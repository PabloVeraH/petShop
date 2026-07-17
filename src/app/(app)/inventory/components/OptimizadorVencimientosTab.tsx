"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, AlertCircle, Copy, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface RecomendacionVencimiento {
  producto_id: string;
  urgencia: "alta" | "media" | "baja";
  estrategia: "descuento" | "bundle" | "donacion" | "devolucion_proveedor";
  descuento_sugerido_pct: number;
  precio_oferta_sugerido: number;
  razon: string;
  mensaje_whatsapp: string;
  dias_hasta_vencer: number;
  stock: number;
  // Solo presente en resultados servidos desde caché (GET). true cuando el
  // producto cambió (nuevo lote, venta, ajuste) desde que se generó este
  // texto — las columnas Días/Stock ya muestran datos en vivo, pero razon/
  // mensaje_whatsapp/urgencia/estrategia/descuento siguen siendo los del
  // análisis original y pueden no coincidir con esos números.
  datos_desactualizados?: boolean;
}

interface AnalisisResultado {
  recomendaciones: RecomendacionVencimiento[];
  modelo_usado: string;
  productos_analizados: number;
  created_at?: string;
  dias_alerta?: number;
  productos_obsoletos?: number;
}

const URGENCIA_COLORS = {
  alta: "bg-red-100 text-red-700",
  media: "bg-amber-100 text-amber-700",
  baja: "bg-green-100 text-green-700",
};

const ESTRATEGIA_LABELS = {
  descuento: "Descuento",
  bundle: "Bundle",
  donacion: "Donación",
  devolucion_proveedor: "Devolución",
};

