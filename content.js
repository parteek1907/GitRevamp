const PROCESSED_ATTR = 'data-health-done';
const TOC_ATTR = 'data-toc-done';
const PR_COMPLEXITY_ATTR = 'data-pr-complexity-done';
const TODO_ATTR = 'data-todo-done';
const INSIGHTS_ATTR = 'data-insights-done';
const ISSUES_AGE_ATTR = 'data-issues-age-done';
const ICONS_ATTR = 'data-icons-done';
const CLONE_ATTR = 'data-clone-done';
const STAR_HISTORY_ATTR = 'data-star-history-done';
const COMMIT_QUALITY_ATTR = 'data-commit-quality-done';
const BOOKMARK_ATTR = 'data-bookmark-done';

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
let badgesHidden = false;
let observer = null;
let debounceTimer = null;
let lastUrl = location.href;
let tocObserver = null;
let lastTrackedRepo = '';
let enhancedGithubClickBound = false;
let enhancedGithubLastUrl = '';

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

    if (settings.showFileEnhancements) {
      enhancedGithubMainEntry(owner, repo).catch(() => {});
    }

    if (settings.showMarkdownPrinter) {
      injectMarkdownPrintButton().catch(() => {});
      injectReadmePagePrintButton().catch(() => {});
    }

    injectBookmarkButton(owner, repo).catch(() => {});

    if (settings.showStarHistory) {
      injectStarHistory(owner, repo).catch(() => {});
    }

    if (settings.showReadmeToc) {
      injectReadmeToc().catch(() => {});
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

    if (settings.showVSIcons) {
      injectVSCodeFileIcons(owner, repo).catch(() => {});
    }
    if (settings.showWebIDE) {
      injectOpenInWebIDE(owner, repo).catch(() => {});
    }
    if (settings.showLOCSidebar) {
      injectLOCInSidebar(owner, repo).catch(() => {});
    }
    if (settings.showHealthSidebar) {
      injectHealthSidebarPanel(owner, repo).catch(() => {});
    }
  }

  if (settings.showAbsoluteDates) {
    injectAbsoluteDates().catch(() => {});
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

const CommonEnum = {
  TOKEN: 'token'
};

const enhancedGithubStorageUtil = {
  set: (key, value) => {
    enhancedGithubStorageUtil[key] = value;
  },
  get: (key) => {
    return enhancedGithubStorageUtil[key];
  }
};

const enhancedGithubCommonUtil = {
  getContentPath: function() {
    const str = window.location.href;
    const result = str.match(/.*[bt][lr][oe][be]\/[^//]+\/(.*)/);
    return result && result.length && result[1];
  },
  getBranch: function() {
    const str = window.location.href;
    const result = str.match(/.*(blob|tree|commits)\/([^//]+).*$/);
    return result && result.length && result[2];
  },
  getUsernameWithReponameFromGithubURL: function() {
    const pathnames = window.location.pathname.split('/');
    const user = pathnames[1];
    const repo = pathnames[2];

    return {
      user: user,
      repo: repo
    };
  },
  sortOn: function(arr, key) {
    return arr.sort(function(a, b) {
      if (a[key] < b[key]) {
        return -1;
      }
      if (a[key] > b[key]) {
        return 1;
      }
      return 0;
    });
  },
  sortFileStructureAsOnSite: function(data) {
    if (!data || Object.prototype.toString.call(data) !== '[object Array]') {
      return;
    }

    let folders = [];
    let files = [];
    let others = [];
    let dataAfterSorting = [];

    data.forEach(function(item) {
      if (item.type === 'dir') {
        folders.push(item);
      } else if (item.type === 'file' && item.size === 0) {
        folders.push(item);
      } else if (item.type === 'file' || item.type === 'symlink') {
        files.push(item);
      } else {
        others.push(item);
      }
    });

    folders = enhancedGithubCommonUtil.sortOn(folders, 'name');
    files = enhancedGithubCommonUtil.sortOn(files, 'name');
    others = enhancedGithubCommonUtil.sortOn(others, 'name');

    dataAfterSorting = dataAfterSorting
      .concat(folders)
      .concat(files)
      .concat(others);
    return dataAfterSorting;
  },
  convertSizeToHumanReadableFormat: function(bytes) {
    if (bytes === 0) {
      return {
        size: 0,
        measure: 'Bytes'
      };
    }

    bytes *= 1024;

    const K = 1024;
    const MEASURE = ['', 'B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(K));

    return {
      size: parseFloat((bytes / Math.pow(K, i)).toFixed(2)),
      measure: MEASURE[i]
    };
  },
  getFileSizeAndUnit: function(data) {
    const formatBytes = enhancedGithubCommonUtil.convertSizeToHumanReadableFormat(data.size);
    const size = formatBytes.size;
    const unit = formatBytes.measure;

    return size + ' ' + unit;
  },
  removePrevInstancesOf: function(selector) {
    if (!selector) {
      return;
    }

    [].forEach.call(document.querySelectorAll(selector), function(el) {
      el.parentNode.removeChild(el);
    });
  }
};

const enhancedGithubApiUtil = {
  checkStatus: function(response) {
    if (response.status >= 200 && response.status < 300) {
      return response;
    }

    throw Error(
      `GitHub returned a bad status: ${response.status}. Please set API token if Rate limiting is the cause(explained in README).`
    );
  },
  parseJSON: function(response) {
    return response === null ? null : response.json();
  },
  getRepoContent: function(callback, contentPath, isRepoMetaData) {
    const path = enhancedGithubCommonUtil.getUsernameWithReponameFromGithubURL();
    if (!path.user || !path.repo) {
      return;
    }

    const userRepo = path.user + '/' + path.repo;
    contentPath = contentPath || enhancedGithubCommonUtil.getContentPath() || '';
    const token = settings.github_pat || '';
    let headers = {};
    const branch = enhancedGithubCommonUtil.getBranch() || enhancedGithubStorageUtil.get('defaultBranch') || 'master';
    let contentParams = '';

    if (!isRepoMetaData) {
      contentParams = '/contents/' + contentPath + '?ref=' + branch;
    }

    if (token) {
      headers = {
        Authorization: 'token ' + token,
        'User-Agent': 'Awesome-Octocat-App'
      };
    }

    window
      .fetch('https://api.github.com/repos/' + userRepo + contentParams, {
        headers: headers
      })
      .then(enhancedGithubApiUtil.checkStatus)
      .then(enhancedGithubApiUtil.parseJSON)
      .then(function(data) {
        callback(data === null ? null : data);
      })
      .catch(function(error) {
        if (error) {
          console.error('Error in enhanced-github', error);
        }
        callback(null);
      });
  }
};

const enhancedGithubHandlersUtil = {
  onPathContentFetchedForBtns: function(data) {
    if (!data) {
      return;
    }
    const formattedFileSize = enhancedGithubCommonUtil.getFileSizeAndUnit(data);

    enhancedGithubCommonUtil.removePrevInstancesOf('.js-file-clipboard');
    enhancedGithubCommonUtil.removePrevInstancesOf('.js-file-download');

    const btnGroupHtml = `
      <button aria-label="Copy file contents to clipboard" class="js-file-clipboard btn btn-sm BtnGroup-item file-clipboard-button tooltipped tooltipped-s js-enhanced-github-copy-btn" data-copied-hint="Copied!" type="button" click="selectText()" data-clipboard-target="tbody">
        Copy File
      </button>
      <a href="${data.download_url}" download="${data.name}"
        aria-label="(Option + Click) to download. (Cmd/Ctr + Click) to view raw contents." class="js-file-download btn btn-sm BtnGroup-item file-download-button tooltipped tooltipped-s">
        <span style="margin-right: 5px;">${formattedFileSize}</span>
        <svg class="octicon octicon-cloud-download" aria-hidden="true" height="16" version="1.1" viewBox="0 0 16 16" width="16">
          <path d="M9 12h2l-3 3-3-3h2V7h2v5zm3-8c0-.44-.91-3-4.5-3C5.08 1 3 2.92 3 5 1.02 5 0 6.52 0 8c0 1.53 1 3 3 3h3V9.7H3C1.38 9.7 1.3 8.28 1.3 8c0-.17.05-1.7 1.7-1.7h1.3V5c0-1.39 1.56-2.7 3.2-2.7 2.55 0 3.13 1.55 3.2 1.8v1.2H12c.81 0 2.7.22 2.7 2.2 0 2.09-2.25 2.2-2.7 2.2h-2V11h2c2.08 0 4-1.16 4-3.5C16 5.06 14.08 4 12 4z"></path>
        </svg>
      </a>`;

    const btnGroup = document.querySelectorAll('.BtnGroup:not(.d-md-none)')[1];
    if (btnGroup) {
      btnGroup.insertAdjacentHTML('beforeend', btnGroupHtml);
    }
  },
  onPathContentFetched: function(data = []) {
    data = enhancedGithubCommonUtil.sortFileStructureAsOnSite(data);

    if (!data) {
      return;
    }

    let isAnyFilePresent = false;

    for (let i = 0; i < data.length; i++) {
      if (data[i].type === 'file') {
        isAnyFilePresent = true;
        break;
      }
    }

    if (!isAnyFilePresent) {
      return;
    }

    setTimeout(function() {
      enhancedGithubCommonUtil.removePrevInstancesOf('.eg-download');

      let actualDataIndex = 0;
      let startIndex = 0;

      if (
        window.location.pathname &&
        window.location.pathname.indexOf(`tree/${enhancedGithubCommonUtil.getBranch()}`) > -1 &&
        !window.location.pathname.endsWith(`tree/${enhancedGithubCommonUtil.getBranch()}`) &&
        !window.location.pathname.endsWith(`tree/${enhancedGithubCommonUtil.getBranch()}/`)
      ) {
        startIndex = 1;
      }

      const repoPath = enhancedGithubCommonUtil.getUsernameWithReponameFromGithubURL();

      if (
        window.location.pathname !== `/${repoPath.user}/${repoPath.repo}` &&
        window.location.href.indexOf('tree/' + enhancedGithubCommonUtil.getBranch()) === -1
      ) {
        return;
      }

      const containerItems = document.querySelectorAll('table > tbody > tr.react-directory-row');
      const firstCell = document.querySelectorAll('tbody tr > td:nth-child(1)')[0];

      if (!containerItems.length || !firstCell) {
        return;
      }

      for (let i = startIndex; i < containerItems.length; i++) {
        if (!data[actualDataIndex]) {
          break;
        }

        const commitElem = containerItems[i].querySelector('td > div.react-directory-commit-age');
        if (!commitElem || !commitElem.parentElement || !commitElem.parentElement.previousElementSibling) {
          actualDataIndex++;
          continue;
        }

        const isValidFile = (data[actualDataIndex].type === 'file' && data[actualDataIndex].size !== 0) || (data[actualDataIndex].type === 'symlink');

        firstCell.setAttribute('colspan', '6');
        commitElem.parentElement.previousElementSibling.setAttribute('colspan', '3');

        if (isValidFile) {
          const formattedFileSize = enhancedGithubCommonUtil.getFileSizeAndUnit(data[actualDataIndex]);

          commitElem.parentElement.insertAdjacentHTML('beforebegin', `
            <td class="eg-download">
              <a class="tooltipped tooltipped-s" href="${data[actualDataIndex].download_url}" title="(Option + Click) to download. (Cmd/Ctr + Click) to view raw contents." aria-label="(Option + Click) to download. (Cmd/Ctr + Click) to view raw contents."
                download="${data[actualDataIndex].name}">
                <svg class="octicon octicon-cloud-download" aria-hidden="true" height="16" version="1.1" viewBox="0 0 16 16" width="16">
                  <path d="M9 12h2l-3 3-3-3h2V7h2v5zm3-8c0-.44-.91-3-4.5-3C5.08 1 3 2.92 3 5 1.02 5 0 6.52 0 8c0 1.53 1 3 3 3h3V9.7H3C1.38 9.7 1.3 8.28 1.3 8c0-.17.05-1.7 1.7-1.7h1.3V5c0-1.39 1.56-2.7 3.2-2.7 2.55 0 3.13 1.55 3.2 1.8v1.2H12c.81 0 2.7.22 2.7 2.2 0 2.09-2.25 2.2-2.7 2.2h-2V11h2c2.08 0 4-1.16 4-3.5C16 5.06 14.08 4 12 4z"></path>
                </svg>
                <span class="react-directory-download Link--secondary">${formattedFileSize}</span>
              </a>
            </td>
          `);
        } else {
          commitElem.parentElement.insertAdjacentHTML('beforebegin', '<td class="eg-download"><div class="react-directory-download"></div></td>');
        }
        actualDataIndex++;
      }
    }, 1000);
  }
};

const enhancedGithubDomUtil = {
  selectText: function() {
    const container = 'tbody';
    if (document.selection) {
      const range = document.body.createTextRange();
      range.moveToElementText(document.querySelectorAll(container)[0]);
      range.select();
    } else if (window.getSelection) {
      const range = document.createRange();
      range.selectNode(document.querySelectorAll(container)[0]);
      window.getSelection().addRange(range);
    }
  },
  hasClass: function(elem, className) {
    const elemClass = elem.getAttribute('class') || '';

    return elemClass.split(' ').indexOf(className) > -1;
  },
  appendRepoSizeElement: function() {
    enhancedGithubCommonUtil.removePrevInstancesOf('.eg-repo-size');

    const formattedFileSize = enhancedGithubCommonUtil.convertSizeToHumanReadableFormat(enhancedGithubStorageUtil.get('repoSize') * 1024);
    let elem;

    if (document.querySelectorAll('.Layout-sidebar .hide-sm.hide-md').length) {
      elem = document.querySelectorAll('.Layout-sidebar .hide-sm.hide-md')[0];
    }

    if (elem) {
      const html = `
        <h3 class="sr-only">Repo Size</h3>
        <div class="mt-2">
          <a href="javascript:void(0);" data-view-component="true" class="Link Link--muted">
            <svg class="octicon octicon-database mr-2" mr="2" aria-hidden="true" height="16" version="1.1" viewBox="0 0 12 16" width="16">
              <path d="M6 15c-3.31 0-6-.9-6-2v-2c0-.17.09-.34.21-.5.67.86 3 1.5 5.79 1.5s5.12-.64 5.79-1.5c.13.16.21.33.21.5v2c0 1.1-2.69 2-6 2zm0-4c-3.31 0-6-.9-6-2V7c0-.11.04-.21.09-.31.03-.06.07-.13.12-.19C.88 7.36 3.21 8 6 8s5.12-.64 5.79-1.5c.05.06.09.13.12.19.05.1.09.21.09.31v2c0 1.1-2.69 2-6 2zm0-4c-3.31 0-6-.9-6-2V3c0-1.1 2.69-2 6-2s6 .9 6 2v2c0 1.1-2.69 2-6 2zm0-5c-2.21 0-4 .45-4 1s1.79 1 4 1 4-.45 4-1-1.79-1-4-1z"></path>
            </svg>
            <strong>${formattedFileSize.size}</strong>
            <span>${formattedFileSize.measure}</span>
          </a>
        </div>
      `;

      elem.parentElement.insertAdjacentHTML('beforeend', html);
    }
  },
  addRepoData: function() {
    setTimeout(() => {
      const path = enhancedGithubCommonUtil.getUsernameWithReponameFromGithubURL();
      const userRepo = `${path.user}/${path.repo}`;

      if (
        enhancedGithubStorageUtil.get('defaultBranch') &&
        window.location.href &&
        window.location.href !== 'https://github.com/' + userRepo
      ) {
        enhancedGithubFetchDataAndCreateDOMElements();
        return;
      }

      if (enhancedGithubStorageUtil.get('repoSize')) {
        enhancedGithubFetchDataAndCreateDOMElements();
        enhancedGithubDomUtil.appendRepoSizeElement();
        return;
      }

      enhancedGithubApiUtil.getRepoContent(
        function(data) {
          if (!data) {
            return;
          }

          enhancedGithubStorageUtil.set('repoSize', data.size);
          enhancedGithubStorageUtil.set('defaultBranch', data.default_branch);

          enhancedGithubFetchDataAndCreateDOMElements();
          enhancedGithubDomUtil.appendRepoSizeElement();
        },
        '',
        true
      );
    }, 0);
  },
  addCopyAndDownloadButton: function() {
    const btnGroup = document.querySelectorAll('.BtnGroup:not(.d-md-none)')[1];

    if (btnGroup && window.location.href && window.location.href.indexOf('blob/' + enhancedGithubCommonUtil.getBranch()) > -1) {
      enhancedGithubApiUtil.getRepoContent(function(data) {
        enhancedGithubHandlersUtil.onPathContentFetchedForBtns(data);
      }, enhancedGithubCommonUtil.getContentPath());
    }
  },
  addFileSizeAndDownloadLink: function() {
    enhancedGithubApiUtil.getRepoContent(function(data) {
      enhancedGithubHandlersUtil.onPathContentFetched(data);
    });
  }
};

function enhancedGithubFetchDataAndCreateDOMElements() {
  enhancedGithubDomUtil.addCopyAndDownloadButton();
  enhancedGithubDomUtil.addFileSizeAndDownloadLink();
}

async function enhancedGithubMainEntry(_owner, _repo) {
  if (!enhancedGithubClickBound) {
    document.addEventListener(
      'click',
      function(e) {
        if (enhancedGithubDomUtil.hasClass(e.target, 'js-file-clipboard')) {
          enhancedGithubDomUtil.selectText();
        }
      },
      false
    );
    enhancedGithubClickBound = true;
  }

  const token = settings.github_pat || '';
  if (token) {
    enhancedGithubStorageUtil.set(CommonEnum.TOKEN, token);
  }

  const currentUrl = window.location.href;
  if (enhancedGithubLastUrl === currentUrl) {
    return;
  }
  enhancedGithubLastUrl = currentUrl;
  enhancedGithubDomUtil.addRepoData();
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
  dot.textContent = '●';

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
    busFactorLine.textContent = `⚠️ Single maintainer risk (${share}% of commits by one person)`;
    lines.push(busFactorLine);
  }

  if (settings.showDeps && data.hasDeps && data.deps) {
    const depsLine = document.createElement('div');
    depsLine.className = 'gh-health-line';
    if (data.deps.riskLabel === 'Clean') {
      depsLine.textContent = '📦 Dependencies clean';
    } else {
      const parts = [];
      if (safeNonNegative(data.deps.outdatedCount) > 0) parts.push(`${safeNonNegative(data.deps.outdatedCount)} deps outdated`);
      if (safeNonNegative(data.deps.vulnerableCount) > 0) parts.push(`${safeNonNegative(data.deps.vulnerableCount)} vuln`);
      depsLine.textContent = `📦 ${parts.join(' · ')}`;
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
    releaseLine.textContent = `🏷️ ${data.latestVersion} · ${Math.round(Number(data.daysSinceRelease))}d ago`;
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
    fallbackLine.textContent = `⭐ ${stars} · 🍴 ${forks} · ${daysSinceLast}d since last commit`;
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

  return `⚡ Issues ~${stripTrailingZero(normalizedIssue)}d · PRs ~${stripTrailingZero(normalizedPr)}d`;
}

function getLicenseBadgeLine(data) {
  if (data.licenseRisk === 'copyleft') {
    return `⚖️ Copyleft license (${formatLicenseShortName(data.licenseName, data.licenseKey)})`;
  }
  if (data.licenseRisk === 'unlicensed') {
    return '⚠️ No license - use with caution';
  }
  if (data.licenseRisk === 'unknown') {
    return '❓ License unclear';
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
  panel.style.top = '72px';

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
  meta.textContent = `📖 ~${mins} min read · ${words} words`;
  const firstHeading = headings[0];
  if (firstHeading) {
    firstHeading.parentNode.insertBefore(meta, firstHeading);
  } else {
    markdownBody.insertBefore(meta, markdownBody.firstChild);
  }
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
    warn.textContent = '⚠️ This PR is too large to review effectively. Consider splitting into smaller PRs.';
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
  panel.appendChild(makeInsightCard('🔥 Current streak', `${current} days`));
  panel.appendChild(makeInsightCard('⚡ Longest streak', `${longest} days`));
  panel.appendChild(makeInsightCard('📅 Most active', weekdayName(topWeekday ? topWeekday[0] : 0)));
  panel.appendChild(makeInsightCard('🏆 Best day', `${formatShortDate(best.date)} (${best.count} contributions)`));
  panel.appendChild(makeInsightCard('📊 Avg active day', `${avgActive.toFixed(1)} contributions`));

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
    marker.textContent = `🕐 ${label}`;
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
      button.textContent = '✅ Copied!';
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
  let isBookmarked = Boolean(existing);

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
  saveButton.textContent = isBookmarked ? 'Remove Bookmark' : 'Save Bookmark';

  saveButton.addEventListener('click', async () => {
    if (isBookmarked) {
      await sendMessage({ type: 'REMOVE_BOOKMARK', payload: { owner, repo } });
      isBookmarked = false;
      setBookmarkLabel(button, false);
    } else {
      const tags = tagsInput.value.split(',').map((item) => item.trim()).filter(Boolean);
      await sendMessage({ type: 'SET_BOOKMARK', payload: { owner, repo, tags, note: noteInput.value.trim() } });
      isBookmarked = true;
      setBookmarkLabel(button, true);
    }
    saveButton.textContent = isBookmarked ? 'Remove Bookmark' : 'Save Bookmark';
    panel.classList.remove('is-open');
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
    icon.textContent = quality === 'good' ? '✅' : '⚠️';
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

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function injectMarkdownPrintButton() {
  if (document.body.hasAttribute('data-md-print-done')) return;

  const isBlobPage = /^\/[^/]+\/[^/]+\/blob\//.test(location.pathname);
  if (!isBlobPage) return;

  const content = document.querySelector('.markdown-body') ?? document.querySelector('div[data-type="ipynb"]');
  if (!content) return;

  const actionHost = document.querySelector('.file-actions')
    || document.querySelector('[data-testid="raw-button"]')?.parentElement
    || document.querySelector('a[href*="?raw=1"]')?.parentElement
    || document.querySelector('[aria-label="Raw"]')?.parentElement
    || document.querySelector('[data-testid="file-actions-button"]')?.parentElement
    || document.querySelector('.Box-header .d-flex.flex-shrink-0')
    || document.querySelector('.Box-header .d-flex')
    || document.querySelector('.BtnGroup:not(.d-md-none)');
  if (!actionHost) return;

  if (actionHost.querySelector('.gh-md-print-btn')) {
    document.body.setAttribute('data-md-print-done', 'true');
    return;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm gh-md-print-btn';
  button.textContent = 'Print';
  button.addEventListener('click', () => {
    printGitHubMarkdownPage(content);
  });
  actionHost.appendChild(button);

  document.body.setAttribute('data-md-print-done', 'true');
}

async function injectReadmePagePrintButton() {
  if (document.body.hasAttribute('data-readme-print-done')) return;
  if (/\/blob\//.test(location.pathname)) return;

  const readmeSection = document.querySelector('#readme');
  if (!readmeSection) return;

  const markdownBody = readmeSection.querySelector('article.markdown-body, .markdown-body');
  if (!markdownBody) return;

  const toolbar =
    readmeSection.querySelector('.file-actions') ||
    readmeSection.querySelector('.Box-header .d-flex.flex-justify-end') ||
    readmeSection.querySelector('.d-flex.flex-justify-end') ||
    readmeSection.querySelector('.BtnGroup');
  if (!toolbar) return;
  if (toolbar.querySelector('.gh-md-print-btn')) {
    document.body.setAttribute('data-readme-print-done', 'true');
    return;
  }

  document.body.setAttribute('data-readme-print-done', 'true');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gh-md-print-btn btn btn-sm';
  btn.textContent = 'Print';
  btn.title = 'Print this README';

  btn.addEventListener('click', () => {
    printGitHubMarkdownPage(markdownBody);
  });

  toolbar.insertBefore(btn, toolbar.firstChild);
}

function printGitHubMarkdownPage(markdownBody) {
  const content = markdownBody
    || document.querySelector('.markdown-body')
    || document.querySelector('div[data-type="ipynb"]');

  if (!content) {
    alert('No printable content found on this page');
    return;
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('markdown-printer-style.css');

  document.head.appendChild(link);
  link.addEventListener('load', async () => {
    const bodyHtml = document.body.innerHTML;
    const theme = document.documentElement.dataset.colorMode;

    document.documentElement.dataset.colorMode = 'light';

    for (const iframe of document.querySelectorAll('iframe')) {
      iframe.src = iframe.src.replace('color_mode=dark', 'color_mode=light');
    }

    document.body.replaceChildren(content);

    await waitForMermaidDiagramsToLoad();
    await waitForJupyterNotebooksToLoad();
    const revertHeadingsLinkable = makeHeadingsLinkable();

    window.print();

    revertHeadingsLinkable();
    document.body.innerHTML = bodyHtml;
    document.documentElement.dataset.colorMode = theme;
    document.head.removeChild(link);
  });

  async function waitForMermaidDiagramsToLoad() {
    const loadedFrames = new Set();

    window.addEventListener('message', ({ data }) => {
      if (data.body === 'ready') {
        loadedFrames.add(data.identity);
      }
    });

    const mermaidIds = Array.from(
      document.querySelectorAll('section[data-type="mermaid"]')
    ).map((node) => node.dataset.identity);

    await new Promise((resolve) => {
      const interval = setInterval(() => {
        if (mermaidIds.every((id) => loadedFrames.has(id))) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }

  async function waitForJupyterNotebooksToLoad() {
    const notebook = document.querySelector('div[data-type="ipynb"]');
    if (notebook) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  function makeHeadingsLinkable() {
    const headings = [
      ...document.getElementsByTagName('h1'),
      ...document.getElementsByTagName('h2'),
      ...document.getElementsByTagName('h3'),
      ...document.getElementsByTagName('h4'),
      ...document.getElementsByTagName('h5'),
      ...document.getElementsByTagName('h6')
    ];

    const normalize = (text) => {
      return text
        .trim()
        .toLowerCase()
        .replaceAll(' ', '-')
        .replace(/[^a-z0-9\-]/g, '');
    };

    const ids = new Set();
    for (const heading of headings) {
      heading.id = normalize(heading.textContent);
      ids.add(heading.id);
    }

    const internalLinks = document.querySelectorAll(
      'a[href^="#"]:not(.markdown-heading a)'
    );
    const originalHrefs = new Map();
    for (const linkNode of internalLinks) {
      const href = linkNode.getAttribute('href');
      const normalized = normalize(href.slice(1));

      if (ids.has(normalized)) {
        originalHrefs.set(linkNode, href);
        linkNode.href = `#${normalized}`;
      }
    }

    return () => {
      for (const heading of headings) {
        heading.removeAttribute('id');
      }

      for (const [linkNode, href] of originalHrefs) {
        linkNode.setAttribute('href', href);
      }
    };
  }
}

// ── FEATURE 1: VS Code Material File Icons ──

const FILE_ICON_MAP = {
  'package.json':     { text: 'NPM',  bg: '#cc3534', fg: '#fff' },
  'package-lock.json':{ text: 'NPM',  bg: '#cc3534', fg: '#fff' },
  'tsconfig.json':    { text: 'TS',   bg: '#3178c6', fg: '#fff' },
  'jsconfig.json':    { text: 'JS',   bg: '#f7df1e', fg: '#000' },
  '.eslintrc':        { text: 'ESL',  bg: '#4b32c3', fg: '#fff' },
  '.eslintrc.js':     { text: 'ESL',  bg: '#4b32c3', fg: '#fff' },
  '.eslintrc.json':   { text: 'ESL',  bg: '#4b32c3', fg: '#fff' },
  '.prettierrc':      { text: 'PRE',  bg: '#f7ba3e', fg: '#000' },
  '.prettierrc.js':   { text: 'PRE',  bg: '#f7ba3e', fg: '#000' },
  'dockerfile':       { text: 'DO',   bg: '#0db7ed', fg: '#fff' },
  'docker-compose.yml':{ text: 'DC',  bg: '#0db7ed', fg: '#fff' },
  '.gitignore':       { text: 'GIT',  bg: '#f54d27', fg: '#fff' },
  '.gitattributes':   { text: 'GIT',  bg: '#f54d27', fg: '#fff' },
  '.env':             { text: 'ENV',  bg: '#3c873a', fg: '#fff' },
  '.env.local':       { text: 'ENV',  bg: '#3c873a', fg: '#fff' },
  '.env.example':     { text: 'ENV',  bg: '#3c873a', fg: '#fff' },
  'makefile':         { text: 'MK',   bg: '#6d8086', fg: '#fff' },
  'license':          { text: 'LIC',  bg: '#d29922', fg: '#fff' },
  'license.md':       { text: 'LIC',  bg: '#d29922', fg: '#fff' },
  'readme.md':        { text: 'MD',   bg: '#2ea043', fg: '#fff' },
  'contributing.md':  { text: 'MD',   bg: '#2ea043', fg: '#fff' },
  'changelog.md':     { text: 'MD',   bg: '#2ea043', fg: '#fff' },
  'vite.config.ts':   { text: 'VITE', bg: '#646cff', fg: '#fff' },
  'vite.config.js':   { text: 'VITE', bg: '#646cff', fg: '#fff' },
  'next.config.js':   { text: 'NEXT', bg: '#000000', fg: '#fff' },
  'next.config.ts':   { text: 'NEXT', bg: '#000000', fg: '#fff' },
  'tailwind.config.js':{ text: 'TW', bg: '#38bdf8', fg: '#fff' },
  'tailwind.config.ts':{ text: 'TW', bg: '#38bdf8', fg: '#fff' },
  'webpack.config.js':{ text: 'WP',   bg: '#8dd6f9', fg: '#000' },
  'jest.config.js':   { text: 'JEST', bg: '#99425b', fg: '#fff' },
  'jest.config.ts':   { text: 'JEST', bg: '#99425b', fg: '#fff' },
  'babel.config.js':  { text: 'BAB',  bg: '#f5da55', fg: '#000' },
  '.babelrc':         { text: 'BAB',  bg: '#f5da55', fg: '#000' },
  'cargo.toml':       { text: 'RS',   bg: '#dea584', fg: '#000' },
  'go.mod':           { text: 'GO',   bg: '#00add8', fg: '#fff' },
  'go.sum':           { text: 'GO',   bg: '#00add8', fg: '#fff' },
  'requirements.txt': { text: 'PY',   bg: '#3572a5', fg: '#fff' },
  'pyproject.toml':   { text: 'PY',   bg: '#3572a5', fg: '#fff' },
  'gemfile':          { text: 'RB',   bg: '#701516', fg: '#fff' },
  'pubspec.yaml':     { text: 'DAR',  bg: '#00b4ab', fg: '#fff' },
  ext: {
    'js':    { text: 'JS',   bg: '#f7df1e', fg: '#000' },
    'mjs':   { text: 'JS',   bg: '#f7df1e', fg: '#000' },
    'cjs':   { text: 'JS',   bg: '#f7df1e', fg: '#000' },
    'jsx':   { text: 'JSX',  bg: '#61dafb', fg: '#000' },
    'ts':    { text: 'TS',   bg: '#3178c6', fg: '#fff' },
    'tsx':   { text: 'TSX',  bg: '#3178c6', fg: '#fff' },
    'mts':   { text: 'TS',   bg: '#3178c6', fg: '#fff' },
    'cts':   { text: 'TS',   bg: '#3178c6', fg: '#fff' },
    'd.ts':  { text: 'DTS',  bg: '#3178c6', fg: '#fff' },
    'html':  { text: 'HTML', bg: '#e34c26', fg: '#fff' },
    'htm':   { text: 'HTML', bg: '#e34c26', fg: '#fff' },
    'css':   { text: 'CSS',  bg: '#563d7c', fg: '#fff' },
    'scss':  { text: 'SCSS', bg: '#c6538c', fg: '#fff' },
    'sass':  { text: 'SASS', bg: '#c6538c', fg: '#fff' },
    'less':  { text: 'LESS', bg: '#1d365d', fg: '#fff' },
    'styl':  { text: 'STY',  bg: '#ff6347', fg: '#fff' },
    'vue':   { text: 'VUE',  bg: '#41b883', fg: '#fff' },
    'svelte':{ text: 'SV',   bg: '#ff3e00', fg: '#fff' },
    'astro': { text: 'AST',  bg: '#ff5d01', fg: '#fff' },
    'json':  { text: 'JSON', bg: '#292929', fg: '#f7df1e' },
    'json5': { text: 'JSON', bg: '#292929', fg: '#f7df1e' },
    'yaml':  { text: 'YAML', bg: '#cb171e', fg: '#fff' },
    'yml':   { text: 'YAML', bg: '#cb171e', fg: '#fff' },
    'toml':  { text: 'TOML', bg: '#9c4121', fg: '#fff' },
    'xml':   { text: 'XML',  bg: '#0060ac', fg: '#fff' },
    'csv':   { text: 'CSV',  bg: '#3c873a', fg: '#fff' },
    'sql':   { text: 'SQL',  bg: '#e38c00', fg: '#fff' },
    'md':    { text: 'MD',   bg: '#2ea043', fg: '#fff' },
    'mdx':   { text: 'MDX',  bg: '#2ea043', fg: '#fff' },
    'rst':   { text: 'RST',  bg: '#2ea043', fg: '#fff' },
    'txt':   { text: 'TXT',  bg: '#6d8086', fg: '#fff' },
    'pdf':   { text: 'PDF',  bg: '#da3633', fg: '#fff' },
    'py':    { text: 'PY',   bg: '#3572a5', fg: '#fff' },
    'pyw':   { text: 'PY',   bg: '#3572a5', fg: '#fff' },
    'ipynb': { text: 'NB',   bg: '#f37626', fg: '#fff' },
    'rs':    { text: 'RS',   bg: '#dea584', fg: '#000' },
    'go':    { text: 'GO',   bg: '#00add8', fg: '#fff' },
    'java':  { text: 'JV',   bg: '#b07219', fg: '#fff' },
    'kt':    { text: 'KT',   bg: '#7f52ff', fg: '#fff' },
    'kts':   { text: 'KT',   bg: '#7f52ff', fg: '#fff' },
    'swift': { text: 'SW',   bg: '#f05138', fg: '#fff' },
    'cs':    { text: 'C#',   bg: '#178600', fg: '#fff' },
    'cpp':   { text: 'C++',  bg: '#f34b7d', fg: '#fff' },
    'cc':    { text: 'C++',  bg: '#f34b7d', fg: '#fff' },
    'cxx':   { text: 'C++',  bg: '#f34b7d', fg: '#fff' },
    'c':     { text: 'C',    bg: '#555555', fg: '#fff' },
    'h':     { text: 'H',    bg: '#555555', fg: '#fff' },
    'hpp':   { text: 'H++',  bg: '#f34b7d', fg: '#fff' },
    'rb':    { text: 'RB',   bg: '#701516', fg: '#fff' },
    'php':   { text: 'PHP',  bg: '#4f5d95', fg: '#fff' },
    'ex':    { text: 'EX',   bg: '#6e4a7e', fg: '#fff' },
    'exs':   { text: 'EX',   bg: '#6e4a7e', fg: '#fff' },
    'erl':   { text: 'ERL',  bg: '#b83998', fg: '#fff' },
    'hs':    { text: 'HS',   bg: '#5e5086', fg: '#fff' },
    'lua':   { text: 'LUA',  bg: '#000080', fg: '#fff' },
    'r':     { text: 'R',    bg: '#198ce7', fg: '#fff' },
    'scala': { text: 'SC',   bg: '#c22d40', fg: '#fff' },
    'clj':   { text: 'CLJ',  bg: '#db5855', fg: '#fff' },
    'dart':  { text: 'DAR',  bg: '#00b4ab', fg: '#fff' },
    'nim':   { text: 'NIM',  bg: '#ffc200', fg: '#000' },
    'zig':   { text: 'ZIG',  bg: '#f7a41d', fg: '#000' },
    'v':     { text: 'V',    bg: '#5d87bf', fg: '#fff' },
    'sh':    { text: 'SH',   bg: '#89e051', fg: '#000' },
    'bash':  { text: 'SH',   bg: '#89e051', fg: '#000' },
    'zsh':   { text: 'ZSH',  bg: '#89e051', fg: '#000' },
    'fish':  { text: 'FSH',  bg: '#89e051', fg: '#000' },
    'ps1':   { text: 'PS',   bg: '#012456', fg: '#fff' },
    'bat':   { text: 'BAT',  bg: '#c1f12e', fg: '#000' },
    'cmd':   { text: 'CMD',  bg: '#c1f12e', fg: '#000' },
    'graphql':{ text: 'GQL', bg: '#e10098', fg: '#fff' },
    'gql':   { text: 'GQL',  bg: '#e10098', fg: '#fff' },
    'proto': { text: 'PB',   bg: '#3178c6', fg: '#fff' },
    'tf':    { text: 'TF',   bg: '#7b42bc', fg: '#fff' },
    'hcl':   { text: 'HCL',  bg: '#7b42bc', fg: '#fff' },
    'nix':   { text: 'NIX',  bg: '#7e74b3', fg: '#fff' },
    'lock':  { text: 'LCK',  bg: '#888888', fg: '#fff' },
    'patch': { text: 'DIFF', bg: '#f0c27f', fg: '#000' },
    'diff':  { text: 'DIFF', bg: '#f0c27f', fg: '#000' },
    'log':   { text: 'LOG',  bg: '#888888', fg: '#fff' },
    'wasm':  { text: 'WASM', bg: '#654ff0', fg: '#fff' },
    'map':   { text: 'MAP',  bg: '#888888', fg: '#fff' },
    'min.js':{ text: 'MIN',  bg: '#888888', fg: '#fff' },
  }
};

const FOLDER_ICON_MAP = {
  'src':'#3178c6','source':'#3178c6','components':'#61dafb','component':'#61dafb',
  'pages':'#7f52ff','views':'#7f52ff','app':'#e34c26','apps':'#e34c26',
  'api':'#e38c00','apis':'#e38c00','lib':'#6d8086','libs':'#6d8086',
  'utils':'#6d8086','util':'#6d8086','helpers':'#6d8086','helper':'#6d8086',
  'hooks':'#61dafb','hook':'#61dafb','store':'#f7df1e','stores':'#f7df1e',
  'context':'#f7df1e','contexts':'#f7df1e','types':'#3178c6','type':'#3178c6',
  'interfaces':'#3178c6','models':'#3178c6','services':'#e38c00','service':'#e38c00',
  'controllers':'#e38c00','controller':'#e38c00','routes':'#ff6347','route':'#ff6347',
  'middleware':'#ff6347','middlewares':'#ff6347','config':'#6d8086','configs':'#6d8086',
  'constants':'#d29922','constant':'#d29922','assets':'#f1e05a','asset':'#f1e05a',
  'static':'#f1e05a','public':'#f1e05a','images':'#f1e05a','image':'#f1e05a',
  'icons':'#f1e05a','icon':'#f1e05a','fonts':'#f1e05a','font':'#f1e05a',
  'styles':'#c6538c','style':'#c6538c','css':'#563d7c','scss':'#c6538c',
  'tests':'#2ea043','test':'#2ea043','__tests__':'#2ea043','spec':'#2ea043',
  'e2e':'#2ea043','integration':'#2ea043','docs':'#607d8b','doc':'#607d8b',
  'documentation':'#607d8b','examples':'#607d8b','scripts':'#89e051','script':'#89e051',
  'bin':'#89e051','tools':'#89e051','build':'#d29922','dist':'#d29922',
  'out':'#d29922','output':'#d29922','node_modules':'#da3633','vendor':'#da3633',
  'packages':'#2f81f7','pkg':'#2f81f7','internal':'#2f81f7','cmd':'#2f81f7',
  'migrations':'#9c4121','migration':'#9c4121','database':'#9c4121','db':'#9c4121',
  'schemas':'#9c4121','schema':'#9c4121','.github':'#24292f','.vscode':'#007acc',
  '.git':'#f54d27','infrastructure':'#7b42bc','terraform':'#7b42bc','k8s':'#326ce5',
  'kubernetes':'#326ce5','docker':'#0db7ed',
};

function buildFileIconDataUri(filename) {
  const lower = filename.toLowerCase();
  if (FILE_ICON_MAP[lower]) {
    return makeIconSvgUri(FILE_ICON_MAP[lower]);
  }
  const doubleExtMatch = lower.match(/\.(test|spec)\.[jt]sx?$/) ||
                         lower.match(/\.d\.ts$/) ||
                         lower.match(/\.min\.js$/);
  if (doubleExtMatch) {
    if (lower.endsWith('.d.ts')) return makeIconSvgUri(FILE_ICON_MAP.ext['d.ts']);
    if (lower.endsWith('.min.js')) return makeIconSvgUri(FILE_ICON_MAP.ext['min.js']);
    if (lower.match(/\.(test|spec)\.[jt]sx?$/)) {
      return makeIconSvgUri({ text: 'TEST', bg: '#2ea043', fg: '#fff' });
    }
  }
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  if (ext && FILE_ICON_MAP.ext[ext]) {
    return makeIconSvgUri(FILE_ICON_MAP.ext[ext]);
  }
  return null;
}

function buildFolderIconDataUri(folderName) {
  const color = FOLDER_ICON_MAP[folderName.toLowerCase()];
  if (!color) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5L6.75 1.5A.75.75 0 006 1H1.75z" fill="${color}"/><path d="M0 5.75C0 4.784.784 4 1.75 4h12.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V5.75z" fill="${color}" opacity="0.75"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function makeIconSvgUri({ text, bg, fg }) {
  const fontSize = text.length <= 2 ? 7 : text.length === 3 ? 6 : 5;
  const safe = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><rect width="16" height="16" rx="3" fill="${bg}"/><text x="8" y="8" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${fontSize}" font-weight="800" fill="${fg}" text-anchor="middle" dominant-baseline="middle">${safe}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function injectVSCodeFileIcons(_owner, _repo) {
  const treeContainer = document.querySelector('table[aria-labelledby="folders-and-files"], [role="grid"]');
  if (!treeContainer || treeContainer.hasAttribute('data-vsicons-done')) return;
  treeContainer.setAttribute('data-vsicons-done', 'true');

  const rows = treeContainer.querySelectorAll('tr, [role="row"]');
  rows.forEach((row) => {
    if (row.hasAttribute('data-vsicon-replaced')) return;
    const iconSvg = row.querySelector('svg.octicon-file, svg.octicon-file-code, svg[aria-label="File"], svg.octicon-file-directory-fill, svg[aria-label="Directory"]');
    const link = row.querySelector('a[href*="/blob/"], a[href*="/tree/"]');
    if (!iconSvg || !link) return;

    const href = link.getAttribute('href') || '';
    const name = decodeURIComponent(href.split('/').pop() || link.textContent.trim());
    const isFolder = href.includes('/tree/');

    const dataUri = isFolder ? buildFolderIconDataUri(name) : buildFileIconDataUri(name);
    if (!dataUri) return;

    const img = document.createElement('img');
    img.src = dataUri;
    img.width = 16;
    img.height = 16;
    img.alt = '';
    img.style.cssText = 'vertical-align:middle;flex-shrink:0;';
    iconSvg.replaceWith(img);
    row.setAttribute('data-vsicon-replaced', 'true');
  });
}

// ── FEATURE 2: Open in Web IDE Button ──

async function injectOpenInWebIDE(owner, repo) {
  if (document.body.hasAttribute('data-webide-done')) return;
  if (!/^\/[^/]+\/[^/]+(\/tree\/|$|\/$)/.test(location.pathname)) return;

  const codeBtn = document.querySelector('[data-testid="CodeButton"], get-repo summary');
  if (!codeBtn) return;
  const parent = codeBtn.closest('div')?.parentNode || codeBtn.parentNode;
  if (!parent || parent.querySelector('.gh-webide-wrap')) return;

  document.body.setAttribute('data-webide-done', 'true');

  const wrap = document.createElement('div');
  wrap.className = 'gh-webide-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gh-webide-btn btn';
  btn.innerHTML = 'Open in Web IDE <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="10" height="10" fill="currentColor" style="margin-left:4px"><path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/></svg>';

  const dropdown = document.createElement('div');
  dropdown.className = 'gh-webide-dropdown';

  const options = [
    { label: 'CodeSandbox', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2 6l10-4 10 4v12l-10 4L2 18V6zm2 1.5v9l8 3.2 8-3.2v-9l-8-3.2-8 3.2zM12 5.3L6.5 7.5 12 9.7l5.5-2.2L12 5.3z"/></svg>', url: () => `https://codesandbox.io/p/github/${owner}/${repo}` },
    { label: 'GitHub1s', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>', url: () => `https://github1s.com/${owner}/${repo}` },
    { label: 'Repl.it', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h8v6H6v4H2V2zm0 10h4v4h4v6H2V12zm10 4h4V10h-4V6h4V2h6v8h-4v4h4v8h-6v-4h-4v-2z"/></svg>', url: () => `https://replit.com/github/${owner}/${repo}` },
    { label: 'Gitpod', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6.07 21.25l8.5-14.72H12L3.5 21.25h2.57zM20.5 9.25h-2.57l-8.5 14.72H12l8.5-14.72z"/></svg>', url: () => `https://gitpod.io/#https://github.com/${owner}/${repo}` },
    { label: 'StackBlitz', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10.796 2L2 13.5h8.5L7.296 22 22 10.5h-8.5L17 2z"/></svg>', url: () => `https://stackblitz.com/github/${owner}/${repo}` },
    { type: 'divider' },
    { label: 'Clone in VS Code', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#007acc"><path d="M17.5 0L9 9.5 3.5 5 0 7l9 9L24 3z"/></svg>', url: () => `vscode://vscode.git/clone?url=${encodeURIComponent('https://github.com/' + owner + '/' + repo + '.git')}` },
    { label: 'Clone in Cursor', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#9333ea"><circle cx="12" cy="12" r="10"/><path d="M8 12l4-4 4 4-4 4z" fill="#fff"/></svg>', url: () => `cursor://vscode.git/clone?url=${encodeURIComponent('https://github.com/' + owner + '/' + repo + '.git')}` },
    { label: 'Clone in Windsurf', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#0ea5e9"><path d="M12 2L2 19h20L12 2zm0 4l7 11H5l7-11z"/></svg>', url: () => `windsurf://vscode.git/clone?url=${encodeURIComponent('https://github.com/' + owner + '/' + repo + '.git')}` }
  ];

  options.forEach((opt) => {
    if (opt.type === 'divider') {
      const div = document.createElement('div');
      div.className = 'gh-webide-divider';
      dropdown.appendChild(div);
      return;
    }
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'gh-webide-item';
    item.innerHTML = `<span class="gh-webide-icon">${opt.icon}</span><span>${opt.label}</span>`;
    item.addEventListener('click', () => {
      const url = opt.url();
      if (url.startsWith('http')) window.open(url, '_blank', 'noopener');
      else window.location.href = url;
      dropdown.classList.remove('is-open');
    });
    dropdown.appendChild(item);
  });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('is-open');
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) dropdown.classList.remove('is-open');
  });

  wrap.appendChild(btn);
  wrap.appendChild(dropdown);
  parent.insertBefore(wrap, codeBtn.closest('div, details') || codeBtn);
}

// ── FEATURE 3: Lines of Code in Sidebar ──

async function injectLOCInSidebar(owner, repo) {
  if (!/^\/[^/]+\/[^/]+\/?$/.test(location.pathname)) return;

  const sidebar = document.querySelector('.Layout-sidebar, [data-testid="repository-about"]')?.closest('.Layout-sidebar') ||
                  document.querySelector('.repository-content .Layout-sidebar');
  if (!sidebar || sidebar.hasAttribute('data-loc-sidebar-done')) return;
  sidebar.setAttribute('data-loc-sidebar-done', 'true');

  const response = await sendMessage({ type: 'GET_LOC', payload: { owner, repo } }).catch(() => null);
  const total = response?.data?.total;
  if (!total) return;

  const locRow = document.createElement('div');
  locRow.className = 'gh-loc-stat-row';
  locRow.innerHTML =
    '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" class="octicon" style="color:var(--color-fg-muted)">' +
    '<path d="m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.44 8.53a.75.75 0 0 1 0-1.06Z"/>' +
    '</svg>' +
    '<span class="gh-loc-stat-number">' + total.toLocaleString() + '</span>' +
    '<span class="gh-loc-stat-label">lines of code</span>';

  const forksRow = document.querySelector('a[href$="/forks"]')?.closest('[class*="BorderGrid-row"], .d-flex, li') ||
                   document.querySelector('[href$="/network/members"]')?.closest('div, li');
  if (forksRow) {
    forksRow.insertAdjacentElement('afterend', locRow);
  } else if (sidebar) {
    sidebar.appendChild(locRow);
  }
}

// ── FEATURE 4: Absolute Dates ──

let absDateObserver = null;

async function injectAbsoluteDates() {
  if (document.body.hasAttribute('data-abs-dates-done')) return;
  document.body.setAttribute('data-abs-dates-done', 'true');

  const stored = await new Promise((resolve) => {
    chrome.storage.local.get(['gh_abs_time_format', 'gh_abs_date_format', 'gh_abs_color_code'], resolve);
  });
  const timeFormat = stored.gh_abs_time_format || '24h';
  const dateFormat = stored.gh_abs_date_format || '';
  const colorCode = stored.gh_abs_color_code !== false;

  function formatAbsDate(isoString) {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;

    let datePart;
    if (dateFormat) {
      datePart = dateFormat
        .replace('YYYY', String(d.getFullYear()))
        .replace('YY', String(d.getFullYear()).slice(-2))
        .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
        .replace('DD', String(d.getDate()).padStart(2, '0'));
    } else {
      datePart = d.toLocaleDateString(undefined, { year: '2-digit', month: '2-digit', day: '2-digit' });
    }

    let timePart;
    if (timeFormat === '12h') {
      timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
    } else if (timeFormat === '24h') {
      timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    } else {
      timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }

    return `${datePart} ${timePart}`;
  }

  function hashDateColor(dateStr) {
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
      hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 55%, 55%)`;
  }

  function processTimeElements(root) {
    const elements = (root || document).querySelectorAll('relative-time[datetime], time-ago[datetime]');
    elements.forEach((el) => {
      if (el.hasAttribute('data-abs-processed')) return;
      el.setAttribute('data-abs-processed', 'true');
      const dt = el.getAttribute('datetime');
      if (!dt) return;
      const formatted = formatAbsDate(dt);
      if (!formatted) return;
      el.textContent = formatted;
      el.setAttribute('title', new Date(dt).toLocaleString());
      if (colorCode) {
        const dayStr = dt.slice(0, 10);
        el.style.color = hashDateColor(dayStr);
        el.style.fontWeight = '500';
      }
    });
  }

  processTimeElements(document);

  if (!absDateObserver) {
    absDateObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            if (node.matches && node.matches('relative-time[datetime], time-ago[datetime]')) {
              processTimeElements(node.parentNode);
            } else if (node.querySelectorAll) {
              processTimeElements(node);
            }
          }
        }
      }
    });
    absDateObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
}

// ── FEATURE 5: Health Score Sidebar Panel ──

async function injectHealthSidebarPanel(owner, repo) {
  if (!/^\/[^/]+\/[^/]+\/?$/.test(location.pathname)) return;

  const sidebar = document.querySelector('.Layout-sidebar, [data-testid="repository-about"]')?.closest('.Layout-sidebar') ||
                  document.querySelector('.repository-content .Layout-sidebar');
  if (!sidebar || sidebar.hasAttribute('data-health-panel-done')) return;
  sidebar.setAttribute('data-health-panel-done', 'true');

  const resp = await sendMessage({ type: 'GET_REPO_HEALTH', payload: { owner, repo } }).catch(() => null);
  const data = resp?.data;
  if (!data) return;

  const scoreColor = data.score >= 7 ? '#2ea043' : data.score >= 4 ? '#d29922' : '#da3633';

  function hsbBar(label, value, max, color) {
    const pct = Math.min(100, (value / max) * 100);
    return '<div class="gh-hsb-row">' +
      '<span class="gh-hsb-label">' + label + '</span>' +
      '<div class="gh-hsb-track"><div class="gh-hsb-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
      '<span class="gh-hsb-val">' + value + '/' + max + '</span>' +
      '</div>';
  }

  function metricRow(label, value) {
    return '<div class="gh-hsb-metric"><span>' + label + '</span><span class="gh-hsb-metric-val">' + value + '</span></div>';
  }

  function timeAgoShort(ts) {
    if (!ts) return '';
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    return Math.round(mins / 60) + 'h ago';
  }

  const licenseDisplay = data.licenseRisk === 'none' ? (data.licenseName || 'Permissive') : data.licenseRisk;
  const releaseDisplay = (data.releaseLabel || 'unknown') + (data.latestVersion ? ' (' + data.latestVersion + ')' : '');

  const panel = document.createElement('div');
  panel.className = 'gh-health-sidebar-panel';
  panel.innerHTML =
    '<div class="gh-health-sidebar-header">' +
      '<span class="gh-health-sidebar-title">Repository Health</span>' +
      '<span class="gh-health-sidebar-score" style="color:' + scoreColor + '">' + data.score.toFixed(1) + '/10</span>' +
    '</div>' +
    '<div class="gh-health-sidebar-status">Status: <strong>' + (data.status || '') + '</strong></div>' +
    '<div class="gh-health-sidebar-bars">' +
      hsbBar('Activity', data.activityScore, 4, '#2f81f7') +
      hsbBar('Maintenance', data.maintenanceScore, 3, '#2ea043') +
      hsbBar('Popularity', data.popularityScore, 3, '#d29922') +
    '</div>' +
    '<div class="gh-health-sidebar-metrics">' +
      metricRow('⚡ Velocity', data.velocityLabel || 'unknown') +
      metricRow('👥 Bus Factor', data.busFactor || 'healthy') +
      metricRow('⚖️ License', licenseDisplay) +
      metricRow('🏷️ Release', releaseDisplay) +
      (data.deps ? metricRow('📦 Deps', data.deps.riskLabel || 'unknown') : '') +
    '</div>' +
    '<div class="gh-health-sidebar-footer">' +
      'Last checked ' + timeAgoShort(data.scannedAt) +
      '<button class="gh-health-sidebar-refresh" type="button">↻</button>' +
    '</div>';

  panel.querySelector('.gh-health-sidebar-refresh').addEventListener('click', async () => {
    await sendMessage({ type: 'GET_REPO_HEALTH', payload: { owner, repo, bypassCache: true } });
    sidebar.removeAttribute('data-health-panel-done');
    panel.remove();
    injectHealthSidebarPanel(owner, repo).catch(() => {});
  });

  const aboutSection = sidebar.querySelector('[data-testid="repository-about"]');
  if (aboutSection) {
    aboutSection.insertAdjacentElement('afterend', panel);
  } else {
    sidebar.appendChild(panel);
  }
}

function cleanupAllBadges() {
  document.querySelectorAll('.gh-health-badge').forEach((badge) => badge.remove());
  document.querySelectorAll('.eg-download, .eg-repo-size, .js-file-clipboard, .js-file-download, .js-enhanced-github-copy-btn, .gh-md-print-btn, .gh-readme-toc, .gh-pr-complexity, .gh-todo-summary, .gh-insights-panel, .gh-issues-summary, .gh-quick-clone-wrap, .gh-star-history, .gh-commit-quality-summary, .gh-webide-wrap, .gh-loc-stat-row, .gh-health-sidebar-panel').forEach((node) => node.remove());
  document.querySelectorAll('[data-health-done], [data-toc-done], [data-pr-complexity-done], [data-todo-done], [data-insights-done], [data-issues-age-done], [data-icons-done], [data-clone-done], [data-star-history-done], [data-commit-quality-done], [data-bookmark-done], [data-md-print-done], [data-readme-print-done], [data-vsicons-done], [data-vsicon-replaced], [data-webide-done], [data-loc-sidebar-done], [data-abs-dates-done], [data-health-panel-done]').forEach((element) => {
    element.removeAttribute('data-health-done');
    element.removeAttribute('data-toc-done');
    element.removeAttribute('data-pr-complexity-done');
    element.removeAttribute('data-todo-done');
    element.removeAttribute('data-insights-done');
    element.removeAttribute('data-issues-age-done');
    element.removeAttribute('data-icons-done');
    element.removeAttribute('data-clone-done');
    element.removeAttribute('data-star-history-done');
    element.removeAttribute('data-commit-quality-done');
    element.removeAttribute('data-bookmark-done');
    element.removeAttribute('data-md-print-done');
    element.removeAttribute('data-readme-print-done');
    element.removeAttribute('data-vsicons-done');
    element.removeAttribute('data-vsicon-replaced');
    element.removeAttribute('data-webide-done');
    element.removeAttribute('data-loc-sidebar-done');
    element.removeAttribute('data-abs-dates-done');
    element.removeAttribute('data-health-panel-done');
  });
}
