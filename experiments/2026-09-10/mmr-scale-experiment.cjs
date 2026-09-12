"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Core = require("../../src/core.cjs");
const Existing = require("./run.cjs");
const Neighbor = require("./neighbor-robustness-experiment.cjs");

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "../2026-09-07/snapshot.json"), "utf8"));
const details = JSON.parse(fs.readFileSync(path.join(__dirname, "rating-details.json"), "utf8"));
const candidateDetails = JSON.parse(fs.readFileSync(path.join(__dirname, "candidate-details.json"), "utf8"));

function normalizedMmr(scoredInputs, count) {
  const scores = scoredInputs.map((item) => item.normalizedScore);
  const high = Math.max(...scores);
  const low = Math.min(...scores);
  const scale = Math.max(1e-9, high - low);
  const remaining = scoredInputs.map((item) => ({ item, maxSimilarity: 0 }));
  const selected = [];
  while (selected.length < count && remaining.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index];
      const relevance = (entry.item.normalizedScore - low) / scale;
      const adjusted = relevance - 0.24 * entry.maxSimilarity;
      if (adjusted > bestValue) {
        bestValue = adjusted;
        bestIndex = index;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    selected.push(chosen.item);
    const chosenFeatures = chosen.item.diversityFeatures || chosen.item.features || {};
    for (const entry of remaining) {
      const features = entry.item.diversityFeatures || entry.item.features || {};
      entry.maxSimilarity = Math.max(entry.maxSimilarity, Core.weightedJaccard(features, chosenFeatures));
    }
  }
  return selected;
}

function rank(rows, id) {
  const index = rows.findIndex((item) => Number(item.subject.id) === Number(id));
  return index < 0 ? null : index + 1;
}

const collections = snapshot.collections.map(Core.normalizeCollection).filter((item) => item.rate > 0);
let profile = Existing.trainExperimental(collections, details, "B");
profile = Neighbor.attachSemanticAnchors(profile, collections);
const candidates = snapshot.candidates.filter((subject) => !Existing.candidateExclusion(subject, candidateDetails.subjects[subject.id]));
const output = {};
for (const variant of ["B", "Q", "R25", "R35"]) {
  const raw = candidates.map((subject) => Neighbor.score(subject, profile, variant)).sort((a, b) => b.normalizedScore - a.normalizedScore);
  const legacy = Core.diversify(raw.slice(0, 180), 180, "balanced", "2026-09-10-fixed");
  const normalized = normalizedMmr(raw.slice(0, 180), 180);
  output[variant] = {
    focus: Object.fromEntries([11577, 253, 799, 1029].map((id) => [id, {
      raw: rank(raw, id), legacyMmr: rank(legacy, id), normalizedMmr: rank(normalized, id),
    }])),
    normalizedTop20: normalized.slice(0, 20).map((item, index) => ({
      rank: index + 1,
      id: item.subject.id,
      name: item.subject.nameCn || item.subject.name,
      predicted: Number(item.predicted.toFixed(3)),
    })),
  };
}
fs.writeFileSync(path.join(__dirname, "mmr-scale-results.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
