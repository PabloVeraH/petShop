import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";
import { computeLicenseStatus } from "@/lib/license";
import { decryptJSON } from "@/lib/canales/encryption";
import { esCanalExterno } from "@/lib/canales/domain/types";
import { adaptadoresImplementados, obtenerAdaptador } from "@/lib/canales/adapters/registry";
import { autorizarCanales } from "@/lib/canales/infrastructure/autorizacion";
import { evaluarPreparacion, listoParaProduccion, type DatosPreparacion } from "@/lib/canales/application/preparacion";

// Checklist de salida a producción (Fase 6, paso 6.2). Solo storeAdmin/
// systemAdmin. Tenant: todo por el store_id de la sesión. Nunca devuelve
// valores de secretos ni de variables de entorno, solo si están definidos.

type Params = { params: Promise<{ canal: string }> };

export const GET = withErrorLogging(async (req: NextRequest, { params }: Params) => {
  const ctx = await autorizarCanales({ soloAdmin: true });
  if (!ctx.ok) return ctx.response;
  const { canal } = await params;
  if (!esCanalExterno(canal)) return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });

  const implementado = adaptadoresImplementados().find((a) => a.id === canal);
  if (!implementado) {
    return NextResponse.json({ error: "Integración pendiente: este canal aún no tiene adaptador" }, { status: 409 });
  }
  const supabase = createServiceClient();
  const { storeId } = ctx;

  const [globalRes, storeRes, configRes, cpcRes, cronRes, deadRes] = await Promise.all([
    supabase.from("canales_externos").select("habilitado").eq("id", canal).maybeSingle(),
    supabase.from("stores").select("license_end_date, license_warning_days").eq("id", storeId).maybeSingle(),
    supabase
      .from("canal_config")
      .select("activo, external_store_id, credenciales_encriptada, credenciales_iv, credenciales_auth_tag, ultimo_evento_at, ultimo_evento_tipo, menu_estado, menu_detalle")
      .eq("store_id", storeId)
      .eq("canal_id", canal)
      .maybeSingle(),
    supabase
      .from("canal_producto_config")
      .select("publicado_at, productos!inner(nombre, stock_minimo, activo, store_id)")
      .eq("store_id", storeId)
      .eq("canal_id", canal)
      .eq("activo", true),
    supabase.rpc("estado_cron_canales"),
    supabase
      .from("canal_outbox")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("canal_id", canal)
      .eq("estado", "dead"),
  ]);
  if (configRes.error || cpcRes.error) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const cfg = configRes.data;
  let credenciales: DatosPreparacion["config"]["credenciales"] = "faltan";
  if (cfg?.credenciales_encriptada && cfg.credenciales_iv && cfg.credenciales_auth_tag) {
    try {
      const crudas = decryptJSON({ ciphertext: cfg.credenciales_encriptada, iv: cfg.credenciales_iv, authTag: cfg.credenciales_auth_tag });
      credenciales = implementado.credentialsSchema.safeParse(crudas).success ? "ok" : "invalidas";
    } catch {
      credenciales = "invalidas";
    }
  }

  type FilaCpc = { publicado_at: string | null; productos: { nombre: string; stock_minimo: number | null; activo: boolean | null; store_id: string } | null };
  const habilitados = ((cpcRes.data ?? []) as unknown as FilaCpc[]).filter(
    (f) => f.productos && f.productos.store_id === storeId && f.productos.activo !== false
  );

  const licencia = storeRes.data
    ? computeLicenseStatus({
        license_end_date: storeRes.data.license_end_date,
        license_warning_days: storeRes.data.license_warning_days ?? 0,
      })
    : null;

  const vars = implementado.variablesProduccion;
  const datos: DatosPreparacion = {
    produccion: process.env.NODE_ENV === "production",
    adaptadorDesplegado: obtenerAdaptador(canal) !== null,
    env: {
      encryptionKey: !!process.env.ENCRYPTION_KEY,
      cronSecret: !!process.env.CRON_SECRET,
      apiBase: vars ? !!process.env[vars.apiBase] : true,
      authBase: vars ? !!process.env[vars.authBase] : true,
    },
    habilitadoGlobal: !!globalRes.data?.habilitado,
    licenciaVigente: licencia ? !licencia.isAutoBlocked : false,
    config: {
      existe: !!cfg,
      activo: !!cfg?.activo,
      credenciales,
      externalStoreId: !!cfg?.external_store_id,
      ultimoEventoAt: cfg?.ultimo_evento_at ?? null,
      ultimoEventoTipo: cfg?.ultimo_evento_tipo ?? null,
      menuEstado: cfg?.menu_estado ?? null,
      menuDetalle: cfg?.menu_detalle ?? null,
    },
    productos: {
      habilitados: habilitados.length,
      publicados: habilitados.filter((f) => f.publicado_at).length,
      sinMinimo: habilitados.filter((f) => !(Number(f.productos!.stock_minimo ?? 0) > 0)).map((f) => f.productos!.nombre),
    },
    // Sin pg_cron o sin la migración 084 la RPC falla: se informa "sin programar".
    crons: cronRes.error ? [] : ((cronRes.data ?? []) as { jobname: string; active: boolean }[]),
    outboxMuertos: deadRes.count ?? 0,
    ahoraMs: Date.now(),
  };

  const items = evaluarPreparacion(datos);
  const origen = req.nextUrl.origin;
  const eventos = implementado.capabilities.eventoEnUrl ? (implementado.eventosWebhook ?? []) : [null];
  const urls = eventos.map((evento) => ({
    evento,
    url: `${origen}/api/canales/webhook/${canal}?store_id=${storeId}${evento ? `&evento=${evento}` : ""}`,
  }));

  return NextResponse.json({ canal, listo: listoParaProduccion(items), items, webhook: { urls } });
}, { endpoint: "GET /api/canales/canal/preparacion" });
