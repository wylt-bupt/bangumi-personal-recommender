// Use the established series grouping only to prevent evaluation leakage.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Core = require('../../src/core.cjs');

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '../2026-09-27/snapshot.json'), 'utf8'));
const own = snapshot.collections[2].filter(row => row.rate > 0);
console.log(JSON.stringify(own.map(row =>
  crypto.createHash('sha256').update(Core.seriesFamilyKey(row.subject)).digest()[0] % 5,
)));
