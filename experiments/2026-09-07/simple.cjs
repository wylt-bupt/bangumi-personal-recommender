// Deliberately small model: BGM/user ratings plus recurring content tags only.
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../../src/core.cjs');
const M=require('./model.cjs');
const root=__dirname;
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'snapshot.json'),'utf8'));
const prior=JSON.parse(fs.readFileSync(path.join(root,'results.json'),'utf8'));
const p=M.prepare(snapshot);
const CONTENT=/(?:治[愈癒]|致郁|日常|恋爱|爱情|纯爱|校园|青春|成长|百合|耽美|科幻|奇幻|魔幻|悬疑|推理|恐怖|惊悚|猎奇|黑暗|压抑|虚无|空虚|孤独|冒险|战斗|战争|历史|社会|政治|职场|家庭|亲情|友情|喜剧|搞笑|爆笑|吐槽|电波|意识流|群像|公路|音乐|运动|竞技|偶像|机战|机器人|超能力|异世界|穿越|轮回|时间|末日|灾难|犯罪|侦探|心理|哲学|文学|童话|催泪|感动|热血|萌|美食|旅行|剧情|后宫|ntr|胃疼|胃药|内涵|乱伦|反乌托邦|赛博朋克|励志|体育|成长)/i;
const generic=new Set(['tv','日本','动画','動畫','anime','アニメ','神作','佳作','名作','经典','補番','补番']);
const canonical=tag=>{
  if(/^(?:爱情|恋爱)$/.test(tag))return '恋爱';
  if(/^(?:治愈系|治癒|治癒系)$/.test(tag))return '治愈';
  if(/^(?:轻百合|輕百合)$/.test(tag))return '百合';
  if(/^(?:公路片|公路动画|公路動畫)$/.test(tag))return '公路';
  if(/^(?:体育|體育)$/.test(tag))return '运动';
  if(/^(?:喜剧|喜劇|搞笑|爆笑)$/.test(tag))return '喜剧';
  if(/^(?:催泪|催淚|感动|感動)$/.test(tag))return '感动';
  if(/^(?:胃疼|胃痛)$/.test(tag))return '胃药';
  return tag;
};
const tags=(subject,personal=[])=>[...new Set([...Core.normalizeTagList(personal),...Core.normalizeSubject(subject).tags])]
  .filter(t=>CONTENT.test(t)&&!generic.has(t)&&!(/^(?:19|20)\d{2}/.test(t))).map(canonical).filter((t,i,a)=>a.indexOf(t)===i);
