/**
 * Widget and visual specifications.
 *
 * The Host validates every model-supplied value before it reaches the Client
 * or the disk: the widget spec is a bounded structure (rows, actions, labels),
 * and a published visual must be one self-contained HTML document with no
 * external resources. Normalization returns a canonical copy, so the Client
 * renders exactly what was submitted and the tests can pin the contract.
 */

export const ASK_MODULES = ['interactive', 'overview'];
export const PUBLISH_MODULES = ['diagram', 'mockup', 'interactive', 'chart'];

export const ASK_LIMITS = {
  maxTitle: 140,
  maxKicker: 80,
  maxSubtitle: 240,
  maxMetricValue: 16,
  maxMetricLabel: 80,
  maxRows: 14,
  maxRowTitle: 140,
  maxRowNote: 28,
  maxRowDetail: 200,
  maxActions: 4,
  maxActionLabel: 28,
  maxActionId: 32,
  maxFooterNote: 240,
  maxLabelButton: 32,
};

export const PUBLISH_LIMITS = {
  maxTitle: 140,
  maxSummary: 600,
  maxHtmlBytes: 512 * 1024,
};

export class SpecError extends Error {
  /**
   * @param {string} code stable machine code returned to the model
   * @param {string} message actionable English text
   */
  constructor(code, message) {
    super(message);
    this.name = 'SpecError';
    this.code = code;
  }
}

