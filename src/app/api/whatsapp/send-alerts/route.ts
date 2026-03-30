import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { sendWhatsAppText, buildConsumoAlertMessage } from "@/lib/whatsapp";

// POST /api/whatsapp/send-alerts
// Finds pending consumo alerts, sends WhatsApp notifications, marks as sent.
// Call from cron or manually from the settings page.
export async function POST() {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId } = ctx;

  const supabase = createServiceClient();

  // Find alerts due within dias_aviso days, not yet sent
  const today = new Date().toISOString().split("T")[0];
  const { data: alertas } = await supabase
    .from("consumo_alertas")
    .select(`
      id,
      dias_aviso,
      fecha_estimada_termino,
      mascota_id,
      producto_id,
      cliente_id,
      clientes(nombre, telefono),
      mascotas(nombre),
      productos(nombre)
    `)
    .eq("store_id", storeId)
    .eq("enviado", false)
    .lte("fecha_estimada_termino", (() => {
      const d = new Date();
      d.setDate(d.getDate() + 14); // look ahead 14 days max
      return d.toISOString().split("T")[0];
    })());

  if (!alertas || alertas.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0 });
  }

  let sent = 0;
  let skipped = 0;

  for (const alerta of alertas) {
    const cliente = alerta.clientes as unknown as { nombre: string; telefono: string | null } | null;
    const mascota = alerta.mascotas as unknown as { nombre: string } | null;
    const producto = alerta.productos as unknown as { nombre: string } | null;

    if (!cliente?.telefono) {
      skipped++;
      continue;
    }

    // Check if alert is within days window
    const diasRestantes = Math.ceil(
      (new Date(alerta.fecha_estimada_termino).getTime() - new Date(today).getTime()) / 86_400_000
    );

    if (diasRestantes > alerta.dias_aviso) {
      skipped++;
      continue;
    }

    // Get store WhatsApp config
    const { data: store } = await supabase
      .from("stores")
      .select("name, whatsapp_enabled, whatsapp_phone_number_id, whatsapp_access_token")
      .eq("id", storeId)
      .single();

    if (!store?.whatsapp_enabled || !store.whatsapp_phone_number_id || !store.whatsapp_access_token) {
      skipped++;
      continue;
    }

    const msg = buildConsumoAlertMessage({
      storeName: store.name,
      clienteNombre: cliente.nombre,
      mascotaNombre: mascota?.nombre ?? "tu mascota",
      productoNombre: producto?.nombre ?? "el producto",
      diasRestantes,
    });

    const ok = await sendWhatsAppText(
      { phoneNumberId: store.whatsapp_phone_number_id, accessToken: store.whatsapp_access_token },
      cliente.telefono,
      msg
    );

    if (ok) {
      await supabase
        .from("consumo_alertas")
        .update({ enviado: true, updated_at: new Date().toISOString() })
        .eq("id", alerta.id);
      sent++;
    } else {
      skipped++;
    }
  }

  return NextResponse.json({ sent, skipped });
}
