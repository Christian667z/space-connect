/* ==========================================================================
   Space Connect | Google OAuth2 & People API Client Configuration
   Developed by Asta aka Space aka Kimberly
   ========================================================================== */

const { google } = require('googleapis');

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '644577029504-oe8g04ksr5q811mti7cntmmbudst056i.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
// Fallback redirect URI — overridden at request time by buildRedirectUri()
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI  || 'http://localhost:5000/api/auth/google/callback';

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

// Scopes required for authentication and Google Contacts sync
const SCOPES_LOGIN = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email'
];

const SCOPES_SYNC = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/contacts'
];

/**
 * Build the OAuth callback URI from the current request host.
 * This ensures the redirect URI matches exactly on Replit, local dev,
 * and any other deployment without hardcoding a URL.
 *
 * @param {import('express').Request} req  — the incoming Express request
 * @returns {string}
 */
function buildRedirectUri(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.get('host');
  return `${proto}://${host}/api/auth/google/callback`;
}

/**
 * Generate Google Consent OAuth URL.
 * Pass a per-request redirectUri so the URI always matches the live host.
 *
 * @param {string} [redirectUri]  — override the default redirect URI
 * @param {boolean} [includeSync] — set true to request Google Contacts management scope
 * @returns {string}
 */
function getGoogleAuthUrl(redirectUri, includeSync = false) {
  const params = {
    access_type: 'offline',
    prompt     : 'consent',
    scope      : includeSync ? SCOPES_SYNC : SCOPES_LOGIN
  };
  if (redirectUri) params.redirect_uri = redirectUri;
  return oauth2Client.generateAuthUrl(params);
}

module.exports = {
  oauth2Client,
  getGoogleAuthUrl,
  buildRedirectUri,
  GOOGLE_CLIENT_ID,
  SCOPES_LOGIN,
  SCOPES_SYNC
};

