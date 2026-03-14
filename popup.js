const BUILTIN_PAGES = new Set([
  'about', 'apps', 'blog', 'collections', 'contact', 'customer-stories', 'enterprise', 'events',
  'explore', 'features', 'github-copilot', 'issues', 'join', 'login', 'marketplace', 'new',
  'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'search', 'security', 'settings',
  'site', 'sponsors', 'team', 'teams', 'topics', 'trending'
]);

let currentRepo = null;
let currentWatchlist = [];
let currentWatchlistScores = {};
let bookmarkTagFilter = '';
let notificationsTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  bindTabs();
  bindActions();
  await loadPopup();
});

window.addEventListener('unload', () => {
  if (notificationsTimer) {
    clearInterval(notificationsTimer);
    notificationsTimer = null;
  }
});

async function loadPopup() {
  await Promise.all([
    loadOverview(),
    loadWatchlist(),
    loadSettings(),
    loadBookmarks(),
    loadNotifications(),
    renderRateLimitFooter()
  ]);
}

function bindTabs() {
  const buttons = document.querySelectorAll('.tab-button');
  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      buttons.forEach((item) => item.classList.toggle('is-active', item === button));
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('is-active', panel.id === `tab-${button.dataset.tab}`);
      });
      if (button.dataset.tab === 'notifs') {
        startNotificationsRefresh();
      } else if (notificationsTimer) {
        clearInterval(notificationsTimer);
        notificationsTimer = null;
      }
    });
  });
}

function bindActions() {
  document.getElementById('compare-button')?.addEventListener('click', () => {
    runCompare().catch(logError);
  });

  document.getElementById('save-token')?.addEventListener('click', async () => {
    await saveSettings();
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
      saveSettings().catch(logError);
    });
  });

  document.getElementById('clear-cache')?.addEventListener('click', async () => {
    await sendMessage({ type: 'CLEAR_CACHED_DATA' });
    await loadPopup();
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

  document.getElementById('bookmark-search')?.addEventListener('input', () => {
    loadBookmarks().catch(logError);
  });

  document.getElementById('notifications-refresh')?.addEventListener('click', () => {
    loadNotifications(true).catch(logError);
  });

  document.getElementById('notifications-mark-all')?.addEventListener('click', async () => {
    await sendMessage({ type: 'MARK_ALL_NOTIFICATIONS_READ' }).catch(() => {});
    await loadNotifications(true);
  });
}

async function loadOverview() {
  const container = document.getElementById('overview-content');
  clearElement(container);

  currentRepo = await getCurrentRepoFromTab();
  const watchlistResponse = await sendMessage({ type: 'GET_WATCHLIST' }).catch(() => ({ watchlist: [], watchlistScores: {} }));
  currentWatchlist = watchlistResponse.watchlist || [];
  currentWatchlistScores = watchlistResponse.watchlistScores || {};

  if (!currentRepo) {
    container.appendChild(makeMessage('Open a GitHub repository to see health data'));
    container.appendChild(await buildRecentReposSection(false));
    return;
  }

  const results = await Promise.all([
    sendMessage({ type: 'GET_REPO_HEALTH', payload: { ...currentRepo } }).catch(() => null),
    sendMessage({ type: 'GET_HISTORY', payload: { ...currentRepo } }).catch(() => ({ history: [] }))
  ]);

  const healthResponse = results[0];
  const historyResponse = results[1];

  if (!healthResponse || !healthResponse.success || !healthResponse.data) {
    container.appendChild(makeMessage('Failed to load this repository.'));
    container.appendChild(await buildRecentReposSection(true));
    return;
  }

  const data = healthResponse.data;
  const history = historyResponse.history || [];
  container.appendChild(buildOverviewCard(currentRepo, data, history));
  container.appendChild(await buildRecentReposSection(true));
}

async function buildRecentReposSection(showSecondary) {
  const section = document.createElement('div');
  section.className = 'recent-section';

  const title = document.createElement('div');
  title.className = 'section-kicker';
  title.textContent = showSecondary ? 'Recently visited repos' : 'Recent repos';
  section.appendChild(title);

  const response = await sendMessage({ type: 'GET_RECENT_REPOS' }).catch(() => ({ recentRepos: [] }));
  const items = (response.recentRepos || []).slice(0, showSecondary ? 10 : 10);

  if (!items.length) {
    section.appendChild(makeMessage('No recent repos yet.'));
    return section;
  }

  const list = document.createElement('div');
  list.className = 'watchlist-list';

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'watchlist-row';

    const link = document.createElement('a');
    link.href = `https://github.com/${item.owner}/${item.repo}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'repo-link';
    link.textContent = `${item.owner}/${item.repo}`;

    const meta = document.createElement('span');
    meta.className = 'meta-note';
    meta.textContent = `visited ${timeAgo(item.visitedAt)}`;

    row.appendChild(link);
    row.appendChild(meta);
    list.appendChild(row);
  });

  if ((response.recentRepos || []).length > 10) {
    const viewAll = document.createElement('button');
    viewAll.type = 'button';
    viewAll.className = 'btn';
    viewAll.textContent = 'View all';
    viewAll.addEventListener('click', () => {
      clearElement(list);
      (response.recentRepos || []).slice(0, 20).forEach((item) => {
        const row = document.createElement('div');
        row.className = 'watchlist-row';
        const link = document.createElement('a');
        link.href = `https://github.com/${item.owner}/${item.repo}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'repo-link';
        link.textContent = `${item.owner}/${item.repo}`;
        const meta = document.createElement('span');
        meta.className = 'meta-note';
        meta.textContent = `visited ${timeAgo(item.visitedAt)}`;
        row.appendChild(link);
        row.appendChild(meta);
        list.appendChild(row);
      });
      viewAll.remove();
    });
    section.appendChild(viewAll);
  }

  section.appendChild(list);
  return section;
}

