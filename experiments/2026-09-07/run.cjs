const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Core=require('../../src/core.cjs');
const M=require('./model.cjs');
const {mean,sum}=M;
const root=__dirname;
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'snapshot.json'),'utf8'));
const genderFile=path.join(root,'characters.json');
const genderData=fs.existsSync(genderFile)?JSON.parse(fs.readFileSync(genderFile,'utf8')):null;
const gender=M.genderFeatures(genderData);
const p=M.prepare(snapshot);
const variants=['A','B','C','D'];
const relationVerified=new Set(snapshot.relations.filter(r=>!r.error).map(r=>r.id));
const label={A:'现行主模型',B:'全部已评分邻居',C:'全部邻居＋弱证据衰减',D:'再加系列支持度调整',E:'D＋女性主要角色占比'};
const hash=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
function folds(rows,k=5){
  const groups=new Map();for(const r of rows){if(!groups.has(r.group))groups.set(r.group,[]);groups.get(r.group).push(r);}
  const out=Array.from({length:k},()=>[]);
  for(const [,members]of [...groups].sort((a,b)=>b[1].length-a[1].length||hash(a[0]).localeCompare(hash(b[0])))){
    const target=out.reduce((best,fold,i)=>fold.length<out[best].length?i:best,0);out[target].push(...members);
  }
  return out;
}
function metrics(rows){
  if(!rows.length)return null;
  const errors=rows.map(r=>r.predicted-r.rate);
  const sorted=[...rows].sort((a,b)=>b.predicted-a.predicted);
  const cutoff=Math.min(20,rows.length),top=sorted.slice(0,cutoff);
  const dcg=rs=>sum(rs.slice(0,cutoff).map((r,i)=>(Math.pow(2,Math.max(0,r.rate-6))-1)/Math.log2(i+2)));
  const ideal=dcg([...rows].sort((a,b)=>b.rate-a.rate));
  const perGroup=new Map();for(const r of rows){if(!perGroup.has(r.group))perGroup.set(r.group,[]);perGroup.get(r.group).push(Math.abs(r.predicted-r.rate));}
  const avgPrediction=mean(rows.map(r=>r.predicted));
  return {n:rows.length,mae:mean(errors.map(Math.abs)),rmse:Math.sqrt(mean(errors.map(e=>e*e))),predictionSD:Math.sqrt(mean(rows.map(r=>(r.predicted-avgPrediction)**2))),groupMacroMAE:mean([...perGroup.values()].map(mean)),precision20:mean(top.map(r=>+(r.rate>=8))),ndcg20:ideal?dcg(sorted)/ideal:0};
}
function pairedInterval(left,right){
  const other=new Map(right.map(r=>[r.id,r])),groups=new Map();
  for(const r of left){const s=other.get(r.id);if(!s)continue;if(!groups.has(r.group))groups.set(r.group,[]);groups.get(r.group).push(Math.abs(s.predicted-s.rate)-Math.abs(r.predicted-r.rate));}
  const stats=[...groups.values()].map(v=>({n:v.length,total:sum(v)}));if(!stats.length)return null;
  let seed=20260907;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const boot=[];for(let i=0;i<1000;i++){let total=0,n=0;for(let j=0;j<stats.length;j++){const g=stats[Math.floor(random()*stats.length)];total+=g.total;n+=g.n;}boot.push(total/n);}
  boot.sort((a,b)=>a-b);return {deltaMAE:sum(stats.map(g=>g.total))/sum(stats.map(g=>g.n)),clusterBootstrap95:[boot[25],boot[974]],groups:stats.length};
}
function crossfit(rows,variant,k=5){
  const partition=folds(rows,k),observations=[];
  for(let f=0;f<partition.length;f++){
    const held=partition[f],ids=new Set(held.map(r=>r.subjectId));
    const training=rows.filter(r=>!ids.has(r.subjectId)),model=M.train(training,variant);
    const trainingGroups=new Set(training.map(r=>r.group));assert(held.every(r=>!trainingGroups.has(r.group)));
    for(const r of held){const s=M.score(p.queries.get(r.subjectId),model,p);observations.push({id:r.subjectId,group:r.group,rate:r.rate,fold:f,predicted:s.predicted,mainstream:!Core.ADULT_RECOMMENDATION_TAGS.profile.some(t=>Core.collectionHasTag(r,t))});}
  }
  return observations;
}
console.log('preparing similarities',p.rated.length,snapshot.candidates.length);
// Baseline reproduction check detects accidental changes in this experimental harness.
const a=M.train(p.rated,'A');
for(const s of snapshot.candidates.slice(0,30)){
  const actual=M.score(p.queries.get(s.id),a,p),expected=Core.scoreSubject(s,a.core,'balanced');
  assert(Math.abs(actual.predicted-expected.predicted)<1e-10,'baseline mismatch '+s.id);
}
console.log('baseline parity: 30/30');
const evaluation={},observations={};
for(const v of variants){
  console.log('grouped CV',v);const rows=crossfit(p.rated,v);observations[v]=rows;
  evaluation[v]={overall:metrics(rows),mainstream:metrics(rows.filter(r=>r.mainstream)),relationVerified:metrics(rows.filter(r=>relationVerified.has(r.id))),folds:Array.from({length:5},(_,f)=>metrics(rows.filter(r=>r.fold===f)))};
}
if(genderData){
  console.log('nested gender validation');
  const partition=folds(p.rated),rows=[];
  for(let f=0;f<5;f++){
    const held=partition[f],ids=new Set(held.map(r=>r.subjectId));
    const training=p.rated.filter(r=>!ids.has(r.subjectId));
    // Fit gender ONLY on inner-fold out-of-sample errors from the outer training partition.
    const inner=crossfit(training,'D',3),fit=M.fitGender(inner,gender);
    for(const o of observations.D.filter(r=>r.fold===f)){
      const g=gender.get(o.id),s=M.applyGender({predicted:o.predicted,normalizedScore:0},g,fit);
      rows.push({...o,predicted:s.predicted,adjustment:s.genderAdjustment,covered:g?.ratio!==null&&g?.ratio!==undefined});
    }
  }
  observations.E=rows;
  evaluation.E={overall:metrics(rows),covered:metrics(rows.filter(r=>r.covered)),coveredWithoutGender:metrics(observations.D.filter(r=>gender.get(r.id)?.ratio!==null&&gender.get(r.id)?.ratio!==undefined)),mainstream:metrics(rows.filter(r=>r.mainstream)),folds:Array.from({length:5},(_,f)=>metrics(rows.filter(r=>r.fold===f)))};
}
const models=Object.fromEntries(variants.map(v=>[v,M.train(p.rated,v)]));
const fullScores=Object.fromEntries(variants.map(v=>[v,snapshot.candidates.map(s=>M.score(p.queries.get(s.id),models[v],p)).sort((a,b)=>b.normalizedScore-a.normalizedScore)]));
const genderFit=genderData?M.fitGender(observations.D,gender):null;
if(genderData)fullScores.E=fullScores.D.map(s=>M.applyGender(s,gender.get(s.subject.id),genderFit)).sort((a,b)=>b.normalizedScore-a.normalizedScore);
const summarise=s=>({id:s.subject.id,name:s.subject.nameCn||s.subject.name,predicted:s.predicted,content:s.content,neighbor:s.neighbor,gender:gender.get(s.subject.id)||null,genderAdjustment:s.genderAdjustment||0,near:s.near});
const rankings=Object.fromEntries(Object.entries(fullScores).map(([v,ss])=>[v,{raw:ss.map(summarise),mmr:Core.diversify(ss.slice(0,180),Math.min(180,ss.length),'balanced','fixed-experiment').map(summarise)}]));
const existingPath=path.join(root,'results.json');
const previous=process.argv.includes('--reuse-influence')&&fs.existsSync(existingPath)?JSON.parse(fs.readFileSync(existingPath,'utf8')):null;
if(previous)assert.equal(previous.snapshotAt,snapshot.at,'cannot reuse sensitivity measurements from another snapshot');
const influence=previous?.influence||{};
const high=p.rated.filter(r=>r.rate>=8);
const deterministic=[...high].sort((a,b)=>hash('influence:'+a.subjectId).localeCompare(hash('influence:'+b.subjectId))).slice(0,30);
const implicated=new Set(fullScores.A.slice(0,20).flatMap(s=>s.near.filter(n=>n.rate>=8).map(n=>n.id)));
const removal=[...new Map([...deterministic,...high.filter(r=>implicated.has(r.subjectId))].map(r=>[r.subjectId,r])).values()];
for(const v of variants){
  if(influence[v])continue;
  console.log('influence',v,removal.length);const base=fullScores[v],baseTop=new Set(base.slice(0,20).map(s=>s.subject.id));
  const baseScores=new Map(base.map(s=>[s.subject.id,s.predicted]));
  const results=[];
  for(const excluded of removal){
    const model=M.train(p.rated.filter(r=>r.subjectId!==excluded.subjectId),v);
    const ss=snapshot.candidates.map(s=>M.score(p.queries.get(s.id),model,p)).sort((a,b)=>b.normalizedScore-a.normalizedScore);
    const deltas=ss.map(s=>Math.abs(s.predicted-baseScores.get(s.subject.id)));
    results.push({id:excluded.subjectId,name:excluded.subject.nameCn||excluded.subject.name,rate:excluded.rate,meanChange:mean(deltas),maxChange:Math.max(...deltas),top20Retained:ss.slice(0,20).filter(s=>baseTop.has(s.subject.id)).length});
  }
  influence[v]={tested:results.length,meanAbsoluteChange:mean(results.map(r=>r.meanChange)),meanWorstCandidateChange:mean(results.map(r=>r.maxChange)),worstCandidateChange:Math.max(...results.map(r=>r.maxChange)),meanTop20Retained:mean(results.map(r=>r.top20Retained)),worstTop20Retained:Math.min(...results.map(r=>r.top20Retained)),cases:results.sort((a,b)=>b.maxChange-a.maxChange)};
}
// Check whether the top retrieval tags rely on one exceptional rating (fixed pool above remains unchanged).
const retrieval={};
for(const v of ['A','D']){
  const top=model=>Object.entries(model.core.featureWeights).filter(([t,w])=>t.startsWith('tag:')&&w>0).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([t])=>t.slice(4));
  const original=top(models[v]);const changes=removal.map(ex=>{const next=top(M.train(p.rated.filter(r=>r.subjectId!==ex.subjectId),v));return 12-next.filter(t=>original.includes(t)).length;});
  retrieval[v]={tags:original,meanTagsReplaced:mean(changes),maxTagsReplaced:Math.max(...changes)};
}
const familySizes=new Map();p.rated.forEach(r=>familySizes.set(r.group,(familySizes.get(r.group)||0)+1));
const uncertainty=Object.fromEntries(['B','C','D'].map(v=>[v,pairedInterval(observations.A,observations[v])]));
if(observations.E)uncertainty.E=pairedInterval(observations.D.filter(r=>gender.get(r.id)?.ratio!==null&&gender.get(r.id)?.ratio!==undefined),observations.E);
const result={createdAt:new Date().toISOString(),snapshotAt:snapshot.at,sourceHash:hash(fs.readFileSync(path.join(root,'../../src/core.cjs'),'utf8')),scope:'Frozen public API snapshot, current main scorer before structured-credits blend; identical Japanese-only unmarked candidate pool. MMR unchanged. No production edits.',data:{collections:snapshot.collections.length,rated:p.rated.length,candidates:snapshot.candidates.length,families:familySizes.size,relationErrors:snapshot.relations.filter(r=>r.error).length,largestFamilies:[...familySizes].sort((a,b)=>b[1]-a[1]).slice(0,10)},labels:label,evaluation,uncertainty,influence,retrieval,gender:{sampling:genderData?.sampling,fit:genderFit,knownTraining:p.rated.filter(r=>gender.get(r.subjectId)?.ratio!==null&&gender.get(r.subjectId)?.ratio!==undefined).length,knownCandidates:snapshot.candidates.filter(s=>gender.get(s.id)?.ratio!==null&&gender.get(s.id)?.ratio!==undefined).length,errors:genderData?.characters.filter(c=>c.error).length||0},rankings,observations};
fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(result,null,2));
const round=n=>Number(n).toFixed(4);
const csv=['variant,stage,rank,id,name,predicted,gender_adjustment',...Object.entries(rankings).flatMap(([v,stages])=>Object.entries(stages).flatMap(([stage,rows])=>rows.map((r,i)=>[v,stage,i+1,r.id,JSON.stringify(r.name),round(r.predicted),round(r.genderAdjustment)].join(','))))].join('\n');
fs.writeFileSync(path.join(root,'rankings.csv'),'\uFEFF'+csv);
console.log(JSON.stringify({data:result.data,evaluation,influence:Object.fromEntries(Object.entries(influence).map(([v,o])=>[v,{...o,cases:o.cases.slice(0,2)}])),gender:result.gender,retrieval,top10:Object.fromEntries(Object.entries(rankings).map(([v,o])=>[v,o.mmr.slice(0,10).map(r=>[r.name,round(r.predicted)])]))},null,2));
