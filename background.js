const CACHE_TTL_HEALTH = 6 * 60 * 60 * 1000;
const CACHE_TTL_DEPS = 24 * 60 * 60 * 1000;
const CACHE_TTL_PR = 60 * 60 * 1000;
const CACHE_TTL_STAR_HISTORY = 12 * 60 * 60 * 1000;
const CACHE_TTL_LOC = 24 * 60 * 60 * 1000;
const CACHE_TTL_NOTIFICATIONS = 5 * 60 * 1000;
const MAX_HISTORY = 10;
const MAX_RECENT_SCANS = 10;
const MAX_RECENT_REPOS = 20;
const DEP_CHECK_LIMIT = 5;

const SETTINGS_KEY = 'settings';
const PAT_KEY = 'github_pat';
const RATE_LIMIT_KEY = 'rate_limit';
const WATCHLIST_KEY = 'watchlist';
const WATCHLIST_SCORES_KEY = 'watchlist_scores';
const RECENT_SCANS_KEY = 'recent_scans';
const RECENT_REPOS_KEY = 'recent_repos';
const BOOKMARKS_KEY = 'bookmarks';
const BADGES_HIDDEN_KEY = 'badges_hidden';

const DEFAULT_SETTINGS = {
  showOnSearch: true,
  showOnTrending: true,
  showDeps: true,
  showBusFactor: true,
  showLicenseRisk: true,
  showReadmeToc: true,
  showPrComplexity: true,
  showTodoHighlights: true,
  showContributionInsights: true,
  showIssueAge: true,
  showFileTypeIcons: true,
  showQuickClone: true,
  showStarHistory: true,
  showCommitQuality: true,
  showFileEnhancements: true,
  showMarkdownPrinter: true,
  showVSIcons: true,
  showWebIDE: true,
  showLOCSidebar: true,
  showAbsoluteDates: true,
  showHealthSidebar: true
};

const SAFE_LICENSES = new Set([
  'mit', 'apache-2.0', 'bsd-2-clause', 'bsd-3-clause', 'isc', 'unlicense', '0bsd', 'mpl-2.0'
]);
const COPYLEFT_LICENSES = new Set([
  'gpl-2.0', 'gpl-3.0', 'lgpl-2.0', 'lgpl-2.1', 'lgpl-3.0', 'agpl-3.0'
]);

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaults().catch(logError);
  chrome.alarms.create('watchlist-check', { periodInMinutes: 360 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('watchlist-check', { periodInMinutes: 360 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'watchlist-check') {
    checkWatchlistRepos().catch(logError);
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-badges') {
    chrome.storage.local.get(BADGES_HIDDEN_KEY, (result) => {
      const newState = !result.badges_hidden;
      chrome.storage.local.set({ [BADGES_HIDDEN_KEY]: newState });
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'TOGGLE_BADGES',
            hidden: newState
          });
        }
      });
    });
    return;
  }

  if (command === 'open-in-ide') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'OPEN_PREFERRED_IDE' });
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  routeMessage(message, sender)
    .then((payload) => sendResponse({ success: true, ...payload }))
    .catch((error) => {
      if (!isExpectedError(error)) {
        logError(error);
      }
      sendResponse({ success: false, error: error.message || 'UNKNOWN' });
    });
  return true;
});

async function routeMessage(message, sender) {
  switch (message.type) {
    case 'GET_REPO_HEALTH': {
      const payload = message.payload || {};
      const data = await handleHealthRequest(payload.owner, payload.repo, {
        bypassCache: Boolean(payload.bypassCache),
        recordRecent: payload.recordRecent !== false
      });
      return { data };
    }
    case 'GET_CACHED_REPO_HEALTH': {
      const payload = message.payload || {};
      const data = await getCached(`health_${payload.owner}_${payload.repo}`, CACHE_TTL_HEALTH);
      return { data };
    }
    case 'GET_HISTORY': {
      const payload = message.payload || {};
      return { history: await getHistory(payload.owner, payload.repo) };
    }
    case 'GET_RECENT_SCANS': {
      return { recentScans: await getRecentScans() };
    }
    case 'GET_WATCHLIST': {
      return {
        watchlist: await getWatchlist(),
        watchlistScores: (await getStorageValue(WATCHLIST_SCORES_KEY)) || {}
      };
    }
    case 'ADD_TO_WATCHLIST': {
      const payload = message.payload || {};
      return { watchlist: await addToWatchlist(payload.owner, payload.repo) };
    }
    case 'REMOVE_FROM_WATCHLIST': {
      const payload = message.payload || {};
      return { watchlist: await removeFromWatchlist(payload.owner, payload.repo) };
    }
    case 'GET_RATE_LIMIT': {
      return { rateLimit: (await getStorageValue(RATE_LIMIT_KEY)) || null };
    }
    case 'GET_ALL_CACHE': {
      return { data: await getAllCacheEntries() };
    }
    case 'GET_SETTINGS': {
      return { settings: await getSettings() };
    }
    case 'SET_SETTINGS': {
      return { settings: await setSettings(message.payload || {}) };
    }
    case 'CLEAR_CACHED_DATA': {
      await clearCachedData();
      return {};
    }
    case 'GET_PR_COMPLEXITY': {
      const payload = message.payload || {};
      const data = await getPrComplexity(payload.owner, payload.repo, payload.number);
      return { data };
    }
    case 'GET_STAR_HISTORY': {
      const payload = message.payload || {};
      const data = await getStarHistory(payload.owner, payload.repo, payload.totalStars);
      return { data };
    }
    case 'GET_LOC': {
      const payload = message.payload || {};
      const data = await getLocData(payload.owner, payload.repo);
      return { data };
    }
    case 'GET_LOC_FULL': {
      const payload = message.payload || {};
      const data = await getLocFullData(payload.owner, payload.repo, Boolean(payload.bypassCache));
      return { data };
    }
    case 'GET_NOTIFICATIONS': {
      const data = await getGroupedNotifications();
      return { data };
    }
    case 'MARK_ALL_NOTIFICATIONS_READ': {
      const data = await markAllNotificationsRead();
      return { data };
    }
    case 'MARK_REPO_NOTIFICATIONS_READ': {
      const payload = message.payload || {};
      const data = await markRepoNotificationsRead(payload.owner, payload.repo);
      return { data };
    }
    case 'GET_BOOKMARKS': {
      return { bookmarks: await getBookmarks() };
    }
    case 'SET_BOOKMARK': {
      const payload = message.payload || {};
      return { bookmarks: await setBookmark(payload) };
    }
    case 'REMOVE_BOOKMARK': {
      const payload = message.payload || {};
      return { bookmarks: await removeBookmark(payload.owner, payload.repo) };
    }
    case 'GET_RECENT_REPOS': {
      return { recentRepos: await getRecentRepos() };
    }
    case 'SAVE_RECENT_REPO': {
      const payload = message.payload || {};
      return { recentRepos: await saveRecentRepo(payload) };
    }
    case 'GET_CLONE_PREFERENCE': {
      return { clone_preference: (await getStorageValue('clone_preference')) || 'https' };
    }
    case 'SET_CLONE_PREFERENCE': {
      const preference = (message.payload && message.payload.preference) || 'https';
      await setStorageValue({ clone_preference: preference });
      return { clone_preference: preference };
    }
    default:
      return {};
  }
}

