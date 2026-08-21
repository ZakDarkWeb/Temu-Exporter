# Temu Order Exporter v2.7.0 — Feature and UI Upgrade Roadmap

## Executive assessment

The current extension has a strong extraction foundation. `worker.js` owns the queue and checkpoint, keeps strict two-tab concurrency, retries no-auth/network failures up to three times, preserves the Temu session identifier, and closes detail tabs deliberately. `content.js` separates bulk-page control from detail-page parsing, prefers `window.rawData.store`, falls back to rendered DOM labels, validates every product row, maintains local UI preferences/history, and renders the dark navy/cyan neon panel. `xlsx.js` creates the requested workbook locally without a third-party runtime dependency.

The main opportunity is not to redesign the extraction engine. It is to add a second, lightweight **control surface** around it: a small Chrome popup for status and quick actions, a clearer extraction pipeline in the in-page card, a better failure-recovery workflow, and a few quality-of-life features for large batches. These can be added without changing the core tab queue or increasing host permissions.

> **Recommendation:** keep the current in-page panel as the live operations console and add the popup as a compact command center for status, resume, pause, download, history, and diagnostics.

## Current architecture and upgrade boundaries

| Area | Current state | Strength | Limitation or opportunity |
|---|---|---|---|
| Manifest | MV3, `worker.js` service worker, `content.css`, `xlsx.js`, and `content.js` injected on `seller.temu.com/*`. No `default_popup` is configured. | Minimal permissions and clear runtime entrypoints. | Browser action icon currently has no command center. |
| In-page UI | Fixed 372px dark neon card on the bulk page with status, progress, metrics, actions, activity log, Settings, History, and minimize mode. | Excellent live visibility while the seller works on the bulk page. | It is not available from other Temu pages or the browser toolbar. |
| Worker | Strict `MAX_CONCURRENCY = 2`, `MAX_ATTEMPTS = 3`, exponential backoff, checkpoint state, orphan cleanup, and serialized pump. | Accuracy and tab safety are prioritized correctly. | No first-class “retry failed only,” per-order diagnostics, or batch naming. |
| Bulk capture | Reads rendered `tr[data-testid="beast-core-table-body-tr"]` rows from the current page. | Fast and deterministic for the loaded table. | Virtualized tables, pagination, filters, or unrendered rows may require a deliberate page-scan feature. |
| Detail parser | Structured bootstrap first, DOM fallback second; multi-product validation and title cleanup are present. | Resilient to normal React rendering changes. | Parser observability could show which path was used and which fields were fallback-derived. |
| Export | Native local XLSX with fixed nine-column schema, numeric cells, frozen header, filter, table, and error sheet. | No external library or upload path. | No export profile, filename template, or “retry failed and append” workflow. |
| Local history | Last 20 serialized sessions under a separate storage key with Download again, Delete, and Clear all. | Convenient and privacy-preserving. | Large sessions can consume `chrome.storage.local`; IndexedDB would scale better for long-term history. |
| Popup | Not present. | No extra popup complexity today. | Add a small read-only/command popup instead of duplicating the entire panel. |

## Highest-value new features

### 1. Popup Command Center — highest priority

Add `popup.html`, `popup.css`, and `popup.js`, then set `action.default_popup` in `manifest.json`. The popup should be approximately 360 × 460 pixels and use the existing dark navy/cyan design language. It should not duplicate the full activity log or extraction parser. Instead, it should read the current checkpoint and local UI/history keys and provide fast actions.

| Popup section | Proposed content | Why it matters |
|---|---|---|
| Header | `TO` logo, “Temu Order Exporter,” connection badge, current version | Gives immediate confidence that the extension is available and identifies the active state. |
| Batch status | Ready, Running, Paused, Complete, or Error; source order count; product rows; active tabs; retry count | Lets the user check the batch from any seller page. |
| Progress | Compact progress bar with `37 / 71` and percentage | Keeps the popup useful without opening the bulk page. |
| Quick actions | Open bulk page, Start/Resume, Pause, Stop/Clear, Download Excel | Makes the browser toolbar a real command center. |
| Recovery card | Failed-order count and `Retry failed` button | Converts the current error sheet from a passive report into an actionable workflow. |
| Recent history | Two or three latest sessions with Download again | Provides quick access without opening the in-page drawer. |
| Footer | Local-only badge, Settings shortcut, Help/README link | Reinforces privacy and discoverability. |

