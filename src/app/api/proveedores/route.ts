import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata } from "@/lib/audit";

export async function GET(req: NextRequest) {
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
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { nombre, rut, contacto, telefono, email } = await req.json();
  if (!nombre?.trim()) return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });

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
}

export async function DELETE(req: NextRequest) {
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
}