async function handleHealthRequest(owner, repo, options) {
  if (!owner || !repo) {
    throw new Error('INVALID_REPO');
  }
  const opts = options || {};
  const cacheKey = `health_${owner}_${repo}`;

  if (!opts.bypassCache) {
    const cached = await getCached(cacheKey, CACHE_TTL_HEALTH);
    if (cached) {
      return cached;
    }
  }

  const rawData = await fetchRepoData(owner, repo);
  const deps = await getDependencyRisk(owner, repo);
  const healthData = calculateHealthScore(rawData, deps);

  await setCached(cacheKey, healthData);
  await appendHistory(owner, repo, healthData.score);
  if (opts.recordRecent !== false) {
    await appendRecentScan(owner, repo, healthData.score);
  }

  return healthData;
}

async function fetchRepoData(owner, repo) {
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = await buildGitHubHeaders();

  const requests = await Promise.allSettled([
    trackedGitHubFetch(base, headers),
    trackedGitHubFetch(`${base}/stats/commit_activity`, headers),
    trackedGitHubFetch(`${base}/contributors?per_page=100`, headers),
    trackedGitHubFetch(`${base}/issues?state=closed&per_page=10&sort=updated`, headers),
    trackedGitHubFetch(`${base}/pulls?state=closed&per_page=10&sort=updated`, headers),
    trackedGitHubFetch(`${base}/releases?per_page=1`, headers)
  ]);

  const repoResponse = resolvePrimaryResponse(requests[0]);
  const repoData = await repoResponse.json();

  const commitActivity = await parseArrayResponse(requests[1]);
  const contributors = await parseArrayResponse(requests[2]);
  const closedIssues = await parseArrayResponse(requests[3]);
  const closedPulls = await parseArrayResponse(requests[4]);
  const releases = await parseArrayResponse(requests[5]);

  const realIssues = closedIssues.filter((item) => !item.pull_request);
  const contributorStats = analyzeContributors(contributors);
  const velocityStats = analyzeVelocity(realIssues, closedPulls);
  const releaseStats = analyzeRelease(releases);
  const licenseStats = analyzeLicense(repoData.license);

  return {
    repoData,
    commitActivity,
    contributorCount: contributors.length || 1,
    busFactor: contributorStats.busFactor,
    topContributorShare: contributorStats.topContributorShare,
    topContributorLogin: contributorStats.topContributorLogin,
    avgIssueCloseDays: velocityStats.avgIssueCloseDays,
    avgPRMergeDays: velocityStats.avgPRMergeDays,
    velocityLabel: velocityStats.velocityLabel,
    daysSinceRelease: releaseStats.daysSinceRelease,
    latestVersion: releaseStats.latestVersion,
    releaseLabel: releaseStats.releaseLabel,
    licenseKey: licenseStats.licenseKey,
    licenseName: licenseStats.licenseName,
    licenseRisk: licenseStats.licenseRisk,
    repoAgeMonths: getRepoAgeMonths(repoData.created_at),
    ageLabel: getAgeLabel(repoData.created_at)
  };
}

function resolvePrimaryResponse(settlement) {
  if (settlement.status === 'rejected') {
    throw settlement.reason instanceof Error ? settlement.reason : new Error('UNKNOWN');
  }

  const response = settlement.value;
  if (response.ok) {
    return response;
  }

  if (response.status === 404) throw new Error('NOT_FOUND');
  if (response.status === 403) throw new Error('RATE_LIMITED');
  if (response.status === 401) throw new Error('AUTH_ERROR');
  throw new Error(`GitHub API error: ${response.status}`);
}

