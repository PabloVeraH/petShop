import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";

export const DELETE = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id, userId } = ctx;
  const supabase = createServiceClient();

  const { id } = await params;

  const { data: entry, error: fetchErr } = await supabase
    .from("journal_entries")
    .select("id, numero_asiento, total_debito, total_credito, descripcion")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();

  if (fetchErr || !entry) {
    return NextResponse.json({ error: "Asiento no encontrado" }, { status: 404 });
  }

  // Solo se permite eliminar asientos sin movimiento económico ($0/$0).
  // Los asientos con montos válidos no se pueden borrar — deben anularse con un contra-asiento.
  if (Number(entry.total_debito) > 0 || Number(entry.total_credito) > 0) {
    return NextResponse.json(
      { error: "No se puede eliminar un asiento con movimiento económico" },
      { status: 409 }
    );
  }

  // Eliminar journal_detail primero (FK constraint)
  const { error: detailErr } = await supabase
    .from("journal_detail")
    .delete()
    .eq("journal_entry_id", id);

  if (detailErr) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { error: deleteErr } = await supabase
    .from("journal_entries")
    .delete()
    .eq("id", id)
    .eq("store_id", store_id);

  if (deleteErr) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId,
    action: "DELETE",
    entityType: "journal_entry",
    entityId: id,
    oldValues: {
      numero_asiento: entry.numero_asiento,
      total_debito: entry.total_debito,
      total_credito: entry.total_credito,
      descripcion: entry.descripcion,
    },
    changeDescription: `Asiento #${entry.numero_asiento} sin movimiento ($0/$0) eliminado`,
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}, { endpoint: "DELETE /api/contabilidad/asientos/id" });
