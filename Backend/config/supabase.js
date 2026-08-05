/* ==========================================================================
   Space Connect | Supabase Client Configuration
   Developed by Asta aka Space aka Kimberly
   ========================================================================== */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-supabase-project.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'your-key';

if (!process.env.SUPABASE_URL) {
  console.warn('⚠️ SUPABASE_URL parameter missing in .env file. Please configure your credentials.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
