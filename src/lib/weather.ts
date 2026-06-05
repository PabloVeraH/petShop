export interface WeatherContext {
  temperatura: number;
  descripcion: string;
  temporada: "verano" | "otoño" | "invierno" | "primavera";
  esFrio: boolean;
  esCalido: boolean;
}

export const SANTIAGO_LAT = -33.45;
export const SANTIAGO_LON = -70.67;

// WMO weather codes → descripción
function wmoADescripcion(code: number): string {
  if (code === 0) return "despejado";
  if (code <= 3) return "parcialmente nublado";
  if (code <= 49) return "neblina";
  if (code <= 69) return "lluvia";
  if (code <= 79) return "nieve";
  if (code <= 82) return "lluvia intensa";
  if (code <= 99) return "tormenta";
  return "variable";
}

// Hemisferio sur: dic/ene/feb=verano, mar/abr/may=otoño, jun/jul/ago=invierno, sep/oct/nov=primavera
function derivarTemporada(mes: number): WeatherContext["temporada"] {
  if (mes === 12 || mes <= 2) return "verano";
  if (mes <= 5) return "otoño";
  if (mes <= 8) return "invierno";
  return "primavera";
}

function fallback(): WeatherContext {
  const temporada = derivarTemporada(new Date().getMonth() + 1);
  return { temperatura: 15, descripcion: "variable", temporada, esFrio: false, esCalido: false };
}

// Cache en memoria: "lat,lon" → { context, expiresAt }
const cache = new Map<string, { context: WeatherContext; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

export async function obtenerContextoClimatico(lat: number, lon: number): Promise<WeatherContext> {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.context;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=America/Santiago`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return fallback();

    const data = await res.json();
    const temperatura = Math.round(data.current?.temperature_2m ?? 15);
    const weatherCode = data.current?.weather_code ?? 0;
    const temporada = derivarTemporada(new Date().getMonth() + 1);

    const context: WeatherContext = {
      temperatura,
      descripcion: wmoADescripcion(weatherCode),
      temporada,
      esFrio: temperatura < 12,
      esCalido: temperatura > 25,
    };

    cache.set(cacheKey, { context, expiresAt: Date.now() + CACHE_TTL_MS });
    return context;
  } catch {
    return fallback();
  }
}
