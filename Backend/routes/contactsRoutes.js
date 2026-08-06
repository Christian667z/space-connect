/* ==========================================================================
   Space Connect | Contacts Directory, VCF Generation & Google Sync Routes
   Developed by Asta aka Space aka Kimberly
   ========================================================================== */

const express = require('express');
const router  = express.Router();
const supabase = require('../config/supabase');
const { syncContactsToGoogleAccount } = require('../services/googleContactsService');
const { requireAuth }                 = require('../middleware/auth');
const { decrypt }                     = require('../utils/crypto');
const { formatOgName }                = require('../utils/format');

/**
 * @route   GET /api/contacts  |  GET /api/contacts/list
 * @desc    Fetch all community directory contacts
 * @access  Authenticated — members only (phone numbers are personal data)
 */
router.get(['/', '/list'], requireAuth, async (req, res) => {
  try {
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('id, user_id, full_name, phone_number, country_code, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success  : true,
      count    : contacts ? contacts.length : 0,
      contacts : contacts || []
    });
  } catch (error) {
    console.error('❌ Contacts fetch error:', error.message);
    res.status(500).json({ success: false, message: 'Impossible de récupérer les contacts.' });
  }
});

/**
 * @route   GET /api/contacts/vcf
 * @desc    Download community contacts as a standard VCF 3.0 file
 * @access  Authenticated — members only
 */
router.get('/vcf', requireAuth, async (req, res) => {
  try {
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('full_name, phone_number, country_code');

    if (error) throw error;

    let vcfContent = '';
    if (contacts && contacts.length > 0) {
      contacts.forEach(c => {
        const name = formatOgName(c.full_name);
        vcfContent += `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${name}\r\nTEL;TYPE=CELL:${c.country_code}${c.phone_number}\r\nEND:VCARD\r\n\r\n`;
      });
    } else {
      vcfContent = `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:OG SpaceConnect Support\r\nTEL;TYPE=CELL:+50935672037\r\nEND:VCARD\r\n\r\n`;
    }

    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="SpaceConnect_Contacts.vcf"');
    res.send(vcfContent);
  } catch (error) {
    console.error('❌ VCF generation error:', error.message);
    res.status(500).json({ success: false, message: 'Impossible de générer le fichier VCF.' });
  }
});

/**
 * @route   POST /api/contacts/sync-google
 * @desc    Sync Space Connect directory to the authenticated user's Google Contacts
 * @access  Authenticated (Bearer Google token required)
 *          userId is derived from the verified token — never from the request body.
 */
router.post('/sync-google', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch the stored (encrypted) Google refresh token for this user
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('google_refresh_token')
      .eq('id', userId)
      .single();

    if (error || !profile || !profile.google_refresh_token) {
      return res.status(401).json({
        success : false,
        message : 'Google Refresh Token manquant. Reconnectez-vous via Google OAuth.'
      });
    }

    // Decrypt the refresh token before passing it to the Google API
    const refreshToken = decrypt(profile.google_refresh_token);
    if (!refreshToken) {
      return res.status(500).json({
        success : false,
        message : 'Erreur de déchiffrement du token. Reconnectez-vous.'
      });
    }

    const result = await syncContactsToGoogleAccount(userId, refreshToken);

    res.json({
      success : true,
      message : `Sync Google Contacts terminé — ${result.contactsSynced} contacts mis à jour.`,
      result
    });
  } catch (error) {
    console.error('❌ Google Contacts Sync API Error:', error.message);
    res.status(500).json({ success: false, message: 'Erreur lors de la synchronisation Google.' });
  }
});

module.exports = router;
