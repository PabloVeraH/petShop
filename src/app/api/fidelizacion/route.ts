import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const clienteId = req.nextUrl.searchParams.get("clienteId");
  if (!clienteId) return NextResponse.json({ error: "clienteId requerido" }, { status: 400 });

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
}
