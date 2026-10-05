#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const cp=require('child_process');

const root=path.resolve(__dirname,'..');
const corePath=path.join(__dirname,'status-core.js');
const helper=path.join(__dirname,'fetch_batch.py');
const dataDir=path.join(root,'docs','data');
fs.mkdirSync(dataDir,{recursive:true});

class GASResponse {
  constructor(x){this.x=x||{}}
  getResponseCode(){return Number(this.x.status||0)}
  getContentText(){return String(this.x.body||'')}
}
function runBatch(reqs){
  const p=cp.spawnSync('python3',[helper],{
    input:JSON.stringify(reqs),
    encoding:'utf8',
    maxBuffer:64*1024*1024,
    timeout:120000
  });
  if(p.error) throw p.error;
  if(p.status!==0) throw new Error(p.stderr||('fetch helper exit '+p.status));
  return JSON.parse(p.stdout||'[]').map(x=>new GASResponse(x));
}
function parseCsv(text){
  const rows=[]; let row=[],field='',q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){
      if(c==='"' && text[i+1]==='"'){field+='"';i++}
      else if(c==='"') q=false;
      else field+=c;
    } else {
      if(c==='"') q=true;
      else if(c===','){row.push(field);field=''}
      else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field=''}
      else field+=c;
    }
  }
  if(field.length||row.length){row.push(field.replace(/\r$/,''));rows.push(row)}
  return rows;
}
const cache={get:()=>null,put:()=>{}};
const context={
  console,
  Date, JSON, Math, Number, String, Boolean, Array, Object, RegExp,
  encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isFinite,
  setTimeout, clearTimeout,
  CacheService:{getScriptCache:()=>cache},
  Utilities:{parseCsv},
  UrlFetchApp:{
    fetch:(url,opt={})=>runBatch([{url,...opt}])[0],
    fetchAll:(reqs)=>runBatch(reqs)
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(corePath,'utf8'),context,{filename:'status-core.js'});

function write(name,obj){
  fs.writeFileSync(path.join(dataDir,name),JSON.stringify(obj,null,2)+'\n');
}
const dashboard=context.getDashboardData(true);

function actualProductTimeFromText(text, now=new Date()){
  const m=String(text||'').match(/\b[A-Z]{4}\d{2}\s+K[A-Z]{3}\s+(\d{2})(\d{2})(\d{2})\b/);
  if(!m)return null;
  const day=Number(m[1]), hour=Number(m[2]), minute=Number(m[3]);
  const candidates=[];
  for(const mo of [-1,0,1]){
    const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+mo,day,hour,minute,0));
    if(!isNaN(d)) candidates.push(d);
  }
  candidates.sort((a,b)=>Math.abs(a-now)-Math.abs(b-now));
  return candidates[0]||null;
}
function refreshRoutineProductsFromPages(board){
  const reqs=[], meta=[];
  const offices=Object.keys(board.offices||{});
  for(const office of offices){
    const products=board.offices[office].products||{};
    for(const key of Object.keys(products)){
      if(['TAF','NWPS','GRIDS'].includes(key)) continue;
      reqs.push({url:'https://forecast.weather.gov/product.php?site=NWS&issuedby='+encodeURIComponent(office)+'&product='+encodeURIComponent(key)+'&format=TXT&version=1&glossary=0',
        headers:{'User-Agent':'WFO-MOB-Product-Status-Board/4.0','Accept':'text/plain,text/html,*/*'}});
      meta.push({office,key});
    }
  }
  if(!reqs.length)return;
  const resps=runBatch(reqs);
  resps.forEach((r,i)=>{
    if(!r || r.getResponseCode()<200 || r.getResponseCode()>=300)return;
    const t=actualProductTimeFromText(r.getContentText(),new Date());
    if(!t)return;
    const {office,key}=meta[i], p=board.offices?.[office]?.products?.[key];
    if(!p)return;
    p.issuedAt=t.toISOString();
    const h=Math.max(0,(Date.now()-t.getTime())/3600000);
    p.ageHours=Math.round(h*10)/10;
    p.state=h>=12?'late':h>=8?'warn':'good';
    p.source='NWS Product Page';
  });
}
refreshRoutineProductsFromPages(dashboard);

