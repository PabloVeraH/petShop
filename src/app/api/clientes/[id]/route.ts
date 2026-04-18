import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { id } = await params;

  const { data: cliente, error } = await supabase
    .from("clientes")
    .select(`
      id, store_id, rut, nombre, email, telefono,
      mascotas(id, nombre, tipo, raza, peso_kg, alimento_habitual_id)
    `)
    .eq("id", id)
    .eq("store_id", store_id)
    .single();

  if (error?.code === "PGRST116") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const { data: ventas } = await supabase
    .from("ventas")
    .select("id, total, metodo_pago, created_at")
    .eq("store_id", store_id)
    .eq("cliente_id", id)
    .neq("estado", "anulada")
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({ ...cliente, ventas: ventas ?? [] });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { id } = await params;

  const body = await req.json();
  const { nombre, email, telefono } = body;

  if (nombre !== undefined && !nombre?.trim())
    return NextResponse.json({ error: "Nombre no puede estar vacío" }, { status: 400 });

  const { data: originalCliente } = await supabase
    .from("clientes")
    .select("nombre, email, telefono")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();

  const auditOldValues = originalCliente ?? {};

  const updateData: Record<string, unknown> = {};
  if (nombre !== undefined) updateData.nombre = nombre;
  if (email !== undefined) updateData.email = email;
  if (telefono !== undefined) updateData.telefono = telefono;

  const { ipAddress, userAgent } = await getRequestMetadata(req);

  const { data, error } = await supabase
    .from("clientes")
    .update(updateData)
    .eq("id", id)
    .eq("store_id", store_id)
    .select()
    .single();

  if (error) {
    await logAudit({
      storeId: store_id,
      userId: ctx.userId,
      action: "UPDATE",
      entityType: "cliente",
      entityId: id,
      oldValues: auditOldValues,
      newValues: updateData,
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
    action: "UPDATE",
    entityType: "cliente",
    entityId: id,
    oldValues: auditOldValues,
    newValues: data,
    changeDescription: `Cliente actualizado: ${JSON.stringify(updateData)}`,
    ipAddress,
    userAgent,
    result: "success",
  });

  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { id } = await params;

  const { data: clienteToDelete } = await supabase
    .from("clientes")
    .select("id, nombre, rut, email, telefono")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();

  if (!clienteToDelete) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  const { ipAddress, userAgent } = await getRequestMetadata(req);

  const { error } = await supabase
    .from("clientes")
    .delete()
    .eq("id", id)
    .eq("store_id", store_id);

  if (error) {
    await logAudit({
      storeId: store_id,
      userId: ctx.userId,
      action: "DELETE",
      entityType: "cliente",
      entityId: id,
      oldValues: clienteToDelete,
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
    entityType: "cliente",
    entityId: id,
    oldValues: clienteToDelete,
    ipAddress,
    userAgent,
    result: "success",
  });

  return NextResponse.json({ ok: true });
}