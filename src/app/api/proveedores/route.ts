import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { ProveedorCreateSchema } from "@/lib/validation";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const search = req.nextUrl.searchParams.get("search") ?? "";
  let query = supabase
    .from("proveedores")
    .select("id, nombre, rut, contacto, telefono, email")
    .eq("store_id", store_id)
    .order("nombre");
  if (search) query = query.ilike("nombre", `%${search}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data ?? []);
}, { endpoint: "GET /api/proveedores" });

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = ProveedorCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { nombre, rut, contacto, telefono, email } = parsed.data;

  const { data, error } = await supabase
    .from("proveedores")
    .insert({ store_id, nombre: nombre.trim(), rut: rut || null, contacto: contacto || null, telefono: telefono || null, email: email || null })
    .select().single();
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const { ipAddress, userAgent } = await getRequestMetadata(req);

  await logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "CREATE",
    entityType: "proveedor",
    entityId: data.id,
    newValues: data,
    changeDescription: `Proveedor creado: ${nombre}`,
    ipAddress,
    userAgent,
    result: "success",
  });

  return NextResponse.json(data);
}, { endpoint: "POST /api/proveedores" });

export const DELETE = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const supabase = createServiceClient();

  const { data: deletedProveedor } = await supabase
    .from("proveedores")
    .select("nombre")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();

  const auditOldValues = deletedProveedor ?? {};

  const { ipAddress, userAgent } = await getRequestMetadata(req);

  const { error } = await supabase.from("proveedores").delete().eq("id", id).eq("store_id", store_id);
  if (error) {
    await logAudit({
      storeId: store_id,
      userId: ctx.userId,
      action: "DELETE",
      entityType: "proveedor",
      entityId: id,
      oldValues: auditOldValues,
      ipAddress,
      userAgent,
      result: "failure",
      errorMessage: error.message,
    });
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  await logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "DELETE",
    entityType: "proveedor",
    entityId: id,
    oldValues: auditOldValues,
    changeDescription: `Proveedor eliminado: ${deletedProveedor?.nombre}`,
    ipAddress,
    userAgent,
    result: "success",
  });

  return NextResponse.json({ ok: true });
}, { endpoint: "DELETE /api/proveedores" });
