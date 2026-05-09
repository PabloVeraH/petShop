"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LotesPanel } from "./components/LotesPanel";
import { CategoriasTab } from "./components/CategoriasTab";

type Producto = {
  id: string;
  nombre: string;
  sku: string;
  precio: number | null;
  costo: number | null;
  stock: number;
  stock_minimo: number;
  marca: string | null;
  peso_gramos: number | null;
  fecha_vencimiento: string | null;
  dias_alerta_expira: number;
  precio_oferta: number | null;
  en_oferta: boolean;
  categoria_id: string | null;
  codigo_barra: string | null;
};

type Categoria = {
  id: string;
  nombre: string;
};

type Tab = "productos" | "categorias";
type AjusteModal = { producto: Producto; tipo: "entrada" | "salida" } | null;
type HistorialModal = Producto | null;

type StockMovement = {
  id: string;
  tipo: string;
  cantidad: number;
  notas: string | null;
  created_at: string;
};

type ProductoForm = {
  nombre: string;
  sku: string;
  precio: string;
  costo: string;
  stock: string;
  stock_minimo: string;
  marca: string;
  peso_gramos: string;
  fecha_vencimiento: string;
  dias_alerta_expira: string;
  precio_oferta: string;
  en_oferta: boolean;
  categoria_id: string;
  codigo_barra: string;
};

const EMPTY_FORM: ProductoForm = {
  nombre: "", sku: "", precio: "", costo: "",
  stock: "0", stock_minimo: "0", marca: "", peso_gramos: "",
  fecha_vencimiento: "", dias_alerta_expira: "30", precio_oferta: "", en_oferta: false,
  categoria_id: "", codigo_barra: "",
};

async function getInventario(search: string, soloAlertas: boolean, soloVencimientos: boolean): Promise<Producto[]> {
  const params = new URLSearchParams({ search });
  if (soloAlertas) params.set("alertas", "1");
  if (soloVencimientos) params.set("vencimiento", "1");
  const res = await fetch(`/api/inventario?${params}`);
  if (!res.ok) throw new Error("Error al cargar inventario");
  return res.json();
}

type VencimientoStatus = 'sin-fecha' | 'vigente' | 'proximo' | 'vencido';

function getVencimientoStatus(producto: Producto): VencimientoStatus {
  if (!producto.fecha_vencimiento) return 'sin-fecha';
  const diasRestantes = Math.ceil((new Date(producto.fecha_vencimiento).getTime() - new Date().getTime()) / 86400000);
  if (diasRestantes < 0) return 'vencido';
  if (diasRestantes <= (producto.dias_alerta_expira ?? 30)) return 'proximo';
  return 'vigente';
}

function formatShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year.slice(2)}`;
}

async function getCategorias(): Promise<Categoria[]> {
  const res = await fetch("/api/categorias");
  if (!res.ok) return [];
  return res.json();
}

export default function InventoryPage() {
  const { user } = useUser();
  const meta = user?.publicMetadata as Record<string, unknown> | undefined;
  const isAdmin = !!(meta?.storeAdmin || meta?.systemAdmin);
  const isSystemAdmin = !!meta?.systemAdmin;

  const [tab, setTab] = useState<Tab>("productos");
  const [search, setSearch] = useState("");
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [soloVencimientos, setSoloVencimientos] = useState(false);
  const [ajuste, setAjuste] = useState<AjusteModal>(null);
  const [ajusteCantidad, setAjusteCantidad] = useState("1");
  const [ajusteNotas, setAjusteNotas] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editando, setEditando] = useState<Producto | null>(null);
  const [form, setForm] = useState<ProductoForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Producto | null>(null);
  const [historial, setHistorial] = useState<HistorialModal>(null);
  const [verLotesDe, setVerLotesDe] = useState<{ id: string; nombre: string; dias_alerta_expira: number } | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["inventario", search, soloAlertas, soloVencimientos],
    queryFn: () => getInventario(search, soloAlertas, soloVencimientos),
  });

  const { data: categorias = [] } = useQuery<Categoria[]>({
    queryKey: ["categorias"],
    queryFn: getCategorias,
    staleTime: 5 * 60 * 1000,
  });

  const { data: movimientos, isLoading: loadingMovimientos } = useQuery<StockMovement[]>({
    queryKey: ["stock-movements", historial?.id],
    queryFn: () => fetch(`/api/stock-movements?productoId=${historial!.id}`).then((r) => r.json()),
    enabled: !!historial,
  });

  const { mutate: aplicarAjuste, isPending: guardandoAjuste } = useMutation({
    mutationFn: () =>
      fetch(`/api/inventario/${ajuste!.producto.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: ajuste!.tipo, cantidad: Number(ajusteCantidad), notas: ajusteNotas || undefined }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventario"] });
      setAjuste(null); setAjusteCantidad("1"); setAjusteNotas("");
    },
  });

  const { mutate: guardarProducto, isPending: guardandoProducto } = useMutation({
    mutationFn: async () => {
      const url = editando ? `/api/productos/${editando.id}` : "/api/productos";
      const method = editando ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.nombre,
          sku: form.sku,
          precio: Number(form.precio),
          costo: form.costo ? Number(form.costo) : undefined,
          stock: Number(form.stock),
          stock_minimo: Number(form.stock_minimo),
          marca: form.marca || undefined,
          peso_gramos: form.peso_gramos ? Number(form.peso_gramos) : undefined,
          fecha_vencimiento: form.fecha_vencimiento || undefined,
          dias_alerta_expira: form.fecha_vencimiento ? Number(form.dias_alerta_expira) : undefined,
          precio_oferta: form.precio_oferta ? Number(form.precio_oferta) : undefined,
          en_oferta: form.en_oferta,
          categoria_id: form.categoria_id || null,
          codigo_barra: form.codigo_barra || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventario"] });
      queryClient.invalidateQueries({ queryKey: ["productos"] });
      setShowForm(false); setEditando(null); setForm(EMPTY_FORM); setFormError("");
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const { mutate: desactivarProducto } = useMutation({
    mutationFn: (id: string) => fetch(`/api/productos/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventario"] });
      queryClient.invalidateQueries({ queryKey: ["productos"] });
      setConfirmDelete(null);
    },
  });

  function abrirEditar(p: Producto) {
    setEditando(p);
    setForm({
      nombre: p.nombre, sku: p.sku,
      precio: p.precio != null ? String(p.precio) : "", costo: p.costo != null ? String(p.costo) : "",
      stock: String(p.stock), stock_minimo: String(p.stock_minimo),
      marca: p.marca ?? "", peso_gramos: p.peso_gramos != null ? String(p.peso_gramos) : "",
      fecha_vencimiento: p.fecha_vencimiento ? p.fecha_vencimiento.split("T")[0] : "",
      dias_alerta_expira: String(p.dias_alerta_expira ?? 30),
      precio_oferta: p.precio_oferta != null ? String(p.precio_oferta) : "",
      en_oferta: p.en_oferta ?? false,
      categoria_id: p.categoria_id ?? "",
      codigo_barra: p.codigo_barra ?? "",
    });
    setFormError("");
    setShowForm(true);
  }

  function abrirNuevo() {
    setEditando(null); setForm(EMPTY_FORM); setFormError(""); setShowForm(true);
  }

  const productos = data ?? [];
  const totalAlertas = data?.filter((p) => p.stock <= p.stock_minimo).length ?? 0;

  const setF = (k: keyof ProductoForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (k === "en_oferta") {
      setForm((f) => ({ ...f, [k]: (e.target as HTMLInputElement).checked }));
    } else {
      setForm((f) => ({ ...f, [k]: e.target.value }));
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Inventario</h1>
        {tab === "productos" && (
          <div className="flex items-center gap-2">
            {totalAlertas > 0 && !soloAlertas && (
              <span className="text-xs font-medium text-red-600 bg-red-50 px-3 py-1 rounded-full">
                {totalAlertas} bajo stock mínimo
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => window.location.href = "/inventory/import"}>
              Importar
            </Button>
            <Button size="sm" onClick={abrirNuevo}>+ Nuevo producto</Button>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="flex border-b border-gray-200">
          {(["productos", "categorias"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
                tab === t
                  ? "border-green-600 text-green-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "productos" ? "Productos" : "Categorías"}
            </button>
          ))}
        </div>
      )}

      {tab === "categorias" && <CategoriasTab />}

      {tab === "productos" && (
      <>
      <div className="flex gap-2">
        <Input
          placeholder="Buscar por nombre o SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button
          variant={soloAlertas ? "default" : "outline"}
          size="sm"
          onClick={() => setSoloAlertas((v) => !v)}
        >
          Solo alertas
        </Button>
        <Button
          variant={soloVencimientos ? "default" : "outline"}
          size="sm"
          onClick={() => setSoloVencimientos((v) => !v)}
        >
          Solo vencimientos
        </Button>
      </div>

      <div className="flex-1 overflow-auto rounded-lg bg-white shadow-sm">
        {isLoading && <p className="text-sm text-gray-400 p-4 text-center">Cargando...</p>}
        {isError && <p className="text-sm text-red-500 p-4 text-center">Error al cargar inventario.</p>}
        {!isLoading && !isError && productos.length === 0 && (
          <p className="text-sm text-gray-400 p-4 text-center">
            {soloAlertas ? "Sin productos en alerta" : soloVencimientos ? "Sin productos con vencimiento" : "Sin productos"}
          </p>
        )}
        {!isLoading && !isError && productos.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Precio (c/IVA)</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Mín.</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Ajustar</TableHead>
                {isAdmin && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {productos.map((p) => {
                const enAlerta = p.stock <= p.stock_minimo;
                const vencStatus = getVencimientoStatus(p);
                const diasRestantes = p.fecha_vencimiento
                  ? Math.ceil((new Date(p.fecha_vencimiento).getTime() - new Date().getTime()) / 86400000)
                  : null;
                return (
                  <TableRow key={p.id} className={enAlerta || vencStatus === 'vencido' ? "bg-red-50" : vencStatus === 'proximo' ? "bg-amber-50" : undefined}>
                    <TableCell className="font-medium">{p.nombre}</TableCell>
                    <TableCell className="text-gray-500 text-sm">{p.sku}</TableCell>
                    <TableCell className="text-right">{p.precio != null ? `$${p.precio.toLocaleString("es-CL")}` : <span className="text-gray-400 text-xs">Sin precio</span>}{p.en_oferta && p.precio_oferta && <span className="text-xs text-red-500 ml-1">${p.precio_oferta}</span>}</TableCell>
                    <TableCell className="text-right font-medium">{p.stock}</TableCell>
                    <TableCell className="text-right text-gray-500">{p.stock_minimo}</TableCell>
                    <TableCell>
                      {vencStatus === 'sin-fecha' && (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                      {vencStatus === 'vigente' && (
                        <span className="text-sm font-medium text-green-600">
                          vence {formatShortDate(p.fecha_vencimiento!)}
                        </span>
                      )}
                      {vencStatus === 'proximo' && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                          ⚠ {diasRestantes} dias
                        </span>
                      )}
                      {vencStatus === 'vencido' && p.stock > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                          ✕ Vencido
                        </span>
                      )}
                      {vencStatus === 'vencido' && p.stock === 0 && (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {enAlerta
                        ? <Badge variant="destructive">Bajo stock</Badge>
                        : <Badge variant="secondary">OK</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <button
                          onClick={() => { setAjuste({ producto: p, tipo: "entrada" }); setAjusteCantidad("1"); setAjusteNotas(""); }}
                          className="px-2 py-1 text-xs rounded bg-green-50 text-green-700 hover:bg-green-100 border border-green-200"
                        >+</button>
                        <button
                          onClick={() => { setAjuste({ producto: p, tipo: "salida" }); setAjusteCantidad("1"); setAjusteNotas(""); }}
                          className="px-2 py-1 text-xs rounded bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                        >−</button>
                      </div>
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <div className="flex gap-1">
                          <button onClick={() => abrirEditar(p)} className="text-xs text-blue-500 hover:underline">Editar</button>
                          <button onClick={() => setHistorial(p)} className="text-xs text-gray-500 hover:underline ml-1">Historial</button>
                          <button onClick={() => setVerLotesDe({ id: p.id, nombre: p.nombre, dias_alerta_expira: p.dias_alerta_expira ?? 30 })} className="text-xs text-purple-600 hover:underline ml-1">Lotes</button>
                          <button onClick={() => setConfirmDelete(p)} className="text-xs text-red-400 hover:underline ml-1">Desact.</button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Modal crear/editar producto */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-gray-800 mb-4">
              {editando ? `Editar: ${editando.nombre}` : "Nuevo producto"}
            </h3>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {[
                { label: "Nombre *", key: "nombre" as const, placeholder: "Alimento Premium Perro 15kg" },
                { label: "SKU *", key: "sku" as const, placeholder: "PRD-001" },
                { label: "Código de barra", key: "codigo_barra" as const, placeholder: "7891234567890" },
                { label: "Precio venta c/IVA *", key: "precio" as const, placeholder: "19990", type: "number" },
                { label: "Costo (opcional)", key: "costo" as const, placeholder: "12000", type: "number" },
                { label: "Stock inicial", key: "stock" as const, placeholder: "0", type: "number" },
                { label: "Stock mínimo", key: "stock_minimo" as const, placeholder: "5", type: "number" },
                { label: "Marca", key: "marca" as const, placeholder: "ProCan" },
                { label: "Peso (gramos)", key: "peso_gramos" as const, placeholder: "15000", type: "number" },
                { label: "Fecha vencimiento (opcional)", key: "fecha_vencimiento" as const, type: "date" },
              ].map(({ label, key, placeholder, type }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    type={type ?? "text"}
                    value={form[key]}
                    onChange={setF(key)}
                    placeholder={placeholder}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              ))}
              {form.fecha_vencimiento && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Días de alerta</label>
                  <input type="number" min={1} value={form.dias_alerta_expira} onChange={(e) => setForm(f => ({ ...f, dias_alerta_expira: e.target.value }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
                <select
                  value={form.categoria_id}
                  onChange={(e) => setForm((f) => ({ ...f, categoria_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Sin categoría</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Precio oferta c/IVA (opcional)</label>
                <input type="number" step="0.01" value={form.precio_oferta} onChange={(e) => setForm(f => ({ ...f, precio_oferta: e.target.value }))}
                  placeholder="Precio rebajado c/IVA"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.en_oferta}
                  onChange={(e) => setForm(f => ({ ...f, en_oferta: e.target.checked }))}
                  id="en-oferta"
                  disabled={!form.precio_oferta || Number(form.precio_oferta) <= 0}
                  className="rounded border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                />
                <label htmlFor="en-oferta" className={`text-sm font-medium cursor-pointer ${!form.precio_oferta || Number(form.precio_oferta) <= 0 ? 'text-gray-400' : 'text-gray-700'}`}>
                  Activar oferta
                </label>
              </div>
            </div>
            {formError && <p className="text-xs text-red-500 mt-3">{formError}</p>}
            <div className="flex gap-2 mt-5">
              <Button variant="outline" onClick={() => { setShowForm(false); setEditando(null); setForm(EMPTY_FORM); setFormError(""); }} className="flex-1">
                Cancelar
              </Button>
              <Button onClick={() => guardarProducto()} disabled={guardandoProducto} className="flex-1">
                {guardandoProducto ? "Guardando..." : editando ? "Guardar cambios" : "Crear producto"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal ajuste de stock */}
      {ajuste && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-gray-800 mb-1">
              {ajuste.tipo === "entrada" ? "Entrada de stock" : "Salida de stock"}
            </h3>
            <p className="text-sm text-gray-500 mb-4">{ajuste.producto.nombre} — stock actual: {ajuste.producto.stock}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad</label>
                <input type="number" min={1} value={ajusteCantidad} onChange={(e) => setAjusteCantidad(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Motivo (opcional)</label>
                <input type="text" value={ajusteNotas} onChange={(e) => setAjusteNotas(e.target.value)}
                  placeholder="Ej: conteo físico, devolución, merma..."
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <Button variant="outline" onClick={() => setAjuste(null)} className="flex-1">Cancelar</Button>
              <Button onClick={() => aplicarAjuste()} disabled={guardandoAjuste || !ajusteCantidad || Number(ajusteCantidad) <= 0}
                className={`flex-1 ${ajuste.tipo === "salida" ? "bg-red-600 hover:bg-red-700" : ""}`}>
                {guardandoAjuste ? "Guardando..." : ajuste.tipo === "entrada" ? "Agregar" : "Descontar"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal historial de movimientos */}
      {historial && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-800">Historial: {historial.nombre}</h3>
              <button onClick={() => setHistorial(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <div className="overflow-y-auto flex-1">
              {loadingMovimientos && <p className="text-sm text-gray-400 text-center py-4">Cargando...</p>}
              {!loadingMovimientos && (!movimientos || movimientos.length === 0) && (
                <p className="text-sm text-gray-400 text-center py-4">Sin movimientos registrados</p>
              )}
              {movimientos && movimientos.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b">
                      <th className="text-left py-1">Fecha</th>
                      <th className="text-left py-1">Tipo</th>
                      <th className="text-right py-1">Cant.</th>
                      <th className="text-left py-1 pl-3">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimientos.map((m) => (
                      <tr key={m.id} className="border-b last:border-0">
                        <td className="py-1.5 text-gray-500 text-xs">
                          {new Date(m.created_at).toLocaleDateString("es-CL")}
                        </td>
                        <td className="py-1.5">
                          <span className={`text-xs font-medium ${m.tipo === "entrada" ? "text-green-600" : "text-red-500"}`}>
                            {m.tipo}
                          </span>
                        </td>
                        <td className={`py-1.5 text-right font-medium ${m.cantidad > 0 ? "text-green-700" : "text-red-600"}`}>
                          {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
                        </td>
                        <td className="py-1.5 pl-3 text-gray-500 text-xs">{m.notas ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="pt-4">
              <Button variant="outline" onClick={() => setHistorial(null)} className="w-full">Cerrar</Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm desactivar */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-gray-800 mb-2">¿Desactivar producto?</h3>
            <p className="text-sm text-gray-500 mb-4">
              <strong>{confirmDelete.nombre}</strong> dejará de aparecer en el POS y el inventario. El historial de ventas se mantiene.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(null)} className="flex-1">Cancelar</Button>
              <Button variant="destructive" onClick={() => desactivarProducto(confirmDelete.id)} className="flex-1">Desactivar</Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal LotesPanel */}
      {verLotesDe && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-800">Lotes: {verLotesDe.nombre}</h3>
              <button onClick={() => setVerLotesDe(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <LotesPanel
              productoId={verLotesDe.id}
              storeId=""
              diasAlerta={verLotesDe.dias_alerta_expira}
              esSoloLectura={!isAdmin}
              puedeAgregarLote={isSystemAdmin}
            />
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
