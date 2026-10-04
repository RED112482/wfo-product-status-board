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
write('status.json',dashboard);
for(const office of ['MOB','LIX','TAE','KEY']){
  try{write('rivers-'+office+'.json',context.getRiverData(office,true))}
  catch(e){write('rivers-'+office+'.json',{office,generatedAt:new Date().toISOString(),rivers:[],errors:[String(e&&e.stack||e)]})}
}
write('build-meta.json',{generatedAt:new Date().toISOString(),source:'GitHub Actions',version:1});
console.log('Status data generated:',new Date().toISOString());
