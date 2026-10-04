/**
 * WFO Product Status Board – MOB + backup offices
 * Google Apps Script backend
 *
 * Official NOAA/NWS sources used:
 *  - api.weather.gov       : NWS text products + forecast grid metadata
 *  - aviationweather.gov   : NWS Aviation Weather Center TAF API
 *  - api.water.noaa.gov    : National Water Prediction Service gauges/stage-flow
 *  - api.weather.gov/radar : authoritative NWS radar station RDA/latency status
 *  - weather.gov/nwr       : national NWR outage/degraded transmitter status
 *
 * Notes:
 *  - River "Forecast" is the highest official forecast stage returned by NWPS
 *    for the current forecast series. The individual gauge page is linked.
 *  - Radar cards use api.weather.gov/radar/stations/{id}; FTM is link-only.
 *  - NWR status is based on the official national outage/degraded list.
 */

const APP = {
  TITLE: 'WFO Product Status Board',
  CACHE_SECONDS: 120,
  PRODUCT_AGE_WARN_HOURS: 8,
  PRODUCT_AGE_LATE_HOURS: 12,
  // Long-fused hazard card color is based on time remaining before the
  // current alert/product expires (CAP/UGC purge time), not issuance age.
  HAZARD_EXPIRY_WARN_MINUTES: 90,
  HAZARD_EXPIRY_LATE_MINUTES: 30,
  NWR_PNS_MAX_PRODUCTS: 140,
  NWR_PNS_MAX_AGE_DAYS: 240,
  USER_AGENT: 'WFO-MOB-Product-Status-Board/3.0 (contact: replace-with-your-email@noaa.gov)',
  GRID_STATUS_URL: 'https://forecast.weather.gov/gfestatus.php?site=ALL',
  NWPS_API: 'https://api.water.noaa.gov/nwps/v1',
  MAX_RIVERS_PER_OFFICE: 120,
  LONG_FUSED_PILS: ['NPW','FFA','MWW','WSW','CFW','RFW','TCV'],
  NWPS_GAUGE_REPORT_URL: 'https://water.noaa.gov/resources/downloads/reports/nwps_all_gauges_report.csv',

  OFFICES: {
    MOB: {
      name: 'Mobile, AL',
      point: [30.6914, -88.2428],
      tafs: ['KMOB', 'KBFM', 'KPNS', 'KJKA'],
      rvf: [
        { pil: 'RVFMOB', location: 'MOB', rfc: 'SERFC' }
      ],
      radars: [
        { id: 'KMOB', ftm: 'MOB', type: 'WSR-88D' },
        { id: 'KEVX', ftm: 'EVX', type: 'WSR-88D' }
      ],
      nwr: [
        { id:'KIH59', name:'Dozier, AL', mhz:'162.550' },
        { id:'KEC61', name:'Mobile, AL', mhz:'162.550' },
        { id:'KEC86', name:'Pensacola, FL', mhz:'162.400' },
        { id:'WWF55', name:'Jackson, AL', mhz:'162.500' },
        { id:'WNG607', name:'Greenville, AL', mhz:'162.425' },
        { id:'WNG646', name:'Brewton, AL', mhz:'162.475' },
        { id:'WNG640', name:'Leakesville, MS', mhz:'162.425' }
      ]
    },
    LIX: {
      name: 'New Orleans/Baton Rouge, LA',
      point: [30.3367, -89.8254],
      tafs: ['KBTR', 'KMSY', 'KMCB', 'KGPT', 'KHUM', 'KASD', 'KNEW', 'KHDC'],
      rvf: [
        { pil: 'RVFLIX', location: 'LIX', rfc: 'LMRFC' },
        { pil: 'RVFLOM', location: 'LOM', rfc: 'LMRFC', note: 'Lower Mississippi operational mainstem' }
      ],
      radars: [
        { id: 'KHDC', ftm: 'HDC', type: 'WSR-88D' },
        { id: 'KTMSY', ftm: 'MSY', type: 'TDWR', spg: true, displayNote: 'MSY TDWR' },
        { id: 'KDGX', ftm: 'DGX', type: 'WSR-88D' }
      ],
      nwr: [
        { id:'KHB46', name:'Baton Rouge, LA', mhz:'162.400' },
        { id:'KHB43', name:'New Orleans, LA', mhz:'162.550' },
        { id:'KIH23', name:'Morgan City, LA', mhz:'162.475' },
        { id:'WNG521', name:'Bogalusa, LA', mhz:'162.525' },
        { id:'WXL41', name:'Buras, LA', mhz:'162.475' },
        { id:'KIH21', name:'Gulfport, MS', mhz:'162.400' }
      ]
    },
    TAE: {
      name: 'Tallahassee, FL',
      point: [30.3965, -84.3289],
      tafs: ['KTLH', 'KECP', 'KDHN', 'KVLD', 'KABY'],
      rvf: [
        { pil: 'RVFTAE', location: 'TAE', rfc: 'SERFC' }
      ],
      radars: [
        { id: 'KEOX', ftm: 'EOX', type: 'WSR-88D' },
        { id: 'KVAX', ftm: 'VAX', type: 'WSR-88D' },
        { id: 'KTLH', ftm: 'TLH', type: 'WSR-88D' }
      ],
      nwr: [
        { id:'KIH24', name:'Tallahassee, FL', mhz:'162.400' },
        { id:'WWF88', name:'Salem, FL', mhz:'162.425' },
        { id:'WWF86', name:'Eastpoint, FL', mhz:'162.500' },
        { id:'KGG67', name:'Panama City, FL', mhz:'162.550' },
        { id:'WWH20', name:'Bethlehem, FL', mhz:'162.450' },
        { id:'WXK53', name:'Pelham, GA', mhz:'162.550' },
        { id:'WWH31', name:'Hahira, GA', mhz:'162.500' },
        { id:'KZZ70', name:'Blakely, GA', mhz:'162.525' },
        { id:'KWN50', name:'Ashburn, GA', mhz:'162.450' },
        { id:'WNG63', name:'Sneads, FL', mhz:'162.425' }
      ]
    },
    KEY: {
      name: 'Key West, FL',
      point: [24.5600, -81.7870],
      tafs: ['KEYW', 'KMTH'],
      rvf: [
        { pil: 'RVFKEY', location: 'KEY', rfc: 'SERFC' }
      ],
      radars: [
        { id: 'KAMX', ftm: 'AMX', type: 'WSR-88D' },
        { id: 'KBYX', ftm: 'BYX', type: 'WSR-88D' },
        { id: 'TMIA', ftm: 'MIA', type: 'TDWR', spg: true }
      ],
      nwr: [
        { id:'WXJ95', name:'Key West, FL', mhz:'162.400' },
        { id:'WWG60', name:'Marathon / Middle-Upper Keys, FL', mhz:'162.450' }
      ]
    }
  },

  PRODUCTS: [
    { key: 'GRIDS', label: 'GRIDS', kind: 'grid', warnHours: 6, lateHours: 10 },
    { key: 'ZFP',   label: 'ZFP',   kind: 'text', type: 'ZFP', warnHours: 8, lateHours: 14 },
    { key: 'SFT',   label: 'SFT',   kind: 'text', type: 'SFT', warnHours: 8, lateHours: 14 },
    { key: 'FWF',   label: 'FWF',   kind: 'text', type: 'FWF', warnHours: 18, lateHours: 26 },
    { key: 'PFM',   label: 'PFM',   kind: 'text', type: 'PFM', warnHours: 8, lateHours: 14 },
    { key: 'AFD',   label: 'AFD',   kind: 'text', type: 'AFD', warnHours: 8, lateHours: 14 },
    { key: 'CWF',   label: 'CWF',   kind: 'text', type: 'CWF', warnHours: 8, lateHours: 14 },
    { key: 'SRF',   label: 'SRF',   kind: 'text', type: 'SRF', warnHours: 12, lateHours: 25 },
    { key: 'TAF',   label: 'TAF',   kind: 'taf', warnHours: 7, lateHours: 10, show: false },
    { key: 'NWPS',  label: 'NWPS',  kind: 'nwps', warnHours: 2, lateHours: 6, show: false }
  ]
};

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP.TITLE)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getDashboardData(forceRefresh) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'product-status-v15';
  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  const now = new Date();
  const offices = {};
  Object.keys(APP.OFFICES).forEach(id => {
    offices[id] = {
      id,
      name: APP.OFFICES[id].name,
      products: {},
      hazards: [],
      hazardMeta: { ok: false, source: 'NWS Active Alerts API' },
      tafs: {},
      rvf: [],
      radars: [],
      nwr: [],
      rivers: [],
      riverSourceUrl: `https://water.noaa.gov/wfo/${id}/fcst`
    };
  });

  const nwsHeaders = { 'User-Agent': APP.USER_AGENT, 'Accept': 'application/geo+json, application/json' };
  const jsonHeaders = { 'User-Agent': APP.USER_AGENT, 'Accept': 'application/json' };

  // ---------------------------------------------------------------------------
  // Batch 1: routine products, grid point metadata, TAFs, NWPS health,
  //          RVF products and authoritative radar station status.
  // ---------------------------------------------------------------------------
  const requests = [];
  const meta = [];

  Object.keys(APP.OFFICES).forEach(office => {
    APP.PRODUCTS.filter(p => p.kind === 'text').forEach(p => {
      requests.push(req_(`https://api.weather.gov/products/types/${p.type}/locations/${office}/latest`, nwsHeaders));
      meta.push({ kind: 'text', office, product: p });
    });

    const point = APP.OFFICES[office].point;
    requests.push(req_(`https://api.weather.gov/points/${point[0]},${point[1]}`, nwsHeaders));
    meta.push({ kind: 'point', office });

    requests.push(req_(`https://aviationweather.gov/api/data/taf?ids=${APP.OFFICES[office].tafs.join(',')}&format=json`, jsonHeaders));
    meta.push({ kind: 'taf', office });

    APP.OFFICES[office].rvf.forEach(r => {
      requests.push(req_(`https://api.weather.gov/products/types/RVF/locations/${r.location}/latest`, nwsHeaders));
      meta.push({ kind: 'rvf', office, config: r });
    });

    APP.OFFICES[office].radars.forEach(r => {
      requests.push(req_(`https://api.weather.gov/radar/stations/${encodeURIComponent(r.id)}`, nwsHeaders));
      meta.push({ kind: 'radar', office, config: r });
    });
  });

  requests.push(req_(`${APP.NWPS_API}/monitor`, jsonHeaders));
  meta.push({ kind: 'nwps' });

  // National active-alert feed; filter by AWIPS identifier (e.g. NPWMOB,
  // FFALIX, MWWTAE) so each WFO gets only hazards it issued.
  requests.push(req_('https://api.weather.gov/alerts/active?status=actual', nwsHeaders));
  meta.push({ kind: 'hazards' });

  const responses = fetchAllChunked_(requests, 45);
  const gridUrls = {};
  let nwpsTime = null;
  let nwpsOk = false;

  responses.forEach((resp, i) => {
    const m = meta[i];
    const code = resp.getResponseCode();
    const json = safeJson_(resp);

    if (m.kind === 'text') {
      const p = m.product;
      if (ok_(code) && json) {
        const issued = parseDate_(json.issuanceTime || json.issueTime || json.generatedAt);
        offices[m.office].products[p.key] = issued
          ? makeStatus_(p, issued, now, {
              source: 'NWS Text Product API',
              sourceUrl: `https://forecast.weather.gov/product.php?site=NWS&issuedby=${m.office}&product=${p.type}&format=CI&version=1&glossary=0`,
              productId: json.id || null
            })
          : makeUnavailable_(p, 'No issuance timestamp returned', null);
      } else {
        offices[m.office].products[p.key] = makeUnavailable_(p, `NWS API ${code}`,
          `https://forecast.weather.gov/product.php?site=NWS&issuedby=${m.office}&product=${p.type}`);
      }
    }

    if (m.kind === 'point' && ok_(code) && json && json.properties) {
      gridUrls[m.office] = json.properties.forecastGridData || null;
    }

    if (m.kind === 'taf') {
      processTafs_(offices[m.office], m.office, json, code, now);
    }

    if (m.kind === 'nwps') {
      nwpsOk = ok_(code);
      if (nwpsOk && json) nwpsTime = findBestTimestamp_(json);
    }

    if (m.kind === 'hazards') {
      if (ok_(code) && json) {
        const byOffice = parseLongFusedHazards_(json, now);
        Object.keys(APP.OFFICES).forEach(office => {
          offices[office].hazards = byOffice[office] || [];
          offices[office].hazardMeta = {
            ok: true,
            source: 'NWS Active Alerts API',
            checkedAt: now.toISOString()
          };
        });
      } else {
        Object.keys(APP.OFFICES).forEach(office => {
          offices[office].hazardMeta = {
            ok: false,
            source: 'NWS Active Alerts API',
            error: `NWS alerts API ${code}`
          };
        });
      }
    }

    if (m.kind === 'rvf') {
      offices[m.office].rvf.push(makeRvfStatus_(m.config, json, code, now));
    }

    if (m.kind === 'radar') {
      offices[m.office].radars.push(makeRadarApiStatus_(m.config, json, code, now));
    }
  });

  // Supplemental state-scoped active-alert feeds. The national active feed can
  // occasionally omit/lag individual coastal products. Pulling the five states
  // covered by MOB/LIX/TAE/KEY and re-filtering by AWIPS identifier provides a
  // second path for long-fused hazards such as CFW (including Coastal Flood
  // Advisories/Warnings and Rip Current Statements).
  try { supplementLongFusedHazardsByState_(offices, now, nwsHeaders); } catch (e) {}

  // ---------------------------------------------------------------------------
  // Batch 2: forecast grid update timestamps.
  // GRIDS card links to the requested all-sites GFE status checker.
  // ---------------------------------------------------------------------------
  const gridRequests = [];
  const gridOffices = [];
  Object.keys(gridUrls).forEach(office => {
    if (!gridUrls[office]) return;
    gridRequests.push(req_(gridUrls[office], nwsHeaders));
    gridOffices.push(office);
  });

  if (gridRequests.length) {
    const gridResponses = fetchAllChunked_(gridRequests, 30);
    gridResponses.forEach((resp, idx) => {
      const office = gridOffices[idx];
      const p = product_('GRIDS');
      const json = safeJson_(resp);
      const props = json && json.properties ? json.properties : {};
      const t = parseDate_(props.updateTime || props.updated || props.generatedAt);
      offices[office].products.GRIDS = t
        ? makeStatus_(p, t, now, {
            source: 'NWS Forecast Grid API',
            sourceUrl: APP.GRID_STATUS_URL,
            note: 'Click for the NWS GFE all-sites status checker'
          })
        : makeUnavailable_(p, `Grid metadata unavailable (${resp.getResponseCode()})`, APP.GRID_STATUS_URL);
    });
  }

  Object.keys(APP.OFFICES).forEach(office => {
    if (!offices[office].products.GRIDS) {
      offices[office].products.GRIDS = makeUnavailable_(product_('GRIDS'), 'Grid endpoint unavailable', APP.GRID_STATUS_URL);
    }
  });

  // NWPS national health/freshness card.
  Object.keys(APP.OFFICES).forEach(office => {
    const p = product_('NWPS');
    offices[office].products.NWPS = (nwpsOk && nwpsTime)
      ? makeStatus_(p, nwpsTime, now, {
          source: 'NWPS national monitor',
          sourceUrl: 'https://water.noaa.gov/',
          note: 'National NWPS feed freshness'
        })
      : makeUnavailable_(p, nwpsOk ? 'NWPS monitor returned no timestamp' : 'NWPS monitor unavailable', 'https://water.noaa.gov/');
  });

  // River data is loaded separately with getRiverData(office) so a slow NWPS
  // response can never block the main status board from rendering.

  // Fill any product that did not populate.
  Object.keys(APP.OFFICES).forEach(office => {
    APP.PRODUCTS.forEach(p => {
      if (!offices[office].products[p.key]) {
        offices[office].products[p.key] = makeUnavailable_(p, 'No current product returned', null);
      }
    });
  });

  // Official NWR transmitter outage/degraded list.  A station is marked
  // NORMAL only when the national status page was successfully retrieved and
  // the transmitter is not present in its outage/degraded table.
  const nwrByOffice = getNwrStatuses_();
  Object.keys(APP.OFFICES).forEach(office => {
    offices[office].nwr = nwrByOffice[office] || [];
  });

  const out = {
    generatedAt: now.toISOString(),
    title: APP.TITLE,
    primary: 'MOB',
    backups: ['LIX', 'TAE', 'KEY'],
    productOrder: APP.PRODUCTS.filter(p => p.show !== false).map(p => p.key),
    gridStatusUrl: APP.GRID_STATUS_URL,
    offices
  };

  try { cache.put(cacheKey, JSON.stringify(out), APP.CACHE_SECONDS); } catch (e) {}
  return out;
}


