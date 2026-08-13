// content.js — Temu Order Exporter v5.0
// Selection Overlay: adds floating checkboxes to Temu shipped orders list page
// Injected via chrome.scripting.executeScript when user enables Selection Mode

(function() {
  'use strict';

  // Prevent double-injection
  if (window.__temuOverlayActive) return;
  window.__temuOverlayActive = true;

  const STORAGE_KEY  = 'temuSelections_v6';   // { orderSn: url, ... }
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
  function getOrderRows() {
    var rows = [];
    document.querySelectorAll('tr').forEach(function(tr) {
      if (tr.querySelector('th')) return; // Avoid header rows
      var text = tr.textContent || '';
      var snMatch = text.match(/(PO-\d+-\d{8,})/);
      if (!snMatch) return;
      rows.push({ tr: tr, sn: snMatch[1] });
    });
    return rows;
  }

  // Build the order detail URL from a PO-xxx serial number
  function buildDetailUrl(sn) {
    return window.location.origin + '/order-detail.html?parent_order_sn=' + encodeURIComponent(sn);
  }

  function isRowChecked(tr) {
    var cb = tr.querySelector('input[type="checkbox"]');
    if (cb && cb.checked) return true;
    var label = tr.querySelector('label[data-testid="beast-core-checkbox"], label[class*="CBX"], [data-checked="true"]');
    if (label && (label.getAttribute('data-checked') === 'true' || label.classList.contains('CBX_active_123'))) return true;
    if (tr.querySelector('.CBX_active_123, .CBX_hasCheckSquare_123.CBX_active_123')) return true;
    return false;
  }

  // ── Sync from User Click: handles both check and explicit uncheck ────────────
  function syncUserInteraction() {
    document.querySelectorAll('tr').forEach(function(tr) {
      if (tr.querySelector('th')) return;
      var text = tr.textContent || '';
      var snMatch = text.match(/(PO-\d+-\d{8,})/);
      if (!snMatch) return;
      var sn = snMatch[1];

      if (isRowChecked(tr)) {
        if (!selections[sn]) {
          selections[sn] = buildDetailUrl(sn);
          tr.classList.add('temu-row-selected');
        }
      } else {
        // User explicitly unchecked a visible row on current page
        if (selections[sn]) {
          delete selections[sn];
          tr.classList.remove('temu-row-selected');
        }
      }
    });
    saveSelections();
  }

  // ── Polling & Observer Sync: ONLY ADDS, NEVER DELETES ────────────────────────
  // Prevents wiping selections during page transitions, lazy rendering or tab switches
  function syncAddOnly() {
    var changed = false;
    document.querySelectorAll('tr').forEach(function(tr) {
      if (tr.querySelector('th')) return;
      var text = tr.textContent || '';
      var snMatch = text.match(/(PO-\d+-\d{8,})/);
      if (!snMatch) return;
      var sn = snMatch[1];

      if (isRowChecked(tr)) {
        if (!selections[sn]) {
          selections[sn] = buildDetailUrl(sn);
          tr.classList.add('temu-row-selected');
          changed = true;
        }
      }
    });
    if (changed) saveSelections();
  }

  // Listen for explicit user clicks and changes on checkbox elements
  document.addEventListener('click', function(e) {
    var checkEl = e.target.closest('label[data-testid="beast-core-checkbox"], label[class*="CBX"], [class*="CBX_square"], td[class*="checkCell"], input[type="checkbox"]');
    if (checkEl) {
      setTimeout(syncUserInteraction, 80);
      setTimeout(syncUserInteraction, 350);
    }
  }, true);

  document.addEventListener('change', function(e) {
    if (e.target && e.target.type === 'checkbox') {
      setTimeout(syncUserInteraction, 80);
      setTimeout(syncUserInteraction, 350);
    }
  }, true);

  // Background polling to catch programmatic selections (e.g. Select All on page)
  setInterval(syncAddOnly, 600);

  // ── MutationObserver: re-sync when Temu SPA re-renders table ────────────────
  var observer = new MutationObserver(function(mutations) {
    var needsSync = mutations.some(function(m) {
      return m.addedNodes.length > 0;
    });
    if (needsSync) {
      clearTimeout(window.__temuInjectTimer);
      window.__temuInjectTimer = setTimeout(syncAddOnly, 300);
    }
  });

  // ── URL change detection: preserve selections across page navigation ────────
  var lastUrl = location.href;
  var urlCheckInterval = setInterval(function() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      updateBadge();
      setTimeout(syncAddOnly, 800);
    }
  }, 500);

  // ── Init ────────────────────────────────────────────────────────────────────
  createBadge();

  // Load existing selections from storage
  chrome.storage.local.get([STORAGE_KEY], function(result) {
    selections = result[STORAGE_KEY] || {};
    setTimeout(syncAddOnly, 300);

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
