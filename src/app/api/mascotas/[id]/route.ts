import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { MascotaUpdateSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata } from "@/lib/audit";

async function verifyOwnership(id: string, store_id: string, supabase: ReturnType<typeof createServiceClient>) {
  const { data: mascota } = await supabase
    .from("mascotas")
    .select("id, cliente_id, nombre, tipo")
    .eq("id", id)
    .single();

  if (!mascota) return { error: "Mascota no encontrada", status: 404 } as const;

  const { data: cliente } = await supabase
    .from("clientes")
    .select("id")
    .eq("id", mascota.cliente_id)
    .eq("store_id", store_id)
    .single();

  if (!cliente) return { error: "Acceso denegado", status: 403 } as const;

  return { mascota };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id, userId } = ctx;

  const { id } = await params;
  const supabase = createServiceClient();

  const ownership = await verifyOwnership(id, store_id, supabase);
  if ("error" in ownership) return NextResponse.json({ error: ownership.error }, { status: ownership.status });

  const body = await req.json();
  const parsed = MascotaUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { nombre, tipo, raza, peso_kg, alimento_habitual_id, gramos_porcion, veces_dia } = parsed.data;

  // Evitar duplicado al renombrar: no permitir otro nombre ya existente (case-insensitive)
  if (nombre !== undefined) {
    const { data: existing } = await supabase
      .from("mascotas")
      .select("id")
      .eq("cliente_id", ownership.mascota.cliente_id)
      .ilike("nombre", nombre.trim())
      .neq("id", id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: "Ya existe una mascota con ese nombre para este cliente" },
        { status: 409 }
      );
    }
  }

  const updates: Record<string, unknown> = {};
  if (nombre !== undefined) updates.nombre = nombre.trim();
  if (tipo !== undefined) updates.tipo = tipo?.trim() || null;
  if (raza !== undefined) updates.raza = raza?.trim() || null;
  if (peso_kg !== undefined) updates.peso_kg = peso_kg ? Number(peso_kg) : null;
  if (alimento_habitual_id !== undefined) updates.alimento_habitual_id = alimento_habitual_id ?? null;
  if (gramos_porcion !== undefined) updates.gramos_porcion = gramos_porcion ? Number(gramos_porcion) : null;
  if (veces_dia !== undefined) updates.veces_dia = veces_dia ? Number(veces_dia) : null;

  const { data: oldData } = await supabase
    .from("mascotas")
    .select("nombre, tipo, raza, peso_kg, gramos_porcion, veces_dia")
    .eq("id", id)
    .single();

  const { data, error } = await supabase
    .from("mascotas")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId,
    action: "UPDATE",
    entityType: "mascota",
    entityId: id,
    oldValues: oldData ?? undefined,
    newValues: updates as Record<string, unknown>,
    ipAddress,
    userAgent,
  });

  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id, userId } = ctx;

  const { id } = await params;
  const supabase = createServiceClient();

  const ownership = await verifyOwnership(id, store_id, supabase);
  if ("error" in ownership) return NextResponse.json({ error: ownership.error }, { status: ownership.status });
  const { mascota } = ownership;

  const { error } = await supabase
    .from("mascotas")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId,
    action: "DELETE",
    entityType: "mascota",
    entityId: id,
    oldValues: { nombre: mascota.nombre, tipo: mascota.tipo },
    changeDescription: `Mascota eliminada: ${mascota.nombre} (${mascota.tipo})`,
    ipAddress,
    userAgent,
  });

  return NextResponse.json({ ok: true });
}
