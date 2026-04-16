/* ═══════════════════════════════════════════════════
   AUTHORITY BRANDS TERRITORY INTELLIGENCE SUITE v4
   Polygon map (Columbus) · Clockface · 3 modes
   Real availability data from CSVs
   ═══════════════════════════════════════════════════ */

let map, zipLayer, footprintLayer;
let config, availability, demographics, footprints;
let zipFeatureMap = new Map();
let zipMetaMap = new Map();

let selectedMode = 'availability';
let activeBrand = null;
let activeRankZip = null;
let centerMarker = null;
let clockfaceVisible = false;

const COLUMBUS = [39.9612, -82.9988];

const MODE_META = {
  availability: {
    title: 'Availability Checker',
    description: 'Which ZIPs are open vs closed for this brand. Green = open territory, red = assigned. Click any ZIP for details.',
  },
  penetration: {
    title: 'Market Penetration',
    description: 'Footprint depth: dark fills show existing unit locations, size of the fill indicates coverage intensity. Light green = open white space with no units yet.',
  },
  ranker: {
    title: 'Opportunity Ranker',
    description: 'Every open ZIP scored 0-100 by demographics, gap, growth, and saturation. Heat colors show where expansion is smartest — not just where territory exists.',
  },
};

const fmt = new Intl.NumberFormat('en-US');
const fmtCur = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtPct = v => `${v}%`;

/* ═══ BOOT ═══ */
async function boot() {
  if (location.protocol === 'file:') {
    document.body.innerHTML = `
      <div style="font-family:system-ui;max-width:540px;margin:80px auto;padding:32px;background:#141d20;border:1px solid #2a3a3e;border-radius:16px;color:#e8f0f2;text-align:center">
        <h2 style="margin:0 0 12px;color:#1fa497">Local Server Required</h2>
        <p style="color:#9ab0b6;line-height:1.6;margin:0 0 16px">Run a local server in the suite folder:</p>
        <div style="background:#0c1214;border-radius:8px;padding:16px;text-align:left;font-family:monospace;font-size:13px;color:#1fa497">npx serve .</div>
        <p style="color:#607a82;font-size:12px;margin:12px 0 0">Then open <strong>http://localhost:3000</strong></p>
      </div>`;
    return;
  }

  try {
    [config, availability, demographics, footprints] = await Promise.all([
      fetch('data/config.json').then(r => { if (!r.ok) throw new Error('config'); return r.json(); }),
      fetch('data/availability.json').then(r => { if (!r.ok) throw new Error('availability'); return r.json(); }),
      fetch('data/demographics.json').then(r => { if (!r.ok) throw new Error('demographics'); return r.json(); }),
      fetch('data/footprints.json').then(r => r.json()).catch(() => []),
    ]);
  } catch (err) {
    document.getElementById('map').innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#e05252;padding:40px;text-align:center;font-family:system-ui"><strong>Failed to load ${err.message}.json</strong></div>`;
    return;
  }

  demographics.forEach(m => zipMetaMap.set(m.zip, m));

  initMap();
  await loadGeo();
  bindUI();
  updateModeUI();
  renderCurrentMode();
}
document.addEventListener('DOMContentLoaded', boot);

/* ═══ MAP ═══ */
function initMap() {
  map = L.map('map', { attributionControl: false, zoomControl: false }).setView(COLUMBUS, 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

  const cf = document.getElementById('clockface');
  if (cf) map.getContainer().appendChild(cf);
  map.on('move zoom', positionClockface);
}

async function loadGeo() {
  const geo = await fetch('data/columbus-zips.geojson').then(r => r.json());

  zipLayer = L.geoJSON(geo, {
    style: baseStyle,
    onEachFeature(feature, layer) {
      const zip = feature.properties.zip;
      zipFeatureMap.set(zip, layer);
      layer.options.zipCode = zip;

      layer.on('mouseover', () => {
        if (!activeBrand) return;
        layer.bindTooltip(buildTooltip(zip), { sticky: true, direction: 'top', className: 'zip-tooltip' }).openTooltip();
        layer.setStyle({ weight: 2.5 });
      });

      layer.on('mouseout', () => {
        layer.setStyle(styleForZip(zip));
        layer.closeTooltip();
      });

      layer.on('click', () => {
        if (!activeBrand) return;
        showZipDetails(zip);
        if (selectedMode === 'ranker') {
          activeRankZip = zip;
          renderCurrentMode();
          triggerAIAdvisor(zip);
        }
      });
    },
  }).addTo(map);

  footprintLayer = L.layerGroup().addTo(map);
}

/* ═══ UI ═══ */
function bindUI() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedMode = btn.dataset.mode;
      activeRankZip = null;
      updateModeUI();
      renderCurrentMode();
    });
  });

  document.getElementById('resetViewBtn').addEventListener('click', () => {
    map.setView(COLUMBUS, activeBrand ? 10 : 7);
    activeRankZip = null;
    renderCurrentMode();
  });

  document.getElementById('exportBtn').addEventListener('click', handleExport);
  document.getElementById('rerankBtn').addEventListener('click', () => { activeRankZip = null; renderCurrentMode(); });

  setupSearch();
}

