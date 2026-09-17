# Changelog

## 5.4.1 — 2026-09-09

### Added & Fixed
- **Interactive Speed Quick-Pill on Floating Card**: Added 1-click speed mode cycling button (`[⚡ Balanced]` ➔ `[🚀 Turbo]` ➔ `[🛡️ Safe]`) directly on the main card status area for instant switching without opening drawers.
- **Auto-Paginate Quick-Pill on Floating Card**: Added 1-click toggle (`[📄 All Pages: ON]` / `[📄 1 Page: OFF]`) right under the progress bar.
- **Progress Line Truncation Fix**: Eliminated long concatenated sentence that was getting clipped into `... 0 wa... 0%`. Replaced with concise dynamic status messages (`Extracting 12/50 · 2 tabs`, `Ready to start`).
- **Live Page Order Detection**: When Temu loads the bulk shipping table, the floating card immediately detects and displays the number of order packages ready for extraction.
- **Workspace Favicon**: Added explicit `<link rel="icon">` in `tools.html` so Chrome tab bar displays the glowing emblem instead of a generic blank globe.
- **Workspace Dashboard 4-Column Layout**: Converted wide 2-column metrics into a sleek 4-column responsive SaaS row (`repeat(4, 1fr)`), eliminating empty void space.
- **Workspace 4-Button Inline Toolbar**: Replaced giant full-width vertical stacked buttons with a balanced inline action toolbar (`Resume`, `Download`, `Retry`, `Stop`).
- **Observability Empty State**: Upgraded empty diagnostics log from bare text to a styled card with subtle glowing indicators and clean typography.

## 5.4.0 — 2026-09-09

### Added & Improved (UI/UX & Aesthetics Overhaul)
- **Draggable Expanded Card (Header Drag Handle)**: The card can now be dragged by its header to any position on the Temu seller page. Position is persisted across sessions in `uiPrefs`. Double-clicking the header instantly resets position to bottom-right.
- **Circular Progress Ring on Minimized FAB**: When minimized, the 56px circular FAB displays an animated SVG circular gauge around the avatar that dynamically fills from 0% to 100% as orders are extracted, accompanied by a status badge (`45%`, `✓`, or `!Errors`).
- **Frosted Cyber Glassmorphism**: Added `backdrop-filter: blur(20px) saturate(180%)`, deep obsidian background, and a luminous cyber-cyan rotating border glow.
- **Crisp High-Contrast Icons (Toolbar & Extension)**: Generated crisp 16x16, 32x32, 48x48, and 128x128 icons with transparent negative space and a glowing neon cyan contour, ensuring 100% clarity and zero square box artifacting on dark and light Chrome toolbars.
- **Enhanced Activity Console**: Added category badge tags (`[SCRAPE]`, `[WORKER]`, `[EXCEL]`, `[CONFIG]`, `[SUCCESS]`, `[WARN]`, `[ERROR]`), plus 1-click **"Copy Logs"** and **"Clear"** buttons.
- **Modern Tabbed Workspace Dashboard (`tools.html`)**: Re-architected the Tools page into an intuitive tabbed navigation system featuring:
  - 📊 **Dashboard & Live Batch**: Extraction monitor, progress metrics, and diagnostics.
  - 🔍 **Universal Search**: Multi-field order & tracking lookup.
  - 📁 **Saved Sheets**: Historical archive with 1-click Excel download and delete.
  - 📐 **Columns**: Excel column selector and ordering.
  - ⚙️ **Settings & Speed**: Speed profiles, daily reminder, and automations.

## 5.3.0 — 2026-09-09

### Added
- **Auto-Pagination (Multi-page bulk scraping)**: Automated detection and navigation across multi-page order tables on `/buy-shipping-bulk-details.html`, accumulating all orders into one unified export batch.
- **Tab Pooling & Tab Recycling Engine**: Replaces constant tab creation and destruction with a managed, persistent worker tab pool. Re-uses tabs for consecutive orders, reducing Chrome RAM usage by ~70% and eliminating tab-creation CPU churn.
- **Global Order & Tracking Search**: Universal instant search engine in the Workspace (`tools.html`) allowing sellers to search across all historical export runs by Order ID, Tracking Number, Customer Name, SKU ID, or Goods ID, with 1-click copy support.
- **Speed & Safety Profiles**:
  - `🛡️ Stealth (Safe Mode)`: 1 concurrent tab with humanized randomized pacing delays (1.4s–2.6s) to prevent Temu bot detection and verification alerts.
  - `⚡ Balanced (Default)`: 2 concurrent tabs with dynamic latency-based pacing.
  - `🚀 Turbo (Fast)`: 3–4 concurrent tabs for high-throughput batch processing.
  - Switchable from both the in-page Floating Card and Workspace settings.
