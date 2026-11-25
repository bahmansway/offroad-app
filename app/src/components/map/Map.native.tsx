import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import {
  BAKU_CENTER, DEFAULT_ZOOM, MAPLIBRE_CDN_VERSION, MAPLIBRE_SRI, mapStyleUrl, pinCss,
  buildPins, isAllowedExternalLink, parseMapMessage, type MapProps,
} from './shared';
import { PIN_LAYERS_JS, pinPalette, safeJson } from './pinLayers';
import { diffPins, isEmptyDiff, type PinPoint } from '../../lib/mapData';
import { palettes, type Scheme } from '../../lib/theme';
import { MapErrorCard } from '../ui/States';
import { useReduceMotion } from '../ui/Motifs';
import { useTheme } from '../../lib/themeContext';

type WebViewHandle = { injectJavaScript: (js: string) => void };
// The package's generic typings omit `ref`; the platform implementations do accept it.
const WebView = RNWebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebViewHandle> }>;

/** The page is loaded with this base URL so it has a stable, known origin. */
const PAGE_ORIGIN = 'https://offroad-map.local';

function buildHtml(center: [number, number], zoom: number, scheme: Scheme, reduceMotion: boolean): string {
  const v = MAPLIBRE_CDN_VERSION;
  const pal = palettes[scheme];
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link href="https://unpkg.com/maplibre-gl@${v}/dist/maplibre-gl.css" rel="stylesheet" integrity="${MAPLIBRE_SRI.css}" crossorigin="anonymous">
<style>html,body,#map{margin:0;height:100%;width:100%;background:${pal.mapBg}}</style><style id="pins">${pinCss(scheme, reduceMotion)}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/maplibre-gl@${v}/dist/maplibre-gl.js" integrity="${MAPLIBRE_SRI.js}" crossorigin="anonymous"></script>
<script>
(function(){
  function send(m){ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  if(!window.maplibregl){ send({type:'failed'}); return; }
  var map = new maplibregl.Map({container:'map',style:${JSON.stringify(mapStyleUrl(scheme))},center:${JSON.stringify(center)},zoom:${zoom},
    attributionControl:{compact:true},dragRotate:false,pitchWithRotate:false});
  map.touchZoomRotate.disableRotation();
  var markers=[];
  var pins=(${PIN_LAYERS_JS})(map,{pal:${safeJson(pinPalette(scheme))},
    onPin:function(id){ send({type:'spotPress',id:id}); },
    onRegion:function(lat,lng,z){ send({type:'region',lat:lat,lng:lng,zoom:z}); }});
  map.on('click',function(e){ if(pins.hit(e.point)) return; var p=e.lngLat.wrap(); send({type:'mapPress',lat:p.lat,lng:p.lng}); });
  var loadedOnce=false;
  map.on('load',function(){ loadedOnce=true; send({type:'loaded'}); });
  // A style/tile network failure before the FIRST load counts as "map failed" (same rule as the web map);
  // after that (e.g. a light/dark setStyle) the working map stays on screen.
  map.on('error',function(e){ if(!loadedOnce && !map.isStyleLoaded() && e && e.error){ send({type:'failed'}); } });
  // Attribution links open in the phone browser, not inside the map view.
  document.addEventListener('click',function(e){
    var a=e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if(a){ e.preventDefault(); send({type:'openLink',url:a.href}); }
  },true);
  // Only the changed pins come in (added / changed / removed); the page keeps the rest.
  window.__pinDiff=function(d){ pins.diff(d); };
  window.__select=function(id){ pins.select(id); };
  // The "picked" pin (new spot / meeting point) stays a DOM marker.
  window.__setPicked=function(list){
    markers.forEach(function(m){m.remove();}); markers=[];
    list.forEach(function(p){
      var el=document.createElement('div'); el.className='or-pin or-pin--picked'; el.setAttribute('aria-hidden','true'); el.innerHTML=p.html;
      markers.push(new maplibregl.Marker({element:el,anchor:'bottom'}).setLngLat([p.lng,p.lat]).addTo(map));
    });
  };
  // z === null keeps the current zoom (so placing a pin doesn't zoom the map out).
  window.__jumpTo=function(lng,lat,z){
    var o={center:[Number(lng),Number(lat)]}; if(z!==null && isFinite(z)) o.zoom=Number(z); map.jumpTo(o);
  };
  // Light/dark switch: new tile style + pin CSS. Both values come from our own constants.
  window.__setScheme=function(styleUrl,css,pal){ map.setStyle(styleUrl); pins.palette(pal); var el=document.getElementById('pins'); if(el) el.textContent=css; };
  window.__getCenter=function(reqId){ var c=map.getCenter().wrap(); send({type:'center',lat:c.lat,lng:c.lng,reqId:reqId}); };
  send({type:'ready'});
})();
</script></body></html>`;
}

const num = (n: number) => (Number.isFinite(n) ? String(Number(n)) : 'null');

export default function SpotMap(props: MapProps) {
  const web = useRef<WebViewHandle>(null);
  /** bumped on every 'ready' from the page (a reloaded page must get every pin again) */
  const [ready, setReady] = useState(0);
  const [failed, setFailed] = useState(false);
  /** bumping this remounts the WebView ("Try again" on the error card) */
  const [attempt, setAttempt] = useState(0);
  const cb = useRef(props);
  cb.current = props;
  const centerReqs = useRef(new Map<number, (c: { lat: number; lng: number } | null) => void>());
  const nextReq = useRef(1);
  const { scheme: themeScheme } = useTheme();
  const scheme = props.scheme ?? themeScheme;
  const pal = palettes[scheme];
  const shownScheme = useRef(scheme);
  const reduceMotion = useReduceMotion();
  const shownMotion = useRef(reduceMotion);

  useImperativeHandle(props.ref, () => ({
    getCenter: () =>
      new Promise((resolve) => {
        if (!ready || !web.current) return resolve(null);
        const id = nextReq.current++;
        centerReqs.current.set(id, resolve);
        web.current.injectJavaScript(`window.__getCenter(${id});true;`);
        setTimeout(() => {
          if (centerReqs.current.delete(id)) resolve(null);
        }, 2000);
      }),
  }), [ready]);

  // HTML is built once (again after "Try again"); later changes are pushed with injectJavaScript.
  const html = useMemo(
    () => buildHtml(props.center ? [props.center.lng, props.center.lat] : BAKU_CENTER, props.zoom ?? DEFAULT_ZOOM, scheme, reduceMotion),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attempt],
  );

  // Spot pins: only what changed goes into the WebView. `shown` mirrors what the page has now.
  const shown = useRef(new Map<string, PinPoint>());
  useEffect(() => {
    if (!ready) return;
    const { diff, next } = diffPins(shown.current, props.spots);
    shown.current = next;
    if (!isEmptyDiff(diff)) web.current?.injectJavaScript(`window.__pinDiff(${safeJson(diff)});true;`);
  }, [ready, props.spots]);

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.__select(${safeJson(props.selectedId ?? null)});true;`);
  }, [ready, props.selectedId]);

  // The "picked" pin (new spot / meeting point) is the only DOM marker left.
  const picked = useMemo(() => buildPins({ spots: [], picked: props.picked, pinLabel: props.pinLabel }, props.label), [props.picked?.lat, props.picked?.lng]);
  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.__setPicked(${safeJson(picked)});true;`);
  }, [ready, picked]);

  useEffect(() => {
    if (ready && shownScheme.current !== scheme) {
      shownScheme.current = scheme;
      shownMotion.current = reduceMotion;
      web.current?.injectJavaScript(`window.__setScheme(${safeJson(mapStyleUrl(scheme))},${safeJson(pinCss(scheme, reduceMotion))},${safeJson(pinPalette(scheme))});true;`);
    } else if (ready && shownMotion.current !== reduceMotion) {
      // Reduce Motion changed (or its first answer arrived): swap only the pin CSS
      shownMotion.current = reduceMotion;
      web.current?.injectJavaScript(`(function(){var el=document.getElementById('pins'); if(el) el.textContent=${JSON.stringify(pinCss(scheme, reduceMotion))};})();true;`);
    }
  }, [ready, scheme, reduceMotion]);

  useEffect(() => {
    if (ready && props.center) {
      web.current?.injectJavaScript(
        `window.__jumpTo(${num(props.center.lng)},${num(props.center.lat)},${props.zoom != null ? num(props.zoom) : 'null'});true;`,
      );
    }
  }, [ready, props.center?.lat, props.center?.lng, props.zoom]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    // Only trust messages from our own page.
    const from = e.nativeEvent.url ?? '';
    if (from && !from.startsWith(PAGE_ORIGIN) && from !== 'about:blank') return;
    const m = parseMapMessage(e.nativeEvent.data);
    if (!m) return;
    switch (m.type) {
      case 'ready': shown.current = new Map(); setReady((n) => n + 1); break;
      case 'loaded': setFailed(false); break;
      case 'failed': setFailed(true); break;
      case 'spotPress': cb.current.onSpotPress?.(m.id); break;
      case 'mapPress': cb.current.onMapPress?.(m.lat, m.lng); break;
      case 'region': cb.current.onRegionChange?.({ lat: m.lat, lng: m.lng, zoom: m.zoom }); break;
      case 'center': {
        const r = centerReqs.current.get(m.reqId);
        if (r) { centerReqs.current.delete(m.reqId); r({ lat: m.lat, lng: m.lng }); }
        break;
      }
      case 'openLink': Linking.openURL(m.url); break;
    }
  }, []);

  return (
    <View style={[styles.wrap, { backgroundColor: pal.mapBg }]} accessibilityLabel={props.label}>
      <WebView
        key={attempt}
        ref={web}
        source={{ html, baseUrl: PAGE_ORIGIN + '/' }}
        // '*' so EVERY navigation reaches onShouldStartLoadWithRequest below. With a narrower list,
        // react-native-webview opens non-matching URLs via Linking itself, bypassing our allow-list.
        originWhitelist={['*']}
        onMessage={onMessage}
        onError={() => setFailed(true)}
        javaScriptEnabled
        domStorageEnabled={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        allowsLinkPreview={false}
        style={[styles.web, { backgroundColor: pal.mapBg }]}
        // Top-level navigation never leaves our page; attribution links go through Linking above.
        onShouldStartLoadWithRequest={(req) => {
          if (req.url.startsWith(PAGE_ORIGIN) || req.url === 'about:blank') return true;
          if (isAllowedExternalLink(req.url)) Linking.openURL(req.url);
          return false;
        }}
      />
      {failed ? (
        <MapErrorCard
          style={[StyleSheet.absoluteFill, props.errorInsets ? {
            paddingTop: props.errorInsets.top, paddingBottom: props.errorInsets.bottom,
            paddingLeft: props.errorInsets.left, paddingRight: props.errorInsets.right,
          } : null]}
          compact={props.errorCompact}
          onRetry={props.errorCompact ? undefined : () => { setFailed(false); setReady(0); shownScheme.current = scheme; shown.current = new Map(); setAttempt((a) => a + 1); }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden' },
  web: { flex: 1 },
});
