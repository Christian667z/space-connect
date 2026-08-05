/* ==========================================================================
   Space Connect | Authentication Routes (Google OAuth2 & Supabase Sync)
   Developed by Asta aka Space aka Kimberly
   ========================================================================== */

const express = require('express');
const router  = express.Router();
const { getGoogleAuthUrl, buildRedirectUri, oauth2Client } = require('../config/googleAuth');
const { exchangeCodeForTokens, getGoogleUserProfile }      = require('../services/googleContactsService');
const supabase                                             = require('../config/supabase');
const { encrypt, decrypt, hmac }                           = require('../utils/crypto');
const { formatOgName }                                     = require('../utils/format');

/**
 * @route   GET /api/auth/google/url
 * @desc    Get Google OAuth2 Login & Consent URL (redirect URI built from request host)
 */
router.get('/google/url', (req, res) => {
  try {
    const redirectUri = buildRedirectUri(req);
    const authUrl     = getGoogleAuthUrl(redirectUri);
    res.json({ success: true, url: authUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Impossible de générer l\'URL OAuth.' });
  }
});

/**
 * @route   GET /api/auth/google/callback
 * @desc    Google OAuth2 Callback Handler
 */
router.get('/google/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    const origin = `${req.protocol}://${req.get('host')}`;
    return res.redirect(`${origin}?error=missing_code`);
  }

  try {
    // Build the same redirect URI used when the auth URL was generated
    const redirectUri = buildRedirectUri(req);

    // 1. Exchange code for OAuth tokens
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // 2. Fetch Google profile info
    const googleProfile = await getGoogleUserProfile(tokens);

    // 3. Encrypt OAuth tokens before storing — never persist plain-text credentials
    const encryptedAccess  = encrypt(tokens.access_token);
    const encryptedRefresh = tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined;
    const accessTokenHash  = hmac(tokens.access_token); // searchable fingerprint

    // 4. Upsert user into Supabase profiles table (preserve existing refresh token if not returned on re-login)
    const profilePayload = {
      google_id            : googleProfile.id,
      email                : googleProfile.email,
      full_name            : formatOgName(googleProfile.name),
      avatar_url           : googleProfile.picture,
      google_access_token  : encryptedAccess,
      access_token_hash    : accessTokenHash,
      token_expires_at     : tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      updated_at           : new Date()
    };
    if (encryptedRefresh) {
      profilePayload.google_refresh_token = encryptedRefresh;
    }

    const { data: userProfile, error } = await supabase
      .from('profiles')
      .upsert(profilePayload, { onConflict: 'email' })
      .select()
      .single();

    if (error) throw error;

    // 5. Redirect to Frontend with session params
    const origin      = `${req.protocol}://${req.get('host')}`;
    const redirectUrl = `${origin}?auth=success&user_id=${userProfile.id}`;
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('❌ Error handling Google Callback:', error.message);
    const origin = `${req.protocol}://${req.get('host')}`;
    res.redirect(`${origin}?error=auth_failed`);
  }
});

/**
 * @route   POST /api/auth/refresh
 * @desc    Mint a new Google access token using the server-stored refresh token.
 *
 * Security: the caller MUST provide their current (even if expired) access token
 * in the Authorization header.  The server looks up the matching user via an HMAC
 * fingerprint of that token — no userId is accepted from the request body.
 *
 * @header  Authorization: Bearer <current_google_access_token>
 */
router.post('/refresh', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      code   : 'TOKEN_MISSING',
      message: 'Bearer token requis dans le header Authorization pour le rafraîchissement.'
    });
  }

  const accessToken = authHeader.slice(7).trim();
  if (!accessToken) {
    return res.status(401).json({ success: false, code: 'TOKEN_MISSING', message: 'Token vide.' });
  }

  // Derive the HMAC fingerprint and look up the matching profile — no UUID from body
  const tokenHash = hmac(accessToken);

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, google_refresh_token')
      .eq('access_token_hash', tokenHash)
      .single();

    if (error || !profile?.google_refresh_token) {
      return res.status(401).json({
        success: false,
        code   : 'NO_REFRESH_TOKEN',
        message: 'Token non reconnu ou session expirée. Reconnexion Google requise.'
      });
    }

    // Decrypt the stored refresh token
    const refreshToken = decrypt(profile.google_refresh_token);
    if (!refreshToken) {
      return res.status(500).json({ success: false, message: 'Erreur de déchiffrement du token.' });
    }

    // Mint a new access token
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();

    if (!credentials?.access_token) {
      throw new Error('Google did not return a new access token.');
    }

    // Persist the refreshed tokens (encrypted)
    await supabase.from('profiles').update({
      google_access_token : encrypt(credentials.access_token),
      access_token_hash   : hmac(credentials.access_token),
      token_expires_at    : credentials.expiry_date ? new Date(credentials.expiry_date) : null,
      updated_at          : new Date()
    }).eq('id', profile.id);

    return res.json({
      success     : true,
      access_token: credentials.access_token,
      expires_at  : credentials.expiry_date || null
    });
  } catch (err) {
    console.error('❌ Token refresh failed:', err.message);
    return res.status(500).json({ success: false, message: 'Échec du rafraîchissement du token.' });
  }
});

module.exports = router;
