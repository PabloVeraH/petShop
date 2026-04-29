import { Resend } from "resend";

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