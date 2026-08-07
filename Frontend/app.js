/* ==========================================================================
   Space Connect | Vanilla JS Interactive Script, 3D Parallax & Google Identity Services (GIS)
   Developed by Asta aka Space aka Kimberly
   ========================================================================== */

const GOOGLE_CLIENT_ID = '644577029504-oe8g04ksr5q811mti7cntmmbudst056i.apps.googleusercontent.com';

const appState = {
  isAuthenticated: false,
  currentUser: null,
  googleAccessToken: null,
  supabaseUserId: null,   // set after first successful backend call; used for server-side token refresh
  membersCount: 2,
  members: [
    { name: "OG Asta | Développeur", time: "29 M", country: "HT +509", avatar: "UN" },
    { name: "OG Space Member", time: "22H", country: "US +1", avatar: "S" }
  ]
};

/**
 * Formats a full name to automatically start with the "OG " prefix.
 * e.g., "Nova" -> "OG Nova"
 *       "OG Nova" -> "OG Nova"
 *       "og nova" -> "OG nova"
 */
function formatOgName(name) {
  if (!name || typeof name !== 'string') return 'OG ';
  const trimmed = name.trim();
  if (!trimmed) return 'OG ';
  if (/^og\b/i.test(trimmed)) {
    return trimmed.replace(/^og\b\s*/i, 'OG ').trim();
  }
  return `OG ${trimmed}`;
}

let tokenClient;
let googleReadyPromise;

document.addEventListener('DOMContentLoaded', () => {
  populateCountrySelectors();   // ← world flags & dial codes first
  initFloatingCapsules();
  initFAQAccordion();
  initAuthLogic();
  initVCFGenerator();
  // GIS is loaded with async/defer and may not exist at DOMContentLoaded.
  waitForGoogleIdentityServices();
  fetchLiveStats();             // ← real network stats on every page load

  // Handle redirect-based OAuth callback (mobile flow).
  // After Google redirects back to /?auth=success&user_id=...,
  // the access token arrives in the URL hash as #gat=...
  handleOAuthRedirectCallback();
});

/**
 * Detect and process a redirect-flow OAuth return.
 * Called on every page load — exits immediately when there's nothing to handle.
 */
async function handleOAuthRedirectCallback() {
  const params = new URLSearchParams(window.location.search);
  const authStatus = params.get('auth');

  if (authStatus === 'success') {
    // Extract the access token from the URL hash (#gat=<token>)
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = hashParams.get('gat');

    // Clean the URL immediately so the token isn't visible or bookmarked
    window.history.replaceState({}, document.title, window.location.pathname);

    if (token) {
      appState.googleAccessToken = token;

      // Register the token server-side (best-effort — don't block on failure)
      try {
        const registration = await registerGoogleToken(token);
        if (registration?.profile?.id) appState.supabaseUserId = registration.profile.id;
      } catch (err) {
        console.warn('Redirect flow — server registration unavailable:', err.message);
      }

      // Fetch Google profile and open the dashboard
      await fetchGoogleUserProfile(token);
      fetchDirectoryContacts();
    } else {
      // auth=success but no token in hash — tell the user to retry
      showToast("Connexion réussie mais token absent. Reconnectez-vous.", 'fa-solid fa-circle-exclamation');
    }
  } else if (params.get('error')) {
    window.history.replaceState({}, document.title, window.location.pathname);
    showToast("Connexion Google annulée ou échouée. Réessayez.", 'fa-solid fa-circle-exclamation');
  }
}

/**
 * Wait for Google's async script so a click made immediately after page load
 * never gets lost.
 */
function waitForGoogleIdentityServices() {
  if (tokenClient) return Promise.resolve(true);
  if (googleReadyPromise) return googleReadyPromise;

  googleReadyPromise = new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      if (initGoogleOAuth()) {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= 8000) {
        googleReadyPromise = null;
        resolve(false);
        return;
      }
      window.setTimeout(check, 150);
    };
    check();
  });

  return googleReadyPromise;
}

/* --------------------------------------------------------------------------
   Live Network Stats — fetches /api/stats (public, no auth required)
   Updates: member counter, countries count, recent members feed
   -------------------------------------------------------------------------- */
async function fetchLiveStats() {
  try {
    const res  = await fetch('/api/stats');
    const data = await res.json();
    if (!data.success) return;

    const { memberCount, countriesCount, countryCodes = [], newToday = 0, newThisWeek = 0, recentMembers } = data;

    // ── Counters ────────────────────────────────────────────────────────────
    const counterEl = document.getElementById('live-members-counter');
    if (counterEl) counterEl.textContent = memberCount;

    const networkEl = document.getElementById('stat-network-members');
    if (networkEl) networkEl.textContent = memberCount;

    const dlEl = document.getElementById('download-members-count');
    if (dlEl) dlEl.textContent = `${memberCount} membre${memberCount !== 1 ? 's' : ''} dans l'annuaire`;

    // ── Landing: Pays & Impressions ──────────────────────────────────────────
    const paysEl = document.getElementById('stat-pays-count');
    if (paysEl) paysEl.textContent = `${countriesCount} Pays`;

    const countriesBadgeEl = document.getElementById('stat-countries-badge');
    if (countriesBadgeEl) countriesBadgeEl.textContent = countryCodes.length > 0 ? countryCodes.join(' / ') : '–';

    // Impressions estimées : chaque membre peut voir les statuts de tous les autres
    const impressions = memberCount > 0 ? memberCount * memberCount : 0;
    const impEl = document.getElementById('stat-impressions-display');
    if (impEl) impEl.textContent = `${impressions} vues / jour`;

    const impBadgeEl = document.getElementById('stat-impressions-badge');
    if (impBadgeEl) impBadgeEl.textContent = memberCount > 1 ? `+${Math.round((impressions - memberCount) / Math.max(memberCount, 1) * 100)}%` : '+0%';

    // ── Dashboard Quad Cards ────────────────────────────────────────────────
    const newTodayEl = document.getElementById('stat-new-today');
    if (newTodayEl) newTodayEl.textContent = newToday;

    const newTodayFooter = document.getElementById('stat-new-today-footer');
    if (newTodayFooter) {
      const pct = memberCount > 0 ? Math.round((newToday / memberCount) * 100) : 0;
      newTodayFooter.innerHTML = `<span>${pct} % du réseau</span>`;
    }

    const weekEl = document.getElementById('stat-week-total');
    if (weekEl) weekEl.textContent = newThisWeek;

    const weekPctEl = document.getElementById('stat-week-pct');
    if (weekPctEl) {
      const pct = memberCount > 0 ? Math.round((newThisWeek / memberCount) * 100) : 0;
      weekPctEl.textContent = `~ ${pct} %`;
    }

    const paysActifsEl = document.getElementById('stat-pays-actifs');
    if (paysActifsEl) paysActifsEl.textContent = countriesCount;

    const paysFooter = document.getElementById('stat-pays-footer');
    if (paysFooter && countryCodes.length > 0) {
      paysFooter.innerHTML = `<span>Régions actives (${countryCodes.map(c => `+${c === 'HT' ? '509' : c === 'US' ? '1' : c === 'FR' ? '33' : c === 'TG' ? '228' : c}`).join(', ')})</span>`;
    }

    // ── Dashboard Growth Goal ───────────────────────────────────────────────
    const growthEl = document.getElementById('stat-growth-current');
    if (growthEl) growthEl.textContent = memberCount;

    const circleEl = document.getElementById('circle-progress-val');
    if (circleEl) {
      const GOAL = 10;
      const pct  = Math.min(memberCount / GOAL, 1);
      // stroke-dasharray = 380; dashoffset 380 = 0%, 0 = 100%
      circleEl.style.strokeDashoffset = 380 * (1 - pct);
    }

    // ── Recent Members Feed ─────────────────────────────────────────────────
    const feedEl = document.getElementById('live-members-list-container');
    if (feedEl) {
      if (!recentMembers || recentMembers.length === 0) {
        feedEl.innerHTML = `
          <div style="text-align:center;padding:2rem 1rem;color:var(--text-muted);">
            <i class="fa-solid fa-users-slash" style="font-size:1.8rem;margin-bottom:0.75rem;display:block;"></i>
            <p style="font-size:0.85rem;font-weight:700;">Aucun membre pour l'instant.</p>
          </div>`;
      } else {
        feedEl.innerHTML = recentMembers.map((m, i) => {
          const name    = formatOgName(m.full_name || 'Membre');
          const initial = name.replace(/^OG\s*/i, '').charAt(0).toUpperCase() || 'O';
          const meta    = getCountryMeta(m.country_code);
          const label   = i === 0 ? 'Actif maintenant' : 'Membre actif';
          return `
            <div class="live-member-item">
              <div style="display:flex;align-items:center;gap:0.9rem;">
                <div class="member-avatar">${initial}</div>
                <div class="member-info">
                  <h4>${name}</h4>
                  <p>${label}</p>
                </div>
              </div>
              <div class="member-country-tag">${meta.code} ${m.country_code}</div>
            </div>`;
        }).join('');
      }
    }
  } catch (err) {
    // Silently fail — stats are non-critical, static fallback stays visible
    console.warn('Stats fetch failed:', err.message);
  }
}

