// Recover an interrupted local bootstrap from the already-collected pilot.
// Never used by the monthly GitHub Action; that starts with an empty cache.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const source = path.join(__dirname, 'data/peers.json');
const pilot = JSON.parse(fs.readFileSync(source, 'utf8'));
const cohort = JSON.parse(fs.readFileSync(path.join(root, 'data/peer-cohort.json'), 'utf8'));
const count = Math.min(cohort.length, Math.max(0, Number(process.argv[2]) || 0));
const cacheDir = path.join(root, 'scripts/.cache/peers');
const collectedAt = fs.statSync(source).mtimeMs;
fs.mkdirSync(cacheDir, { recursive: true });
for (const userId of cohort.slice(0, count)) {
  const rated = pilot.peers[userId]?.rated;
  if (!Array.isArray(rated) || rated.length < 100) throw new Error(`Pilot data missing for ${userId}`);
  const subjects = {};
  for (const [itemId] of rated) {
    if (pilot.subjects[itemId]) subjects[itemId] = pilot.subjects[itemId];
  }
  const digest = crypto.createHash('sha256').update(userId).digest('hex');
  fs.writeFileSync(path.join(cacheDir, `${digest}.json`), JSON.stringify({ rated, subjects, refreshedAt: collectedAt }));
}
console.log(`Seeded ${count} local peer checkpoints from the pilot collected at ${new Date(collectedAt).toISOString()}`);
