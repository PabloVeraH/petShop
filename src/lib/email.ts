import { Resend } from "resend";
import { generateBoletaPDF, type BoletaData } from "@/lib/reports/pdf-generator";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

export const DEFAULT_FROM = process.env.RESEND_FROM_DEFAULT ?? "no-reply@tuapp.com";

export interface FoodReminderEmailParams {
  to: string;
  clienteNombre: string;
  storeName: string;
  storeFromEmail?: string;
  items: Array<{
    mascotaNombre: string;
    productoNombre: string;
    diasRestantes: number;
    precioUnitario: number;
  }>;
}

export async function sendFoodReminderEmail(params: FoodReminderEmailParams) {
  const from = params.storeFromEmail ?? DEFAULT_FROM;

  const html = buildFoodReminderHTML(params);

  const { error } = await getResend().emails.send({
    from,
    to: params.to,
    subject: `⏰ El alimento de ${params.items.map(i => i.mascotaNombre).join(" y ")} está por acabarse`,
    html,
  });

  if (error) {
    console.error("[email] Error enviando recordatorio:", error);
    return false;
  }
  return true;
}

export function buildFoodReminderHTML(params: FoodReminderEmailParams): string {
  const itemsHTML = params.items.map(item => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">
        <strong>${item.mascotaNombre}</strong> — ${item.productoNombre}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">
        ${item.diasRestantes <= 0 ? "Se acabó hoy" : `Queda${item.diasRestantes === 1 ? "" : "n"} ${item.diasRestantes} día${item.diasRestantes === 1 ? "" : "s"}`}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">
        $${Math.round(item.precioUnitario).toLocaleString("es-CL")}
      </td>
    </tr>
  `).join("");

  return `
    <!DOCTYPE html>
    <html lang="es">
    <body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
      <h2 style="color:#2d6a4f;">Recordatorio de alimento — ${params.storeName}</h2>
      <p>Hola ${params.clienteNombre},</p>
      <p>El alimento de tu${params.items.length > 1 ? "s mascota" : " mascota"}s está por terminarse:</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px 0;border-bottom:2px solid #ddd;">Mascota / Producto</th>
            <th style="text-align:right;padding:8px 0;border-bottom:2px solid #ddd;">Días restantes</th>
            <th style="text-align:right;padding:8px 0;border-bottom:2px solid #ddd;">Último precio</th>
          </tr>
        </thead>
        <tbody>${itemsHTML}</tbody>
      </table>
      <p style="margin-top:24px;">Pasa por <strong>${params.storeName}</strong> antes de que se acabe.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
      <p style="font-size:12px;color:#999;">Recibiste este correo porque eres cliente de ${params.storeName}.</p>
    </body>
    </html>
  `;
}

export function _setResendInstance(resendInstance: Resend) {
  _resend = resendInstance;
}

export async function sendBoletaEmail(params: {
  to: string;
  fromEmail?: string;
  boleta: BoletaData;
}): Promise<boolean> {
  const from = params.fromEmail ?? DEFAULT_FROM;
  const doc = generateBoletaPDF(params.boleta);
  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

  const { error } = await getResend().emails.send({
    from,
    to: params.to,
    subject: `Boleta ${params.boleta.numeroComprobante} — ${params.boleta.storeName}`,
    html: buildBoletaEmailHTML(params.boleta),
    attachments: [
      {
        filename: `boleta-${params.boleta.numeroComprobante}.pdf`,
        content: pdfBuffer,
      },
    ],
  });

  if (error) {
    console.error("[email] Error enviando boleta:", error);
    return false;
  }
  return true;
}

export function buildBoletaEmailHTML(b: BoletaData): string {
  const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
  const fecha = new Date(b.fecha).toLocaleDateString("es-CL");
  // Subtotal (sin IVA) del monto efectivamente cobrado — NO netoDesdeBruto(b.subtotal),
  // que es el bruto pre-descuento y rompe la invariante Subtotal + IVA = Total en el email
  // cuando hay descuento (ver AGENTS.md §23.3).
  const subtotalNeto = b.total - b.impuesto;

  const itemsHTML = b.items.map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">${i.nombre}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center;">${i.cantidad}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${fmt(i.precio_unitario)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${fmt(i.subtotal)}</td>
    </tr>`).join("");

  const pagosHTML = b.pagos.map(p => {
    const metodoLabels: Record<string, string> = {
      efectivo: "Efectivo", debito: "Débito", credito: "Crédito",
      transferencia: "Transferencia", nota_credito: "Nota de Crédito",
    };
    let label = metodoLabels[p.metodo] ?? p.metodo;
    if (p.numero_transaccion) label += ` #${p.numero_transaccion}`;
    return `<div style="display:flex;justify-content:space-between;"><span>${label}</span><span>${fmt(p.monto)}</span></div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="es">
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
  <h2 style="color:#16a34a;">${b.storeName}</h2>
  ${b.storeRut ? `<p style="color:#666;margin-top:-12px;">RUT: ${b.storeRut}</p>` : ""}
  <p style="font-size:13px;color:#555;">Boleta <strong>${b.numeroComprobante}</strong> · ${fecha}</p>
  ${b.cliente ? `<p style="font-size:13px;">Cliente: <strong>${b.cliente.nombre}</strong>${b.cliente.rut ? ` (${b.cliente.rut})` : ""}</p>` : ""}

  <table style="width:100%;border-collapse:collapse;margin-top:16px;">
    <thead>
      <tr style="border-bottom:2px solid #ddd;">
        <th style="text-align:left;padding:8px 0;">Producto</th>
        <th style="text-align:center;padding:8px 0;">Cant</th>
        <th style="text-align:right;padding:8px 0;">Precio</th>
        <th style="text-align:right;padding:8px 0;">Total</th>
      </tr>
    </thead>
    <tbody>${itemsHTML}</tbody>
  </table>

  <div style="margin-top:12px;text-align:right;font-size:13px;">
    <div>Subtotal: ${fmt(subtotalNeto)}</div>
    ${b.descuentoMonto > 0 ? `<div>Descuento (${b.descuentoPct}%): -${fmt(b.descuentoMonto)}</div>` : ""}
    <div>IVA (19%): ${fmt(b.impuesto)}</div>
    <div style="font-weight:bold;font-size:16px;border-top:1px solid #ddd;margin-top:6px;padding-top:6px;">
      TOTAL: ${fmt(b.total)}
    </div>
  </div>

  <div style="margin-top:16px;font-size:12px;color:#666;">
    <strong>Formas de pago:</strong>
    ${pagosHTML}
  </div>

  <hr style="margin:20px 0;border:none;border-top:1px solid #eee;">
  <p style="font-size:11px;color:#999;">
    Adjunto encontrarás la boleta en formato PDF.<br>
    Este correo no constituye un documento tributario.
  </p>
</body>
</html>`;
}

export interface OrdenCompraCancelacionEmailParams {
  to: string;
  proveedorNombre: string;
  storeName: string;
  storeAddress?: string;
  storeFromEmail?: string;
  orden: {
    numero: string;
    fecha: string;
  };
}

export async function sendOrdenCompraCancelacionEmail(params: OrdenCompraCancelacionEmailParams): Promise<boolean> {
  const from = params.storeFromEmail ?? DEFAULT_FROM;
  const html = buildOrdenCompraCancelacionHTML(params);

  const { error } = await getResend().emails.send({
    from,
    to: params.to,
    subject: `Cancelación de Orden de Compra ${params.orden.numero} — ${params.storeName}`,
    html,
  });

  if (error) {
    console.error("[email-oc] Error enviando cancelación OC:", error);
    return false;
  }
  return true;
}

export function buildOrdenCompraCancelacionHTML(params: OrdenCompraCancelacionEmailParams): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
    <tr><td>
      <table width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr>
          <td style="background:#dc2626;padding:28px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${params.storeName}</h1>
            <p style="margin:4px 0 0;color:#fecaca;font-size:14px;">Cancelación de Orden de Compra</p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0;color:#6b7280;font-size:14px;">Estimado/a <strong style="color:#111827;">${params.proveedorNombre}</strong>,</p>
            <p style="margin:12px 0 0;color:#374151;font-size:15px;">
              Lamentamos informarle que la orden de compra <strong>${params.orden.numero}</strong>
              con fecha <strong>${params.orden.fecha}</strong> ha sido
              <strong style="color:#dc2626;">cancelada</strong>.
            </p>
            <p style="margin:12px 0 0;color:#374151;font-size:15px;">
              Si tiene consultas al respecto, no dude en contactarnos respondiendo a este correo.
            </p>
            ${params.storeAddress ? `<p style="margin:24px 0 0;color:#9ca3af;font-size:13px;">${params.storeAddress}</p>` : ""}
            <p style="margin:8px 0 0;color:#9ca3af;font-size:12px;">— ${params.storeName}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export interface OrdenCompraEmailParams {
  to: string;
  proveedorNombre: string;
  storeName: string;
  storeAddress?: string;
  storeFromEmail?: string;
  orden: {
    numero: string;
    fecha: string;
    notas?: string;
  };
  items: Array<{
    nombre: string;
    cantidad: number;
  }>;
}

export async function sendOrdenCompraEmail(params: OrdenCompraEmailParams): Promise<boolean> {
  const from = params.storeFromEmail ?? DEFAULT_FROM;
  const html = buildOrdenCompraHTML(params);

  const { error } = await getResend().emails.send({
    from,
    to: params.to,
    subject: `Orden de Compra ${params.orden.numero} — ${params.storeName}`,
    html,
  });

  if (error) {
    console.error("[email-oc] Error enviando OC:", error);
    return false;
  }
  return true;
}

export function buildOrdenCompraHTML(params: OrdenCompraEmailParams): string {
  const itemsHTML = params.items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#374151;">${item.nombre}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#374151;text-align:center;">${item.cantidad}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
    <tr><td>
      <table width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr>
          <td style="background:#16a34a;padding:28px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${params.storeName}</h1>
            <p style="margin:4px 0 0;color:#bbf7d0;font-size:14px;">Orden de Compra</p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 0;">
            <p style="margin:0;color:#6b7280;font-size:14px;">Estimado/a <strong style="color:#111827;">${params.proveedorNombre}</strong>,</p>
            <p style="margin:12px 0 0;color:#374151;font-size:15px;">
              Le enviamos nuestra orden de compra <strong>${params.orden.numero}</strong> con fecha <strong>${params.orden.fecha}</strong>.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background:#f3f4f6;">
                  <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Producto</th>
                  <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Cantidad</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHTML}
              </tbody>
            </table>
          </td>
        </tr>
        ${params.orden.notas ? `
        <tr>
          <td style="padding:20px 32px 0;">
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;">
              <p style="margin:0;font-size:13px;color:#92400e;"><strong>Notas:</strong> ${params.orden.notas}</p>
            </div>
          </td>
        </tr>` : ""}
        <tr>
          <td style="padding:28px 32px;border-top:1px solid #f0f0f0;margin-top:24px;">
            <p style="margin:0;color:#374151;font-size:14px;">Cualquier consulta, responda a este correo.</p>
            ${params.storeAddress ? `<p style="margin:8px 0 0;color:#9ca3af;font-size:13px;">${params.storeAddress}</p>` : ""}
            <p style="margin:16px 0 0;color:#9ca3af;font-size:12px;">— ${params.storeName}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}