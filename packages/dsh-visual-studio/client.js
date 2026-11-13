/**
 * dsh-visual-studio — Client (browser) half.
 *
 * Two surfaces:
 *  - inline tool views for `visual_ask` (structured choice widget) and
 *    `visual_publish` (publication card), registered in the keyed
 *    `tool.call.toolview` slot;
 *  - the «Визуализации» tab in the right sidebar: artifact list, sandboxed
 *    preview, versions, device width, download and full-screen mode.
 *
 * Plain ESM through `window.__ModuleLoader__`, React from the host, one
 * injected `<style data-plugin>`, theme tokens only, no external libraries.
 * The widget is rendered by this plugin (not by agent HTML), so it always
 * matches the host theme; only published visuals run in a sandboxed iframe.
 */
window.__ModuleLoader__.load({
  id: 'dsh-visual-studio',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const PLUGIN_ID = 'dsh-visual-studio';
    const TAB_ID = 'dsh-visual-studio/panel';
    const TAB_KIND = 'dsh-visual-studio';
    const HEADER = 'x-dsh-visual-studio';
    const ROUTE_MANIFEST = '/plugins/dsh-visual-studio/manifest';
    const ROUTE_ASK = '/plugins/dsh-visual-studio/ask';
    const ROUTE_ARTIFACT = '/plugins/dsh-visual-studio/artifact';
    const POLL_MS = 2500;

    const DICT = {
      en: {
        'panel.title': 'Visual studio',
        'panel.description': 'Published visuals with versions and export',
        'panel.empty.title': 'No visuals yet',
        'panel.empty.body': 'Ask the agent to show a diagram, graph or screen mockup — it will appear here.',
        'panel.artifact': 'Visual',
        'panel.version': 'Version',
        'panel.width': 'Width',
        'panel.refresh': 'Refresh',
        'panel.download': 'Download HTML',
        'panel.print': 'Print / PDF',
        'panel.open': 'Open',
        'panel.fullscreen': 'Full screen',
        'panel.exitFullscreen': 'Exit full screen',
        'panel.fit': 'Fit',
        'panel.loading': 'Loading…',
        'panel.error': 'Could not load visuals',
        'panel.latest': 'latest',
        'panel.frameTitle': 'Visual preview',
        'widget.submit': 'Send choice',
        'widget.reset': 'Reset',
        'widget.changed': 'Changed: {n}',
        'widget.done': 'Accepted',
        'widget.doneCount': '{n} changed',
        'widget.showAnswers': 'Show answers',
        'widget.hideAnswers': 'Hide answers',
        'widget.closedTitle': 'Widget closed',
        'widget.closedBody': 'No answer was sent.',
        'widget.doneHint': 'The agent continues with your choice.',
        'widget.waiting': 'Sending…',
        'widget.failed': 'Could not send the choice',
        'widget.closed': 'Widget closed',
        'widget.closedHint': 'No answer was sent; the agent got a timeout.',
        'widget.sending': 'Choosing…',
        'publish.opening': 'Publishing visual…',
        'publish.open': 'Open in the Visual studio panel',
        'publish.done': 'Published',
        'publish.version': 'version',
      },
      ru: {
        'panel.title': 'Визуализации',
        'panel.description': 'Опубликованные визуалы с версиями и экспортом',
        'panel.empty.title': 'Пока нет визуализаций',
        'panel.empty.body': 'Попросите агента показать схему, граф или мокап экрана — визуал появится здесь.',
        'panel.artifact': 'Визуал',
        'panel.version': 'Версия',
        'panel.width': 'Ширина',
        'panel.refresh': 'Обновить',
        'panel.download': 'Скачать HTML',
        'panel.print': 'Печать / PDF',
        'panel.open': 'Открыть',
        'panel.fullscreen': 'На весь экран',
        'panel.exitFullscreen': 'Выйти из полного экрана',
        'panel.fit': 'По ширине',
        'panel.loading': 'Загружаю…',
        'panel.error': 'Не удалось загрузить визуализации',
        'panel.latest': 'последняя',
        'panel.frameTitle': 'Предпросмотр визуала',
        'widget.submit': 'Отправить выбор',
        'widget.reset': 'Сбросить',
        'widget.changed': 'Изменено: {n}',
        'widget.done': 'Принято',
        'widget.doneCount': 'изменено: {n}',
        'widget.showAnswers': 'Показать ответы',
        'widget.hideAnswers': 'Свернуть ответы',
        'widget.closedTitle': 'Виджет закрыт',
        'widget.closedBody': 'Ответ не отправлен.',
        'widget.doneHint': 'Агент продолжает с вашим выбором.',
        'widget.waiting': 'Отправляю…',
        'widget.failed': 'Не удалось отправить выбор',
        'widget.closed': 'Виджет закрыт',
        'widget.closedHint': 'Ответ не отправлен, у агента истекло время ожидания.',
        'widget.sending': 'Выбираю…',
        'publish.opening': 'Публикую визуализацию…',
        'publish.open': 'Открыть в панели «Визуализации»',
        'publish.done': 'Опубликовано',
        'publish.version': 'версия',
      },
    };

    const CSS = `
.dvs-widget, .dvs-card { border: 1px solid var(--dsw-alias-border-l2, #e3e1dc); background: var(--dsw-alias-bg-layer-1, #fff);
  border-radius: 12px; overflow: hidden; margin: 4px 0; font-size: 13px; line-height: 1.45;
  color: var(--dsw-alias-label-primary, #1d1d1b); }
.dvs-head { padding: 12px 14px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, #f1efec); }
.dvs-kicker { font-size: 11px; color: var(--dsw-alias-label-tertiary, #9a968e); }
.dvs-title { font-size: 15.5px; font-weight: 650; margin-top: 2px; letter-spacing: -0.01em; }
.dvs-sub { font-size: 12px; color: var(--dsw-alias-label-secondary, #8c887f); margin-top: 2px; }
.dvs-metric { display: flex; align-items: baseline; gap: 8px; margin-top: 10px; }
.dvs-metric b { font-size: 28px; font-weight: 650; letter-spacing: -0.02em; }
.dvs-metric span { font-size: 12px; color: var(--dsw-alias-label-secondary, #8c887f); }
.dvs-rows { padding: 2px 8px 6px; }
.dvs-row { display: flex; align-items: center; gap: 12px; padding: 9px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, #f4f2ef); border-radius: 8px; }
.dvs-row:last-child { border-bottom: 0; }
.dvs-row-changed { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #e3a23c) 12%, transparent); }
.dvs-rowtext { flex: 1; min-width: 0; }
.dvs-rowname { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dvs-rowname b { font-size: 12.5px; font-weight: 600; }
.dvs-note { font-size: 10px; color: var(--dsw-alias-link, #4d6bfe); background: var(--dsw-alias-bg-layer-3, #eef2fb); border-radius: 999px; padding: 1px 6px; white-space: nowrap; }
.dvs-rowdetail { font-size: 11px; color: var(--dsw-alias-label-tertiary, #9a968e); margin-top: 1px; }
.dvs-actions { display: flex; gap: 5px; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; }
.dvs-btn { height: 28px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2, #e3e0da); border-radius: 7px;
  background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #45433e); font: inherit;
  font-size: 12px; cursor: pointer; white-space: nowrap; }
.dvs-btn:hover { background: var(--dsw-alias-interactive-bg-hover, #f4f3f0); }
.dvs-btn:disabled { opacity: 0.55; cursor: default; }
.dvs-btn.on { border-color: var(--dsw-alias-brand-primary, #4d6bfe);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 12%, transparent);
  color: var(--dsw-alias-brand-primary, #4d6bfe); font-weight: 600; }
.dvs-btn.primary { background: var(--dsw-alias-button-primary-fill, #4d6bfe); border-color: transparent;
  color: var(--dsw-alias-label-primary-inverted, #fff); font-weight: 600; }
.dvs-btn.primary:hover { background: var(--dsw-alias-button-primary-hover, #3f5ce0); }
.dvs-btn.muted { color: var(--dsw-alias-label-secondary, #78756e); }
.dvs-foot { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--dsw-alias-border-l1, #f1efec);
  background: var(--dsw-alias-bg-layer-2, #fcfcfb); flex-wrap: wrap; }
.dvs-grow { flex: 1; }
.dvs-changed-label { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #6f6b64); }
.dvs-error { font-size: 11.5px; color: var(--dsw-alias-label-error, #c0453a); }
.dvs-done-head { display: flex; align-items: center; gap: 12px; padding: 12px 14px; cursor: pointer; user-select: none; }
.dvs-done-head:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: -2px; border-radius: 12px; }
.dvs-done-icon { width: 30px; height: 30px; border-radius: 50%; flex: 0 0 30px; display: grid; place-items: center;
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #4caf7d) 16%, transparent);
  color: var(--dsw-alias-state-success-primary, #4caf7d); font-size: 15px; font-weight: 700; }
.dvs-done-icon.closed { background: var(--dsw-alias-bg-layer-3, #f1f0ed); color: var(--dsw-alias-label-secondary, #78756e); }
.dvs-done-body { flex: 1; min-width: 0; }
.dvs-done-title { font-size: 13px; font-weight: 600; }
.dvs-done-sub { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8c887f); margin-top: 1px; }
.dvs-done-chev { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary, #a8a49c); transition: transform .15s ease; font-size: 11px; }
.dvs-done-head[aria-expanded="true"] .dvs-done-chev { transform: rotate(180deg); }
.dvs-answers { border-top: 1px solid var(--dsw-alias-border-l1, #f1efec); padding: 4px 12px 8px; }
.dvs-answer { display: flex; align-items: center; gap: 10px; padding: 7px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1, #f4f2ef); font-size: 12.5px; }
.dvs-answer:last-child { border-bottom: 0; }
.dvs-answer.changed { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #e3a23c) 12%, transparent); border-radius: 8px; }
.dvs-answer-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvs-answer-label { flex: 0 0 auto; font-weight: 600; color: var(--dsw-alias-brand-primary, #3346c8); white-space: nowrap; }
.dvs-answer.changed .dvs-answer-label { color: var(--dsw-alias-state-warn-primary, #8a5f14); }
.dvs-badge { display: inline-flex; align-items: center; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--dsw-alias-label-secondary, #78756e); background: var(--dsw-alias-bg-layer-3, #f1f0ed);
  border-radius: 5px; padding: 1px 6px; }
.dvs-pub { padding: 12px 14px; }
.dvs-pub-title { font-size: 14px; font-weight: 600; margin-top: 4px; }
.dvs-pub-sub { font-size: 12px; color: var(--dsw-alias-label-secondary, #8c887f); margin-top: 3px; }
.dvs-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--dsw-alias-bg-base, #fbfbfa);
  color: var(--dsw-alias-label-primary, #1d1d1b); }
.dvs-panel-fs { position: fixed; inset: 0; z-index: 2147483000; background: var(--dsw-alias-bg-base, #fbfbfa); }
.dvs-bar { display: flex; align-items: center; gap: 6px; padding: 7px 9px; border-bottom: 1px solid var(--dsw-alias-border-l1, #eae8e4); flex-wrap: wrap; }
.dvs-select { height: 26px; max-width: 190px; border: 1px solid var(--dsw-alias-border-l2, #e3e0da); border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #2b2a27); font: inherit; font-size: 11.5px; padding: 0 6px; }
.dvs-toolbar-btn { height: 26px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2, #e3e0da); border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #45433e); font: inherit;
  font-size: 11.5px; cursor: pointer; white-space: nowrap; text-decoration: none; display: inline-flex; align-items: center; }
.dvs-toolbar-btn:hover { background: var(--dsw-alias-interactive-bg-hover, #f4f3f0); }
.dvs-toolbar-btn.on { border-color: var(--dsw-alias-brand-primary, #4d6bfe); color: var(--dsw-alias-brand-primary, #4d6bfe); }
.dvs-frame-wrap { flex: 1; min-height: 0; overflow: auto; padding: 8px; background: var(--dsw-alias-bg-l2, #f0efec);
  display: flex; justify-content: center; align-items: stretch; }
.dvs-frame { width: 100%; height: 100%; border: 0; background: #fff; border-radius: 8px; }
.dvs-frame-390 { max-width: 390px; }
.dvs-frame-768 { max-width: 768px; }
.dvs-frame-1440 { max-width: 1440px; }
.dvs-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  padding: 24px; text-align: center; }
.dvs-empty-title { font-size: 13px; font-weight: 600; }
.dvs-empty-body { font-size: 12px; color: var(--dsw-alias-label-secondary, #8c887f); max-width: 320px; }
.dvs-status { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #9a968e); padding: 7px 10px; }
`;

    /* ---------------------------------------------------------------- */
    /* Shared helpers                                                   */
    /* ---------------------------------------------------------------- */

    const bridge = {
      lang: 'ru',
      openStudio: () => false,
    };

    function detectLang() {
      try {
        const html = document.documentElement?.lang;
        if (typeof html === 'string' && html.length >= 2) return html.slice(0, 2) === 'ru' ? 'ru' : 'en';
        const nav = navigator.language;
        if (typeof nav === 'string' && nav.length >= 2) return nav.slice(0, 2) === 'ru' ? 'ru' : 'en';
      } catch {
        // Fall through to the default.
      }
      return 'ru';
    }

    function t(key) {
      const dict = DICT[bridge.lang] ?? DICT.ru;
      return dict[key] ?? DICT.ru[key] ?? key;
    }

    async function requestJson(path, { method = 'GET', body, intent = true } = {}) {
      const headers = { accept: 'application/json' };
      if (intent) headers[HEADER] = '1';
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (!response.ok || payload?.ok !== true) {
        const code = payload?.error?.code ?? `HTTP_${response.status}`;
        throw new Error(code);
      }
      return payload.value;
    }

    function printUrl(id, rev, key) {
      return `/plugins/dsh-visual-studio/print?id=${encodeURIComponent(id)}&rev=${encodeURIComponent(rev)}${typeof key === 'string' && key !== '' ? `&k=${encodeURIComponent(key)}` : ''}`;
    }

    function artifactUrl(id, rev, key) {
      const base = `${ROUTE_ARTIFACT}?id=${encodeURIComponent(id)}`;
      const withRev = rev === undefined || rev === null ? base : `${base}&rev=${encodeURIComponent(rev)}`;
      return typeof key === 'string' && key !== '' ? `${withRev}&k=${encodeURIComponent(key)}` : withRev;
    }

    /**
     * Read one Tool call from the slot owner props. The Host passes the stage
     * discriminant plus a stage-specific block: `preparing`/`start` carry
     * `argsRaw` (a JSON string), a settled result carries `call.argsRaw` and
     * the frozen content. `block.args` is a progressive argument view with
     * `text()/complete()` readers, not a plain object, so the raw JSON is the
     * reliable source here.
     */
    function readToolCall(props) {
      const block = props?.block ?? {};
      const phase = typeof props?.phase === 'string' ? props.phase : 'preparing';
      let raw;
      if (typeof block.argsRaw === 'string' && block.argsRaw !== '') raw = block.argsRaw;
      else if (block.call !== null && typeof block.call === 'object' && typeof block.call.argsRaw === 'string') raw = block.call.argsRaw;
      else if (typeof props?.argsRaw === 'string') raw = props.argsRaw;
      let args;
      if (raw !== undefined) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
        } catch {
          args = undefined;
        }
      }
      const callId = typeof props?.callId === 'string' && props.callId !== ''
        ? props.callId
        : (typeof block.callId === 'string' ? block.callId : (typeof block.call?.callId === 'string' ? block.call.callId : ''));
      return { phase, args, callId };
    }

    /**
     * Defensive client-side reader for the widget spec: the Host validates and
     * returns canonical JSON, but during argument streaming the object is
     * partial, so the widget renders only once `rows` is usable.
     */
    function readWidgetSpec(args) {
      if (args === null || typeof args !== 'object') return undefined;
      if (!Array.isArray(args.rows) || args.rows.length === 0) return undefined;
      const rows = [];
      for (const raw of args.rows) {
        if (raw === null || typeof raw !== 'object') return undefined;
        if (typeof raw.title !== 'string' || !Array.isArray(raw.actions) || raw.actions.length < 2) return undefined;
        const actions = raw.actions
          .filter((action) => action !== null && typeof action === 'object' && typeof action.label === 'string')
          .map((action, index) => ({
            id: typeof action.id === 'string' && action.id !== '' ? action.id : `a${index + 1}`,
            label: action.label,
            tone: action.tone === 'primary' || action.tone === 'muted' ? action.tone : 'default',
          }));
        if (actions.length < 2) return undefined;
        rows.push({
          id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : `r${rows.length + 1}`,
          title: raw.title,
          note: typeof raw.note === 'string' ? raw.note : undefined,
          detail: typeof raw.detail === 'string' ? raw.detail : undefined,
          actions,
          defaultAction: actions.some((action) => action.id === raw.defaultAction) ? raw.defaultAction : actions[0].id,
        });
      }
      return {
        title: typeof args.title === 'string' ? args.title : '',
        kicker: typeof args.kicker === 'string' ? args.kicker : undefined,
        subtitle: typeof args.subtitle === 'string' ? args.subtitle : undefined,
        metric: args.metric !== null && typeof args.metric === 'object' && typeof args.metric.value === 'string'
          ? { value: args.metric.value, label: typeof args.metric.label === 'string' ? args.metric.label : undefined }
          : undefined,
        rows,
        submitLabel: typeof args.submitLabel === 'string' && args.submitLabel !== '' ? args.submitLabel : t('widget.submit'),
        resetLabel: typeof args.resetLabel === 'string' && args.resetLabel !== '' ? args.resetLabel : t('widget.reset'),
      };
    }

    /* ---------------------------------------------------------------- */
    /* Inline widget (visual_ask)                                        */
    /* ---------------------------------------------------------------- */

    /**
     * Text blocks of a settled Tool result, flattened for the replay parser.
     */
    function resultText(props) {
      const content = props?.block?.content;
      if (!Array.isArray(content)) return '';
      return content
        .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n');
    }

    /**
     * Read the recorded answer after a reload. The Host attaches it as
     * presentation metadata; older records fall back to the stable bullet lines
     * of the rendered result text.
     */
    function deriveAskAnswer(props, spec, localValues) {
      const meta = props?.block?.meta;
      const metaAnswer = meta !== null && typeof meta === 'object' && (meta.kind === 'dsh-visual-studio/ask' || meta.visualAsk !== undefined)
        ? (meta.kind === 'dsh-visual-studio/ask' ? meta : meta.visualAsk)
        : undefined;
      if (metaAnswer !== undefined && Array.isArray(metaAnswer.selections) && metaAnswer.selections.length > 0) {
        const rows = metaAnswer.selections.map((selection) => ({
          title: String(selection?.title ?? ''),
          label: String(selection?.label ?? ''),
          changed: selection?.changed === true,
        }));
        return { answered: metaAnswer.submitted !== false, changed: rows.filter((row) => row.changed).length, rows };
      }
      const text = resultText(props);
      const rows = [];
      for (const line of text.split('\n')) {
        const match = /^•(\*)?\s+(.+?)\s+→\s+(.+)$/.exec(line.trim());
        if (match !== null) rows.push({ changed: match[1] === '*', title: match[2].trim(), label: match[3].trim() });
      }
      if (rows.length > 0) return { answered: true, changed: rows.filter((row) => row.changed).length, rows };
      if (spec !== undefined && localValues !== null) {
        const local = spec.rows.map((row) => {
          const actionId = localValues[row.id] ?? row.defaultAction;
          const action = row.actions.find((candidate) => candidate.id === actionId);
          return { title: row.title, label: action?.label ?? actionId, changed: actionId !== row.defaultAction };
        });
        return { answered: true, changed: local.filter((row) => row.changed).length, rows: local };
      }
      return { answered: false, changed: 0, rows: [] };
    }

    function VisualAskCard(props) {
      const { phase, args, callId } = readToolCall(props);
      const [values, setValues] = useState(null);
      const [busy, setBusy] = useState(false);
      const [sent, setSent] = useState(false);
      const [error, setError] = useState('');
      const [expanded, setExpanded] = useState(false);
      const spec = readWidgetSpec(args);
      const specKey = spec === undefined ? '' : JSON.stringify(spec);

      useEffect(() => {
        if (spec === undefined) return;
        setValues((current) => {
          if (current !== null) return current;
          const next = {};
          for (const row of spec.rows) next[row.id] = row.defaultAction;
          return next;
        });
      }, [specKey]);

      if (phase === 'result') {
        const answer = deriveAskAnswer(props, spec, values);
        const toggle = () => setExpanded((current) => !current);
        if (!answer.answered) {
          return h('div', { className: 'dvs-card dvs-done' },
            h('div', { className: 'dvs-done-head' },
              h('div', { className: 'dvs-done-icon closed' }, '—'),
              h('div', { className: 'dvs-done-body' },
                h('div', { className: 'dvs-done-title' }, t('widget.closedTitle')),
                h('div', { className: 'dvs-done-sub' }, t('widget.closedBody')),
              ),
            ),
          );
        }
        return h('div', { className: 'dvs-card dvs-done' },
          h('div', {
            className: 'dvs-done-head',
            role: 'button',
            tabIndex: 0,
            'aria-expanded': expanded,
            onClick: toggle,
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggle();
              }
            },
          },
          h('div', { className: 'dvs-done-icon' }, '✓'),
          h('div', { className: 'dvs-done-body' },
            h('div', { className: 'dvs-done-title' }, answer.changed > 0
              ? `${t('widget.done')} · ${t('widget.doneCount').replace('{n}', String(answer.changed))}`
              : t('widget.done')),
            h('div', { className: 'dvs-done-sub' }, expanded ? t('widget.hideAnswers') : t('widget.showAnswers')),
          ),
          h('div', { className: 'dvs-done-chev', 'aria-hidden': 'true' }, expanded ? '▲' : '▼'),
          ),
          expanded
            ? h('div', { className: 'dvs-answers' }, answer.rows.map((row, index) => h('div', {
              key: `${row.title}:${index}`,
              className: `dvs-answer${row.changed ? ' changed' : ''}`,
            },
            h('span', { className: 'dvs-answer-title' }, row.title),
            h('span', { className: 'dvs-answer-label' }, row.label),
            )))
            : null,
        );
      }

      if (spec === undefined) {
        return h('div', { className: 'dvs-card' },
          h('div', { className: 'dvs-head' }, h('div', { className: 'dvs-kicker' }, t('widget.sending'))),
        );
      }

      const changed = values === null ? 0 : spec.rows.filter((row) => values[row.id] !== row.defaultAction).length;

      const submit = async () => {
        if (busy || sent || callId === '' || values === null) return;
        setBusy(true);
        setError('');
        try {
          const selections = spec.rows.map((row) => ({ rowId: row.id, actionId: values[row.id] ?? row.defaultAction }));
          await requestJson(ROUTE_ASK, { method: 'POST', body: { callId, selections } });
          setSent(true);
        } catch (problem) {
          setError(String(problem?.message ?? problem));
        } finally {
          setBusy(false);
        }
      };

      const reset = () => {
        if (spec === undefined) return;
        const next = {};
        for (const row of spec.rows) next[row.id] = row.defaultAction;
        setValues(next);
      };

      return h('div', { className: 'dvs-widget' },
        h('div', { className: 'dvs-head' },
          spec.kicker !== undefined ? h('div', { className: 'dvs-kicker' }, spec.kicker) : null,
          h('div', { className: 'dvs-title' }, spec.title),
          spec.subtitle !== undefined ? h('div', { className: 'dvs-sub' }, spec.subtitle) : null,
          spec.metric !== undefined
            ? h('div', { className: 'dvs-metric' },
              h('b', null, spec.metric.value),
              spec.metric.label !== undefined ? h('span', null, spec.metric.label) : null,
            )
            : null,
        ),
        h('div', { className: 'dvs-rows' }, spec.rows.map((row) => {
          const current = values === null ? row.defaultAction : (values[row.id] ?? row.defaultAction);
          const isChanged = current !== row.defaultAction;
          return h('div', { key: row.id, className: `dvs-row${isChanged ? ' dvs-row-changed' : ''}` },
            h('div', { className: 'dvs-rowtext' },
              h('div', { className: 'dvs-rowname' },
                h('b', null, row.title),
                row.note !== undefined ? h('span', { className: 'dvs-note' }, row.note) : null,
              ),
              row.detail !== undefined ? h('div', { className: 'dvs-rowdetail' }, row.detail) : null,
            ),
            h('div', { className: 'dvs-actions' }, row.actions.map((action) => h('button', {
              key: action.id,
              type: 'button',
              className: `dvs-btn${current === action.id ? ' on' : ''}${action.tone === 'muted' ? ' muted' : ''}`,
              'aria-pressed': current === action.id,
              disabled: busy || sent,
              onClick: () => {
                setValues((previous) => ({ ...(previous ?? {}), [row.id]: action.id }));
              },
            }, action.label))),
          );
        })),
        h('div', { className: 'dvs-foot' },
          h('span', { className: 'dvs-changed-label' }, t('widget.changed').replace('{n}', String(changed))),
          h('div', { className: 'dvs-grow' }),
          error !== '' ? h('span', { className: 'dvs-error' }, `${t('widget.failed')}: ${error}`) : null,
          h('button', { type: 'button', className: 'dvs-btn muted', disabled: busy || sent, onClick: reset }, spec.resetLabel),
          h('button', {
            type: 'button',
            className: 'dvs-btn primary',
            disabled: busy || sent || callId === '',
            onClick: submit,
          }, sent ? t('widget.waiting') : (busy ? t('widget.waiting') : spec.submitLabel)),
        ),
      );
    }

    /* ---------------------------------------------------------------- */
    /* Publication card (visual_publish)                                 */
    /* ---------------------------------------------------------------- */

    function VisualPublishCard(props) {
      const { phase, args } = readToolCall(props);
      const title = typeof args?.title === 'string' ? args.title : '';
      const module = typeof args?.module === 'string' ? args.module : '';
      const summary = typeof args?.summary === 'string' ? args.summary : '';
      const openedRef = useRef(false);

      useEffect(() => {
        if (phase === 'result' && !openedRef.current) {
          openedRef.current = true;
          try {
            bridge.openStudio();
          } catch {
            // Opening the panel is best-effort.
          }
        }
      }, [phase]);

      if (phase !== 'result') {
        return h('div', { className: 'dvs-card' },
          h('div', { className: 'dvs-pub' },
            h('div', { className: 'dvs-badge' }, module || 'visual'),
            h('div', { className: 'dvs-pub-title' }, title === '' ? t('publish.opening') : title),
            h('div', { className: 'dvs-pub-sub' }, t('publish.opening')),
          ),
        );
      }

      return h('div', { className: 'dvs-card' },
        h('div', { className: 'dvs-pub' },
          h('div', { className: 'dvs-badge' }, module || 'visual'),
          h('div', { className: 'dvs-pub-title' }, title),
          summary !== '' ? h('div', { className: 'dvs-pub-sub' }, summary) : null,
        ),
        h('div', { className: 'dvs-foot' },
          h('span', { className: 'dvs-changed-label' }, t('publish.done')),
          h('div', { className: 'dvs-grow' }),
          h('button', { type: 'button', className: 'dvs-btn primary', onClick: () => bridge.openStudio() }, t('publish.open')),
        ),
      );
    }

    /* ---------------------------------------------------------------- */
    /* Right-sidebar panel                                               */
    /* ---------------------------------------------------------------- */

    function StudioPanel(props) {
      const [snapshot, setSnapshot] = useState(undefined);
      const [error, setError] = useState('');
      const [selectedId, setSelectedId] = useState('');
      const [selectedRev, setSelectedRev] = useState(0);
      const [width, setWidth] = useState('fit');
      const [fullscreen, setFullscreen] = useState(false);
      const [nonce, setNonce] = useState(0);
      const [previewKey, setPreviewKey] = useState('');
      const [visible, setVisible] = useState(true);
      const nonceRef = useRef(0);

      let tabInfo;
      try {
        tabInfo = typeof props?.useTabInfo === 'function' ? props.useTabInfo() : undefined;
      } catch {
        tabInfo = undefined;
      }
      useEffect(() => {
        if (typeof props?.useTabInfo === 'function') {
          try {
            setVisible(props.useTabInfo().tab?.visible !== false);
          } catch {
            setVisible(true);
          }
        }
      }, [props?.useTabInfo, tabInfo?.tab?.visible]);
      const params = tabInfo?.tab?.navigation?.params;
      const preferredTitle = typeof params?.title === 'string' ? params.title : '';

      const load = useCallback(async () => {
        try {
          const value = await requestJson(ROUTE_MANIFEST);
          setSnapshot(value);
          setPreviewKey(typeof value?.previewKey === 'string' ? value.previewKey : '');
          setError('');
        } catch (problem) {
          setError(String(problem?.message ?? problem));
        }
      }, []);

      useEffect(() => {
        void load();
        const timer = setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void load();
        }, POLL_MS);
        return () => clearInterval(timer);
      }, [load]);

      const artifacts = snapshot?.artifacts ?? [];
      const selected = useMemo(() => {
        if (artifacts.length === 0) return undefined;
        const byId = artifacts.find((artifact) => artifact.id === selectedId);
        if (byId !== undefined) return byId;
        if (preferredTitle !== '') {
          const byTitle = artifacts.find((artifact) => artifact.title === preferredTitle);
          if (byTitle !== undefined) return byTitle;
        }
        return artifacts[0];
      }, [artifacts, selectedId, preferredTitle]);

      useEffect(() => {
        if (selected !== undefined && selected.id !== selectedId) setSelectedId(selected.id);
      }, [selected?.id]);

      const revision = selected === undefined
        ? 0
        : (selected.versions.some((version) => version.rev === selectedRev) ? selectedRev : selected.rev);

      const panelClass = `dvs-panel${fullscreen ? ' dvs-panel-fs' : ''}`;

      const toolbar = h('div', { className: 'dvs-bar' },
        h('select', {
          className: 'dvs-select',
          value: selected?.id ?? '',
          'aria-label': t('panel.artifact'),
          onChange: (event) => {
            setSelectedId(event.target.value);
            setSelectedRev(0);
            setNonce(nonceRef.current += 1);
          },
        },
        artifacts.length === 0 ? h('option', { value: '' }, t('panel.empty.title')) : null,
        artifacts.map((artifact) => h('option', { key: artifact.id, value: artifact.id }, artifact.title)),
        ),
        selected !== undefined && selected.versions.length > 1
          ? h('select', {
            className: 'dvs-select',
            value: String(revision),
            'aria-label': t('panel.version'),
            onChange: (event) => {
              setSelectedRev(Number.parseInt(event.target.value, 10));
              setNonce(nonceRef.current += 1);
            },
          }, [...selected.versions].reverse().map((version) => h('option', { key: version.rev, value: String(version.rev) }, `v${version.rev}${version.rev === selected.rev ? ` · ${t('panel.latest')}` : ''}`)))
          : null,
        h('select', {
          className: 'dvs-select',
          value: width,
          'aria-label': t('panel.width'),
          onChange: (event) => setWidth(event.target.value),
        },
        h('option', { value: 'fit' }, t('panel.fit')),
        h('option', { value: '390' }, '390'),
        h('option', { value: '768' }, '768'),
        h('option', { value: '1440' }, '1440'),
        ),
        h('div', { className: 'dvs-grow' }),
        h('button', {
          type: 'button',
          className: 'dvs-toolbar-btn',
          onClick: () => {
            setNonce(nonceRef.current += 1);
            void load();
          },
        }, t('panel.refresh')),
        selected !== undefined
          ? h('a', {
            className: 'dvs-toolbar-btn',
            href: `${artifactUrl(selected.id, revision, previewKey)}&download=1`,
            download: '',
          }, t('panel.download'))
          : null,
        selected !== undefined
          ? h('a', {
            className: 'dvs-toolbar-btn',
            href: printUrl(selected.id, revision, previewKey),
            target: '_blank',
            rel: 'noopener noreferrer',
          }, t('panel.print'))
          : null,
        selected !== undefined
          ? h('a', {
            className: 'dvs-toolbar-btn',
            href: artifactUrl(selected.id, revision, previewKey),
            target: '_blank',
            rel: 'noopener noreferrer',
          }, t('panel.open'))
          : null,
        h('button', {
          type: 'button',
          className: `dvs-toolbar-btn${fullscreen ? ' on' : ''}`,
          onClick: () => setFullscreen((value) => !value),
        }, fullscreen ? t('panel.exitFullscreen') : t('panel.fullscreen')),
      );

      if (snapshot === undefined && error === '') {
        return h('div', { className: panelClass },
          toolbar,
          h('div', { className: 'dvs-status' }, t('panel.loading')),
        );
      }

      if (error !== '' && artifacts.length === 0) {
        return h('div', { className: panelClass },
          toolbar,
          h('div', { className: 'dvs-empty' },
            h('div', { className: 'dvs-empty-title' }, t('panel.error')),
            h('div', { className: 'dvs-empty-body' }, error),
            h('button', { type: 'button', className: 'dvs-toolbar-btn', onClick: () => void load() }, t('panel.refresh')),
          ),
        );
      }

      if (selected === undefined) {
        return h('div', { className: panelClass },
          toolbar,
          h('div', { className: 'dvs-empty' },
            h('div', { className: 'dvs-empty-title' }, t('panel.empty.title')),
            h('div', { className: 'dvs-empty-body' }, t('panel.empty.body')),
          ),
        );
      }

      const src = `${artifactUrl(selected.id, revision, previewKey)}${nonce === 0 ? '' : `&n=${nonce}`}`;
      return h('div', { className: panelClass },
        toolbar,
        h('div', { className: 'dvs-frame-wrap' },
          h('iframe', {
            key: `${selected.id}:${revision}:${nonce}`,
            className: `dvs-frame${width === 'fit' ? '' : ` dvs-frame-${width}`}`,
            src,
            sandbox: 'allow-scripts',
            title: t('panel.frameTitle'),
            loading: 'lazy',
          }),
        ),
      );
    }

    /* ---------------------------------------------------------------- */
    /* Plugin definition                                                 */
    /* ---------------------------------------------------------------- */

    const inject = ['slots', 'locale'];

    function installStyles() {
      if (typeof document === 'undefined') return () => {};
      const style = document.createElement('style');
      style.dataset.plugin = PLUGIN_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
      return () => {
        style.remove();
      };
    }

    function apply(ctx) {
      bridge.lang = detectLang();
      try {
        const locale = ctx.locale;
        const active = locale?.getSnapshot?.()?.active;
        if (typeof active === 'string' && active !== '') bridge.lang = active.slice(0, 2) === 'ru' ? 'ru' : 'en';
        if (locale !== undefined && typeof locale.subscribe === 'function') {
          ctx.effect(() => locale.subscribe(() => {
            const next = locale.getSnapshot?.()?.active;
            bridge.lang = typeof next === 'string' && next !== '' ? (next.slice(0, 2) === 'ru' ? 'ru' : 'en') : detectLang();
          }), 'dsh-visual-studio: language');
        }
      } catch {
        // Locale service is optional; the document language remains the source.
      }

      ctx.effect(() => installStyles(), 'dsh-visual-studio: styles');

      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'visual_ask',
      }, VisualAskCard));

      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'visual_publish',
      }, VisualPublishCard));

      ctx.inject(['sidebarRightTabs'], (owner) => {
        const sidebarTabs = owner.get('sidebarRightTabs');
        const sidebarRight = typeof owner.get === 'function' ? owner.get('sidebarRight') : undefined;
        owner.effect(() => sidebarTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          priority: 'extension',
          title: () => t('panel.title'),
          guide: [{
            id: 'dsh-visual-studio',
            order: 120,
            title: () => t('panel.title'),
            description: () => t('panel.description'),
          }],
        }), 'dsh-visual-studio: sidebar tab type');

        const register = owner.slots.register.bind(owner.slots);
        owner.slots.inject('sidebar.right.pane.tab', () => register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
        }, StudioPanel));

        bridge.openStudio = () => {
          try {
            if (sidebarRight !== undefined && typeof sidebarRight.openTab === 'function') {
              sidebarRight.openTab(TAB_KIND);
              return true;
            }
          } catch {
            // Fall through to the layout fallback.
          }
          try {
            const layout = typeof owner.get === 'function' ? owner.get('layout') : undefined;
            if (layout !== undefined && typeof layout.openRightbar === 'function') {
              layout.openRightbar();
              return true;
            }
          } catch {
            // Opening the panel stays best-effort.
          }
          return false;
        };
      });
    }

    return { inject, apply };
  },
});
