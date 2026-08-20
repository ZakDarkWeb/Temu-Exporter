# Temu Order Tab Exporter v8.8.7

Temu Order Tab Exporter is a deliberately minimal read-only helper for one seller workflow: remember selected orders, match them after labels move the orders to Shipped, extract the order details, and copy the resulting sheet data to the clipboard.

## Installation

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted extension folder. After replacing an existing version, click **Reload** on the extension card.

## Simple workflow

On Temu Seller Center → Manage Orders → **Unshipped**, select the orders that will be included in the bulk-label purchase. The extension watches the native checkboxes and saves the selected Order No, Package ID, and Tracking Number in local extension storage. The saved selection survives pagination, closing the popup, and browser restart.

Use Temu's own **Buy shipping in bulk** control. The extension never clicks that control. After Temu moves the orders to **Shipped**, click **Refresh Shipped** on the in-page card. The extension scans the Shipped pages, supports Temu's current `activeTab=4` URL, and matches saved orders by Order No while validating Package ID and Tracking Number when available.

When the matched count is ready, click **Export Sheet**. The extension opens only the selected order-detail pages in background tabs, waits for complete detail data, extracts the nine required fields, retries incomplete detail pages, closes the tabs it opened, and shows one **Copy to Clipboard** button. Paste the copied TSV directly into the existing sheet.

The popup is intentionally limited to selection memory and **Debug Detection**. Debug Detection is only for diagnosing whether Temu's current checkbox, row, and Order No DOM can be read. It does not start an export.

## Exact sheet columns

The output always contains these nine columns in this exact order:

| Column | Source |
|---|---|
| Shipping Date | Order-detail shipment date |
| Order Date | Order-detail purchase/order date |
| Tracking Number | Shipped package tracking number |
| Order No | Temu parent order number |
| Customer Name | Order-detail recipient name |
| Product Details | Order-detail product title and variant |
| Qty (No) | Product quantity |
| Est. Revenue | Order-detail estimated revenue |
| Shipping Cost | Temu's **Est. total shipping cost** field |

**Shipping Cost is intentionally taken from Est. total shipping cost, not the lower shipping cost field.**

## Removed by design

The extension no longer exposes page-range export, date-range export, JSON/CSV/XLSX downloads, pre-export Sheets sync, label-run Save/Restore, History, Settings, dashboard statistics, delivery-status tracking, task-detail label-batch export, or multiple copy/download buttons. These were outside the requested workflow and could make it unclear which data was being placed into the seller's sheet.

## Read-only safety

The extension reads order rows and order-detail pages, stores selection state locally, prepares TSV text, and closes only detail tabs created for extraction. It never clicks **Buy shipping**, **Confirm shipment**, **Print**, **Cancel**, **Refund**, **Edit**, **Schedule pickup**, or any payment/account-changing control.

## Development checks

From the repository directory, run:

```bash
node --check background.js
node --check content.js
node --check popup.js
node test_selected_workflow.js
node test_shipped_scan_fix.js
node test_minimal_ui.js
```
