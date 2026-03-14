const PROCESSED_ATTR = 'data-health-done';
const BOOKMARK_ATTR = 'data-bookmark-done';

const BUILTIN_PAGES = [
  'about', 'apps', 'blog', 'collections', 'contact', 'customer-stories', 'enterprise', 'events',
  'explore', 'features', 'github-copilot', 'issues', 'join', 'login', 'marketplace', 'new',
  'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'search', 'security', 'settings',
  'site', 'sponsors', 'team', 'teams', 'topics', 'trending'
];

let settings = {
  showBusFactor: true,
  showLicenseRisk: true,
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
let lastTrackedRepo = '';
let enhancedGithubClickBound = false;
let enhancedGithubLastUrl = '';

if (typeof initSidebar === 'function') {
  initSidebar();
}

function isExpectedRuntimeError(error) {
  const msg = error instanceof Error ? error.message : String(error || '');
  return msg.includes('Extension context invalidated') || msg.includes('Receiving end does not exist');
}

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

  if (message.type === 'SIDEBAR_REFRESH') {
    if (typeof refreshSidebarData === 'function') refreshSidebarData();
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
    window.__ghhSettings = settings;
  } catch (_error) {
    // use defaults
  }

  scanPage();
  startObserver();
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => scanPage(), 300);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function scanPage() {
  const path = window.location.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length >= 2 && !isBuiltinPage(segments[0])) {
    const owner = segments[0];
    const repo = segments[1];
    handleRepoPage(owner, repo);
    trackRecentRepo(owner, repo).catch(() => {});

    if (settings.showFileEnhancements) {
      enhancedGithubMainEntry(owner, repo).catch(() => {});
    }

    if (settings.showMarkdownPrinter) {
      injectMarkdownPrintButton().catch(() => {});
      injectReadmePagePrintButton().catch(() => {});
    }

    injectBookmarkButton(owner, repo).catch(() => {});

    if (settings.showVSIcons) {
      injectVSCodeFileIcons(owner, repo).catch(() => {});
    }
    if (settings.showWebIDE) {
      injectOpenInWebIDE(owner, repo).catch(() => {});
    }
    if (settings.showLOCSidebar) {
      injectLOCInSidebar(owner, repo).catch(() => {});
    }
    // Health sidebar panel now handled by sidebar.js
    // if (settings.showHealthSidebar) {
    //   injectHealthSidebarPanel(owner, repo).catch(() => {});
    // }
  }

  if (settings.showAbsoluteDates) {
    injectAbsoluteDates().catch(() => {});
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
  },
  fetchFolderFilesRecursive: async function(userRepo, folderPath, branch, headers) {
    const files = [];
    const url = `https://api.github.com/repos/${userRepo}/contents/${folderPath}?ref=${branch}`;
    const resp = await window.fetch(url, { headers });
    if (!resp.ok) return files;
    const items = await resp.json();
    for (const item of items) {
      if (item.type === 'file') {
        files.push({ path: item.path, download_url: item.download_url });
      } else if (item.type === 'dir') {
        const subFiles = await enhancedGithubCommonUtil.fetchFolderFilesRecursive(userRepo, item.path, branch, headers);
        files.push(...subFiles);
      }
    }
    return files;
  },
  downloadFolderAsZip: async function(folderPath, folderName) {
    const path = enhancedGithubCommonUtil.getUsernameWithReponameFromGithubURL();
    const userRepo = `${path.user}/${path.repo}`;
    const branch = enhancedGithubCommonUtil.getBranch() || enhancedGithubStorageUtil.get('defaultBranch') || 'master';
    const token = settings.github_pat || '';
    const headers = token ? { Authorization: 'token ' + token, 'User-Agent': 'Awesome-Octocat-App' } : {};

    const files = await enhancedGithubCommonUtil.fetchFolderFilesRecursive(userRepo, folderPath, branch, headers);
    if (!files.length) return;

    // Minimal ZIP builder (store method, no compression)
    const encoder = new TextEncoder();
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const file of files) {
      const resp = await window.fetch(file.download_url);
      if (!resp.ok) continue;
      const blob = await resp.arrayBuffer();
      const fileData = new Uint8Array(blob);
      const relativePath = file.path.startsWith(folderPath + '/') ? file.path.slice(folderPath.length + 1) : file.path;
      const nameBytes = encoder.encode(relativePath);

      // Local file header
      const local = new Uint8Array(30 + nameBytes.length + fileData.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);  // signature
      localView.setUint16(4, 20, true);           // version needed
      localView.setUint16(6, 0, true);            // flags
      localView.setUint16(8, 0, true);            // compression (store)
      localView.setUint16(10, 0, true);           // mod time
      localView.setUint16(12, 0, true);           // mod date
      // CRC-32
      const crc = enhancedGithubCommonUtil.crc32(fileData);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, fileData.length, true); // compressed size
      localView.setUint32(22, fileData.length, true); // uncompressed size
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);           // extra field length
      local.set(nameBytes, 30);
      local.set(fileData, 30 + nameBytes.length);
      localHeaders.push(local);

      // Central directory header
      const central = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true); // signature
      centralView.setUint16(4, 20, true);          // version made by
      centralView.setUint16(6, 20, true);          // version needed
      centralView.setUint16(8, 0, true);           // flags
      centralView.setUint16(10, 0, true);          // compression
      centralView.setUint16(12, 0, true);          // mod time
      centralView.setUint16(14, 0, true);          // mod date
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, fileData.length, true);
      centralView.setUint32(24, fileData.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);          // extra field length
      centralView.setUint16(32, 0, true);          // comment length
      centralView.setUint16(34, 0, true);          // disk number start
      centralView.setUint16(36, 0, true);          // internal attrs
      centralView.setUint32(38, 0, true);          // external attrs
      centralView.setUint32(42, offset, true);     // local header offset
      central.set(nameBytes, 46);
      centralHeaders.push(central);

      offset += local.length;
    }

    // End of central directory
    let centralSize = 0;
    centralHeaders.forEach(c => centralSize += c.length);
    const endRecord = new Uint8Array(22);
    const endView = new DataView(endRecord.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, centralHeaders.length, true);
    endView.setUint16(10, centralHeaders.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    endView.setUint16(20, 0, true);

    const zipParts = [...localHeaders, ...centralHeaders, endRecord];
    const zipBlob = new Blob(zipParts, { type: 'application/zip' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = folderName + '.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  crc32: function(data) {
    let crc = 0xFFFFFFFF;
    if (!enhancedGithubCommonUtil._crc32Table) {
      enhancedGithubCommonUtil._crc32Table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        enhancedGithubCommonUtil._crc32Table[i] = c;
      }
    }
    const table = enhancedGithubCommonUtil._crc32Table;
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  },
  fetchFolderSize: async function(userRepo, folderPath, branch, headers) {
    try {
      const response = await window.fetch(
        `https://api.github.com/repos/${userRepo}/contents/${folderPath}?ref=${branch}`,
        { headers }
      );
      if (!response.ok) return null;
      const items = await response.json();
      if (!Array.isArray(items)) return null;
      let totalSize = 0;
      for (const item of items) {
        if (item.type === 'file' && item.size) {
          totalSize += item.size;
        } else if (item.type === 'dir') {
          const subSize = await enhancedGithubCommonUtil.fetchFolderSize(userRepo, item.path, branch, headers);
          if (subSize !== null) totalSize += subSize;
        }
      }
      return totalSize;
    } catch (e) {
      return null;
    }
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
      <button
        aria-label="Download file" class="js-file-download btn btn-sm BtnGroup-item file-download-button tooltipped tooltipped-s" data-url="${data.download_url}" data-name="${data.name}">
        <span style="margin-right: 5px;">${formattedFileSize}</span>
        <svg class="octicon octicon-cloud-download" aria-hidden="true" height="16" version="1.1" viewBox="0 0 16 16" width="16">
          <path d="M9 12h2l-3 3-3-3h2V7h2v5zm3-8c0-.44-.91-3-4.5-3C5.08 1 3 2.92 3 5 1.02 5 0 6.52 0 8c0 1.53 1 3 3 3h3V9.7H3C1.38 9.7 1.3 8.28 1.3 8c0-.17.05-1.7 1.7-1.7h1.3V5c0-1.39 1.56-2.7 3.2-2.7 2.55 0 3.13 1.55 3.2 1.8v1.2H12c.81 0 2.7.22 2.7 2.2 0 2.09-2.25 2.2-2.7 2.2h-2V11h2c2.08 0 4-1.16 4-3.5C16 5.06 14.08 4 12 4z"></path>
        </svg>
      </button>`;

    const btnGroup = document.querySelectorAll('.BtnGroup:not(.d-md-none)')[1];
    if (btnGroup) {
      btnGroup.insertAdjacentHTML('beforeend', btnGroupHtml);
      const dlBtn = btnGroup.querySelector('.js-file-download');
      if (dlBtn) {
        dlBtn.addEventListener('click', function(e) {
          e.preventDefault();
          const url = this.getAttribute('data-url');
          const name = this.getAttribute('data-name');
          window.fetch(url).then(r => r.blob()).then(blob => {
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
          });
        });
      }
    }
  },
  onPathContentFetched: function(data = []) {
    data = enhancedGithubCommonUtil.sortFileStructureAsOnSite(data);

    if (!data) {
      return;
    }

    let isAnyFileOrDirPresent = false;

    for (let i = 0; i < data.length; i++) {
      if (data[i].type === 'file' || data[i].type === 'dir') {
        isAnyFileOrDirPresent = true;
        break;
      }
    }

    if (!isAnyFileOrDirPresent) {
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
          const fileUrl = data[actualDataIndex].download_url;
          const fileName = data[actualDataIndex].name;
          const fileDlId = 'eg-file-dl-' + actualDataIndex;

          commitElem.parentElement.insertAdjacentHTML('beforebegin', `
            <td class="eg-download">
              <div class="eg-file-cell" id="${fileDlId}" data-url="${fileUrl}" data-name="${fileName}" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
                <span class="react-directory-download Link--secondary">${formattedFileSize}</span>
                <span class="eg-file-dl-icon" title="Download file" style="display:none;opacity:0;transition:opacity 0.2s;">
                  <svg class="octicon octicon-cloud-download" aria-hidden="true" height="16" version="1.1" viewBox="0 0 16 16" width="16">
                    <path d="M9 12h2l-3 3-3-3h2V7h2v5zm3-8c0-.44-.91-3-4.5-3C5.08 1 3 2.92 3 5 1.02 5 0 6.52 0 8c0 1.53 1 3 3 3h3V9.7H3C1.38 9.7 1.3 8.28 1.3 8c0-.17.05-1.7 1.7-1.7h1.3V5c0-1.39 1.56-2.7 3.2-2.7 2.55 0 3.13 1.55 3.2 1.8v1.2H12c.81 0 2.7.22 2.7 2.2 0 2.09-2.25 2.2-2.7 2.2h-2V11h2c2.08 0 4-1.16 4-3.5C16 5.06 14.08 4 12 4z"></path>
                  </svg>
                </span>
              </div>
            </td>
          `);
          setTimeout(() => {
            const cell = document.getElementById(fileDlId);
            if (cell) {
              const dlIcon = cell.querySelector('.eg-file-dl-icon');
              cell.addEventListener('mouseenter', function() {
                if (dlIcon) { dlIcon.style.display = 'inline-flex'; setTimeout(() => { dlIcon.style.opacity = '1'; }, 10); }
              });
              cell.addEventListener('mouseleave', function() {
                if (dlIcon) { dlIcon.style.opacity = '0'; setTimeout(() => { dlIcon.style.display = 'none'; }, 200); }
              });
              cell.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                const url = this.getAttribute('data-url');
                const name = this.getAttribute('data-name');
                window.fetch(url).then(r => r.blob()).then(blob => {
                  const blobUrl = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = blobUrl;
                  a.download = name;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(blobUrl);
                });
              });
            }
          }, 0);
        } else if (data[actualDataIndex].type === 'dir') {
          const folderPath = data[actualDataIndex].path;
          const folderName = data[actualDataIndex].name;
          const btnId = 'eg-folder-dl-' + actualDataIndex;
          const sizeSpanId = 'eg-folder-size-' + actualDataIndex;
          commitElem.parentElement.insertAdjacentHTML('beforebegin', `
            <td class="eg-download">
              <div class="eg-folder-cell" id="${btnId}" data-folder-path="${folderPath}" data-folder-name="${folderName}" style="position:relative;cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
                <span id="${sizeSpanId}" class="react-directory-download Link--secondary">...</span>
                <span class="eg-folder-zip-icon" title="Download folder as ZIP" style="display:none;opacity:0;transition:opacity 0.2s;">
                  <svg class="octicon octicon-cloud-download" aria-hidden="true" height="16" version="1.1" viewBox="0 0 16 16" width="16">
                    <path d="M9 12h2l-3 3-3-3h2V7h2v5zm3-8c0-.44-.91-3-4.5-3C5.08 1 3 2.92 3 5 1.02 5 0 6.52 0 8c0 1.53 1 3 3 3h3V9.7H3C1.38 9.7 1.3 8.28 1.3 8c0-.17.05-1.7 1.7-1.7h1.3V5c0-1.39 1.56-2.7 3.2-2.7 2.55 0 3.13 1.55 3.2 1.8v1.2H12c.81 0 2.7.22 2.7 2.2 0 2.09-2.25 2.2-2.7 2.2h-2V11h2c2.08 0 4-1.16 4-3.5C16 5.06 14.08 4 12 4z"></path>
                  </svg>
                </span>
              </div>
            </td>
          `);
          // Async fetch folder size
          (function(fPath, spanId, elId) {
            const repoInfo = enhancedGithubCommonUtil.getUsernameWithReponameFromGithubURL();
            const uRepo = repoInfo.user + '/' + repoInfo.repo;
            const br = enhancedGithubCommonUtil.getBranch() || enhancedGithubStorageUtil.get('defaultBranch') || 'master';
            const tk = settings.github_pat || '';
            const hdrs = tk ? { Authorization: 'token ' + tk, 'User-Agent': 'Awesome-Octocat-App' } : {};
            enhancedGithubCommonUtil.fetchFolderSize(uRepo, fPath, br, hdrs).then(function(totalBytes) {
              const el = document.getElementById(spanId);
              if (!el) return;
              if (totalBytes === null) { el.textContent = '-'; return; }
              const formatted = enhancedGithubCommonUtil.convertSizeToHumanReadableFormat(totalBytes);
              el.textContent = formatted.size + ' ' + formatted.measure;
            }).catch(function() {
              const el = document.getElementById(spanId);
              if (el) el.textContent = '-';
            });
          })(folderPath, sizeSpanId, btnId);
          setTimeout(() => {
            const cell = document.getElementById(btnId);
            if (cell) {
              const zipIcon = cell.querySelector('.eg-folder-zip-icon');
              cell.addEventListener('mouseenter', function() {
                if (zipIcon) { zipIcon.style.display = 'inline-flex'; setTimeout(() => { zipIcon.style.opacity = '1'; }, 10); }
              });
              cell.addEventListener('mouseleave', function() {
                if (zipIcon) { zipIcon.style.opacity = '0'; setTimeout(() => { zipIcon.style.display = 'none'; }, 200); }
              });
              cell.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                const fp = this.getAttribute('data-folder-path');
                const fn = this.getAttribute('data-folder-name');
                const sizeEl = this.querySelector('#' + sizeSpanId);
                const origText = sizeEl ? sizeEl.textContent : '';
                if (sizeEl) sizeEl.textContent = 'Downloading...';
                enhancedGithubCommonUtil.downloadFolderAsZip(fp, fn).then(() => {
                  if (sizeEl) sizeEl.textContent = origText;
                }).catch(() => {
                  if (sizeEl) sizeEl.textContent = origText;
                });
              });
            }
          }, 0);
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
  dot.textContent = 'â—';

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
    busFactorLine.textContent = `âš ï¸ Single maintainer risk (${share}% of commits by one person)`;
    lines.push(busFactorLine);
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
    releaseLine.textContent = `ðŸ·ï¸ ${data.latestVersion} Â· ${Math.round(Number(data.daysSinceRelease))}d ago`;
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
    fallbackLine.textContent = `â­ ${stars} Â· ðŸ´ ${forks} Â· ${daysSinceLast}d since last commit`;
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

  return `âš¡ Issues ~${stripTrailingZero(normalizedIssue)}d Â· PRs ~${stripTrailingZero(normalizedPr)}d`;
}

function getLicenseBadgeLine(data) {
  if (data.licenseRisk === 'copyleft') {
    return `âš–ï¸ Copyleft license (${formatLicenseShortName(data.licenseName, data.licenseKey)})`;
  }
  if (data.licenseRisk === 'unlicensed') {
    return 'âš ï¸ No license - use with caution';
  }
  if (data.licenseRisk === 'unknown') {
    return 'â“ License unclear';
  }
  return null;
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
  if (document.querySelector('.gh-md-print-btn')) {
    document.body.setAttribute('data-readme-print-done', 'true');
    return;
  }

  // Find the README section — try multiple strategies since GitHub changes DOM often
  const readmeSection =
    document.querySelector('#readme') ||
    document.querySelector('[data-testid="readme"]') ||
    document.querySelector('[data-testid="readme-panel"]');

  // Find the markdown body (the README content)
  let markdownBody = null;
  if (readmeSection) {
    markdownBody = readmeSection.querySelector('article.markdown-body, .markdown-body');
  }
  // If no #readme container, look for a standalone .markdown-body on repo root pages
  if (!markdownBody) {
    const allMd = document.querySelectorAll('article.markdown-body, .markdown-body');
    for (const md of allMd) {
      // Skip blob-view markdown bodies
      if (md.closest('[data-testid="blob-viewer"]') || md.closest('.blob-wrapper')) continue;
      markdownBody = md;
      break;
    }
  }
  if (!markdownBody) return;

  // Find the header/toolbar row that contains the pen icon
  // In modern GitHub, look for the row that has "README" nav links + icon buttons
  // It's typically a sibling or ancestor of the markdown body container
  let headerRow = null;
  let penButton = null;

  // Strategy 1: Walk up from markdownBody looking for a container that has the pen icon
  let container = markdownBody.parentElement;
  for (let i = 0; i < 5 && container; i++) {
    // Look for edit links/buttons
    penButton =
      container.querySelector('a[aria-label*="Edit" i]') ||
      container.querySelector('button[aria-label*="Edit" i]') ||
      container.querySelector('a[href*="/edit/"]') ||
      container.querySelector('svg.octicon-pencil')?.closest('a, button');
    if (penButton && !markdownBody.contains(penButton)) break;
    penButton = null;

    // Scan SVG paths for pencil icon
    for (const pathEl of container.querySelectorAll('svg path')) {
      if (markdownBody.contains(pathEl)) continue;
      const d = pathEl.getAttribute('d') || '';
      if (d.includes('M11.013') || d.includes('m11.013')) {
        penButton = pathEl.closest('svg').closest('a, button') || pathEl.closest('svg').parentElement;
        break;
      }
    }
    if (penButton) break;

    container = container.parentElement;
  }

  document.body.setAttribute('data-readme-print-done', 'true');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gh-md-print-btn';
  btn.title = 'Print this README';
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4 1h8a1 1 0 0 1 1 1v2H3V2a1 1 0 0 1 1-1Zm-3 5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2H2a1 1 0 0 1-1-1V6Zm3 4v3h8v-3H4Zm7-3.5a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    printGitHubMarkdownPage(markdownBody);
  });

  // Insert before the pen icon if found
  if (penButton) {
    penButton.parentElement.insertBefore(btn, penButton);
    return;
  }

  // Strategy 2: Find the header row by looking at siblings above the markdown body
  const mdParent = markdownBody.parentElement;
  if (mdParent) {
    for (const sibling of mdParent.children) {
      if (sibling === markdownBody || sibling.contains(markdownBody)) continue;
      // Check if this sibling has SVG icon buttons (pen, list icons)
      const iconLinks = [];
      sibling.querySelectorAll('a, button').forEach((el) => {
        if (el.querySelector('svg') && !markdownBody.contains(el)) iconLinks.push(el);
      });
      if (iconLinks.length > 0) {
        // Insert before the first icon (pen icon comes first)
        iconLinks[0].parentElement.insertBefore(btn, iconLinks[0]);
        return;
      }
      // Check if this looks like a README nav row (has "README" text)
      if (/README/i.test(sibling.textContent) && sibling.querySelector('nav, a')) {
        sibling.appendChild(btn);
        return;
      }
    }
  }

  // Strategy 3: absolute position above the markdown content
  const posRef = (readmeSection || markdownBody.parentElement || markdownBody);
  posRef.style.position = 'relative';
  btn.style.cssText = 'position:absolute;right:48px;top:8px;z-index:10;';
  posRef.insertBefore(btn, posRef.firstChild);
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

// â”€â”€ FEATURE 1: VS Code Material File Icons â”€â”€

const VSICONS_ATTR = 'data-vsicons-done';

function getVSCodeIconUrl(name, isFolder) {
  const lower = name.toLowerCase();

  if (isFolder) {
    const folderMap = {
      'src': 'folder_type_src.svg',
      'source': 'folder_type_src.svg',
      'components': 'folder_type_component.svg',
      'component': 'folder_type_component.svg',
      'api': 'folder_type_api.svg',
      'apis': 'folder_type_api.svg',
      'lib': 'folder_type_library.svg',
      'libs': 'folder_type_library.svg',
      'library': 'folder_type_library.svg',
      'utils': 'folder_type_helper.svg',
      'util': 'folder_type_helper.svg',
      'helpers': 'folder_type_helper.svg',
      'helper': 'folder_type_helper.svg',
      'hooks': 'folder_type_hook.svg',
      'hook': 'folder_type_hook.svg',
      'styles': 'folder_type_style.svg',
      'style': 'folder_type_style.svg',
      'css': 'folder_type_style.svg',
      'scss': 'folder_type_style.svg',
      'tests': 'folder_type_test.svg',
      'test': 'folder_type_test.svg',
      '__tests__': 'folder_type_test.svg',
      'spec': 'folder_type_test.svg',
      'e2e': 'folder_type_e2e.svg',
      'mocks': 'folder_type_mock.svg',
      '__mocks__': 'folder_type_mock.svg',
      'docs': 'folder_type_docs.svg',
      'doc': 'folder_type_docs.svg',
      'documentation': 'folder_type_docs.svg',
      'scripts': 'folder_type_script.svg',
      'script': 'folder_type_script.svg',
      'assets': 'folder_type_asset.svg',
      'asset': 'folder_type_asset.svg',
      'images': 'folder_type_images.svg',
      'image': 'folder_type_images.svg',
      'img': 'folder_type_images.svg',
      'icons': 'folder_type_images.svg',
      'fonts': 'folder_type_fonts.svg',
      'font': 'folder_type_fonts.svg',
      'public': 'folder_type_public.svg',
      'static': 'folder_type_public.svg',
      'dist': 'folder_type_dist.svg',
      'out': 'folder_type_dist.svg',
      'output': 'folder_type_dist.svg',
      'node_modules': 'folder_type_node.svg',
      'config': 'folder_type_config.svg',
      'configs': 'folder_type_config.svg',
      '.github': 'folder_type_github.svg',
      '.vscode': 'folder_type_vscode.svg',
      '.git': 'folder_type_git.svg',
      'docker': 'folder_type_docker.svg',
      'kubernetes': 'folder_type_kubernetes.svg',
      'k8s': 'folder_type_kubernetes.svg',
      'models': 'folder_type_model.svg',
      'model': 'folder_type_model.svg',
      'controllers': 'folder_type_controller.svg',
      'controller': 'folder_type_controller.svg',
      'services': 'folder_type_services.svg',
      'service': 'folder_type_services.svg',
      'types': 'folder_type_typescript.svg',
      'interfaces': 'folder_type_typings.svg',
      'typings': 'folder_type_typings.svg',
      'routes': 'folder_type_route.svg',
      'route': 'folder_type_route.svg',
      'middleware': 'folder_type_middleware.svg',
      'middlewares': 'folder_type_middleware.svg',
      'server': 'folder_type_server.svg',
      'client': 'folder_type_client.svg',
      'packages': 'folder_type_package.svg',
      'modules': 'folder_type_module.svg',
      'tools': 'folder_type_tools.svg',
      'themes': 'folder_type_theme.svg',
      'theme': 'folder_type_theme.svg',
      'redux': 'folder_type_redux.svg',
      'locales': 'folder_type_locale.svg',
      'locale': 'folder_type_locale.svg',
      'i18n': 'folder_type_locale.svg',
      'views': 'folder_type_view.svg',
      'view': 'folder_type_view.svg',
      'logs': 'folder_type_log.svg',
      'log': 'folder_type_log.svg',
      'tmp': 'folder_type_temp.svg',
      'temp': 'folder_type_temp.svg',
      'database': 'folder_type_db.svg',
      'db': 'folder_type_db.svg',
      'migrations': 'folder_type_db.svg',
      'migration': 'folder_type_db.svg',
    };
    const icon = folderMap[lower];
    if (icon) return chrome.runtime.getURL('icons/file-icons/' + icon);
    return chrome.runtime.getURL('icons/file-icons/default_folder.svg');
  }

  // Special full filenames first
  const fullNameMap = {
    'package.json': 'file_type_npm.svg',
    'package-lock.json': 'file_type_npm.svg',
    'yarn.lock': 'file_type_yarn.svg',
    'pnpm-lock.yaml': 'file_type_pnpm.svg',
    'bun.lockb': 'file_type_bun.svg',
    'tsconfig.json': 'file_type_tsconfig.svg',
    'jsconfig.json': 'file_type_jsconfig.svg',
    '.eslintrc': 'file_type_eslint.svg',
    '.eslintrc.js': 'file_type_eslint.svg',
    '.eslintrc.cjs': 'file_type_eslint.svg',
    '.eslintrc.json': 'file_type_eslint.svg',
    '.eslintrc.yaml': 'file_type_eslint.svg',
    '.eslintrc.yml': 'file_type_eslint.svg',
    'eslint.config.js': 'file_type_eslint.svg',
    'eslint.config.ts': 'file_type_eslint.svg',
    '.prettierrc': 'file_type_prettier.svg',
    '.prettierrc.js': 'file_type_prettier.svg',
    '.prettierrc.json': 'file_type_prettier.svg',
    '.prettierrc.yaml': 'file_type_prettier.svg',
    '.prettierrc.yml': 'file_type_prettier.svg',
    'prettier.config.js': 'file_type_prettier.svg',
    'prettier.config.ts': 'file_type_prettier.svg',
    'dockerfile': 'file_type_docker.svg',
    'docker-compose.yml': 'file_type_docker.svg',
    'docker-compose.yaml': 'file_type_docker.svg',
    '.dockerignore': 'file_type_docker.svg',
    '.gitignore': 'file_type_git.svg',
    '.gitattributes': 'file_type_git.svg',
    '.gitmodules': 'file_type_git.svg',
    '.env': 'file_type_dotenv.svg',
    '.env.local': 'file_type_dotenv.svg',
    '.env.example': 'file_type_dotenv.svg',
    '.env.development': 'file_type_dotenv.svg',
    '.env.production': 'file_type_dotenv.svg',
    '.env.test': 'file_type_dotenv.svg',
    'makefile': 'file_type_text.svg',
    'cmakelists.txt': 'file_type_cmake.svg',
    'readme.md': 'file_type_markdown.svg',
    'readme': 'file_type_markdown.svg',
    'license': 'file_type_license.svg',
    'license.md': 'file_type_license.svg',
    'license.txt': 'file_type_license.svg',
    'vite.config.js': 'file_type_vite.svg',
    'vite.config.ts': 'file_type_vite.svg',
    'vite.config.mts': 'file_type_vite.svg',
    'next.config.js': 'file_type_next.svg',
    'next.config.ts': 'file_type_next.svg',
    'next.config.mjs': 'file_type_next.svg',
    'nuxt.config.js': 'file_type_nuxt.svg',
    'nuxt.config.ts': 'file_type_nuxt.svg',
    'tailwind.config.js': 'file_type_tailwind.svg',
    'tailwind.config.ts': 'file_type_tailwind.svg',
    'tailwind.config.cjs': 'file_type_tailwind.svg',
    'webpack.config.js': 'file_type_webpack.svg',
    'webpack.config.ts': 'file_type_webpack.svg',
    'jest.config.js': 'file_type_jest.svg',
    'jest.config.ts': 'file_type_jest.svg',
    'jest.config.cjs': 'file_type_jest.svg',
    'vitest.config.js': 'file_type_vitest.svg',
    'vitest.config.ts': 'file_type_vitest.svg',
    'babel.config.js': 'file_type_babel.svg',
    'babel.config.json': 'file_type_babel.svg',
    '.babelrc': 'file_type_babel.svg',
    '.babelrc.js': 'file_type_babel.svg',
    'cargo.toml': 'file_type_cargo.svg',
    'cargo.lock': 'file_type_cargo.svg',
    'go.mod': 'file_type_go.svg',
    'go.sum': 'file_type_go.svg',
    'requirements.txt': 'file_type_python.svg',
    'pyproject.toml': 'file_type_python.svg',
    'setup.py': 'file_type_python.svg',
    'pipfile': 'file_type_python.svg',
    'gemfile': 'file_type_ruby.svg',
    'gemfile.lock': 'file_type_ruby.svg',
    'rakefile': 'file_type_ruby.svg',
    'pubspec.yaml': 'file_type_dartlang.svg',
    'pubspec.lock': 'file_type_dartlang.svg',
    'mix.exs': 'file_type_elixir.svg',
    'mix.lock': 'file_type_elixir.svg',
    '.travis.yml': 'file_type_travis.svg',
    '.travis.yaml': 'file_type_travis.svg',
    'vercel.json': 'file_type_vercel.svg',
    'netlify.toml': 'file_type_netlify.svg',
    'firebase.json': 'file_type_firebase.svg',
    '.firebaserc': 'file_type_firebase.svg',
    'angular.json': 'file_type_angular.svg',
    'angular-cli.json': 'file_type_angular.svg',
    'svelte.config.js': 'file_type_svelte.svg',
    'svelte.config.ts': 'file_type_svelte.svg',
    'astro.config.js': 'file_type_astro.svg',
    'astro.config.ts': 'file_type_astro.svg',
    'astro.config.mjs': 'file_type_astro.svg',
    'prisma': 'file_type_prisma.svg',
    '.nvmrc': 'file_type_node.svg',
    '.node-version': 'file_type_node.svg',
    'renovate.json': 'file_type_renovate.svg',
    'renovate.json5': 'file_type_renovate.svg',
    '.editorconfig': 'file_type_editorconfig.svg',
  };

  if (fullNameMap[lower]) {
    return chrome.runtime.getURL('icons/file-icons/' + fullNameMap[lower]);
  }

  // Extension mapping
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const extMap = {
    'js': 'file_type_js.svg',
    'mjs': 'file_type_js.svg',
    'cjs': 'file_type_js.svg',
    'jsx': 'file_type_reactjs.svg',
    'ts': 'file_type_typescript.svg',
    'mts': 'file_type_typescript.svg',
    'cts': 'file_type_typescript.svg',
    'tsx': 'file_type_reactts.svg',
    'py': 'file_type_python.svg',
    'pyw': 'file_type_python.svg',
    'pyi': 'file_type_python.svg',
    'ipynb': 'file_type_jupyter.svg',
    'rs': 'file_type_rust.svg',
    'go': 'file_type_go.svg',
    'java': 'file_type_java.svg',
    'class': 'file_type_java.svg',
    'jar': 'file_type_java.svg',
    'kt': 'file_type_kotlin.svg',
    'kts': 'file_type_kotlin.svg',
    'swift': 'file_type_swift.svg',
    'cs': 'file_type_csharp.svg',
    'cpp': 'file_type_cpp.svg',
    'cc': 'file_type_cpp.svg',
    'cxx': 'file_type_cpp.svg',
    'c': 'file_type_c.svg',
    'h': 'file_type_c.svg',
    'hpp': 'file_type_cpp.svg',
    'rb': 'file_type_ruby.svg',
    'php': 'file_type_php.svg',
    'html': 'file_type_html.svg',
    'htm': 'file_type_html.svg',
    'css': 'file_type_css.svg',
    'scss': 'file_type_scss.svg',
    'sass': 'file_type_sass.svg',
    'less': 'file_type_less.svg',
    'styl': 'file_type_stylus.svg',
    'vue': 'file_type_vue.svg',
    'svelte': 'file_type_svelte.svg',
    'astro': 'file_type_astro.svg',
    'json': 'file_type_json.svg',
    'json5': 'file_type_json.svg',
    'jsonc': 'file_type_json.svg',
    'yaml': 'file_type_yaml.svg',
    'yml': 'file_type_yaml.svg',
    'toml': 'file_type_toml.svg',
    'xml': 'file_type_xml.svg',
    'md': 'file_type_markdown.svg',
    'mdx': 'file_type_mdx.svg',
    'rst': 'file_type_markdown.svg',
    'txt': 'file_type_text.svg',
    'sql': 'file_type_sql.svg',
    'graphql': 'file_type_graphql.svg',
    'gql': 'file_type_graphql.svg',
    'sh': 'file_type_shell.svg',
    'bash': 'file_type_shell.svg',
    'zsh': 'file_type_shell.svg',
    'fish': 'file_type_shell.svg',
    'ps1': 'file_type_powershell.svg',
    'psm1': 'file_type_powershell.svg',
    'bat': 'file_type_bat.svg',
    'cmd': 'file_type_bat.svg',
    'lua': 'file_type_lua.svg',
    'r': 'file_type_r.svg',
    'scala': 'file_type_scala.svg',
    'ex': 'file_type_elixir.svg',
    'exs': 'file_type_elixir.svg',
    'erl': 'file_type_erlang.svg',
    'hs': 'file_type_haskell.svg',
    'dart': 'file_type_dartlang.svg',
    'nim': 'file_type_nim.svg',
    'zig': 'file_type_zig.svg',
    'jl': 'file_type_julia.svg',
    'tf': 'file_type_terraform.svg',
    'proto': 'file_type_protobuf.svg',
    'wasm': 'file_type_wasm.svg',
    'pdf': 'file_type_pdf.svg',
    'png': 'file_type_image.svg',
    'jpg': 'file_type_image.svg',
    'jpeg': 'file_type_image.svg',
    'gif': 'file_type_image.svg',
    'svg': 'file_type_svg.svg',
    'ico': 'file_type_image.svg',
    'webp': 'file_type_image.svg',
    'mp4': 'file_type_video.svg',
    'mov': 'file_type_video.svg',
    'mp3': 'file_type_audio.svg',
    'wav': 'file_type_audio.svg',
    'zip': 'file_type_zip.svg',
    'tar': 'file_type_zip.svg',
    'gz': 'file_type_zip.svg',
    'rar': 'file_type_zip.svg',
    'patch': 'file_type_patch.svg',
    'diff': 'file_type_patch.svg',
    'log': 'file_type_log.svg',
    'env': 'file_type_dotenv.svg',
    'pem': 'file_type_cert.svg',
    'crt': 'file_type_cert.svg',
    'key': 'file_type_key.svg',
  };

  if (ext && extMap[ext]) {
    return chrome.runtime.getURL('icons/file-icons/' + extMap[ext]);
  }

  return chrome.runtime.getURL('icons/file-icons/default_file.svg');
}

async function injectVSCodeFileIcons(owner, repo) {
  const isTreeLike = /\/[^/]+\/[^/]+(\/tree\/|\/?)$/.test(location.pathname)
    && !/\/blob\//.test(location.pathname);
  if (!isTreeLike) return;

  const tree = document.querySelector(
    'table[aria-labelledby="folders-and-files"], [role="grid"]'
  );
  if (!tree || tree.hasAttribute(VSICONS_ATTR)) return;
  tree.setAttribute(VSICONS_ATTR, 'true');

  console.log('[GH Health] Found tree:', tree.tagName, tree.className);

  const rows = Array.from(
    tree.querySelectorAll('tr, div[role="row"], [class*="TreeRow"], [class*="row"]')
  ).filter(row => !row.querySelector('th') && !row.getAttribute('role')?.includes('columnheader'));

  console.log('[GH Health] Found rows:', rows.length);

  rows.forEach(function (row) {
    if (row.hasAttribute('data-vsicon-row')) return;

    // Log the first row to understand structure
    if (!tree.hasAttribute('data-debug-logged')) {
      tree.setAttribute('data-debug-logged', 'true');
      console.log('[GH Health] First row HTML:', row.outerHTML.slice(0, 500));
    }

    const fileLink = row.querySelector('a[href*="/' + owner + '/' + repo + '/blob/"]');
    const folderLink = row.querySelector('a[href*="/' + owner + '/' + repo + '/tree/"]');
    const existingIcon =
      row.querySelector('svg.octicon-file-directory-fill') ||
      row.querySelector('svg.octicon-file-directory') ||
      row.querySelector('svg.octicon-file') ||
      row.querySelector('svg[class*="octicon"]') ||
      row.querySelector('svg[aria-hidden="true"]') ||
      row.querySelector('img[data-vsicon]');

    if (!existingIcon) return;
    if (!fileLink && !folderLink) return;

    const link = fileLink || folderLink;
    const isFolder = Boolean(folderLink);
    const href = link.getAttribute('href') || '';
    const hrefClean = href.split('?')[0].replace(/\/$/, '');
    const name = decodeURIComponent(hrefClean.split('/').pop() || '').trim();
    if (!name) return;

    const iconUrl = getVSCodeIconUrl(name, isFolder);

    const img = document.createElement('img');
    img.src = iconUrl;
    img.width = 16;
    img.height = 16;
    img.alt = '';
    img.setAttribute('data-vsicon', 'true');
    img.style.cssText = 'display:inline-block;vertical-align:middle;flex-shrink:0;margin-right:4px;';

    img.onerror = function () {
      img.src = chrome.runtime.getURL(
        isFolder ? 'icons/file-icons/default_folder.svg' : 'icons/file-icons/default_file.svg'
      );
      img.onerror = null;
    };

    existingIcon.replaceWith(img);
    row.setAttribute('data-vsicon-row', 'true');
  });
}

// â”€â”€ FEATURE 2: Open in Web IDE Button â”€â”€

async function injectOpenInWebIDE(owner, repo, _retries) {
  _retries = _retries || 0;
  if (document.querySelector('.gh-webide-wrap')) return;
  if (!/^\/[^/]+\/[^/]+(\/tree\/|$|\/$)/.test(location.pathname)) return;

  // Try multiple strategies to find the Code button
  let codeBtn = document.querySelector(
    '[data-testid="CodeButton"],' +
    'get-repo summary,' +
    '[data-action="click:get-repo#showPanel"]'
  );

  // Fallback: find a button/summary whose visible text contains "Code" in the repo action bar
  if (!codeBtn) {
    const candidates = document.querySelectorAll('button, summary, a.btn, a[class*="btn"]');
    for (const el of candidates) {
      const text = el.textContent.trim().replace(/\s+/g, ' ');
      if (/^(<>)?\s*Code\s*$/.test(text)) {
        // Make sure it's in the repo header area, not navigation
        const rect = el.getBoundingClientRect();
        if (rect.top > 100 && rect.top < 600) {
          codeBtn = el;
          break;
        }
      }
    }
  }

  // Find the right parent container to insert next to
  let parent = null;
  let insertRef = null;
  if (codeBtn) {
    // Walk up to find the flex container holding the action buttons
    insertRef = codeBtn.closest('react-partial, details, div.d-flex, div.BtnGroup, div') || codeBtn;
    parent = insertRef.parentNode;
  }

  // Fallback: look for the row containing branch selector + action buttons
  if (!parent) {
    const branchSelector = document.querySelector('[data-hotkey="w"], #branch-select-menu, .branch-select-menu, react-branch-filter-ref');
    if (branchSelector) {
      const row = branchSelector.closest('.d-flex, .file-navigation, div[class*="react-code-view"]');
      if (row) {
        parent = row;
        insertRef = null;
      }
    }
  }

  // Retry up to 5 times with increasing delay if we can't find the insertion point
  if (!parent) {
    if (_retries < 5) {
      setTimeout(() => injectOpenInWebIDE(owner, repo, _retries + 1), 500 * (_retries + 1));
    }
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'gh-webide-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gh-webide-btn btn';
  btn.innerHTML = 'Open in Web IDE <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="10" height="10" fill="currentColor" style="margin-left:4px"><path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/></svg>';

  const dropdown = document.createElement('div');
  dropdown.className = 'gh-webide-dropdown';

  const options = [
    { label: 'CodeSandbox', icon: '<svg width="16" height="16" viewBox="0 0 256 296" fill="none"><path d="M115.498 261.088v-106.61L23.814 101.73v60.773l41.996 24.347v45.7l49.688 28.538zm23.814.627l50.605-29.072V185.99l42.269-24.495v-60.011l-92.874 53.09v106.82zm80.66-180.46l-48.817-28.289-42.863 24.872-43.188-24.897-49.252 28.667 91.914 52.882 92.206-53.235zM0 222.212V74.495L127.987 0 256 74.182v147.797l-128.013 73.744L0 222.212z" fill="currentColor"/></svg>', url: () => `https://codesandbox.io/p/github/${owner}/${repo}` },
    { label: 'GitHub1s', icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>', url: () => `https://github1s.com/${owner}/${repo}` },
    { label: 'Replit', icon: '<svg width="16" height="16" viewBox="0 0 32 32" fill="none"><path d="M7 5.5C7 4.67 7.67 4 8.5 4h15c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-15C7.67 14 7 13.33 7 12.5v-7zm0 14C7 18.67 7.67 18 8.5 18h15c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-15C7.67 28 7 27.33 7 26.5v-7z" fill="#F26522"/><path d="M7 12.5C7 11.67 7.67 11 8.5 11H16v10H8.5C7.67 21 7 20.33 7 19.5v-7z" fill="#F26522"/></svg>', url: () => `https://replit.com/github/${owner}/${repo}` },
    { label: 'Gitpod', icon: '<svg width="16" height="16" viewBox="0 0 32 32" fill="none"><path d="M18.92 2.72l-9.84 17.07h4.62l-1.78 9.49L21.76 12.2h-4.62l1.78-9.48z" fill="#FFAE33"/><path d="M18.92 2.72l-9.84 17.07h4.62l-1.78 9.49L21.76 12.2h-4.62l1.78-9.48z" fill="#FFAE33"/></svg>', url: () => `https://gitpod.io/#https://github.com/${owner}/${repo}` },
    { label: 'StackBlitz', icon: '<svg width="16" height="16" viewBox="0 0 28 28" fill="none"><path d="M12.747 16.273h-7.46L18.925 1.5l-3.672 10.227h7.46L9.075 26.5l3.672-10.227z" fill="#1389FD"/></svg>', url: () => `https://stackblitz.com/github/${owner}/${repo}` },
    { type: 'divider' },
    { label: 'Clone in VSCode', icon: '<svg width="16" height="16" viewBox="0 0 100 100" fill="none"><mask id="a" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><path d="M70.911 99.069a6.04 6.04 0 004.191-.638l19.735-9.47a6.04 6.04 0 003.163-5.304V16.343a6.04 6.04 0 00-3.163-5.303L75.102 1.569a6.04 6.04 0 00-6.882 1.04L29.395 38.22 12.21 25.543a4.028 4.028 0 00-5.145.263L2.289 30.2a4.03 4.03 0 00-.003 5.996L16.675 50 2.286 63.804a4.032 4.032 0 00.003 5.996l4.776 4.395a4.028 4.028 0 005.145.263l17.186-12.676 38.824 35.612a6.02 6.02 0 002.691 1.695zM75.015 27.241L45.109 50l29.906 22.76V27.24z" fill="#fff"/></mask><g mask="url(#a)"><path d="M96.837 10.911L75.097 1.568a6.04 6.04 0 00-6.887 1.04L2.286 63.804a4.03 4.03 0 00.003 5.996l4.776 4.395a4.027 4.027 0 005.145.263L96.574 15.69a6.04 6.04 0 00.263-4.779z" fill="#0065A9"/><g filter="url(#b)"><path d="M96.837 89.089L75.097 98.43a6.04 6.04 0 01-6.887-1.04L2.286 36.196a4.031 4.031 0 01.003-5.996l4.776-4.395a4.027 4.027 0 015.145-.262l84.364 58.768a6.04 6.04 0 01.263 4.778z" fill="#007ACC"/></g><g filter="url(#c)"><path d="M75.097 98.432a6.04 6.04 0 01-6.887-1.04c2.299 2.3 6.204.672 6.204-2.584V5.192c0-3.256-3.905-4.884-6.204-2.584a6.04 6.04 0 016.887-1.04l19.735 9.471A6.04 6.04 0 0198 16.343v67.314a6.04 6.04 0 01-3.168 5.304L75.097 98.432z" fill="#1F9CF0"/></g></g></svg>', url: () => `vscode://vscode.git/clone?url=${encodeURIComponent('https://github.com/' + owner + '/' + repo + '.git')}` },
    { label: 'Clone in Cursor', icon: '<svg width="16" height="16" viewBox="0 0 100 100" fill="none"><rect width="100" height="100" rx="20" fill="#000"/><path d="M30 70V30l40 20-40 20z" fill="#fff"/></svg>', url: () => `cursor://vscode.git/clone?url=${encodeURIComponent('https://github.com/' + owner + '/' + repo + '.git')}` },
    { label: 'Clone in Windsurf', icon: '<svg width="16" height="16" viewBox="0 0 32 32" fill="none"><path d="M16 3C8.82 3 3 8.82 3 16s5.82 13 13 13 13-5.82 13-13S23.18 3 16 3zm-2 18.5l-5-5 1.41-1.41L14 18.67l7.59-7.59L23 12.5l-9 9z" fill="#0EA5E9"/></svg>', url: () => `windsurf://vscode.git/clone?url=${encodeURIComponent('https://github.com/' + owner + '/' + repo + '.git')}` }
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
  if (insertRef && insertRef.nextSibling) {
    parent.insertBefore(wrap, insertRef.nextSibling);
  } else {
    parent.appendChild(wrap);
  }
}

// â”€â”€ FEATURE 3: Lines of Code in Sidebar â”€â”€

var LOC_LANGUAGE_COLORS = {
  'JavaScript': '#f7df1e',
  'TypeScript': '#3178c6',
  'Python': '#3572a5',
  'Rust': '#dea584',
  'Go': '#00add8',
  'Java': '#b07219',
  'C': '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  'Ruby': '#701516',
  'PHP': '#4f5d95',
  'Swift': '#f05138',
  'Kotlin': '#a97bff',
  'HTML': '#e34c26',
  'CSS': '#563d7c',
  'Shell': '#89e051',
  'Vue': '#41b883',
  'Svelte': '#ff3e00',
  'Markdown': '#083fa1',
  'YAML': '#cb171e',
  'JSON': '#292929'
};

var LOC_EXT_TO_LANG = {
  '.rs': 'Rust', '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.ts': 'TypeScript', '.mts': 'TypeScript', '.py': 'Python', '.go': 'Go',
  '.java': 'Java', '.c': 'C', '.h': 'C', '.cpp': 'C++', '.cc': 'C++',
  '.cxx': 'C++', '.hpp': 'C++', '.cs': 'C#', '.rb': 'Ruby', '.php': 'PHP',
  '.swift': 'Swift', '.kt': 'Kotlin', '.kts': 'Kotlin', '.html': 'HTML',
  '.htm': 'HTML', '.css': 'CSS', '.sh': 'Shell', '.bash': 'Shell',
  '.vue': 'Vue', '.svelte': 'Svelte', '.md': 'Markdown', '.mdx': 'Markdown',
  '.yaml': 'YAML', '.yml': 'YAML', '.json': 'JSON'
};

function getLanguageColor(name) {
  if (LOC_LANGUAGE_COLORS[name]) return LOC_LANGUAGE_COLORS[name];
  var langName = LOC_EXT_TO_LANG[name] || LOC_EXT_TO_LANG['.' + name.replace(/^\./, '')];
  if (langName && LOC_LANGUAGE_COLORS[langName]) return LOC_LANGUAGE_COLORS[langName];
  return '#8b949e';
}

var locModalData = null;

async function injectLOCInSidebar(owner, repo) {
  if (!/^\/[^/]+\/[^/]+\/?$/.test(location.pathname)) {
    console.log('[GH-LOC] skipped: not a repo root page', location.pathname);
    return;
  }

  // Find the About/sidebar section using multiple strategies
  var sidebar = document.querySelector('.Layout-sidebar') ||
                document.querySelector('[data-testid="repo-sidebar"]') ||
                document.querySelector('aside[aria-label]');

  // If no sidebar found, look for the About heading or forks/stars links and walk up
  if (!sidebar) {
    var aboutHeading = document.querySelector('h2.h4.mb-3');
    if (!aboutHeading) {
      // Try finding any heading that says "About"
      var allH2 = document.querySelectorAll('h2');
      for (var i = 0; i < allH2.length; i++) {
        if (allH2[i].textContent.trim() === 'About') {
          aboutHeading = allH2[i];
          break;
        }
      }
    }
    if (aboutHeading) {
      sidebar = aboutHeading.closest('div.Layout-sidebar, aside, [class*="sidebar"], [class*="Sidebar"]') ||
                aboutHeading.parentElement;
    }
  }

  // Try finding sidebar from stars/forks links
  if (!sidebar) {
    var statLink = document.querySelector('a[href$="/stargazers"]') ||
                   document.querySelector('a[href$="/forks"]') ||
                   document.querySelector('a[href$="/watchers"]');
    if (statLink) {
      sidebar = statLink.closest('div.Layout-sidebar, aside, [class*="sidebar"], [class*="Sidebar"]') ||
                statLink.parentElement?.parentElement?.parentElement;
    }
  }

  console.log('[GH-LOC] sidebar found:', !!sidebar, sidebar?.tagName, sidebar?.className?.substring(0, 80));

  if (!sidebar || sidebar.hasAttribute('data-loc-sidebar-done')) return;
  sidebar.setAttribute('data-loc-sidebar-done', 'true');

  // Create the LOC item as a list item to match stars/watching/forks format
  var locRow = document.createElement('li');
  locRow.className = 'gh-loc-stat-row d-inline';
  locRow.style.cursor = 'pointer';
  locRow.innerHTML =
    '<a class="Link Link--muted" style="cursor:pointer">' +
    '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" class="octicon mr-1" style="vertical-align:text-bottom">' +
    '<path d="m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.44 8.53a.75.75 0 0 1 0-1.06Z"/>' +
    '</svg>' +
    '<span class="gh-loc-stat-number">...</span> lines of code' +
    '</a>';

  // Find the stats UL (contains stars/watching/forks)
  var forkLink = sidebar.querySelector('a[href$="/forks"]') ||
                 sidebar.querySelector('a[href$="/network/members"]') ||
                 document.querySelector('a[href$="/forks"]');
  var statsUl = null;

  console.log('[GH-LOC] forkLink found:', !!forkLink, forkLink?.href);

  if (forkLink) {
    // Walk up to find the UL that contains the stats
    statsUl = forkLink.closest('ul');
    if (!statsUl) {
      // Maybe it's in an li, go up further
      var li = forkLink.closest('li');
      if (li) statsUl = li.parentElement;
    }
    console.log('[GH-LOC] statsUl from forkLink:', !!statsUl, statsUl?.tagName, statsUl?.className?.substring(0, 80));
  }

  if (!statsUl) {
    var starLink = sidebar.querySelector('a[href$="/stargazers"]') ||
                   document.querySelector('a[href$="/stargazers"]');
    if (starLink) {
      statsUl = starLink.closest('ul');
      if (!statsUl) {
        var li2 = starLink.closest('li');
        if (li2) statsUl = li2.parentElement;
      }
    }
  }

  if (statsUl && statsUl.tagName === 'UL') {
    statsUl.appendChild(locRow);
    console.log('[GH-LOC] appended to stats UL:', statsUl.className?.substring(0, 80));
  } else {
    // Fallback: try inserting after the forks link parent
    var fallbackParent = forkLink ? (forkLink.closest('.d-flex') || forkLink.parentElement?.parentElement) : null;
    if (fallbackParent) {
      fallbackParent.insertAdjacentElement('afterend', locRow);
      console.log('[GH-LOC] inserted after fallback parent');
    } else {
      sidebar.appendChild(locRow);
      console.log('[GH-LOC] appended to sidebar');
    }
  }

  locRow.addEventListener('click', function () {
    openLOCModal(owner, repo, locModalData);
  });

  var response = await sendMessage({ type: 'GET_LOC_FULL', payload: { owner: owner, repo: repo } }).catch(function (err) { console.log('[GH-LOC] API error:', err); return null; });
  var data = response && response.data;
  console.log('[GH-LOC] API response:', !!data, data ? data.total : 'no data');

  var numSpan = locRow.querySelector('.gh-loc-stat-number');
  if (!data || !data.total) {
    console.log('[GH-LOC] no LOC data available');
    numSpan.textContent = 'N/A';
  } else {
    locModalData = data;
    numSpan.textContent = data.total.toLocaleString();
  }
}

function openLOCModal(owner, repo, data) {
  var existing = document.getElementById('gh-loc-modal-backdrop');
  if (existing) {
    existing.style.display = 'flex';
    if (data) {
      populateLOCModal(existing.querySelector('.gh-loc-modal'), owner, repo, data);
    }
    return;
  }

  var backdrop = document.createElement('div');
  backdrop.id = 'gh-loc-modal-backdrop';
  backdrop.className = 'gh-loc-modal-backdrop';

  var modal = document.createElement('div');
  modal.className = 'gh-loc-modal';
  modal.id = 'gh-loc-modal';

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', function (e) {
    if (e.target === backdrop) {
      backdrop.style.display = 'none';
    }
  });

  function onKeyDown(e) {
    if (e.key === 'Escape' && backdrop.style.display !== 'none') {
      backdrop.style.display = 'none';
    }
  }
  document.addEventListener('keydown', onKeyDown);

  if (data) {
    populateLOCModal(modal, owner, repo, data);
  } else {
    modal.innerHTML = '';
    var header = buildLOCModalHeader(owner, repo, backdrop);
    modal.appendChild(header);
    var loading = document.createElement('div');
    loading.className = 'gh-loc-loading';
    loading.innerHTML = '<div class="gh-loc-spinner"></div><span>Loading lines of code\u2026</span>';
    modal.appendChild(loading);

    sendMessage({ type: 'GET_LOC_FULL', payload: { owner: owner, repo: repo } }).then(function (response) {
      var d = response && response.data;
      if (d) {
        locModalData = d;
        populateLOCModal(modal, owner, repo, d);
      } else {
        loading.innerHTML = '<span>Failed to load data.</span>';
      }
    }).catch(function () {
      loading.innerHTML = '<span>Failed to load data.</span>';
    });
  }

  modal.focus();
}

