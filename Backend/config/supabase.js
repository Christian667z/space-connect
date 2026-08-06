/* ==========================================================================
   Space Connect | Supabase Client Configuration
   Developed by Asta aka Space aka Kimberly
   ========================================================================== */

const { createClient } = require('@supabase/supabase-js');
// Node 20 lacks native WebSocket — polyfill with the `ws` package.
const WebSocket = require('ws');

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-supabase-project.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'your-key';

if (!process.env.SUPABASE_URL) {
  console.warn('⚠️ SUPABASE_URL parameter missing in .env file. Please configure your credentials.');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { transport: WebSocket }   // ws constructor passed directly — required on Node 20 which lacks native WebSocket
});

module.exports = supabase;
