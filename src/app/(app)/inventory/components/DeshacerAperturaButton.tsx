"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

// G2 — "Deshacer apertura" de un saco marcado por error: devuelve el saco a
// cerrados (y a su lote). La página solo lo muestra a admin (conveniencia de
// UX); el control real es el servidor: POST /api/productos/[id]/saco con
// accion "deshacer" exige storeAdmin/systemAdmin, y la BD rechaza sacos con
// ventas o con gramos que ya cambiaron.
export function DeshacerAperturaButton({ productoId }: { productoId: string }) {
  const queryClient = useQueryClient();
  const { mutate, isPending, error } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/productos/${productoId}/saco`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "deshacer" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo deshacer la apertura");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventario"], refetchType: "all" });
      queryClient.invalidateQueries({ queryKey: ["productos"], refetchType: "all" });
      queryClient.invalidateQueries({ queryKey: ["lotes"], refetchType: "all" });
    },
  });

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => mutate()}
        disabled={isPending}
        className="text-[11px] text-amber-700 hover:underline px-1 disabled:opacity-50"
      >
        {isPending ? "Deshaciendo..." : "Deshacer apertura"}
      </button>
      {error && <span role="alert" className="text-[10px] text-red-500 px-1 max-w-[180px] whitespace-normal">{error.message}</span>}
    </span>
  );
}
