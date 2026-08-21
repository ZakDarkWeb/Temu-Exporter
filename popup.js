(() => {
  'use strict';

  const STATE_KEY = 'temuOrderExporterStateV7';
  const UI_KEY = 'temuOrderExporterUiV1';
  const HISTORY_KEY = 'temuOrderExporterHistoryV1';
  const HISTORY_LIMIT = 20;
  const BULK_URL = 'https://seller.temu.com/buy-shipping-bulk-details.html';

  let state = defaultState();
  let activeTab = null;
  let historyEntries = [];

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  function defaultState() {
    return { version: 7, runId: null, status: 'idle', sourceUrl: '', sourceTabId: null, rows: [], nextIndex: 0, retryQueue: [], inFlight: [], attempts: {}, records: [], errors: [], updatedAt: null };
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response || {});
      });
    });
  }

  function cleanRecord(record) {
    if (!record) return record;
    const { __key, __index, __attempts, __lineIndex, ...clean } = record;
    return clean;
  }

  function stats() {
    const total = state.rows.length;
    const done = new Set(state.records.map(record => record.__key || `${record['Order No'] || ''}::${record['Tracking Number'] || ''}`)).size;
    return { total, done, rows: state.records.length, active: state.inFlight.length, errors: state.errors.length, percent: total ? Math.min(100, Math.round((done / total) * 100)) : 0 };
  }

  function statusCopy() {
    if (state.status === 'running') return ['Running', 'Live extraction is in progress.'];
    if (state.status === 'paused') return ['Paused', 'Checkpoint saved and ready to resume.'];
    if (state.status === 'complete' && state.errors.length) return ['Complete with errors', 'Successful records are ready; failed orders can be retried.'];
    if (state.status === 'complete') return ['Complete', 'Workbook is ready for download.'];
    return ['Ready', 'Open the bulk-shipping page to begin.'];
  }

  function pageContext() {
    const path = activeTab?.url ? (() => { try { return new URL(activeTab.url).pathname; } catch (_) { return ''; } })() : '';
    const page = $('[data-role="page-context"]');
    const text = $('[data-role="page-text"]');
    page.classList.remove('is-ready', 'is-wrong');
    if (path === '/buy-shipping-bulk-details.html') {
      page.classList.add('is-ready');
      text.textContent = 'Bulk-shipping page detected';
    } else if (path === '/order-detail.html') {
      page.classList.add('is-wrong');
      text.textContent = 'Detail page open — return to bulk page';
    } else if (activeTab?.url?.startsWith('https://seller.temu.com/')) {
      page.classList.add('is-wrong');
      text.textContent = 'Temu page detected — open the bulk page';
    } else {
      page.classList.add('is-wrong');
      text.textContent = 'Open Temu Seller Center to begin';
    }
  }

  function pipelineState(stage, data) {
    if (!data.total) return 'idle';
    if (stage === 'capture') return state.status === 'idle' ? 'idle' : 'complete';
    if (stage === 'details') return state.status === 'running' ? 'active' : (data.done ? 'complete' : 'idle');
    return state.status === 'complete' ? 'complete' : (state.records.length ? 'ready' : 'idle');
  }

  function renderState() {
    const data = stats();
    const [statusText, detailText] = statusCopy();
    const card = $('[data-role="status-card"]');
    const chip = $('[data-role="status-chip"]');
    const status = $('[data-role="status"]');
    const detail = $('[data-role="status-detail"]');
    status.textContent = statusText;
    detail.textContent = detailText;
    chip.textContent = state.status === 'complete' && state.errors.length ? 'Errors' : statusText;
    const statusKey = state.status === 'complete' && state.errors.length ? 'error' : state.status;
    chip.dataset.status = statusKey;
    card.dataset.status = state.status;
    $('[data-role="progress-fill"]').style.width = `${data.percent}%`;
    $('[data-role="progress-text"]').textContent = `${data.done} of ${data.total} orders · ${data.rows} rows`;
    $('[data-role="progress-percent"]').textContent = `${data.percent}%`;
    $('[data-metric="orders"]').textContent = `${data.done}/${data.total || 0}`;
    $('[data-metric="rows"]').textContent = String(data.rows);
    $('[data-metric="active"]').textContent = String(data.active);
    $('[data-metric="errors"]').textContent = String(data.errors);
    $$('[data-stage]').forEach(stage => { stage.dataset.stage = pipelineState(stage.dataset.stage, data); });

    const primary = $('[data-command="primary"]');
    if (state.status === 'running') {
      primary.innerHTML = '<span>↗</span><b>View active batch</b>';
      primary.disabled = false;
    } else if (state.status === 'paused') {
      primary.innerHTML = '<span>▶</span><b>Resume extraction</b>';
      primary.disabled = false;
    } else if (state.status === 'complete' && state.errors.length) {
      primary.innerHTML = '<span>↻</span><b>Retry failed orders</b>';
      primary.disabled = false;
    } else if (activeTab?.url?.includes('/buy-shipping-bulk-details.html')) {
      primary.innerHTML = '<span>↗</span><b>Start extraction</b>';
      primary.disabled = false;
    } else {
      primary.innerHTML = '<span>↗</span><b>Open bulk page</b>';
      primary.disabled = false;
    }
    $('[data-command="pause"]').disabled = state.status !== 'running';
    $('[data-command="download"]').disabled = !state.records.length;
    $('[data-command="stop"]').disabled = state.status === 'idle' && !state.records.length;
    const recovery = $('[data-role="recovery"]');
    recovery.classList.toggle('is-visible', Boolean(state.errors.length && state.status !== 'running' && !data.active));
    $('[data-role="error-count"]').textContent = String(state.errors.length);
  }

  function historyDate(value) {
    try { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return value || ''; }
  }

  function renderHistory() {
    const list = $('[data-role="history-list"]');
    if (!historyEntries.length) {
      list.innerHTML = '<div class="to-popup-empty">No saved sheets yet.</div>';
      return;
    }
    list.innerHTML = historyEntries.slice(0, 3).map((entry, index) => `<div class="to-popup-history-item"><div><strong>${historyDate(entry.createdAt)}</strong><small>${entry.orders} orders · ${entry.rows} rows · ${entry.errors} errors</small></div><button type="button" data-history-index="${index}" title="Download this sheet" aria-label="Download this sheet">↓</button></div>`).join('');
  }

  async function loadHistory() {
    try {
      const stored = await chrome.storage.local.get([HISTORY_KEY]);
      historyEntries = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY].slice(0, HISTORY_LIMIT) : [];
    } catch (_) { historyEntries = []; }
    renderHistory();
  }

  async function loadState() {
    try {
      const response = await send({ type: 'TEMU_GET_STATE' });
      state = { ...defaultState(), ...(response.state || {}) };
    } catch (_) {
      try {
        const stored = await chrome.storage.local.get([STATE_KEY]);
        state = { ...defaultState(), ...(stored[STATE_KEY] || {}) };
      } catch (_) { state = defaultState(); }
    }
    renderState();
  }

  async function loadActiveTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tabs[0] || null;
    } catch (_) { activeTab = null; }
    pageContext();
    renderState();
  }

  async function refresh() {
    await Promise.all([loadState(), loadHistory(), loadActiveTab()]);
  }

  async function openBulkPage() {
    const url = state.sourceUrl || BULK_URL;
    if (activeTab?.id && activeTab.url?.startsWith('https://seller.temu.com/')) await chrome.tabs.update(activeTab.id, { url });
    else await chrome.tabs.create({ url });
    window.close();
  }

  async function sendToActiveContent(message) {
    if (!activeTab?.id) return false;
    return new Promise(resolve => chrome.tabs.sendMessage(activeTab.id, message, () => { void chrome.runtime.lastError; resolve(!chrome.runtime.lastError); }));
  }

  async function primaryAction() {
    if (state.status === 'running') { const sent = await sendToActiveContent({ type: 'TEMU_OPEN_PANEL' }); if (sent) window.close(); else await openBulkPage(); return; }
    if (state.status === 'paused') { await send({ type: 'TEMU_RESUME_JOB' }); await refresh(); return; }
    if (state.status === 'complete' && state.errors.length) { await retryFailed(); return; }
    if (activeTab?.url?.includes('/buy-shipping-bulk-details.html')) {
      const sent = await sendToActiveContent({ type: 'TEMU_POPUP_START' });
      if (!sent) await openBulkPage();
      else { await new Promise(resolve => setTimeout(resolve, 250)); await refresh(); }
      return;
    }
    await openBulkPage();
  }

  async function pauseJob() { await send({ type: 'TEMU_PAUSE_JOB' }); await refresh(); }
  async function resumeJob() { await send({ type: 'TEMU_RESUME_JOB' }); await refresh(); }
  async function retryFailed() { if (!state.errors.length) return; await send({ type: 'TEMU_RETRY_FAILED' }); await refresh(); }
  async function stopJob() { await send({ type: 'TEMU_STOP_JOB' }); await refresh(); }
  function download(records, errors) { window.TemuXlsx.downloadWorkbook((records || []).map(cleanRecord), errors || []); }
  function downloadCurrent() { download(state.records, state.errors); }
  function openHistoryDrawer() { sendToActiveContent({ type: 'TEMU_OPEN_HISTORY' }).then(sent => { if (sent) window.close(); }); }

  document.addEventListener('click', event => {
    const command = event.target.closest('[data-command]')?.dataset.command;
    if (command === 'primary') primaryAction();
    if (command === 'pause') pauseJob();
    if (command === 'download') downloadCurrent();
    if (command === 'stop') stopJob();
    if (command === 'retry') retryFailed();
    if (command === 'history') openHistoryDrawer();
    if (command === 'open-bulk') openBulkPage();
    const historyButton = event.target.closest('[data-history-index]');
    if (historyButton) {
      const entry = historyEntries[Number(historyButton.dataset.historyIndex)];
      if (entry) download(entry.records, entry.errorsData);
    }
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'TEMU_STATE_UPDATE') {
      state = { ...defaultState(), ...(message.state || {}) };
      renderState();
    }
  });
  chrome.storage?.onChanged?.addListener(changes => { if (changes[HISTORY_KEY]) { historyEntries = changes[HISTORY_KEY].newValue || []; renderHistory(); } });
  refresh();
})();
