"use client";

import { useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    locality?: string;
    district?: string;
    state?: string;
    country?: string;
  };
}

interface LocationData {
  direccion: string;
  ciudad: string;
  lat: number;
  lon: number;
}

interface Props {
  direccion: string;
  ciudad: string;
  lat: number | null;
  lon: number | null;
  onChange: (data: LocationData) => void;
}

const MapWithPin = dynamic(() => import("./MapWithPin"), {
  ssr: false,
  loading: () => (
    <div className="h-full bg-gray-100 flex items-center justify-center text-sm text-gray-400">
      Cargando mapa...
    </div>
  ),
});

export function buildDisplayAddress(props: PhotonFeature["properties"]): string {
  const parts: string[] = [];
  if (props.street) {
    parts.push(props.housenumber ? `${props.street} ${props.housenumber}` : props.street);
  } else if (props.name) {
    parts.push(props.name);
  }
  if (props.district && props.district !== props.city) parts.push(props.district);
  else if (props.locality && props.locality !== props.city) parts.push(props.locality);
  if (props.city) parts.push(props.city);
  if (props.country) parts.push(props.country);
  return parts.join(", ");
}

export function extractCity(props: PhotonFeature["properties"]): string {
  return props.city ?? props.locality ?? props.district ?? props.state ?? props.name ?? "";
}

const DEFAULT_LAT = -33.45;
const DEFAULT_LON = -70.67;

export default function StoreLocationPicker({ direccion, ciudad, lat, lon, onChange }: Props) {
  const [query, setQuery] = useState(direccion);
  const [suggestions, setSuggestions] = useState<PhotonFeature[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showPinMovedDialog, setShowPinMovedDialog] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const searchPhoton = useCallback(async (q: string) => {
    if (q.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setLoadingSuggestions(true);
    try {
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=es`
      );
      const data = await res.json();
      setSuggestions(data.features ?? []);
      setShowSuggestions(true);
    } catch {
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchPhoton(value), 400);
  };

  const handleSelectSuggestion = (feature: PhotonFeature) => {
    const [featureLon, featureLat] = feature.geometry.coordinates;
    const displayAddr = buildDisplayAddress(feature.properties);
    const city = extractCity(feature.properties);
    setQuery(displayAddr);
    setSuggestions([]);
    setShowSuggestions(false);
    onChange({ direccion: displayAddr, ciudad: city, lat: featureLat, lon: featureLon });
  };

  const handlePinMoved = (newLat: number, newLon: number) => {
    onChange({ direccion: query, ciudad, lat: newLat, lon: newLon });
    setShowPinMovedDialog(true);
  };

  const handlePinMovedResponse = (modifyAddress: boolean) => {
    setShowPinMovedDialog(false);
    if (modifyAddress) {
      setQuery("");
      setSuggestions([]);
    }
  };

  const currentLat = lat ?? DEFAULT_LAT;
  const currentLon = lon ?? DEFAULT_LON;

  return (
    <div className="space-y-3">
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder="Ej: Pinares 579, Chiguayante"
          autoComplete="off"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        {loadingSuggestions && (
          <span className="absolute right-3 top-9 text-xs text-gray-400">Buscando...</span>
        )}
        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute z-50 w-full bg-white border border-gray-200 rounded-md shadow-lg mt-1 max-h-52 overflow-auto">
            {suggestions.map((f, i) => (
              <li
                key={i}
                onMouseDown={() => handleSelectSuggestion(f)}
                className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-0"
              >
                {buildDisplayAddress(f.properties)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Ciudad</label>
        <input
          type="text"
          value={ciudad}
          readOnly
          placeholder="Se completa al seleccionar dirección"
          className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-default"
        />
      </div>

      <div className="h-64 rounded-lg overflow-hidden border border-gray-200">
        <MapWithPin lat={currentLat} lon={currentLon} onPinMoved={handlePinMoved} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Latitud</label>
          <input
            type="number"
            step="0.000001"
            value={lat ?? ""}
            readOnly
            className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-default"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Longitud</label>
          <input
            type="number"
            step="0.000001"
            value={lon ?? ""}
            readOnly
            className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-default"
          />
        </div>
      </div>

      {showPinMovedDialog && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
          <p className="text-sm text-amber-800 mb-3">
            Ha movido el pin de la posición original. ¿Desea modificar la dirección?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handlePinMovedResponse(true)}
              className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700"
            >
              Sí, modificar dirección
            </button>
            <button
              type="button"
              onClick={() => handlePinMovedResponse(false)}
              className="px-3 py-1.5 text-sm bg-white text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              No, mantener dirección
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          if (!navigator.geolocation) return;
          navigator.geolocation.getCurrentPosition((pos) => {
            const newLat = parseFloat(pos.coords.latitude.toFixed(6));
            const newLon = parseFloat(pos.coords.longitude.toFixed(6));
            onChange({ direccion: query, ciudad, lat: newLat, lon: newLon });
          });
        }}
        className="text-sm text-green-600 hover:underline"
      >
        Usar mi ubicación actual
      </button>
    </div>
  );
}