/* ═══ SEARCH ═══ */
function setupSearch() {
  const input = document.getElementById('locationInput');
  const popup = document.getElementById('locationPopup');

  const item = document.createElement('div');
  item.className = 'loc-item';
  item.textContent = 'Columbus, OH';
  popup.appendChild(item);

  input.addEventListener('input', () => {
    const v = input.value.trim().toLowerCase();
    (v.length >= 2 && ('columbus'.startsWith(v) || v.startsWith('col') || v.startsWith('432')))
      ? popup.classList.add('show') : popup.classList.remove('show');
  });

  item.addEventListener('mousedown', e => {
    e.preventDefault();
    input.value = 'Columbus, OH';
    popup.classList.remove('show');
    goColumbus();
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.value = 'Columbus, OH';
      popup.classList.remove('show');
      goColumbus();
    }
  });

  document.addEventListener('click', e => {
    if (!popup.contains(e.target) && e.target !== input) popup.classList.remove('show');
  });
}

function goColumbus() {
  map.setView(COLUMBUS, 11);
  if (centerMarker) map.removeLayer(centerMarker);
  centerMarker = L.marker(COLUMBUS).addTo(map);
  centerMarker.bindTooltip('COLUMBUS', { permanent: true, direction: 'bottom', offset: [-14, 24] });
  showClockface();
}

/* ═══ CLOCKFACE ═══ */
function positionClockface() {
  const cf = document.getElementById('clockface');
  if (!cf || cf.classList.contains('hidden')) return;
  const pt = map.latLngToContainerPoint(COLUMBUS);
  cf.style.left = `${pt.x - 130}px`;
  cf.style.top = `${pt.y - 130}px`;
}

function showClockface() {
  const cf = document.getElementById('clockface');
  const box = document.getElementById('clockfaceBrands');
  if (!cf || !box) return;
  cf.classList.remove('hidden');
  clockfaceVisible = true;
  box.innerHTML = '';
  positionClockface();
  syncClockface();

  config.brands.forEach((b, i) => {
    const angle = (i / config.brands.length) * 2 * Math.PI - Math.PI / 2;
    const x = 130 + 100 * Math.cos(angle) - 27;
    const y = 130 + 100 * Math.sin(angle) - 27;
    const node = document.createElement('div');
    node.className = 'brand-node' + (activeBrand === b.id ? ' is-selected' : '');
    node.dataset.brand = b.id;
    Object.assign(node.style, { left: x + 'px', top: y + 'px' });
    node.innerHTML = `<img src="${b.icon}" alt="${b.name}"/>`;
    node.addEventListener('click', e => { e.stopPropagation(); pickBrand(b.id); });
    box.appendChild(node);
  });
}

function syncClockface() {
  const cf = document.getElementById('clockface');
  const label = document.getElementById('clockfaceLabel');
  if (!cf || !clockfaceVisible) return;
  cf.classList.toggle('has-selection', !!activeBrand);
  label.textContent = activeBrand ? (config.brands.find(b => b.id === activeBrand)?.name || '') : 'Select a brand';
  document.querySelectorAll('.brand-node').forEach(n => n.classList.toggle('is-selected', n.dataset.brand === activeBrand));
}

function pickBrand(id) {
  activeBrand = activeBrand === id ? null : id;
  activeRankZip = null;
  syncClockface();
  updateBrandCard();
  renderCurrentMode();
}