The popup should use the existing message contracts where possible. `TEMU_GET_STATE`, `TEMU_PAUSE_JOB`, and `TEMU_STOP_JOB` already exist. A small `TEMU_RETRY_FAILED` message and a worker-side `retryQueue` rebuild would be the only new extraction-facing contract required for the first popup release.

### 2. Retry failed orders only — high priority

After a batch completes with errors, the user should be able to retry only the failed rows rather than restarting all orders. The worker can rebuild `retryQueue` from `state.errors`, clear or retain previous error records by policy, and preserve the original source URL and session ID. The UI should show a confirmation summary such as “Retry 3 failed orders” and maintain attempt counts. This is safer and faster than reprocessing successful orders.

### 3. Extraction pipeline visualization — high priority

Replace the current status-only mental model with a compact three-stage pipeline:

> **Capture rows → Read detail tabs → Build XLSX**

Each stage can have `idle`, `active`, `complete`, and `error` states. The pipeline should use CSS transforms and opacity only. During processing, a small cyan pulse can move across the active stage; on completion, a short checkmark animation can replace the pulse. Error states should pulse once rather than loop indefinitely.

### 4. Better diagnostics — high priority

Add a diagnostics drawer or popup section that shows, per failed order, the order number, package ID, attempt count, failure category, and suggested action. Failure categories can be normalized to `No auth`, `Network/timeout`, `Incomplete fields`, `Unexpected route`, or `Tab closed`. A “Copy diagnostics” action can copy a safe text summary without uploading order data. The detail parser can optionally report `structured` versus `dom-fallback` source in internal metadata, while keeping the workbook schema unchanged.

### 5. Batch naming and export filename templates — medium priority

Allow a user-defined batch label such as `Amazon Restock — Aug 21` and use it in the workbook filename and history card. This is a local preference and does not touch extraction accuracy. A safe default remains `temu-orders-YYYY-MM-DD.xlsx`.

### 6. Selected-order and pagination support — medium/high priority, requires live DOM validation

The current bulk capture reads rendered rows. A future mode could offer `Current rendered rows`, `Selected rows`, or `Scan all pagination`. This should not be implemented from assumptions because Temu's table virtualization and pagination behavior must be inspected in a signed-in browser session. The implementation should capture stable order/package identifiers, deduplicate them, and show a preview count before opening detail tabs.

### 7. Scalable history storage — medium priority

Keep the current 20-session UI, but move large serialized records from `chrome.storage.local` to IndexedDB. Store only metadata and a record pointer in the UI history key. This prevents large multi-product sessions from approaching storage limits and allows future search/filtering by date, order number, or batch name.

## Popup visual concept

The popup should feel like a smaller companion to the in-page card, not a second unrelated product. The visual hierarchy should be:

1. **Header identity:** cyan `TO` monogram, title, and a small `Local-only` status pill.
2. **Primary status card:** large status word, one-line detail, and a glowing progress bar.
3. **Four compact metrics:** orders, product rows, active tabs, and errors.
4. **One primary action:** context-aware Start, Resume, or View active batch.
5. **Secondary action row:** Pause, Download, and Stop/Clear.
6. **Recovery/history cards:** only shown when there are errors or saved sessions.

The popup should have a fixed maximum height and a scrollable lower region so it remains quick to open. The in-page card stays responsible for the activity log because a popup disappears when it loses focus.

## Animation system

The current CSS already uses panel-scoped selectors, reduced-motion support, and transform/opacity-first transitions. The next animation layer should extend those principles rather than introduce a JavaScript animation library.