/**
 * Filter the national active-alert feed to long-fused WFO hazards only.
 * Short-fused TOR/SVR/FFW/SMW/SQW/DSW hazards are intentionally excluded.
 */
function parseLongFusedHazards_(root, now) {
  const byOffice = {};
  Object.keys(APP.OFFICES).forEach(o => byOffice[o] = []);

  const features = root && Array.isArray(root.features) ? root.features : [];
  const grouped = {};

  features.forEach(feature => {
    const p = feature && feature.properties ? feature.properties : {};
    const params = p.parameters || {};
    const awips = arr_(params.AWIPSidentifier || params.AWIPSIdentifier || params.awipsidentifier);
    if (!awips.length) return;

    const event = String(p.event || '').trim();
    const headline = String(p.headline || '').trim();

    if (/Tornado Warning|Severe Thunderstorm Warning|Flash Flood Warning|Special Marine Warning|Snow Squall Warning|Dust Storm Warning/i.test(event)) return;

    awips.forEach(raw => {
      const ident = String(raw || '').trim().toUpperCase();
      const m = ident.match(/^([A-Z]{3})([A-Z0-9]{3})$/);
      if (!m) return;
      const pil = m[1], office = m[2];
      if (!APP.OFFICES[office]) return;
      if (APP.LONG_FUSED_PILS.indexOf(pil) < 0) return;


      const vtecList = arr_(params.VTEC || params.vtec);
      const vtec = vtecList.length ? String(vtecList[0]) : '';
      const vi = parseVtec_(vtec);
      const updated = parseDate_(p.sent || p.effective || p.onset);
      // Keep the two clocks separate:
      //   expires = CAP/UGC product expiration (when this alert instance drops off)
      //   validUntil = VTEC hazard end time (how long the hazard itself remains in effect)
      // They can differ substantially for CON/EXT products.
      const expires = parseDate_(p.expires || p.ends);
      const validUntil = vi.endAt ? parseDate_(vi.endAt) : parseDate_(p.ends || p.expires);
      const ageHours = updated ? Math.max(0, (now - updated) / 3600000) : null;
      const expiresInMinutes = expires ? Math.round((expires.getTime() - now.getTime()) / 60000) : null;

      const track = vi.track || `${event}|${headline}`;
      // CFW is a single Coastal Hazard Message product family.  Collapse all
      // active CFW components (Rip Current Statement, Coastal Flood Advisory/
      // Watch/Warning, etc.) into one office-level card instead of one card
      // per VTEC segment.
      const key = pil === 'CFW' ? `${office}|CFW` : `${office}|${pil}|${track}`;
      const area = String(p.areaDesc || '').trim();
      const sourceUrl = `https://forecast.weather.gov/product.php?site=NWS&issuedby=${office}&product=${pil}&format=CI&version=1&glossary=0`;

      const h = {
        office,
        product: pil,
        displayProduct: hazardDisplayCode_(pil),
        event: pil === 'CFW' ? 'Coastal Hazard Message' : (event || hazardEventFromPil_(pil)),
        subHazards: pil === 'CFW' && event ? [event] : [],
        headline: headline || event || pil,
        action: vi.action || '',
        updatedAt: updated ? updated.toISOString() : null,
        ageHours,
        // expiresAt is the product/alert drop-off time; validUntilAt is the VTEC hazard end.
        expiresAt: expires ? expires.toISOString() : null,
        endsAt: validUntil ? validUntil.toISOString() : null,
        expiresInMinutes,
        areaDesc: area,
        severity: String(p.severity || ''),
        certainty: String(p.certainty || ''),
        urgency: String(p.urgency || ''),
        vtec,
        // Hazard card color follows the same issuance-age thresholds as the main Products section.
        state: ageState_(ageHours),
        sourceUrl
      };

      const old = grouped[key];
      if (!old) {
        grouped[key] = h;
      } else {
        const oldT = old.updatedAt ? new Date(old.updatedAt).getTime() : 0;
        const newT = h.updatedAt ? new Date(h.updatedAt).getTime() : 0;
        if (pil === 'CFW') {
          // Preserve one CFW card while retaining the individual hazards it contains.
          const mergedSubs = Array.from(new Set([].concat(old.subHazards || [], h.subHazards || []).filter(Boolean)));
          const mergedAreas = uniqueAreas_([old.areaDesc, h.areaDesc]);
          // Use the newest alert instance for update/action/source metadata.  For
          // drop-off coloring, use the earliest known CAP expiration among the
          // still-active CFW components so the card turns orange/red as soon as
          // any part of the Coastal Hazard Message is nearing drop-off.
          const expTimes = [old.expiresAt, h.expiresAt].filter(Boolean).map(x => new Date(x).getTime()).filter(Number.isFinite);
          const earliestExp = expTimes.length ? new Date(Math.min.apply(null, expTimes)) : null;
          const endTimes = [old.endsAt, h.endsAt].filter(Boolean).map(x => new Date(x).getTime()).filter(Number.isFinite);
          const latestEnd = endTimes.length ? new Date(Math.max.apply(null, endTimes)) : null;
          const base = newT >= oldT ? Object.assign({}, h) : Object.assign({}, old);
          base.event = 'Coastal Hazard Message';
          base.displayProduct = 'CFW';
          base.subHazards = mergedSubs;
          base.areaDesc = mergedAreas;
          base.expiresAt = earliestExp ? earliestExp.toISOString() : (base.expiresAt || null);
          base.endsAt = latestEnd ? latestEnd.toISOString() : (base.endsAt || null);
          base.expiresInMinutes = earliestExp ? Math.round((earliestExp.getTime() - now.getTime()) / 60000) : null;
          base.state = hazardExpiryState_(earliestExp, now);
          grouped[key] = base;
        } else if (newT >= oldT) {
          grouped[key] = Object.assign({}, h, { areaDesc: uniqueAreas_([old.areaDesc, h.areaDesc]) });
        } else {
          old.areaDesc = uniqueAreas_([old.areaDesc, h.areaDesc]);
        }
      }
    });
  });

  Object.keys(grouped).forEach(k => {
    const h = grouped[k];
    byOffice[h.office].push(h);
  });

  Object.keys(byOffice).forEach(office => {
    byOffice[office].sort((a, b) =>
      hazardRank_(b.state) - hazardRank_(a.state) ||
      (new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)) ||
      String(a.event).localeCompare(String(b.event))
    );
  });
  return byOffice;
}

