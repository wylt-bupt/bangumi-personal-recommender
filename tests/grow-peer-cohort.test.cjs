const { test } = require('node:test');
const assert = require('node:assert/strict');
const Grow = require('../scripts/grow-peer-cohort.cjs');

test('seed selection samples all three rating bands at fixed fractions', () => {
  const ratings = [1, 2, 3, 4, 5, 6, 6, 7, 7, 6, 8, 8, 9, 10, 8];
  const own = ratings.map((rate, index) => ({ subject_id: 1000 + index, rate }));
  const seeds = Grow.selectSeeds(own);
  assert.equal(seeds.length, 12);
  assert.ok([...new Set(seeds)].length === seeds.length);
  const band = (predicate) => seeds.filter(id => predicate(ratings[id - 1000])).length;
  assert.equal(band(rate => rate <= 5), 4);
  assert.equal(band(rate => rate === 6 || rate === 7), 4);
  assert.equal(band(rate => rate >= 8), 4);
});

test('comment page plan is bounded, deduplicated and always includes the first page', () => {
  const plan = Grow.commentPagePlan(25);
  assert.equal(plan[0], 1);
  assert.ok(new Set(plan).size === plan.length);
  assert.ok(plan.every(p => p >= 1 && p <= 25));
  // a three-page subject must not get an out-of-range probe page
  assert.deepEqual(Grow.commentPagePlan(3).sort((a, b) => a - b), [1, 2, 3]);
  assert.deepEqual(Grow.commentPagePlan(1), [1]);
});

test('candidate user ids come from data-item-user attributes only', () => {
  const html = '<a data-item-user="wylt_1">A</a><span>skip</span><i data-item-user="B2"></i>';
  assert.deepEqual(Grow.candidateUserIds(html), ['wylt_1', 'B2']);
  assert.deepEqual(Grow.candidateUserIds('no markers'), []);
  assert.deepEqual(Grow.candidateUserIds('<i data-item-user="x" onclick="evil">'), ['x']);
});

test('hash sort is deterministic regardless of input order', () => {
  const ids = ['alpha', 'Beta-2', 'gamma_3', 'delta'];
  const one = Grow.hashSort(ids);
  const two = Grow.hashSort(['delta', 'gamma_3', 'Beta-2', 'alpha']);
  assert.deepEqual(one, two);
  assert.equal(one.length, 4);
});
