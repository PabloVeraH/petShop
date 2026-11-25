import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { exigirStoreAdmin } from "@/lib/admin-check";
import { ReportsExportQuerySchema } from "@/lib/validation";
import { hoyNegocioISO, inicioPeriodo, instanteDeTimestamp, ZONA_NEGOCIO } from "@/lib/dates";
import { calcularMontoBoleta, etiquetaMetodo } from "@/lib/ventas/pagos";
import { cargarPagosPorVenta, esVentaPos, pagosDeVenta } from "@/lib/reports/pagos-reporte";

// Máximo de filas que devuelve la API de Supabase por consulta.
const FILAS_POR_PAGINA = 1000;

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return new NextResponse("Unauthorized", { status: 401 });
  const { storeId: store_id } = ctx;
  // Solo storeAdmin de esta tienda o systemAdmin: el CSV trae todas las
  // ventas (clientes, RUT, vendedores) e inventario con costos.
  const denegado = await exigirStoreAdmin(store_id);
  if (denegado) return denegado;
  const supabase = createServiceClient();

  const tipo = req.nextUrl.searchParams.get("tipo") ?? "ventas";
  const desde = req.nextUrl.searchParams.get("desde") ?? "";
  const hasta = req.nextUrl.searchParams.get("hasta") ?? "";
  const qParsed = ReportsExportQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!qParsed.success) return NextResponse.json({ error: qParsed.error.issues[0].message }, { status: 400 });
  const { periodo, canal, vendedor } = qParsed.data;

  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };

  let csv = "";

  if (tipo === "ventas") {
    // Por páginas: una sola consulta corta en silencio a las 1.000 ventas. El
    // tope de fecha fija el conjunto (una venta nueva entre páginas las correría).
    const desdePeriodo = periodo === undefined ? "" : inicioPeriodo(periodo);
    const ahora = new Date().toISOString();
    const pagina = (desdeFila: number) => {
      let query = supabase
        .from("ventas")
        .select("id, numero_comprobante, created_at, total, subtotal, descuento, impuesto, metodo_pago, canal, estado, worker_clerk_id, clientes(nombre, rut)")
        .eq("store_id", store_id)
        .lte("created_at", ahora);
      if (desdePeriodo) query = query.gte("created_at", desdePeriodo);
      if (desde) query = query.gte("created_at", desde);
      if (hasta) query = query.lte("created_at", hasta + "T23:59:59");
      if (canal) query = query.eq("canal", canal);
      if (vendedor) query = query.eq("worker_clerk_id", vendedor);
      return query
        .order("created_at", { ascending: false })
        .order("id")
        .range(desdeFila, desdeFila + FILAS_POR_PAGINA - 1);
    };

    const primera = await pagina(0);
    // Un CSV vacío o a medias se confundiría con "no hubo ventas".
    if (primera.error) return NextResponse.json({ error: "Error interno" }, { status: 500 });
    const data = [...(primera.data ?? [])];
    for (let n = data.length; n === FILAS_POR_PAGINA; ) {
      const sig = await pagina(data.length);
      if (sig.error) return NextResponse.json({ error: "Error interno" }, { status: 500 });
      data.push(...sig.data);
      n = sig.data.length;
    }

    // Vendedor: solo el nombre (como el recibo), nunca el email. Los
    // clerk_id salen de ventas ya filtradas por store_id.
    const workerIds = [...new Set(data.map((v) => v.worker_clerk_id).filter(Boolean))] as string[];
    const nombreVendedor: Record<string, string> = {};
    if (workerIds.length > 0) {
      const { data: workers } = await supabase
        .from("clerk_users")
        .select("clerk_id, nombre")
        .in("clerk_id", workerIds);
      for (const w of workers ?? []) if (w.nombre) nombreVendedor[w.clerk_id] = w.nombre;
    }

    // Pagos de todas las ventas exportadas (store_id de la sesión).
    const pagosPorVenta = await cargarPagosPorVenta(supabase, store_id, data.map((v) => v.id));

    csv = "Comprobante,Fecha,Vendedor,Cliente,RUT,Total,Subtotal,Descuento,IVA,Método,Estado,Detalle pagos,Monto a boletear\n";
    for (const v of data) {
      const cliente = v.clientes as unknown as { nombre: string; rut: string } | null;
      const pagos = pagosDeVenta(v, pagosPorVenta);
      csv += [
        esc(v.numero_comprobante),
        esc(instanteDeTimestamp(v.created_at).toLocaleString("es-CL", { timeZone: ZONA_NEGOCIO })),
        esc(v.worker_clerk_id ? nombreVendedor[v.worker_clerk_id] : ""),
        esc(cliente?.nombre),
        esc(cliente?.rut),
        Math.round(Number(v.total)),
        Math.round(Number(v.subtotal)),
        Math.round(Number(v.descuento)),
        Math.round(Number(v.impuesto)),
        esc(v.metodo_pago),
        esc(v.estado),
        esc(pagos.map((p) => `${etiquetaMetodo(p.metodo)} $${Math.round(p.monto).toLocaleString("es-CL")}`).join("; ")),
        // Solo ventas del POS: las de canal no pasan por el cobro con boleta.
        esVentaPos(v) ? calcularMontoBoleta(pagos) : "",
      ].join(",") + "\n";
    }
  } else if (tipo === "inventario") {
    const { data } = await supabase
      .from("productos")
      .select("sku, nombre, marca, precio, costo, stock, stock_minimo, activo")
      .eq("store_id", store_id)
      .order("nombre");

    csv = "SKU,Nombre,Marca,Precio,Costo,Stock,Stock Mínimo,Activo\n";
    for (const p of data ?? []) {
      csv += [
        esc(p.sku), esc(p.nombre), esc(p.marca),
        Math.round(Number(p.precio)),
        p.costo ? Math.round(Number(p.costo)) : "",
        p.stock ?? 0, p.stock_minimo ?? 0,
        p.activo ? "Sí" : "No",
      ].join(",") + "\n";
    }
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "EXPORT",
    entityType: "report_export",
    changeDescription: `Exportación de ${tipo} generada`,
    ...(tipo === "ventas" ? { newValues: { periodo: periodo ?? "todo", canal: canal || "todos", vendedor: vendedor || "todos" } } : {}),
    ipAddress,
    userAgent,
  }).catch(() => {});

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${tipo}-${hoyNegocioISO()}.csv"`,
    },
  });
}, { endpoint: "GET /api/reports/export" });
