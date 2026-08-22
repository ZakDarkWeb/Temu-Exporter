# Temu Order Exporter v3.1.0

## Popup-free workflow

The unstable browser popup has been removed from the extension manifest and source package. Clicking the extension icon now opens the stable in-page card when the current tab is the Temu bulk-shipping page. When the current tab is another Temu Seller Center page, the action navigates that tab to the bulk-shipping page instead of opening a clipped popup.

## Compact extraction card

The in-page card is now the primary workflow surface. It intentionally keeps only the controls needed during extraction: Start/Resume, Download Excel, Pause, Stop/Clear, Retry failed, progress, order/product-row counts, active tabs, errors, activity status, and a single **Tools** button. The card width and height are bounded to remain compact and non-sticky while still being readable.

## History & Tools page

The new `tools.html` page opens in a separate browser tab from the card's Tools button. It contains local sheet history, per-sheet Download/Delete actions, Clear all history, current batch diagnostics, Retry failed, current workbook download, Stop and clear, Open bulk page, and Motion/History preferences. This keeps secondary features available without making the extraction card oversized.

## Stability and bug fixes

Repetitive logo/status/live-dot animations were disabled to remove the reported vibration effect. The card retains only deliberate hover and state transitions. Stale drawer references were removed from the main action path, and the extension action now uses a worker-controlled click handler rather than a popup document. Warning counts remain visible in History & Tools diagnostics while the compact card avoids unnecessary metric density.

## Validation

Manifest validation, JavaScript syntax, compact-card UI assertions, worker concurrency/recovery/alarm/retry tests, multi-product extraction, XLSX generation, current Temu fixture parsing, privacy checks, and release-package checks are required before publishing this version. No Temu customer, order, tracking, address, or session data is included in the source or release package.
