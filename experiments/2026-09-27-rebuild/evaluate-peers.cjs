// Offline sanity check: whether a small, freshly sampled peer matrix carries
// real predictive information for wylt, compared on identical held-out titles.
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../../legacy/src/core.cjs');

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '../2026-09-27/snapshot.json'), 'utf8'));
const pilot = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/peers.json'), 'utf8'));
const neighborLimit = Number(process.env.BGM_PILOT_KNN || 20);
const own = snapshot.collections[2].map(Core.normalizeCollection).filter(row => row.rate > 0);
const peers = Object.entries(pilot.peers).map(([id, peer]) => {
  const ratings = new Map(peer.rated.map(([subjectId, rate]) => [subjectId, rate]));
  const mean = peer.rated.reduce((sum, [, rate]) => sum + rate, 0) / peer.rated.length;
  return { id, ratings, mean, count: ratings.size };
});

function foldOf(row) {
  const key = Core.seriesFamilyKey(row.subject);
  let hash = 2166136261;
  for (const ch of key) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return (hash >>> 0) % 5;
}

function mean(values) { return values.reduce((sum, x) => sum + x, 0) / Math.max(1, values.length); }

function fit(train) {
  const ownMap = new Map(train.map(row => [row.subjectId, row.rate]));
  const siteMap = new Map(train.map(row => [row.subjectId, row.subject.rating.score || 6.8]));
  const userMean = mean(train.map(row => row.rate));
  const userSiteBias = mean(train.map(row => row.rate - (row.subject.rating.score || 6.8)));
  const neighborModels = peers.map(peer => {
    const pairs = [...ownMap.entries()]
      .filter(([id]) => peer.ratings.has(id))
      .map(([id, rate]) => [rate, peer.ratings.get(id), siteMap.get(id)]);
    if (pairs.length < 12) return { ...peer, overlap: pairs.length, similarity: 0 };
    const xMean = mean(pairs.map(([x, , site]) => x - site));
    const yMean = mean(pairs.map(([, y, site]) => y - site));
    const peerSiteBias = mean(pairs.map(([, y, site]) => y - site));
    let covariance = 0; let xNorm = 0; let yNorm = 0;
    for (const [x, y, site] of pairs) {
      covariance += (x - site - xMean) * (y - site - yMean);
      xNorm += (x - site - xMean) ** 2;
      yNorm += (y - site - yMean) ** 2;
    }
    const pearson = xNorm * yNorm > 0 ? covariance / Math.sqrt(xNorm * yNorm) : 0;
    const similarity = Math.max(0, pearson) * pairs.length / (pairs.length + 20);
    return { ...peer, overlap: pairs.length, similarity, peerSiteBias };
  }).filter(peer => peer.similarity > 0).sort((a, b) => b.similarity - a.similarity).slice(0, neighborLimit);
  return { userMean, userSiteBias, neighborModels };
}

function predict(model, subjectId) {
  let numerator = 0; let weight = 0; let voters = 0;
  for (const peer of model.neighborModels) {
    if (!peer.ratings.has(subjectId)) continue;
    numerator += peer.similarity * (peer.ratings.get(subjectId) - peer.mean);
    weight += peer.similarity;
    voters++;
  }
  return voters ? { score: Math.max(1, Math.min(10, model.userMean + numerator / weight)), voters, weight } : null;
}

function predictSiteResidual(model, subjectId, siteScore) {
  let numerator = 0; let weight = 0; let voters = 0;
  for (const peer of model.neighborModels) {
    if (!peer.ratings.has(subjectId)) continue;
    numerator += peer.similarity * (peer.ratings.get(subjectId) - siteScore - peer.peerSiteBias);
    weight += peer.similarity;
    voters++;
  }
  const baseline = siteScore + model.userSiteBias;
  const confidence = weight / (weight + 1);
  return {
    score: Math.max(1, Math.min(10, baseline + (weight ? confidence * numerator / weight : 0))),
    baseline: Math.max(1, Math.min(10, baseline)), confidence,
  };
}

function mae(rows, key) { return mean(rows.map(row => Math.abs(row[key] - row.truth))); }
function rmse(rows, key) { return Math.sqrt(mean(rows.map(row => (row[key] - row.truth) ** 2))); }
function ndcg(rows, key, n = 20) {
  const gain = (row, index) => (2 ** row.truth - 1) / Math.log2(index + 2);
  const actual = [...rows].sort((a, b) => b[key] - a[key]).slice(0, n).reduce((sum, row, index) => sum + gain(row, index), 0);
  const ideal = [...rows].sort((a, b) => b.truth - a.truth).slice(0, n).reduce((sum, row, index) => sum + gain(row, index), 0);
  return ideal ? actual / ideal : 0;
}

const folds = [];
for (let fold = 0; fold < 5; fold++) {
  const train = own.filter(row => foldOf(row) !== fold);
  const test = own.filter(row => foldOf(row) === fold);
  const model = fit(train);
  const common = test.map(row => {
    const prediction = predict(model, row.subjectId);
    return prediction ? {
      id: row.subjectId, truth: row.rate, collaborative: prediction.score,
      global: row.subject.rating.score || 6.8, voters: prediction.voters,
      siteResidual: predictSiteResidual(model, row.subjectId, row.subject.rating.score || 6.8).score,
      calibratedGlobal: predictSiteResidual(model, row.subjectId, row.subject.rating.score || 6.8).baseline,
    } : null;
  }).filter(Boolean);
  folds.push({
    fold, test: test.length, covered: common.length,
    activePeers: model.neighborModels.length,
    medianOverlap: model.neighborModels.length
      ? [...model.neighborModels.map(peer => peer.overlap)].sort((a, b) => a - b)[Math.floor(model.neighborModels.length / 2)] : 0,
    meanVoters: mean(common.map(row => row.voters)),
    collaborativeMae: mae(common, 'collaborative'), globalMae: mae(common, 'global'),
    siteResidualMae: mae(common, 'siteResidual'), calibratedGlobalMae: mae(common, 'calibratedGlobal'),
    collaborativeRmse: rmse(common, 'collaborative'), globalRmse: rmse(common, 'global'),
    collaborativeNdcg20: ndcg(common, 'collaborative'), globalNdcg20: ndcg(common, 'global'),
    siteResidualNdcg20: ndcg(common, 'siteResidual'), calibratedGlobalNdcg20: ndcg(common, 'calibratedGlobal'),
  });
}
const model = fit(own);
const seen = new Set(own.map(row => row.subjectId));
const candidateIds = new Set();
for (const peer of model.neighborModels) for (const id of peer.ratings.keys()) if (!seen.has(id)) candidateIds.add(id);
console.log(JSON.stringify({
  peerCount: peers.length,
  neighborLimit,
  usablePeers: model.neighborModels.length,
  candidateCount: candidateIds.size,
  strongestPeers: model.neighborModels.slice(0, 10).map(({ id, count, overlap, similarity }) => ({ id, count, overlap, similarity })),
  folds,
  average: Object.fromEntries(['covered', 'collaborativeMae', 'globalMae', 'siteResidualMae', 'calibratedGlobalMae', 'collaborativeRmse', 'globalRmse', 'collaborativeNdcg20', 'globalNdcg20', 'siteResidualNdcg20', 'calibratedGlobalNdcg20'].map(key => [key, mean(folds.map(fold => fold[key]))])),
}, null, 2));
