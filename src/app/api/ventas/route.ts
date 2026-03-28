import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users")
    .select("store_id")
    .eq("clerk_id", userId)
    .single();

  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

  const search = req.nextUrl.searchParams.get("search") ?? "";
  const metodo = req.nextUrl.searchParams.get("metodo") ?? "";
  const desde = req.nextUrl.searchParams.get("desde") ?? "";
  const hasta = req.nextUrl.searchParams.get("hasta") ?? "";
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");
  const LIMIT = 50;

  let query = supabase
    .from("ventas")
    .select("id, total, metodo_pago, estado, created_at, clientes(nombre)", { count: "exact" })
    .eq("store_id", user.store_id)
    .order("created_at", { ascending: false })
    .range(offset, offset + LIMIT - 1);

  if (metodo) query = query.eq("metodo_pago", metodo);
  if (desde) query = query.gte("created_at", desde);
  if (hasta) query = query.lte("created_at", hasta + "T23:59:59");

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Filter by cliente nombre in JS (Supabase doesn't support ilike on joined tables easily)
  let ventas = data ?? [];
  if (search) {
    const q = search.toLowerCase();
    ventas = ventas.filter((v) => {
      const cliente = v.clientes as unknown as { nombre: string } | null;
      return cliente?.nombre.toLowerCase().includes(q);
    });
  }

  return NextResponse.json({ data: ventas, count: count ?? 0 });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users")
    .select("store_id")
    .eq("clerk_id", userId)
    .single();

  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

  const { items, clienteId, metodoPago, descuentoPct } = await req.json();

  const subtotal: number = items.reduce(
    (sum: number, i: { subtotal: number }) => sum + i.subtotal,
    0
  );
  const descuento = (subtotal * (descuentoPct ?? 0)) / 100;
  const impuesto = (subtotal - descuento) * 0.19;
  const total = (subtotal - descuento) * 1.19;

  const { data: venta, error: ventaError } = await supabase
    .from("ventas")
    .insert({
      store_id: user.store_id,
      cliente_id: clienteId ?? null,
      subtotal,
      descuento,
      impuesto,
      total,
      metodo_pago: metodoPago,
      estado: "completada",
    })
    .select()
    .single();

  if (ventaError) return NextResponse.json({ error: ventaError.message }, { status: 500 });

  const { error: itemsError } = await supabase.from("venta_items").insert(
    items.map((item: {
      producto_id: string;
      cantidad: number;
      precio_unitario: number;
      subtotal: number;
      mascota_id?: string;
    }) => ({
      venta_id: venta.id,
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      subtotal: item.subtotal,
      mascota_id: item.mascota_id ?? null,
    }))
  );

  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

  for (const item of items as { producto_id: string; cantidad: number; mascota_id?: string }[]) {
    await supabase.rpc("decrement_stock", {
      p_producto_id: item.producto_id,
      p_cantidad: item.cantidad,
    });
    await supabase.from("stock_movements").insert({
      producto_id: item.producto_id,
      tipo: "salida",
      cantidad: -item.cantidad,
      referencia_id: venta.id,
      notas: `Venta ${venta.id}`,
    });

    // Calcular alerta de consumo si hay mascota y config definida
    if (item.mascota_id) {
      const { data: config } = await supabase
        .from("consumo_configs")
        .select("id, cliente_id, gramos_porcion, veces_dia")
        .eq("mascota_id", item.mascota_id)
        .eq("producto_id", item.producto_id)
        .single();

      const { data: producto } = await supabase
        .from("productos")
        .select("peso_gramos")
        .eq("id", item.producto_id)
        .single();

      if (config && producto?.peso_gramos && config.gramos_porcion > 0 && config.veces_dia > 0) {
        const consumoDiario = config.gramos_porcion * config.veces_dia;
        const diasEstimados = Math.round((item.cantidad * producto.peso_gramos) / consumoDiario);
        const fechaTermino = new Date();
        fechaTermino.setDate(fechaTermino.getDate() + diasEstimados);

        await supabase.from("consumo_alertas").upsert(
          {
            cliente_id: config.cliente_id,
            mascota_id: item.mascota_id,
            producto_id: item.producto_id,
            fecha_estimada_termino: fechaTermino.toISOString().split("T")[0],
            dias_aviso: 7,
            enviado: false,
          },
          { onConflict: "mascota_id,producto_id" }
        );
      }
    }
  }

  return NextResponse.json(venta);
}
