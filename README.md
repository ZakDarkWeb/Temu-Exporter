# Temu Order Tab Exporter v8.8.6

Temu Order Tab Exporter helps Temu sellers export order data to CSV, JSON, Excel, and Google Sheets. The primary workflow is: select orders, purchase labels through Temu’s own controls, move to Shipped, refresh the in-page card, and export complete order details.

## Installation

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted extension folder. After replacing an existing version, click **Reload** on the extension card.

## Primary workflow

On Temu Seller Center → Manage Orders → **Unshipped**, select the orders included in the bulk-label operation. You may also open **Shipped** and select additional rows directly; selections from both tabs are merged and saved in `chrome.storage.local`, surviving pagination and browser restarts.

Use Temu’s own controls to buy labels in bulk. The extension never purchases labels or submits account actions. After the orders appear in **Shipped**, click **Refresh Shipped** on the in-page card. The extension scans Shipped pages, matches the durable selection using Order No and, when available, Package ID and Tracking Number, and reports matched and pending counts. Pagination now waits against the actual previous first order and supports Temu’s current active Shipped tab (`activeTab=4`).

Click **Export to Sheets** after matching. The extension opens each matched order-detail URL in a background tab, waits for the complete detail shell, extracts the fields, validates that the row is complete, retries incomplete pages, closes the detail tabs, and returns a nine-column TSV. Incomplete Order No-only shells are excluded instead of producing misleading partial spreadsheet rows.

## Copy and download options

The in-page card removes the two unused Today shortcuts and keeps the approved workflow controls: **Refresh Shipped**, **Export to Sheets**, selection clear/cancel, and the existing result actions. The popup progress panel stays hidden while idle and appears only when a real extraction or matching operation is running. The obsolete popup Sheets tab and its date-based sync controls are removed; selected-label results remain available from the in-page workflow card. After extraction, the result provides all of the following actions:

| Action | Purpose |
|---|---|
| Copy TSV to clipboard | Paste the exact nine-column result into Google Sheets |
| Download XLSX | Download a formatted Excel workbook with frozen headers and fitted columns |
| Download CSV | Download a UTF-8 CSV with the same nine-column schema |

The download buttons are available in the in-page result card and in the popup’s Sheets result card. If clipboard access is blocked, the visible text-area fallback can be copied manually.

## Export history

Every completed selected-label export is saved in the extension’s local **History** tab with its rows, schema, order count, and timestamp. History entries remain available after the popup is closed or the browser is restarted. Each entry provides Copy, XLSX, and CSV actions for later re-download. The latest result is also retained in session storage so it can be recovered if the popup closes during extraction.

## Exact selected-label columns

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

Shipping Cost is taken from **Est. total shipping cost**, not the lower-case sales-proceeds `shipping cost` value.

## Read-only safety

The extension observes order rows, opens order-detail pages for extraction, reads data, stores export state locally, generates local files, and closes tabs opened for extraction. It does not purchase labels, confirm shipments, print documents, cancel orders, schedule pickups, edit orders, submit orders, or make payments.

## Development checks

From the repository directory, run:

```bash
node --check background.js
node --check content.js
node --check popup.js
node test_selected_workflow.js
node test_selected_label_quality.js
```