async function parseArrayResponse(settlement) {
  if (settlement.status !== 'fulfilled') {
    return [];
  }

  const response = settlement.value;
  if (!response.ok || response.status === 202) {
    return [];
  }

  try {
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (_error) {
    return [];
  }
}

function analyzeContributors(contributors) {
  if (!Array.isArray(contributors) || contributors.length === 0) {
    return {
      busFactor: 'healthy',
      topContributorShare: 0,
      topContributorLogin: null
    };
  }

  const totalContributions = contributors.reduce((sum, contributor) => {
    return sum + (contributor.contributions || 0);
  }, 0);

  const topContributor = contributors[0] || {};
  const share = totalContributions > 0
    ? round1(((topContributor.contributions || 0) / totalContributions) * 100)
    : 0;

  let busFactor = 'healthy';
  if (share > 60) {
    busFactor = 'high risk';
  } else if (share > 40) {
    busFactor = 'moderate';
  }

  return {
    busFactor,
    topContributorShare: share,
    topContributorLogin: topContributor.login || null
  };
}

function analyzeVelocity(issues, pulls) {
  const issueCloseDays = issues
    .filter((issue) => issue.closed_at && issue.created_at)
    .map((issue) => {
      const days = (new Date(issue.closed_at).getTime() - new Date(issue.created_at).getTime()) / 86400000;
      return round1(days);
    })
    .filter((days) => Number.isFinite(days) && days >= 0);

  const mergedPulls = pulls.filter((pull) => pull.merged_at && pull.created_at);
  const prMergeDays = mergedPulls
    .map((pull) => {
      const days = (new Date(pull.merged_at).getTime() - new Date(pull.created_at).getTime()) / 86400000;
      return round1(days);
    })
    .filter((days) => Number.isFinite(days) && days >= 0);

  const avgIssueCloseDays = safeAvg(issueCloseDays);
  const avgPRMergeDays = safeAvg(prMergeDays);

  let velocityLabel = 'slow';
  if (avgIssueCloseDays === null && avgPRMergeDays === null) {
    velocityLabel = 'unknown';
  } else if (avgIssueCloseDays !== null && avgPRMergeDays !== null && avgIssueCloseDays <= 7 && avgPRMergeDays <= 3) {
    velocityLabel = 'fast';
  } else if (avgIssueCloseDays !== null && avgPRMergeDays !== null && avgIssueCloseDays <= 30 && avgPRMergeDays <= 14) {
    velocityLabel = 'moderate';
  }

  return { avgIssueCloseDays, avgPRMergeDays, velocityLabel };
}

function safeAvg(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const rounded = round1(avg);
  return rounded < 0 ? 0 : rounded;
}

function analyzeRelease(releases) {
  if (!Array.isArray(releases) || releases.length === 0) {
    return {
      daysSinceRelease: null,
      latestVersion: null,
      releaseLabel: 'no releases'
    };
  }

  const latestRelease = releases[0];
  let daysSinceRelease = null;
  if (latestRelease && latestRelease.published_at) {
    const raw = (Date.now() - new Date(latestRelease.published_at).getTime()) / 86400000;
    daysSinceRelease = Number.isNaN(raw) ? null : Math.max(0, Math.round(raw));
  }

  let releaseLabel = 'no releases';
  if (daysSinceRelease !== null) {
    if (daysSinceRelease <= 90) releaseLabel = 'recent';
    else if (daysSinceRelease <= 365) releaseLabel = 'aging';
    else releaseLabel = 'stale';
  }

  return {
    daysSinceRelease,
    latestVersion: latestRelease.tag_name || null,
    releaseLabel
  };
}

function analyzeLicense(license) {
  const key = (license && license.key) || null;
  const name = (license && license.name) || null;

  let licenseRisk = 'unknown';
  if (!key) {
    licenseRisk = 'unlicensed';
  } else if (SAFE_LICENSES.has(key)) {
    licenseRisk = 'none';
  } else if (COPYLEFT_LICENSES.has(key)) {
    licenseRisk = 'copyleft';
  }

  return {
    licenseKey: key,
    licenseName: name,
    licenseRisk
  };
}

function calculateHealthScore(rawData, deps) {
  const repoData = rawData.repoData;
  const daysSinceLast = getDaysSince(repoData.pushed_at);
  const openIssues = repoData.open_issues_count || 0;
  const forks = repoData.forks_count || 0;
  const stars = repoData.stargazers_count || 0;
  const watchers = repoData.subscribers_count || 0;

  let recency = 0;
  if (daysSinceLast <= 7) recency = 2.0;
  else if (daysSinceLast <= 30) recency = 1.5;
  else if (daysSinceLast <= 90) recency = 1.0;
  else if (daysSinceLast <= 180) recency = 0.5;

  const recentWeeks = Array.isArray(rawData.commitActivity) ? rawData.commitActivity.slice(-12) : [];
  const avgCommits = recentWeeks.length
    ? recentWeeks.reduce((sum, week) => sum + (week.total || 0), 0) / recentWeeks.length
    : 0;

  let frequency = 0;
  if (avgCommits >= 10) frequency = 2.0;
  else if (avgCommits >= 5) frequency = 1.5;
  else if (avgCommits >= 2) frequency = 1.0;
  else if (avgCommits >= 1) frequency = 0.5;

  const activityScore = recency + frequency;

  const issueRatio = forks > 0 ? openIssues / forks : openIssues;
  let issueScore = 0;
  if (issueRatio <= 0.05) issueScore = 1.5;
  else if (issueRatio <= 0.15) issueScore = 1.0;
  else if (issueRatio <= 0.35) issueScore = 0.5;

  let contribScore = 0;
  if (rawData.contributorCount >= 20) contribScore = 1.5;
  else if (rawData.contributorCount >= 5) contribScore = 1.0;
  else if (rawData.contributorCount >= 2) contribScore = 0.5;

  const maintenanceScore = issueScore + contribScore;

  let starScore = 0;
  if (stars >= 10000) starScore = 1.5;
  else if (stars >= 1000) starScore = 1.0;
  else if (stars >= 100) starScore = 0.5;

  let forkScore = 0;
  if (forks >= 5000) forkScore = 0.75;
  else if (forks >= 500) forkScore = 0.5;
  else if (forks >= 50) forkScore = 0.25;

  let watcherScore = 0;
  if (watchers >= 1000) watcherScore = 0.75;
  else if (watchers >= 100) watcherScore = 0.5;
  else if (watchers >= 10) watcherScore = 0.25;

  const popularityScore = Math.min(3, starScore + forkScore + watcherScore);

  let rawTotal = activityScore + maintenanceScore + popularityScore;

  if (rawData.velocityLabel === 'fast') rawTotal += 0.5;
  if (rawData.velocityLabel === 'slow') rawTotal -= 0.5;
  if (rawData.busFactor === 'moderate') rawTotal -= 0.5;
  if (rawData.busFactor === 'high risk') rawTotal -= 1.0;
  if (rawData.releaseLabel === 'stale') rawTotal -= 0.5;
  if (rawData.licenseRisk === 'unknown') rawTotal -= 0.5;
  if (rawData.licenseRisk === 'unlicensed') rawTotal -= 1.5;
  if ((rawData.ageLabel === 'mature' || rawData.ageLabel === 'veteran') && activityScore >= 2) rawTotal += 0.3;

  const finalScore = Math.min(10, Math.round(rawTotal * 10) / 10);
  const score = clamp(finalScore, 0, 10);

  const status = daysSinceLast <= 30
    ? 'Active'
    : daysSinceLast <= 90
      ? 'Moderate'
      : daysSinceLast <= 180
        ? 'Slow'
        : 'Inactive';

  return {
    score,
    status,
    repoName: repoData.full_name,
    size: Number(repoData.size) || 0,
    activityScore: round1(activityScore),
    maintenanceScore: round1(maintenanceScore),
    popularityScore: round1(popularityScore),
    daysSinceLast,
    openIssues,
    stars,
    forks,
    deps,
    hasDeps: Boolean(deps),
    busFactor: rawData.busFactor,
    topContributorShare: rawData.topContributorShare,
    topContributorLogin: rawData.topContributorLogin,
    avgIssueCloseDays: rawData.avgIssueCloseDays,
    avgPRMergeDays: rawData.avgPRMergeDays,
    velocityLabel: rawData.velocityLabel,
    licenseKey: rawData.licenseKey,
    licenseName: rawData.licenseName,
    licenseRisk: rawData.licenseRisk,
    daysSinceRelease: rawData.daysSinceRelease,
    latestVersion: rawData.latestVersion,
    releaseLabel: rawData.releaseLabel,
    repoAgeMonths: rawData.repoAgeMonths,
    ageLabel: rawData.ageLabel,
    scannedAt: Date.now()
  };
}

async function getDependencyRisk(owner, repo) {
  const cacheKey = `deps_${owner}_${repo}`;
  const cached = await getCached(cacheKey, CACHE_TTL_DEPS);
  if (cached !== null) {
    return cached;
  }

  try {
    const pkgJson = await fetchPackageJson(owner, repo);
    if (!pkgJson) {
      await setCached(cacheKey, null);
      return null;
    }

    const allDeps = Object.assign({}, pkgJson.dependencies || {}, pkgJson.devDependencies || {});
    const depNames = Object.keys(allDeps).slice(0, DEP_CHECK_LIMIT);
    if (depNames.length === 0) {
      await setCached(cacheKey, null);
      return null;
    }

    const results = await Promise.allSettled(depNames.map((name) => auditPackage(name)));
    let vulnerableCount = 0;
    let outdatedCount = 0;
    const checkedPackages = [];

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      checkedPackages.push(result.value);
      if (result.value.hasVulns) vulnerableCount += 1;
      if (result.value.isOutdated) outdatedCount += 1;
    }

    let riskLabel = 'Clean';
    if (vulnerableCount >= 2) riskLabel = 'High Risk';
    else if (vulnerableCount === 1 || outdatedCount >= 3) riskLabel = 'Medium';
    else if (outdatedCount >= 1) riskLabel = 'Low Risk';

    const deps = {
      vulnerableCount,
      outdatedCount,
      riskLabel,
      checkedCount: depNames.length,
      checkedPackages
    };

    await setCached(cacheKey, deps);
    return deps;
  } catch (error) {
    console.warn('[GH Health] dependency risk failed:', error.message);
    return null;
  }
}

