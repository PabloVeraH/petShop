import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { netoDesdeBruto } from "@/lib/tax";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ventaId: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { ventaId } = await params;
  if (!ventaId) {
    return NextResponse.json({ error: "ventaId requerido" }, { status: 400 });
  }

  // Obtener venta con detalles
  const { data: venta, error: ventaError } = await supabase
    .from("ventas")
    .select(
      `
      id, store_id, numero_comprobante, total, subtotal, descuento, impuesto,
      created_at, estado, worker_clerk_id,
      clientes(id, nombre, telefono, email, rut),
      venta_items(cantidad, precio_unitario, subtotal, productos(nombre, sku))
    `
    )
    .eq("id", ventaId)
    .eq("store_id", store_id)
    .single();

  if (ventaError || !venta) {
    return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
  }

  let worker = null;
  if (venta.worker_clerk_id) {
    const { data: workerData } = await supabase
      .from("clerk_users")
      .select("nombre, email")
      .eq("clerk_id", venta.worker_clerk_id)
      .single();
    worker = workerData;
  }

  // Obtener pagos
  const { data: pagos } = await supabase
    .from("pagos")
    .select("id, metodo, monto, numero_transaccion, created_at")
    .eq("venta_id", ventaId)
    .order("created_at", { ascending: true });

  // Obtener información de tienda
  const { data: store } = await supabase
    .from("stores")
    .select("name, rut, email, telefono, whatsapp_phone")
    .eq("id", store_id)
    .single();

  // Construir HTML del recibo
  const cliente = venta.clientes as any;
  const items = venta.venta_items as any[];

  const html = generarHTMLRecibo({
    venta,
    store,
    cliente,
    worker,
    items,
    pagos: pagos ?? [],
  });

  return NextResponse.json({
    ok: true,
    html,
    numeroComprobante: venta.numero_comprobante,
    total: venta.total,
  });
}

interface ReciboDatos {
  venta: any;
  store: any;
  cliente: any;
  worker: any;
  items: any[];
  pagos: any[];
}

function generarHTMLRecibo({ venta, store, cliente, worker, items, pagos }: ReciboDatos): string {
  const fecha = new Date(venta.created_at);
  const fechaFormato = fecha.toLocaleDateString("es-CL");
  const horaFormato = fecha.toLocaleTimeString("es-CL");

  const metodosDetalle = pagos
    .map((p: any) => {
      const monto = Number(p.monto);
      let metodoTexto = p.metodo.charAt(0).toUpperCase() + p.metodo.slice(1);
      if (p.numero_transaccion) {
        metodoTexto += ` #${p.numero_transaccion}`;
      }
      return `      <tr>
        <td>${metodoTexto}</td>
        <td style="text-align: right">$${monto.toLocaleString("es-CL")}</td>
      </tr>`;
    })
    .join("");

  const itemsDetalle = items
    .map((item: any) => {
      const prod = item.productos as any;
      const cantidad = item.cantidad;
      const precio = Number(item.precio_unitario);
      const subtotal = Number(item.subtotal);

      // Mostrar cantidad diferente para granel
      const cantidadDisplay = item.es_granel
        ? `${item.gramos}g a $${precio.toLocaleString("es-CL")}/kg`
        : `${cantidad} x $${precio.toLocaleString("es-CL")}`;

      return `      <tr>
        <td>${prod?.nombre ?? "Producto"}${item.es_granel ? " (Granel)" : ""}</td>
        <td style="text-align: center">${cantidadDisplay}</td>
        <td style="text-align: right">$${precio.toLocaleString("es-CL")}</td>
        <td style="text-align: right">$${subtotal.toLocaleString("es-CL")}</td>
      </tr>`;
    })
    .join("");

  const subtotalConIva = Number(venta.subtotal); // IVA-inclusive, antes del descuento
  const subtotalNeto = netoDesdeBruto(subtotalConIva); // Extraído el IVA
  const descuentoPct = Number(venta.descuento); // almacenado como porcentaje (ej: 10)
  const descuentoMonto = Math.round(subtotalConIva * descuentoPct / 100);
  const impuesto = Number(venta.impuesto);
  const total = Number(venta.total);
  const neto = total - impuesto; // Neto sin IVA para mostrar en recibo

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recibo ${venta.numero_comprobante}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Courier New', monospace;
      background: white;
      color: #333;
      line-height: 1.4;
    }

    .recibo {
      width: 80mm;
      margin: 0 auto;
      padding: 8mm;
      background: white;
      min-height: 100vh;
    }

    .header {
      text-align: center;
      margin-bottom: 8mm;
      border-bottom: 1px dashed #333;
      padding-bottom: 4mm;
    }

    .titulo {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 2mm;
    }

    .subtitulo {
      font-size: 12px;
      margin-bottom: 2mm;
    }

    .numero-comprobante {
      font-size: 14px;
      font-weight: bold;
      letter-spacing: 2px;
      margin-top: 4mm;
      border-top: 1px dashed #333;
      border-bottom: 1px dashed #333;
      padding: 2mm 0;
    }

    .fecha-hora {
      font-size: 11px;
      color: #666;
      margin-top: 2mm;
    }

    .seccion {
      margin-bottom: 4mm;
    }

    .seccion-titulo {
      font-size: 11px;
      font-weight: bold;
      background: #f0f0f0;
      padding: 1mm 2mm;
      margin-bottom: 2mm;
    }

    .cliente-info {
      font-size: 11px;
      line-height: 1.6;
    }

    .cliente-info div {
      margin-bottom: 1mm;
    }

    table {
      width: 100%;
      font-size: 11px;
      margin-bottom: 4mm;
      border-collapse: collapse;
    }

    table thead {
      border-top: 1px solid #333;
      border-bottom: 1px solid #333;
      background: #f9f9f9;
    }

    table th {
      padding: 2mm;
      text-align: left;
      font-weight: bold;
      border: none;
    }

    table td {
      padding: 2mm;
      border: none;
    }

    table tfoot {
      border-top: 1px solid #333;
      border-bottom: 1px dashed #333;
    }

    .totales {
      font-size: 11px;
      margin: 4mm 0;
    }

    .totales-fila {
      display: flex;
      justify-content: space-between;
      margin-bottom: 1mm;
    }

    .totales-fila.total-final {
      font-weight: bold;
      font-size: 14px;
      margin-top: 2mm;
      border-top: 1px solid #333;
      padding-top: 2mm;
    }

    .metodos-pago {
      font-size: 11px;
      margin-top: 4mm;
    }

    .metodo-fila {
      display: flex;
      justify-content: space-between;
      margin-bottom: 1mm;
    }

    .pie {
      text-align: center;
      font-size: 10px;
      color: #666;
      margin-top: 8mm;
      border-top: 1px dashed #333;
      padding-top: 4mm;
    }

    .codigo-barras {
      text-align: center;
      margin: 4mm 0;
      font-family: 'Code128';
      font-size: 32px;
      letter-spacing: 3px;
    }

    @media print {
      body {
        margin: 0;
        padding: 0;
      }

      .recibo {
        width: 100%;
        padding: 0;
        margin: 0;
        min-height: auto;
      }
    }
  </style>
