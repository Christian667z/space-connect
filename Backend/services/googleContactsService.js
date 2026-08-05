/* ==========================================================================
   Space Connect | Google Contacts API (People API v1) Integration Service
   Developed by Asta aka Space aka Kimberly
   ========================================================================== */

const { google } = require('googleapis');
const { oauth2Client } = require('../config/googleAuth');
const supabase = require('../config/supabase');
const { formatOgName } = require('../utils/format');

/**
 * Exchange OAuth authorization code for Access & Refresh Tokens.
 * The redirectUri MUST match the one used when generating the auth URL.
 *
 * @param {string} code         — OAuth authorization code from Google
 * @param {string} redirectUri  — redirect URI used during auth URL generation
 */
async function exchangeCodeForTokens(code, redirectUri) {
  try {
    // Create a fresh client with the exact redirect URI used at auth time.
    // Using a mismatched URI is a common OAuth error (redirect_uri_mismatch).
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri || process.env.GOOGLE_REDIRECT_URI
    );
    const { tokens } = await client.getToken(code);
    return tokens;
  } catch (error) {
    console.error('❌ Error exchanging code for Google tokens:', error.message);
    throw error;
  }
}

/**
 * Fetch Google User Profile Information.
 * Receives raw (plaintext) tokens directly from exchangeCodeForTokens.
 */
async function getGoogleUserProfile(tokens) {
  try {
    const client = new google.auth.OAuth2();
    client.setCredentials(tokens);

    const oauth2   = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    return data;
  } catch (error) {
    console.error('❌ Error fetching Google user profile:', error.message);
    throw error;
  }
}

/**
 * Sync Space Connect Community Contacts to User's Google Account.
 * Receives an already-decrypted refreshToken — decryption happens in the route layer.
 *
 * NOTE: Google People API does not offer a native upsert.  This implementation
 * always calls createContact, which may produce duplicates if run multiple times.
 * A deduplication pass (list → match by phone → skip/update) should be added
 * in a follow-up task.
 */
async function syncContactsToGoogleAccount(userId, refreshToken) {
  try {
    // Build an OAuth client using the provided (plaintext) refresh token
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    client.setCredentials({ refresh_token: refreshToken });

    const peopleService = google.people({ version: 'v1', auth: client });

    // Fetch existing contacts from user's Google Contacts to avoid duplicates
    const existingPhones = new Set();
    try {
      const existingRes = await peopleService.people.connections.list({
        resourceName: 'people/me',
        personFields: 'phoneNumbers,names',
        pageSize: 1000
      });
      const connections = existingRes.data.connections || [];
      connections.forEach(conn => {
        if (conn.phoneNumbers) {
          conn.phoneNumbers.forEach(p => {
            if (p.value) {
              const sanitized = p.value.replace(/\s+/g, '').replace(/[^\d+]/g, '');
              existingPhones.add(sanitized);
            }
          });
        }
      });
    } catch (e) {
      console.warn('⚠️ Could not fetch existing Google Contacts list prior to sync:', e.message);
    }

    // Fetch only the columns needed for sync
    const { data: communityContacts, error } = await supabase
      .from('contacts')
      .select('full_name, phone_number, country_code');

    if (error) throw error;

    let syncedCount = 0;

    for (const contact of communityContacts) {
      try {
        const fullPhone = `${contact.country_code}${contact.phone_number}`.replace(/\s+/g, '').replace(/[^\d+]/g, '');
        if (existingPhones.has(fullPhone)) {
          console.log(`ℹ️ Contact ${contact.full_name} (${fullPhone}) already exists in Google Contacts — skipping.`);
          continue;
        }

        const ogFormattedName = formatOgName(contact.full_name);
        await peopleService.people.createContact({
          requestBody: {
            names: [
              { givenName: ogFormattedName, familyName: 'SpaceConnect' }
            ],
            phoneNumbers: [
              { value: `${contact.country_code} ${contact.phone_number}`, type: 'mobile' }
            ],
            biographies: [
              { value: 'Membre certifié de la communauté Space Connect.' }
            ]
          }
        });
        existingPhones.add(fullPhone);
        syncedCount++;
      } catch (singleErr) {
        console.warn(`⚠️ Skipped contact ${contact.full_name}: ${singleErr.message}`);
      }
    }

    // Log sync status into Supabase
    await supabase.from('sync_logs').insert([{
      user_id       : userId,
      status        : 'SUCCESS',
      contacts_count: syncedCount
    }]);

    return { success: true, contactsSynced: syncedCount };

  } catch (error) {
    console.error(`❌ Google Contacts Auto-Sync failed for user ${userId}:`, error.message);

    await supabase.from('sync_logs').insert([{
      user_id      : userId,
      status       : 'FAILED',
      error_message: error.message
    }]);

    throw error;
  }
}

module.exports = {
  exchangeCodeForTokens,
  getGoogleUserProfile,
  syncContactsToGoogleAccount
};