async function fetchPackageJson(owner, repo) {
  for (const branch of ['main', 'master']) {
    try {
      const response = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/package.json`);
      if (response.ok) {
        return JSON.parse(await response.text());
      }
    } catch (_error) {
      // noop
    }
  }
  return null;
}

async function auditPackage(name) {
  const registryResult = await Promise.resolve(fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`));
  const osvResult = await Promise.resolve(fetch('https://api.osv.dev/v1/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ package: { name, ecosystem: 'npm' } })
  }));

  let isOutdated = false;
  try {
    if (registryResult.ok) {
      const data = await registryResult.json();
      const modified = data && data.time && data.time.modified;
      if (modified) {
        const daysSince = (Date.now() - new Date(modified).getTime()) / 86400000;
        isOutdated = daysSince > 365;
      }
    }
  } catch (_error) {
    isOutdated = false;
  }

  let hasVulns = false;
  try {
    if (osvResult.ok) {
      const osvData = await osvResult.json();
      hasVulns = Array.isArray(osvData.vulns) && osvData.vulns.length > 0;
    }
  } catch (_error) {
    hasVulns = false;
  }

  return { name, isOutdated, hasVulns };
}

async function getPrComplexity(owner, repo, number) {
  const num = Number(number);
  if (!Number.isFinite(num)) {
    throw new Error('INVALID_PR');
  }
  const cacheKey = `pr_${owner}_${repo}_${num}`;
  const cached = await getCached(cacheKey, CACHE_TTL_PR);
  if (cached) return cached;

  const headers = await buildGitHubHeaders();
  const response = await trackedGitHubFetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}/files?per_page=100`, headers);
  if (!response.ok) {
    throw new Error('PR_FETCH_FAILED');
  }
  const files = await response.json();
  const safeFiles = Array.isArray(files) ? files : [];

  let totalAdditions = 0;
  let totalDeletions = 0;
  let testFileCount = 0;
  const extensionCounts = {};

  safeFiles.forEach((file) => {
    const additions = Number(file.additions) || 0;
    const deletions = Number(file.deletions) || 0;
    totalAdditions += additions;
    totalDeletions += deletions;

    const filename = file.filename || '';
    if (/__tests__\/|\.test\.|\.spec\.|_test\.|test_/i.test(filename)) {
      testFileCount += 1;
    }

    const ext = getFileExtensionLabel(filename);
    extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
  });

  const totalFiles = safeFiles.length;
  const totalChanges = totalAdditions + totalDeletions;
  const sourceFileCount = Math.max(0, totalFiles - testFileCount);
  const hasTests = testFileCount > 0;
  const testRatio = totalFiles > 0 ? Math.round((testFileCount / totalFiles) * 100) : 0;

  let complexity = 'massive';
  if (totalFiles <= 5 && totalChanges <= 100) complexity = 'simple';
  else if (totalFiles <= 15 && totalChanges <= 500) complexity = 'moderate';
  else if (totalFiles <= 30 && totalChanges <= 1000) complexity = 'large';

  const extensionBreakdown = Object.keys(extensionCounts)
    .sort((a, b) => extensionCounts[b] - extensionCounts[a])
    .map((ext) => ({ extension: ext, count: extensionCounts[ext] }));

  const payload = {
    totalFiles,
    totalAdditions,
    totalDeletions,
    totalChanges,
    testFileCount,
    sourceFileCount,
    hasTests,
    testRatio,
    complexity,
    extensionBreakdown,
    scannedAt: Date.now()
  };

  await setCached(cacheKey, payload);
  return payload;
}

async function getStarHistory(owner, repo) {
  const cacheKey = `star_history_${owner}_${repo}`;
  const cached = await getCached(cacheKey, CACHE_TTL_STAR_HISTORY);
  if (cached) return cached;

  const headers = await buildGitHubHeaders();
  headers.Accept = 'application/vnd.github.v3.star+json';

  let totalStars = 0;
  let criticalFailed = false;

  try {
    const repoResponse = await trackedGitHubFetch(`https://api.github.com/repos/${owner}/${repo}`, await buildGitHubHeaders());
    if (!repoResponse.ok) {
      criticalFailed = true;
    } else {
      const repoData = await repoResponse.json();
      totalStars = Number(repoData.stargazers_count) || 0;
    }
  } catch (_error) {
    criticalFailed = true;
  }

  let firstBatch = [];
  let middleBatch = [];
  let lastBatch = [];
  let lastPage = 1;

  try {
    const page1 = await trackedGitHubFetch(`https://api.github.com/repos/${owner}/${repo}/stargazers?per_page=100&page=1`, headers);
    if (!page1.ok) {
      criticalFailed = true;
    } else {
      firstBatch = await page1.json();
      const linkHeader = page1.headers.get('Link') || '';
      lastPage = parseLastPage(linkHeader);
    }
  } catch (_error) {
    criticalFailed = true;
  }

  const midPage = Math.max(1, Math.floor(lastPage / 2));
  if (midPage > 1) {
    try {
      const midResponse = await trackedGitHubFetch(`https://api.github.com/repos/${owner}/${repo}/stargazers?per_page=100&page=${midPage}`, headers);
      if (midResponse.ok) middleBatch = await midResponse.json();
    } catch (_error) {
      middleBatch = [];
    }
  }
  if (lastPage > 1) {
    try {
      const lastResponse = await trackedGitHubFetch(`https://api.github.com/repos/${owner}/${repo}/stargazers?per_page=100&page=${lastPage}`, headers);
      if (lastResponse.ok) lastBatch = await lastResponse.json();
    } catch (_error) {
      lastBatch = [];
    }
  }

  const allSample = []
    .concat(Array.isArray(firstBatch) ? firstBatch : [])
    .concat(Array.isArray(middleBatch) ? middleBatch : [])
    .concat(Array.isArray(lastBatch) ? lastBatch : []);

  const sampleDates = allSample
    .map((item) => new Date(item.starred_at).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  const firstStarTs = sampleDates.length ? sampleDates[0] : null;
  const now = Date.now();
  const daysSpan = firstStarTs ? Math.max(1, Math.round((now - firstStarTs) / 86400000)) : null;
  const monthlyGrowth = daysSpan ? Math.round((totalStars / daysSpan) * 30) : null;

  let points = [];
  if (sampleDates.length > 0) {
    const startTs = sampleDates[0];
    const span = Math.max(1, now - startTs);
    points = Array.from({ length: 5 }, (_, i) => {
      const threshold = startTs + Math.round((span * i) / 4);
      const sampledCount = sampleDates.filter((ts) => ts <= threshold).length;
      const ratio = sampleDates.length ? sampledCount / sampleDates.length : 0;
      return { x: i, y: Math.max(0, Math.round(totalStars * ratio)) };
    });
  } else {
    for (let i = 0; i < 5; i += 1) {
      const ratio = i / 4;
      const y = Math.max(0, Math.round(totalStars * ratio));
      points.push({ x: i, y });
    }
  }

  const payload = {
    totalStars,
    firstStarAt: firstStarTs,
    firstStarDate: firstStarTs,
    monthlyGrowth,
    estimatedMonthlyGrowth: monthlyGrowth,
    currentTotal: totalStars,
    points
  };

  if (criticalFailed) {
    payload.unavailable = true;
    payload.error = 'STAR_HISTORY_FAILED';
  }

  await setCached(cacheKey, payload);
  return payload;
}

