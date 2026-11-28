import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";
import { autorizarCanales } from "@/lib/canales/infrastructure/autorizacion";
import { canalActivoEfectivo } from "@/lib/canales/campos";

// Nombre y RUT de la tienda para cualquier usuario de la tienda (sidebar y
// recibo del POS), más el umbral de 135 UF que el POS usa para avisar que la
// boleta debe identificar al comprador (pago mixto, plan F11; no es sensible). GET /api/settings es solo admin (SEC-07: tokens, licencia)
// y el storeWorker veía "PetShop" (QA 2026-09-27). Solo expone `name` y `rut`:
// el RUT de la tienda es público (va impreso en cada recibo, igual que en
// /api/recibos/[ventaId]). Desde la 095 también `vender_vencidos` (no sensible):
// el POS lo usa para avisar o bloquear al agregar unidades de lotes vencidos; y
// desde la 098 `numero_transaccion_obligatorio` (cobro del POS y de citas); y
// desde la 099 `venta_granel_por` (gramos o valor en el POS).
export const GET = withErrorLogging(async () => {
  const ctx = await autorizarCanales({ soloAdmin: false });
  if (!ctx.ok) return ctx.response;

  const supabase = createServiceClient();
  const [{ data, error }, canales] = await Promise.all([
    supabase
      .from("stores")
      .select("name, rut, umbral_identificacion_comprador, vender_vencidos, numero_transaccion_obligatorio, venta_granel_por")
      .eq("id", ctx.storeId)
      .single(),
    supabase.from("canal_config").select("canal_id, activo").eq("store_id", ctx.storeId).eq("activo", true),
  ]);

  if (error || !data) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json({
    name: data.name,
    rut: data.rut ?? null,
    umbral_identificacion_comprador: data.umbral_identificacion_comprador ?? null,
    vender_vencidos: data.vender_vencidos === true,
    numero_transaccion_obligatorio: data.numero_transaccion_obligatorio !== false,
    venta_granel_por: data.venta_granel_por === "valor" ? "valor" : "gramos",
    // ¿Hay un canal de pedidos (Rappi, PedidosYa, Uber Eats) activo? Sin
    // ninguno, el aviso del POS no pregunta cada 20 s por pedidos (registro del
    // 2026-11-27: ~50% de las consultas a la BD). Instagram no trae pedidos.
    // Error al leer → true: mejor consultar de más que esconder un pedido.
    pedidos_canales: canales.error
      ? true
      : (canales.data ?? []).some((c) => c.canal_id !== "instagram" && canalActivoEfectivo(c.canal_id, c.activo)),
  });
}, { endpoint: "GET /api/tienda/nombre" });
