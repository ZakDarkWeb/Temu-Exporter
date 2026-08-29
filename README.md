# Temu Order Exporter

Chrome extension (Manifest V3) that exports orders from the Temu Seller **Buy shipping in bulk** page to an Excel workbook.

## How it works

1. **Capture** — On `buy-shipping-bulk-details.html` the content script reads the rendered table (Order No, Package ID, Tracking, Shipping cost) and shows a floating card.
2. **Read details** — The service worker opens each order's `order-detail.html` in a background tab (1–4 tabs, adaptive), the content script extracts the structured page data (falling back to DOM parsing) and reports back.
3. **Build XLSX** — A dependency-free XLSX writer produces `Orders` and `Extraction Status` sheets with real date/number cells, a frozen header and an Excel table.

All processing is local. No data leaves the browser.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest. Content scripts inject only on the bulk and detail pages. |
| `constants.js` | Shared keys, paths, column lists, message types, pure helpers. Loaded by every context. |
| `worker.js` | Service worker: job queue, retries, adaptive concurrency, tab lifecycle, recovery after SW restart. |
| `content.js` | Bulk page: floating card UI. Detail page: extraction. |
| `xlsx.js` | XLSX/ZIP writer (no libraries). |
| `tools.html/js/css` | History & Tools workspace (also the extension's options page). |
| `content.css` | Card styles. |

## Development

Load unpacked from `chrome://extensions` → *Developer mode* → *Load unpacked* → select this folder.

Lint (optional):

```sh
npm i -D eslint globals
npx eslint constants.js worker.js content.js xlsx.js tools.js
```

### Temu selector map

Temu's class names are CSS-module hashes and change on deploys. They live in the `SELECTORS` object at the top of `content.js`. Every selector has a label-based fallback; when a primary selector misses, the exported *Extraction Status* sheet will contain a note such as `primary selector missed: carrier (fallback used)` — that is the signal to update the map.

### State model

The worker keeps one persisted state object (`storage.local`) mutated only through `commitState()`, which serialises writes. Each detail tab launch has an `attemptToken`; every callback (success, failure, timeout, tab closed) verifies the token before acting, so late or duplicate events cannot corrupt the queue. `operationEpoch` lets Pause/Stop return immediately while in-progress launches self-cancel.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