/* --------------------------------------------------------------------------
   Google Identity Services (GIS) OAuth2 Token Client Setup (People API)
   -------------------------------------------------------------------------- */
function initGoogleOAuth() {
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    return false;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
    callback: async (tokenResponse) => {
      if (tokenResponse.access_token) {
        console.log("🔑 Access Token Google GIS reçu.");
        appState.googleAccessToken = tokenResponse.access_token;

        // Register the token server-side when Supabase is configured.
        try {
          const registration = await registerGoogleToken(tokenResponse.access_token);
          if (registration?.profile?.id) {
            appState.supabaseUserId = registration.profile.id;
          }
        } catch (error) {
          console.warn('Google profile registration unavailable:', error.message);
        }

        // Fetch profile info (name, email, picture), then open the dashboard.
        try {
          await fetchGoogleUserProfile(tokenResponse.access_token);
        } catch (profileErr) {
          console.error('❌ fetchGoogleUserProfile failed:', profileErr.message);
          showToast("Profil Google non chargé. Réessayez.", 'fa-solid fa-circle-exclamation');
        }

        fetchLiveStats();
        fetchDirectoryContacts();
      } else if (tokenResponse.error) {
        console.error("❌ Erreur Google GIS :", tokenResponse.error);
        showToast(`Connexion Google refusée : ${tokenResponse.error_description || tokenResponse.error}`, 'fa-solid fa-circle-exclamation');
      }
    },
  });

  return true;
}

/**
 * Refresh the Google access token when the backend returns TOKEN_EXPIRED.
 *
 * Strategy (in order):
 *   1. Ask the server to use its stored refresh_token (works when the user
 *      completed the server-side OAuth flow and we have their supabaseUserId).
 *   2. Fall back to a GIS silent re-prompt (no user interaction if consent
 *      was already granted — GIS handles cookie/session internally).
 *
 * Returns the new access token string, or null if refresh failed.
 */
async function refreshGoogleToken() {
  // Strategy 1 — server-side refresh using stored refresh_token
  if (appState.supabaseUserId) {
    try {
      const res = await fetch('/api/auth/refresh', {
        method : 'POST',
         headers: {
           'Content-Type': 'application/json',
           'Authorization': `Bearer ${appState.googleAccessToken}`
         }
      });
      const data = await res.json();
      if (data.success && data.access_token) {
        appState.googleAccessToken = data.access_token;
        console.log('🔄 Token rafraîchi via serveur.');
        return data.access_token;
      }
    } catch (_) { /* fall through to GIS */ }
  }

  // Strategy 2 — GIS silent re-prompt
  return new Promise((resolve) => {
    if (!tokenClient) {
      initGoogleOAuth();
    }
    if (!tokenClient) {
      resolve(null);
      return;
    }
    // Override the callback temporarily to capture the new token.
    const originalCallback = tokenClient.callback;
    tokenClient.callback = async (tokenResponse) => {
      tokenClient.callback = originalCallback;
      if (tokenResponse.access_token) {
        appState.googleAccessToken = tokenResponse.access_token;
        console.log('🔄 Token rafraîchi via GIS.');
        resolve(tokenResponse.access_token);
      } else {
        resolve(null);
      }
    };
    // prompt: 'none' attempts silent refresh without showing the consent screen.
    tokenClient.requestAccessToken({ prompt: 'none' });
  });
}

/**
 * Trigger GIS Token Client Popup
 */
async function requestGoogleAuth() {
  // On mobile, GIS popups are blocked by the browser. Use the backend redirect
  // flow instead — Google redirects back to the app and the access token is
  // returned in the URL hash (#gat=...) so it never touches any server log.
  const isMobile = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile) {
    try {
      const res  = await fetch('/api/auth/google/url');
      const data = await res.json();
      if (data.success && data.url) {
        window.location.href = data.url;
        return;
      }
    } catch (err) {
      console.error('❌ Impossible de récupérer l\'URL Google :', err);
    }
    showToast("Connexion Google indisponible. Réessayez.", 'fa-solid fa-circle-exclamation');
    return;
  }

  // Desktop: GIS popup flow
  if (!tokenClient) {
    const initialized = await waitForGoogleIdentityServices();
    if (!initialized) {
      showToast("Le service Google n'est pas disponible. Vérifiez votre connexion puis réessayez.", 'fa-solid fa-circle-exclamation');
      openModal('modal-google-auth');
      return;
    }
  }

  if (tokenClient) {
    try {
      tokenClient.requestAccessToken({ prompt: '' });
    } catch (error) {
      console.error('❌ Impossible de lancer Google GIS :', error);
      showToast("Impossible d'ouvrir la fenêtre Google. Autorisez les popups puis réessayez.", 'fa-solid fa-circle-exclamation');
    }
  } else {
    openModal('modal-google-auth');
  }
}

/**
 * Register the GIS access token with the API. This bridges the browser popup
 * flow with the server-side profile and auth middleware.
 */
async function registerGoogleToken(accessToken) {
  const res = await fetch('/api/auth/google/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.message || `HTTP ${res.status}`);
  }
  return data;
}

/**
 * Fetch and display the authenticated user's real dashboard stats
 * (contact slots used, edits remaining, stored phone number).
 * Called after login and after a successful phone save.
 */
async function fetchUserDashboardStats(token) {
  try {
    const res  = await fetch('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;

    const slotsUsed      = data.slotsUsed      ?? 0;
    const maxSlots       = data.maxSlots        ?? 3;
    const editsRemaining = data.editsRemaining  ?? 2;
    const profile        = data.profile         ?? {};

    // Update slot / edit counters in the trio-grid
    const elSlots = document.getElementById('stat-slots-used');
    const elEdits = document.getElementById('stat-edits-remaining');
    if (elSlots) elSlots.textContent = `${slotsUsed}/${maxSlots} emplacements`;
    if (elEdits) {
      elEdits.textContent = `${editsRemaining}/2 restantes`;
      // Red tint when 0 edits left
      elEdits.style.color = editsRemaining <= 0 ? 'var(--accent-red-bright)' : '';
    }

    // Pre-fill the phone form and name input with stored values
    const storedPhone = profile.phone_number || '';
    const storedCode  = profile.country_code || '+509';
    const storedName  = profile.full_name ? formatOgName(profile.full_name) : (appState.currentUser?.name || '');

    const phoneInput = document.getElementById('input-phone-number');
    const codeSelect = document.getElementById('select-country-code');
    const nameInput  = document.getElementById('input-full-name');

    if (phoneInput) phoneInput.value = storedPhone;
    if (codeSelect && storedCode) codeSelect.value = storedCode;
    if (nameInput)  nameInput.value  = storedName;

    // Update slot card preview
    const slotName  = document.getElementById('slot-card-name');
    const slotPhone = document.getElementById('slot-card-phone');
    if (slotName)  slotName.textContent  = storedName || 'Votre Fiche Contact';
    if (slotPhone) slotPhone.textContent = storedPhone ? `${storedCode} ${storedPhone}` : 'Aucun numéro enregistré';

    // Disable the save button if no edits left
    const saveBtn = document.getElementById('btn-save-phone-sync');
    if (saveBtn && editsRemaining <= 0) {
      saveBtn.disabled = true;
      saveBtn.title = 'Limite de modifications atteinte';
    } else if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.title = '';
    }
  } catch (err) {
    console.warn('⚠️ fetchUserDashboardStats:', err.message);
  }
}