- **Repository & Extension Cleanup**: Eliminated nested duplicate directory, unused graphic design mockups, and temporary helper scripts for a lean, production-ready extension package.

## 5.2.1 — 2026-08-29

### Fixed
- **Severe slowdown on detail tabs (regression in 5.2.0).** The new readiness check read `document.body.textContent`, which includes Temu's multi-megabyte inline `window.rawData` script, and the MutationObserver re-scanned all scripts on every DOM change. Each detail tab was doing megabytes of string work many times per second. Now: the observer path only checks the structured store (script scan cached by script count, throttled to 250 ms); the rendered-text check uses `innerText` and runs once per second as a fallback only.

## 5.2.0 — 2026-08-29

### Fixed
- **ETA was always "~0s left".** The start timestamp lived on a local field that every state broadcast overwrote. ETA now derives from `runId` (the run's start time), which survives broadcasts.
- **Adaptive-speed log lines never appeared.** The worker used `runtime.sendMessage`, which cannot reach content scripts, and no page handled `TEMU_LOG`. Logs are now routed to the source tab and rendered in the card.
- **Warning log lines rendered unstyled.** `log(..., 'warning')` didn't match the `warn` CSS/icon key; `warning` is now accepted as an alias.
- **Pausing consumed retry attempts.** Each interrupted in-flight tab was charged an attempt; three pauses on one order made it permanently fail. Pause now refunds the attempt.
- **Adaptive concurrency reset on every service-worker sleep.** Speed level, sample history and cooldown are persisted in `chrome.storage.session`.
- **Service-worker recovery timeouts no longer drop concurrency** (they are not a signal about Temu's response time).
- **Start / Retry errors were silent** (unhandled promise rejections). Both buttons now run through a guarded control runner that logs errors to the card and prevents double-clicks.
- **Retry ignored `ok: false` responses** from the worker.
- **Version drift.** Card footer and Tools header read the version from the manifest instead of hard-coded strings.
- **Stale copy** ("Two tabs" / "two background detail tabs") updated for adaptive concurrency.
- **History save failures were swallowed silently.** Storage errors are now logged; `unlimitedStorage` is requested so 20 saved runs cannot exceed the 10 MB local quota.
- **Automations drawer accessibility.** Focusable toggles inside an `aria-hidden` container replaced with the `inert` attribute.

### Changed
- **Scheduled Auto-Run renamed to Daily Reminder** with honest copy. Temu requires an order selection in Manage Orders before the bulk page has data, so the schedule opens the page and shows the card; it does not (and cannot) start an export by itself.
- **Detail-page readiness detection** replaced the 50 ms `innerText` poll (which forced a full layout reflow 20×/s for up to 30 s) with a `MutationObserver` plus a 300 ms `textContent` fallback. Recipient-name scanning also uses `textContent`.
- **Content scripts only inject on the two pages they serve** (bulk-shipping and order-detail) instead of every `seller.temu.com` page; `content.css` and `xlsx.js` no longer load in detail tabs.
- **Excel dates are real date cells** (`yyyy-mm-dd` number format) so Excel can sort and filter them. Unparseable dates fall back to text.
- **Non-dollar currencies (€, £) are kept as text** instead of being stripped to a bare number.
- **Column selection is validated** against the known column list on download (guards against stale storage values).
- Google Fonts request removed from the Tools page (extension pages should not make external requests; also failed offline). System font stack is used, with Inter if installed locally.
- `options_ui` added so the Tools page is reachable from `chrome://extensions`; `minimum_chrome_version` set; store description rewritten.
- Web `Notification.requestPermission()` prompt removed from Tools — the worker uses `chrome.notifications`, which is granted by the manifest.

### Internal
- New `constants.js`: single source of truth for storage keys, paths, column lists, message types and pure helpers (`normalize`, `dateOnly`, `moneyNumber`, `missingRequiredFields`). Previously duplicated across three files.
- Temu's hashed CSS-module class names are isolated in one `SELECTORS` map in `content.js`. When a primary selector misses and a fallback is used, a parser note is attached to the record so the map can be updated.
- Removed ~120 lines of dead code (settings/history drawers whose DOM no longer exists, `allocateMoney`, unused icons, duplicated helpers).
- `icon_source.jpg` moved out of the shipped package into `design/`.

### Not done in this pass (recommended next)
- Split `records` out of the single state blob so each commit doesn't rewrite the entire record set.
- Read `window.rawData` via a `world: "MAIN"` script instead of parsing script text.
- Unit tests for the parsers against saved Temu HTML fixtures.