async function getLocData(owner, repo) {
  const cacheKey = `loc_${owner}_${repo}`;
  const cached = await getCached(cacheKey, CACHE_TTL_LOC);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`https://api.codetabs.com/v1/loc?github=${owner}/${repo}`, {
      signal: controller.signal
    });
    if (!response.ok) {
      return null;
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) return null;
    const languages = rows
      .filter((item) => item && item.language && Number.isFinite(Number(item.linesOfCode)))
      .map((item) => ({
        language: item.language,
        files: Number(item.files) || 0,
        lines: Number(item.lines) || 0,
        blanks: Number(item.blanks) || 0,
        comments: Number(item.comments) || 0,
        linesOfCode: Number(item.linesOfCode) || 0
      }));
    const total = languages.reduce((sum, item) => sum + item.linesOfCode, 0);
    const payload = { languages, total };
    await setCached(cacheKey, payload);
    return payload;
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getLocFullData(owner, repo, bypassCache) {
  const langCacheKey = `loc_${owner}_${repo}`;
  const folderCacheKey = `loc_folders_${owner}_${repo}`;

  let cachedLang = null;
  let cachedFolders = null;

  if (!bypassCache) {
    cachedLang = await getCached(langCacheKey, CACHE_TTL_LOC);
    cachedFolders = await getCached(folderCacheKey, CACHE_TTL_LOC);
    if (cachedLang && cachedFolders) {
      return {
        languages: cachedLang.languages || [],
        folders: cachedFolders.folders || [],
        total: cachedLang.total || 0,
        isEstimated: true
      };
    }
  }

  const [langResult, folderResult] = await Promise.allSettled([
    fetchLanguageData(owner, repo),
    fetchFolderData(owner, repo)
  ]);

  let languages = [];
  let total = 0;
  if (langResult.status === 'fulfilled' && langResult.value) {
    languages = langResult.value.languages;
    total = langResult.value.total;
    await setCached(langCacheKey, { languages, total });
  } else if (cachedLang) {
    languages = cachedLang.languages || [];
    total = cachedLang.total || 0;
  }

  let folders = [];
  if (folderResult.status === 'fulfilled' && folderResult.value) {
    const folderItems = folderResult.value;
    const totalFileCount = folderItems.reduce(function (sum, f) { return sum + f.fileCount; }, 0);
    folders = folderItems.map(function (f) {
      const estimatedLOC = totalFileCount > 0 ? Math.round(total * (f.fileCount / totalFileCount)) : 0;
      const percentage = total > 0 ? Math.round((estimatedLOC / total) * 1000) / 10 : 0;
      return {
        name: f.name,
        estimatedLOC: estimatedLOC,
        fileCount: f.fileCount,
        percentage: percentage
      };
    });
    await setCached(folderCacheKey, { folders });
  } else if (cachedFolders) {
    folders = cachedFolders.folders || [];
  }

  const langTotal = languages.reduce(function (sum, l) { return sum + l.linesOfCode; }, 0);
  languages = languages.map(function (l) {
    return {
      language: l.language,
      linesOfCode: l.linesOfCode,
      files: l.files || 0,
      percentage: langTotal > 0 ? Math.round((l.linesOfCode / langTotal) * 1000) / 10 : 0
    };
  });

  return {
    languages: languages,
    folders: folders,
    total: total || langTotal,
    isEstimated: true
  };
}

