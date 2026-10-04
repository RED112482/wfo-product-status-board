let DATA=null,mode='mob',backup='LIX',riverCache={};

function jsonp(api,params={}){
  let url;
  if(api==='dashboard') url='data/status.json';
  else if(api==='rivers') url='data/rivers-'+String(params.office||'').toUpperCase()+'.json';
  else return Promise.reject(new Error('Unknown local data request: '+api));
  const sep=url.includes('?')?'&':'?';
  return fetch(url+sep+'t='+Date.now(),{cache:'no-store'})
    .then(r=>{if(!r.ok)throw new Error('Live data file unavailable ('+r.status+')');return r.json()});
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function openUrl(u){if(u)window.open(u,'_blank','noopener')}
function fmt(d){if(!d)return '—';d=new Date(d);return new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(d)}
function fmtZ(d){if(!d)return '—';d=new Date(d);return String(d.getUTCMonth()+1).padStart(2,'0')+'/'+String(d.getUTCDate()).padStart(2,'0')+' '+String(d.getUTCHours()).padStart(2,'0')+String(d.getUTCMinutes()).padStart(2,'0')+'z'}
function age(d){if(!d)return '—';let m=Math.max(0,Math.floor((Date.now()-new Date(d))/60000));if(m<60)return m+'m';let h=Math.floor(m/60);return h<24?h+'h '+m%60+'m':Math.floor(h/24)+'d '+h%24+'h'}
function until(d){if(!d)return 'expiration unavailable';let m=Math.ceil((new Date(d)-Date.now())/60000);if(m<=0)return 'expired';if(m<60)return m+'m until drop-off';let h=Math.floor(m/60),r=m%60;return h+'h '+r+'m until drop-off'}
function productAgeState(d){
  if(!d)return 'na';
  const h=(Date.now()-new Date(d).getTime())/3600000;
  if(!Number.isFinite(h))return 'na';
  if(h>=12)return 'late';
  if(h>=8)return 'warn';
  return 'good';
}
function setMode(m){mode=m;document.getElementById('mobTab').classList.toggle('active',m==='mob');document.getElementById('backupTab').classList.toggle('active',m==='backup');render()}
function setBackup(id){backup=id;render()}
function loadData(force=false){
  document.getElementById('updated').textContent='Refreshing…';
  jsonp('dashboard',{force:force?1:0}).then(d=>{DATA=d;render()}).catch(e=>{document.getElementById('content').innerHTML='<div class="panel loading">'+esc(e.message)+'</div>';document.getElementById('updated').textContent='Refresh failed'});
}
function render(){
  if(!DATA)return;
  document.getElementById('updated').innerHTML='Updated '+fmt(DATA.generatedAt)+'<br>'+age(DATA.generatedAt)+' ago';
  const bt=document.getElementById('backupTabs');
  if(mode==='backup'){
    const ids=DATA.backups||['LIX','TAE','KEY']; bt.classList.remove('hidden');
    bt.innerHTML=ids.map(x=>'<button class="'+(backup===x?'active':'')+'" onclick="setBackup(\''+x+'\')">'+x+'</button>').join('');
  } else bt.classList.add('hidden');
  const id=mode==='mob'?'MOB':backup, o=DATA.offices?.[id];
  document.getElementById('content').innerHTML=o?officeHtml(o):'<div class="panel loading">No office data.</div>';
  loadRivers(id);
  refreshVisibleProductsLive(id);
}
function officeHtml(o){
  const products=(DATA.productOrder||Object.keys(o.products||{})).filter(k=>!['TAF','NWPS'].includes(k)).map(k=>productCard(o.products?.[k],k)).join('');
  const tafs=Object.entries(o.tafs||{}).map(([id,t])=>tafCard(id,t)).join('');
  const rvf=(o.rvf||[]).map(statusCard).join('');
  const radars=(o.radars||[]).map(radarCard).join('');
  const nwr=(o.nwr||[]).map(nwrCard).join('');
  return '<div class="office-head"><div><div class="office-id">WFO '+esc(o.id)+'</div><div class="office-name">'+esc(o.name)+'</div></div></div>'+
    hazardPanel(o)+
    section('Products','Last issuance / update','<div class="grid products">'+products+'</div>')+
    section('TAF Monitor','Cycle-aware status','<div class="grid">'+tafs+'</div>')+
    section('River Forecast Product Status','LMRFC / SERFC RVF guidance','<div class="grid">'+rvf+'</div>')+
    section('Radar Status','NWS radar status / latency','<div class="grid">'+radars+'</div>')+
    section('NOAA Weather Radio','Official NWR status + local PNS cross-check','<div class="grid">'+nwr+'</div>')+
    '<div id="rivers-'+esc(o.id)+'">'+section('Rivers','NWPS current stage + RVF forecast stage','<div class="loading">Loading rivers…</div>')+'</div>';
}
function section(a,b,body){return '<section class="panel"><div class="section-title"><span>'+a+'</span><span class="muted">'+b+'</span></div>'+body+'</section>'}
function productCard(p,key){
  if(!p)return '<div class="card na"><div><div class="name">'+esc(key)+'</div><div class="small">No data</div></div></div>';
  const state=productAgeState(p.issuedAt);
  return '<div class="card product-card '+esc(state)+'" data-product-key="'+esc(key)+'" onclick="openUrl(\''+esc(p.sourceUrl||'')+'\')"><div><div class="name">'+esc(p.label||key)+'</div><div class="small product-age">'+esc(p.issuedAt?age(p.issuedAt)+' old':'No timestamp')+'</div></div><div class="product-issued">'+esc(p.issuedAt?fmtZ(p.issuedAt):'—')+'</div></div>'
}
function parseWmoTime(text){
  const m=String(text||'').match(/\b[A-Z]{4}\d{2}\s+K[A-Z]{3}\s+(\d{2})(\d{2})(\d{2})\b/);
  if(!m)return null;
  const now=new Date(), day=+m[1], hour=+m[2], minute=+m[3], arr=[];
  for(const mo of [-1,0,1]){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+mo,day,hour,minute));if(!isNaN(d))arr.push(d)}
  arr.sort((a,b)=>Math.abs(a-now)-Math.abs(b-now)); return arr[0]||null;
}
async function refreshVisibleProductsLive(office){
  const o=DATA?.offices?.[office];
  if(!o)return;
  const keys=Object.keys(o.products||{}).filter(k=>!['TAF','NWPS','GRIDS'].includes(k));
  await Promise.allSettled(keys.map(async key=>{
    let bestMs=0;
    try{
      const page='https://forecast.weather.gov/product.php?site=NWS&issuedby='+encodeURIComponent(office)+'&product='+encodeURIComponent(key)+'&format=TXT&version=1&glossary=0';
      const pr=await fetch(page,{cache:'no-store'});
      if(pr.ok){const t=parseWmoTime(await pr.text());if(t)bestMs=t.getTime()}
    }catch(e){}
    if(!bestMs){
      try{
        const url='https://api.weather.gov/products/types/'+encodeURIComponent(key)+'/locations/'+encodeURIComponent(office);
        const r=await fetch(url,{cache:'no-store',headers:{'Accept':'application/ld+json, application/json'}});
        if(r.ok){
          const j=await r.json(), arr=j['@graph']||j.products||j.items||[];
          for(const item of (Array.isArray(arr)?arr:[])){
            const raw=item?.issuanceTime||item?.issueTime||item?.generatedAt, ms=raw?Date.parse(raw):NaN;
            if(Number.isFinite(ms)&&ms>bestMs)bestMs=ms;
          }
        }
      }catch(e){}
    }
    if(!bestMs)return;
    const p=o.products[key], current=p?.issuedAt?Date.parse(p.issuedAt):0;
    if(bestMs<=current)return;
    p.issuedAt=new Date(bestMs).toISOString();
    p.state=productAgeState(p.issuedAt);
    updateProductCardLive(key,p);
  }));
}
function updateProductCardLive(key,p){
  const el=document.querySelector('.product-card[data-product-key="'+CSS.escape(String(key))+'"]');
  if(!el)return;
  el.classList.remove('good','warn','late','na');
  el.classList.add(productAgeState(p.issuedAt));
  const a=el.querySelector('.product-age');
  const t=el.querySelector('.product-issued');
  if(a)a.textContent=p.issuedAt?age(p.issuedAt)+' old':'No timestamp';
  if(t)t.textContent=p.issuedAt?fmtZ(p.issuedAt):'—';
}
function currentOffice(){return mode==='mob'?'MOB':backup}