const ACTION_TONES = ['default', 'primary', 'muted'];
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, { field, required = false, max, code }) {
  if (value === undefined || value === null) {
    if (required) throw new SpecError(code ?? 'MISSING_FIELD', `${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new SpecError(code ?? 'INVALID_FIELD', `${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (required) throw new SpecError(code ?? 'MISSING_FIELD', `${field} must not be empty`);
    return undefined;
  }
  if (trimmed.length > max) {
    throw new SpecError('FIELD_TOO_LONG', `${field} must be at most ${max} characters`);
  }
  return trimmed;
}

function oneOf(value, allowed, { field, required = false, code = 'INVALID_FIELD' }) {
  if (value === undefined || value === null) {
    if (required) throw new SpecError(code, `${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new SpecError(code, `${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function normalizeId(value, { field, fallback }) {
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  if (!ID_PATTERN.test(trimmed)) {
    throw new SpecError('INVALID_ID', `${field} must match ${ID_PATTERN.source}`);
  }
  return trimmed;
}

/**
 * Validate and normalize the `visual_ask` widget specification.
 * @param {unknown} input raw model arguments
 * @returns {object} canonical spec
 */
export function normalizeAskSpec(input) {
  if (!isRecord(input)) throw new SpecError('INVALID_SPEC', 'widget spec must be an object');
  const title = text(input.title, { field: 'title', required: true, max: ASK_LIMITS.maxTitle, code: 'MISSING_TITLE' });
  const kicker = text(input.kicker, { field: 'kicker', max: ASK_LIMITS.maxKicker });
  const subtitle = text(input.subtitle, { field: 'subtitle', max: ASK_LIMITS.maxSubtitle });
  const submitLabel = text(input.submitLabel, { field: 'submitLabel', max: ASK_LIMITS.maxLabelButton });
  const resetLabel = text(input.resetLabel, { field: 'resetLabel', max: ASK_LIMITS.maxLabelButton });
  const summaryLabel = text(input.summaryLabel, { field: 'summaryLabel', max: ASK_LIMITS.maxSubtitle });

  let metric;
  if (input.metric !== undefined && input.metric !== null) {
    if (!isRecord(input.metric)) throw new SpecError('INVALID_METRIC', 'metric must be an object');
    metric = {
      value: text(input.metric.value, { field: 'metric.value', required: true, max: ASK_LIMITS.maxMetricValue, code: 'MISSING_METRIC_VALUE' }),
      label: text(input.metric.label, { field: 'metric.label', max: ASK_LIMITS.maxMetricLabel }),
    };
  }

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new SpecError('MISSING_ROWS', 'rows must be a non-empty array');
  }
  if (input.rows.length > ASK_LIMITS.maxRows) {
    throw new SpecError('TOO_MANY_ROWS', `rows must contain at most ${ASK_LIMITS.maxRows} items`);
  }

  const seenRows = new Set();
  const rows = input.rows.map((raw, index) => {
    if (!isRecord(raw)) throw new SpecError('INVALID_ROW', `rows[${index}] must be an object`);
    const id = normalizeId(raw.id, { field: `rows[${index}].id`, fallback: `r${index + 1}` });
    if (seenRows.has(id)) throw new SpecError('DUPLICATE_ROW_ID', `rows[${index}].id is duplicated`);
    seenRows.add(id);
    const rowTitle = text(raw.title, { field: `rows[${index}].title`, required: true, max: ASK_LIMITS.maxRowTitle, code: 'MISSING_ROW_TITLE' });
    const note = text(raw.note, { field: `rows[${index}].note`, max: ASK_LIMITS.maxRowNote });
    const detail = text(raw.detail, { field: `rows[${index}].detail`, max: ASK_LIMITS.maxRowDetail });

    if (!Array.isArray(raw.actions) || raw.actions.length < 2) {
      throw new SpecError('MISSING_ACTIONS', `rows[${index}].actions must contain 2 to ${ASK_LIMITS.maxActions} actions`);
    }
    if (raw.actions.length > ASK_LIMITS.maxActions) {
      throw new SpecError('TOO_MANY_ACTIONS', `rows[${index}].actions must contain at most ${ASK_LIMITS.maxActions} actions`);
    }
    const seenActions = new Set();
    const actions = raw.actions.map((action, actionIndex) => {
      if (!isRecord(action)) throw new SpecError('INVALID_ACTION', `rows[${index}].actions[${actionIndex}] must be an object`);
      const actionId = normalizeId(action.id, { field: `rows[${index}].actions[${actionIndex}].id`, fallback: `a${actionIndex + 1}` });
      if (seenActions.has(actionId)) throw new SpecError('DUPLICATE_ACTION_ID', `rows[${index}].actions[${actionIndex}].id is duplicated`);
      seenActions.add(actionId);
      return {
        id: actionId,
        label: text(action.label, {
          field: `rows[${index}].actions[${actionIndex}].label`,
          required: true,
          max: ASK_LIMITS.maxActionLabel,
          code: 'MISSING_ACTION_LABEL',
        }),
        tone: oneOf(action.tone, ACTION_TONES, { field: `rows[${index}].actions[${actionIndex}].tone` }) ?? 'default',
      };
    });
    const defaultAction = normalizeId(raw.defaultAction, { field: `rows[${index}].defaultAction`, fallback: null });
    const knownDefault = defaultAction !== null && actions.some((action) => action.id === defaultAction)
      ? defaultAction
      : actions[0].id;
    return { id, title: rowTitle, note, detail, actions, defaultAction: knownDefault };
  });

  return {
    title,
    kicker,
    subtitle,
    metric,
    rows,
    submitLabel: submitLabel ?? 'Отправить выбор',
    resetLabel: resetLabel ?? 'Сбросить',
    summaryLabel: summaryLabel ?? 'Принято',
  };
}

/**
 * Validate a submitted answer against the spec it answers.
 * @param {object} spec canonical spec from normalizeAskSpec
 * @param {unknown} payload raw answer from the widget
 * @returns {{selections: Array<{rowId: string, actionId: string, label: string, title: string}>, changed: number, note?: string}}
 */
export function normalizeAskAnswer(spec, payload) {
  if (!isRecord(payload)) throw new SpecError('INVALID_ANSWER', 'answer must be an object');
  const rawSelections = payload.selections;
  if (!Array.isArray(rawSelections) || rawSelections.length === 0) {
    throw new SpecError('MISSING_SELECTIONS', 'selections must be a non-empty array');
  }
  if (rawSelections.length > spec.rows.length) {
    throw new SpecError('TOO_MANY_SELECTIONS', 'selections cannot exceed rows');
  }
  const byRow = new Map(spec.rows.map((row) => [row.id, row]));
  const seen = new Set();
  const selections = rawSelections.map((entry, index) => {
    if (!isRecord(entry)) throw new SpecError('INVALID_SELECTION', `selections[${index}] must be an object`);
    const row = byRow.get(String(entry.rowId ?? ''));
    if (row === undefined) throw new SpecError('UNKNOWN_ROW', `selections[${index}].rowId does not match a row`);
    if (seen.has(row.id)) throw new SpecError('DUPLICATE_SELECTION', `selections[${index}].rowId is duplicated`);
    seen.add(row.id);
    const action = row.actions.find((candidate) => candidate.id === String(entry.actionId ?? ''));
    if (action === undefined) throw new SpecError('UNKNOWN_ACTION', `selections[${index}].actionId does not match a row action`);
    return { rowId: row.id, actionId: action.id, label: action.label, title: row.title };
  });
  if (selections.length !== spec.rows.length) {
    throw new SpecError('INCOMPLETE_SELECTIONS', 'every row must have exactly one selected action');
  }
  const changed = selections.filter((selection) => {
    const row = byRow.get(selection.rowId);
    return row.defaultAction !== selection.actionId;
  }).length;
  const note = typeof payload.note === 'string' ? payload.note.trim().slice(0, 400) : undefined;
  return { selections, changed, ...(note === undefined || note === '' ? {} : { note }) };
}

const EXTERNAL_RESOURCE_PATTERNS = [
  /<script\b[^>]*\bsrc\s*=\s*["']\s*(?:https?:)?\/\//i,
  /<link\b[^>]*\bhref\s*=\s*["']\s*(?:https?:)?\/\//i,
  /<img\b[^>]*\bsrc\s*=\s*["']\s*(?:https?:)?\/\//i,
  /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i,
  /\bfetch\s*\(\s*["']\s*(?:https?:)?\/\//i,
];

/**
 * Validate and normalize a `visual_publish` request. Rejects content that
 * would need the network: the published page runs in a sandbox with no
 * external connections, so an external reference would render as a hole.
 * @param {unknown} input raw model arguments
 * @returns {{title: string, module: string, html: string, summary?: string, bytes: number}}
 */
export function normalizePublish(input) {
  if (!isRecord(input)) throw new SpecError('INVALID_SPEC', 'visual request must be an object');
  const title = text(input.title, { field: 'title', required: true, max: PUBLISH_LIMITS.maxTitle, code: 'MISSING_TITLE' });
  const module = oneOf(input.module, PUBLISH_MODULES, { field: 'module', required: true, code: 'MISSING_MODULE' });
  const summary = text(input.summary, { field: 'summary', max: PUBLISH_LIMITS.maxSummary });
  if (typeof input.html !== 'string') throw new SpecError('MISSING_HTML', 'html must be a string');
  const html = input.html.trim();
  if (html.length === 0) throw new SpecError('MISSING_HTML', 'html must not be empty');
  if (!/^<!doctype html>|^<html\b/i.test(html)) {
    throw new SpecError('INVALID_HTML', 'html must be a complete document starting with <!doctype html> or <html>');
  }
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > PUBLISH_LIMITS.maxHtmlBytes) {
    throw new SpecError('HTML_TOO_LARGE', `html must be at most ${PUBLISH_LIMITS.maxHtmlBytes} bytes (got ${bytes})`);
  }
  for (const pattern of EXTERNAL_RESOURCE_PATTERNS) {
    if (pattern.test(html)) {
      throw new SpecError('EXTERNAL_RESOURCE', 'html must be self-contained: inline CSS and JavaScript, no external scripts, styles, images, fonts or fetch calls');
    }
  }
  return { title, module, html, summary, bytes };
}
