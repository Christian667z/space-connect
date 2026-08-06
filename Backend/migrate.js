#!/usr/bin/env node
/* ==========================================================================
   Space Connect | Database Migration Runner
   Developed by Asta aka Space aka Kimberly

   Mechanism:
     Each migration is a PL/pgSQL function stored in the database.
     This runner calls those functions via supabase.rpc() — the only
     supported way to execute arbitrary SQL through the Supabase JS client.

   First-time setup for an EXISTING database:
     1. Open your Supabase project → SQL Editor
     2. Run the SQL file for each migration in Backend/migrations/ in order
        (e.g. 001_contacts_user_id_unique.sql)
        This creates the migration function AND calls it immediately.
     3. After that, `npm run migrate` re-calls the (idempotent) functions for
        any future CI pipelines or re-deployments — safely repeatable.

   For FRESH databases:
     schema.sql already includes the function definitions — just run
     schema.sql once, then `npm run migrate` handles the rest.

   Usage:
     npm run migrate           — apply all migrations via RPC
     npm run migrate:dry       — list migrations that would run (no DB calls)
   ========================================================================== */

'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

// ---------------------------------------------------------------------------
// 1. Validate credentials
// ---------------------------------------------------------------------------
const isDryRun = process.argv.includes('--dry-run');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Credential check is skipped in dry-run — no database contact is made.
if (!isDryRun) {
  if (!supabaseUrl || supabaseUrl.includes('your-supabase') ||
      !serviceKey  || serviceKey === 'your-key' || !serviceKey) {
    console.error(
      '❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before running migrations.\n' +
      '    Set them as Replit Secrets or in Backend/.env.\n'
    );
    process.exit(1);
  }
}

// In dry-run mode we never touch the database — skip client setup entirely.
const supabase = isDryRun ? null : createClient(supabaseUrl, serviceKey, {
  realtime: { transport: WebSocket }
});

// ---------------------------------------------------------------------------
// 2. Migration registry
//    Each entry maps to the PL/pgSQL function created by the corresponding
//    SQL file in Backend/migrations/.  Functions must be idempotent.
// ---------------------------------------------------------------------------
const MIGRATIONS = [
  {
    id  : '001',
    name: 'contacts_user_id_unique',
    rpc : 'apply_migration_001_contacts_unique',
    file: 'migrations/001_contacts_user_id_unique.sql'
  }
  // Add future migrations here:
  // { id: '002', name: '...', rpc: 'apply_migration_002_...', file: 'migrations/002_....sql' }
];

// ---------------------------------------------------------------------------
// 3. Run migrations
// ---------------------------------------------------------------------------
async function runMigration(m) {
  console.log(`\n▶  [${m.id}] ${m.name}`);

  if (isDryRun) {
    console.log(`    Would call: supabase.rpc('${m.rpc}')`);
    console.log(`    SQL file  : Backend/${m.file}`);
    return;
  }

  const { data, error } = await supabase.rpc(m.rpc);

  if (error) {
    if (error.code === 'PGRST202' || (error.message || '').includes('does not exist')) {
      // The function does not exist in this database yet — the migration SQL
      // has not been run via the Supabase SQL Editor.
      throw new Error(
        `Function '${m.rpc}' not found in the database.\n\n` +
        `    ➜  First-time setup: open Supabase SQL Editor and run:\n` +
        `       Backend/${m.file}\n` +
        `    This creates the function and applies the migration in one step.\n` +
        `    After that, \`npm run migrate\` works for all future re-runs.\n`
      );
    }
    throw new Error(`RPC ${m.rpc} failed: ${error.message}`);
  }

  console.log(`✅  ${data || 'Done.'}`);
}

(async () => {
  console.log('🚀  Space Connect — Database Migration Runner');
  console.log(`    Supabase : ${supabaseUrl}`);
  if (isDryRun) console.log('    Mode     : DRY RUN (no database changes)');
  console.log(`    Pending  : ${MIGRATIONS.length} migration(s)`);

  let failed = 0;
  for (const m of MIGRATIONS) {
    try {
      await runMigration(m);
    } catch (err) {
      console.error(`\n❌  Migration ${m.id} failed:\n    ${err.message}`);
      failed++;
    }
  }

  process.exit(failed > 0 ? 1 : 0);
})();
