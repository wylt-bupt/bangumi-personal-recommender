const { test } = require('node:test');
const assert = require('node:assert/strict');
const Eligibility = require('../src/candidate-eligibility.cjs');

const TOM_JERRY = { id: 25961, type: 2, name: 'トムとジェリー', name_cn: '猫和老鼠（1965年电视版）', tags: ['童年', '欧美', '搞笑', '美国', '原创'] };
const GUNDAM_0080 = { id: 14909, type: 2, name: '機動戦士ガンダム0080 ポケットの中の戦争', name_cn: '机动战士高达0080 口袋里的战争', tags: ['高达', 'ova', 'sunrise', '战争'] };
const WITCH_MERCURY = { id: 917262, type: 2, name: '機動戦士ガンダム 水星の魔女', name_cn: '机动战士高达 水星的魔女', tags: ['高达', '原创', 'sunrise'] };
const GINTAMA_RETRY = { id: 123456, type: 2, name: '銀魂 プリゴラ14', name_cn: '银魂精选集 第二回', tags: ['银魂', '精选集', '银他妈'] };
const GINTAMA_MARKED = { id: 78910, type: 2, name: '銀魂 -吉原大炎上-', name_cn: '新剧场版 银魂 -吉原大炎上-', tags: ['银魂', '巨坑'] };
const KUKI = { id: 81, type: 2, name: '十二国記', name_cn: '十二国记', tags: ['十二国记', '小野不由美', '奇幻', '中国风', '2002', 'tv'] };
const HIBIKE_LAST = { id: 5123, type: 2, name: 'お屋根の上のヴァイオリン', name_cn: '吹响吧！上低音号 后篇', tags: ['京都アニメーション', '校园'] };
const HIBIKE_MAIN = { id: 5124, type: 2, name: 'お屋根の上のヴァイオリン2', name_cn: '吹响吧！上低音号', tags: ['京阿尼', '音乐'] };

test('non-Japanese origin is rejected on built-in country markers', () => {
  assert.equal(Eligibility.isJapaneseOrigin(TOM_JERRY), false);
  assert.equal(Eligibility.isJapaneseOrigin({ tags: [{ name: '国产' }, '动画'] }), false);
  assert.equal(Eligibility.isJapaneseOrigin({ tags: ['韩国', 'netflix'] }), false);
  assert.equal(Eligibility.isJapaneseOrigin({ tags: ['非日本动画', '合集'] }), false);
});

test('Chinese-styling, Japanese co-adaptation and unmarked tags stay included', () => {
  assert.equal(Eligibility.isJapaneseOrigin(KUKI), true);
  assert.equal(Eligibility.isJapaneseOrigin({ tags: ['日本改编中国作品', '奇幻'] }), true);
  assert.equal(Eligibility.isJapaneseOrigin({ tags: ['日本', '动画电影'] }), true);
  assert.equal(Eligibility.isJapaneseOrigin({ tags: ['科幻', '原创', 'sunrise'] }), true);
});

test('embedded franchise tag groups across release titles', () => {
  assert.equal(Eligibility.franchiseKey(GUNDAM_0080), Eligibility.franchiseKey(WITCH_MERCURY));
  assert.equal(Eligibility.franchiseKey(GINTAMA_RETRY), Eligibility.franchiseKey(GINTAMA_MARKED));
  assert.notEqual(Eligibility.franchiseKey(GUNDAM_0080), Eligibility.franchiseKey(KUKI));
});

test('suffix stripping maps late episodes to the base title', () => {
  assert.equal(Eligibility.franchiseKey(HIBIKE_LAST), Eligibility.franchiseKey(HIBIKE_MAIN));
  assert.equal(Eligibility.franchiseKey({ name_cn: '日常 第二季', tags: ['日常'] }), 'title:日常');
});

test('content descriptors never become franchise keys', () => {
  const key = Eligibility.franchiseKey({ name_cn: '百合花园 第二季', tags: ['百合', '校园'] });
  assert.match(key, /^title:/);
});

test('marked franchises only consider animation rows across all statuses', () => {
  const marked = Eligibility.markedFranchiseKeys([
    { subject_id: 917262, type: 1, rate: 8, subject: WITCH_MERCURY }, // type from subject decides
    { subject_id: 78910, rate: 0, subject: GINTAMA_MARKED },          // unrated placeholder still marks
    { subject_id: 600, type: 3, subject: { type: 3, name_cn: '银河英雄传说 原著', tags: ['银河英雄传说', '小说'] } },
  ]);
  assert.ok(marked.has(Eligibility.franchiseKey(WITCH_MERCURY)));
  assert.ok(marked.has(Eligibility.franchiseKey(GINTAMA_MARKED)));
  assert.ok(!marked.has(Eligibility.franchiseKey({ name_cn: '银河英雄传说 原著', tags: ['银河英雄传说', '小说'] })));
});

test('excludeReason reports origin and watchedFranchise, null keeps candidate', () => {
  const marked = Eligibility.markedFranchiseKeys([{ subject_id: 78910, subject: GINTAMA_MARKED }]);
  assert.equal(Eligibility.excludeReason(TOM_JERRY, marked), 'origin');
  assert.equal(Eligibility.excludeReason(GINTAMA_RETRY, marked), 'watchedFranchise');
  assert.equal(Eligibility.excludeReason(GUNDAM_0080, marked), null);
  assert.equal(Eligibility.excludeReason(KUKI, marked), null);
});