function updateBrandCard() {
  const el = document.getElementById('brandCardInner');
  if (!activeBrand) {
    el.innerHTML = `<div class="bc-placeholder"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg><span>Search Columbus → pick a brand</span></div>`;
    return;
  }
  const b = config.brands.find(b => b.id === activeBrand);
  el.innerHTML = `<div class="bc-active"><img src="${b.icon}" alt="${b.name}"/><div class="bc-meta"><div class="bc-name">${b.name}</div><div class="bc-profile">${b.profile.replace('-',' ')}</div></div><button class="bc-clear" id="bcClear">×</button></div>`;
  document.getElementById('bcClear').addEventListener('click', () => pickBrand(activeBrand));
}

/* ═══ MODE UI ═══ */
function updateModeUI() {
  document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.toggle('is-active', btn.dataset.mode === selectedMode));
  document.getElementById('modeTitle').textContent = MODE_META[selectedMode].title;
  document.getElementById('modeDescription').textContent = MODE_META[selectedMode].description;
  document.getElementById('rankingPanel').style.display = selectedMode === 'ranker' ? 'block' : 'none';
  document.getElementById('aiPanel').style.display = selectedMode === 'ranker' ? 'block' : 'none';
}

/* ═══ RENDER ═══ */
function renderCurrentMode() {
  footprintLayer.clearLayers();

  zipLayer.eachLayer(layer => {
    layer.setStyle(styleForZip(layer.options.zipCode));
  });

  if (selectedMode === 'penetration' && activeBrand) renderFootprints();
  if (selectedMode === 'ranker' && activeBrand) renderRankings();

  renderLegend();
  renderSummary();
  renderStatsBar();
  renderDefaultDetails();
}

/* ═══ ZIP STYLES ═══ */
function baseStyle() {
  return { color: '#2a4045', weight: 0.8, fillColor: '#1a2e33', fillOpacity: 0.15 };
}

function styleForZip(zip) {
  if (!activeBrand) return baseStyle();
  const status = availability[activeBrand]?.[zip];
  const fpCount = fpByZip()[zip] || 0;

  /* MODE 1: AVAILABILITY — simple green/red */
  if (selectedMode === 'availability') {
    if (status === 'available') return { color: '#2d6b4a', weight: 1, fillColor: '#4fae61', fillOpacity: 0.45 };
    if (status === 'unavailable') return { color: '#6b3a38', weight: 1, fillColor: '#e05252', fillOpacity: 0.4 };
    return baseStyle();
  }

  /* MODE 2: PENETRATION — footprint intensity + white space */
  if (selectedMode === 'penetration') {
    if (fpCount > 0) {
      const brandColor = config.brands.find(b => b.id === activeBrand)?.color || '#1fa497';
      const intensity = Math.min(0.75, 0.35 + fpCount * 0.12);
      return { color: brandColor, weight: 2, fillColor: brandColor, fillOpacity: intensity };
    }
    if (status === 'available') {
      // White space: dim green, dashed border
      return { color: '#3a6a50', weight: 1, fillColor: '#4fae61', fillOpacity: 0.12, dashArray: '4 3' };
    }
    // Closed: barely visible
    return { color: '#2a3538', weight: 0.5, fillColor: '#1e2e32', fillOpacity: 0.08 };
  }

  /* MODE 3: OPPORTUNITY — heat gradient by score */
  if (selectedMode === 'ranker') {
    if (status === 'unavailable') {
      return { color: '#2a3538', weight: 0.5, fillColor: '#1e2e32', fillOpacity: 0.08 };
    }
    const score = computeScore(zip).total;
    let fillColor, fillOpacity;
    if (score >= 78) { fillColor = '#00e68a'; fillOpacity = 0.6; }
    else if (score >= 68) { fillColor = '#52d67a'; fillOpacity = 0.5; }
    else if (score >= 58) { fillColor = '#d4a72c'; fillOpacity = 0.45; }
    else if (score >= 45) { fillColor = '#d88d4a'; fillOpacity = 0.38; }
    else { fillColor = '#8a6050'; fillOpacity = 0.25; }

    const isActive = activeRankZip === zip;
    return {
      color: isActive ? '#fff' : '#3a5a50',
      weight: isActive ? 3 : 1,
      fillColor, fillOpacity: isActive ? fillOpacity + 0.15 : fillOpacity,
    };
  }

  return baseStyle();
}

