const PROCESSED_ATTR = 'data-health-done';
const TOC_ATTR = 'data-toc-done';
const SIZES_ATTR = 'data-sizes-done';
const PR_COMPLEXITY_ATTR = 'data-pr-complexity-done';
const TODO_ATTR = 'data-todo-done';
const INSIGHTS_ATTR = 'data-insights-done';
const ISSUES_AGE_ATTR = 'data-issues-age-done';
const ICONS_ATTR = 'data-icons-done';
const CLONE_ATTR = 'data-clone-done';
const STAR_HISTORY_ATTR = 'data-star-history-done';
const COMMIT_QUALITY_ATTR = 'data-commit-quality-done';
const OPEN_EDITOR_ATTR = 'data-open-editor-done';
const BOOKMARK_ATTR = 'data-bookmark-done';
const FILE_ACTIONS_ATTR = 'data-file-actions-done';
const GITZIP_ATTR = 'data-gitzip-done';
const OPEN_IDE_ATTR = 'data-open-ide-done';
const LOC_ATTR = 'data-loc-done';

const BUILTIN_PAGES = [
  'about', 'apps', 'blog', 'collections', 'contact', 'customer-stories', 'enterprise', 'events',
  'explore', 'features', 'github-copilot', 'issues', 'join', 'login', 'marketplace', 'new',
  'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'search', 'security', 'settings',
  'site', 'sponsors', 'team', 'teams', 'topics', 'trending'
];

let settings = {
  showOnSearch: true,
  showOnTrending: true,
  showDeps: true,
  showBusFactor: true,
  showLicenseRisk: true,
  showReadmeToc: true,
  showFolderSizes: true,
  showPrComplexity: true,
  showTodoHighlights: true,
  showContributionInsights: true,
  showIssueAge: true,
  showFileTypeIcons: true,
  showQuickClone: true,
  showStarHistory: true,
  showCommitQuality: true,
  showFileDownloadButtons: true,
  showFolderZipDownload: true,
  showOpenInIde: true,
  showLoc: true,
  preferred_online_ide: 'github-dev',
  preferred_editor: 'vscode'
};
let badgesHidden = false;
let observer = null;
let debounceTimer = null;
let lastUrl = location.href;
let tocObserver = null;
let lastTrackedRepo = '';
let activeFolderZipButton = null;

bootstrap().catch((error) => {
  if (!isExpectedRuntimeError(error)) {
    console.error('[GH Health]', error.message);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_CURRENT_REPO') {
    const current = parseCurrentRepo();
    sendResponse(current || {});
    return true;
  }

  if (message.type === 'TOGGLE_BADGES') {
    badgesHidden = Boolean(message.hidden);
    document.querySelectorAll('.gh-health-badge').forEach((badge) => {
      badge.style.display = badgesHidden ? 'none' : '';
    });
  }

  if (message.type === 'FOLDER_ZIP_PROGRESS') {
    if (activeFolderZipButton && message.payload && message.payload.text) {
      activeFolderZipButton.textContent = message.payload.text;
    }
    return false;
  }

  if (message.type === 'CONTEXT_DOWNLOAD_FOLDER_ZIP') {
    const payload = message.payload || {};
    startFolderZipDownload(payload.owner, payload.repo, payload.branch, payload.path).catch(() => {});
    return false;
  }

  if (message.type === 'CONTEXT_DOWNLOAD_SINGLE_FILE') {
    const payload = message.payload || {};
    downloadSingleFileRaw(payload.owner, payload.repo, payload.branch, payload.filePath, payload.fileName).catch(() => {});
    return false;
  }

  if (message.type === 'OPEN_PREFERRED_IDE') {
    const current = parseCurrentRepo();
    if (!current) return false;
    const ideUrl = buildOnlineIdeUrl(settings.preferred_online_ide, current.owner, current.repo);
    if (ideUrl) {
      window.open(ideUrl, '_blank', 'noopener');
    }
    return false;
  }

  return false;
});

async function bootstrap() {
  try {
    const [settingsResponse, hiddenState] = await Promise.all([
      sendMessage({ type: 'GET_SETTINGS' }),
      getBadgesHiddenState()
    ]);
    if (settingsResponse && settingsResponse.success && settingsResponse.settings) {
      settings = Object.assign({}, settings, settingsResponse.settings);
    }
    badgesHidden = hiddenState;
  } catch (_error) {
    // use defaults
  }

  scanPage();
  startObserver();
}

function scanPage() {
  const path = window.location.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length >= 2 && !isBuiltinPage(segments[0])) {
    const owner = segments[0];
    const repo = segments[1];
    handleRepoPage(owner, repo);
    trackRecentRepo(owner, repo).catch(() => {});

    if (settings.showQuickClone) {
      injectQuickCloneButton(owner, repo).catch(() => {});
    }

    if (settings.showFolderZipDownload) {
      injectGitZipButtons(owner, repo).catch(() => {});
    }

    if (settings.showFileDownloadButtons) {
      injectBlobFileActions(owner, repo).catch(() => {});
    }

    if (settings.showOpenInIde) {
      injectOpenInIdeDropdown(owner, repo).catch(() => {});
    }

    injectBookmarkButton(owner, repo).catch(() => {});

    if (settings.showStarHistory) {
      injectStarHistory(owner, repo).catch(() => {});
    }

    injectOpenInEditor(owner, repo).catch(() => {});

    if (settings.showLoc) {
      injectLocCounter(owner, repo).catch(() => {});
    }

    if (settings.showReadmeToc) {
      injectReadmeToc().catch(() => {});
    }

    if (settings.showFolderSizes) {
      injectFolderSizes(owner, repo).catch(() => {});
    }

    if (settings.showFileTypeIcons) {
      injectFileTypeIcons(owner, repo).catch(() => {});
    }

    if (settings.showPrComplexity) {
      injectPrComplexity(owner, repo).catch(() => {});
    }

    if (settings.showIssueAge) {
      injectIssueAge(owner, repo).catch(() => {});
    }

    if (settings.showCommitQuality) {
      injectCommitQuality().catch(() => {});
    }

    if (settings.showTodoHighlights) {
      injectTodoHighlighter().catch(() => {});
    }
  }

  if (isProfileRoot(segments) && settings.showContributionInsights) {
    injectContributionInsights().catch(() => {});
  }

  if (path === '/search' && settings.showOnSearch) {
    processCardsInBatches(Array.from(document.querySelectorAll('[data-testid="results-list"] li, .repo-list-item')));
  }

  if ((path.startsWith('/trending') || path.startsWith('/explore')) && settings.showOnTrending) {
    processCardsInBatches(Array.from(document.querySelectorAll('article.Box-row')));
  }
}

function isBuiltinPage(segment) {
  return BUILTIN_PAGES.includes(segment);
}

function parseCurrentRepo() {
  const segments = location.pathname.split('/').filter(Boolean);
  if (segments.length < 2 || isBuiltinPage(segments[0])) return null;
  return { owner: segments[0], repo: segments[1] };
}

function isProfileRoot(segments) {
  return segments.length === 1 && !isBuiltinPage(segments[0]);
}

async function processCardsInBatches(cards) {
  const batchSize = 5;
  for (let index = 0; index < cards.length; index += batchSize) {
    const batch = cards.slice(index, index + batchSize);
    batch.forEach((card) => processCard(card));
    if (index + batchSize < cards.length) {
      await wait(100);
    }
  }
}

function handleRepoPage(owner, repo) {
  const title =
    document.querySelector('[data-testid="repository-container-header"] h1') ||
    document.querySelector('#repository-container-header h1') ||
    document.querySelector('main > div h1:first-of-type') ||
    document.querySelector('h1[class*="d-flex"]');

  if (!title || title.hasAttribute(PROCESSED_ATTR)) return;
  title.setAttribute(PROCESSED_ATTR, 'true');
  renderBadgeForTarget(title, owner, repo, 'page');
}

function processCard(card) {
  if (card.hasAttribute(PROCESSED_ATTR)) return;
  const repoInfo = extractRepoFromCard(card);
  if (!repoInfo) return;

  card.setAttribute(PROCESSED_ATTR, 'true');
  renderBadgeForTarget(card, repoInfo.owner, repoInfo.repo, 'card');
}

function extractRepoFromCard(card) {
  const primaryLink = card.querySelector('h1 a[href], h2 a[href], h3 a[href], a[data-testid="ViewTitleLink"]');
  const primary = extractRepoParts(primaryLink && primaryLink.getAttribute('href'));
  if (primary) return primary;

  const anchors = card.querySelectorAll('a[href]');
  for (const anchor of anchors) {
    const parts = extractRepoParts(anchor.getAttribute('href'));
    if (parts) return parts;
  }
  return null;
}

