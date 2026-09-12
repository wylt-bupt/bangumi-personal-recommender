// Experimental main-score variants. Production modules are only imported, never edited.
const Core=require('../../src/core.cjs');
const clamp=Core.clamp;
const sum=xs=>xs.reduce((a,b)=>a+b,0);
const mean=xs=>xs.length?sum(xs)/xs.length:0;
const SHRINK={tag:4,meta:4,director:2.5,studio:4,creator:3,series:3,script:3,music:4,cv:7,decade:8,format:6};
const MIN={tag:2,meta:2,director:2,studio:3,creator:2,series:2,script:2,music:3,cv:4,decade:4,format:3};
function groupsFor(snapshot){
  const parents=new Map();
  const find=id=>{if(!parents.has(id))parents.set(id,id);if(parents.get(id)!==id)parents.set(id,find(parents.get(id)));return parents.get(id);};
  const join=(a,b)=>{a=find(a);b=find(b);parents.set(Math.max(a,b),Math.min(a,b));};
  for(const row of snapshot.relations)for(const r of row.relations)join(row.id,r.id);
  return new Map(snapshot.collections.map(c=>[c.subjectId,find(c.subjectId)]));
}
function prepare(snapshot){
  const groups=groupsFor(snapshot);
  const rated=snapshot.collections.filter(c=>c.rate>0).map((c,i)=>({...c,index:i,group:groups.get(c.subjectId),vector:Core.buildFeatureVector(c.subject,c.tags)}));
  const queries=new Map([...snapshot.collections.map(c=>c.subject),...snapshot.candidates].map(s=>[s.id,{subject:s,vector:Core.buildFeatureVector(s)}]));
  const similarityCache=new Map();
  function similarities(query){
    if(!similarityCache.has(query.subject.id)){
      const values=new Float64Array(rated.length);
      for(const row of rated)values[row.index]=Core.weightedJaccard(query.vector.features,row.vector.features);
      similarityCache.set(query.subject.id,values);
    }
    return similarityCache.get(query.subject.id);
  }
  return {groups,rated,queries,similarities};
}
function train(rows,variant){
  const core=Core.trainProfile(rows);
  const all=rows.map(r=>({...r,residual:clamp((r.rate-Core.expectedRating(r.subject,core.baseline))/2.5,-1.5,1.5)}));
  const groupSizes=new Map();for(const r of all)groupSizes.set(r.group,(groupSizes.get(r.group)||0)+1);
  if(variant==='D'){
    const stats=new Map();let effectiveCount=0;
    for(const r of all){
      const w=1/Math.sqrt(groupSizes.get(r.group));effectiveCount+=w;
      for(const [token,magnitude]of Object.entries(r.vector.features)){
        const s=stats.get(token)||{support:0,mass:0,families:new Set()};
        s.support+=w;s.mass+=w*r.residual*magnitude;s.families.add(r.group);stats.set(token,s);
      }
    }
    core.featureWeights={};core.featureSupport={};
    for(const [token,s]of stats){const role=token.split(':')[0];if(s.families.size<(MIN[role]||2))continue;
      core.featureWeights[token]=s.mass/((SHRINK[role]||4)+s.support)*clamp(Math.log((effectiveCount+1)/(s.support+1))+1,1,2.5);
      core.featureSupport[token]=s.families.size;
    }
  }
  const anchors=variant==='A'?[...all].sort((a,b)=>Math.abs(b.residual)-Math.abs(a.residual)).slice(0,80):all;
  return {core,anchors,variant,groupSizes};
}
function score(query,model,prepared){
  const {core,variant}=model;
  const features=query.vector.features;
  const contentRaw=sum(Object.entries(features).map(([t,m])=>m*(core.featureWeights[t]||0)))/Math.sqrt(Math.max(1,sum(Object.values(features))));
  const content=Math.tanh(contentRaw*2.2);
  const similarities=prepared.similarities(query);
  let near=model.anchors.map(a=>({a,similarity:similarities[a.index]})).filter(x=>x.similarity>=0.04).sort((a,b)=>b.similarity-a.similarity);
  if(variant==='D'){const used=new Set();near=near.filter(x=>{if(used.has(x.a.group))return false;used.add(x.a.group);return true;});}
  near=near.slice(0,6);
  const mass=sum(near.map(x=>x.similarity));
  const numerator=sum(near.map(x=>x.similarity*x.a.residual));
  const neighbor=mass?numerator/(mass+(['C','D'].includes(variant)?1:0)):0;
  const quality=clamp((Core.bayesianScore(query.subject,core.baseline.globalMean)-6.5)/2.5,-1,1);
  const normalizedScore=0.6*content+0.25*neighbor+0.15*quality;
  return {subject:query.subject,normalizedScore,predicted:clamp(core.baseline.userMean+2.1*normalizedScore,1,10),features,content,neighbor,quality,near:near.map(x=>({id:x.a.subjectId,rate:x.a.rate,similarity:x.similarity,share:x.similarity/(mass+(['C','D'].includes(variant)?1:0))}))};
}
function genderFeatures(data){
  if(!data)return new Map();
  const genders=new Map(data.characters.map(c=>{
    let gender=c.gender;
    if(!['female','male'].includes(gender)){
      const value=(c.infobox||[]).map(e=>typeof e.value==='string'?e.value:'').join(' ').trim();
      if(/^(女|女性|female)$/i.test(value))gender='female';
      else if(/^(男|男性|male)$/i.test(value))gender='male';
    }
    return [c.id,gender];
  }));
  return new Map(data.casts.map(c=>{
    const ids=[...new Set(c.main.map(m=>m.id))];
    const f=ids.filter(id=>genders.get(id)==='female').length;
    const m=ids.filter(id=>genders.get(id)==='male').length;
    const known=f+m,total=ids.length,coverage=total?known/total:0;
    // Unknown and other genders are never counted as male; incomplete casts yield no feature.
    return [c.id,{female:f,male:m,total,coverage,ratio:known>=2&&coverage>=0.8?f/known:null}];
  }));
}
function fitGender(observations,genders){
  const rows=observations.map(o=>({...o,g:genders.get(o.id)})).filter(o=>o.g?.ratio!==null&&o.g?.ratio!==undefined);
  const sizes=new Map();rows.forEach(r=>sizes.set(r.group,(sizes.get(r.group)||0)+1));
  const independentGroups=sizes.size;
  if(independentGroups<20)return {slope:0,center:0.5,support:rows.length,independentGroups};
  rows.forEach(r=>r.w=r.g.coverage/Math.sqrt(sizes.get(r.group)));
  const wsum=sum(rows.map(r=>r.w)),center=sum(rows.map(r=>r.w*r.g.ratio))/wsum;
  const eMean=sum(rows.map(r=>r.w*(r.rate-r.predicted)))/wsum;
  const numerator=sum(rows.map(r=>r.w*(r.g.ratio-center)*(r.rate-r.predicted-eMean)));
  const denominator=sum(rows.map(r=>r.w*(r.g.ratio-center)**2))+20;
  return {slope:numerator/denominator,center,support:rows.length,independentGroups};
}
function applyGender(s,g,fit){
  const adjustment=g?.ratio===null||g?.ratio===undefined?0:clamp(fit.slope*(g.ratio-fit.center)*g.coverage,-0.08,0.08);
  return {...s,predicted:clamp(s.predicted+adjustment,1,10),normalizedScore:s.normalizedScore+adjustment/2.1,genderAdjustment:adjustment};
}
module.exports={prepare,train,score,genderFeatures,fitGender,applyGender,mean,sum};