/* ═══ TOOLTIPS ═══ */
function buildTooltip(zip) {
  const m = zipMetaMap.get(zip);
  if (!m) return `ZIP ${zip}`;
  const status = availability[activeBrand]?.[zip];

  if (selectedMode === 'availability') {
    return `<strong>ZIP ${zip}</strong> · ${m.city}<br>` +
      (status === 'available' ? '<span style="color:#4fae61">● Open territory</span>' :
       status === 'unavailable' ? '<span style="color:#e05252">● Closed</span>' : '—');
  }

  if (selectedMode === 'penetration') {
    const units = fpByZip()[zip] || 0;
    return `<strong>ZIP ${zip}</strong> · ${m.city}<br>` +
      `Households: <strong>${fmt.format(m.households)}</strong><br>` +
      `Units here: <strong>${units}</strong><br>` +
      (units > 0 ? `<span style="color:${config.brands.find(b=>b.id===activeBrand)?.color}">● Active coverage</span>` :
       status === 'available' ? '<span style="color:#4fae61">● White space — no units</span>' : '<span style="color:#607a82">Closed</span>');
  }

  // Ranker
  const s = computeScore(zip);
  const scoreColor = s.total >= 68 ? '#00e68a' : s.total >= 58 ? '#d4a72c' : '#d88d4a';
  return `<strong>ZIP ${zip}</strong> · ${m.city}<br>` +
    `<span style="font-size:14px;font-weight:800;color:${scoreColor}">Score: ${s.total}/100</span><br>` +
    `HH: ${fmt.format(m.households)} · Income: ${fmtCur.format(m.median_income)}<br>` +
    `Growth: ${m.growth_rate}% · Gap: ${s.gap}pts`;
}

/* ═══ LEGEND ═══ */
function renderLegend() {
  const el = document.getElementById('floatingLegend');
  if (!activeBrand) {
    el.innerHTML = `<div class="legend-title">Getting Started</div><div style="font-size:11px;color:var(--text-3)">Search "Columbus" to begin</div>`;
    return;
  }
  if (selectedMode === 'availability') {
    el.innerHTML = `<div class="legend-title">Availability</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#4fae61"></span>Open territory</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#e05252"></span>Closed / assigned</div>`;
  } else if (selectedMode === 'penetration') {
    const bc = config.brands.find(b => b.id === activeBrand)?.color;
    el.innerHTML = `<div class="legend-title">Penetration</div>
      <div class="legend-row"><span class="legend-swatch" style="background:${bc}"></span>Active units (darker = more)</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#4fae61;opacity:.3"></span>Open white space</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#1e2e32"></span>Closed</div>`;
  } else {
    el.innerHTML = `<div class="legend-title">Opportunity Score</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#00e68a"></span>Excellent (78+)</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#52d67a"></span>High (68-77)</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#d4a72c"></span>Medium (58-67)</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#d88d4a"></span>Moderate (45-57)</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#1e2e32"></span>Closed</div>`;
  }
}

/* ═══ FOOTPRINTS (penetration mode) ═══ */
function renderFootprints() {
  if (!footprints?.length) return;
  const bc = config.brands.find(b => b.id === activeBrand)?.color || '#1fa497';
  footprints.filter(f => f.brand_id === activeBrand).forEach(f => {
    const icon = L.divIcon({
      className: '',
      html: `<div class="custom-point-icon" style="background:${bc}"></div>`,
      iconSize: [12, 12], iconAnchor: [6, 6],
    });
    L.marker([f.lat, f.lng], { icon })
      .bindPopup(`<strong>${f.location_name}</strong><br>${f.zip}, ${f.city}<br>Units: ${f.units}`)
      .addTo(footprintLayer);
  });
}

