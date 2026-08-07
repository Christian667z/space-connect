/* ==========================================================================
   Space Connect | Server-Side Google Token Verification Middleware
   Verifies the Google access token from the Authorization header and
   derives the authenticated user identity from Supabase — the userId
   is NEVER taken from user-supplied input.
   ========================================================================== */

const supabase = require('../config/supabase');

/**
 * requireAuth middleware
 *
 * Expects:  Authorization: Bearer <google_access_token>
 * Sets:     req.user = { id, email }  on success
 * Rejects:  401 if token is missing, invalid, or the user is unknown
 *
 * Error codes returned in JSON:
 *   TOKEN_EXPIRED  — token was valid but has expired; client should refresh silently
 *   TOKEN_INVALID  — token is malformed, revoked, or issued by a different app
 */
// In-memory token verification cache (TTL: 30 seconds) to prevent Google API rate-limiting
const tokenCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [token, item] of tokenCache.entries()) {
    if (item.expiresAt < now) tokenCache.delete(token);
  }
}, 60 * 1000);

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      code: 'TOKEN_MISSING',
      message: 'Authentification requise — fournissez un Bearer token Google valide.'
    });
  }

  const accessToken = authHeader.slice(7).trim();
  if (!accessToken) {
    return res.status(401).json({ success: false, code: 'TOKEN_MISSING', message: 'Token vide.' });
  }

  // 1. Check in-memory verification cache
  const cached = tokenCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) {
    req.user = cached.user;
    return next();
  }

  try {
    // 2. Verify the token with Google's tokeninfo endpoint.
    const googleRes = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    const tokenInfo = await googleRes.json();

    if (!googleRes.ok || tokenInfo.error || !tokenInfo.email) {
      const isExpired =
        tokenInfo.error === 'invalid_token' ||
        (tokenInfo.error_description || '').toLowerCase().includes('expir');
      return res.status(401).json({
        success: false,
        code: isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
        message: isExpired
          ? 'Token Google expiré. Rafraîchissement requis.'
          : 'Token Google invalide. Reconnectez-vous.'
      });
    }

    // Reject tokens not issued for this application's client ID.
    const EXPECTED_AUD = process.env.GOOGLE_CLIENT_ID ||
      '644577029504-oe8g04ksr5q811mti7cntmmbudst056i.apps.googleusercontent.com';
    const audiences = [tokenInfo.aud, tokenInfo.azp].filter(Boolean);
    if (!audiences.includes(EXPECTED_AUD)) {
      return res.status(401).json({
        success: false,
        code: 'TOKEN_INVALID',
        message: 'Token émis pour une autre application — accès refusé.'
      });
    }

    // 3. Look up or auto-provision the verified email in Supabase
    let { data: profile } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', tokenInfo.email)
      .maybeSingle();

    if (!profile) {
      const { formatOgName } = require('../utils/format');
      const rawName = tokenInfo.name || tokenInfo.email.split('@')[0] || 'Membre Space';
      const profilePayload = {
        email: tokenInfo.email,
        full_name: formatOgName(rawName),
        google_id: tokenInfo.sub,
        updated_at: new Date()
      };
      const { data: newProfile } = await supabase
        .from('profiles')
        .upsert(profilePayload, { onConflict: 'email' })
        .select('id, email')
        .single();

      if (newProfile) profile = newProfile;
    }

    if (!profile) {
      return res.status(401).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: "Impossible de synchroniser le profil utilisateur."
      });
    }

    const authenticatedUser = { id: profile.id, email: profile.email };
    req.user = authenticatedUser;

    // Cache verification result for 30 seconds
    tokenCache.set(accessToken, {
      user: authenticatedUser,
      expiresAt: Date.now() + 30 * 1000
    });

    next();
  } catch (err) {
    console.error('❌ Auth middleware error:', err.message);
    return res.status(500).json({
      success: false,
      code: 'AUTH_ERROR',
      message: 'Erreur de vérification du token.'
    });
  }
}

module.exports = { requireAuth };