async function loadWatchlist() {
  const alertContainer = document.getElementById('watchlist-alert');
  const content = document.getElementById('watchlist-content');
  clearElement(alertContainer);
  clearElement(content);

  const response = await sendMessage({ type: 'GET_WATCHLIST' }).catch(() => ({ watchlist: [], watchlistScores: {} }));
  currentWatchlist = response.watchlist || [];
  currentWatchlistScores = response.watchlistScores || {};

  const drops = [];
  for (const [repoKey, scoreState] of Object.entries(currentWatchlistScores)) {
    if (scoreState.previousScore !== null && scoreState.previousScore - scoreState.currentScore >= 1) {
      drops.push({ repoKey, drop: round1(scoreState.previousScore - scoreState.currentScore) });
    }
  }

  if (drops.length > 0) {
    const banner = document.createElement('div');
    banner.className = 'banner banner-alert';
    banner.textContent = `${drops.length} watched repo${drops.length === 1 ? '' : 's'} dropped by 1.0+ since the last check.`;
    alertContainer.appendChild(banner);
  }

  if (currentWatchlist.length === 0) {
    content.appendChild(makeMessage('No repos watched yet. Click Watch on any repo to track it.'));
    return;
  }

  const list = document.createElement('div');
  list.className = 'watchlist-list';
  content.appendChild(list);

  for (const item of currentWatchlist) {
    const repoKey = `${item.owner}/${item.repo}`;
    const scoreState = currentWatchlistScores[repoKey] || {};
    const healthResponse = await sendMessage({ type: 'GET_REPO_HEALTH', payload: { owner: item.owner, repo: item.repo } }).catch(() => null);
    const data = healthResponse && healthResponse.data ? healthResponse.data : null;
    list.appendChild(buildWatchlistRow(item, data, scoreState));
  }
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

  const tokenInput = document.getElementById('github-token');
  if (tokenInput) tokenInput.value = data.github_pat || '';
}

