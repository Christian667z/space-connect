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

  try {
    // 1. Verify the token with Google's tokeninfo endpoint.
    const googleRes = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    const tokenInfo = await googleRes.json();

    if (!googleRes.ok || tokenInfo.error || !tokenInfo.email) {
      // Distinguish expired tokens from outright invalid ones so the client
      // can silently refresh instead of forcing the user to re-login.
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

    // Only accept tokens backed by a verified Google email address.
    if (tokenInfo.email_verified !== 'true' && tokenInfo.email_verified !== true) {
      return res.status(401).json({
        success: false,
        code: 'TOKEN_INVALID',
        message: 'Email Google non vérifié.'
      });
    }

    // 2. Look up the verified email in Supabase to get our internal user ID.
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', tokenInfo.email)
      .single();

    if (error || !profile) {
      return res.status(401).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: "Utilisateur introuvable. Completez l'inscription via Google OAuth."
      });
    }

    // 3. Attach the verified identity — routes must use req.user, never req.body.userId.
    req.user = { id: profile.id, email: profile.email };
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