/* ═══ SUMMARY ═══ */
function renderSummary() {
  const wrap = document.getElementById('summaryMetrics');
  if (!activeBrand) {
    wrap.innerHTML = '<div style="grid-column:1/-1;color:var(--text-3);font-size:12px">No brand selected</div>';
    return;
  }

  const brandMap = availability[activeBrand] || {};
  const mapZips = [...zipFeatureMap.keys()];
  const openOnMap = mapZips.filter(z => brandMap[z] === 'available').length;
  const closedOnMap = mapZips.filter(z => brandMap[z] === 'unavailable').length;
  const totalRegionClosed = Object.values(brandMap).filter(v => v === 'unavailable').length;

  let metrics;
  if (selectedMode === 'availability') {
    metrics = [
      { label: 'Columbus Open', value: fmt.format(openOnMap) },
      { label: 'Columbus Closed', value: fmt.format(closedOnMap) },
      { label: 'Region Closed', value: fmt.format(totalRegionClosed) },
      { label: 'Open Rate', value: `${Math.round(openOnMap / mapZips.length * 100)}%` },
    ];
  } else if (selectedMode === 'penetration') {
    const fp = fpByZip();
    const covered = mapZips.filter(z => fp[z] > 0).length;
    const whiteSpace = mapZips.filter(z => brandMap[z] === 'available' && !fp[z]).length;
    const totalUnits = footprints ? footprints.filter(f => f.brand_id === activeBrand).reduce((s, f) => s + (f.units || 1), 0) : 0;
    metrics = [
      { label: 'Covered ZIPs', value: fmt.format(covered) },
      { label: 'White Space', value: fmt.format(whiteSpace) },
      { label: 'Total Units', value: fmt.format(totalUnits) },
      { label: 'Coverage', value: `${Math.round(covered / mapZips.length * 100)}%` },
    ];
  } else {
    const ranked = getTopRanked(8);
    const top = ranked[0];
    const strong = ranked.filter(r => r.score >= 70).length;
    metrics = [
      { label: 'Top ZIP', value: top?.zip || '—' },
      { label: 'Top Score', value: top ? `${top.score}` : '—' },
      { label: 'Score 70+', value: fmt.format(strong) },
      { label: 'Rankable', value: fmt.format(ranked.length) },
    ];
  }
  wrap.innerHTML = metrics.map(m => `<div class="metric-card"><div class="label">${m.label}</div><div class="value">${m.value}</div></div>`).join('');
}

/* ═══ STATS BAR ═══ */
function renderStatsBar() {
  const bar = document.getElementById('statsBar');
  if (!activeBrand) { bar.innerHTML = ''; return; }

  const brandMap = availability[activeBrand] || {};
  const totalRegionClosed = Object.values(brandMap).filter(v => v === 'unavailable').length;
  const totalRegionAll = Object.keys(brandMap).length;
  const avgIncome = Math.round(meanValue(demographics.map(m => m.median_income)));
  const avgGrowth = meanValue(demographics.map(m => m.growth_rate)).toFixed(1);
  const totalHH = demographics.reduce((s, m) => s + m.households, 0);

  bar.innerHTML = [
    { val: '45', lbl: 'Columbus ZIPs' },
    { val: fmt.format(totalRegionClosed), lbl: 'Region Closed' },
    { val: fmt.format(totalHH), lbl: 'Columbus HH' },
    { val: fmtCur.format(avgIncome), lbl: 'Avg Income' },
    { val: `${avgGrowth}%`, lbl: 'Avg Growth' },
  ].map(s => `<div class="stat-cell"><div class="stat-val">${s.val}</div><div class="stat-lbl">${s.lbl}</div></div>`).join('');
}

/* ═══ DEFAULT DETAILS ═══ */
function renderDefaultDetails() {
  const t = document.getElementById('detailsTitle');
  const c = document.getElementById('detailsContent');
  if (!activeBrand) {
    t.textContent = 'Getting Started';
    c.innerHTML = `<div class="detail-group"><div class="muted-text">Type "Columbus" in the search bar, then click a brand on the clockface to see territory data.</div></div>`;
    return;
  }
  const b = config.brands.find(b => b.id === activeBrand);
  if (selectedMode === 'availability') {
    t.textContent = 'How to Read';
    c.innerHTML = `<div class="detail-group"><div class="detail-heading">${b.name}</div><div class="muted-text">Green ZIPs = open territory. Red = closed/assigned. Click any ZIP for demographics. Availability data from real CSV export.</div></div>`;
  } else if (selectedMode === 'penetration') {
    t.textContent = 'Coverage Map';
    c.innerHTML = `<div class="detail-group"><div class="detail-heading">Footprint + White Space</div><div class="muted-text">Bright colored ZIPs have active ${b.name} units — darker = more units. Dashed-border ZIPs are open with no coverage. Look for open ZIPs near existing clusters — natural expansion.</div></div>`;
  } else {
    t.textContent = 'Scoring Method';
    c.innerHTML = `<div class="detail-group"><div class="detail-heading">Opportunity Formula</div>
      <div class="kv"><span>Territory open</span><span>25 pts</span></div>
      <div class="kv"><span>No existing units</span><span>25 pts</span></div>
      <div class="kv"><span>Demographic fit</span><span>30 pts</span></div>
      <div class="kv"><span>Growth rate</span><span>10 pts</span></div>
      <div class="kv"><span>Saturation penalty</span><span>−10 pts</span></div>
      <div class="muted-text" style="margin-top:8px;font-size:11px">Click a colored ZIP to see breakdown + AI analysis.</div></div>`;
  }
}

