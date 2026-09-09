/*
 * constants.js — single source of truth shared by worker.js (via importScripts),
 * content.js (via manifest content_scripts) and tools.js (via <script>).
 *
 * Nothing in here touches the DOM or chrome.* APIs, so it is safe in every context.
 */
(function attachConstants(root) {
  'use strict';

  const SELLER_ORIGIN = 'https://seller.temu.com';
  const BULK_PATH     = '/buy-shipping-bulk-details.html';
  const DETAIL_PATH   = '/order-detail.html';

  /* Storage keys. Bump the suffix when the shape of the stored value changes. */
  const STORAGE_KEYS = Object.freeze({
    STATE:       'temuOrderExporterStateV7',
    UI:          'temuOrderExporterUiV1',
    HISTORY:     'temuOrderExporterHistoryV1',
    SCHEDULE:    'temuOrderExporterScheduleV1',
    COLUMNS:     'temuOrderExporterColumnsV1',
    CONCURRENCY: 'temuOrderExporterConcurrencyV1' // chrome.storage.session
  });

  /* Columns that MUST be present for a record to count as complete. */
  const REQUIRED_COLUMNS = Object.freeze([
    'Shipping Date', 'Order Date', 'Tracking Number', 'Order No', 'Customer Name',
    'Product Details', 'Qty (No)', 'Est. Revenue', 'Shipping Cost'
  ]);

  /* Optional columns: may be blank and never fail validation. */
  const OPTIONAL_COLUMNS = Object.freeze(['Carrier', 'SKU ID', 'Goods ID']);

  const ALL_COLUMNS  = Object.freeze([...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]);
  const MAIN_COLUMNS = REQUIRED_COLUMNS; // default export set (backward compatible)
  const ERROR_COLUMNS = Object.freeze(['Time', 'Order No', 'Package ID', 'Attempts', 'Error']);

  /* Columns where a blank value is allowed on continuation lines (line 2+ of a multi-product order). */
  const BLANK_ALLOWED_ON_CONTINUATION = Object.freeze(['Est. Revenue', 'Shipping Cost']);

  const HISTORY_LIMIT = 20;

  const SPEED_PROFILES = Object.freeze({
    STEALTH:  Object.freeze({ id: 'stealth',  label: 'Stealth (Safe)', concurrency: 1, minDelay: 1400, maxDelay: 2600 }),
    BALANCED: Object.freeze({ id: 'balanced', label: 'Balanced',       concurrency: 2, minDelay: 200,  maxDelay: 400 }),
    TURBO:    Object.freeze({ id: 'turbo',    label: 'Turbo (Fast)',   concurrency: 4, minDelay: 0,    maxDelay: 50 })
  });

  const DEFAULT_UI_PREFS = Object.freeze({
    minimized: false, motion: true, saveHistory: true, autoExport: false,
    autoRetry: false, notifyOnComplete: false, fabRight: 18, fabBottom: 18, cardWidth: 320,
    speedProfile: 'balanced', autoPaginate: true
  });

  /* Message types exchanged between worker, content script and tools page. */
  const MSG = Object.freeze({
    START_JOB: 'TEMU_START_JOB', PAUSE_JOB: 'TEMU_PAUSE_JOB', RESUME_JOB: 'TEMU_RESUME_JOB',
    STOP_JOB: 'TEMU_STOP_JOB', RETRY_FAILED: 'TEMU_RETRY_FAILED', GET_STATE: 'TEMU_GET_STATE',
    STATE_UPDATE: 'TEMU_STATE_UPDATE', LOG: 'TEMU_LOG',
    OPEN_PANEL: 'TEMU_OPEN_PANEL', OPEN_TOOLS: 'TEMU_OPEN_TOOLS',
    SCHEDULE_SET: 'TEMU_SCHEDULE_SET', UI_PREFS_UPDATE: 'TEMU_UI_PREFS_UPDATE',
    DETAIL_RESULT: 'TEMU_DETAIL_RESULT', DETAIL_ERROR: 'TEMU_DETAIL_ERROR'
  });

  /* ── Pure helpers ─────────────────────────────────────────────── */

  function normalize(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Strip a time component: "Aug 25, 2026 3:14 pm" → "Aug 25, 2026"; "2026-08-25 15:14" → "2026-08-25". */
  function dateOnly(value) {
    const text = normalize(value);
    if (!text) return '';
    const monthDate = text.match(/^(.+?,\s*\d{4})/);
    if (monthDate) return monthDate[1].trim();
    const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoDate) return isoDate[1];
    const beforeTime = text.match(/^(.+?)(?=,?\s+\d{1,2}:\d{2}\s*(?:am|pm)?\b)/i);
    return beforeTime ? beforeTime[1].replace(/,\s*$/, '').trim() : text;
  }

  /** "$1,234.50" → 1234.5; returns null when not parseable. */
  function moneyNumber(value) {
    const cleaned = normalize(value).replace(/[^0-9.-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  /** Required columns missing from a record (respecting continuation-line rules). */
  function missingRequiredFields(record, lineIndex = 0) {
    return REQUIRED_COLUMNS.filter(column =>
      !normalize(record?.[column]) && (lineIndex === 0 || !BLANK_ALLOWED_ON_CONTINUATION.includes(column))
    );
  }

  root.TEMU_CONSTANTS = Object.freeze({
    SELLER_ORIGIN, BULK_PATH, DETAIL_PATH, STORAGE_KEYS,
    REQUIRED_COLUMNS, OPTIONAL_COLUMNS, ALL_COLUMNS, MAIN_COLUMNS, ERROR_COLUMNS,
    BLANK_ALLOWED_ON_CONTINUATION, HISTORY_LIMIT, DEFAULT_UI_PREFS, SPEED_PROFILES, MSG,
    normalize, dateOnly, moneyNumber, missingRequiredFields
  });
})(typeof self !== 'undefined' ? self : globalThis);
