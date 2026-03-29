import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return new NextResponse("Unauthorized", { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const tipo = req.nextUrl.searchParams.get("tipo") ?? "ventas";
  const desde = req.nextUrl.searchParams.get("desde") ?? "";
  const hasta = req.nextUrl.searchParams.get("hasta") ?? "";

  let csv = "";

  if (tipo === "ventas") {
    let query = supabase
      .from("ventas")
      .select("numero_comprobante, created_at, total, subtotal, descuento, impuesto, metodo_pago, estado, clientes(nombre, rut)")
      .eq("store_id", store_id)
      .order("created_at", { ascending: false });
    if (desde) query = query.gte("created_at", desde);
    if (hasta) query = query.lte("created_at", hasta + "T23:59:59");

    const { data } = await query;
    csv = "Comprobante,Fecha,Cliente,RUT,Total,Subtotal,Descuento,IVA,Método,Estado\n";
    for (const v of data ?? []) {
      const cliente = v.clientes as unknown as { nombre: string; rut: string } | null;
      csv += [
        v.numero_comprobante ?? "",
        new Date(v.created_at).toLocaleString("es-CL"),
        cliente?.nombre ?? "",
        cliente?.rut ?? "",
        Math.round(Number(v.total)),
        Math.round(Number(v.subtotal)),
        Math.round(Number(v.descuento)),
        Math.round(Number(v.impuesto)),
        v.metodo_pago ?? "",
        v.estado,
      ].join(",") + "\n";
    }
  } else if (tipo === "inventario") {
    const { data } = await supabase
      .from("productos")
      .select("sku, nombre, marca, precio, costo, stock, stock_minimo, activo")
      .eq("store_id", store_id)
      .order("nombre");

    csv = "SKU,Nombre,Marca,Precio,Costo,Stock,Stock Mínimo,Activo\n";
    for (const p of data ?? []) {
      csv += [p.sku, p.nombre, p.marca ?? "", Math.round(Number(p.precio)), p.costo ? Math.round(Number(p.costo)) : "", p.stock ?? 0, p.stock_minimo ?? 0, p.activo ? "Sí" : "No"].join(",") + "\n";
    }
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${tipo}-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
