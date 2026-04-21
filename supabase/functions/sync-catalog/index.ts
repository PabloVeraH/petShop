// Deno Edge Function — se ejecuta en el runtime de Supabase
// Disparada por Database Webhook en tabla `productos` (INSERT, UPDATE, DELETE)

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();

    // Database Webhook payload:
    // { type: "INSERT"|"UPDATE"|"DELETE", table: "productos", record: {...}, old_record: {...} }
    const { type, record, old_record } = payload;

    // En DELETE físico, record es null y old_record tiene los datos
    const row = record ?? old_record;
    if (!row) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_row" }), { status: 200 });
    }

    const HUB_URL = Deno.env.get("HUB_URL");
    const HUB_SYNC_SECRET = Deno.env.get("HUB_SYNC_SECRET");
    const STORE_ID = Deno.env.get("STORE_ID");

    if (!HUB_URL || !HUB_SYNC_SECRET || !STORE_ID) {
      console.error("[sync-catalog] Missing env vars");
      return new Response(JSON.stringify({ error: "missing_env" }), { status: 500 });
    }

    // DELETE físico o soft-delete (activo=false) → marcar inactivo en el hub
    const activo = type === "DELETE" ? false : (row.activo ?? true);

    const response = await fetch(`${HUB_URL}/api/sync/catalog`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${HUB_SYNC_SECRET}`,
      },
      body: JSON.stringify({
        store_id: STORE_ID,
        productos: [{
          producto_id: row.id,
          nombre_producto: row.nombre,
          marca: row.marca ?? null,
          categoria: null,
          codigo_barra: row.codigo_barra ?? null,
          precio: Number(row.precio),
          stock: Number(row.stock ?? 0),
          imagen_url: null,
          activo,
        }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[sync-catalog] Hub error:", response.status, text);
      return new Response(JSON.stringify({ error: "hub_error", status: response.status }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });

  } catch (err) {
    console.error("[sync-catalog] Unexpected error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