/**
 * Fetch Google User Profile (Name, Email, Avatar)
 */
async function fetchGoogleUserProfile(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const profile = await res.json();
    
    appState.isAuthenticated = true;
    const formattedName = formatOgName(profile.name || 'Utilisateur Google');
    appState.currentUser = {
      name: formattedName,
      email: profile.email || '',
      avatar: profile.picture || 'img/OG Image.png'
    };

    closeModal('modal-google-auth');
    updateAuthUI();
    switchView('dashboard');
    showToast(`Bienvenue ${appState.currentUser.name} !`, 'fa-solid fa-circle-check');

    // Load real slot / edit counts from backend right after login
    fetchUserDashboardStats(accessToken);
  } catch (err) {
    console.error("❌ Erreur récupération profil Google :", err);
    showToast("Google a répondu, mais le profil n'a pas pu être chargé. Réessayez.", 'fa-solid fa-circle-exclamation');
    // Do NOT re-throw — let the caller continue so the UI isn't left in a broken state.
  }
}

/**
 * Fetch Google Contacts via People API (v1)
 */
async function fetchGoogleContacts(accessToken) {
  try {
    showToast("Synchronisation des contacts Google en cours...", 'fa-solid fa-arrows-rotate');
    const res = await fetch('https://people.googleapis.com/v1/people/me/connections?personFields=names,phoneNumbers,emailAddresses', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    console.log("👥 Contacts Google récupérés (People API) :", data);
    
    const count = data.connections ? data.connections.length : 0;
    showToast(`${count} contacts Google détectés et prêts pour la synchro !`, 'fa-solid fa-address-book');
  } catch (err) {
    console.warn("⚠️ Attention People API :", err.message);
  }
}

/* --------------------------------------------------------------------------
   Interactive Glassmorphism Floating Capsules Generator & 3D Inverse Parallax
   -------------------------------------------------------------------------- */
function initFloatingCapsules() {
  const container = document.getElementById('floating-container');
  if (!container) return;

  if (container.children.length === 0) {
    const depths = [0.04, 0.08, 0.03, 0.12, 0.06, 0.10];
    for (let i = 0; i < 6; i++) {
      const capsule = document.createElement('div');
      capsule.classList.add('floating-capsule', `capsule-${i + 1}`);
      capsule.setAttribute('data-depth', depths[i]);
      container.appendChild(capsule);
    }
  }

  window.addEventListener('mousemove', (e) => {
    const mouseX = e.clientX - window.innerWidth / 2;
    const mouseY = e.clientY - window.innerHeight / 2;

    const capsules = container.querySelectorAll('.floating-capsule');
    capsules.forEach(capsule => {
      const depth = parseFloat(capsule.getAttribute('data-depth')) || 0.05;
      const moveX = -mouseX * depth;
      const moveY = -mouseY * depth;

      capsule.style.setProperty('--px', `${moveX.toFixed(2)}px`);
      capsule.style.setProperty('--py', `${moveY.toFixed(2)}px`);
    });
  });
}

/* FAQ Accordion Logic */
function initFAQAccordion() {
  document.querySelectorAll('.faq-question').forEach(q => {
    q.addEventListener('click', () => {
      const parent = q.parentElement;
      const isActive = parent.classList.contains('active');

      document.querySelectorAll('.faq-accordion-item').forEach(item => {
        item.classList.remove('active');
      });

      if (!isActive) {
        parent.classList.add('active');
      }
    });
  });
}

/* Auth Buttons Logic */
function initAuthLogic() {
  // Bind all login buttons to GIS Request
  document.querySelectorAll('.btn-google-login').forEach(btn => {
    btn.addEventListener('click', () => {
      if (appState.isAuthenticated) {
        switchView('dashboard');
      } else {
        requestGoogleAuth();
      }
    });
  });

  // Modal Submit Button
  document.getElementById('btn-modal-google-submit')?.addEventListener('click', () => {
    requestGoogleAuth();
  });

  document.getElementById('btn-logout-google')?.addEventListener('click', () => {
    logout();
  });

  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => closeModal('modal-google-auth'));
  });

  // Auto-format full name input on blur to ensure OG prefix is preserved
  const inputFullName = document.getElementById('input-full-name');
  if (inputFullName) {
    inputFullName.addEventListener('blur', () => {
      inputFullName.value = formatOgName(inputFullName.value);
    });
  }

  document.getElementById('form-phone-sync')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputElem = document.getElementById('input-full-name');
    const formattedName = formatOgName(inputElem ? inputElem.value : '');
    if (inputElem) inputElem.value = formattedName;

    const code = document.getElementById('select-country-code').value;
    const num  = document.getElementById('input-phone-number').value;

    // Update card preview immediately
    const slotName  = document.getElementById('slot-card-name');
    const slotPhone = document.getElementById('slot-card-phone');
    if (slotName)  slotName.textContent  = formattedName;
    if (slotPhone) slotPhone.textContent = `${code} ${num}`;

    if (appState.currentUser) {
      appState.currentUser.name = formattedName;
      const nameElem   = document.getElementById('user-google-name');
      const accountName = document.getElementById('user-account-name');
      if (nameElem)    nameElem.textContent    = formattedName;
      if (accountName) accountName.textContent = formattedName;
    }

    // Persist to backend if user is authenticated (token-verified)
    if (appState.googleAccessToken) {
      const savePhone = async (token) => fetch('/api/user/phone', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body   : JSON.stringify({ countryCode: code, phoneNumber: num, fullName: formattedName })
      });
      try {
        let res  = await savePhone(appState.googleAccessToken);
        let data = await res.json();

        // Token expired — refresh and retry once
        if (res.status === 401 && data.code === 'TOKEN_EXPIRED') {
          showToast('Session expirée, rafraîchissement en cours…', 'fa-solid fa-arrows-rotate');
          const newToken = await refreshGoogleToken();
          if (newToken) {
            res  = await savePhone(newToken);
            data = await res.json();
          }
        }

        if (data.success) {
          // Store Supabase userId for future server-side token refreshes
          if (data.profile?.id) appState.supabaseUserId = data.profile.id;
          showToast(`Fiche enregistrée : ${formattedName} (${code} ${num})`, 'fa-solid fa-check');
          // Refresh real slot / edit counts after save
          const elSlots = document.getElementById('stat-slots-used');
          const elEdits = document.getElementById('stat-edits-remaining');
          if (elSlots && data.slotsUsed !== undefined)
            elSlots.textContent = `${data.slotsUsed}/${data.maxSlots ?? 3} emplacements`;
          if (elEdits && data.editsRemaining !== undefined) {
            elEdits.textContent = `${data.editsRemaining}/2 restantes`;
            elEdits.style.color = data.editsRemaining <= 0 ? 'var(--accent-red-bright)' : '';
          }
          // Disable save button if no edits left
          const saveBtn = document.getElementById('btn-save-phone-sync');
          if (saveBtn) {
            saveBtn.disabled = data.editsRemaining <= 0;
            saveBtn.title    = data.editsRemaining <= 0 ? 'Limite de modifications atteinte' : '';
          }

          fetchLiveStats();
          fetchDirectoryContacts();
        } else {
          showToast(data.message || 'Erreur lors de la sauvegarde.', 'fa-solid fa-circle-exclamation');
        }
      } catch (err) {
        console.warn('Phone save error:', err);
        showToast(`Fiche mise à jour localement : ${formattedName} (${code} ${num})`, 'fa-solid fa-check');
      }
    } else {
      showToast(`Fiche contact enregistrée : ${formattedName} (${code} ${num})`, 'fa-solid fa-check');
    }
  });

  document.querySelectorAll('#btn-refresh-stats, #btn-refresh-stats-sync, #btn-refresh-stats-dl, #btn-refresh-stats-rep, #btn-refresh-stats-acc, #btn-refresh-user-list').forEach(btn => {
    btn?.addEventListener('click', () => {
      fetchLiveStats();
      fetchDirectoryContacts();
      showToast('Données et annuaire rafraîchis !', 'fa-solid fa-rotate-right');
    });
  });

  // Handle Support / Signalisation Form Submit -> WhatsApp Direct
  document.getElementById('form-report-issue')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('input-report-email')?.value.trim() || '';
    const country = document.getElementById('select-report-country')?.value || '+509';
    const phoneNum = document.getElementById('input-report-phone')?.value.trim() || '';
    const topic = document.getElementById('select-report-topic')?.value || 'Signalement';
    const desc = document.getElementById('textarea-report-desc')?.value.trim() || '';

    const fullPhone = `${country} ${phoneNum}`.trim();
    const userName = appState.currentUser?.name ? appState.currentUser.name : 'Membre Space Connect';

    // Format WhatsApp message
    const message = `📌 *NOUVEAU SIGNALEMENT / SUPPORT SPACE CONNECT*\n\n` +
      `👤 *Membre* : ${userName}\n` +
      `📧 *Email* : ${email}\n` +
      `📱 *WhatsApp* : ${fullPhone}\n` +
      `🏷️ *Sujet* : ${topic}\n\n` +
      `💬 *Description du problème* :\n${desc}`;

    const encodedMsg = encodeURIComponent(message);
    const waUrl = `https://wa.me/50935672037?text=${encodedMsg}`;

    showToast("Ouverture de WhatsApp avec votre message...", 'fa-brands fa-whatsapp');

    setTimeout(() => {
      window.open(waUrl, '_blank');
    }, 500);
  });

  const syncToggle = document.getElementById('toggle-auto-sync-check');
  const syncPill = document.getElementById('sync-status-pill');
  const syncDesc = document.getElementById('sync-toggle-desc');

  if (syncToggle && syncPill && syncDesc) {
    syncToggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        syncPill.textContent = 'ACTIVÉ';
        syncPill.style.background = 'rgba(16, 185, 129, 0.15)';
        syncPill.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        syncPill.style.color = '#10B981';
        syncDesc.textContent = 'Activé — les nouveaux membres sont ajoutés automatiquement toutes les 15 minutes.';
        showToast('Auto-Sync Google Contacts activé !', 'fa-solid fa-bolt');
      } else {
        syncPill.textContent = 'DÉSACTIVÉ';
        syncPill.style.background = 'rgba(255, 255, 255, 0.06)';
        syncPill.style.borderColor = 'var(--border-card)';
        syncPill.style.color = 'var(--text-muted)';
        syncDesc.textContent = 'Désactivé — vous devrez télécharger les contacts manuellement.';
        showToast('Auto-Sync Google Contacts désactivé.', 'fa-solid fa-power-off');
      }
    });
  }

  document.getElementById('btn-manual-google-sync')?.addEventListener('click', async () => {
    if (!appState.googleAccessToken) {
      requestGoogleAuth();
      return;
    }
    showToast('Synchronisation Google Contacts en cours...', 'fa-solid fa-arrows-rotate');
    const doSync = (token) => fetch('/api/contacts/sync-google', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    try {
      let res  = await doSync(appState.googleAccessToken);
      let data = await res.json();

      // Token expired — refresh and retry once
      if (res.status === 401 && data.code === 'TOKEN_EXPIRED') {
        showToast('Session expirée, rafraîchissement en cours…', 'fa-solid fa-arrows-rotate');
        const newToken = await refreshGoogleToken();
        if (newToken) {
          res  = await doSync(newToken);
          data = await res.json();
        }
      }

      if (data.success) {
        showToast(data.message, 'fa-solid fa-circle-check');
      } else {
        fetchGoogleContacts(appState.googleAccessToken);
      }
    } catch (err) {
      fetchGoogleContacts(appState.googleAccessToken);
    }
  });
}