function supplementLongFusedHazardsByState_(offices, now, headers) {
  const states = ['AL','FL','MS','LA','GA'];
  const reqs = states.map(st => req_(`https://api.weather.gov/alerts/active?status=actual&area=${st}`, headers));
  const responses = fetchAllChunked_(reqs, 10);
  const combined = { type: 'FeatureCollection', features: [] };
  let anyOk = false;
  responses.forEach(resp => {
    if (!resp || !ok_(resp.getResponseCode())) return;
    const j = safeJson_(resp);
    if (!j || !Array.isArray(j.features)) return;
    anyOk = true;
    Array.prototype.push.apply(combined.features, j.features);
  });
  if (!anyOk || !combined.features.length) return;

  const extra = parseLongFusedHazards_(combined, now);
  Object.keys(APP.OFFICES).forEach(office => {
    const merged = {};
    const add = h => {
      if (!h) return;
      const key = h.product === 'CFW' ? 'CFW' : [h.product || '', h.vtec || '', h.event || '', h.expiresAt || '', h.areaDesc || ''].join('|');
      const old = merged[key];
      if (!old || new Date(h.updatedAt || 0) > new Date(old.updatedAt || 0)) merged[key] = h;
    };
    (offices[office].hazards || []).forEach(add);
    (extra[office] || []).forEach(add);
    offices[office].hazards = Object.keys(merged).map(k => merged[k]).sort((a,b) =>
      hazardRank_(b.state) - hazardRank_(a.state) ||
      (new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)) ||
      String(a.event || '').localeCompare(String(b.event || ''))
    );
    if (offices[office].hazardMeta && offices[office].hazardMeta.ok) {
      offices[office].hazardMeta.source = 'NWS Active Alerts API (national + state cross-check)';
    }
  });
}

function arr_(v) {
  if (Array.isArray(v)) return v;
  return v == null ? [] : [v];
}

