let saveTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  bindActions();
  await loadSettings();
  await renderRateLimitFooter();
});

function bindActions() {
  document.getElementById('save-token')?.addEventListener('click', () => {
    saveToken().catch(logError);
  });

  const tokenInput = document.getElementById('github-token');
  tokenInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveToken().catch(logError);
  });

  const toggleIds = [
    'toggle-search', 'toggle-trending', 'toggle-deps', 'toggle-bus-factor', 'toggle-license-risk',
    'toggle-readme-toc', 'toggle-pr-complexity', 'toggle-todo', 'toggle-insights',
    'toggle-issue-age', 'toggle-file-icons', 'toggle-quick-clone', 'toggle-star-history', 'toggle-commit-quality',
    'toggle-file-enhancements', 'toggle-md-printer',
    'toggle-vsicons', 'toggle-webide', 'toggle-loc-sidebar', 'toggle-abs-dates', 'toggle-health-sidebar'
  ];
  toggleIds.forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      debouncedSave();
    });
  });

  document.getElementById('clear-cache')?.addEventListener('click', async () => {
    await sendMessage({ type: 'CLEAR_CACHED_DATA' });
    await renderRateLimitFooter();
  });

  document.getElementById('export-data')?.addEventListener('click', async () => {
    const response = await sendMessage({ type: 'GET_ALL_CACHE' });
    const json = JSON.stringify((response && response.data) || {}, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `gh-health-${date}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  });
}

function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveSettings().catch(logError);
  }, 300);
}

async function loadSettings() {
  const response = await sendMessage({ type: 'GET_SETTINGS' }).catch(() => ({ settings: {} }));
  const data = response.settings || {};

  setCheckbox('toggle-search', data.showOnSearch !== false);
  setCheckbox('toggle-trending', data.showOnTrending !== false);
  setCheckbox('toggle-deps', data.showDeps !== false);
  setCheckbox('toggle-bus-factor', data.showBusFactor !== false);
  setCheckbox('toggle-license-risk', data.showLicenseRisk !== false);
  setCheckbox('toggle-readme-toc', data.showReadmeToc !== false);
  setCheckbox('toggle-pr-complexity', data.showPrComplexity !== false);
  setCheckbox('toggle-todo', data.showTodoHighlights !== false);
  setCheckbox('toggle-insights', data.showContributionInsights !== false);
  setCheckbox('toggle-issue-age', data.showIssueAge !== false);
  setCheckbox('toggle-file-icons', data.showFileTypeIcons !== false);
  setCheckbox('toggle-quick-clone', data.showQuickClone !== false);
  setCheckbox('toggle-star-history', data.showStarHistory !== false);
  setCheckbox('toggle-commit-quality', data.showCommitQuality !== false);
  setCheckbox('toggle-file-enhancements', data.showFileEnhancements !== false);
  setCheckbox('toggle-md-printer', data.showMarkdownPrinter !== false);
  setCheckbox('toggle-vsicons', data.showVSIcons !== false);
  setCheckbox('toggle-webide', data.showWebIDE !== false);
  setCheckbox('toggle-loc-sidebar', data.showLOCSidebar !== false);
  setCheckbox('toggle-abs-dates', data.showAbsoluteDates !== false);
  setCheckbox('toggle-health-sidebar', data.showHealthSidebar !== false);

  updateTokenStatus(data.github_pat || '');
}

async function saveSettings() {
  const tokenInput = document.getElementById('github-token');
  const rawValue = (tokenInput?.value || '').trim();

  // If the field shows the masked placeholder, don't overwrite the stored token
  const existingResponse = await sendMessage({ type: 'GET_SETTINGS' }).catch(() => ({ settings: {} }));
  const existingPat = (existingResponse.settings || {}).github_pat || '';
  const githubPat = rawValue.includes('••••') ? existingPat : rawValue;

  await sendMessage({
    type: 'SET_SETTINGS',
    payload: {
      showOnSearch: isChecked('toggle-search'),
      showOnTrending: isChecked('toggle-trending'),
      showDeps: isChecked('toggle-deps'),
      showBusFactor: isChecked('toggle-bus-factor'),
      showLicenseRisk: isChecked('toggle-license-risk'),
      showReadmeToc: isChecked('toggle-readme-toc'),
      showPrComplexity: isChecked('toggle-pr-complexity'),
      showTodoHighlights: isChecked('toggle-todo'),
      showContributionInsights: isChecked('toggle-insights'),
      showIssueAge: isChecked('toggle-issue-age'),
      showFileTypeIcons: isChecked('toggle-file-icons'),
      showQuickClone: isChecked('toggle-quick-clone'),
      showStarHistory: isChecked('toggle-star-history'),
      showCommitQuality: isChecked('toggle-commit-quality'),
      showFileEnhancements: isChecked('toggle-file-enhancements'),
      showMarkdownPrinter: isChecked('toggle-md-printer'),
      showVSIcons: isChecked('toggle-vsicons'),
      showWebIDE: isChecked('toggle-webide'),
      showLOCSidebar: isChecked('toggle-loc-sidebar'),
      showAbsoluteDates: isChecked('toggle-abs-dates'),
      showHealthSidebar: isChecked('toggle-health-sidebar'),
      github_pat: githubPat
    }
  });
}

async function saveToken() {
  const tokenInput = document.getElementById('github-token');
  const rawValue = (tokenInput?.value || '').trim();
  if (!rawValue || rawValue.includes('••••')) return;

  await sendMessage({
    type: 'SET_SETTINGS',
    payload: { github_pat: rawValue }
  });

  updateTokenStatus(rawValue);
  await renderRateLimitFooter();
}

function updateTokenStatus(pat) {
  const statusEl = document.getElementById('token-status');
  if (!statusEl) return;

  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('.status-text');
  const tokenInput = document.getElementById('github-token');

  if (pat) {
    const last4 = pat.slice(-4);
    if (dot) { dot.className = 'status-dot status-dot--green'; }
    if (text) { text.textContent = 'Active'; text.className = 'status-text status-text--active'; }
    if (tokenInput) { tokenInput.value = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + last4; }
  } else {
    if (dot) { dot.className = 'status-dot status-dot--grey'; }
    if (text) { text.textContent = 'Not set'; text.className = 'status-text'; }
    if (tokenInput) { tokenInput.value = ''; }
  }
}

async function renderRateLimitFooter() {
  const status = document.getElementById('rate-limit-status');
  if (!status) return;
  status.innerHTML = '';

  const response = await sendMessage({ type: 'GET_RATE_LIMIT' }).catch(() => ({ rateLimit: null }));
  const rateLimit = response.rateLimit;

  if (!rateLimit || typeof rateLimit.remaining !== 'number' || typeof rateLimit.limit !== 'number') {
    return;
  }

  const line = document.createElement('div');
  line.className = 'rate-line';

  if (rateLimit.remaining === 0) {
    const minutes = rateLimit.reset ? Math.max(1, Math.ceil(((rateLimit.reset * 1000) - Date.now()) / 60000)) : 0;
    line.classList.add('rate-line-danger');
    line.textContent = `Rate limited \u2014 resets in ${minutes}m`;
  } else if (rateLimit.remaining <= 20) {
    line.classList.add('rate-line-warn');
    line.textContent = `API limit low: ${rateLimit.remaining} left`;
  } else {
    line.classList.add('rate-line-ok');
    line.textContent = `API: ${rateLimit.remaining}/${rateLimit.limit} calls left`;
  }

  status.appendChild(line);
}

/* ── Utilities ── */

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        const error = new Error(chrome.runtime.lastError.message || 'UNKNOWN_RUNTIME_ERROR');
        if (isExpectedRuntimeError(error)) {
          resolve({ success: false, error: error.message });
          return;
        }
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

function isChecked(id) {
  return Boolean(document.getElementById(id)?.checked);
}

function setCheckbox(id, value) {
  const input = document.getElementById(id);
  if (input) input.checked = value;
}

function isExpectedRuntimeError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('Extension context invalidated')
    || message.includes('Receiving end does not exist');
}

function logError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (isExpectedRuntimeError(error)) return;
  console.error('[GH Health]', message);
}
