import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, sessionClaims } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
  if (!meta?.systemAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: clerkId } = await params;

  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("clerk_users")
      .delete()
      .eq("clerk_id", clerkId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
