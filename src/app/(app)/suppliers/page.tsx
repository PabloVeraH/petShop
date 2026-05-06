"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as XLSX from "xlsx";

type Proveedor = { id: string; nombre: string; rut: string | null; contacto: string | null; telefono: string | null; email: string | null };
type ProdRow = { id: string; costo: number | null; tiempo_entrega_dias: number | null; productos: { id: string; nombre: string; sku: string; stock: number } | null };
type DetalleProveedor = Proveedor & { productos: ProdRow[] };
type OrdenCompra = { id: string; numero: string; estado: string; total: number; fecha_estimada: string | null; fecha_recibida: string | null; created_at: string };
type OrdenItem = { id: string; cantidad_solicitada: number; cantidad_recibida: number | null; precio_unitario: number | null; nombre_nuevo: string | null; productos: { id: string; nombre: string; sku: string; tiene_vencimiento: boolean } | null };
type CuentaPagar = { id: string; monto: number; fecha_vencimiento: string; estado: string; orden_id?: string };
type ProductoOpt = { id: string; nombre: string; sku: string; precio: number };

type SavedFilter = { id: string; name: string; type: "overdue" | "due-soon" | "due-this-week" | "custom" };

const EMPTY_FORM = { nombre: "", rut: "", contacto: "", telefono: "", email: "" };
const SAVED_FILTERS_KEY = "supply-chain-saved-filters";

