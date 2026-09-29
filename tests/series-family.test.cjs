const { test } = require('node:test');
const assert = require('node:assert/strict');
const { seriesFamilyKey } = require('../src/series-family.cjs');

test('series grouping preserves title normalization and sequel suffixes', () => {
  assert.equal(seriesFamilyKey({ name_cn: ' 示例 Season ２ ' }), 'title:示例');
  assert.equal(seriesFamilyKey({ name: '示例第二季' }), 'title:示例');
  assert.equal(seriesFamilyKey({ nameCn: '示例 续篇' }), 'title:示例');
  assert.equal(seriesFamilyKey({ name: '學園・島' }), 'title:学園岛');
});

test('embedded franchise tags group series but generic and content tags do not', () => {
  assert.equal(seriesFamilyKey({ name_cn: '银河英雄传说 外传', tags: [{ name: '银河英雄传说' }, '科幻'] }), 'tag:银河英雄传说');
  assert.equal(seriesFamilyKey({ name: '日本动画校园 第二季', tags: ['日本', '动画', '校园'] }), 'title:日本动画校园');
});

test('series grouping handles missing names without imposing recommendation eligibility', () => {
  assert.equal(seriesFamilyKey({ subject_id: 42 }), 'title:42');
  assert.equal(seriesFamilyKey({}), 'title:0');
  assert.equal(seriesFamilyKey({ id: 1, name: 'Film', type: 2, eps: 1 }), 'title:film');
});
