-- ==========================================================================
-- Migration 001: Add UNIQUE constraint on contacts.user_id
-- Space Connect | Developed by Asta aka Space aka Kimberly
--
-- HOW TO APPLY (existing databases — run once in Supabase SQL Editor):
--   1. Open your Supabase project → SQL Editor
--   2. Paste and run this entire file
--   3. The function is created and called immediately in a single transaction
--   4. After this, `npm run migrate` can call the function idempotently
--      for any future re-runs or CI pipelines.
--
-- Fresh installs: schema.sql already includes the function definition.
--   Running schema.sql + this file is idempotent.
--
-- Purpose:
--   Each member should have exactly one community directory entry.
--   Enforcing UNIQUE (user_id) at the database level lets the API use
--   an atomic ON CONFLICT (user_id) DO UPDATE upsert, which eliminates
--   the select-then-insert race condition.
-- ==========================================================================

-- Step 1: Create (or replace) the migration function.
--         SECURITY DEFINER runs as the function owner (service role), so it
--         can perform DDL regardless of the caller's privileges.
--         search_path is pinned to prevent search-path hijacking attacks.
CREATE OR REPLACE FUNCTION public.apply_migration_001_contacts_unique()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1a. Remove duplicate user_id rows, keeping the most recently updated one.
  --     If updated_at is equal, keep the row with the smaller (older) UUID.
  DELETE FROM public.contacts c_old
    USING public.contacts c_keep
    WHERE c_old.user_id  = c_keep.user_id
      AND c_old.id      <> c_keep.id
      AND (
        c_old.updated_at < c_keep.updated_at
        OR (c_old.updated_at = c_keep.updated_at AND c_old.id > c_keep.id)
      );

  -- 1b. Add the UNIQUE constraint if it does not already exist.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname   = 'contacts_user_id_key'
       AND conrelid  = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_user_id_key UNIQUE (user_id);
  END IF;

  -- 1c. Drop the now-redundant plain index (UNIQUE constraint creates its own).
  DROP INDEX IF EXISTS public.idx_contacts_user_id;

  RETURN 'Migration 001 applied successfully.';
END;
$$;

-- Step 2: Lock down execute permissions.
--         PostgreSQL grants EXECUTE to PUBLIC by default — revoke that so
--         anonymous and authenticated Supabase API callers cannot invoke
--         this privileged DDL function.  Only the database owner / service
--         role (used by the migration runner) retains execute rights.
REVOKE EXECUTE ON FUNCTION public.apply_migration_001_contacts_unique() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_migration_001_contacts_unique() FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_migration_001_contacts_unique() FROM authenticated;
-- Grant only to service_role — the role used by the server-side migration runner.
GRANT  EXECUTE ON FUNCTION public.apply_migration_001_contacts_unique() TO   service_role;

-- Step 3: Execute the migration immediately so running this file in the
--         Supabase SQL Editor applies the change in one shot.
SELECT public.apply_migration_001_contacts_unique();