export default function SupplierHubPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Proveedor | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [editingProveedor, setEditingProveedor] = useState(false);
  const [showAddProd, setShowAddProd] = useState(false);
  const [prodForm, setProdForm] = useState({ producto_id: "", costo: "", tiempo_entrega_dias: "3" });
  const [showCreateOrder, setShowCreateOrder] = useState(false);
  const [orderForm, setOrderForm] = useState({ items: [] as Array<{ producto_id: string | null; nombre_nuevo: string; nombre: string; cantidad: string; esNuevo: boolean }> });
  const [addingOrderItem, setAddingOrderItem] = useState({ producto_id: "", nombre_nuevo: "", cantidad: "1", esNuevo: false });
  const [selectedOrden, setSelectedOrden] = useState<string | null>(null);
  const [showReceiving, setShowReceiving] = useState<string | null>(null);
  const [receivingForm, setReceivingForm] = useState<Record<string, { cantidad: number; precio: string; fecha_vencimiento?: string }>>({});
  const [receivingError, setReceivingError] = useState("");
  const [selectedPayables, setSelectedPayables] = useState<Set<string>>(new Set());
  const [payablesFilter, setPayablesFilter] = useState<"all" | "overdue" | "due-soon" | "due-this-week" | "custom">("all");
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = localStorage.getItem(SAVED_FILTERS_KEY);
    return stored ? JSON.parse(stored) : [];
  });
  const queryClient = useQueryClient();

  const { data: proveedores, isLoading } = useQuery<Proveedor[]>({
    queryKey: ["proveedores", search],
    queryFn: async () => {
      const res = await fetch(`/api/proveedores?search=${search}`);
      return res.json();
    },
  });

  const { data: detalle } = useQuery<DetalleProveedor>({
    queryKey: ["proveedor", selected?.id],
    queryFn: async () => {
      const res = await fetch(`/api/proveedores/${selected!.id}`);
      return res.json();
    },
    enabled: !!selected?.id,
  });

  const { data: ordenes } = useQuery<OrdenCompra[]>({
    queryKey: ["ordenes-proveedor", selected?.id],
    queryFn: async () => {
      const res = await fetch(`/api/ordenes-compra?proveedor_id=${selected!.id}`);
      return res.json();
    },
    enabled: !!selected?.id,
  });

  const { data: cuentas } = useQuery<CuentaPagar[]>({
    queryKey: ["cuentas-proveedor", selected?.id],
    queryFn: async () => {
      const res = await fetch(`/api/cuentas-pagar?proveedor_id=${selected!.id}`);
      return res.json();
    },
    enabled: !!selected?.id,
  });

  const { data: todosProductos } = useQuery<ProductoOpt[]>({
    queryKey: ["productos-activos"],
    queryFn: async () => {
      const res = await fetch("/api/inventario?search=");
      return res.json();
    },
    enabled: showAddProd || showCreateOrder,
  });

  // Phase 3: Calculate supplier performance (on-time delivery %)
  const supplierPerformance = useMemo(() => {
    if (!ordenes || ordenes.length === 0) return null;
    const recibidas = ordenes.filter(o => o.estado === "recibida");
    if (recibidas.length === 0) return null;
    const onTime = recibidas.filter(o => {
      if (!o.fecha_estimada || !o.fecha_recibida) return false;
      return new Date(o.fecha_recibida) <= new Date(o.fecha_estimada);
    }).length;
    return Math.round((onTime / recibidas.length) * 100);
  }, [ordenes]);

  // Phase 4: KPI Dashboard data
  const kpiData = useMemo(() => {
    const allCuentas = cuentas || [];
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const pendiente = allCuentas.filter(c => c.estado === "pendiente");
    const overdue = pendiente.filter(c => new Date(c.fecha_vencimiento) < hoy);
    const dueSoon = pendiente.filter(c => {
      const venc = new Date(c.fecha_vencimiento);
      const daysUntil = Math.ceil((venc.getTime() - hoy.getTime()) / 86400000);
      return daysUntil > 0 && daysUntil <= 7;
    });

    return {
      totalPendiente: pendiente.reduce((sum, c) => sum + Number(c.monto), 0),
      pendienteCount: pendiente.length,
      overdueCount: overdue.length,
      dueSoonCount: dueSoon.length,
      ordersInProgress: (ordenes || []).filter(o => o.estado === "pendiente").length,
    };
  }, [cuentas, ordenes]);

  // Phase 3 & 4: Filter payables
  const filteredPayables = useMemo(() => {
    if (!cuentas) return [];
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let filtered = cuentas.filter(c => c.estado === "pendiente");

    switch (payablesFilter) {
      case "overdue":
        filtered = filtered.filter(c => new Date(c.fecha_vencimiento) < hoy);
        break;
      case "due-soon":
        filtered = filtered.filter(c => {
          const venc = new Date(c.fecha_vencimiento);
          const daysUntil = Math.ceil((venc.getTime() - hoy.getTime()) / 86400000);
          return daysUntil > 0 && daysUntil <= 7;
        });
        break;
      case "due-this-week":
        const weekStart = new Date(hoy);
        const weekEnd = new Date(hoy);
        weekEnd.setDate(weekEnd.getDate() + 7);
        filtered = filtered.filter(c => {
          const venc = new Date(c.fecha_vencimiento);
          return venc >= weekStart && venc <= weekEnd;
        });
        break;
      case "custom":
      case "all":
        break;
    }

    return filtered.sort((a, b) => new Date(a.fecha_vencimiento).getTime() - new Date(b.fecha_vencimiento).getTime());
  }, [cuentas, payablesFilter]);

  const { mutate: createProveedor, isPending: creating } = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/proveedores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["proveedores"] }); setShowForm(false); setForm(EMPTY_FORM); setFormError(""); },
    onError: (e: Error) => setFormError(e.message),
  });

  const { mutate: updateProveedor, isPending: updating } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/proveedores/${selected!.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["proveedores"] });
      queryClient.invalidateQueries({ queryKey: ["proveedor", selected?.id] });
      setSelected(data);
      setEditingProveedor(false);
      setFormError("");
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const { mutate: deleteProveedor } = useMutation({
    mutationFn: async (id: string) => { await fetch(`/api/proveedores?id=${id}`, { method: "DELETE" }); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["proveedores"] }); setSelected(null); },
  });

  const { mutate: addProducto, isPending: addingProd } = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/proveedor-productos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proveedor_id: selected!.id, ...prodForm }) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["proveedor", selected?.id] }); setShowAddProd(false); setProdForm({ producto_id: "", costo: "", tiempo_entrega_dias: "3" }); },
  });

  const { mutate: removeProducto } = useMutation({
    mutationFn: async (id: string) => { await fetch(`/api/proveedor-productos?id=${id}`, { method: "DELETE" }); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proveedor", selected?.id] }),
  });

  const { mutate: createOrden, isPending: creatingOrder } = useMutation({
    mutationFn: async () => {
      const items = orderForm.items.map(item => ({
        producto_id: item.producto_id ?? undefined,
        nombre_nuevo: item.esNuevo ? item.nombre_nuevo : undefined,
        cantidad_solicitada: Number(item.cantidad),
      }));
      const res = await fetch("/api/ordenes-compra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedor_id: selected!.id, items }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ordenes-proveedor", selected?.id] });
      setShowCreateOrder(false);
      setOrderForm({ items: [] });
      setAddingOrderItem({ producto_id: "", nombre_nuevo: "", cantidad: "1", esNuevo: false });
    },
  });

  const { data: ordenDetalle } = useQuery<OrdenCompra & { items: OrdenItem[] }>({
    queryKey: ["orden-detalle", selectedOrden],
    queryFn: async () => {
      const res = await fetch(`/api/ordenes-compra/${selectedOrden}`);
      return res.json();
    },
    enabled: !!selectedOrden,
  });

  const { mutate: cambiarEstadoOrden } = useMutation({
    mutationFn: async ({ ordenId, estado }: { ordenId: string; estado: string }) => {
      const res = await fetch(`/api/ordenes-compra/${ordenId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ordenes-proveedor", selected?.id] });
      setSelectedOrden(null);
    },
  });

  const { mutate: recibirOrden, isPending: recibiendo } = useMutation({
    mutationFn: async () => {
      const items = (ordenDetalle?.items ?? []).map(item => ({
        id: item.id,
        cantidad_recibida: receivingForm[item.id]?.cantidad ?? 0,
        precio_unitario: parseFloat(receivingForm[item.id]?.precio ?? "0") || 0,
        producto_id: item.productos?.id ?? undefined,
        nombre_nuevo: item.nombre_nuevo ?? undefined,
        fecha_vencimiento: receivingForm[item.id]?.fecha_vencimiento || undefined,
      }));
      const res = await fetch(`/api/ordenes-compra/${selectedOrden}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recibir", items }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ordenes-proveedor", selected?.id] });
      queryClient.invalidateQueries({ queryKey: ["cuentas-proveedor", selected?.id] });
      setSelectedOrden(null);
      setShowReceiving(null);
      setReceivingForm({});
    },
  });

  const { mutate: marcarPagada } = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/cuentas-pagar?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estado: "pagada" }) });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cuentas-proveedor", selected?.id] }),
  });

  // Phase 4: Bulk mark paid
  const { mutate: marcarVariasPagadas, isPending: pagandoMultiples } = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id =>
        fetch(`/api/cuentas-pagar?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estado: "pagada" }) })
      ));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cuentas-proveedor", selected?.id] });
      setSelectedPayables(new Set());
    },
  });

  // Phase 4: Export payment batch
  const exportPaymentBatch = () => {
    const selected_cuentas = filteredPayables.filter(c => selectedPayables.has(c.id));
    if (selected_cuentas.length === 0) return;

    const data = selected_cuentas.map(c => ({
      "Cuenta ID": c.id,
      "Proveedor": selected?.nombre ?? "—",
      "Monto": Number(c.monto),
      "Vencimiento": new Date(c.fecha_vencimiento).toLocaleDateString("es-CL"),
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pagos");
    XLSX.writeFile(wb, `pagos-${selected?.nombre}-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Phase 4: Save filter
  const saveCurrentFilter = (filterName: string, filterType: SavedFilter["type"]) => {
    const newFilter: SavedFilter = { id: Date.now().toString(), name: filterName, type: filterType };
    const updated = [...savedFilters, newFilter];
    setSavedFilters(updated);
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(updated));
  };

  // Phase 4: Load saved filter
  const loadSavedFilter = (filter: SavedFilter) => {
    setPayablesFilter(filter.type);
  };

  // Phase 4: Delete saved filter
  const deleteSavedFilter = (id: string) => {
    const updated = savedFilters.filter(f => f.id !== id);
    setSavedFilters(updated);
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(updated));
  };

  const addOrderItem = () => {
    if (addingOrderItem.esNuevo) {
      if (!addingOrderItem.nombre_nuevo.trim()) return;
      setOrderForm(prev => ({
        ...prev,
        items: [...prev.items, {
          producto_id: null,
          nombre_nuevo: addingOrderItem.nombre_nuevo.trim(),
          nombre: addingOrderItem.nombre_nuevo.trim(),
          cantidad: addingOrderItem.cantidad,
          esNuevo: true,
        }]
      }));
    } else {
      const prod = todosProductos?.find(p => p.id === addingOrderItem.producto_id);
      if (!prod) return;
      setOrderForm(prev => ({
        ...prev,
        items: [...prev.items, {
          producto_id: prod.id,
          nombre_nuevo: "",
          nombre: prod.nombre,
          cantidad: addingOrderItem.cantidad,
          esNuevo: false,
        }]
      }));
    }
    setAddingOrderItem({ producto_id: "", nombre_nuevo: "", cantidad: "1", esNuevo: false });
  };

  const removeOrderItem = (idx: number) => {
    setOrderForm(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx)
    }));
  };

  const pendingOrders = ordenes?.filter(o => o.estado !== "cancelada") ?? [];

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Phase 4: KPI Dashboard */}
      <div className="grid grid-cols-4 gap-3 bg-white rounded-lg shadow-sm p-4">
        <div className="border-l-4 border-red-500 pl-3">
          <p className="text-xs text-gray-600">Vencidas</p>
          <p className="text-lg font-bold text-red-600">{kpiData.overdueCount}</p>
          <p className="text-xs text-gray-500">${kpiData.totalPendiente.toLocaleString("es-CL")}</p>
        </div>
        <div className="border-l-4 border-yellow-500 pl-3">
          <p className="text-xs text-gray-600">Próx. a vencer</p>
          <p className="text-lg font-bold text-yellow-600">{kpiData.dueSoonCount}</p>
          <p className="text-xs text-gray-500">7 días</p>
        </div>
        <div className="border-l-4 border-blue-500 pl-3">
          <p className="text-xs text-gray-600">Pendiente</p>
          <p className="text-lg font-bold text-blue-600">{kpiData.pendienteCount}</p>
          <p className="text-xs text-gray-500">${kpiData.totalPendiente.toLocaleString("es-CL")}</p>
        </div>
        <div className="border-l-4 border-green-500 pl-3">
          <p className="text-xs text-gray-600">OC en Proceso</p>
          <p className="text-lg font-bold text-green-600">{kpiData.ordersInProgress}</p>
          <p className="text-xs text-gray-500">Pendientes</p>
        </div>
      </div>

      <div className="flex gap-4 h-full min-h-0">
        {/* Left Panel: Suppliers List */}
        <div className="w-80 flex flex-col gap-3 min-h-0">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-900">Proveedores</h1>
            <Button size="sm" onClick={() => { setShowForm(!showForm); setEditingProveedor(false); }}>
              {showForm ? "Cancelar" : "+ Nuevo"}
            </Button>
          </div>

          {showForm && (
            <div className="bg-white rounded-lg shadow-sm p-3 space-y-2">
              {["nombre", "rut", "contacto", "telefono", "email"].map((field) => (
                <div key={field}>
                  <label className="text-xs font-medium text-gray-600 block mb-0.5 capitalize">{field}{field === "nombre" ? " *" : ""}</label>
                  <Input className="h-7 text-sm" value={(form as Record<string, string>)[field]} onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))} />
                </div>
              ))}
              {formError && <p className="text-xs text-red-500">{formError}</p>}
              <Button size="sm" className="w-full" onClick={() => { if (!form.nombre.trim()) { setFormError("Nombre requerido"); return; } createProveedor(); }} disabled={creating}>
                {creating ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          )}

          <Input placeholder="Buscar proveedor..." value={search} onChange={(e) => setSearch(e.target.value)} />

          <div className="flex-1 overflow-auto rounded-lg bg-white shadow-sm min-h-0">
            {isLoading && <p className="text-sm text-gray-400 p-4 text-center">Cargando...</p>}
            {!isLoading && !proveedores?.length && <p className="text-sm text-gray-400 p-4 text-center">Sin proveedores</p>}
            {proveedores?.map((p) => {
              const pOrdenes = ordenes?.filter(o => o.estado !== "cancelada").length ?? 0;
              const pPayables = cuentas?.filter(c => c.estado === "pendiente").length ?? 0;
              const pPayablesAmount = (cuentas ?? []).filter(c => c.estado === "pendiente").reduce((sum, c) => sum + Number(c.monto), 0);
              return (
                <div
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className={`px-4 py-3 cursor-pointer border-b last:border-0 ${selected?.id === p.id ? "bg-green-50" : "hover:bg-gray-50"}`}
                >
                  <p className="text-sm font-medium">{p.nombre}</p>
                  <p className="text-xs text-gray-400">{p.rut ?? ""}{p.contacto ? ` · ${p.contacto}` : ""}</p>
                  {(pOrdenes > 0 || pPayables > 0) && (
                    <p className="text-xs text-gray-500 mt-1">
                      {pOrdenes > 0 && <span>{pOrdenes} OC pendientes</span>}
                      {pOrdenes > 0 && pPayables > 0 && <span> · </span>}
                      {pPayables > 0 && <span>${pPayablesAmount.toLocaleString("es-CL")} x pagar</span>}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Panel: Contextual Detail */}
        <div className="flex-1 rounded-lg bg-white shadow-sm p-5 overflow-auto min-h-0">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">Selecciona un proveedor</div>
          ) : (
            <div className="space-y-5">
              {/* Supplier Info with Performance */}
              <div className="pb-5 border-b">
                {!editingProveedor ? (
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold">{detalle?.nombre ?? selected.nombre}</h2>
                        {/* Phase 3: Performance badge */}
                        {supplierPerformance !== null && (
                          <span className={`text-xs px-2 py-1 rounded ${supplierPerformance >= 90 ? "bg-green-100 text-green-700" : supplierPerformance >= 70 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>
                            {supplierPerformance}% on-time
                          </span>
                        )}
                      </div>
                      {detalle?.rut && <p className="text-sm text-gray-500">RUT: {detalle.rut}</p>}
                      {detalle?.contacto && <p className="text-xs text-gray-400">Contacto: {detalle.contacto}</p>}
                      {detalle?.telefono && <p className="text-xs text-gray-400">{detalle.telefono}</p>}
                      {detalle?.email && <p className="text-xs text-gray-400">{detalle.email}</p>}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setEditingProveedor(true); setForm({ nombre: detalle?.nombre ?? "", rut: detalle?.rut ?? "", contacto: detalle?.contacto ?? "", telefono: detalle?.telefono ?? "", email: detalle?.email ?? "" }); }}>
                        Editar
                      </Button>
                      <Button variant="outline" size="sm" className="text-red-500 border-red-200 hover:bg-red-50" onClick={() => deleteProveedor(selected.id)}>
                        Eliminar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {["nombre", "rut", "contacto", "telefono", "email"].map((field) => (
                      <div key={field}>
                        <label className="text-xs font-medium text-gray-600 block mb-0.5 capitalize">{field}</label>
                        <Input className="h-7 text-sm" value={(form as Record<string, string>)[field]} onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))} />
                      </div>
                    ))}
                    {formError && <p className="text-xs text-red-500">{formError}</p>}
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1" onClick={() => updateProveedor()} disabled={updating}>
                        {updating ? "Guardando..." : "Guardar"}
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => { setEditingProveedor(false); setFormError(""); }}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Orders Section */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-gray-700">Órdenes de Compra ({pendingOrders.length})</p>
                  <Button size="sm" variant="outline" onClick={() => setShowCreateOrder(!showCreateOrder)}>+ Nueva OC</Button>
                </div>

                {showCreateOrder && (
                  <div className="border rounded p-3 mb-3 space-y-2 bg-gray-50">
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {orderForm.items.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-white p-2 rounded text-sm">
                          <span>{item.nombre}{item.esNuevo && <span className="text-xs text-blue-500 ml-1">(nuevo)</span>}</span>
                          <div className="flex items-center gap-2">
                            <span>{item.cantidad}x</span>
                            <button onClick={() => removeOrderItem(idx)} className="text-xs text-red-400 hover:text-red-600">✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-1 mb-2">
                      <button
                        type="button"
                        onClick={() => setAddingOrderItem(f => ({ ...f, esNuevo: false, nombre_nuevo: "", producto_id: "" }))}
                        className={`text-xs px-3 py-1 rounded ${!addingOrderItem.esNuevo ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600"}`}
                      >
                        Existente
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddingOrderItem(f => ({ ...f, esNuevo: true, producto_id: "" }))}
                        className={`text-xs px-3 py-1 rounded ${addingOrderItem.esNuevo ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}
                      >
                        + Nuevo producto
                      </button>
                    </div>
                    <div className="flex gap-2">
                      {!addingOrderItem.esNuevo ? (
                        <select
                          value={addingOrderItem.producto_id}
                          onChange={(e) => setAddingOrderItem((f) => ({ ...f, producto_id: e.target.value }))}
                          className="flex-1 rounded border border-input px-2 py-1.5 text-sm h-8"
                        >
                          <option value="">Producto...</option>
                          {todosProductos?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      ) : (
                        <Input
                          placeholder="Nombre del producto nuevo"
                          className="flex-1 h-8 text-sm"
                          value={addingOrderItem.nombre_nuevo}
                          onChange={e => setAddingOrderItem(f => ({ ...f, nombre_nuevo: e.target.value }))}
                        />
                      )}
                      <Input type="number" placeholder="Cant" className="w-16 h-8 text-sm" value={addingOrderItem.cantidad} onChange={(e) => setAddingOrderItem((f) => ({ ...f, cantidad: e.target.value }))} />
                      <Button size="sm" disabled={(!addingOrderItem.producto_id && !addingOrderItem.nombre_nuevo.trim()) || !addingOrderItem.cantidad} onClick={addOrderItem} className="h-8">Agregar</Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-600">Precio se ingresará al recibir</span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="h-7" onClick={() => setShowCreateOrder(false)}>Cancelar</Button>
                        <Button size="sm" className="h-7" disabled={orderForm.items.length === 0 || creatingOrder} onClick={() => createOrden()}>
                          {creatingOrder ? "Guardando..." : "Crear OC"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {pendingOrders.length === 0 ? (
                  <p className="text-xs text-gray-400">Sin órdenes pendientes</p>
                ) : (
                  <div className="space-y-1">
                    {pendingOrders.map((oc) => {
                      const expanded = selectedOrden === oc.id;
                      const estadoColor = oc.estado === "pendiente" ? "text-orange-500" : oc.estado === "enviada" ? "text-blue-500" : oc.estado === "recibida" ? "text-green-600" : "text-gray-400";
                      return (
                        <div key={oc.id} className="rounded border bg-gray-50 text-sm overflow-hidden">
                          <div
                            className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-100"
                            onClick={() => setSelectedOrden(expanded ? null : oc.id)}
                          >
                            <div>
                              <span className="font-medium">{oc.numero}</span>
                              <span className={`text-xs ml-2 ${estadoColor}`}>{oc.estado}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {oc.total ? `$${Number(oc.total).toLocaleString("es-CL")}` : "Precio pendiente"}
                              </span>
                              <span className="text-gray-400 text-xs">{expanded ? "▲" : "▼"}</span>
                            </div>
                          </div>

                          {expanded && (
                            <div className="border-t px-3 py-3 bg-white space-y-3">
                              {!ordenDetalle || ordenDetalle.id !== oc.id ? (
                                <p className="text-xs text-gray-400">Cargando...</p>
                              ) : (
                                <>
                                  <div className="space-y-1">
                                    {(ordenDetalle.items ?? []).map((item) => (
                                      <div key={item.id} className="flex items-center justify-between text-xs">
                                        <span>
                                          {item.productos?.nombre ?? item.nombre_nuevo ?? "Producto nuevo"}
                                          {" "}
                                          {item.productos?.sku && <span className="text-gray-400">({item.productos.sku})</span>}
                                          {!item.productos && item.nombre_nuevo && (
                                            <span className="text-xs text-blue-500 ml-1">(nuevo)</span>
                                          )}
                                        </span>
                                        <span className="text-gray-500">
                                          Solicitado: {item.cantidad_solicitada}
                                          {item.cantidad_recibida !== null && ` · Recibido: ${item.cantidad_recibida}`}
                                          {item.precio_unitario != null && ` · $${Number(item.precio_unitario).toLocaleString("es-CL")}`}
                                        </span>
                                      </div>
                                    ))}
                                  </div>

                                  {oc.estado !== "recibida" && oc.estado !== "cancelada" && (
                                    <div className="flex gap-2 flex-wrap">
                                      {oc.estado === "pendiente" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => cambiarEstadoOrden({ ordenId: oc.id, estado: "enviada" })}>
                            Enviar OC
                          </Button>
                                      )}
                                      <Button size="sm" variant="outline" className="h-7 text-xs text-red-500 border-red-200"
                                        onClick={() => cambiarEstadoOrden({ ordenId: oc.id, estado: "cancelada" })}>
                                        Cancelar OC
                                      </Button>
                                    <Button size="sm" className="h-7 text-xs"
                                      onClick={() => {
                                        const initial: Record<string, { cantidad: number; precio: string; fecha_vencimiento?: string }> = {};
                                        (ordenDetalle.items ?? []).forEach((item) => { initial[item.id] = { cantidad: item.cantidad_solicitada, precio: "" }; });
                                        setReceivingForm(initial);
                                        setReceivingError("");
                                        setShowReceiving(oc.id);
                                      }}>
                                        Recibir OC
                                      </Button>
                                    </div>
                                  )}

                                  {showReceiving === oc.id && (
                                    <div className="border rounded p-2 space-y-3 bg-gray-50">
                                      <p className="text-xs font-medium text-gray-600">Confirmar recepción — ingrese precio y cantidades:</p>
                                      {(ordenDetalle.items ?? []).map(item => {
                                        const nombreProducto = item.productos?.nombre ?? item.nombre_nuevo ?? "Producto nuevo";
                                        return (
                                          <div key={item.id} className="bg-white rounded p-2 space-y-1.5">
                                            <p className="text-xs font-medium text-gray-700">{nombreProducto}</p>
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <div className="flex flex-col">
                                                <label className="text-xs text-gray-500 mb-0.5">Cant. recibida</label>
                                                <div className="flex items-center gap-1">
                                                  <Input
                                                    type="number"
                                                    className="w-16 h-7 text-xs"
                                                    min="0"
                                                    value={receivingForm[item.id]?.cantidad ?? item.cantidad_solicitada}
                                                    onChange={e => setReceivingForm(f => ({
                                                      ...f,
                                                      [item.id]: { ...f[item.id], cantidad: Number(e.target.value) }
                                                    }))}
                                                  />
                                                  <span className="text-xs text-gray-400">/ {item.cantidad_solicitada}</span>
                                                </div>
                                              </div>
                                              <div className="flex flex-col">
                                                <label className="text-xs text-gray-500 mb-0.5">Precio unit. $</label>
                                                <Input
                                                  type="number"
                                                  className="w-24 h-7 text-xs"
                                                  min="0"
                                                  placeholder="0"
                                                  value={receivingForm[item.id]?.precio ?? ""}
                                                  onChange={e => setReceivingForm(f => ({
                                                    ...f,
                                                    [item.id]: { ...f[item.id], precio: e.target.value }
                                                  }))}
                                                />
                                              </div>
                                              <div className="flex flex-col">
                                                <label className="text-xs mb-0.5">
                                                  <span className="text-gray-500">Vencimiento</span>
                                                  {item.productos?.tiene_vencimiento && <span className="text-red-500 ml-0.5">*</span>}
                                                </label>
                                                <Input
                                                  type="date"
                                                  className={`w-32 h-7 text-xs ${item.productos?.tiene_vencimiento && !receivingForm[item.id]?.fecha_vencimiento ? "border-red-300" : ""}`}
                                                  value={receivingForm[item.id]?.fecha_vencimiento ?? ""}
                                                  onChange={e => { setReceivingError(""); setReceivingForm(f => ({
                                                    ...f,
                                                    [item.id]: { ...f[item.id], fecha_vencimiento: e.target.value }
                                                  })); }}
                                                />
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                      {receivingError && <p className="text-xs text-red-500">{receivingError}</p>}
                                      <div className="flex gap-2">
                                        <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => { setShowReceiving(null); setReceivingError(""); }}>Cancelar</Button>
                                        <Button size="sm" className="h-7 text-xs flex-1" disabled={recibiendo} onClick={() => {
                                          const faltanFecha = (ordenDetalle?.items ?? []).filter(
                                            it => it.productos?.tiene_vencimiento && !receivingForm[it.id]?.fecha_vencimiento
                                          );
                                          if (faltanFecha.length > 0) {
                                            setReceivingError(`Fecha de vencimiento requerida: ${faltanFecha.map(it => it.productos?.nombre ?? it.nombre_nuevo ?? "Producto").join(", ")}`);
                                            return;
                                          }
                                          recibirOrden();
                                        }}>
                                          {recibiendo ? "Procesando..." : "Confirmar recepción"}
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Phase 4: Payables with Bulk Actions and Filters */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-gray-700">Cuentas por Pagar ({filteredPayables.length})</p>
                  {selectedPayables.size > 0 && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pagandoMultiples} onClick={() => marcarVariasPagadas(Array.from(selectedPayables))}>
                        {pagandoMultiples ? "Pagando..." : `Pagar ${selectedPayables.size}`}
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportPaymentBatch}>
                        Exportar {selectedPayables.size}
                      </Button>
                    </div>
                  )}
                </div>

                {/* Phase 4: Filter tabs with saved filters */}
                <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
                  {[
                    { label: "Todas", value: "all" as const },
                    { label: "Vencidas", value: "overdue" as const },
                    { label: "Próx. a vencer", value: "due-soon" as const },
                    { label: "Esta semana", value: "due-this-week" as const },
                  ].map((tab) => (
                    <Button
                      key={tab.value}
                      size="sm"
                      variant={payablesFilter === tab.value ? "default" : "outline"}
                      className="h-7 text-xs whitespace-nowrap"
                      onClick={() => setPayablesFilter(tab.value)}
                    >
                      {tab.label}
                    </Button>
                  ))}
                  {savedFilters.length > 0 && <span className="text-xs text-gray-400 self-center px-2">|</span>}
                  {savedFilters.map((sf) => (
                    <div key={sf.id} className="relative group">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs whitespace-nowrap"
                        onClick={() => loadSavedFilter(sf)}
                      >
                        ⭐ {sf.name}
                      </Button>
                      <button
                        onClick={() => deleteSavedFilter(sf.id)}
                        className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {payablesFilter !== "all" && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => saveCurrentFilter(`Filtro ${new Date().toLocaleTimeString()}`, payablesFilter)}>
                      💾
                    </Button>
                  )}
                </div>

                {filteredPayables.length === 0 ? (
                  <p className="text-xs text-gray-400">Sin cuentas en este filtro</p>
                ) : (
                  <div className="space-y-1 max-h-96 overflow-y-auto">
                    {filteredPayables.map((cp) => {
                      const venc = new Date(cp.fecha_vencimiento);
                      const hoy = new Date();
                      const vencida = venc < hoy;
                      const daysUntil = Math.ceil((venc.getTime() - hoy.getTime()) / 86400000);

                      return (
                        <div key={cp.id} className={`flex items-center gap-2 rounded px-3 py-2 text-sm ${vencida ? "bg-red-50" : daysUntil <= 7 ? "bg-yellow-50" : "bg-gray-50"}`}>
                          {/* Phase 4: Checkbox for bulk selection */}
                          <input
                            type="checkbox"
                            checked={selectedPayables.has(cp.id)}
                            onChange={(e) => {
                              const newSet = new Set(selectedPayables);
                              if (e.target.checked) newSet.add(cp.id);
                              else newSet.delete(cp.id);
                              setSelectedPayables(newSet);
                            }}
                            className="w-4 h-4"
                          />
                          <div className="flex-1">
                            <span className="font-medium">${Number(cp.monto).toLocaleString("es-CL")}</span>
                            <span className={`text-xs ml-2 ${vencida ? "text-red-600 font-medium" : daysUntil <= 7 ? "text-yellow-600 font-medium" : "text-gray-600"}`}>
                              {venc.toLocaleDateString("es-CL")}
                              {vencida && " · VENCIDA"}
                              {daysUntil <= 7 && daysUntil > 0 && ` · ${daysUntil} días`}
                            </span>
                          </div>
                          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => marcarPagada(cp.id)}>Pagar</Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Products Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-gray-700">Productos que provee</p>
                  <Button size="sm" variant="outline" onClick={() => setShowAddProd((v) => !v)}>+ Agregar</Button>
                </div>

                {showAddProd && (
                  <div className="border rounded p-3 mb-3 space-y-2 bg-gray-50">
                    <select
                      value={prodForm.producto_id}
                      onChange={(e) => setProdForm((f) => ({ ...f, producto_id: e.target.value }))}
                      className="w-full rounded border border-input px-2 py-1.5 text-sm"
                    >
                      <option value="">Seleccionar producto...</option>
                      {todosProductos?.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.sku})</option>)}
                    </select>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-xs text-gray-600 block mb-1">Costo ($)</label>
                        <Input type="number" className="h-7 text-sm" value={prodForm.costo} onChange={(e) => setProdForm((f) => ({ ...f, costo: e.target.value }))} />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-gray-600 block mb-1">Días entrega</label>
                        <Input type="number" className="h-7 text-sm" value={prodForm.tiempo_entrega_dias} onChange={(e) => setProdForm((f) => ({ ...f, tiempo_entrega_dias: e.target.value }))} />
                      </div>
                    </div>
                    <Button size="sm" className="w-full" disabled={!prodForm.producto_id || addingProd} onClick={() => addProducto()}>
                      {addingProd ? "Guardando..." : "Agregar"}
                    </Button>
                  </div>
                )}

                {!detalle?.productos?.length ? (
                  <p className="text-xs text-gray-400">Sin productos asignados</p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {detalle.productos.map((pp) => {
                      const prod = pp.productos as unknown as { nombre: string; sku: string; stock: number } | null;
                      return (
                        <div key={pp.id} className="flex items-center justify-between rounded bg-gray-50 px-3 py-2 text-sm">
                          <div>
                            <span className="font-medium">{prod?.nombre}</span>
                            <span className="text-xs text-gray-400 ml-2">
                              {pp.costo ? `$${Number(pp.costo).toLocaleString("es-CL")}` : "sin costo"}
                              {pp.tiempo_entrega_dias ? ` · ${pp.tiempo_entrega_dias}d` : ""}
                              {` · Stock: ${prod?.stock ?? 0}`}
                            </span>
                          </div>
                          <button onClick={() => removeProducto(pp.id)} className="text-xs text-red-400 hover:text-red-600">✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