function tafCard(id,t){
  return '<div class="card taf '+esc(t?.state||'na')+'" onclick="openUrl(\''+esc(t?.sourceUrl||'')+'\')"><div class="name">'+esc(id)+'</div><div class="mini">'+esc(t?.status||t?.label||'No data')+'</div><div class="small">'+esc(t?.issuedAt?fmtZ(t.issuedAt):'—')+'</div></div>'
}
function statusCard(r){
  return '<div class="card status '+esc(r?.state||'na')+'" onclick="openUrl(\''+esc(r?.sourceUrl||'')+'\')"><div class="name">'+esc(r?.pil||r?.label||'RVF')+'</div><div class="mini">'+esc(r?.rfc||'')+'</div><div class="small">'+esc(r?.issuedAt?fmtZ(r.issuedAt)+' · '+age(r.issuedAt)+' old':r?.note||'No data')+'</div></div>'
}
function radarCard(r){
  const lag=r?.latencySeconds==null?'Latency unavailable':Math.round(r.latencySeconds)+'s latency';
  return '<div class="card status '+esc(r?.state||'na')+'" onclick="openUrl(\''+esc(r?.liveUrl||r?.sourceUrl||'')+'\')"><div class="name">'+esc(r?.id||'Radar')+'</div><div class="mini">'+esc(r?.status||r?.type||'')+'</div><div class="small">'+esc(lag)+'</div></div>'
}
function nwrCard(r){
  return '<div class="card status '+esc(r?.state||'na')+'" onclick="openUrl(\''+esc(r?.outageUrl||r?.sourceUrl||'')+'\')"><div class="name">'+esc(r?.id||'NWR')+'</div><div class="mini">'+esc((r?.mhz||'')+(r?.mhz?' MHz · ':'')+(r?.status||''))+'</div><div class="small">'+esc(r?.name||r?.source||'')+'</div></div>'
}
function hazardPanel(o){
  const list=o.hazards||[];
  if(o.hazardMeta && o.hazardMeta.ok===false)return section('Long-Fused Hazards','NPW / FAA / MWW / WSW / CFW / RFW / TCV','<div class="loading">Hazard status unavailable.</div>');
  if(!list.length)return section('Long-Fused Hazards','NPW / FAA / MWW / WSW / CFW / RFW / TCV','<div class="clear">● No active long-fused hazards</div>');
  const cards=list.map(h=>{
    const code=h.displayProduct||h.product||'';
    const state=productAgeState(h.updatedAt);
    return '<div class="card hazard '+esc(state)+'" onclick="openUrl(\''+esc(h.sourceUrl||'')+'\')"><div class="hazard-head"><div class="name">'+esc(h.event||h.headline||code)+'</div><span class="pill">'+esc(code+(h.action?' · '+h.action:''))+'</span></div><div class="hazard-time">Expires '+esc(fmtZ(h.expiresAt))+' · '+esc(until(h.expiresAt))+'</div><div class="status-time">Updated '+esc(fmtZ(h.updatedAt))+(h.endsAt?' · Hazard valid until '+esc(fmtZ(h.endsAt)):'')+'</div><div class="small">'+esc(h.areaDesc||'')+'</div></div>';
  }).join('');
  return section('Long-Fused Hazards · '+list.length,'NPW / FAA / MWW / WSW / CFW / RFW / TCV','<div class="hazards">'+cards+'</div>');
}
function loadRivers(id){
  if(riverCache[id]){drawRivers(id,riverCache[id]);return}
  jsonp('rivers',{office:id}).then(d=>{riverCache[id]=d;drawRivers(id,d)}).catch(e=>{const el=document.getElementById('rivers-'+id);if(el)el.innerHTML=section('Rivers','Load failed','<div class="loading">'+esc(e.message)+'</div>')});
}
function drawRivers(id,d){
  const el=document.getElementById('rivers-'+id);if(!el)return;
  const rows=(d?.rivers||[]).map(r=>'<tr class="river-row" onclick="showHydro(\''+esc(r.id)+'\',\''+esc(r.name)+'\',\''+esc(r.hydrographUrl||'')+'\')"><td><span class="warnflag '+(r.floodWarning?.active?'active':r.warningCheck==='missing'?'missing':'')+'"></span><b>'+esc(r.name)+'</b><div class="small">'+esc(r.id)+(r.rfc?' · '+esc(r.rfc):'')+'</div></td><td>'+stage(r.observed,r.unit,r.observedCategory)+'<div class="small">'+esc(r.observedTime?fmtZ(r.observedTime):'—')+'</div></td><td>'+stage(r.forecast,r.unit,r.forecastCategory)+'<div class="small">'+esc(r.forecastTime?fmtZ(r.forecastTime):'Latest RVF')+'</div></td><td>'+thresholds(r.thresholds,r.unit)+'</td><td>'+warningText(r)+'</td></tr>').join('');
  const body=rows?'<div class="river-wrap"><table><thead><tr><th>River / Gauge</th><th>Current Stage</th><th>Forecast Stage</th><th>Flood Categories</th><th>River Flood Warning</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<div class="loading">No river gauges returned.</div>';
  el.innerHTML=section('Rivers · '+(d?.rivers?.length||0),(d?.discoverySource||'RVF / NWPS'),body);
}
function stage(v,u,c){if(v==null||!isFinite(Number(v)))return '<span class="stage cat-na">No data</span>';return '<span class="stage cat-'+esc(c||'na')+'">'+Number(v).toFixed(Math.abs(Number(v))>=100?0:1)+' '+esc(unit(u))+'</span>'}
function unit(u){u=String(u||'ft').toLowerCase();return u.includes('foot')||u.includes('feet')||u==='ft'?'ft':u.replace(/^.*:/,'')}
function thresholds(t,u){if(!t)return '—';let a=[];if(t.action!=null)a.push('A '+t.action);if(t.minor!=null)a.push('Min '+t.minor);if(t.moderate!=null)a.push('Mod '+t.moderate);if(t.major!=null)a.push('Maj '+t.major);return esc(a.join(' · ')+' '+unit(u))}
function warningText(r){const w=r.floodWarning||{};if(r.warningCheck==='missing')return '<b>CHECK WARNING</b><div class="small">At/above Minor with no active warning</div>';if(w.active)return '<b>ACTIVE · '+esc([w.productType,w.action].filter(Boolean).join(' '))+'</b><div class="small">Updated '+esc(fmtZ(w.lastUpdated))+' · Ends '+esc(fmtZ(w.expiresAt))+'</div>';return '<span class="muted">No active warning</span>'}
function showHydro(id,name,url){const m=document.getElementById('modal'),img=document.getElementById('modalImg');document.getElementById('modalTitle').textContent=name||id;document.getElementById('modalSub').textContent=id+' · NOAA/NWPS latest forecast';img.src=(url||('https://water.noaa.gov/resources/hydrographs/'+String(id).toLowerCase()+'_hg.png'))+'?t='+Date.now();document.getElementById('modalNote').textContent='Click outside or × to close.';m.classList.add('show')}
function closeModal(){document.getElementById('modal').classList.remove('show');document.getElementById('modalImg').src=''}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
loadData(false);
setInterval(()=>loadData(false),Number(window.STATUS_BOARD_CONFIG?.REFRESH_MS)||120000);
setInterval(()=>refreshVisibleProductsLive(currentOffice()),60000);
