import { useStore } from "../store";
import YandexMap from "./YandexMap";

export type MapPoint = { id: number; lat: number; lng: number; color: string; icon?: string; name: string; slug?: string; sub?: string; status?: string; order?: number };

export type MapProps = {
  points?: MapPoint[];
  center?: [number, number];
  zoom?: number;
  cluster?: boolean;
  polyline?: [number, number][];
  polylineColor?: string;
  polygons?: { id: number; coords: [number, number][]; color: string; name: string; onClick?: () => void }[];
  user?: { lat: number; lng: number } | null;
  fit?: boolean;
  onPointClick?: (p: MapPoint) => void;
  onClusterList?: (pts: MapPoint[]) => void;
  onMapClick?: (lat: number, lng: number) => void;
  marker?: [number, number] | null;
  style?: React.CSSProperties;
  numbered?: boolean;
};

/** Все карты сайта — Яндекс Карты (JavaScript API 2.1). Ключ приходит с сервера (/api/config → maps.yandex_key),
 *  по умолчанию он вписан в backend/app/config.py, заменить можно в .env (YANDEX_MAPS_KEY=...). */
export default function MapView(props: MapProps) {
  const { config } = useStore();
  const key: string = (config as any)?.maps?.yandex_key || "";
  if (!config) return <div className="ymap ymap-msg" style={props.style}><span>Загружаем карту…</span></div>;
  if (!key) return <div className="ymap ymap-msg" style={props.style}><span>Не задан ключ Яндекс Карт: впишите YANDEX_MAPS_KEY в файл .env и перезапустите сервер</span></div>;
  return <YandexMap {...props} apiKey={key} />;
}