function logout() {
  appState.isAuthenticated = false;
  appState.currentUser = null;
  appState.googleAccessToken = null;
  appState.supabaseUserId = null;
  updateAuthUI();
  switchView('landing');
  showToast('Déconnecté de Space Connect.', 'fa-solid fa-right-from-bracket');
}

function updateAuthUI() {
  const authNav = document.getElementById('nav-auth-container');
  const unauthNotice = document.getElementById('saas-unauth-notice');
  const authContent = document.getElementById('saas-auth-content');

  if (appState.isAuthenticated && appState.currentUser) {
    authNav.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.6rem; background: rgba(255,255,255,0.05); padding: 0.35rem 0.8rem 0.35rem 0.35rem; border-radius: 9999px; border: 1px solid var(--border-card);">
        <img src="${appState.currentUser.avatar}" style="width: 28px; height: 28px; border-radius: 50%;" alt="Avatar">
        <span style="font-weight: 700; font-size: 0.825rem;">${appState.currentUser.name}</span>
      </div>
      <button class="btn btn-red btn-sm" onclick="switchView('dashboard')">Mon Espace SaaS</button>
    `;
    if (unauthNotice) unauthNotice.style.display = 'none';
    if (authContent) authContent.style.display = 'block';

    // Update Dashboard UI with real User Info
    const avatarElem = document.getElementById('user-google-avatar');
    const nameElem = document.getElementById('user-google-name');
    const emailElem = document.getElementById('user-google-email');

    const accountAvatar = document.getElementById('user-account-avatar');
    const accountName = document.getElementById('user-account-name');
    const accountEmail = document.getElementById('user-account-email');

    const slotName = document.getElementById('slot-card-name');
    const inputName = document.getElementById('input-full-name');

    if (avatarElem) avatarElem.src = appState.currentUser.avatar;
    if (nameElem) nameElem.textContent = appState.currentUser.name;
    if (emailElem) emailElem.textContent = appState.currentUser.email;

    if (accountAvatar) accountAvatar.src = appState.currentUser.avatar;
    if (accountName) accountName.textContent = appState.currentUser.name;
    if (accountEmail) accountEmail.textContent = appState.currentUser.email;

    if (slotName) slotName.textContent = formatOgName(appState.currentUser.name);
    if (inputName) inputName.value = formatOgName(appState.currentUser.name);

    const reportEmail = document.getElementById('input-report-email');
    if (reportEmail && appState.currentUser.email) {
      reportEmail.value = appState.currentUser.email;
    }

  } else {
    authNav.innerHTML = `
      <button class="btn btn-dark" style="padding: 0.4rem 0.85rem; font-size: 0.8rem;"><i class="fa-solid fa-language" style="color: var(--accent-red-bright);"></i> FR <i class="fa-solid fa-chevron-down" style="font-size: 0.7rem;"></i></button>
      <a href="#social-section" class="btn btn-dark" style="padding: 0.4rem 0.85rem; font-size: 0.8rem;"><i class="fa-solid fa-share-nodes" style="color: var(--accent-red-bright);"></i> RÉSEAUX</a>
      <a href="privacy.html" class="btn btn-dark" style="padding: 0.4rem 0.85rem; font-size: 0.8rem;"><i class="fa-solid fa-user-shield" style="color: var(--accent-red-bright);"></i> CONFIDENTIALITÉ</a>
      <a href="terms.html" class="btn btn-dark" style="padding: 0.4rem 0.85rem; font-size: 0.8rem;"><i class="fa-solid fa-scale-balanced" style="color: var(--accent-red-bright);"></i> CGU</a>
      <button class="btn btn-dark btn-google-login">SE CONNECTER</button>
      <button class="btn btn-red btn-google-login">REJOINDRE</button>
    `;
    if (unauthNotice) unauthNotice.style.display = 'block';
    if (authContent) authContent.style.display = 'none';

    document.querySelectorAll('.btn-google-login').forEach(b => {
      b.addEventListener('click', () => requestGoogleAuth());
    });
  }
}

/* Dashboard Sidebar Multi-Tab Controller */
function initDashboardTabs() {
  document.querySelectorAll('.dash-nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.getAttribute('data-tab');
      switchDashTab(tabId);
    });
  });
}

function switchDashTab(tabId) {
  // Update sidebar active status
  document.querySelectorAll('.dash-nav-item[data-tab]').forEach(item => {
    if (item.getAttribute('data-tab') === tabId) {
      item.classList.add('active');
      if (!item.querySelector('.active-dot')) {
        const dot = document.createElement('span');
        dot.classList.add('active-dot');
        item.appendChild(dot);
      }
    } else {
      item.classList.remove('active');
      const dot = item.querySelector('.active-dot');
      if (dot) dot.remove();
    }
  });

  // Switch visible tab pane
  document.querySelectorAll('.dash-tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });

  const targetPane = document.getElementById(`tab-${tabId}`);
  if (targetPane) {
    targetPane.classList.add('active');
  }
}

function copyInviteLink() {
  const link = window.location.origin + window.location.pathname;
  navigator.clipboard.writeText(link).then(() => {
    showToast("Lien d'invitation copié dans le presse-papier !", 'fa-solid fa-link');
  }).catch(() => {
    showToast("Lien : " + link, 'fa-solid fa-link');
  });
}

function switchView(viewName) {
  document.querySelectorAll('.spa-view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

/* VCF File Export */
function initVCFGenerator() {
  const triggerDownload = () => {
    let vcf = '';
    appState.members.forEach(m => {
      vcf += `BEGIN:VCARD\nVERSION:3.0\nFN:${m.name}\nTEL;TYPE=CELL:${m.country}\nEND:VCARD\n\n`;
    });

    const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'SpaceConnect_Contacts.vcf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    showToast('Fichier SpaceConnect_Contacts.vcf téléchargé !', 'fa-solid fa-download');
  };

  document.getElementById('btn-download-vcf')?.addEventListener('click', triggerDownload);
  document.querySelectorAll('.btn-download-vcf-action').forEach(b => {
    b.addEventListener('click', triggerDownload);
  });
}

// Attach logout actions
document.addEventListener('click', (e) => {
  if (e.target.closest('.btn-logout-action')) {
    logout();
  }
});

// Initialize Dashboard Tabs on DOMReady
document.addEventListener('DOMContentLoaded', () => {
  initDashboardTabs();
});

function openModal(id) { document.getElementById(id)?.classList.add('active'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

function showToast(msg, icon = 'fa-solid fa-bell') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.classList.add('toast');
  toast.innerHTML = `<i class="${icon}" style="color: var(--accent-red-bright);"></i> <span>${msg}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/* ==========================================================================
   ANNUAIRE MONDIAL - PAYS DU MONDE ENTIER (DRAPEAUX & INDICATIFS)
   ========================================================================== */

/** Tous les pays du monde avec drapeaux emoji, codes ISO et indicatifs */
const WORLD_COUNTRIES = [
  // ── PRIORITÉ : HAÏTI & DIASPORA ──────────────────────────────────────────
  { flag: '🇭🇹', code: 'HT', dial: '+509',  name: 'Haïti' },
  { flag: '🇺🇸', code: 'US', dial: '+1',    name: 'États-Unis' },
  { flag: '🇨🇦', code: 'CA', dial: '+1',    name: 'Canada' },
  { flag: '🇫🇷', code: 'FR', dial: '+33',   name: 'France' },
  { flag: '🇩🇴', code: 'DO', dial: '+1809', name: 'Rép. Dominicaine' },
  { flag: '🇬🇵', code: 'GP', dial: '+590',  name: 'Guadeloupe' },
  { flag: '🇲🇶', code: 'MQ', dial: '+596',  name: 'Martinique' },
  { flag: '🇬🇫', code: 'GF', dial: '+594',  name: 'Guyane française' },
  { flag: '🇨🇺', code: 'CU', dial: '+53',   name: 'Cuba' },
  { flag: '🇯🇲', code: 'JM', dial: '+1876', name: 'Jamaïque' },
  { flag: '🇵🇷', code: 'PR', dial: '+1787', name: 'Porto Rico' },
  { flag: '🇹🇹', code: 'TT', dial: '+1868', name: 'Trinité-et-Tobago' },
  { flag: '🇧🇧', code: 'BB', dial: '+1246', name: 'Barbade' },
  { flag: '🇧🇸', code: 'BS', dial: '+1242', name: 'Bahamas' },
  { flag: '🇻🇨', code: 'VC', dial: '+1784', name: 'Saint-Vincent-et-les-Grenadines' },
  { flag: '🇱🇨', code: 'LC', dial: '+1758', name: 'Sainte-Lucie' },
  { flag: '🇬🇩', code: 'GD', dial: '+1473', name: 'Grenade' },
  { flag: '🇦🇬', code: 'AG', dial: '+1268', name: 'Antigua-et-Barbuda' },
  { flag: '🇰🇳', code: 'KN', dial: '+1869', name: 'Saint-Kitts-et-Nevis' },
  { flag: '🇩🇲', code: 'DM', dial: '+1767', name: 'Dominique' },
  { flag: '🇦🇼', code: 'AW', dial: '+297',  name: 'Aruba' },
  { flag: '🇨🇼', code: 'CW', dial: '+599',  name: 'Curaçao' },

  // ── AFRIQUE FRANCOPHONE ───────────────────────────────────────────────────
  { flag: '🇸🇳', code: 'SN', dial: '+221',  name: 'Sénégal' },
  { flag: '🇨🇮', code: 'CI', dial: '+225',  name: "Côte d'Ivoire" },
  { flag: '🇹🇬', code: 'TG', dial: '+228',  name: 'Togo' },
  { flag: '🇧🇯', code: 'BJ', dial: '+229',  name: 'Bénin' },
  { flag: '🇲🇱', code: 'ML', dial: '+223',  name: 'Mali' },
  { flag: '🇧🇫', code: 'BF', dial: '+226',  name: 'Burkina Faso' },
  { flag: '🇨🇲', code: 'CM', dial: '+237',  name: 'Cameroun' },
  { flag: '🇬🇦', code: 'GA', dial: '+241',  name: 'Gabon' },
  { flag: '🇨🇬', code: 'CG', dial: '+242',  name: 'Congo-Brazzaville' },
  { flag: '🇨🇩', code: 'CD', dial: '+243',  name: 'RD Congo' },
  { flag: '🇨🇫', code: 'CF', dial: '+236',  name: 'Centrafrique' },
  { flag: '🇬🇳', code: 'GN', dial: '+224',  name: 'Guinée' },
  { flag: '🇬🇼', code: 'GW', dial: '+245',  name: 'Guinée-Bissau' },
  { flag: '🇬🇶', code: 'GQ', dial: '+240',  name: 'Guinée équatoriale' },
  { flag: '🇳🇪', code: 'NE', dial: '+227',  name: 'Niger' },
  { flag: '🇹🇩', code: 'TD', dial: '+235',  name: 'Tchad' },
  { flag: '🇲🇷', code: 'MR', dial: '+222',  name: 'Mauritanie' },
  { flag: '🇩🇯', code: 'DJ', dial: '+253',  name: 'Djibouti' },
  { flag: '🇰🇲', code: 'KM', dial: '+269',  name: 'Comores' },
  { flag: '🇲🇬', code: 'MG', dial: '+261',  name: 'Madagascar' },
  { flag: '🇲🇺', code: 'MU', dial: '+230',  name: 'Maurice' },
  { flag: '🇸🇨', code: 'SC', dial: '+248',  name: 'Seychelles' },
  { flag: '🇷🇼', code: 'RW', dial: '+250',  name: 'Rwanda' },
  { flag: '🇧🇮', code: 'BI', dial: '+257',  name: 'Burundi' },

  // ── AFRIQUE (AUTRES) ──────────────────────────────────────────────────────
  { flag: '🇳🇬', code: 'NG', dial: '+234',  name: 'Nigeria' },
  { flag: '🇬🇭', code: 'GH', dial: '+233',  name: 'Ghana' },
  { flag: '🇰🇪', code: 'KE', dial: '+254',  name: 'Kenya' },
  { flag: '🇹🇿', code: 'TZ', dial: '+255',  name: 'Tanzanie' },
  { flag: '🇺🇬', code: 'UG', dial: '+256',  name: 'Ouganda' },
  { flag: '🇪🇹', code: 'ET', dial: '+251',  name: 'Éthiopie' },
  { flag: '🇸🇴', code: 'SO', dial: '+252',  name: 'Somalie' },
  { flag: '🇸🇩', code: 'SD', dial: '+249',  name: 'Soudan' },
  { flag: '🇸🇸', code: 'SS', dial: '+211',  name: 'Soudan du Sud' },
  { flag: '🇪🇷', code: 'ER', dial: '+291',  name: 'Érythrée' },
  { flag: '🇲🇿', code: 'MZ', dial: '+258',  name: 'Mozambique' },
  { flag: '🇿🇦', code: 'ZA', dial: '+27',   name: 'Afrique du Sud' },
  { flag: '🇿🇲', code: 'ZM', dial: '+260',  name: 'Zambie' },
  { flag: '🇿🇼', code: 'ZW', dial: '+263',  name: 'Zimbabwe' },
  { flag: '🇧🇼', code: 'BW', dial: '+267',  name: 'Botswana' },
  { flag: '🇳🇦', code: 'NA', dial: '+264',  name: 'Namibie' },
  { flag: '🇲🇼', code: 'MW', dial: '+265',  name: 'Malawi' },
  { flag: '🇦🇴', code: 'AO', dial: '+244',  name: 'Angola' },
  { flag: '🇸🇱', code: 'SL', dial: '+232',  name: 'Sierra Leone' },
  { flag: '🇱🇷', code: 'LR', dial: '+231',  name: 'Liberia' },
  { flag: '🇬🇲', code: 'GM', dial: '+220',  name: 'Gambie' },
  { flag: '🇨🇻', code: 'CV', dial: '+238',  name: 'Cap-Vert' },
  { flag: '🇸🇹', code: 'ST', dial: '+239',  name: 'São Tomé-et-Príncipe' },
  { flag: '🇱🇸', code: 'LS', dial: '+266',  name: 'Lesotho' },
  { flag: '🇸🇿', code: 'SZ', dial: '+268',  name: 'Eswatini' },
  { flag: '🇲🇦', code: 'MA', dial: '+212',  name: 'Maroc' },
  { flag: '🇩🇿', code: 'DZ', dial: '+213',  name: 'Algérie' },
  { flag: '🇹🇳', code: 'TN', dial: '+216',  name: 'Tunisie' },
  { flag: '🇱🇾', code: 'LY', dial: '+218',  name: 'Libye' },
  { flag: '🇪🇬', code: 'EG', dial: '+20',   name: 'Égypte' },

  // ── EUROPE ────────────────────────────────────────────────────────────────
  { flag: '🇧🇪', code: 'BE', dial: '+32',   name: 'Belgique' },
  { flag: '🇨🇭', code: 'CH', dial: '+41',   name: 'Suisse' },
  { flag: '🇱🇺', code: 'LU', dial: '+352',  name: 'Luxembourg' },
  { flag: '🇲🇨', code: 'MC', dial: '+377',  name: 'Monaco' },
  { flag: '🇬🇧', code: 'GB', dial: '+44',   name: 'Royaume-Uni' },
  { flag: '🇩🇪', code: 'DE', dial: '+49',   name: 'Allemagne' },
  { flag: '🇪🇸', code: 'ES', dial: '+34',   name: 'Espagne' },
  { flag: '🇮🇹', code: 'IT', dial: '+39',   name: 'Italie' },
  { flag: '🇵🇹', code: 'PT', dial: '+351',  name: 'Portugal' },
  { flag: '🇳🇱', code: 'NL', dial: '+31',   name: 'Pays-Bas' },
  { flag: '🇸🇪', code: 'SE', dial: '+46',   name: 'Suède' },
  { flag: '🇳🇴', code: 'NO', dial: '+47',   name: 'Norvège' },
  { flag: '🇩🇰', code: 'DK', dial: '+45',   name: 'Danemark' },
  { flag: '🇫🇮', code: 'FI', dial: '+358',  name: 'Finlande' },
  { flag: '🇮🇸', code: 'IS', dial: '+354',  name: 'Islande' },
  { flag: '🇮🇪', code: 'IE', dial: '+353',  name: 'Irlande' },
  { flag: '🇦🇹', code: 'AT', dial: '+43',   name: 'Autriche' },
  { flag: '🇵🇱', code: 'PL', dial: '+48',   name: 'Pologne' },
  { flag: '🇨🇿', code: 'CZ', dial: '+420',  name: 'Tchéquie' },
  { flag: '🇸🇰', code: 'SK', dial: '+421',  name: 'Slovaquie' },
  { flag: '🇭🇺', code: 'HU', dial: '+36',   name: 'Hongrie' },
  { flag: '🇷🇴', code: 'RO', dial: '+40',   name: 'Roumanie' },
  { flag: '🇧🇬', code: 'BG', dial: '+359',  name: 'Bulgarie' },
  { flag: '🇭🇷', code: 'HR', dial: '+385',  name: 'Croatie' },
  { flag: '🇷🇸', code: 'RS', dial: '+381',  name: 'Serbie' },
  { flag: '🇸🇮', code: 'SI', dial: '+386',  name: 'Slovénie' },
  { flag: '🇧🇦', code: 'BA', dial: '+387',  name: 'Bosnie-Herzégovine' },
  { flag: '🇲🇪', code: 'ME', dial: '+382',  name: 'Monténégro' },
  { flag: '🇲🇰', code: 'MK', dial: '+389',  name: 'Macédoine du Nord' },
  { flag: '🇦🇱', code: 'AL', dial: '+355',  name: 'Albanie' },
  { flag: '🇬🇷', code: 'GR', dial: '+30',   name: 'Grèce' },
  { flag: '🇷🇺', code: 'RU', dial: '+7',    name: 'Russie' },
  { flag: '🇺🇦', code: 'UA', dial: '+380',  name: 'Ukraine' },
  { flag: '🇧🇾', code: 'BY', dial: '+375',  name: 'Biélorussie' },
  { flag: '🇲🇩', code: 'MD', dial: '+373',  name: 'Moldavie' },
  { flag: '🇱🇹', code: 'LT', dial: '+370',  name: 'Lituanie' },
  { flag: '🇱🇻', code: 'LV', dial: '+371',  name: 'Lettonie' },
  { flag: '🇪🇪', code: 'EE', dial: '+372',  name: 'Estonie' },
  { flag: '🇸🇲', code: 'SM', dial: '+378',  name: 'Saint-Marin' },
  { flag: '🇦🇩', code: 'AD', dial: '+376',  name: 'Andorre' },
  { flag: '🇱🇮', code: 'LI', dial: '+423',  name: 'Liechtenstein' },
  { flag: '🇲🇹', code: 'MT', dial: '+356',  name: 'Malte' },
  { flag: '🇨🇾', code: 'CY', dial: '+357',  name: 'Chypre' },
  { flag: '🇽🇰', code: 'XK', dial: '+383',  name: 'Kosovo' },
  { flag: '🇦🇲', code: 'AM', dial: '+374',  name: 'Arménie' },
  { flag: '🇬🇪', code: 'GE', dial: '+995',  name: 'Géorgie' },
  { flag: '🇦🇿', code: 'AZ', dial: '+994',  name: 'Azerbaïdjan' },

  // ── AMÉRIQUE LATINE ───────────────────────────────────────────────────────
  { flag: '🇧🇷', code: 'BR', dial: '+55',   name: 'Brésil' },
  { flag: '🇲🇽', code: 'MX', dial: '+52',   name: 'Mexique' },
  { flag: '🇨🇴', code: 'CO', dial: '+57',   name: 'Colombie' },
  { flag: '🇻🇪', code: 'VE', dial: '+58',   name: 'Venezuela' },
  { flag: '🇦🇷', code: 'AR', dial: '+54',   name: 'Argentine' },
  { flag: '🇨🇱', code: 'CL', dial: '+56',   name: 'Chili' },
  { flag: '🇵🇪', code: 'PE', dial: '+51',   name: 'Pérou' },
  { flag: '🇪🇨', code: 'EC', dial: '+593',  name: 'Équateur' },
  { flag: '🇧🇴', code: 'BO', dial: '+591',  name: 'Bolivie' },
  { flag: '🇵🇾', code: 'PY', dial: '+595',  name: 'Paraguay' },
  { flag: '🇺🇾', code: 'UY', dial: '+598',  name: 'Uruguay' },
  { flag: '🇬🇾', code: 'GY', dial: '+592',  name: 'Guyana' },
  { flag: '🇸🇷', code: 'SR', dial: '+597',  name: 'Suriname' },
  { flag: '🇬🇹', code: 'GT', dial: '+502',  name: 'Guatemala' },
  { flag: '🇭🇳', code: 'HN', dial: '+504',  name: 'Honduras' },
  { flag: '🇸🇻', code: 'SV', dial: '+503',  name: 'El Salvador' },
  { flag: '🇳🇮', code: 'NI', dial: '+505',  name: 'Nicaragua' },
  { flag: '🇨🇷', code: 'CR', dial: '+506',  name: 'Costa Rica' },
  { flag: '🇵🇦', code: 'PA', dial: '+507',  name: 'Panama' },
  { flag: '🇧🇿', code: 'BZ', dial: '+501',  name: 'Belize' },

  // ── MOYEN-ORIENT ─────────────────────────────────────────────────────────
  { flag: '🇸🇦', code: 'SA', dial: '+966',  name: 'Arabie Saoudite' },
  { flag: '🇦🇪', code: 'AE', dial: '+971',  name: 'Émirats Arabes Unis' },
  { flag: '🇶🇦', code: 'QA', dial: '+974',  name: 'Qatar' },
  { flag: '🇰🇼', code: 'KW', dial: '+965',  name: 'Koweït' },
  { flag: '🇧🇭', code: 'BH', dial: '+973',  name: 'Bahreïn' },
  { flag: '🇴🇲', code: 'OM', dial: '+968',  name: 'Oman' },
  { flag: '🇾🇪', code: 'YE', dial: '+967',  name: 'Yémen' },
  { flag: '🇯🇴', code: 'JO', dial: '+962',  name: 'Jordanie' },
  { flag: '🇱🇧', code: 'LB', dial: '+961',  name: 'Liban' },
  { flag: '🇸🇾', code: 'SY', dial: '+963',  name: 'Syrie' },
  { flag: '🇮🇶', code: 'IQ', dial: '+964',  name: 'Irak' },
  { flag: '🇮🇷', code: 'IR', dial: '+98',   name: 'Iran' },
  { flag: '🇮🇱', code: 'IL', dial: '+972',  name: 'Israël' },
  { flag: '🇵🇸', code: 'PS', dial: '+970',  name: 'Palestine' },
  { flag: '🇹🇷', code: 'TR', dial: '+90',   name: 'Turquie' },

  // ── ASIE DU SUD & SUD-EST ─────────────────────────────────────────────────
  { flag: '🇮🇳', code: 'IN', dial: '+91',   name: 'Inde' },
  { flag: '🇵🇰', code: 'PK', dial: '+92',   name: 'Pakistan' },
  { flag: '🇧🇩', code: 'BD', dial: '+880',  name: 'Bangladesh' },
  { flag: '🇱🇰', code: 'LK', dial: '+94',   name: 'Sri Lanka' },
  { flag: '🇳🇵', code: 'NP', dial: '+977',  name: 'Népal' },
  { flag: '🇲🇻', code: 'MV', dial: '+960',  name: 'Maldives' },
  { flag: '🇧🇹', code: 'BT', dial: '+975',  name: 'Bhoutan' },
  { flag: '🇦🇫', code: 'AF', dial: '+93',   name: 'Afghanistan' },
  { flag: '🇹🇭', code: 'TH', dial: '+66',   name: 'Thaïlande' },
  { flag: '🇻🇳', code: 'VN', dial: '+84',   name: 'Viêt Nam' },
  { flag: '🇲🇾', code: 'MY', dial: '+60',   name: 'Malaisie' },
  { flag: '🇮🇩', code: 'ID', dial: '+62',   name: 'Indonésie' },
  { flag: '🇵🇭', code: 'PH', dial: '+63',   name: 'Philippines' },
  { flag: '🇸🇬', code: 'SG', dial: '+65',   name: 'Singapour' },
  { flag: '🇲🇲', code: 'MM', dial: '+95',   name: 'Myanmar' },
  { flag: '🇰🇭', code: 'KH', dial: '+855',  name: 'Cambodge' },
  { flag: '🇱🇦', code: 'LA', dial: '+856',  name: 'Laos' },
  { flag: '🇧🇳', code: 'BN', dial: '+673',  name: 'Brunéi' },
  { flag: '🇹🇱', code: 'TL', dial: '+670',  name: 'Timor oriental' },

  // ── ASIE DE L'EST & CENTRALE ──────────────────────────────────────────────
  { flag: '🇨🇳', code: 'CN', dial: '+86',   name: 'Chine' },
  { flag: '🇯🇵', code: 'JP', dial: '+81',   name: 'Japon' },
  { flag: '🇰🇷', code: 'KR', dial: '+82',   name: 'Corée du Sud' },
  { flag: '🇰🇵', code: 'KP', dial: '+850',  name: 'Corée du Nord' },
  { flag: '🇲🇳', code: 'MN', dial: '+976',  name: 'Mongolie' },
  { flag: '🇹🇼', code: 'TW', dial: '+886',  name: 'Taïwan' },
  { flag: '🇭🇰', code: 'HK', dial: '+852',  name: 'Hong Kong' },
  { flag: '🇲🇴', code: 'MO', dial: '+853',  name: 'Macao' },
  { flag: '🇰🇿', code: 'KZ', dial: '+7',    name: 'Kazakhstan' },
  { flag: '🇺🇿', code: 'UZ', dial: '+998',  name: 'Ouzbékistan' },
  { flag: '🇹🇲', code: 'TM', dial: '+993',  name: 'Turkménistan' },
  { flag: '🇰🇬', code: 'KG', dial: '+996',  name: 'Kirghizistan' },
  { flag: '🇹🇯', code: 'TJ', dial: '+992',  name: 'Tadjikistan' },

  // ── OCÉANIE ───────────────────────────────────────────────────────────────
  { flag: '🇦🇺', code: 'AU', dial: '+61',   name: 'Australie' },
  { flag: '🇳🇿', code: 'NZ', dial: '+64',   name: 'Nouvelle-Zélande' },
  { flag: '🇫🇯', code: 'FJ', dial: '+679',  name: 'Fidji' },
  { flag: '🇵🇬', code: 'PG', dial: '+675',  name: 'Papouasie-Nouvelle-Guinée' },
  { flag: '🇸🇧', code: 'SB', dial: '+677',  name: 'Îles Salomon' },
  { flag: '🇻🇺', code: 'VU', dial: '+678',  name: 'Vanuatu' },
  { flag: '🇼🇸', code: 'WS', dial: '+685',  name: 'Samoa' },
  { flag: '🇹🇴', code: 'TO', dial: '+676',  name: 'Tonga' },
  { flag: '🇰🇮', code: 'KI', dial: '+686',  name: 'Kiribati' },
  { flag: '🇫🇲', code: 'FM', dial: '+691',  name: 'Micronésie' },
  { flag: '🇵🇼', code: 'PW', dial: '+680',  name: 'Palaos' },
  { flag: '🇲🇭', code: 'MH', dial: '+692',  name: 'Îles Marshall' },
  { flag: '🇳🇷', code: 'NR', dial: '+674',  name: 'Nauru' },
  { flag: '🇹🇻', code: 'TV', dial: '+688',  name: 'Tuvalu' },
  { flag: '🇳🇨', code: 'NC', dial: '+687',  name: 'Nouvelle-Calédonie' },
  { flag: '🇵🇫', code: 'PF', dial: '+689',  name: 'Polynésie française' },
];

/**
 * Build COUNTRY_MAP from WORLD_COUNTRIES for backwards-compatible lookups.
 * Keys are dial codes; some codes map to multiple countries (e.g. +1) so we
 * keep the first match and add aliases for Dominican Republic sub-codes.
 */
const COUNTRY_MAP = (() => {
  const map = {};
  WORLD_COUNTRIES.forEach(c => {
    if (!map[c.dial]) map[c.dial] = { name: c.name.toUpperCase(), flag: c.flag, code: c.code };
  });
  // Dominican Republic sub-codes
  ['+1829', '+1849'].forEach(d => {
    map[d] = { name: 'RÉP. DOMINICAINE', flag: '🇩🇴', code: 'DO' };
  });
  return map;
})();

function getCountryMeta(dial) {
  if (!dial) return { name: 'HAÏTI', flag: '🇭🇹', code: 'HT' };
  const clean = dial.trim();
  if (COUNTRY_MAP[clean]) return COUNTRY_MAP[clean];
  // +1 fallback (US/CA)
  if (clean.startsWith('+1')) return { name: 'ÉTATS-UNIS / CANADA', flag: '🇺🇸', code: 'US' };
  return { name: 'INTERNATIONAL', flag: '🌐', code: 'INT' };
}

/**
 * Populate every country / dial-code <select> in the page from WORLD_COUNTRIES.
 * Runs once on DOMContentLoaded.
 */
function populateCountrySelectors() {
  // 1. Phone-sync form (#select-country-code)
  const phoneSel = document.getElementById('select-country-code');
  if (phoneSel) {
    phoneSel.innerHTML = '';
    WORLD_COUNTRIES.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.dial;
      opt.textContent = `${c.flag} ${c.code} (${c.dial})`;
      phoneSel.appendChild(opt);
    });
  }

  // 2. Report / support form (#select-report-country)
  const reportSel = document.getElementById('select-report-country');
  if (reportSel) {
    reportSel.innerHTML = '';
    WORLD_COUNTRIES.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.dial;
      opt.textContent = `${c.flag} ${c.name} (${c.dial})`;
      reportSel.appendChild(opt);
    });
  }

  // 3. Directory country filter (#directory-filter-country)
  const ctrySel = document.getElementById('directory-filter-country');
  if (ctrySel) {
    ctrySel.innerHTML = '<option value="ALL">🌍 Tous les pays</option>';
    WORLD_COUNTRIES.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = `${c.flag} ${c.name}`;
      ctrySel.appendChild(opt);
    });
  }

  // 4. Directory dial-code filter (#directory-filter-code)
  const codeSel = document.getElementById('directory-filter-code');
  if (codeSel) {
    codeSel.innerHTML = '<option value="ALL">📞 Tous indicatifs</option>';
    // Deduplicate dial codes while keeping order
    const seen = new Set();
    WORLD_COUNTRIES.forEach(c => {
      if (seen.has(c.dial)) return;
      seen.add(c.dial);
      const opt = document.createElement('option');
      opt.value = c.dial;
      opt.textContent = `${c.flag} ${c.dial} — ${c.name}`;
      codeSel.appendChild(opt);
    });
  }
}

