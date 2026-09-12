const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('./model.cjs');
const Core=require('../../src/core.cjs');
function fixture(){
  const collections=Array.from({length:12},(_,i)=>Core.normalizeCollection({subject_id:i+1,type:2,rate:5+i%5,tags:[],subject:{id:i+1,type:2,name:'test'+i,tags:['校园',i%2?'恋爱':'科幻'],rating:{score:7,total:500}}}));
  const candidates=[Core.normalizeSubject({id:100,type:2,tags:['校园','恋爱'],rating:{score:7,total:500}})];
  return {collections,candidates,relations:[]};
}
test('experimental A reproduces production main score exactly',()=>{
  const s=fixture(),p=M.prepare(s),a=M.train(p.rated,'A');
  assert(Math.abs(M.score(p.queries.get(100),a,p).predicted-Core.scoreSubject(s.candidates[0],Core.trainProfile(s.collections)).predicted)<1e-12);
});
test('weak single neighbor influence shrinks with absolute similarity',()=>{
  const p=M.prepare(fixture()),q=p.queries.get(100),m=M.train(p.rated.slice(0,1),'C');
  m.anchors[0].residual=0.4;
  const weak=M.score(q,m,{similarities:()=>[0.05]}),strong=M.score(q,m,{similarities:()=>[0.5]});
  assert(weak.neighbor>0);assert(weak.neighbor<strong.neighbor);assert(weak.neighbor<0.02);
});
test('same-series repetitions do not qualify as independent tag support',()=>{
  const s=fixture();s.relations=s.collections.slice(1).map(c=>({id:c.subjectId,relations:[{id:1}]}));
  const p=M.prepare(s),m=M.train(p.rated,'D');
  assert.equal(m.core.featureWeights['tag:校园'],undefined);
  assert.equal(M.score(p.queries.get(100),m,p).near.length,1);
});
test('unknown gender is not male and incomplete casts produce no ratio',()=>{
  const g=M.genderFeatures({characters:[{id:1,gender:'female'},{id:2,gender:null},{id:3,gender:'male'}],casts:[{id:100,main:[{id:1},{id:2}]},{id:101,main:[{id:1},{id:3}]}]});
  assert.equal(g.get(100).male,0);assert.equal(g.get(100).ratio,null);assert.equal(g.get(101).ratio,0.5);
});
test('cast adjustment is bounded and missing values are neutral',()=>{
  const s={predicted:7,normalizedScore:0},fit={slope:100,center:0.5};
  assert.equal(M.applyGender(s,{ratio:1,coverage:1},fit).genderAdjustment,0.08);
  assert.equal(M.applyGender(s,{ratio:0,coverage:1},fit).genderAdjustment,-0.08);
  assert.equal(M.applyGender(s,undefined,fit).genderAdjustment,0);
});
