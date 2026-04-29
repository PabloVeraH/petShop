import { createServiceClient } from "./supabase";

interface FoodAlert {
  id: string;
  cliente_id: string;
  mascota_id: string;
  producto_id: string;
  fecha_estimada_termino: string;
  clientes: { nombre: string; email: string | null } | null;
  mascotas: { nombre: string } | null;
  productos: { nombre: string; precio: number } | null;
}

interface SendResult {
  sent: number;
  skipped: number;
  reason?: string;
}

export async function sendEmailAlertsForStore(storeId: string): Promise<SendResult> {
  const supabase = createServiceClient();

  const { data: store } = await supabase
    .from("stores")
    .select("name, email_reminder_enabled, email_reminder_dias_aviso, resend_from_email")
    .eq("id", storeId)
    .single();

  if (!store?.email_reminder_enabled) {
    return { sent: 0, skipped: 0, reason: "disabled" };
  }

  const diasAviso = store.email_reminder_dias_aviso ?? 5;

  const fechaLimite = new Date();
  fechaLimite.setDate(fechaLimite.getDate() + diasAviso);

  const { data: alertas } = await supabase
    .from("consumo_alertas")
    .select(`
      id,
      cliente_id,
      mascota_id,
      producto_id,
      fecha_estimada_termino,
      clientes(nombre, email),
      mascotas(nombre),
      productos(nombre, precio)
    `)
    .eq("store_id", storeId)
    .eq("enviado", false)
    .lte("fecha_estimada_termino", fechaLimite.toISOString().split("T")[0]);

  if (!alertas || alertas.length === 0) {
    return { sent: 0, skipped: 0 };
  }

  const porCliente = new Map<string, FoodAlert[]>();
  for (const alerta of alertas) {
    const grupo = porCliente.get(alerta.cliente_id) ?? [];
    grupo.push(alerta as unknown as FoodAlert);
    porCliente.set(alerta.cliente_id, grupo);
  }

  const hoy = new Date();
  let sent = 0;
  let skipped = 0;

  const { sendFoodReminderEmail } = await import("./email");

  for (const [_clienteId, grupo] of porCliente) {
    const cliente = grupo[0].clientes as { nombre: string; email: string | null } | null;
    if (!cliente?.email) { skipped += grupo.length; continue; }

    const items = grupo.map(a => {
      const mascota = a.mascotas as { nombre: string } | null;
      const producto = a.productos as { nombre: string; precio: number } | null;
      const diasRestantes = Math.ceil(
        (new Date(a.fecha_estimada_termino).getTime() - hoy.getTime()) / 86_400_000
      );
      return {
        mascotaNombre: mascota?.nombre ?? "tu mascota",
        productoNombre: producto?.nombre ?? "el alimento",
        diasRestantes,
        precioUnitario: Number(producto?.precio ?? 0),
      };
    });

    const ok = await sendFoodReminderEmail({
      to: cliente.email,
      clienteNombre: cliente.nombre,
      storeName: store.name,
      storeFromEmail: store.resend_from_email ?? undefined,
      items,
    });

    if (ok) {
      const ids = grupo.map(a => a.id);
      await supabase
        .from("consumo_alertas")
        .update({ enviado: true, updated_at: new Date().toISOString() })
        .in("id", ids);
      sent++;
    } else {
      skipped += grupo.length;
    }
  }

  return { sent, skipped };
}