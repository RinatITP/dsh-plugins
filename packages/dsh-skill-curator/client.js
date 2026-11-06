/**
 * dsh-skill-curator — Client (browser) half.
 *
 * Registers one `settings.section` page (id `skill-curator`, order 23) into the
 * DeepSeek Harness Web settings UI: a read-only studio over every known skill
 * root. Stage 1 shows the catalog, per-skill diagnostics, the SKILL.md body and
 * the bounded resource tree; editing, import and toggles arrive in later stages
 * behind explicit confirmations.
 *
 * Presentation rules match `dsh-mcp-guard`: plain ESM loaded through
 * `window.__ModuleLoader__`, React from the host, one injected `<style>` with
 * `data-plugin`, theme tokens only, all copy through a local RU/EN dictionary.
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-curator',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useState } = React;

    /* ------------------------------------------------------------------ */
    /* Constants                                                           */
    /* ------------------------------------------------------------------ */

    const PLUGIN_ID = 'dsh-skill-curator';
    const LOCALE_NS = 'settings.skillCurator';
    const API_HEADER = 'x-dsh-skill-curator';
    const API_PATH = '/api/dsh-skill-curator';
    const SECTION_ORDER = 23;

    const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

    const DICT_EN = {
      'nav.label': 'Skills',
      'page.title': 'Skill Curator',
      'page.subtitle': 'Read-only studio over DSH, project and external agent skills.',
      'page.search': 'Search skills…',
      'page.refresh': 'Refresh',
      'page.loading': 'Reading skill roots…',
      'page.empty.title': 'No skills found',
      'page.empty.body': 'No SKILL.md files were found in the known roots on this computer.',
      'page.error.title': 'Could not load skills',
      'page.error.code': 'Error code',
      'page.error.unauthorized': 'Reopen this page from an authenticated DSH window.',
      'page.error.network': 'The DSH host is not reachable.',
      'summary.skills': 'skills',
      'summary.sources': 'sources',
      'summary.errors': 'errors',
      'summary.warnings': 'warnings',
      'summary.incomplete': 'some roots could not be read',
      'group.readOnly': 'read-only',
      'group.system': 'system',
      'group.empty': 'No skills in this root',
      'badge.symlink': 'symlink',
      'badge.duplicate': 'duplicate name',
      'badge.shadowed': 'shadowed',
      'badge.truncated': 'truncated',
      'badge.modelOff': 'hidden from model',
      'badge.userOff': 'hidden from slash menu',
      'badge.errors': 'errors',
      'badge.warnings': 'warnings',
      'detail.content': 'SKILL.md',
      'detail.files': 'Files',
      'detail.diagnostics': 'Diagnostics',
      'detail.close': 'Close',
      'detail.loading': 'Reading…',
      'detail.path': 'Path',
      'detail.source': 'Source',
      'detail.scope': 'Scope',
      'detail.size': 'Size',
      'detail.lines': 'Body lines',
      'detail.status': 'Status',
      'detail.mtime': 'Modified',
      'detail.files.empty': 'No resource files.',
      'detail.files.readonly': 'Read-only preview',
      'detail.files.binary': 'Binary file preview is not available.',
      'detail.files.tooLarge': 'File is too large to preview.',
      'detail.diagnostics.none': 'No diagnostics — the skill looks valid.',
      'detail.diagnostics.severity.error': 'error',
      'detail.diagnostics.severity.warn': 'warning',
      'detail.diagnostics.severity.info': 'info',
      'detail.rawTruncated': 'The file is larger than the preview limit; content is truncated.',
      'source.dshUser': 'My skills (DSH)',
      'source.dshAgents': 'Shared agents',
      'source.project': 'Project',
      'source.bundled': 'Bundled (DSH)',
      'source.claude': 'Claude Code',
      'source.codex': 'Codex',
      'source.hermes': 'Hermes',
      'source.zcode': 'ZCode',
      'source.cursor': 'Cursor',
      'source.gemini': 'Gemini / Antigravity',
      'source.kimi': 'Kimi',
      'source.opencode': 'OpenCode',
      'scope.user': 'user',
      'scope.project': 'project',
      'status.writable': 'writable',
      'status.readOnly': 'read-only',
      'status.external': 'external, read-only',
      'status.bundled': 'bundled, read-only',
      'status.projectLocked': 'project, read-only in this stage',
    };

    const DICT_RU = {
      'nav.label': 'Навыки',
      'page.title': 'Студия навыков',
      'page.subtitle': 'Просмотр навыков DSH, проекта и других агентов без изменения файлов.',
      'page.search': 'Поиск навыков…',
      'page.refresh': 'Обновить',
      'page.loading': 'Читаю каталоги навыков…',
      'page.empty.title': 'Навыки не найдены',
      'page.empty.body': 'В известных корнях на этом компьютере нет файлов SKILL.md.',
      'page.error.title': 'Не удалось загрузить навыки',
      'page.error.code': 'Код ошибки',
      'page.error.unauthorized': 'Откройте страницу заново из авторизованного окна DSH.',
      'page.error.network': 'Хост DSH недоступен.',
      'summary.skills': 'навыков',
      'summary.sources': 'источников',
      'summary.errors': 'ошибок',
      'summary.warnings': 'предупреждений',
      'summary.incomplete': 'часть корней не прочитана',
      'group.readOnly': 'только чтение',
      'group.system': 'системные',
      'group.empty': 'В этом корне навыков нет',
      'badge.symlink': 'ссылка',
      'badge.duplicate': 'дубль имени',
      'badge.shadowed': 'перекрыт',
      'badge.truncated': 'обрезано',
      'badge.modelOff': 'скрыт от модели',
      'badge.userOff': 'скрыт из меню /',
      'badge.errors': 'ошибок',
      'badge.warnings': 'предупреждений',
      'detail.content': 'SKILL.md',
      'detail.files': 'Файлы',
      'detail.diagnostics': 'Диагностика',
      'detail.close': 'Закрыть',
      'detail.loading': 'Читаю…',
      'detail.path': 'Путь',
      'detail.source': 'Источник',
      'detail.scope': 'Область',
      'detail.size': 'Размер',
      'detail.lines': 'Строк в теле',
      'detail.status': 'Статус',
      'detail.mtime': 'Изменён',
      'detail.files.empty': 'Вложенных файлов нет.',
      'detail.files.readonly': 'Просмотр без изменений',
      'detail.files.binary': 'Бинарный файл — предпросмотр недоступен.',
      'detail.files.tooLarge': 'Файл слишком большой для предпросмотра.',
      'detail.diagnostics.none': 'Ошибок нет — навык выглядит корректным.',
      'detail.diagnostics.severity.error': 'ошибка',
      'detail.diagnostics.severity.warn': 'предупреждение',
      'detail.diagnostics.severity.info': 'информация',
      'detail.rawTruncated': 'Файл больше лимита предпросмотра; содержимое обрезано.',
      'source.dshUser': 'Мои навыки (DSH)',
      'source.dshAgents': 'Общие агентские',
      'source.project': 'Проект',
      'source.bundled': 'Встроенные (DSH)',
      'source.claude': 'Claude Code',
      'source.codex': 'Codex',
      'source.hermes': 'Hermes',
      'source.zcode': 'ZCode',
      'source.cursor': 'Cursor',
      'source.gemini': 'Gemini / Antigravity',
      'source.kimi': 'Kimi',
      'source.opencode': 'OpenCode',
      'scope.user': 'пользователь',
      'scope.project': 'проект',
      'status.writable': 'доступен для записи',
      'status.readOnly': 'только чтение',
      'status.external': 'внешний, только чтение',
      'status.bundled': 'встроенный, только чтение',
      'status.projectLocked': 'проектный, на этом этапе только чтение',
    };

    /* ------------------------------------------------------------------ */
    /* Styles                                                              */
    /* ------------------------------------------------------------------ */

    const STYLES = `
      [data-plugin="dsh-skill-curator"] * { box-sizing: border-box; }
      .sc-page {
        display: flex; flex-direction: column; gap: 16px;
        max-width: 960px; margin: 0 auto; padding: 8px 4px 40px;
        color: var(--dsw-alias-label-primary, #1c1c1e);
        font-size: 13px; line-height: 1.45;
      }
      .sc-header { display: flex; flex-direction: column; gap: 12px; }
      .sc-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .sc-title { margin: 0; font-size: 22px; font-weight: 650; letter-spacing: -0.01em; }
      .sc-subtitle { margin: 4px 0 0; color: var(--dsw-alias-label-secondary, #6b7280); }
      .sc-header-actions { display: flex; gap: 8px; flex: none; }
      .sc-button {
        border: 1px solid var(--dsw-alias-border-l3, #d1d5db);
        background: var(--dsw-alias-bg-layer-1, #fff);
        color: var(--dsw-alias-label-primary, #1c1c1e);
        border-radius: 8px; padding: 6px 12px; font: inherit; cursor: pointer;
      }
      .sc-button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04)); }
      .sc-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f46e5); outline-offset: 1px; }
      .sc-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
      .sc-search {
        flex: 1 1 260px; min-width: 220px; padding: 7px 10px; font: inherit;
        border: 1px solid var(--dsw-alias-border-l3, #d1d5db); border-radius: 8px;
        background: var(--dsw-alias-bg-layer-1, #fff); color: inherit;
      }
      .sc-search:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f46e5); outline-offset: 1px; }
      .sc-summary { display: flex; flex-wrap: wrap; gap: 10px; color: var(--dsw-alias-label-secondary, #6b7280); }
      .sc-summary strong { color: var(--dsw-alias-label-primary, #1c1c1e); font-weight: 600; }
      .sc-summary .sc-bad { color: var(--dsw-alias-state-error-primary, #dc2626); }
      .sc-summary .sc-warn { color: var(--dsw-alias-state-warn-primary, #b45309); }
      .sc-banner {
        border: 1px solid var(--dsw-alias-state-error-primary, #dc2626);
        border-radius: 10px; padding: 10px 12px;
        background: var(--dsw-alias-bg-layer-2, #f9fafb);
      }
      .sc-banner-title { font-weight: 600; margin-bottom: 2px; }
      .sc-banner-code { color: var(--dsw-alias-label-tertiary, #9ca3af); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .sc-loading, .sc-empty {
        border: 1px dashed var(--dsw-alias-border-l3, #d1d5db); border-radius: 12px;
        padding: 28px 16px; text-align: center; color: var(--dsw-alias-label-secondary, #6b7280);
      }
      .sc-empty-title { font-weight: 600; color: var(--dsw-alias-label-primary, #1c1c1e); margin-bottom: 4px; }
      .sc-group {
        border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1, #fff); overflow: hidden;
      }
      .sc-group-head {
        display: flex; align-items: center; gap: 10px; width: 100%;
        padding: 10px 14px; background: transparent; border: 0; cursor: pointer;
        font: inherit; color: inherit; text-align: left;
      }
      .sc-group-head:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.03)); }
      .sc-group-chevron { width: 14px; color: var(--dsw-alias-label-tertiary, #9ca3af); flex: none; }
      .sc-group-name { font-weight: 600; }
      .sc-group-path {
        color: var(--dsw-alias-label-tertiary, #9ca3af);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
      }
      .sc-group-spacer { flex: 1 1 auto; }
      .sc-group-count {
        flex: none; color: var(--dsw-alias-label-secondary, #6b7280);
        border: 1px solid var(--dsw-alias-border-l3, #d1d5db); border-radius: 999px;
        padding: 0 8px; font-size: 11px; line-height: 18px;
      }
      .sc-rows { display: flex; flex-direction: column; }
      .sc-row {
        display: flex; flex-direction: column; gap: 3px; width: 100%;
        padding: 10px 14px; border: 0; border-top: 1px solid var(--dsw-alias-border-l2, #f0f0f0);
        background: transparent; font: inherit; color: inherit; text-align: left; cursor: pointer;
      }
      .sc-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.03)); }
      .sc-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f46e5); outline-offset: -2px; }
      .sc-row-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
      .sc-row-name { font-weight: 600; }
      .sc-row-desc { color: var(--dsw-alias-label-secondary, #6b7280); }
      .sc-row-path {
        color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .sc-chip {
        flex: none; display: inline-flex; align-items: center; gap: 4px;
        border: 1px solid var(--dsw-alias-border-l3, #d1d5db); border-radius: 999px;
        padding: 0 7px; font-size: 11px; line-height: 18px;
        color: var(--dsw-alias-label-secondary, #6b7280); background: var(--dsw-alias-bg-layer-2, #f9fafb);
      }
      .sc-chip.is-error { color: var(--dsw-alias-state-error-primary, #dc2626); border-color: var(--dsw-alias-state-error-primary, #dc2626); }
      .sc-chip.is-warn { color: var(--dsw-alias-state-warn-primary, #b45309); border-color: var(--dsw-alias-state-warn-primary, #b45309); }
      .sc-chip.is-info { color: var(--dsw-alias-label-tertiary, #9ca3af); }
      .sc-overlay {
        position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
        background: var(--dsw-alias-bg-mask-1, rgba(15, 23, 42, 0.45)); padding: 24px;
      }
      .sc-modal {
        display: flex; flex-direction: column; width: min(860px, 100%); max-height: min(860px, 92vh);
        background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #1c1c1e);
        border-radius: 14px; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); overflow: hidden;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
      }
      .sc-modal-head { display: flex; flex-direction: column; gap: 8px; padding: 16px 18px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
      .sc-modal-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .sc-modal-title { margin: 0; font-size: 18px; font-weight: 650; word-break: break-word; }
      .sc-modal-desc { margin: 0; color: var(--dsw-alias-label-secondary, #6b7280); }
      .sc-modal-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px 18px; font-size: 12px; }
      .sc-meta { display: flex; flex-direction: column; min-width: 0; }
      .sc-meta-label { color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 11px; }
      .sc-meta-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sc-meta-value.sc-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .sc-tabs { display: flex; gap: 4px; padding: 10px 18px 0; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
      .sc-tab {
        border: 0; background: transparent; font: inherit; color: var(--dsw-alias-label-secondary, #6b7280);
        padding: 7px 10px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
      }
      .sc-tab[aria-selected="true"] { color: var(--dsw-alias-label-primary, #1c1c1e); border-bottom-color: var(--dsw-alias-brand-primary, #4f46e5); }
      .sc-tab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f46e5); outline-offset: -2px; }
      .sc-modal-body { padding: 12px 18px 18px; overflow: auto; }
      .sc-pre {
        margin: 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2, #f9fafb); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; overflow: auto; max-height: 52vh;
      }
      .sc-files { display: flex; flex-direction: column; gap: 2px; }
      .sc-file {
        display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px; border: 0;
        background: transparent; border-radius: 8px; font: inherit; color: inherit; text-align: left; cursor: pointer;
      }
      .sc-file:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04)); }
      .sc-file-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sc-file-size { margin-left: auto; color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 11px; flex: none; }
      .sc-diag { display: flex; flex-direction: column; gap: 8px; }
      .sc-diag-item { border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 10px; padding: 8px 10px; }
      .sc-diag-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
      .sc-diag-params { color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 11px; margin-top: 2px; word-break: break-word; }
      .sc-muted { color: var(--dsw-alias-label-secondary, #6b7280); }
      .sc-note { color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 12px; }
      .sc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    `;

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    function installStyles() {
      if (typeof document === 'undefined' || !document.head) return () => {};
      const selector = 'style[data-plugin="' + PLUGIN_ID + '"]';
      for (const node of Array.from(document.querySelectorAll(selector))) {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
      const tag = document.createElement('style');
      tag.dataset.plugin = PLUGIN_ID;
      tag.textContent = STYLES;
      document.head.appendChild(tag);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        if (tag.parentNode) tag.parentNode.removeChild(tag);
      };
    }

    function resolveApiPath() {
      try {
        if (typeof document !== 'undefined' && typeof document.baseURI === 'string' && document.baseURI !== '') {
          const url = new URL(API_PATH.replace(/^\//, ''), document.baseURI);
          return url.pathname + url.search;
        }
      } catch {
        // Fall through to the root-relative path.
      }
      return API_PATH;
    }

    function clientError(code, status) {
      return { code, status };
    }

    async function requestApi(action, payload) {
      const headers = {};
      headers[API_HEADER] = '1';
      const init = { method: 'GET', credentials: 'same-origin', headers, cache: 'no-store' };
      if (typeof action === 'string' && action !== '') {
        init.method = 'POST';
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify({ action, ...(payload || {}) });
      }
      let response;
      try {
        response = await fetch(resolveApiPath(), init);
      } catch {
        throw clientError('NETWORK', 0);
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw clientError('INVALID_RESPONSE', response.status);
      }
      if (!response.ok || !body || body.ok !== true) {
        const error = body && body.error && typeof body.error === 'object' ? body.error : {};
        const code = typeof error.code === 'string' && error.code !== '' ? error.code : 'INVALID_RESPONSE';
        throw clientError(code, response.status);
      }
      return body.value;
    }

    function formatBytes(value) {
      const bytes = typeof value === 'number' && Number.isFinite(value) ? value : 0;
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function formatDate(value, language) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '';
      try {
        return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ru-RU', {
          year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
        }).format(new Date(value));
      } catch {
        return new Date(value).toISOString();
      }
    }

    function severityRank(diagnostics) {
      let rank = 99;
      for (const item of diagnostics || []) {
        const value = SEVERITY_ORDER[item?.severity];
        if (typeof value === 'number' && value < rank) rank = value;
      }
      return rank;
    }

    function countSeverity(diagnostics, severity) {
      return (diagnostics || []).filter((item) => item?.severity === severity).length;
    }

    function formatParams(params) {
      if (!params || typeof params !== 'object') return '';
      const parts = [];
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
        if (text === '') continue;
        parts.push(key + '=' + text.slice(0, 120));
      }
      return parts.join(' · ');
    }

    /* ------------------------------------------------------------------ */
    /* Runtime                                                             */
    /* ------------------------------------------------------------------ */

    function createRuntime(ctx) {
      const locale = ctx && ctx.locale;
      const readLanguage = () => {
        try {
          if (locale && typeof locale.getLocale === 'function') {
            const snapshot = locale.getLocale();
            const code = snapshot && (snapshot.language || snapshot.locale || snapshot.lang);
            if (typeof code === 'string' && code.toLowerCase().startsWith('en')) return 'en';
            if (typeof code === 'string' && code.toLowerCase().startsWith('ru')) return 'ru';
          }
        } catch {
          // Fall through to the default.
        }
        return 'ru';
      };
      const runtime = {
        language: 'ru',
        t(key) {
          const dictionary = runtime.language === 'en' ? DICT_EN : DICT_RU;
          return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : (DICT_EN[key] ?? key);
        },
        refreshLanguage() {
          runtime.language = readLanguage();
        },
        subscribe(listener) {
          if (locale && typeof locale.subscribe === 'function') {
            try {
              return locale.subscribe(() => {
                runtime.refreshLanguage();
                listener();
              });
            } catch {
              return () => {};
            }
          }
          return () => {};
        },
      };
      runtime.refreshLanguage();
      return runtime;
    }

    function useRuntime(runtime) {
      const [, setRevision] = useState(0);
      useEffect(() => {
        const dispose = runtime.subscribe(() => setRevision((value) => value + 1));
        return typeof dispose === 'function' ? dispose : undefined;
      }, [runtime]);
      return runtime;
    }

    function sourceLabel(runtime, source) {
      if (source && typeof source.label === 'string' && source.label !== '') return source.label;
      const key = source && typeof source.labelKey === 'string' ? source.labelKey : '';
      return key !== '' ? runtime.t(key) : (source?.agent ?? source?.key ?? '');
    }

    function scopeLabel(runtime, scope) {
      return runtime.t('scope.' + (scope === 'project' ? 'project' : 'user'));
    }

    function statusLabel(runtime, skill) {
      if (skill.readOnlyReason === 'BUNDLED') return runtime.t('status.bundled');
      if (skill.readOnlyReason === 'EXTERNAL') return runtime.t('status.external');
      if (skill.readOnlyReason === 'PROJECT') return runtime.t('status.projectLocked');
      return skill.readOnly ? runtime.t('status.readOnly') : runtime.t('status.writable');
    }

    /* ------------------------------------------------------------------ */
    /* Components                                                          */
    /* ------------------------------------------------------------------ */

    function Chip({ text, tone }) {
      const className = 'sc-chip' + (tone ? ' is-' + tone : '');
      return h('span', { className }, text);
    }

    function SkillRow({ runtime, skill, onOpen }) {
      const errors = countSeverity(skill.diagnostics, 'error');
      const warnings = countSeverity(skill.diagnostics, 'warn');
      const chips = [];
      if (skill.isSymlink) chips.push(h(Chip, { key: 'symlink', text: runtime.t('badge.symlink') }));
      if (skill.system) chips.push(h(Chip, { key: 'system', text: runtime.t('group.system') }));
      if (skill.shadowed) chips.push(h(Chip, { key: 'shadowed', text: runtime.t('badge.shadowed'), tone: 'info' }));
      else if (skill.duplicateName) chips.push(h(Chip, { key: 'duplicate', text: runtime.t('badge.duplicate'), tone: 'info' }));
      if (skill.invocation && skill.invocation.modelInvocable === false) {
        chips.push(h(Chip, { key: 'modelOff', text: runtime.t('badge.modelOff'), tone: 'info' }));
      }
      if (skill.invocation && skill.invocation.userInvocable === false) {
        chips.push(h(Chip, { key: 'userOff', text: runtime.t('badge.userOff'), tone: 'info' }));
      }
      if (skill.truncated) chips.push(h(Chip, { key: 'truncated', text: runtime.t('badge.truncated'), tone: 'warn' }));
      if (errors > 0) chips.push(h(Chip, { key: 'errors', text: errors + ' ' + runtime.t('badge.errors'), tone: 'error' }));
      else if (warnings > 0) chips.push(h(Chip, { key: 'warnings', text: warnings + ' ' + runtime.t('badge.warnings'), tone: 'warn' }));

      return h(
        'button',
        {
          type: 'button',
          className: 'sc-row',
          onClick: () => onOpen(skill),
          'aria-label': skill.name,
        },
        h('span', { className: 'sc-row-top' }, h('span', { className: 'sc-row-name' }, skill.name), chips),
        skill.description ? h('span', { className: 'sc-row-desc' }, skill.description) : null,
        h('span', { className: 'sc-row-path' }, skill.relativePath || skill.path),
      );
    }

    function SourceGroup({ runtime, source, skills, collapsed, onToggle, onOpen }) {
      const errors = skills.reduce((total, skill) => total + countSeverity(skill.diagnostics, 'error'), 0);
      const warnings = skills.reduce((total, skill) => total + countSeverity(skill.diagnostics, 'warn'), 0);
      const summary = [];
      summary.push(h(Chip, { key: 'count', text: String(skills.length) }));
      if (source.readOnly) summary.push(h(Chip, { key: 'readonly', text: runtime.t('group.readOnly'), tone: 'info' }));
      if (source.systemCount > 0) summary.push(h(Chip, { key: 'system', text: runtime.t('group.system') }));
      if (errors > 0) summary.push(h(Chip, { key: 'errors', text: errors + ' ' + runtime.t('badge.errors'), tone: 'error' }));
      else if (warnings > 0) summary.push(h(Chip, { key: 'warnings', text: warnings + ' ' + runtime.t('badge.warnings'), tone: 'warn' }));

      return h(
        'section',
        { className: 'sc-group' },
        h(
          'button',
          {
            type: 'button',
            className: 'sc-group-head',
            onClick: onToggle,
            'aria-expanded': collapsed ? 'false' : 'true',
          },
          h('span', { className: 'sc-group-chevron' }, collapsed ? '▸' : '▾'),
          h('span', { className: 'sc-group-name' }, sourceLabel(runtime, source)),
          source.path ? h('span', { className: 'sc-group-path' }, source.path) : null,
          h('span', { className: 'sc-group-spacer' }),
          summary,
        ),
        collapsed ? null : h(
          'div',
          { className: 'sc-rows' },
          skills.length === 0
            ? h('div', { className: 'sc-note', style: { padding: '10px 14px' } }, runtime.t('group.empty'))
            : skills.map((skill) => h(SkillRow, { key: skill.id, runtime, skill, onOpen })),
        ),
      );
    }

    function MetaItem({ label, value, mono }) {
      return h(
        'div',
        { className: 'sc-meta' },
        h('span', { className: 'sc-meta-label' }, label),
        h('span', { className: 'sc-meta-value' + (mono ? ' sc-mono' : ''), title: value }, value),
      );
    }

    function SkillDetail({ runtime, skillId, source, onClose }) {
      const [detail, setDetail] = useState(null);
      const [state, setState] = useState({ loading: true, error: null });
      const [tab, setTab] = useState('content');
      const [file, setFile] = useState(null);
      const [fileState, setFileState] = useState({ loading: false, error: null });

      useEffect(() => {
        let cancelled = false;
        (async () => {
          setState({ loading: true, error: null });
          try {
            const value = await requestApi('detail', { id: skillId });
            if (!cancelled) {
              setDetail(value);
              setState({ loading: false, error: null });
            }
          } catch (error) {
            if (!cancelled) setState({ loading: false, error: error.code || 'OPERATION_FAILED' });
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [skillId]);

      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose();
        };
        if (typeof document !== 'undefined') {
          document.addEventListener('keydown', onKey);
          return () => document.removeEventListener('keydown', onKey);
        }
        return undefined;
      }, [onClose]);

      const skill = detail ? detail.skill : null;
      const diagnostics = skill ? (skill.diagnostics || []) : [];
      const errors = countSeverity(diagnostics, 'error');
      const warnings = countSeverity(diagnostics, 'warn');

      const openFile = useCallback(async (relativePath) => {
        setTab('files');
        setFileState({ loading: true, error: null });
        setFile(null);
        try {
          const value = await requestApi('readFile', { id: skillId, path: relativePath });
          setFile({ relativePath, ...value });
          setFileState({ loading: false, error: null });
        } catch (error) {
          setFileState({ loading: false, error: error.code || 'OPERATION_FAILED' });
        }
      }, [skillId]);

      const tabs = ['content', 'files', 'diagnostics'];

      return h(
        'div',
        {
          className: 'sc-overlay',
          role: 'dialog',
          'aria-modal': 'true',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose();
          },
        },
        h(
          'div',
          { className: 'sc-modal' },
          h(
            'div',
            { className: 'sc-modal-head' },
            h(
              'div',
              { className: 'sc-modal-title-row' },
              h('h2', { className: 'sc-modal-title' }, skill ? skill.name : runtime.t('detail.loading')),
              h('button', { type: 'button', className: 'sc-button', onClick: onClose }, runtime.t('detail.close')),
            ),
            skill && skill.description ? h('p', { className: 'sc-modal-desc' }, skill.description) : null,
            skill
              ? h(
                'div',
                { className: 'sc-modal-meta' },
                h(MetaItem, { label: runtime.t('detail.source'), value: sourceLabel(runtime, source ?? { key: skill.sourceKey, labelKey: 'source.' + (skill.agent || skill.sourceKind) }) }),
                h(MetaItem, { label: runtime.t('detail.scope'), value: scopeLabel(runtime, skill.scope) }),
                h(MetaItem, { label: runtime.t('detail.path'), value: skill.path, mono: true }),
                h(MetaItem, { label: runtime.t('detail.size'), value: formatBytes(skill.sizeBytes) }),
                h(MetaItem, { label: runtime.t('detail.lines'), value: String(skill.bodyLines) }),
                h(MetaItem, { label: runtime.t('detail.status'), value: statusLabel(runtime, skill) }),
                h(MetaItem, { label: runtime.t('detail.mtime'), value: formatDate(skill.mtimeMs, runtime.language) }),
                errors > 0 || warnings > 0
                  ? h(MetaItem, {
                    label: runtime.t('detail.diagnostics'),
                    value: errors + ' / ' + warnings,
                  })
                  : null,
              )
              : null,
            h(
              'div',
              { className: 'sc-tabs', role: 'tablist' },
              tabs.map((item) => h(
                'button',
                {
                  key: item,
                  type: 'button',
                  role: 'tab',
                  className: 'sc-tab',
                  'aria-selected': tab === item ? 'true' : 'false',
                  onClick: () => setTab(item),
                },
                runtime.t('detail.' + item),
              )),
            ),
          ),
          h(
            'div',
            { className: 'sc-modal-body' },
            state.loading ? h('div', { className: 'sc-note' }, runtime.t('detail.loading')) : null,
            state.error
              ? h(
                'div',
                { className: 'sc-banner' },
                h('div', { className: 'sc-banner-title' }, runtime.t('page.error.title')),
                h('div', { className: 'sc-banner-code' }, runtime.t('page.error.code') + ': ' + state.error),
              )
              : null,
            !state.loading && !state.error && detail
              ? [
                tab === 'content'
                  ? h(
                    'div',
                    null,
                    detail.truncated ? h('p', { className: 'sc-note' }, runtime.t('detail.rawTruncated')) : null,
                    h('pre', { className: 'sc-pre' }, detail.content),
                  )
                  : null,
                tab === 'files'
                  ? h(
                    'div',
                    null,
                    fileState.loading ? h('div', { className: 'sc-note' }, runtime.t('detail.loading')) : null,
                    fileState.error
                      ? h('div', { className: 'sc-banner' }, h('div', { className: 'sc-banner-code' }, fileState.error))
                      : null,
                    file && !file.binary
                      ? h(
                        'div',
                        null,
                        h('div', { className: 'sc-note', style: { marginBottom: '8px' } }, file.relativePath + ' · ' + formatBytes(file.size)),
                        file.truncated ? h('p', { className: 'sc-note' }, runtime.t('detail.files.tooLarge')) : null,
                        h('pre', { className: 'sc-pre' }, file.content),
                      )
                      : null,
                    file && file.binary ? h('p', { className: 'sc-note' }, runtime.t('detail.files.binary')) : null,
                    h(
                      'div',
                      { className: 'sc-files' },
                      (detail.files || []).length === 0
                        ? h('p', { className: 'sc-note' }, runtime.t('detail.files.empty'))
                        : detail.files.map((entry) => h(
                          'button',
                          {
                            key: entry.relativePath,
                            type: 'button',
                            className: 'sc-file',
                            onClick: () => openFile(entry.relativePath),
                            disabled: entry.kind === 'directory',
                          },
                          h('span', { className: 'sc-file-name' }, (entry.kind === 'directory' ? '📁 ' : '') + entry.relativePath),
                          h('span', { className: 'sc-file-size' }, entry.kind === 'directory' ? '' : formatBytes(entry.size)),
                        )),
                    ),
                  )
                  : null,
                tab === 'diagnostics'
                  ? (diagnostics.length === 0
                    ? h('p', { className: 'sc-note' }, runtime.t('detail.diagnostics.none'))
                    : h(
                      'div',
                      { className: 'sc-diag' },
                      diagnostics.map((item, index) => h(
                        'div',
                        { key: item.code + ':' + index, className: 'sc-diag-item' },
                        h(
                          'div',
                          { className: 'sc-diag-code' },
                          h(
                            'span',
                            {
                              className: 'sc-chip' + (item.severity === 'error' ? ' is-error' : item.severity === 'warn' ? ' is-warn' : ' is-info'),
                              style: { marginRight: '8px' },
                            },
                            runtime.t('detail.diagnostics.severity.' + (item.severity || 'info')),
                          ),
                          item.code,
                        ),
                        Object.keys(item.params || {}).length > 0
                          ? h('div', { className: 'sc-diag-params' }, formatParams(item.params))
                          : null,
                      )),
                    ))
                  : null,
              ]
              : null,
          ),
        ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Page                                                                */
    /* ------------------------------------------------------------------ */

    function SkillCuratorPage({ runtime }) {
      useRuntime(runtime);
      const [snapshot, setSnapshot] = useState(null);
      const [state, setState] = useState({ loading: true, error: null });
      const [query, setQuery] = useState('');
      const [collapsed, setCollapsed] = useState({});
      const [selectedSkill, setSelectedSkill] = useState(null);

      const load = useCallback(async () => {
        setState({ loading: true, error: null });
        try {
          const value = await requestApi('snapshot');
          setSnapshot(value);
          setState({ loading: false, error: null });
        } catch (error) {
          setState({ loading: false, error: error.code || 'OPERATION_FAILED' });
        }
      }, []);

      useEffect(() => {
        load();
      }, [load]);

      const filtered = useMemo(() => {
        const skills = snapshot && Array.isArray(snapshot.skills) ? snapshot.skills : [];
        const text = query.trim().toLowerCase();
        if (text === '') return skills;
        return skills.filter((skill) => (
          String(skill.name || '').toLowerCase().includes(text)
          || String(skill.description || '').toLowerCase().includes(text)
          || String(skill.path || '').toLowerCase().includes(text)
        ));
      }, [snapshot, query]);

      const groups = useMemo(() => {
        if (!snapshot || !Array.isArray(snapshot.sources)) return [];
        const bySource = new Map();
        for (const source of snapshot.sources) bySource.set(source.key, []);
        for (const skill of filtered) {
          if (!bySource.has(skill.sourceKey)) bySource.set(skill.sourceKey, []);
          bySource.get(skill.sourceKey).push(skill);
        }
        return snapshot.sources
          .filter((source) => (bySource.get(source.key) || []).length > 0)
          .map((source) => ({ source, skills: bySource.get(source.key) || [] }));
      }, [snapshot, filtered]);

      const summary = snapshot && snapshot.summary ? snapshot.summary : null;
      const showEmpty = !state.loading && !state.error && groups.length === 0;

      const errorBanner = state.error
        ? h(
          'div',
          { className: 'sc-banner', role: 'alert' },
          h('div', { className: 'sc-banner-title' }, runtime.t('page.error.title')),
          h(
            'div',
            { className: 'sc-banner-code' },
            runtime.t('page.error.code') + ': ' + state.error,
          ),
          (state.error === 'UNAUTHENTICATED' || state.error === 'FORBIDDEN')
            ? h('div', { className: 'sc-note', style: { marginTop: '4px' } }, runtime.t('page.error.unauthorized'))
            : state.error === 'NETWORK'
              ? h('div', { className: 'sc-note', style: { marginTop: '4px' } }, runtime.t('page.error.network'))
              : null,
          h('div', { style: { marginTop: '10px' } },
            h('button', { type: 'button', className: 'sc-button', onClick: load }, runtime.t('page.refresh'))),
        )
        : null;

      const summaryBar = summary
        ? h(
          'div',
          { className: 'sc-summary' },
          h('span', null, h('strong', null, String(summary.skills)), ' ', runtime.t('summary.skills')),
          h('span', null, h('strong', null, String(summary.sources)), ' ', runtime.t('summary.sources')),
          summary.errors > 0
            ? h('span', { className: 'sc-bad' }, h('strong', { className: 'sc-bad' }, String(summary.errors)), ' ', runtime.t('summary.errors'))
            : null,
          summary.warnings > 0
            ? h('span', { className: 'sc-warn' }, h('strong', { className: 'sc-warn' }, String(summary.warnings)), ' ', runtime.t('summary.warnings'))
            : null,
          snapshot && snapshot.complete === false ? h('span', { className: 'sc-warn' }, runtime.t('summary.incomplete')) : null,
        )
        : null;

      return h(
        'div',
        { className: 'sc-page' },
        h(
          'header',
          { className: 'sc-header' },
          h(
            'div',
            { className: 'sc-title-row' },
            h(
              'div',
              null,
              h('h1', { className: 'sc-title' }, runtime.t('page.title')),
              h('p', { className: 'sc-subtitle' }, runtime.t('page.subtitle')),
            ),
            h(
              'div',
              { className: 'sc-header-actions' },
              h('button', { type: 'button', className: 'sc-button', onClick: load, disabled: state.loading }, runtime.t('page.refresh')),
            ),
          ),
          h(
            'div',
            { className: 'sc-toolbar' },
            h('input', {
              className: 'sc-search',
              type: 'search',
              placeholder: runtime.t('page.search'),
              value: query,
              onChange: (event) => setQuery(event.target.value),
              'aria-label': runtime.t('page.search'),
            }),
            summaryBar,
          ),
        ),
        errorBanner,
        state.loading ? h('div', { className: 'sc-loading' }, runtime.t('page.loading')) : null,
        showEmpty
          ? h(
            'div',
            { className: 'sc-empty' },
            h('div', { className: 'sc-empty-title' }, runtime.t('page.empty.title')),
            h('div', null, runtime.t('page.empty.body')),
          )
          : null,
        groups.map((group) => h(SourceGroup, {
          key: group.source.key,
          runtime,
          source: group.source,
          skills: group.skills,
          collapsed: collapsed[group.source.key] === true,
          onToggle: () => setCollapsed((current) => ({ ...current, [group.source.key]: !current[group.source.key] })),
          onOpen: (skill) => setSelectedSkill(skill),
        })),
        selectedSkill !== null
          ? h(SkillDetail, {
            runtime,
            skillId: selectedSkill.id,
            source: (snapshot?.sources || []).find((item) => item.key === selectedSkill.sourceKey) ?? null,
            onClose: () => setSelectedSkill(null),
          })
          : null,
      );
    }

    function SkillCuratorIcon() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M5 4.5h9.5A2.5 2.5 0 0 1 17 7v12.5H7.5A2.5 2.5 0 0 1 5 17V4.5Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M5 17a2.5 2.5 0 0 1 2.5-2.5H17', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M8.5 8h5M8.5 11h5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Plugin definition                                                   */
    /* ------------------------------------------------------------------ */

    const inject = ['slots', 'locale'];

    function apply(ctx) {
      const runtime = createRuntime(ctx);

      ctx.effect(() => installStyles(), 'dsh-skill-curator: styles');

      if (ctx.locale && typeof ctx.locale.register === 'function') {
        ctx.effect(() => {
          try {
            return ctx.locale.register(LOCALE_NS, { en: DICT_EN, ru: DICT_RU });
          } catch (error) {
            const message = String((error && error.message) || error || '');
            if (/already has locale/.test(message)) return () => {};
            throw error;
          }
        }, 'dsh-skill-curator: dictionaries');
      }

      ctx.effect(
        () => ctx.slots.inject('settings.section', () => ctx.slots.register(
          {
            name: 'settings.section',
            id: 'skill-curator',
            order: SECTION_ORDER,
            label: () => runtime.t('nav.label'),
            locale: LOCALE_NS,
            inject: () => ({ runtime }),
          },
          SkillCuratorPage,
        )),
        'dsh-skill-curator: settings section',
      );

      ctx.effect(
        () => ctx.slots.inject('settings.section.icon', () => ctx.slots.register(
          {
            name: 'settings.section.icon',
            id: 'skill-curator',
            locale: LOCALE_NS,
          },
          SkillCuratorIcon,
        )),
        'dsh-skill-curator: settings icon',
      );
    }

    return { inject, apply };
  },
});
