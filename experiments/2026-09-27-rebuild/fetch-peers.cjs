// Read-only, deliberately rate-limited pilot. Raw peer rows stay git-ignored.
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const dataDir = path.join(root, 'data');
const snapshot = JSON.parse(fs.readFileSync(path.join(root, '../2026-09-27/snapshot.json'), 'utf8'));
const own = snapshot.collections[2].filter(row => row.rate > 0 && row.subjectId);
const output = path.join(dataDir, 'peers.json');
const previous = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : { fetchedAt: null, seeds: [], candidates: [], peers: {}, skipped: {} };
previous.subjects ||= {};
const AGENT = 'wylt-bupt/bangumi-personal-recommender (read-only collaborative-filtering pilot; https://github.com/wylt-bupt/bangumi-personal-recommender)';
const delayMs = Number(process.env.BGM_PILOT_DELAY_MS || 1500);
const maxPeers = Number(process.env.BGM_PILOT_MAX_PEERS || 40);
const maxCandidates = Number(process.env.BGM_PILOT_MAX_CANDIDATES || 1000);
let nextRequestAt = 0;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function get(url) {
  const wait = nextRequestAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextRequestAt = Date.now() + delayMs;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      headers: { 'User-Agent': AGENT },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429 || response.status >= 500) {
      const seconds = Number(response.headers.get('retry-after'));
      const backoff = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Math.max(60_000, 30_000 * 2 ** attempt);
      console.error(`HTTP ${response.status} ${url}; waiting ${Math.ceil(backoff / 1000)}s`);
      await sleep(backoff);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
    return response;
  }
  throw new Error(`Failed after retries: ${url}`);
}

function save() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(output, JSON.stringify(previous));
}

function selectSeeds() {
  const byBand = [row => row.rate <= 5, row => row.rate === 6 || row.rate === 7, row => row.rate >= 8];
  const picked = [];
  for (const predicate of byBand) {
    const rows = own.filter(predicate).sort((a, b) => a.subjectId - b.subjectId);
    for (const fraction of [0.12, 0.37, 0.62, 0.87]) {
      picked.push(rows[Math.floor((rows.length - 1) * fraction)].subjectId);
    }
  }
  return [...new Set(picked)];
}

async function discover() {
  if (previous.candidates.length >= maxCandidates) return;
  const seeds = selectSeeds();
  const userIds = new Set(previous.candidates);
  for (const subjectId of seeds) {
    // Comment pages contain users who actually write about and rate a title;
    // recent collection pages yielded many accounts with no ratings at all.
    const firstUrl = `https://bgm.tv/subject/${subjectId}/comments`;
    const firstHtml = await (await get(firstUrl)).text();
    const pageNumbers = [...firstHtml.matchAll(/href="\?page=(\d+)"/g)].map(match => Number(match[1]));
    const lastPage = Math.max(1, ...pageNumbers);
    for (const page of [...new Set([1, 8, ...[0.25, 0.5, 0.75, 1].map(part => Math.max(1, Math.ceil(lastPage * part)))])]) {
      const url = `https://bgm.tv/subject/${subjectId}/comments?page=${page}`;
      const html = page === 1 ? firstHtml : await (await get(url)).text();
      for (const match of html.matchAll(/data-item-user="([A-Za-z0-9_]+)"/g)) userIds.add(match[1]);
    }
    console.error(`Seed ${subjectId}: ${userIds.size} candidate users`);
  }
  previous.seeds = seeds;
  const hash = id => {
    let value = 2166136261;
    for (const character of id) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
    return value >>> 0;
  };
  previous.candidates = [...userIds].filter(id => id !== '727034')
    .sort((left, right) => hash(left) - hash(right))
    .slice(0, maxCandidates);
  save();
}

async function main() {
  await discover();
  for (const userId of previous.candidates) {
    if (Object.keys(previous.peers).length >= maxPeers) break;
    if (previous.peers[userId] || previous.skipped[userId]) continue;
    try {
      const base = `https://api.bgm.tv/v0/users/${userId}/collections?subject_type=2&limit=50&offset=`;
      const first = await (await get(base + '0')).json();
      if (first.total < 120) {
        previous.skipped[userId] = `anime collections ${first.total} < 120`;
        save();
        continue;
      }
      if (first.data.filter(row => row.rate > 0).length < 5) {
        previous.skipped[userId] = 'fewer than 5 ratings on first page';
        save();
        continue;
      }
      const rows = [...first.data];
      for (let offset = 50; offset < first.total; offset += 50) {
        const page = await (await get(base + offset)).json();
        rows.push(...page.data);
      }
      for (const row of rows) {
        const subject = row.subject;
        if (!subject?.id) continue;
        previous.subjects[subject.id] = {
          id: subject.id,
          type: subject.type,
          name: subject.name,
          name_cn: subject.name_cn,
          date: subject.date,
          images: subject.images,
          tags: subject.tags,
          rating: subject.rating,
          platform: subject.platform,
          eps: subject.eps,
        };
      }
      const rated = rows.filter(row => row.rate > 0 && row.subject_id > 0).map(row => [row.subject_id, row.rate]);
      if (rated.length < 100) previous.skipped[userId] = `rated ${rated.length} < 100`;
      else previous.peers[userId] = { rated, total: rows.length };
      previous.fetchedAt = new Date().toISOString();
      save();
      console.error(`User ${userId}: ${rows.length} collections, ${rated.length} rated; ${Object.keys(previous.peers).length}/${maxPeers} peers`);
    } catch (error) {
      console.error(`User ${userId}: ${error}`);
      if (/HTTP 404/.test(String(error))) {
        previous.skipped[userId] = String(error);
        save();
      } else {
        // A transient failure must not turn this user into a permanent reject.
        throw error;
      }
    }
  }
  console.log(JSON.stringify({ seeds: previous.seeds, candidates: previous.candidates.length, peers: Object.keys(previous.peers).length, skipped: Object.keys(previous.skipped).length, fetchedAt: previous.fetchedAt }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
