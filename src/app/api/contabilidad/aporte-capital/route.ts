import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { crearAsiento, lineasAporteCapital } from "@/lib/contabilidad/generador-asientos";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { AporteCapitalSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id, userId } = ctx;

  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  try {
    requireStoreAdmin(admin, store_id);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = AporteCapitalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { cuentaDestino, monto, descripcion, fecha } = parsed.data;
  const fechaAsiento = fecha ?? new Date().toISOString().split("T")[0];

  const asientoId = await crearAsiento({
    storeId: store_id,
    fecha: fechaAsiento,
    tipoMovimiento: "APORTE_CAPITAL",
    descripcion: descripcion?.trim() || `Aporte de capital a ${cuentaDestino === "caja" ? "Caja" : "Banco"}`,
    lineas: lineasAporteCapital({ cuentaDestino, monto }),
    usuarioId: userId,
  });

  if (!asientoId) {
    return NextResponse.json({ error: "Error al registrar el aporte de capital" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId,
    action: "CREATE",
    entityType: "aporte_capital",
    entityId: asientoId,
    newValues: { cuentaDestino, monto, fecha: fechaAsiento },
    changeDescription: `Aporte de capital registrado: $${monto.toLocaleString("es-CL")} a ${cuentaDestino === "caja" ? "Caja" : "Banco"}`,
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

  return NextResponse.json({ ok: true, asientoId }, { status: 201 });
}
