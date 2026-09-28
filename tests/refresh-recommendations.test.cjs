const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compactSubject } = require('../scripts/refresh-recommendations.cjs');

test('collection subject score and ranked subject rating both preserve site scores', () => {
  assert.equal(compactSubject({ id: 1, type: 2, score: 7.4 }).rating.score, 7.4);
  assert.equal(compactSubject({ id: 1, type: 2, rating: { score: 8.1, total: 123, rank: 42 } }).rating.score, 8.1);
  assert.deepEqual(compactSubject({ id: 1, rating: { score: 8.1, total: 123, rank: 42 } }).rating,
    { score: 8.1, total: 123, rank: 42 });
});

test('compaction keeps public title, tags and cover without collection comments', () => {
  const result = compactSubject({ id: 5, type: 2, nameCn: '标题', tags: [{ name: '科幻' }, '青春'],
    images: { medium: 'https://lain.bgm.tv/cover.jpg' }, comment: 'not metadata' });
  assert.equal(result.name_cn, '标题');
  assert.deepEqual(result.tags, ['科幻', '青春']);
  assert.equal(result.images.common, 'https://lain.bgm.tv/cover.jpg');
  assert.ok(!('comment' in result));
});