</head>
<body>
  <div class="recibo">
    <!-- Header -->
    <div class="header">
      <div class="titulo">${store?.name ?? "Tienda"}</div>
      <div class="subtitulo">RUT: ${store?.rut ?? "N/A"}</div>
      <div class="numero-comprobante">${venta.numero_comprobante}</div>
      <div class="fecha-hora">${fechaFormato} ${horaFormato}</div>
    </div>

    <!-- Cliente -->
    ${
      cliente
        ? `
    <div class="seccion">
      <div class="seccion-titulo">CLIENTE</div>
      <div class="cliente-info">
        <div><strong>${cliente.nombre}</strong></div>
        ${cliente.rut ? `<div>RUT: ${cliente.rut}</div>` : ""}
        ${cliente.email ? `<div>Email: ${cliente.email}</div>` : ""}
        ${cliente.telefono ? `<div>Teléfono: ${cliente.telefono}</div>` : ""}
      </div>
    </div>
    `
        : ""
    }

    <!-- Vendedor -->
    ${worker ? `<div class="seccion"><div class="seccion-titulo">Vendedor: ${worker.nombre ?? worker.email}</div></div>` : ""}

    <!-- Detalles de venta -->
    <div class="seccion">
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th style="width: 15mm; text-align: center">Cant</th>
            <th style="width: 18mm; text-align: right">Precio</th>
            <th style="width: 18mm; text-align: right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsDetalle}
        </tbody>
      </table>
    </div>

    <!-- Totales -->
    <div class="totales">
      ${
        descuentoPct > 0
          ? `
      <div class="totales-fila">
        <span>Subtotal:</span>
        <span>$${subtotalNeto.toLocaleString("es-CL")}</span>
      </div>
      <div class="totales-fila">
        <span>Descuento (${descuentoPct}%):</span>
        <span>-$${descuentoMonto.toLocaleString("es-CL")}</span>
      </div>
      `
          : ""
      }
      <div class="totales-fila">
        <span>Neto (sin IVA):</span>
        <span>$${neto.toLocaleString("es-CL")}</span>
      </div>
      <div class="totales-fila">
        <span>IVA (19%):</span>
        <span>$${impuesto.toLocaleString("es-CL")}</span>
      </div>
      <div class="totales-fila total-final">
        <span>TOTAL:</span>
        <span>$${total.toLocaleString("es-CL")}</span>
      </div>
    </div>

    <!-- Métodos de pago -->
    <div class="metodos-pago">
      <div class="seccion-titulo">FORMAS DE PAGO</div>
      ${metodosDetalle}
    </div>

    <!-- Pie -->
    <div class="pie">
      <p>Gracias por su compra</p>
      <p style="margin-top: 2mm; font-size: 9px;">Estado: ${venta.estado}</p>
      <p style="margin-top: 2mm; font-size: 9px;">Este recibo NO constituye un documento tributario</p>
    </div>
  </div>
</body>
</html>`;
}
