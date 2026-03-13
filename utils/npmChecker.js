// utils/npmChecker.js — dependency risk helpers (used by background.js)
// All logic lives in background.js for MV3 service-worker scope;
// this file documents the dep-check contract and risk-label logic as reference.

/**
 * Given raw dependency check results, compute a human-readable risk label.
 *
 * @param {number} vulnerableCount
 * @param {number} outdatedCount
 * @returns {'Clean'|'Low Risk'|'Medium'|'High Risk'}
 */
function computeRiskLabel(vulnerableCount, outdatedCount) {
  if (vulnerableCount >= 2)                             return 'High Risk';
  if (vulnerableCount === 1 || outdatedCount >= 3)      return 'Medium';
  if (outdatedCount >= 1)                               return 'Low Risk';
  return 'Clean';
}

/**
 * Format a deps object into a short display string.
 * Returns null if deps is null (no package.json found).
 *
 * @param {{ vulnerableCount: number, outdatedCount: number, riskLabel: string }|null} deps
 * @returns {string|null}
 */
function formatDepsLabel(deps) {
  if (!deps) return null;
  if (deps.riskLabel === 'Clean') return '📦 Deps: Clean';

  const parts = [];
  if (deps.outdatedCount > 0)   parts.push(`${deps.outdatedCount} outdated`);
  if (deps.vulnerableCount > 0) parts.push(`${deps.vulnerableCount} vulnerable`);
  return `📦 Deps: ${parts.join(', ')}`;
}

if (typeof module !== 'undefined') {
  module.exports = { computeRiskLabel, formatDepsLabel };
}