function buildLOCModalHeader(owner, repo, backdrop) {
  var header = document.createElement('div');
  header.className = 'gh-loc-modal-header';

  var title = document.createElement('span');
  title.className = 'gh-loc-modal-title';
  title.textContent = 'Lines of Code \u2014 ' + owner + '/' + repo;

  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gh-loc-modal-close';
  closeBtn.textContent = '\u00D7';
  closeBtn.addEventListener('click', function () {
    backdrop.style.display = 'none';
  });

  header.appendChild(title);
  header.appendChild(closeBtn);
  return header;
}

function populateLOCModal(modal, owner, repo, data) {
  modal.innerHTML = '';

  var backdrop = modal.closest('.gh-loc-modal-backdrop');

  modal.appendChild(buildLOCModalHeader(owner, repo, backdrop));

  var folderChecked = {};
  var langChecked = {};

  (data.folders || []).forEach(function (f) { folderChecked[f.name] = true; });
  (data.languages || []).forEach(function (l) { langChecked[l.language] = true; });

  var totalSection = document.createElement('div');
  totalSection.className = 'gh-loc-modal-total';

  var totalNumber = document.createElement('div');
  totalNumber.className = 'gh-loc-total-number';
  totalNumber.textContent = (data.total || 0).toLocaleString();

  var totalLabel = document.createElement('div');
  totalLabel.className = 'gh-loc-total-label';
  totalLabel.textContent = 'total lines of code';

  var totalSub = document.createElement('div');
  totalSub.className = 'gh-loc-total-sub';

  var folderTotalSpan = document.createElement('span');
  folderTotalSpan.textContent = computeFolderTotal(data.folders, folderChecked).toLocaleString() + ' lines across selected folders';

  var langTotalSpan = document.createElement('span');
  langTotalSpan.textContent = computeLangTotal(data.languages, langChecked).toLocaleString() + ' lines in selected languages';

  totalSub.appendChild(folderTotalSpan);
  totalSub.appendChild(langTotalSpan);

  totalSection.appendChild(totalNumber);
  totalSection.appendChild(totalLabel);
  totalSection.appendChild(totalSub);
  modal.appendChild(totalSection);

  function updateTotals() {
    var ft = computeFolderTotal(data.folders, folderChecked);
    var lt = computeLangTotal(data.languages, langChecked);
    folderTotalSpan.textContent = ft.toLocaleString() + ' lines across selected folders';
    langTotalSpan.textContent = lt.toLocaleString() + ' lines in selected languages';
    var estimated = Math.min(ft, lt);
    totalNumber.textContent = '~' + estimated.toLocaleString();
    totalLabel.textContent = 'lines (estimated)';
  }

  var body = document.createElement('div');
  body.className = 'gh-loc-modal-body';

  var folderCol = buildLOCColumn(data.folders || [], 'folder', folderChecked, updateTotals);
  var langCol = buildLOCColumn(data.languages || [], 'language', langChecked, updateTotals);

  body.appendChild(folderCol);
  body.appendChild(langCol);
  modal.appendChild(body);

  var footer = document.createElement('div');
  footer.className = 'gh-loc-modal-footer';

  var footerText = document.createElement('span');
  footerText.textContent = 'Data from GitHub Trees API and codetabs.com';

  var recalcBtn = document.createElement('button');
  recalcBtn.type = 'button';
  recalcBtn.className = 'gh-loc-sort-btn';
  recalcBtn.textContent = 'Recalculate';
  recalcBtn.addEventListener('click', function () {
    modal.innerHTML = '';
    modal.appendChild(buildLOCModalHeader(owner, repo, backdrop));
    var loading = document.createElement('div');
    loading.className = 'gh-loc-loading';
    loading.innerHTML = '<div class="gh-loc-spinner"></div><span>Recalculating\u2026</span>';
    modal.appendChild(loading);

    sendMessage({ type: 'GET_LOC_FULL', payload: { owner: owner, repo: repo, bypassCache: true } }).then(function (response) {
      var d = response && response.data;
      if (d) {
        locModalData = d;
        populateLOCModal(modal, owner, repo, d);
      } else {
        loading.innerHTML = '<span>Failed to load data.</span>';
      }
    }).catch(function () {
      loading.innerHTML = '<span>Failed to load data.</span>';
    });
  });

  footer.appendChild(footerText);
  footer.appendChild(recalcBtn);
  modal.appendChild(footer);
}

