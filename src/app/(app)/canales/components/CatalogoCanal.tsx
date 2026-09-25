"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Catálogo por canal (Fase 4, paso 4.4): qué productos se venden en el canal,
// precio calculado (D7/D13/D14) u override, cupo (D4) y estado publicado.
// Reemplaza las tres páginas anteriores, que listaban SKUs sin precio y
// publicaban todo con precio 0. La autorización real (solo storeAdmin/
// systemAdmin, D8) la aplica el servidor: aquí solo se muestra su respuesta.

export interface InfoCanal {
  id: "rappi" | "pedidosya" | "ubereats";
  nombre: string;
  icono: string;
  color: string;
}

interface ProductoCatalogo {
  producto_id: string;
  nombre: string;
  sku: string;
  precio_base: number | null;
  precio_override: number | null;
  precio_canal: number | null;
  habilitado: boolean;
  publicado_at: string | null;
  disponible_publicado: boolean | null;
  stock: number;
  stock_minimo: number;
  cupo: number;
}

interface RespuestaCatalogo {
  activo: boolean;
  recargo_pct: number;
  productos: ProductoCatalogo[];
}

function clp(n: number | null): string {
  return n == null ? "—" : `$${Math.round(n).toLocaleString("es-CL")}`;
}

async function leerError(res: Response, porDefecto: string): Promise<string> {
  if (res.status === 403) return "Solo un administrador de la tienda puede gestionar el catálogo";
  const data = await res.json().catch(() => null);
  return (data && typeof data.error === "string" && data.error) || porDefecto;
}

