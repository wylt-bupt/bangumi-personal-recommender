// Read-only Bangumi API acquisition. Never reads credentials or modifies BGM data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Core = require('../../src/core.cjs');
const root = __dirname;
const cache = path.join(root, 'data');
fs.mkdirSync(cache, {recursive:true});
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function get(endpoint, body) {
  const key = crypto.createHash('sha256').update(endpoint+JSON.stringify(body||null)).digest('hex');
  const file = path.join(cache,key+'.json');
  if(fs.existsSync(file)) return JSON.parse(fs.readFileSync(file,'utf8')).value;
  for(let attempt=0;attempt<3;attempt++) {
    try {
      const r=await fetch('https://api.bgm.tv'+endpoint,{method:body?'POST':'GET',headers:{'User-Agent':'wylt-bupt/bangumi-personal-recommender (offline personal experiment)','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const value=await r.json();
      fs.writeFileSync(file,JSON.stringify({endpoint,body,fetchedAt:new Date().toISOString(),value}));
      return value;
    } catch(e) { if(attempt===2) throw e; await pause(1500*(attempt+1)); }
  }
}
async function map(items,fn,label) {
  let cursor=0,done=0; const out=new Array(items.length);
  await Promise.all(Array.from({length:4},async()=>{while(cursor<items.length){const i=cursor++;out[i]=await fn(items[i],i);done++;if(done%100===0||done===items.length)console.log(label,done+'/'+items.length);await pause(100);}}));
  return out;
}
async function main(){
  const first=await get('/v0/users/wylt/collections?subject_type=2&limit=100&offset=0');
  const pages=await map(Array.from({length:Math.ceil(first.total/100)-1},(_,i)=>(i+1)*100),o=>get('/v0/users/wylt/collections?subject_type=2&limit=100&offset='+o),'collections');
  const collections=[first,...pages].flatMap(p=>p.data).map(Core.normalizeCollection);
  const seen=new Set(collections.map(c=>c.subjectId));
  const tags=Core.topRetrievalTags(Core.trainProfile(collections),12);
  const ranks=await map(Array.from({length:10},(_,i)=>i*100),o=>get('/v0/subjects?type=2&sort=rank&limit=100&offset='+o),'rank');
  const searches=await map(tags.flatMap(tag=>[0,50].map(offset=>({tag,offset}))),q=>get('/v0/search/subjects?limit=50&offset='+q.offset,{keyword:q.tag,sort:'heat',filter:{type:[2],tag:[q.tag]}}),'tags');
  const candidates=[...new Map([...ranks,...searches].flatMap(p=>p.data||[]).map(s=>[s.id,Core.normalizeSubject(s)])).values()].filter(s=>!seen.has(s.id)&&Core.classifyJapaneseOrigin(s).status==='japanese');
  const rated=collections.filter(c=>c.rate>0);
  const rels=await map(rated,c=>get('/v0/subjects/'+c.subjectId+'/subjects').then(v=>({id:c.subjectId,relations:v.filter(r=>r.type===2&&['前传','续集','番外篇','总集篇','不同演绎','主线故事','相同世界观'].includes(r.relation))})).catch(e=>({id:c.subjectId,error:e.message,relations:[]})),'series');
  const snapshot={at:new Date().toISOString(),source:'public API, frozen per-request cache',collections,candidates,retrievalTags:tags,relations:rels};
  fs.writeFileSync(path.join(root,'snapshot.json'),JSON.stringify(snapshot));
  console.log(JSON.stringify({collections:collections.length,rated:rated.length,candidates:candidates.length,tags,relationErrors:rels.filter(x=>x.error).length}));
  if(process.argv.includes('--characters')){
    const M=require('./model.cjs'),p=M.prepare(snapshot);
    const orderedGroups=[...new Map(p.rated.map(r=>[r.group,r])).values()].sort((a,b)=>{
      const hash=id=>crypto.createHash('sha256').update('gender-sample-v1:'+id).digest('hex');
      return hash(a.group).localeCompare(hash(b.group));
    });
    // Rating-blind, one-per-series sample; candidate coverage is the union of both models' top 40.
    const trainingIds=orderedGroups.slice(0,240).map(r=>r.subjectId);
    const candidateIds=['A','D'].flatMap(v=>{
      const model=M.train(p.rated,v);
      return candidates.map(s=>M.score(p.queries.get(s.id),model,p)).sort((a,b)=>b.normalizedScore-a.normalizedScore).slice(0,40).map(s=>s.subject.id);
    });
    const ids=[...new Set([...trainingIds,...candidateIds])];
    const casts=await map(ids,id=>get('/v0/subjects/'+id+'/characters').then(v=>({id,main:v.filter(c=>c.relation==='主角').map(c=>({id:c.id,name:c.name}))})).catch(e=>({id,main:[],error:e.message})),'casts');
    const characterIds=[...new Set(casts.flatMap(c=>c.main.map(m=>m.id)))];
    const characters=await map(characterIds,id=>get('/v0/characters/'+id).then(v=>({id,name:v.name,gender:v.gender,infobox:v.infobox?.filter(e=>/性别|性別|gender/i.test(e.key))})).catch(e=>({id,error:e.message})),'gender');
    fs.writeFileSync(path.join(root,'characters.json'),JSON.stringify({at:new Date().toISOString(),sampling:'240 rating-blind independent-series representatives plus A/D raw top-40 union',trainingIds,candidateIds:[...new Set(candidateIds)],casts,characters}));
    console.log('character metadata saved',casts.length,characters.length);
  }
}
if(require.main===module) main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={get,map};
