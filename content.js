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

  // ── Detect active tab using URL only (NO DOM queries = zero overhead) ───────
  function isOnShippedTab() {
    const url = window.location.href;
    // Must be on seller.temu.com
    if (!url.includes('seller.temu.com')) return false;
    // Must be on an orders-related page
    if (!url.includes('order') && !url.includes('orders')) return false;
    return true;
  }

  function isOnOrdersPage() {
    const url = window.location.href;
    return url.includes('seller.temu.com') &&
           (url.includes('order') || url.includes('manage') || url.includes('shipped'));
  }

  // ── Inject CSS (into main document, not shadow — panel uses inline styles) ─
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

      #${PANEL_ID} {
        position: fixed;
        bottom: 28px; right: 28px;
        z-index: 2147483647;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        user-select: none;
        -webkit-font-smoothing: antialiased;
      }
      #${PANEL_ID} *, #${PANEL_ID} *::before, #${PANEL_ID} *::after {
        box-sizing: border-box; margin: 0; padding: 0;
      }

      /* ── CARD ─────────────────────────────────────────────── */
      #${PANEL_ID} .tep-card {
        background: #0d1117;
        border: 1px solid rgba(0, 212, 170, 0.25);
        border-radius: 16px;
        box-shadow:
          0 0 0 1px rgba(0,212,170,0.08),
          0 8px 32px rgba(0,0,0,0.8),
          0 0 40px rgba(0,212,170,0.06);
        width: 230px;
        overflow: hidden;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }

      /* ── MINIMIZED STATE ──────────────────────────────────── */
      #${PANEL_ID}.tep-minimized .tep-card {
        width: 44px; height: 44px;
        border-radius: 50%;
        border-color: rgba(0,212,170,0.5);
        box-shadow: 0 4px 20px rgba(0,0,0,0.7), 0 0 24px rgba(0,212,170,0.25);
        cursor: pointer;
        overflow: hidden;
      }
      #${PANEL_ID}.tep-minimized .tep-body,
      #${PANEL_ID}.tep-minimized .tep-title,
      #${PANEL_ID}.tep-minimized .tep-header-actions,
      #${PANEL_ID}.tep-minimized .tep-divider-h { display: none !important; }
      #${PANEL_ID}.tep-minimized .tep-header {
        height: 44px; padding: 0;
        border: none; background: transparent;
        justify-content: center; cursor: pointer;
      }
      #${PANEL_ID}.tep-minimized .tep-logo { font-size: 20px; }

      /* ── HEADER ───────────────────────────────────────────── */
      .tep-header {
        display: flex; align-items: center; gap: 8px;
        padding: 11px 13px 10px;
        cursor: grab;
        position: relative;
      }
      .tep-header:active { cursor: grabbing; }
      .tep-divider-h {
        position: absolute; bottom: 0; left: 13px; right: 13px;
        height: 1px;
        background: linear-gradient(90deg, rgba(0,212,170,0.4), transparent);
      }

      .tep-logo {
        width: 28px; height: 28px; border-radius: 8px;
        background: linear-gradient(135deg, #00d4aa22, #00b89411);
        border: 1px solid rgba(0,212,170,0.3);
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; flex-shrink: 0;
      }
      .tep-title {
        flex: 1; font-size: 12px; font-weight: 800;
        color: #f1f5f9; letter-spacing: -0.3px;
        line-height: 1;
      }
      .tep-subtitle {
        font-size: 9px; font-weight: 500; color: #4a5568;
        margin-top: 1px;
      }
      .tep-header-actions { display: flex; gap: 3px; }
      .tep-icon-btn {
        width: 22px; height: 22px; border-radius: 6px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.06);
        color: #64748b; font-size: 12px; font-weight: 700;
        cursor: pointer; font-family: inherit;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.15s; line-height: 1;
      }
      .tep-icon-btn:hover {
        background: rgba(255,255,255,0.1);
        border-color: rgba(255,255,255,0.12);
        color: #f1f5f9;
      }

      /* ── BODY ─────────────────────────────────────────────── */
      .tep-body {
        padding: 12px; display: flex; flex-direction: column; gap: 8px;
      }

      /* ── STATUS CHIP ──────────────────────────────────────── */
      .tep-status {
        display: flex; align-items: center; gap: 6px;
        font-size: 10px; font-weight: 600;
        padding: 5px 9px; border-radius: 8px;
        transition: all 0.25s ease;
        line-height: 1;
      }
      .tep-status-dot {
        width: 6px; height: 6px; border-radius: 50%;
        flex-shrink: 0; transition: background 0.25s;
      }
      .tep-status.idle   { color: #64748b; background: rgba(255,255,255,0.03); }
      .tep-status.idle   .tep-status-dot { background: #2d3748; }
      .tep-status.ready  { color: #00d4aa; background: rgba(0,212,170,0.07); }
      .tep-status.ready  .tep-status-dot { background: #00d4aa; box-shadow: 0 0 6px rgba(0,212,170,0.8); animation: tepPulse 1.5s ease-in-out infinite; }
      .tep-status.running{ color: #60a5fa; background: rgba(96,165,250,0.07); }
      .tep-status.running .tep-status-dot { background: #60a5fa; box-shadow: 0 0 6px rgba(96,165,250,0.8); animation: tepPulse 0.8s ease-in-out infinite; }
      .tep-status.done   { color: #00d4aa; background: rgba(0,212,170,0.1); }
      .tep-status.done   .tep-status-dot { background: #00d4aa; }
      .tep-status.error  { color: #f87171; background: rgba(248,113,113,0.07); }
      .tep-status.error  .tep-status-dot { background: #f87171; }
      @keyframes tepPulse {
        0%,100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(0.8); }
      }

      /* ── BUTTONS ──────────────────────────────────────────── */
      .tep-btn {
        width: 100%; padding: 0 14px;
        height: 36px;
        border: none; border-radius: 10px;
        font-size: 11px; font-weight: 800; font-family: inherit;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 7px;
        transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
        position: relative; overflow: hidden;
        letter-spacing: 0.1px; white-space: nowrap;
      }
      /* Shimmer effect */
      .tep-btn::after {
        content: '';
        position: absolute; top: 0; left: -80%; width: 50%; height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
        transform: skewX(-15deg);
        animation: tepShimmer 3.5s ease-in-out infinite;
      }
      @keyframes tepShimmer { 0%{left:-80%} 40%,100%{left:130%} }

      /* Primary — teal gradient */
      .tep-btn-primary {
        background: linear-gradient(135deg, #00d4aa 0%, #00b894 100%);
        color: #01120d;
        box-shadow: 0 0 20px rgba(0,212,170,0.28), 0 3px 10px rgba(0,0,0,0.5);
      }
      .tep-btn-primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 0 28px rgba(0,212,170,0.45), 0 6px 18px rgba(0,0,0,0.5);
      }
      .tep-btn-primary:active { transform: scale(0.97); }

      /* Secondary — outlined teal */
      .tep-btn-secondary {
        background: rgba(0,212,170,0.06);
        border: 1px solid rgba(0,212,170,0.22);
        color: #00d4aa;
      }
      .tep-btn-secondary:hover {
        background: rgba(0,212,170,0.12);
        border-color: rgba(0,212,170,0.4);
        transform: translateY(-1px);
      }
      .tep-btn-secondary:active { transform: scale(0.97); }

      /* Cancel — red outline pill */
      .tep-btn-cancel {
        background: rgba(239,68,68,0.06);
        border: 1px solid rgba(239,68,68,0.25);
        color: #f87171;
        border-radius: 10px;
      }
      .tep-btn-cancel:hover { background: rgba(239,68,68,0.13); border-color: rgba(239,68,68,0.45); }
      .tep-btn-cancel:active { transform: scale(0.97); }

      .tep-btn:disabled {
        opacity: 0.35; cursor: not-allowed;
        transform: none !important; box-shadow: none !important;
      }
      .tep-btn:disabled::after { display: none; }

      /* ── PROGRESS SECTION ─────────────────────────────────── */
      .tep-progress-section {
        display: flex; flex-direction: column; gap: 7px;
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.05);
        border-radius: 10px; padding: 9px 10px;
      }
      .tep-progress-top {
        display: flex; align-items: center; gap: 7px;
      }
      .tep-spinner {
        width: 12px; height: 12px;
        border: 2px solid rgba(96,165,250,0.2);
        border-top-color: #60a5fa;
        border-radius: 50%;
        animation: tepSpin 0.7s linear infinite;
        flex-shrink: 0;
      }
      @keyframes tepSpin { to { transform: rotate(360deg); } }
      .tep-progress-text {
        flex: 1; font-size: 10px; font-weight: 700; color: #60a5fa;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .tep-progress-pct {
        font-size: 10px; font-weight: 900; color: #00d4aa;
        flex-shrink: 0; font-variant-numeric: tabular-nums;
      }
      .tep-progress-track {
        height: 3px; background: rgba(255,255,255,0.06);
        border-radius: 2px; overflow: hidden;
      }
      .tep-progress-fill {
        height: 100%; border-radius: 2px;
        background: linear-gradient(90deg, #00d4aa, #60a5fa);
        box-shadow: 0 0 8px rgba(0,212,170,0.6);
        transition: width 0.5s cubic-bezier(0.4,0,0.2,1);
        width: 0%;
      }
      .tep-progress-sub {
        font-size: 9px; color: #4a5568; font-weight: 600;
      }

      /* ── RESULT TOAST ─────────────────────────────────────── */
      .tep-result {
        font-size: 10px; font-weight: 700; color: #00d4aa;
        text-align: center; padding: 6px 8px;
        background: rgba(0,212,170,0.07);
        border: 1px solid rgba(0,212,170,0.18);
        border-radius: 8px;
        animation: tepFadeIn 0.3s ease;
      }
      @keyframes tepFadeIn {
        from { opacity:0; transform: translateY(6px); }
        to   { opacity:1; transform: none; }
      }

      /* ── DRAG HINT ────────────────────────────────────────── */
      .tep-drag-hint {
        display: flex; align-items: center; justify-content: center; gap: 3px;
        font-size: 9px; color: #1e2a3a;
        padding-bottom: 1px;
      }
      .tep-drag-dots {
        display: flex; gap: 3px;
      }
      .tep-drag-dots span {
        width: 3px; height: 3px; border-radius: 50%;
        background: #1f2d3d;
        display: block;
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
          <div class="tep-logo">📦</div>
          <div style="flex:1;min-width:0;">
            <div class="tep-title">Temu Exporter</div>
          </div>
          <div class="tep-header-actions">
            <button class="tep-icon-btn" id="tepMinBtn" title="Minimize">—</button>
          </div>
          <div class="tep-divider-h"></div>
        </div>

        <div class="tep-body">
          <div class="tep-status ready" id="tepStatus">
            <span class="tep-status-dot"></span>
            <span id="tepStatusText">Ready to export</span>
          </div>

          <button class="tep-btn tep-btn-primary" id="tepExportToday">
            ⚡ Export Today
          </button>
          <button class="tep-btn tep-btn-secondary" id="tepSheetsToday">
            📊 Sheets Sync Today
          </button>

          <div class="tep-progress-section" id="tepProgressSection" style="display:none;">
            <div class="tep-progress-top">
              <div class="tep-spinner"></div>
              <span class="tep-progress-text" id="tepProgressText">Scanning...</span>
              <span class="tep-progress-pct" id="tepProgressPct">0%</span>
            </div>
            <div class="tep-progress-track">
              <div class="tep-progress-fill" id="tepProgressFill"></div>
            </div>
            <div class="tep-progress-sub" id="tepProgressSub"></div>
            <button class="tep-btn tep-btn-cancel" id="tepCancel">✕ Cancel Export</button>
          </div>

          <div id="tepResult" class="tep-result" style="display:none;"></div>

          <div class="tep-drag-hint">
            <div class="tep-drag-dots">
              <span></span><span></span><span></span>
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>
      </div>
    `;
    return panel;
  }


  // ── Panel state helpers ────────────────────────────────────────────────────
  function setStatus(text, cls) {
    const el  = document.getElementById('tepStatus');
    const txt = document.getElementById('tepStatusText');
    if (!el) return;
    el.className = 'tep-status ' + (cls || 'idle');
    if (txt) txt.textContent = text;
  }

  function setButtons(disabled) {
    ['tepExportToday', 'tepSheetsToday'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = disabled;
    });
  }

  function showProgress(show) {
    const sec = document.getElementById('tepProgressSection');
    if (sec) sec.style.display = show ? 'flex' : 'none';
    if (!show) {
      updateProgress(0, '');
    }
  }

  function updateProgress(pct, label, sub) {
    const fill   = document.getElementById('tepProgressFill');
    const txt    = document.getElementById('tepProgressText');
    const pctEl  = document.getElementById('tepProgressPct');
    const subEl  = document.getElementById('tepProgressSub');
    if (fill)  fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (txt)   txt.textContent  = label || '';
    if (pctEl) pctEl.textContent= Math.round(pct) + '%';
    if (subEl && sub !== undefined) subEl.textContent = sub;
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
        updateProgress(pagePct + 5, `Scanning page ${page} / ${totalPages || '?'}...`, `${scraped||0} orders found so far`);
        setStatus('Scanning pages...', 'running');
      } else {
        updateProgress(pagePct + 10, `Extracting orders...`, `${scraped||0} orders collected`);
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
    if (!isOnOrdersPage()) {
      setStatus('ℹ️ Go to Orders tab to export', '');
      panel.style.display = 'none';
    }

    // ── Watch for SPA navigation using URL polling (lightweight — no DOM scanning) ──
    let _lastUrl = window.location.href;
    setInterval(() => {
      const currentUrl = window.location.href;
      if (currentUrl === _lastUrl) return; // URL hasn't changed — do nothing
      _lastUrl = currentUrl;
      // URL changed: update panel visibility and status
      if (isOnOrdersPage()) {
        panel.style.display = '';
        if (!running) setStatus('✅ Orders page ready', 'ready');
      } else {
        // Hide panel on non-order pages (e.g. product listings, settings)
        panel.style.display = 'none';
      }
    }, 3000); // Check every 3 seconds — negligible CPU cost
  }

  // ── Wait for DOM ready ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Small delay so page layout is stable
    setTimeout(init, 1500);
  }

})();
