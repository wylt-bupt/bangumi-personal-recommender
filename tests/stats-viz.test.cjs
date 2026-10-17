const { test } = require('node:test');
const assert = require('node:assert/strict');
const Viz = require('../src/stats-viz.cjs');
test('year columns descend left to right and fill gaps without inventing counts', () => {
  assert.deepEqual(Viz.yearSeries([{year:2026,count:2},{year:2024,count:7},{year:'未知',count:10}]), [{year:2026,count:2},{year:2025,count:0},{year:2024,count:7}]);
  assert.deepEqual(Viz.yearSeries([]), []);
});
test('count axes start at zero, have integer ticks and cover every value', () => {
  for(const value of [0,1,2,7,9,41,117,1000]) {
    const axis=Viz.axis(value);
    assert.equal(axis.ticks[0],0);assert.ok(axis.max>=value);
    assert.ok(axis.ticks.every(Number.isInteger));
    assert.equal(axis.ticks.at(-1),axis.max);
  }
});
test('tag threshold is strictly over ten, and frequency sorting is stable', () => {
  assert.deepEqual(Viz.featuredTags([{name:'十',count:10},{name:'十一',count:11},{name:'最多',count:548},{name:'少',count:1}]).map(row=>row.name),['最多','十一']);
});
test('calendar-like tags are excluded without removing thematic season words', () => {
  const names=['2026','2026年','2026年7月','2026-07','2025夏番','7月番','2020s','夏天','青春'];
  assert.deepEqual(Viz.featuredTags(names.map(name=>({name,count:20}))).map(row=>row.name),['青春','夏天']);
});
