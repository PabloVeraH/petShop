"use client";

import { useState, useEffect } from "react";

interface Prediccion {
  prediccion: number[];
  tendencia: "alta" | "baja" | "estable";
  confianza: number;
  estacionalidad: string[];
  insuficienteDatos?: boolean;
}

interface ProductoBasico {
  id: string;
  nombre: string;
}

export default function PrediccionPage() {
  const [productos, setProductos] = useState<ProductoBasico[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [prediccion, setPrediccion] = useState<Prediccion | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProductos, setLoadingProductos] = useState(true);

  useEffect(() => {
    fetch("/api/productos")
      .then(r => r.json())
      .then((data: ProductoBasico[]) => setProductos(data || []))
      .finally(() => setLoadingProductos(false));
  }, []);

  const handlePredict = async () => {
    if (!selectedProduct) return;
    setLoading(true);
    const res = await fetch(`/api/reports/prediccion?producto_id=${selectedProduct}&dias=30`);
    const data = await res.json();
    setPrediccion(data);
    setLoading(false);
  };

  const tendenciaColor = {
    alta: "text-green-700 bg-green-50",
    baja: "text-red-700 bg-red-50",
    estable: "text-gray-700 bg-gray-50",
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Predicción de Demanda</h1>

      <div className="flex gap-4 mb-6">
        <select
          value={selectedProduct}
          onChange={e => setSelectedProduct(e.target.value)}
          className="border rounded px-3 py-2 flex-1"
          disabled={loadingProductos}
        >
          <option value="">
            {loadingProductos ? "Cargando productos..." : "Seleccionar producto"}
          </option>
          {productos.map(p => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>

        <button
          onClick={handlePredict}
          disabled={!selectedProduct || loading}
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? "Calculando..." : "Predecir"}
        </button>
      </div>

      {prediccion && (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className={`p-4 rounded ${tendenciaColor[prediccion.tendencia]}`}>
              <div className="text-sm opacity-70">Tendencia</div>
              <div className="text-2xl font-bold capitalize">{prediccion.tendencia}</div>
            </div>
            <div className="bg-blue-50 p-4 rounded">
              <div className="text-sm text-gray-600">Confianza</div>
              <div className="text-2xl font-bold">{Math.round(prediccion.confianza * 100)}%</div>
            </div>
            <div className="bg-purple-50 p-4 rounded">
              <div className="text-sm text-gray-600">Total 30 días</div>
              <div className="text-2xl font-bold">
                {prediccion.prediccion.reduce((a, b) => a + b, 0)} uds.
              </div>
            </div>
          </div>

          {prediccion.estacionalidad.length > 0 && (
            <p className="text-sm text-gray-600 mb-4">
              Días pico: {prediccion.estacionalidad.join(" · ")}
            </p>
          )}

          {prediccion.insuficienteDatos && (
            <div className="bg-amber-50 border border-amber-200 rounded p-4 mb-4">
              <p className="text-sm font-medium text-amber-800">Datos insuficientes para predicción</p>
              <p className="text-xs text-amber-700 mt-1">
                Se necesitan al menos {10} registros históricos de ventas. Actualmente hay datos insuficientes para generar una proyección confiable.
              </p>
            </div>
          )}

          {!prediccion.insuficienteDatos && (
            <div className="bg-white border rounded overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm">Día</th>
                    <th className="px-4 py-2 text-right text-sm">Unidades predichas</th>
                  </tr>
                </thead>
                <tbody>
                  {prediccion.prediccion.slice(0, 14).map((cant, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-4 py-2 text-sm">Día {i + 1}</td>
                      <td className="px-4 py-2 text-right font-medium">{cant}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