function computeFolderTotal(folders, checked) {
  if (!folders || !folders.length) return 0;
  return folders.reduce(function (sum, f) {
    return sum + (checked[f.name] ? (f.estimatedLOC || 0) : 0);
  }, 0);
}

function computeLangTotal(languages, checked) {
  if (!languages || !languages.length) return 0;
  return languages.reduce(function (sum, l) {
    return sum + (checked[l.language] ? (l.linesOfCode || 0) : 0);
  }, 0);
}

function buildLOCColumn(items, type, checkedMap, onUpdate) {
  var col = document.createElement('div');
  col.className = 'gh-loc-col';

  var colHeader = document.createElement('div');
  colHeader.className = 'gh-loc-col-header';
  colHeader.textContent = type === 'folder' ? 'Folders' : 'Languages';
  col.appendChild(colHeader);

  var search = document.createElement('input');
  search.type = 'text';
  search.className = 'gh-loc-search';
  search.placeholder = 'Filter ' + (type === 'folder' ? 'folders' : 'languages') + '\u2026';
  col.appendChild(search);

  var controls = document.createElement('div');
  controls.className = 'gh-loc-col-controls';

  var sortNameBtn = document.createElement('button');
  sortNameBtn.type = 'button';
  sortNameBtn.className = 'gh-loc-sort-btn';
  sortNameBtn.textContent = 'Name';

  var sortLocBtn = document.createElement('button');
  sortLocBtn.type = 'button';
  sortLocBtn.className = 'gh-loc-sort-btn is-active';
  sortLocBtn.textContent = 'Lines';

  var selectAllBtn = document.createElement('button');
  selectAllBtn.type = 'button';
  selectAllBtn.className = 'gh-loc-select-btn';
  selectAllBtn.textContent = 'Select all';

  var deselectAllBtn = document.createElement('button');
  deselectAllBtn.type = 'button';
  deselectAllBtn.className = 'gh-loc-select-btn';
  deselectAllBtn.textContent = 'Deselect all';

  controls.appendChild(sortNameBtn);
  controls.appendChild(sortLocBtn);
  controls.appendChild(selectAllBtn);
  controls.appendChild(deselectAllBtn);
  col.appendChild(controls);

  var list = document.createElement('div');
  list.className = 'gh-loc-list';
  col.appendChild(list);

  function getItemLoc(item) {
    return type === 'folder' ? (item.estimatedLOC || 0) : (item.linesOfCode || 0);
  }

  function getItemName(item) {
    return type === 'folder' ? item.name : item.language;
  }

  var currentSort = 'loc';
  var maxLoc = items.length > 0 ? Math.max.apply(null, items.map(getItemLoc)) : 1;

  function renderList() {
    while (list.firstChild) list.removeChild(list.firstChild);

    var query = search.value.trim().toLowerCase();
    var filtered = items.filter(function (item) {
      if (!query) return true;
      return getItemName(item).toLowerCase().indexOf(query) !== -1;
    });

    var sorted = filtered.slice();
    if (currentSort === 'name') {
      sorted.sort(function (a, b) { return getItemName(a).localeCompare(getItemName(b)); });
    } else {
      sorted.sort(function (a, b) { return getItemLoc(b) - getItemLoc(a); });
    }

    sorted.forEach(function (item) {
      var name = getItemName(item);
      var loc = getItemLoc(item);
      var pct = item.percentage || 0;
      var color = type === 'folder' ? '#2f81f7' : getLanguageColor(name);
      var barWidth = maxLoc > 0 ? Math.max(1, (loc / maxLoc) * 100) : 0;

      var row = document.createElement('div');
      row.className = 'gh-loc-row';

      var top = document.createElement('div');
      top.className = 'gh-loc-row-top';

      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'gh-loc-row-check';
      checkbox.checked = checkedMap[name] !== false;
      checkbox.addEventListener('change', function () {
        checkedMap[name] = checkbox.checked;
        onUpdate();
      });

      var nameSpan = document.createElement('span');
      nameSpan.className = 'gh-loc-row-name';
      nameSpan.textContent = name;

      var countSpan = document.createElement('span');
      countSpan.className = 'gh-loc-row-count';
      countSpan.textContent = loc.toLocaleString();

      var pctSpan = document.createElement('span');
      pctSpan.className = 'gh-loc-row-pct';
      pctSpan.textContent = pct.toFixed(1) + '%';

      top.appendChild(checkbox);
      top.appendChild(nameSpan);
      top.appendChild(countSpan);
      top.appendChild(pctSpan);

      var barTrack = document.createElement('div');
      barTrack.className = 'gh-loc-bar-track';

      var barFill = document.createElement('div');
      barFill.className = 'gh-loc-bar-fill';
      barFill.style.width = barWidth + '%';
      barFill.style.background = color;
      barTrack.appendChild(barFill);

      row.appendChild(top);
      row.appendChild(barTrack);
      list.appendChild(row);
    });

    if (sorted.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'gh-loc-loading';
      empty.style.padding = '12px';
      empty.textContent = items.length === 0 ? 'No data available' : 'No matches';
      list.appendChild(empty);
    }
  }

  search.addEventListener('input', renderList);

  sortNameBtn.addEventListener('click', function () {
    currentSort = 'name';
    sortNameBtn.classList.add('is-active');
    sortLocBtn.classList.remove('is-active');
    renderList();
  });

  sortLocBtn.addEventListener('click', function () {
    currentSort = 'loc';
    sortLocBtn.classList.add('is-active');
    sortNameBtn.classList.remove('is-active');
    renderList();
  });

  selectAllBtn.addEventListener('click', function () {
    items.forEach(function (item) { checkedMap[getItemName(item)] = true; });
    renderList();
    onUpdate();
  });

  deselectAllBtn.addEventListener('click', function () {
    items.forEach(function (item) { checkedMap[getItemName(item)] = false; });
    renderList();
    onUpdate();
  });

  renderList();
  return col;
}