function extractRepoParts(href) {
  if (!href) return null;
  let parsed;
  try {
    parsed = new URL(href, window.location.origin);
  } catch (_error) {
    return null;
  }

  if (parsed.origin !== window.location.origin) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length !== 2) return null;

  const owner = parts[0];
  const repo = parts[1];
  if (isBuiltinPage(owner) || isBuiltinPage(repo)) return null;
  if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) return null;

  return { owner, repo };
}

async function renderBadgeForTarget(target, owner, repo, context) {
  removeExistingBadge(target, context);

  try {
    const cachedResponse = await sendMessage({
      type: 'GET_CACHED_REPO_HEALTH',
      payload: { owner, repo }
    });

    if (cachedResponse && cachedResponse.success && cachedResponse.data) {
      const historyResponse = await sendMessage({ type: 'GET_HISTORY', payload: { owner, repo } });
      insertBadge(target, buildHealthBadge(cachedResponse.data, (historyResponse && historyResponse.history) || [], context), context);
      return;
    }
  } catch (_error) {
    // live fetch fallback
  }

  const placeholder = buildStateBadge(context, 'loading', 'Checking health...');
  insertBadge(target, placeholder, context);

  try {
    const responses = await Promise.all([
      sendMessage({ type: 'GET_REPO_HEALTH', payload: { owner, repo } }),
      sendMessage({ type: 'GET_HISTORY', payload: { owner, repo } })
    ]);

    const healthResponse = responses[0];
    const historyResponse = responses[1];

    if (!healthResponse || !healthResponse.success || !healthResponse.data) {
      throw new Error((healthResponse && healthResponse.error) || 'UNKNOWN');
    }

    placeholder.remove();
    insertBadge(target, buildHealthBadge(healthResponse.data, (historyResponse && historyResponse.history) || [], context), context);
  } catch (error) {
    updateStateBadge(placeholder, context, error.message || 'UNKNOWN');
  }
}

function removeExistingBadge(target, context) {
  if (context === 'page') {
    const next = target.nextElementSibling;
    if (next && next.classList && next.classList.contains('gh-health-badge')) {
      next.remove();
    }
  } else {
    const existing = target.querySelector('.gh-health-badge');
    if (existing) existing.remove();
  }
}

function insertBadge(target, badge, context) {
  badge.style.display = badgesHidden ? 'none' : '';
  if (context === 'page') {
    target.insertAdjacentElement('afterend', badge);
  } else {
    target.appendChild(badge);
  }
}

function buildStateBadge(context, state, label) {
  const badge = document.createElement('div');
  badge.className = `gh-health-badge gh-health-${context} gh-health-static gh-health-${state}`;

  const pill = document.createElement('div');
  pill.className = 'gh-health-pill';
  const text = document.createElement('span');
  text.className = 'gh-health-pill-text';
  text.textContent = label;
  pill.appendChild(text);
  badge.appendChild(pill);

  return badge;
}

function updateStateBadge(badge, context, errorCode) {
  let state = 'error';
  let label = 'Error - retry';

  if (errorCode === 'RATE_LIMITED') {
    state = 'rate-limited';
    label = 'Rate limited';
  } else if (errorCode === 'NOT_FOUND') {
    state = 'not-found';
    label = context === 'page' ? 'Private repo' : 'Repo not found';
  } else if (errorCode === 'AUTH_ERROR') {
    state = 'error';
    label = 'Token invalid';
  }

  badge.className = `gh-health-badge gh-health-${context} gh-health-static gh-health-${state}`;
  const text = badge.querySelector('.gh-health-pill-text');
  if (text) {
    text.textContent = label;
  }
}

function buildHealthBadge(data, history, context) {
  const colorClass = getColorClass(data.score);
  const badge = document.createElement('div');
  badge.className = `gh-health-badge gh-health-${context} gh-health-${colorClass}`;

  const pill = document.createElement('div');
  pill.className = 'gh-health-pill';

  const dot = document.createElement('span');
  dot.className = 'gh-health-dot';
  dot.textContent = '?';

  const score = document.createElement('span');
  score.className = 'gh-health-pill-score';
  score.textContent = Number(data.score).toFixed(1);

  const status = document.createElement('span');
  status.className = 'gh-health-pill-status';
  status.textContent = data.status;

  pill.appendChild(dot);
  pill.appendChild(score);
  pill.appendChild(status);
  badge.appendChild(pill);

  const detailLines = buildExpandedLines(data, history, colorClass, context);
  if (detailLines.length > 0) {
    const details = document.createElement('div');
    details.className = 'gh-health-details';
    detailLines.forEach((line) => details.appendChild(line));
    badge.appendChild(details);
  } else {
    badge.classList.add('gh-health-static');
  }

  return badge;
}

function buildExpandedLines(data, history, colorClass, context) {
  const lines = [];

  const velocityText = buildVelocityText(data);
  if (velocityText) {
    const velocityLine = document.createElement('div');
    velocityLine.className = 'gh-health-line';
    velocityLine.textContent = velocityText;
    lines.push(velocityLine);
  }

  if (settings.showBusFactor && data.busFactor === 'high risk') {
    const busFactorLine = document.createElement('div');
    busFactorLine.className = 'gh-health-line gh-health-warning';
    const share = sanitizeNumber(data.topContributorShare);
    busFactorLine.textContent = `?? Single maintainer risk (${share}% of commits by one person)`;
    lines.push(busFactorLine);
  }

  if (settings.showDeps && data.hasDeps && data.deps) {
    const depsLine = document.createElement('div');
    depsLine.className = 'gh-health-line';
    if (data.deps.riskLabel === 'Clean') {
      depsLine.textContent = '?? Dependencies clean';
    } else {
      const parts = [];
      if (safeNonNegative(data.deps.outdatedCount) > 0) parts.push(`${safeNonNegative(data.deps.outdatedCount)} deps outdated`);
      if (safeNonNegative(data.deps.vulnerableCount) > 0) parts.push(`${safeNonNegative(data.deps.vulnerableCount)} vuln`);
      depsLine.textContent = `?? ${parts.join(' · ')}`;
    }
    lines.push(depsLine);
  }

  const licenseText = getLicenseBadgeLine(data);
  if (settings.showLicenseRisk && licenseText) {
    const licenseLine = document.createElement('div');
    licenseLine.className = 'gh-health-line';
    licenseLine.textContent = licenseText;
    lines.push(licenseLine);
  }

  if (
    data.latestVersion &&
    data.daysSinceRelease != null &&
    !Number.isNaN(Number(data.daysSinceRelease)) &&
    Number(data.daysSinceRelease) >= 0
  ) {
    const releaseLine = document.createElement('div');
    releaseLine.className = 'gh-health-line';
    releaseLine.textContent = `??? ${data.latestVersion} · ${Math.round(Number(data.daysSinceRelease))}d ago`;
    lines.push(releaseLine);
  }

  if (Array.isArray(history) && history.length >= 2) {
    const sparklineWrap = document.createElement('div');
    sparklineWrap.className = 'gh-health-sparkline-wrap';
    const daysAgo = Math.round((Date.now() - history[0].timestamp) / 86400000);
    sparklineWrap.title = `First recorded: ${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`;
    sparklineWrap.innerHTML = buildSparklineSvg(history.map((entry) => entry.score), colorClass);
    lines.push(sparklineWrap);
  }

  if (lines.length === 0 && context === 'card') {
    const stars = safeNonNegative(data.stars);
    const forks = safeNonNegative(data.forks);
    const daysSinceLast = safeNonNegative(data.daysSinceLast);
    const fallbackLine = document.createElement('div');
    fallbackLine.className = 'gh-health-line';
    fallbackLine.textContent = `? ${stars} · ?? ${forks} · ${daysSinceLast}d since last commit`;
    lines.push(fallbackLine);
  }

  return lines;
}

function buildVelocityText(data) {
  const issueVal = data.avgIssueCloseDays;
  const prVal = data.avgPRMergeDays;

  const issueNum = issueVal == null ? null : Number(issueVal);
  const prNum = prVal == null ? null : Number(prVal);

  if ((issueNum === null || Number.isNaN(issueNum)) && (prNum === null || Number.isNaN(prNum))) {
    return '';
  }

  const normalizedIssue = issueNum == null || Number.isNaN(issueNum) ? 0 : Math.max(0, issueNum);
  const normalizedPr = prNum == null || Number.isNaN(prNum) ? 0 : Math.max(0, prNum);

  if (normalizedIssue === 0 && normalizedPr === 0) {
    return '';
  }

  return `? Issues ~${stripTrailingZero(normalizedIssue)}d · PRs ~${stripTrailingZero(normalizedPr)}d`;
}