export default function CatalogoCanal({ canal }: { canal: InfoCanal }) {
  const router = useRouter();
  const [datos, setDatos] = useState<RespuestaCatalogo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [recargo, setRecargo] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/canales/${canal.id}/productos`);
    if (!res.ok) {
      setError(await leerError(res, "Error cargando el catálogo"));
      setCargando(false);
      return;
    }
    const data = (await res.json()) as RespuestaCatalogo;
    setDatos(data);
    setRecargo(String(data.recargo_pct ?? 0));
    setOverrides(
      Object.fromEntries(data.productos.map((p) => [p.producto_id, p.precio_override != null ? String(p.precio_override) : ""]))
    );
    setCargando(false);
  }, [canal.id]);

  useEffect(() => {
    cargar().catch(() => {
      setError("Error cargando el catálogo");
      setCargando(false);
    });
  }, [cargar]);

  async function guardarProducto(p: ProductoCatalogo, habilitado: boolean, conOverride: boolean) {
    setError("");
    setAviso("");
    const body: Record<string, unknown> = { producto_id: p.producto_id, habilitado };
    if (conOverride) {
      const texto = (overrides[p.producto_id] ?? "").trim();
      const valor = texto === "" ? null : Number(texto);
      if (valor !== null && !(Number.isInteger(valor) && valor > 0)) {
        setError(`Precio inválido para ${p.nombre}: usa un entero mayor que 0 o déjalo vacío`);
        return;
      }
      body.precio_override = valor;
    }
    setOcupado(p.producto_id);
    try {
      const res = await fetch(`/api/canales/${canal.id}/productos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await leerError(res, "Error guardando el producto"));
        return;
      }
      await cargar();
    } catch {
      setError("Error de red guardando el producto");
    } finally {
      setOcupado(null);
    }
  }

  async function guardarRecargo() {
    setError("");
    setAviso("");
    const valor = Number(recargo);
    if (!(valor >= 0 && valor <= 100)) {
      setError("El recargo debe estar entre 0 y 100 %");
      return;
    }
    setOcupado("recargo");
    try {
      const res = await fetch("/api/canales/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal_id: canal.id, recargo_pct: valor }),
      });
      if (!res.ok) {
        setError(await leerError(res, "Error guardando el recargo"));
        return;
      }
      setAviso("Recargo guardado. Publica el catálogo para enviar los nuevos precios.");
      await cargar();
    } catch {
      setError("Error de red guardando el recargo");
    } finally {
      setOcupado(null);
    }
  }

  async function publicar() {
    setError("");
    setAviso("");
    setOcupado("publicar");
    try {
      const res = await fetch("/api/canales/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal_id: canal.id }),
      });
      if (!res.ok) {
        setError(await leerError(res, "Error publicando el catálogo"));
        return;
      }
      const data = await res.json().catch(() => ({}));
      setAviso(
        data.status === "ya_en_curso"
          ? "Ya hay una publicación en curso."
          : "Publicación en curso: el catálogo se envía en segundo plano."
      );
    } catch {
      setError("Error de red publicando el catálogo");
    } finally {
      setOcupado(null);
    }
  }

  if (cargando) return <div className="text-gray-500">Cargando...</div>;

  const termino = busqueda.trim().toLowerCase();
  const productos = (datos?.productos ?? []).filter(
    (p) => !termino || p.nombre.toLowerCase().includes(termino) || p.sku.toLowerCase().includes(termino)
  );
  const habilitados = (datos?.productos ?? []).filter((p) => p.habilitado).length;

  return (
    <div className="max-w-6xl">
      <button
        onClick={() => router.push(`/canales/${canal.id}`)}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        ← Volver a {canal.nombre}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg ${canal.color} flex items-center justify-center text-lg`}>{canal.icono}</div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">Catálogo {canal.nombre}</h1>
            <p className="text-sm text-gray-500">
              {habilitados} producto{habilitados === 1 ? "" : "s"} habilitado{habilitados === 1 ? "" : "s"}
              {datos && !datos.activo ? " · canal inactivo" : ""}
            </p>
          </div>
        </div>
        {datos && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-gray-600">
              Recargo del canal (%)
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={recargo}
                onChange={(e) => setRecargo(e.target.value)}
                className="ml-2 w-24 border border-gray-300 rounded-md px-2 py-1 text-sm"
              />
            </label>
            <button
              onClick={guardarRecargo}
              disabled={ocupado !== null}
              className="px-3 py-1.5 border border-gray-300 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Guardar recargo
            </button>
            <button
              onClick={publicar}
              disabled={ocupado !== null || habilitados === 0 || !datos.activo}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {ocupado === "publicar" ? "Publicando..." : "Publicar catálogo"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {aviso && (
        <p role="status" className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {aviso}
        </p>
      )}

      {datos && (
        <>
          <p className="mb-3 text-xs text-gray-500">
            Cupo = unidades enteras vigentes − stock mínimo. Con cupo 0 el producto se apaga en el canal
            automáticamente; el precio vacío usa el precio base con el recargo del canal, redondeado hacia
            arriba a la decena.
          </p>
          <input
            type="search"
            placeholder="Buscar por nombre o SKU"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="mb-3 w-full max-w-sm border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Vender</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Producto</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">Stock</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">Mínimo</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">Cupo</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">Precio base</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">Precio canal</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Precio fijo</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Estado</th>
                </tr>
              </thead>
              <tbody>
                {productos.map((p) => (
                  <tr key={p.producto_id} className="border-b border-gray-100">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Vender ${p.nombre} en ${canal.nombre}`}
                        checked={p.habilitado}
                        disabled={ocupado !== null}
                        onChange={() => guardarProducto(p, !p.habilitado, false)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-gray-800">{p.nombre}</div>
                      <div className="text-xs text-gray-400">{p.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">{p.stock.toLocaleString("es-CL")}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{p.stock_minimo}</td>
                    <td className={`px-3 py-2 text-right font-medium ${p.cupo > 0 ? "text-gray-800" : "text-red-600"}`}>{p.cupo}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{clp(p.precio_base)}</td>
                    <td className="px-3 py-2 text-right text-gray-800">{clp(p.precio_canal)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          aria-label={`Precio fijo de ${p.nombre}`}
                          placeholder="Automático"
                          value={overrides[p.producto_id] ?? ""}
                          onChange={(e) => setOverrides({ ...overrides, [p.producto_id]: e.target.value })}
                          className="w-28 border border-gray-300 rounded-md px-2 py-1 text-sm"
                        />
                        <button
                          onClick={() => guardarProducto(p, p.habilitado, true)}
                          disabled={ocupado !== null}
                          aria-label={`Guardar precio de ${p.nombre}`}
                          className="px-2 py-1 border border-gray-300 text-xs rounded-md hover:bg-gray-50 disabled:opacity-50"
                        >
                          Guardar
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {!p.publicado_at ? (
                        <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-500">No publicado</span>
                      ) : p.disponible_publicado ? (
                        <span className="px-2 py-1 rounded-full bg-green-100 text-green-700">Disponible</span>
                      ) : p.disponible_publicado === false ? (
                        <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700">Apagado</span>
                      ) : (
                        <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">Publicado</span>
                      )}
                    </td>
                  </tr>
                ))}
                {productos.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                      Sin productos
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
