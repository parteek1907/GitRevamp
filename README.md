# 🔧 GitRevamp — Supercharge Your GitHub Experience

<div align="center">

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Available-4285F4?style=flat-square&logo=google-chrome&logoColor=white)](https://chrome.google.com/webstore)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/parteek1907/gitrevamp?style=flat-square&color=gold)](https://github.com/parteek1907/gitrevamp/stargazers)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/parteek1907/gitrevamp/pulls)

**GitRevamp is a powerful Chrome extension that transforms your GitHub workflow — adding health scores, VS Code-style file icons, lines of code insights, web IDE access, and 15+ developer tools directly into GitHub's UI.**

[Install](#-installation) · [Features](#-features) · [Screenshots](#-screenshots) · [Tech Stack](#-tech-stack) · [Contributing](#-contributing)

</div>

---

## 📌 What is GitRevamp?

GitHub is powerful — but it doesn't tell you everything. GitRevamp fills the gaps:

- Is this repo actively maintained? → **Health Score Badge**
- How many lines of code? → **LOC in Sidebar**
- Who owns most of the codebase? → **Bus Factor Warning**
- What's the PR complexity before reviewing? → **PR Complexity Score**
- Open it in VS Code instantly? → **Web IDE Button**

GitRevamp injects these insights directly into GitHub pages — no tab-switching, no copy-pasting URLs, no manual analysis.

---

## ✨ Features

### 🏥 Repository Health
| Feature | Description |
|---------|-------------|
| **Health Score Badge** | Scores every repo 0–10 based on activity, maintenance, and popularity. Shows inline on repo pages, search results, and trending. |
| **Health Sidebar Panel** | Full breakdown panel in the About section — activity score, maintenance score, popularity score with visual bars. |
| **Watchlist** | Track repos and get alerted when their health score drops by 1.0+. |
| **Bus Factor Warning** | Warns when a single contributor owns >60% of commits — single point of failure risk. |
| **License Risk Warning** | Flags unlicensed repos and copyleft licenses (GPL, AGPL) that may affect commercial use. |

### 📊 Code Insights
| Feature | Description |
|---------|-------------|
| **LOC in Sidebar** | Shows total lines of code in the About section. Click to open a full breakdown modal — folder-wise and language-wise with interactive checkboxes and color bars. |
| **Star History Sparkline** | Shows a mini star growth chart below the star count with monthly growth estimate. |
| **Commit Quality Indicators** | Marks commits as ✅ good or ⚠️ poor based on conventional commit format. Shows summary score on commit listing pages. |
| **PR Complexity Score** | Classifies pull requests as Simple / Moderate / Large / Massive based on files changed and lines modified. |

### 🎨 Visual Enhancements
| Feature | Description |
|---------|-------------|
| **VS Code File Icons** | Replaces GitHub's default file icons with VS Code Material Icon Theme-style icons — 80+ file types and 40+ named folders supported. |
| **Absolute Dates** | Shows exact dates (DD/MM/YY, HH:MM) alongside GitHub's relative timestamps ("3 days ago"). |
| **Issue Age Heatmap** | Color-codes issues by age: New / Recent / Aging / Old / Stale. |
| **TODO Highlights** | Highlights TODO, FIXME, HACK, BUG, DEPRECATED annotations in source files with colored pills. |

### ⚡ Workflow Tools
| Feature | Description |
|---------|-------------|
| **Web IDE Button** | One-click access to CodeSandbox, GitHub1s, Replit, Gitpod, StackBlitz, VS Code, Cursor, or Windsurf. |
| **Quick Clone Button** | Instantly copy SSH, HTTPS, or GitHub CLI clone commands with your preferred format saved. |
| **File Sizes & Download** | Shows file sizes in the tree view. Adds Copy and Download buttons on file pages. |
| **Markdown Printer** | Adds a Print button to README and markdown file pages for clean rendered output. |
| **README Table of Contents** | Auto-generates a floating TOC panel on README pages with active heading tracking. |
| **Contribution Insights** | Adds current streak, longest streak, most active day, and best day stats below the contribution graph on profile pages. |

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
cd gitrevamp

# 2. Open Chrome and go to
chrome://extensions/

# 3. Enable "Developer mode" (top right toggle)

# 4. Click "Load unpacked" and select the gitrevamp folder

# 5. Visit any GitHub repo — you're done!
```

---

## ⚙️ Configuration

On first install, GitRevamp walks you through a quick onboarding:

1. **Step 1** — Optionally add a GitHub Personal Access Token (PAT) for higher API rate limits (5,000 calls/hour vs 60/hour unauthenticated)
2. **Step 2** — Enable or disable individual features to match your workflow

All settings are accessible anytime via the extension popup → **Settings tab**.

### GitHub PAT (Optional but Recommended)
A PAT increases your API rate limit significantly. To generate one:
1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Generate a token with **public_repo** scope (read-only is fine)
3. Paste it in GitRevamp Settings

---

## 🖥️ Screenshots

> *Screenshots coming soon — install the extension to see it in action!*

| Feature | Preview |
|---------|---------|
| Health Score Badge | Inline score on every repo |
| LOC Modal | Folder + language breakdown |
| VS Code Icons | Material icons in file tree |
| Web IDE Dropdown | One-click IDE access |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Platform** | Chrome Extension — Manifest V3 |
| **Language** | Vanilla JavaScript (zero dependencies) |
| **APIs** | GitHub REST API v3, codetabs.com LOC API, OSV.dev CVE API, npmjs Registry |
| **Storage** | `chrome.storage.local` |
| **Icons** | VS Code Material Icon Theme (SVG, locally bundled) |
| **Build** | No build step — pure MV3 service worker + content script |

> No React, Vue, webpack, or npm packages. The entire extension is plain JavaScript running directly in the browser.

---

## 📁 Project Structure

```
gitrevamp/
├── manifest.json              # MV3 extension manifest
├── background.js              # Service worker — API calls, scoring, caching
├── content.js                 # Content script — DOM injection, all features
├── style.css                  # Injected styles for all UI components
├── popup.html                 # Extension popup
├── popup.js                   # Popup logic — overview, watchlist, compare, settings
├── popup.css                  # Popup styles
├── onboarding.html            # First-run onboarding page
├── markdown-printer-style.css # Print styles for markdown pages
└── icons/
    ├── icon16.png
    ├── icon48.png
    ├── icon128.png
    └── file-icons/            # 100+ VS Code Material Icon SVGs
```

---

## 🔌 Permissions Explained

| Permission | Why It's Needed |
|-----------|----------------|
| `storage` | Save settings, watchlist, bookmarks, and cached health data locally |
| `activeTab` | Read the current GitHub tab URL to detect repo context |
| `tabs` | Send messages between popup and content script |
| `alarms` | Schedule periodic watchlist health checks |
| `https://api.github.com/*` | Fetch repo metadata, contributors, commit stats |
| `https://raw.githubusercontent.com/*` | Read package.json for dependency analysis |
| `https://registry.npmjs.org/*` | Check npm package staleness |
| `https://api.osv.dev/*` | Check for known CVEs in dependencies |
| `https://api.codetabs.com/*` | Fetch lines of code statistics |

GitRevamp **never** sends your data to any external server. All processing happens locally in your browser.

---

## 🤝 Contributing

Contributions are welcome! Whether it's a bug fix, new feature, or documentation improvement.

```bash
# Fork and clone
git clone https://github.com/parteek1907/gitrevamp.git

# Create a feature branch
git checkout -b feature/your-feature-name

# Make your changes, then load unpacked in Chrome to test

# Submit a pull request
```

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting.

---

## 🗺️ Roadmap

- [ ] Similar repositories suggestions
- [ ] Isometric contribution graph
- [ ] GitZip — download folders as ZIP
- [ ] Notification grouping in popup
- [ ] Firefox support (MV2 port)
- [ ] Chrome Web Store publish

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 👤 Author

**Parteek Garg**

---

<div align="center">

**If GitRevamp saves you time, please ⭐ star the repo — it helps others discover it!**

</div>