function stripHtmlText(s){
  return String(s||'')
    .replace(/<script\b[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&#39;/g,"'")
    .replace(/&quot;/gi,'"')
    .replace(/\r/g,'')
    .replace(/[ \t]+/g,' ');
}
function parseVtecZulu(s){
  const m=String(s||'').match(/^(\d{2})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/);
  if(!m || s==='000000T0000Z') return null;
  const yy=+m[1], year=yy>=70?1900+yy:2000+yy;
  const d=new Date(Date.UTC(year,+m[2]-1,+m[3],+m[4],+m[5],0));
  return isNaN(d)?null:d;
}
function productPageHazard(office,pil,text){
  const plain=stripHtmlText(text);
  const now=new Date();
  const issue=actualProductTimeFromText(plain,now);
  const re=/\/O\.([A-Z]{3})\.K([A-Z0-9]{3})\.([A-Z]{2})\.([WAYS])\.(\d{4})\.(\d{6}T\d{4}Z|000000T0000Z)-(\d{6}T\d{4}Z|000000T0000Z)\//g;
  const active=[];
  let m;
  while((m=re.exec(plain))){
    if(m[2]!==office) continue;
    const action=m[1], end=parseVtecZulu(m[7]);
    if(action==='CAN'||action==='EXP') continue;
    if(end && end.getTime()<=now.getTime()) continue;
    active.push({action,phen:m[3],sig:m[4],etn:m[5],end});
  }
  if(!active.length) return null;
  active.sort((a,b)=>(a.end?.getTime()||Infinity)-(b.end?.getTime()||Infinity));
  const earliest=active[0].end||null;
  const labels={MWW:'Marine Weather Message',CFW:'Coastal Hazard Message',NPW:'Non-Precipitation Weather Message',WSW:'Winter Weather Message',RFW:'Red Flag Warning',TCV:'Tropical Cyclone Watch/Warning',FFA:'Flood Watch'};
  return {
    office,
    product:pil,
    displayProduct:pil==='FFA'?'FAA':pil,
    event:labels[pil]||pil,
    subHazards:[],
    headline:labels[pil]||pil,
    action:active[0].action||'',
    updatedAt:issue?issue.toISOString():now.toISOString(),
    ageHours:issue?Math.max(0,(now-issue)/3600000):0,
    expiresAt:earliest?earliest.toISOString():null,
    endsAt:earliest?earliest.toISOString():null,
    expiresInMinutes:earliest?Math.round((earliest-now)/60000):null,
    areaDesc:'',
    severity:'',
    certainty:'',
    urgency:'',
    vtec:'',
    state:issue?((now-issue)/3600000>=12?'late':(now-issue)/3600000>=8?'warn':'good'):'good',
    sourceUrl:'https://forecast.weather.gov/product.php?site=NWS&issuedby='+office+'&product='+pil+'&format=CI&version=1&glossary=0'
  };
}
function supplementHazardsFromProductPages(board){
  const reqs=[], meta=[];
  for(const office of Object.keys(board.offices||{})){
    for(const pil of ['MWW','CFW','NPW','WSW','RFW','TCV','FFA']){
      reqs.push({url:'https://forecast.weather.gov/product.php?site=NWS&issuedby='+office+'&product='+pil+'&format=TXT&version=1&glossary=0',
        headers:{'User-Agent':'WFO-MOB-Product-Status-Board/4.1','Accept':'text/plain,text/html,*/*'}});
      meta.push({office,pil});
    }
  }
  const resps=runBatch(reqs);
  resps.forEach((r,i)=>{
    if(!r || r.getResponseCode()<200 || r.getResponseCode()>=300) return;
    const {office,pil}=meta[i];
    const h=productPageHazard(office,pil,r.getContentText());
    if(!h) return;
    const arr=board.offices?.[office]?.hazards;
    if(!Array.isArray(arr)) return;
    const same=arr.find(x=>x && x.product===pil);
    if(!same) arr.push(h);
    else if(new Date(h.updatedAt)>new Date(same.updatedAt||0)){
      Object.assign(same,h);
    }
  });
  for(const office of Object.keys(board.offices||{})){
    const arr=board.offices[office].hazards||[];
    arr.sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0));
    if(board.offices[office].hazardMeta){
      board.offices[office].hazardMeta.source='NWS Active Alerts API + actual NWS product-page cross-check';
    }
  }
}
supplementHazardsFromProductPages(dashboard);
write('status.json',dashboard);
for(const office of ['MOB','LIX','TAE','KEY']){
  try{write('rivers-'+office+'.json',context.getRiverData(office,true))}
  catch(e){write('rivers-'+office+'.json',{office,generatedAt:new Date().toISOString(),rivers:[],errors:[String(e&&e.stack||e)]})}
}
write('build-meta.json',{generatedAt:new Date().toISOString(),source:'GitHub Actions',version:1});
console.log('Status data generated:',new Date().toISOString());

// Triggered by source changes; scheduled workflow refreshes data every 5 minutes.