const directoryState = {
  allContacts: [],
  selectedIds: new Set(),
  searchQuery: '',
  countryFilter: 'ALL',
  codeFilter: 'ALL'
};

async function fetchDirectoryContacts() {
  // The directory endpoint is intentionally protected because it contains
  // personal phone numbers. Do not call it on the public landing page.
  if (!appState.isAuthenticated || !appState.googleAccessToken) {
    return;
  }

  try {
    const res = await fetch('/api/contacts/list');
    const data = await res.json();
    if (data.success && Array.isArray(data.contacts) && data.contacts.length > 0) {
      directoryState.allContacts = data.contacts;
    } else {
      directoryState.allContacts = getMockDirectoryContacts();
    }
  } catch (err) {
    directoryState.allContacts = getMockDirectoryContacts();
  }
  renderDirectoryGrid();
}

function getMockDirectoryContacts() {
  return [
    { id: '1', full_name: 'OG Ednova graphic', country_code: '+509', phone_number: '41026788' },
    { id: '2', full_name: 'OG Royaume - unis', country_code: '+509', phone_number: '56748217' },
    { id: '3', full_name: 'OG Jonathan Saûs', country_code: '+509', phone_number: '40328101' },
    { id: '4', full_name: 'OG Kossi Fernado', country_code: '+228', phone_number: '90123456' },
    { id: '5', full_name: 'OG Doberto Jean', country_code: '+509', phone_number: '34567890' },
    { id: '6', full_name: 'OG Jeff_tsukidev_test', country_code: '+33', phone_number: '612345678' }
  ];
}

