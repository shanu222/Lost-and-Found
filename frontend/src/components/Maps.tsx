// Leaflet maps (lazy-loaded chunk): pin picker, approximate item areas and
// safe-place markers. Tiles come from OpenStreetMap.
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { Circle, CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';

const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
type P = { lat: number; lng: number };

function Fly({ to, zoom }: { to: P; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([to.lat, to.lng], zoom ?? map.getZoom());
  }, [to.lat, to.lng, zoom, map]);
  return null;
}

function Clicks({ onPick }: { onPick: (p: P) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Tap to drop a pin; optional radius circle. */
export function PinMap({ center, value, onChange, radiusM, label, height = 280 }: { center: P; value: P | null; onChange: (p: P) => void; radiusM?: number; label: string; height?: number }) {
  const focus = value ?? center;
  return (
    <div className="map-box" style={{ height }} role="application" aria-label={label}>
      <MapContainer center={[focus.lat, focus.lng]} zoom={13} style={{ height: '100%' }} scrollWheelZoom={false}>
        <TileLayer url={TILE} attribution={ATTR} />
        <Fly to={focus} />
        <Clicks onPick={onChange} />
        {value && radiusM && <Circle center={[value.lat, value.lng]} radius={radiusM} pathOptions={{ color: '#0f4c4f', fillColor: '#1b6f72', fillOpacity: 0.12, weight: 2 }} />}
        {value && <CircleMarker center={[value.lat, value.lng]} radius={8} pathOptions={{ color: '#fff', fillColor: '#f0a23b', fillOpacity: 1, weight: 3 }} />}
      </MapContainer>
    </div>
  );
}

/** Approximate areas only (~500 m circles) — never exact points. */
export function AreaMap({ areas, center, height = 320, onSelect }: { areas: { id: string; lat: number; lng: number; radiusM: number; title: string }[]; center: P; height?: number; onSelect?: (id: string) => void }) {
  return (
    <div className="map-box" style={{ height }}>
      <MapContainer center={[center.lat, center.lng]} zoom={12} style={{ height: '100%' }} scrollWheelZoom={false}>
        <TileLayer url={TILE} attribution={ATTR} />
        <Fly to={center} />
        {areas.map((a) => (
          <Circle
            key={a.id}
            center={[a.lat, a.lng]}
            radius={a.radiusM}
            pathOptions={{ color: '#0f4c4f', fillColor: '#f0a23b', fillOpacity: 0.25, weight: 2 }}
            eventHandlers={onSelect ? { click: () => onSelect(a.id) } : undefined}
          >
            <Tooltip>{a.title}</Tooltip>
          </Circle>
        ))}
      </MapContainer>
    </div>
  );
}

const PLACE_COLORS = { police: '#284f7a', bank: '#1f6a43', mall: '#8a4b12', station: '#6c3a63' } as const;

export function PlacesMap({ center, places, selected, onSelect, height = 300 }: { center: P; places: { osmId: string; name: string; lat: number; lng: number; type: keyof typeof PLACE_COLORS }[]; selected?: string | null; onSelect: (id: string) => void; height?: number }) {
  return (
    <div className="map-box" style={{ height }}>
      <MapContainer center={[center.lat, center.lng]} zoom={13} style={{ height: '100%' }} scrollWheelZoom={false}>
        <TileLayer url={TILE} attribution={ATTR} />
        {places.map((p) => (
          <CircleMarker
            key={p.osmId}
            center={[p.lat, p.lng]}
            radius={selected === p.osmId ? 11 : 8}
            pathOptions={{ color: '#fff', weight: 2, fillColor: selected === p.osmId ? '#f0a23b' : PLACE_COLORS[p.type], fillOpacity: 1 }}
            eventHandlers={{ click: () => onSelect(p.osmId) }}
          >
            <Popup>{p.name}</Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
