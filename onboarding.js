function getButtons() {
  return Array.from(document.querySelectorAll('button'));
}

function findButton(label) {
  return getButtons().find((btn) => (btn.textContent || '').replace(/\s+/g, ' ').trim().includes(label)) || null;
}

function findTokenInput() {
  return document.querySelector('input[type="password"]');
}

function getFeatureRows() {
  return Array.from(document.querySelectorAll('div.group')).filter((el) =>
    el.className.includes('justify-between') && (el.textContent || '').trim().length
  );
}

function collectSettingsFromFeatureRows() {
  const map = {
    'File Sizes & Download': 'showFileEnhancements',
    'Markdown Printer': 'showMarkdownPrinter',
    'Absolute Dates': 'showAbsoluteDates',
    'Health Sidebar Panel': 'showHealthSidebar',
    'Web IDE Button': 'showWebIDE',
    'LOC in Sidebar': 'showLOCSidebar',
    'VS Code Icons': 'showVSIcons',
    'Bus Factor Warning': 'showBusFactor',
    'License Risk Warning': 'showLicenseRisk'
  };

  const settings = {};
  for (const row of getFeatureRows()) {
    const label = Object.keys(map).find((text) => (row.textContent || '').includes(text));
    if (!label) continue;
    const knob = row.querySelector('.w-10.h-6');
    const enabled = knob ? knob.className.includes('bg-primary') : true;
    settings[map[label]] = enabled;
  }

  return settings;
}

function attachInteractions() {
  const connectBtn = findButton('Connect GitHub');
  const validateBtn = findButton('Validate');
  const skipBtn = findButton('Skip');
  const startBtn = findButton('Start Using GitHub');
  const settingsBtn = findButton('Open Settings');
  const tokenInput = findTokenInput();

  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://github.com/login' });
    });
  }

  if (validateBtn) {
    validateBtn.addEventListener('click', async () => {
      const token = tokenInput ? tokenInput.value.trim() : '';
      const valid = /^(ghp_|github_pat_)[A-Za-z0-9_]{20,}$/.test(token);
      if (!token || !valid) return;
      await chrome.storage.local.set({ githubToken: token });
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      if (tokenInput) tokenInput.value = '';
    });
  }

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      const payload = collectSettingsFromFeatureRows();
      await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', payload }).catch(() => undefined);
      await chrome.storage.local.set({ ghh_onboarding_complete: true });
      chrome.tabs.create({ url: 'https://github.com' });
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
      const payload = collectSettingsFromFeatureRows();
      await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', payload }).catch(() => undefined);
      await chrome.storage.local.set({ ghh_onboarding_complete: true });
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
        return;
      }
      chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    });
  }
}

attachInteractions();
