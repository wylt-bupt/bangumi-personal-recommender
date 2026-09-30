const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/calendar-core.cjs');
const week = () => Array.from({ length: 7 }, (_, n) => ({ weekday: { id: n + 1 }, items: [] }));
test('calendar intersection retains all five states and never matches by title', () => {
  const data = week(); data[0].items = Array.from({ length: 6 }, (_, n) => ({ id: n + 1, name_cn: '同名作品' }));
  const collection = C.normalizeCollections(Array.from({ length: 5 }, (_, n) => ({ subject_id: n + 1, type: n + 1, rate: 9, comment: 'do not retain' })));
  assert.deepEqual(collection[0], { id: 1, type: 1 });
  assert.deepEqual(C.intersect(C.normalizeCalendar(data), collection)[0].items.map(x => x.type), [1, 2, 3, 4, 5]);
  assert.deepEqual(C.intersect(C.normalizeCalendar(data), collection, true)[0].items.map(x => x.id), [3]);
});
test('calendar has Chinese fallbacks, deduplicated IDs and safe HTTPS images', () => {
  const data = week(); data[0].items = [{ id: 1, name: 'Original', name_cn: '', images: { common: 'http://lain.bgm.tv/pic/cover/c/a.jpg' } }, { id: 1, name: 'Duplicate' }, { id: 2, name_cn: '<script>not markup</script>', images: { common: 'https://evil.test/a.jpg' } }];
  const day = C.normalizeCalendar(data)[0];
  assert.equal(day.items.length, 2); assert.equal(day.items[0].title, 'Original'); assert.equal(day.items[0].image, 'https://lain.bgm.tv/pic/cover/c/a.jpg'); assert.equal(day.items[1].image, '');
  assert.equal(C.imageURL('javascript:alert(1)'), ''); assert.equal(C.imageURL('https://user:password@lain.bgm.tv/a.jpg'), '');
  assert.deepEqual(C.normalizeCalendar(C.normalizeCalendar(data)), C.normalizeCalendar(data));
});
test('invalid or partial data cannot become a successful empty calendar', () => {
  assert.throws(() => C.normalizeCalendar(week().slice(1)), /完整/);
  const data = week(); data[0].weekday.id = 2; assert.throws(() => C.normalizeCalendar(data), /无效/);
  assert.throws(() => C.normalizeCollections([{ id: 1, type: 6 }]), /无效/);
});
test('public pagination reads the last page and accepts a genuinely empty collection', async () => {
  const offsets = [];
  const rows = await C.collectPublic(async offset => { offsets.push(offset); return { total: 3, offset, data: (offset === 0 ? [1, 2] : [3]).map(id => ({ subject_id: id, type: 3 })) }; });
  assert.deepEqual(offsets, [0, 2]); assert.equal(rows.length, 3);
  assert.deepEqual(await C.collectPublic(async offset => ({ total: 0, offset, data: [] })), []);
});
test('public pagination rejects truncation, repeats and concurrent collection changes', async () => {
  await assert.rejects(C.collectPublic(async offset => ({ total: 2, offset, data: offset === 0 ? [{ subject_id: 1, type: 1 }] : [] })), /不完整/);
  await assert.rejects(C.collectPublic(async offset => ({ total: 2, offset, data: [{ subject_id: 1, type: 1 }] })), /重复/);
  await assert.rejects(C.collectPublic(async offset => ({ total: offset ? 3 : 2, offset, data: [{ subject_id: offset + 1, type: 1 }] })), /变化/);
});
test('dates cross month/year boundaries in the browser local timezone', () => {
  const dates = C.weekDates(new Date(2026, 11, 31, 23, 59));
  assert.equal(dates[0].date, '2026-12-30'); assert.equal(dates[1].date, '2026-12-31'); assert.equal(dates[2].date, '2027-01-01');
  assert.equal(dates[0].relative, '昨天'); assert.equal(dates[1].weekday, 4); assert.equal(dates[1].relative, '今天'); assert.equal(dates[2].relative, '明天');
});
test('release is independent and paste-friendly output is identical', () => {
  const fs = require('node:fs'), path = require('node:path');
  const pkg = require('../package.json');
  const script = fs.readFileSync(path.join(__dirname, '../dist/bangumi-personal-calendar.user.js'), 'utf8');
  assert.ok(script.includes(`// @version      ${pkg.calendarVersion}`));
  assert.equal(script, fs.readFileSync(path.join(__dirname, '../dist/bangumi-personal-calendar.bgm.txt'), 'utf8'));
  assert.ok(!script.includes('BangumiTimelineCore')); assert.ok(!script.includes('BangumiRecommendationFeed'));
});
