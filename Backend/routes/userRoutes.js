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
      .select('full_name, phone_edits_remaining')
      .eq('id', userId)
      .single();

    // Guard: block save if no edits remaining (null means migration not run → allow)
    const currentEdits = existingProfile?.phone_edits_remaining;
    if (currentEdits !== null && currentEdits !== undefined && currentEdits <= 0) {
      return res.status(403).json({
        success: false,
        message: 'Vous avez atteint la limite de modifications (2/2). Contactez le support pour plus d\'options.'
      });
    }

    const rawName       = fullName || (existingProfile?.full_name) || 'Membre Space';
    const formattedName = formatOgName(rawName);
    const safeCode      = (countryCode || '+509').trim();
    const safePhone     = phoneNumber.trim();

    // Compute new edits remaining (decrement, floor at 0, skip if column not yet migrated)
    const newEditsRemaining = currentEdits !== null && currentEdits !== undefined
      ? Math.max(0, currentEdits - 1)
      : undefined;

    // 1. Update the user's own profile row.
    const updatePayload = {
      full_name    : formattedName,
      country_code : safeCode,
      phone_number : safePhone,
      updated_at   : new Date()
    };
    if (newEditsRemaining !== undefined) {
      updatePayload.phone_edits_remaining = newEditsRemaining;
    }

    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .update(updatePayload)
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

    // Count slots used after the save
    const { count: slotsUsed } = await supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    res.json({
      success       : true,
      message       : 'Numéro WhatsApp enregistré dans Space Connect !',
      profile,
      slotsUsed     : slotsUsed ?? 1,
      maxSlots      : MAX_SLOTS,
      editsRemaining: profile?.phone_edits_remaining ?? newEditsRemaining ?? 2
    });
  } catch (error) {
    console.error('❌ Error saving phone number:', error.message);
    res.status(500).json({ success: false, message: 'Impossible d\'enregistrer le numéro WhatsApp.' });
  }
});


/**
 * @route   DELETE /api/user/phone
 * @desc    Remove the user's phone number from profile and contacts directory
 * @access  Authenticated (Bearer Google token required)
 */
router.delete('/phone', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Clear phone fields from profile AND reset edit allowance.
    //    Deletion is not an edit — resetting allows the member to restore
    //    their number later without consuming a quota slot.
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({
        phone_number         : null,
        country_code         : null,
        phone_edits_remaining: 2,     // restore full edit quota on deletion
        updated_at           : new Date()
      })
      .eq('id', userId);
    if (profileErr) throw profileErr;

    // 2. Remove contact entry from community directory
    const { error: contactErr } = await supabase
      .from('contacts')
      .delete()
      .eq('user_id', userId);
    if (contactErr) throw contactErr;

    return res.json({ success: true, message: 'Numéro supprimé avec succès. Vous pouvez en ajouter un nouveau.' });
  } catch (error) {
    console.error('❌ Phone delete error:', error.message);
    return res.status(500).json({ success: false, message: 'Impossible de supprimer le numéro.' });
  }
});

/**
 * @route   POST /api/user/sync-preference
 * @desc    Persist the user's auto-sync toggle preference.
 * @access  Authenticated (Bearer Google token required)
 */
router.post('/sync-preference', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { autoSyncEnabled } = req.body;
    if (typeof autoSyncEnabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'autoSyncEnabled (boolean) requis.' });
    }

    const { error } = await supabase
      .from('profiles')
      .update({ auto_sync_enabled: autoSyncEnabled, updated_at: new Date() })
      .eq('id', userId);

    if (error) throw error;
    return res.json({ success: true, autoSyncEnabled });
  } catch (error) {
    console.error('❌ Sync preference error:', error.message);
    return res.status(500).json({ success: false, message: 'Impossible de sauvegarder la préférence.' });
  }
});

module.exports = router;