async function saveSettings() {
  const githubPat = (document.getElementById('github-token')?.value || '').trim();

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
  await renderRateLimitFooter();
}

async function loadBookmarks() {
  const search = (document.getElementById('bookmark-search')?.value || '').trim().toLowerCase();
  const tagsWrap = document.getElementById('bookmark-tags');
  const content = document.getElementById('bookmarks-content');
  clearElement(tagsWrap);
  clearElement(content);

  const response = await sendMessage({ type: 'GET_BOOKMARKS' }).catch(() => ({ bookmarks: [] }));
  const bookmarks = response.bookmarks || [];

  const allTags = [...new Set(bookmarks.flatMap((item) => item.tags || []))].sort((a, b) => a.localeCompare(b));
  allTags.forEach((tag) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tag-pill ${bookmarkTagFilter === tag ? 'is-active' : ''}`;
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      bookmarkTagFilter = bookmarkTagFilter === tag ? '' : tag;
      loadBookmarks().catch(logError);
    });
    tagsWrap.appendChild(btn);
  });

  const filtered = bookmarks.filter((item) => {
    const full = `${item.owner}/${item.repo}`.toLowerCase();
    const tags = (item.tags || []).join(' ').toLowerCase();
    const matchesSearch = !search || full.includes(search) || tags.includes(search);
    const matchesTag = !bookmarkTagFilter || (item.tags || []).includes(bookmarkTagFilter);
    return matchesSearch && matchesTag;
  });

  if (!filtered.length) {
    content.appendChild(makeMessage('No saved repos yet. Click Bookmark on any repo to save it.'));
    return;
  }

  filtered.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'watchlist-row';

    const left = document.createElement('div');
    left.className = 'watchlist-left';

    const link = document.createElement('a');
    link.href = `https://github.com/${item.owner}/${item.repo}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'repo-link';
    link.textContent = `${item.owner}/${item.repo}`;
    left.appendChild(link);

    const tagWrap = document.createElement('div');
    tagWrap.className = 'bookmark-tags';
    (item.tags || []).forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'tag-pill';
      chip.textContent = tag;
      tagWrap.appendChild(chip);
    });
    left.appendChild(tagWrap);

    if (item.note) {
      const note = document.createElement('div');
      note.className = 'meta-note';
      note.textContent = item.note.length > 60 ? `${item.note.slice(0, 60)}...` : item.note;
      left.appendChild(note);
    }

    const right = document.createElement('div');
    right.className = 'watchlist-meta';

    const time = document.createElement('span');
    time.className = 'meta-note';
    time.textContent = timeAgo(item.addedAt);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-button';
    remove.textContent = '×';
    remove.addEventListener('click', async () => {
      await sendMessage({ type: 'REMOVE_BOOKMARK', payload: { owner: item.owner, repo: item.repo } });
      await loadBookmarks();
    });

    right.appendChild(time);
    right.appendChild(remove);

    row.appendChild(left);
    row.appendChild(right);
    content.appendChild(row);
  });
}