function getLicenseBadgeLine(data) {
  if (data.licenseRisk === 'copyleft') {
    return `?? Copyleft license (${formatLicenseShortName(data.licenseName, data.licenseKey)})`;
  }
  if (data.licenseRisk === 'unlicensed') {
    return '?? No license - use with caution';
  }
  if (data.licenseRisk === 'unknown') {
    return '? License unclear';
  }
  return null;
}

async function injectReadmeToc() {
  const bodyWidth = document.body.clientWidth;
  const mainContent = document.querySelector('#readme, .markdown-body');
  const mainRect = mainContent?.getBoundingClientRect();
  const leftSpace = mainRect?.left ?? 0;

  if (!mainContent || bodyWidth <= 0 || leftSpace < 220) return;

  const body = document.body;
  if (body.hasAttribute(TOC_ATTR)) return;

  const markdownBody = mainContent.matches('.markdown-body')
    ? mainContent
    : mainContent.querySelector('article.markdown-body, .markdown-body');
  if (!markdownBody) return;

  const headings = Array.from(markdownBody.querySelectorAll('h2, h3'));
  if (headings.length < 3) return;

  body.setAttribute(TOC_ATTR, 'true');

  injectReadingTime(markdownBody, headings);

  let panel = document.querySelector('.gh-readme-toc');
  if (!panel) {
    panel = document.createElement('aside');
    panel.className = 'gh-readme-toc gh-toc-panel';

    const topRow = document.createElement('div');
    topRow.className = 'gh-readme-toc-header';

    const title = document.createElement('span');
    title.className = 'gh-readme-toc-title';
    title.textContent = 'README TOC';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'gh-readme-toc-toggle';
    toggle.textContent = '‹';

    const list = document.createElement('div');
    list.className = 'gh-readme-toc-list';

    topRow.appendChild(title);
    topRow.appendChild(toggle);
    panel.appendChild(topRow);
    panel.appendChild(list);
    document.body.appendChild(panel);

    toggle.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('is-collapsed');
      toggle.textContent = collapsed ? '›' : '‹';
      chrome.storage.local.set({ toc_collapsed: collapsed });
    });

    chrome.storage.local.get('toc_collapsed', (result) => {
      const collapsed = Boolean(result.toc_collapsed);
      panel.classList.toggle('is-collapsed', collapsed);
      toggle.textContent = collapsed ? '›' : '‹';
    });
  }

  panel.style.right = 'auto';
  panel.style.left = `${Math.max(16, leftSpace - 216)}px`;

  const list = panel.querySelector('.gh-readme-toc-list');
  while (list && list.firstChild) list.removeChild(list.firstChild);

  const linkMap = new Map();

  headings.forEach((heading, index) => {
    if (!heading.id) {
      heading.id = `gh-toc-heading-${index}`;
    }
    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.className = 'gh-readme-toc-item';
    if (heading.tagName.toLowerCase() === 'h3') {
      link.classList.add('is-sub');
    }
    link.textContent = heading.textContent.trim();
    link.addEventListener('click', (event) => {
      event.preventDefault();
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    if (list) list.appendChild(link);
    linkMap.set(heading.id, link);
  });

  if (tocObserver) {
    tocObserver.disconnect();
  }

  tocObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const id = entry.target.id;
      const link = linkMap.get(id);
      if (!link) return;
      if (entry.isIntersecting) {
        linkMap.forEach((value) => value.classList.remove('is-active'));
        link.classList.add('is-active');
      }
    });
  }, { rootMargin: '0px 0px -70% 0px', threshold: 0.1 });

  headings.forEach((heading) => tocObserver.observe(heading));
}

function injectReadingTime(markdownBody, headings) {
  if (markdownBody.querySelector('.gh-readme-reading-time')) return;
  const words = countWords(markdownBody.textContent || '');
  const mins = Math.max(1, Math.round(words / 200));
  const meta = document.createElement('div');
  meta.className = 'gh-readme-reading-time';
  meta.textContent = `?? ~${mins} min read · ${words} words`;
  const firstHeading = headings[0];
  if (firstHeading) {
    firstHeading.parentNode.insertBefore(meta, firstHeading);
  } else {
    markdownBody.insertBefore(meta, markdownBody.firstChild);
  }
}

async function injectFolderSizes(owner, repo) {
  const isTreePage = /\/[^/]+\/[^/]+(\/tree\/[^/]+(\/.*)?|$)/.test(location.pathname);
  if (!isTreePage) return;

  const treeContainer = document.querySelector('table[aria-labelledby="folders-and-files"], div[role="grid"]');
  if (!treeContainer || treeContainer.hasAttribute(SIZES_ATTR)) return;
  treeContainer.setAttribute(SIZES_ATTR, 'true');

  let response;
  try {
    response = await sendMessage({ type: 'GET_REPO_TREE_SIZES', payload: { owner, repo } });
  } catch (_error) {
    return;
  }
  if (!response || !response.success || !response.data) return;

  const data = response.data;
  const links = treeContainer.querySelectorAll('a[href*="/tree/"], a[href*="/blob/"]');

  links.forEach((link) => {
    const row = link.closest('tr, div[role="row"]');
    if (!row || row.querySelector('.gh-size-label')) return;

    const href = link.getAttribute('href') || '';
    const relPath = extractTreeRelativePath(owner, repo, href, data.defaultBranch);
    if (!relPath) return;

    const isFolder = href.includes('/tree/');
    let size = 0;

    if (isFolder) {
      const top = relPath.split('/')[0];
      size = Number(data.topFolders[top]) || 0;
    } else {
      size = Number(data.fileSizes[relPath]) || 0;
    }

    const label = document.createElement('span');
    label.className = 'gh-size-label';
    label.textContent = formatBytes(size);
    if (size > 50 * 1024 * 1024) {
      label.classList.add('is-large-red');
    } else if (size > 10 * 1024 * 1024) {
      label.classList.add('is-large-amber');
    }

    const targetCell = row.querySelector('td:last-child, div[role="gridcell"]:last-child') || row;
    targetCell.appendChild(label);
  });

  if (!document.querySelector('.gh-total-size')) {
    const summary = document.createElement('div');
    summary.className = 'gh-total-size';
    summary.textContent = `Total: ${formatBytes(data.totalSize)} across ${safeNonNegative(data.totalFiles)} files`;
    const nav = document.querySelector('.file-navigation, div[data-testid="branch-selector"]');
    if (nav && nav.parentNode) {
      nav.parentNode.insertBefore(summary, nav);
    }
  }
}

function extractTreeRelativePath(owner, repo, href, defaultBranch) {
  try {
    const url = new URL(href, location.origin);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 4) return '';
    if (parts[0] !== owner || parts[1] !== repo) return '';

    if (parts[2] === 'blob' || parts[2] === 'tree') {
      const branch = parts[3];
      const pathParts = parts.slice(4);
      if (branch && pathParts.length > 0) {
        return decodeURIComponent(pathParts.join('/'));
      }
      if (branch === defaultBranch && pathParts.length === 0) return '';
    }

    if (parts.length === 2) {
      return '';
    }
  } catch (_error) {
    return '';
  }
  return '';
}

async function injectPrComplexity(owner, repo) {
  const match = location.pathname.match(/^\/[^/]+\/[^/]+\/pull\/(\d+)/);
  if (!match) return;
  if (document.body.hasAttribute(PR_COMPLEXITY_ATTR)) return;
  document.body.setAttribute(PR_COMPLEXITY_ATTR, 'true');

  let response;
  try {
    response = await sendMessage({
      type: 'GET_PR_COMPLEXITY',
      payload: { owner, repo, number: Number(match[1]) }
    });
  } catch (_error) {
    return;
  }

  if (!response || !response.success || !response.data) return;
  const data = response.data;

  const header = document.querySelector('#partial-discussion-header');
  if (!header || header.parentNode.querySelector('.gh-pr-complexity')) return;

  const banner = document.createElement('div');
  banner.className = `gh-pr-complexity gh-pr-${data.complexity}`;

  const top = document.createElement('div');
  top.className = 'gh-pr-complexity-main';
  top.textContent = `[${capitalize(data.complexity)} PR] ${data.totalFiles} files · +${data.totalAdditions} -${data.totalDeletions} lines · ${data.testFileCount} test files (${data.testRatio}%)`;
  banner.appendChild(top);

  if (data.complexity === 'massive') {
    const warn = document.createElement('div');
    warn.className = 'gh-pr-complexity-warn';
    warn.textContent = '? This PR is too large to review effectively. Consider splitting into smaller PRs.';
    banner.appendChild(warn);
  }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'gh-pr-breakdown-toggle';
  toggle.textContent = 'Show file breakdown';

  const body = document.createElement('div');
  body.className = 'gh-pr-breakdown';

  data.extensionBreakdown.slice(0, 12).forEach((item) => {
    const chunk = document.createElement('span');
    chunk.className = 'gh-pr-breakdown-item';
    chunk.textContent = `${item.extension}: ${item.count} files`;
    body.appendChild(chunk);
  });

  toggle.addEventListener('click', () => {
    const shown = body.classList.toggle('is-open');
    toggle.textContent = shown ? 'Hide file breakdown' : 'Show file breakdown';
  });

  banner.appendChild(toggle);
  banner.appendChild(body);
  header.insertAdjacentElement('afterend', banner);
}

