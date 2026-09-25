#!/usr/bin/env node
// Simulador de webhooks de Rappi para pruebas E2E (Fase 6, paso 6.1 de
// docs/canales-stock/stock_canales_externos.md). Envía eventos FIRMADOS igual
// que Rappi (header Rappi-Signature: t=<seg>,sign=<HMAC-SHA256 hex de
// "t.cuerpo">) a un despliegue de la app (preview de Vercel o local).
//
// NO reemplaza la prueba con el sandbox real de Rappi: sirve para verificar
// el pipeline propio (firma, tienda, orden → venta, stock, outbox) antes de
// tener credenciales. Las llamadas SALIENTES a Rappi (confirmar, catálogo,
// disponibilidad) fallarán sin credenciales reales y quedarán en la outbox.
//
// Uso (el secreto va por variable de entorno, no por argumento, para que no
// quede en el historial de la terminal):
//   RAPPI_WEBHOOK_SECRET=... node scripts/canales/simular-rappi.mjs \
//     --url https://<preview>.vercel.app --store-id <uuid> --evento PING
//   ... --evento NEW_ORDER --rappi-store 900105814 --item SKU-1:2:15990 --item SKU-2:1:3990
//   ... --evento ORDER_EVENT_CANCEL --orden 123456 --rappi-store 900105814
//   ... --evento MENU_APPROVED
//   ... --evento MENU_REJECTED --motivo "Faltan imágenes"
//
// Si la Deployment Protection de Vercel está activa en el preview, agrega
// --bypass <token> (header x-vercel-protection-bypass).

import { createHmac, randomInt } from "node:crypto";

function args(argv) {
  const out = { item: [] };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    const nombre = k.slice(2);
    const valor = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    if (nombre === "item") out.item.push(valor);
    else out[nombre] = valor;
  }
  return out;
}

function fallar(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function cuerpo(evento, a) {
  const tienda = a["rappi-store"];
  switch (evento) {
    case "PING":
      return { store_id: tienda ?? "0" };
    case "NEW_ORDER": {
      if (a.item.length === 0) fallar("NEW_ORDER necesita al menos un --item SKU:cantidad:precio");
      const items = a.item.map((txt, i) => {
        const [sku, cantidad, precio] = txt.split(":");
        const quantity = Number(cantidad);
        const price = Number(precio);
        if (!sku || !Number.isInteger(quantity) || quantity <= 0 || !(price >= 0)) fallar(`--item inválido: ${txt}`);
        return { id: String(i + 1), sku, name: sku, quantity, price, unit_price_with_discount: price };
      });
      const orderId = a.orden ?? String(randomInt(1_000_000_000, 9_999_999_999));
      return {
        order_detail: {
          order_id: orderId,
          created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
          items,
          totals: { total_order: items.reduce((s, it) => s + it.price * it.quantity, 0) },
        },
        ...(tienda ? { store: { internal_id: tienda, external_id: tienda } } : {}),
      };
    }
    case "ORDER_EVENT_CANCEL":
    case "ORDER_OTHER_EVENT":
      if (!a.orden) fallar(`${evento} necesita --orden <order_id>`);
      return { event: a.estado ?? (evento === "ORDER_EVENT_CANCEL" ? "canceled_with_charge" : "picked_up"), order_id: a.orden, ...(tienda ? { store_id: tienda } : {}) };
    case "MENU_APPROVED":
      return { message: "Menu approved" };
    case "MENU_REJECTED":
      return { message: "Menu rejected", reason: a.motivo ?? "Rechazo simulado" };
    default:
      return fallar(`evento no soportado por el simulador: ${evento}`);
  }
}

const a = args(process.argv);
const secreto = process.env.RAPPI_WEBHOOK_SECRET;
if (!a.url) fallar("falta --url (ej. https://<preview>.vercel.app)");
if (!a["store-id"]) fallar("falta --store-id (UUID de la tienda en petShop)");
if (!a.evento) fallar("falta --evento");
if (!secreto) fallar("falta la variable de entorno RAPPI_WEBHOOK_SECRET");

const body = JSON.stringify(cuerpo(a.evento, a));
const t = Math.floor(Date.now() / 1000);
const sign = createHmac("sha256", secreto).update(`${t}.${body}`).digest("hex");
const destino = `${a.url.replace(/\/$/, "")}/api/canales/webhook/rappi?store_id=${encodeURIComponent(a["store-id"])}&evento=${encodeURIComponent(a.evento)}`;

const res = await fetch(destino, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Rappi-Signature": `t=${t},sign=${sign}`,
    ...(a.bypass ? { "x-vercel-protection-bypass": a.bypass } : {}),
  },
  body,
});
const texto = await res.text();
console.log(`${a.evento} → HTTP ${res.status}`);
console.log(texto);
if (a.evento === "NEW_ORDER") console.log(`order_id: ${JSON.parse(body).order_detail.order_id}`);
process.exit(res.ok ? 0 : 2);
