const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/recommender-core.cjs');

const subject = (id, overrides = {}) => ({
  id,
  name: `作品${id}`,
  name_cn: `条目${id}`,
  platform: 'TV',
  images: { common: `https://lain.bgm.tv/pic/cover/c/${id}.jpg` },
  rating: { score: 8, total: 2000 },
  tags: [{ name: '原创', count: 100 }],
  ...overrides,
});

test('tag database averages my 10-point ratings across the works a tag appears on', () => {
  const rows = [
    { id: 1, rate: 8, tags: ['日常', '治愈'] },
    { id: 2, rate: 6, tags: ['日常'] },
    { id: 3, rate: 10, tags: ['治愈', '原创'] },
    { id: 4, rate: 0, tags: ['未评分不计入'] },
  ];
  const db = Core.buildTagDb(rows.map(row => ({ ...row, subject: { tags: row.tags.map(name => ({ name })) } })));
  assert.equal(db.get('日常'), 7, 'mean of 8 and 6');
  assert.equal(db.get('治愈'), 9, 'mean of 8 and 10');
  assert.equal(db.get('原创'), 10);
  assert.ok(!db.has('未评分不计入'));
  // 采集层裁剪后的形状：标签是行内 subject.tags 的纯字符串数组。
  const trimmed = Core.buildTagDb([
    { id: 5, rate: 7, subject: { id: 5, tags: ['日常', '科幻'] } },
  ]);
  assert.equal(trimmed.get('日常'), 7);
  assert.equal(trimmed.get('科幻'), 7);
});

test('a candidate borrows its tags\u2019 mean score divided by two, on a 1-5 scale', () => {
  const db = Core.buildTagDb([
    { rate: 8, subject: { tags: [{ name: '日常' }] } },
    { rate: 6, subject: { tags: [{ name: '日常' }] } },
  ]);
  // 日常 = 7（10 分制）→ 折算 3.5（5 分制）
  assert.equal(Core.tagScore([{ name: '日常' }], db), 3.5);
  assert.equal(Core.tagScore([{ name: '日常' }, { name: '未知标签' }], db), 3.5, 'unknown tags are ignored, not counted as neutral');
  assert.equal(Core.tagScore([{ name: '未知标签' }], db), null, 'no known tags means no tag score');
  assert.equal(Core.tagScore([], db), null);
});

test('final score weights site 1 : tag 7, kept to two decimals', () => {
  const db = Core.buildTagDb([{ rate: 9, subject: { tags: [{ name: '科幻' }] } }]);
  const rows = [subject(10, { rating: { score: 7.6, total: 1000 }, tags: [{ name: '科幻' }] })];
  const scored = Core.scoreCandidates(rows, db, new Set());
  assert.equal(scored[0].site, 3.8);
  assert.equal(scored[0].tag, 4.5);
  assert.equal(scored[0].final, 4.41, 'exploration factor: (3.8×1 + 4.5×7) / 8');
  // 只用全站分：没有已知标签时没有可混合的第二项。
  const tagless = Core.scoreCandidates([subject(11, { tags: [{ name: '完全未知' }] })], db, new Set());
  assert.equal(tagless[0].tag, null);
  assert.equal(tagless[0].final, 4);
});

test('candidates with heavily-tagged region labels are excluded', () => {
  const rows = [
    subject(21, { tags: [{ name: '国产', count: 11 }] }),  // 超过 10 人 → 排除
    subject(22, { tags: [{ name: '中国', count: 30 }] }),  // 排除
    subject(23, { tags: [{ name: '欧美', count: 12 }] }),  // 排除
    subject(24, { tags: [{ name: '国产', count: 10 }] }),  // 恰好 10 人 → 保留
    subject(25, { tags: [{ name: '美国', count: 99 }] }),  // 不在排除名单 → 保留
    subject(26, { tags: ['国产'] }),                       // 无人数（字符串形状）→ 无法判定，保留
  ];
  const scored = Core.scoreCandidates(rows, new Map(), new Set());
  assert.deepEqual(scored.map(row => row.id), [24, 25, 26]);
  assert.deepEqual([...Core.REGION_EXCLUSION_TAGS], ['国产', '中国', '欧美']);
  assert.equal(Core.REGION_EXCLUSION_COUNT, 10);
});

test('candidates exclude my rated works, thin ratings and OVA releases; collected-but-unrated stays', () => {
  const ratedIds = new Set([1, 2]);
  const rows = [
    subject(1),                                   // 我打过分 → 排除
    subject(2, { rating: { score: 9, total: 800 } }), // 我打过分 → 排除
    subject(3, { rating: { score: 9, total: 499 } }), // 评分人数不足 → 排除
    subject(4, { platform: 'OVA' }),              // OVA → 排除
    subject(5, { platform: '剧场版' }),           // 剧场版不受 OVA 规则影响
    subject(6),                                   // 未收藏未评分，正常参与
    subject(7, { rating: { score: 7, total: 500 } }), // 门槛恰好 500 → 参与
  ];
  const scored = Core.scoreCandidates(rows, new Map(), ratedIds);
  assert.deepEqual(scored.map(row => row.id), [5, 6, 7], 'sorted by final score, ties by rating count then id');
});

test('collection rows with a rating but no collection entry still count as excluded only by id', () => {
  const rows = [subject(9), subject(10)];
  const scored = Core.scoreCandidates(rows, new Map(), new Set([9]));
  assert.deepEqual(scored.map(row => row.id), [10]);
});

test('selectTop walks the ranked list and drops candidates remade from works I rated', async () => {
  const scored = [subject(101), subject(102), subject(103), subject(104)].map(row => ({ ...row, final: 4 }));
  const ratedIds = new Set([55]);
  const relations = {
    101: [{ id: 55, relation: '不同演绎' }],   // 我评过 55 → 排除
    102: [{ id: 55, relation: '相同演绎' }, { id: 56, relation: '不同演绎' }], // 56 我没评过 → 保留
    103: [{ id: 57, relation: '续集' }],
    104: [],
  };
  const { selected, excluded } = await Core.selectTop(scored, 30, ratedIds, async id => relations[id] || []);
  assert.deepEqual(selected.map(row => row.id), [102, 103, 104]);
  assert.deepEqual(excluded, [101]);
});

test('selectTop stops once the limit is reached and tolerates a shorter pool', async () => {
  const scored = Array.from({ length: 40 }, (_, index) => ({ ...subject(200 + index), final: 5 - index / 100 }));
  const calls = [];
  const { selected } = await Core.selectTop(scored, 30, new Set(), async id => { calls.push(id); return []; });
  assert.equal(selected.length, 30);
  assert.equal(calls.length, 30, 'the walk stops at the limit instead of scanning the whole pool');
  const short = await Core.selectTop(scored.slice(0, 3), 30, new Set(), async () => []);
  assert.equal(short.selected.length, 3, 'a thin pool still yields what it has');
});
