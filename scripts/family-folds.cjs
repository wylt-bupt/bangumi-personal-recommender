const fs = require('node:fs');
const crypto = require('node:crypto');
const { seriesFamilyKey } = require('../src/series-family.cjs');

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const folds = input.own.filter(row => Number(row.rate) > 0).map(row => {
  const family = seriesFamilyKey(row.subject || {});
  const digest = crypto.createHash('sha256').update(family).digest();
  return digest.readUInt32BE(0) % 5;
});
process.stdout.write(JSON.stringify(folds));