// â”€â”€ FEATURE 4: Absolute Dates â”€â”€

let absDateObserver = null;

function formatAbsoluteDate(dateString) {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;

  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');

  return `${dd}/${mm}/${yy}, ${hh}:${min}`;
}

function convertAllTimestamps() {
  const selectors = [
    'relative-time[datetime]',
    'time-ago[datetime]',
    'local-time[datetime]'
  ];

  selectors.forEach(function (selector) {
    document.querySelectorAll(selector).forEach(function (el) {
      if (el.hasAttribute('data-abs-converted')) return;

      const datetime = el.getAttribute('datetime');
      if (!datetime) return;

      const formatted = formatAbsoluteDate(datetime);
      if (!formatted) return;

      el.setAttribute('data-abs-converted', 'true');

      const span = document.createElement('span');
      span.className = 'gh-abs-date-span';
      span.textContent = formatted;
      span.setAttribute('title', el.getAttribute('title') || datetime);

      el.insertAdjacentElement('afterend', span);
      el.setAttribute('data-abs-hidden', 'true');
    });
  });
}

function startAbsDateObserver() {
  if (absDateObserver) return;

  absDateObserver = new MutationObserver(function () {
    convertAllTimestamps();
  });

  absDateObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

async function injectAbsoluteDates() {
  convertAllTimestamps();
  startAbsDateObserver();
}

// â”€â”€ FEATURE 5: Health Score Sidebar Panel â”€â”€

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
      metricRow('âš¡ Velocity', data.velocityLabel || 'unknown') +
      metricRow('ðŸ‘¥ Bus Factor', data.busFactor || 'healthy') +
      metricRow('âš–ï¸ License', licenseDisplay) +
      metricRow('ðŸ·ï¸ Release', releaseDisplay) +
      (data.deps ? metricRow('ðŸ“¦ Deps', data.deps.riskLabel || 'unknown') : '') +
    '</div>' +
    '<div class="gh-health-sidebar-footer">' +
      'Last checked ' + timeAgoShort(data.scannedAt) +
      '<button class="gh-health-sidebar-refresh" type="button">â†»</button>' +
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
  document.querySelectorAll('.eg-download, .eg-repo-size, .js-file-clipboard, .js-file-download, .js-enhanced-github-copy-btn, .gh-md-print-btn, .gh-webide-wrap, .gh-loc-stat-row, .gh-loc-modal-backdrop, .gh-health-sidebar-panel, .gh-abs-date-span').forEach((node) => node.remove());
  document.querySelectorAll('[data-health-done], [data-bookmark-done], [data-md-print-done], [data-readme-print-done], [data-vsicons-done], [data-vsicon-row], [data-vsicon], [data-webide-done], [data-loc-sidebar-done], [data-health-panel-done], [data-abs-converted], [data-abs-hidden]').forEach((element) => {
    element.removeAttribute('data-health-done');
    element.removeAttribute('data-bookmark-done');
    element.removeAttribute('data-md-print-done');
    element.removeAttribute('data-readme-print-done');
    element.removeAttribute('data-vsicons-done');
    element.removeAttribute('data-vsicon-row');
    element.removeAttribute('data-vsicon');
    element.removeAttribute('data-webide-done');
    element.removeAttribute('data-loc-sidebar-done');
    element.removeAttribute('data-health-panel-done');
    element.removeAttribute('data-abs-converted');
    element.removeAttribute('data-abs-hidden');
  });

  if (typeof refreshSidebarData === 'function') {
    refreshSidebarData();
  }
}