/* ==========================================================================
   Space Connect | Shared Formatting Utilities
   ========================================================================== */

/**
 * Normalise un nom de membre en format "OG Prénom".
 * - Préfixe "OG " ajouté s'il est absent
 * - Casse du préfixe existant corrigée (og / Og → OG)
 *
 * @param {string} name
 * @returns {string}
 */
function formatOgName(name) {
  if (!name || typeof name !== 'string') return 'OG Membre Space';
  const trimmed = name.trim();
  if (!trimmed) return 'OG Membre Space';
  if (/^og\b/i.test(trimmed)) {
    return trimmed.replace(/^og\b\s*/i, 'OG ').trim();
  }
  return `OG ${trimmed}`;
}

module.exports = { formatOgName };
