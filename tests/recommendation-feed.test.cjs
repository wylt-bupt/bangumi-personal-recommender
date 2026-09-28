const { test } = require('node:test');
const assert = require('node:assert/strict');
const Feed = require('../src/recommendation-feed.cjs');

function candidate(id, predicted, extra = {}) {
  return { subject: { id, type: 2, name: `Title ${id}`, tags: ['治愈'], rating: { score: 7, total: 10 }, ...extra }, predicted, reasons: ['根据评分'], collaborativeLift: 0.2 };
}

function validFeed(rows) {
  return { schema: 1, owner: 'wylt', generatedAt: '2026-09-28T00:00:00Z', peerCount: 100, ratedCount: 1325, model: 'joint', candidates: rows };
}

test('rejects incompatible or non-owner feeds before rendering', () => {
  const rows = Array.from({ length: 5 }, (_, index) => candidate(index + 1, 8));
  assert.throws(() => Feed.parseFeed({ ...validFeed(rows), owner: 'another' }), /不兼容/);
  assert.throws(() => Feed.parseFeed({ ...validFeed(rows), schema: 0 }), /不兼容/);
  assert.throws(() => Feed.parseFeed({ ...validFeed(rows), generatedAt: 'no date' }), /不兼容/);
});

test('deduplicates and ranks valid anime, dropping malformed rows', () => {
  const rows = [candidate(2, 7), candidate(1, 9), candidate(1, 8), candidate(3, NaN),
    candidate(4, 6, { type: 1 }), candidate(5, 8), candidate(6, 7), candidate(7, 6)];
  const feed = Feed.parseFeed(validFeed(rows));
  assert.deepEqual(feed.candidates.map((item) => item.subject.id), [1, 5, 2, 6, 7]);
});

test('filters every marked status, not merely rated or watched entries', () => {
  const feed = Feed.parseFeed(validFeed(Array.from({ length: 6 }, (_, index) => candidate(index + 1, 8))));
  const actual = Feed.unmarkedCandidates(feed, [
    { subject_id: 1, type: 1, rate: 0 },
    { subject_id: 2, type: 2, rate: 0 },
    { subject_id: 3, type: 3, rate: 0 },
    { subject_id: 4, type: 5, rate: 2 },
  ]);
  assert.deepEqual(actual.map((item) => item.subject.id), [5, 6]);
});

test('does not retain arbitrary HTML fields from external feed', () => {
  const raw = validFeed(Array.from({ length: 5 }, (_, index) => candidate(index + 1, 8, { malicious: '<script>' })));
  raw.candidates[0].subject.image = 'javascript:alert(1)';
  raw.candidates[0].untrustedHtml = '<script>bad()</script>';
  const normalized = Feed.parseFeed(raw);
  assert.equal(normalized.candidates[0].untrustedHtml, undefined);
  assert.equal(normalized.candidates[0].subject.malicious, undefined);
});
