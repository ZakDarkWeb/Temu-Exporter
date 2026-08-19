// ═══════════════════════════════════════════════════════════════════════════════
// Temu Order Exporter — Content Script (content.js) v8.0
// Injects a floating Quick Export panel on seller.temu.com Shipped orders page
// ═══════════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const PANEL_ID  = '__temu_exporter_panel__';
  const STYLE_ID  = '__temu_exporter_style__';

  // ── Prevent double-injection ───────────────────────────────────────────────
  if (document.getElementById(PANEL_ID)) return;

  // ── Only run on seller pages ───────────────────────────────────────────────
  if (!window.location.hostname.includes('seller.temu.com')) return;

  // ── State ──────────────────────────────────────────────────────────────────
  let running     = false;
  let minimized   = false;
  let dragOffsetX = 0, dragOffsetY = 0, dragging = false;

  // ── Utility: today's date range ───────────────────────────────────────────
  function getTodayRange() {
    const now   = new Date();
    const from  = new Date(now); from.setHours(0, 0, 0, 0);
    const to    = new Date(now); to.setHours(23, 59, 59, 999);
    return { fromDate: from.toISOString(), toDate: to.toISOString() };
  }

  // ── Detect active tab (Shipped / Unshipped) ───────────────────────────────
  function isOnShippedTab() {
    const url = window.location.href;
    if (!url.includes('seller.temu.com')) return false;
    // Check active tab in page
    const activeTabEl = document.querySelector(
      '[class*="shipStatus"][class*="active"], ' +
      '[class*="tab"][class*="active"][class*="shipped" i], ' +
      'li.active a[href*="shipped" i], ' +
      '.tab-item.active'
    );
    if (activeTabEl) {
      const text = (activeTabEl.textContent || '').toLowerCase();
      return text.includes('shipped') || text.includes('dispatch');
    }
    // Fallback: check URL params
    return url.includes('ship_status=2') || url.includes('shipped') || url.includes('orders');
  }

  // ── Inject CSS (into main document, not shadow — panel uses inline styles) ─
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        bottom: 24px; right: 24px;
        z-index: 2147483647;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        user-select: none;
        transition: opacity 0.25s, transform 0.25s;
      }
      #${PANEL_ID} * { box-sizing: border-box; margin: 0; padding: 0; }

      #${PANEL_ID} .tep-card {
        background: #0a0d14;
        border: 1px solid rgba(0,212,170,0.3);
        border-radius: 14px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,212,170,0.1),
                    0 0 30px rgba(0,212,170,0.08);
        width: 240px;
        overflow: hidden;
        transition: width 0.25s ease, height 0.25s ease;
      }
      #${PANEL_ID}.tep-minimized .tep-card {
        width: 48px; border-radius: 50%;
        height: 48px;
        border-color: rgba(0,212,170,0.5);
        box-shadow: 0 4px 20px rgba(0,0,0,0.6), 0 0 20px rgba(0,212,170,0.2);
        cursor: pointer;
      }
      #${PANEL_ID}.tep-minimized .tep-body { display: none; }
      #${PANEL_ID}.tep-minimized .tep-header { padding: 0; border: none; background: transparent; justify-content: center; height: 48px; }
      #${PANEL_ID}.tep-minimized .tep-title,
      #${PANEL_ID}.tep-minimized .tep-header-actions { display: none; }
      #${PANEL_ID}.tep-minimized .tep-logo { font-size: 22px; }

      .tep-header {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 12px;
        background: rgba(255,255,255,0.02);
        border-bottom: 1px solid rgba(255,255,255,0.06);
        cursor: grab;
      }
      .tep-header:active { cursor: grabbing; }
      .tep-logo { font-size: 16px; flex-shrink: 0; }
      .tep-title {
        flex: 1; font-size: 11px; font-weight: 800;
        color: #f1f5f9; letter-spacing: -0.2px;
      }
      .tep-header-actions { display: flex; gap: 4px; }
      .tep-icon-btn {
        width: 20px; height: 20px; border-radius: 50%;
        background: rgba(255,255,255,0.06); border: none;
        color: #64748b; font-size: 11px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.15s;
      }
      .tep-icon-btn:hover { background: rgba(255,255,255,0.12); color: #f1f5f9; }

      .tep-body { padding: 10px; display: flex; flex-direction: column; gap: 7px; }

      .tep-status {
        font-size: 9px; font-weight: 600; color: #4a5568;
        padding: 4px 8px; border-radius: 6px;
        background: rgba(255,255,255,0.02);
        border-left: 2px solid #1e2a3a;
        transition: all 0.3s;
      }
      .tep-status.ready  { color: #00d4aa; border-color: #00d4aa; background: rgba(0,212,170,0.05); }
      .tep-status.running{ color: #4f8ef7; border-color: #4f8ef7; background: rgba(79,142,247,0.05); }
      .tep-status.done   { color: #00d4aa; border-color: #00d4aa; background: rgba(0,212,170,0.08); }
      .tep-status.error  { color: #f87171; border-color: #ef4444; background: rgba(239,68,68,0.06); }

      .tep-btn {
        width: 100%; padding: 8px 10px;
        border: none; border-radius: 8px;
        font-size: 10px; font-weight: 800; font-family: inherit;
        cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;
        transition: all 0.2s; position: relative; overflow: hidden;
        letter-spacing: 0.2px;
      }
      .tep-btn::before {
        content: ''; position: absolute; top: 0; left: -100%; width: 60%; height: 100%;
        background: linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent);
        animation: tepShimmer 3s ease-in-out infinite;
      }
      @keyframes tepShimmer { 0%{left:-100%} 50%,100%{left:160%} }
      .tep-btn-primary {
        background: linear-gradient(135deg, #00d4aa, #00b894);
        color: #021a13;
        box-shadow: 0 0 16px rgba(0,212,170,0.3), 0 3px 12px rgba(0,0,0,0.4);
      }
      .tep-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 0 24px rgba(0,212,170,0.45), 0 5px 16px rgba(0,0,0,0.4); }
      .tep-btn-primary:active { transform: scale(0.98); }
      .tep-btn-secondary {
        background: rgba(79,142,247,0.1); border: 1px solid rgba(79,142,247,0.25);
        color: #4f8ef7;
      }
      .tep-btn-secondary:hover { background: rgba(79,142,247,0.18); border-color: rgba(79,142,247,0.45); }
      .tep-btn-cancel {
        background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25);
        color: #f87171;
      }
      .tep-btn-cancel:hover { background: rgba(239,68,68,0.15); }
      .tep-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none !important; }
      .tep-btn:disabled::before { display: none; }

      .tep-progress-wrap { display: flex; flex-direction: column; gap: 4px; }
      .tep-progress-label {
        display: flex; justify-content: space-between; align-items: center;
        font-size: 9px; color: #64748b; font-weight: 600;
      }
      .tep-progress-pct { color: #00d4aa; font-weight: 800; }
      .tep-progress-track {
        height: 4px; background: #1e2a3a; border-radius: 2px; overflow: hidden;
      }
      .tep-progress-fill {
        height: 100%; border-radius: 2px;
        background: linear-gradient(90deg, #00d4aa, #4f8ef7);
        box-shadow: 0 0 8px rgba(0,212,170,0.5);
        transition: width 0.4s ease;
        width: 0%;
      }

      .tep-divider {
        height: 1px; background: rgba(255,255,255,0.05);
        margin: 2px 0;
      }

      .tep-result {
        font-size: 10px; font-weight: 700; color: #00d4aa;
        text-align: center; padding: 4px;
        animation: tepFadeIn 0.3s ease;
      }
      @keyframes tepFadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }

      .tep-drag-hint {
        font-size: 8px; color: #1e2a3a; text-align: center;
        letter-spacing: 0.3px; margin-top: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  // ── Build HTML panel ──────────────────────────────────────────────────────
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="tep-card">
        <div class="tep-header" id="tepHeader">
          <span class="tep-logo">📦</span>
          <span class="tep-title">Temu Exporter</span>
          <div class="tep-header-actions">
            <button class="tep-icon-btn" id="tepMinBtn" title="Minimize">—</button>
          </div>
        </div>
        <div class="tep-body">
          <div class="tep-status ready" id="tepStatus">✅ Shipped tab ready</div>

          <button class="tep-btn tep-btn-primary" id="tepExportToday">
            ⚡ Export Today's Orders
          </button>
          <button class="tep-btn tep-btn-secondary" id="tepSheetsToday">
            📊 Sheets Sync Today
          </button>

          <div id="tepProgressSection" style="display:none;">
            <div class="tep-divider"></div>
            <div class="tep-progress-wrap">
              <div class="tep-progress-label">
                <span id="tepProgressText">Scanning...</span>
                <span class="tep-progress-pct" id="tepProgressPct">0%</span>
              </div>
              <div class="tep-progress-track">
                <div class="tep-progress-fill" id="tepProgressFill"></div>
              </div>
            </div>
            <button class="tep-btn tep-btn-cancel" id="tepCancel" style="margin-top:6px;">
              ✕ Cancel
            </button>
          </div>

          <div id="tepResult" style="display:none;" class="tep-result"></div>
          <div class="tep-drag-hint">⠿ drag to move</div>
        </div>
      </div>
    `;
    return panel;
  }

  // ── Panel state helpers ────────────────────────────────────────────────────
  function setStatus(text, cls) {
    const el = document.getElementById('tepStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'tep-status ' + (cls || '');
  }

  function setButtons(disabled) {
    ['tepExportToday', 'tepSheetsToday'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = disabled;
    });
  }

  function showProgress(show) {
    const sec = document.getElementById('tepProgressSection');
    if (sec) sec.style.display = show ? 'block' : 'none';
    if (!show) {
      updateProgress(0, '');
    }
  }

  function updateProgress(pct, label) {
    const fill = document.getElementById('tepProgressFill');
    const txt  = document.getElementById('tepProgressText');
    const pctEl= document.getElementById('tepProgressPct');
    if (fill)  fill.style.width = pct + '%';
    if (txt)   txt.textContent  = label || '';
    if (pctEl) pctEl.textContent= Math.round(pct) + '%';
  }

  function showResult(text) {
    const el = document.getElementById('tepResult');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
    setTimeout(() => { if (el) el.style.display = 'none'; }, 5000);
  }

  // ── Start export via background.js ─────────────────────────────────────────
  function startQuickExport(sheetsMode) {
    if (running) return;
    running = true;
    setButtons(true);
    showProgress(true);
    showResult(''); // hide previous result
    const { fromDate, toDate } = getTodayRange();
    const label = sheetsMode ? 'Sheets Sync' : 'Export';

    setStatus('🔄 Running ' + label + '...', 'running');
    updateProgress(5, 'Initializing...');

    // Find the current tab ID via active tab detection
    chrome.runtime.sendMessage({
      type: sheetsMode ? 'quickSheetsSync' : 'quickExport',
      fromDate,
      toDate
    });
  }

  function cancelExport() {
    chrome.runtime.sendMessage({ type: 'cancelExport' });
    running = false;
    setButtons(false);
    showProgress(false);
    setStatus('⚡ Export cancelled', 'error');
    setTimeout(() => setStatus('✅ Shipped tab ready', 'ready'), 3000);
  }

  // ── Listen to messages from background.js ─────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;

    // Progress updates (autoProgress from runDateExport)
    if (msg.type === 'autoProgress') {
      const { stage, page, totalPages, scraped } = msg;
      const pagePct = totalPages > 0 ? (page / totalPages) * 80 : 0;
      if (stage === 'navigating') {
        updateProgress(pagePct + 5, `📄 Scanning page ${page} / ${totalPages || '?'}...`);
        setStatus(`🔄 Page ${page} / ${totalPages || '?'} — ${scraped || 0} orders found`, 'running');
      } else {
        updateProgress(pagePct + 10, `⚡ Extracting orders (${scraped || 0} found)...`);
      }
    }

    // Export done
    if (msg.type === 'autoDone' || msg.type === 'done') {
      running = false;
      setButtons(false);
      showProgress(false);
      const count = msg.ordersFound || msg.rowsSynced || 0;
      setStatus(`✅ Done! ${count} orders exported`, 'done');
      showResult(`✅ ${count} orders exported successfully!`);
      updateProgress(100, 'Complete!');
      setTimeout(() => setStatus('✅ Shipped tab ready', 'ready'), 6000);
    }

    // Sheets sync done (autoDone with sheetsMode)
    if (msg.type === 'sheetsDone') {
      running = false;
      setButtons(false);
      showProgress(false);
      const count = msg.rowsSynced || 0;
      setStatus(`✅ ${count} rows copied to clipboard!`, 'done');
      showResult(`📊 ${count} rows ready — Ctrl+V in Google Sheets!`);
      setTimeout(() => setStatus('✅ Shipped tab ready', 'ready'), 8000);
    }

    // No data
    if (msg.type === 'noData') {
      running = false;
      setButtons(false);
      showProgress(false);
      setStatus('⚠️ No orders found in range', 'error');
      setTimeout(() => setStatus('✅ Shipped tab ready', 'ready'), 4000);
    }

    // Error
    if (msg.type === 'error') {
      running = false;
      setButtons(false);
      showProgress(false);
      setStatus('❌ ' + (msg.message || 'Error').slice(0, 50), 'error');
      setTimeout(() => setStatus('✅ Shipped tab ready', 'ready'), 5000);
    }

    // Cancelled
    if (msg.type === 'cancelled') {
      running = false;
      setButtons(false);
      showProgress(false);
      setStatus('⚡ Cancelled', 'error');
      setTimeout(() => setStatus('✅ Shipped tab ready', 'ready'), 3000);
    }
  });

  // ── Draggable logic ────────────────────────────────────────────────────────
  function initDrag(panel) {
    const header = document.getElementById('tepHeader');
    if (!header) return;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tep-icon-btn')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      panel.style.transition = 'none';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      let x = e.clientX - dragOffsetX;
      let y = e.clientY - dragOffsetY;
      // Clamp to viewport
      x = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  x));
      y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, y));
      panel.style.left   = x + 'px';
      panel.style.top    = y + 'px';
      panel.style.right  = 'auto';
      panel.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
      panel.style.transition = '';
      document.body.style.userSelect = '';
    });
  }

  // ── Minimize toggle ────────────────────────────────────────────────────────
  function initMinimize(panel) {
    const minBtn = document.getElementById('tepMinBtn');
    if (minBtn) {
      minBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        minimized = !minimized;
        panel.classList.toggle('tep-minimized', minimized);
        minBtn.textContent = minimized ? '□' : '—';
      });
    }
    // Click on minimized panel to expand
    panel.addEventListener('click', (e) => {
      if (minimized && !e.target.closest('.tep-icon-btn')) {
        minimized = false;
        panel.classList.remove('tep-minimized');
        const minBtn2 = document.getElementById('tepMinBtn');
        if (minBtn2) minBtn2.textContent = '—';
      }
    });
  }

  // ── Wire buttons ──────────────────────────────────────────────────────────
  function wireButtons() {
    const btnExport = document.getElementById('tepExportToday');
    const btnSheets = document.getElementById('tepSheetsToday');
    const btnCancel = document.getElementById('tepCancel');

    if (btnExport) btnExport.addEventListener('click', () => startQuickExport(false));
    if (btnSheets) btnSheets.addEventListener('click', () => startQuickExport(true));
    if (btnCancel) btnCancel.addEventListener('click', cancelExport);
  }

  // ── Main init ─────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    const panel = buildPanel();
    document.body.appendChild(panel);
    initDrag(panel);
    initMinimize(panel);
    wireButtons();

    // Initial status based on page
    if (!isOnShippedTab()) {
      setStatus('ℹ️ Go to Shipped tab to export', '');
    }

    // Watch for tab changes (Temu is SPA)
    const observer = new MutationObserver(() => {
      if (isOnShippedTab()) {
        if (!running) setStatus('✅ Shipped tab ready', 'ready');
        setButtons(false);
      } else {
        if (!running) setStatus('ℹ️ Go to Shipped tab to export', '');
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  // ── Wait for DOM ready ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Small delay so page layout is stable
    setTimeout(init, 1500);
  }

})();
