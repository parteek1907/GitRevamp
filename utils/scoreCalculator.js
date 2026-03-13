// utils/scoreCalculator.js — shared score logic (importable by popup if needed)

/**
 * Categorise a numeric score into a color tier.
 * @param {number} score
 * @returns {'green'|'yellow'|'red'}
 */
function getColorClass(score) {
  if (score >= 7) return 'green';
  if (score >= 4) return 'yellow';
  return 'red';
}

/**
 * Format a large number for display (e.g. 21500 → "21.5k").
 * @param {number} n
 * @returns {string}
 */
function formatNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000)      return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

/**
 * Format milliseconds since epoch into a relative time string.
 * @param {number} ts  Unix timestamp in ms
 * @returns {string}   e.g. "3 hours ago", "2 days ago"
 */
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);

  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

/**
 * Build an inline SVG sparkline from an array of score values.
 * @param {number[]} scores   Array of 2–10 score values (0–10)
 * @param {'green'|'yellow'|'red'} colorClass
 * @returns {string}  SVG element HTML string
 */
function buildSparklineSVG(scores, colorClass) {
  if (!scores || scores.length < 2) return '';

  const W = 80;
  const H = 24;
  const pad = 2;

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;

  const pts = scores.map((v, i) => {
    const x = pad + (i / (scores.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const colorMap = { green: '#16a34a', yellow: '#ca8a04', red: '#dc2626' };
  const stroke = colorMap[colorClass] || '#888';

  return `<svg class="gh-health-sparkline" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="${pts.join(' ')}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

// Export for use in popup (via script tag) — also usable as module
if (typeof module !== 'undefined') {
  module.exports = { getColorClass, formatNum, timeAgo, buildSparklineSVG };
}
