"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ImportResult, ImportError } from "@/app/api/inventario/import/route";

type Estado = "idle" | "preview" | "importando" | "listo" | "error";

export default function ImportInventarioPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [estado, setEstado] = useState<Estado>("idle");
  const [preview, setPreview] = useState<(ImportResult & { dryRun: boolean }) | null>(null);
  const [resultado, setResultado] = useState<ImportResult | null>(null);
  const [errorGlobal, setErrorGlobal] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setArchivo(f);
    setPreview(null);
    setResultado(null);
    setErrorGlobal(null);
    setEstado(f ? "idle" : "idle");
  }

  async function handlePreview() {
    if (!archivo) return;
    setEstado("preview");
    setErrorGlobal(null);

    const fd = new FormData();
    fd.append("file", archivo);

    const res = await fetch("/api/inventario/import?dryRun=true", { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok) {
      setErrorGlobal(data.error ?? "Error al procesar el archivo");
      setEstado("idle");
      return;
    }

    setPreview(data);
    setEstado("preview");
  }

  async function handleImportar() {
    if (!archivo) return;
    setEstado("importando");
    setErrorGlobal(null);

    const fd = new FormData();
    fd.append("file", archivo);

    const res = await fetch("/api/inventario/import", { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok) {
      setErrorGlobal(data.error ?? "Error al importar");
      setEstado("preview");
      return;
    }

    setResultado(data);
    setEstado("listo");
  }

  function resetear() {
    setArchivo(null);
    setPreview(null);
    setResultado(null);
    setErrorGlobal(null);
    setEstado("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Importar Inventario</h1>
          <p className="text-sm text-gray-500 mt-1">Carga masiva de productos desde un archivo Excel</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.location.href = "/api/inventario/import"}
        >
          Descargar plantilla
        </Button>
      </div>

      {/* Zona de carga */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Seleccionar archivo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-green-400 transition-colors"
            onClick={() => inputRef.current?.click()}
          >
            {archivo ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-800">{archivo.name}</p>
                <p className="text-xs text-gray-500">{(archivo.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-500">Haz clic para seleccionar un archivo .xlsx</p>
                <p className="text-xs text-gray-400">Máximo 500 productos · 5 MB</p>
              </div>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={handleFileChange}
          />

          {errorGlobal && (
            <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{errorGlobal}</p>
          )}

          <div className="flex gap-2 justify-end">
            {archivo && estado !== "listo" && (
              <Button
                variant="outline"
                size="sm"
                onClick={resetear}
                disabled={estado === "importando"}
              >
                Limpiar
              </Button>
            )}
            {archivo && estado !== "listo" && (
              <Button
                size="sm"
                onClick={handlePreview}
                disabled={estado === "importando" || estado === "preview"}
              >
                {estado === "preview" ? "Previsualizando..." : "Previsualizar"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Preview / dry-run */}
      {preview && estado === "preview" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultado de previsualización</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResumenBadges
              creados={preview.creados}
              omitidos={preview.omitidos}
              errores={preview.errores.length}
              label="Se importarán"
            />

            {preview.categoriasCreadas.length > 0 && (
              <div className="text-sm text-blue-700 bg-blue-50 rounded px-3 py-2">
                Se crearán las categorías: <strong>{preview.categoriasCreadas.join(", ")}</strong>
              </div>
            )}

            {preview.errores.length > 0 && <TablaErrores errores={preview.errores} />}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={resetear}>Cancelar</Button>
              <Button
                size="sm"
                onClick={handleImportar}
                disabled={preview.creados === 0}
              >
                {preview.creados === 0
                  ? "Sin productos válidos"
                  : `Importar ${preview.creados} producto${preview.creados !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Procesando */}
      {estado === "importando" && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-gray-600">Importando productos...</p>
          </CardContent>
        </Card>
      )}

      {/* Resultado final */}
      {estado === "listo" && resultado && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-green-700">Importación completada</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResumenBadges
              creados={resultado.creados}
              omitidos={resultado.omitidos}
              errores={resultado.errores.length}
              label="Creados"
            />

            {resultado.categoriasCreadas.length > 0 && (
              <div className="text-sm text-blue-700 bg-blue-50 rounded px-3 py-2">
                Categorías creadas: <strong>{resultado.categoriasCreadas.join(", ")}</strong>
              </div>
            )}

            {resultado.errores.length > 0 && <TablaErrores errores={resultado.errores} />}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={resetear}>
                Importar otro archivo
              </Button>
              <Button size="sm" onClick={() => window.location.href = "/inventory"}>
                Ver inventario
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResumenBadges({
  creados, omitidos, errores, label,
}: { creados: number; omitidos: number; errores: number; label: string }) {
  return (
    <div className="flex gap-3 flex-wrap">
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-1">
        {label}: {creados}
      </span>
      {omitidos > 0 && (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-full px-3 py-1">
          Omitidos: {omitidos}
        </span>
      )}
      {errores > 0 && (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-3 py-1">
          Con errores: {errores}
        </span>
      )}
    </div>
  );
}

function TablaErrores({ errores }: { errores: ImportError[] }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-gray-700">Detalle de errores:</p>
      <div className="border rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-red-50 text-red-800">
            <tr>
              <th className="px-3 py-2 text-left w-16">Fila</th>
              <th className="px-3 py-2 text-left">Producto</th>
              <th className="px-3 py-2 text-left">Motivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {errores.map((e, idx) => (
              <tr key={idx} className="hover:bg-red-50/50">
                <td className="px-3 py-2 text-gray-500">{e.fila}</td>
                <td className="px-3 py-2 text-gray-800">{e.nombre || "—"}</td>
                <td className="px-3 py-2 text-red-600">{e.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
