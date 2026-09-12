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
test('tag threshold is strictly over ten, and frequency sorting is stable', () => {
  assert.deepEqual(Viz.featuredTags([{name:'十',count:10},{name:'十一',count:11},{name:'最多',count:548},{name:'少',count:1}]).map(row=>row.name),['最多','十一']);
});
test('calendar-like tags are excluded without removing thematic season words', () => {
  const names=['2026','2026年','2026年7月','2026-07','2025夏番','7月番','夏天','青春'];
  assert.deepEqual(Viz.featuredTags(names.map(name=>({name,count:20}))).map(row=>row.name),['青春','夏天']);
});
test('narrow clouds select an importance-first set from available circular area', () => {
  const items=Array.from({length:70},(_,index)=>({index,width:70-index/2,height:26}));
  const narrow=Viz.circularItems(items,335);
  assert.ok(narrow.length>=8 && narrow.length<items.length);
  assert.deepEqual(narrow,items.slice(0,narrow.length));
  const wide=Viz.circularItems(items,816);
  assert.equal(wide.length,items.length);
  assert.deepEqual(wide,items);
  const scoreSpread=Viz.circularItems(items,335,true);
  assert.ok(scoreSpread.some(item=>item.index<10));
  assert.ok(scoreSpread.some(item=>item.index>59));
});
test('cloud packing is deterministic, nearly circular, bounded and keeps the highest-priority words', () => {
  for(const width of [280,335,816]) {
    const input=Array.from({length:48},(_,index)=>({index,width:Math.min(width-20,35+(index*37)%180),height:20+(index*11)%35}));
    const selected=Viz.circularItems(input,width);
    const cloud=Viz.packCloud(selected,width);
    assert.deepEqual(cloud,Viz.packCloud(selected,width));
    assert.ok(cloud.items.length>=8 && cloud.items.length<=selected.length);
    assert.deepEqual(cloud.items.map(item=>item.index),selected.slice(0,cloud.items.length).map(item=>item.index));
    assert.ok(cloud.height<=Math.max(width*1.08,260)+1);
    cloud.items.forEach((a,i)=>{
      assert.ok(a.x>=0 && a.x+a.width<=width && a.y>=0 && a.y+a.height<=cloud.height);
      cloud.items.slice(i+1).forEach(b=>assert.ok(!Viz.overlaps(a,b)));
    });
  }
  assert.deepEqual(Viz.packCloud([],335),{items:[],height:0});
});
test('episode distribution keeps no more than five common counts and merges the rest', () => {
  const rows=[];
  for(const [eps,count] of [[12,40],[24,20],[13,14],[26,10],[1,6],[2,2],[3,1],[50,1]])for(let i=0;i<count;i++)rows.push({eps});
  const result=Viz.episodeDistribution(rows);
  assert.equal(result.total,94);
  assert.deepEqual(result.groups.map(row=>row.label),['12 话','24 话','13 话','26 话','1 话','其他']);
  assert.equal(result.groups.at(-1).count,4);
  assert.ok(Math.abs(result.groups.reduce((sum,row)=>sum+row.share,0)-1)<1e-10);
});
test('pie geometry covers one circle and preserves group values', () => {
  const groups=[{label:'12 话',count:7,share:.7},{label:'其他',count:3,share:.3}];
  const slices=Viz.pieSlices(groups);
  assert.deepEqual(slices.map(row=>[row.label,row.count]),[['12 话',7],['其他',3]]);
  assert.ok(slices.every(row=>/^M/.test(row.path)&&Number.isFinite(row.labelX)&&Number.isFinite(row.labelY)));
  assert.match(Viz.pieSlices([{label:'12 话',count:1,share:1}])[0].path,/A110 110/);
});
test('an unusually dense tag set scales before dropping words and never stretches the cloud', () => {
  for (const width of [335,816]) {
    const input=Array.from({length:160},(_,index)=>({index,width:30+(index*17)%90,height:23}));
    const selected=Viz.circularItems(input,width);
    const cloud=Viz.packCloud(selected,width);
    assert.ok(cloud.items.length>=8 && cloud.items.length<=input.length);
    if(width<460)assert.ok(cloud.items.length<input.length);
    assert.ok((cloud.scale||1)<=1);
    assert.ok(cloud.height<=Math.max(width*1.08,260)+1);
    cloud.items.forEach((a,i)=>{
      assert.ok(a.x>=0 && a.x+a.width<=width && a.y>=0 && a.y+a.height<=cloud.height);
      cloud.items.slice(i+1).forEach(b=>assert.ok(!Viz.overlaps(a,b,4.9)));
    });
  }
});
