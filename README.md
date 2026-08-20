# Temu Order Tab Exporter v8.7.3

This release adds a direct **Select Orders → Copy Selected to Sheets** workflow, package-aware spreadsheet output, and fixes the collapsed progress/options area below the Export as selector.

## Installation

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted extension folder. After replacing an existing version, click **Reload** on the extension card.

## Select Orders → Sheets

Open Temu Seller Center → Manage Orders. Select order checkboxes on the Temu page; the extension detects the current `beast-core` order rows and preserves selections while you move between pages. Open the extension’s **By Selection** tab and click **Copy Selected to Sheets**. The extension extracts the selected order-detail pages, switches to the Sheets result view, and copies tab-separated rows to the clipboard for pasting into Google Sheets.

The default Sheets columns include Label Date, Tracking No, Package ID, Order No, Customer, Product, Quantity, Estimated Revenue, and **Shipping Cost**. Shipping Cost is taken from the exact order-detail field **Est. total shipping cost**, not the earlier sales-proceeds `shipping cost` value. Package-aware duplicate detection uses order number, package ID, and tracking number.

The workflow is read-only. It does not purchase labels, confirm shipments, print documents, cancel orders, schedule pickups, edit orders, or submit payments.

## Included export modes

The extension supports page-range export, date-range export, selected-order file export, selected-order clipboard export to Sheets, date-based Sheets Sync, history, and the in-page Quick Export panel.
