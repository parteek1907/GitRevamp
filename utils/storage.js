// utils/storage.js — chrome.storage.local helpers used by popup.js

/**
 * Promisified wrapper for chrome.storage.local.get.
 * @param {string|string[]|null} keys
 * @returns {Promise<object>}
 */
function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

/**
 * Promisified wrapper for chrome.storage.local.set.
 * @param {object} items
 * @returns {Promise<void>}
 */
function storageSet(items) {
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}

/**
 * Promisified wrapper for chrome.storage.local.clear.
 * @returns {Promise<void>}
 */
function storageClear() {
  return new Promise(resolve => chrome.storage.local.clear(resolve));
}

/**
 * Return all recently scanned repos (health_ keys), sorted newest first.
 * @returns {Promise<Array<{ owner: string, repo: string, data: object }>>}
 */
async function getRecentlyScanned(limit = 5) {
  const all = await storageGet(null);
  const entries = [];

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith('health_')) continue;
    if (!value || !value.data || !value.timestamp) continue;

    const parts = key.slice('health_'.length).split('_');
    if (parts.length < 2) continue;
    const owner = parts[0];
    const repo  = parts.slice(1).join('_');

    entries.push({ owner, repo, data: value.data, scannedAt: value.timestamp });
  }

  entries.sort((a, b) => b.scannedAt - a.scannedAt);
  return entries.slice(0, limit);
}

/**
 * Return history entries for a specific repo.
 * @returns {Promise<Array<{ score: number, timestamp: number }>>}
 */
async function getRepoHistory(owner, repo) {
  const key = `history_${owner}_${repo}`;
  const result = await storageGet(key);
  return result[key] || [];
}

if (typeof module !== 'undefined') {
  module.exports = { storageGet, storageSet, storageClear, getRecentlyScanned, getRepoHistory };
}
