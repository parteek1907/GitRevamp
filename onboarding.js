/* â”€â”€ Onboarding â†” Extension Wiring â”€â”€ */

(function () {
  'use strict';

  var step1CompletedInSession = false;

  function getRoot() {
    return document.getElementById('root') || document.body;
  }

  function getOnboardingCards() {
    return Array.from(getRoot().querySelectorAll('.glass-card.glow-border'));
  }

  function updateStepHeading(container, fromText, toText) {
    var headings = Array.from(container.querySelectorAll('h3'));
    var heading = headings.find(function (node) {
      return ((node.textContent || '').trim() === fromText);
    });
    if (heading) {
      heading.textContent = toText;
    }
  }

  function updateStepNumber(container, fromText, toText) {
    var labels = Array.from(container.querySelectorAll('span'));
    var label = labels.find(function (node) {
      return ((node.textContent || '').trim() === fromText);
    });
    if (label) {
      label.textContent = toText;
    }
  }

  function normalizeOnboardingSteps() {
    var cards = getOnboardingCards();
    if (cards.length < 2) return false;

    var connectCard = cards.find(function (card) {
      return (card.textContent || '').includes('Connect GitHub')
        || (card.textContent || '').includes('Allow GitHub Access');
    });

    if (connectCard) {
      connectCard.remove();
    }

    cards = getOnboardingCards();

    var tokenCard = cards.find(function (card) {
      return (card.textContent || '').includes('Personal Access Token');
    });
    if (tokenCard) {
      updateStepNumber(tokenCard, '02', '01');
      updateStepHeading(tokenCard, 'Optional: Add Personal Access Token', 'Step 1: Access Token');
    }

    var featuresSection = Array.from(getRoot().querySelectorAll('div.py-12')).find(function (section) {
      return (section.textContent || '').includes('Enable Features');
    });
    if (featuresSection) {
      updateStepHeading(featuresSection, 'Step 3: Enable Features', 'Step 2: Enable Features');
    }

    return true;
  }

  function normalizeIntroToStepSpacing() {
    var root = getRoot();
    var introText = Array.from(root.querySelectorAll('p')).find(function (el) {
      return (el.textContent || '').includes('GitRevamp enhances your GitHub experience');
    });
    if (!introText) return;

    // Match intro->Step1 spacing with the card-to-card spacing used in the step section.
    var heroSection = introText.closest('section');
    if (heroSection) {
      heroSection.style.paddingBottom = '0';
    }
    introText.style.marginBottom = '0';

    var stepSection = Array.from(root.querySelectorAll('section')).find(function (el) {
      var text = ((el.textContent || '').toLowerCase());
      return text.includes('step 1') && text.includes('access token');
    });
    if (stepSection) {
      stepSection.style.paddingTop = '3.5rem';
    }
  }

  function getStep2Section() {
    return Array.from(getRoot().querySelectorAll('div.py-12')).find(function (el) {
      return (el.textContent || '').includes('Enable Features');
    }) || null;
  }

  function getFinalSection() {
    return Array.from(getRoot().querySelectorAll('div.py-24.text-center')).find(function (el) {
      return (el.textContent || '').includes("You're all set!");
    }) || null;
  }

  function setStepFlowVisibility(step1Done) {
    var step2 = getStep2Section();
    var finalSection = getFinalSection();
    if (step2) step2.style.display = step1Done ? '' : 'none';
    // Final section always hidden until "All Set!" is clicked
    if (finalSection) finalSection.style.display = 'none';
  }

  function markStep2Completed() {
    var finalSection = getFinalSection();
    if (finalSection) {
      finalSection.style.display = '';
      requestAnimationFrame(function () {
        smoothScrollTo(finalSection);
      });
    }
  }

  function injectAllSetButton() {
    var step2 = getStep2Section();
    if (!step2 || step2.querySelector('.ghh-allset-btn')) return;

    var btn = document.createElement('button');
    btn.className = 'ghh-allset-btn bg-primary hover:bg-primary/90 text-white text-sm font-semibold h-14 px-10 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer';
    btn.style.margin = '2.5rem auto 0';
    btn.textContent = 'All Set!';

    btn.addEventListener('click', function () {
      markStep2Completed();
    });

    step2.appendChild(btn);
  }

  function smoothScrollTo(element) {
    var targetY = element.getBoundingClientRect().top + window.pageYOffset - (window.innerHeight / 2) + (element.offsetHeight / 2);
    var startY = window.pageYOffset;
    var diff = targetY - startY;
    var duration = 800;
    var startTime = null;

    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var elapsed = timestamp - startTime;
      var progress = Math.min(elapsed / duration, 1);
      var ease = easeInOutCubic(progress);
      window.scrollTo(0, startY + diff * ease);
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }

    requestAnimationFrame(step);
  }

  function markStep1Completed() {
    step1CompletedInSession = true;
    setStepFlowVisibility(true);
    var step2 = getStep2Section();
    if (step2) {
      requestAnimationFrame(function () {
        smoothScrollTo(step2);
      });
    }
  }

  function initializeStepFlow() {
    // Hide later steps until the user explicitly completes Step 1 (Validate or Skip) this session.
    setStepFlowVisibility(false);
  }

  // React renders asynchronously; wait for buttons to appear
  var retries = 0;
  var timer = setInterval(function () {
    retries++;
    var stepsReady = normalizeOnboardingSteps();
    normalizeIntroToStepSpacing();
    if ((stepsReady && (findButton('Validate') || findButton('Skip'))) || retries > 40) {
      clearInterval(timer);
      normalizeOnboardingSteps();
      normalizeIntroToStepSpacing();
      initializeStepFlow();
      injectAllSetButton();
      attachInteractions();
    }
  }, 150);

  function getButtons() {
    return Array.from(document.querySelectorAll('button'));
  }

  function findButton(label) {
    var needle = (label || '').toLowerCase();
    return getButtons().find(function (btn) {
      return (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase().includes(needle);
    }) || null;
  }

  function findTokenInput() {
    return document.querySelector('input[type="password"]');
  }

  function getFeatureRows() {
    return Array.from(document.querySelectorAll('div.group')).filter(function (el) {
      return el.className.includes('justify-between') && (el.textContent || '').trim().length;
    });
  }

  function collectSettingsFromFeatureRows() {
    var map = {
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

    var settings = {};
    var rows = getFeatureRows();
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var label = Object.keys(map).find(function (text) {
        return (row.textContent || '').includes(text);
      });
      if (!label) continue;
      var knob = row.querySelector('.w-10.h-6');
      var enabled = knob ? knob.className.includes('bg-primary') : true;
      settings[map[label]] = enabled;
    }
    return settings;
  }

  function showFeedback(btn, message, isError) {
    var card = btn.closest('.glass-card') || btn.closest('[class*="rounded-2xl"]') || btn.parentElement;
    var rowHost = btn.parentElement;

    // Prefer placing feedback below the full token row (input + action buttons).
    var probe = btn.parentElement;
    while (probe && probe !== card && probe !== document.body) {
      if (probe.querySelector && probe.querySelector('input[type="password"]')) {
        rowHost = probe;
        break;
      }
      probe = probe.parentElement;
    }

    Array.from((card || rowHost).querySelectorAll('.ghh-onboard-feedback')).forEach(function (node) {
      node.remove();
    });

    var el = document.createElement('div');
    el.className = 'ghh-onboard-feedback';
    el.textContent = message;
    Object.assign(el.style, {
      marginTop: '12px',
      fontSize: '13px',
      fontWeight: '600',
      color: isError ? '#f85149' : '#3fb950',
      textAlign: 'center',
      width: '100%'
    });

    if (rowHost && rowHost.parentElement) {
      rowHost.insertAdjacentElement('afterend', el);
    } else {
      (card || btn.parentElement).appendChild(el);
    }

    setTimeout(function () { if (el.parentElement) el.remove(); }, 5000);
  }

  async function validateTokenWithAPI(token) {
    try {
      var resp = await fetch('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token
        }
      });
      if (!resp.ok) return { valid: false, user: null };
      var data = await resp.json();
      return { valid: true, user: data.login || 'unknown' };
    } catch (_e) {
      return { valid: false, user: null };
    }
  }

  function attachInteractions() {
    var validateBtn = findButton('Validate');
    var skipBtn = findButton('Skip');
    var startBtn = findButton('Start Using Your Revamped Github');
    var settingsBtn = findButton('Open Settings');
    var tokenInput = findTokenInput();

    if (validateBtn) {
      validateBtn.addEventListener('click', async function () {
        var token = tokenInput ? tokenInput.value.trim() : '';
        if (!token) {
          showFeedback(validateBtn, 'Please enter a token', true);
          return;
        }
        var validFormat = /^(ghp_|github_pat_)[A-Za-z0-9_]{20,}$/.test(token);
        if (!validFormat) {
          showFeedback(validateBtn, 'Invalid token format', true);
          return;
        }

        validateBtn.disabled = true;
        var origText = validateBtn.textContent;
        validateBtn.textContent = 'Validating...';

        var result = await validateTokenWithAPI(token);

        validateBtn.disabled = false;
        validateBtn.textContent = origText;

        if (result.valid) {
          // Save token via the extension's SET_SETTINGS message so it goes to the correct PAT_KEY
          await chrome.runtime.sendMessage({
            type: 'SET_SETTINGS',
            payload: { github_pat: token }
          }).catch(function () {});
          markStep1Completed();
          showFeedback(validateBtn, 'Token saved! Authenticated as ' + result.user, false);
        } else {
          showFeedback(validateBtn, 'Token invalid or expired', true);
        }
      });
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', function () {
        if (tokenInput) tokenInput.value = '';
        markStep1Completed();
        showFeedback(skipBtn, 'Skipped - you can add a token later in settings', false);
      });

      // Insert "How to get key" button next to Skip
      var howBtn = document.createElement('button');
      howBtn.textContent = 'How to get key?';
      Object.assign(howBtn.style, {
        padding: '6px 16px', height: '56px', borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.15)', background: 'transparent',
        color: '#58a6ff', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
        whiteSpace: 'nowrap'
      });
      skipBtn.parentElement.appendChild(howBtn);

      howBtn.addEventListener('click', function () {
        if (document.getElementById('ghh-token-guide')) {
          document.getElementById('ghh-token-guide').remove();
          return;
        }
        var guide = document.createElement('div');
        guide.id = 'ghh-token-guide';
        Object.assign(guide.style, {
          marginTop: '12px', padding: '16px 20px', borderRadius: '12px',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
          fontSize: '13px', lineHeight: '1.7', color: '#c9d1d9'
        });
        guide.innerHTML =
          '<strong style="color:#e6edf3;font-size:14px">Get a Personal Access Token</strong><br>' +
          '<span style="color:#8b949e">1.</span> Open <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener" style="color:#58a6ff;text-decoration:underline">GitHub Token Settings</a><br>' +
          '<span style="color:#8b949e">2.</span> Click <strong>Generate new token</strong> -> <strong>Fine-grained token</strong><br>' +
          '<span style="color:#8b949e">3.</span> Name: <code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:4px">GitRevamp Extension</code><br>' +
          '<span style="color:#8b949e">4.</span> Repository access: <strong>All repositories</strong> <span style="color:#8b949e">(or Public only if you don\'t need private repo insights)</span><br>' +
          '<span style="color:#8b949e">5.</span> Permissions (read-only): <strong>Metadata, Contents, Pull requests, Issues</strong><br>' +
          '<span style="color:#8b949e">6.</span> Click <strong>Generate token</strong>, copy & paste it above<br>' +
          '<div style="margin-top:8px;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:8px;color:#8b949e;font-size:12px">' +
          'Keep your token private. Revoke anytime at <a href="https://github.com/settings/tokens" target="_blank" rel="noopener" style="color:#58a6ff">github.com/settings/tokens</a></div>';

        // Insert guide below the input row
        var card = skipBtn.closest('.glass-card') || skipBtn.closest('[class*="rounded-2xl"]') || skipBtn.parentElement.parentElement;
        card.appendChild(guide);
      });
    }

    if (startBtn) {
      startBtn.addEventListener('click', async function () {
        var payload = collectSettingsFromFeatureRows();
        await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', payload: payload }).catch(function () {});
        await chrome.storage.local.set({ ghh_onboarding_complete: true });
        chrome.tabs.create({ url: 'https://github.com' });
      });
    }

    if (settingsBtn) {
      settingsBtn.addEventListener('click', async function () {
        var payload = collectSettingsFromFeatureRows();
        await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', payload: payload }).catch(function () {});
        await chrome.storage.local.set({ ghh_onboarding_complete: true });
        if (chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
          return;
        }
        window.close();
      });
    }
  }
})();

