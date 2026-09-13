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
  state.streams.subject.headAt = now - C.REFRESH_INTERVAL;
  assert.equal(C.nextSyncAt(state, now), now);
  state.retryAt = now + 123456;
  assert.equal(C.nextSyncAt(state, now), state.retryAt);
});
test('one activity is one count even when multiple subjects are grouped', () => {
  const state = C.freshState('wylt');
  state.events = [{ ...event(1), subjects: ['1', '2'] }, event(2, now, 'subject')];
  const stats = C.aggregate(state, now);
  assert.equal(stats.total, 2);
  assert.equal(stats.hourly[12], 2);
  assert.equal(stats.weekly[5], 2);
  assert.equal(stats.platform[0].name, '网页端');
});
test('incomplete stream cannot mark unknown dates as zero activity', () => {
  const state = C.freshState('wylt');
  state.streams.subject.complete = true;
  let data = C.aggregate(state, now);
  assert.equal(data.days.filter(d => d.known).length, 0);
  state.streams.progress.oldest = C.parseTime('2026-9-3 21:00');
  data = C.aggregate(state, now);
  assert.deepEqual(data.days.filter(d => d.known).map(d => d.key), ['2026-09-04', '2026-09-05']);
  state.streams.progress.complete = true;
  data = C.aggregate(state, now);
  assert.equal(data.days.filter(d => d.known).length, 365);
  assert.equal(data.days[0].key, '2025-09-06');
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
