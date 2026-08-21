# Temu Order Exporter 2.6.0 — Upgrade Architecture

## Faster processing

The active bulk page will remain open. The extension will create a bounded number of background detail tabs, defaulting to two simultaneous tabs. Each tab opens one order-detail URL, reads the already-rendered `window.rawData` bootstrap object, sends the normalized product records to the background worker, and closes. The bootstrap store is cached within the tab and the readiness poll uses a short interval so extraction starts as soon as the complete payload is available. This removes the repeated bulk-page reload cycle while keeping Temu responsive and preventing an uncontrolled number of tabs.

The bulk page will send the captured row list to the worker. The worker owns the queue, the retry budget, the in-flight tab map, and the persistent checkpoint. The in-flight entry is checkpointed before navigation, and the complete validated product-record payload is checkpointed before the tab is closed. Queue advancement waits for the close promise, so the next detail tab cannot open until the previous tab has closed.

## No-auth and network recovery

A detail tab that reaches `/no-auth.html`, displays a no-internet/no-auth message, fails to render the order-detail bootstrap data, or times out is treated as a retryable error. The worker closes that tab, waits with exponential backoff, and retries the same row up to three times. Every retry preserves the current session query parameter and the original package/order identity. After the retry budget is exhausted, the worker records the row in an errors list and continues with the next order. The final workbook includes an `Extraction Status` worksheet listing such failures so no order is silently lost.

## Structured extraction first

The detail parser first reads `window.rawData.store`. It matches the package by `packageSn` and reads `sendTimeStr`, `trackingNumber`, and the shipping-label estimate from `interlineInfoForAggregationInfo[].estimatedAmount`. It reads the customer name from `shippingInfo.receiptName`, order number and date from `parentOrderMap`, product names and quantities from every entry in `orderList`, per-line revenue when available or allocates the order total by product basis, and package-level shipping cost by product/package group. Titles are cleaned by removing trailing variation/spec groups. It falls back to the existing label-based DOM parser, which also returns one row per product line, when structured data is unavailable. This is less sensitive to React re-rendering and text layout changes.

## Multi-product rows and tab cleanup

Every product in a multi-product order becomes its own row. Order No, customer, dates, tracking, Product Details, and Qty repeat across those rows. The top-right order-level Estimated revenue and the bottom-left package-level shipping cost are written only to the first product row; subsequent money cells remain blank for later merging. Every required field is validated for every product row before a result is accepted. The worker restores in-flight entries from persistent state when a service worker wakes, serializes pump calls, closes the detail tab after a successful checkpoint or failure, and on startup/new-batch/Stop-Clear closes current and legacy exporter detail tabs that do not belong to a running checkpoint.

## Excel workbook

The exporter creates a native `.xlsx` file locally with no external library or network call. The source mapping is explicit: structured `parentOrderMap.estimatedIncomeTotal`/top-right Sales proceeds supplies the first-row revenue total, while `interlineInfoForAggregationInfo[].estimatedAmount`/bottom-left package shipping cost supplies the first-row shipping total. The workbook has a styled green header with bold white text, frozen header row, autofilter, an Excel table, sensible column widths, and numeric cell types for `Qty (No)`, `Est. Revenue`, and `Shipping Cost`. The requested original column order is retained: `Shipping Date`, `Order Date`, `Tracking Number`, `Order No`, `Customer Name`, `Product Details`, `Qty (No)`, `Est. Revenue`, and `Shipping Cost`. This explains the example screenshot's visible Excel column B beginning with `Order Date`: the `Shipping Date` column can be column A just outside the crop.

A second worksheet named `Extraction Status` contains a timestamp, row identity, retry count, and error message for failed or incomplete rows. If there are no errors, the worksheet contains a short `Completed without extraction errors` note.

## Premium local UI state

The content script stores UI preferences under a separate local key: minimized state, motion effects, and the save-history toggle. Completed or manually downloaded sessions are serialized into a capped local history key containing the last 20 workbooks' records and error metadata. The Sheet history drawer can regenerate a workbook, delete one item, or clear all history without network access. History and settings are deliberately separate from the extraction checkpoint so UI changes cannot interrupt the worker queue. Version 2.9.0 keeps the CSS-only interaction polish and adds persisted warning diagnostics, focus-return/Escape drawer handling, popup overflow protection, and a three-stage Capture rows → Read details → Build XLSX pipeline. The worker uses serialized state commits, per-attempt tokens, cancellable timeout handles, persisted deadlines, and the MV3 alarms API as a wake-up path after service-worker suspension. A Manifest V3 Popup Command Center reads the same checkpoint and history keys, sends only small worker/content messages, and exposes Start/Resume, Pause, Download, Stop/Clear, Open bulk page, and Retry failed actions. Retry failed rebuilds the queue only from deduplicated error indexes, removes stale records for those keys, resets their attempt budgets, and keeps the same source URL/session identifier. Bulk capture uses header-aware indexes and duplicate suppression, while empty bulk pages provide an actionable Manage Orders explanation.


## Permissions and privacy

Manifest V3 uses local storage for checkpoints and a background service worker for tab coordination. The extension is limited to `https://seller.temu.com/*`, and it does not upload order data. The `tabs` capability is used only to create, monitor, and close the extension's own background detail tabs. The `alarms` permission is used only to schedule recovery wake-ups for persisted retry/deadline checkpoints.