async function loadNotifications(forceRefresh) {
  const container = document.getElementById('notifications-content');
  clearElement(container);

  if (forceRefresh) {
    await sendMessage({ type: 'CLEAR_CACHED_DATA' }).catch(() => {});
  }

  const response = await sendMessage({ type: 'GET_NOTIFICATIONS' }).catch(() => ({ data: null }));
  const data = response.data;

  if (!data) {
    container.appendChild(makeMessage('Failed to load notifications.'));
    return;
  }

  if (data.requiresToken) {
    container.appendChild(makeMessage('Add a GitHub token in Settings to see notifications'));
    return;
  }

  if (!data.groups || !data.groups.length) {
    container.appendChild(makeMessage('No unread notifications.'));
    return;
  }

  data.groups.forEach((group) => {
    const card = document.createElement('div');
    card.className = 'notification-group';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'notification-group-header';
    header.textContent = `${group.repoFullName} (${group.notifications.length})`;

    const markRead = document.createElement('button');
    markRead.type = 'button';
    markRead.className = 'btn';
    markRead.textContent = 'Mark all read';
    markRead.addEventListener('click', async () => {
      const parts = group.repoFullName.split('/');
      await sendMessage({ type: 'MARK_REPO_NOTIFICATIONS_READ', payload: { owner: parts[0], repo: parts[1] } }).catch(() => {});
      await loadNotifications(true);
    });

    const rowTop = document.createElement('div');
    rowTop.className = 'notification-top';
    rowTop.appendChild(header);
    rowTop.appendChild(markRead);

    const body = document.createElement('div');
    body.className = 'notification-list';

    group.notifications.forEach((item) => {
      const line = document.createElement('a');
      line.href = item.threadUrl;
      line.target = '_blank';
      line.rel = 'noopener noreferrer';
      line.className = 'notification-item';
      line.textContent = `${notificationIcon(item.type)} ${item.title}`;
      body.appendChild(line);
    });

    header.addEventListener('click', () => {
      body.classList.toggle('is-open');
    });

    card.appendChild(rowTop);
    card.appendChild(body);
    container.appendChild(card);
  });
}

function startNotificationsRefresh() {
  if (notificationsTimer) return;
  notificationsTimer = setInterval(() => {
    loadNotifications(false).catch(() => {});
  }, 5 * 60 * 1000);
}

function notificationIcon(type) {
  const map = {
    Issue: '🐞',
    PullRequest: '🔀',
    Release: '🏷️',
    Discussion: '💬'
  };
  return map[type] || '•';
}

async function renderRateLimitFooter() {
  const status = document.getElementById('rate-limit-status');
  const prompt = document.getElementById('rate-limit-prompt');
  clearElement(status);
  clearElement(prompt);

  const response = await sendMessage({ type: 'GET_RATE_LIMIT' }).catch(() => ({ rateLimit: null }));
  const rateLimit = response.rateLimit;
  if (!rateLimit || typeof rateLimit.remaining !== 'number' || typeof rateLimit.limit !== 'number') {
    return;
  }

  const statusLine = document.createElement('div');
  statusLine.className = 'rate-line';

  if (rateLimit.remaining === 0) {
    const minutes = rateLimit.reset ? Math.max(1, Math.ceil(((rateLimit.reset * 1000) - Date.now()) / 60000)) : 0;
    statusLine.classList.add('rate-line-danger');
    statusLine.textContent = `⏳ Rate limited - reset in ${minutes} minutes`;
  } else if (rateLimit.remaining <= 20) {
    statusLine.classList.add('rate-line-warn');
    statusLine.textContent = `⚠️ API limit low: ${rateLimit.remaining} left`;
  } else {
    statusLine.classList.add('rate-line-ok');
    statusLine.textContent = `✅ API: ${rateLimit.remaining}/${rateLimit.limit} calls left`;
  }

  status.appendChild(statusLine);

  if (rateLimit.remaining <= 5) {
    const promptLine = document.createElement('div');
    promptLine.className = 'rate-prompt';
    promptLine.textContent = 'Add a GitHub token in Settings to get 5,000 calls/hour';
    prompt.appendChild(promptLine);
  }
}