async function injectTodoHighlighter() {
  if (!/\/blob\//.test(location.pathname)) return;
  const fileTable = document.querySelector('table.js-file-line-container, table');
  if (!fileTable || fileTable.hasAttribute(TODO_ATTR)) return;
  fileTable.setAttribute(TODO_ATTR, 'true');

  const keywordRegex = /\b(TODO|FIXME|HACK|XXX|DEPRECATED|BUG|NOTE|OPTIMIZE)\b/i;
  const counts = {};
  const firstHits = {};

  const lines = fileTable.querySelectorAll('td.blob-code, td.react-code-cell');
  lines.forEach((line) => {
    const text = (line.textContent || '').trim();
    const match = text.match(keywordRegex);
    if (!match) return;

    const keyword = match[1].toUpperCase();
    counts[keyword] = (counts[keyword] || 0) + 1;
    if (!firstHits[keyword]) firstHits[keyword] = line;

    line.classList.add('gh-todo-line');

    if (!line.querySelector('.gh-todo-pill')) {
      const pill = document.createElement('span');
      pill.className = `gh-todo-pill gh-todo-${keyword.toLowerCase()}`;
      pill.textContent = keyword;
      line.insertBefore(pill, line.firstChild);
    }
  });

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (!total) return;

  if (document.querySelector('.gh-todo-summary')) return;
  const summary = document.createElement('div');
  summary.className = 'gh-todo-summary';
  summary.appendChild(document.createTextNode(`${total} annotations in this file:`));

  Object.keys(counts).forEach((key) => {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'gh-todo-summary-link';
    link.textContent = `${counts[key]} ${key}`;
    link.addEventListener('click', () => {
      const target = firstHits[key];
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    summary.appendChild(link);
  });

  const wrap = fileTable.closest('.js-file, .file') || fileTable.parentNode;
  if (wrap) {
    wrap.insertBefore(summary, wrap.firstChild);
  }
}

async function injectContributionInsights() {
  const graph = document.querySelector('.js-yearly-contributions, .js-profile-editable-area .js-yearly-contributions');
  if (!graph || graph.hasAttribute(INSIGHTS_ATTR)) return;

  const cells = Array.from(graph.querySelectorAll('[data-date][data-count]'));
  if (!cells.length) return;

  const points = cells
    .map((cell) => {
      const date = cell.getAttribute('data-date');
      const count = Number(cell.getAttribute('data-count')) || 0;
      const ts = new Date(date).getTime();
      return { date, count, ts };
    })
    .filter((item) => Number.isFinite(item.ts))
    .sort((a, b) => a.ts - b.ts);

  if (!points.length || points.every((item) => item.count === 0)) return;
  graph.setAttribute(INSIGHTS_ATTR, 'true');

  const totalsByMonth = new Map();
  const totalsByWeekday = new Map();
  let total = 0;
  let activeDays = 0;
  let longest = 0;
  let current = 0;
  let rolling = 0;
  let best = points[0];

  points.forEach((point, index) => {
    total += point.count;
    if (point.count > 0) {
      activeDays += 1;
      rolling += 1;
      if (rolling > longest) longest = rolling;
      best = point.count > best.count ? point : best;
    } else {
      rolling = 0;
    }

    const date = new Date(point.ts);
    const month = date.getMonth();
    const weekday = date.getDay();
    totalsByMonth.set(month, (totalsByMonth.get(month) || 0) + point.count);
    totalsByWeekday.set(weekday, (totalsByWeekday.get(weekday) || 0) + point.count);

    if (index === points.length - 1) {
      current = rolling;
    }
  });

  const topWeekday = [...totalsByWeekday.entries()].sort((a, b) => b[1] - a[1])[0];
  const topMonth = [...totalsByMonth.entries()].sort((a, b) => b[1] - a[1])[0];
  const avgActive = activeDays ? (total / activeDays) : 0;

  const panel = document.createElement('div');
  panel.className = 'gh-insights-panel';
  panel.appendChild(makeInsightCard('?? Current streak', `${current} days`));
  panel.appendChild(makeInsightCard('? Longest streak', `${longest} days`));
  panel.appendChild(makeInsightCard('?? Most active', weekdayName(topWeekday ? topWeekday[0] : 0)));
  panel.appendChild(makeInsightCard('?? Best day', `${formatShortDate(best.date)} (${best.count} contributions)`));
  panel.appendChild(makeInsightCard('?? Avg active day', `${avgActive.toFixed(1)} contributions`));

  const anchor = graph.closest('.js-yearly-contributions') || graph;
  anchor.insertAdjacentElement('afterend', panel);
}

function makeInsightCard(label, value) {
  const card = document.createElement('div');
  card.className = 'gh-insight-card';
  const top = document.createElement('div');
  top.className = 'gh-insight-label';
  top.textContent = label;
  const bottom = document.createElement('div');
  bottom.className = 'gh-insight-value';
  bottom.textContent = value;
  card.appendChild(top);
  card.appendChild(bottom);
  return card;
}

async function injectIssueAge(owner, repo) {
  if (!new RegExp(`^/${owner}/${repo}/issues$`).test(location.pathname)) return;
  const list = document.querySelector('[aria-label="Issues"], .js-navigation-container');
  if (!list || list.hasAttribute(ISSUES_AGE_ATTR)) return;
  list.setAttribute(ISSUES_AGE_ATTR, 'true');

  const rows = Array.from(document.querySelectorAll('[id^="issue_"], .js-issue-row'));
  if (!rows.length) return;

  const buckets = {
    new: [],
    recent: [],
    aging: [],
    old: [],
    stale: []
  };

  rows.forEach((row) => {
    if (row.querySelector('.gh-issue-age')) return;
    const timeEl = row.querySelector('relative-time[datetime], time[datetime]');
    if (!timeEl) return;
    const date = new Date(timeEl.getAttribute('datetime'));
    const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));

    let bucket = 'new';
    let label = 'New';
    if (days <= 7) {
      bucket = 'new';
      label = 'New';
    } else if (days <= 30) {
      bucket = 'recent';
      label = 'Recent';
    } else if (days <= 90) {
      bucket = 'aging';
      label = 'Aging';
    } else if (days <= 180) {
      bucket = 'old';
      label = 'Old';
    } else {
      bucket = 'stale';
      label = 'Stale';
    }

    const marker = document.createElement('span');
    marker.className = `gh-issue-age gh-issue-${bucket}`;
    marker.textContent = `? ${label}`;
    row.appendChild(marker);
    buckets[bucket].push(row);
  });

  if (document.querySelector('.gh-issues-summary')) return;

  const summary = document.createElement('div');
  summary.className = 'gh-issues-summary';
  summary.appendChild(document.createTextNode(
    `${rows.length} open issues: ${buckets.new.length} new · ${buckets.recent.length} recent · ${buckets.aging.length} aging · ${buckets.old.length} old · ${buckets.stale.length} stale`
  ));

  ['new', 'recent', 'aging', 'old', 'stale'].forEach((bucket) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gh-issues-filter';
    btn.textContent = bucket;
    btn.addEventListener('click', () => {
      const first = buckets[bucket][0];
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    summary.appendChild(btn);
  });

  const listRoot = document.querySelector('[aria-label="Issues"], .js-navigation-container');
  if (listRoot && listRoot.parentNode) {
    listRoot.parentNode.insertBefore(summary, listRoot);
  }
}

async function injectFileTypeIcons(owner, repo) {
  const isTreeLike = /\/[^/]+\/[^/]+(\/tree\/|$)/.test(location.pathname);
  if (!isTreeLike) return;

  const tree = document.querySelector('table[aria-labelledby="folders-and-files"], div[role="grid"]');
  if (!tree || tree.hasAttribute(ICONS_ATTR)) return;
  tree.setAttribute(ICONS_ATTR, 'true');

  const rows = tree.querySelectorAll('tr, div[role="row"]');
  rows.forEach((row) => {
    if (row.hasAttribute('data-icon-replaced')) return;
    const fileLink = row.querySelector(`a[href^="/${owner}/${repo}/blob/"]`);
    const folderLink = row.querySelector(`a[href^="/${owner}/${repo}/tree/"]`);
    const iconSvg = row.querySelector('svg');
    if (!iconSvg) return;

    let dataUri = '';
    if (fileLink) {
      dataUri = getMaterialFileIconDataUri((fileLink.textContent || '').trim());
    } else if (folderLink) {
      dataUri = getMaterialFolderIconDataUri((folderLink.textContent || '').trim());
    }
    if (!dataUri) return;

    const img = document.createElement('img');
    img.src = dataUri;
    img.width = 16;
    img.height = 16;
    img.alt = '';
    img.style.verticalAlign = 'middle';
    img.style.marginRight = '4px';
    img.style.borderRadius = '2px';

    iconSvg.replaceWith(img);
    row.setAttribute('data-icon-replaced', 'true');
  });
}

function getMaterialFileIconDataUri(filename) {
  const lower = filename.toLowerCase();
  if (lower === 'package.json') return buildTextIconUri('JSON', '#cb3837', '#fff', 7);
  if (lower === 'tsconfig.json') return buildTextIconUri('TS', '#3178c6', '#fff', 8);
  if (/^\.eslintrc/.test(lower)) return buildTextIconUri('CFG', '#4b32c3', '#fff', 7);
  if (/^\.prettierrc/.test(lower)) return buildTextIconUri('CFG', '#f7ba3e', '#000', 7);
  if (lower === 'dockerfile') return buildTextIconUri('DO', '#0db7ed', '#fff', 8);
  if (lower === '.gitignore') return buildTextIconUri('GIT', '#f54d27', '#fff', 8);
  if (lower === '.env' || lower.startsWith('.env.')) return buildTextIconUri('ENV', '#3c873a', '#fff', 8);
  if (lower.startsWith('readme')) return buildTextIconUri('RD', '#2ea043', '#fff', 8);
  if (lower.startsWith('license')) return buildTextIconUri('L', '#d29922', '#fff', 9);
  if (/\.test\./.test(lower) || /\.spec\./.test(lower)) return buildTextIconUri('TEST', '#21a366', '#fff', 7);

  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const map = {
    js: ['JS', '#f7df1e', '#000', 8], mjs: ['JS', '#f7df1e', '#000', 8], cjs: ['JS', '#f7df1e', '#000', 8],
    ts: ['TS', '#3178c6', '#fff', 8], tsx: ['X', '#61dafb', '#000', 9], jsx: ['X', '#61dafb', '#000', 9],
    py: ['PY', '#3572a5', '#fff', 8], rs: ['RS', '#dea584', '#000', 8], go: ['GO', '#00add8', '#fff', 8],
    java: ['JV', '#b07219', '#fff', 8], cs: ['C#', '#178600', '#fff', 8], cpp: ['C', '#555555', '#fff', 9], cc: ['C', '#555555', '#fff', 9], c: ['C', '#555555', '#fff', 9],
    rb: ['RB', '#701516', '#fff', 8], php: ['PHP', '#4f5d95', '#fff', 8], swift: ['SW', '#f05138', '#fff', 8], kt: ['KT', '#7f52ff', '#fff', 8],
    html: ['H', '#e34c26', '#fff', 10], css: ['CSS', '#563d7c', '#fff', 8], scss: ['SC', '#c6538c', '#fff', 8],
    json: ['{}', '#292929', '#f7df1e', 9], md: ['MD', '#083fa1', '#fff', 8], mdx: ['MD', '#083fa1', '#fff', 8],
    yaml: ['YML', '#cb171e', '#fff', 8], yml: ['YML', '#cb171e', '#fff', 8], toml: ['TML', '#9c4121', '#fff', 8],
    sh: ['SH', '#89e051', '#000', 8], bash: ['SH', '#89e051', '#000', 8], dockerfile: ['DO', '#0db7ed', '#fff', 8],
    sql: ['SQL', '#e38c00', '#fff', 8], vue: ['VUE', '#41b883', '#fff', 8], svelte: ['SV', '#ff3e00', '#fff', 8],
    graphql: ['GQL', '#e10098', '#fff', 8], gql: ['GQL', '#e10098', '#fff', 8], lock: ['L', '#888888', '#fff', 9]
  };
  const cfg = map[ext];
  if (!cfg) return '';
  return buildTextIconUri(cfg[0], cfg[1], cfg[2], cfg[3]);
}

function getMaterialFolderIconDataUri(folderName) {
  const key = folderName.toLowerCase();
  const map = {
    src: '#3178c6', components: '#00add8', pages: '#7f52ff', api: '#e38c00', tests: '#21a366', '__tests__': '#21a366',
    assets: '#f1e05a', static: '#f1e05a', public: '#f1e05a', styles: '#c6538c', css: '#c6538c',
    utils: '#6d8086', lib: '#6d8086', helpers: '#6d8086', docs: '#607d8b', '.github': '#24292f',
    node_modules: '#da3633', dist: '#d29922', build: '#d29922', out: '#d29922', '.git': '#f54d27'
  };
  const color = map[key];
  if (!color) return '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path d="M1 3.5A1.5 1.5 0 012.5 2h3.44l1.5 1.5H13.5A1.5 1.5 0 0115 5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5z" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function buildTextIconUri(label, bg, fg, size) {
  const safeLabel = String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><rect width="16" height="16" rx="2" fill="${bg}"/><text x="8" y="11" font-family="-apple-system,sans-serif" font-size="${size}" font-weight="700" fill="${fg}" text-anchor="middle">${safeLabel}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function injectBlobFileActions(owner, repo) {
  if (!/\/blob\//.test(location.pathname)) return;
  const actionBar = document.querySelector('.file-actions, [aria-label="File actions"], .BtnGroup');
  if (!actionBar || actionBar.querySelector(`[${FILE_ACTIONS_ATTR}]`)) return;

  const parsed = parseBlobUrlPath(location.pathname);
  if (!parsed) return;

  const group = document.createElement('div');
  group.className = 'gh-file-actions-group';
  group.setAttribute(FILE_ACTIONS_ATTR, 'true');

  const downloadBtn = createSecondaryActionButton('Download');
  downloadBtn.addEventListener('click', () => {
    downloadSingleFileRaw(owner, repo, parsed.branch, parsed.filePath, parsed.fileName).catch(() => {});
  });

  const copyBtn = createSecondaryActionButton('Copy');
  copyBtn.addEventListener('click', async () => {
    const old = copyBtn.textContent;
    copyBtn.textContent = 'Copying...';
    try {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${parsed.branch}/${parsed.filePath}`;
      const response = await fetch(rawUrl);
      const buffer = await response.arrayBuffer();
      if (!isLikelyTextContent(buffer)) {
        copyBtn.title = 'Cannot copy binary file';
        copyBtn.textContent = old;
        return;
      }
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = old; }, 1500);
    } catch (_error) {
      copyBtn.textContent = old;
    }
  });

  group.appendChild(downloadBtn);
  group.appendChild(copyBtn);
  actionBar.appendChild(group);
}

async function injectGitZipButtons(owner, repo) {
  const isRoot = new RegExp(`^/${owner}/${repo}$`).test(location.pathname);
  const treeMatch = location.pathname.match(new RegExp(`^/${owner}/${repo}/tree/([^/]+)(?:/(.*))?$`));

  if (isRoot) {
    const codeButton = document.querySelector('[data-testid="CodeButton"], get-repo summary, .file-navigation [aria-label="Code"]');
    if (codeButton && !document.querySelector('.gh-download-zip-root')) {
      const btn = createSecondaryActionButton('Download ZIP');
      btn.classList.add('gh-download-zip-root');
      const branch = detectCurrentBranch() || 'main';
      btn.addEventListener('click', () => {
        window.location.href = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
      });
      const wrap = codeButton.closest('div, details')?.parentNode || codeButton.parentNode;
      if (wrap) wrap.insertBefore(btn, codeButton.closest('div, details') || codeButton);
    }
  }

  if (!treeMatch) return;
  const branch = treeMatch[1];
  const folderPath = treeMatch[2] || '';
  const container = document.querySelector('.file-navigation, [data-testid="breadcrumb-nav"], .js-repo-nav');
  if (!container || container.querySelector(`[${GITZIP_ATTR}]`)) return;

  const btn = createSecondaryActionButton('Download folder');
  btn.setAttribute(GITZIP_ATTR, 'true');
  btn.addEventListener('click', () => {
    startFolderZipDownload(owner, repo, branch, folderPath, btn).catch(() => {});
  });
  container.appendChild(btn);
}

async function startFolderZipDownload(owner, repo, branch, folderPath, button) {
  const targetButton = button || activeFolderZipButton;
  const original = targetButton ? targetButton.textContent : 'Download folder';
  if (targetButton) targetButton.textContent = 'Fetching file list...';

  const countResponse = await sendMessage({
    type: 'GET_FOLDER_ZIP',
    payload: { owner, repo, branch, folderPath, countOnly: true }
  }).catch(() => null);

  const total = countResponse?.data?.totalFiles || 0;
  if (total > 100) {
    const ok = window.confirm(`This folder has ${total} files. Download may be slow. Continue?`);
    if (!ok) {
      if (targetButton) targetButton.textContent = original;
      return;
    }
  }

  activeFolderZipButton = targetButton || null;
  const response = await sendMessage({
    type: 'GET_FOLDER_ZIP',
    payload: { owner, repo, branch, folderPath }
  }).catch(() => null);

  if (!response?.success || !response.data || !Array.isArray(response.data.files)) {
    if (targetButton) {
      targetButton.textContent = 'Failed - try again';
      setTimeout(() => { targetButton.textContent = original; }, 2000);
    }
    return;
  }

  const files = response.data.files;
  const zip = new JSZip();
  files.forEach((item) => {
    zip.file(item.relativePath, item.base64Content, { base64: true });
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  const folderName = folderPath ? folderPath.split('/').pop() : 'root';
  triggerBlobDownload(blob, `${repo}-${folderName}.zip`);

  if (targetButton) {
    targetButton.textContent = 'Downloaded';
    setTimeout(() => { targetButton.textContent = original; }, 2000);
  }
  activeFolderZipButton = null;
}

async function downloadSingleFileRaw(owner, repo, branch, filePath, fileName) {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  const response = await fetch(rawUrl);
  if (!response.ok) return;
  const blob = await response.blob();
  triggerBlobDownload(blob, fileName || filePath.split('/').pop() || 'file');
}

function parseBlobUrlPath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 5 || parts[2] !== 'blob') return null;
  const branch = parts[3];
  const filePath = decodeURIComponent(parts.slice(4).join('/'));
  const fileName = filePath.split('/').pop() || 'file';
  return { branch, filePath, fileName };
}

function createSecondaryActionButton(text) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-sm';
  btn.textContent = text;
  return btn;
}

function isLikelyTextContent(buffer) {
  const view = new Uint8Array(buffer);
  const sample = view.slice(0, Math.min(view.length, 2048));
  let suspicious = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const byte = sample[i];
    if (byte === 0) return false;
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return suspicious / Math.max(sample.length, 1) < 0.08;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function injectOpenInIdeDropdown(owner, repo) {
  const codeButton = document.querySelector('[data-testid="CodeButton"], get-repo summary, .file-navigation [aria-label="Code"]');
  if (!codeButton) return;
  const parent = codeButton.closest('div, details')?.parentNode || codeButton.parentNode;
  if (!parent || parent.querySelector(`[${OPEN_IDE_ATTR}]`)) return;

  const order = getOnlineIdeOrder();
  const wrap = document.createElement('div');
  wrap.className = 'gh-open-ide-wrap';
  wrap.setAttribute(OPEN_IDE_ATTR, 'true');

  const button = createSecondaryActionButton('< > Open in IDE');
  button.classList.add('gh-open-ide-button');

  const panel = document.createElement('div');
  panel.className = 'gh-open-ide-panel';

  order.forEach((key) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'gh-open-ide-item';
    item.textContent = onlineIdeLabel(key);
    item.addEventListener('click', () => {
      const url = buildOnlineIdeUrl(key, owner, repo);
      if (url) {
        chrome.storage.local.set({ preferred_online_ide: key });
        window.open(url, '_blank', 'noopener');
      }
      panel.classList.remove('is-open');
    });
    panel.appendChild(item);
  });

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    panel.classList.toggle('is-open');
  });
  document.addEventListener('click', (event) => {
    if (!wrap.contains(event.target)) panel.classList.remove('is-open');
  });

  wrap.appendChild(button);
  wrap.appendChild(panel);
  parent.insertBefore(wrap, codeButton.closest('div, details') || codeButton);
}

function getOnlineIdeOrder() {
  const keys = ['github-dev', 'vscode-dev', 'codesandbox', 'stackblitz', 'gitpod', 'replit'];
  const hasPackage = Boolean(document.querySelector('a[href*="/blob/"][title="package.json"], a[title="package.json"]'));
  const hasDevcontainer = Boolean(document.querySelector('a[title=".devcontainer"], a[href*="/tree/"][title=".devcontainer"]'));
  if (hasDevcontainer) {
    return ['gitpod', ...keys.filter((k) => k !== 'gitpod')];
  }
  if (hasPackage) {
    return ['stackblitz', 'codesandbox', ...keys.filter((k) => !['stackblitz', 'codesandbox'].includes(k))];
  }
  const preferred = settings.preferred_online_ide || 'github-dev';
  return [preferred, ...keys.filter((k) => k !== preferred)];
}

function onlineIdeLabel(key) {
  return {
    'github-dev': 'GitHub Dev',
    'vscode-dev': 'VS Code Dev',
    codesandbox: 'CodeSandbox',
    stackblitz: 'StackBlitz',
    gitpod: 'Gitpod',
    replit: 'Replit'
  }[key] || 'GitHub Dev';
}

function buildOnlineIdeUrl(key, owner, repo) {
  const blobParts = parseBlobUrlPath(location.pathname);
  if (key === 'github-dev') {
    return location.href.replace('https://github.com/', 'https://github.dev/');
  }
  if (key === 'vscode-dev') {
    if (blobParts) {
      return `https://vscode.dev/github/${owner}/${repo}/blob/${blobParts.branch}/${blobParts.filePath}`;
    }
    return `https://vscode.dev/github/${owner}/${repo}`;
  }
  if (key === 'codesandbox') return `https://codesandbox.io/p/github/${owner}/${repo}`;
  if (key === 'stackblitz') return `https://stackblitz.com/github/${owner}/${repo}`;
  if (key === 'gitpod') return `https://gitpod.io/#https://github.com/${owner}/${repo}`;
  if (key === 'replit') return `https://replit.com/github/${owner}/${repo}`;
  return `https://github.dev/${owner}/${repo}`;
}

async function injectLocCounter(owner, repo) {
  const sidebar = document.querySelector('[data-testid="repository-about"] .BorderGrid, .Layout-sidebar .BorderGrid');
  if (!sidebar || sidebar.hasAttribute(LOC_ATTR)) return;
  sidebar.setAttribute(LOC_ATTR, 'true');

  const placeholder = document.createElement('div');
  placeholder.className = 'gh-loc-block';
  placeholder.textContent = '< > Counting lines...';
  sidebar.appendChild(placeholder);

  const response = await sendMessage({ type: 'GET_LOC', payload: { owner, repo } }).catch(() => null);
  const data = response?.data;
  if (!data || !Array.isArray(data.languages) || !Number.isFinite(Number(data.total))) {
    placeholder.remove();
    return;
  }

  placeholder.textContent = `< > ${formatCompactLoc(data.total)} lines of code`;
  const panel = document.createElement('div');
  panel.className = 'gh-loc-panel';

  const sorted = [...data.languages].sort((a, b) => b.linesOfCode - a.linesOfCode);
  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5);

  const renderRows = (rows, container) => {
    rows.forEach((row) => {
      const pct = data.total > 0 ? Math.round((row.linesOfCode / data.total) * 100) : 0;
      const item = document.createElement('div');
      item.className = 'gh-loc-row';
      const label = document.createElement('span');
      label.textContent = `${row.language} ${row.linesOfCode.toLocaleString()} (${pct}%)`;
      const bar = document.createElement('div');
      bar.className = 'gh-loc-bar';
      const fill = document.createElement('span');
      fill.className = 'gh-loc-fill';
      fill.style.width = `${pct}%`;
      fill.style.backgroundColor = languageColor(row.language);
      bar.appendChild(fill);
      item.appendChild(label);
      item.appendChild(bar);
      container.appendChild(item);
    });
  };

  renderRows(top, panel);
  if (rest.length > 0) {
    const more = document.createElement('div');
    more.className = 'gh-loc-more';
    renderRows(rest, more);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gh-loc-toggle';
    btn.textContent = 'Show more';
    btn.addEventListener('click', () => {
      const open = more.classList.toggle('is-open');
      btn.textContent = open ? 'Show less' : 'Show more';
    });
    panel.appendChild(btn);
    panel.appendChild(more);
  }

  placeholder.addEventListener('click', () => {
    panel.classList.toggle('is-open');
  });
  sidebar.appendChild(panel);
}

function formatCompactLoc(value) {
  const n = Number(value) || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

function languageColor(language) {
  const map = {
    JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572a5', CSS: '#563d7c', HTML: '#e34c26',
    Go: '#00add8', Rust: '#dea584', Java: '#b07219', Ruby: '#701516', PHP: '#4f5d95',
    'C++': '#f34b7d', C: '#555555', Swift: '#f05138', Kotlin: '#a97bff'
  };
  return map[language] || '#8b949e';
}

async function injectQuickCloneButton(owner, repo) {
  if (document.body.hasAttribute(CLONE_ATTR)) return;
  const codeButton = document.querySelector('[data-testid="CodeButton"], get-repo summary, .file-navigation [aria-label="Code"]');
  if (!codeButton) return;
  document.body.setAttribute(CLONE_ATTR, 'true');

  const wrap = codeButton.closest('div, details')?.parentNode || codeButton.parentNode;
  if (!wrap || wrap.querySelector('.gh-quick-clone-wrap')) return;

  const prefResponse = await sendMessage({ type: 'GET_CLONE_PREFERENCE' }).catch(() => ({ clone_preference: 'https' }));
  const preferred = (prefResponse && prefResponse.clone_preference) || 'https';

  const optionList = [
    { key: 'ssh', cmd: `git clone git@github.com:${owner}/${repo}.git` },
    { key: 'https', cmd: `git clone https://github.com/${owner}/${repo}.git` },
    { key: 'cli', cmd: `gh repo clone ${owner}/${repo}` }
  ];

  optionList.sort((a, b) => (a.key === preferred ? -1 : b.key === preferred ? 1 : 0));

  const host = document.createElement('div');
  host.className = 'gh-quick-clone-wrap';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm gh-quick-clone-btn';
  button.textContent = 'Quick Clone';

  const panel = document.createElement('div');
  panel.className = 'gh-quick-clone-panel';

  optionList.forEach((item) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'gh-quick-clone-option';
    row.textContent = `${item.key.toUpperCase()}: ${item.cmd}`;
    row.addEventListener('click', async () => {
      await navigator.clipboard.writeText(item.cmd);
      await sendMessage({ type: 'SET_CLONE_PREFERENCE', payload: { preference: item.key } }).catch(() => {});
      panel.classList.remove('is-open');
      const old = button.textContent;
      button.textContent = '? Copied!';
      setTimeout(() => {
        button.textContent = old;
      }, 1500);
    });
    panel.appendChild(row);
  });

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    panel.classList.toggle('is-open');
  });

  document.addEventListener('click', (event) => {
    if (!host.contains(event.target)) {
      panel.classList.remove('is-open');
    }
  });

  host.appendChild(button);
  host.appendChild(panel);
  wrap.insertBefore(host, codeButton.closest('div, details') || codeButton);
}

async function injectBookmarkButton(owner, repo) {
  const container = document.querySelector('#repository-container-header ul, #repository-container-header .pagehead-actions');
  if (!container || container.hasAttribute(BOOKMARK_ATTR)) return;
  container.setAttribute(BOOKMARK_ATTR, 'true');

  let bookmarks = [];
  try {
    const response = await sendMessage({ type: 'GET_BOOKMARKS' });
    bookmarks = (response && response.bookmarks) || [];
  } catch (_error) {
    bookmarks = [];
  }

  const key = `${owner}/${repo}`;
  const existing = bookmarks.find((item) => `${item.owner}/${item.repo}` === key);

  const host = document.createElement('li');
  host.className = 'd-inline-flex gh-bookmark-host';

  const svgIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:middle;margin-right:4px"><path d="M3 2.75C3 1.784 3.784 1 4.75 1h6.5c.966 0 1.75.784 1.75 1.75v11.5a.75.75 0 01-1.28.53L8 11.06l-3.72 3.72A.75.75 0 013 14.25V2.75z"/></svg>`;

  function setBookmarkLabel(btn, isBookmarked) {
    btn.innerHTML = svgIcon + (isBookmarked ? 'Bookmarked' : 'Bookmark');
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm gh-bookmark-btn';
  setBookmarkLabel(button, Boolean(existing));

  const panel = document.createElement('div');
  panel.className = 'gh-bookmark-panel';

  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.className = 'gh-bookmark-input';
  tagsInput.placeholder = 'reference, typescript, work';
  tagsInput.value = existing ? (existing.tags || []).join(', ') : '';

  const noteInput = document.createElement('textarea');
  noteInput.className = 'gh-bookmark-note';
  noteInput.maxLength = 200;
  noteInput.placeholder = 'Short note (optional)';
  noteInput.value = existing ? (existing.note || '') : '';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn-sm';
  saveButton.textContent = existing ? 'Remove Bookmark' : 'Save Bookmark';

  saveButton.addEventListener('click', async () => {
    if (existing) {
      await sendMessage({ type: 'REMOVE_BOOKMARK', payload: { owner, repo } });
      setBookmarkLabel(button, false);
    } else {
      const tags = tagsInput.value.split(',').map((item) => item.trim()).filter(Boolean);
      await sendMessage({ type: 'SET_BOOKMARK', payload: { owner, repo, tags, note: noteInput.value.trim() } });
      setBookmarkLabel(button, true);
    }
    panel.classList.remove('is-open');
    container.removeAttribute(BOOKMARK_ATTR);
    injectBookmarkButton(owner, repo).catch(() => {});
  });

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    panel.classList.toggle('is-open');
  });

  panel.appendChild(tagsInput);
  panel.appendChild(noteInput);
  panel.appendChild(saveButton);
  host.appendChild(button);
  host.appendChild(panel);
  container.appendChild(host);

  document.addEventListener('click', (event) => {
    if (!host.contains(event.target)) {
      panel.classList.remove('is-open');
    }
  });
}

async function trackRecentRepo(owner, repo) {
  const key = `${owner}/${repo}`;
  if (lastTrackedRepo === key) return;
  lastTrackedRepo = key;
  await sendMessage({
    type: 'SAVE_RECENT_REPO',
    payload: {
      owner,
      repo,
      title: document.title || key
    }
  }).catch(() => {});
}

async function injectStarHistory(owner, repo) {
  if (document.body.hasAttribute(STAR_HISTORY_ATTR)) return;

  const starsAnchor = document.querySelector('a[href$="/stargazers"], #repo-stars-counter-star');
  if (!starsAnchor) return;
  document.body.setAttribute(STAR_HISTORY_ATTR, 'true');

  const response = await sendMessage({ type: 'GET_STAR_HISTORY', payload: { owner, repo } }).catch(() => null);
  if (!response || !response.success || !response.data) return;

  if (document.querySelector('.gh-star-history')) return;

  const wrap = document.createElement('div');
  wrap.className = 'gh-star-history';

  const svg = buildInlineSparkline(response.data.points || []);
  wrap.appendChild(svg);

  const meta = document.createElement('div');
  meta.className = 'gh-star-history-meta';
  if (response.data.monthlyGrowth) {
    meta.textContent = `+${formatCompact(response.data.monthlyGrowth)} this month`;
  } else if (response.data.firstStarAt) {
    meta.textContent = `First starred: ${formatMonthYear(response.data.firstStarAt)}`;
  } else {
    meta.textContent = 'Star history unavailable';
  }

  wrap.appendChild(meta);
  const host = starsAnchor.closest('div, li, p') || starsAnchor.parentNode;
  if (host) {
    host.appendChild(wrap);
  }
}

function buildInlineSparkline(points) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '120');
  svg.setAttribute('height', '32');
  svg.setAttribute('viewBox', '0 0 120 32');
  svg.classList.add('gh-star-sparkline');

  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  const safePoints = points.length ? points : [{ x: 0, y: 0 }, { x: 4, y: 1 }];
  const maxY = Math.max(...safePoints.map((p) => p.y), 1);

  const mapped = safePoints.map((point, index) => {
    const x = 4 + (index / Math.max(1, safePoints.length - 1)) * 112;
    const y = 28 - ((point.y || 0) / maxY) * 24;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  polyline.setAttribute('points', mapped.join(' '));
  polyline.setAttribute('stroke', '#2f81f7');
  polyline.setAttribute('stroke-width', '2');
  polyline.setAttribute('fill', 'none');
  svg.appendChild(polyline);
  return svg;
}

async function injectCommitQuality() {
  if (!/\/commits\//.test(location.pathname) && !/\/commits$/.test(location.pathname)) return;
  const container = document.querySelector('.js-navigation-container, .TimelineItem-body');
  if (!container || container.hasAttribute(COMMIT_QUALITY_ATTR)) return;
  container.setAttribute(COMMIT_QUALITY_ATTR, 'true');

  const commitLinks = Array.from(document.querySelectorAll('a.Link--primary.text-bold, a.markdown-title'));
  if (!commitLinks.length) return;

  let good = 0;
  let total = 0;

  commitLinks.forEach((link) => {
    if (link.querySelector('.gh-commit-quality-icon')) return;
    const text = (link.textContent || '').trim();
    if (!text) return;
    total += 1;

    const quality = evaluateCommitQuality(text);
    if (quality === 'neutral') return;

    if (quality === 'good') good += 1;

    const icon = document.createElement('span');
    icon.className = `gh-commit-quality-icon is-${quality}`;
    icon.textContent = quality === 'good' ? '?' : '?';
    icon.title = quality === 'good'
      ? 'Good commit message format'
      : 'Poor commit message - consider using conventional commits';
    link.appendChild(icon);
  });

  if (total > 5 && !document.querySelector('.gh-commit-quality-summary')) {
    const summary = document.createElement('div');
    summary.className = 'gh-commit-quality-summary';
    const percent = total ? Math.round((good / total) * 100) : 0;
    summary.textContent = `Commit quality: ${good}/${total} good messages (${percent}%)`;

    const anchor = document.querySelector('.commits-listing, .js-navigation-container') || container;
    anchor.insertAdjacentElement('beforebegin', summary);
  }
}

function evaluateCommitQuality(message) {
  const lower = message.toLowerCase();
  const badWords = ['fix', 'update', 'wip', 'test', 'misc'];
  if (badWords.includes(lower)) return 'bad';
  if (message.length < 10) return 'bad';
  if (/^[0-9\W_]+$/.test(message)) return 'bad';
  if (message.endsWith('...')) return 'bad';
  if (/^[a-z]+$/.test(message) && message.split(' ').length === 1) return 'bad';

  if (/^(feat|fix|docs|chore|refactor|test|style|perf|ci|build)(\([^)]+\))?:/.test(lower)) return 'good';
  if (message.length >= 20 && message.length <= 72 && message.split(' ').length >= 3) return 'good';

  return 'neutral';
}

async function injectOpenInEditor(owner, repo) {
  const isBlob = /\/blob\//.test(location.pathname);
  const isRepo = /^\/[^/]+\/[^/]+(\/.*)?$/.test(location.pathname);
  if (!isBlob && !isRepo) return;

  if (document.body.hasAttribute(OPEN_EDITOR_ATTR)) return;

  const target = isBlob
    ? document.querySelector('.file-actions, [aria-label="File actions"]')
    : document.querySelector('[data-testid="CodeButton"], get-repo summary, .file-navigation');
  if (!target) return;

  document.body.setAttribute(OPEN_EDITOR_ATTR, 'true');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm gh-open-editor-btn';

  const editorName = getEditorName(settings.preferred_editor);
  button.textContent = `Open in ${editorName}`;

  button.addEventListener('click', () => {
    const deepLink = buildEditorDeepLink(owner, repo, settings.preferred_editor, isBlob);
    if (deepLink) {
      window.location.href = deepLink;
    }
  });

  if (isBlob) {
    button.title = 'Requires this repository to be cloned locally for file links to work.';
  }

  const host = target.closest('div') || target;
  host.insertAdjacentElement('afterbegin', button);
}

function buildEditorDeepLink(owner, repo, editor, isBlob) {
  const schemes = {
    vscode: 'vscode',
    'vscode-insiders': 'vscode-insiders',
    cursor: 'cursor',
    windsurf: 'windsurf'
  };

  const scheme = schemes[editor] || 'vscode';
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;

  if (!isBlob) {
    return `${scheme}://vscode.git/clone?url=${encodeURIComponent(cloneUrl)}`;
  }

  const filePath = location.pathname.split('/blob/')[1] || '';
  return `${scheme}://file/${encodeURIComponent(filePath)}`;
}

function getEditorName(editor) {
  if (editor === 'vscode-insiders') return 'VS Code Insiders';
  if (editor === 'cursor') return 'Cursor';
  if (editor === 'windsurf') return 'Windsurf';
  return 'VS Code';
}

function startObserver() {
  stopObserver();
  observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      stopObserver();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        cleanupAllBadges();
        scanPage();
        startObserver();
      }, 600);
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanPage, 300);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
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

