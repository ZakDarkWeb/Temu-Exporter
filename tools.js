(() => {
  'use strict';
  const STATE_KEY = 'temuOrderExporterStateV7';
  const UI_KEY = 'temuOrderExporterUiV1';
  const HISTORY_KEY = 'temuOrderExporterHistoryV1';
  const HISTORY_LIMIT = 20;
  const BULK_URL = 'https://seller.temu.com/buy-shipping-bulk-details.html';
  let state = defaultState();
  let historyEntries = [];
  let uiPrefs = { minimized: false, motion: true, saveHistory: true };
  let busy = false;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  function defaultState() { return { version: 8, status: 'idle', sourceUrl: '', rows: [], records: [], errors: [], warnings: [], inFlight: [], attempts: {}, updatedAt: null }; }
  function cleanRecord(record) { if (!record) return record; const { __key, __index, __attempts, __lineIndex, ...clean } = record; return clean; }
  function formatDate(value) { try { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return value || ''; } }
  function stats() {
    const total = Array.isArray(state.rows) ? state.rows.length : 0;
    const records = Array.isArray(state.records) ? state.records : [];
    const done = new Set(records.map(record => record.__key || `${record['Order No'] || ''}::${record['Tracking Number'] || ''}`)).size;
    return { total, done, rows: records.length, errors: (state.errors || []).length, warnings: (state.warnings || []).length, percent: total ? Math.min(100, Math.round(done / total * 100)) : 0 };
  }
  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message)); else resolve(response || {});
      });
    });
  }
  function feedback(message, tone = 'info') {
    const element = $('[data-role="feedback"]');
    if (!element) return;
    element.textContent = message; element.dataset.tone = tone; element.hidden = false;
    clearTimeout(feedback.timer); feedback.timer = setTimeout(() => { element.hidden = true; }, 4200);
  }
  function statusCopy() {
    if (state.status === 'running') return ['Running', 'Live extraction is in progress.'];
    if (state.status === 'paused') return ['Paused', 'Checkpoint saved and ready to resume.'];
    if (state.status === 'complete' && state.errors?.length) return ['Complete with errors', 'Successful records are ready; failed orders can be retried.'];
    if (state.status === 'complete' && state.warnings?.length) return ['Complete with notes', 'Workbook is ready; review notes below.'];
    if (state.status === 'complete') return ['Complete', 'Workbook is ready for download.'];
    return ['Ready', 'Open the bulk-shipping page to begin.'];
  }
  function renderState() {
    const data = stats();
    const [status, detail] = statusCopy();
    $('[data-role="status"]').textContent = status;
    $('[data-role="status-detail"]').textContent = detail;
    $('[data-role="progress-fill"]').style.width = `${data.percent}%`;
    $('[data-role="progress-text"]').textContent = `${data.done} of ${data.total} orders · ${data.rows} rows · ${data.errors} errors · ${data.warnings} notes`;
    $('[data-role="progress-percent"]').textContent = `${data.percent}%`;
    $('[data-stat="orders"]').textContent = `${data.done}/${data.total || 0}`;
    $('[data-stat="rows"]').textContent = String(data.rows);
    $('[data-stat="errors"]').textContent = String(data.errors);
    $('[data-stat="warnings"]').textContent = String(data.warnings);
    const card = $('.tools-status-main');
    card.dataset.status = state.status;
    $('[data-action="retry"]').disabled = !data.errors || state.status === 'running' || state.inFlight?.length > 0;
    $('[data-action="download-current"]').disabled = !data.rows;
    $('[data-action="stop"]').disabled = state.status === 'idle' && !data.rows;
  }
  function empty(text) { const element = document.createElement('div'); element.className = 'tools-empty'; element.textContent = text; return element; }
  function renderHistory() {
    const list = $('[data-role="history-list"]'); list.replaceChildren();
    if (!historyEntries.length) { list.appendChild(empty('No saved sheets yet. Completed workbooks will appear here.')); return; }
    historyEntries.slice(0, HISTORY_LIMIT).forEach(entry => {
      const item = document.createElement('div'); item.className = 'tools-history-item';
      const main = document.createElement('div'); main.className = 'tools-history-main';
      const title = document.createElement('strong'); title.textContent = formatDate(entry.createdAt);
      const meta = document.createElement('small'); meta.textContent = `${Number(entry.orders) || 0} orders · ${Number(entry.rows) || 0} rows · ${Number(entry.errors) || 0} errors · ${Number(entry.warnings) || 0} notes`;
      main.append(title, meta);
      const actions = document.createElement('div'); actions.className = 'tools-history-actions';
      [['download', 'Download this sheet', '↓'], ['delete', 'Delete this history item', '×']].forEach(([action, label, text]) => { const button = document.createElement('button'); button.type = 'button'; button.dataset.historyAction = action; button.dataset.historyId = entry.id; button.title = label; button.setAttribute('aria-label', label); button.textContent = text; actions.appendChild(button); });
      item.append(main, actions); list.appendChild(item);
    });
  }
  function renderDiagnostics() {
    const list = $('[data-role="diagnostics"]'); list.replaceChildren();
    const rows = [...(state.errors || []).map(error => ({ ...error, tone: 'error', label: 'Error' })), ...(state.warnings || []).map(warning => ({ ...warning, tone: 'warning', label: 'Note' }))];
    $('[data-role="diagnostic-count"]').textContent = `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`;
    if (!rows.length) { list.appendChild(empty('No errors or parser notes in the current batch.')); return; }
    rows.slice(0, 80).forEach(row => { const item = document.createElement('div'); item.className = 'tools-diagnostic'; item.dataset.tone = row.tone; const copy = document.createElement('div'); const title = document.createElement('strong'); title.textContent = row.label; const detail = document.createElement('small'); detail.textContent = row.message || 'No additional details available.'; copy.append(title, detail); item.appendChild(copy); list.appendChild(item); });
  }
  async function load() {
    try {
      const [response, stored] = await Promise.all([send({ type: 'TEMU_GET_STATE' }), chrome.storage.local.get([HISTORY_KEY, UI_KEY])]);
      state = { ...defaultState(), ...(response.state || {}) };
      historyEntries = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY].slice(0, HISTORY_LIMIT) : [];
      uiPrefs = { ...uiPrefs, ...(stored[UI_KEY] || {}) };
    } catch (_) {
      try { const stored = await chrome.storage.local.get([STATE_KEY, HISTORY_KEY, UI_KEY]); state = { ...defaultState(), ...(stored[STATE_KEY] || {}) }; historyEntries = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY].slice(0, HISTORY_LIMIT) : []; uiPrefs = { ...uiPrefs, ...(stored[UI_KEY] || {}) }; } catch (error) { feedback('Could not load local workspace state.', 'error'); }
    }
    $('[data-setting="saveHistory"]').checked = Boolean(uiPrefs.saveHistory);
    $('[data-setting="motion"]').checked = Boolean(uiPrefs.motion);
    renderState(); renderHistory(); renderDiagnostics();
  }
  async function run(action, trigger) {
    if (busy) return; busy = true; if (trigger) { trigger.disabled = true; trigger.setAttribute('aria-busy', 'true'); }
    try {
      if (action === 'open-bulk') { await chrome.tabs.create({ url: state.sourceUrl || BULK_URL }); return; }
      if (action === 'resume') { const sent = await send({ type: 'TEMU_OPEN_PANEL' }); if (!sent?.ok) await chrome.tabs.create({ url: state.sourceUrl || BULK_URL }); return; }
      if (action === 'retry') await send({ type: 'TEMU_RETRY_FAILED' });
      if (action === 'stop') await send({ type: 'TEMU_STOP_JOB' });
      if (action === 'download-current') {
        const records = (state.records || []).map(cleanRecord); if (!records.length) { feedback('No workbook rows are ready yet.', 'warning'); return; }
        window.TemuXlsx.downloadWorkbook(records, [...(state.errors || []), ...(state.warnings || []).map(warning => ({ ...warning, message: warning.message || 'Parser warning' }))]); feedback('Workbook download started.', 'success'); return;
      }
      if (action === 'clear-history') { historyEntries = []; await chrome.storage.local.set({ [HISTORY_KEY]: [] }); feedback('Sheet history cleared.', 'success'); }
      if (action === 'refresh') { await load(); feedback('Workspace refreshed.', 'success'); return; }
      await load();
    } catch (error) { feedback(error?.message || 'Action could not be completed.', 'error'); }
    finally { busy = false; if (trigger) trigger.removeAttribute('aria-busy'); renderState(); }
  }
  $('[data-role="history-list"]').addEventListener('click', event => { const button = event.target.closest('[data-history-action]'); if (!button) return; const entry = historyEntries.find(candidate => candidate.id === button.dataset.historyId); if (!entry) return; if (button.dataset.historyAction === 'download') window.TemuXlsx.downloadWorkbook((entry.records || []).map(cleanRecord), entry.errorsData || []); if (button.dataset.historyAction === 'delete') { historyEntries = historyEntries.filter(candidate => candidate.id !== entry.id); chrome.storage.local.set({ [HISTORY_KEY]: historyEntries }); renderHistory(); feedback('History item deleted.', 'success'); } });
  document.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button) void run(button.dataset.action, button); });
  $$('[data-setting]').forEach(input => input.addEventListener('change', async event => { uiPrefs[event.target.dataset.setting] = event.target.checked; await chrome.storage.local.set({ [UI_KEY]: uiPrefs }); try { await send({ type: 'TEMU_UI_PREFS_UPDATE', prefs: uiPrefs }); } catch (_) {} feedback(`${event.target.dataset.setting === 'motion' ? 'Motion effects' : 'Sheet history'} ${event.target.checked ? 'enabled' : 'disabled'}.`, 'success'); }));
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'TEMU_STATE_UPDATE') { state = { ...defaultState(), ...(message.state || {}) }; renderState(); renderDiagnostics(); } });
  chrome.storage?.onChanged?.addListener(changes => { if (changes[HISTORY_KEY] || changes[UI_KEY]) load(); });
  load();
})();