/* ═══ ZIP DETAILS ═══ */
function showZipDetails(zip) {
  const m = zipMetaMap.get(zip);
  if (!m || !activeBrand) return;
  const status = availability[activeBrand]?.[zip];
  const closed = status === 'unavailable';
  const units = fpByZip()[zip] || 0;
  const s = computeScore(zip);

  document.getElementById('detailsTitle').textContent = `ZIP ${zip}`;
  document.getElementById('detailsContent').innerHTML = `
    <div class="detail-group"><div class="detail-heading">${m.city}, ${m.state}</div>
      <div class="kv"><span>Households</span><span>${fmt.format(m.households)}</span></div>
      <div class="kv"><span>Median Income</span><span>${fmtCur.format(m.median_income)}</span></div>
      <div class="kv"><span>Growth</span><span>${m.growth_rate}%</span></div>
      <div class="kv"><span>Senior Pop.</span><span>${m.senior_pct}%</span></div>
      <div class="kv"><span>Family Share</span><span>${m.family_pct}%</span></div>
      <div class="kv"><span>Competition</span><span>${m.competition_score}/10</span></div>
      <div class="kv"><span>Market Health</span><span>${m.market_health_score}/100</span></div></div>
    <div class="detail-group"><div class="detail-heading">Brand Status</div>
      <div class="kv"><span>Territory</span><span style="color:${closed?'var(--danger)':'var(--success)'}">${closed?'Closed':'Open'}</span></div>
      <div class="kv"><span>Local Units</span><span>${units}</span></div>
      <div class="kv"><span>Opp. Score</span><span style="font-size:16px;color:var(--brand)">${s.total}</span></div></div>
    ${!closed ? `<div class="detail-group"><div class="detail-heading">Score Breakdown</div>
      <div class="kv"><span>Availability</span><span>+${s.avail}</span></div>
      <div class="kv"><span>Gap</span><span>+${s.gap}</span></div>
      <div class="kv"><span>Demo Fit</span><span>+${s.demo}</span></div>
      <div class="kv"><span>Growth</span><span>+${s.growth}</span></div>
      <div class="kv"><span>Saturation</span><span>−${s.penalty}</span></div></div>` : ''}`;
}

/* ═══ RANKINGS ═══ */
function renderRankings() {
  if (!activeBrand) return;
  const ranked = getTopRanked(10);
  const list = document.getElementById('rankingList');
  list.innerHTML = ranked.map((r, i) => `
    <div class="ranking-item ${activeRankZip===r.zip?'is-active':''}" data-zip="${r.zip}">
      <div class="topline"><div><div class="rank-label">#${i+1} · ${r.city}</div><div class="rank-title">${r.zip}</div></div><div class="score-badge">${r.score}</div></div>
      <div class="rank-sub">${r.summary}</div></div>`).join('');

  list.querySelectorAll('.ranking-item').forEach(node => {
    node.addEventListener('click', () => {
      const zip = node.dataset.zip;
      activeRankZip = zip;
      const m = zipMetaMap.get(zip);
      if (m) map.setView([m.lat, m.lng], 12);
      showZipDetails(zip);
      renderCurrentMode();
      triggerAIAdvisor(zip);
    });
  });
}

/* ═══ AI ADVISOR ═══ */
function triggerAIAdvisor(zip) {
  const el = document.getElementById('aiContent');
  const m = zipMetaMap.get(zip);
  const brand = config.brands.find(b => b.id === activeBrand);
  const s = computeScore(zip);
  if (!m || !brand) return;

  el.innerHTML = `<div class="ai-loading">Analyzing territory<div class="dot-pulse"><span></span><span></span><span></span></div></div>`;

  const prompt = `You are a franchise territory expansion advisor for ${brand.name} (${brand.profile}). Analyze ZIP ${zip} in ${m.city}, ${m.state}. Households: ${m.households}, Income: $${m.median_income}, Growth: ${m.growth_rate}%, Senior: ${m.senior_pct}%, Family: ${m.family_pct}%, Competition: ${m.competition_score}/10, Health: ${m.market_health_score}/100, Score: ${s.total}/100. Give 3-4 sentences of direct strategic advice. Be specific. End with one recommendation. No bullets or headers.`;

  fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
  })
    .then(r => r.json())
    .then(data => {
      const text = data.content?.map(c => c.text || '').join('') || fallback(zip, brand, m, s);
      showAI(zip, m, brand, s, text);
    })
    .catch(() => showAI(zip, m, brand, s, fallback(zip, brand, m, s)));
}

