// Optional "home area" picker: tap the map to set a centre, slider for radius.
// The server double-checks the point is inside the user's country.
import 'leaflet/dist/leaflet.css';
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { useEffect } from 'react';

export interface HomeArea {
  lat: number;
  lng: number;
  radiusKm: number;
}

function ClickToSet({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

export default function HomeAreaMap({
  center,
  value,
  onChange,
  label,
}: {
  center: { lat: number; lng: number };
  value: HomeArea | null;
  onChange: (v: HomeArea) => void;
  label: string;
}) {
  const focus = value ?? center;
  return (
    <div className="map-box" role="application" aria-label={label}>
      <MapContainer center={[focus.lat, focus.lng]} zoom={12} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Recenter lat={focus.lat} lng={focus.lng} />
        <ClickToSet onPick={(lat, lng) => onChange({ lat, lng, radiusKm: value?.radiusKm ?? 5 })} />
        {value && (
          <>
            <Circle center={[value.lat, value.lng]} radius={value.radiusKm * 1000} pathOptions={{ color: '#0f4c4f', fillColor: '#1b6f72', fillOpacity: 0.12, weight: 2 }} />
            <CircleMarker center={[value.lat, value.lng]} radius={7} pathOptions={{ color: '#fff', fillColor: '#f0a23b', fillOpacity: 1, weight: 3 }} />
          </>
        )}
      </MapContainer>
    </div>
  );
}
