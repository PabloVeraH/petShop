"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";

type CuentaPagar = {
  id: string;
  monto: number;
  fecha_emision: string | null;
  fecha_vencimiento: string;
  estado: string;
  proveedores: { nombre: string } | null;
  ordenes_compra: { numero: string } | null;
};

async function getCuentas(estado: string): Promise<CuentaPagar[]> {
  const res = await fetch(`/api/cuentas-pagar?estado=${estado}`);
  if (!res.ok) throw new Error("Error");
  return res.json();
}

export default function PayablesPage() {
  const [estado, setEstado] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["cuentas-pagar", estado],
    queryFn: () => getCuentas(estado),
  });

  const { mutate: marcarPagada } = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/cuentas-pagar?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "pagada" }),
      });
      if (!res.ok) throw new Error("Error");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cuentas-pagar"] }),
  });

  const cuentas = data ?? [];
  const hoy = new Date();

  const totalPendiente = cuentas
    .filter((c) => c.estado === "pendiente")
    .reduce((sum, c) => sum + Number(c.monto), 0);

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Cuentas por Pagar</h1>
          {estado !== "pagada" && totalPendiente > 0 && (
            <p className="text-sm text-red-600 font-medium mt-0.5">
              Total pendiente: ${Math.round(totalPendiente).toLocaleString("es-CL")}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        {["", "pendiente", "pagada"].map((e) => (
          <Button key={e} size="sm" variant={estado === e ? "default" : "outline"} onClick={() => setEstado(e)}>
            {e || "Todas"}
          </Button>
        ))}
      </div>

      <div className="flex-1 overflow-auto rounded-lg bg-white shadow-sm">
        {isLoading && <p className="text-sm text-gray-400 p-4 text-center">Cargando...</p>}
        {isError && <p className="text-sm text-red-500 p-4 text-center">Error al cargar.</p>}
        {!isLoading && !isError && cuentas.length === 0 && (
          <p className="text-sm text-gray-400 p-4 text-center">Sin cuentas</p>
        )}
        {!isLoading && !isError && cuentas.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proveedor</TableHead>
                <TableHead>Orden</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cuentas.map((c) => {
                const prov = c.proveedores as unknown as { nombre: string } | null;
                const orden = c.ordenes_compra as unknown as { numero: string } | null;
                const venc = new Date(c.fecha_vencimiento);
                const vencida = c.estado === "pendiente" && venc < hoy;
                const proximaVencer = c.estado === "pendiente" && !vencida && Math.round((venc.getTime() - hoy.getTime()) / 86400000) <= 7;
                return (
                  <TableRow key={c.id} className={vencida ? "bg-red-50" : proximaVencer ? "bg-yellow-50" : undefined}>
                    <TableCell className="font-medium text-sm">{prov?.nombre ?? "—"}</TableCell>
                    <TableCell className="text-sm text-gray-500">{orden?.numero ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      <span className={vencida ? "text-red-600 font-medium" : proximaVencer ? "text-yellow-600 font-medium" : "text-gray-500"}>
                        {venc.toLocaleDateString("es-CL")}
                        {vencida && " · VENCIDA"}
                        {proximaVencer && " · Próx. a vencer"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium text-gray-800">
                      ${Math.round(Number(c.monto)).toLocaleString("es-CL")}
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.estado === "pagada" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                        {c.estado}
                      </span>
                    </TableCell>
                    <TableCell>
                      {c.estado === "pendiente" && (
                        <Button size="sm" variant="outline" onClick={() => marcarPagada(c.id)} className="h-7 text-xs">
                          Marcar pagada
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