function buildOverviewCard(repoInfo, data, history) {
  const wrapper = document.createElement('div');
  wrapper.className = 'overview-card';

  const heading = document.createElement('div');
  heading.className = 'overview-heading';

  const title = document.createElement('a');
  title.href = `https://github.com/${repoInfo.owner}/${repoInfo.repo}`;
  title.target = '_blank';
  title.rel = 'noopener noreferrer';
  title.className = 'repo-link';
  title.textContent = `${repoInfo.owner}/${repoInfo.repo}`;

  const watchButton = document.createElement('button');
  watchButton.type = 'button';
  watchButton.className = 'btn btn-primary btn-watch';
  const watching = isWatchlisted(repoInfo.owner, repoInfo.repo);
  watchButton.textContent = watching ? '✓ Watching' : '+ Watch';
  watchButton.addEventListener('click', async () => {
    if (isWatchlisted(repoInfo.owner, repoInfo.repo)) {
      await sendMessage({ type: 'REMOVE_FROM_WATCHLIST', payload: repoInfo });
    } else {
      await sendMessage({ type: 'ADD_TO_WATCHLIST', payload: repoInfo });
    }
    await loadOverview();
    await loadWatchlist();
  });

  heading.appendChild(title);
  heading.appendChild(watchButton);
  wrapper.appendChild(heading);

  const summary = document.createElement('div');
  summary.className = 'overview-summary';
  summary.appendChild(buildScoreDonut(data.score));
  summary.appendChild(buildBreakdown(data));
  wrapper.appendChild(summary);

  const signals = document.createElement('div');
  signals.className = 'signal-list';
  [
    ['Velocity', formatVelocity(data)],
    ['Bus factor', formatBusFactor(data)],
    ['License', formatLicense(data)],
    ['Release cadence', formatRelease(data)],
    ['Dependency risk', formatDependencyRisk(data.deps)]
  ].forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'signal-row';
    row.appendChild(makeInlineText(label, 'signal-label'));
    row.appendChild(makeInlineText(value, 'signal-value'));
    signals.appendChild(row);
  });
  wrapper.appendChild(signals);

  if (history.length >= 2) {
    const trend = document.createElement('div');
    trend.className = 'trend-card';
    trend.appendChild(makeInlineText('Trend', 'section-kicker'));
    trend.insertAdjacentHTML('beforeend', buildSparklineSvg(history.map((entry) => entry.score), data.score, 'popup-sparkline'));
    wrapper.appendChild(trend);
  }

  return wrapper;
}

function buildBreakdown(data) {
  const breakdown = document.createElement('div');
  breakdown.className = 'breakdown-list';
  breakdown.appendChild(buildBreakdownRow('Activity', data.activityScore, 4));
  breakdown.appendChild(buildBreakdownRow('Maintenance', data.maintenanceScore, 3));
  breakdown.appendChild(buildBreakdownRow('Popularity', data.popularityScore, 3));
  return breakdown;
}

function buildBreakdownRow(label, value, max) {
  const row = document.createElement('div');
  row.className = 'breakdown-row';

  const header = document.createElement('div');
  header.className = 'breakdown-row-header';
  header.appendChild(makeInlineText(label, 'breakdown-label'));
  header.appendChild(makeInlineText(`${value}/${max}`, 'breakdown-value'));

  const track = document.createElement('div');
  track.className = 'bar-track';
  const fill = document.createElement('div');
  fill.className = 'bar-fill';
  fill.style.width = `${Math.min(100, (value / max) * 100)}%`;
  track.appendChild(fill);

  row.appendChild(header);
  row.appendChild(track);
  return row;
}

function buildScoreDonut(score) {
  const color = getScoreColor(score);
  const circumference = 2 * Math.PI * 42;
  const progress = circumference * (score / 10);
  const wrapper = document.createElement('div');
  wrapper.className = 'score-donut';
  wrapper.innerHTML = `<svg viewBox="0 0 100 100" class="score-donut-svg" aria-hidden="true"><circle cx="50" cy="50" r="42" class="score-donut-track"></circle><circle cx="50" cy="50" r="42" class="score-donut-ring" stroke="${color}" stroke-dasharray="${progress} ${circumference - progress}" transform="rotate(-90 50 50)"></circle><text x="50" y="47" text-anchor="middle" class="score-donut-value">${score}</text><text x="50" y="62" text-anchor="middle" class="score-donut-caption">/ 10</text></svg>`;
  return wrapper;
}

