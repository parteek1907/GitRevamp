# 🔧 GitRevamp — Supercharge Your GitHub Experience

<div align="center">

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Available-4285F4?style=flat-square&logo=google-chrome&logoColor=white)](https://chrome.google.com/webstore)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/parteek1907/gitrevamp?style=flat-square&color=gold)](https://github.com/parteek1907/gitrevamp/stargazers)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/parteek1907/gitrevamp/pulls)

**GitRevamp is a Chrome extension that enhances GitHub with 9 developer tools — health scoring, VS Code-style file icons, lines of code stats, and more — injected directly into GitHub's UI.**

[Install](#-installation) · [Features](#-features) · [Contributing](#-contributing)

</div>

---

## ✨ Features

### 🏥 Health & Risk
| Feature | Description |
|---------|-------------|
| **Health Sidebar Panel** | Scores every repo 0–10 based on activity, maintenance, and popularity. Full breakdown shown in the About section with visual bars. |
| **Bus Factor Warning** | Warns when a single contributor owns >60% of commits — a key sustainability risk signal. |
| **License Risk Warning** | Flags repos with no license or copyleft licenses (GPL, AGPL) that may affect commercial use. |

### 📊 Code Insights
| Feature | Description |
|---------|-------------|
| **LOC in Sidebar** | Shows total lines of code in the About section. Click to open a full breakdown modal — language-wise and folder-wise with interactive filters. |

### 🎨 Visual Enhancements
| Feature | Description |
|---------|-------------|
| **VS Code Icons** | Replaces GitHub's default file icons with VS Code Material Icon Theme-style SVG icons — 80+ file types and 40+ named folders. |
| **Absolute Dates** | Shows exact timestamps (DD/MM/YY, HH:MM) alongside GitHub's relative times like "3 days ago". |

### ⚡ Workflow Tools
| Feature | Description |
|---------|-------------|
| **Web IDE Button** | One-click access to CodeSandbox, GitHub1s, Replit, Gitpod, StackBlitz, or VS Code Desktop. |
| **File Sizes & Download** | Shows file sizes in the tree view. Adds Copy and Download buttons on file pages. |
| **Markdown Printer** | Adds a Print button to README and markdown file pages for clean rendered output. |

---

## 🚀 Installation

### From Chrome Web Store *(Recommended)*
1. Visit the [GitRevamp page on Chrome Web Store](https://chrome.google.com/webstore)
2. Click **Add to Chrome**
3. Open any GitHub repository — GitRevamp activates automatically

### Manual Installation (Developer Mode)
```bash
# 1. Clone the repository
git clone https://github.com/parteek1907/gitrevamp.git

# 2. Open Chrome and go to chrome://extensions/

# 3. Enable "Developer mode" (top-right toggle)

# 4. Click "Load unpacked" and select the gitrevamp folder

# 5. Visit any GitHub repo — done!
```

---

## ⚙️ Configuration

On first install, GitRevamp shows a quick onboarding screen where you can enable or disable each of the 9 features. All settings are accessible later via the extension popup → **Settings tab**.

### GitHub PAT (Optional but Recommended)
Adding a GitHub Personal Access Token upgrades your API rate limit from 60 to 5,000 requests/hour.

1. GitHub → Settings → Developer settings → Personal access tokens
2. Generate a token with **public_repo** scope
3. Paste it in GitRevamp Settings

---

## 🛠️ Tech Stack

| Layer | Details |
|-------|---------|
| **Platform** | Chrome Extension — Manifest V3 |
| **Language** | Vanilla JavaScript — zero external dependencies |
| **APIs** | GitHub REST API v3, codetabs.com (LOC), OSV.dev (CVE) |
| **Storage** | `chrome.storage.local` |
| **Icons** | VS Code Material Icon Theme SVGs, locally bundled |

---

## 📁 Project Structure

```
gitrevamp/
├── manifest.json                  # MV3 extension manifest
├── background.js                  # Service worker — all API calls, scoring, caching
├── background.ts                  # TypeScript source for background
├── content.js                     # Content script — DOM injection for all features
├── sidebar.js                     # Sidebar panel logic
├── style.css                      # Injected styles for all UI components
├── markdown-printer-style.css     # Print styles for markdown pages
│
├── popup.html                     # Extension popup markup
├── popup.js                       # Popup logic
├── popup.css                      # Popup styles
│
├── onboarding.html                # First-run setup page
├── onboarding.js                  # Onboarding logic (source)
├── onboarding.ts                  # TypeScript source for onboarding
├── onboarding.bundle.js           # Bundled onboarding script
├── onboarding.bundle.css          # Bundled onboarding styles
├── onboarding.css                 # Onboarding base styles
│
├── LICENSE
├── README.md
├── Contributing.md
│
└── icons/
    ├── icon16.png
    ├── icon48.png
    ├── icon128.png
    └── file-icons/                # VS Code Material Icon SVGs (80+ types)
```

---

## 🔌 Permissions

| Permission | Reason |
|-----------|--------|
| `storage` | Save settings and cached data locally |
| `activeTab` | Detect current GitHub page context |
| `tabs` | Communicate between popup and content script |
| `alarms` | Periodic background health checks |
| `https://api.github.com/*` | Repo metadata, contributors, commit stats |
| `https://api.codetabs.com/*` | Lines of code statistics |
| `https://api.osv.dev/*` | Known CVEs for dependency scanning |

GitRevamp **never** sends your data to any external server. All processing is local.

---

## 🤝 Contributing

```bash
git clone https://github.com/parteek1907/gitrevamp.git
git checkout -b feature/your-feature-name
# make changes, test in Chrome
# submit a pull request
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

**Built by [Parteek Garg](https://github.com/parteek1907)**

---

<div align="center">

**If GitRevamp saves you time, please ⭐ star the repo!**

</div>
