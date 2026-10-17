// Prints the franchise-marked origin/watched classification of every subject
// in a recommendations-input file so the Python builder can filter candidate
// pools. Same JSON in -> JSON out pattern as scripts/family-folds.cjs.
"use strict";

const fs = require("node:fs");
const eligibility = require("../src/candidate-eligibility.cjs");

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("usage: node scripts/candidate-eligibility.cjs <recommendations-input.json>");
  process.exit(2);
}

const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const markedKeys = eligibility.markedFranchiseKeys(input.own || []);
const exclusions = {};
const stats = { origin: 0, watchedFranchise: 0 };
for (const [id, subject] of Object.entries(input.subjects || {})) {
  const reason = eligibility.excludeReason(subject, markedKeys);
  if (reason) {
    exclusions[id] = reason;
    stats[reason] += 1;
  }
}
process.stdout.write(JSON.stringify({
  markedFranchiseCount: markedKeys.size,
  stats,
  exclusions,
}));
