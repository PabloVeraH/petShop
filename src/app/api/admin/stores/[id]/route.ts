import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, sessionClaims } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
  if (!meta?.systemAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: storeId } = await params;
  const { name, rut, email, phone, whatsapp_enabled } = await req.json();

  try {
    const supabase = createServiceClient();
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
