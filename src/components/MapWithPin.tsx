"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import type { Marker as LeafletMarker } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const DefaultIcon = L.icon({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

interface Props {
  lat: number;
  lon: number;
  onPinMoved: (lat: number, lon: number) => void;
}

function FlyToController({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    map.flyTo([lat, lon], 15, { duration: 1 });
  }, [lat, lon, map]);
  return null;
}

function DraggableMarker({ lat, lon, onPinMoved }: Props) {
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

export default function MapWithPin({ lat, lon, onPinMoved }: Props) {
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
      <FlyToController lat={lat} lon={lon} />
      <DraggableMarker lat={lat} lon={lon} onPinMoved={onPinMoved} />
    </MapContainer>
  );
}
