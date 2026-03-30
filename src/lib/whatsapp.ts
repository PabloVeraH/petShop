const WA_API_VERSION = "v19.0";
const WA_BASE_URL = `https://graph.facebook.com/${WA_API_VERSION}`;

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
}

/**
 * Validates and normalizes a Chilean mobile phone number.
 * Accepts formats: +56912345678, 56912345678, 912345678, 912345678
 * Returns the E.164 international number (569XXXXXXXX) or null if invalid.
 */
export function normalizeChileanPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  // Normalize to local 9-digit number
  let local = digits;
  if (local.startsWith("569")) local = local.slice(2); // strip country code
  else if (local.startsWith("56")) local = local.slice(2);
  // Chilean mobile numbers start with 9 and are 9 digits
  if (!/^9\d{8}$/.test(local)) return null;
  return `56${local}`;
}

export async function sendWhatsAppText(
  config: WhatsAppConfig,
  to: string,
  body: string
): Promise<boolean> {
  const intl = normalizeChileanPhone(to);
  if (!intl) return false; // reject invalid/non-Chilean numbers silently

  try {
    const res = await fetch(`${WA_BASE_URL}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: intl,
        type: "text",
        text: { body },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function buildReceiptMessage(params: {
  storeName: string;
  numeroComprobante: string;
  clienteNombre: string;
  items: Array<{ nombre: string; cantidad: number; subtotal: number }>;
  total: number;
  metodoPago: string;
}): string {
  const lines = params.items.map(
    (i) => `• ${i.nombre} ×${i.cantidad} = $${Math.round(i.subtotal).toLocaleString("es-CL")}`
  );
  return (
    `*${params.storeName}*\n` +
    `Comprobante N° ${params.numeroComprobante}\n\n` +
    `Hola ${params.clienteNombre}, gracias por tu compra 🐾\n\n` +
    lines.join("\n") +
    `\n\n*Total: $${Math.round(params.total).toLocaleString("es-CL")}*` +
    `\nMétodo: ${params.metodoPago}`
  );
}

export function buildConsumoAlertMessage(params: {
  storeName: string;
  clienteNombre: string;
  mascotaNombre: string;
  productoNombre: string;
  diasRestantes: number;
}): string {
  const urgente = params.diasRestantes <= 3;
  return (
    `*${params.storeName}* 🐾\n\n` +
    `Hola ${params.clienteNombre},\n` +
    (urgente
      ? `⚠️ El alimento de *${params.mascotaNombre}* (${params.productoNombre}) se agota en *${params.diasRestantes} días*.\n`
      : `El alimento de *${params.mascotaNombre}* (${params.productoNombre}) se agotará en aproximadamente *${params.diasRestantes} días*.\n`) +
    `\nPasa por nuestra tienda o escríbenos para hacer tu pedido.`
  );
}