function buildWatchlistRow(item, data, scoreState) {
  const row = document.createElement('div');
  row.className = 'watchlist-row';

  const left = document.createElement('div');
  left.className = 'watchlist-left';
  const link = document.createElement('a');
  link.href = `https://github.com/${item.owner}/${item.repo}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'repo-link';
  link.textContent = `${item.owner}/${item.repo}`;
  left.appendChild(link);

  const right = document.createElement('div');
  right.className = 'watchlist-meta';
  right.appendChild(buildScoreBadge(data ? data.score : scoreState.currentScore ?? '—'));
  right.appendChild(buildScoreDelta(scoreState));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-button';
  remove.textContent = 'Remove';
  remove.addEventListener('click', async () => {
    await sendMessage({ type: 'REMOVE_FROM_WATCHLIST', payload: { owner: item.owner, repo: item.repo } });
    await loadWatchlist();
    await loadOverview();
  });

  row.appendChild(left);
  row.appendChild(right);
  row.appendChild(remove);
  return row;
}

function buildScoreDelta(scoreState) {
  const delta = document.createElement('span');
  delta.className = 'score-delta score-delta-neutral';

  if (typeof scoreState.previousScore !== 'number' || typeof scoreState.currentScore !== 'number') {
    delta.textContent = '—';
    return delta;
  }

  const change = round1(scoreState.currentScore - scoreState.previousScore);
  if (change > 0) {
    delta.className = 'score-delta score-delta-up';
    delta.textContent = `↗ ${change.toFixed(1)}`;
  } else if (change < 0) {
    delta.className = 'score-delta score-delta-down';
    delta.textContent = `↘ ${Math.abs(change).toFixed(1)}`;
  } else {
    delta.textContent = `→ 0.0`;
  }

  return delta;
}

async function runCompare() {
  const container = document.getElementById('compare-results');
  clearElement(container);

  const leftRepo = parseRepoInput(document.getElementById('compare-left')?.value || '');
  const rightRepo = parseRepoInput(document.getElementById('compare-right')?.value || '');
  if (!leftRepo || !rightRepo) {
    container.appendChild(makeMessage('Enter two repositories as owner/repo.'));
    return;
  }

  container.appendChild(makeMessage('Comparing repositories...'));

  const results = await Promise.allSettled([
    sendMessage({ type: 'GET_REPO_HEALTH', payload: leftRepo }),
    sendMessage({ type: 'GET_REPO_HEALTH', payload: rightRepo })
  ]);

  clearElement(container);
  if (results.some((result) => result.status !== 'fulfilled' || !result.value?.success || !result.value?.data)) {
    container.appendChild(makeMessage('One or both repositories could not be loaded.'));
    return;
  }

  const leftData = results[0].value.data;
  const rightData = results[1].value.data;
  container.appendChild(buildCompareTable(leftRepo, leftData, rightRepo, rightData));
}

function buildCompareTable(leftRepo, leftData, rightRepo, rightData) {
  const tableWrap = document.createElement('div');
  tableWrap.className = 'compare-table-wrap';

  const header = document.createElement('div');
  header.className = 'compare-header';
  header.appendChild(document.createElement('div'));
  header.appendChild(buildCompareHeaderCell(leftRepo, leftData.score >= rightData.score && leftData.score !== rightData.score));
  header.appendChild(buildCompareHeaderCell(rightRepo, rightData.score > leftData.score));
  tableWrap.appendChild(header);

  const rows = [
    buildCompareRow('Health Score', leftData.score, rightData.score, `${leftData.score}/10`, `${rightData.score}/10`, true),
    buildCompareRow('Last Commit', leftData.daysSinceLast, rightData.daysSinceLast, formatDaysAgo(leftData.daysSinceLast), formatDaysAgo(rightData.daysSinceLast), false),
    buildCompareRow('Maintenance Velocity', velocityRank(leftData.velocityLabel), velocityRank(rightData.velocityLabel), formatVelocity(leftData), formatVelocity(rightData), true),
    buildCompareRow('Bus Factor', busFactorRank(leftData.busFactor), busFactorRank(rightData.busFactor), formatBusFactor(leftData), formatBusFactor(rightData), true),
    buildCompareRow('License', licenseRank(leftData.licenseRisk), licenseRank(rightData.licenseRisk), formatLicense(leftData), formatLicense(rightData), true),
    buildCompareRow('Open Issues', leftData.openIssues, rightData.openIssues, String(leftData.openIssues), String(rightData.openIssues), false),
    buildCompareRow('Stars', leftData.stars, rightData.stars, formatNum(leftData.stars), formatNum(rightData.stars), true),
    buildCompareRow('Dependency Risk', depRiskRank(leftData.deps), depRiskRank(rightData.deps), formatDependencyRisk(leftData.deps), formatDependencyRisk(rightData.deps), true),
    buildCompareRow('Release Cadence', releaseRank(leftData.releaseLabel), releaseRank(rightData.releaseLabel), formatRelease(leftData), formatRelease(rightData), true)
  ];

  rows.forEach((row) => tableWrap.appendChild(row));
  return tableWrap;
}

function buildCompareHeaderCell(repoInfo, recommended) {
  const cell = document.createElement('div');
  cell.className = 'compare-header-cell';
  if (recommended) {
    const tag = document.createElement('span');
    tag.className = 'recommended-tag';
    tag.textContent = 'recommended';
    cell.appendChild(tag);
  }
  cell.appendChild(makeInlineText(`${repoInfo.owner}/${repoInfo.repo}`, 'compare-repo-name'));
  return cell;
}

function buildCompareRow(label, leftMetric, rightMetric, leftText, rightText, higherIsBetter) {
  const row = document.createElement('div');
  row.className = 'compare-row';
  row.appendChild(makeInlineText(label, 'compare-label'));

  const leftCell = document.createElement('div');
  leftCell.className = `compare-value ${compareClass(leftMetric, rightMetric, higherIsBetter)}`;
  leftCell.textContent = leftText;
  row.appendChild(leftCell);

  const rightCell = document.createElement('div');
  rightCell.className = `compare-value ${compareClass(rightMetric, leftMetric, higherIsBetter)}`;
  rightCell.textContent = rightText;
  row.appendChild(rightCell);

  return row;
}

function compareClass(value, otherValue, higherIsBetter) {
  if (value === otherValue) return 'compare-equal';
  const wins = higherIsBetter ? value > otherValue : value < otherValue;
  return wins ? 'compare-better' : 'compare-worse';
}

function buildScoreBadge(score) {
  const badge = document.createElement('span');
  const color = typeof score === 'number' ? getColorClass(score) : 'neutral';
  badge.className = `score-badge score-badge-${color}`;
  badge.textContent = typeof score === 'number' ? score.toFixed(1) : String(score);
  return badge;
}

function formatVelocity(data) {
  if (data.avgIssueCloseDays === null && data.avgPRMergeDays === null) return 'Unknown';
  const issueText = data.avgIssueCloseDays === null ? 'n/a' : `${stripTrailingZero(data.avgIssueCloseDays)}d issues`;
  const prText = data.avgPRMergeDays === null ? 'n/a' : `${stripTrailingZero(data.avgPRMergeDays)}d PRs`;
  return `${issueText} · ${prText}`;
}

function formatBusFactor(data) {
  if (!data.topContributorLogin) return 'Healthy';
  return `${capitalize(data.busFactor)} · ${stripTrailingZero(data.topContributorShare)}% by ${data.topContributorLogin}`;
}

function formatLicense(data) {
  if (data.licenseRisk === 'none') return data.licenseName || 'Permissive';
  if (data.licenseRisk === 'copyleft') return `Copyleft · ${data.licenseName || data.licenseKey || 'GPL'}`;
  if (data.licenseRisk === 'unlicensed') return 'No license';
  return 'Unknown';
}

function formatRelease(data) {
  if (!data.latestVersion || data.daysSinceRelease === null) return 'No releases';
  return `${data.latestVersion} · ${data.daysSinceRelease}d ago`;
}

function formatDependencyRisk(deps) {
  if (!deps) return 'No package.json';
  if (deps.riskLabel === 'Clean') return 'Clean';
  const parts = [];
  if (deps.outdatedCount > 0) parts.push(`${deps.outdatedCount} outdated`);
  if (deps.vulnerableCount > 0) parts.push(`${deps.vulnerableCount} vulnerable`);
  return parts.join(' · ');
}

function depRiskRank(deps) {
  if (!deps) return -1;
  if (deps.riskLabel === 'Clean') return 3;
  if (deps.riskLabel === 'Low Risk') return 2;
  if (deps.riskLabel === 'Medium') return 1;
  return 0;
}

function releaseRank(label) {
  return { recent: 3, aging: 2, stale: 1, 'no releases': 0 }[label] ?? 0;
}

function licenseRank(risk) {
  return { none: 3, copyleft: 2, unknown: 1, unlicensed: 0 }[risk] ?? 0;
}

function busFactorRank(label) {
  return { healthy: 2, moderate: 1, 'high risk': 0 }[label] ?? 0;
}

function velocityRank(label) {
  return { fast: 3, moderate: 2, slow: 1, unknown: 0 }[label] ?? 0;
}

async function getCurrentRepoFromTab() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_error) {
    return null;
  }

  if (!tab?.url || !tab.url.includes('github.com') || !tab.id) {
    return null;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CURRENT_REPO' });
    if (response?.owner && response?.repo && !BUILTIN_PAGES.has(response.owner)) {
      return { owner: response.owner, repo: response.repo };
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function parseRepoInput(value) {
  const trimmed = value.trim().replace(/^https?:\/\/github\.com\//, '');
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const owner = parts[0];
  const repo = parts[1];
  if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) return null;
  return { owner, repo };
}

function isWatchlisted(owner, repo) {
  return currentWatchlist.some((item) => item.owner === owner && item.repo === repo);
}

function buildSparklineSvg(scores, score, className) {
  const width = 120;
  const height = 30;
  const padding = 3;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;
  const points = scores.map((value, index) => {
    const x = padding + (index / (scores.length - 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const stroke = getScoreColor(score);
  return `<svg class="${className}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="${points.join(' ')}" stroke="${stroke}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

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

function clearElement(element) {
  if (!element) return;
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function makeMessage(text) {
  const message = document.createElement('div');
  message.className = 'muted-message';
  message.textContent = text;
  return message;
}

function makeInlineText(text, className) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function isChecked(id) {
  return Boolean(document.getElementById(id)?.checked);
}

function setCheckbox(id, value) {
  const input = document.getElementById(id);
  if (input) input.checked = value;
}

function getColorClass(score) {
  if (score >= 7) return 'green';
  if (score >= 4) return 'yellow';
  return 'red';
}

function getScoreColor(score) {
  if (score >= 7) return '#238636';
  if (score >= 4) return '#d29922';
  return '#da3633';
}

function formatNum(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function timeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatDaysAgo(days) {
  if (days === 0) return 'Today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

function stripTrailingZero(value) {
  return Number.isInteger(value) ? String(value) : String(value);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function logError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (isExpectedRuntimeError(error) || isExpectedApiError(message)) {
    return;
  }
  console.error('[GH Health]', message);
}

function isExpectedRuntimeError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('Extension context invalidated')
    || message.includes('Receiving end does not exist');
}

function isExpectedApiError(message) {
  return message === 'NOT_FOUND'
    || message === 'RATE_LIMITED'
    || message === 'AUTH_ERROR'
    || message === 'INVALID_REPO'
    || message === 'Repository not found';
}