function parseVtec_(vtec) {
  // Example: /O.CON.KMOB.CF.W.0002.261004T1200Z-261005T1800Z/
  const raw = String(vtec || '');
  const m = raw.match(/\/[OTEX]\.([A-Z]{3})\.K?[A-Z0-9]{3}\.([A-Z]{2})\.([WAYS])\.(\d{4})\./i);
  if (!m) return { action: '', phenomenon: '', significance: '', track: '', endAt: null };
  const endMatch = raw.match(/-(\d{6}T\d{4}Z|000000T0000Z)\//i);
  return {
    action: m[1].toUpperCase(),
    phenomenon: m[2].toUpperCase(),
    significance: m[3].toUpperCase(),
    track: `${m[2].toUpperCase()}.${m[3].toUpperCase()}.${m[4]}`,
    endAt: endMatch ? parseVtecTimestamp_(endMatch[1]) : null
  };
}

function parseVtecTimestamp_(value) {
  const s = String(value || '').toUpperCase();
  if (!s || s === '000000T0000Z') return null;
  const m = s.match(/^(\d{2})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const yy = Number(m[1]), year = yy >= 70 ? 1900 + yy : 2000 + yy;
  const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function hazardExpiryState_(expires, now) {
  if (!(expires instanceof Date) || isNaN(expires.getTime())) return 'na';
  const mins = (expires.getTime() - now.getTime()) / 60000;
  // Red = about to drop off / already expired; orange = nearing expiration; green = comfortably current.
  if (mins <= APP.HAZARD_EXPIRY_LATE_MINUTES) return 'late';
  if (mins <= APP.HAZARD_EXPIRY_WARN_MINUTES) return 'warn';
  return 'good';
}

function hazardState_(event, sig) {
  const e = String(event || '').toLowerCase();
  const s = String(sig || '').toUpperCase();
  if (s === 'W' || /\bwarning\b/.test(e)) return 'warning';
  if (s === 'A' || /\bwatch\b/.test(e)) return 'watch';
  if (s === 'Y' || /\badvisory\b/.test(e)) return 'advisory';
  return 'other';
}

function hazardRank_(state) {
  // Sort oldest/stalest first within the hazard panel.
  return state === 'late' ? 4 : state === 'warn' ? 3 : state === 'good' ? 2 : 1;
}


function hazardDisplayCode_(pil) {
  // Dashboard display codes.  The Flood Watch family is shown as FAA per the
  // operational status-board convention requested by the office, while the
  // NWS API lookup continues to use its FFA AWIPS product identifier.
  return pil === 'FFA' ? 'FAA' : pil;
}

function hazardEventFromPil_(pil) {
  return ({
    NPW: 'Non-Precipitation Hazard',
    FFA: 'Flood Watch',
    MWW: 'Marine Hazard',
    WSW: 'Winter Weather Hazard',
    CFW: 'Coastal Hazard Message',
    RFW: 'Fire Weather Hazard',
    TCV: 'Tropical Cyclone Hazard'
  })[pil] || pil;
}

function uniqueAreas_(areas) {
  const out = [];
  areas.forEach(s => String(s || '').split(';').forEach(part => {
    const v = part.trim();
    if (v && out.indexOf(v) < 0) out.push(v);
  }));
  return out.join('; ');
}

/**
 * Loads rivers for one office independently from the main board.
 * This intentionally runs on demand so NWPS latency cannot leave the whole
 * dashboard stuck on "Loading live NWS product status…".
 */
function getRiverData(office, forceRefresh) {
  office = String(office || '').toUpperCase();
  if (!APP.OFFICES[office]) throw new Error('Unknown WFO: ' + office);

  const cache = CacheService.getScriptCache();
  const cacheKey = 'river-status-rvf-nwps-warnings-v3-' + office;
  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  const now = new Date();
  const headers = { 'User-Agent': APP.USER_AGENT, 'Accept': 'application/geo+json, application/json' };
  const jsonHeaders = { 'User-Agent': APP.USER_AGENT, 'Accept': 'application/json' };
  const configs = APP.OFFICES[office].rvf || [];
  const riversById = {};
  let checked = 0;
  const sourceNames = [];
  const errors = [];

  // 1) Discover forecast points and the latest forecast values from RVF history.
  configs.forEach(cfg => {
    const historyUrl = `https://api.weather.gov/products/types/RVF/locations/${encodeURIComponent(cfg.location)}`;
    let historyResp;
    try {
      historyResp = UrlFetchApp.fetch(historyUrl, {
        method: 'get', headers, muteHttpExceptions: true, followRedirects: true
      });
    } catch (e) {
      errors.push(`${cfg.pil}: history fetch failed`);
      return;
    }

    if (!ok_(historyResp.getResponseCode())) {
      errors.push(`${cfg.pil}: history HTTP ${historyResp.getResponseCode()}`);
      return;
    }

    const historyJson = safeJson_(historyResp);
    let refs = extractRvfProductRefs_(historyJson).slice(0, 45);
    if (!refs.length) {
      errors.push(`${cfg.pil}: no RVF history returned`);
      return;
    }

    checked += refs.length;
    sourceNames.push(cfg.pil);
    const reqs = refs.map(r => req_(r.url, headers));
    const resps = fetchAllChunked_(reqs, 25);

    resps.forEach((resp, idx) => {
      if (!resp || !ok_(resp.getResponseCode())) return;
      const json = safeJson_(resp);
      if (!json) return;
      const text = String(json.productText || json.text || json.body || '');
      if (!text) return;
      const issued = parseDate_(json.issuanceTime || json.issueTime || refs[idx].issuedAt) || now;
      const parsed = parseRvfRiverProduct_(text, issued, cfg, refs[idx].id);
      parsed.forEach(r => {
        const key = r.id || r.name;
        if (!key) return;
        const existing = riversById[key];
        if (!existing || new Date(r.productIssuedAt) > new Date(existing.productIssuedAt)) {
          riversById[key] = r;
        }
      });
    });
  });

  const rivers = Object.keys(riversById).map(k => riversById[k]);

  // 2) Replace the RVF observation with the newest official NWPS observation.
  if (rivers.length) {
    const obsReqs = rivers.map(r => req_(
      `${APP.NWPS_API}/gauges/${encodeURIComponent(r.id.toLowerCase())}/stageflow`,
      jsonHeaders
    ));
    const obsResps = fetchAllChunked_(obsReqs, 25);
    obsResps.forEach((resp, idx) => {
      const r = rivers[idx];
      if (!resp || !ok_(resp.getResponseCode())) {
        r.observationSource = 'RVF fallback';
        return;
      }
      const j = safeJson_(resp);
      if (!j) {
        r.observationSource = 'RVF fallback';
        return;
      }
      const series = extractStageSeries_(j);
      const latest = latestPoint_(series.observed);
      if (latest && latest.value != null && latest.time) {
        r.observed = latest.value;
        r.observedTime = latest.time.toISOString();
        r.observedCategory = categoryFor_(latest.value, r.thresholds || {});
        r.unit = latest.unit || r.unit || 'ft';
        r.observationSource = 'NWPS API';
        r.nwpsUrl = `https://water.noaa.gov/gauges/${String(r.id).toLowerCase()}`;
      } else {
        r.observationSource = 'RVF fallback';
      }
    });
  }

  // 3) Search recent FLW + FLS history for active river Flood Warnings.
  let warningProducts = [];
  try {
    warningProducts = fetchRecentRiverWarningProducts_(office, headers, now);
  } catch (e) {
    errors.push('Flood warning history: ' + (e && e.message ? e.message : e));
  }

  rivers.forEach(r => {
    r.hydrographUrl = `https://water.noaa.gov/resources/hydrographs/${String(r.id).toLowerCase()}_hg.png`;
    r.floodWarning = findRiverWarningStatus_(r, warningProducts, now);
    const atOrAboveMinor = severityRank_(r.observedCategory) >= severityRank_('minor');
    if (atOrAboveMinor && r.floodWarning && r.floodWarning.active) {
      r.warningCheck = 'covered';
    } else if (atOrAboveMinor && (!r.floodWarning || !r.floodWarning.active)) {
      r.warningCheck = 'missing';
    } else if (r.floodWarning && r.floodWarning.active) {
      r.warningCheck = 'active-below-minor';
    } else {
      r.warningCheck = 'none';
    }
  });

  rivers.sort((a, b) =>
    (warningCheckRank_(b.warningCheck) - warningCheckRank_(a.warningCheck)) ||
    (severityRank_(b.forecastCategory) - severityRank_(a.forecastCategory)) ||
    (severityRank_(b.observedCategory) - severityRank_(a.observedCategory)) ||
    String(a.name).localeCompare(String(b.name))
  );

  const out = {
    office,
    generatedAt: now.toISOString(),
    rivers,
    totalFound: rivers.length,
    displayed: rivers.length,
    truncated: false,
    discoverySource: sourceNames.length ? `RVF history: ${sourceNames.join(' + ')}` : 'RVF history',
    historyProductsChecked: checked,
    warningProductsChecked: warningProducts.length,
    errors
  };
  try { cache.put(cacheKey, JSON.stringify(out), 180); } catch (e) {}
  return out;
}

function extractRvfProductRefs_(root) {
  const arr = root && (root['@graph'] || root.products || root.items || root.features);
  if (!Array.isArray(arr)) return [];
  const out = [];
  arr.forEach(item => {
    if (!item || typeof item !== 'object') return;
    let id = item.id || item.identifier || '';
    let url = item['@id'] || item.url || '';
    if (!id && url) {
      const m = String(url).match(/\/products\/([^/?#]+)/i);
      if (m) id = m[1];
    }
    if (!url && id) url = `https://api.weather.gov/products/${encodeURIComponent(id)}`;
    if (!url) return;
    out.push({ id: String(id || ''), url: String(url), issuedAt: item.issuanceTime || item.issueTime || item.generatedAt || null });
  });
  out.sort((a, b) => {
    const ta = parseDate_(a.issuedAt), tb = parseDate_(b.issuedAt);
    return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
  });
  return out;
}

function parseRvfRiverProduct_(text, issued, cfg, productId) {
  const out = [];
  const groupMatch = text.match(/^\s*:\s*FORECAST GROUP IS\s+([^\r\n]+)/im);
  const forecastGroup = groupMatch ? groupMatch[1].trim() : '';
  const chunks = String(text).split(/\r?\n(?=\s*:\*{8,})/);

  chunks.forEach(chunk => {
    const idMatch = chunk.match(/^\s*\.ER\s+([A-Z0-9]{4,8})\b/im);
    if (!idMatch) return;
    const id = idMatch[1].toUpperCase();

    // Only treat stage-based river sections as "stage" rows. Flow-only reservoir
    // guidance is intentionally skipped rather than mislabeled as feet.
    const isStage = /:\s*RIVER FORECAST\b/i.test(chunk) || /LATEST\s+(?:RIVER\s+|TAILWATER\s+|POOL\s+)?STAGE\b/i.test(chunk);
    if (!isStage) return;

    const nameMatch = chunk.match(/^\s*:\s*([^\r\n:]+?\s+-\s+[^\r\n:]+?)\s*$/m);
    const name = nameMatch ? nameMatch[1].trim().replace(/\s+/g, ' ') : id;

    const thresholds = {
      action: matchNum_(chunk, /ACTION\s+STAGE\s+(-?\d+(?:\.\d+)?)/i),
      minor: matchNum_(chunk, /MINOR\s+STAGE\s+(-?\d+(?:\.\d+)?)/i),
      moderate: matchNum_(chunk, /MODERATE\s+STAGE\s+(-?\d+(?:\.\d+)?)/i),
      major: matchNum_(chunk, /MAJOR\s+STAGE\s+(-?\d+(?:\.\d+)?)/i)
    };

    const obsMatch = chunk.match(/LATEST\s+(?:RIVER\s+|TAILWATER\s+|POOL\s+)?STAGE\s+(-?\d+(?:\.\d+)?)\s*(?:FT|FEET)?\s+AT\s+([^\r\n]+)/i);
    const observed = obsMatch ? Number(obsMatch[1]) : null;
    const observedTime = obsMatch ? parseRvfObservationTime_(obsMatch[2], issued) : issued;

    const forecast = parseRvfForecastPeak_(chunk);
    const obsCat = categoryFor_(observed, thresholds);
    const fcstCat = categoryFor_(forecast.value, thresholds);
    const sourceUrl = productId ? `https://api.weather.gov/products/${encodeURIComponent(productId)}` : `https://forecast.weather.gov/product.php?site=NWS&issuedby=${encodeURIComponent(cfg.location)}&product=RVF&format=CI&version=1&glossary=0`;

    out.push({
      id,
      name,
      rfc: cfg.rfc || '',
      forecastGroup,
      state: 'good',
      observed,
      observedTime: observedTime ? observedTime.toISOString() : issued.toISOString(),
      observedCategory: obsCat,
      forecast: forecast.value,
      forecastTime: forecast.time ? forecast.time.toISOString() : null,
      forecastCategory: fcstCat,
      unit: 'ft',
      thresholds,
      sourceUrl,
      productId: productId || '',
      productIssuedAt: issued.toISOString(),
      pil: cfg.pil
    });
  });

  return out;
}

function parseRvfForecastPeak_(chunk) {
  const marker = chunk.search(/:\s*RIVER FORECAST\b/i);
  if (marker < 0) return { value: null, time: null };
  let tail = chunk.slice(marker);
  const stop = tail.slice(1).search(/\r?\n\s*(?:\.ER\s+|:\s*(?:QPF|FLOW FORECAST|FORECASTER COMMENTS)|\.AR\s+)/i);
  if (stop >= 0) tail = tail.slice(0, stop + 1);

  const vals = [];
  const lines = tail.split(/\r?\n/);
  lines.forEach(line => {
    if (!/^\s*\.E\d+\b/i.test(line)) return;
    const pieces = line.split('/').slice(1);
    pieces.forEach(piece => {
      const m = piece.match(/-?\d+(?:\.\d+)?/);
      if (!m) return;
      const n = Number(m[0]);
      if (isFinite(n)) vals.push(n);
    });
  });
  if (!vals.length) return { value: null, time: null };
  return { value: Math.max.apply(null, vals), time: null };
}

function parseRvfObservationTime_(s, issued) {
  const m = String(s || '').toUpperCase().match(/(\d{3,4})\s*(AM|PM)\s+(EST|EDT|CST|CDT)\s+ON\s+([A-Z]{3})\s+(\d{1,2})/);
  if (!m) return issued;
  let hhmm = m[1].padStart(4, '0');
  let hh = Number(hhmm.slice(0, 2)), mm = Number(hhmm.slice(2));
  if (m[2] === 'AM' && hh === 12) hh = 0;
  if (m[2] === 'PM' && hh !== 12) hh += 12;
  const mons = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
  const mon = mons[m[4]];
  if (mon == null) return issued;
  let year = issued.getUTCFullYear();
  const day = Number(m[5]);
  // Handle products issued around New Year's with a Dec/Jan observation.
  if (issued.getUTCMonth() === 0 && mon === 11) year -= 1;
  if (issued.getUTCMonth() === 11 && mon === 0) year += 1;
  const offsets = { EST: -5, EDT: -4, CST: -6, CDT: -5 };
  const offset = offsets[m[3]];
  const utc = Date.UTC(year, mon, day, hh - offset, mm, 0);
  return new Date(utc);
}

function matchNum_(text, re) {
  const m = String(text || '').match(re);
  return m ? Number(m[1]) : null;
}

/**
 * Discover every gauge assigned to a WFO from NOAA's official national
 * all-gauges report.  Header matching is deliberately flexible because NOAA
 * has changed report labels over time.
 */
function discoverGaugeRefsForOffice_(office) {
  let resp;
  try {
    resp = UrlFetchApp.fetch(APP.NWPS_GAUGE_REPORT_URL, {
      method: 'get',
      headers: { 'User-Agent': APP.USER_AGENT, 'Accept': 'text/csv,*/*' },
      muteHttpExceptions: true,
      followRedirects: true
    });
  } catch (e) {
    return { gauges: [], source: 'NWPS all-gauges report unavailable' };
  }
  if (!ok_(resp.getResponseCode())) {
    return { gauges: [], source: 'NWPS all-gauges report HTTP ' + resp.getResponseCode() };
  }

  let rows;
  try { rows = Utilities.parseCsv(resp.getContentText('UTF-8')); }
  catch (e) { return { gauges: [], source: 'NWPS all-gauges report parse error' }; }
  if (!rows || rows.length < 2) return { gauges: [], source: 'NWPS all-gauges report empty' };

  const header = rows[0].map(normalizeHeader_);
  const idxWfo = findHeaderIndex_(header, ['wfo','wfoid','wfoidentifier','weatherforecastoffice','forecastoffice','forecastofficeid']);
  const idxId  = findHeaderIndex_(header, ['nwsli','nwsid','lid','gaugeid','gaugeidentifier','identifier','nwslid']);
  const idxName = findHeaderIndex_(header, ['name','gaugename','locationname','sitename']);
  const idxRfc = findHeaderIndex_(header, ['rfc','rfcid','rfcidentifier','riverforecastcenter']);

  if (idxWfo < 0 || idxId < 0) {
    return { gauges: [], source: 'NWPS report headers changed (WFO/LID not found)' };
  }

  const gauges = [];
  rows.slice(1).forEach(row => {
    const wfo = String(row[idxWfo] || '').trim().toUpperCase().replace(/^K/, '');
    if (wfo !== office) return;
    const id = String(row[idxId] || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,10}$/.test(id)) return;
    gauges.push({
      lid: id,
      name: idxName >= 0 ? String(row[idxName] || '').trim() : id,
      rfc: idxRfc >= 0 ? String(row[idxRfc] || '').trim().toUpperCase() : '',
      wfo: { abbreviation: office }
    });
  });

  return { gauges: dedupeGauges_(gauges), source: 'NWPS all-gauges report' };
}

function normalizeHeader_(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findHeaderIndex_(headers, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const exact = headers.indexOf(candidates[i]);
    if (exact >= 0) return exact;
  }
  for (let i = 0; i < headers.length; i++) {
    for (let j = 0; j < candidates.length; j++) {
      if (headers[i].indexOf(candidates[j]) >= 0) return i;
    }
  }
  return -1;
}

function discoverGaugesFromApi_(office, jsonHeaders) {
  let resp;
  try {
    // Try an office-filtered request first. If the backend ignores the
    // parameter, the exact WFO check below still protects the result.
    resp = UrlFetchApp.fetch(`${APP.NWPS_API}/gauges?wfo=${encodeURIComponent(office)}`, {
      method: 'get', headers: jsonHeaders, muteHttpExceptions: true, followRedirects: true
    });
  } catch (e) { return []; }
  if (!ok_(resp.getResponseCode())) return [];
  const root = safeJson_(resp);
  const all = extractGaugeArray_(root);
  return all.filter(g => gaugeWfo_(g) === office);
}

// =============================================================================
// Product / TAF helpers
// =============================================================================

function processTafs_(officeOut, office, json, code, now) {
  const tafProduct = product_('TAF');
  let newest = null;  if (ok_(code) && Array.isArray(json)) {
    json.forEach(item => {
      const station = String(item.icaoId || item.stationId || item.id || '').toUpperCase();
      if (!station) return;
      const t = extractTafIssue_(item);
      if (t) {
        officeOut.tafs[station] = makeTafCycleStatus_(station, t, now);
        if (!newest || t > newest) newest = t;
      }
    });
  }

  APP.OFFICES[office].tafs.forEach(station => {
    if (!officeOut.tafs[station]) {
      officeOut.tafs[station] = makeUnavailable_(tafProduct, 'No current TAF returned',
        `https://aviationweather.gov/data/taf/?ids=${station}`);
    }
  });

  const tafStates = APP.OFFICES[office].tafs.map(s => officeOut.tafs[s]);
  const worst = tafStates.sort((a,b) => tafStateRank_(b.state) - tafStateRank_(a.state))[0];
  officeOut.products.TAF = newest
    ? Object.assign(makeStatus_(tafProduct, newest, now, {
        source: 'NWS Aviation Weather Center',
        sourceUrl: `https://aviationweather.gov/data/taf/?ids=${APP.OFFICES[office].tafs.join(',')}`
      }), {
        state: worst ? worst.state : 'good',
        note: worst && worst.cycleNote ? `Worst station: ${worst.cycleNote}` : 'TAF cycle monitor'
      })
    : makeUnavailable_(tafProduct, 'No current TAFs returned', 'https://aviationweather.gov/data/taf/');
}

function makeTafCycleStatus_(station, issued, now) {
  const expected = latestExpectedTafIssue_(now);
  // Allow a TAF issued shortly before the nominal :20 checkpoint to count as
  // the new cycle.  Some sites publish a few minutes early.
  const cycleReceived = issued.getTime() >= expected.getTime() - 15 * 60000;
  const overdueMin = Math.max(0, (now.getTime() - expected.getTime()) / 60000);
  let state = 'good';
  let cycleNote = 'Current cycle received';
  if (!cycleReceived) {
    if (overdueMin >= 25) {
      state = 'late';
      cycleNote = `OUTDATED — expected by ${fmtUtcHm_(expected)}Z`;
    } else if (overdueMin >= 10) {
      state = 'warn';
      cycleNote = `AGING — expected by ${fmtUtcHm_(expected)}Z`;
    } else {
      state = 'good';
      cycleNote = `Cycle due ${fmtUtcHm_(expected)}Z — grace period`;
    }
  }
  return {
    key: 'TAF', label: station, state,
    issuedAt: issued.toISOString(),
    ageHours: Math.max(0, (now-issued)/3600000),
    source: 'NWS Aviation Weather Center',
    sourceUrl: `https://aviationweather.gov/data/taf/?ids=${station}`,
    expectedIssueAt: expected.toISOString(),
    cycleReceived,
    cycleNote
  };
}

function latestExpectedTafIssue_(now) {
  // User-requested schedule: :20 during the hour before 00/06/12/18Z,
  // i.e. 23:20, 05:20, 11:20 and 17:20 UTC.
  const d = new Date(now.getTime());
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0);
  const candidates = [];
  [-1,0].forEach(dayOffset => {
    [23,5,11,17].forEach(h => candidates.push(new Date(base + dayOffset*86400000 + (h*60+20)*60000)));
  });
  candidates.sort((a,b)=>b-a);
  return candidates.find(x => x <= now) || new Date(base - 40*60000);
}
function fmtUtcHm_(d){ return String(d.getUTCHours()).padStart(2,'0') + String(d.getUTCMinutes()).padStart(2,'0'); }
function tafStateRank_(s){ return ({late:4,warn:3,na:2,good:1})[s] || 0; }

function makeRvfStatus_(cfg, json, code, now) {
  const issued = ok_(code) && json ? parseDate_(json.issuanceTime || json.issueTime || json.generatedAt) : null;
  const ageHours = issued ? Math.max(0, (now - issued) / 3600000) : null;
  let state = 'na';
  if (issued) state = ageState_(ageHours);
  return {
    pil: cfg.pil,
    rfc: cfg.rfc,
    note: cfg.note || '',
    state,
    issuedAt: issued ? issued.toISOString() : null,
    ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
    warnHours: APP.PRODUCT_AGE_WARN_HOURS,
    lateHours: APP.PRODUCT_AGE_LATE_HOURS,
    sourceUrl: `https://forecast.weather.gov/product.php?site=NWS&issuedby=${cfg.location}&product=RVF&format=CI&version=1&glossary=0`,
    source: issued ? `${cfg.rfc} River Forecast` : `RVF unavailable (${code})`
  };
}

// =============================================================================
// Radar helpers
// =============================================================================

function makeRadarApiStatus_(cfg, json, code, now) {
  const liveUrl = cfg.spg ? 'https://www.weather.gov/nl2/SPGView' : 'https://www.weather.gov/nl2/NEXRADView';
  const apiUrl = `https://api.weather.gov/radar/stations/${encodeURIComponent(cfg.id)}`;
  if (!ok_(code) || !json) {
    return {
      id: cfg.id, type: cfg.type, note: cfg.displayNote || '', state: 'na',
      status: `Radar API unavailable (${code})`, lastDataAt: null, latencySeconds: null,
      source: 'NWS Radar Status API', sourceUrl: apiUrl, liveUrl,
      ftmUrl: `https://forecast.weather.gov/product.php?site=NWS&issuedby=${cfg.ftm}&product=FTM&format=CI&version=1&glossary=0`
    };
  }

  const root = json.properties || json;
  const rda = root.rda || json.rda || {};
  const rdaProps = rda.properties || rda;
  const latency = root.latency || json.latency || {};
  const latProps = latency.properties || latency;
  const rawStatus = String(rdaProps.status || root.status || 'Unknown').trim();
  const last = radarLastDataTime_(latProps, root);
  const latencySeconds = last ? Math.max(0, Math.round((now.getTime()-last.getTime())/1000)) : null;
  const normalized = rawStatus.toUpperCase();

  let state = 'na', label = rawStatus || 'Unknown';
  if (/OPERATE/.test(normalized) && !/NOT\s+OPERATE/.test(normalized)) state = 'good';
  else if (/OFFLINE|NOT\s+OPERATE|INOPER|FAILED/.test(normalized)) state = 'late';
  else if (/STANDBY|RESTART|START[- ]?UP|MAINT/.test(normalized)) state = 'warn';

  // Match ROC/NEXRAD status practice: fresh data <5 min green; 5–30 min
  // delayed/aging; >=30 min stale/out.  RDA OFFLINE always remains red.
  if (latencySeconds != null) {
    if (latencySeconds >= 1800) state = 'late';
    else if (latencySeconds >= 300 && state !== 'late') state = 'warn';
    else if (latencySeconds < 300 && state === 'na' && /OPERATE/.test(normalized)) state = 'good';
  }

  return {
    id: cfg.id,
    type: cfg.type,
    note: cfg.displayNote || '',
    state,
    status: label,
    lastDataAt: last ? last.toISOString() : null,
    latencySeconds,
    source: 'NWS Radar Status API',
    sourceUrl: apiUrl,
    liveUrl,
    ftmUrl: `https://forecast.weather.gov/product.php?site=NWS&issuedby=${cfg.ftm}&product=FTM&format=CI&version=1&glossary=0`
  };
}

function radarLastDataTime_(latency, root) {
  const candidates = [
    latency && latency.levelTwoLastReceivedTime,
    latency && latency.levelThreeLastReceivedTime,
    latency && latency.lastReceivedTime,
    root && root.levelTwoLastReceivedTime,
    root && root.levelThreeLastReceivedTime
  ];
  for (let i=0;i<candidates.length;i++) {
    const d=parseDate_(candidates[i]); if(d) return d;
  }
  // Defensive fallback for API schema additions: choose the newest ISO date
  // within the latency object only.
  const found=[];
  (function walk(v){
    if(v==null) return;
    if(typeof v==='string'){ const d=parseDate_(v); if(d) found.push(d); return; }
    if(typeof v==='object') Object.keys(v).forEach(k=>walk(v[k]));
  })(latency);
  if(!found.length) return null;
  found.sort((a,b)=>b-a); return found[0];
}

// =============================================================================
// NOAA Weather Radio status helpers
// =============================================================================
function getNwrStatuses_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'nwr-status-v5';
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const out = {};
  Object.keys(APP.OFFICES).forEach(o => out[o] = []);
  const fetchedAt = new Date();

  // Source 1: national NWR outage/degraded registry. This is report-based,
  // not live RF telemetry. It remains useful, but a local PNS can be newer
  // or can describe an outage that has not yet propagated to the national map.
  let html = '', nationalOk = false;
  try {
    const resp = UrlFetchApp.fetch('https://www.weather.gov/nwr/outages', {
      method:'get', headers:{'User-Agent':APP.USER_AGENT,'Accept':'text/html'},
      muteHttpExceptions:true, followRedirects:true
    });
    nationalOk = ok_(resp.getResponseCode());
    if (nationalOk) html = resp.getContentText('UTF-8');
  } catch(e) {}
  const nationalText = nationalOk ? stripHtml_(html).toUpperCase().replace(/-/g,'') : '';

  // Source 2: deep local PNS history. This deliberately goes much farther
  // back than the previous 24 products because an "until further notice"
  // NWR outage can remain active for weeks/months and is only cleared by a
  // later restoration statement. We also follow product-API pagination.
  const pnsByOffice = {};
  Object.keys(APP.OFFICES).forEach(office => {
    pnsByOffice[office] = getRecentNwrPnsMentions_(office, APP.OFFICES[office].nwr || [], fetchedAt);
  });

  Object.keys(APP.OFFICES).forEach(office => {
    (APP.OFFICES[office].nwr || []).forEach(cfg => {
      const id = normalizeNwrId_(cfg.id);
      const pns = (pnsByOffice[office] || {})[id] || null;
      let status = nationalOk ? 'Online' : 'Status unavailable';
      let state = nationalOk ? 'good' : 'na';
      let details = '';
      let source = nationalOk ? 'National NWR registry' : 'NWR registry unavailable';
      let sourceUrl = 'https://www.weather.gov/nwr/outages';

      if (nationalOk) {
        const pos = nationalText.indexOf(id);
        if (pos >= 0) {
          const chunk = nationalText.slice(Math.max(0,pos-300), pos+700);
          if (/OUT\s+OF\s+SERVICE|OFFLINE|OUTAGE|OFF\s+AIR|NON\s*OPERATIONAL/.test(chunk)) {
            status='Out of Service'; state='late'; details='Listed by national NWR outage service';
          } else if (/DEGRADED|REDUCED\s+POWER|LIMITED\s+COVERAGE|INTERMITTENT/.test(chunk)) {
            status='Degraded'; state='warn'; details='Listed by national NWR degraded-service registry';
          }
        }
      }

      // Newest local callsign/location/office-wide PNS mention wins over the
      // national registry. Persistent outages stay red until a later PNS says
      // restored. Time-limited maintenance notices expire automatically.
      if (pns) {
        source = 'Local NWS PNS + national NWR registry';
        // Keep the card click-through anchored to the official NWR status page.
        // The local PNS is retained as metadata but does not replace the status-page link.
        sourceUrl = 'https://www.weather.gov/nwr/outages';
        details = pns.summary || details;
        if (pns.status === 'out') { status='Out of Service'; state='late'; }
        else if (pns.status === 'degraded') { status='Degraded'; state='warn'; }
        else if (pns.status === 'restored') { status='Restored / reported operational'; state='good'; }
        else if (pns.status === 'scheduled') { status='Scheduled / temporary outage'; state='warn'; }
      }

      if (status === 'Online') {
        details = 'No outage/degraded condition is listed on the official NWR status page and no unresolved local PNS outage was found.';
      }

      out[office].push({
        id:cfg.id, name:cfg.name, mhz:cfg.mhz, status, state,
        checkedAt:fetchedAt.toISOString(), details,
        source, pnsUpdatedAt:pns && pns.issuedAt || null,
        sourceUrl,
        outageUrl:'https://www.weather.gov/nwr/outages'
      });
    });
  });

  try { cache.put(cacheKey, JSON.stringify(out), 300); } catch(e) {}
  return out;
}

function normalizeNwrId_(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
}

function normalizePlace_(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
}

function fetchPnsHistoryRefs_(office, maxProducts) {
  const refs = [];
  const seen = {};
  let url = `https://api.weather.gov/products/types/PNS/locations/${encodeURIComponent(office)}`;
  let pages = 0;
  const headers = {'User-Agent':APP.USER_AGENT,'Accept':'application/geo+json, application/json'};
  while (url && refs.length < maxProducts && pages < 8) {
    pages++;
    let resp;
    try {
      resp = UrlFetchApp.fetch(url, {method:'get',headers,muteHttpExceptions:true,followRedirects:true});
    } catch(e) { break; }
    if (!ok_(resp.getResponseCode())) break;
    const j = safeJson_(resp) || {};
    const graph = j['@graph'] || j.products || j.items || [];
    if (Array.isArray(graph)) {
      graph.forEach(x => {
        if (!x || refs.length >= maxProducts) return;
        const id = String(x.id || x.identifier || '').trim();
        const apiUrl = String(x['@id'] || x.url || (id ? `https://api.weather.gov/products/${encodeURIComponent(id)}` : '')).trim();
        if (!apiUrl || seen[apiUrl]) return;
        seen[apiUrl] = true;
        refs.push({url:apiUrl, issuedAt:x.issuanceTime || x.issueTime || x.generatedAt || null});
      });
    }
    const pag = j.pagination || {};
    const next = pag.next || j.next || null;
    url = next && String(next) !== url ? String(next) : null;
  }
  return refs.slice(0,maxProducts);
}

function getRecentNwrPnsMentions_(office, configs, now) {
  const result = {};
  if (!configs || !configs.length) return result;
  now = now || new Date();

  const refs = fetchPnsHistoryRefs_(office, APP.NWR_PNS_MAX_PRODUCTS);
  if (!refs.length) return result;
  const cutoff = now.getTime() - APP.NWR_PNS_MAX_AGE_DAYS * 86400000;
  const useful = refs.filter(r => {
    const d = parseDate_(r.issuedAt);
    return !d || d.getTime() >= cutoff;
  }).slice(0, APP.NWR_PNS_MAX_PRODUCTS);

  const reqs = useful.map(x => ({
    url:x.url, method:'get',
    headers:{'User-Agent':APP.USER_AGENT,'Accept':'application/geo+json, application/json'},
    muteHttpExceptions:true, followRedirects:true
  }));
  let responses=[];
  try { responses = fetchAllChunked_(reqs, 35); } catch(e) { return result; }

  responses.forEach((resp, i) => {
    if (!resp || !ok_(resp.getResponseCode())) return;
    const j=safeJson_(resp); if(!j) return;
    const text=String(j.productText || j.product || j.text || '').replace(/\r/g,'');
    if (!/NOAA\s+WEATHER\s+RADIO|WEATHER\s+RADIO|\bNWR\b/i.test(text)) return;
    const issued = parseDate_(j.issuanceTime || (useful[i] && useful[i].issuedAt));
    if (issued && issued.getTime() < cutoff) return;

    const upper = text.toUpperCase();
    const norm = normalizeNwrId_(text);
    const officeWide = /ALL\s+(?:NOAA\s+WEATHER\s+RADIO|NWR)\s+(?:TRANSMITTERS|STATIONS|BROADCASTS)[\s\S]{0,120}(?:DOWN|OFF\s+THE\s+AIR|OFF\s+AIR|OUT\s+OF\s+SERVICE)/i.test(text) ||
      /ALL\s+(?:NWR|NOAA\s+WEATHER\s+RADIO)\s+(?:TRANSMITTERS|STATIONS)[\s\S]{0,180}UNTIL\s+FURTHER\s+NOTICE/i.test(text);

    configs.forEach(cfg => {
      const id=normalizeNwrId_(cfg.id);
      const city = normalizePlace_(String(cfg.name||'').split(',')[0]);
      const cityMatch = city && upper.indexOf(city) >= 0;
      const callMatch = norm.indexOf(id) >= 0;
      if (!officeWide && !callMatch && !cityMatch) return;

      const old=result[id];
      if (old && old.issuedAt && issued && new Date(old.issuedAt) >= issued) return;

      let pos = -1;
      const rawId = String(cfg.id||'').toUpperCase();
      pos = upper.indexOf(rawId);
      if (pos < 0) pos = upper.indexOf(String(cfg.name||'').split(',')[0].toUpperCase());
      if (pos < 0) pos = 0;
      const chunk=text.slice(Math.max(0,pos-700), Math.min(text.length,pos+1800));
      const classified = classifyNwrPns_(chunk, text, issued, now);
      if (!classified) return;

      result[id]={
        status:classified.status,
        issuedAt:issued?issued.toISOString():null,
        summary:stripNwrPnsSummary_(chunk),
        url:String(j['@id'] || j.id || (useful[i] && useful[i].url) || ''),
        persistent:classified.persistent || false
      };
    });
  });
  return result;
}

function classifyNwrPns_(chunk, fullText, issued, now) {
  const t = String(chunk || '') + '\n' + String(fullText || '');
  if (/RESTORED|RETURNED\s+TO\s+SERVICE|BACK\s+(?:ON|IN)\s+(?:THE\s+)?AIR|BACK\s+IN\s+SERVICE|IS\s+BACK\s+IN\s+SERVICE|OPERATIONAL\s+AGAIN/i.test(t)) {
    return {status:'restored', persistent:false};
  }
  const out = /OUT\s+OF\s+SERVICE|OFF\s+THE\s+AIR|OFF\s+AIR|NOT\s+TRANSMITTING|TRANSMITTER\s+(?:IS\s+)?DOWN|BROADCAST\s+(?:IS\s+)?UNAVAILABLE|SERVICE\s+OUTAGE|CURRENTLY\s+DOWN|WILL\s+REMAIN\s+OFFLINE/i.test(t);
  const degraded = /DEGRADED|INTERMITTENT|REDUCED\s+POWER|LIMITED\s+COVERAGE/i.test(t);
  if (!out && !degraded) return null;

  const persistent = /UNTIL\s+FURTHER\s+NOTICE|NO\s+(?:ESTIMATE|ESTIMATED)\s+(?:TIME|DATE)|RETURN\s+TO\s+SERVICE\s+(?:IS\s+)?UNKNOWN|UNKNOWN\s+(?:RETURN|RESTORATION)/i.test(t);
  if (persistent) return {status:out?'out':'degraded', persistent:true};

  // If the PNS clearly describes a short scheduled/temporary window and that
  // statement is now old, do not keep it as a current outage indefinitely.
  const ageHours = issued ? Math.max(0,(now-issued)/3600000) : 0;
  const temporary = /THROUGH\s+(?:THIS\s+)?(?:MORNING|AFTERNOON|EVENING|TONIGHT)|FROM\s+\d{1,4}\s*(?:AM|PM)?\s+(?:TO|THROUGH|UNTIL)\s+\d{1,4}|SCHEDULED|ROUTINE\s+MAINTENANCE|FOR\s+MAINTENANCE/i.test(t);
  if (temporary && ageHours > 36) return null;
  if (degraded) return {status:'degraded', persistent:false};
  return {status: temporary ? 'scheduled' : 'out', persistent:false};
}

function stripNwrPnsSummary_(text) {
  return String(text||'').replace(/\s+/g,' ').trim().slice(0,420);
}

function stripHtml_(s) {
  return String(s||'').replace(/<script\b[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&#39;/g,"'")
    .replace(/&quot;/gi,'"').replace(/\s+/g,' ').trim();
}


function fetchRecentRiverWarningProducts_(office, headers, now) {
  const products = [];
  ['FLW', 'FLS'].forEach(type => {
    const historyUrl = `https://api.weather.gov/products/types/${type}/locations/${encodeURIComponent(office)}`;
    let resp;
    try {
      resp = UrlFetchApp.fetch(historyUrl, {
        method: 'get', headers, muteHttpExceptions: true, followRedirects: true
      });
    } catch (e) {
      return;
    }
    if (!ok_(resp.getResponseCode())) return;
    const refs = extractRvfProductRefs_(safeJson_(resp))
      .filter(r => {
        const t = parseDate_(r.issuedAt);
        return !t || (now.getTime() - t.getTime()) <= 10 * 86400000;
      })
      .slice(0, 50);
    if (!refs.length) return;

    const resps = fetchAllChunked_(refs.map(r => req_(r.url, headers)), 25);
    resps.forEach((r, i) => {
      if (!r || !ok_(r.getResponseCode())) return;
      const j = safeJson_(r);
      if (!j) return;
      const text = String(j.productText || j.text || j.body || '');
      if (!text || !/\.FL\.W\./i.test(text)) return; // river Flood Warnings only
      const issued = parseDate_(j.issuanceTime || j.issueTime || refs[i].issuedAt) || now;
      const blocks = extractRiverWarningBlocks_(text, type, issued, refs[i].id);
      Array.prototype.push.apply(products, blocks);
    });
  });
  products.sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
  return products;
}

function extractRiverWarningBlocks_(text, productType, issued, productId) {
  const out = [];
  const re = /\/O\.(NEW|CON|EXT|EXA|EXB|CAN|EXP)\.[A-Z]{4}\.FL\.W\.(\d{4})\.(\d{6}T\d{4}Z)-(\d{6}T\d{4}Z)\//ig;
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push({
      index: m.index,
      action: m[1].toUpperCase(),
      etn: m[2],
      begin: parseVtecTime_(m[3]),
      end: parseVtecTime_(m[4])
    });
  }
  if (!matches.length) return out;

  matches.forEach((x, i) => {
    let start = x.index;
    let stop = (i + 1 < matches.length) ? matches[i + 1].index : text.length;
    // River-specific FLW/FLS sections carry the WHERE/location after the VTEC
    // line. Starting at the VTEC keeps neighboring river warnings from matching.
    const chunk = text.slice(start, stop);
    out.push({
      productType,
      action: x.action,
      etn: x.etn,
      begin: x.begin ? x.begin.toISOString() : null,
      expiresAt: x.end ? x.end.toISOString() : null,
      issuedAt: issued.toISOString(),
      productId: productId || '',
      sourceUrl: productId
        ? `https://api.weather.gov/products/${encodeURIComponent(productId)}`
        : `https://forecast.weather.gov/product.php?site=NWS&product=${productType}`,
      text: chunk
    });
  });
  return out;
}

function parseVtecTime_(s) {
  const m = String(s || '').match(/^(\d{2})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/);
  if (!m) return null;
  if (m[1] === '00' && m[2] === '00' && m[3] === '00') return null;
  const yy = Number(m[1]);
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])));
}

