# Bug-fix findings

## Date fields

Temu structured values arrive as strings such as `Aug 21, 2026, 12:01 am PKT` and `Aug 19, 2026, 4:35 am PKT(UTC+5)`. The previous workbook wrote these strings unchanged, so Excel displayed the time and timezone. Both the content parser and workbook generator now normalize Shipping Date and Order Date to the calendar portion only, such as `Aug 21, 2026`.

## Quantity field

The previous workbook used the shared decimal style `0.00` for quantity, revenue, and shipping cost. Even when the underlying quantity was one, Excel displayed `1.00`. Quantity now uses the integer number format `0`, while revenue and shipping cost retain the decimal style.

## Repeated retry errors

The background worker intentionally closes a detail tab after success or after scheduling a retry. The browser's `tabs.onRemoved` event could then be interpreted as an unexpected premature close, causing a false second failure and another retry. The worker now tracks intentional closes, ignores those removal events, verifies the order is still in-flight before processing a failure, and uses a new v3 checkpoint key so stale v2 retry state is not reused. The worker test simulates real removal callbacks and confirms that successful tab closure creates no false errors.

## Live signed-in DOM validation

The current signed-in session opened the requested bulk-shipping URL successfully. The live page reports 29 labels purchased and exposes 29 body rows using `data-testid="beast-core-table-body-tr"`. The table headers remain Order details, Package ID, Product, Weight, Packaging dimensions, Ship from, Shipping service, Total shipping cost, Tracking number, and Actions. Each row still exposes Print document followed by View details as role-button controls. The first live row remains PO-211-01861395087993272 / PK-3937132821381893074 with tracking 1Z16E50BYW50615076 and shipping cost $6.24. This confirms the bulk-page selectors used by the bug-fixed extension remain compatible with the live DOM.

## Live signed-in detail DOM validation

The first live detail page loaded successfully for PO-211-01861395087993272. The rendered labels and values are: Purchase date `Aug 19, 2026, 8:35 pm GMT(UTC+0)`, Recipient name `Larry Northcutt`, Product `Callaway Golf Supersoft Golf Balls Blue Splatter Balls (Sleeve)`, Quantity `1 shipped`, Shipment confirmed at `Aug 20, 2026, 4:16 pm GMT`, Tracking number `1Z16E50BYW50615076`, Estimated revenue `$16.02`, and Est. total shipping cost `$6.24`. The live DOM matches the parser's label fallbacks and confirms that the date-only normalization must strip the time and timezone while retaining the calendar portion.

The read-only live console check confirmed `/order-detail.html`, one structured order in `window.rawData.store.orderList`, a populated `localPackageInfoList`, and the presence of Tracking number, Estimated revenue, and Est. total shipping cost labels. The live values for Purchase date and Shipment confirmed at include time text exactly as reported, confirming the date-only fix is required at export and parser layers.

## Retry session fix

The worker previously added the `_x_sessn_id` query parameter only on the first attempt. The live page URL uses this session identifier, so later retry URLs could lose the seller session and repeatedly open the no-auth page. Version 2.0.1 now preserves `_x_sessn_id` on every attempt. The worker regression test explicitly verifies that generated detail URLs retain the live session identifier.

## Multi-product live check

The reported order URL loaded in the signed-in browser but returned an empty `Order contents` table with `No data` in this session, so it cannot be used as a live fixture. The user-provided detail screenshot clearly shows two product rows in one order: Callaway Supersoft Stars & Stripes Golf Balls and TaylorMade Blue Ink SpeedSoft Golf Balls. The implementation must therefore support an arbitrary product-line array instead of assuming `orderList[0]`.

## Multi-product and tab-cleanup release

Option B is now implemented. Every entry in Temu's structured `orderList` becomes a separate workbook row. Shared order-level values repeat on each row; product title, quantity, revenue, and allocated package shipping cost remain line-specific. Product titles are normalized by removing trailing parenthetical, curly-brace, and square-bracket groups repeatedly, so examples such as `(2026)`, `(USA)`, `{Sleeve}`, and `(Special)` are removed.

The max-tabs issue was caused by the service worker losing its in-memory `activeTabs` map while persistent `inFlight` state still existed. Detail result and error messages now restore entries from persistent state. Timeout callbacks do the same. Startup recovery queries Temu detail tabs, keeps only tabs still tracked by a running batch, and closes orphan tabs; intentional close events are ignored by the retry handler. A new v4 checkpoint namespace prevents old single-product v3 state from being reused.

## Speed optimization

Version 2.2.0 raises bounded detail-tab concurrency from two to four. The readiness loop now polls structured data every 50 ms and caches the parsed bootstrap store so the same large script is not reparsed repeatedly. The worker writes the in-flight checkpoint before navigating each tab, validates that every required field exists for every product row, checkpoints the complete product-record payload, and only then closes the detail tab. Stop/Clear waits for pending launches and closes tracked plus orphan extension tabs.

## Strict two-tab rollback

The user reported that the four-tab release left more than 20 Temu detail tabs open. Version 2.3.0 limits concurrency to two and serializes queue-pump calls so a success/error callback cannot start a second pump while the first pump is still launching items. `handleSuccess` and `handleFailure` await the tab removal before calling `pump`, so the next order is opened only after the previous detail tab is closed.

Cleanup now recognizes both current hash-based exporter URLs and legacy referral-parameter detail URLs. Startup, a new batch, and Stop/Clear close all untracked exporter detail tabs, while tracked paused/running tabs are preserved. The v6 checkpoint namespace prevents the previous four-tab v5 state from being reused.

## Revenue and shipping source inspection

The provided URL opened in the signed-in browser but this particular session returned `No data` in the order contents and did not expose usable live values in the DOM snapshot. The supplied screenshot confirms the required source locations: total `Estimated revenue` is in the upper-right `Sales proceeds` card, while `Est. total shipping cost` is in the lower-left package section. The multi-product row proceeds are visible in the order-content table under the `Proceeds` column and should be preferred for individual product revenue; the upper-right amount is the order-level fallback/validation total.

## Highlighted spreadsheet pattern

The wide screenshot was inspected in left-to-right tiles. The highlighted duplicate order repeats Tracking Number, Order No, Customer Name, Product Details, and Qty on both rows. The first highlighted row carries the order-level money values; the second highlighted row leaves the money cells empty. The two product titles remain separate rows, confirming the requested first-row-only Estimated Revenue and Shipping Cost placement.

## First-row-only money placement

The highlighted screenshot confirms that multi-product rows repeat order and product details, while only the first row carries the order-level Estimated Revenue and package Shipping Cost. Version 2.4.0 now uses `parentOrderMap.estimatedIncomeTotal` for the top-right Sales proceeds total and sums package `interlineInfoForAggregationInfo[].estimatedAmount` for the bottom-left package shipping total. Subsequent product rows intentionally contain blank money cells, and the XLSX writer emits true blank cells rather than empty strings so later manual merging works correctly.

## Premium ZHunter-inspired UI

Version 2.6.0 adds a separate local UI layer without touching the extraction checkpoint. The panel uses a dark navy/cyan neon palette, glass-grid texture, glowing toolbar buttons, animated status orbit, collapsible floating mode, Settings drawer, and Sheet history drawer. Settings and history are stored under separate local keys. History is capped at 20 sessions and contains only locally serialized records/error metadata for regenerating a workbook; Delete and Clear all history never affect the active extraction queue.
