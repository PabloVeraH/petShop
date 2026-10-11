-- ============================================================
-- 029_instagram.sql
-- Tablas para publicaciones programadas en Instagram.
-- Estas tablas existen en producción pero no tenían archivo
-- de migración. Incluidas aquí para consistencia.
-- ============================================================

-- Publicaciones de Instagram por tienda
CREATE TABLE IF NOT EXISTS instagram_posts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  content_type      TEXT        NOT NULL DEFAULT 'image'
                      CHECK (content_type IN ('image', 'video', 'carousel', 'reel')),
  caption           TEXT,
  image_url         TEXT,
  product_tags      JSONB,
  status            TEXT        NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'scheduled', 'published', 'failed', 'cancelled')),
  scheduled_for     TIMESTAMPTZ,
  published_at      TIMESTAMPTZ,
  external_post_id  TEXT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instagram_posts_store    ON instagram_posts(store_id, status);
CREATE INDEX IF NOT EXISTS idx_instagram_posts_scheduled ON instagram_posts(scheduled_for)
  WHERE status = 'scheduled';

ALTER TABLE instagram_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "instagram_posts_store_isolation" ON instagram_posts
  FOR ALL USING (
    store_id = (
      SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()::TEXT
      LIMIT 1
    )
  );

CREATE TRIGGER trg_instagram_posts_updated_at
  BEFORE UPDATE ON instagram_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Medios asociados a cada post (para carruseles)
CREATE TABLE IF NOT EXISTS instagram_post_media (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID    NOT NULL REFERENCES instagram_posts(id) ON DELETE CASCADE,
  media_url  TEXT    NOT NULL,
  media_type TEXT    NOT NULL DEFAULT 'image'
               CHECK (media_type IN ('image', 'video')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_instagram_post_media_post ON instagram_post_media(post_id);

ALTER TABLE instagram_post_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "instagram_post_media_via_post" ON instagram_post_media
  FOR ALL USING (
    post_id IN (
      SELECT id FROM instagram_posts
      WHERE store_id = (
        SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()::TEXT
        LIMIT 1
      )
    )
  );
