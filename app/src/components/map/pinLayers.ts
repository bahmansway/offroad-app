import { palettes, type Scheme } from '../../lib/theme';

/**
 * Spot pins as a clustered MapLibre GeoJSON source (SPEC-v6 §5). ONE piece of plain ES5 code, used by both maps:
 * - native: pasted into the WebView page (Hermes keeps no function source, so it has to be a string)
 * - web: turned into a function with `new Function` (the server sends no CSP that blocks it)
 *
 * `PIN_LAYERS_JS` is a function expression `(map, cfg) → api`:
 *   cfg  = { pal: PinPalette, onPin(id), onRegion(lat,lng,zoom) }
 *   api  = { diff({add,update,remove}), select(id|null), palette(pal) }
 * Pins are drawn on a canvas once per colour set (teardrop + level number / tent) and added as map images;
 * clusters are ink circles with a 3 px white ring and the count. Region changes are debounced (250 ms).
 * Everything that reaches the page is data we built (numbers, our own ids and colours), never HTML.
 */
export interface PinPalette {
  pin: string; pinStroke: string; pinText: string;
  camp: string;
  sel: string; selText: string;
  ink: string; onInk: string;
}

export function pinPalette(scheme: Scheme): PinPalette {
  const c = palettes[scheme];
  const dark = scheme === 'dark';
  return {
    pin: dark ? '#2C2C2E' : '#FFFFFF',
    pinStroke: dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.38)',
    pinText: dark ? '#FFFFFF' : '#1C1C1E',
    camp: c.forest,
    sel: c.tint,
    selText: c.onTint,
    ink: c.ink,
    onInk: c.onInk,
  };
}

/** JSON that is also safe inside a <script> and an injected JS string. */
const LS = new RegExp(String.fromCharCode(0x2028), 'g');
const PS = new RegExp(String.fromCharCode(0x2029), 'g');
export function safeJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(LS, '\\u2028').replace(PS, '\\u2029');
}

