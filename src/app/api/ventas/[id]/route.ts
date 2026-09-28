import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { anularVenta } from "@/lib/ventas/anular-venta";
import { withErrorLogging } from "@/lib/audit";
import { autorizarCanales } from "@/lib/canales/infrastructure/autorizacion";
import { auth } from "@clerk/nextjs/server";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { fechaNegocioISO } from "@/lib/dates";

export const GET = withErrorLogging(async (_req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  // Admin: cualquier venta de su tienda. Worker (QA 2026-09-27): solo ventas
  // de su tienda creadas hoy (recibo del POS recién cobrado; en el POS se
  // puede elegir otro vendedor) o, si son antiguas, aquellas en que él figura
  // como vendedor. Otra venta → 404 (no confirma que exista).
  const ctx = await autorizarCanales({ soloAdmin: false });
  if (!ctx.ok) return ctx.response;
  const { storeId: store_id } = ctx;
  const { sessionClaims } = await auth();
  let esAdmin = true;
  try {
    requireStoreAdmin(getAdminStatus(sessionClaims), store_id);
  } catch {
    esAdmin = false;
  }

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: venta, error } = await supabase
    .from("ventas")
    .select("id, numero_comprobante, subtotal, descuento, impuesto, total, metodo_pago, estado, created_at, worker_clerk_id, clientes(id, nombre, rut, telefono)")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();

  if (error || !venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });

  if (!esAdmin) {
    const deHoy = fechaNegocioISO(new Date(venta.created_at)) === fechaNegocioISO(new Date());
    const esSuya = venta.worker_clerk_id === ctx.userId;
    if (!deHoy && !esSuya) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
  }

  // Vendedor: el worker solo recibe el nombre (lo que muestra el recibo); el
  // email de otro usuario es dato personal que no necesita (QA 2026-09-27).
  let worker = null;
  if (venta.worker_clerk_id) {
    const { data: workerData } = await supabase
      .from("clerk_users")
      .select(esAdmin ? "nombre, email" : "nombre")
      .eq("clerk_id", venta.worker_clerk_id)
      .single();
    worker = workerData;
  }

  const { data: items } = await supabase
    .from("venta_items")
    .select("id, cantidad, precio_unitario, subtotal, es_granel, gramos, productos(nombre, sku), servicios(nombre)")
    .eq("venta_id", id);

  const { data: pagos } = await supabase
    .from("pagos")
    .select("id, metodo, monto, numero_transaccion, nota_credito_id")
    .eq("venta_id", id);

  return NextResponse.json({ ...venta, worker, items: items ?? [], pagos: pagos ?? [] });
}, { endpoint: "GET /api/ventas/id" });

export const PATCH = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  // Anular (única acción del PATCH): solo storeAdmin/systemAdmin de la tienda
  // (regla del negocio, QA 2026-09-27). Antes bastaba una sesión de la tienda:
  // un worker anulaba ventas por API aunque la UI (/sales) le está negada.
  // Mismo helper que /api/canales/** (401 sin sesión, 403 deshabilitado o no admin).
  const ctx = await autorizarCanales({ soloAdmin: true });
  if (!ctx.ok) return ctx.response;
  const { storeId: store_id } = ctx;

  const { id } = await params;
  const supabase = createServiceClient();

  const { action } = await req.json();

  if (action !== "anular") {
    return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  }

  // anular_venta_tx (migración 053) hace el reclamo atómico de estado='anulada'
  // ANTES de restaurar stock/fidelización/saldo y envuelve toda la reversión en
  // una sola transacción; los contra-asientos se agendan con after(). La lógica
  // vive en el servicio compartido src/lib/ventas/anular-venta.ts (Fase 3.1 del
  // plan de canales: también lo usa la cancelación de órdenes de canal).
  const resultado = await anularVenta(supabase, store_id, id, ctx.userId);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }

  return NextResponse.json(resultado.venta);
}, { endpoint: "PATCH /api/ventas/id" });
