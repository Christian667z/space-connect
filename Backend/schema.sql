-- ==========================================================================
-- Space Connect | Supabase Database Schema
-- Designed & Developed by Asta aka Space aka Kimberly
-- ==========================================================================

-- 1. Create Profiles Table (Users & Google Tokens)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    google_id TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    phone_number TEXT,
    country_code TEXT DEFAULT '+509',
    auto_sync_enabled BOOLEAN DEFAULT TRUE,
    -- OAuth tokens are stored AES-256-GCM encrypted (see Backend/utils/crypto.js)
    google_access_token TEXT,
    google_refresh_token TEXT,
    -- HMAC-SHA256 fingerprint of the access token — used for secure lookup
    -- without decrypting all rows. Not reversible.
    access_token_hash TEXT,
    token_expires_at TIMESTAMPTZ,
    phone_edits_remaining INT DEFAULT 2,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration (run this if the table already exists):
-- ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_edits_remaining INT DEFAULT 2;

-- Migration: if upgrading from an earlier version of this schema, run:
-- ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS access_token_hash TEXT;

-- 2. Create Contacts Table (Community Members Directory)
-- user_id is UNIQUE: each member has at most one directory entry.
-- This constraint is required for the ON CONFLICT (user_id) upsert in the API.
CREATE TABLE IF NOT EXISTS public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    country_code TEXT DEFAULT '+509',
    vcf_string TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration (run this if the table already exists — remove duplicates first,
-- then add the constraint and drop the now-redundant plain index):
-- DELETE FROM public.contacts c1
--   USING public.contacts c2
--   WHERE c1.id > c2.id AND c1.user_id = c2.user_id;
-- ALTER TABLE public.contacts ADD CONSTRAINT contacts_user_id_key UNIQUE (user_id);
-- DROP INDEX IF EXISTS idx_contacts_user_id;

-- 3. Create Sync Logs Table (Tracking Google Contacts Auto-Sync)
CREATE TABLE IF NOT EXISTS public.sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL, -- 'SUCCESS', 'FAILED', 'IN_PROGRESS'
    contacts_count INT DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Profiles
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles
    FOR SELECT USING (true);

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- RLS Policies for Contacts
CREATE POLICY "Directory contacts are viewable by all authenticated users" ON public.contacts
    FOR SELECT USING (true);

CREATE POLICY "Users can insert their own contact" ON public.contacts
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Indexes for maximum performance
-- Note: idx_contacts_user_id is intentionally omitted — the UNIQUE constraint on
-- contacts.user_id already creates an implicit B-tree index covering that column.
CREATE INDEX IF NOT EXISTS idx_profiles_email     ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_google_id ON public.profiles(google_id);
CREATE INDEX IF NOT EXISTS idx_profiles_token_hash ON public.profiles(access_token_hash);

-- Updated_at Trigger Function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================================================
-- Migration Functions
-- These are idempotent PL/pgSQL functions called by `npm run migrate` via
-- supabase.rpc().  Each function is also called directly at the bottom of
-- its corresponding file in Backend/migrations/ for one-shot SQL Editor runs.
-- ==========================================================================

-- Migration 001: enforce one directory entry per member (UNIQUE on user_id)
-- search_path is pinned to prevent search-path hijacking.
-- Execute is revoked from PUBLIC/anon/authenticated — only the DB owner
-- (service role used by the migration runner) can call this function.
CREATE OR REPLACE FUNCTION public.apply_migration_001_contacts_unique()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Remove duplicate user_id rows, keeping the most recently updated one.
  DELETE FROM public.contacts c_old
    USING public.contacts c_keep
    WHERE c_old.user_id  = c_keep.user_id
      AND c_old.id      <> c_keep.id
      AND (
        c_old.updated_at < c_keep.updated_at
        OR (c_old.updated_at = c_keep.updated_at AND c_old.id > c_keep.id)
      );

  -- Add the UNIQUE constraint if it does not already exist.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname   = 'contacts_user_id_key'
       AND conrelid  = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_user_id_key UNIQUE (user_id);
  END IF;

  -- Drop the now-redundant plain index (UNIQUE constraint creates its own).
  DROP INDEX IF EXISTS public.idx_contacts_user_id;

  RETURN 'Migration 001 applied successfully.';
END;
$$;

-- Restrict execute access: revoke from all public roles, grant only to service_role
-- (the role used by the server-side migration runner via the service-role API key).
REVOKE EXECUTE ON FUNCTION public.apply_migration_001_contacts_unique() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_migration_001_contacts_unique() FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_migration_001_contacts_unique() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_migration_001_contacts_unique() TO   service_role;
