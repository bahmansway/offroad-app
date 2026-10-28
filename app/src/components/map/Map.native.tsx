import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import {
  BAKU_CENTER, DEFAULT_ZOOM, MAPLIBRE_CDN_VERSION, MAPLIBRE_SRI, MAP_STYLE_URL, PIN_CSS,
  buildPins, isAllowedExternalLink, parseMapMessage, type MapProps,
} from './shared';
import { colors, fonts } from '../../lib/theme';

type WebViewHandle = { injectJavaScript: (js: string) => void };
// The package's generic typings omit `ref`; the platform implementations do accept it.
const WebView = RNWebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebViewHandle> }>;

/** The page is loaded with this base URL so it has a stable, known origin. */
const PAGE_ORIGIN = 'https://offroad-map.local';

function buildHtml(center: [number, number], zoom: number): string {
  const v = MAPLIBRE_CDN_VERSION;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link href="https://unpkg.com/maplibre-gl@${v}/dist/maplibre-gl.css" rel="stylesheet" integrity="${MAPLIBRE_SRI.css}" crossorigin="anonymous">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700&family=Barlow:wght@500&display=swap" rel="stylesheet">
<style>html,body,#map{margin:0;height:100%;width:100%;background:${colors.mapBg}}${PIN_CSS}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/maplibre-gl@${v}/dist/maplibre-gl.js" integrity="${MAPLIBRE_SRI.js}" crossorigin="anonymous"></script>
<script>
(function(){
  function send(m){ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  if(!window.maplibregl){ send({type:'failed'}); return; }
  var map = new maplibregl.Map({container:'map',style:${JSON.stringify(MAP_STYLE_URL)},center:${JSON.stringify(center)},zoom:${zoom},
    attributionControl:{compact:true},dragRotate:false,pitchWithRotate:false});
  map.touchZoomRotate.disableRotation();
  var markers=[];
  map.on('click',function(e){ var p=e.lngLat.wrap(); send({type:'mapPress',lat:p.lat,lng:p.lng}); });
  map.on('load',function(){ send({type:'loaded'}); });
  // Attribution links open in the phone browser, not inside the map view.
  document.addEventListener('click',function(e){
    var a=e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if(a){ e.preventDefault(); send({type:'openLink',url:a.href}); }
  },true);
  window.__setPins=function(pins){
    markers.forEach(function(m){m.remove();}); markers=[];
    pins.forEach(function(p){
      var el=document.createElement('button'); el.type='button';
      el.className=p.kind==='picked'?'or-pin or-pin--picked':'or-pin';
      el.setAttribute('aria-label',p.label); el.innerHTML=p.html;
      if(p.kind!=='picked'){ el.addEventListener('click',function(ev){ ev.stopPropagation(); send({type:'spotPress',id:p.id}); }); }
      markers.push(new maplibregl.Marker({element:el,anchor:'bottom-left'}).setLngLat([p.lng,p.lat]).addTo(map));
    });
  };
  // z === null keeps the current zoom (so placing a pin doesn't zoom the map out).
  window.__jumpTo=function(lng,lat,z){
    var o={center:[Number(lng),Number(lat)]}; if(z!==null && isFinite(z)) o.zoom=Number(z); map.jumpTo(o);
  };
  window.__getCenter=function(reqId){ var c=map.getCenter().wrap(); send({type:'center',lat:c.lat,lng:c.lng,reqId:reqId}); };
  send({type:'ready'});
})();
</script></body></html>`;
}

const num = (n: number) => (Number.isFinite(n) ? String(Number(n)) : 'null');

export default function SpotMap(props: MapProps) {
  const web = useRef<WebViewHandle>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const cb = useRef(props);
  cb.current = props;
  const centerReqs = useRef(new Map<number, (c: { lat: number; lng: number } | null) => void>());
  const nextReq = useRef(1);

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

  // HTML is built once; later changes are pushed with injectJavaScript.
  const html = useMemo(
    () => buildHtml(props.center ? [props.center.lng, props.center.lat] : BAKU_CENTER, props.zoom ?? DEFAULT_ZOOM),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const pins = useMemo(() => buildPins(props, props.label), [props.spots, props.picked?.lat, props.picked?.lng, props.pinLabel]);

  useEffect(() => {
    // JSON.stringify output is a valid JS literal; labels/ids are escaped inside it.
    if (ready) web.current?.injectJavaScript(`window.__setPins(${JSON.stringify(pins)});true;`);
  }, [ready, pins]);

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
      case 'ready': setReady(true); break;
      case 'loaded': setFailed(false); break;
      case 'failed': setFailed(true); break;
      case 'spotPress': cb.current.onSpotPress?.(m.id); break;
      case 'mapPress': cb.current.onMapPress?.(m.lat, m.lng); break;
      case 'center': {
        const r = centerReqs.current.get(m.reqId);
        if (r) { centerReqs.current.delete(m.reqId); r({ lat: m.lat, lng: m.lng }); }
        break;
      }
      case 'openLink': Linking.openURL(m.url); break;
    }
  }, []);

  return (
    <View style={styles.wrap} accessibilityLabel={props.label}>
      <WebView
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
        style={styles.web}
        // Top-level navigation never leaves our page; attribution links go through Linking above.
        onShouldStartLoadWithRequest={(req) => {
          if (req.url.startsWith(PAGE_ORIGIN) || req.url === 'about:blank') return true;
          if (isAllowedExternalLink(req.url)) Linking.openURL(req.url);
          return false;
        }}
      />
      {failed && props.failedText ? (
        <View style={styles.failed} pointerEvents="none">
          <Text style={styles.failedText}>{props.failedText}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.mapBg, overflow: 'hidden' },
  web: { flex: 1, backgroundColor: colors.mapBg },
  failed: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 24 },
  failedText: { color: colors.text, fontFamily: fonts.medium, fontSize: 14, textAlign: 'center' },
});
