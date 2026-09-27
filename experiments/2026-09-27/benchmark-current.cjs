// Offline preference-discrimination benchmark on the fresh local snapshot.
// A grouped holdout keeps entries from the same inferred series in one fold.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Core = require('../../src/core.cjs');

const root = __dirname;
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'snapshot.json'), 'utf8'));
const ratingDetails = JSON.parse(fs.readFileSync(path.join(root, 'rating-details.json'), 'utf8'));
const collections = snapshot.collections[2].map(Core.normalizeCollection).map(row => ({
  ...row,
  subject: {
    ...row.subject,
    rating: {
      ...row.subject.rating,
      total: Number(ratingDetails.subjects[row.subjectId]?.rating?.total || 0),
    },
  },
}));
// Some collected titles return 404 from the subject-detail API. They still
// contribute to training preferences, but cannot be scored fairly as test
// candidates without the vote-count evidence required by the quality prior.
const rated = collections.filter(row => row.rate > 0 && row.subject.rating.total > 0);
if (!rated.length) throw new Error('No vote totals; run enrich-ratings.cjs first');
const foldOf = row => crypto.createHash('sha256').update(Core.seriesFamilyKey(row.subject)).digest()[0] % 5;
const scoreVariants = {
  current: row => row.normalizedScore,
  contentOnly: row => row.contentScore,
  qualityOnly: row => row.qualityScore,
  halfAndHalf: row => 0.5 * row.contentScore + 0.5 * row.qualityScore,
  oldNeighborBlend: row => 0.6 * row.contentScore + 0.25 * row.rawNeighborScore * row.neighborReliability + 0.15 * row.qualityScore,
};

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const rounded = value => Math.round(value * 10000) / 10000;
function auc(rows) {
  const positive = rows.filter(row => row.rate >= 8);
  const negative = rows.filter(row => row.rate <= 6);
  let wins = 0;
  for (const p of positive) for (const n of negative) wins += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0;
  return wins / (positive.length * negative.length);
}
function ranking(rows) {
  const ordered = [...rows].sort((a, b) => b.score - a.score || a.id - b.id).slice(0, 20);
  const precision = ordered.filter(row => row.rate >= 8).length / 20;
  const dcg = ordered.reduce((sum, row, index) => sum + (row.rate >= 8 ? 1 / Math.log2(index + 2) : 0), 0);
  const ideal = [...rows].filter(row => row.rate >= 8).slice(0, 20)
    .reduce((sum, _, index) => sum + 1 / Math.log2(index + 2), 0);
  return { precision, ndcg: dcg / ideal };
}

const folds = [];
for (let fold = 0; fold < 5; fold += 1) {
  const train = collections.filter(row => !row.rate || foldOf(row) !== fold);
  const test = rated.filter(row => foldOf(row) === fold);
  const profile = Core.trainProfile(train);
  const scored = test.map(row => ({
    id: row.subjectId,
    rate: row.rate,
    ...Core.scoreSubject(row.subject, profile),
  }));
  const metrics = {};
  for (const [name, score] of Object.entries(scoreVariants)) {
    const rows = scored.map(row => ({ id: row.id, rate: row.rate, score: score(row) }));
    metrics[name] = { auc: auc(rows), ...ranking(rows) };
  }
  folds.push({ fold, train: train.filter(row => row.rate).length, test: test.length, positive: test.filter(row => row.rate >= 8).length, negative: test.filter(row => row.rate <= 6).length, metrics });
}
const summary = Object.fromEntries(Object.keys(scoreVariants).map(name => [name, Object.fromEntries(
  ['auc', 'precision', 'ndcg'].map(metric => [metric, rounded(mean(folds.map(fold => fold.metrics[name][metric])))]),
)]));
const result = { snapshotAt: snapshot.fetchedAt, voteTotalProvenance: `${ratingDetails.reused} reused from the 2026-09-10 cache; the remainder fetched on ${ratingDetails.fetchedAt}`, inaccessibleDetails: collections.filter(row => row.rate > 0 && !row.subject.rating.total).length, protocol: '5-fold inferred-series-grouped holdout; held-out rated anime with vote-count evidence ranked per fold; other titles contribute to training only; no sampled negatives', folds, summary };
fs.writeFileSync(path.join(root, 'benchmark-details.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ snapshotAt: result.snapshotAt, voteTotalProvenance: result.voteTotalProvenance, inaccessibleDetails: result.inaccessibleDetails, protocol: result.protocol, folds: folds.map(({ fold, train, test, positive, negative }) => ({ fold, train, test, positive, negative })), summary }, null, 2));
