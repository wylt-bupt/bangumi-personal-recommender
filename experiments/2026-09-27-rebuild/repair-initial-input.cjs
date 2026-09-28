// One-time repair for the bootstrap cache collected before direct score support.
// Run refresh-recommendations.cjs --own-only first. Monthly refresh needs no repair.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compactSubject } = require('../../scripts/refresh-recommendations.cjs');
const root = path.resolve(__dirname, '../..');
const inputPath = path.join(root, 'scripts/.cache/recommendations-input.json');
const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const ownRows = JSON.parse(fs.readFileSync(path.join(root, 'scripts/.cache/own-collections.json'), 'utf8'));
let repaired = 0;
data.own = ownRows.map(row => {
  const id = Number(row.subject_id);
  const fresh = compactSubject(row.subject || {});
  const previous = data.subjects[id];
  if (!previous?.rating?.score && fresh.rating.score) {
    data.subjects[id] = fresh;
    repaired += 1;
  }
  return { subject_id: id, rate: Number(row.rate) || 0, subject: data.subjects[id] || fresh };
});

function build() {
  fs.writeFileSync(inputPath, JSON.stringify(data));
  const result = spawnSync(process.env.BGM_PYTHON || 'python', ['-X', 'utf8', path.join(root, 'scripts/build-recommendations.py'), '--input', inputPath], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error || new Error(`Builder exit ${result.status}`);
}

async function main() {
  console.error(`Recovered site scores for ${repaired} own subjects`);
  build();
  const attempted = new Set();
  for (let round = 0; round < 3; round++) {
    const feed = JSON.parse(fs.readFileSync(path.join(root, 'public/recommendations.json'), 'utf8'));
    const missing = feed.candidates.filter(row => !row.subject.rating.score && !attempted.has(row.subject.id));
    if (!missing.length) break;
    if (attempted.size + missing.length > 30) throw new Error('Unexpected missing-score volume in initial top 500');
    for (const row of missing) {
      const id = row.subject.id;
      attempted.add(id);
      await new Promise(resolve => setTimeout(resolve, 1500));
      const response = await fetch(`https://api.bgm.tv/v0/subjects/${id}`, {
        headers: { 'User-Agent': 'wylt-bupt/bangumi-personal-recommender (initial metadata repair)' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Subject metadata HTTP ${response.status}`);
      data.subjects[id] = compactSubject(await response.json());
    }
    build();
  }
  console.error(`Initial repair complete: ${attempted.size} candidate details checked`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
