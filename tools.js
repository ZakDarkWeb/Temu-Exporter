(() => {
  'use strict';
  const STATE_KEY    = 'temuOrderExporterStateV7';
  const UI_KEY       = 'temuOrderExporterUiV1';
  const HISTORY_KEY  = 'temuOrderExporterHistoryV1';
  const SCHEDULE_KEY = 'temuOrderExporterScheduleV1';
  const COLS_KEY     = 'temuOrderExporterColumnsV1';
  const HISTORY_LIMIT = 20;
  const BULK_URL = 'https://seller.temu.com/buy-shipping-bulk-details.html';

  let state          = defaultState();
  let historyEntries = [];
  let uiPrefs        = { minimized: false, motion: true, saveHistory: true, autoExport: false, autoRetry: false, notifyOnComplete: false };
  let schedulePrefs  = { enabled: false, time: '09:00' };
  let selectedColumns = null; // null = use MAIN_COLUMNS default
  let busy = false;

  const $  = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];

  /* ── State helpers ──────────────────────────────────────── */
  function defaultState() {
    return { version: 8, status: 'idle', sourceUrl: '', rows: [], records: [], errors: [], warnings: [], inFlight: [], attempts: {}, updatedAt: null };
  }
  function cleanRecord(r) {
    if (!r) return r;
    const { __key, __index, __attempts, __lineIndex, ...clean } = r;
    return clean;
  }
  function formatDate(value) {
    try { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (_) { return value || ''; }
  }
  function stats() {
    const total   = Array.isArray(state.rows)    ? state.rows.length    : 0;
    const records = Array.isArray(state.records) ? state.records        : [];
    const done    = new Set(records.map(r => r.__key || `${r['Order No']||''}::${r['Tracking Number']||''}`)).size;
    return {
      total, done, rows: records.length,
      errors:   (state.errors   || []).length,
      warnings: (state.warnings || []).length,
      percent: total ? Math.min(100, Math.round(done / total * 100)) : 0
    };
  }

  /* ── Messaging ──────────────────────────────────────────── */
  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message)); else resolve(response || {});
      });
    });
  }

  /* ── Toast feedback ─────────────────────────────────────── */
  function feedback(message, tone = 'info') {
    const el = $('[data-role="feedback"]');
    if (!el) return;
    el.textContent = message;
    el.dataset.tone = tone;
    el.hidden = false;
    clearTimeout(feedback._t);
    feedback._t = setTimeout(() => { el.hidden = true; }, 4000);
  }

  /* ── Status copy ────────────────────────────────────────── */
  function statusCopy() {
    if (state.status === 'running')  return ['Running',              'Live extraction is in progress.'];
    if (state.status === 'paused')   return ['Paused',               'Checkpoint saved — ready to resume.'];
    if (state.status === 'complete' && state.errors?.length)   return ['Complete with errors', 'Successful records ready; retry failed orders.'];
    if (state.status === 'complete' && state.warnings?.length) return ['Complete with notes',  'Workbook ready — review notes in diagnostics.'];
    if (state.status === 'complete') return ['Complete',             'Workbook is ready for download.'];
    return ['Ready', 'Open the bulk-shipping page to begin.'];
  }

  /* ── Render state ───────────────────────────────────────── */
  function renderState() {
    const data = stats();
    const [status, detail] = statusCopy();

    $('[data-role="status"]').textContent       = status;
    $('[data-role="status-detail"]').textContent = detail;
    $('[data-role="progress-fill"]').style.width = `${data.percent}%`;
    $('[data-role="progress-text"]').textContent  = `${data.done} of ${data.total} orders · ${data.rows} rows · ${data.errors} errors · ${data.warnings} notes`;
    $('[data-role="progress-percent"]').textContent = `${data.percent}%`;
    $('[data-stat="orders"]').textContent   = `${data.done}/${data.total || 0}`;
    $('[data-stat="rows"]').textContent     = String(data.rows);
    $('[data-stat="errors"]').textContent   = String(data.errors);
    $('[data-stat="warnings"]').textContent = String(data.warnings);

    // Status chip
    const chip = $('[data-role="status-chip"]');
    if (chip) {
      chip.dataset.status = state.status;
      chip.textContent = state.status.toUpperCase();
    }
    // Status card
    const card = $('[data-role="status-card"]');
    if (card) card.dataset.status = state.status;

    // Buttons
    const retryBtn    = $('#btn-retry');
    const downloadBtn = $('#btn-download');
    const stopBtn     = $('#btn-stop');
    if (retryBtn)    retryBtn.disabled    = !data.errors || state.status === 'running';
    if (downloadBtn) downloadBtn.disabled = !data.rows;
    if (stopBtn)     stopBtn.disabled     = state.status === 'idle' && !data.rows;
  }

  /* ── Empty state helper ─────────────────────────────────── */
  function emptyEl(text) {
    const el = document.createElement('div');
    el.className = 'tp-empty';
    el.textContent = text;
    return el;
  }

  /* ── History status badge ───────────────────────────────── */
  function historyBadge(entry) {
    const span = document.createElement('span');
    if (entry.completed) {
      if ((entry.errors || 0) > 0) { span.textContent = 'Partial';  span.className = 'tp-history-badge partial'; }
      else                         { span.textContent = 'Complete'; span.className = 'tp-history-badge complete'; }
    } else {
      span.textContent = 'Incomplete'; span.className = 'tp-history-badge incomplete';
    }
    return span;
  }

  /* ── Render history (with search filter) ────────────────── */
  function renderHistory(filter = '') {
    const list = $('[data-role="history-list"]');
    list.replaceChildren();
    if (!historyEntries.length) {
      list.appendChild(emptyEl('No saved sheets yet. Completed workbooks will appear here.'));
      return;
    }
    const q = filter.toLowerCase().trim();
    let shown = 0;
    historyEntries.slice(0, HISTORY_LIMIT).forEach(entry => {
      const dateStr = formatDate(entry.createdAt);
      const metaStr = `${entry.orders||0} orders ${entry.rows||0} rows`;
      if (q && !dateStr.toLowerCase().includes(q) && !metaStr.toLowerCase().includes(q)) return;
      shown++;

      const item = document.createElement('div');
      item.className = 'tp-history-item';

      const iconWrap = document.createElement('div');
      iconWrap.className = 'tp-history-icon-wrap';
      iconWrap.innerHTML = `<svg viewBox="0 0 16 16" fill="none"><path d="M4 2h5l3 3v9H4V2Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 2v3h3" stroke="currentColor" stroke-width="1.3"/><path d="M6 8h4M6 11h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

      const main = document.createElement('div');
      main.className = 'tp-history-main';

      const topRow = document.createElement('div');
      topRow.className = 'tp-history-top-row';
      const title = document.createElement('strong');
      title.textContent = dateStr;
      topRow.append(title, historyBadge(entry));

      const meta = document.createElement('small');
      meta.textContent = `${Number(entry.orders)||0} orders · ${Number(entry.rows)||0} rows · ${Number(entry.errors)||0} errors`;
      main.append(topRow, meta);

      const actions = document.createElement('div');
      actions.className = 'tp-history-actions';
      [['download', 'Download', '↓'], ['delete', 'Delete', '×']].forEach(([action, label, text]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.historyAction = action;
        btn.dataset.historyId = entry.id;
        btn.title = label; btn.setAttribute('aria-label', label);
        btn.textContent = text;
        actions.appendChild(btn);
      });

      item.append(iconWrap, main, actions);
      list.appendChild(item);
    });

    if (shown === 0 && q) {
      list.appendChild(emptyEl(`No history matches "${filter}".`));
    }
  }

  /* ── Render diagnostics ─────────────────────────────────── */
  function renderDiagnostics() {
    const list = $('[data-role="diagnostics"]');
    list.replaceChildren();
    const rows = [
      ...(state.errors   || []).map(e => ({ ...e, tone: 'error',   label: 'Error' })),
      ...(state.warnings || []).map(w => ({ ...w, tone: 'warning', label: 'Note'  }))
    ];
    $('[data-role="diagnostic-count"]').textContent = `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`;
    if (!rows.length) {
      list.appendChild(emptyEl('No errors or parser notes in the current batch.'));
      return;
    }
    rows.slice(0, 80).forEach(row => {
      const item = document.createElement('div');
      item.className = 'tp-diagnostic';
      item.dataset.tone = row.tone;
      const strong = document.createElement('strong');
      strong.textContent = row.label;
      const small = document.createElement('small');
      small.textContent = row.message || 'No additional details available.';
      item.append(strong, small);
      list.appendChild(item);
    });
  }

  /* ── Schedule status ────────────────────────────────────── */
  function renderScheduleStatus() {
    const note = $('[data-role="schedule-status"]');
    if (!note) return;
    if (schedulePrefs.enabled && schedulePrefs.time) {
      note.textContent = `✓ Auto-run scheduled daily at ${schedulePrefs.time}. Chrome must be running.`;
      note.style.color = 'var(--tp-green)';
    } else {
      note.textContent = 'Schedule not set. Enable above and save to activate.';
      note.style.color = '';
    }
    const timeRow = $('#schedule-time-row');
    if (timeRow) timeRow.style.display = schedulePrefs.enabled ? 'flex' : 'none';
  }

  /* ── Column selector ────────────────────────────────────── */
  const DEFAULT_COLUMNS = () => window.TemuXlsx?.MAIN_COLUMNS || [];
  const ALL_COLUMNS     = () => window.TemuXlsx?.ALL_COLUMNS  || DEFAULT_COLUMNS();

  function renderColGrid() {
    const grid = $('#col-grid');
    if (!grid) return;
    const allCols = ALL_COLUMNS();
    const defCols = new Set(DEFAULT_COLUMNS());
    const active  = new Set(selectedColumns || DEFAULT_COLUMNS());

    grid.replaceChildren();
    allCols.forEach(col => {
      const label = document.createElement('label');
      label.className = 'tp-col-item' + (active.has(col) ? ' is-checked' : '') + (!defCols.has(col) ? ' is-new' : '');
      label.setAttribute('title', col);

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = col;
      input.checked = active.has(col);
      input.setAttribute('aria-label', col);

      const span = document.createElement('span');
      span.textContent = col;

      input.addEventListener('change', () => {
        if (input.checked) { label.classList.add('is-checked'); active.add(col); }
        else               { label.classList.remove('is-checked'); active.delete(col); }
        selectedColumns = allCols.filter(c => active.has(c)); // preserve order
        chrome.storage.local.set({ [COLS_KEY]: selectedColumns }).catch(() => {});
        feedback(`Column "${col}" ${input.checked ? 'added to' : 'removed from'} export.`, 'info');
      });

      label.append(input, span);
      grid.appendChild(label);
    });
  }

  /* ── Save schedule ──────────────────────────────────────── */
  async function saveSchedule() {
    try {
      await chrome.storage.local.set({ [SCHEDULE_KEY]: schedulePrefs });
      if (schedulePrefs.enabled && schedulePrefs.time) {
        await send({ type: 'TEMU_SCHEDULE_SET', time: schedulePrefs.time, enabled: true });
        feedback(`Daily auto-run scheduled at ${schedulePrefs.time}.`, 'success');
      } else {
        await send({ type: 'TEMU_SCHEDULE_SET', enabled: false });
        feedback('Schedule cleared.', 'success');
      }
    } catch (_) { feedback('Could not save schedule.', 'error'); }
    renderScheduleStatus();
  }

  /* ── Notification permission ────────────────────────────── */
  async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') {
      feedback('Notification permission was blocked. Enable it in browser settings.', 'error');
      return false;
    }
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  /* ── Load all data ──────────────────────────────────────── */
  async function load() {
    try {
      const [response, stored] = await Promise.all([
        send({ type: 'TEMU_GET_STATE' }),
        chrome.storage.local.get([HISTORY_KEY, UI_KEY, SCHEDULE_KEY, COLS_KEY])
      ]);
      state          = { ...defaultState(), ...(response.state || {}) };
      historyEntries = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY].slice(0, HISTORY_LIMIT) : [];
      uiPrefs        = { ...uiPrefs, ...(stored[UI_KEY]       || {}) };
      schedulePrefs  = { ...schedulePrefs, ...(stored[SCHEDULE_KEY] || {}) };
      selectedColumns = Array.isArray(stored[COLS_KEY]) && stored[COLS_KEY].length ? stored[COLS_KEY] : null;
    } catch (_) {
      try {
        const stored = await chrome.storage.local.get([STATE_KEY, HISTORY_KEY, UI_KEY, SCHEDULE_KEY, COLS_KEY]);
        state          = { ...defaultState(), ...(stored[STATE_KEY]     || {}) };
        historyEntries = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY].slice(0, HISTORY_LIMIT) : [];
        uiPrefs        = { ...uiPrefs, ...(stored[UI_KEY]       || {}) };
        schedulePrefs  = { ...schedulePrefs, ...(stored[SCHEDULE_KEY] || {}) };
        selectedColumns = Array.isArray(stored[COLS_KEY]) && stored[COLS_KEY].length ? stored[COLS_KEY] : null;
      } catch (err) { feedback('Could not load workspace data.', 'error'); }
    }

    // Sync toggles
    $$('[data-setting]').forEach(input => {
      const key = input.dataset.setting;
      if (key === 'scheduleEnabled') input.checked = Boolean(schedulePrefs.enabled);
      else if (key in uiPrefs) input.checked = Boolean(uiPrefs[key]);
    });
    const timeInput = $('[data-role="schedule-time"]');
    if (timeInput && schedulePrefs.time) timeInput.value = schedulePrefs.time;

    renderState();
    renderHistory();
    renderDiagnostics();
    renderScheduleStatus();
    renderColGrid();
  }

  /* ── Download helper (passes selected columns) ──────────── */
  function downloadRecords(records, errors) {
    const cols = selectedColumns && selectedColumns.length ? selectedColumns : undefined;
    window.TemuXlsx.downloadWorkbook(records, errors, cols);
  }

  /* ── Action runner ──────────────────────────────────────── */
  async function run(action, trigger) {
    if (busy) return;
    busy = true;
    if (trigger) { trigger.disabled = true; trigger.setAttribute('aria-busy', 'true'); }
    try {
      if (action === 'open-bulk') {
        await chrome.tabs.create({ url: state.sourceUrl || BULK_URL }); return;
      }
      if (action === 'resume') {
        const sent = await send({ type: 'TEMU_OPEN_PANEL' });
        if (!sent?.ok) await chrome.tabs.create({ url: state.sourceUrl || BULK_URL });
        return;
      }
      if (action === 'retry')    await send({ type: 'TEMU_RETRY_FAILED' });
      if (action === 'stop')     await send({ type: 'TEMU_STOP_JOB' });
      if (action === 'download-current') {
        const records = (state.records || []).map(cleanRecord);
        if (!records.length) { feedback('No workbook rows are ready yet.', 'warning'); return; }
        downloadRecords(records, [...(state.errors||[]), ...(state.warnings||[]).map(w => ({ ...w, message: w.message || 'Parser warning' }))]);
        feedback('Workbook download started.', 'success'); return;
      }
      if (action === 'clear-history') {
        historyEntries = [];
        await chrome.storage.local.set({ [HISTORY_KEY]: [] });
        feedback('Sheet history cleared.', 'success');
        renderHistory(); return;
      }
      if (action === 'refresh')       { await load(); feedback('Workspace refreshed.', 'success'); return; }
      if (action === 'save-schedule') { await saveSchedule(); return; }
      if (action === 'cols-all') {
        selectedColumns = [...ALL_COLUMNS()];
        await chrome.storage.local.set({ [COLS_KEY]: selectedColumns });
        renderColGrid(); feedback('All columns selected.', 'success'); return;
      }
      if (action === 'cols-default') {
        selectedColumns = null;
        await chrome.storage.local.remove(COLS_KEY);
        renderColGrid(); feedback('Columns reset to default.', 'success'); return;
      }
      await load();
    } catch (error) {
      feedback(error?.message || 'Action could not be completed.', 'error');
    } finally {
      busy = false;
      if (trigger) { trigger.disabled = false; trigger.removeAttribute('aria-busy'); }
      renderState();
    }
  }

  /* ── Event listeners ────────────────────────────────────── */
  // History list clicks
  $('[data-role="history-list"]').addEventListener('click', event => {
    const btn = event.target.closest('[data-history-action]');
    if (!btn) return;
    const entry = historyEntries.find(e => e.id === btn.dataset.historyId);
    if (!entry) return;
    if (btn.dataset.historyAction === 'download') {
      downloadRecords((entry.records || []).map(cleanRecord), entry.errorsData || []);
      feedback('Downloading history workbook…', 'success');
    }
    if (btn.dataset.historyAction === 'delete') {
      historyEntries = historyEntries.filter(e => e.id !== entry.id);
      chrome.storage.local.set({ [HISTORY_KEY]: historyEntries });
      renderHistory($('#history-search')?.value || '');
      feedback('History item deleted.', 'success');
    }
  });

  // General button clicks
  document.addEventListener('click', event => {
    const btn = event.target.closest('[data-action]');
    if (btn) void run(btn.dataset.action, btn);
  });

  // Column selector quick buttons
  $('#btn-cols-all')?.addEventListener('click', () => void run('cols-all'));
  $('#btn-cols-default')?.addEventListener('click', () => void run('cols-default'));

  // Settings toggles
  $$('[data-setting]').forEach(input => input.addEventListener('change', async event => {
    const key     = event.target.dataset.setting;
    const checked = event.target.checked;

    if (key === 'scheduleEnabled') {
      schedulePrefs.enabled = checked;
      renderScheduleStatus();
      await chrome.storage.local.set({ [SCHEDULE_KEY]: schedulePrefs });
      if (!checked) await send({ type: 'TEMU_SCHEDULE_SET', enabled: false }).catch(() => {});
    } else if (key === 'notifyOnComplete') {
      if (checked) {
        const granted = await requestNotificationPermission();
        if (!granted) { event.target.checked = false; return; }
      }
      uiPrefs[key] = checked;
      await chrome.storage.local.set({ [UI_KEY]: uiPrefs });
      try { await send({ type: 'TEMU_UI_PREFS_UPDATE', prefs: uiPrefs }); } catch (_) {}
      feedback(`Completion notifications ${checked ? 'enabled' : 'disabled'}.`, 'success');
    } else {
      uiPrefs[key] = checked;
      await chrome.storage.local.set({ [UI_KEY]: uiPrefs });
      try { await send({ type: 'TEMU_UI_PREFS_UPDATE', prefs: uiPrefs }); } catch (_) {}
      const labels = { motion: 'Motion effects', saveHistory: 'Sheet history', autoExport: 'Auto-export', autoRetry: 'Auto-retry' };
      feedback(`${labels[key] || key} ${checked ? 'enabled' : 'disabled'}.`, 'success');
    }
  }));

  // Schedule time
  $('[data-role="schedule-time"]')?.addEventListener('change', event => {
    schedulePrefs.time = event.target.value;
  });

  // Schedule enabled → show/hide time row
  $('#schedule-enabled')?.addEventListener('change', () => renderScheduleStatus());

  // History search filter
  $('#history-search')?.addEventListener('input', event => {
    renderHistory(event.target.value);
  });

  // Live state updates from background
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'TEMU_STATE_UPDATE') {
      state = { ...defaultState(), ...(message.state || {}) };
      renderState();
      renderDiagnostics();
    }
  });

  chrome.storage?.onChanged?.addListener(changes => {
    if (changes[HISTORY_KEY] || changes[UI_KEY] || changes[SCHEDULE_KEY]) load();
  });

  // Init
  load();
})();
