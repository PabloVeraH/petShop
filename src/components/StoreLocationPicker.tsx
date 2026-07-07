"use client";

import { useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import type { FlyTarget } from "./MapWithPin";

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

interface MapWithPinProps {
  lat: number;
  lon: number;
  flyTarget?: FlyTarget;
  onPinMoved: (lat: number, lon: number) => void;
  onMapClick: (lat: number, lon: number) => void;
}

const MapWithPin = dynamic<MapWithPinProps>(() => import("./MapWithPin"), {
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

async function reverseGeocode(lat: number, lon: number): Promise<{ direccion: string; ciudad: string } | null> {
  const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`);
  const data = await res.json();
  const feature: PhotonFeature | undefined = data.features?.[0];
  if (!feature) return null;
  return {
    direccion: buildDisplayAddress(feature.properties),
    ciudad: extractCity(feature.properties),
  };
}

const DEFAULT_LAT = -33.45;
const DEFAULT_LON = -70.67;

export default function StoreLocationPicker({ direccion, ciudad, lat, lon, onChange }: Props) {
  const [query, setQuery] = useState(direccion);
  const [suggestions, setSuggestions] = useState<PhotonFeature[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showPinMovedDialog, setShowPinMovedDialog] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [flyTarget, setFlyTarget] = useState<FlyTarget | undefined>(undefined);
  // Stores the new coords while the confirmation dialog is open
  const [pendingCoords, setPendingCoords] = useState<{ lat: number; lon: number } | null>(null);
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
    setFlyTarget({ lat: featureLat, lon: featureLon, key: Date.now() });
    onChange({ direccion: displayAddr, ciudad: city, lat: featureLat, lon: featureLon });
  };

  // Pin dragged: always update coords, then ask about address
  const handlePinMoved = (newLat: number, newLon: number) => {
    onChange({ direccion: query, ciudad, lat: newLat, lon: newLon });
    setPendingCoords({ lat: newLat, lon: newLon });
    setShowPinMovedDialog(true);
  };

  // Map click: if empty → reverse geocode inline; if not empty → ask via dialog
  const handleMapClick = useCallback(async (newLat: number, newLon: number) => {
    onChange({ direccion: query, ciudad, lat: newLat, lon: newLon });

    if (!query.trim()) {
      setLoadingSuggestions(true);
      try {
        const result = await reverseGeocode(newLat, newLon);
        if (result) {
          setQuery(result.direccion);
          onChange({ direccion: result.direccion, ciudad: result.ciudad, lat: newLat, lon: newLon });
        }
      } catch {
        // silently fail
      } finally {
        setLoadingSuggestions(false);
      }
    } else {
      setPendingCoords({ lat: newLat, lon: newLon });
      setShowPinMovedDialog(true);
    }
  }, [query, ciudad, onChange]);

  // Confirmation dialog response: if accepted → reverse geocode pending coords
  const handlePinMovedResponse = useCallback(async (modifyAddress: boolean) => {
    setShowPinMovedDialog(false);
    const coords = pendingCoords;
    setPendingCoords(null);

    if (modifyAddress && coords) {
      setQuery("");
      setLoadingSuggestions(true);
      try {
        const result = await reverseGeocode(coords.lat, coords.lon);
        if (result) {
          setQuery(result.direccion);
          onChange({ direccion: result.direccion, ciudad: result.ciudad, lat: coords.lat, lon: coords.lon });
        }
      } catch {
        // silently fail — address stays empty, coords remain updated
      } finally {
        setLoadingSuggestions(false);
      }
    }
  }, [pendingCoords, onChange]);

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

      <p className="text-xs text-gray-400">
        Haz clic en el mapa para mover el pin, o arrástralo a la posición exacta.
      </p>

      <div className="h-64 rounded-lg overflow-hidden border border-gray-200">
        <MapWithPin
          lat={currentLat}
          lon={currentLon}
          flyTarget={flyTarget}
          onPinMoved={handlePinMoved}
          onMapClick={handleMapClick}
        />
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

      {/* Popup modal for pin position change confirmation */}
      {showPinMovedDialog && (
        <ModalOverlay open onClose={() => handlePinMovedResponse(false)}>
        <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 m-4">
            <h3 id="pin-moved-title" className="text-base font-semibold text-gray-800 mb-2">
              Posición modificada
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              Ha movido el pin de la posición original. ¿Desea actualizar la dirección con la nueva ubicación?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => handlePinMovedResponse(false)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                No, mantener
              </button>
              <button
                type="button"
                onClick={() => handlePinMovedResponse(true)}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Sí, actualizar
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      <button
        type="button"
        onClick={() => {
          if (!navigator.geolocation) return;
          navigator.geolocation.getCurrentPosition((pos) => {
            const newLat = parseFloat(pos.coords.latitude.toFixed(6));
            const newLon = parseFloat(pos.coords.longitude.toFixed(6));
            setFlyTarget({ lat: newLat, lon: newLon, key: Date.now() });
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
