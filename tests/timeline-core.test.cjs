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
test('backup validates account and merges without trusting coverage or cursors', () => {
  const state = C.freshState('wylt'); state.events = [event(1)];
  const backup = { format: 'bangumi-personal-timeline', schema: 1, user: 'wylt', events: [event(1), event(2)], streams: { progress: { complete: true, page: 9999 } } };
  const restored = C.importBackup(JSON.stringify(backup), 'wylt', state);
  assert.equal(restored.events.length, 2); assert.equal(restored.streams.progress.complete, false);
  assert.throws(() => C.importBackup(JSON.stringify({ ...backup, user: 'other' }), 'wylt', state));
  assert.throws(() => C.importBackup(JSON.stringify({ ...backup, events: [{ ...event(3), time: 0 }] }), 'wylt', state));
});
