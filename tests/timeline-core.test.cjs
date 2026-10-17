const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/timeline-core.cjs');
const now = Date.parse('2026-09-05T12:00:00+08:00');
const event = (id, time = now, type = 'progress') => ({ id: String(id), time, type, source: 'web', subjects: ['1'], text: '看过 ep.1' });
test('Bangumi timestamps use Beijing time including day/hour boundaries', () => {
  assert.equal(C.parseTime('2026-9-5 00:49'), Date.parse('2026-09-04T16:49:00Z'));
  assert.equal(C.dayKey(C.parseTime('2026-9-5 00:49')), '2026-09-05');
  assert.ok(Number.isNaN(C.parseTime('2026-2-30 12:00')));
  assert.ok(Number.isNaN(C.parseTime('2026-9-5 25:00')));
  assert.ok(Number.isNaN(C.parseTime('10分钟前')));
});
test('overlapping pages deduplicate by timeline id, not episode or minute', () => {
  const merged = C.mergeEvents([event(1), event(2)], [event(2), event(3)]);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map(e => e.id), ['3', '2', '1']);
});

test('completed streams expose one shared idle deadline and retries take precedence', () => {
  const now = Date.now();
  const state = C.freshState('wylt');
  assert.equal(C.nextSyncAt(state, now), 0);
  for (const stream of Object.values(state.streams)) {
    stream.complete = true;
    stream.headAt = now;
  }
  assert.equal(C.nextSyncAt(state, now), now + C.REFRESH_INTERVAL);
  state.streams.progress.headAt = now - C.REFRESH_INTERVAL;
  assert.equal(C.nextSyncAt(state, now), now);
  state.retryAt = now + 123456;
  assert.equal(C.nextSyncAt(state, now), state.retryAt);
});
test('only watched episodes count, not collections or other timeline actions', () => {
  const state = C.freshState('wylt');
  state.events = [
    { ...event(1), subjects: ['1', '2'] },
    { ...event(2, now, 'subject'), text: '将作品标记为看过' },
    { ...event(3), text: '读过 ep.2' },
    { ...event(4), text: '更新了进度' },
    { ...event(5), text: '看过 sp.1' }
  ];
  const stats = C.aggregate(state, now);
  assert.equal(stats.total, 2);
  assert.equal(stats.hourly[12], 2);
  assert.equal(stats.weekly[5], 2);
  assert.equal(stats.platform[0].name, '网页端');
});
test('batch progress counts newly watched episodes without a one-event minimum', () => {
  const state = C.freshState('wylt');
  const yesterday = now - C.DAY;
  state.events = [
    { ...event(1, yesterday), text: '完成了 风が強く吹いている 4 of 23 话' },
    { ...event(2, yesterday + 1000), text: '看过 ep.5' },
    { ...event(3, now), text: '完成了 风が強く吹いている 9 of 23 话' },
    { ...event(4, now + 1000), text: '完成了 风が強く吹いている 9 of 23 话' },
    { ...event(5, now + 2000), text: '完成了 风が強く吹いている 8 of 23 话' }
  ];
  const stats = C.aggregate(state, now + 3000);
  assert.equal(stats.days.find(day => day.key === C.dayKey(yesterday)).count, 5);
  assert.equal(stats.days.find(day => day.key === C.dayKey(now)).count, 4);
  assert.equal(stats.total, 9);
});
test('incomplete stream cannot mark unknown dates as zero activity', () => {
  const state = C.freshState('wylt');
  assert.deepEqual(C.SYNC_TYPES, ['progress']);
  let data = C.aggregate(state, now);
  assert.equal(data.days.filter(d => d.known).length, 0);
  state.streams.progress.oldest = C.parseTime('2026-9-3 21:00');
  data = C.aggregate(state, now);
  assert.deepEqual(data.days.filter(d => d.known).map(d => d.key), ['2026-09-04', '2026-09-05']);
  state.streams.progress.complete = true;
  data = C.aggregate(state, now);
  assert.equal(data.days.filter(d => d.known).length, 365);
  assert.equal(data.days[0].key, '2025-09-06');
  state.streams.subject = { complete: false, headAt: 0 };
  assert.equal(C.aggregate(state, now).complete, true);
  assert.equal(C.nextSyncAt(state, now), 0);
});
test('rolling year excludes old records and groups small platforms', () => {
  const state = C.freshState('wylt');
  state.events = [event(1, now - C.DAY * 366), ...Array.from({ length: 7 }, (_, i) => ({ ...event(i + 2), source: `app${i}` }))];
  const data = C.aggregate(state, now);
  assert.equal(data.total, 7); assert.equal(data.platform.length, 5);
  assert.equal(data.platform.at(-1).name, '其他'); assert.equal(data.platform.at(-1).count, 3);
});
test('30-day average uses yesterday through 30 days ago, including inactive days', () => {
  const state = C.freshState('wylt');
  state.streams.progress.complete = true;
  const watched = (id, daysAgo, count) => ({ ...event(id, C.dayStart(now) - daysAgo * C.DAY), subjects: [String(id)], text: `完成了 动画 ${count} of 100 话` });
  state.events = [watched(1, 0, 99), watched(2, 1, 6), watched(3, 30, 9), watched(4, 31, 60)];
  assert.equal(C.aggregate(state, now).average30, 0.5);
  assert.equal(C.aggregate(state, C.dayStart(now)).average30, 0.5);
  state.events = [];
  assert.equal(C.aggregate(state, now).average30, 0);
});
test('30-day average waits for full date coverage instead of treating unknown days as zero', () => {
  const state = C.freshState('wylt');
  state.streams.progress.oldest = C.dayStart(now) - 30 * C.DAY;
  assert.equal(C.aggregate(state, now).average30, null);
  state.streams.progress.oldest -= C.DAY;
  assert.equal(C.aggregate(state, now).average30, 0);
});
test('backup validates account and merges without trusting coverage or cursors', () => {
  const state = C.freshState('wylt'); state.events = [event(1)];
  const backup = { format: 'bangumi-personal-timeline', schema: 1, user: 'wylt', events: [event(1), event(2)], streams: { progress: { complete: true, page: 9999 } } };
  const restored = C.importBackup(JSON.stringify(backup), 'wylt', state);
  assert.equal(restored.events.length, 2); assert.equal(restored.streams.progress.complete, false);
  assert.throws(() => C.importBackup(JSON.stringify({ ...backup, user: 'other' }), 'wylt', state));
  assert.throws(() => C.importBackup(JSON.stringify({ ...backup, events: [{ ...event(3), time: 0 }] }), 'wylt', state));
});
test('daily series mirrors the heatmap window for a year and stretches back for all', () => {
  const state = C.freshState('wylt');
  state.events = [event(1, now - C.DAY * 366), event(2, now - C.DAY * 400), event(3, now - C.DAY * 2)];
  const year = C.dailySeries(state, now);
  assert.equal(year.days.length, 365);
  assert.equal(year.days[0].key, '2025-09-06');
  assert.equal(year.days.at(-1).key, '2026-09-05');
  assert.equal(year.days.find(d => d.key === '2026-09-03').count, 1);
  assert.equal(year.total, 1);
  const all = C.dailySeries(state, now, 'all');
  assert.equal(all.days.length, 401);
  assert.equal(all.days[0].key, '2025-08-01');
  assert.equal(all.days.find(d => d.key === '2025-08-01').count, 1);
  assert.equal(all.days.find(d => d.key === '2025-08-02').count, 0);
  assert.equal(all.total, 3);
  assert.equal(all.oldestTime, now - C.DAY * 400);
  const empty = C.dailySeries(C.freshState('wylt'), now, 'all');
  assert.equal(empty.days.length, 0, 'no progress records means nothing to plot');
  assert.equal(empty.total, 0);
  assert.equal(empty.oldestTime, null);
});
test('daily series carries a trailing mean that survives window slicing', () => {
  const state = C.freshState('wylt');
  // 一年窗口外还有两条记录：窗口内的均线必须已经“预热”，不是从首日重新起算。
  state.events = [event(1, now - C.DAY * 366), event(2, now - C.DAY * 400), event(3, now - C.DAY * 2)];
  const year = C.dailySeries(state, now);
  assert.equal(year.days.length, 365);
  assert.equal(year.total, 1);
  const active = year.days.find(day => day.key === '2026-09-03');
  assert.equal(active.count, 1);
  assert.ok(Math.abs(active.mean - 1 / 7) < 1e-9, 'mean spreads a single episode over the full window');
  assert.ok(year.days.every(day => day.mean <= Math.max(1, ...year.days.map(d => d.count))), 'mean never exceeds the peak');
  const all = C.dailySeries(state, now, 'all');
  const firstAll = all.days[0];
  assert.equal(firstAll.count, 1);
  assert.ok(Math.abs(firstAll.mean - 1) < 1e-9, 'the oldest day averages only itself');
  // 均线与逐日值一一对应，长度必须一致，否则连线会错位。
  assert.equal(all.days.filter(day => typeof day.mean === 'number').length, all.days.length);
});
test('rolling mean uses the full window and never exceeds it', () => {
  assert.deepEqual(C.rollingMean([1, 2, 3]), [1, 1.5, 2]);
  // 窗口未满时按已有天数取平均（首日就是它自己），不会把未来补齐成 0。
  assert.deepEqual(C.rollingMean([6, 0, 0, 0, 0, 0, 0], 7), [6, 3, 2, 1.5, 1.2, 1, 6 / 7]);
  assert.deepEqual(C.rollingMean([0, 0, 0, 0, 0, 0, 0, 7], 7)[7], 1, 'the eighth day drops the first slot');
  assert.deepEqual(C.rollingMean([], 7), []);
});
test('count axis keeps integer ticks, a zero floor and headroom above the peak', () => {
  const flat = C.countAxis([0, 0, 0]);
  assert.equal(flat.lo, 0);
  assert.ok(flat.hi >= 1, 'an all-zero series still needs a non-degenerate axis');
  assert.ok(flat.ticks.every(Number.isInteger));
  const spiky = C.countAxis([1, 1, 2, 1, 24, 1, 3]);
  assert.equal(spiky.lo, 0);
  assert.ok(spiky.hi >= 24, `the peak must fit inside the axis, got ${spiky.hi}`);
  assert.ok(spiky.ticks.every(Number.isInteger), 'episode ticks stay whole numbers');
  assert.ok(spiky.position(0) === 0 && Math.abs(spiky.position(spiky.hi) - 1) < 1e-9);
  // 对数刻度的意义：1 集不再只占最高日的 1/24，而是明显抬起。
  assert.ok(spiky.position(1) > 1 / 24, `one episode should be clearly visible, got ${spiky.position(1)}`);
  let previous = -1;
  for (const tick of spiky.ticks) { assert.ok(tick > previous, 'ticks ascend'); previous = tick; }
});
test('deep backfill keeps sync due until the stream reaches the oldest record', () => {
  const state = C.freshState('wylt');
  state.streams.progress.complete = true;
  state.streams.progress.headAt = now - C.REFRESH_INTERVAL;
  assert.equal(C.nextSyncAt(state, now), now);
  state.deep = true;
  assert.equal(C.nextSyncAt(state, now), 0);
  state.streams.progress.deep = true;
  assert.equal(C.nextSyncAt(state, now), now);
  assert.equal(C.nextSyncAt(state, now + C.REFRESH_INTERVAL), now);
  assert.equal(C.freshState('wylt').deep, false);
  assert.equal(C.freshState('wylt').streams.progress.deep, false);
});
