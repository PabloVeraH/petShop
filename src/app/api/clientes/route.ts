import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { z } from "zod";
import { validateRUT, formatRUT } from "@/lib/validation";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const rut = req.nextUrl.searchParams.get("rut");

  // Single lookup by RUT (used by POS)
  if (rut) {
    const rutNormalizado = validateRUT(rut) ? formatRUT(rut) : rut;
    const { data: matches, error } = await supabase
      .from("clientes")
      .select("id, store_id, rut, nombre, email, telefono")
      .eq("store_id", store_id)
      .eq("rut", rutNormalizado);

    if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    if (!matches || matches.length === 0) return NextResponse.json(null);
    if (matches.length > 1) {
      console.error(`[clientes] Integridad: ${matches.length} clientes con RUT ${rutNormalizado} en store ${store_id}`);
      return NextResponse.json({ error: "Error de integridad de datos" }, { status: 500 });
    }
    return NextResponse.json(matches[0]);
  }

  // List with optional search + pagination
  const searchSchema = z.string().max(100); // Limit search length
  const searchResult = searchSchema.safeParse(req.nextUrl.searchParams.get("search"));
  const search = searchResult.success ? searchResult.data : "";
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");
  const limit = 50;

  let query = supabase
    .from("clientes")
    .select("id, store_id, rut, nombre, email, telefono", { count: "exact" })
    .eq("store_id", store_id)
    .order("nombre", { ascending: true });

  if (search.trim()) {
    // Sanitize to prevent PostgREST filter string manipulation
    const s = search.replace(/[()%,]/g, "");
    query = query.or(`nombre.ilike.%${s}%,rut.ilike.%${s}%`);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json({ data: data ?? [], count: count ?? 0 });
}, { endpoint: "GET /api/clientes" });

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { rut, nombre, email, telefono } = await req.json();

  if (!validateRUT(rut)) {
    return NextResponse.json({ error: "RUT inválido" }, { status: 400 });
  }
  if (!nombre || nombre.trim().length < 3) {
    return NextResponse.json({ error: "Nombre debe tener al menos 3 caracteres" }, { status: 400 });
  }
  const emailNorm = email?.trim() || null;
  if (emailNorm !== null) {
    const emailCheck = z.string().email("Correo electrónico inválido").safeParse(emailNorm);
    if (!emailCheck.success) {
      return NextResponse.json({ error: emailCheck.error.issues[0].message }, { status: 400 });
    }
  }

  const { data: cliente, error } = await supabase
    .from("clientes")
    .insert({
      store_id,
      rut: formatRUT(rut),
      nombre: nombre.trim(),
      email: emailNorm,
      telefono: telefono?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ya existe un cliente con ese RUT" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  // Auto-create fidelizacion entry
  await supabase.from("fidelizacion").insert({ cliente_id: cliente.id });

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "CREATE",
    entityType: "cliente",
    entityId: cliente.id,
    newValues: { rut: cliente.rut, nombre: cliente.nombre, email: cliente.email },
    changeDescription: `Cliente "${cliente.nombre}" creado`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json(cliente, { status: 201 });
}, { endpoint: "POST /api/clientes" });