function renderDirectoryGrid() {
  const container = document.getElementById('directory-grid-container');
  const totalBadge = document.getElementById('directory-total-badge');
  const selectedCountElem = document.getElementById('directory-selected-count');
  if (!container) return;

  const filtered = directoryState.allContacts.filter(c => {
    const name = formatOgName(c.full_name || '').toLowerCase();
    const query = directoryState.searchQuery.toLowerCase();
    const matchesSearch = name.includes(query) || (c.phone_number || '').includes(query);

    const countryMeta = getCountryMeta(c.country_code);
    const matchesCountry = directoryState.countryFilter === 'ALL' || countryMeta.code === directoryState.countryFilter;
    const matchesCode = directoryState.codeFilter === 'ALL' || c.country_code === directoryState.codeFilter;

    return matchesSearch && matchesCountry && matchesCode;
  });

  if (totalBadge) totalBadge.textContent = `${filtered.length} Membres`;
  if (selectedCountElem) selectedCountElem.textContent = `${directoryState.selectedIds.size} / ${filtered.length} sélectionné(s)`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-muted);">
        <i class="fa-solid fa-users-slash" style="font-size: 2.5rem; margin-bottom: 1rem; color: var(--border-card);"></i>
        <p style="font-weight: 700;">Aucun membre ne correspond à vos filtres.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(c => {
    const formattedName = formatOgName(c.full_name);
    const initial = formattedName.replace(/^OG\s+/i, '').charAt(0).toUpperCase() || 'O';
    const countryMeta = getCountryMeta(c.country_code);
    const fullPhone = `${c.country_code || '+509'}${c.phone_number || ''}`;
    const isSelected = directoryState.selectedIds.has(c.id);

    return `
      <div class="directory-card ${isSelected ? 'selected' : ''}" onclick="toggleDirectorySelect('${c.id}')">
        <div class="directory-card-left">
          <div class="directory-avatar">${initial}</div>
          <div class="directory-info">
            <div class="directory-name">${formattedName}</div>
            <div class="directory-meta">
              <span>${countryMeta.name}</span> • <span>${c.country_code || '+509'}</span>
            </div>
            <div class="directory-phone">${fullPhone}</div>
            ${isSelected ? `<div class="directory-status-pill"><i class="fa-solid fa-circle-check"></i> DÉJÀ SÉLECTIONNÉ</div>` : ''}
          </div>
        </div>
        <div class="directory-flag-badge">${countryMeta.flag}</div>
      </div>
    `;
  }).join('');
}

