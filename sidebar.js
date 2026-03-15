/* ════════════════════════════════════════════════════════════════════════════
  GitRevamp — Collapsible Left Sidebar
  Plain content script, no modules. Loaded after content.js.
  ════════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const SIDEBAR_ID = 'ghh-sidebar';
  const STORAGE_KEY = 'ghh_sidebar_open';
  const POLL_INTERVAL = 500;

  let currentPath = location.pathname;
  let sidebarEl = null;
  let panelScrollEl = null;
  let isExpanded = false;
  let sidebarEnabled = true;

  function detectSidebarTop() {
    const selectors = [
      '.repository-content',
      '[data-testid="repository-container-header"]',
      'main'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY;
        if (top > 0) return Math.round(top);
      }
    }
    return 130;
  }

  function applySidebarTop() {
    if (!sidebarEl) return;
    const top = detectSidebarTop();
    sidebarEl.style.top = top + 'px';
    sidebarEl.style.height = 'calc(100vh - ' + top + 'px)';
  }

  /* ── Helpers ── */

  function sidebarSendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    });
  }

  function parseRepoFromPath(path) {
    const parts = (path || '').replace(/^\//, '').split('/');
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1];
    const BUILTIN = [
      'about', 'apps', 'blog', 'collections', 'contact', 'customer-stories',
      'enterprise', 'events', 'explore', 'features', 'github-copilot', 'issues',
      'join', 'login', 'marketplace', 'new', 'notifications', 'orgs',
      'organizations', 'pricing', 'pulls', 'search', 'security', 'settings',
      'site', 'sponsors', 'team', 'teams', 'topics', 'trending'
    ];
    if (BUILTIN.includes(owner.toLowerCase())) return null;
    if (repo.startsWith('.')) return null;
    return { owner, repo };
  }

  async function getSidebarEnabledSetting() {
    try {
      const resp = await sidebarSendMessage({ type: 'GET_SETTINGS' });
      const cfg = resp && resp.settings ? resp.settings : {};
      return cfg.showHealthSidebar !== false;
    } catch (_err) {
      return true;
    }
  }

  function applySidebarVisibility() {
    if (!sidebarEl) return;
    sidebarEl.style.display = sidebarEnabled ? '' : 'none';
  }

  function formatNumber(n) {
    if (n == null) return '-';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 30) return days + 'd ago';
    const months = Math.floor(days / 30);
    return months + 'mo ago';
  }

  function scoreColor(score) {
    if (score >= 7) return 'green';
    if (score >= 4) return 'yellow';
    return 'red';
  }

  function scoreHex(score) {
    if (score >= 7) return '#3fb950';
    if (score >= 4) return '#d29922';
    return '#f85149';
  }

  /* ── SVG Helpers ── */

  function buildScoreRing(score) {
    const radius = 26;
    const circumference = 2 * Math.PI * radius;
    const pct = Math.min(score, 10) / 10;
    const dashLen = circumference * pct;
    const gap = circumference - dashLen;
    const color = scoreHex(score);

    return `
      <svg class="ghh-score-donut-svg" viewBox="0 0 64 64">
        <circle class="ghh-score-donut-track" cx="32" cy="32" r="${radius}" />
        <circle class="ghh-score-donut-ring" cx="32" cy="32" r="${radius}"
          stroke="${color}"
          stroke-dasharray="0 ${circumference}"
          transform="rotate(-90 32 32)" />
        <text class="ghh-score-donut-value" x="32" y="36" text-anchor="middle">${score}</text>
      </svg>`;
  }

  function animateRing(svgEl, score) {
    const ring = svgEl.querySelector('.ghh-score-donut-ring');
    if (!ring) return;
    const radius = 26;
    const circumference = 2 * Math.PI * radius;
    const dashLen = circumference * (Math.min(score, 10) / 10);
    const gap = circumference - dashLen;
    requestAnimationFrame(() => {
      ring.style.strokeDasharray = dashLen.toFixed(1) + ' ' + gap.toFixed(1);
    });
  }

  function buildSparklineSvg(points) {
    if (!points || points.length < 2) {
      return '<svg class="ghh-sparkline-svg" width="100%" height="40" viewBox="0 0 200 40"></svg>';
    }
    const w = 200;
    const h = 40;
    const pad = 4;
    const maxY = Math.max(...points.map((p) => p.y));
    const minY = Math.min(...points.map((p) => p.y));
    const range = maxY - minY || 1;
    const coords = points.map((p, i) => {
      const x = pad + (i / (points.length - 1)) * (w - pad * 2);
      const y = h - pad - ((p.y - minY) / range) * (h - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    return `<svg class="ghh-sparkline-svg" width="100%" height="40" viewBox="0 0 ${w} ${h}" fill="none">
      <polyline points="${coords.join(' ')}" stroke="#58a6ff" stroke-width="1.5"
        stroke-linejoin="round" stroke-linecap="round" />
    </svg>`;
  }

  /* ── DOM Creation ── */

  function createSidebarDOM() {
    const el = document.createElement('div');
    el.id = SIDEBAR_ID;
    el.className = 'ghh-sidebar';

    el.innerHTML = `
      <!-- Icon strip (visible when collapsed) -->
      <div class="ghh-icon-strip">
        <button class="ghh-icon-btn" data-tooltip="Health Score" data-action="open-health">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11Zm-.75-8h1.5v3.25H12v1.5H7.25Z"/></svg>
        </button>
        <button class="ghh-icon-btn" data-tooltip="Watchlist" data-action="open-watchlist">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.671 13.008 9.981 14 8 14s-3.671-.992-4.933-2.078C1.797 10.831.88 9.577.43 8.899a1.62 1.62 0 0 1 0-1.798c.45-.678 1.367-1.932 2.637-3.023C4.329 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5s2.824-.742 3.955-1.715c1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5S5.176 4.242 4.045 5.215C2.92 6.182 2.09 7.311 1.679 7.932ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z"/></svg>
        </button>
        <button class="ghh-icon-btn" data-tooltip="Notifications" data-action="open-notifications">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 16a2 2 0 0 0 1.985-1.75H6.015A2 2 0 0 0 8 16ZM8 1.5A4.502 4.502 0 0 0 3.5 6c0 .97-.266 2.824-.876 4.357A7 7 0 0 1 2 12h12a7 7 0 0 1-.624-1.643C12.766 8.824 12.5 6.97 12.5 6A4.5 4.5 0 0 0 8 1.5Z"/></svg>
          <span class="ghh-icon-badge" id="ghh-notif-badge" style="display:none"></span>
        </button>
      </div>

      <!-- Expanded panel -->
      <div class="ghh-panel">
        <!-- Header -->
        <div class="ghh-header">
          <span class="ghh-pulse-dot" id="ghh-pulse"></span>
          <span class="ghh-header-title">Repo Health</span>
          <button class="ghh-header-close" data-action="toggle" title="Collapse">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 1 1 1.06 1.06L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z"/></svg>
          </button>
        </div>

        <!-- Scrollable content -->
        <div class="ghh-panel-scroll" id="ghh-panel-scroll">
          <!-- Health Score Section -->
          <div class="ghh-section-repo-only" id="ghh-section-health">
            <div class="ghh-section-title">Health Score</div>
            <div class="ghh-score-wrap" id="ghh-score-wrap">
              <div class="ghh-loading-text">Loading...</div>
            </div>
          </div>

          <div class="ghh-divider ghh-section-repo-only"></div>

          <!-- Breakdown Bars -->
          <div class="ghh-section-repo-only" id="ghh-section-breakdown">
            <div class="ghh-section-title">Breakdown</div>
            <div class="ghh-breakdown" id="ghh-breakdown"></div>
          </div>

          <div class="ghh-divider ghh-section-repo-only"></div>

          <!-- Signals -->
          <div class="ghh-section-repo-only" id="ghh-section-signals">
            <div class="ghh-section-title">Signals</div>
            <div class="ghh-signals" id="ghh-signals"></div>
          </div>

          <div class="ghh-divider"></div>

          <!-- Watchlist -->
          <div id="ghh-section-watchlist">
            <div class="ghh-section-title">Watchlist</div>
            <div class="ghh-watchlist" id="ghh-watchlist">
              <div class="ghh-loading-text">Loading...</div>
            </div>
          </div>

          <div class="ghh-divider"></div>

          <!-- Recent Repos -->
          <div id="ghh-section-recent">
            <div class="ghh-section-title">Recent Repos</div>
            <div class="ghh-recent" id="ghh-recent">
              <div class="ghh-loading-text">Loading...</div>
            </div>
          </div>
          <!-- Actions -->
          <div class="ghh-actions-section">
            <div class="ghh-actions-divider"></div>
            <div class="ghh-actions-row">
              <button class="ghh-action-btn" data-tooltip="Refresh" data-action="refresh" title="Refresh data">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.07-1.07A7 7 0 0 1 1.049 8.84a.75.75 0 0 1 .656-.834ZM14.295 7.995a.75.75 0 0 1-.834-.656 5.5 5.5 0 0 0-9.592-2.97l1.204 1.204a.25.25 0 0 1-.177.427H1.25a.25.25 0 0 1-.25-.25V2.104a.25.25 0 0 1 .427-.177l1.07 1.07a7 7 0 0 1 12.553 4.341.75.75 0 0 1-.656.834v-.177Z"/></svg>
              </button>
            </div>
          </div>
          <div class="ghh-scroll-bottom-pad"></div>
        </div>
      </div>
      <!-- Toggle chevron -->
      <button class="ghh-toggle-chevron" id="ghh-toggle-btn" data-action="toggle" title="Toggle sidebar">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 3.5a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 0 1-1.4-1.4L8.8 8 5.5 4.5a1 1 0 0 1 0-1Z" fill-rule="evenodd"/></svg>
      </button>`;

    return el;
  }

  /* ── Toggle Logic ── */

  function toggleSidebar(forceState) {
    const el = document.getElementById(SIDEBAR_ID);
    if (!el) return;
    const currentlyOpen = el.classList.contains('ghh-open');
    const open = typeof forceState === 'boolean' ? forceState : !currentlyOpen;
    isExpanded = open;

    // Update DOM first
    if (open) {
      el.classList.add('ghh-open');
      el.classList.remove('ghh-closed');
    } else {
      el.classList.remove('ghh-open');
      el.classList.add('ghh-closed');
    }

    // Then persist
    chrome.storage.local.set({ [STORAGE_KEY]: open });

    if (open) {
      refreshSidebarData();
    }
  }

  function attachToggleListener() {
    const btn = document.getElementById('ghh-toggle-btn');
    if (!btn) return;
    if (window.__ghhToggleHandler) {
      btn.removeEventListener('click', window.__ghhToggleHandler);
    }
    window.__ghhToggleHandler = function (e) {
      e.stopPropagation();
      toggleSidebar();
    };
    btn.addEventListener('click', window.__ghhToggleHandler);
  }

  /* ── Data Loading ── */

  async function refreshSidebarData() {
    if (!sidebarEnabled || !sidebarEl) return;

    const parsed = parseRepoFromPath(location.pathname);
    const isRepo = Boolean(parsed);

    sidebarEl.classList.toggle('ghh-sidebar--reduced', !isRepo);

    const pulse = document.getElementById('ghh-pulse');
    if (pulse) pulse.classList.toggle('ghh-pulse-dot--active', isRepo);

    if (isRepo) {
      loadHealthScore(parsed.owner, parsed.repo);
    }

    loadWatchlist();
    loadRecentRepos();
    loadNotifications();
  }

  async function loadHealthScore(owner, repo) {
    const scoreWrap = document.getElementById('ghh-score-wrap');
    const breakdown = document.getElementById('ghh-breakdown');
    const signals = document.getElementById('ghh-signals');

    if (scoreWrap) scoreWrap.innerHTML = '<div class="ghh-loading-text">Loading...</div>';

    try {
      const resp = await sidebarSendMessage({
        type: 'GET_REPO_HEALTH',
        payload: { owner, repo, recordRecent: true }
      });

      if (!resp || !resp.data) {
        if (scoreWrap) scoreWrap.innerHTML = '<div class="ghh-empty">No data available</div>';
        return;
      }

      const d = resp.data;

      if (d.error) {
        const msg = d.error === 'RATE_LIMITED' ? 'Rate limited'
          : d.error === 'NOT_FOUND' ? 'Repo not found'
          : d.error === 'AUTH_ERROR' ? 'Token invalid'
          : 'Error loading data';
        if (scoreWrap) scoreWrap.innerHTML = '<div class="ghh-empty">' + msg + '</div>';
        return;
      }

      renderHealthScore(d, scoreWrap);
      renderBreakdown(d, breakdown);
      renderSignals(d, signals);
    } catch (err) {
      if (scoreWrap) scoreWrap.innerHTML = '<div class="ghh-empty">Failed to load</div>';
    }
  }

  function renderHealthScore(d, wrap) {
    if (!wrap) return;
    const score = d.score != null ? d.score : 0;
    const grade = d.grade || '';
    const gradeClass = grade.startsWith('A') ? 'green' : grade.startsWith('B') ? 'blue'
      : grade.startsWith('C') ? 'yellow' : 'red';
    wrap.innerHTML = `
      <div class="ghh-score-donut" id="ghh-donut">${buildScoreRing(score)}</div>
      <div class="ghh-score-meta">
        <div class="ghh-score-grade-row">
          <span class="ghh-score-status">${d.status || 'Unknown'}</span>
          <span class="ghh-score-grade ghh-score-grade--${gradeClass}">${grade}</span>
        </div>
        <span class="ghh-score-sub">${formatNumber(d.stars)} stars &middot; ${formatNumber(d.openIssues)} issues${d.primaryLanguage ? ' &middot; ' + d.primaryLanguage : ''}</span>
        <span class="ghh-score-sub">${d.daysSinceLast != null ? d.daysSinceLast + 'd since push' : ''}${d.isArchived ? ' · Archived' : ''}${d.isFork ? ' · Fork' : ''}</span>
      </div>`;

    const svg = wrap.querySelector('.ghh-score-donut-svg');
    if (svg) {
      requestAnimationFrame(() => animateRing(svg, score));
    }
  }

  function renderBreakdown(d, container) {
    if (!container) return;
    const bars = [
      { label: 'Commit Activity',    value: d.pillarActivity,       max: 20, icon: '⚡' },
      { label: 'Community',          value: d.pillarCommunity,      max: 15, icon: '👥' },
      { label: 'Responsiveness',     value: d.pillarResponsiveness, max: 15, icon: '🔁' },
      { label: 'Popularity',         value: d.pillarPopularity,     max: 15, icon: '⭐' },
      { label: 'Release Health',     value: d.pillarRelease,        max: 10, icon: '🏷️' },
      { label: 'Governance',         value: d.pillarGovernance,     max: 10, icon: '📋' },
      { label: 'Maturity',           value: d.pillarMaturity,       max: 15, icon: '🏛️' },
    ];

    container.innerHTML = bars.map((b) => {
      const pct = Math.min(100, ((b.value || 0) / b.max) * 100).toFixed(0);
      const color = scoreColor((b.value || 0) / b.max * 10);
      return `
        <div class="ghh-bar-row">
          <div class="ghh-bar-header">
            <span class="ghh-bar-label">${b.icon} ${b.label}</span>
            <span class="ghh-bar-value">${b.value != null ? b.value : '-'} / ${b.max}</span>
          </div>
          <div class="ghh-bar-track">
            <div class="ghh-bar-fill ghh-bar-fill--${color}" style="width:${pct}%"></div>
          </div>
        </div>`;
    }).join('');
  }

  function renderSignals(d, container) {
    if (!container) return;

    function badge(val, type) {
      const map = {
        fast: 'green', moderate: 'blue', slow: 'yellow',
        'low risk': 'green', 'moderate': 'yellow', 'high risk': 'red',
        fresh: 'green', recent: 'blue', aging: 'yellow', stale: 'red',
        permissive: 'green', copyleft: 'yellow', unknown: 'yellow', unlicensed: 'red',
        'very active': 'green', active: 'blue', slow: 'yellow', inactive: 'red',
      };
      const color = map[(val || '').toLowerCase()] || 'muted';
      return `<span class="ghh-badge ghh-badge--${color}">${val || '—'}</span>`;
    }

    const rows = [
      { label: 'Top Contributor',value: d.topContributorLogin
          ? `${d.topContributorLogin} (${d.topContributorShare != null ? Math.round(d.topContributorShare) + '%' : '?'})`
          : '—', raw: null },
      { label: 'Commit Consistency', value: d.commitConsistencyPct != null
          ? `${d.commitConsistencyPct}% (${d.activeWeeksOf12 || 0}/12 wks)`
          : '—', raw: null },
      { label: 'Avg Commits/wk', value: d.avgCommitsPerWeek != null ? d.avgCommitsPerWeek : '—', raw: null },
      { label: 'Velocity',       value: null, badge: badge(d.velocityLabel || 'unknown', 'velocity') },
      { label: 'Issue Close',    value: d.avgIssueCloseDays != null ? d.avgIssueCloseDays + 'd avg' : '—', raw: null },
      { label: 'PR Merge',       value: d.avgPRMergeDays != null ? d.avgPRMergeDays + 'd avg' : '—', raw: null },
      { label: 'Bus Factor',     value: null, badge: badge(d.busFactor || 'unknown', 'bus') },
      { label: 'License',        value: null, badge: badge(d.licenseName || d.licenseRisk || 'unknown', 'license') },
      { label: 'Latest Release', value: d.latestVersion || '—', raw: null },
      { label: 'Release Status', value: null, badge: badge(d.releaseLabel || 'unknown', 'release') },
      { label: 'Repo Age',       value: d.repoAgeMonths != null
          ? (d.repoAgeMonths >= 12 ? Math.floor(d.repoAgeMonths / 12) + 'y ' + (d.repoAgeMonths % 12) + 'mo' : d.repoAgeMonths + ' mo')
          : '—', raw: null },
      { label: 'Has Topics',     value: d.hasTopics ? 'Yes' : 'No', raw: null },
    ];

    container.innerHTML = rows.map((r) =>
      `<div class="ghh-signal-row">
        <span class="ghh-signal-label">${r.label}</span>
        <span class="ghh-signal-value">${r.badge != null ? r.badge : (r.value != null ? r.value : '—')}</span>
      </div>`
    ).join('');
  }



  async function loadWatchlist() {
    const container = document.getElementById('ghh-watchlist');
    if (!container) return;

    try {
      const resp = await sidebarSendMessage({ type: 'GET_WATCHLIST' });
      const list = (resp && resp.watchlist) || [];
      const scores = (resp && resp.watchlistScores) || {};

      if (list.length === 0) {
        container.innerHTML = '<div class="ghh-empty">No repos watched</div>';
        return;
      }

      container.innerHTML = list.map((item) => {
        const key = item.owner + '/' + item.repo;
        const info = scores[key];
        const sc = info && info.currentScore != null ? info.currentScore : null;
        const color = sc != null ? scoreColor(sc) : '';
        const badge = sc != null
          ? '<span class="ghh-watch-score ghh-watch-score--' + color + '">' + sc + '</span>'
          : '';
        return `<div class="ghh-watch-row" data-href="/${key}">
          <span class="ghh-watch-name">${key}</span>
          ${badge}
        </div>`;
      }).join('');
    } catch (_) {
      container.innerHTML = '<div class="ghh-empty">Failed to load</div>';
    }
  }

  async function loadRecentRepos() {
    const container = document.getElementById('ghh-recent');
    if (!container) return;

    try {
      const resp = await sidebarSendMessage({ type: 'GET_RECENT_REPOS' });
      const list = (resp && resp.recentRepos) || [];

      if (list.length === 0) {
        container.innerHTML = '<div class="ghh-empty">No recent repos</div>';
        return;
      }

      container.innerHTML = list.slice(0, 8).map((item) => {
        const name = item.owner + '/' + item.repo;
        return `<div class="ghh-recent-row" data-href="/${name}">
          <span class="ghh-recent-name"><a href="/${name}">${name}</a></span>
          <span class="ghh-recent-time">${timeAgo(item.visitedAt)}</span>
        </div>`;
      }).join('');
    } catch (_) {
      container.innerHTML = '<div class="ghh-empty">Failed to load</div>';
    }
  }

  async function loadNotifications() {
    const badge = document.getElementById('ghh-notif-badge');

    try {
      const resp = await sidebarSendMessage({ type: 'GET_NOTIFICATIONS' });
      const data = resp && resp.data;
      if (!data || !data.groups) {
        if (badge) badge.style.display = 'none';
        return;
      }

      let total = 0;
      data.groups.forEach((g) => { total += (g.notifications || []).length; });

      if (badge) {
        if (total > 0) {
          badge.textContent = total > 99 ? '99+' : String(total);
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch (_) {
      if (badge) badge.style.display = 'none';
    }
  }

  /* ── Event Delegation ── */

  function handleSidebarClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) {
      const row = e.target.closest('[data-href]');
      if (row) {
        window.location.href = row.dataset.href;
      }
      return;
    }

    const action = btn.dataset.action;
    switch (action) {
      case 'toggle':
        toggleSidebar();
        break;
      case 'open-health':
      case 'open-watchlist':
      case 'open-notifications':
        toggleSidebar(true);
        break;
      case 'refresh':
        refreshSidebarData();
        break;
    }
  }

  /* ── URL Change Detection ── */

  function startUrlWatcher() {
    setInterval(() => {
      if (location.pathname !== currentPath) {
        currentPath = location.pathname;
        if (!sidebarEnabled) return;
        applySidebarTop();
        attachToggleListener();
        if (isExpanded) {
          refreshSidebarData();
        }
      }
    }, POLL_INTERVAL);
  }

  /* ── Initialization ── */

  function initSidebar() {
    if (document.getElementById(SIDEBAR_ID)) return;

    sidebarEl = createSidebarDOM();
    document.body.insertBefore(sidebarEl, document.body.firstChild);
    panelScrollEl = document.getElementById('ghh-panel-scroll');

    sidebarEl.addEventListener('click', handleSidebarClick);

    // Restore persisted open/collapsed state (default: collapsed)
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const el = document.getElementById(SIDEBAR_ID);
      if (!el) return;
      if (result[STORAGE_KEY] === true) {
        el.classList.add('ghh-open');
        el.classList.remove('ghh-closed');
        isExpanded = true;
        refreshSidebarData();
      } else {
        el.classList.add('ghh-closed');
        el.classList.remove('ghh-open');
        isExpanded = false;
      }
      attachToggleListener();
    });

    // Detect top position after DOM is settled
    setTimeout(applySidebarTop, 500);
    window.addEventListener('resize', applySidebarTop);

    startUrlWatcher();
  }

  function attachSettingsWatcher() {
    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName !== 'local' || !changes.settings) return;

      const nextSettings = changes.settings.newValue || {};
      const nextEnabled = nextSettings.showHealthSidebar !== false;
      const changed = nextEnabled !== sidebarEnabled;
      sidebarEnabled = nextEnabled;
      applySidebarVisibility();

      if (changed && sidebarEnabled) {
        applySidebarTop();
        if (isExpanded) {
          refreshSidebarData();
        }
      }
    });
  }

  async function bootstrapSidebar() {
    sidebarEnabled = await getSidebarEnabledSetting();
    initSidebar();
    applySidebarVisibility();
    attachSettingsWatcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapSidebar);
  } else {
    bootstrapSidebar();
  }
})();
