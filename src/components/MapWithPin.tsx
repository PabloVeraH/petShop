"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import type { Marker as LeafletMarker } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const DefaultIcon = L.divIcon({
  className: "",
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 41" width="25" height="41" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35))">
    <path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.4 12.5 28.5 12.5 28.5S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z" fill="#2563eb" stroke="white" stroke-width="1.5"/>
    <circle cx="12.5" cy="12.5" r="4.5" fill="white" opacity="0.85"/>
  </svg>`,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [0, -41],
});
L.Marker.prototype.options.icon = DefaultIcon;

export interface FlyTarget {
  lat: number;
  lon: number;
  key: number;
}

interface Props {
  lat: number;
  lon: number;
  flyTarget?: FlyTarget;
  onPinMoved: (lat: number, lon: number) => void;
  onMapClick: (lat: number, lon: number) => void;
}

// Only animates when flyTarget.key changes — ignores drag and map-click movements
function FlyToController({ flyTarget }: { flyTarget?: FlyTarget }) {
  const map = useMap();
  const lastKey = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!flyTarget || flyTarget.key === lastKey.current) return;
    lastKey.current = flyTarget.key;
    map.flyTo([flyTarget.lat, flyTarget.lon], 15, { duration: 1 });
  }, [flyTarget, map]);
  return null;
}

function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click: (e) => {
      onMapClick(
        parseFloat(e.latlng.lat.toFixed(6)),
        parseFloat(e.latlng.lng.toFixed(6))
      );
    },
  });
  return null;
}

function DraggableMarker({
  lat,
  lon,
  onPinMoved,
}: {
  lat: number;
  lon: number;
  onPinMoved: (lat: number, lon: number) => void;
}) {
  const markerRef = useRef<LeafletMarker>(null);
  return (
    <Marker
      draggable
      position={[lat, lon]}
      ref={markerRef}
      eventHandlers={{
        dragend: () => {
          const pos = markerRef.current?.getLatLng();
          if (pos) {
            onPinMoved(
              parseFloat(pos.lat.toFixed(6)),
              parseFloat(pos.lng.toFixed(6))
            );
          }
        },
      }}
    />
  );
}

export default function MapWithPin({ lat, lon, flyTarget, onPinMoved, onMapClick }: Props) {
  return (
    <MapContainer
      center={[lat, lon]}
      zoom={15}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FlyToController flyTarget={flyTarget} />
      <MapClickHandler onMapClick={onMapClick} />
      <DraggableMarker lat={lat} lon={lon} onPinMoved={onPinMoved} />
    </MapContainer>
  );
}
