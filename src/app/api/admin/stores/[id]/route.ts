import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus, requireSystemAdmin } from "@/lib/admin-check";
import { AdminStoreUpdateSchema } from "@/lib/validation";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);

  try {
    requireSystemAdmin(admin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: storeId } = await params;
  const body = await req.json();
  const parsed = AdminStoreUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();
    const { name, rut, email, phone, whatsapp_enabled } = parsed.data;

    const { error } = await supabase
      .from("stores")
      .update({
        name: name || undefined,
        rut: rut || undefined,
        email: email || undefined,
        phone: phone || undefined,
        whatsapp_enabled: whatsapp_enabled !== undefined ? whatsapp_enabled : undefined,
      })
      .eq("id", storeId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
