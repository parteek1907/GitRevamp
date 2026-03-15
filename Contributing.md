# Contributing to GitRevamp

Thank you for considering contributing! Here's everything you need to get started.

---

## Development Setup

```bash
# 1. Fork and clone
git clone https://github.com/parteek1907/gitrevamp.git

# 2. Open Chrome → chrome://extensions/

# 3. Enable Developer Mode (top-right toggle)

# 4. Click "Load unpacked" → select the gitrevamp folder

# 5. After any code change, click the refresh icon on the extension card
#    Then refresh the GitHub tab to see content script changes
```

### Test on these pages
- `github.com/facebook/react` — main repo page (health panel, LOC, icons)
- `github.com/facebook/react/blob/main/README.md` — file page (markdown printer, download)
- `github.com/trending` — trending page (health scores)
- Any repo commit list — absolute dates

---

## Reporting Bugs

Before opening an issue, include:
- Chrome version and OS
- Steps to reproduce
- Expected vs actual behaviour
- Console errors (F12 → Console)
- Which GitHub page it happened on

---

## Pull Request Guidelines

1. **One feature or fix per PR** — keep changes focused
2. **Test before submitting** — list which pages you tested
3. **No new dependencies** — the extension must stay dependency-free
4. **No breaking changes** — all 9 existing features must still work

### PR title format
```
feat: add X
fix: Y not working on Z page
style: improve dark mode for health badge
docs: update install instructions
```

---

## Code Rules

- **No frameworks** — vanilla JS only
- **No npm packages** — zero runtime dependencies
- **All API calls in `background.js`** — content scripts never call APIs directly
- **Use CSS variables** — `var(--color-fg-default)` not hardcoded hex (for dark mode support)
- **Fail silently** — a broken feature should never break GitHub itself
- **Each feature needs a processed attribute** — e.g. `data-loc-done` to prevent double-injection

---

## Questions?

Open an issue with the `question` label.