| Interaction | Animation | Duration | Performance rule |
|---|---|---:|---|
| Popup open | Fade in plus 4px upward translate | 180–220 ms | Animate `opacity` and `transform` only. |
| Status change | Status chip crossfade and 1px scale settle | 160 ms | Trigger only on actual status changes, not every state message. |
| Progress update | Existing bar transition plus a low-opacity moving highlight | 350–450 ms | Do not animate layout width of the entire card. |
| Metric update | One-time number scale from `.96` to `1` | 160 ms | Add a class only when the value changes. |
| Button hover | 1–2px lift, shadow change, icon micro-scale | 160–180 ms | No blur-heavy continuous effect. |
| Button press | `.985` scale and reduced shadow | 90–120 ms | Immediate feedback. |
| Drawer open | Opacity plus translate/scale | 200–240 ms | Keep the drawer within the existing panel. |
| Completion | One-time cyan-to-teal glow and checkmark | 500–700 ms | No permanent celebration loop. |
| Error | One short red pulse on the error metric/card | 350–450 ms | Avoid flashing or infinite animation. |
| Minimize | Width/height transition with body fade/scale | 280–350 ms | Preserve the current compact `TO` control. |

All animation classes should be disabled by the existing Motion Effects setting and `@media (prefers-reduced-motion: reduce)`. The UI should not use canvas, SVG particle systems, or repeated `requestAnimationFrame` loops for these effects.

## Additional practical features

| Feature | Priority | Notes |
|---|---:|---|
| Current Temu page detector in popup | High | Show `Bulk page detected`, `Detail page`, or `Open the bulk page`. |
| Open bulk page shortcut | High | Opens the configured path without requiring the user to find it manually. |
| Retry failed only | High | Best immediate productivity improvement after popup. |
| Copy diagnostics | High | Helps report parser/network failures while keeping data local. |
| Batch labels | Medium | Improves history and filenames. |
| Export profile presets | Medium | Useful only after fixed schema needs are stable. |
| Dark/light theme toggle | Low | Current dark neon theme is a strong brand; light mode adds maintenance cost. |
| Notifications | Medium/optional | Could notify on completion, but would require the `notifications` permission and should be opt-in. |
| Auto-open workbook folder | Low | Browser security and platform differences make this unreliable. |
| Concurrency slider | Low/not recommended initially | The current strict two-tab policy was chosen after tab accumulation issues; keep it fixed until adaptive safety is proven. |
| Cloud sync | Not recommended | Conflicts with the current local-only privacy model and would require new permissions and infrastructure. |

## Recommended release plan

### v2.8 — Command center and recovery

Implemented in v2.8.0: the popup, page detector, status/progress view, quick actions, recent history summary, Retry failed only, and the three-stage in-page/popup pipeline are now available. The worker invariants remain preserved, and focused popup and retry queue fixtures pass.

### v2.9 — Workflow intelligence

After a fresh signed-in DOM inspection, add selected-order mode, deduplication, optional pagination scanning, batch labels, export filename templates, and a diagnostics drawer. These features should be validated against the actual current Temu table rather than inferred from old fixtures.

### v3.0 — Scale and polish

Move large history payloads to IndexedDB, add searchable history and error filters, add optional completion notifications, and expand the visual system with one-time completion/error animations. Keep the no-upload model and strict tab lifecycle as non-negotiable constraints.

## What should not change

The following are already the strongest parts of the extension and should remain stable: structured-data-first parsing, DOM fallback, validation before tab closure, first-row-only order-level money placement, strict two-tab concurrency, session-preserving retries, orphan-tab cleanup, native local XLSX generation, and local-only data handling.

## Proposed next step

The safest next implementation is **v2.9 Workflow Intelligence**: selected-order mode, stable identifier deduplication, optional pagination scanning after a fresh signed-in DOM inspection, batch labels, export filename templates, and a diagnostics drawer. The current v2.8 release intentionally leaves pagination and DOM virtualization unchanged because those behaviors require live Temu validation before they can be implemented safely.
