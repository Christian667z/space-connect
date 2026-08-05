/* ==========================================================================
   Space Connect | User & WhatsApp Profile Management Routes
   Developed by Asta aka Space aka Kimberly
   ========================================================================== */

const express = require('express');
const router  = express.Router();
const supabase        = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { formatOgName } = require('../utils/format');

// Safe public columns — OAuth tokens are NEVER returned via the API.
const PUBLIC_PROFILE_COLS =
  'id, google_id, email, full_name, avatar_url, phone_number, country_code, auto_sync_enabled, created_at, updated_at';

/**
 * @route   GET /api/user/profile
 * @desc    Get the authenticated user's own profile (userId from verified token)
 * @access  Authenticated (Bearer Google token required)
 */
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select(PUBLIC_PROFILE_COLS)
      .eq('id', req.user.id)   // ← derived from verified token, not user input
      .single();

    if (error) throw error;
    if (!profile) return res.status(404).json({ success: false, message: 'Profil introuvable.' });

    res.json({ success: true, profile });
  } catch (error) {
    console.error('❌ Profile fetch error:', error.message);
    res.status(500).json({ success: false, message: 'Impossible de récupérer le profil.' });
  }
});

/**
 * @route   POST /api/user/phone
 * @desc    Save / update the authenticated user's WhatsApp number
 * @access  Authenticated (Bearer Google token required)
 *          userId is derived from the verified token — never from the request body.
 */
router.post('/phone', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;   // always from verified token
    const { countryCode, phoneNumber, fullName } = req.body;

    if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim().length < 4) {
      return res.status(400).json({
        success: false,
        message: 'phoneNumber est requis (min 4 chiffres).'
      });
    }
    if (countryCode && !/^\+\d{1,4}$/.test(countryCode.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Format d\'indicatif invalide (ex: +509).'
      });
    }

    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .single();

    const rawName       = fullName || (existingProfile?.full_name) || 'Membre Space';
    const formattedName = formatOgName(rawName);
    const safeCode      = (countryCode || '+509').trim();
    const safePhone     = phoneNumber.trim();

    // 1. Update the user's own profile row.
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .update({
        full_name    : formattedName,
        country_code : safeCode,
        phone_number : safePhone,
        updated_at   : new Date()
      })
      .eq('id', userId)
      .select(PUBLIC_PROFILE_COLS)
      .single();

    if (profileErr) throw profileErr;

    // 2. Update the community directory entry.
    //    We use select-then-update-or-insert because the schema may not have a
    //    UNIQUE constraint on contacts.user_id (the DB schema should add one via
    //    the updated schema.sql, but we guard against missing it at the app level).
    const vcfString = `BEGIN:VCARD\nVERSION:3.0\nFN:${formattedName}\nTEL;TYPE=CELL:${safeCode}${safePhone}\nEND:VCARD`;

    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (existingContact) {
      // Row exists — update it.
      const { error: contactErr } = await supabase
        .from('contacts')
        .update({
          full_name    : formattedName,
          phone_number : safePhone,
          country_code : safeCode,
          vcf_string   : vcfString,
          updated_at   : new Date()
        })
        .eq('user_id', userId);
      if (contactErr) throw contactErr;
    } else {
      // No row yet — insert one.
      const { error: contactErr } = await supabase
        .from('contacts')
        .insert({
          user_id      : userId,
          full_name    : formattedName,
          phone_number : safePhone,
          country_code : safeCode,
          vcf_string   : vcfString
        });
      if (contactErr) throw contactErr;
    }

    res.json({
      success : true,
      message : 'Numéro WhatsApp enregistré dans Space Connect !',
      profile
    });
  } catch (error) {
    console.error('❌ Error saving phone number:', error.message);
    res.status(500).json({ success: false, message: 'Impossible d\'enregistrer le numéro WhatsApp.' });
  }
});

module.exports = router;