async function fetchLanguageData(owner, repo) {
  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, 15000);
  try {
    const url = 'https://api.codetabs.com/v1/loc?github=' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
    console.log('[GH-LOC-BG] fetchLanguageData url:', url);
    const response = await fetch(url, { signal: controller.signal });
    console.log('[GH-LOC-BG] codetabs status:', response.status);
    if (!response.ok) {
      console.log('[GH-LOC-BG] codetabs not ok, falling back to GitHub languages API');
      return await fetchLanguageDataFallback(owner, repo);
    }
    const rows = await response.json();
    console.log('[GH-LOC-BG] codetabs rows:', Array.isArray(rows) ? rows.length : typeof rows);
    if (!Array.isArray(rows)) {
      console.log('[GH-LOC-BG] codetabs non-array, falling back');
      return await fetchLanguageDataFallback(owner, repo);
    }
    const languages = rows
      .filter(function (item) {
        return item && item.language && item.language !== 'Total' && Number.isFinite(Number(item.linesOfCode));
      })
      .map(function (item) {
        return {
          language: item.language,
          files: Number(item.files) || 0,
          linesOfCode: Number(item.linesOfCode) || 0
        };
      });
    const total = languages.reduce(function (sum, item) { return sum + item.linesOfCode; }, 0);
    console.log('[GH-LOC-BG] codetabs total:', total, 'languages:', languages.length);
    if (total === 0 && languages.length === 0) {
      console.log('[GH-LOC-BG] codetabs returned empty, falling back');
      return await fetchLanguageDataFallback(owner, repo);
    }
    return { languages: languages, total: total };
  } catch (err) {
    console.log('[GH-LOC-BG] codetabs error:', err.message, '- falling back');
    return await fetchLanguageDataFallback(owner, repo);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLanguageDataFallback(owner, repo) {
  try {
    const headers = await buildGitHubHeaders();
    const response = await trackedGitHubFetch(
      'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/languages',
      headers
    );
    if (!response.ok) {
      console.log('[GH-LOC-BG] GitHub languages API failed:', response.status);
      return null;
    }
    const langBytes = await response.json();
    console.log('[GH-LOC-BG] GitHub languages API result:', Object.keys(langBytes).length, 'languages');
    const entries = Object.entries(langBytes);
    if (!entries.length) return null;
    const totalBytes = entries.reduce(function (sum, entry) { return sum + entry[1]; }, 0);
    const BYTES_PER_LINE = 35;
    const languages = entries.map(function (entry) {
      return {
        language: entry[0],
        files: 0,
        linesOfCode: Math.round(entry[1] / BYTES_PER_LINE)
      };
    });
    const total = languages.reduce(function (sum, item) { return sum + item.linesOfCode; }, 0);
    console.log('[GH-LOC-BG] fallback total LOC (estimated):', total);
    return { languages: languages, total: total };
  } catch (err) {
    console.log('[GH-LOC-BG] fallback error:', err.message);
    return null;
  }
}

async function fetchFolderData(owner, repo) {
  const headers = await buildGitHubHeaders();

  let defaultBranch = 'main';
  try {
    const repoResp = await trackedGitHubFetch(
      'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo),
      headers
    );
    if (repoResp.ok) {
      const repoData = await repoResp.json();
      defaultBranch = repoData.default_branch || 'main';
    }
  } catch (_error) {
    // use default
  }

  let topLevel;
  try {
    const treeResp = await trackedGitHubFetch(
      'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) +
      '/git/trees/' + encodeURIComponent(defaultBranch),
      headers
    );
    if (!treeResp.ok) return null;
    topLevel = await treeResp.json();
  } catch (_error) {
    return null;
  }

  if (!topLevel || !Array.isArray(topLevel.tree)) return null;

  const folderEntries = topLevel.tree.filter(function (item) {
    return item.type === 'tree';
  });

  const folderPromises = folderEntries.slice(0, 50).map(async function (folder) {
    try {
      const subResp = await trackedGitHubFetch(
        'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) +
        '/git/trees/' + folder.sha + '?recursive=1',
        headers
      );
      if (!subResp.ok) return { name: folder.path, fileCount: 0 };
      const subTree = await subResp.json();
      const blobCount = Array.isArray(subTree.tree)
        ? subTree.tree.filter(function (item) { return item.type === 'blob'; }).length
        : 0;
      return { name: folder.path, fileCount: blobCount };
    } catch (_error) {
      return { name: folder.path, fileCount: 0 };
    }
  });

  const results = await Promise.allSettled(folderPromises);
  return results
    .filter(function (r) { return r.status === 'fulfilled'; })
    .map(function (r) { return r.value; })
    .filter(function (f) { return f.fileCount > 0; });
}

async function getGroupedNotifications() {
  const settings = await getSettings();
  if (!settings.github_pat) {
    return {
      requiresToken: true,
      groups: [],
      unreadCount: 0
    };
  }

  const cached = await getCached('notifications_grouped', CACHE_TTL_NOTIFICATIONS);
  if (cached) {
    await setNotificationBadge(cached.unreadCount || 0);
    return cached;
  }

  const headers = await buildGitHubHeaders();
  let response;
  try {
    response = await trackedGitHubFetch('https://api.github.com/notifications?per_page=50', headers);
  } catch (_error) {
    await setNotificationBadge(0);
    return {
      requiresToken: false,
      groups: [],
      unreadCount: 0,
      fetchedAt: Date.now(),
      unavailable: true,
      error: 'NOTIFICATIONS_FAILED'
    };
  }
  if (!response.ok) {
    await setNotificationBadge(0);
    return {
      requiresToken: response.status === 401 || response.status === 403,
      groups: [],
      unreadCount: 0,
      fetchedAt: Date.now(),
      unavailable: true,
      error: 'NOTIFICATIONS_FAILED'
    };
  }

  let items;
  try {
    items = await response.json();
  } catch (_error) {
    await setNotificationBadge(0);
    return {
      requiresToken: false,
      groups: [],
      unreadCount: 0,
      fetchedAt: Date.now(),
      unavailable: true,
      error: 'NOTIFICATIONS_FAILED'
    };
  }
  const list = Array.isArray(items) ? items : [];
  const groupsMap = {};

  list.forEach((item) => {
    const repoName = item && item.repository && item.repository.full_name;
    if (!repoName) return;
    if (!groupsMap[repoName]) {
      groupsMap[repoName] = {
        repoFullName: repoName,
        repoUrl: item.repository.html_url,
        notifications: []
      };
    }
    groupsMap[repoName].notifications.push({
      id: item.id,
      title: (item.subject && item.subject.title) || 'Untitled',
      type: (item.subject && item.subject.type) || 'Notification',
      threadUrl: item.subject && item.subject.url ? apiThreadToWebUrl(item.subject.url, item.repository.html_url) : item.repository.html_url,
      updatedAt: item.updated_at || ''
    });
  });

  const groups = Object.values(groupsMap)
    .map((group) => {
      group.notifications.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return group;
    })
    .sort((a, b) => {
      const aTs = a.notifications[0] ? new Date(a.notifications[0].updatedAt).getTime() : 0;
      const bTs = b.notifications[0] ? new Date(b.notifications[0].updatedAt).getTime() : 0;
      return bTs - aTs;
    });

  const payload = {
    requiresToken: false,
    groups,
    unreadCount: list.length,
    fetchedAt: Date.now()
  };

  await setCached('notifications_grouped', payload);
  await setNotificationBadge(payload.unreadCount);
  return payload;
}

async function markAllNotificationsRead() {
  const headers = await buildGitHubHeaders();
  await fetch('https://api.github.com/notifications', { method: 'PUT', headers });
  await removeStorageKeys(['notifications_grouped']);
  await setNotificationBadge(0);
  return { ok: true };
}

async function markRepoNotificationsRead(owner, repo) {
  if (!owner || !repo) return { ok: false };
  const headers = await buildGitHubHeaders();
  await fetch(`https://api.github.com/repos/${owner}/${repo}/notifications`, { method: 'PUT', headers });
  await removeStorageKeys(['notifications_grouped']);
  return { ok: true };
}

async function setNotificationBadge(count) {
  const text = count > 0 ? String(Math.min(99, count)) : '';
  chrome.action.setBadgeText({ text });
  if (count > 0) {
    chrome.action.setBadgeBackgroundColor({ color: '#2f81f7' });
  }
}

async function getBookmarks() {
  return (await getStorageValue(BOOKMARKS_KEY)) || [];
}

async function setBookmark(payload) {
  if (!payload || !payload.owner || !payload.repo) {
    return await getBookmarks();
  }
  const existing = await getBookmarks();
  const repoKey = `${payload.owner}/${payload.repo}`;
  const next = existing.filter((item) => `${item.owner}/${item.repo}` !== repoKey);
  next.unshift({
    owner: payload.owner,
    repo: payload.repo,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    note: typeof payload.note === 'string' ? payload.note.slice(0, 200) : '',
    addedAt: Date.now()
  });
  await setStorageValue({ [BOOKMARKS_KEY]: next });
  return next;
}

async function removeBookmark(owner, repo) {
  const repoKey = `${owner}/${repo}`;
  const bookmarks = (await getBookmarks()).filter((item) => `${item.owner}/${item.repo}` !== repoKey);
  await setStorageValue({ [BOOKMARKS_KEY]: bookmarks });
  return bookmarks;
}

async function getRecentRepos() {
  return (await getStorageValue(RECENT_REPOS_KEY)) || [];
}

async function saveRecentRepo(payload) {
  if (!payload || !payload.owner || !payload.repo) {
    return await getRecentRepos();
  }
  const current = await getRecentRepos();
  const key = `${payload.owner}/${payload.repo}`;
  const next = [{
    owner: payload.owner,
    repo: payload.repo,
    visitedAt: Date.now(),
    title: payload.title || `${payload.owner}/${payload.repo}`
  }]
    .concat(current.filter((item) => `${item.owner}/${item.repo}` !== key))
    .slice(0, MAX_RECENT_REPOS);
  await setStorageValue({ [RECENT_REPOS_KEY]: next });
  return next;
}

async function trackedGitHubFetch(url, headers) {
  const rateLimit = await getStorageValue(RATE_LIMIT_KEY);
  if (shouldBlockForRateLimit(rateLimit, Boolean(headers && headers.Authorization))) {
    throw new Error('RATE_LIMITED');
  }

  const response = await fetch(url, { headers });
  await persistRateLimitFromResponse(response);
  return response;
}

async function persistRateLimitFromResponse(response) {
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const limit = response.headers.get('X-RateLimit-Limit');
  const reset = response.headers.get('X-RateLimit-Reset');
  if (remaining === null && limit === null && reset === null) return;

  await setStorageValue({
    [RATE_LIMIT_KEY]: {
      remaining: remaining === null ? null : Number(remaining),
      limit: limit === null ? null : Number(limit),
      reset: reset === null ? null : Number(reset),
      updatedAt: Date.now()
    }
  });
}

function shouldBlockForRateLimit(rateLimit, hasAuthHeader) {
  if (hasAuthHeader) return false;
  if (!rateLimit || typeof rateLimit.remaining !== 'number') return false;
  if (rateLimit.remaining > 5) return false;
  if (!rateLimit.reset) return true;
  return (rateLimit.reset * 1000) > Date.now();
}

async function appendHistory(owner, repo, score) {
  const key = `history_${owner}_${repo}`;
  const existing = (await getStorageValue(key)) || [];
  const updated = existing.concat([{ score, timestamp: Date.now() }]).slice(-MAX_HISTORY);
  await setStorageValue({ [key]: updated });
}

async function getHistory(owner, repo) {
  return (await getStorageValue(`history_${owner}_${repo}`)) || [];
}

async function appendRecentScan(owner, repo, score) {
  const existing = (await getStorageValue(RECENT_SCANS_KEY)) || [];
  const repoKey = `${owner}/${repo}`;
  const next = [{ owner, repo, score, timestamp: Date.now() }]
    .concat(existing.filter((item) => `${item.owner}/${item.repo}` !== repoKey))
    .slice(0, MAX_RECENT_SCANS);
  await setStorageValue({ [RECENT_SCANS_KEY]: next });
}

async function getRecentScans() {
  return (await getStorageValue(RECENT_SCANS_KEY)) || [];
}

async function checkWatchlistRepos() {
  const watchlist = await getWatchlist();
  const watchlistScores = (await getStorageValue(WATCHLIST_SCORES_KEY)) || {};
  let hasDropAlert = false;

  for (const item of watchlist) {
    const repoKey = `${item.owner}/${item.repo}`;
    try {
      const health = await handleHealthRequest(item.owner, item.repo, {
        bypassCache: true,
        recordRecent: false
      });
      const previousCurrent = watchlistScores[repoKey] ? watchlistScores[repoKey].currentScore : null;
      watchlistScores[repoKey] = {
        previousScore: previousCurrent,
        currentScore: health.score,
        lastChecked: Date.now()
      };
      if (previousCurrent !== null && previousCurrent - health.score >= 1) {
        hasDropAlert = true;
      }
    } catch (error) {
      console.warn('[GH Health] watchlist check failed:', repoKey, error.message);
    }
  }

  await setStorageValue({ [WATCHLIST_SCORES_KEY]: watchlistScores });
  if (!hasDropAlert) return;
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
}

async function addToWatchlist(owner, repo) {
  const watchlist = await getWatchlist();
  const repoKey = `${owner}/${repo}`;
  if (!watchlist.some((item) => `${item.owner}/${item.repo}` === repoKey)) {
    watchlist.unshift({ owner, repo, addedAt: Date.now() });
    await setStorageValue({ [WATCHLIST_KEY]: watchlist });
  }
  return watchlist;
}

async function removeFromWatchlist(owner, repo) {
  const repoKey = `${owner}/${repo}`;
  const watchlist = (await getWatchlist()).filter((item) => `${item.owner}/${item.repo}` !== repoKey);
  const watchlistScores = (await getStorageValue(WATCHLIST_SCORES_KEY)) || {};
  delete watchlistScores[repoKey];
  await setStorageValue({
    [WATCHLIST_KEY]: watchlist,
    [WATCHLIST_SCORES_KEY]: watchlistScores
  });
  if (watchlist.length === 0) {
    chrome.action.setBadgeText({ text: '' });
  }
  return watchlist;
}

async function getWatchlist() {
  return (await getStorageValue(WATCHLIST_KEY)) || [];
}

async function clearCachedData() {
  const allItems = await getAllCacheEntries();
  const keysToRemove = Object.keys(allItems).filter((key) => {
    return key.startsWith('health_')
      || key.startsWith('deps_')
      || key.startsWith('history_')
      || key.startsWith('pr_')
      || key.startsWith('star_history_')
      || key.startsWith('loc_')
      || key === 'notifications_grouped'
      || key === RECENT_SCANS_KEY
      || key === WATCHLIST_SCORES_KEY
      || key === RATE_LIMIT_KEY;
  });
  if (keysToRemove.length > 0) {
    await removeStorageKeys(keysToRemove);
  }
  chrome.action.setBadgeText({ text: '' });
}

async function ensureDefaults() {
  const currentSettings = await getStorageValue(SETTINGS_KEY);
  const currentHidden = await getStorageValue(BADGES_HIDDEN_KEY);

  if (!currentSettings) {
    await setStorageValue({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }
  if (currentHidden === null) {
    await setStorageValue({ [BADGES_HIDDEN_KEY]: false });
  }
  if ((await getStorageValue(BOOKMARKS_KEY)) === null) {
    await setStorageValue({ [BOOKMARKS_KEY]: [] });
  }
  if ((await getStorageValue(RECENT_REPOS_KEY)) === null) {
    await setStorageValue({ [RECENT_REPOS_KEY]: [] });
  }
}

async function getSettings() {
  const results = await Promise.all([
    getStorageValue(SETTINGS_KEY),
    getStorageValue('_settings'),
    getStorageValue(PAT_KEY)
  ]);
  const settings = results[0];
  const legacy = results[1];
  const githubPat = results[2];
  const merged = Object.assign({}, DEFAULT_SETTINGS, legacy || {}, settings || {});

  return {
    showOnSearch: merged.showOnSearch !== false,
    showOnTrending: merged.showOnTrending !== false,
    showDeps: merged.showDeps !== false,
    showBusFactor: merged.showBusFactor !== false,
    showLicenseRisk: merged.showLicenseRisk !== false,
    showReadmeToc: merged.showReadmeToc !== false,
    showPrComplexity: merged.showPrComplexity !== false,
    showTodoHighlights: merged.showTodoHighlights !== false,
    showContributionInsights: merged.showContributionInsights !== false,
    showIssueAge: merged.showIssueAge !== false,
    showFileTypeIcons: merged.showFileTypeIcons !== false,
    showQuickClone: merged.showQuickClone !== false,
    showStarHistory: merged.showStarHistory !== false,
    showCommitQuality: merged.showCommitQuality !== false,
    showFileEnhancements: merged.showFileEnhancements !== false,
    showMarkdownPrinter: merged.showMarkdownPrinter !== false,
    showVSIcons: merged.showVSIcons !== false,
    showWebIDE: merged.showWebIDE !== false,
    showLOCSidebar: merged.showLOCSidebar !== false,
    showAbsoluteDates: merged.showAbsoluteDates !== false,
    showHealthSidebar: merged.showHealthSidebar !== false,
    github_pat: githubPat || (legacy && legacy.github_pat) || ''
  };
}

async function setSettings(partial) {
  const current = await getSettings();
  const next = Object.assign({}, current, partial || {});
  const githubPat = typeof next.github_pat === 'string' ? next.github_pat.trim() : '';
  delete next.github_pat;

  await setStorageValue({
    [SETTINGS_KEY]: next,
    [PAT_KEY]: githubPat
  });

  return Object.assign({}, next, { github_pat: githubPat });
}

async function buildGitHubHeaders() {
  const settings = await getSettings();
  const headers = { Accept: 'application/vnd.github+json' };
  if (settings.github_pat) {
    headers.Authorization = `Bearer ${settings.github_pat}`;
  }
  return headers;
}

function parseGitHubLink(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 5) return null;
    const owner = parts[0];
    const repo = parts[1];
    const kind = parts[2];
    const branch = parts[3];
    const path = decodeURIComponent(parts.slice(4).join('/'));
    if (kind !== 'tree' && kind !== 'blob') return null;
    return { owner, repo, kind, branch, path };
  } catch (_error) {
    return null;
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

function getStorageValue(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => resolve(result[key] ?? null));
  });
}

