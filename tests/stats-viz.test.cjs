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
test('cloud font size is monotonic in frequency; ties have equal size', () => {
  assert.ok(Viz.fontSize(100,1,100)>Viz.fontSize(25,1,100));
  assert.ok(Viz.fontSize(25,1,100)>Viz.fontSize(1,1,100));
  assert.equal(Viz.fontSize(10,10,10),30);
  assert.ok(Viz.fontSize(548,11,548)/Viz.fontSize(11,11,548)>4);
});
test('score word sizes use score percentiles to create a clear visual hierarchy', () => {
  assert.equal(Viz.scoreFontSize(7,[7]),26);
  const values=[6.72,6.83,6.9,6.94,7.01,7.08,7.16,7.31];
  assert.ok(Viz.scoreFontSize(7.31,values)>Viz.scoreFontSize(7.01,values));
  assert.ok(Viz.scoreFontSize(7.01,values)>Viz.scoreFontSize(6.72,values));
  assert.ok(Viz.scoreFontSize(7.31,values)/Viz.scoreFontSize(6.72,values)>3.5);
  assert.equal(Viz.scoreFontSize(7.01,[6.5,7.01,7.01,8]),Viz.scoreFontSize(7.01,[6.5,7.01,7.01,8]));
});
test('score word sizes are power-law: the lower half stays small, only the top ranks grow large', () => {
  // Averages cluster in a narrow band (here 8 levels). A count-cloud-like
  // distribution keeps most tags small so differences stand out.
  const values=[6.72,6.83,6.9,6.94,7.01,7.08,7.16,7.31];
  const sizes=values.map(v=>Viz.scoreFontSize(v,values));
  assert.ok(sizes.filter(s=>s<=20).length>=5,'lower ranks should stay small');
  assert.ok(sizes[7]>=48,'top rank should dominate');
  assert.ok(sizes[7]-sizes[6]>15,'top ranks separate clearly');
  assert.ok(sizes[3]-sizes[0]<3,'lower ranks compress together');
});
test('tag threshold is strictly over ten, and frequency sorting is stable', () => {
  assert.deepEqual(Viz.featuredTags([{name:'十',count:10},{name:'十一',count:11},{name:'最多',count:548},{name:'少',count:1}]).map(row=>row.name),['最多','十一']);
});
test('calendar-like tags are excluded without removing thematic season words', () => {
  const names=['2026','2026年','2026年7月','2026-07','2025夏番','7月番','2020s','夏天','青春'];
  assert.deepEqual(Viz.featuredTags(names.map(name=>({name,count:20}))).map(row=>row.name),['青春','夏天']);
});
test('cloud packing places every word, deterministically, without overlap or overflow', () => {
  for(const width of [280,335,816]) {
    const input=Array.from({length:48},(_,index)=>({index,seed:index*7919+3,width:Math.min(width-20,35+(index*37)%180),height:20+(index*11)%35}));
    const cloud=Viz.packCloud(input,width);
    assert.deepEqual(cloud,Viz.packCloud(input,width));
    assert.equal(cloud.items.length,input.length);
    assert.equal(new Set(cloud.items.map(item=>item.index)).size,input.length);
    cloud.items.forEach((a,i)=>{
      assert.ok(a.x>=0 && a.x+a.width<=width+1 && a.y>=0 && a.y+a.height<=cloud.height+1);
      cloud.items.slice(i+1).forEach(b=>assert.ok(!Viz.overlaps(a,b)));
    });
  }
  assert.deepEqual(Viz.packCloud([],335),{items:[],height:0});
});
test('moderate clouds stay close to the frame aspect and keep a center-out hierarchy', () => {
  const input=Array.from({length:24},(_,index)=>({index,seed:index*31+7,width:60+(index*53)%120,height:24+(index*7)%14}));
  const cloud=Viz.packCloud(input,816);
  assert.ok(cloud.height<=Math.max(816*1.08,260)+1);
  const largestFirst=cloud.items[0];
  const centerDistance=Math.abs(largestFirst.x+largestFirst.width/2-408);
  assert.ok(centerDistance<300,'largest word should sit near the center');
});
test('a dense tag set keeps every word and finishes quickly', () => {
  for (const width of [335,816]) {
    const input=Array.from({length:160},(_,index)=>({index,seed:index*104729,width:30+(index*17)%90,height:23}));
    const started=Date.now();
    const cloud=Viz.packCloud(input,width);
    assert.ok(Date.now()-started<3000,'packing must stay interactive');
    assert.equal(cloud.items.length,input.length);
    assert.ok((cloud.scale||1)<=1);
    cloud.items.forEach((a,i)=>{
      assert.ok(a.x>=0 && a.x+a.width<=width+1 && a.y>=0 && a.y+a.height<=cloud.height+1);
      cloud.items.slice(i+1).forEach(b=>assert.ok(!Viz.overlaps(a,b)));
    });
  }
});
