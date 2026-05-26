-- MIGRATION 020: Instagram Channel Tables
-- Seed Instagram in canales_externos and create instagram_posts and instagram_post_media tables

INSERT INTO canales_externos (id, nombre, es_externo, habilitado)
VALUES ('instagram', 'Instagram', true, false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS instagram_posts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  content_type     TEXT NOT NULL CHECK (content_type IN ('post','story','carousel')),
  caption          TEXT,
  image_url        TEXT,
  product_tags     JSONB DEFAULT '[]',
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','failed')),
  scheduled_for    TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  external_post_id TEXT,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS instagram_post_media (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES instagram_posts(id) ON DELETE CASCADE,
  media_url  TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image',
  sort_order INT NOT NULL DEFAULT 0
);

ALTER TABLE instagram_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_post_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "instagram_posts_select_by_store" ON instagram_posts
  FOR SELECT USING (store_id IN (
    SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()::text
  ));

CREATE POLICY "instagram_posts_insert_by_store" ON instagram_posts
  FOR INSERT WITH CHECK (store_id IN (
    SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()::text
  ));

CREATE POLICY "instagram_posts_update_by_store" ON instagram_posts
  FOR UPDATE USING (store_id IN (
    SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()::text
  ));

CREATE POLICY "instagram_posts_delete_by_store" ON instagram_posts
  FOR DELETE USING (store_id IN (
    SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()::text
  ));

CREATE POLICY "instagram_media_select_by_store" ON instagram_post_media
  FOR SELECT USING (post_id IN (
    SELECT id FROM instagram_posts WHERE store_id IN (
      SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()::text
    )
  ));

CREATE POLICY "instagram_media_insert_by_store" ON instagram_post_media
  FOR INSERT WITH CHECK (post_id IN (
    SELECT id FROM instagram_posts WHERE store_id IN (
      SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()::text
    )
  ));

CREATE POLICY "instagram_media_delete_by_store" ON instagram_post_media
  FOR DELETE USING (post_id IN (
    SELECT id FROM instagram_posts WHERE store_id IN (
      SELECT store_id FROM clerk_users WHERE clerk_id = auth.uid()::text
    )
  ));

CREATE INDEX IF NOT EXISTS idx_instagram_posts_store_status ON instagram_posts(store_id, status);
CREATE INDEX IF NOT EXISTS idx_instagram_posts_scheduled ON instagram_posts(scheduled_for) WHERE status = 'scheduled';
