// Local bridge for testing the production feed builder against the pilot.
// The generated raw input stays ignored; never commit public users' rating rows.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'experiments/2026-09-27/snapshot.json'), 'utf8'));
const pilot = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/peers.json'), 'utf8'));
const freshOwnPath = path.join(root, 'scripts/.cache/own-collections.json');
const freshOwn = fs.existsSync(freshOwnPath) ? JSON.parse(fs.readFileSync(freshOwnPath, 'utf8')) : null;
const own = freshOwn || snapshot.collections[2];
const subjects = { ...(pilot.subjects || {}) };
for (const row of own) subjects[row.subjectId || row.subject_id] = row.subject;
const rankedPath = path.join(root, 'scripts/.cache/ranked-subjects.json');
if (fs.existsSync(rankedPath)) Object.assign(subjects, JSON.parse(fs.readFileSync(rankedPath, 'utf8')));
for (const row of own) {
  const subject = subjects[row.subjectId || row.subject_id];
  if (subject) row.subject = subject;
}
const peers = Object.values(pilot.peers).map(peer => ({ rated: peer.rated }));
const output = path.join(root, 'scripts/.cache/recommendations-input.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ own, peers, subjects }));
console.log(JSON.stringify({ own: own.length, peers: peers.length, subjects: Object.keys(subjects).length }));
