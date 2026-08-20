// ═══════════════════════════════════════════════════════════════════════════════
// Temu Order Exporter — Content Script v8.8.6
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
      width: 300px;
      max-height: 620px;
      overflow-y: auto;
      overflow-x: hidden;
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
      width: 44px; height: 44px; min-height: 44px; max-height: 44px;
      border-radius: 50%; overflow: hidden; overflow-y: hidden;
      border-color: rgba(0,212,170,0.55);
      box-shadow: 0 4px 24px rgba(0,0,0,0.8), 0 0 28px rgba(0,212,170,0.22);
      cursor: pointer;
    }
    .card.minimized .body,
    .card.minimized .title-wrap,
    .card.minimized .actions,
    .card.minimized .header-line { display: none !important; }
    .card.minimized .header {
      width: 44px; height: 44px; min-height: 44px; padding: 0;
      justify-content: center; cursor: pointer;
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

    /* ── PRIMARY WORKFLOW ─────────────────────────────────────── */
    .selection-card {
      background: rgba(96,165,250,0.055);
      border: 1px solid rgba(96,165,250,0.18);
      border-radius: 10px; padding: 9px 10px;
      display: flex; flex-direction: column; gap: 7px;
    }
    .selection-title { display:flex; align-items:center; justify-content:space-between; gap:6px; }
    .selection-title strong { color:#dbeafe; font-size:10px; font-weight:800; }
    .selection-tab { color:#64748b; font-size:8px; font-weight:700; text-transform:uppercase; letter-spacing:.35px; }
    .selection-count { color:#60a5fa; font-size:18px; font-weight:900; line-height:1; font-variant-numeric:tabular-nums; }
    .selection-label { color:#94a3b8; font-size:9px; font-weight:600; }
    .selection-stats { display:grid; grid-template-columns:1fr 1fr; gap:5px; }
    .selection-stat { background:rgba(255,255,255,.025); border-radius:7px; padding:6px 7px; min-width:0; }
    .selection-stat b { display:block; color:#f1f5f9; font-size:12px; line-height:1; font-variant-numeric:tabular-nums; }
    .selection-stat span { display:block; color:#64748b; font-size:8px; font-weight:700; margin-top:3px; }
    .selection-actions { display:flex; gap:5px; }
    .selection-actions .btn { height:29px; padding:0 6px; font-size:9px; border-radius:7px; }
    .selection-actions .btn-clear { flex:0 0 29px; padding:0; color:#fca5a5; border-color:rgba(248,113,113,.25); background:rgba(248,113,113,.06); }
    .selection-actions .btn-clear:hover { background:rgba(248,113,113,.14); }
    .selection-hint { color:#64748b; font-size:8px; line-height:1.35; }
    .tsv-card { background:rgba(0,212,170,.055); border:1px solid rgba(0,212,170,.18); border-radius:9px; padding:8px; }
    .tsv-card textarea { width:100%; height:48px; resize:none; border:1px solid rgba(255,255,255,.08); border-radius:6px; background:#080c12; color:#94a3b8; padding:5px; font:8px/1.3 monospace; outline:none; }
    .tsv-copy { margin-top:5px; height:27px; font-size:9px; }
    .tsv-download-row { display:grid; grid-template-columns:1fr 1fr; gap:5px; margin-top:5px; }
    .tsv-download-row .btn { height:26px; font-size:8px; }

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
          <div class="version">v8.8.6 · Bulk Label Workflow</div>
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

        <div class="selection-card" id="selectionCard">
          <div class="selection-title">
            <strong>Bulk Label Workflow</strong>
            <span class="selection-tab" id="selectionTab">Unshipped</span>
          </div>
          <div><span class="selection-count" id="selectedCount">0</span> <span class="selection-label">orders selected</span></div>
          <div class="selection-stats">
            <div class="selection-stat"><b id="matchedCount">0</b><span>Shipped / matched</span></div>
            <div class="selection-stat"><b id="pendingCount">0</b><span>Pending</span></div>
          </div>
          <div class="selection-actions">
            <button class="btn btn-outline" id="btnRefreshShipped">Refresh Shipped</button>
            <button class="btn btn-primary" id="btnExportSelected">Export to Sheets</button>
            <button class="btn btn-clear" id="btnClearSelection" title="Clear saved selection">×</button>
          </div>
          <div class="selection-hint" id="selectionHint">Select orders on Unshipped. The selection persists while you buy labels.</div>
        </div>

        <div class="tsv-card" id="tsvCard" style="display:none;">
          <div class="selection-title"><strong>Sheets TSV ready</strong><span class="selection-tab" id="tsvCount">0 rows</span></div>
          <textarea id="tsvText" readonly></textarea>
          <button class="btn btn-outline tsv-copy" id="btnCopySelected">Copy TSV to clipboard</button>
          <div class="tsv-download-row">
            <button class="btn btn-outline" id="btnDownloadSelectedXlsx">Download XLSX</button>
            <button class="btn btn-outline" id="btnDownloadSelectedCsv">Download CSV</button>
          </div>
        </div>


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

  // ── Persistent bulk-label selection workflow ──────────────────────────────
  const SELECTED_ORDERS_KEY = 'temuSelectedOrders_v2';
  const SELECTED_SHIPPED_KEY = 'temuSelectedShipped_v1';
  let workflowBusy = false;
  let lastWorkflowRows = [];
  let lastWorkflowHistoryId = null;

  function workflowMode() {
    const params = new URLSearchParams(window.location.search);
    const active = params.get('activeTab');
    if (active === '2') return 'unshipped';
    if (active === '3' || active === '4') return 'shipped';
    const url = window.location.href.toLowerCase();
    if (url.includes('shipped')) return 'shipped';
    if (url.includes('unshipped')) return 'unshipped';
    return 'orders';
  }

  function parseVisibleSelection() {
    const rows = Array.from(document.querySelectorAll('tr[data-testid="beast-core-table-body-tr"]'));
    return rows.map(row => {
      const text = (row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim();
      const orderNumber = (text.match(/PO-\d+-\d{8,}/) || [])[0] || '';
      const packageId = (text.match(/PK-[A-Za-z0-9-]+/) || [])[0] || '';
      const trackingNumber = ((text.match(/Tracking number:?\s*([A-Z0-9-]{6,})/i) || [])[1] || '');
      const checkbox = row.querySelector('[data-testid="beast-core-checkbox"]');
      const selected = checkbox && (checkbox.getAttribute('data-checked') === 'true' || checkbox.getAttribute('aria-checked') === 'true' || checkbox.querySelector('input')?.checked);
      return { orderNumber, packageId, trackingNumber, selected: !!selected };
    }).filter(row => row.orderNumber);
  }

  function identityOf(row) { return [row.orderNumber || '', row.packageId || '', row.trackingNumber || ''].filter(Boolean).join('|'); }
  function orderKey(row) { return row.orderNumber || identityOf(row); }
  function sourceSet(item) {
    const values = item?.selectionSources || (item?.selectionSource ? [item.selectionSource] : []);
    return new Set(values.filter(Boolean));
  }
  function isSelectedMatch(row, selectedOrders) {
    const selected = selectedOrders.find(item => item.orderNumber === row.orderNumber);
    if (!selected) return false;
    const packageMatches = !selected.packageId || !row.packageId || selected.packageId === row.packageId;
    const trackingMatches = !selected.trackingNumber || !row.trackingNumber || selected.trackingNumber === row.trackingNumber;
    return packageMatches && trackingMatches;
  }

  async function readWorkflowState() {
    const data = await chrome.storage.local.get([SELECTED_ORDERS_KEY, SELECTED_SHIPPED_KEY]);
    return {
      selected: data[SELECTED_ORDERS_KEY] || { updatedAt: 0, orders: {} },
      shipped: data[SELECTED_SHIPPED_KEY] || { matchedCount: 0, pendingCount: 0, rows: [] }
    };
  }

  async function refreshWorkflowSummary() {
    const state = await readWorkflowState();
    const selected = Object.values(state.selected.orders || {});
    const matchedRows = (state.shipped.rows || []).filter(row => isSelectedMatch(row, selected));
    const matched = matchedRows.length;
    const pending = selected.length ? Math.max(0, selected.length - matched) : 0;
    if ($('selectedCount')) $('selectedCount').textContent = selected.length;
    if ($('matchedCount')) $('matchedCount').textContent = matched;
    if ($('pendingCount')) $('pendingCount').textContent = pending;
    const mode = workflowMode();
    if ($('selectionTab')) $('selectionTab').textContent = mode === 'shipped' ? 'Shipped' : mode === 'unshipped' ? 'Unshipped' : 'Orders';
    if ($('selectionHint')) $('selectionHint').textContent = mode === 'unshipped'
      ? 'Selections are saved automatically while you buy labels.'
      : mode === 'shipped' ? 'Selected Shipped rows are added and ready for Sheets export.' : 'Open Unshipped or Shipped to use this workflow.';
    if ($('btnRefreshShipped')) $('btnRefreshShipped').disabled = workflowBusy;
    if ($('btnExportSelected')) $('btnExportSelected').disabled = workflowBusy || matched === 0;
    lastWorkflowRows = matchedRows;
  }

  async function persistVisibleSelection() {
    const mode = workflowMode();
    if (mode !== 'unshipped' && mode !== 'shipped') return;
    const visible = parseVisibleSelection();
    if (!visible.length) return;
    const data = await chrome.storage.local.get([SELECTED_ORDERS_KEY, SELECTED_SHIPPED_KEY]);
    const current = data[SELECTED_ORDERS_KEY] || { updatedAt: 0, orders: {} };
    const orders = { ...(current.orders || {}) };
    const shippedState = data[SELECTED_SHIPPED_KEY] || { updatedAt: 0, rows: [] };
    const shippedRows = new Map((shippedState.rows || []).map(row => [orderKey(row), row]));
    const source = mode === 'shipped' ? 'shipped' : 'unshipped';

    visible.forEach(row => {
      const identity = identityOf(row);
      if (!identity) return;
      const key = Object.keys(orders).find(existingKey => orders[existingKey]?.orderNumber === row.orderNumber) || identity;
      const existing = orders[key] || { orderNumber: row.orderNumber, packageId: row.packageId, trackingNumber: row.trackingNumber, selectedAt: Date.now() };
      const sources = sourceSet(existing);
      if (row.selected) {
        sources.add(source);
        orders[key] = { ...existing, orderNumber: row.orderNumber, packageId: row.packageId, trackingNumber: row.trackingNumber, selectionSources: [...sources] };
        if (mode === 'shipped') shippedRows.set(orderKey(row), { ...row, selectedAt: existing.selectedAt });
      } else if (orders[key]) {
        sources.delete(source);
        if (sources.size) orders[key] = { ...existing, selectionSources: [...sources] };
        else {
          delete orders[key];
          shippedRows.delete(orderKey(row));
        }
        if (mode === 'shipped') shippedRows.delete(orderKey(row));
      }
    });

    const selected = Object.values(orders);
    const matchedRows = [...shippedRows.values()].filter(row => isSelectedMatch(row, selected));
    await chrome.storage.local.set({
      [SELECTED_ORDERS_KEY]: { updatedAt: Date.now(), orders },
      [SELECTED_SHIPPED_KEY]: {
        ...shippedState,
        updatedAt: Date.now(),
        selectedCount: selected.length,
        matchedCount: matchedRows.length,
        pendingCount: Math.max(0, selected.length - matchedRows.length),
        rows: matchedRows
      }
    });
    await refreshWorkflowSummary();
  }

  async function clearWorkflowSelection() {
    await chrome.storage.local.remove([SELECTED_ORDERS_KEY, SELECTED_SHIPPED_KEY]);
    lastWorkflowRows = [];
    if ($('tsvCard')) $('tsvCard').style.display = 'none';
    await refreshWorkflowSummary();
    setStatus('Saved selection cleared', 's-done');
    setTimeout(() => setStatus('Ready to export', 's-ready'), 2500);
  }

  function copyTextWithFallback(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => copyTextFallback(text));
    return copyTextFallback(text);
  }
  function copyTextFallback(text) {
    const area = document.createElement('textarea');
    area.value = text; area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(area); area.focus(); area.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) {}
    area.remove(); return ok ? Promise.resolve() : Promise.reject(new Error('Clipboard permission denied'));
  }

  function showSelectedLabelRows(msg) {
    lastWorkflowRows = msg.rows || [];
    lastWorkflowHistoryId = msg.historyId || null;
    running = false;
    showProgress(false);
    if ($('tsvText')) $('tsvText').value = msg.tsv || '';
    if ($('tsvCount')) $('tsvCount').textContent = `${lastWorkflowRows.length} rows`;
    if ($('tsvCard')) $('tsvCard').style.display = 'block';
    workflowBusy = false;
    setStatus(`${lastWorkflowRows.length} rows ready for Sheets`, 's-done');
    refreshWorkflowSummary();
  }

  async function refreshSelectedShipped() {
    if (workflowBusy) return;
    workflowBusy = true;
    await refreshWorkflowSummary();
    showProgress(true); setStatus('Scanning Shipped orders...', 's-running'); updateProgress(5, 'Scanning Shipped pages...', '');
    chrome.runtime.sendMessage({ type: 'refreshSelectedShipped' });
  }

  function downloadSelectedLabel(format) {
    if (!lastWorkflowRows.length) { setStatus('No rows available for download', 's-error'); return; }
    chrome.runtime.sendMessage({
      type: 'downloadSelectedLabelFile',
      rows: lastWorkflowRows,
      format,
      historyId: lastWorkflowHistoryId
    });
    setStatus(`Preparing ${format.toUpperCase()} download...`, 's-running');
  }

  async function exportSelectedLabelSheets() {
    if (workflowBusy) return;
    const state = await readWorkflowState();
    const selected = Object.values(state.selected.orders || {});
    const rows = (state.shipped.rows || lastWorkflowRows).filter(row => isSelectedMatch(row, selected));
    if (!rows.length) { setStatus('Select Shipped orders or click Refresh Shipped first', 's-error'); return; }
    workflowBusy = true;
    showProgress(true); setStatus('Extracting selected orders...', 's-running'); updateProgress(10, 'Opening order details...', `${rows.length} matched orders`);
    chrome.runtime.sendMessage({ type: 'exportSelectedLabelSheets', rows });
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
      running = false; workflowBusy = false; setButtons(false); showProgress(false);
      setStatus('Cancelled', 's-error');
      setTimeout(() => setStatus('Ready to export', 's-ready'), 3000);
    }
    if (msg.type === 'selectedShippedProgress') {
      const total = Number(msg.total || 0);
      const current = Number(msg.current || 0);
      updateProgress(total ? Math.min(92, 10 + (current / total) * 75) : 20, msg.message || 'Scanning Shipped pages...', `${current} matched / ${total} selected`);
    }
    if (msg.type === 'selectedShippedReady') {
      workflowBusy = false; running = false; showProgress(false); setButtons(false);
      if ($('selectedCount')) $('selectedCount').textContent = msg.selectedCount || 0;
      if ($('matchedCount')) $('matchedCount').textContent = msg.matchedCount || 0;
      if ($('pendingCount')) $('pendingCount').textContent = msg.pendingCount || 0;
      lastWorkflowRows = msg.rows || [];
      setStatus(`${msg.matchedCount || 0} Shipped orders matched`, 's-done');
      showResult(`${msg.matchedCount || 0} matched · ${msg.pendingCount || 0} pending`);
      refreshWorkflowSummary();
    }
    if (msg.type === 'selectedLabelRowsReady') showSelectedLabelRows(msg);
    if (msg.type === 'selectedLabelFileDownloaded') {
      workflowBusy = false;
      setStatus(`${String(msg.format || 'file').toUpperCase()} downloaded`, 's-done');
    }
    if (msg.type === 'selectedLabelDownloadError') {
      workflowBusy = false;
      setStatus((msg.message || 'Download failed').slice(0, 64), 's-error');
    }
    if (msg.type === 'selectedShippedError' || msg.type === 'selectedLabelExportError') {
      workflowBusy = false; running = false; showProgress(false); setButtons(false);
      setStatus((msg.message || 'Workflow failed').slice(0, 48), 's-error');
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
    } else if (id === 'btnRefreshShipped') {
      if (!minimized) refreshSelectedShipped();
    } else if (id === 'btnExportSelected') {
      if (!minimized) exportSelectedLabelSheets();
    } else if (id === 'btnClearSelection') {
      if (!minimized) clearWorkflowSelection();
    } else if (id === 'btnDownloadSelectedXlsx') {
      downloadSelectedLabel('xlsx');
    } else if (id === 'btnDownloadSelectedCsv') {
      downloadSelectedLabel('csv');
    } else if (id === 'btnCopySelected') {
      const text = $('tsvText')?.value || '';
      copyTextWithFallback(text).then(() => {
        setStatus('TSV copied — paste into Sheets', 's-done');
        showResult('TSV copied to clipboard');
      }).catch(() => setStatus('Copy blocked — use the text box', 's-error'));
    } else if (id === 'btnCancel') {
      // Visual flash to confirm click registered
      btn.style.background = 'rgba(239,68,68,0.25)';
      setTimeout(() => { btn.style.background = ''; }, 200);
      cancelExport();
    }
  }, true); // useCapture:true — fires before any other handler

  // ── Selection persistence watcher ─────────────────────────────────────────
  let selectionSaveTimer = null;
  function scheduleSelectionSave() {
    clearTimeout(selectionSaveTimer);
    selectionSaveTimer = setTimeout(() => persistVisibleSelection().catch(() => {}), 350);
  }
  document.addEventListener('click', scheduleSelectionSave, true);
  const tableObserver = new MutationObserver(() => {
    if (workflowMode() === 'unshipped') scheduleSelectionSave();
  });
  tableObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-checked', 'aria-checked', 'class'] });
  setInterval(() => refreshWorkflowSummary().catch(() => {}), 2500);
  refreshWorkflowSummary().catch(() => {});

  // ── SPA navigation watcher (URL-based, 3s poll) ───────────────────────────
  let _lastUrl = window.location.href;
  setInterval(() => {
    const cur = window.location.href;
    if (cur === _lastUrl) return;
    _lastUrl = cur;
    host.style.display = isOnOrdersPage() ? '' : 'none';
    refreshWorkflowSummary().catch(() => {});
    if (isOnOrdersPage() && !running && !workflowBusy) setStatus('Ready to export', 's-ready');
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
          ${taskId ? `<div style="margin-left:auto"><div class="lb-task-id">${taskId}</div></div>` : ''}
        </div>

        ${orderCount > 0 ? `
        <div class="lb-preview">
          ${previewOrders.map(o => `
            <div class="lb-preview-row">
              <span class="lb-order">${o.orderNumber}</span>
              <span class="lb-track">${o.trackingNumber || '—'}</span>
              <span style="font-size:9px;color:#475569;white-space:nowrap">${o.shippingCost ? '$'+o.shippingCost : ''}</span>
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
