import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { NotaCreditoPostSchema } from "@/lib/validation";
import { crearAsiento, lineasNotaCredito, lineasNotaCreditoCOGS } from "@/lib/contabilidad/generador-asientos";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id, systemAdmin } = ctx;
  const supabase = createServiceClient();

  // Lookup/validate a single NC by its code (used by POS for NC payment)
  const numeroNc = req.nextUrl.searchParams.get("numero_nc");
  if (numeroNc) {
    let ncQuery = supabase
      .from("notas_credito")
      .select("id, numero_nc, monto_total, fecha_vencimiento, estado")
      .eq("numero_nc", numeroNc);

    if (!systemAdmin) ncQuery = ncQuery.eq("store_id", store_id);

    const { data: nc } = await ncQuery.single();

    if (!nc) return NextResponse.json({ error: "Nota de crédito no encontrada" }, { status: 404 });
    if (nc.estado !== "activa") {
      return NextResponse.json(
        { error: nc.estado === "usada" ? "NC ya fue utilizada" : "NC inactiva" },
        { status: 409 }
      );
    }
    if (nc.fecha_vencimiento && new Date(nc.fecha_vencimiento) < new Date()) {
      return NextResponse.json({ error: "NC vencida" }, { status: 410 });
    }
    return NextResponse.json({ data: nc });
  }

  const ventaId = req.nextUrl.searchParams.get("ventaId");
  if (!ventaId) return NextResponse.json({ error: "ventaId required" }, { status: 400 });

  let query = supabase
    .from("notas_credito")
    .select("id, numero_nc, monto_total, motivo, tipo_reembolso, metodo_reembolso, estado, created_at, nota_credito_items(venta_item_id, cantidad_devuelta)")
    .eq("venta_id", ventaId);

  // systemAdmin puede ver notas de crédito de cualquier tienda
  if (!systemAdmin) {
    query = query.eq("store_id", store_id);
  }

  const { data: notas, error } = await query.order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Error al cargar notas de crédito" }, { status: 500 });
  return NextResponse.json({ data: notas ?? [] });
}, { endpoint: "GET /api/notas-credito" });

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = NotaCreditoPostSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { ventaId, items, tipoReembolso, metodoReembolso, motivo } = parsed.data;

  const hoy = new Date();
  const numero_nc = `NC-${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}${String(hoy.getDate()).padStart(2, "0")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  const fechaVencimiento = new Date();
  fechaVencimiento.setDate(fechaVencimiento.getDate() + 30);

  const itemsForRpc = items.map((item) => ({
    venta_item_id: item.ventaItemId,
    cantidad_devuelta: item.cantidadDevuelta,
    restituir_stock: item.restituirStock ?? true,
  }));

  const { data: result, error: rpcError } = await supabase.rpc("crear_nota_credito_tx", {
    p_store_id: store_id,
    p_user_id: ctx.userId,
    p_venta_id: ventaId,
    p_items: itemsForRpc,
    p_numero_nc: numero_nc,
    p_motivo: motivo ?? null,
    p_tipo_reembolso: tipoReembolso,
    p_metodo_reembolso: metodoReembolso ?? null,
    p_fecha_vencimiento: fechaVencimiento.toISOString().split("T")[0],
  });

  if (rpcError || !result) {
    const { ipAddress, userAgent } = getRequestMetadata(req);
    logAudit({
      storeId: store_id,
      userId: ctx.userId,
      action: "CREATE",
      entityType: "nota_credito",
      changeDescription: `Error creando nota de crédito para devolución de venta ${ventaId}: ${rpcError?.message ?? "Unknown error"}`,
      ipAddress,
      userAgent,
      result: "failure",
      errorMessage: rpcError?.message ?? "Unknown error",
    }).catch(() => {});
    return NextResponse.json(
      { error: `Error creando nota de crédito: ${rpcError?.message}` },
      { status: 500 }
    );
  }

  const {
    id: ncId,
    monto_total: montoTotal,
    costo_total: costoTotalNc,
    venta_cliente_id: clienteId,
  } = result as {
    id: string;
    numero_nc: string;
    monto_total: number;
    costo_total: number;
    venta_cliente_id: string | null;
  };

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "CREATE",
    entityType: "nota_credito",
    entityId: ncId,
    newValues: { monto_total: montoTotal, motivo: motivo ?? null, tipo_reembolso: tipoReembolso },
    changeDescription: `Nota de crédito creada por devolución de venta ${ventaId}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  // Asiento contable (post-response): after() de next/server garantiza que la
  // plataforma espere a que el callback termine (waitUntil) tras responder —
  // a diferencia del fire-and-forget puro, que podía quedar congelado a mitad
  // de ejecución en serverless y dejar la NC con el asiento de devolución pero
  // sin el reverso de COGS (mismo patrón que ticket Trello
  // 6a77e779358cdccca29dc3e3, encontrado durante esa revisión).
  after(async () => {
    try {
      let clienteNombre: string | undefined;
      if (clienteId) {
        const { data: cli } = await supabase.from("clientes").select("nombre").eq("id", clienteId).single();
        clienteNombre = cli?.nombre ?? undefined;
      }

      const fechaNc = new Date().toISOString().split("T")[0];

      const asiento = await crearAsiento({
        storeId: store_id,
        fecha: fechaNc,
        tipoMovimiento: "NOTA_CREDITO",
        canal: "pos",
        referenciaId: ncId,
        referenciaNomero: numero_nc,
        descripcion: `Devolución${clienteNombre ? ` a ${clienteNombre}` : ""}${motivo ? ` — ${motivo}` : ""}`,
        lineas: lineasNotaCredito({ monto: montoTotal, tipoReembolso, metodoReembolso: metodoReembolso ?? undefined }),
        usuarioId: ctx.userId ?? undefined,
      });
      if (!asiento) console.error(`[contabilidad] Asiento NC NO CREADO para ${numero_nc}`);

      if (costoTotalNc > 0) {
        const reversoCogs = await crearAsiento({
          storeId: store_id,
          fecha: fechaNc,
          tipoMovimiento: "NOTA_CREDITO",
          canal: "pos",
          referenciaId: ncId,
          referenciaNomero: numero_nc,
          descripcion: `Reverso COGS devolución${clienteNombre ? ` a ${clienteNombre}` : ""}`,
          lineas: lineasNotaCreditoCOGS(Math.round(costoTotalNc)),
          usuarioId: ctx.userId ?? undefined,
        });
        if (!reversoCogs) console.error(`[contabilidad] Reverso COGS NO CREADO para NC ${numero_nc}`);
      }
    } catch (e) {
      console.error("[contabilidad] Error en asiento NC:", e);
    }
  });

  return NextResponse.json({
    ok: true,
    notaCreditoId: ncId,
    numeroNc: numero_nc,
    montoNc: montoTotal,
    fechaVencimiento: fechaVencimiento.toISOString().split("T")[0],
  });
}, { endpoint: "POST /api/notas-credito" });