export function OptimizadorVencimientosTab() {
  const [diasAlerta, setDiasAlerta] = useState(30);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<AnalisisResultado | null>(null);
  const [aplicando, setAplicando] = useState<Set<string>>(new Set());
  const [aplicados, setAplicados] = useState<Set<string>>(new Set());
  const [errorAplicar, setErrorAplicar] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [detalle, setDetalle] = useState<RecomendacionVencimiento | null>(null);

  useEffect(() => {
    fetch("/api/ai/vencimientos/optimizar")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setResultado(data); })
      .catch(() => {})
      .finally(() => setIsLoadingHistory(false));
  }, []);

  const handleAnalizar = async () => {
    setIsLoading(true);
    setError(null);
    setResultado(null);
    // El backend puede tardar hasta ~45s en casos de cold-start + reintento
    // (ver maxDuration en la API route). Este timeout evita un spinner
    // indefinido si la respuesta nunca llega.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000);
    try {
      const res = await fetch("/api/ai/vencimientos/optimizar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diasAlerta }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const ct = res.headers?.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        throw new Error("Error al conectar con el servicio de IA. Intente de nuevo.");
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error inesperado");
      setResultado(data);
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("El análisis está tardando demasiado. Intente de nuevo.");
      } else {
        setError(e instanceof Error ? e.message : "Error inesperado");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAplicarDescuento = async (rec: RecomendacionVencimiento) => {
    setAplicando(prev => new Set(prev).add(rec.producto_id));
    setErrorAplicar(prev => ({ ...prev, [rec.producto_id]: "" }));

    try {
      const res = await fetch(`/api/productos/${rec.producto_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          precio_oferta: rec.precio_oferta_sugerido,
          en_oferta: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al aplicar descuento");
      setAplicados(prev => new Set(prev).add(rec.producto_id));
    } catch (e) {
      setErrorAplicar(prev => ({
        ...prev,
        [rec.producto_id]: e instanceof Error ? e.message : "Error",
      }));
    } finally {
      setAplicando(prev => { const s = new Set(prev); s.delete(rec.producto_id); return s; });
    }
  };

  const handleCopiarWhatsApp = (mensaje: string, productoId: string) => {
    navigator.clipboard.writeText(mensaje);
    setCopied(productoId);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>🤖</span>
            Optimizador de Vencimientos con IA
          </CardTitle>
          <CardDescription>
            Analiza productos próximos a vencer y recibe recomendaciones inteligentes para minimizar pérdidas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">
                Analizar productos que venzan en los próximos:
              </label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={diasAlerta}
                  onChange={(e) => setDiasAlerta(Number(e.target.value))}
                  min="1"
                  max="365"
                  className="w-24"
                />
                <span>días</span>
              </div>
            </div>
            <Button
              onClick={handleAnalizar}
              disabled={isLoading}
              className="px-6"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Clock className="h-4 w-4 mr-2" />
              )}
              Analizar con IA
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">
                Analizando {resultado?.productos_analizados || 0} productos con {resultado?.modelo_usado || "modelo"}...
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent className="flex items-center gap-2 py-4 text-red-600">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </CardContent>
        </Card>
      )}

      {resultado?.recomendaciones && resultado.recomendaciones.length === 0 && !isLoading && !error && !isLoadingHistory && (
        <Card>
          <CardContent className="text-center py-12">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <p className="text-lg font-medium text-green-700">
              No hay productos próximos a vencer
            </p>
            <p className="text-muted-foreground mt-2">
              con stock disponible en los próximos {diasAlerta} días.
            </p>
          </CardContent>
        </Card>
      )}

      {resultado?.recomendaciones && resultado.recomendaciones.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-lg">Recomendaciones de IA</CardTitle>
                <CardDescription>
                  {resultado.productos_analizados} productos analizados
                </CardDescription>
                {resultado.created_at && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                    Generado el {new Date(resultado.created_at).toLocaleString("es-CL")}
                    {Date.now() - new Date(resultado.created_at).getTime() > 7 * 24 * 60 * 60 * 1000 && (
                      <Badge className="bg-amber-100 text-amber-700">Puede estar desactualizado</Badge>
                    )}
                  </p>
                )}
              </div>
              {resultado.productos_obsoletos && resultado.productos_obsoletos > 0 && (
                <div className="mt-3 p-3 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-800">
                  <span className="font-medium">{resultado.productos_obsoletos}{" "}
                  recomendación(es) omitidas</span> porque sus productos ya no son válidos en el catálogo actual (inactivos, eliminados o sin seguimiento de vencimiento). Genera un nuevo análisis para obtener datos actualizados.
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium">Producto</th>
                    <th className="text-left py-3 px-4 font-medium">Días</th>
                    <th className="text-left py-3 px-4 font-medium">Stock</th>
                    <th className="text-left py-3 px-4 font-medium">Urgencia</th>
                    <th className="text-left py-3 px-4 font-medium">Descuento</th>
                    <th className="text-left py-3 px-4 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.recomendaciones.map((rec) => (
                    <tr
                      key={rec.producto_id}
                      className="border-b hover:bg-muted/50 cursor-pointer"
                      onClick={() => setDetalle(rec)}
                    >
                      <td className="py-3 px-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{rec.razon}</p>
                            {rec.datos_desactualizados && (
                              <Badge
                                className="bg-amber-100 text-amber-700 shrink-0"
                                title="El producto cambió (nuevo lote, venta o ajuste) desde que se generó este texto — Días y Stock ya son actuales, pero la recomendación puede no coincidir"
                              >
                                Texto desactualizado
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {rec.mensaje_whatsapp.length > 60
                              ? `${rec.mensaje_whatsapp.substring(0, 60)}...`
                              : rec.mensaje_whatsapp
                            }
                          </p>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium">{Math.max(0, rec.dias_hasta_vencer)}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium">{rec.stock}</span>
                      </td>
                      <td className="py-3 px-4">
                        <Badge className={URGENCIA_COLORS[rec.urgencia]}>
                          {rec.urgencia}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <div>
                          <span className="font-medium">{rec.descuento_sugerido_pct}%</span>
                          <span className="text-sm text-muted-foreground ml-2">
                            ${rec.precio_oferta_sugerido.toLocaleString()}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-2 items-start">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAplicarDescuento(rec)}
                            disabled={aplicados.has(rec.producto_id) || aplicando.has(rec.producto_id)}
                            className="text-xs"
                          >
                            {aplicados.has(rec.producto_id) ? (
                              <>
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Aplicado
                              </>
                            ) : aplicando.has(rec.producto_id) ? (
                              "Aplicando..."
                            ) : (
                              `Aplicar descuento (${rec.descuento_sugerido_pct}%)`
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Copiar mensaje WhatsApp"
                            onClick={() => handleCopiarWhatsApp(rec.mensaje_whatsapp, rec.producto_id)}
                            className="text-xs"
                          >
                            {copied === rec.producto_id ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                          {errorAplicar[rec.producto_id] && (
                            <div className="text-xs text-red-500 mt-1">
                              {errorAplicar[rec.producto_id]}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      {detalle && (
        <Dialog open={!!detalle} onOpenChange={(open) => { if (!open) setDetalle(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Badge className={URGENCIA_COLORS[detalle.urgencia]}>{detalle.urgencia}</Badge>
                <span className="text-sm font-normal text-muted-foreground">
                  {ESTRATEGIA_LABELS[detalle.estrategia]} · {detalle.descuento_sugerido_pct}% off · {Math.max(0, detalle.dias_hasta_vencer)} días · stock {detalle.stock}
                </span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {detalle.datos_desactualizados && (
                <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-800">
                  El producto cambió (nuevo lote, venta o ajuste) desde que se generó este análisis.
                  Días y Stock ya muestran datos actuales, pero el texto de abajo puede no coincidir.
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Análisis</p>
                <p className="text-sm">{detalle.razon}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Mensaje WhatsApp</p>
                <p className="text-sm whitespace-pre-wrap">{detalle.mensaje_whatsapp}</p>
              </div>
              <div className="flex justify-between items-center pt-2 border-t">
                <span className="text-sm text-muted-foreground">
                  Precio oferta: <strong>${detalle.precio_oferta_sugerido.toLocaleString()}</strong>
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopiarWhatsApp(detalle.mensaje_whatsapp, detalle.producto_id)}
                  >
                    {copied === detalle.producto_id ? <CheckCircle2 className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                    Copiar WA
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { handleAplicarDescuento(detalle); setDetalle(null); }}
                    disabled={aplicados.has(detalle.producto_id) || aplicando.has(detalle.producto_id)}
                  >
                    {aplicados.has(detalle.producto_id) ? "✓ Aplicado" : `Aplicar descuento (${detalle.descuento_sugerido_pct}%)`}
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}