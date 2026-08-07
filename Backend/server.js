/* ==========================================================================
   Space Connect | Backend Server API (Express + Supabase + Google Contacts)
   Developed by Asta aka Space aka Kimberly
   ========================================================================== */

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Security & Rate Limiting
let helmet, rateLimit;
try { helmet = require('helmet'); } catch (e) { helmet = null; }
try { rateLimit = require('express-rate-limit'); } catch (e) { rateLimit = null; }

const authRoutes    = require('./routes/authRoutes');
const userRoutes    = require('./routes/userRoutes');
const contactsRoutes = require('./routes/contactsRoutes');

const app  = express();
const PORT = process.env.PORT || 5000;

// Reverse proxy trust (pour Render, Replit, Heroku...)
app.set('trust proxy', 1);

// ── Security Headers ──────────────────────────────────────────────────────────
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false,   // désactivé pour scripts inline & CDN frontend
    crossOriginEmbedderPolicy: false
  }));
}

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (() => {
  const configured = process.env.FRONTEND_URL || '';
  const replit = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}` : '';
  return [configured, replit].filter(Boolean);
})();

app.use(cors({
  origin (origin, cb) {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options(/.*/, cors());

// ── Body Parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── Request Logger ────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ── API Rate Limiter ──────────────────────────────────────────────────────────
if (rateLimit) {
  const apiLimiter = rateLimit({
    windowMs : 15 * 60 * 1000,   // 15 minutes
    max      : 150,
    standardHeaders: true,
    legacyHeaders  : false,
    message : { success: false, message: 'Trop de requêtes. Réessayez dans 15 minutes.' }
  });
  app.use('/api/', apiLimiter);

  const authLimiter = rateLimit({
    windowMs : 60 * 60 * 1000,   // 1 heure
    max      : 30,
    message  : { success: false, message: 'Trop de tentatives d\'authentification.' }
  });
  app.use('/api/auth/', authLimiter);
}

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/user',     userRoutes);
app.use('/api/contacts', contactsRoutes);

// ── Public Stats ──────────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  const supabase = require('./config/supabase');
  try {
    const now        = new Date();
    const todayISO   = now.toISOString().slice(0, 10);
    const weekAgoISO = new Date(now - 7 * 24 * 3600 * 1000).toISOString();

    const [profilesRes, countRes, recentRes, todayRes, weekRes, syncRes] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('contacts').select('country_code, created_at'),
      supabase.from('contacts')
        .select('full_name, country_code')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase.from('contacts')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', `${todayISO}T00:00:00.000Z`),
      supabase.from('contacts')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', weekAgoISO),
      supabase.from('sync_logs')
        .select('contacts_count')
        .eq('status', 'SUCCESS')
    ]);

    const contacts          = countRes.data || [];
    const dbContactsCount   = contacts.length;
    const dbProfilesCount   = profilesRes.count || 0;
    const memberCount       = Math.max(dbProfilesCount, dbContactsCount);

    const countriesCount    = new Set(contacts.map(c => c.country_code).filter(Boolean)).size;
    const countryCodes      = [...new Set(contacts.map(c => c.country_code).filter(Boolean))].slice(0, 4);
    const newToday          = todayRes.count  || 0;
    const newThisWeek       = weekRes.count   || 0;
    const syncedContacts    = (syncRes.data || []).reduce((sum, row) => sum + (row.contacts_count || 0), 0);

    res.json({
      success       : true,
      memberCount,
      countriesCount,
      countryCodes,
      newToday,
      newThisWeek,
      syncedContacts,
      recentMembers : recentRes.data || []
    });
  } catch (err) {
    console.error('❌ Stats error:', err.message);
    res.json({
      success       : true,
      memberCount   : 0,
      countriesCount: 0,
      countryCodes  : [],
      newToday      : 0,
      newThisWeek   : 0,
      syncedContacts: 0,
      recentMembers : []
    });
  }
});

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status   : 'ONLINE',
    service  : 'Space Connect API',
    developer: 'Asta aka Space aka Kimberly',
    supabase : !!process.env.SUPABASE_URL && !process.env.SUPABASE_URL.includes('your-supabase'),
    timestamp: new Date().toISOString()
  });
});

// ── Distribution du Frontend (Fichiers Statiques) ────────────────────────────
const frontendPath = path.resolve(__dirname, '../Frontend');
app.use(express.static(frontendPath));

// Redirection SPA : Toutes les requêtes hors API renvoient sur index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Internal Server Error:', err);
  res.status(500).json({
    success: false,
    message: 'Une erreur serveur inattendue est survenue.',
    error  : process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ── Supabase Config Check ─────────────────────────────────────────────────────
const isSupabaseConfigured = process.env.SUPABASE_URL
  && !process.env.SUPABASE_URL.includes('your-supabase');

// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ================================================================
  🚀 Space Connect Backend API — ONLINE
  ----------------------------------------------------------------
  📡 Port         : http://0.0.0.0:${PORT}
  🌐 Frontend     : Serving from /Frontend
  🔑 Google Key   : ${process.env.GOOGLE_CLIENT_ID ? '✅ Configured' : '⚠️  Missing'}
  💾 Supabase     : ${isSupabaseConfigured ? '✅ Configured' : '⚠️  Credentials not set — contacts API will return empty data'}
  🛡️  Helmet       : ${helmet ? '✅ Active' : '⚠️  Not loaded'}
  🚦 Rate Limit   : ${rateLimit ? '✅ Active (150/15min per IP)' : '⚠️  Not loaded'}
  👨‍💻 Developed by : Asta aka Space aka Kimberly
  ================================================================
  `);
});