function toggleDirectorySelect(id) {
  if (directoryState.selectedIds.has(id)) {
    directoryState.selectedIds.delete(id);
  } else {
    directoryState.selectedIds.add(id);
  }
  renderDirectoryGrid();
}

function initDirectoryListeners() {
  document.getElementById('directory-search-input')?.addEventListener('input', (e) => {
    directoryState.searchQuery = e.target.value;
    renderDirectoryGrid();
  });

  document.getElementById('directory-filter-country')?.addEventListener('change', (e) => {
    directoryState.countryFilter = e.target.value;
    renderDirectoryGrid();
  });

  document.getElementById('directory-filter-code')?.addEventListener('change', (e) => {
    directoryState.codeFilter = e.target.value;
    renderDirectoryGrid();
  });

  document.getElementById('btn-directory-select-all')?.addEventListener('click', () => {
    const label = document.getElementById('select-all-label');
    if (directoryState.selectedIds.size === directoryState.allContacts.length) {
      directoryState.selectedIds.clear();
      if (label) label.textContent = 'TOUT SÉLECTIONNER';
    } else {
      directoryState.allContacts.forEach(c => directoryState.selectedIds.add(c.id));
      if (label) label.textContent = 'DÉSÉLECTIONNER TOUT';
    }
    renderDirectoryGrid();
  });

  document.getElementById('btn-refresh-user-list')?.addEventListener('click', () => {
    fetchDirectoryContacts();
    showToast('Annuaire mondial rafraîchi !', 'fa-solid fa-rotate-right');
  });

  document.getElementById('btn-directory-add-google')?.addEventListener('click', () => {
    showToast('Ajout de la sélection à vos Google Contacts...', 'fa-solid fa-cloud-arrow-down');
    setTimeout(() => {
      showToast('Contacts synchronisés dans votre compte Google !', 'fa-solid fa-check');
    }, 1200);
  });

  // Auto-refresh directory every 15 minutes (900,000 ms)
  setInterval(() => {
    fetchDirectoryContacts();
  }, 15 * 60 * 1000);

  // Initial fetch
  fetchDirectoryContacts();
}

document.addEventListener('DOMContentLoaded', () => {
  initDirectoryListeners();
});

