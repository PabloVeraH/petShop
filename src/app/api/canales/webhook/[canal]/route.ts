import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";
import { recibirEventoWebhook } from "@/lib/canales/application/recibir-evento";

// Webhook de canales externos (Fase 2, 2.4–2.5). Llamada server-to-server sin
// sesión Clerk: la ruta es pública en el middleware y la autenticidad se
// verifica SOLO con la firma del adaptador (HMAC + anti-replay).
// URL a registrar en la plataforma:
//   /api/canales/webhook/<canal>?store_id=<uuid>&evento=<EVENTO>
// (Rappi registra una URL por evento — el evento viaja en ?evento=).
// El handler es delgado: toda la lógica vive en application/recibir-evento.
export const POST = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ canal: string }> }) => {
  const { canal } = await params;
  const rawBody = await req.text();

  const { status, body } = await recibirEventoWebhook({
    supabase: createServiceClient(),
    canal,
    storeId: req.nextUrl.searchParams.get("store_id"),
    evento: req.nextUrl.searchParams.get("evento"),
    headers: req.headers,
    rawBody,
  });

  return NextResponse.json(body, { status });
}, { endpoint: "POST /api/canales/webhook/canal" });
