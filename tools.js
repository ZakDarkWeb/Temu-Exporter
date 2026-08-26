(() => {
  'use strict';
  const STATE_KEY   = 'temuOrderExporterStateV7';
  const UI_KEY      = 'temuOrderExporterUiV1';
  const HISTORY_KEY = 'temuOrderExporterHistoryV1';
  const SCHEDULE_KEY= 'temuOrderExporterScheduleV1';
  const HISTORY_LIMIT = 20;
  const BULK_URL = 'https://seller.temu.com/buy-shipping-bulk-details.html';
  let state = defaultState();
  let historyEntries = [];
  let uiPrefs = { minimized: false, motion: true, saveHistory: true, autoExport: false, autoRetry: false, notifyOnComplete: false };
  let schedulePrefs = { enabled: false, time: '09:00' };
  let busy = false;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  function defaultState() {
    return { version: 8, status: 'idle', sourceUrl: '', rows: [], records: [], errors: [], warnings: [], inFlight: [], attempts: {}, updatedAt: null };
  }
  function cleanRecord(record) {
    if (!record) return record;
    const { __key, __index, __attempts, __lineIndex, ...clean } = record;
    return clean;
  }
  function formatDate(value) {
    try { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return value || ''; }
  }
  function stats() {
    const total = Array.isArray(state.rows) ? state.rows.length : 0;
    const records = Array.isArray(state.records) ? state.records : [];
    const done = new Set(records.map(r => r.__key || `${r['Order No'] || ''}::${r['Tracking Number'] || ''}`)).size;
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
    const el = $('[data-role="feedback"]');
    if (!el) return;
    el.textContent = message; el.dataset.tone = tone; el.hidden = false;
    clearTimeout(feedback.timer);
    feedback.timer = setTimeout(() => { el.hidden = true; }, 4200);
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

  function empty(text) {
    const el = document.createElement('div');
    el.className = 'tools-empty'; el.textContent = text; return el;
  }

  function historyStatusBadge(entry) {
    const badge = document.createElement('span');
    if (entry.completed) {
      if ((entry.errors || 0) > 0) {
        badge.textContent = 'Partial'; badge.className = 'tools-history-badge partial';
      } else {
        badge.textContent = 'Complete'; badge.className = 'tools-history-badge complete';
      }
    } else {
      badge.textContent = 'Incomplete'; badge.className = 'tools-history-badge incomplete';
    }
    return badge;
  }

  function renderHistory() {
    const list = $('[data-role="history-list"]');
    list.replaceChildren();
    if (!historyEntries.length) { list.appendChild(empty('No saved sheets yet. Completed workbooks will appear here.')); return; }
    historyEntries.slice(0, HISTORY_LIMIT).forEach(entry => {
      const item = document.createElement('div'); item.className = 'tools-history-item';
      // Icon
      const iconWrap = document.createElement('div'); iconWrap.className = 'tools-history-icon-wrap';
      iconWrap.innerHTML = `<svg viewBox="0 0 16 16" fill="none"><path d="M4 2h5l3 3v9H4V2Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 2v3h3" stroke="currentColor" stroke-width="1.3"/><path d="M6 8h4M6 11h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
      const main = document.createElement('div'); main.className = 'tools-history-main';
      const topRow = document.createElement('div'); topRow.className = 'tools-history-top-row';
      const title = document.createElement('strong'); title.textContent = formatDate(entry.createdAt);
      topRow.append(title, historyStatusBadge(entry));
      const meta = document.createElement('small');
      meta.textContent = `${Number(entry.orders)||0} orders · ${Number(entry.rows)||0} rows · ${Number(entry.errors)||0} errors · ${Number(entry.warnings)||0} notes`;
      main.append(topRow, meta);
      const actions = document.createElement('div'); actions.className = 'tools-history-actions';
      [['download', 'Download this sheet', '↓'], ['delete', 'Delete this history item', '×']].forEach(([action, label, text]) => {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.dataset.historyAction = action; btn.dataset.historyId = entry.id;
        btn.title = label; btn.setAttribute('aria-label', label); btn.textContent = text;
        actions.appendChild(btn);
      });
      item.append(iconWrap, main, actions);
      list.appendChild(item);
    });
  }

  function renderDiagnostics() {
    const list = $('[data-role="diagnostics"]'); list.replaceChildren();
    const rows = [...(state.errors||[]).map(e=>({...e,tone:'error',label:'Error'})), ...(state.warnings||[]).map(w=>({...w,tone:'warning',label:'Note'}))];
    $('[data-role="diagnostic-count"]').textContent = `${rows.length} entr${rows.length===1?'y':'ies'}`;
    if (!rows.length) { list.appendChild(empty('No errors or parser notes in the current batch.')); return; }
    rows.slice(0,80).forEach(row => {
      const item = document.createElement('div'); item.className = 'tools-diagnostic'; item.dataset.tone = row.tone;
      const copy = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = row.label;
      const detail = document.createElement('small'); detail.textContent = row.message || 'No additional details available.';
      copy.append(title, detail); item.appendChild(copy); list.appendChild(item);
    });
  }

  function renderScheduleStatus() {
    const note = $('[data-role="schedule-status"]');
    if (!note) return;
    if (schedulePrefs.enabled && schedulePrefs.time) {
      note.textContent = `✓ Auto-run scheduled daily at ${schedulePrefs.time}. Chrome must be running at that time.`;
      note.style.color = 'var(--green)';
    } else {
      note.textContent = 'Schedule not set. Enable above and save to activate.';
      note.style.color = '';
    }
    // Show/hide time row
    const timeRow = $('#schedule-time-row');
    if (timeRow) timeRow.style.display = schedulePrefs.enabled ? 'flex' : 'none';
  }

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

  async function load() {
    try {
      const [response, stored] = await Promise.all([
        send({ type: 'TEMU_GET_STATE' }),
        chrome.storage.local.get([HISTORY_KEY, UI_KEY, SCHEDULE_KEY])
      ]);
      state = { ...defaultState(), ...(response.state || {}) };
      historyEntries = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY].slice(0, HISTORY_LIMIT) : [];
      uiPrefs = { ...uiPrefs, ...(stored[UI_KEY] || {}) };
      schedulePrefs = { ...schedulePrefs, ...(stored[SCHEDULE_KEY] || {}) };
    } catch (_) {
      try {
        const stored = await chrome.storage.local.get([STATE_KEY, HISTORY_KEY, UI_KEY, SCHEDULE_KEY]);
        state = { ...defaultState(), ...(stored[STATE_KEY] || {}) };
        historyEntries = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY].slice(0, HISTORY_LIMIT) : [];
        uiPrefs = { ...uiPrefs, ...(stored[UI_KEY] || {}) };
        schedulePrefs = { ...schedulePrefs, ...(stored[SCHEDULE_KEY] || {}) };
      } catch (err) { feedback('Could not load local workspace state.', 'error'); }
    }
    // Sync all settings toggles
    $$('[data-setting]').forEach(input => {
      const key = input.dataset.setting;
      if (key in uiPrefs) input.checked = Boolean(uiPrefs[key]);
      if (key === 'scheduleEnabled') input.checked = Boolean(schedulePrefs.enabled);
    });
    // Sync schedule time
    const timeInput = $('[data-role="schedule-time"]');
    if (timeInput && schedulePrefs.time) timeInput.value = schedulePrefs.time;

    renderState(); renderHistory(); renderDiagnostics(); renderScheduleStatus();
  }

  async function run(action, trigger) {
    if (busy) return;
    busy = true;
    if (trigger) { trigger.disabled = true; trigger.setAttribute('aria-busy', 'true'); }
    try {
      if (action === 'open-bulk') { await chrome.tabs.create({ url: state.sourceUrl || BULK_URL }); return; }
      if (action === 'resume') { const sent = await send({ type: 'TEMU_OPEN_PANEL' }); if (!sent?.ok) await chrome.tabs.create({ url: state.sourceUrl || BULK_URL }); return; }
      if (action === 'retry') await send({ type: 'TEMU_RETRY_FAILED' });
      if (action === 'stop') await send({ type: 'TEMU_STOP_JOB' });
      if (action === 'download-current') {
        const records = (state.records || []).map(cleanRecord);
        if (!records.length) { feedback('No workbook rows are ready yet.', 'warning'); return; }
        window.TemuXlsx.downloadWorkbook(records, [...(state.errors||[]), ...(state.warnings||[]).map(w=>({...w,message:w.message||'Parser warning'}))]);
        feedback('Workbook download started.', 'success'); return;
      }
      if (action === 'clear-history') {
        historyEntries = [];
        await chrome.storage.local.set({ [HISTORY_KEY]: [] });
        feedback('Sheet history cleared.', 'success');
      }
      if (action === 'refresh') { await load(); feedback('Workspace refreshed.', 'success'); return; }
      if (action === 'save-schedule') { await saveSchedule(); return; }
      await load();
    } catch (error) { feedback(error?.message || 'Action could not be completed.', 'error'); }
    finally { busy = false; if (trigger) trigger.removeAttribute('aria-busy'); renderState(); }
  }

  // History list clicks
  $('[data-role="history-list"]').addEventListener('click', event => {
    const button = event.target.closest('[data-history-action]');
    if (!button) return;
    const entry = historyEntries.find(c => c.id === button.dataset.historyId);
    if (!entry) return;
    if (button.dataset.historyAction === 'download') {
      window.TemuXlsx.downloadWorkbook((entry.records||[]).map(cleanRecord), entry.errorsData||[]);
    }
    if (button.dataset.historyAction === 'delete') {
      historyEntries = historyEntries.filter(c => c.id !== entry.id);
      chrome.storage.local.set({ [HISTORY_KEY]: historyEntries });
      renderHistory();
      feedback('History item deleted.', 'success');
    }
  });

  // General action clicks
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (button) void run(button.dataset.action, button);
  });

  // Settings toggles
  $$('[data-setting]').forEach(input => input.addEventListener('change', async event => {
    const key = event.target.dataset.setting;
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
      feedback(`${labels[key]||key} ${checked ? 'enabled' : 'disabled'}.`, 'success');
    }
  }));

  // Schedule time input
  const timeInput = $('[data-role="schedule-time"]');
  if (timeInput) {
    timeInput.addEventListener('change', event => { schedulePrefs.time = event.target.value; });
  }

  // Schedule enabled toggle show/hide time row
  const scheduleEnabledInput = $('#schedule-enabled');
  if (scheduleEnabledInput) {
    scheduleEnabledInput.addEventListener('change', () => renderScheduleStatus());
  }

  // Live state updates
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

  load();
})();