const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
function train(rows){
  const baseline=Core.calculateRatingBaseline(rows);
  const byTag=new Map();
  for(const row of rows){
    const residual=Core.clamp(row.rate-Core.expectedRating(row.subject,baseline),-2,2);
    for(const tag of tags(row.subject,row.tags)){
      if(!byTag.has(tag))byTag.set(tag,new Map());
      const series=byTag.get(tag),values=series.get(row.group)||[];values.push(residual);series.set(row.group,values);
    }
  }
  const effects=new Map(),supports=new Map();
  for(const [tag,series]of byTag){
    if(series.size<5)continue;
    const values=[...series.values()].map(avg);
    effects.set(tag,values.reduce((a,b)=>a+b,0)/(values.length+6));
    supports.set(tag,series.size);
  }
  return {baseline,effects,supports};
}
function score(subject,model){
  const matched=tags(subject).map(tag=>({tag,effect:model.effects.get(tag),support:model.supports.get(tag)}))
    .filter(x=>Number.isFinite(x.effect)).sort((a,b)=>Math.abs(b.effect)-Math.abs(a.effect)).slice(0,3);
  const adjustment=Core.clamp(avg(matched.map(x=>x.effect)),-1.2,1.2);
  const predicted=Core.clamp(Core.expectedRating(Core.normalizeSubject(subject),model.baseline)+adjustment,1,10);
  return {subject:Core.normalizeSubject(subject),predicted,normalizedScore:(predicted-model.baseline.userMean)/2.1,features:Object.fromEntries(tags(subject).map(t=>['tag:'+t,1])),matched,adjustment};
}
function metrics(rows){
  const errors=rows.map(r=>r.predicted-r.rate),mean=avg;
  const sorted=[...rows].sort((a,b)=>b.predicted-a.predicted),topByFold=[];
  for(let fold=0;fold<5;fold++)topByFold.push(...sorted.filter(r=>r.fold===fold).slice(0,20));
  const predictionMean=mean(rows.map(r=>r.predicted));
  return {n:rows.length,mae:mean(errors.map(Math.abs)),rmse:Math.sqrt(mean(errors.map(e=>e*e))),precision20:mean(topByFold.map(r=>+(r.rate>=8))),predictionSD:Math.sqrt(mean(rows.map(r=>(r.predicted-predictionMean)**2)))};
}
const folds=new Map(prior.observations.A.map(r=>[r.id,r.fold])),observations=[];
for(let fold=0;fold<5;fold++){
  const model=train(p.rated.filter(r=>folds.get(r.subjectId)!==fold));
  for(const row of p.rated.filter(r=>folds.get(r.subjectId)===fold))observations.push({id:row.subjectId,group:row.group,rate:row.rate,fold,predicted:score(row.subject,model).predicted});
}
const model=train(p.rated);
const candidates=snapshot.candidates.map(s=>score(s,model)).sort((a,b)=>b.predicted-a.predicted);
const mmr=Core.diversify(candidates.slice(0,180),180,'balanced','simple-fixed');
const base=new Map(candidates.map(s=>[s.subject.id,s.predicted])),baseTop=new Set(candidates.slice(0,20).map(s=>s.subject.id)),baseMmrTop=new Set(mmr.slice(0,20).map(s=>s.subject.id));
const cases=[];
for(const removed of prior.influence.A.cases){
  const nextModel=train(p.rated.filter(r=>r.subjectId!==removed.id));
  const next=snapshot.candidates.map(s=>score(s,nextModel)).sort((a,b)=>b.predicted-a.predicted);
  const nextMmr=Core.diversify(next.slice(0,180),180,'balanced','simple-fixed');
  const deltas=next.map(s=>Math.abs(s.predicted-base.get(s.subject.id)));
  cases.push({id:removed.id,name:removed.name,meanChange:avg(deltas),maxChange:Math.max(...deltas),top20Retained:next.slice(0,20).filter(s=>baseTop.has(s.subject.id)).length,mmrTop20Retained:nextMmr.slice(0,20).filter(s=>baseMmrTop.has(s.subject.id)).length});
}
const result={description:'expected personal rating from BGM score + average of up to 3 strongest recurring canonical content-tag effects; each tag requires 5 independent series and shrinks by 6 pseudo-series; residuals clipped to ±2',metrics:metrics(observations),candidateSD:metrics(candidates.map(s=>({...s,rate:s.predicted}))).predictionSD,tagCount:model.effects.size,topTags:[...model.effects].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([tag,effect])=>({tag,effect,support:model.supports.get(tag)})),influence:{tested:cases.length,meanAbsoluteChange:avg(cases.map(x=>x.meanChange)),worstCandidateChange:Math.max(...cases.map(x=>x.maxChange)),meanTop20Retained:avg(cases.map(x=>x.top20Retained)),worstTop20Retained:Math.min(...cases.map(x=>x.top20Retained)),meanMmrTop20Retained:avg(cases.map(x=>x.mmrTop20Retained)),worstMmrTop20Retained:Math.min(...cases.map(x=>x.mmrTop20Retained)),cases:cases.sort((a,b)=>b.maxChange-a.maxChange)},top20:mmr.slice(0,20).map((s,i)=>({rank:i+1,id:s.subject.id,name:s.subject.nameCn||s.subject.name,predicted:s.predicted,adjustment:s.adjustment,tags:s.matched}))};
fs.writeFileSync(path.join(root,'simple-results.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
