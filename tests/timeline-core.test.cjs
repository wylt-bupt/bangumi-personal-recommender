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
  assert.ok(flat.hi >= 5, `an empty series still needs one labelled tick, got ${flat.hi}`);
  assert.deepEqual(flat.ticks, [5], 'the lowest labelled tick is 5 episodes');
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
  assert.equal(spiky.ticks[0], 5, `no tick below 5 episodes: ${spiky.ticks.join(', ')}`);
  assert.equal(spiky.ticks.at(-1), spiky.hi, 'the top tick always marks the axis ceiling');
});
test('count axis anchors the compression on the lowest labelled tick', () => {
  // 真实账号的一年分布：365 天里 86 天 0 集、162 天 1-5 集、最多的一天 63 集。
  const counts = [];
  for (let i = 0; i < 86; i++) counts.push(0);
  for (let i = 0; i < 78; i++) counts.push(i % 2 ? 1 : 2);
  for (let i = 0; i < 84; i++) counts.push(3 + (i % 3));
  for (let i = 0; i < 45; i++) counts.push(6 + (i % 4));
  for (let i = 0; i < 58; i++) counts.push(10 + (i % 10));
  for (let i = 0; i < 10; i++) counts.push(20 + i);
  counts.push(63);
  const axis = C.countAxis(counts);
  // 最低刻度线（5 集）固定落在 22% 高度，压缩力度不再随分位数漂移。
  assert.ok(Math.abs(axis.position(5) - 0.22) < 0.02, `five episodes define the first gridline at 22%, got ${axis.position(5).toFixed(3)}`);
  // 1 集只占一条薄边：上一版把 1 集抬到 26%，面积跟数量完全脱节。
  assert.ok(axis.position(1) < 0.1, `a single-episode day must stay a sliver, got ${axis.position(1).toFixed(3)}`);
  assert.ok(axis.position(1) > 1 / 63, `a single-episode day must still be visible, got ${axis.position(1).toFixed(3)}`);
  assert.ok(axis.position(3) < axis.position(5) && axis.position(5) < axis.position(10) && axis.position(10) < axis.position(63));
  // 高峰仍然顶天，尾部靠对数压住，但压缩比 1.0.19 的 c≈0.2 轻得多。
  assert.ok(axis.position(63) > 0.85, `the peak should still reach the top, got ${axis.position(63).toFixed(3)}`);
  assert.ok(axis.constant > 3, `the compression must be gentler than the old constant of 3, got ${axis.constant.toFixed(3)}`);
  // 刻度从 5 起算：0 只作基线，不再标数字。
  assert.deepEqual(axis.ticks, [5, 10, 20, 50, 80], 'ticks are whole episodes starting at 5');
});
test('bucket series folds consecutive days and keeps the ragged tail', () => {
  const days = Array.from({ length: 10 }, (_, index) => ({
    key: `2026-05-${String(index + 1).padStart(2, '0')}`,
    time: index * C.DAY,
    count: index,
    mean: index * 2,
  }));
  const weekly = C.bucketSeries(days, 7);
  assert.equal(weekly.length, 2, 'ten days fold into one full week plus a tail');
  assert.equal(weekly[0].days, 7);
  assert.equal(weekly[0].count, 21, 'the bar carries the sum of the block');
  assert.equal(weekly[0].mean, 6, 'the line carries the average of the block');
  assert.equal(weekly[0].key, '2026-05-01');
  assert.equal(weekly[0].endKey, '2026-05-07');
  assert.equal(weekly[1].days, 3, 'the tail keeps its real length');
  assert.equal(weekly[1].count, 24);
  assert.deepEqual(C.bucketSeries(days, 1)[3], { key: '2026-05-04', endKey: '2026-05-04', days: 1, count: 3, mean: 6 });
  assert.deepEqual(C.bucketSeries([], 7), []);
});
test('calendar buckets align weeks to Monday and months to the calendar, marking partial edges', () => {
  // 2026-06-01 是周一：两周的完整窗口恰好切成两个 7 天桶。
  const june = Array.from({ length: 14 }, (_, index) => ({
    key: `2026-06-${String(index + 1).padStart(2, '0')}`,
    count: index + 1,
  }));
  const weeks = C.calendarBuckets(june, 'week');
  assert.equal(weeks.length, 2, 'two calendar weeks');
  assert.equal(weeks[0].key, '2026-06-01', 'the week starts on Monday');
  assert.equal(weeks[0].endKey, '2026-06-07');
  assert.equal(weeks[0].days, 7);
  assert.equal(weeks[0].count, 28, 'totals are conserved');
  assert.equal(weeks[1].count, 77);
  assert.ok(weeks.every(bucket => !bucket.partial), 'full weeks are complete');
  // 窗口从周六开始：首桶只剩周六周日，必须标记 partial。
  const weekend = june.slice(5);
  const edge = C.calendarBuckets(weekend, 'week');
  assert.equal(edge[0].key, '2026-06-01', 'a Saturday still folds into its Monday week');
  assert.equal(edge[0].days, 2);
  assert.equal(edge[0].partial, true, 'the ragged leading week is partial');
  assert.equal(edge[1].partial, false);
  // 跨月的自然周：6/29 周一起，桶整体属于那一周。
  const crossMonth = C.calendarBuckets([
    { key: '2026-06-29', count: 1 }, { key: '2026-06-30', count: 2 },
    { key: '2026-07-01', count: 3 }, { key: '2026-07-02', count: 4 },
  ], 'week');
  assert.equal(crossMonth.length, 1);
  assert.equal(crossMonth[0].key, '2026-06-29');
  assert.equal(crossMonth[0].count, 10);
  // 自然月按 key 前七位聚合，边界月按真实天数判 partial。
  const months = C.calendarBuckets([
    { key: '2026-01-30', count: 5 }, { key: '2026-01-31', count: 6 },
    { key: '2026-02-01', count: 7 }, { key: '2026-02-02', count: 8 },
  ], 'month');
  assert.equal(months.length, 2);
  assert.equal(months[0].key, '2026-01');
  assert.equal(months[0].count, 11);
  assert.equal(months[0].partial, true, 'January is missing 29 days');
  assert.equal(months[1].partial, true, 'February is missing 26 days');
  assert.deepEqual(C.calendarBuckets([], 'week'), []);
  assert.deepEqual(C.calendarBuckets(june, 'day'), [], 'unknown modes produce no buckets');
});
test('volume axis keeps lengths proportional and caps only the binge buckets', () => {
  // 真实账号近一年的 53 个周合计：p50=33、峰值 128（3.5 倍偏态）。
  const weekly = [4, 5, 16, 33, 16, 31, 13, 18, 16, 28, 22, 66, 46, 23, 90, 47, 74, 49, 58, 40, 14, 34, 40, 38, 10, 20, 18, 28, 56, 36, 49, 5, 6, 4, 17, 10, 57, 72, 62, 26, 53, 17, 53, 50, 128, 63, 110, 60, 36, 29, 38, 12, 1];
  const axis = C.volumeAxis(weekly);
  assert.equal(axis.hi, 80, 'the axis covers p90, not the 128-episode binge week');
  assert.deepEqual(axis.ticks, [20, 40, 60, 80], 'evenly spaced whole-episode ticks');
  assert.equal(axis.cap, true, 'the peak exceeds the ceiling and gets capped');
  assert.equal(axis.position(0), 0);
  assert.equal(axis.position(128), 1, 'capped buckets land exactly on the ceiling');
  assert.ok(Math.abs(axis.position(33) - 0.4125) < 0.01, `the median week owns about 41% of the plot, got ${axis.position(33).toFixed(3)}`);
  assert.ok(Math.abs(axis.position(66) - 66 / 80) < 1e-9, 'length stays proportional below the cap');
  // 月合计偏态温和（峰值 276、p50 141）：常规档盖住峰值，不封顶。
  const monthly = C.volumeAxis([9, 99, 84, 235, 228, 141, 95, 153, 64, 242, 248, 276, 73]);
  assert.equal(monthly.hi, 300);
  assert.deepEqual(monthly.ticks, [100, 200, 300]);
  assert.equal(monthly.cap, false);
  assert.ok(monthly.position(141) > 0.44 && monthly.position(141) < 0.5, 'the median month fills about half the plot');
  // 小数据与全零：退到最低档，也要有一条刻度线撑着。
  const tiny = C.volumeAxis([1, 2, 1, 3, 2]);
  assert.equal(tiny.cap, false);
  assert.ok(tiny.ticks.at(-1) >= 3 && tiny.ticks.every(Number.isInteger));
  const flat = C.volumeAxis([0, 0, 0]);
  assert.equal(flat.hi, 5);
  assert.deepEqual(flat.ticks, [5]);
  assert.equal(flat.position(0), 0);
});
test('momentum compares the last complete buckets and skips partial edges', () => {
  const bucket = (count, partial) => ({ key: '2026-01-01', endKey: '2026-01-07', days: 7, count, partial: Boolean(partial) });
  // 8 个完整桶：近 4 周均值 10，前 4 周均值 5，动量 +100%。
  const rising = [4, 5, 6, 5, 8, 10, 12, 10].map(count => bucket(count));
  const up = C.momentum(rising, 4);
  assert.equal(up.count, 8);
  assert.equal(up.recent, 10);
  assert.equal(up.previous, 5);
  assert.ok(Math.abs(up.delta - 1) < 1e-9);
  // partial（进行中的当前周）不参与均值。
  const withPartial = [...rising, bucket(999, true)];
  assert.deepEqual(C.momentum(withPartial, 4), up);
  // 完整桶不足 2k：只给水平，不给百分比；不足 k：全空。
  const short = C.momentum(rising.slice(2), 4);
  assert.equal(short.recent, 10);
  assert.equal(short.previous, null);
  assert.equal(short.delta, null);
  assert.equal(C.momentum(rising.slice(0, 3), 4).recent, null);
  // 前段为 0 时百分比没有意义，delta 为 null 但水平仍可读。
  const fromZero = C.momentum([0, 0, 0, 0, 6, 8, 10, 12].map(count => bucket(count)), 4);
  assert.equal(fromZero.recent, 9);
  assert.equal(fromZero.delta, null);
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
