// Read-only audit of the production anime candidate retrieval routes.
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../../src/core.cjs');

const root = __dirname;
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'snapshot.json'), 'utf8'));
const cachePath = path.join(root, 'candidate-pages-details.json');
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : { rank: {}, search: {} };
const saveCache = () => fs.writeFileSync(cachePath, JSON.stringify(cache));
const collections = snapshot.collections[2].map(Core.normalizeCollection);
const profile = Core.trainProfile(collections);
const tags = Core.topRetrievalTags(profile, 12);
const seen = new Map(collections.map(row => [row.subjectId, row]));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(pathname, body) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(`https://api.bgm.tv${pathname}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'User-Agent': 'wylt-bupt/bangumi-personal-recommender (read-only candidate audit)', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
      if (response.ok) return response.json();
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 4) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt === 4) throw error;
    }
    await pause(1000 * (attempt + 1));
  }
}

async function main() {
  const rank = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    if (!cache.rank[offset]) {
      const page = await request(`/v0/subjects?type=2&sort=rank&limit=100&offset=${offset}`);
      cache.rank[offset] = page.data || [];
      saveCache();
    }
    rank.push(...cache.rank[offset]);
    console.error(`rank ${offset + 100}/1000`);
    await pause(120);
  }
  const jobs = tags.flatMap(tag => [0, 50].map(offset => ({ tag, offset })));
  const searched = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < jobs.length) {
      const { tag, offset } = jobs[cursor++];
      const key = `${tag}:${offset}`;
      if (!cache.search[key]) {
        const page = await request(`/v0/search/subjects?limit=50&offset=${offset}`, {
          keyword: tag, sort: 'heat', filter: { type: [2], tag: [tag] },
        });
        cache.search[key] = page.data || [];
        saveCache();
      }
      searched.push({ tag, offset, data: cache.search[key] });
      console.error(`tag ${tag} ${offset}: ${cache.search[key].length}`);
      await pause(150);
    }
  }));
  const correctedJobs = tags.flatMap(tag => [0, 20].map(offset => ({ tag, offset })));
  const corrected = [];
  cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < correctedJobs.length) {
      const { tag, offset } = correctedJobs[cursor++];
      const key = `filter-only:${tag}:${offset}`;
      if (!cache.search[key]) {
        const page = await request(`/v0/search/subjects?limit=20&offset=${offset}`, {
          keyword: '', sort: 'heat', filter: { type: [2], tag: [tag] },
        });
        cache.search[key] = page.data || [];
        saveCache();
      }
      corrected.push({ tag, offset, data: cache.search[key] });
      console.error(`corrected ${tag} ${offset}: ${cache.search[key].length}`);
      await pause(150);
    }
  }));
  const ids = items => new Set(items.map(item => Number(item.id)).filter(Boolean));
  const rankIds = ids(rank);
  const tagIds = ids(searched.flatMap(page => page.data));
  const unionIds = new Set([...rankIds, ...tagIds]);
  const correctedIds = ids(corrected.flatMap(page => page.data));
  const correctedUnionIds = new Set([...rankIds, ...correctedIds]);
  const count = set => {
    let liked = 0, neutral = 0, disliked = 0, marked = 0;
    for (const id of set) {
      const row = seen.get(id);
      if (!row) continue;
      marked += 1;
      if (row.rate >= 8) liked += 1;
      else if (row.rate === 7) neutral += 1;
      else if (row.rate > 0) disliked += 1;
    }
    return { raw: set.size, marked, unmarked: set.size - marked, liked, neutral, disliked };
  };
  const result = {
    fetchedAt: new Date().toISOString(), profileAt: snapshot.fetchedAt, tags,
    rank: count(rankIds), tagsOnly: count(new Set([...tagIds].filter(id => !rankIds.has(id)))),
    union: count(unionIds), perTag: tags.map(tag => ({ tag, ...count(ids(searched.filter(page => page.tag === tag).flatMap(page => page.data))) })),
    correctedTagsOnly: count(new Set([...correctedIds].filter(id => !rankIds.has(id)))),
    correctedUnion: count(correctedUnionIds),
    correctedPerTag: tags.map(tag => ({ tag, ...count(ids(corrected.filter(page => page.tag === tag).flatMap(page => page.data))) })),
    caveat: 'Diagnostic retrieval overlap only; tags are learned from the full collection. Not a held-out recall estimate, not post-origin/exclusion filtering.',
  };
  fs.writeFileSync(path.join(root, 'candidate-details.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