function findRiverWarningStatus_(river, products, now) {
  const matches = (products || []).filter(p => warningBlockMatchesRiver_(river, p.text));
  if (!matches.length) {
    return {
      active: false,
      action: null,
      productType: null,
      lastUpdated: null,
      expiresAt: null,
      sourceUrl: null
    };
  }

  matches.sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
  const p = matches[0];
  const activeAction = ['NEW', 'CON', 'EXT', 'EXA', 'EXB'].indexOf(p.action) >= 0;
  const end = parseDate_(p.expiresAt);
  const active = activeAction && (!end || end.getTime() > now.getTime());

  return {
    active,
    action: p.action,
    productType: p.productType,
    lastUpdated: p.issuedAt,
    expiresAt: p.expiresAt,
    sourceUrl: p.sourceUrl,
    etn: p.etn
  };
}

function warningBlockMatchesRiver_(river, text) {
  const hay = normalizeMatchText_(text);
  const id = normalizeMatchText_(river.id || '');
  if (id && new RegExp(`\\b${escapeRegex_(id)}\\b`, 'i').test(hay)) return true;

  const name = String(river.name || '');
  const full = normalizeMatchText_(name);
  if (full && full.length >= 8 && hay.indexOf(full) >= 0) return true;

  // RVF names are commonly "River Name - Location". Requiring both halves
  // avoids matching every gauge on the same river when one point is warned.
  const parts = name.split(/\s+-\s+/);
  if (parts.length >= 2) {
    const riverPart = normalizeMatchText_(parts[0]);
    const locPart = normalizeMatchText_(parts.slice(1).join(' '));
    const locCore = significantWords_(locPart).join(' ');
    const riverWords = significantWords_(riverPart);
    const riverCore = riverWords.slice(0, Math.min(3, riverWords.length)).join(' ');
    if (locCore && hay.indexOf(locCore) >= 0 && riverCore && hay.indexOf(riverCore) >= 0) return true;
  }

  // Fallback: location plus any distinctive river token.
  const words = significantWords_(full);
  if (words.length >= 3) {
    const loc = words[words.length - 1];
    const distinctive = words.filter(w => w !== loc && w.length >= 5);
    if (hay.indexOf(loc) >= 0 && distinctive.some(w => hay.indexOf(w) >= 0)) return true;
  }
  return false;
}

