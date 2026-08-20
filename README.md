# Temu Order Tab Exporter v8.8.1

Temu Order Tab Exporter helps Temu sellers export order data to CSV, JSON, Excel, and Google Sheets. This release adds the primary **persistent bulk-label workflow**: select orders on the Unshipped tab, purchase labels using Temu’s own controls, move to Shipped, refresh the in-page card, and export the matched orders to Google Sheets.

## Installation

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted extension folder. After replacing an existing version, click **Reload** on the extension card.

## Primary workflow: Unshipped selection to Sheets

On Temu Seller Center → Manage Orders → **Unshipped**, select the orders that will be included in the bulk-label operation. You may also open **Shipped** and select additional rows directly; those rows are merged into the same durable selection rather than replacing the Unshipped selection. The in-page Temu Exporter card observes the selected order rows and saves their Order No, Package ID, and Tracking Number to `chrome.storage.local`. The selection therefore survives pagination and browser restarts.

Use Temu’s own interface to buy labels in bulk. The extension does not purchase labels or submit any account action. After the orders appear under **Shipped**, open that tab and click **Refresh Shipped** on the in-page card. Orders selected directly on Shipped are recognized immediately and can be exported without waiting for another refresh. The extension scans the visible Shipped pagination, matches the durable selection using Order No and, when available, Package ID and Tracking Number, and reports the matched and pending counts.

Click **Export to Sheets** after matching is complete. The extension opens each matched order-detail URL in a background tab, extracts the detail fields, closes the detail tabs, and returns a tab-separated result to the in-page card. Click **Copy TSV to clipboard** and paste into Google Sheets. A manual text-area fallback remains available if the browser blocks clipboard access.

The selection is not cleared automatically after export. Use **Clear Selection** when the workflow is complete or when a new batch should start. The minimized card is locked to a clipped 44×44-pixel icon state so the expanded card’s scrollbar cannot remain visible after minimizing.

## Exact selected-label Sheets columns

The primary workflow always produces these nine columns in this exact order:

| Column | Source |
|---|---|
| Shipping Date | Order-detail shipment date |
| Order Date | Order-detail purchase/order date |
| Tracking Number | Package tracking number |
| Order No | Temu parent order number |
| Customer Name | Recipient/customer name |
| Product Details | Product title and variant details |
| Qty (No) | Product quantity |
| Est. Revenue | Estimated order revenue |
| Shipping Cost | Exact **Est. total shipping cost** field |

The Shipping Cost value is taken from the exact order-detail label **Est. total shipping cost**. It does not use the lower-case sales-proceeds `shipping cost` value that can appear elsewhere on the detail page.

## Other export modes

The extension also supports page-range export, date-range export, selected-order file export, the general date-based Sheets Sync workflow, export history, and the in-page Quick Export panel. Existing export modes retain their own configurable column selections where applicable; the primary selected-label workflow uses the fixed nine-column contract above.

## Read-only safety

The extension is read-only with respect to Temu account operations. It only observes order rows, opens order-detail pages for extraction, reads data, stores export state locally, and closes tabs opened for extraction. It does not purchase labels, confirm shipments, print documents, cancel orders, schedule pickups, edit orders, submit orders, or make payments.

## Development checks

From the repository directory, run:

```bash
node --check background.js
node --check content.js
node --check popup.js
node test_shipping_cost_fix.js
node test_selected_workflow.js
python3 test_popup_structure.py
```
