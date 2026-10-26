import { NextRequest, NextResponse } from "next/server";
import { autorizarCanales } from "@/lib/canales/infrastructure/autorizacion";
import { sendEmailAlertsForStore } from "@/lib/email-alerts";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";

// Envío masivo de recordatorios por correo a clientes: solo
// storeAdmin/systemAdmin, y queda en auditoría quién lo disparó y su
// resultado. El cron diario llama a sendEmailAlertsForStore sin pasar por aquí.
export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await autorizarCanales({ soloAdmin: true });
  if (!ctx.ok) return ctx.response;
  const { storeId } = ctx;

  const result = await sendEmailAlertsForStore(storeId);
  await logAudit({
    storeId,
    userId: ctx.userId,
    action: "CREATE",
    entityType: "envio_alertas",
    newValues: { canal: "email", ...result },
    changeDescription: `Envío masivo de alertas por correo: ${result.sent} enviadas, ${result.skipped} omitidas`,
    ...getRequestMetadata(req),
  });
  return NextResponse.json(result);
}, { endpoint: "POST /api/email/send-alerts" });
