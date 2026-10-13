CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE documents ADD COLUMN IF NOT EXISTS manual_allowed_users JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS kb_allowed_users JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS knowledge_base_id UUID;
INSERT INTO schema_migrations(version) VALUES ('0001_p1_document_acl') ON CONFLICT DO NOTHING;