function normalizeMatchText_(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantWords_(s) {
  const stop = {
    RIVER:1, CREEK:1, BAYOU:1, FORK:1, LAKE:1, AT:1, NEAR:1, ABOVE:1, BELOW:1,
    THE:1, OF:1, AND:1, DAM:1, LOCK:1, NR:1
  };
  return normalizeMatchText_(s).split(' ').filter(w => w.length >= 3 && !stop[w]);
}

function escapeRegex_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function warningCheckRank_(v) {
  return ({ missing: 4, covered: 3, 'active-below-minor': 2, none: 0 })[v] || 0;
}

// =============================================================================
// River helpers
// =============================================================================

function extractGaugeArray_(root) {
  const best = [];
  function visit(v, depth) {
    if (depth > 7 || v == null) return;
    if (Array.isArray(v)) {
      const gaugeish = v.filter(x => x && typeof x === 'object' && gaugeId_(x)).length;
      if (gaugeish >= Math.max(1, Math.floor(v.length * 0.25))) {
        v.forEach(x => { if (x && typeof x === 'object' && gaugeId_(x)) best.push(x); });
        return;
      }
      v.forEach(x => visit(x, depth + 1));
      return;
    }
    if (typeof v === 'object') Object.keys(v).forEach(k => visit(v[k], depth + 1));
  }
  visit(root, 0);
  return dedupeGauges_(best);
}

function dedupeGauges_(arr) {
  const seen = {};
  return arr.filter(g => {
    const id = gaugeId_(g);
    if (!id || seen[id]) return false;
    seen[id] = true;
    return true;
  });
}

function gaugeId_(g) {
  if (!g || typeof g !== 'object') return '';
  const values = [g.identifier, g.lid, g.LID, g.id, g.gaugeId, g.gauge_id, g.nwsLid];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v === 'string' && /^[A-Za-z0-9]{4,8}$/.test(v.trim())) return v.trim().toUpperCase();
  }
  if (g.lids && typeof g.lids === 'object') {
    const v = g.lids.lid || g.lids.identifier;
    if (v) return String(v).toUpperCase();
  }
  return '';
}

