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
      overflow: hidden;
      box-shadow:
        0 0 0 1px rgba(0,212,170,0.07),
        0 12px 40px rgba(0,0,0,0.85),
        0 0 60px rgba(0,212,170,0.05),
        inset 0 1px 0 rgba(255,255,255,0.04);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-font-smoothing: antialiased;
      transition: width 0.25s ease, height 0.25s ease, border-radius 0.25s ease;
    }

    /* ── MINIMIZED ─────────────────────────────────────────── */
    /* 'minimized' class is on .card itself, so use .card.minimized selectors */
    .card.minimized {
      width: 44px; height: 44px; border-radius: 50%;
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
      box-shadow: 0 0 22px rgba(0,212,170,0.3), 0 3px 12px rgba(0,0,0,0.5);
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 0 32px rgba(0,212,170,0.5), 0 6px 20px rgba(0,0,0,0.55);
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
          <div class="version">v8.5 · Quick Export</div>
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
    chrome.runtime.sendMessage({ type: 'cancelExport' });
    running = false; setButtons(false); showProgress(false);
    setStatus('Export cancelled', 's-error');
    setTimeout(() => setStatus('Ready to export', 's-ready'), 3000);
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
  const minBtn = $('minBtn');
  const cardEl = wrapper.firstElementChild; // the .card div

  function setMinimized(val) {
    minimized = val;
    cardEl.classList.toggle('minimized', minimized);
    if (minBtn) minBtn.textContent = minimized ? '+' : '—';
  }

  if (minBtn) {
    minBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setMinimized(!minimized);
    });
  }
  // Click anywhere on minimized card to expand
  cardEl.addEventListener('click', (e) => {
    if (minimized) {
      e.stopPropagation();
      setMinimized(false);
    }
  });

  // ── Wire action buttons ───────────────────────────────────────────────────
  const btnE = $('btnExport'), btnS = $('btnSheets'), btnC = $('btnCancel');
  if (btnE) btnE.addEventListener('click', () => startExport(false));
  if (btnS) btnS.addEventListener('click', () => startExport(true));
  if (btnC) btnC.addEventListener('click', cancelExport);

  // ── SPA navigation watcher (URL-based, 3s poll) ───────────────────────────
  let _lastUrl = window.location.href;
  setInterval(() => {
    const cur = window.location.href;
    if (cur === _lastUrl) return;
    _lastUrl = cur;
    host.style.display = isOnOrdersPage() ? '' : 'none';
    if (isOnOrdersPage() && !running) setStatus('Ready to export', 's-ready');
  }, 3000);

  // Initial visibility
  if (!isOnOrdersPage()) host.style.display = 'none';

})();
