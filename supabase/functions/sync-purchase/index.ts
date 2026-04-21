// Deno Edge Function — se ejecuta en el runtime de Supabase
// Disparada por Database Webhook en tabla `ventas` (INSERT)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();
    const { type, record } = payload;

    // Solo procesar INSERTs de ventas
    if (type !== "INSERT" || !record) {
      return new Response(JSON.stringify({ ok: true, skipped: type }), { status: 200 });
    }

    // Solo sincronizar ventas que tienen cliente asociado
    if (!record.cliente_id) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_cliente" }), { status: 200 });
    }

    const HUB_URL = Deno.env.get("HUB_URL");
    const HUB_SYNC_SECRET = Deno.env.get("HUB_SYNC_SECRET");
    const STORE_ID = Deno.env.get("STORE_ID");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!HUB_URL || !HUB_SYNC_SECRET || !STORE_ID || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("[sync-purchase] Missing env vars");
      return new Response(JSON.stringify({ error: "missing_env" }), { status: 500 });
    }

    // Buscar RUT del cliente
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: cliente } = await supabase
      .from("clientes")
      .select("rut")
      .eq("id", record.cliente_id)
      .single();

    if (!cliente?.rut) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_rut" }), { status: 200 });
    }

    const response = await fetch(`${HUB_URL}/api/sync/purchase`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${HUB_SYNC_SECRET}`,
      },
      body: JSON.stringify({
        store_id: STORE_ID,
        rut: cliente.rut,
        monto: Number(record.total ?? 0),
        fecha: record.created_at?.split("T")[0] ?? new Date().toISOString().split("T")[0],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[sync-purchase] Hub error:", response.status, text);
      return new Response(JSON.stringify({ error: "hub_error", status: response.status }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });

  } catch (err) {
    console.error("[sync-purchase] Unexpected error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