function gaugeWfo_(g) {
  function scan(v, depth) {
    if (depth > 4 || v == null) return '';
    if (typeof v === 'string') {
      const m = v.toUpperCase().match(/\b(MOB|LIX|TAE|KEY)\b/);
      return m ? m[1] : '';
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) { const hit = scan(v[i], depth + 1); if (hit) return hit; }
      return '';
    }
    if (typeof v === 'object') {
      const preferred = [v.abbreviation, v.id, v.identifier, v.name, v.wfo, v.WFO, v.weatherForecastOffice, v.office];
      for (let i = 0; i < preferred.length; i++) { const hit = scan(preferred[i], depth + 1); if (hit) return hit; }
    }
    return '';
  }
  const direct = scan([g.wfo, g.WFO, g.weatherForecastOffice, g.office], 0);
  if (direct) return direct;
  // Last-resort shallow JSON match only.
  const s = JSON.stringify(g).slice(0, 5000).toUpperCase();
  const m = s.match(/"(?:WFO|ABBREVIATION|IDENTIFIER|ID)"\s*:\s*"(?:K)?(MOB|LIX|TAE|KEY)"/);
  return m ? m[1] : '';
}

function gaugeName_(g, id) {
  const c = [g.name, g.locationName, g.gaugeName, g.description, g.title, g.location];
  for (let i = 0; i < c.length; i++) if (typeof c[i] === 'string' && c[i].trim()) return c[i].trim();
  return id;
}

