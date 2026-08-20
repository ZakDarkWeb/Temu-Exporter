# Temu Order Tab Exporter v8.9.0

Temu Order Tab Exporter is a focused, read-only workflow for sellers who select orders, buy labels through Temu’s own interface, and export the resulting order details to Google Sheets.

## Installation

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted extension folder. After replacing an existing version, click **Reload** on the extension card.

## Primary workflow

On Temu Seller Center → Manage Orders, select orders on **Unshipped** or select additional orders directly on **Shipped**. The in-page card saves the selected Order No, Package ID, and Tracking Number in `chrome.storage.local`. Selection survives pagination and browser restarts, and selections made on the two tabs are merged instead of replacing one another.

Use Temu’s own controls to buy labels in bulk. The extension never purchases labels, confirms shipments, prints documents, cancels orders, edits orders, submits orders, or makes payments. After labels are processed, open **Shipped** and click **Refresh Shipped** when you want to scan all Shipped pages and match the saved selection. Directly selected Shipped rows are also immediately available for export.

Click **Export to Sheets** to open each matched order-detail page in a background tab, extract the data, close the detail tab, and return a TSV result. The in-page card and popup show compact live progress such as `Extracting 4 / 12 orders`. Copy the TSV and paste it into Google Sheets. If clipboard access is blocked, the visible text-area fallback can be copied manually.

Use **Clear Selection** when the batch is complete. Export does not clear the selection automatically.

## Exact Sheets columns

The workflow always produces these nine columns in this exact order:

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

## Focused interface

The extension intentionally contains only the primary bulk-label workflow. The old Pages, Date, History, Today, and generic Sheets Sync interfaces are not part of v8.9.0. The popup is a compact status dashboard, while the in-page card remains the main operating surface on Temu.

## Read-only safety

The extension observes order rows, reads order-detail data, stores selection state locally, and closes tabs opened for extraction. It performs no Temu account action and does not access or submit payment, shipment, or order controls.

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
