import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";
import { recibirEventoWebhook } from "@/lib/canales/application/recibir-evento";
import { procesarOrden } from "@/lib/canales/application/procesar-orden";
import { procesarOutbox } from "@/lib/canales/application/outbox";

// Webhook de canales externos (Fase 2, 2.4–2.5; Fase 3, 3.3). Llamada
// server-to-server sin sesión Clerk: la ruta es pública en el middleware y la
// autenticidad se verifica SOLO con la firma del adaptador (HMAC + anti-replay).
// URL a registrar en la plataforma:
//   /api/canales/webhook/<canal>?store_id=<uuid>&evento=<EVENTO>
// (Rappi registra una URL por evento — el evento viaja en ?evento=).
// El handler es delgado: toda la lógica vive en application/.
export const POST = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ canal: string }> }) => {
  const { canal } = await params;
  const rawBody = await req.text();
  const supabase = createServiceClient();

  const { status, body, procesarOrden: pendiente } = await recibirEventoWebhook({
    supabase,
    canal,
    storeId: req.nextUrl.searchParams.get("store_id"),
    evento: req.nextUrl.searchParams.get("evento"),
    headers: req.headers,
    rawBody,
  });

  // §4.2 paso 5: responder rápido y procesar la orden después (aceptación
  // automática, D5). Si after() no llega a ejecutarse, el cron
  // /api/cron/canales-outbox la retoma.
  if (pendiente) {
    after(async () => {
      try {
        await procesarOrden(supabase, pendiente.storeId, pendiente.ordenId);
        await procesarOutbox(supabase, 5);
      } catch (e) {
        console.error("[canales/webhook] error procesando la orden en after():", e);
      }
    });
  }

  return NextResponse.json(body, { status });
}, { endpoint: "POST /api/canales/webhook/canal" });