function showAI(zip, m, brand, s, text) {
  document.getElementById('aiContent').innerHTML = `<div class="ai-result"><h4>ZIP ${zip} · ${m.city}, ${m.state}</h4><p>${text}</p><div><span class="ai-tag">Score: ${s.total}</span><span class="ai-tag">${m.households>8000?'High density':'Moderate'}</span><span class="ai-tag">${m.growth_rate>2?'Growing':'Stable'}</span>${brand.profile==='senior-care'&&m.senior_pct>18?'<span class="ai-tag">Senior-rich</span>':''}</div></div>`;
}

function fallback(zip, brand, m, s) {
  let a = `ZIP ${zip} scores ${s.total}/100 for ${brand.name}. `;
  if (m.households > 8000) a += `Strong density at ${fmt.format(m.households)} households. `;
  if (m.median_income > 65000) a += `Solid purchasing power at ${fmtCur.format(m.median_income)}. `;
  if (m.growth_rate > 2) a += `${m.growth_rate}% growth signals expanding demand. `;
  a += s.total >= 70 ? 'Recommend prioritizing for recruitment.' : 'Consider as secondary target.';
  return a;
}

/* ═══ EXPORT ═══ */
function handleExport() {
  if (!activeBrand) { alert('Select a brand first.'); return; }
  const a = document.createElement('a');
  a.href = 'assets/availabilityOutput.pdf'; a.download = `${activeBrand}-territory-report.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
}

/* ═══ SCORING ═══ */
function computeScore(zip) {
  const m = zipMetaMap.get(zip);
  if (!m) return { total: 0, avail: 0, gap: 0, demo: 0, growth: 0, penalty: 0, summary: 'No data' };
  const status = availability[activeBrand]?.[zip];
  const closed = status === 'unavailable';
  const units = fpByZip()[zip] || 0;
  const brand = config.brands.find(b => b.id === activeBrand);

  const avail = closed ? 0 : 25;
  const gap = units === 0 ? 25 : Math.max(0, 10 - units * 4);
  let demo = 0;
  demo += clamp((m.households - 5000) / 350, 0, 12);
  demo += clamp((m.median_income - 50000) / 3500, 0, 10);
  demo += brand.profile === 'senior-care' ? clamp((m.senior_pct - 12) / 1.3, 0, 10) : clamp((m.family_pct - 22) / 2.2, 0, 10);
  demo = Math.round(demo);
  const growth = Math.round(clamp(m.growth_rate * 2.5, 0, 10));
  const penalty = Math.round(clamp(m.competition_score + units * 1.5, 0, 10));
  const total = clamp(Math.round(avail + gap + demo + growth - penalty), 0, 100);

  const bits = [];
  if (m.households > 9000) bits.push(`${fmt.format(m.households)} HH`);
  if (m.median_income > 70000) bits.push(fmtCur.format(m.median_income));
  if (m.growth_rate > 2) bits.push(`${m.growth_rate}% growth`);
  const summary = closed ? 'Closed.' : `Open${units===0?', no units':`, ${units} unit(s)`}${bits.length?' · '+bits.join(', '):''}`;

  return { total, avail, gap, demo, growth, penalty, summary, city: m.city };
}

let _fpCache = null, _fpBrand = null;
function fpByZip() {
  if (_fpBrand === activeBrand && _fpCache) return _fpCache;
  _fpCache = {};
  _fpBrand = activeBrand;
  if (!footprints) return _fpCache;
  footprints.filter(f => f.brand_id === activeBrand).forEach(f => {
    _fpCache[f.zip] = (_fpCache[f.zip] || 0) + (f.units || 1);
  });
  return _fpCache;
}

function getTopRanked(limit) {
  const brandMap = availability[activeBrand] || {};
  return [...zipFeatureMap.keys()]
    .filter(z => brandMap[z] === 'available')
    .map(z => { const s = computeScore(z); return { zip: z, score: s.total, summary: s.summary, city: s.city }; })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function meanValue(v) { return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