function isExpectedRuntimeError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('Extension context invalidated')
    || message.includes('Receiving end does not exist');
}

function getBadgesHiddenState() {
  return new Promise((resolve) => {
    chrome.storage.local.get('badges_hidden', (result) => resolve(Boolean(result.badges_hidden)));
  });
}

function getColorClass(score) {
  if (score >= 7) return 'green';
  if (score >= 4) return 'yellow';
  return 'red';
}

function buildSparklineSvg(scores, colorClass) {
  const width = 80;
  const height = 24;
  const padding = 2;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;
  const points = scores.map((value, index) => {
    const x = padding + (index / (scores.length - 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const stroke = colorClass === 'green' ? '#238636' : colorClass === 'yellow' ? '#d29922' : '#da3633';
  return `<svg class="gh-health-sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="${points.join(' ')}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function formatLicenseShortName(name, key) {
  if (name) {
    return name.replace(' License', '').replace('GNU ', '');
  }
  return (key || '').toUpperCase();
}

function stripTrailingZero(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return Number.isInteger(num) ? String(num) : String(num);
}

function safeNonNegative(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
}

function sanitizeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return '0';
  return stripTrailingZero(num);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countWords(text) {
  return (text.trim().match(/\S+/g) || []).length;
}

function formatBytes(bytes) {
  const b = Math.max(0, Number(bytes) || 0);
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

function weekdayName(day) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] || 'Sunday';
}

function formatShortDate(dateIso) {
  const d = new Date(dateIso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMonthYear(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function formatCompact(value) {
  const n = Number(value) || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function detectCurrentBranch() {
  const branchLink = document.querySelector('a[href*="/tree/"].css-truncate-target, summary[title*="Switch branches"], button[aria-label*="Switch branches"]');
  if (branchLink) {
    const text = (branchLink.textContent || '').trim();
    if (text && !text.includes('/')) return text;
  }
  const pathMatch = location.pathname.match(/^\/[^/]+\/[^/]+\/tree\/([^/]+)/);
  if (pathMatch) return decodeURIComponent(pathMatch[1]);
  return 'main';
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function cleanupAllBadges() {
  document.querySelectorAll('.gh-health-badge').forEach((badge) => badge.remove());
  document.querySelectorAll('.gh-readme-toc, .gh-pr-complexity, .gh-todo-summary, .gh-insights-panel, .gh-issues-summary, .gh-quick-clone-wrap, .gh-star-history, .gh-open-editor-btn, .gh-commit-quality-summary, .gh-file-actions-group, .gh-download-zip-root, .gh-open-ide-wrap, .gh-loc-block, .gh-loc-panel').forEach((node) => node.remove());
  document.querySelectorAll('[data-health-done], [data-toc-done], [data-sizes-done], [data-pr-complexity-done], [data-todo-done], [data-insights-done], [data-issues-age-done], [data-icons-done], [data-clone-done], [data-star-history-done], [data-commit-quality-done], [data-open-editor-done], [data-bookmark-done], [data-file-actions-done], [data-gitzip-done], [data-open-ide-done], [data-loc-done]').forEach((element) => {
    element.removeAttribute('data-health-done');
    element.removeAttribute('data-toc-done');
    element.removeAttribute('data-sizes-done');
    element.removeAttribute('data-pr-complexity-done');
    element.removeAttribute('data-todo-done');
    element.removeAttribute('data-insights-done');
    element.removeAttribute('data-issues-age-done');
    element.removeAttribute('data-icons-done');
    element.removeAttribute('data-clone-done');
    element.removeAttribute('data-star-history-done');
    element.removeAttribute('data-commit-quality-done');
    element.removeAttribute('data-open-editor-done');
    element.removeAttribute('data-bookmark-done');
    element.removeAttribute('data-file-actions-done');
    element.removeAttribute('data-gitzip-done');
    element.removeAttribute('data-open-ide-done');
    element.removeAttribute('data-loc-done');
  });
}
