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
  assert.equal(Viz.fontSize(10,10,10),32);
  assert.ok(Viz.fontSize(548,11,548)/Viz.fontSize(11,11,548)>4);
});
test('tag threshold is strictly over ten, and frequency sorting is stable', () => {
  assert.deepEqual(Viz.featuredTags([{name:'十',count:10},{name:'十一',count:11},{name:'最多',count:548},{name:'少',count:1}]).map(row=>row.name),['最多','十一']);
});
test('seasons include all twelve months; means exclude unrated works', () => {
  const rows=Array.from({length:12},(_,i)=>({subject:{date:'2025-'+String(i+1).padStart(2,'0')+'-15'},rate:i===0?0:8}));
  rows.push({subject:{date:'2024-01-01'},rate:10},{subject:{date:'2024'},rate:9},{subject:{date:'2025-13-01'},rate:8});
  const result=Viz.seasonDistribution(rows);
  assert.equal(result.total,13);assert.equal(result.unknown,2);
  assert.deepEqual(result.groups.map(row=>row.month),[1,4,7,10]);
  assert.deepEqual(result.groups.map(row=>row.count),[4,3,3,3]);
  assert.equal(result.groups[0].rated,3);assert.equal(result.groups[0].average,26/3);
  assert.ok(Math.abs(result.groups.reduce((sum,row)=>sum+row.share,0)-1)<1e-10);
  const empty=Viz.seasonDistribution([{subject:{date:'2024-07'},rate:0}]);
  assert.equal(empty.groups[2].count,1);assert.equal(empty.groups[2].average,null);
  assert.equal(empty.groups[0].count,0);assert.equal(empty.groups[0].average,null);
});
test('cloud packing is deterministic, bounded and never overlaps or drops a word', () => {
  for(const width of [280,335,816]) {
    const input=Array.from({length:48},(_,index)=>({index,width:Math.min(width-20,35+(index*37)%180),height:20+(index*11)%35}));
    const cloud=Viz.packCloud(input,width);
    assert.deepEqual(cloud,Viz.packCloud(input,width));
    assert.equal(cloud.items.length,input.length);
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
test('all 700 tags fit without overlap or a sparse fallback tail', () => {
  for (const width of [335,816]) {
    const input=Array.from({length:700},(_,index)=>({index,width:30+(index*17)%90,height:23}));
    const cloud=Viz.packCloud(input,width);
    assert.equal(cloud.items.length,700);
    cloud.items.forEach((a,i)=>{
      assert.ok(a.x>=0 && a.x+a.width<=width && a.y>=0 && a.y+a.height<=cloud.height);
      cloud.items.slice(i+1).forEach(b=>assert.ok(!Viz.overlaps(a,b,4.9)));
    });
    const packedArea=input.reduce((sum,item)=>sum+(item.width+5)*(item.height+5),0);
    assert.ok(cloud.height<packedArea/(width-16)/.6);
  }
});
