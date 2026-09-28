// Monthly read-only API sync. Raw collection matrices remain in scripts/.cache.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const cacheDir = path.join(__dirname, '.cache');
const inputPath = path.join(cacheDir, 'recommendations-input.json');
const peerCacheDir = path.join(cacheDir, 'peers');
const delayMs = Number(process.env.BGM_REFRESH_DELAY_MS || 1500);
const agent = 'wylt-bupt/bangumi-personal-recommender (monthly public-rating aggregation; https://github.com/wylt-bupt/bangumi-personal-recommender)';
let nextRequestAt = 0;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function getJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = nextRequestAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextRequestAt = Date.now() + delayMs;
    let response;
    try {
      response = await fetch(url, { headers: { 'User-Agent': agent }, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(30_000 * (attempt + 1));
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 60_000 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.json();
  }
  throw new Error(`API retry budget exhausted: ${url}`);
}

async function collections(userId) {
  const rows = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset += 50) {
    const page = await getJson(`https://api.bgm.tv/v0/users/${encodeURIComponent(userId)}/collections?subject_type=2&limit=50&offset=${offset}`);
    const batch = Array.isArray(page.data) ? page.data : [];
    total = Number(page.total);
    if (!Number.isFinite(total)) throw new Error(`Invalid collection count for ${userId}`);
    rows.push(...batch);
    if (!batch.length) break;
  }
  return rows;
}

function compactSubject(subject) {
  const image = subject?.images || {};
  return {
    id: Number(subject.id), type: Number(subject.type), name: subject.name || '', name_cn: subject.name_cn || subject.nameCn || '',
    date: subject.date || '', images: { common: image.common || image.medium || image.small || '' },
    tags: Array.isArray(subject.tags) ? subject.tags.map(tag => typeof tag === 'string' ? tag : tag.name).filter(Boolean) : [],
    rating: {
      score: Number(subject.rating?.score || subject.score) || 0,
      total: Number(subject.rating?.total) || 0,
      rank: Number(subject.rating?.rank) || 0,
    },
  };
}

function peerCachePath(userId) {
  const digest = crypto.createHash('sha256').update(userId).digest('hex');
  return path.join(peerCacheDir, `${digest}.json`);
}

function readPeerCache(userId) {
  try {
    const payload = JSON.parse(fs.readFileSync(peerCachePath(userId), 'utf8'));
    if (Date.now() - Number(payload.refreshedAt) > 24 * 60 * 60 * 1000 ||
        !Array.isArray(payload.rated) || !payload.subjects || typeof payload.subjects !== 'object') return null;
    return payload;
  } catch { return null; }
}

function writePeerCache(userId, payload) {
  fs.mkdirSync(peerCacheDir, { recursive: true });
  const target = peerCachePath(userId);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ ...payload, refreshedAt: Date.now() }));
  fs.renameSync(temporary, target);
}

async function rankedSubjects() {
  const subjects = {};
  let total = Infinity;
  for (let offset = 0; offset < total; offset += 100) {
    const page = await getJson(`https://api.bgm.tv/v0/subjects?type=2&sort=rank&limit=100&offset=${offset}`);
    const batch = Array.isArray(page.data) ? page.data : [];
    total = Number(page.total);
    if (!Number.isFinite(total)) throw new Error('Invalid ranked subject count');
    for (const subject of batch) subjects[subject.id] = compactSubject(subject);
    if (!batch.length) break;
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'ranked-subjects.json'), JSON.stringify(subjects));
  console.error(`Ranked metadata: ${Object.keys(subjects).length} subjects`);
  return subjects;
}

async function main() {
  if (process.argv.includes('--ranked-only')) { await rankedSubjects(); return; }
  if (process.argv.includes('--own-only')) {
    const rows = await collections('wylt');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'own-collections.json'), JSON.stringify(rows));
    console.error(`Own collections: ${rows.length}`);
    return;
  }
  const cohort = JSON.parse(fs.readFileSync(path.join(root, 'data/peer-cohort.json'), 'utf8'));
  if (!Array.isArray(cohort) || cohort.length < 60 || new Set(cohort).size !== cohort.length) {
    throw new Error('Peer cohort must contain at least 60 distinct public account IDs');
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  const ownRows = await collections('wylt');
  const subjects = {};
  const own = ownRows.map(row => {
    if (row.subject?.id) subjects[row.subject.id] = compactSubject(row.subject);
    return { subject_id: Number(row.subject_id), rate: Number(row.rate) || 0, subject: compactSubject(row.subject || {}) };
  });
  const peers = [];
  let consecutiveFailures = 0;
  for (const userId of cohort) {
    try {
      const cached = readPeerCache(userId);
      const rows = cached ? null : await collections(userId);
      consecutiveFailures = 0;
      const rated = cached?.rated || rows.filter(row => Number(row.rate) > 0 && Number(row.subject_id) > 0)
        .map(row => [Number(row.subject_id), Number(row.rate)]);
      if (rated.length < 100) continue;
      const peerSubjects = cached?.subjects || {};
      if (!cached) {
        for (const row of rows) {
          if (row.subject?.id) peerSubjects[row.subject.id] = compactSubject(row.subject);
        }
        writePeerCache(userId, { rated, subjects: peerSubjects });
      }
      for (const [itemId, subject] of Object.entries(peerSubjects)) {
        if (!subjects[itemId]) subjects[itemId] = subject;
      }
      peers.push({ rated });
      console.error(`${peers.length}/${cohort.length} usable peers (${rated.length} ratings${cached ? ', cached' : ', fresh'} in latest account)`);
    } catch (error) {
      console.error(`Public peer unavailable: ${String(error).replace(/https?:\/\/\S+/g, '[API URL]').slice(0, 100)}`);
      if (/HTTP 404/.test(String(error))) continue;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) throw new Error('Three consecutive public peer requests failed; preserving previous feed');
    }
  }
  if (peers.length < 60) throw new Error(`Only ${peers.length} public peers remained; refusing to replace the feed`);
  Object.assign(subjects, await rankedSubjects());
  for (const row of own) {
    if (subjects[row.subject_id]) row.subject = subjects[row.subject_id];
  }
  fs.writeFileSync(inputPath, JSON.stringify({ own, peers, subjects }));
  const python = process.env.BGM_PYTHON || 'python';
  const result = spawnSync(python, ['-X', 'utf8', path.join(__dirname, 'build-recommendations.py'), '--input', inputPath], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Feed builder failed with exit code ${result.status}`);
  console.error('Monthly recommendation refresh completed successfully');
}

module.exports = { compactSubject };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