function setStorageValue(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, resolve);
  });
}

function removeStorageKeys(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });
}

async function getCached(key, ttl) {
  const entry = await getStorageValue(key);
  if (!entry || Date.now() - entry.timestamp > ttl) return null;
  return entry.data;
}

function setCached(key, data) {
  return setStorageValue({
    [key]: {
      data,
      timestamp: Date.now()
    }
  });
}

function getAllCacheEntries() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (items) => resolve(items));
  });
}

function getDaysSince(isoDate) {
  if (!isoDate) return 9999;
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
}

function getRepoAgeMonths(createdAt) {
  if (!createdAt) return 0;
  return Math.round((Date.now() - new Date(createdAt).getTime()) / (86400000 * 30.4375));
}

function getAgeLabel(createdAt) {
  const repoAgeMonths = getRepoAgeMonths(createdAt);
  if (repoAgeMonths < 6) return 'new';
  if (repoAgeMonths < 24) return 'growing';
  if (repoAgeMonths < 60) return 'mature';
  return 'veteran';
}

function parseLastPage(linkHeader) {
  if (!linkHeader) return 1;
  const match = linkHeader.match(/[?&]page=(\d+)>; rel="last"/);
  if (!match) return 1;
  const page = Number(match[1]);
  return Number.isFinite(page) ? page : 1;
}

