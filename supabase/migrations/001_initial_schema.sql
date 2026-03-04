-- Kue Platform Multi-Tenant Auth Schema

-- ============================================================
-- 0. ENUM TYPES
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.source_connection_source AS ENUM (
    'google_contacts',
    'gmail',
    'google_calendar',
    'linkedin',
    'twitter',
    'csv_import'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.source_connection_status AS ENUM (
    'active',
    'revoked',
    'error'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 1. TENANTS (Org/Workspace)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenants (
  tenant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. TENANT USERS (membership)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_users (
  tenant_id TEXT NOT NULL REFERENCES public.tenants(tenant_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_users_user_id ON public.tenant_users(user_id);

-- ============================================================
-- 3. SOURCE CONNECTIONS (OAuth tokens per user/source)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.source_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source public.source_connection_source NOT NULL,
  external_account_id TEXT NOT NULL,
  token_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status public.source_connection_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_source_connections_tenant_user
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES public.tenant_users(tenant_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_source_connections_identity
    UNIQUE (tenant_id, user_id, source, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_source_connections_tenant_user
  ON public.source_connections(tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_source_connections_status
  ON public.source_connections(status);

-- ============================================================
-- 4. SYNC CHECKPOINTS (cursor state)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sync_checkpoints (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source public.source_connection_source NOT NULL,
  cursor_value TEXT,
  cursor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id, source),
  CONSTRAINT fk_sync_checkpoints_tenant_user
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES public.tenant_users(tenant_id, user_id)
    ON DELETE CASCADE
);

-- ============================================================
-- 5. UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenants_updated_at ON public.tenants;
CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS tenant_users_updated_at ON public.tenant_users;
CREATE TRIGGER tenant_users_updated_at
  BEFORE UPDATE ON public.tenant_users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS source_connections_updated_at ON public.source_connections;
CREATE TRIGGER source_connections_updated_at
  BEFORE UPDATE ON public.source_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS sync_checkpoints_updated_at ON public.sync_checkpoints;
CREATE TRIGGER sync_checkpoints_updated_at
  BEFORE UPDATE ON public.sync_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 6. RLS POLICIES
-- ============================================================
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_checkpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_select ON public.tenants;
CREATE POLICY tenants_select ON public.tenants
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_users tu
      WHERE tu.tenant_id = tenants.tenant_id
        AND tu.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS tenant_users_all ON public.tenant_users;
CREATE POLICY tenant_users_all ON public.tenant_users
  FOR ALL USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS source_connections_all ON public.source_connections;
CREATE POLICY source_connections_all ON public.source_connections
  FOR ALL USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS sync_checkpoints_all ON public.sync_checkpoints;
CREATE POLICY sync_checkpoints_all ON public.sync_checkpoints
  FOR ALL USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);
