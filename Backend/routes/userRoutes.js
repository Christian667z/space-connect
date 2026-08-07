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
  'id, google_id, email, full_name, avatar_url, phone_number, country_code, auto_sync_enabled, phone_edits_remaining, created_at, updated_at';

const MAX_SLOTS = 3;

/**
 * @route   GET /api/user/profile
 * @desc    Get the authenticated user's own profile with real slot & edit counts.
 * @access  Authenticated (Bearer Google token required)
 */
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const [profileRes, slotsRes] = await Promise.all([
      supabase.from('profiles').select(PUBLIC_PROFILE_COLS).eq('id', userId).single(),
      supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('user_id', userId)
    ]);

    if (profileRes.error) throw profileRes.error;
    if (!profileRes.data) return res.status(404).json({ success: false, message: 'Profil introuvable.' });

    const profile       = profileRes.data;
    const slotsUsed     = slotsRes.count ?? 0;
    // phone_edits_remaining may be null if migration hasn't run yet — default to 2
    const editsRemaining = profile.phone_edits_remaining ?? 2;

    res.json({ success: true, profile, slotsUsed, maxSlots: MAX_SLOTS, editsRemaining });
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

    if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim().replace(/\s+/g, '').length < 4) {
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
      .select('full_name, phone_edits_remaining')
      .eq('id', userId)
      .single();

    const rawName       = fullName || (existingProfile?.full_name) || 'Membre Space';
    const formattedName = formatOgName(rawName);
    const safeCode      = (countryCode || '+509').trim();
    const safePhone     = phoneNumber.trim().replace(/\s+/g, '');

    const currentEdits = existingProfile?.phone_edits_remaining ?? 5;
    const newEditsRemaining = Math.max(0, currentEdits - 1);

    // 1. Update the user's own profile row in Supabase
    const updatePayload = {
      full_name             : formattedName,
      country_code          : safeCode,
      phone_number          : safePhone,
      phone_edits_remaining : newEditsRemaining,
      updated_at            : new Date()
    };

    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId)
      .select(PUBLIC_PROFILE_COLS)
      .single();

    if (profileErr) throw profileErr;

    // 2. Update or insert the community directory entry in contacts table
    const vcfString = `BEGIN:VCARD\nVERSION:3.0\nFN:${formattedName}\nTEL;TYPE=CELL:${safeCode}${safePhone}\nEND:VCARD`;

    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (existingContact) {
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

    const { count: slotsUsed } = await supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    res.json({
      success       : true,
      message       : 'Numéro WhatsApp enregistré avec succès dans Space Connect !',
      profile,
      slotsUsed     : slotsUsed ?? 1,
      maxSlots      : MAX_SLOTS,
      editsRemaining: profile?.phone_edits_remaining ?? newEditsRemaining
    });
  } catch (error) {
    console.error('❌ Error saving phone number:', error.message);
    res.status(500).json({ success: false, message: 'Impossible d\'enregistrer le numéro WhatsApp.' });
  }
});

module.exports = router;
