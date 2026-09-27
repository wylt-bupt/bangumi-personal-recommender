// Complete the public vote totals omitted from collection-list subjects.
// Reuse the prior local API cache where available; fetch only missing IDs.
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'snapshot.json'), 'utf8'));
const destination = path.join(root, 'rating-details.json');
const prior = path.join(root, '..', '2026-09-10', 'rating-details.json');
const seed = fs.existsSync(destination) ? JSON.parse(fs.readFileSync(destination, 'utf8'))
  : fs.existsSync(prior) ? JSON.parse(fs.readFileSync(prior, 'utf8')) : { subjects: {}, errors: {} };
const details = { subjects: { ...seed.subjects }, errors: { ...seed.errors } };
const ids = [...new Set(snapshot.collections[2].filter(row => row.rate > 0).map(row => row.subjectId))];
const missing = ids.filter(id => !details.subjects[id]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getRating(id) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`https://api.bgm.tv/v0/subjects/${id}`, {
        headers: { 'User-Agent': 'wylt-bupt/bangumi-personal-recommender (read-only personal modeling)' },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const subject = await response.json();
      return { id, rating: subject.rating };
    } catch (error) {
      if (attempt === 2) throw error;
      await pause((attempt + 1) * 1000);
    }
  }
}

async function main() {
  let cursor = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < missing.length) {
      const id = missing[cursor++];
      try {
        details.subjects[id] = await getRating(id);
        delete details.errors[id];
      } catch (error) {
        details.errors[id] = String(error);
      }
      completed += 1;
      if (completed % 25 === 0 || completed === missing.length) {
        console.error(`rating details ${completed}/${missing.length}`);
        fs.writeFileSync(destination, JSON.stringify({ ...details, fetchedAt: new Date().toISOString(), reused: ids.length - missing.length }));
      }
      await pause(200);
    }
  }));
  console.log(JSON.stringify({ total: ids.length, reused: ids.length - missing.length, fetched: missing.length, available: ids.filter(id => details.subjects[id]?.rating?.total > 0).length, errors: ids.filter(id => !details.subjects[id]).length }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
