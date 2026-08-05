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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration: if upgrading from an earlier version of this schema, run:
-- ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS access_token_hash TEXT;

-- 2. Create Contacts Table (Community Members Directory)
CREATE TABLE IF NOT EXISTS public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    country_code TEXT DEFAULT '+509',
    vcf_string TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
CREATE INDEX IF NOT EXISTS idx_contacts_user_id   ON public.contacts(user_id);
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
