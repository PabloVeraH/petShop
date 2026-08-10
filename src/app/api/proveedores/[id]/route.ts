import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { z } from "zod";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";

const UpdateProveedorSchema = z.object({
  nombre: z.string().min(1).max(255).optional(),
  rut: z.string().max(20).optional(),
  contacto: z.string().max(255).optional(),
  telefono: z.string().max(20).optional(),
  email: z.string().email().optional(),
});

export const GET = withErrorLogging(async (_req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: proveedor, error } = await supabase
    .from("proveedores")
    .select("id, nombre, rut, contacto, telefono, email")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();
  if (error || !proveedor) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const { data: productos } = await supabase
    .from("proveedor_productos")
    .select("id, costo, tiempo_entrega_dias, productos(id, nombre, sku, stock)")
    .eq("proveedor_id", id);

  return NextResponse.json({ ...proveedor, productos: productos ?? [] });
}, { endpoint: "GET /api/proveedores/id" });

export const PATCH = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const { id } = await params;
  const body = await req.json();

  const parsed = UpdateProveedorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: proveedor, error: checkError } = await supabase
    .from("proveedores")
    .select("id")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();
  if (checkError || !proveedor) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("proveedores")
    .update(parsed.data)
    .eq("id", id)
    .eq("store_id", store_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "proveedor",
    entityId: id,
    newValues: parsed.data,
    changeDescription: `Proveedor actualizado: ${Object.keys(parsed.data).join(", ")}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json(data);
}, { endpoint: "PATCH /api/proveedores/id" });
