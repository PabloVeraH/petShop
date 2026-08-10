import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { FidelizacionQuerySchema } from "@/lib/validation";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const parsed = FidelizacionQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { clienteId } = parsed.data;

  const supabase = createServiceClient();

  // Verify cliente belongs to this store
  const { data: cliente } = await supabase.from("clientes").select("id").eq("id", clienteId).eq("store_id", store_id).single();
  if (!cliente) return NextResponse.json(null);

  const [{ data }, { data: store }] = await Promise.all([
    supabase
      .from("fidelizacion")
      .select("total_historico, frecuencia_compras, descuento_actual")
      .eq("cliente_id", clienteId)
      .single(),
    supabase
      .from("stores")
      .select("fidelizacion_niveles")
      .eq("id", store_id)
      .single(),
  ]);

  if (!data) return NextResponse.json(null);

  const defaultNiveles = [
    { monto: 50000, descuento: 5 },
    { monto: 150000, descuento: 10 },
    { monto: 300000, descuento: 20 },
  ];
  const niveles = (store?.fidelizacion_niveles as { monto: number; descuento: number }[] | null) ?? defaultNiveles;

  return NextResponse.json({ ...data, niveles });
}, { endpoint: "GET /api/fidelizacion" });