export const PIN_LAYERS_JS = `function(map, cfg){
  var store = {}, sel = null, pal = cfg.pal, regionTimer = null, countImgs = {};
  var DROP = 'M20 46C20 46 4 30 4 18a16 16 0 0 1 32 0c0 12-16 28-16 28Z';
  var TENT = 'M12 25 20 12l8 13Z M20 25l-2.5-4h5Z';
  function fc(only){
    var f = [];
    for (var k in store) { if (Object.prototype.hasOwnProperty.call(store, k)) {
      var p = store[k];
      if (only !== undefined && p.id !== only) continue;
      f.push({ type: 'Feature', properties: { id: p.id, k: p.k, l: p.l }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } });
    } }
    return { type: 'FeatureCollection', features: f };
  }
  function draw(fill, stroke, sw, text, textColor, tent){
    var r = 2, cv = document.createElement('canvas'); cv.width = 44 * r; cv.height = 52 * r;
    var g = cv.getContext('2d'); g.scale(r, r); g.translate(2, 1);
    g.shadowColor = 'rgba(0,0,0,0.3)'; g.shadowBlur = 6; g.shadowOffsetY = 2;
    var d = new Path2D(DROP); g.fillStyle = fill; g.fill(d);
    g.shadowColor = 'transparent'; g.lineWidth = sw; g.strokeStyle = stroke; g.stroke(d);
    if (tent) { g.lineWidth = 2; g.lineJoin = 'round'; g.strokeStyle = textColor; g.stroke(new Path2D(TENT)); }
    else { g.fillStyle = textColor; g.font = '800 15px -apple-system, Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 20, 18.5); }
    return g.getImageData(0, 0, cv.width, cv.height);
  }
  function images(force){
    var list = [];
    for (var l = 0; l <= 5; l++) {
      var n = l === 0 ? '?' : String(l);
      list.push(['or-t' + l, draw(pal.pin, pal.pinStroke, 1, n, pal.pinText, false)]);
      list.push(['or-t' + l + 's', draw(pal.sel, '#FFFFFF', 2, n, pal.selText, false)]);
    }
    list.push(['or-c', draw(pal.camp, '#FFFFFF', 2, '', '#FFFFFF', true)]);
    list.push(['or-cs', draw(pal.sel, '#FFFFFF', 2, '', pal.selText, true)]);
    list.forEach(function(x){
      if (map.hasImage(x[0])) { if (!force) return; map.removeImage(x[0]); }
      map.addImage(x[0], x[1], { pixelRatio: 2 });
    });
  }
  // cluster = ink circle, 3 px white ring, count in the middle; drawn on demand per count, so no map fonts are needed
  function cluster(text){
    var n = parseInt(text, 10) || 0, d = n >= 50 || /k/.test(text) ? 52 : n >= 10 ? 46 : 42, r = 2;
    var cv = document.createElement('canvas'); cv.width = (d + 8) * r; cv.height = (d + 8) * r;
    var g = cv.getContext('2d'); g.scale(r, r);
    g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowBlur = 8; g.shadowOffsetY = 3;
    g.beginPath(); g.arc((d + 8) / 2, (d + 8) / 2 - 1, d / 2 - 1.5, 0, Math.PI * 2); g.fillStyle = pal.ink; g.fill();
    g.shadowColor = 'transparent'; g.lineWidth = 3; g.strokeStyle = '#FFFFFF'; g.stroke();
    g.fillStyle = pal.onInk; g.font = '800 15px -apple-system, Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, (d + 8) / 2, (d + 8) / 2);
    return g.getImageData(0, 0, cv.width, cv.height);
  }
  map.on('styleimagemissing', function(e){
    var id = e && e.id;
    if (typeof id !== 'string' || id.indexOf('or-n-') !== 0 || map.hasImage(id)) return;
    map.addImage(id, cluster(id.slice(5)), { pixelRatio: 2 }); countImgs[id] = true;
  });
  var ICON = ['case', ['==', ['get', 'k'], 'camp'], 'or-c', ['concat', 'or-t', ['to-string', ['get', 'l']]]];
  var ICON_SEL = ['case', ['==', ['get', 'k'], 'camp'], 'or-cs', ['concat', 'or-t', ['to-string', ['get', 'l']], 's']];
  var installing = false;
  // Adding images/sources fires 'styledata' synchronously: the guard stops that from calling install() again.
  function install(force){
    if (installing || !map.isStyleLoaded()) return;
    installing = true;
    try { setup(force === true); } finally { installing = false; }
  }
  function setup(force){
    images(force);
    if (!map.getSource('or')) map.addSource('or', { type: 'geojson', data: fc(), cluster: true, clusterRadius: 48, clusterMaxZoom: 12 });
    if (!map.getSource('or-s')) map.addSource('or-s', { type: 'geojson', data: fc(sel === null ? '\\u0000' : sel) });
    if (!map.getLayer('or-cl')) map.addLayer({ id: 'or-cl', type: 'symbol', source: 'or', filter: ['has', 'point_count'],
      layout: { 'icon-image': ['concat', 'or-n-', ['to-string', ['get', 'point_count_abbreviated']]], 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    if (!map.getLayer('or-pin')) map.addLayer({ id: 'or-pin', type: 'symbol', source: 'or', filter: ['!', ['has', 'point_count']],
      layout: { 'icon-image': ICON, 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    if (!map.getLayer('or-sel')) map.addLayer({ id: 'or-sel', type: 'symbol', source: 'or-s',
      layout: { 'icon-image': ICON_SEL, 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': 1.12 } });
  }
  function refresh(){
    var s = map.getSource('or'); if (s) s.setData(fc());
    var s2 = map.getSource('or-s'); if (s2) s2.setData(fc(sel === null ? '\\u0000' : sel));
  }
  map.on('load', install);
  map.on('style.load', install);
  map.on('styledata', function(){ if (!map.getSource('or')) install(); });
  map.on('click', 'or-pin', function(e){ var f = e.features && e.features[0]; if (f) { e.originalEvent && e.originalEvent.stopPropagation && e.originalEvent.stopPropagation(); e.orHit = true; cfg.onPin(String(f.properties.id)); } });
  map.on('click', 'or-sel', function(e){ var f = e.features && e.features[0]; if (f) { e.orHit = true; cfg.onPin(String(f.properties.id)); } });
  map.on('click', 'or-cl', function(e){
    var f = e.features && e.features[0]; if (!f) return; e.orHit = true;
    var src = map.getSource('or'), center = f.geometry.coordinates;
    var p = src.getClusterExpansionZoom(f.properties.cluster_id);
    var go = function(z){ map.easeTo({ center: center, zoom: Math.min(z, 16) + 0.2 }); };
    if (p && p.then) p.then(go, function(){}); else go(map.getZoom() + 2);
  });
  ['or-pin', 'or-sel', 'or-cl'].forEach(function(id){
    map.on('mouseenter', id, function(){ map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, function(){ map.getCanvas().style.cursor = ''; });
  });
  map.on('moveend', function(){
    if (regionTimer) clearTimeout(regionTimer);
    regionTimer = setTimeout(function(){ var c = map.getCenter().wrap(); cfg.onRegion(c.lat, c.lng, map.getZoom()); }, 250);
  });
  function ok(p){ return p && typeof p.id === 'string' && isFinite(p.lat) && isFinite(p.lng) && (p.k === 'trail' || p.k === 'camp') && p.l >= 0 && p.l <= 5; }
  return {
    hit: function(point){ return map.queryRenderedFeatures(point, { layers: ['or-pin', 'or-sel', 'or-cl'].filter(function(l){ return !!map.getLayer(l); }) }).length > 0; },
    diff: function(d){
      (d.remove || []).forEach(function(id){ delete store[id]; });
      (d.add || []).concat(d.update || []).forEach(function(p){ if (ok(p)) store[p.id] = { id: p.id, lat: Number(p.lat), lng: Number(p.lng), k: p.k, l: Number(p.l) | 0 }; });
      refresh();
    },
    select: function(id){ sel = typeof id === 'string' ? id : null; var s2 = map.getSource('or-s'); if (s2) s2.setData(fc(sel === null ? '\\u0000' : sel)); },
    palette: function(p){
      pal = p;
      // count circles are redrawn in the new colours the next time they are needed
      for (var k in countImgs) { if (map.hasImage(k)) map.removeImage(k); }
      countImgs = {};
      install(true);
    }
  };
}`;
