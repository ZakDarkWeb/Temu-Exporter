// content.js — Temu Order Exporter v5.0
// Selection Overlay: adds floating checkboxes to Temu shipped orders list page
// Injected via chrome.scripting.executeScript when user enables Selection Mode

(function() {
  'use strict';

  // Prevent double-injection
  if (window.__temuOverlayActive) return;
  window.__temuOverlayActive = true;

  const STORAGE_KEY  = 'temuSelections';   // { orderSn: url, ... }
  const OVERLAY_ID   = '__temuOverlayBadge';
  const COL_ID       = '__temuCheckCol';
  const STYLE_ID     = '__temuOverlayStyle';

  // ── Inject CSS ──────────────────────────────────────────────────────────────
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Checkbox circles */
      .temu-sel-btn {
        width: 22px; height: 22px;
        border-radius: 50%;
        border: 2px solid #22c55e;
        background: transparent;
        cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 13px; font-weight: bold;
        color: transparent;
        transition: all 0.15s ease;
        flex-shrink: 0;
        outline: none;
        vertical-align: middle;
      }
      .temu-sel-btn:hover {
        background: rgba(34,197,94,0.15);
      }
      .temu-sel-btn.selected {
        background: #22c55e;
        border-color: #16a34a;
        color: white;
      }
      /* Header checkbox cell */
      .temu-sel-th {
        width: 36px !important;
        min-width: 36px !important;
        padding: 0 6px !important;
        text-align: center !important;
        vertical-align: middle !important;
      }
      .temu-sel-td {
        width: 36px !important;
        min-width: 36px !important;
        padding: 4px 6px !important;
        text-align: center !important;
        vertical-align: middle !important;
        position: relative;
      }
      /* Row highlight when selected */
      tr.temu-row-selected {
        background: rgba(34,197,94,0.06) !important;
      }
      /* Floating badge */
      #${OVERLAY_ID} {
        position: fixed;
        top: 14px; right: 14px;
        z-index: 999999;
        background: #0f172a;
        border: 1.5px solid #22c55e;
        border-radius: 10px;
        padding: 7px 14px;
        display: flex; align-items: center; gap: 10px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; font-weight: 600;
        color: #f0fdf4;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        user-select: none;
        cursor: default;
        transition: opacity 0.2s;
      }
      #${OVERLAY_ID} .temu-badge-count {
        color: #22c55e;
        font-size: 15px;
      }
      #${OVERLAY_ID} .temu-badge-sep {
        color: #334155;
      }
      #${OVERLAY_ID} .temu-badge-clear {
        background: transparent;
        border: 1px solid #ef4444;
        color: #ef4444;
        border-radius: 5px;
        padding: 2px 8px;
        font-size: 11px; font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
      }
      #${OVERLAY_ID} .temu-badge-clear:hover {
        background: #ef4444; color: white;
      }
      #${OVERLAY_ID} .temu-badge-label {
        color: #94a3b8;
      }
    `;
    document.head.appendChild(style);
  }

  // ── State ───────────────────────────────────────────────────────────────────
  var selections = {};   // { orderSn: detailUrl }

  function selectionCount() { return Object.keys(selections).length; }

  function saveSelections() {
    chrome.storage.local.set({ [STORAGE_KEY]: selections });
    updateBadge();
  }

  function clearSelections() {
    selections = {};
    chrome.storage.local.set({ [STORAGE_KEY]: {} });
    updateBadge();
    // Visually deselect all
    document.querySelectorAll('.temu-sel-btn.selected').forEach(function(btn) {
      btn.classList.remove('selected');
      btn.textContent = '';
      var tr = btn.closest('tr');
      if (tr) tr.classList.remove('temu-row-selected');
    });
  }

  // ── Floating badge ──────────────────────────────────────────────────────────
  function createBadge() {
    if (document.getElementById(OVERLAY_ID)) return;
    var badge = document.createElement('div');
    badge.id = OVERLAY_ID;
    badge.innerHTML =
      '<span class="temu-badge-label">Selected:</span>' +
      '<span class="temu-badge-count" id="__temuCount">0</span>' +
      '<span class="temu-badge-sep">|</span>' +
      '<button class="temu-badge-clear" id="__temuClearBtn">✕ Clear All</button>';
    document.body.appendChild(badge);

    document.getElementById('__temuClearBtn').addEventListener('click', function(e) {
      e.stopPropagation();
      clearSelections();
    });
  }

  function updateBadge() {
    var el = document.getElementById('__temuCount');
    if (el) el.textContent = selectionCount();
  }

  // ── Find order rows in the table ─────────────────────────────────────────────
  // Each order row on Temu list contains a PO-xxx order number
  function getOrderRows() {
    var rows = [];
    // Look for table rows that contain a PO-xxx order number link or span
    document.querySelectorAll('tr').forEach(function(tr) {
      var text = tr.textContent || '';
      var snMatch = text.match(/\b(PO-\d{3}-\d{10,})\b/);
      if (!snMatch) return;
      // Avoid header rows
      if (tr.querySelector('th')) return;
      rows.push({ tr: tr, sn: snMatch[1] });
    });
    return rows;
  }

  // Build the order detail URL from a PO-xxx serial number
  function buildDetailUrl(sn) {
    return window.location.origin + '/order-detail.html?parent_order_sn=' + encodeURIComponent(sn);
  }

  // ── Watch Temu's NATIVE checkboxes — primary selection method ────────────────
  // Users naturally use Temu's own black checkboxes; we track those state changes
  // and mirror them into our selections storage.
  function syncNativeCheckboxes() {
    document.querySelectorAll('tr').forEach(function(tr) {
      if (tr.querySelector('th')) return; // skip header
      var text = tr.textContent || '';
      var snMatch = text.match(/\b(PO-\d{3}-\d{10,})\b/);
      if (!snMatch) return;
      var sn = snMatch[1];

      // Find native checkbox in this row
      var cb = tr.querySelector('input[type="checkbox"]');
      if (!cb) return;

      if (cb.checked) {
        // Add to selections
        if (!selections[sn]) {
          selections[sn] = buildDetailUrl(sn);
          tr.classList.add('temu-row-selected');
        }
      } else {
        // Remove from selections
        if (selections[sn]) {
          delete selections[sn];
          tr.classList.remove('temu-row-selected');
        }
      }
    });
    saveSelections();
  }

  // Listen for native checkbox change events (bubbled from any tr > input[checkbox])
  document.addEventListener('change', function(e) {
    if (e.target && e.target.type === 'checkbox') {
      // Small delay to let Temu's own handler run first
      setTimeout(syncNativeCheckboxes, 80);
    }
  });

  // Also poll every 600ms to catch programmatic check changes (e.g. "Select All")
  setInterval(syncNativeCheckboxes, 600);



  function injectCheckboxes() {
    var rows = getOrderRows();
    if (rows.length === 0) return;

    // Add header cell if missing
    var thead = document.querySelector('thead tr');
    if (thead && !thead.querySelector('.' + COL_ID + '-th')) {
      var th = document.createElement('th');
      th.className = 'temu-sel-th ' + COL_ID + '-th';
      th.textContent = '☑';
      thead.insertBefore(th, thead.firstChild);
    }

    rows.forEach(function(item) {
      if (injectedRows.has(item.tr)) return;
      injectedRows.add(item.tr);

      var td = document.createElement('td');
      td.className = 'temu-sel-td';

      var btn = document.createElement('button');
      btn.className = 'temu-sel-btn';
      btn.title = 'Select ' + item.sn;

      // Restore selected state if previously selected
      if (selections[item.sn]) {
        btn.classList.add('selected');
        btn.textContent = '✓';
        item.tr.classList.add('temu-row-selected');
      }

      btn.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (selections[item.sn]) {
          // Deselect
          delete selections[item.sn];
          btn.classList.remove('selected');
          btn.textContent = '';
          item.tr.classList.remove('temu-row-selected');
        } else {
          // Select
          selections[item.sn] = buildDetailUrl(item.sn);
          btn.classList.add('selected');
          btn.textContent = '✓';
          item.tr.classList.add('temu-row-selected');
        }
        saveSelections();
      });

      td.appendChild(btn);
      item.tr.insertBefore(td, item.tr.firstChild);
    });

    updateBadge();
  }

  // ── MutationObserver: re-sync when Temu SPA re-renders table ────────────────
  var observer = new MutationObserver(function(mutations) {
    var needsSync = mutations.some(function(m) {
      return m.addedNodes.length > 0;
    });
    if (needsSync) {
      clearTimeout(window.__temuInjectTimer);
      window.__temuInjectTimer = setTimeout(syncNativeCheckboxes, 350);
    }
  });

  // ── URL change detection: reset selections on page navigation ───────────────
  var lastUrl = location.href;
  var urlCheckInterval = setInterval(function() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Page changed — reset all selections
      selections = {};
      chrome.storage.local.set({ [STORAGE_KEY]: {} });
      updateBadge();
      setTimeout(syncNativeCheckboxes, 800);
    }
  }, 500);

  // ── Init ────────────────────────────────────────────────────────────────────
  createBadge();

  // Load any existing selections from storage (edge case: re-injection)
  chrome.storage.local.get([STORAGE_KEY], function(result) {
    selections = result[STORAGE_KEY] || {};
    // Sync native checkboxes immediately (handles already-checked orders)
    setTimeout(syncNativeCheckboxes, 300);

    // Start observing for SPA table re-renders
    var target = document.querySelector('tbody') || document.body;
    observer.observe(target, { childList: true, subtree: true });
  });

  // Cleanup on unload
  window.addEventListener('beforeunload', function() {
    clearInterval(urlCheckInterval);
    observer.disconnect();
  });

  // Listen for clear command from popup/background
  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg.type === 'clearSelections') clearSelections();
    if (msg.type === 'getSelectionCount') {
      return true; // async
    }
  });

})();