function getFileExtensionLabel(filename) {
  const base = filename.split('/').pop() || '';
  if (base.toLowerCase() === 'dockerfile') return 'Dockerfile';
  if (!base.includes('.')) return '(no-ext)';
  const ext = base.slice(base.lastIndexOf('.')).toLowerCase();
  return ext;
}

function apiThreadToWebUrl(apiUrl, fallbackRepoUrl) {
  if (!apiUrl) return fallbackRepoUrl || 'https://github.com';
  try {
    const url = new URL(apiUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    const reposIdx = parts.indexOf('repos');
    if (reposIdx === -1 || parts.length < reposIdx + 5) {
      return fallbackRepoUrl || 'https://github.com';
    }
    const owner = parts[reposIdx + 1];
    const repo = parts[reposIdx + 2];
    const type = parts[reposIdx + 3];
    const number = parts[reposIdx + 4];
    if (type === 'issues') return `https://github.com/${owner}/${repo}/issues/${number}`;
    if (type === 'pulls') return `https://github.com/${owner}/${repo}/pull/${number}`;
    if (type === 'discussions') return `https://github.com/${owner}/${repo}/discussions/${number}`;
    if (type === 'releases') return `https://github.com/${owner}/${repo}/releases`;
  } catch (_error) {
    // noop
  }
  return fallbackRepoUrl || 'https://github.com';
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function logError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[GH Health]', message);
}

function isExpectedError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message === 'NOT_FOUND'
    || message === 'RATE_LIMITED'
    || message === 'AUTH_ERROR'
    || message === 'INVALID_REPO'
    || message === 'STAR_HISTORY_FAILED'
    || message === 'NOTIFICATIONS_FAILED'
    || message.includes('Extension context invalidated')
    || message.includes('Receiving end does not exist');
}
