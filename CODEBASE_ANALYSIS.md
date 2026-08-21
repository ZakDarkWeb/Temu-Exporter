# Temu Order Exporter Codebase Analysis and UI Upgrade Plan

## Runtime structure

| File | Runtime role | Current behavior | UI-upgrade boundary |
|---|---|---|---|
| `manifest.json` | Manifest V3 entrypoint | Loads `worker.js` as the service worker and injects `content.css`, `xlsx.js`, then `content.js` on `seller.temu.com/*`. | Update release metadata only; keep permissions and host scope unchanged. |
| `worker.js` | Background orchestration | Maintains checkpoint state, opens at most two inactive detail tabs, retries failures up to three times with exponential backoff, preserves `_x_sessn_id`, closes tabs after checkpointing, and recovers orphan tabs. | Do not touch queue, retry, tab, or checkpoint logic for a visual-only release. |
| `content.js` | Page integration, parser, and panel controller | Creates the bulk-page panel, captures bulk rows, requests state, handles start/pause/stop/download, stores UI preferences and history, extracts structured `window.rawData.store` data, and falls back to DOM labels. | Keep extraction and message contracts unchanged. Improve only panel state classes, visual metadata, and UI interaction feedback if needed. |
| `xlsx.js` | Native workbook generator | Builds a ZIP/XML XLSX in memory with Orders and Extraction Status sheets, frozen panes, filters, an Excel table, green headers, numeric quantity/money cells, and date-only strings. | Leave export logic unchanged. |
| `content.css` | Scoped panel stylesheet | Provides dark navy/cyan neon styling, card layout, status orbit, progress bar, metric tiles, action buttons, drawers, minimized mode, responsive layout, and reduced-motion rules. | Primary upgrade surface: consolidate tokens, refine buttons, add enter/hover/press/focus micro-interactions, and preserve GPU-friendly transitions. |
| `ui_preview.html` | Static visual fixture | Renders the expanded running-state panel against a dark background using `content.css`; it is intentionally not runtime logic and currently omits drawers. | Extend preview with settings/history open-state fixtures for before/after screenshots. |

## Functional flow

The bulk page is detected by `location.pathname === '/buy-shipping-bulk-details.html'`. On that page, `content.js` loads the UI preference and history keys, creates the panel, then requests the worker checkpoint. `startJob()` captures rendered table rows and sends `TEMU_START_JOB`. The worker creates inactive detail tabs and adds a metadata hash so the detail content script can identify the order. The detail page waits for `window.rawData.store.orderList`, parses one record per product, validates required fields, and sends either `TEMU_DETAIL_RESULT` or `TEMU_DETAIL_ERROR`. The worker checkpoints successful records before intentionally closing the tab and advances the queue only after close confirmation. The source panel receives `TEMU_STATE_UPDATE` messages and updates status, progress, metrics, and logs.

Structured extraction is the primary path. It maps `parentOrderMap`, `shippingInfo`, `orderList`, `localPackageInfoList`, and `interlineInfoForAggregationInfo`; `parseDetailRecordsFromDom()` is the fallback for rendered labels such as `Purchase date`, `Recipient name`, `Estimated revenue`, and `Est. total shipping cost`. Dates are normalized to date-only strings, product titles remove trailing variation groups, and order-level revenue/shipping values are placed only on the first product row.

## Existing UI state model

The UI preference key is `temuOrderExporterUiV1` and stores `minimized`, `motion`, and `saveHistory`. The history key is `temuOrderExporterHistoryV1` and stores at most 20 serialized completed sessions. The panel has independent Settings and Sheet history drawers, and the minimize state is applied through `is-minimized`. The extraction checkpoint remains under `temuOrderExporterStateV7`, which is deliberately separate from UI state.

## Performance and safety assessment

The codebase has a clean separation between runtime extraction and presentation. `content.css` is injected on all seller pages, but all selectors are scoped to the exporter panel ID or class names. The main UI update path changes text, attributes, and one progress-bar width; it does not perform layout-heavy polling. The detail wait loop polls for structured data only on detail pages and is unrelated to UI rendering. The XLSX generator is invoked only when the user downloads a workbook.

The safest animation strategy is therefore to use short `opacity` and `transform` transitions, avoid JavaScript animation loops, keep the existing 50 ms extraction polling unchanged, and disable animations through both the existing Settings toggle and `prefers-reduced-motion`. Permanent `will-change` declarations should be avoided; containment may be used on the panel to limit style/layout scope. Visual effects must remain pseudo-element gradients and shadows rather than image assets or additional libraries.

## Upgrade decisions

The UI release will keep the current dark navy/cyan neon brand direction and improve hierarchy rather than replace it. Buttons will use a shared tokenized treatment with consistent height, padding, radius, focus ring, hover lift, active press, and disabled states. Metrics and history rows will receive restrained hover feedback. The panel and drawers will use short enter/exit transitions based on `opacity` and `transform`, while the running status orbit remains the only continuous animation. The preview will include expanded, settings-drawer, history-drawer, and minimized states so the final report can show a meaningful before/after comparison.

## Before/after visual record

The preserved v2.6.0 preview is available as `ui_preview_before.html` and was rendered at `/home/ubuntu/screenshots/page_2026-08-21_06-52-50_6541.webp`. It showed the original expanded neon panel with the core controls but no interactive drawer content in the preview surface. The upgraded `ui_preview.html` rendered at `/home/ubuntu/screenshots/page_2026-08-21_06-52-58_8549.webp`; it keeps the same compact dark-neon footprint while adding a clearer professional preview label, explicit Settings and Sheet history surfaces, consistent toolbar/action controls, polished hover-ready button treatment, and an interactive minimize control. The screenshots are visual QA artifacts rather than runtime dependencies.

Interactive browser verification confirmed the Settings drawer opens with animated overlay and both toggles visible. The drawers are intentionally mutually exclusive; while Settings is open, its overlay captures interaction, so the user closes it before opening Sheet history. This matches the runtime `closeDrawers()`/`toggleDrawer()` design and avoids stacked drawer states.

The Sheet history drawer opened successfully after Settings was closed. The browser preview showed two session rows with order/row/error summaries, Download and Delete controls for each row, and a bottom Clear all history button, all inside the same dark-neon card surface.

The upgraded preview minimized successfully into a compact branded `TO` floating card at the bottom-right. The header/body collapsed, toolbar icons were hidden except for the `+` expand control, and the panel remained readable and visually consistent with the neon theme. Screenshot artifact: `/home/ubuntu/screenshots/page_2026-08-21_06-53-56_8190.webp`.
