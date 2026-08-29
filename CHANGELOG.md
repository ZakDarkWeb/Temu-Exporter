# Changelog

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
