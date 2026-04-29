import { NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { sendEmailAlertsForStore } from "@/lib/email-alerts";

export async function POST() {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId } = ctx;

  const result = await sendEmailAlertsForStore(storeId);
  return NextResponse.json(result);
}