function gaugeRfc_(g) {
  const v = g.rfc || g.RFC || g.riverForecastCenter;
  if (typeof v === 'string') return v.toUpperCase();
  if (v && typeof v === 'object') return String(v.abbreviation || v.id || v.identifier || '').toUpperCase();
  return '';
}

function makeRiver_(gauge, id, stageJson, code, now) {
  const thresholds = extractFloodThresholds_(gauge);
  // Stageflow response can also carry richer threshold metadata.
  mergeThresholds_(thresholds, extractFloodThresholds_(stageJson));

  const series = extractStageSeries_(stageJson);
  const observed = latestPoint_(series.observed);
  const forecast = maxPoint_(series.forecast, now);
  const unit = observed.unit || forecast.unit || findUnit_(stageJson) || 'ft';

  const obsCat = categoryFor_(observed.value, thresholds);
  const fcstCat = categoryFor_(forecast.value, thresholds);

  return {
    id,
    name: gaugeName_(gauge, id),
    rfc: gaugeRfc_(gauge),
    state: ok_(code) ? 'good' : 'na',
    observed: observed.value,
    observedTime: observed.time ? observed.time.toISOString() : null,
    observedCategory: obsCat,
    forecast: forecast.value,
    forecastTime: forecast.time ? forecast.time.toISOString() : null,
    forecastCategory: fcstCat,
    unit,
    thresholds,
    sourceUrl: `https://water.noaa.gov/gauges/${id.toLowerCase()}`
  };
}

function extractStageSeries_(root) {
  const out = { observed: [], forecast: [] };
  function visit(v, path, depth) {
    if (depth > 10 || v == null) return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${path}[${i}]`, depth + 1));
      return;
    }
    if (typeof v !== 'object') return;

    const val = firstNumber_([v.value, v.stage, v.primary, v.y, v.magnitude]);
    const time = parseDate_(v.validTime || v.valid_time || v.time || v.timestamp || v.dateTime || v.datetime || v.observedTime || v.forecastTime);
    if (val != null && time) {
      const p = path.toLowerCase();
      const unit = String(v.unit || v.units || v.unitCode || '').replace(/^.*:/, '');
      if (/forecast|fcst|future/.test(p)) out.forecast.push({ value: val, time, unit });
      else if (/observ|obs|actual/.test(p)) out.observed.push({ value: val, time, unit });
    }
    Object.keys(v).forEach(k => visit(v[k], path ? `${path}.${k}` : k, depth + 1));
  }
  visit(root, '', 0);
  return out;
}

function latestPoint_(arr) {
  if (!arr || !arr.length) return { value: null, time: null, unit: '' };
  arr.sort((a, b) => b.time - a.time);
  return arr[0];
}

function maxPoint_(arr, now) {
  if (!arr || !arr.length) return { value: null, time: null, unit: '' };
  const futureish = arr.filter(p => p.time.getTime() >= now.getTime() - 3 * 3600000);
  const use = futureish.length ? futureish : arr;
  use.sort((a, b) => (b.value - a.value) || (a.time - b.time));
  return use[0];
}

function extractFloodThresholds_(root) {
  const out = { action: null, minor: null, moderate: null, major: null };
  function visit(v, path, depth) {
    if (depth > 8 || v == null) return;
    if (Array.isArray(v)) return v.forEach((x, i) => visit(x, `${path}[${i}]`, depth + 1));
    if (typeof v !== 'object') return;
    Object.keys(v).forEach(k => {
      const nv = v[k];
      const p = `${path}.${k}`.toLowerCase();
      const num = typeof nv === 'number' ? nv : (typeof nv === 'string' && /^-?\d+(\.\d+)?$/.test(nv.trim()) ? Number(nv) : null);
      if (num != null) {
        if (/major/.test(p) && /(stage|flood|value|threshold|category)/.test(p)) out.major = chooseThreshold_(out.major, num);
        else if (/moderate/.test(p) && /(stage|flood|value|threshold|category)/.test(p)) out.moderate = chooseThreshold_(out.moderate, num);
        else if (/minor/.test(p) && /(stage|flood|value|threshold|category)/.test(p)) out.minor = chooseThreshold_(out.minor, num);
        else if (/action/.test(p) && /(stage|flood|value|threshold|category)/.test(p)) out.action = chooseThreshold_(out.action, num);
      }
      visit(nv, p, depth + 1);
    });
  }
  visit(root, '', 0);
  return out;
}

function chooseThreshold_(oldVal, newVal) {
  if (newVal == null || !isFinite(newVal)) return oldVal;
  if (oldVal == null) return newVal;
  return oldVal; // retain first matching value; NWPS primary stage generally appears first
}

function mergeThresholds_(a, b) {
  ['action','minor','moderate','major'].forEach(k => { if (a[k] == null && b[k] != null) a[k] = b[k]; });
}

function categoryFor_(value, t) {
  if (value == null || !isFinite(value)) return 'na';
  if (t.major != null && value >= t.major) return 'major';
  if (t.moderate != null && value >= t.moderate) return 'moderate';
  if (t.minor != null && value >= t.minor) return 'minor';
  if (t.action != null && value >= t.action) return 'action';
  return 'normal';
}

function severityRank_(cat) {
  return ({ na: -1, normal: 0, action: 1, minor: 2, moderate: 3, major: 4 })[cat] ?? -1;
}

function findUnit_(obj) {
  let unit = '';
  function visit(v, depth) {
    if (unit || depth > 6 || v == null) return;
    if (Array.isArray(v)) return v.forEach(x => visit(x, depth + 1));
    if (typeof v !== 'object') return;
    ['unit','units','unitCode'].forEach(k => {
      if (!unit && typeof v[k] === 'string' && /ft|feet|foot|m\b|kcfs|cfs/i.test(v[k])) unit = v[k].replace(/^.*:/, '');
    });
    Object.keys(v).forEach(k => visit(v[k], depth + 1));
  }
  visit(obj, 0);
  return unit;
}

// =============================================================================
// Generic helpers
// =============================================================================

function req_(url, headers) {
  return { url, method: 'get', headers: headers || {}, muteHttpExceptions: true, followRedirects: true };
}

function fetchAllChunked_(requests, size) {
  const out = [];
  for (let i = 0; i < requests.length; i += size) {
    const chunk = requests.slice(i, i + size);
    const got = UrlFetchApp.fetchAll(chunk);
    Array.prototype.push.apply(out, got);
  }
  return out;
}

function safeJson_(resp) {
  try { return JSON.parse(resp.getContentText()); } catch (e) { return null; }
}

function ok_(code) { return code >= 200 && code < 300; }
function product_(key) { return APP.PRODUCTS.find(p => p.key === key); }

function ageState_(ageHours) {
  if (ageHours == null || !isFinite(ageHours)) return 'na';
  if (ageHours >= APP.PRODUCT_AGE_LATE_HOURS) return 'late';
  if (ageHours >= APP.PRODUCT_AGE_WARN_HOURS) return 'warn';
  return 'good';
}

function makeStatus_(product, issued, now, extra) {
  const ageHours = Math.max(0, (now.getTime() - issued.getTime()) / 3600000);
  const state = ageState_(ageHours);
  return Object.assign({
    key: product.key,
    label: product.label,
    state,
    issuedAt: issued.toISOString(),
    ageHours: Math.round(ageHours * 10) / 10,
    warnHours: APP.PRODUCT_AGE_WARN_HOURS,
    lateHours: APP.PRODUCT_AGE_LATE_HOURS
  }, extra || {});
}

function makeUnavailable_(product, reason, url) {
  return {
    key: product.key,
    label: product.label,
    state: 'na',
    issuedAt: null,
    ageHours: null,
    warnHours: APP.PRODUCT_AGE_WARN_HOURS,
    lateHours: APP.PRODUCT_AGE_LATE_HOURS,
    source: reason || 'Unavailable',
    sourceUrl: url || null
  };
}

function parseDate_(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value)) return value;
  if (typeof value === 'number') {
    const millis = value < 1e12 ? value * 1000 : value;
    const d = new Date(millis);
    return isNaN(d) ? null : d;
  }
  const d = new Date(value);
  return isNaN(d) ? null : d;
}

function firstNumber_(values) {
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  }
  return null;
}

function extractTafIssue_(item) {
  const candidates = [item.issueTime, item.issue_time, item.bulletinTime, item.bulletin_time, item.dbPopTime];
  for (let i = 0; i < candidates.length; i++) {
    const d = parseDate_(candidates[i]);
    if (d) return d;
  }
  const raw = String(item.rawTAF || item.rawText || item.raw || '');
  const m = raw.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  if (!m) return null;
  const now = new Date();
  const year = now.getUTCFullYear(), month = now.getUTCMonth();
  const day = Number(m[1]), hour = Number(m[2]), minute = Number(m[3]);
  let d = new Date(Date.UTC(year, month, day, hour, minute));
  if (d.getTime() - now.getTime() > 7 * 86400000) d = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (now.getTime() - d.getTime() > 35 * 86400000) d = new Date(Date.UTC(year, month + 1, day, hour, minute));
  return d;
}

function findBestTimestamp_(obj) {
  const found = [];
  walk_(obj, '', found);
  if (!found.length) return null;
  found.sort((a, b) => b.score - a.score || b.date.getTime() - a.date.getTime());
  return found[0].date;
}

function walk_(value, path, found) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk_(v, `${path}[${i}]`, found));
    return;
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach(k => walk_(value[k], path ? `${path}.${k}` : k, found));
    return;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const d = parseDate_(value);
  if (!d) return;
  const y = d.getUTCFullYear();
  if (y < 2020 || y > 2100) return;
  const p = path.toLowerCase();
  let score = 0;
  if (p.includes('last')) score += 5;
  if (p.includes('receiv')) score += 5;
  if (p.includes('update')) score += 4;
  if (p.includes('hml')) score += 4;
  if (p.includes('time')) score += 2;
  if (p.includes('date')) score += 1;
  if (score) found.push({ date: d, score });
}