import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon } from "./kit";
import { useStore } from "../store";
import type { MapPoint, MapProps } from "./MapView";

/** Карта на Яндекс Картах (JavaScript API 2.1). Включается, когда в .env задан YANDEX_MAPS_KEY.
 *  Умеет то же, что и Leaflet-версия: метки по вертикалям, кластеры с числом объектов (клик — приближение,
 *  на крупном масштабе — список), маршрут-линия, контуры инвестплощадок, «я здесь», выбор точки кликом. */

declare global { interface Window { ymaps?: any } }

let loading: Promise<any> | null = null;
function loadYmaps(key: string): Promise<any> {
  if (window.ymaps?.Map) return Promise.resolve(window.ymaps);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const fail = (msg: string) => { loading = null; reject(new Error(msg)); };
      const s = document.createElement("script");
      s.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(key)}&lang=ru_RU`;
      s.async = true;
      s.onload = () => {
        if (!window.ymaps) return fail("API Яндекс Карт не загрузилось");
        // второй колбэк ready — ошибка API (например, неверный или ещё не активированный ключ)
        window.ymaps.ready(() => resolve(window.ymaps), (e: any) => fail(`Яндекс Карты: ${e?.message || e || "ошибка ключа API"}`));
      };
      s.onerror = () => { s.remove(); fail("Нет связи с api-maps.yandex.ru — проверьте интернет"); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

const iconCache: Record<string, string> = {};
const svgFor = (name?: string) => (iconCache[name || ""] ??= renderToStaticMarkup(<Icon name={name} size={15} />));
/** Цвет из данных — только #hex, иначе фирменный синий (цвет попадает в HTML метки). */
const safeColor = (c?: string) => (c && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : "#1B4FA3");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export default function YandexMap(props: MapProps & { apiKey: string }) {
  const { dark } = useStore();
  const el = useRef<HTMLDivElement>(null);
  const ym = useRef<any>(null);
  const map = useRef<any>(null);
  const pointsLayer = useRef<any>(null);
  const extraLayer = useRef<any>(null);
  const layouts = useRef<any>(null);
  const cb = useRef(props);
  cb.current = props;
  const ready = useRef(false);
  const [state, setState] = useState<"loading" | "ok" | string>("loading");
  const [attempt, setAttempt] = useState(0);

  // --- создание карты ---
  useEffect(() => {
    let alive = true;
    loadYmaps(props.apiKey).then((ymaps) => {
      if (!alive || !el.current) return;
      ym.current = ymaps;
      const m = new ymaps.Map(el.current, { center: props.center || [48.008, 37.804], zoom: props.zoom || 12, controls: ["zoomControl"] },
        { suppressMapOpenBlock: true, yandexMapDisablePoiInteractivity: true });
      m.events.add("click", (e: any) => { const [lat, lng] = e.get("coords"); cb.current.onMapClick?.(lat, lng); });
      // Метка: центр значка — в точке на карте
      const Pin = ymaps.templateLayoutFactory.createClass(
        '<div style="position:absolute;left:-15px;top:-15px"><div class="pin {{ properties.cls }}" style="background:{{ properties.color }}">{{ properties.inner|raw }}</div></div>');
      const Me = ymaps.templateLayoutFactory.createClass('<div style="position:absolute;left:-9px;top:-9px"><div class="me-dot"></div></div>');
      // Кластер: цвет — самой частой вертикали, вторая вертикаль — кольцом
      const Cluster = ymaps.templateLayoutFactory.createClass("<div></div>", {
        build: function (this: any) {
          Cluster.superclass.build.call(this);
          const objs: any[] = this.getData().properties.get("geoObjects") || [];
          const counts: Record<string, number> = {};
          objs.forEach((o) => { const c = o.properties.get("color"); counts[c] = (counts[c] || 0) + 1; });
          const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
          const color = sorted[0]?.[0] || "#E3263A";
          const n = objs.length;
          const size = n < 10 ? 40 : n < 30 ? 48 : 56;
          const ring = sorted.length > 1 ? `box-shadow:0 0 0 4px ${sorted[1][0]}55, 0 3px 12px rgba(0,0,0,.3);` : "";
          this.getParentElement().innerHTML =
            `<div style="position:absolute;left:${-size / 2}px;top:${-size / 2}px"><div class="cluster" style="width:${size}px;height:${size}px;background:${color};${ring}">${n}</div></div>`;
        },
      });
      layouts.current = { Pin, Me, Cluster };
      extraLayer.current = new ymaps.GeoObjectCollection();
      m.geoObjects.add(extraLayer.current);
      map.current = m;
      ready.current = true;
      drawPoints();
      drawExtra();
      applyDark();
      setState("ok");
    }).catch((e) => alive && setState(e.message || "Яндекс Карты не загрузились"));
    return () => { alive = false; map.current?.destroy(); map.current = null; ready.current = false; };
  }, [attempt]); // eslint-disable-line

  // --- тёмная тема: Яндекс не даёт тёмной схемы в API 2.1, инвертируем подложку ---
  const applyDark = () => { el.current?.classList.toggle("ymap-dark", !!dark); };
  useEffect(applyDark, [dark]);

  const fitTo = (coords: [number, number][], margin = 50) => {
    const ymaps = ym.current, m = map.current;
    if (!ymaps || !m || !coords.length) return;
    if (coords.length === 1) { m.setCenter(coords[0], 15); return; }
    m.setBounds(ymaps.util.bounds.fromPoints(coords), { checkZoomRange: true, zoomMargin: margin })
      .then(() => { if (m.getZoom() > 15) m.setZoom(15); });
  };

  // --- метки и кластеры ---
  const drawPoints = () => {
    const ymaps = ym.current, m = map.current;
    if (!ymaps || !m) return;
    if (pointsLayer.current) m.geoObjects.remove(pointsLayer.current);
    const p = cb.current;
    const pts = p.points || [];
    const marks = pts.map((pt: MapPoint) => {
      const inner = p.numbered && pt.order ? `<b style="font-size:13px">${pt.order}</b>` : svgFor(pt.icon);
      const pm = new ymaps.Placemark([pt.lat, pt.lng], {
        color: safeColor(pt.color), inner, cls: pt.status && pt.status !== "open" ? "closed" : "", hintContent: esc(pt.name), pt,
        balloonContentBody: p.onPointClick ? undefined :
          `<b>${esc(pt.name)}</b>${pt.sub ? `<div style="color:#667;font-size:13px">${esc(pt.sub)}</div>` : ""}` +
          (pt.slug ? `<div style="margin-top:6px"><a href="/place/${pt.slug}" style="color:#1B4FA3;font-weight:600">Открыть карточку</a></div>` : ""),
      }, {
        iconLayout: layouts.current.Pin, iconShape: { type: "Circle", coordinates: [0, 0], radius: 16 },
        hasBalloon: !p.onPointClick, hideIconOnBalloonOpen: false, balloonOffset: [0, -16],
      });
      pm.events.add("click", () => cb.current.onPointClick?.(pt));
      return pm;
    });
    let layer: any;
    if (p.cluster) {
      layer = new ymaps.Clusterer({
        clusterIconLayout: layouts.current.Cluster, clusterIconShape: { type: "Circle", coordinates: [0, 0], radius: 26 },
        clusterDisableClickZoom: true, clusterOpenBalloonOnClick: false, hasBalloon: false, gridSize: 80, groupByCoordinates: false,
      });
      layer.add(marks);
      layer.events.add("click", (e: any) => {
        const target = e.get("target");
        if (!target?.getGeoObjects) return; // клик по одиночной метке обработан самой меткой
        const objs = target.getGeoObjects();
        const coords = objs.map((o: any) => o.geometry.getCoordinates());
        const b = ymaps.util.bounds.fromPoints(coords);
        const tight = m.getZoom() >= 16 || ymaps.coordSystem.geo.getDistance(b[0], b[1]) < 60;
        if (tight && cb.current.onClusterList) cb.current.onClusterList(objs.map((o: any) => o.properties.get("pt")));
        else m.setBounds(b, { checkZoomRange: true, zoomMargin: 40 });
      });
    } else {
      layer = new ymaps.GeoObjectCollection();
      marks.forEach((mk: any) => layer.add(mk));
    }
    m.geoObjects.add(layer);
    pointsLayer.current = layer;
    if (p.fit && pts.length) fitTo(pts.map((x) => [x.lat, x.lng] as [number, number]));
  };
  useEffect(() => { if (ready.current) drawPoints(); }, [props.points, props.cluster]); // eslint-disable-line

  // --- линия маршрута, контуры площадок, «я здесь», выбранная точка ---
  const drawExtra = () => {
    const ymaps = ym.current, g = extraLayer.current;
    if (!ymaps || !g) return;
    const p = cb.current;
    g.removeAll();
    if (p.polyline && p.polyline.length > 1) {
      g.add(new ymaps.Polyline(p.polyline, {}, { strokeColor: safeColor(p.polylineColor || "#17191F"), strokeWidth: 4, strokeOpacity: 0.85 }));
    }
    (p.polygons || []).forEach((pg) => {
      const poly = new ymaps.Polygon([pg.coords], { hintContent: esc(pg.name) }, { fillColor: safeColor(pg.color) + "38", strokeColor: safeColor(pg.color), strokeWidth: 2 });
      if (pg.onClick) poly.events.add("click", pg.onClick);
      g.add(poly);
    });
    if (p.polygons?.length && p.fit && !(p.points || []).length) fitTo(p.polygons.flatMap((x) => x.coords), 40);
    if (p.user) g.add(new ymaps.Placemark([p.user.lat, p.user.lng], { hintContent: "Вы здесь" }, { iconLayout: layouts.current.Me }));
    if (p.marker) g.add(new ymaps.Placemark(p.marker, { color: "#E3263A", inner: "", cls: "" }, { iconLayout: layouts.current.Pin }));
  };
  useEffect(() => { if (ready.current) drawExtra(); }, [props.polyline, props.polygons, props.user, props.marker]); // eslint-disable-line

  useEffect(() => {
    if (map.current && props.center) map.current.setCenter(props.center, props.zoom || map.current.getZoom());
  }, [props.center?.[0], props.center?.[1]]); // eslint-disable-line

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", ...props.style }}>
      <div ref={el} className="ymap" style={{ width: "100%", height: "100%" }} />
      {state !== "ok" && (
        <div className="ymap-msg overlay">
          {state === "loading" ? <span>Загружаем Яндекс Карты…</span> : (
            <span>{state}<br /><button className="btn secondary sm" style={{ marginTop: 10 }} onClick={() => { setState("loading"); setAttempt((a) => a + 1); }}>Повторить</button></span>
          )}
        </div>
      )}
    </div>
  );
}
