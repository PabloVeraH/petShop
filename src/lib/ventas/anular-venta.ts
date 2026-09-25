import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  crearAsiento,
  lineasAnulacionVentaCanal,
  lineasAnulacionVentaConNc,
  lineasAnulacionCOGS,
} from "@/lib/contabilidad/generador-asientos";

export interface VentaAnulada {
  id: string;
  total: number;
  impuesto: number | null;
  metodo_pago: string | null;
  canal: string | null;
  numero_comprobante: string | null;
  created_at: string;
}

export type ResultadoAnulacion =
  | { ok: true; venta: VentaAnulada }
  | { ok: false; status: 404 | 409 | 500; error: string };

// Servicio compartido de anulación de venta (paso 3.1 del plan de canales).
// Extraído SIN cambios de PATCH /api/ventas/[id]; también lo usa la
// cancelación de órdenes de canal (Fase 3.5). Toda la lógica de negocio vive
// en anular_venta_tx (AGENTS.md §23.5): reclamo atómico de estado='anulada'
// antes de restaurar stock/fidelización/saldo y rollback ante error parcial.
// Aquí solo se mapean los errores y se agendan los contra-asientos.
// Debe llamarse dentro del scope de un request (usa after()).
export async function anularVenta(
  supabase: SupabaseClient,
  storeId: string,
  ventaId: string,
  userId: string | null
): Promise<ResultadoAnulacion> {
  const { data: txResult, error: txError } = await supabase.rpc("anular_venta_tx", {
    p_store_id: storeId,
    p_venta_id: ventaId,
    p_user_id: userId,
  });

  if (txError) {
    if (txError.message.includes("no encontrada")) {
      return { ok: false, status: 404, error: "Venta no encontrada" };
    }
    if (txError.message.includes("ya está anulada")) {
      return { ok: false, status: 409, error: "La venta ya está anulada" };
    }
    return { ok: false, status: 500, error: "Error interno del servidor" };
  }

  const { venta, costo_total: costoTotal } = txResult as {
    venta: VentaAnulada;
    costo_total: number;
  };

  // Contra-asientos de anulación en el Libro Diario. Dos asientos
  // independientes (igual que la venta original):
  // 1. Reverso del ingreso — Dr Ventas + Dr IVA / Cr Caja|Banco
  // 2. Reverso del COGS   — Dr Inventario / Cr COGS (solo si hubo costo)
  //
  // Se usa la fecha ORIGINAL de la venta (no la fecha de hoy) para que el
  // contra-asiento caiga en el mismo período contable que el asiento
  // original. Si se usara la fecha de anulación, anular una venta de un
  // mes anterior generaría un ingreso "fantasma" en el Estado de Resultado
  // del mes de la venta (no se neteó) y un resultado negativo "fantasma"
  // en el mes de la anulación (reverso sin venta que lo explique).
  const fechaAnulacion = new Date(venta.created_at).toISOString().split("T")[0];
  const totalVenta = Math.round(Number(venta.total));
  const ivaVenta = Math.round(Number(venta.impuesto ?? 0));
  const montoNeto = totalVenta - ivaVenta;
  const numeroRef = venta.numero_comprobante ?? ventaId.slice(0, 8);
  const canalVenta = (venta.canal ?? "pos") as "pos" | "rappi" | "pedidosya" | "ubereats";

  // Asiento contable (post-response): after() de next/server garantiza que la
  // plataforma espere a que el callback termine (waitUntil) tras responder —
  // a diferencia del fire-and-forget puro, que podía quedar congelado a mitad
  // de ejecución en serverless y dejar la anulación con el asiento de reverso
  // de ingreso pero sin el reverso de COGS (mismo patrón que ticket Trello
  // 6a77e779358cdccca29dc3e3, encontrado durante esa revisión).
  after(async () => {
    try {
      // Espejo del pago original: si la venta se pagó total o parcialmente con
      // nota de crédito / saldo a favor, el reverso de esa porción va a Saldos
      // a Favor (pasivo) — NUNCA a Caja|Banco, que no recibieron ese dinero
      // (ticket Trello 6a5f9ad3fbf979e68251d40e). venta.metodo_pago guarda
      // 'nota_credito'/'mixto' para esas ventas, pero el monto exacto del
      // crédito solo está en pagos.
      const { data: pagosVenta } = await supabase
        .from("pagos")
        .select("metodo, monto")
        .eq("venta_id", ventaId)
        .eq("store_id", storeId);

      const METODOS_CREDITO = new Set(["nota_credito", "saldo_a_favor"]);
      const montoCredito = Math.round(
        (pagosVenta ?? [])
          .filter((p) => METODOS_CREDITO.has(p.metodo as string))
          .reduce((s, p) => s + Number(p.monto), 0)
      );
      const pagoResto = (pagosVenta ?? []).find((p) => !METODOS_CREDITO.has(p.metodo as string));

      const asiento = await crearAsiento({
        storeId,
        fecha: fechaAnulacion,
        tipoMovimiento: "ANULACION_VENTA",
        canal: canalVenta,
        referenciaId: ventaId,
        referenciaNomero: numeroRef,
        descripcion: `Anulación venta ${numeroRef}`,
        lineas: montoCredito > 0
          ? lineasAnulacionVentaConNc({
              montoNeto,
              iva: ivaVenta,
              montoNc: montoCredito,
              montoResto: Math.round(totalVenta - montoCredito),
              metodoPagoResto: (pagoResto?.metodo as string | undefined) ?? undefined,
            })
          : lineasAnulacionVentaCanal({
              canal: venta.canal ?? "pos",
              metodoPago: venta.metodo_pago ?? "efectivo",
              montoNeto,
              iva: ivaVenta,
              total: totalVenta,
            }),
        usuarioId: userId ?? undefined,
      });
      if (!asiento) console.error(`[contabilidad] Asiento de anulación NO CREADO para venta ${numeroRef}`);

      if (costoTotal > 0) {
        const reverso = await crearAsiento({
          storeId,
          fecha: fechaAnulacion,
          tipoMovimiento: "ANULACION_VENTA",
          canal: canalVenta,
          referenciaId: ventaId,
          referenciaNomero: numeroRef,
          descripcion: `Reverso COGS anulación ${numeroRef}`,
          lineas: lineasAnulacionCOGS(Math.round(costoTotal)),
          usuarioId: userId ?? undefined,
        });
        if (!reverso) console.error(`[contabilidad] Reverso COGS NO CREADO para venta ${numeroRef}`);
      }
    } catch (e) {
      console.error("[contabilidad] Error en asiento de anulación:", e);
    }
  });

  return { ok: true, venta };
}
