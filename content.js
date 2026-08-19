// ═══════════════════════════════════════════════════════════════════════════════
// Temu Order Exporter — Content Script v8.5
// Uses Shadow DOM for full CSS isolation from Temu page styles
// ═══════════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const PANEL_ID = '__temu_exporter_host__';

  // ── Prevent double-injection ───────────────────────────────────────────────
  if (document.getElementById(PANEL_ID)) return;
  if (!window.location.hostname.includes('seller.temu.com')) return;

  // ── State ──────────────────────────────────────────────────────────────────
  let running     = false;
  let minimized   = false;
  let dragging    = false;
  let dragOffX    = 0, dragOffY = 0;

  // ── Today's date range ────────────────────────────────────────────────────
  function getTodayRange() {
    const now  = new Date();
    const from = new Date(now); from.setHours(0, 0, 0, 0);
    const to   = new Date(now); to.setHours(23, 59, 59, 999);
    return { fromDate: from.toISOString(), toDate: to.toISOString() };
  }

  // ── URL-based page check (zero DOM overhead) ──────────────────────────────
  function isOnOrdersPage() {
    const url = window.location.href;
    return url.includes('seller.temu.com') &&
      (url.includes('order') || url.includes('manage') || url.includes('shipped'));
  }

  // ── CSS (runs inside Shadow DOM — completely isolated) ────────────────────
  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :host {
      all: initial;
      position: fixed !important;
      bottom: 28px !important;
      right: 28px !important;
      z-index: 2147483647 !important;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;
      -webkit-font-smoothing: antialiased;
    }

    /* ── CARD ───────────────────────────────────────────────── */
    .card {
      background: #0d1117;
      border: 1px solid rgba(0, 212, 170, 0.25);
      border-radius: 16px;
      width: 228px;
      max-height: 400px;
      overflow: hidden;
      contain: paint;  /* clips ALL child visual overflow — glows, shadows, animations */
      box-shadow:
        0 0 0 1px rgba(0,212,170,0.07),
        0 12px 40px rgba(0,0,0,0.85),
        0 0 60px rgba(0,212,170,0.05),
        inset 0 1px 0 rgba(255,255,255,0.04);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-font-smoothing: antialiased;
      transition: width 0.25s ease, max-height 0.3s ease, border-radius 0.25s ease;
    }

    /* ── MINIMIZED ─────────────────────────────────────────── */
    /* 'minimized' class is on .card itself, so use .card.minimized selectors */
    .card.minimized {
      width: 44px; max-height: 44px; border-radius: 50%;
      border-color: rgba(0,212,170,0.55);
      box-shadow: 0 4px 24px rgba(0,0,0,0.8), 0 0 28px rgba(0,212,170,0.22);
      cursor: pointer;
    }
    .card.minimized .body,
    .card.minimized .title-wrap,
    .card.minimized .actions,
    .card.minimized .header-line { display: none !important; }
    .card.minimized .header {
      height: 44px; padding: 0; justify-content: center; cursor: pointer;
    }
    .card.minimized .logo {
      width: 26px; height: 26px; border-radius: 50%;
      background: rgba(0,212,170,0.12);
      border-color: rgba(0,212,170,0.4);
    }
    .card.minimized .logo svg { width: 16px; height: 16px; }

    /* ── HEADER ─────────────────────────────────────────────── */
    .header {
      display: flex; align-items: center; gap: 8px;
      padding: 11px 12px 10px;
      cursor: grab; position: relative;
    }
    .header:active { cursor: grabbing; }
    .header-line {
      position: absolute; bottom: 0; left: 12px; right: 12px;
      height: 1px;
      background: linear-gradient(90deg, rgba(0,212,170,0.5) 0%, transparent 80%);
    }
    .logo {
      width: 26px; height: 26px; border-radius: 7px;
      background: linear-gradient(135deg, rgba(0,212,170,0.15), rgba(0,184,148,0.08));
      border: 1px solid rgba(0,212,170,0.28);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; flex-shrink: 0; line-height: 1;
    }
    .title-wrap { flex: 1; min-width: 0; }
    .title {
      font-size: 12px; font-weight: 800; color: #f0f6ff;
      letter-spacing: -0.3px; line-height: 1;
      white-space: nowrap;
    }
    .version { font-size: 8px; font-weight: 500; color: #2d3f52; margin-top: 2px; }
    .actions { display: flex; gap: 3px; }
    .icon-btn {
      all: unset;
      width: 20px; height: 20px; border-radius: 5px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.07);
      color: #4a5568; font-size: 13px; font-weight: 700;
      cursor: pointer; font-family: inherit;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s, color 0.15s; line-height: 1;
    }
    .icon-btn:hover { background: rgba(255,255,255,0.1); color: #e2e8f0; }

    /* ── BODY ────────────────────────────────────────────────── */
    .body { padding: 11px 11px 10px; display: flex; flex-direction: column; gap: 7px; }

    /* ── STATUS PILL ────────────────────────────────────────── */
    .status-pill {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 8px; border-radius: 8px;
      font-size: 10px; font-weight: 600; font-family: inherit;
      transition: all 0.25s;
    }
    .status-dot {
      width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
    }
    .s-idle   { background: rgba(255,255,255,0.03); color: #4a5568; }
    .s-idle   .status-dot { background: #2d3748; }
    .s-ready  { background: rgba(0,212,170,0.08); color: #00d4aa; }
    .s-ready  .status-dot { background: #00d4aa; box-shadow: 0 0 8px rgba(0,212,170,0.9); animation: dot-pulse 2s ease-in-out infinite; }
    .s-running{ background: rgba(96,165,250,0.08); color: #93c5fd; }
    .s-running .status-dot { background: #60a5fa; box-shadow: 0 0 8px rgba(96,165,250,0.9); animation: dot-pulse 0.9s ease-in-out infinite; }
    .s-done   { background: rgba(0,212,170,0.1);  color: #00d4aa; }
    .s-done   .status-dot { background: #00d4aa; }
    .s-error  { background: rgba(248,113,113,0.08); color: #fca5a5; }
    .s-error  .status-dot { background: #f87171; }
    @keyframes dot-pulse {
      0%,100% { opacity:1; transform:scale(1); }
      50%     { opacity:0.4; transform:scale(0.75); }
    }

    /* ── BUTTONS ─────────────────────────────────────────────── */
    .btn {
      all: unset;
      box-sizing: border-box; /* CRITICAL: all:unset resets box-sizing → padding causes overflow */
      -webkit-appearance: none; /* restore button click behavior */
      display: flex; align-items: center; justify-content: center; gap: 7px;
      width: 100%; height: 36px; padding: 0 12px;
      border-radius: 10px; cursor: pointer;
      font-size: 11px; font-weight: 800; font-family: inherit;
      letter-spacing: 0.05px; white-space: nowrap;
      position: relative; overflow: hidden;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    /* Shimmer sweep */
    .btn::after {
      content: '';
      position: absolute; top: 0; left: -70%; width: 45%; height: 100%;
      background: linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.18) 50%, transparent 100%);
      animation: sweep 3.5s ease-in-out infinite;
    }
    @keyframes sweep { 0%{left:-70%} 45%,100%{left:120%} }

    .btn-primary {
      background: linear-gradient(130deg, #00d4aa 0%, #00ba96 55%, #00a882 100%);
      color: #00170f;
      box-shadow: 0 0 8px rgba(0,212,170,0.2), 0 3px 10px rgba(0,0,0,0.4);
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 0 14px rgba(0,212,170,0.3), 0 5px 16px rgba(0,0,0,0.45);
    }
    .btn-primary:active { transform: scale(0.97); }

    .btn-outline {
      background: rgba(0,212,170,0.06);
      border: 1px solid rgba(0,212,170,0.24);
      color: #00d4aa;
    }
    .btn-outline:hover {
      background: rgba(0,212,170,0.12);
      border-color: rgba(0,212,170,0.45);
      transform: translateY(-1px);
    }
    .btn-outline:active { transform: scale(0.97); }

    .btn-cancel {
      all: unset;
      box-sizing: border-box;      /* fix: all:unset resets to content-box → overflow */
      -webkit-appearance: none;    /* fix: restore proper button click behavior */
      display: flex; align-items: center; justify-content: center; gap: 5px;
      width: 100%; height: 30px; padding: 0 10px;
      border-radius: 8px; cursor: pointer;
      font-size: 10px; font-weight: 700; font-family: inherit;
      background: rgba(239,68,68,0.07);
      border: 1px solid rgba(239,68,68,0.22);
      color: #fca5a5;
      transition: background 0.15s, border-color 0.15s;
    }
    .btn-cancel:hover { background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.4); }

    .btn:disabled, .btn[disabled] {
      opacity: 0.35; cursor: not-allowed;
      transform: none !important; box-shadow: none !important;
    }
    .btn[disabled]::after { display: none; }

    /* ── PROGRESS CARD ───────────────────────────────────────── */
    .progress-card {
      background: rgba(255,255,255,0.025);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 10px; padding: 9px 10px 8px;
      display: flex; flex-direction: column; gap: 7px;
    }
    .progress-row {
      display: flex; align-items: center; gap: 7px;
    }
    .spinner {
      width: 11px; height: 11px; flex-shrink: 0;
      border: 2px solid rgba(96,165,250,0.18);
      border-top-color: #60a5fa;
      border-radius: 50%;
      animation: spin 0.65s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .progress-label {
      flex: 1; font-size: 10px; font-weight: 700; font-family: inherit;
      color: #93c5fd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .progress-pct {
      font-size: 10px; font-weight: 900; font-family: inherit;
      color: #00d4aa; font-variant-numeric: tabular-nums; flex-shrink: 0;
    }
    .progress-track {
      height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden;
    }
    .progress-bar {
      height: 100%; border-radius: 2px;
      background: linear-gradient(90deg, #00d4aa, #60a5fa);
      box-shadow: 0 0 10px rgba(0,212,170,0.65);
      transition: width 0.45s cubic-bezier(0.4,0,0.2,1);
      width: 0%;
    }
    .progress-sub {
      font-size: 9px; font-weight: 600; font-family: inherit; color: #374151;
    }

    /* ── RESULT TOAST ───────────────────────────────────────── */
    .result-toast {
      background: rgba(0,212,170,0.08);
      border: 1px solid rgba(0,212,170,0.2);
      border-radius: 8px; padding: 7px 9px;
      font-size: 10px; font-weight: 700; font-family: inherit;
      color: #00d4aa; text-align: center;
      animation: toast-in 0.3s ease;
    }
    @keyframes toast-in {
      from { opacity:0; transform:translateY(5px); }
      to   { opacity:1; transform:none; }
    }

    /* ── DRAG DOTS ───────────────────────────────────────────── */
    .drag-dots {
      display: flex; justify-content: center; gap: 4px; padding-top: 1px;
    }
    .drag-dot {
      width: 3px; height: 3px; border-radius: 50%; background: #1a2537;
    }
  `;

  // ── HTML Template ─────────────────────────────────────────────────────────
  const HTML = `
    <div class="card">
      <div class="header" id="hdr">
        <div class="logo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L7 8H10V13H14V8H17L12 2Z" fill="#00d4aa"/>
            <rect x="4" y="15" width="16" height="1.5" rx="0.5" fill="#00d4aa"/>
            <rect x="4" y="18.5" width="16" height="1.5" rx="0.5" fill="#00d4aa"/>
            <rect x="4" y="22" width="16" height="1.5" rx="0.5" fill="#00d4aa"/>
            <rect x="4" y="15" width="1.5" height="8.5" rx="0.5" fill="#00d4aa"/>
            <rect x="11.25" y="15" width="1.5" height="8.5" rx="0.5" fill="#00d4aa"/>
            <rect x="18.5" y="15" width="1.5" height="8.5" rx="0.5" fill="#00d4aa"/>
          </svg>
        </div>
        <div class="title-wrap">
          <div class="title">Temu Exporter</div>
          <div class="version">v8.7 · Quick Export</div>
        </div>
        <div class="actions">
          <button class="icon-btn" id="minBtn">—</button>
        </div>
        <div class="header-line"></div>
      </div>
      <div class="body">
        <div class="status-pill s-ready" id="statusPill">
          <span class="status-dot"></span>
          <span id="statusTxt">Ready to export</span>
        </div>

        <button class="btn btn-primary" id="btnExport">⚡ Export Today</button>
        <button class="btn btn-outline" id="btnSheets">📊 Sheets Sync Today</button>

        <div class="progress-card" id="progressCard" style="display:none;">
          <div class="progress-row">
            <div class="spinner"></div>
            <span class="progress-label" id="progLabel">Scanning...</span>
            <span class="progress-pct" id="progPct">0%</span>
          </div>
          <div class="progress-track"><div class="progress-bar" id="progBar"></div></div>
          <div class="progress-sub" id="progSub"></div>
          <button class="btn-cancel" id="btnCancel">✕ Cancel Export</button>
        </div>

        <div class="result-toast" id="resultToast" style="display:none;"></div>
        <div class="drag-dots">
          <span class="drag-dot"></span><span class="drag-dot"></span><span class="drag-dot"></span>
          <span class="drag-dot"></span><span class="drag-dot"></span><span class="drag-dot"></span>
        </div>
      </div>
    </div>
  `;

  // ── Build host + shadow root ───────────────────────────────────────────────
  const host = document.createElement('div');
  host.id = PANEL_ID;
  // Host element needs fixed positioning set inline (before shadow attaches)
  Object.assign(host.style, {
    position: 'fixed', bottom: '28px', right: '28px',
    zIndex: '2147483647', userSelect: 'none', lineHeight: 'normal'
  });

  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  shadow.appendChild(styleEl);

  const wrapper = document.createElement('div');
  wrapper.innerHTML = HTML;
  shadow.appendChild(wrapper);

  document.body.appendChild(host);

  // ── Shadow DOM element helpers ────────────────────────────────────────────
  const $ = (id) => shadow.getElementById(id);

  // ── UI state functions ────────────────────────────────────────────────────
  function setStatus(text, cls) {
    const pill = $('statusPill');
    const txt  = $('statusTxt');
    if (!pill) return;
    pill.className = 'status-pill ' + (cls || 's-idle');
    if (txt) txt.textContent = text;
  }

  function setButtons(disabled) {
    [$('btnExport'), $('btnSheets')].forEach(b => {
      if (b) { b.disabled = disabled; if (disabled) b.setAttribute('disabled',''); else b.removeAttribute('disabled'); }
    });
  }

  function showProgress(show) {
    const card = $('progressCard');
    if (card) card.style.display = show ? 'flex' : 'none';
    if (!show) updateProgress(0, '', '');
  }

  function updateProgress(pct, label, sub) {
    const bar   = $('progBar');
    const lbl   = $('progLabel');
    const pctEl = $('progPct');
    const subEl = $('progSub');
    if (bar)   bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (lbl)   lbl.textContent = label || '';
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
    if (subEl) subEl.textContent = sub || '';
  }

  function showResult(text) {
    const el = $('resultToast');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 6000);
  }

  // ── Start export ──────────────────────────────────────────────────────────
  function startExport(sheetsMode) {
    if (running) return;
    running = true;
    setButtons(true);
    showProgress(true);
    const { fromDate, toDate } = getTodayRange();
    setStatus('Scanning pages...', 's-running');
    updateProgress(5, 'Initializing...', '');
    chrome.runtime.sendMessage({
      type: sheetsMode ? 'quickSheetsSync' : 'quickExport',
      fromDate, toDate
    });
  }

  function cancelExport() {
    // Reset UI immediately — don't wait for background response
    running = false;
    setButtons(false);
    showProgress(false);
    setStatus('Cancelling...', 's-running');

    // Send cancel to background — try-catch in case service worker is sleeping
    try {
      chrome.runtime.sendMessage({ type: 'cancelExport' }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[Temu Exporter] Cancel message error:', chrome.runtime.lastError.message);
        }
        setStatus('Export cancelled', 's-error');
        setTimeout(() => setStatus('Ready to export', 's-ready'), 3000);
      });
    } catch (err) {
      console.warn('[Temu Exporter] cancelExport failed:', err);
      setStatus('Export cancelled', 's-error');
      setTimeout(() => setStatus('Ready to export', 's-ready'), 3000);
    }
  }

  // ── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'autoProgress') {
      const { stage, page, totalPages, scraped } = msg;
      const pct = totalPages > 0 ? (page / totalPages) * 85 : 0;
      if (stage === 'navigating') {
        updateProgress(pct + 5, `Scanning page ${page} / ${totalPages || '?'}`, `${scraped || 0} orders found so far`);
      } else {
        updateProgress(pct + 10, `Extracting orders...`, `${scraped || 0} orders collected`);
      }
    }
    if (msg.type === 'autoDone' || msg.type === 'done') {
      running = false; setButtons(false); showProgress(false);
      const count = msg.ordersFound || 0;
      updateProgress(100, 'Complete!', '');
      setStatus(`Done! ${count} orders exported`, 's-done');
      showResult(`✅ ${count} orders exported!`);
      setTimeout(() => setStatus('Ready to export', 's-ready'), 7000);
    }
    if (msg.type === 'noData') {
      running = false; setButtons(false); showProgress(false);
      setStatus('No orders found in range', 's-error');
      setTimeout(() => setStatus('Ready to export', 's-ready'), 4000);
    }
    if (msg.type === 'error') {
      running = false; setButtons(false); showProgress(false);
      setStatus((msg.message || 'Error').slice(0, 48), 's-error');
      setTimeout(() => setStatus('Ready to export', 's-ready'), 5000);
    }
    if (msg.type === 'cancelled') {
      running = false; setButtons(false); showProgress(false);
      setStatus('Cancelled', 's-error');
      setTimeout(() => setStatus('Ready to export', 's-ready'), 3000);
    }
  });

  // ── Dragging (on host element directly) ──────────────────────────────────
  const hdr = $('hdr');
  if (hdr) {
    hdr.addEventListener('mousedown', (e) => {
      if (e.target.closest('.icon-btn')) return;
      dragging = true;
      const rect = host.getBoundingClientRect();
      dragOffX = e.clientX - rect.left;
      dragOffY = e.clientY - rect.top;
      host.style.transition = 'none';
    });
  }
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    let x = Math.max(0, Math.min(window.innerWidth  - host.offsetWidth,  e.clientX - dragOffX));
    let y = Math.max(0, Math.min(window.innerHeight - host.offsetHeight, e.clientY - dragOffY));
    host.style.right = 'auto'; host.style.bottom = 'auto';
    host.style.left  = x + 'px'; host.style.top = y + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; host.style.transition = ''; });

  // ── Minimize ──────────────────────────────────────────────────────────────
  const cardEl = wrapper.firstElementChild; // the .card div

  function setMinimized(val) {
    minimized = val;
    cardEl.classList.toggle('minimized', minimized);
    const mb = $('minBtn');
    if (mb) mb.textContent = minimized ? '+' : '—';
  }

  // ── ALL button events via single shadow-root delegation ───────────────────
  // Using delegation on shadow root is more reliable than individual listeners
  // in Shadow DOM — catches clicks even through composed event paths
  shadow.addEventListener('click', (e) => {
    // Find the actual button that was clicked (handle clicks on child elements too)
    const btn = e.target.closest('button');
    if (!btn) {
      // Click on card background: expand if minimized
      if (minimized) setMinimized(false);
      return;
    }

    const id = btn.id;
    e.stopPropagation(); // prevent Temu page handlers

    if (id === 'minBtn') {
      setMinimized(!minimized);
    } else if (id === 'btnExport') {
      if (!minimized && !running) startExport(false);
      else if (minimized) setMinimized(false);
    } else if (id === 'btnSheets') {
      if (!minimized && !running) startExport(true);
      else if (minimized) setMinimized(false);
    } else if (id === 'btnCancel') {
      // Visual flash to confirm click registered
      btn.style.background = 'rgba(239,68,68,0.25)';
      setTimeout(() => { btn.style.background = ''; }, 200);
      cancelExport();
    }
  }, true); // useCapture:true — fires before any other handler

  // ── SPA navigation watcher (URL-based, 3s poll) ───────────────────────────
  let _lastUrl = window.location.href;
  setInterval(() => {
    const cur = window.location.href;
    if (cur === _lastUrl) return;
    _lastUrl = cur;
    host.style.display = isOnOrdersPage() ? '' : 'none';
    if (isOnOrdersPage() && !running) setStatus('Ready to export', 's-ready');
    // Check if navigated to task detail page
    if (isOnTaskDetailPage()) initLabelBatchExport();
  }, 3000);

  // Initial visibility
  if (!isOnOrdersPage()) host.style.display = 'none';

})();

// ═══════════════════════════════════════════════════════════════════════════════
// LABEL BATCH EXPORT — Detects task-detail page and shows export modal
// Runs as separate IIFE to stay independent from the floating widget above
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const MODAL_ID = '__temu_label_batch_modal__';

  function isOnTaskDetailPage() {
    return window.location.href.includes('seller.temu.com') &&
      /task[-_]?detail|taskDetail|task_detail/i.test(window.location.href);
  }

  function extractTaskId() {
    // Try URL path: /task-detail/TK-xxxxxx or ?taskId=TK-xxx
    const m = window.location.href.match(/TK-[\w\d]+/i) ||
              window.location.href.match(/task[-_]?id[=\/]([\w\d-]+)/i);
    return m ? m[0] : '';
  }

  // ── Scrape orders from the "View details" table ───────────────────────────
  function scrapeOrders(taskId) {
    const orders = [];
    const today  = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Find table — try multiple selectors since Temu uses dynamic class names
    const table = document.querySelector('table') ||
                  document.querySelector('[class*="table"]');
    if (!table) return [];

    // Get header columns to build index map
    const thEls  = [...(table.querySelectorAll('thead th') || table.querySelectorAll('th'))];
    const headers = thEls.map(th => th.textContent.toLowerCase().trim());
    const idx = {
      order:    headers.findIndex(h => h.includes('order')),
      pkg:      headers.findIndex(h => h.includes('package')),
      tracking: headers.findIndex(h => h.includes('tracking')),
      service:  headers.findIndex(h => h.includes('service')),
      cost:     headers.findIndex(h => h.includes('cost') || h.includes('shipping cost')),
    };

    // Fallback indices if headers not found
    if (idx.order    < 0) idx.order    = 0;
    if (idx.pkg      < 0) idx.pkg      = 1;
    if (idx.tracking < 0) idx.tracking = 8;
    if (idx.service  < 0) idx.service  = 6;
    if (idx.cost     < 0) idx.cost     = 7;

    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(tr => {
      const cells = [...tr.querySelectorAll('td')];
      if (cells.length < 3) return;

      const getText = (i) => (cells[i]?.textContent || '').replace(/\s+/g, ' ').trim();

      // Extract Order ID (PO-xxx pattern)
      const orderCell = getText(idx.order);
      const orderMatch = orderCell.match(/PO-[\d-]+/);
      const orderNumber = orderMatch ? orderMatch[0] : orderCell.split('\n')[0].trim();
      if (!orderNumber) return;

      // Extract Package ID (PK-xxx pattern)
      const pkgCell = getText(idx.pkg);
      const pkgMatch = pkgCell.match(/PK-[\w\d]+/);
      const packageId = pkgMatch ? pkgMatch[0] : pkgCell.split('\n')[0].trim();

      orders.push({
        orderNumber,
        packageId,
        trackingNumber: getText(idx.tracking),
        shippingService: getText(idx.service),
        shippingCost: getText(idx.cost).replace(/\$/g, '').trim(),
        labelDate: today,
        taskId
      });
    });

    return orders;
  }

  // ── Wait for table to appear ──────────────────────────────────────────────
  function waitForTable(maxMs = 10000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const tbl = document.querySelector('table') || document.querySelector('[class*="table"]');
        const rows = tbl?.querySelectorAll('tbody tr');
        if (rows && rows.length > 0) { resolve(true); return; }
        if (Date.now() - start > maxMs) { resolve(false); return; }
        setTimeout(check, 600);
      };
      check();
    });
  }

  // ── Build and show the export modal ──────────────────────────────────────
  function showModal(orders, taskId) {
    // Remove existing modal
    document.getElementById(MODAL_ID)?.remove();

    const orderCount = orders.length;
    const previewOrders = orders.slice(0, 3);
    const escapeHtml = value => String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.style.cssText = `
      position: fixed; top: 24px; right: 24px; z-index: 2147483646;
      width: 340px;
      background: rgba(10,14,22,0.97);
      backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(0,212,170,0.3);
      border-radius: 16px;
      box-shadow: 0 0 0 1px rgba(0,212,170,0.07), 0 20px 60px rgba(0,0,0,0.85), 0 0 80px rgba(0,212,170,0.06);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px; color: #f1f5f9;
      overflow: hidden;
      animation: lbSlideIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
    `;

    modal.innerHTML = `
      <style>
        @keyframes lbSlideIn { from { opacity:0; transform: translateY(-16px) scale(0.95); } to { opacity:1; transform: none; } }
        #${MODAL_ID} * { box-sizing: border-box; margin: 0; padding: 0; }
        #${MODAL_ID} .lb-header { display: flex; align-items: center; gap: 10px; padding: 14px 16px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(0,212,170,0.04); }
        #${MODAL_ID} .lb-icon { width: 36px; height: 36px; border-radius: 10px; background: rgba(0,212,170,0.12); border: 1px solid rgba(0,212,170,0.3); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        #${MODAL_ID} .lb-title { font-size: 13px; font-weight: 800; color: #f1f5f9; letter-spacing: -0.3px; }
        #${MODAL_ID} .lb-sub { font-size: 10px; color: #64748b; font-weight: 600; margin-top: 1px; }
        #${MODAL_ID} .lb-close { margin-left: auto; width: 26px; height: 26px; border-radius: 6px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); cursor: pointer; display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 14px; font-family: inherit; transition: background 0.15s; }
        #${MODAL_ID} .lb-close:hover { background: rgba(255,255,255,0.09); color: #f1f5f9; }
        #${MODAL_ID} .lb-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
        #${MODAL_ID} .lb-count-row { display: flex; align-items: center; gap: 8px; background: rgba(0,212,170,0.07); border: 1px solid rgba(0,212,170,0.18); border-radius: 10px; padding: 10px 12px; }
        #${MODAL_ID} .lb-count-num { font-size: 22px; font-weight: 900; color: #00d4aa; font-variant-numeric: tabular-nums; line-height: 1; }
        #${MODAL_ID} .lb-count-label { font-size: 11px; color: #94a3b8; font-weight: 600; }
        #${MODAL_ID} .lb-task-id { font-size: 9px; color: #475569; font-weight: 700; letter-spacing: 0.3px; font-family: monospace; }
        #${MODAL_ID} .lb-preview { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; overflow: hidden; }
        #${MODAL_ID} .lb-preview-row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 10px; }
        #${MODAL_ID} .lb-preview-row:last-child { border-bottom: none; }
        #${MODAL_ID} .lb-order { color: #60a5fa; font-weight: 700; font-family: monospace; flex: 1; font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #${MODAL_ID} .lb-track { color: #475569; font-size: 9px; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
        #${MODAL_ID} .lb-more { padding: 6px 10px; font-size: 9px; color: #475569; font-weight: 600; text-align: center; }
        #${MODAL_ID} .lb-format-row { display: flex; gap: 6px; }
        #${MODAL_ID} .lb-fmt-btn { flex: 1; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; font-size: 11px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all 0.15s; }
        #${MODAL_ID} .lb-fmt-btn.active { background: rgba(0,212,170,0.12); border-color: rgba(0,212,170,0.4); color: #00d4aa; }
        #${MODAL_ID} .lb-fmt-btn:hover:not(.active) { background: rgba(255,255,255,0.07); color: #f1f5f9; }
        #${MODAL_ID} .lb-export-btn { width: 100%; height: 40px; border-radius: 10px; background: linear-gradient(130deg, #00d4aa 0%, #00b894 100%); border: none; color: #00170f; font-size: 12px; font-weight: 900; font-family: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px; box-sizing: border-box; transition: opacity 0.15s, transform 0.15s; letter-spacing: 0.2px; }
        #${MODAL_ID} .lb-export-btn:hover { opacity: 0.92; transform: translateY(-1px); }
        #${MODAL_ID} .lb-export-btn:active { transform: scale(0.97); }
        #${MODAL_ID} .lb-export-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
        #${MODAL_ID} .lb-status { font-size: 10px; font-weight: 600; text-align: center; color: #64748b; min-height: 16px; }
        #${MODAL_ID} .lb-status.success { color: #00d4aa; }
        #${MODAL_ID} .lb-status.error { color: #f87171; }
      </style>

      <div class="lb-header">
        <div class="lb-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="3" width="20" height="18" rx="3" stroke="#00d4aa" stroke-width="1.5"/>
            <path d="M8 8h8M8 12h8M8 16h5" stroke="#00d4aa" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M17 15l2 2 3-3" stroke="#00d4aa" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <div>
          <div class="lb-title">Label Batch Export</div>
          <div class="lb-sub">Task Detail Page Detected</div>
        </div>
        <button class="lb-close" id="lbCloseBtn">✕</button>
      </div>

      <div class="lb-body">
        <div class="lb-count-row">
          <div>
            <div class="lb-count-num">${orderCount}</div>
            <div class="lb-count-label">Orders detected in this batch</div>
          </div>
          ${taskId ? `<div style="margin-left:auto"><div class="lb-task-id">${escapeHtml(taskId)}</div></div>` : ''}
        </div>

        ${orderCount > 0 ? `
        <div class="lb-preview">
          ${previewOrders.map(o => `
            <div class="lb-preview-row">
              <span class="lb-order">${escapeHtml(o.orderNumber)}</span>
              <span class="lb-track">${escapeHtml(o.trackingNumber || '—')}</span>
              <span style="font-size:9px;color:#475569;white-space:nowrap">${o.shippingCost ? '$' + escapeHtml(o.shippingCost) : ''}</span>
            </div>
          `).join('')}
          ${orderCount > 3 ? `<div class="lb-more">+${orderCount - 3} more orders</div>` : ''}
        </div>
        ` : '<div style="text-align:center;font-size:11px;color:#ef4444;padding:8px">⚠ No orders detected in table</div>'}

        <div class="lb-format-row">
          <button class="lb-fmt-btn active" id="lbFmtXlsx">📊 Excel</button>
          <button class="lb-fmt-btn" id="lbFmtCsv">📄 CSV</button>
        </div>

        <button class="lb-export-btn" id="lbExportBtn" ${orderCount === 0 ? 'disabled' : ''}>
          ⬇ Export ${orderCount} Orders
        </button>

        <div class="lb-status" id="lbStatus"></div>
      </div>
    `;

    document.body.appendChild(modal);

    // ── Wire events ──────────────────────────────────────────────────────────
    let selectedFormat = 'xlsx';

    document.getElementById('lbCloseBtn').onclick = () => modal.remove();

    const xlsxBtn = document.getElementById('lbFmtXlsx');
    const csvBtn  = document.getElementById('lbFmtCsv');
    xlsxBtn.onclick = () => { selectedFormat = 'xlsx'; xlsxBtn.classList.add('active'); csvBtn.classList.remove('active'); };
    csvBtn.onclick  = () => { selectedFormat = 'csv';  csvBtn.classList.add('active'); xlsxBtn.classList.remove('active'); };

    document.getElementById('lbExportBtn').onclick = () => {
      const btn = document.getElementById('lbExportBtn');
      const statusEl = document.getElementById('lbStatus');
      btn.disabled = true;
      btn.textContent = '⏳ Exporting...';
      statusEl.textContent = 'Sending to background...';
      statusEl.className = 'lb-status';

      try {
        chrome.runtime.sendMessage({ type: 'exportLabelBatch', orders, taskId, format: selectedFormat }, () => {
          if (chrome.runtime.lastError) {
            statusEl.textContent = '✗ Error: ' + chrome.runtime.lastError.message;
            statusEl.className = 'lb-status error';
            btn.disabled = false;
            btn.innerHTML = '⬇ Export ' + orderCount + ' Orders';
          } else {
            statusEl.textContent = '✓ Exported! Check your Downloads folder.';
            statusEl.className = 'lb-status success';
            btn.innerHTML = '✓ Done!';
            setTimeout(() => { modal.remove(); }, 4000);
          }
        });
      } catch (e) {
        statusEl.textContent = '✗ Failed: ' + e.message;
        statusEl.className = 'lb-status error';
        btn.disabled = false;
        btn.innerHTML = '⬇ Retry Export';
      }
    };
  }

  // ── Main init function ────────────────────────────────────────────────────
  async function initLabelBatchExport() {
    if (!isOnTaskDetailPage()) return;
    if (document.getElementById(MODAL_ID)) return; // already shown

    const taskId = extractTaskId();

    // Wait for page table to render
    const ready = await waitForTable(12000);
    if (!ready) {
      // Show modal even if table not found (0 orders)
      showModal([], taskId);
      return;
    }

    // Extra wait for React to finish rendering rows
    await new Promise(r => setTimeout(r, 800));

    const orders = scrapeOrders(taskId);
    showModal(orders, taskId);
  }

  // ── Run on page load ──────────────────────────────────────────────────────
  if (isOnTaskDetailPage()) {
    initLabelBatchExport();
  }

  // ── Listen for URL changes (SPA navigation) — separate from main watcher ──
  let _lbLastUrl = window.location.href;
  setInterval(() => {
    const cur = window.location.href;
    if (cur === _lbLastUrl) return;
    _lbLastUrl = cur;
    if (isOnTaskDetailPage()) {
      // Small delay for React to render new page content
      setTimeout(initLabelBatchExport, 1500);
    } else {
      // Clean up modal if navigated away
      document.getElementById(MODAL_ID)?.remove();
    }
  }, 1500);

})();
