import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { decryptJSON } from "@/lib/canales/encryption";
import type { IExternalChannel } from "@/lib/canales/types";

export async function POST(req: NextRequest) {
  const canalId = req.nextUrl.pathname.split("/canales/webhook/")[1]?.split("/")[0];

  if (!canalId) {
    return NextResponse.json({ error: "Canal no especificado" }, { status: 400 });
  }

  const ctx = await getStoreId();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { storeId } = ctx;

  const bodyText = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k] = v;
  });

  try {
    const supabase = createServiceClient();
    const { data: config, error: configError } = await supabase
      .from("canal_config")
      .select("credenciales_encriptada, credenciales_iv, credenciales_auth_tag, credenciales_encriptada")
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
    } else if (canalId === "pedidosya") {
      return NextResponse.json({ error: "Canal no implementado" }, { status: 501 });
    } else if (canalId === "ubereats") {
      return NextResponse.json({ error: "Canal no implementado" }, { status: 501 });
    } else {
      return NextResponse.json({ error: "Canal no soportado" }, { status: 400 });
    }

    const isValid = handler.validateWebhook(headers, bodyText, secret);
    if (!isValid) {
      return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
    }

    const parsed = JSON.parse(bodyText);
    const event = handler.parseWebhookEvent(parsed);

    if (event.type === "ping") {
      return NextResponse.json({ status: "ok", message: "PONG" });
    }

    if (event.type === "order") {
      const orderData = event.data as { order_id: string; items?: { id: string; quantity: number; unit_price: number }[]; total?: number };
      const orderId = orderData.order_id;

      const existing = await supabase
        .from("canal_ordenes")
        .select("id")
        .eq("store_id", storeId)
        .eq("external_order_id", orderId)
        .single();

      if (existing.data) {
        return NextResponse.json({ status: "ok", message: "Orden ya procesada" });
      }

      const { data: newOrden, error: insertError } = await supabase
        .from("canal_ordenes")
        .insert({
          store_id: storeId,
          canal_id: canalId,
          external_order_id: orderId,
          estado: "pending",
          total_externo: orderData.total ?? 0,
          raw_payload: orderData,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        return NextResponse.json({ error: "Error guardando orden" }, { status: 500 });
      }

      return NextResponse.json(
        { status: "ok", orderId: newOrden.id },
        { status: 201 }
      );
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}