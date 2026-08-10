import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { decryptJSON } from "@/lib/canales/encryption";
import type { IExternalChannel } from "@/lib/canales/types";
import { withErrorLogging } from "@/lib/audit";

// El webhook llega como llamada server-to-server desde Rappi, sin sesión de usuario.
// La autenticidad se verifica exclusivamente con la firma HMAC del payload.
export const POST = withErrorLogging(async (req: NextRequest) => {
  const canalId = req.nextUrl.pathname.split("/canales/webhook/")[1]?.split("/")[0];

  if (!canalId) {
    return NextResponse.json({ error: "Canal no especificado" }, { status: 400 });
  }

  // storeId puede venir como query param al registrar el webhook:
  // /api/canales/webhook/rappi?store_id=<uuid>
  const storeId = req.nextUrl.searchParams.get("store_id");
  if (!storeId) {
    return NextResponse.json({ error: "store_id requerido" }, { status: 400 });
  }

  const bodyText = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });

  try {
    const supabase = createServiceClient();
    const { data: config, error: configError } = await supabase
      .from("canal_config")
      .select("credenciales_encriptada, credenciales_iv, credenciales_auth_tag")
      .eq("store_id", storeId)
      .eq("canal_id", canalId)
      .eq("activo", true)
      .single();

    if (configError || !config) {
      return NextResponse.json({ error: "Canal no configurado o inactivo" }, { status: 404 });
    }

    const secret =
      (decryptJSON({
        ciphertext: config.credenciales_encriptada,
        iv: config.credenciales_iv,
        authTag: config.credenciales_auth_tag,
      }) as { webhook_secret?: string })?.webhook_secret ?? "";

    let handler: IExternalChannel;

    if (canalId === "rappi") {
      const { RappiChannel } = await import("@/lib/canales/rappi/adapter");
      handler = new RappiChannel();
    } else {
      return NextResponse.json({ error: "Canal no soportado" }, { status: 400 });
    }

    const isValid = handler.validateWebhook(headers, bodyText, secret);
    if (!isValid) {
      return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
    }

    const parsed = JSON.parse(bodyText);
    const event = handler.parseWebhookEvent(parsed);

    // PING — respuesta exacta que exige Rappi o marca la tienda como offline
    if (event.type === "ping") {
      return NextResponse.json({ status: "OK", description: "Tienda prendida" });
    }

    if (event.type === "order") {
      const orden = handler.parseOrder(event.data);
      const orderId = orden.externalOrderId;

      // Idempotencia: ignorar si ya existe
      const { data: existing } = await supabase
        .from("canal_ordenes")
        .select("id")
        .eq("store_id", storeId)
        .eq("external_order_id", orderId)
        .single();

      if (existing) {
        return NextResponse.json({ status: "ok", message: "Orden ya procesada" });
      }

      const aceptarAntesDe = new Date(
        Date.now() + 5 * 60 * 1000 // 5 minutos para Rappi
      ).toISOString();

      const { data: newOrden, error: insertError } = await supabase
        .from("canal_ordenes")
        .insert({
          store_id: storeId,
          canal_id: canalId,
          external_order_id: orderId,
          estado: "pending",
          payload: orden.rawPayload,
          aceptar_antes_de: aceptarAntesDe,
        })
        .select()
        .single();

      if (insertError) {
        console.error("[webhook] Error guardando orden:", insertError.message);
        return NextResponse.json({ error: "Error guardando orden" }, { status: 500 });
      }

      return NextResponse.json({ status: "ok", orderId: newOrden.id }, { status: 201 });
    }

    if (event.type === "cancellation") {
      const data = event.data as { order_id?: string };
      const orderId = String(data.order_id ?? "");
      if (orderId) {
        await supabase
          .from("canal_ordenes")
          .update({ estado: "cancelled", updated_at: new Date().toISOString() })
          .eq("store_id", storeId)
          .eq("external_order_id", orderId);
      }
      return NextResponse.json({ status: "ok" });
    }

    if (event.type === "status_change") {
      const data = event.data as { order_id?: string; event?: string };
      const orderId = String(data.order_id ?? "");
      if (orderId) {
        await supabase
          .from("canal_ordenes")
          .update({ updated_at: new Date().toISOString() })
          .eq("store_id", storeId)
          .eq("external_order_id", orderId);
      }
      return NextResponse.json({ status: "ok" });
    }

    if (event.type === "menu_approved") {
      // El menú fue aprobado por Rappi — canal listo para recibir órdenes
      console.info(`[webhook] Menú aprobado para store ${storeId}`);
      return NextResponse.json({ status: "ok" });
    }

    if (event.type === "menu_rejected") {
      // El menú fue rechazado — notificar al operador (TODO: alerta)
      console.warn(`[webhook] Menú rechazado para store ${storeId}`);
      return NextResponse.json({ status: "ok" });
    }

    if (event.type === "store_connectivity") {
      const data = event.data as { enabled?: boolean; message?: string };
      console.info(`[webhook] Store connectivity store=${storeId} enabled=${data.enabled}: ${data.message}`);
      return NextResponse.json({ status: "ok" });
    }

    // tracking, other — acusar recibo
    return NextResponse.json({ status: "ok" });

  } catch (error) {
    console.error("[webhook] Error interno:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}, { endpoint: "POST /api/canales/webhook/canal" });
