# Temu Order Exporter (v5.4.1)

Chrome extension (Manifest V3) that exports orders from the Temu Seller **Buy shipping in bulk** page to a structured, professional Excel workbook (.xlsx).

## Key Features

- **Multi-Page Auto-Pagination** — Automatically navigates through multi-page bulk order batches and merges all records into a single Excel export.
- **Tab Pooling & Recycling Engine** — Reuses persistent background tabs to scrape order details with 70% less RAM usage and zero tab creation churn.
- **Speed & Safety Profiles**:
  - `🛡️ Stealth (Safe)`: Single-tab paced extraction (1.4s–2.6s delays) to avoid rate limits or security verification.
  - `⚡ Balanced (Default)`: Dual-tab concurrent processing with adaptive latency management.
  - `🚀 Turbo (Fast)`: Multi-tab high-throughput scraping for rapid exports.
- **Universal Search & Workspace Dashboard** — Comprehensive offline tools page (`tools.html`) featuring:
  - 📊 **Dashboard & Live Batch**: Real-time extraction status, progress metrics, and diagnostics.
  - 🔍 **Universal Search**: Fast multi-field search across past runs by Order ID, Tracking No, SKU ID, Customer Name, or Goods ID.
  - 📁 **Saved Sheets**: Historical sheet archive with one-click re-download.
  - 📐 **Column Preferences**: Selectable carrier, SKU, goods ID, and custom export layout.
- **Draggable Frosted Glass UI** — Cyber-glass floating card on Temu seller pages with interactive speed quick-pill, draggable header with position memory, and circular progress ring when minimized.
- **Zero-Dependency XLSX Engine** — Built-in fast XML/ZIP writer generating native Excel workbooks with styled tables, frozen headers, and properly formatted dates and currency.

All processing is 100% local. No data leaves your browser.

## How it works

1. **Capture** — On `buy-shipping-bulk-details.html`, the content script reads the rendered orders table (Order No, Package ID, Tracking, Shipping cost) and displays the floating card.
2. **Read details** — The service worker uses managed worker tabs to open each order's `order-detail.html` in the background, extracting structured data (with label-based DOM fallbacks).
3. **Build XLSX** — The dependency-free XLSX writer packages the `Orders` and `Extraction Status` sheets with real numbers, dates, and styling into a `.xlsx` download.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest. Content scripts inject only on bulk and detail pages. |
| `constants.js` | Shared keys, paths, speed profiles, column definitions, message types, and helpers. |
| `worker.js` | Service worker: job queue, tab pool lifecycle, retries, adaptive concurrency, SW recovery. |
| `content.js` | Bulk page: floating card UI, live order detection. Detail page: data extraction. |
| `xlsx.js` | XLSX/ZIP writer (native, zero dependencies). |
| `tools.html/js/css` | Modern tabbed Workspace: live batch monitor, search, history archive, settings. |
| `content.css` | Draggable cyber-glass floating card and minimized circular ring gauge styles. |

## Development & Installation

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select this directory.

### Linting (optional)

```sh
npm i -D eslint globals
npx eslint constants.js worker.js content.js xlsx.js tools.js
```

### State Model

The worker maintains a persisted state object (`storage.local`) mutated sequentially through `commitState()`. Each tab launch verifies an `attemptToken` to prevent corrupted states from stale callbacks, while `operationEpoch` enables instant pause and cancellation without memory leaks.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full release history.
