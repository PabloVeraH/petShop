"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Worker = {
  clerk_id: string;
  nombre: string | null;
  email: string;
  rut: string | null;
  meta_ventas: number | null;
  store_admin: boolean;
  store_worker: boolean;
  ventas_mes: number;
  ventas_hoy: number;
};

type VentaWorker = {
  id: string;
  numero_comprobante: string | null;
  total: number;
  metodo_pago: string | null;
  estado: string;
  created_at: string;
  clientes: { nombre: string } | null;
};

async function getWorkers(): Promise<Worker[]> {
  const res = await fetch("/api/workers");
  if (!res.ok) throw new Error("Error al cargar trabajadores");
  return res.json();
}

async function getWorkerVentas(clerkId: string, desde?: string, hasta?: string): Promise<VentaWorker[]> {
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  const res = await fetch(`/api/workers/${clerkId}/ventas?${params}`);
  if (!res.ok) throw new Error("Error al cargar ventas");
  return res.json();
}

async function updateWorker(clerkId: string, data: { rut?: string; meta_ventas?: number }) {
  const res = await fetch("/api/workers", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clerk_id: clerkId, ...data }),
  });
  if (!res.ok) {
    const d = await res.json();
    throw new Error(d.error ?? "Error");
  }
  return res.json();
}

export default function VendedoresPage() {
  const { sessionClaims } = useAuth();
  const meta = sessionClaims?.publicMetadata as Record<string, boolean> | undefined;
  const hasAccess = meta?.storeAdmin === true || meta?.systemAdmin === true;
  const queryClient = useQueryClient();

  const { data: workers, isLoading } = useQuery({
    queryKey: ["workers"],
    queryFn: getWorkers,
    enabled: hasAccess,
  });

  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [editForm, setEditForm] = useState({ rut: "", meta_ventas: "" });
  const [editError, setEditError] = useState("");
  const [showDetail, setShowDetail] = useState(false);
  const [detailDesde, setDetailDesde] = useState("");
  const [detailHasta, setDetailHasta] = useState("");

  const { data: workerVentas, isLoading: ventasLoading } = useQuery({
    queryKey: ["worker-ventas", selectedWorker?.clerk_id, detailDesde, detailHasta],
    queryFn: () => getWorkerVentas(selectedWorker!.clerk_id, detailDesde, detailHasta),
    enabled: !!selectedWorker,
  });

  const { mutate: saveWorker, isPending } = useMutation({
    mutationFn: () => updateWorker(selectedWorker!.clerk_id, {
      rut: editForm.rut || undefined,
      meta_ventas: editForm.meta_ventas ? Number(editForm.meta_ventas) : undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workers"] });
      setSelectedWorker(null);
      setEditError("");
    },
    onError: (e: Error) => setEditError(e.message),
  });

  const sortedWorkers = (workers ?? []).sort((a, b) => b.ventas_mes - a.ventas_mes);

  const openDetail = (worker: Worker) => {
    setSelectedWorker(worker);
    setEditForm({ rut: worker.rut ?? "", meta_ventas: worker.meta_ventas ? String(worker.meta_ventas) : "" });
    setShowDetail(true);
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Vendedores</h1>
      </div>

      <div className="flex-1 overflow-auto rounded-lg bg-white shadow-sm">
        {isLoading && <p className="text-sm text-gray-400 p-4 text-center">Cargando...</p>}
        {!isLoading && !hasAccess && (
          <p className="text-sm text-gray-400 p-4 text-center">No tienes acceso a esta página</p>
        )}
        {!isLoading && hasAccess && sortedWorkers.length === 0 && (
          <p className="text-sm text-gray-400 p-4 text-center">Sin trabajadores registrados</p>
        )}
        {!isLoading && hasAccess && sortedWorkers.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead className="text-right">Ventas hoy</TableHead>
                <TableHead className="text-right">Ventas mes</TableHead>
                <TableHead className="text-right">Meta</TableHead>
                <TableHead className="text-right">Avance</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedWorkers.map((w, i) => {
                const avance = w.meta_ventas && w.meta_ventas > 0
                  ? Math.round((w.ventas_mes / w.meta_ventas) * 100)
                  : null;
                return (
                  <TableRow key={w.clerk_id}>
                    <TableCell className="font-bold text-gray-400 text-sm">#{i + 1}</TableCell>
                    <TableCell className="font-medium">{w.nombre ?? w.email}</TableCell>
                    <TableCell>
                      {w.store_admin && (
                        <span className="inline-flex items-center px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">
                          Admin
                        </span>
                      )}
                      {w.store_worker && (
                        <span className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold ml-1">
                          Operador
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium text-green-700">
                      ${Math.round(w.ventas_hoy).toLocaleString("es-CL")}
                    </TableCell>
                    <TableCell className="text-right font-medium text-green-700">
                      ${Math.round(w.ventas_mes).toLocaleString("es-CL")}
                    </TableCell>
                    <TableCell className="text-right text-gray-500 text-sm">
                      {w.meta_ventas ? `$${Math.round(w.meta_ventas).toLocaleString("es-CL")}` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {avance !== null ? (
                        <span className={`text-sm font-medium ${avance >= 100 ? "text-green-600" : avance >= 50 ? "text-yellow-600" : "text-red-500"}`}>
                          {avance}%
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => openDetail(w)}
                        className="text-xs text-blue-500 hover:underline"
                      >
                        Ver detalle
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={showDetail} onOpenChange={(open) => { if (!open) setShowDetail(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedWorker?.nombre ?? selectedWorker?.email}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">RUT</label>
                <input
                  type="text"
                  value={editForm.rut}
                  onChange={(e) => setEditForm((f) => ({ ...f, rut: e.target.value }))}
                  placeholder="12.345.678-9"
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              {selectedWorker?.store_worker && (
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">Meta mensual ($)</label>
                  <input
                    type="number"
                    value={editForm.meta_ventas}
                    onChange={(e) => setEditForm((f) => ({ ...f, meta_ventas: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              )}
            </div>

            {editError && <p className="text-xs text-red-500">{editError}</p>}

            <div className="flex gap-2">
              <Button onClick={() => saveWorker()} disabled={isPending} size="sm">
                {isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowDetail(false)}>
                Cerrar
              </Button>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Historial de ventas</h3>
              <div className="flex gap-2 mb-3">
                <input
                  type="date"
                  value={detailDesde}
                  onChange={(e) => setDetailDesde(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                />
                <span className="text-gray-400">→</span>
                <input
                  type="date"
                  value={detailHasta}
                  onChange={(e) => setDetailHasta(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </div>

              {ventasLoading ? (
                <p className="text-xs text-gray-400">Cargando ventas...</p>
              ) : workerVentas && workerVentas.length > 0 ? (
                <div className="max-h-60 overflow-auto border border-gray-200 rounded">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Comprobante</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workerVentas.map((v) => (
                        <TableRow key={v.id}>
                          <TableCell className="text-xs">{new Date(v.created_at).toLocaleDateString("es-CL")}</TableCell>
                          <TableCell className="text-xs">{v.numero_comprobante ?? "—"}</TableCell>
                          <TableCell className="text-xs">{v.clientes?.nombre ?? "—"}</TableCell>
                          <TableCell className="text-right text-xs font-medium text-green-700">
                            ${Math.round(v.total).toLocaleString("es-CL")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-xs text-gray-400">Sin ventas en este período</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}