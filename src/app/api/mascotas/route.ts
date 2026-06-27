import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { MascotaCreateSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const clienteId = req.nextUrl.searchParams.get("clienteId");
  if (!clienteId) return NextResponse.json({ error: "clienteId required" }, { status: 400 });

  // Verify cliente belongs to the user's store
  const { data: cliente } = await supabase
    .from("clientes")
    .select("id")
    .eq("id", clienteId)
    .eq("store_id", store_id)
    .single();

  if (!cliente) return NextResponse.json([]);

  const { data, error } = await supabase
    .from("mascotas")
    .select("id, cliente_id, nombre, tipo, raza, peso_kg, alimento_habitual_id, gramos_porcion, veces_dia")
    .eq("cliente_id", clienteId);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  // Deduplicar por (nombre, tipo) — puede haber duplicados si el usuario guardó dos veces
  const seen = new Set<string>();
  const unique = (data ?? []).filter((m) => {
    const key = `${m.nombre}|${m.tipo}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json(unique);
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = MascotaCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { cliente_id, nombre, tipo, raza, peso_kg, alimento_habitual_id, gramos_porcion, veces_dia } = parsed.data;

  // Verify cliente belongs to store
  const { data: cliente } = await supabase
    .from("clientes")
    .select("id")
    .eq("id", cliente_id)
    .eq("store_id", store_id)
    .single();

  if (!cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });

  // Evitar mascotas duplicadas por (cliente_id, nombre)
  const { data: existing } = await supabase
    .from("mascotas")
    .select("id")
    .eq("cliente_id", cliente_id)
    .eq("nombre", nombre)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Ya existe una mascota con ese nombre para este cliente" }, { status: 409 });
  }

  const { data: mascota, error } = await supabase
    .from("mascotas")
    .insert({
      cliente_id,
      nombre,
      tipo,
      raza: raza ?? null,
      peso_kg: peso_kg ?? null,
      alimento_habitual_id: alimento_habitual_id ?? null,
      gramos_porcion: gramos_porcion ?? null,
      veces_dia: veces_dia ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const { ipAddress, userAgent } = await getRequestMetadata(req);

  await logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "CREATE",
    entityType: "mascota",
    entityId: mascota.id,
    newValues: mascota,
    changeDescription: `Mascota registrada: ${nombre} (${tipo})`,
    ipAddress,
    userAgent,
    result: "success",
  });

  return NextResponse.json(mascota, { status: 201 });
}
