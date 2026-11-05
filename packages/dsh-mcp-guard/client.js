/**
 * dsh-mcp-guard — Client (browser) half.
 *
 * Registers one `settings.section` page (id `mcp-guard`, order 22) into the DSH
 * Web settings UI. The page is a thin, fail-closed manager over the Host HTTP
 * endpoint `/api/dsh-mcp-guard`:
 *
 *  - managed servers list (cards) + read-only "managed by other plugins" rows;
 *  - Add/Edit form with Form | JSON tabs, debounced `analyze` validation,
 *    risk findings and an argv/endpoint preview;
 *  - enable confirmation with an execution preview and an explicit risk
 *    acknowledgement for high/critical findings;
 *  - delete / disable confirmation, strict JSON import preview, redacted export;
 *  - per-server tool list and an audit log.
 *
 * Secrets are write-only: the API never returns env/header values and this file
 * never mirrors them. All copy goes through a local English/Russian dictionary
 * (also registered with `ctx.locale`). Styles are one injected `<style>` with
 * `data-plugin="dsh-mcp-guard"`; only `--dsw-alias-*` theme tokens are used for
 * color. No DOM is written outside this plugin's own slot sub-tree.
 */
window.__ModuleLoader__.load({
  id: 'dsh-mcp-guard',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useId, useMemo, useRef, useState } = React;

    /* ------------------------------------------------------------------ */
    /* Constants                                                           */
    /* ------------------------------------------------------------------ */

    const PLUGIN_ID = 'dsh-mcp-guard';
    const LOCALE_NS = 'settings.mcpGuard';
    const API_PATH = '/api/dsh-mcp-guard';
    const API_HEADER = 'x-dsh-mcp-guard';
    const MAX_BODY_BYTES = 1048576;
    const REFRESH_INTERVAL_MS = 30000;
    const ANALYZE_DEBOUNCE_MS = 350;

    const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
    const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
    const RISK_ORDER = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

    const TRANSPORT_STDIO = 'stdio';
    const TRANSPORT_HTTP = 'streamable-http';

    /* ------------------------------------------------------------------ */
    /* Small helpers                                                       */
    /* ------------------------------------------------------------------ */

    const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

    function isPlainObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function formatTimestamp(iso) {
      if (typeof iso !== 'string' || iso === '') return '';
      try {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return iso;
        return date.toLocaleString();
      } catch {
        return iso;
      }
    }

    function toNumberOrUndefined(text) {
      const trimmed = String(text ?? '').trim();
      if (trimmed === '') return undefined;
      const value = Number(trimmed);
      return Number.isFinite(value) ? value : trimmed;
    }

    function highestRisk(risks) {
      let best = null;
      for (const risk of Array.isArray(risks) ? risks : []) {
        const level = risk && risk.level;
        if (!hasOwn(RISK_ORDER, level)) continue;
        if (best === null || RISK_ORDER[level] > RISK_ORDER[best]) best = level;
      }
      return best;
    }

    function riskTone(level) {
      if (level === 'critical' || level === 'high') return 'danger';
      if (level === 'medium') return 'warning';
      if (level === 'low') return 'info';
      if (level === 'info') return 'neutral';
      return 'neutral';
    }

    function requiresAcknowledgement(risks) {
      const level = highestRisk(risks);
      return level === 'high' || level === 'critical';
    }

    function formatRiskParams(params) {
      if (!isPlainObject(params)) return '';
      const parts = [];
      for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined) continue;
        const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
        parts.push(key + '=' + text.slice(0, 120));
      }
      return parts.join(' · ').slice(0, 240);
    }

    /** Parse a Host-compatible shell-like args text (quotes group, no evaluation). */
    function parseArgsText(text) {
      const input = typeof text === 'string' ? text : '';
      const args = [];
      let current = '';
      let token = false;
      let quote = null;
      for (let index = 0; index < input.length; index += 1) {
        const ch = input[index];
        if (quote === "'") {
          if (ch === "'") quote = null;
          else current += ch;
          continue;
        }
        if (quote === '"') {
          if (ch === '"') {
            quote = null;
          } else if (ch === '\\') {
            index += 1;
            if (index >= input.length) return { ok: false };
            current += input[index];
          } else {
            current += ch;
          }
          continue;
        }
        if (ch === '"' || ch === "'") {
          quote = ch;
          token = true;
          continue;
        }
        if (ch === '\\') {
          index += 1;
          if (index >= input.length) return { ok: false };
          current += input[index];
          token = true;
          continue;
        }
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
          if (token || current !== '') {
            args.push(current);
            current = '';
            token = false;
          }
          continue;
        }
        current += ch;
        token = true;
      }
      if (quote !== null) return { ok: false };
      if (token || current !== '') args.push(current);
      return { ok: true, args };
    }

    /** Render one argv item as shell-like text (display only; never executed). */
    function quoteArg(arg) {
      const value = String(arg);
      if (value === '') return '""';
      if (!/[\s"'\\]/.test(value)) return value;
      if (!/["\\]/.test(value)) return "'" + value + "'";
      return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }

    /* ------------------------------------------------------------------ */
    /* Dictionaries (English + Russian)                                    */
    /* ------------------------------------------------------------------ */

    const DICT_EN = {
      'nav.label': 'MCP servers',
      'page.intro': 'Review, enable and audit MCP servers managed by this plugin.',
      'page.profile': 'Profile: {name}',
      'page.refresh': 'Refresh',
      'page.add': 'Add server',
      'page.import': 'Import JSON',
      'page.export': 'Export',
      'page.loading': 'Loading…',
      'page.officialUnavailable':
        'The official MCP client package cannot be loaded, so servers cannot be enabled from this page.',
      'page.officialAvailable': 'Official MCP client: available',
      'page.managed': 'Managed servers',
      'page.external': 'Managed by other plugins',
      'page.externalHint':
        'These MCP servers are defined by other plugins or the profile patch. They are read-only here.',
      'page.externalLocked': 'Read-only',
      'page.audit': 'Audit log',
      'page.auditEmpty': 'No audit entries yet.',
      'page.empty': 'No MCP servers are managed yet. Add one to start.',
      'action.copy': 'Copy',
      'action.close': 'Close',
      'action.edit': 'Edit',
      'action.delete': 'Delete',
      'page.neverChecked': 'Never checked',
      'page.checkOk': 'Last check OK',
      'page.checkFailed': 'Last check failed',
      'page.checking': 'Checking…',
      'page.check': 'Check',
      'page.secrets': 'Has secrets',
      'page.invalid': 'Invalid configuration',
      'page.transport': 'Transport',
      'page.endpoint': 'Endpoint',
      'page.timeout': 'Timeout',
      'page.tools': 'Tools',
      'page.args': 'Arguments',
      'status.enabled': 'Enabled',
      'status.disabled': 'Disabled',
      'transport.stdio': 'stdio',
      'transport.http': 'streamable-http',
      'transport.stdioLong': 'stdio (local process)',
      'transport.httpLong': 'streamable-http (remote URL)',
      'notice.savedCreate': 'Server saved disabled. Review it and enable when ready.',
      'notice.savedUpdate': 'Changes saved. The server stays disabled until you enable it again.',
      'notice.imported': '{count} server(s) imported disabled.',
      'notice.enabled': '{name} enabled.',
      'notice.disabled': '{name} disabled.',
      'notice.removed': '{name} deleted.',
      'notice.checkOk': '{name}: connection check passed.',
      'notice.checkFailed': '{name}: connection check failed.',
      'notice.copied': 'Copied to clipboard.',
      'notice.copyFailed': 'Could not access the clipboard.',
      'auth.notice':
        'This page is no longer authorized. Reopen the authenticated Harness window and reload the page.',
      'auth.reload': 'Reload page',
      'stale.notice':
        'The configuration changed elsewhere. The latest state was reloaded — review it and retry.',
      'stale.reload': 'Reload',
      'error.unknown': 'Something went wrong.',
      'error.network': 'The plugin endpoint is unreachable. Reload the page and try again.',
      'error.invalidResponse': 'Unexpected response from the plugin endpoint.',
      'error.detail': 'Field: {path}',
      'form.titleCreate': 'Add MCP server',
      'form.titleEdit': 'Edit {name}',
      'form.back': 'Back to list',
      'form.name': 'Name',
      'form.nameHint': 'Letters, digits, _ and - only; 1–32 characters.',
      'form.editNotice':
        'For security, the stored command, arguments, URL and secret values are not returned. Re-enter the command and arguments (or the URL) completely; secret values are kept by key when their value field is left blank.',
      'form.scope': 'Scope: this plugin manages MCP servers in profile {profile}. Every save is disabled until you enable it after review.',
      'form.type': 'Type',
      'form.timeout': 'Timeout, ms',
      'form.timeoutHint': 'Per-call timeout, 1000–600000 ms.',
      'form.protocol': 'Protocol version',
      'form.protocolAuto': 'Auto (official client)',
      'form.command': 'Command',
      'form.commandHint': 'Executable or path; it is spawned directly, without a shell.',
      'form.commandEditHint':
        'The stored command is not returned (displayed endpoint: {endpoint}). Re-enter it.',
      'form.args': 'Arguments',
      'form.argsHint':
        'Space- or newline-separated. Single and double quotes group one argument; nothing is evaluated.',
      'form.argsEditHint':
        'For security, stored arguments are not returned ({count}). Re-enter the full argument list.',
      'form.cwd': 'Working directory',
      'form.cwdHint': 'Optional absolute path.',
      'form.url': 'URL',
      'form.urlHint': 'Full URL including path, for example https://host.example/mcp.',
      'form.env': 'Environment variables',
      'form.envHint': 'Values are write-only: stored values are never shown again.',
      'form.headers': 'Headers',
      'form.headersHint': 'Values are write-only: stored values are never shown again.',
      'form.kvKey': 'Key',
      'form.kvValue': 'Value (write-only)',
      'form.kvStored': 'stored — leave blank to keep',
      'form.kvKeepHint': 'Leave a stored value blank to keep it.',
      'form.kvNone': 'No entries yet.',
      'form.kvAddEnv': 'Add variable',
      'form.kvAddHeader': 'Add header',
      'form.kvRemove': 'Remove',
      'form.advanced': 'Advanced',
      'form.reconnectEnabled': 'Reconnect automatically',
      'form.reconnectAttempts': 'Max reconnect attempts',
      'form.failOnStartupError': 'Fail on startup error',
      'form.maxInstructionBytes': 'Max instruction bytes',
      'form.allowPlainHttp': 'Allow plaintext HTTP to a non-loopback host',
      'form.allowPlainHttpWarning':
        'Only enable this for a trusted host you control: the connection will be unencrypted.',
      'form.tabForm': 'Form',
      'form.tabJson': 'JSON',
      'form.tabsLabel': 'Server editor',
      'form.jsonHint':
        'Editable mcpServers entry for this draft. Stored secrets appear as placeholders; advanced options stay on the Form tab.',
      'form.jsonInvalid': 'Invalid JSON.',
      'form.jsonShape': 'Expected a single mcpServers entry object.',
      'form.jsonUnknownField': 'Unsupported field in the JSON entry.',
      'form.clearSecrets': 'Stored secret values will be deleted for: {keys}',
      'form.clearAck': 'I understand these stored values will be deleted.',
      'form.saveDisabled': 'Save becomes available when the draft passes validation.',
      'form.save': 'Save',
      'form.cancel': 'Cancel',
      'form.nameLocked': 'The server name cannot be changed after creation.',
      'form.required': 'Required',
      'analyze.pending': 'Validating…',
      'analyze.valid': 'Configuration is valid.',
      'analyze.problems': 'Validation problems',
      'analyze.noFindings': 'No risk findings.',
      'analyze.blocked': 'This configuration is blocked and cannot be saved or enabled.',
      'analyze.argv': 'Command that will run (no shell):',
      'analyze.endpoint': 'Endpoint:',
      'analyze.risks': 'Risk findings',
      'analyze.secretsNote': 'Secret values are never displayed; blank stored values are kept.',
      'preview.cwd': 'Working directory: {cwd}',
      'preview.hostDefault': 'host default',
      'preview.envKeys': 'Environment keys',
      'preview.headerKeys': 'Header keys',
      'risk.none': 'No risk findings.',
      'risk.level': 'Risk level',
      'risk.level.critical': 'Critical',
      'risk.level.high': 'High',
      'risk.level.medium': 'Medium',
      'risk.level.low': 'Low',
      'risk.level.info': 'Info',
      'risk.localExecution': 'A local program will be started for this server.',
      'risk.remoteEndpoint': 'The server connects to a remote HTTP endpoint.',
      'risk.packageRunnerAutoInstall':
        'The package runner may auto-install and run a package from the network.',
      'risk.packageRunnerUnpinned': 'The package specification is not pinned to an exact version.',
      'risk.shellInterpreter': 'The command is a shell or an interpreter.',
      'risk.codeEvalFlag': 'The command line evaluates code directly.',
      'risk.elevatedCommand': 'The command requests elevated privileges.',
      'risk.plainHttpLoopback': 'Plaintext HTTP is used to a loopback address.',
      'risk.plainHttpAllowlisted': 'Plaintext HTTP to a non-loopback host is explicitly allowed.',
      'risk.secretInArgs': 'A command argument looks like a credential.',
      'risk.envSecretLiteral':
        'A secret-looking literal is stored in env/headers instead of a variable reference.',
      'risk.namespaceAmbiguous':
        'The server name contains a double underscore, which can confuse tool namespaces.',
      'risk.cwdSystemRoot': 'The working directory is a system root.',
      'risk.timeoutLong': 'The per-call timeout is above 10 minutes.',
      'risk.reconnectDisabled': 'Automatic reconnect is disabled.',
      'modal.close': 'Close dialog',
      'modal.enableTitle': 'Enable {name}?',
      'modal.enableReview': 'Review exactly what will run before enabling this server.',
      'modal.enableAck': 'I understand the risk and want to enable this server.',
      'modal.enableConfirm': 'Enable',
      'modal.disableTitle': 'Disable {name}?',
      'modal.disableBody':
        'The server will be unloaded and its tools disappear until it is enabled again.',
      'modal.disableConfirm': 'Disable',
      'modal.deleteTitle': 'Delete {name}?',
      'modal.deleteBody':
        'The stored configuration and its secret values are removed. This cannot be undone.',
      'modal.deleteConfirm': 'Delete',
      'modal.importTitle': 'Import MCP servers',
      'modal.importHint':
        'Paste an mcpServers JSON document. Import is strict and limited to 1 MiB; imported servers are saved disabled and no command runs during preview.',
      'modal.importInput': 'mcpServers JSON',
      'modal.importPreview': 'Preview import',
      'modal.importConfirm': 'Import',
      'modal.importSummary': '{count} server(s) recognised',
      'modal.importDisabledNote': 'Imported servers are saved disabled and must be enabled separately.',
      'modal.importTooLarge': 'The input is larger than 1 MiB.',
      'modal.importEmpty': 'Paste a JSON document to preview it.',
      'modal.exportTitle': 'Export MCP servers',
      'modal.exportNote':
        'Env and header values are replaced with placeholders. This is a backup and migration aid, not a secret backup.',
      'modal.exportLoading': 'Preparing export…',
      'audit.action.create': 'Created',
      'audit.action.update': 'Updated',
      'audit.action.remove': 'Deleted',
      'audit.action.enable': 'Enabled',
      'audit.action.disable': 'Disabled',
      'audit.action.import': 'Imported',
      'audit.action.check': 'Checked',
      'audit.result.ok': 'ok',
      'audit.result.error': 'error',
      'a11y.enable': 'Enable server {name}',
      'a11y.disable': 'Disable server {name}',
      'a11y.edit': 'Edit server {name}',
      'a11y.delete': 'Delete server {name}',
      'a11y.check': 'Check server {name}',
      'a11y.refresh': 'Refresh server list',
      'a11y.removeEntry': 'Remove entry {key}',
      'a11y.toolsOf': 'Registered tools for {name}',
      'a11y.riskOf': 'Risk findings for {name}',
      'a11y.riskLevel': 'Risk level',
      'a11y.managedSection': 'Managed servers',
      'a11y.externalSection': 'Servers managed by other plugins',
      'a11y.audit': 'Audit log',
      'a11y.dismiss': 'Dismiss',
      'a11y.formTab': 'Form editor',
      'a11y.jsonTab': 'JSON editor',
      'a11y.transportGroup': 'Transport type',
      'error.NAME_INVALID': 'Server name may contain only letters, digits, _ and - (1–32 characters).',
      'error.NAME_CONFLICT': 'This name is already used by another MCP server.',
      'error.TRANSPORT_INVALID': 'Unsupported transport. Choose stdio or streamable-http.',
      'error.STDIO_COMMAND_REQUIRED': 'A command is required for a stdio server.',
      'error.STDIO_COMMAND_INVALID': 'The command is invalid (max 4096 characters, no NUL, CR or LF).',
      'error.STDIO_ARGS_INVALID': 'Arguments are invalid. Check quotes and length limits.',
      'error.STDIO_CWD_INVALID': 'The working directory must be an absolute path without NUL, CR or LF.',
      'error.STDIO_ENV_INVALID': 'Environment variables are invalid: check keys and values.',
      'error.HTTP_URL_REQUIRED': 'A URL is required for a streamable-http server.',
      'error.HTTP_URL_INVALID': 'The URL is invalid.',
      'error.HTTP_PLAINTEXT_BLOCKED':
        'Plaintext HTTP is allowed only for loopback hosts unless explicitly enabled on this server.',
      'error.HTTP_HEADERS_INVALID': 'Headers are invalid: check names, values and duplicates.',
      'error.ENV_EXECUTION_OVERRIDE': 'This environment variable can change how code runs and is blocked.',
      'error.FIELD_UNKNOWN': 'Unsupported field in the configuration.',
      'error.EXPRESSION_UNSUPPORTED': 'Loader expressions are not supported in MCP server configuration.',
      'error.SECRET_KEEP_UNAVAILABLE': 'There is no stored value to keep for this key; enter a value.',
      'error.TIMEOUT_INVALID': 'Timeout must be an integer between 1000 and 600000 ms.',
      'error.RECONNECT_INVALID': 'Reconnect settings are invalid (attempts 1–100).',
      'error.MAX_INSTRUCTION_INVALID': 'Max instruction bytes must be between 1 and 1048576.',
      'error.TOO_MANY_SERVERS': 'The maximum number of MCP servers is reached.',
      'error.TOO_MANY_ENV': 'Too many environment variables (max 64).',
      'error.TOO_MANY_HEADERS': 'Too many headers (max 64).',
      'error.VALUE_TOO_LONG': 'A value is too long.',
      'error.IMPORT_INPUT_INVALID': 'Import input must be a JSON object.',
      'error.IMPORT_TOO_LARGE': 'Import input is larger than 1 MiB.',
      'error.IMPORT_JSON_INVALID': 'Import JSON cannot be parsed.',
      'error.IMPORT_UNSAFE_KEY': 'Import contains an unsafe object key.',
      'error.IMPORT_DUPLICATE_KEY': 'Import contains duplicate JSON keys.',
      'error.IMPORT_SHAPE': 'Import must have a single mcpServers object with server entries.',
      'error.IMPORT_TOO_MANY_SERVERS': 'Import contains too many servers (max 100).',
      'error.IMPORT_NAME_INVALID': 'An imported server name is invalid.',
      'error.IMPORT_NAME_CONFLICT': 'An imported server name is already in use.',
      'error.IMPORT_SERVER_INVALID': 'An imported server entry is invalid.',
      'error.IMPORT_UNKNOWN_FIELD': 'An imported server has an unsupported field.',
      'error.IMPORT_TYPE_INVALID': 'An imported server type is invalid.',
      'error.IMPORT_TRANSPORT_CONFLICT': 'An imported server mixes stdio and HTTP fields.',
      'error.IMPORT_URL_INVALID': 'An imported URL is invalid.',
      'error.IMPORT_COMMAND_INVALID': 'An imported command is invalid.',
      'error.IMPORT_ARGS_INVALID': 'Imported arguments are invalid.',
      'error.IMPORT_ENV_INVALID': 'Imported environment variables are invalid.',
      'error.IMPORT_HEADERS_INVALID': 'Imported headers are invalid.',
      'error.IMPORT_CWD_INVALID': 'An imported working directory is invalid.',
      'error.NOT_FOUND': 'This server no longer exists. Refresh the list.',
      'error.CONFIRM_REQUIRED': 'This change needs explicit confirmation.',
      'error.STALE_CONFIGURATION': 'The configuration changed. The latest state was reloaded — review it and retry.',
      'error.CONFIGURATION_UNAVAILABLE': 'The plugin configuration is unavailable.',
      'error.INVALID_REQUEST': 'The request is invalid.',
      'error.METHOD_NOT_ALLOWED': 'The endpoint rejected the request method.',
      'error.CONTENT_TYPE': 'The endpoint rejected the request content type.',
      'error.BODY_TOO_LARGE': 'The request body is too large.',
      'error.UNAUTHENTICATED': 'This page is not authorized. Reopen the Harness window and reload.',
      'error.FORBIDDEN': 'This page is not authorized. Reopen the Harness window and reload.',
      'error.OPERATION_FAILED': 'The operation failed.',
      'error.OFFICIAL_CLIENT_UNAVAILABLE': 'The official MCP client package is unavailable.',
      'error.CHECK_UNAVAILABLE': 'Connection checks are unavailable in this deployment.',
      'error.RISK_BLOCKED': 'The configuration is blocked by risk findings and cannot be saved or enabled.',
      'error.RISK_ACK_REQUIRED': 'This server requires an explicit risk acknowledgement to be enabled.',
      'error.CONFIGURATION_INVALID': 'The stored configuration is invalid. Re-enter it before changing this server.',
      'error.NETWORK': 'The plugin endpoint is unreachable. Reload the page and try again.',
      'error.INVALID_RESPONSE': 'Unexpected response from the plugin endpoint.',
    };

    const DICT_RU = {
      'nav.label': 'MCP-серверы',
      'page.intro': 'Проверяйте, включайте и отслеживайте MCP-серверы, которыми управляет этот плагин.',
      'page.profile': 'Профиль: {name}',
      'page.refresh': 'Обновить',
      'page.add': 'Добавить сервер',
      'page.import': 'Импорт JSON',
      'page.export': 'Экспорт',
      'page.loading': 'Загрузка…',
      'page.officialUnavailable':
        'Официальный клиент MCP недоступен, поэтому включать серверы с этой страницы нельзя.',
      'page.officialAvailable': 'Официальный клиент MCP: доступен',
      'page.managed': 'Управляемые серверы',
      'page.external': 'Управляется другими плагинами',
      'page.externalHint':
        'Эти MCP-серверы заданы другими плагинами или патчем профиля. Здесь они доступны только для чтения.',
      'page.externalLocked': 'Только чтение',
      'page.audit': 'Журнал аудита',
      'page.auditEmpty': 'Записей пока нет.',
      'page.empty': 'Управляемых MCP-серверов пока нет. Добавьте первый.',
      'action.copy': 'Копировать',
      'action.close': 'Закрыть',
      'action.edit': 'Изменить',
      'action.delete': 'Удалить',
      'page.neverChecked': 'Не проверялся',
      'page.checkOk': 'Последняя проверка успешна',
      'page.checkFailed': 'Последняя проверка не удалась',
      'page.checking': 'Проверка…',
      'page.check': 'Проверить',
      'page.secrets': 'Есть секреты',
      'page.invalid': 'Некорректная конфигурация',
      'page.transport': 'Транспорт',
      'page.endpoint': 'Эндпоинт',
      'page.timeout': 'Таймаут',
      'page.tools': 'Инструменты',
      'page.args': 'Аргументы',
      'status.enabled': 'Включён',
      'status.disabled': 'Отключён',
      'transport.stdio': 'stdio',
      'transport.http': 'streamable-http',
      'transport.stdioLong': 'stdio (локальный процесс)',
      'transport.httpLong': 'streamable-http (удалённый URL)',
      'notice.savedCreate': 'Сервер сохранён отключённым. Проверьте его и включите, когда будете готовы.',
      'notice.savedUpdate': 'Изменения сохранены. Сервер останется отключённым, пока вы его не включите.',
      'notice.imported': 'Импортировано серверов (отключены): {count}.',
      'notice.enabled': 'Сервер {name} включён.',
      'notice.disabled': 'Сервер {name} отключён.',
      'notice.removed': 'Сервер {name} удалён.',
      'notice.checkOk': 'Сервер {name}: проверка соединения пройдена.',
      'notice.checkFailed': 'Сервер {name}: проверка соединения не пройдена.',
      'notice.copied': 'Скопировано в буфер обмена.',
      'notice.copyFailed': 'Не удалось получить доступ к буферу обмена.',
      'auth.notice':
        'Страница больше не авторизована. Откройте окно Harness с действующей авторизацией и перезагрузите страницу.',
      'auth.reload': 'Перезагрузить страницу',
      'stale.notice':
        'Конфигурация изменилась в другом месте. Загружено актуальное состояние — проверьте его и повторите действие.',
      'stale.reload': 'Обновить',
      'error.unknown': 'Что-то пошло не так.',
      'error.network': 'Эндпоинт плагина недоступен. Перезагрузите страницу и попробуйте снова.',
      'error.invalidResponse': 'Неожиданный ответ эндпоинта плагина.',
      'error.detail': 'Поле: {path}',
      'form.titleCreate': 'Добавление MCP-сервера',
      'form.titleEdit': 'Изменение сервера {name}',
      'form.back': 'Назад к списку',
      'form.name': 'Имя',
      'form.nameHint': 'Только латинские буквы, цифры, _ и -; 1–32 символа.',
      'form.editNotice':
        'В целях безопасности сохранённые команда, аргументы, URL и значения секретов не возвращаются. Введите команду и аргументы (или URL) полностью заново; значения секретов сохраняются по ключам, если поле значения оставить пустым.',
      'form.scope': 'Область: плагин управляет MCP-серверами в профиле {profile}. Любое сохранение выполняется отключённым — включайте после проверки.',
      'form.type': 'Тип',
      'form.timeout': 'Таймаут, мс',
      'form.timeoutHint': 'Таймаут вызова, 1000–600000 мс.',
      'form.protocol': 'Версия протокола',
      'form.protocolAuto': 'Авто (официальный клиент)',
      'form.command': 'Команда',
      'form.commandHint': 'Исполняемый файл или путь; запускается напрямую, без shell.',
      'form.commandEditHint':
        'Сохранённая команда не возвращается (показан эндпоинт: {endpoint}). Введите её заново.',
      'form.args': 'Аргументы',
      'form.argsHint':
        'Разделяются пробелом или переводом строки. Одинарные и двойные кавычки группируют один аргумент; ничего не вычисляется.',
      'form.argsEditHint':
        'В целях безопасности сохранённые аргументы не возвращаются ({count}). Введите полный список аргументов заново.',
      'form.cwd': 'Рабочий каталог',
      'form.cwdHint': 'Необязательный абсолютный путь.',
      'form.url': 'URL',
      'form.urlHint': 'Полный URL, включая путь, например https://host.example/mcp.',
      'form.env': 'Переменные окружения',
      'form.envHint': 'Значения только для записи: сохранённые значения больше не показываются.',
      'form.headers': 'Заголовки',
      'form.headersHint': 'Значения только для записи: сохранённые значения больше не показываются.',
      'form.kvKey': 'Ключ',
      'form.kvValue': 'Значение (только запись)',
      'form.kvStored': 'сохранено — оставьте пустым, чтобы сохранить',
      'form.kvKeepHint': 'Пустое значение сохранённого ключа означает «оставить как есть».',
      'form.kvNone': 'Записей пока нет.',
      'form.kvAddEnv': 'Добавить переменную',
      'form.kvAddHeader': 'Добавить заголовок',
      'form.kvRemove': 'Удалить',
      'form.advanced': 'Дополнительно',
      'form.reconnectEnabled': 'Переподключаться автоматически',
      'form.reconnectAttempts': 'Максимум попыток переподключения',
      'form.failOnStartupError': 'Прерывать при ошибке запуска',
      'form.maxInstructionBytes': 'Максимум байт инструкций',
      'form.allowPlainHttp': 'Разрешить plaintext HTTP не на loopback',
      'form.allowPlainHttpWarning':
        'Включайте только для доверенного хоста под вашим контролем: соединение будет незашифрованным.',
      'form.tabForm': 'Форма',
      'form.tabJson': 'JSON',
      'form.tabsLabel': 'Редактор сервера',
      'form.jsonHint':
        'Редактируемая запись mcpServers для этого черновика. Сохранённые секреты показаны заглушками; дополнительные параметры остаются на вкладке «Форма».',
      'form.jsonInvalid': 'Некорректный JSON.',
      'form.jsonShape': 'Ожидается объект mcpServers с одной записью.',
      'form.jsonUnknownField': 'Неподдерживаемое поле в JSON-записи.',
      'form.clearSecrets': 'Сохранённые значения секретов будут удалены для ключей: {keys}',
      'form.clearAck': 'Я понимаю, что эти сохранённые значения будут удалены.',
      'form.saveDisabled': 'Сохранение станет доступно, когда черновик пройдёт проверку.',
      'form.save': 'Сохранить',
      'form.cancel': 'Отмена',
      'form.nameLocked': 'Имя сервера нельзя изменить после создания.',
      'form.required': 'Обязательно',
      'analyze.pending': 'Проверка…',
      'analyze.valid': 'Конфигурация корректна.',
      'analyze.problems': 'Проблемы проверки',
      'analyze.noFindings': 'Рисков не обнаружено.',
      'analyze.blocked': 'Конфигурация заблокирована: сохранить или включить её нельзя.',
      'analyze.argv': 'Команда, которая будет выполнена (без shell):',
      'analyze.endpoint': 'Эндпоинт:',
      'analyze.risks': 'Найденные риски',
      'analyze.secretsNote': 'Значения секретов не показываются; пустые сохранённые значения сохраняются.',
      'preview.cwd': 'Рабочий каталог: {cwd}',
      'preview.hostDefault': 'по умолчанию (хост)',
      'preview.envKeys': 'Ключи окружения',
      'preview.headerKeys': 'Ключи заголовков',
      'risk.none': 'Рисков не обнаружено.',
      'risk.level': 'Уровень риска',
      'risk.level.critical': 'Критический',
      'risk.level.high': 'Высокий',
      'risk.level.medium': 'Средний',
      'risk.level.low': 'Низкий',
      'risk.level.info': 'Информация',
      'risk.localExecution': 'Для этого сервера будет запущена локальная программа.',
      'risk.remoteEndpoint': 'Сервер подключается к удалённому HTTP-эндпоинту.',
      'risk.packageRunnerAutoInstall':
        'Пакетный раннер может автоматически скачать и запустить пакет из сети.',
      'risk.packageRunnerUnpinned': 'Спецификация пакета не закреплена на точной версии.',
      'risk.shellInterpreter': 'Команда является shell или интерпретатором.',
      'risk.codeEvalFlag': 'Командная строка вычисляет код напрямую.',
      'risk.elevatedCommand': 'Команда запрашивает повышенные привилегии.',
      'risk.plainHttpLoopback': 'Используется plaintext HTTP к loopback-адресу.',
      'risk.plainHttpAllowlisted':
        'Plaintext HTTP к хосту вне loopback разрешён явно для этого сервера.',
      'risk.secretInArgs': 'Аргумент команды похож на учётные данные.',
      'risk.envSecretLiteral':
        'Похожее на секрет значение хранится в env или заголовках вместо ссылки на переменную.',
      'risk.namespaceAmbiguous':
        'Имя сервера содержит двойное подчёркивание — это может запутать пространства имён инструментов.',
      'risk.cwdSystemRoot': 'Рабочий каталог — системный корень.',
      'risk.timeoutLong': 'Таймаут вызова превышает 10 минут.',
      'risk.reconnectDisabled': 'Автоматическое переподключение отключено.',
      'modal.close': 'Закрыть диалог',
      'modal.enableTitle': 'Включить {name}?',
      'modal.enableReview': 'Проверьте, что именно будет запущено, прежде чем включать сервер.',
      'modal.enableAck': 'Я понимаю риск и хочу включить этот сервер.',
      'modal.enableConfirm': 'Включить',
      'modal.disableTitle': 'Отключить {name}?',
      'modal.disableBody':
        'Сервер будет выгружен, и его инструменты исчезнут, пока он снова не будет включён.',
      'modal.disableConfirm': 'Отключить',
      'modal.deleteTitle': 'Удалить {name}?',
      'modal.deleteBody':
        'Сохранённая конфигурация и её значения секретов будут удалены. Отменить это нельзя.',
      'modal.deleteConfirm': 'Удалить',
      'modal.importTitle': 'Импорт MCP-серверов',
      'modal.importHint':
        'Вставьте JSON-документ mcpServers. Импорт строгий и ограничен 1 МиБ; импортированные серверы сохраняются отключёнными, при предпросмотре ничего не запускается.',
      'modal.importInput': 'JSON mcpServers',
      'modal.importPreview': 'Предпросмотр импорта',
      'modal.importConfirm': 'Импортировать',
      'modal.importSummary': 'Распознано серверов: {count}',
      'modal.importDisabledNote': 'Импортированные серверы сохраняются отключёнными и включаются отдельно.',
      'modal.importTooLarge': 'Ввод больше 1 МиБ.',
      'modal.importEmpty': 'Вставьте JSON-документ, чтобы увидеть предпросмотр.',
      'modal.exportTitle': 'Экспорт MCP-серверов',
      'modal.exportNote':
        'Значения env и заголовков заменены заглушками. Это резервная копия для переноса, а не хранилище секретов.',
      'modal.exportLoading': 'Подготовка экспорта…',
      'audit.action.create': 'Создан',
      'audit.action.update': 'Изменён',
      'audit.action.remove': 'Удалён',
      'audit.action.enable': 'Включён',
      'audit.action.disable': 'Отключён',
      'audit.action.import': 'Импорт',
      'audit.action.check': 'Проверка',
      'audit.result.ok': 'успешно',
      'audit.result.error': 'ошибка',
      'a11y.enable': 'Включить сервер {name}',
      'a11y.disable': 'Отключить сервер {name}',
      'a11y.edit': 'Изменить сервер {name}',
      'a11y.delete': 'Удалить сервер {name}',
      'a11y.check': 'Проверить сервер {name}',
      'a11y.refresh': 'Обновить список серверов',
      'a11y.removeEntry': 'Удалить запись {key}',
      'a11y.toolsOf': 'Зарегистрированные инструменты для {name}',
      'a11y.riskOf': 'Найденные риски для {name}',
      'a11y.riskLevel': 'Уровень риска',
      'a11y.managedSection': 'Управляемые серверы',
      'a11y.externalSection': 'Серверы, управляемые другими плагинами',
      'a11y.audit': 'Журнал аудита',
      'a11y.dismiss': 'Скрыть',
      'a11y.formTab': 'Редактор формы',
      'a11y.jsonTab': 'Редактор JSON',
      'a11y.transportGroup': 'Тип транспорта',
      'error.NAME_INVALID': 'Имя сервера может содержать только латинские буквы, цифры, _ и - (1–32 символа).',
      'error.NAME_CONFLICT': 'Это имя уже используется другим MCP-сервером.',
      'error.TRANSPORT_INVALID': 'Неподдерживаемый транспорт. Выберите stdio или streamable-http.',
      'error.STDIO_COMMAND_REQUIRED': 'Для stdio-сервера требуется команда.',
      'error.STDIO_COMMAND_INVALID': 'Команда некорректна (до 4096 символов, без NUL, CR и LF).',
      'error.STDIO_ARGS_INVALID': 'Аргументы некорректны. Проверьте кавычки и ограничения длины.',
      'error.STDIO_CWD_INVALID': 'Рабочий каталог должен быть абсолютным путём без NUL, CR и LF.',
      'error.STDIO_ENV_INVALID': 'Переменные окружения некорректны: проверьте ключи и значения.',
      'error.HTTP_URL_REQUIRED': 'Для streamable-http сервера требуется URL.',
      'error.HTTP_URL_INVALID': 'URL некорректен.',
      'error.HTTP_PLAINTEXT_BLOCKED':
        'Plaintext HTTP разрешён только для loopback, если только он не разрешён явно для этого сервера.',
      'error.HTTP_HEADERS_INVALID': 'Заголовки некорректны: проверьте имена, значения и дубликаты.',
      'error.ENV_EXECUTION_OVERRIDE':
        'Эта переменная окружения может менять способ выполнения кода и заблокирована.',
      'error.FIELD_UNKNOWN': 'В конфигурации есть неподдерживаемое поле.',
      'error.EXPRESSION_UNSUPPORTED': 'Выражения Loader не поддерживаются в конфигурации MCP-сервера.',
      'error.SECRET_KEEP_UNAVAILABLE': 'Для этого ключа нет сохранённого значения; введите значение.',
      'error.TIMEOUT_INVALID': 'Таймаут должен быть целым числом от 1000 до 600000 мс.',
      'error.RECONNECT_INVALID': 'Настройки переподключения некорректны (попытки 1–100).',
      'error.MAX_INSTRUCTION_INVALID': 'Максимум байт инструкций должен быть от 1 до 1048576.',
      'error.TOO_MANY_SERVERS': 'Достигнут максимум числа MCP-серверов.',
      'error.TOO_MANY_ENV': 'Слишком много переменных окружения (максимум 64).',
      'error.TOO_MANY_HEADERS': 'Слишком много заголовков (максимум 64).',
      'error.VALUE_TOO_LONG': 'Значение слишком длинное.',
      'error.IMPORT_INPUT_INVALID': 'Ввод импорта должен быть JSON-объектом.',
      'error.IMPORT_TOO_LARGE': 'Ввод импорта больше 1 МиБ.',
      'error.IMPORT_JSON_INVALID': 'JSON импорта не удаётся разобрать.',
      'error.IMPORT_UNSAFE_KEY': 'Импорт содержит небезопасный ключ объекта.',
      'error.IMPORT_DUPLICATE_KEY': 'Импорт содержит дублирующиеся ключи JSON.',
      'error.IMPORT_SHAPE': 'Импорт должен содержать один объект mcpServers с записями серверов.',
      'error.IMPORT_TOO_MANY_SERVERS': 'Импорт содержит слишком много серверов (максимум 100).',
      'error.IMPORT_NAME_INVALID': 'Имя импортируемого сервера некорректно.',
      'error.IMPORT_NAME_CONFLICT': 'Имя импортируемого сервера уже используется.',
      'error.IMPORT_SERVER_INVALID': 'Запись импортируемого сервера некорректна.',
      'error.IMPORT_UNKNOWN_FIELD': 'У импортируемого сервера есть неподдерживаемое поле.',
      'error.IMPORT_TYPE_INVALID': 'Тип импортируемого сервера некорректен.',
      'error.IMPORT_TRANSPORT_CONFLICT': 'Импортируемый сервер смешивает поля stdio и HTTP.',
      'error.IMPORT_URL_INVALID': 'URL импортируемого сервера некорректен.',
      'error.IMPORT_COMMAND_INVALID': 'Команда импортируемого сервера некорректна.',
      'error.IMPORT_ARGS_INVALID': 'Аргументы импортируемого сервера некорректны.',
      'error.IMPORT_ENV_INVALID': 'Переменные окружения импортируемого сервера некорректны.',
      'error.IMPORT_HEADERS_INVALID': 'Заголовки импортируемого сервера некорректны.',
      'error.IMPORT_CWD_INVALID': 'Рабочий каталог импортируемого сервера некорректен.',
      'error.NOT_FOUND': 'Этого сервера больше нет. Обновите список.',
      'error.CONFIRM_REQUIRED': 'Для этого изменения требуется явное подтверждение.',
      'error.STALE_CONFIGURATION':
        'Конфигурация изменилась. Загружено актуальное состояние — проверьте его и повторите действие.',
      'error.CONFIGURATION_UNAVAILABLE': 'Конфигурация плагина недоступна.',
      'error.INVALID_REQUEST': 'Запрос некорректен.',
      'error.METHOD_NOT_ALLOWED': 'Эндпоинт отклонил метод запроса.',
      'error.CONTENT_TYPE': 'Эндпоинт отклонил тип содержимого запроса.',
      'error.BODY_TOO_LARGE': 'Тело запроса слишком большое.',
      'error.UNAUTHENTICATED': 'Страница не авторизована. Откройте окно Harness заново и перезагрузите страницу.',
      'error.FORBIDDEN': 'Страница не авторизована. Откройте окно Harness заново и перезагрузите страницу.',
      'error.OPERATION_FAILED': 'Операция не удалась.',
      'error.OFFICIAL_CLIENT_UNAVAILABLE': 'Официальный пакет клиента MCP недоступен.',
      'error.CHECK_UNAVAILABLE': 'Проверка соединений недоступна в этом развёртывании.',
      'error.RISK_BLOCKED': 'Конфигурация заблокирована найденными рисками: сохранить или включить её нельзя.',
      'error.RISK_ACK_REQUIRED': 'Для включения этого сервера требуется явное подтверждение риска.',
      'error.CONFIGURATION_INVALID':
        'Сохранённая конфигурация некорректна. Введите её заново, прежде чем менять этот сервер.',
      'error.NETWORK': 'Эндпоинт плагина недоступен. Перезагрузите страницу и попробуйте снова.',
      'error.INVALID_RESPONSE': 'Неожиданный ответ эндпоинта плагина.',
    };

    const DICTS = { en: DICT_EN, ru: DICT_RU };

    /* ------------------------------------------------------------------ */
    /* Styles (single <style data-plugin="dsh-mcp-guard">)                 */
    /* ------------------------------------------------------------------ */

    const STYLES = `
.mcpg-section{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;width:100%;max-width:760px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.mcpg-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.mcpg-h2{margin:0;font-size:18px;font-weight:600;line-height:26px}
.mcpg-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.mcpg-head{display:flex;flex-direction:column;gap:4px;min-width:0}
.mcpg-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.mcpg-grow{flex:1 1 auto}
.mcpg-sectionline{display:flex;align-items:baseline;gap:8px;margin-top:8px}
.mcpg-h3{margin:0;font-size:14px;font-weight:600;line-height:20px}
.mcpg-count{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.mcpg-empty{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.mcpg-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 14px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;white-space:nowrap;text-decoration:none}
.mcpg-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.mcpg-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.mcpg-btn:disabled{opacity:.4;cursor:not-allowed}
.mcpg-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.mcpg-btn-outline{box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l3)}
.mcpg-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.mcpg-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.mcpg-btn-danger{color:var(--dsw-alias-state-error-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l3)}
.mcpg-btn-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.mcpg-btn-sm{height:28px;padding:0 10px;font-size:12px;line-height:18px;border-radius:6px}
.mcpg-btn-icon{width:30px;height:30px;padding:0;border-radius:8px}
.mcpg-tag{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;border:.5px solid transparent;box-sizing:border-box}
.mcpg-tag-neutral{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.mcpg-tag-quiet{color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l3)}
.mcpg-tag-success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}
.mcpg-tag-warning{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-primary)}
.mcpg-tag-danger{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.mcpg-tag-info{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary)}
.mcpg-cards{display:flex;flex-direction:column;gap:10px}
.mcpg-card{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:12px;background:var(--dsw-alias-settings-card-fill);padding:12px 14px}
.mcpg-rowline{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.mcpg-main{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 auto}
.mcpg-nameline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.mcpg-name{font-size:14px;font-weight:600;line-height:20px;overflow-wrap:anywhere}
.mcpg-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.mcpg-meta-strong{color:var(--dsw-alias-label-secondary)}
.mcpg-actions{display:flex;align-items:center;gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end}
.mcpg-actions-end{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.mcpg-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}
.mcpg-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.mcpg-switch:disabled{cursor:default;opacity:.5}
.mcpg-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.mcpg-switch-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-switch-thumb);transition:transform .12s ease}
.mcpg-switch[aria-checked="true"] .mcpg-switch-thumb{background:var(--dsw-alias-label-primary-foreground);transform:translate(16px)}
.mcpg-panel{box-sizing:border-box;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:12px;background:var(--dsw-alias-settings-card-fill);padding:10px 14px}
.mcpg-panel>summary{display:flex;align-items:center;gap:8px;min-height:28px;cursor:pointer;font-size:13px;font-weight:500;line-height:20px;list-style:none}
.mcpg-panel>summary::-webkit-details-marker{display:none}
.mcpg-panel>summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:6px}
.mcpg-banner{box-sizing:border-box;display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;font-size:13px;line-height:20px}
.mcpg-banner-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.mcpg-banner-detail{color:var(--dsw-alias-label-tertiary);font-size:12px}
.mcpg-banner-actions{display:flex;align-items:center;gap:6px;flex:none}
.mcpg-banner-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.mcpg-banner-warning{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary)}
.mcpg-banner-info{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.mcpg-banner-success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}
.mcpg-form{display:flex;flex-direction:column;gap:12px}
.mcpg-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.mcpg-label{font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}
.mcpg-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.mcpg-invalid{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.mcpg-input,.mcpg-textarea,.mcpg-select{box-sizing:border-box;width:100%;min-height:34px;padding:6px 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.mcpg-input:focus-visible,.mcpg-textarea:focus-visible,.mcpg-select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.mcpg-input[aria-invalid="true"],.mcpg-textarea[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.mcpg-input:disabled,.mcpg-textarea:disabled,.mcpg-select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.mcpg-textarea{resize:vertical;min-height:76px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px}
.mcpg-textarea-plain{font-family:inherit;font-size:13px;line-height:20px}
.mcpg-grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.mcpg-entryrow{display:flex;align-items:flex-start;gap:8px}
.mcpg-entryrow .mcpg-input{flex:1 1 auto}
.mcpg-entryrow-key{flex:0 1 42%}
.mcpg-code{margin:0;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;max-height:240px}
.mcpg-inline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mcpg-tabs{display:inline-flex;gap:4px;padding:3px;border-radius:10px;background:var(--dsw-alias-bg-module-platform);align-self:flex-start}
.mcpg-tab{height:28px;padding:0 14px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.mcpg-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:500;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l3)}
.mcpg-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.mcpg-segmented{display:inline-flex;gap:4px;padding:3px;border-radius:10px;background:var(--dsw-alias-bg-module-platform);align-self:flex-start}
.mcpg-segment{height:28px;padding:0 14px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.mcpg-segment[aria-checked="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:500;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l3)}
.mcpg-segment:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.mcpg-check{display:inline-flex;align-items:flex-start;gap:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer}
.mcpg-check input{flex:0 0 auto;width:16px;height:16px;margin:2px 0 0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.mcpg-check input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.mcpg-advanced{display:flex;flex-direction:column;gap:12px}
.mcpg-advanced>summary{margin-bottom:0}
.mcpg-advanced-body{display:flex;flex-direction:column;gap:12px;padding-top:10px}
.mcpg-risks{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.mcpg-risk{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.mcpg-risk-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.mcpg-risk-params{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.mcpg-preview{display:flex;flex-direction:column;gap:6px}
.mcpg-preview-label{margin:0;font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary)}
.mcpg-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.mcpg-chip{padding:1px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;overflow-wrap:anywhere}
.mcpg-auditlist{display:flex;flex-direction:column;margin:8px 0 0;padding:0;list-style:none}
.mcpg-auditrow{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px}
.mcpg-audittime{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.mcpg-auditserver{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.mcpg-modal-root{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:24px}
.mcpg-modal-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:blur(2px)}
.mcpg-modal{position:relative;z-index:1;box-sizing:border-box;display:flex;flex-direction:column;width:min(600px,100%);max-height:min(760px,calc(100vh - 48px));overflow:hidden;border:.5px solid var(--dsw-alias-border-l3);border-radius:16px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 12px 40px color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent)}
.mcpg-modal:focus{outline:none}
.mcpg-modal-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:20px 14px 10px 22px}
.mcpg-modal-title{margin:0;font-size:16px;font-weight:500;line-height:24px;color:var(--dsw-alias-label-primary)}
.mcpg-modal-body{display:flex;flex-direction:column;gap:12px;min-height:0;padding:0 22px;overflow-y:auto;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.mcpg-modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:16px 22px 20px}
.mcpg-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:560px){.mcpg-grid2{grid-template-columns:minmax(0,1fr)}.mcpg-rowline{flex-direction:column}.mcpg-actions{align-self:flex-start}}
`;

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

    /* ------------------------------------------------------------------ */
    /* HTTP transport                                                      */
    /* ------------------------------------------------------------------ */

    function clientError(code, status, path) {
      return { code, status, path };
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
        response = await fetch(API_PATH, init);
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
        throw clientError(code, response.status, typeof error.path === 'string' ? error.path : '');
      }
      return body.value;
    }

    /* ------------------------------------------------------------------ */
    /* Runtime: locale-aware translation + transport                       */
    /* ------------------------------------------------------------------ */

    function createRuntime(ctx) {
      const locale = ctx && ctx.locale;
      const hasLocale = Boolean(locale && typeof locale.getLocale === 'function');

      function activeLocale() {
        if (!hasLocale) return 'en';
        try {
          const snapshot = locale.getLocale();
          return snapshot && typeof snapshot.active === 'string' ? snapshot.active : 'en';
        } catch {
          return 'en';
        }
      }

      function lookup(key) {
        const active = activeLocale();
        const dict = DICTS[active] || DICT_EN;
        if (hasOwn(dict, key)) return dict[key];
        if (hasOwn(DICT_EN, key)) return DICT_EN[key];
        return null;
      }

      const runtime = {
        translate(key, params) {
          const template = lookup(key);
          const text = template === null ? String(key) : String(template);
          if (!params || typeof params !== 'object') return text;
          return text.replace(/\{(\w+)\}/g, (match, name) => (hasOwn(params, name) ? String(params[name]) : match));
        },
        optionalText(key) {
          return lookup(key);
        },
        errorText(code) {
          if (typeof code !== 'string' || code === '') return runtime.translate('error.unknown');
          const known = lookup('error.' + code);
          return known === null ? code : known;
        },
        riskText(code) {
          if (typeof code !== 'string' || code === '') return runtime.translate('error.unknown');
          const known = lookup('risk.' + code);
          return known === null ? code : known;
        },
        levelText(level) {
          if (typeof level !== 'string' || level === '') return '';
          const known = lookup('risk.level.' + level);
          return known === null ? level : known;
        },
        localeRevision() {
          if (!hasLocale) return 0;
          try {
            const snapshot = typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : locale.getLocale();
            return snapshot && Number.isFinite(snapshot.revision) ? snapshot.revision : 0;
          } catch {
            return 0;
          }
        },
        subscribeLocale(listener) {
          if (hasLocale && typeof locale.subscribe === 'function') {
            try {
              return locale.subscribe(listener);
            } catch {
              return () => {};
            }
          }
          return () => {};
        },
        request: requestApi,
      };
      return runtime;
    }

    function useLocaleRevision(runtime) {
      const [revision, setRevision] = useState(() => runtime.localeRevision());
      useEffect(() => {
        setRevision(runtime.localeRevision());
        return runtime.subscribeLocale(() => setRevision(runtime.localeRevision()));
      }, [runtime]);
      return revision;
    }

    /* ------------------------------------------------------------------ */
    /* Primitive components                                                */
    /* ------------------------------------------------------------------ */

    function Button(props) {
      const { variant, size, className, children, ...rest } = props;
      const classes = ['mcpg-btn'];
      if (variant === 'primary') classes.push('mcpg-btn-primary');
      else if (variant === 'outline') classes.push('mcpg-btn-outline');
      else if (variant === 'danger') classes.push('mcpg-btn-danger');
      if (size === 'sm') classes.push('mcpg-btn-sm');
      if (className) classes.push(className);
      const elementProps = { ...rest };
      elementProps.className = classes.join(' ');
      if (!elementProps.type) elementProps.type = 'button';
      return h('button', elementProps, children);
    }

    function Tag({ tone, children, title }) {
      return h('span', { className: 'mcpg-tag mcpg-tag-' + (tone || 'neutral'), title }, children);
    }

    function Switch({ checked, disabled, label, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          className: 'mcpg-switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          disabled: disabled === true,
          onClick: () => {
            if (!disabled) onChange(!checked);
          },
        },
        h('span', { className: 'mcpg-switch-thumb', 'aria-hidden': 'true' }),
      );
    }

    function Banner({ tone, text, detail, actions, live }) {
      const role = live ? (tone === 'error' ? 'alert' : 'status') : undefined;
      return h(
        'div',
        { className: 'mcpg-banner mcpg-banner-' + (tone || 'info'), role, 'aria-live': live ? 'polite' : undefined },
        h(
          'div',
          { className: 'mcpg-banner-text' },
          text,
          detail ? h('span', { className: 'mcpg-banner-detail' }, ' · ', detail) : null,
        ),
        actions ? h('div', { className: 'mcpg-banner-actions' }, actions) : null,
      );
    }

    function TextField(props) {
      const { id, label, value, onChange, hint, errors, placeholder, disabled, type, readOnly, inputMode, min, max, autoComplete } = props;
      const hasError = Boolean(errors && errors.length);
      return h(
        'div',
        { className: 'mcpg-field' },
        label ? h('label', { className: 'mcpg-label', htmlFor: id }, label) : null,
        h('input', {
          id,
          className: 'mcpg-input',
          type: type || 'text',
          value: value === undefined || value === null ? '' : String(value),
          placeholder: placeholder || undefined,
          disabled: disabled === true,
          readOnly: readOnly === true,
          inputMode: inputMode || undefined,
          min: min === undefined ? undefined : min,
          max: max === undefined ? undefined : max,
          autoComplete: autoComplete || 'off',
          spellCheck: 'false',
          'aria-invalid': hasError ? 'true' : undefined,
          'aria-describedby': hasError || hint ? id + '-meta' : undefined,
          onChange: (event) => onChange(event.target.value),
        }),
        hint || hasError
          ? h(
              'div',
              { id: id + '-meta' },
              hint ? h('p', { className: 'mcpg-hint' }, hint) : null,
              hasError ? errors.map((text, index) => h('p', { key: index, className: 'mcpg-invalid' }, text)) : null,
            )
          : null,
      );
    }

    function TextAreaField(props) {
      const { id, label, value, onChange, hint, errors, rows, monospace, placeholder, ariaLabel } = props;
      const hasError = Boolean(errors && errors.length);
      return h(
        'div',
        { className: 'mcpg-field' },
        label ? h('label', { className: 'mcpg-label', htmlFor: id }, label) : null,
        h('textarea', {
          id,
          className: 'mcpg-textarea' + (monospace === false ? ' mcpg-textarea-plain' : ''),
          value: value === undefined || value === null ? '' : String(value),
          rows: rows || 5,
          placeholder: placeholder || undefined,
          spellCheck: 'false',
          autoComplete: 'off',
          'aria-label': ariaLabel || undefined,
          'aria-invalid': hasError ? 'true' : undefined,
          'aria-describedby': hasError || hint ? id + '-meta' : undefined,
          onChange: (event) => onChange(event.target.value),
        }),
        hint || hasError
          ? h(
              'div',
              { id: id + '-meta' },
              hint ? h('p', { className: 'mcpg-hint' }, hint) : null,
              hasError ? errors.map((text, index) => h('p', { key: index, className: 'mcpg-invalid' }, text)) : null,
            )
          : null,
      );
    }

    function CheckboxField({ id, label, checked, onChange, disabled, hint, errors }) {
      const hasError = Boolean(errors && errors.length);
      return h(
        'div',
        { className: 'mcpg-field' },
        h(
          'label',
          { className: 'mcpg-check', htmlFor: id },
          h('input', {
            id,
            type: 'checkbox',
            checked: checked === true,
            disabled: disabled === true,
            'aria-invalid': hasError ? 'true' : undefined,
            onChange: (event) => onChange(event.target.checked),
          }),
          h('span', null, label),
        ),
        hint ? h('p', { className: 'mcpg-hint' }, hint) : null,
        hasError ? errors.map((text, index) => h('p', { key: index, className: 'mcpg-invalid' }, text)) : null,
      );
    }

    function Tabs({ value, onChange, formLabel, jsonLabel, labels }) {
      const tabId = useId ? useId() : 'mcpg-tabs';
      const options = [
        { id: 'form', label: formLabel, aria: labels.formAria },
        { id: 'json', label: jsonLabel, aria: labels.jsonAria },
      ];
      return h(
        'div',
        { className: 'mcpg-tabs', role: 'tablist', 'aria-label': labels.group },
        options.map((option) =>
          h(
            'button',
            {
              key: option.id,
              type: 'button',
              role: 'tab',
              id: tabId + '-' + option.id,
              className: 'mcpg-tab',
              'aria-selected': value === option.id ? 'true' : 'false',
              'aria-label': option.aria,
              tabIndex: value === option.id ? 0 : -1,
              onClick: () => onChange(option.id),
              onKeyDown: (event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                onChange(value === 'form' ? 'json' : 'form');
              },
            },
            option.label,
          ),
        ),
      );
    }

    function Segmented({ value, onChange, options, label }) {
      return h(
        'div',
        { className: 'mcpg-segmented', role: 'radiogroup', 'aria-label': label },
        options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              role: 'radio',
              className: 'mcpg-segment',
              'aria-checked': value === option.value ? 'true' : 'false',
              onClick: () => onChange(option.value),
            },
            option.label,
          ),
        ),
      );
    }

    function Modal({ title, closeLabel, onClose, children, footer }) {
      const titleId = useId ? useId() : 'mcpg-modal-title';
      const dialogRef = useRef(null);
      const onCloseRef = useRef(onClose);
      // Keep the latest close handler without re-running the focus/Escape effect.
      useEffect(() => {
        onCloseRef.current = onClose;
      }, [onClose]);
      useEffect(() => {
        const node = dialogRef.current;
        if (node && typeof node.focus === 'function') node.focus();
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCloseRef.current();
          }
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, []);
      return h(
        'div',
        { className: 'mcpg-modal-root', role: 'presentation' },
        h('div', { className: 'mcpg-modal-mask', 'aria-hidden': 'true', onClick: () => onCloseRef.current() }),
        h(
          'div',
          {
            ref: dialogRef,
            className: 'mcpg-modal',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': titleId,
            tabIndex: -1,
          },
          h(
            'div',
            { className: 'mcpg-modal-head' },
            h('h2', { className: 'mcpg-modal-title', id: titleId }, title),
            h(
              Button,
              {
                size: 'sm',
                variant: 'outline',
                className: 'mcpg-btn-icon',
                onClick: onClose,
                'aria-label': closeLabel,
                title: closeLabel,
              },
              '✕',
            ),
          ),
          h('div', { className: 'mcpg-modal-body' }, children),
          footer ? h('div', { className: 'mcpg-modal-foot' }, footer) : null,
        ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Risk / preview presentation                                         */
    /* ------------------------------------------------------------------ */

    function RiskList({ runtime, risks, emptyText }) {
      if (!Array.isArray(risks) || risks.length === 0) {
        return h('p', { className: 'mcpg-hint' }, emptyText || runtime.translate('analyze.noFindings'));
      }
      return h(
        'ul',
        { className: 'mcpg-risks' },
        risks.map((risk, index) => {
          const level = risk && typeof risk.level === 'string' ? risk.level : 'info';
          const code = risk && typeof risk.code === 'string' ? risk.code : '';
          const params = formatRiskParams(risk && risk.params);
          return h(
            'li',
            { key: index, className: 'mcpg-risk' },
            h(Tag, { tone: riskTone(level), title: runtime.translate('a11y.riskLevel') }, runtime.levelText(level)),
            h(
              'span',
              { className: 'mcpg-risk-text' },
              h('span', null, runtime.riskText(code)),
              params ? h('code', { className: 'mcpg-risk-params' }, params) : null,
            ),
          );
        }),
      );
    }

    function ArgvPreview({ runtime, argv, endpoint, cwd, transport }) {
      return h(
        'div',
        { className: 'mcpg-preview' },
        transport === TRANSPORT_STDIO
          ? [
              h('p', { key: 'label', className: 'mcpg-preview-label' }, runtime.translate('analyze.argv')),
              h('pre', { key: 'code', className: 'mcpg-code' }, argv.map((arg) => quoteArg(arg)).join('\n')),
              h(
                'p',
                { key: 'cwd', className: 'mcpg-hint' },
                runtime.translate('preview.cwd', {
                  cwd: cwd ? cwd : runtime.translate('preview.hostDefault'),
                }),
              ),
            ]
          : [
              h('p', { key: 'label', className: 'mcpg-preview-label' }, runtime.translate('analyze.endpoint')),
              h('pre', { key: 'code', className: 'mcpg-code' }, endpoint || '—'),
            ],
      );
    }

    function KeyChips({ label, keys }) {
      if (!Array.isArray(keys) || keys.length === 0) return null;
      return h(
        'div',
        { className: 'mcpg-preview' },
        h('p', { className: 'mcpg-preview-label' }, label),
        h(
          'ul',
          { className: 'mcpg-chips' },
          keys.map((key) => h('li', { key, className: 'mcpg-chip' }, key)),
        ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Key/value editor (write-only values)                                */
    /* ------------------------------------------------------------------ */

    function KeyValueEditor(props) {
      const { runtime, entries, onChange, kind, errors } = props;
      const isEnv = kind === 'env';
      const addLabel = isEnv ? runtime.translate('form.kvAddEnv') : runtime.translate('form.kvAddHeader');
      const keyLabel = runtime.translate('form.kvKey');
      const valueLabel = runtime.translate('form.kvValue');

      function updateEntry(index, patch) {
        const next = entries.map((entry, entryIndex) => (entryIndex === index ? { ...entry, ...patch } : entry));
        onChange(next);
      }

      function removeEntry(index) {
        onChange(entries.filter((entry, entryIndex) => entryIndex !== index));
      }

      function entryIssues(entry, index) {
        const messages = [];
        for (const error of Array.isArray(errors) ? errors : []) {
          const path = String(error.path || '');
          const indexed = new RegExp('^' + kind + '\\[(\\d+)\\]').exec(path);
          if (indexed && Number(indexed[1]) === index) {
            messages.push(runtime.errorText(error.code));
            continue;
          }
          if (entry.key && path === kind + '.' + entry.key) messages.push(runtime.errorText(error.code));
        }
        return messages;
      }

      return h(
        'div',
        { className: 'mcpg-field' },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
          h('span', { className: 'mcpg-label' }, isEnv ? runtime.translate('form.env') : runtime.translate('form.headers')),
          h(
            Button,
            { size: 'sm', variant: 'outline', onClick: () => onChange([...entries, { key: '', value: '', stored: false }]) },
            addLabel,
          ),
        ),
        entries.length === 0 ? h('p', { className: 'mcpg-hint' }, runtime.translate('form.kvNone')) : null,
        entries.map((entry, index) => {
          const issues = entryIssues(entry, index);
          const keyId = 'mcpg-' + kind + '-key-' + index;
          const valueId = 'mcpg-' + kind + '-value-' + index;
          return h(
            'div',
            { key: index, className: 'mcpg-field' },
            h(
              'div',
              { className: 'mcpg-entryrow' },
              h('input', {
                id: keyId,
                className: 'mcpg-input mcpg-entryrow-key',
                type: 'text',
                value: entry.key,
                readOnly: entry.stored === true,
                placeholder: keyLabel,
                'aria-label': keyLabel + ' ' + (index + 1),
                spellCheck: 'false',
                autoComplete: 'off',
                onChange: (event) => updateEntry(index, { key: event.target.value }),
              }),
              h('input', {
                id: valueId,
                className: 'mcpg-input',
                type: 'password',
                value: entry.value || '',
                placeholder: entry.stored === true ? runtime.translate('form.kvStored') : valueLabel,
                'aria-label': valueLabel + ' ' + (entry.key || index + 1),
                autoComplete: 'new-password',
                spellCheck: 'false',
                'aria-invalid': issues.length ? 'true' : undefined,
                onChange: (event) => updateEntry(index, { value: event.target.value }),
              }),
              h(
                Button,
                {
                  size: 'sm',
                  variant: 'outline',
                  className: 'mcpg-btn-icon',
                  onClick: () => removeEntry(index),
                  'aria-label': runtime.translate('a11y.removeEntry', { key: entry.key || index + 1 }),
                  title: runtime.translate('form.kvRemove'),
                },
                '✕',
              ),
            ),
            issues.length ? issues.map((text, issueIndex) => h('p', { key: issueIndex, className: 'mcpg-invalid' }, text)) : null,
          );
        }),
      );
    }

    function entryPayload(entries, kind, runtime) {
      const payload = [];
      for (const entry of entries) {
        const key = String(entry.key || '').trim();
        if (key === '') continue;
        if (entry.stored === true && (entry.value === undefined || entry.value === '')) {
          payload.push({ key, keep: true });
          continue;
        }
        payload.push({ key, value: typeof entry.value === 'string' ? entry.value : '' });
      }
      return payload;
    }

    /* ------------------------------------------------------------------ */
    /* List page                                                           */
    /* ------------------------------------------------------------------ */

    function ToolList({ runtime, serverName, tools }) {
      if (!Array.isArray(tools) || tools.length === 0) return null;
      return h(
        'details',
        { className: 'mcpg-panel' },
        h('summary', null, runtime.translate('page.tools') + ' (' + tools.length + ')'),
        h(
          'ul',
          { className: 'mcpg-chips', 'aria-label': runtime.translate('a11y.toolsOf', { name: serverName }) },
          tools.map((tool) => h('li', { key: tool, className: 'mcpg-chip' }, tool)),
        ),
      );
    }

    function ServerCard({ runtime, row, busy, officialClient, checking, onToggle, onEdit, onDelete, onCheck }) {
      const name = row.serverName || '';
      const isStdio = row.transport === TRANSPORT_STDIO;
      const toggleDisabled = busy || officialClient !== true || Boolean(row.configurationError);
      const riskLevel = row.highestRisk;
      const metaParts = [
        runtime.translate(isStdio ? 'transport.stdioLong' : 'transport.httpLong'),
        row.endpoint ? row.endpoint : null,
        runtime.translate('page.timeout') + ' ' + row.timeoutMs + ' ms',
        runtime.translate('page.tools') + ': ' + (row.toolCount || 0),
        row.argumentCount > 0 ? runtime.translate('page.args') + ': ' + row.argumentCount : null,
      ].filter(Boolean);

      let lastCheckText = runtime.translate('page.neverChecked');
      let lastCheckTone = 'quiet';
      if (row.lastCheck && typeof row.lastCheck === 'object') {
        lastCheckTone = row.lastCheck.successful ? 'success' : 'danger';
        lastCheckText = (row.lastCheck.successful ? runtime.translate('page.checkOk') : runtime.translate('page.checkFailed')) +
          (row.lastCheck.at ? ' · ' + formatTimestamp(row.lastCheck.at) : '');
      }

      return h(
        'article',
        { className: 'mcpg-card' },
        h(
          'div',
          { className: 'mcpg-rowline' },
          h(
            'div',
            { className: 'mcpg-main' },
            h(
              'div',
              { className: 'mcpg-nameline' },
              h('span', { className: 'mcpg-name' }, name),
              h(Tag, { tone: row.enabled ? 'success' : 'neutral' }, runtime.translate(row.enabled ? 'status.enabled' : 'status.disabled')),
              riskLevel ? h(Tag, { tone: riskTone(riskLevel) }, runtime.levelText(riskLevel)) : null,
              row.hasSecrets ? h(Tag, { tone: 'quiet' }, runtime.translate('page.secrets')) : null,
              row.configurationError ? h(Tag, { tone: 'danger' }, runtime.translate('page.invalid')) : null,
            ),
            h(
              'div',
              { className: 'mcpg-meta' },
              metaParts.map((part, index) => h('span', { key: index }, (index > 0 ? ' · ' : '') + part)),
            ),
            h('div', null, h(Tag, { tone: lastCheckTone }, lastCheckText)),
          ),
          h(Switch, {
            checked: row.enabled === true,
            disabled: toggleDisabled,
            label: runtime.translate(row.enabled ? 'a11y.disable' : 'a11y.enable', { name }),
            onChange: (next) => onToggle(row, next),
          }),
        ),
        h(
          'div',
          { className: 'mcpg-rowline' },
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
            row.enabled
              ? h(
                  Button,
                  {
                    size: 'sm',
                    variant: 'outline',
                    disabled: busy || checking,
                    onClick: () => onCheck(row),
                  },
                  checking ? runtime.translate('page.checking') : runtime.translate('page.check'),
                )
              : null,
            h(
              Button,
              { size: 'sm', variant: 'outline', disabled: busy, onClick: () => onEdit(row) },
              runtime.translate('action.edit'),
            ),
            h(
              Button,
              { size: 'sm', variant: 'danger', disabled: busy, onClick: () => onDelete(row) },
              runtime.translate('action.delete'),
            ),
          ),
          row.hasSecrets && (row.envKeys.length || row.headerKeys.length)
            ? h(
                'span',
                { className: 'mcpg-meta' },
                (row.envKeys.length ? 'env: ' + row.envKeys.join(', ') : ''),
                row.envKeys.length && row.headerKeys.length ? ' · ' : '',
                row.headerKeys.length ? 'headers: ' + row.headerKeys.join(', ') : '',
              )
            : null,
        ),
        row.configurationError
          ? h(Banner, { tone: 'warning', text: runtime.errorText(row.configurationError) })
          : null,
        ToolList({ runtime, serverName: name, tools: row.tools }),
      );
    }

    function ExternalCard({ runtime, row }) {
      return h(
        'article',
        { className: 'mcpg-card' },
        h(
          'div',
          { className: 'mcpg-rowline' },
          h(
            'div',
            { className: 'mcpg-main' },
            h(
              'div',
              { className: 'mcpg-nameline' },
              h('span', { className: 'mcpg-name' }, row.serverName || ''),
              h(Tag, { tone: row.enabled ? 'success' : 'neutral' }, runtime.translate(row.enabled ? 'status.enabled' : 'status.disabled')),
              h(Tag, { tone: 'quiet' }, runtime.translate('page.externalLocked')),
            ),
            h('div', { className: 'mcpg-meta' }, runtime.translate(row.transport === TRANSPORT_STDIO ? 'transport.stdioLong' : 'transport.httpLong')),
          ),
        ),
      );
    }

    function AuditSection({ runtime, entries }) {
      const list = Array.isArray(entries) ? entries : [];
      return h(
        'details',
        { className: 'mcpg-panel' },
        h(
          'summary',
          null,
          h('span', { 'aria-label': runtime.translate('a11y.audit') }, runtime.translate('page.audit')),
          h('span', { className: 'mcpg-count' }, '(' + list.length + ')'),
        ),
        list.length === 0
          ? h('p', { className: 'mcpg-hint' }, runtime.translate('page.auditEmpty'))
          : h(
              'ul',
              { className: 'mcpg-auditlist' },
              list.map((entry, index) => {
                const action = entry && typeof entry.action === 'string' ? entry.action : '';
                const result = entry && typeof entry.result === 'string' ? entry.result : '';
                const actionLabel = runtime.optionalText('audit.action.' + action) || action;
                const resultLabel = runtime.optionalText('audit.result.' + result) || result;
                const risk = entry && typeof entry.highestRisk === 'string' ? entry.highestRisk : null;
                return h(
                  'li',
                  { key: index, className: 'mcpg-auditrow' },
                  h('span', { className: 'mcpg-audittime' }, formatTimestamp(entry && entry.at)),
                  h('span', null, actionLabel),
                  entry && entry.serverName ? h('span', { className: 'mcpg-auditserver' }, entry.serverName) : null,
                  result ? h(Tag, { tone: result === 'ok' ? 'success' : 'danger' }, resultLabel) : null,
                  risk ? h(Tag, { tone: riskTone(risk) }, runtime.levelText(risk)) : null,
                );
              }),
            ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Modal bodies                                                        */
    /* ------------------------------------------------------------------ */

    function EnableModal({ runtime, preview, busy, error, onClose, onConfirm }) {
      const [acknowledged, setAcknowledged] = useState(false);
      const needsAck = requiresAcknowledgement(preview.risk);
      const blocked = preview.blocked === true;
      const canConfirm = !busy && !blocked && (!needsAck || acknowledged);
      const title = runtime.translate('modal.enableTitle', { name: preview.serverName });
      const closeLabel = runtime.translate('modal.close');
      return h(
        Modal,
        {
          title,
          closeLabel,
          onClose: busy ? () => {} : onClose,
          footer: [
            h(Button, { key: 'cancel', variant: 'outline', disabled: busy, onClick: onClose }, runtime.translate('form.cancel')),
            h(
              Button,
              { key: 'confirm', variant: 'primary', disabled: !canConfirm, onClick: () => onConfirm(needsAck) },
              runtime.translate('modal.enableConfirm'),
            ),
          ],
        },
        h('p', { className: 'mcpg-hint' }, runtime.translate('modal.enableReview')),
        h(
          'div',
          { className: 'mcpg-inline' },
          h(Tag, { tone: 'neutral' }, runtime.translate(preview.transport === TRANSPORT_STDIO ? 'transport.stdioLong' : 'transport.httpLong')),
          preview.endpoint ? h('code', { className: 'mcpg-chip' }, preview.endpoint) : null,
        ),
        preview.transport === TRANSPORT_STDIO
          ? ArgvPreview({
              runtime,
              argv: Array.isArray(preview.argv) ? preview.argv : [],
              endpoint: preview.endpoint,
              cwd: preview.cwd,
              transport: preview.transport,
            })
          : h(ArgvPreview, {
              runtime,
              argv: [],
              endpoint: preview.endpoint,
              cwd: null,
              transport: preview.transport,
            }),
        h(KeyChips, { label: runtime.translate('preview.envKeys'), keys: preview.envKeys }),
        h(KeyChips, { label: runtime.translate('preview.headerKeys'), keys: preview.headerKeys }),
        h('p', { className: 'mcpg-preview-label' }, runtime.translate('analyze.risks')),
        h(RiskList, { runtime, risks: preview.risk }),
        blocked ? h(Banner, { tone: 'error', text: runtime.translate('analyze.blocked') }) : null,
        needsAck && !blocked
          ? h(CheckboxField, {
              id: 'mcpg-enable-ack',
              label: runtime.translate('modal.enableAck'),
              checked: acknowledged,
              onChange: setAcknowledged,
            })
          : null,
        error ? h(Banner, { tone: 'error', text: error, live: true }) : null,
      );
    }

    function ConfirmModal({ runtime, title, body, confirmLabel, tone, busy, error, onClose, onConfirm }) {
      const closeLabel = runtime.translate('modal.close');
      return h(
        Modal,
        {
          title,
          closeLabel,
          onClose: busy ? () => {} : onClose,
          footer: [
            h(Button, { key: 'cancel', variant: 'outline', disabled: busy, onClick: onClose }, runtime.translate('form.cancel')),
            h(
              Button,
              { key: 'confirm', variant: tone === 'danger' ? 'danger' : 'primary', disabled: busy === true, onClick: onConfirm },
              confirmLabel,
            ),
          ],
        },
        body ? h('p', null, body) : null,
        error ? h(Banner, { tone: 'error', text: error, live: true }) : null,
      );
    }

    function ImportModal({ runtime, latestRevision, busy, error, onClose, onPreview, onImport }) {
      const [text, setText] = useState('');
      const [preview, setPreview] = useState(null);
      const [localError, setLocalError] = useState('');
      const [previewing, setPreviewing] = useState(false);
      const closeLabel = runtime.translate('modal.close');

      const canImport = Boolean(preview) && !busy && preview.count > 0 && (!preview.errors || preview.errors.length === 0);

      async function handlePreview() {
        setLocalError('');
        setPreview(null);
        if (text.length > MAX_BODY_BYTES) {
          setLocalError(runtime.translate('modal.importTooLarge'));
          return;
        }
        if (text.trim() === '') {
          setLocalError(runtime.translate('modal.importEmpty'));
          return;
        }
        setPreviewing(true);
        try {
          const value = await onPreview(text);
          setPreview(value);
        } catch (caught) {
          setLocalError(runtime.errorText(caught && caught.code));
        } finally {
          setPreviewing(false);
        }
      }

      return h(
        Modal,
        {
          title: runtime.translate('modal.importTitle'),
          closeLabel,
          onClose: busy ? () => {} : onClose,
          footer: [
            h(Button, { key: 'cancel', variant: 'outline', disabled: busy, onClick: onClose }, runtime.translate('form.cancel')),
            h(
              Button,
              {
                key: 'preview',
                variant: 'outline',
                disabled: busy || previewing || text.trim() === '',
                onClick: handlePreview,
              },
              runtime.translate('modal.importPreview'),
            ),
            h(
              Button,
              { key: 'import', variant: 'primary', disabled: !canImport, onClick: () => onImport(text, preview) },
              runtime.translate('modal.importConfirm'),
            ),
          ],
        },
        h('p', { className: 'mcpg-hint' }, runtime.translate('modal.importHint')),
        h('textarea', {
          className: 'mcpg-textarea',
          rows: 10,
          value: text,
          spellCheck: 'false',
          autoComplete: 'off',
          'aria-label': runtime.translate('modal.importInput'),
          onChange: (event) => {
            setText(event.target.value);
            setPreview(null);
            setLocalError('');
          },
          placeholder: '{"mcpServers":{"github":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-github"]}}}',
        }),
        localError ? h(Banner, { tone: 'error', text: localError, live: true }) : null,
        preview
          ? h(
              'div',
              { className: 'mcpg-preview' },
              h('p', { className: 'mcpg-preview-label' }, runtime.translate('modal.importSummary', { count: preview.count })),
              Array.isArray(preview.errors) && preview.errors.length
                ? h(
                    'ul',
                    { className: 'mcpg-risk-text' },
                    preview.errors.map((item, index) => h('li', { key: index, className: 'mcpg-invalid' }, runtime.errorText(item && item.code))),
                  )
                : null,
              h(
                'div',
                { className: 'mcpg-cards' },
                (preview.servers || []).map((server, index) =>
                  h(
                    'div',
                    { key: index, className: 'mcpg-card' },
                    h(
                      'div',
                      { className: 'mcpg-nameline' },
                      h('span', { className: 'mcpg-name' }, server.serverName || ''),
                      h(Tag, { tone: 'neutral' }, runtime.translate(server.transport === TRANSPORT_STDIO ? 'transport.stdioLong' : 'transport.httpLong')),
                      server.highestRisk ? h(Tag, { tone: riskTone(server.highestRisk) }, runtime.levelText(server.highestRisk)) : null,
                    ),
                    server.endpoint ? h('div', { className: 'mcpg-meta' }, server.endpoint) : null,
                    Array.isArray(server.risk) && server.risk.length
                      ? h(RiskList, { runtime, risks: server.risk })
                      : null,
                  ),
                ),
              ),
              h('p', { className: 'mcpg-hint' }, runtime.translate('modal.importDisabledNote')),
              preview.revision && latestRevision && preview.revision !== latestRevision
                ? h(Banner, { tone: 'warning', text: runtime.translate('stale.notice') })
                : null,
            )
          : null,
        error ? h(Banner, { tone: 'error', text: error, live: true }) : null,
      );
    }

    function ExportModal({ runtime, onClose }) {
      const [state, setState] = useState({ status: 'loading', json: '', error: null });
      const [copied, setCopied] = useState(false);
      const timerRef = useRef(null);
      const closeLabel = runtime.translate('modal.close');

      useEffect(() => {
        let cancelled = false;
        runtime
          .request('export')
          .then((value) => {
            if (cancelled) return;
            setState({ status: 'ready', json: (value && value.json) || '', error: null });
          })
          .catch((caught) => {
            if (cancelled) return;
            setState({ status: 'error', json: '', error: runtime.errorText(caught && caught.code) });
          });
        return () => {
          cancelled = true;
          if (timerRef.current !== null) clearTimeout(timerRef.current);
        };
      }, [runtime]);

      async function copy() {
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(state.json);
            setCopied(true);
            if (timerRef.current !== null) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setCopied(false), 2000);
            return;
          }
        } catch {
          /* fall through to the failure banner */
        }
        setState((previous) => ({ ...previous, error: runtime.translate('notice.copyFailed') }));
      }

      return h(
        Modal,
        {
          title: runtime.translate('modal.exportTitle'),
          closeLabel,
          onClose,
          footer: [
            h(
              Button,
              { key: 'copy', variant: 'outline', disabled: state.status !== 'ready', onClick: copy },
              copied ? runtime.translate('notice.copied') : runtime.translate('action.copy'),
            ),
            h(Button, { key: 'close', variant: 'primary', onClick: onClose }, runtime.translate('action.close')),
          ],
        },
        h('p', { className: 'mcpg-hint' }, runtime.translate('modal.exportNote')),
        state.status === 'loading' ? h('p', { className: 'mcpg-hint' }, runtime.translate('modal.exportLoading')) : null,
        state.status === 'error' && state.error ? h(Banner, { tone: 'error', text: state.error, live: true }) : null,
        state.status === 'ready'
          ? h('textarea', {
              className: 'mcpg-textarea',
              rows: 14,
              value: state.json,
              readOnly: true,
              spellCheck: 'false',
              'aria-label': runtime.translate('modal.exportTitle'),
            })
          : null,
      );
    }

    /* ------------------------------------------------------------------ */
    /* Edit page                                                           */
    /* ------------------------------------------------------------------ */

    function emptyDraft() {
      return {
        serverName: '',
        transport: TRANSPORT_STDIO,
        command: '',
        argsText: '',
        cwd: '',
        url: '',
        env: [],
        headers: [],
        timeoutMs: '60000',
        reconnectEnabled: true,
        reconnectAttempts: '10',
        failOnStartupError: false,
        maxInstructionBytes: '32768',
        allowPlainHttp: false,
      };
    }

    function draftFromServer(server) {
      const draft = emptyDraft();
      if (!server) return draft;
      draft.serverName = server.serverName || '';
      draft.transport = server.transport === TRANSPORT_HTTP ? TRANSPORT_HTTP : TRANSPORT_STDIO;
      draft.env = (server.envKeys || []).map((key) => ({ key, value: '', stored: true }));
      draft.headers = (server.headerKeys || []).map((key) => ({ key, value: '', stored: true }));
      draft.timeoutMs = String(server.timeoutMs || 60000);
      draft.reconnectEnabled = !(server.reconnect && server.reconnect.enabled === false);
      draft.reconnectAttempts = String((server.reconnect && server.reconnect.maxAttempts) || 10);
      draft.failOnStartupError = server.failOnStartupError === true;
      draft.maxInstructionBytes = String(server.maxInstructionBytes || 32768);
      draft.allowPlainHttp = server.allowPlainHttp === true;
      return draft;
    }

    function buildDraftPayload(draft) {
      return {
        serverName: String(draft.serverName || '').trim(),
        transport: draft.transport,
        command: draft.command,
        argsText: draft.argsText,
        cwd: draft.cwd,
        url: draft.url,
        env: entryPayload(draft.env, 'env'),
        headers: entryPayload(draft.headers, 'headers'),
        timeoutMs: toNumberOrUndefined(draft.timeoutMs),
        reconnectEnabled: draft.reconnectEnabled === true,
        reconnectAttempts: toNumberOrUndefined(draft.reconnectAttempts),
        failOnStartupError: draft.failOnStartupError === true,
        maxInstructionBytes: toNumberOrUndefined(draft.maxInstructionBytes),
        allowPlainHttp: draft.allowPlainHttp === true,
      };
    }

    function splitPathRoot(path) {
      const text = String(path || '');
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text);
      return match ? match[0] : 'general';
    }

    function toJsonText(draft) {
      const parsed = parseArgsText(draft.argsText);
      const name = String(draft.serverName || '').trim() || 'server';
      const entry = { type: draft.transport === TRANSPORT_HTTP ? 'http' : 'stdio' };
      if (draft.transport === TRANSPORT_HTTP) {
        if (String(draft.url || '').trim() !== '') entry.url = draft.url;
        const headers = {};
        for (const item of draft.headers) {
          const key = String(item.key || '').trim();
          if (key === '') continue;
          headers[key] = item.stored === true && (!item.value || item.value === '') ? '${' + key + '}' : item.value || '';
        }
        if (Object.keys(headers).length) entry.headers = headers;
      } else {
        if (String(draft.command || '') !== '') entry.command = draft.command;
        if (parsed.ok && parsed.args.length) entry.args = parsed.args;
        const env = {};
        for (const item of draft.env) {
          const key = String(item.key || '').trim();
          if (key === '') continue;
          env[key] = item.stored === true && (!item.value || item.value === '') ? '${' + key + '}' : item.value || '';
        }
        if (Object.keys(env).length) entry.env = env;
        if (String(draft.cwd || '').trim() !== '') entry.cwd = draft.cwd;
      }
      const document = { mcpServers: {} };
      document.mcpServers[name] = entry;
      return JSON.stringify(document, null, 2);
    }

    function fromJsonText(text, storedEnvKeys, storedHeaderKeys) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, message: 'form.jsonInvalid' };
      }
      if (!isPlainObject(parsed) || !isPlainObject(parsed.mcpServers)) {
        return { ok: false, message: 'form.jsonShape' };
      }
      const names = Object.keys(parsed.mcpServers);
      if (names.length !== 1) return { ok: false, message: 'form.jsonShape' };
      const name = names[0];
      const entry = parsed.mcpServers[name];
      if (!isPlainObject(entry)) return { ok: false, message: 'form.jsonShape' };
      const allowed = ['type', 'command', 'args', 'env', 'cwd', 'url', 'headers'];
      for (const field of Object.keys(entry)) {
        if (!allowed.includes(field)) {
          return { ok: false, message: { field, key: 'form.jsonUnknownField' } };
        }
      }
      let transport = TRANSPORT_STDIO;
      if (hasOwn(entry, 'type')) {
        if (entry.type === 'http' || entry.type === TRANSPORT_HTTP) transport = TRANSPORT_HTTP;
        else if (entry.type === 'stdio') transport = TRANSPORT_STDIO;
        else return { ok: false, message: 'error.TRANSPORT_INVALID' };
      }
      if (transport === TRANSPORT_HTTP && (hasOwn(entry, 'command') || hasOwn(entry, 'env') || hasOwn(entry, 'cwd'))) {
        return { ok: false, message: 'error.TRANSPORT_INVALID' };
      }
      if (transport === TRANSPORT_STDIO && (hasOwn(entry, 'url') || hasOwn(entry, 'headers'))) {
        return { ok: false, message: 'error.TRANSPORT_INVALID' };
      }
      let command = '';
      if (hasOwn(entry, 'command')) {
        if (typeof entry.command !== 'string') return { ok: false, message: 'error.STDIO_COMMAND_INVALID' };
        command = entry.command;
      }
      let argsText = '';
      if (hasOwn(entry, 'args')) {
        if (!Array.isArray(entry.args) || entry.args.some((arg) => typeof arg !== 'string')) {
          return { ok: false, message: 'error.STDIO_ARGS_INVALID' };
        }
        argsText = entry.args.map((arg) => quoteArg(arg)).join(' ');
      }
      let cwd = '';
      if (hasOwn(entry, 'cwd')) {
        if (typeof entry.cwd !== 'string') return { ok: false, message: 'error.STDIO_CWD_INVALID' };
        cwd = entry.cwd;
      }
      let url = '';
      if (hasOwn(entry, 'url')) {
        if (typeof entry.url !== 'string') return { ok: false, message: 'error.HTTP_URL_INVALID' };
        url = entry.url;
      }
      function recordToEntries(record, storedKeys) {
        const entries = [];
        if (!hasOwn(entry, record)) return entries;
        const map = entry[record];
        if (!isPlainObject(map)) return { invalid: true };
        for (const [key, raw] of Object.entries(map)) {
          if (typeof raw !== 'string') return { invalid: true };
          const placeholder = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(raw);
          const stored = storedKeys.includes(key);
          if (placeholder && placeholder[1] === key && stored) {
            entries.push({ key, value: '', stored: true });
          } else {
            entries.push({ key, value: raw, stored });
          }
        }
        return entries;
      }
      const env = recordToEntries('env', storedEnvKeys);
      if (env.invalid) return { ok: false, message: 'error.STDIO_ENV_INVALID' };
      const headers = recordToEntries('headers', storedHeaderKeys);
      if (headers.invalid) return { ok: false, message: 'error.HTTP_HEADERS_INVALID' };
      return {
        ok: true,
        value: {
          serverName: name,
          transport,
          command,
          argsText,
          cwd,
          url,
          env,
          headers,
        },
      };
    }

    function EditPage({ runtime, page, mode, serverName, onBack, onSaved, report }) {
      useLocaleRevision(runtime);
      const server = mode === 'edit' && page ? page.servers.find((item) => item.serverName === serverName) || null : null;
      const initial = useMemo(() => draftFromServer(server), []);
      const [draft, setDraft] = useState(initial);
      const [tab, setTab] = useState('form');
      const [jsonText, setJsonText] = useState('');
      const [jsonProblem, setJsonProblem] = useState(null);
      const [touched, setTouched] = useState(false);
      const [saving, setSaving] = useState(false);
      const [clearAck, setClearAck] = useState(false);
      const [analysis, setAnalysis] = useState({ status: 'idle', result: null, key: null });
      const storedEnvKeys = (server && server.envKeys) || [];
      const storedHeaderKeys = (server && server.headerKeys) || [];
      const tokens = {
        formAria: runtime.translate('a11y.formTab'),
        jsonAria: runtime.translate('a11y.jsonTab'),
        group: runtime.translate('form.tabsLabel'),
      };

      const payload = useMemo(() => buildDraftPayload(draft), [draft]);
      const payloadKey = JSON.stringify(payload);

      function patch(patchValue) {
        setDraft((previous) => ({ ...previous, ...patchValue }));
        setTouched(true);
      }

      useEffect(() => {
        if (!touched) return undefined;
        if (tab === 'json' && jsonProblem) return undefined;
        if (mode === 'edit' && !server) return undefined;
        let cancelled = false;
        const key = payloadKey;
        const timer = setTimeout(() => {
          setAnalysis((previous) => ({ ...previous, status: 'pending' }));
          const requestPayload = { draft: payload };
          if (mode === 'edit' && serverName) requestPayload.existingName = serverName;
          runtime
            .request('analyze', requestPayload)
            .then((result) => {
              if (!cancelled) setAnalysis({ status: 'ready', result, key });
            })
            .catch((caught) => {
              if (!cancelled) setAnalysis({ status: 'error', error: caught, key });
            });
        }, ANALYZE_DEBOUNCE_MS);
        return () => {
          cancelled = true;
          clearTimeout(timer);
        };
      }, [payloadKey, touched, tab, jsonProblem, mode, serverName, server, runtime]);

      const ready = analysis.status === 'ready' && analysis.key === payloadKey;
      const analysisResult = ready ? analysis.result : null;
      const apiErrors = analysisResult && Array.isArray(analysisResult.errors) ? analysisResult.errors : [];
      const risks = analysisResult && Array.isArray(analysisResult.risk) ? analysisResult.risk : [];
      const blocked = Boolean(analysisResult && analysisResult.blocked);

      const errorsByRoot = useMemo(() => {
        const map = {};
        for (const error of apiErrors) {
          const root = splitPathRoot(error && error.path);
          if (!map[root]) map[root] = [];
          map[root].push({ code: error && error.code, path: error && error.path });
        }
        return map;
      }, [apiErrors]);

      const renderedRoots = [
        'serverName',
        'transport',
        'command',
        'args',
        'argsText',
        'cwd',
        'url',
        'env',
        'headers',
        'timeoutMs',
        'reconnectEnabled',
        'reconnectAttempts',
        'failOnStartupError',
        'maxInstructionBytes',
        'allowPlainHttp',
        'reconnect',
      ];
      const generalErrors = Object.keys(errorsByRoot).filter((root) => !renderedRoots.includes(root));

      function fieldErrorTexts(root) {
        const list = errorsByRoot[root] || [];
        return list.map((item) => runtime.errorText(item.code));
      }

      const currentEnvKeys = draft.env.map((item) => String(item.key || '').trim()).filter(Boolean);
      const droppedEnvKeys = storedEnvKeys.filter((key) => !currentEnvKeys.includes(key));
      const currentHeaderKeys = draft.headers.map((item) => String(item.key || '').trim()).filter(Boolean);
      const droppedHeaderKeys = storedHeaderKeys.filter((key) => !currentHeaderKeys.includes(key));
      const droppedSecrets = [...droppedEnvKeys, ...droppedHeaderKeys];
      const needsClearAck = mode === 'edit' && droppedSecrets.length > 0;

      const canSave =
        !saving &&
        touched &&
        ready &&
        !blocked &&
        apiErrors.length === 0 &&
        !jsonProblem &&
        (!needsClearAck || clearAck) &&
        analysis.status !== 'pending';

      function selectTab(nextTab) {
        if (nextTab === tab) return;
        if (nextTab === 'json') {
          const parsedArgs = parseArgsText(draft.argsText);
          if (!parsedArgs.ok) {
            report({ code: 'STDIO_ARGS_INVALID' });
            return;
          }
          setJsonText(toJsonText(draft));
          setJsonProblem(null);
          setTab('json');
          return;
        }
        const parsed = fromJsonText(jsonText, storedEnvKeys, storedHeaderKeys);
        if (!parsed.ok) {
          const problem = parsed.message;
          const text =
            typeof problem === 'string'
              ? runtime.translate(problem)
              : runtime.translate(problem.key) + (problem.field ? ' · ' + problem.field : '');
          setJsonProblem(text);
          return;
        }
        setDraft((previous) => ({ ...previous, ...parsed.value }));
        setJsonProblem(null);
        setTab('form');
      }

      function handleJsonChange(value) {
        setJsonText(value);
        setTouched(true);
        if (value.length > MAX_BODY_BYTES) {
          setJsonProblem(runtime.translate('modal.importTooLarge'));
          return;
        }
        const parsed = fromJsonText(value, storedEnvKeys, storedHeaderKeys);
        if (!parsed.ok) {
          const problem = parsed.message;
          const text =
            typeof problem === 'string'
              ? runtime.translate(problem)
              : runtime.translate(problem.key) + (problem.field ? ' · ' + problem.field : '');
          setJsonProblem(text);
          return;
        }
        setJsonProblem(null);
        setDraft((previous) => ({ ...previous, ...parsed.value }));
      }

      async function handleSave() {
        if (!canSave) return;
        setSaving(true);
        try {
          if (mode === 'create') {
            await runtime.request('create', { draft: payload, revision: page.revision, confirm: true });
          } else {
            await runtime.request('update', { serverName, draft: payload, revision: page.revision, confirm: true });
          }
          onSaved(mode);
        } catch (caught) {
          report(caught);
        } finally {
          setSaving(false);
        }
      }

      if (mode === 'edit' && !server) {
        return h(
          'section',
          { className: 'mcpg-section' },
          h('h2', { className: 'mcpg-title' }, runtime.translate('form.titleEdit', { name: serverName })),
          h(Banner, { tone: 'warning', text: runtime.translate('error.NOT_FOUND') }),
          h('div', null, h(Button, { variant: 'outline', onClick: onBack }, runtime.translate('form.back'))),
        );
      }

      const formPanel = h(
        'div',
        { className: 'mcpg-form' },
        h(
          'div',
          { className: 'mcpg-grid2' },
          h(TextField, {
            id: 'mcpg-name',
            label: runtime.translate('form.name'),
            value: draft.serverName,
            disabled: mode === 'edit',
            onChange: (value) => patch({ serverName: value }),
            hint: mode === 'edit' ? runtime.translate('form.nameLocked') : runtime.translate('form.nameHint'),
            errors: fieldErrorTexts('serverName'),
          }),
          h(TextField, {
            id: 'mcpg-timeout',
            label: runtime.translate('form.timeout'),
            value: draft.timeoutMs,
            inputMode: 'numeric',
            onChange: (value) => patch({ timeoutMs: value }),
            hint: runtime.translate('form.timeoutHint'),
            errors: fieldErrorTexts('timeoutMs'),
          }),
        ),
        h(
          'div',
          { className: 'mcpg-field' },
          h('span', { className: 'mcpg-label' }, runtime.translate('form.type')),
          h(Segmented, {
            value: draft.transport,
            onChange: (value) =>
              patch(
                value === TRANSPORT_HTTP
                  ? { transport: value, env: [] }
                  : { transport: value, headers: [] },
              ),
            label: runtime.translate('a11y.transportGroup'),
            options: [
              { value: TRANSPORT_STDIO, label: runtime.translate('transport.stdioLong') },
              { value: TRANSPORT_HTTP, label: runtime.translate('transport.httpLong') },
            ],
          }),
          fieldErrorTexts('transport').map((text, index) => h('p', { key: index, className: 'mcpg-invalid' }, text)),
        ),
        h(TextField, {
          id: 'mcpg-protocol',
          label: runtime.translate('form.protocol'),
          value: runtime.translate('form.protocolAuto'),
          readOnly: true,
          disabled: true,
          onChange: () => {},
        }),
        draft.transport === TRANSPORT_STDIO
          ? [
              h(TextField, {
                key: 'command',
                id: 'mcpg-command',
                label: runtime.translate('form.command'),
                value: draft.command,
                onChange: (value) => patch({ command: value }),
                placeholder: server && server.transport === TRANSPORT_STDIO ? server.endpoint || '' : 'npx',
                hint:
                  mode === 'edit' && server
                    ? runtime.translate('form.commandEditHint', { endpoint: server.endpoint || '—' })
                    : runtime.translate('form.commandHint'),
                errors: fieldErrorTexts('command'),
              }),
              h(TextAreaField, {
                key: 'args',
                id: 'mcpg-args',
                label: runtime.translate('form.args'),
                value: draft.argsText,
                onChange: (value) => patch({ argsText: value }),
                hint:
                  mode === 'edit' && server && server.argumentCount > 0
                    ? runtime.translate('form.argsEditHint', { count: server.argumentCount })
                    : runtime.translate('form.argsHint'),
                errors: [...fieldErrorTexts('argsText'), ...fieldErrorTexts('args')],
                rows: 3,
              }),
              h(TextField, {
                key: 'cwd',
                id: 'mcpg-cwd',
                label: runtime.translate('form.cwd'),
                value: draft.cwd,
                onChange: (value) => patch({ cwd: value }),
                placeholder: server ? server.endpoint || '' : '',
                hint: runtime.translate('form.cwdHint'),
                errors: fieldErrorTexts('cwd'),
              }),
              h(KeyValueEditor, {
                key: 'env',
                runtime,
                entries: draft.env,
                onChange: (entries) => patch({ env: entries }),
                kind: 'env',
                errors: errorsByRoot.env || [],
              }),
            ]
          : [
              h(TextField, {
                key: 'url',
                id: 'mcpg-url',
                label: runtime.translate('form.url'),
                value: draft.url,
                onChange: (value) => patch({ url: value }),
                placeholder: server && server.transport === TRANSPORT_HTTP ? server.endpoint || '' : 'https://example.com/mcp',
                hint: runtime.translate('form.urlHint'),
                errors: fieldErrorTexts('url'),
              }),
              h(CheckboxField, {
                key: 'plain',
                id: 'mcpg-plain-http',
                label: runtime.translate('form.allowPlainHttp'),
                checked: draft.allowPlainHttp,
                onChange: (checked) => patch({ allowPlainHttp: checked }),
                hint: runtime.translate('form.allowPlainHttpWarning'),
                errors: fieldErrorTexts('allowPlainHttp'),
              }),
              h(KeyValueEditor, {
                key: 'headers',
                runtime,
                entries: draft.headers,
                onChange: (entries) => patch({ headers: entries }),
                kind: 'headers',
                errors: errorsByRoot.headers || [],
              }),
            ],
        h(
          'details',
          { className: 'mcpg-panel mcpg-advanced' },
          h('summary', null, runtime.translate('form.advanced')),
          h(
            'div',
            { className: 'mcpg-advanced-body' },
            h(CheckboxField, {
              id: 'mcpg-reconnect-enabled',
              label: runtime.translate('form.reconnectEnabled'),
              checked: draft.reconnectEnabled,
              onChange: (checked) => patch({ reconnectEnabled: checked }),
              errors: [...fieldErrorTexts('reconnectEnabled'), ...fieldErrorTexts('reconnect')],
            }),
            h(TextField, {
              id: 'mcpg-reconnect-attempts',
              label: runtime.translate('form.reconnectAttempts'),
              value: draft.reconnectAttempts,
              inputMode: 'numeric',
              onChange: (value) => patch({ reconnectAttempts: value }),
              errors: fieldErrorTexts('reconnectAttempts'),
            }),
            h(CheckboxField, {
              id: 'mcpg-fail-startup',
              label: runtime.translate('form.failOnStartupError'),
              checked: draft.failOnStartupError,
              onChange: (checked) => patch({ failOnStartupError: checked }),
              errors: fieldErrorTexts('failOnStartupError'),
            }),
            h(TextField, {
              id: 'mcpg-max-instruction',
              label: runtime.translate('form.maxInstructionBytes'),
              value: draft.maxInstructionBytes,
              inputMode: 'numeric',
              onChange: (value) => patch({ maxInstructionBytes: value }),
              errors: fieldErrorTexts('maxInstructionBytes'),
            }),
          ),
        ),
      );

      const jsonPanel = h(
        'div',
        { className: 'mcpg-form' },
        h('p', { className: 'mcpg-hint' }, runtime.translate('form.jsonHint')),
        h(TextAreaField, {
          id: 'mcpg-json',
          value: jsonText,
          onChange: handleJsonChange,
          rows: 16,
          errors: jsonProblem ? [jsonProblem] : [],
          ariaLabel: runtime.translate('form.tabJson'),
        }),
      );

      return h(
        'section',
        { className: 'mcpg-section' },
        h(
          'div',
          { className: 'mcpg-head' },
          h('h2', { className: 'mcpg-title' }, mode === 'create'
            ? runtime.translate('form.titleCreate')
            : runtime.translate('form.titleEdit', { name: serverName || '' })),
          h('p', { className: 'mcpg-intro' }, runtime.translate('form.scope', { profile: (page && page.profileName) || 'desktop' })),
        ),
        h(
          'div',
          { className: 'mcpg-toolbar' },
          h(Button, { variant: 'outline', size: 'sm', onClick: onBack }, '← ' + runtime.translate('form.back')),
        ),
        mode === 'edit' ? h(Banner, { tone: 'info', text: runtime.translate('form.editNotice') }) : null,
        h(Tabs, {
          value: tab,
          onChange: selectTab,
          formLabel: runtime.translate('form.tabForm'),
          jsonLabel: runtime.translate('form.tabJson'),
          labels: tokens,
        }),
        h(
          'div',
          {
            role: 'tabpanel',
            id: 'mcpg-tabs-panel-' + tab,
            'aria-label': tab === 'form' ? runtime.translate('a11y.formTab') : runtime.translate('a11y.jsonTab'),
          },
          tab === 'form' ? formPanel : jsonPanel,
        ),
        analysis.status === 'error' ? h(Banner, { tone: 'error', text: runtime.errorText(analysis.error && analysis.error.code), live: true }) : null,
        generalErrors.length
          ? h(
              'div',
              { className: 'mcpg-panel' },
              h('p', { className: 'mcpg-preview-label' }, runtime.translate('analyze.problems')),
              h(
                'ul',
                { className: 'mcpg-risks' },
                generalErrors.flatMap((root) =>
                  (errorsByRoot[root] || []).map((item, index) =>
                    h('li', { key: root + '-' + index, className: 'mcpg-risk' },
                      h('span', null, runtime.errorText(item.code), item.path ? ' · ' + item.path : ''),
                    ),
                  ),
                ),
              ),
            )
          : null,
        analysis.status === 'pending' ? h('p', { className: 'mcpg-hint' }, runtime.translate('analyze.pending')) : null,
        analysisResult
          ? h(
              'div',
              { className: 'mcpg-panel' },
              h('p', { className: 'mcpg-preview-label' }, runtime.translate('analyze.risks')),
              blocked ? h(Banner, { tone: 'error', text: runtime.translate('analyze.blocked') }) : null,
              h(RiskList, { runtime, risks }),
              ArgvPreview({
                runtime,
                argv: Array.isArray(analysisResult.argv) ? analysisResult.argv : [],
                endpoint: analysisResult.endpoint,
                cwd: draft.transport === TRANSPORT_STDIO ? draft.cwd : null,
                transport: draft.transport,
              }),
              h('p', { className: 'mcpg-hint' }, runtime.translate('analyze.secretsNote')),
            )
          : null,
        needsClearAck
          ? h(
              'div',
              { className: 'mcpg-form' },
              h(Banner, { tone: 'warning', text: runtime.translate('form.clearSecrets', { keys: droppedSecrets.join(', ') }) }),
              h(CheckboxField, {
                id: 'mcpg-clear-ack',
                label: runtime.translate('form.clearAck'),
                checked: clearAck,
                onChange: setClearAck,
              }),
            )
          : null,
        h(
          'div',
          { className: 'mcpg-actions-end' },
          h(Button, { variant: 'outline', disabled: saving, onClick: onBack }, runtime.translate('form.cancel')),
          h(
            Button,
            { variant: 'primary', disabled: !canSave, onClick: handleSave, title: canSave ? undefined : runtime.translate('form.saveDisabled') },
            runtime.translate('form.save'),
          ),
        ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Settings page                                                       */
    /* ------------------------------------------------------------------ */

    function McpGuardPage(props) {
      const runtime = props.runtime;
      useLocaleRevision(runtime);
      const [page, setPage] = useState(null);
      const [loading, setLoading] = useState(false);
      const [loadError, setLoadError] = useState(null);
      const [authBlocked, setAuthBlocked] = useState(false);
      const [stale, setStale] = useState(false);
      const [notice, setNotice] = useState(null);
      const [view, setView] = useState({ kind: 'list' });
      const [modal, setModal] = useState(null);
      const [busy, setBusy] = useState(null);
      const [checkingName, setCheckingName] = useState(null);

      const load = useCallback(
        async (silent) => {
          if (!silent) setLoading(true);
          try {
            const value = await runtime.request(null);
            setPage(value);
            setLoadError(null);
            setAuthBlocked(false);
            return value;
          } catch (error) {
            const status = error && error.status;
            const code = error && error.code;
            if (status === 401 || status === 403 || code === 'UNAUTHENTICATED' || code === 'FORBIDDEN') {
              setAuthBlocked(true);
              return null;
            }
            setLoadError(error);
            return null;
          } finally {
            if (!silent) setLoading(false);
          }
        },
        [runtime],
      );

      useEffect(() => {
        void load(false);
        const refresh = () => {
          if (document.visibilityState !== 'hidden') void load(true);
        };
        const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
        document.addEventListener('visibilitychange', refresh);
        return () => {
          window.clearInterval(timer);
          document.removeEventListener('visibilitychange', refresh);
        };
      }, [load]);

      const classify = useCallback((error) => {
        const status = error && error.status;
        const code = error && error.code;
        if (status === 401 || status === 403 || code === 'UNAUTHENTICATED' || code === 'FORBIDDEN') return 'auth';
        if (status === 409 || code === 'STALE_CONFIGURATION') return 'stale';
        return 'error';
      }, []);

      const report = useCallback(
        (error) => {
          const kind = classify(error);
          if (kind === 'auth') {
            setAuthBlocked(true);
            return kind;
          }
          if (kind === 'stale') {
            setStale(true);
            void load(true);
            return kind;
          }
          const code = error && error.code;
          setNotice({
            tone: 'error',
            text: runtime.errorText(code),
            detail: error && error.path ? String(error.path) : '',
          });
          return kind;
        },
        [classify, load, runtime],
      );

      const failModal = useCallback(
        (error) => {
          const kind = classify(error);
          if (kind === 'auth') {
            setAuthBlocked(true);
            setModal(null);
            return kind;
          }
          if (kind === 'stale') {
            setStale(true);
            setModal(null);
            void load(true);
            return kind;
          }
          setModal((previous) =>
            previous ? { ...previous, error: runtime.errorText(error && error.code) } : previous,
          );
          return kind;
        },
        [classify, load, runtime],
      );

      const translate = runtime.translate;
      const officialClient = Boolean(page && page.officialClient === true);
      const servers = page && Array.isArray(page.servers) ? page.servers : [];
      const external = page && Array.isArray(page.external) ? page.external : [];
      const toolsTotal = page && page.tools && typeof page.tools.total === 'number' ? page.tools.total : 0;

      function openCreate() {
        setView({ kind: 'edit', mode: 'create' });
      }

      function openEdit(row) {
        setView({ kind: 'edit', mode: 'edit', serverName: row.serverName });
      }

      function onSaved(mode) {
        setView({ kind: 'list' });
        setNotice({ tone: 'success', text: translate(mode === 'create' ? 'notice.savedCreate' : 'notice.savedUpdate') });
        void load(true);
      }

      async function toggleServer(row, nextEnabled) {
        if (busy) return;
        if (!nextEnabled) {
          setModal({ kind: 'disable', serverName: row.serverName });
          return;
        }
        setBusy('preview');
        try {
          const preview = await runtime.request('executionPreview', { serverName: row.serverName });
          setModal({ kind: 'enable', preview });
        } catch (error) {
          report(error);
        } finally {
          setBusy(null);
        }
      }

      async function confirmEnable(acknowledge) {
        const preview = modal && modal.kind === 'enable' ? modal.preview : null;
        if (!preview) return;
        setBusy('enable');
        try {
          if (!page || preview.revision !== page.revision) {
            setModal(null);
            setStale(true);
            await load(true);
            return;
          }
          await runtime.request('toggle', {
            serverName: preview.serverName,
            enabled: true,
            revision: page.revision,
            confirm: true,
            ...(acknowledge ? { acknowledgeRisk: true } : {}),
          });
          setModal(null);
          setNotice({ tone: 'success', text: translate('notice.enabled', { name: preview.serverName }) });
          await load(true);
        } catch (error) {
          failModal(error);
        } finally {
          setBusy(null);
        }
      }

      async function confirmDisable() {
        const serverName = modal && modal.kind === 'disable' ? modal.serverName : null;
        if (!serverName || !page) return;
        setBusy('disable');
        try {
          await runtime.request('toggle', {
            serverName,
            enabled: false,
            revision: page.revision,
            confirm: true,
          });
          setModal(null);
          setNotice({ tone: 'success', text: translate('notice.disabled', { name: serverName }) });
          await load(true);
        } catch (error) {
          failModal(error);
        } finally {
          setBusy(null);
        }
      }

      async function confirmDelete() {
        const serverName = modal && modal.kind === 'delete' ? modal.serverName : null;
        if (!serverName || !page) return;
        setBusy('delete');
        try {
          await runtime.request('remove', { serverName, revision: page.revision, confirm: true });
          setModal(null);
          setNotice({ tone: 'success', text: translate('notice.removed', { name: serverName }) });
          await load(true);
        } catch (error) {
          failModal(error);
        } finally {
          setBusy(null);
        }
      }

      async function runCheck(row) {
        if (!page || checkingName) return;
        setCheckingName(row.serverName);
        try {
          const result = await runtime.request('check', { serverName: row.serverName, revision: page.revision });
          setPage((previous) => {
            if (!previous) return previous;
            return {
              ...previous,
              servers: previous.servers.map((item) =>
                item.serverName === row.serverName ? { ...item, lastCheck: result } : item,
              ),
            };
          });
          setNotice({
            tone: result.successful ? 'success' : 'error',
            text: translate(result.successful ? 'notice.checkOk' : 'notice.checkFailed', { name: row.serverName }),
          });
        } catch (error) {
          report(error);
        } finally {
          setCheckingName(null);
        }
      }

      async function previewImport(text) {
        return runtime.request('previewImport', { text });
      }

      async function runImport(text, preview) {
        if (!page || !preview) return;
        setBusy('import');
        try {
          if (preview.revision !== page.revision) {
            setModal(null);
            setStale(true);
            await load(true);
            return;
          }
          await runtime.request('import', { text, revision: page.revision, confirm: true });
          setModal(null);
          setNotice({ tone: 'success', text: translate('notice.imported', { count: preview.count }) });
          await load(true);
        } catch (error) {
          failModal(error);
        } finally {
          setBusy(null);
        }
      }

      const editView = view.kind === 'edit';
      const limited = page && page.limits && typeof page.limits.maxServers === 'number' ? page.limits.maxServers : 100;

      const bannerAuth = authBlocked
        ? h(Banner, {
            tone: 'error',
            text: translate('auth.notice'),
            live: true,
            actions: h(
              Button,
              { size: 'sm', variant: 'outline', onClick: () => window.location.reload() },
              translate('auth.reload'),
            ),
          })
        : null;

      const bannerStale = stale
        ? h(Banner, {
            tone: 'warning',
            text: translate('stale.notice'),
            live: true,
            actions: h(
              Button,
              {
                size: 'sm',
                variant: 'outline',
                onClick: () => {
                  setStale(false);
                  void load(true);
                },
              },
              translate('stale.reload'),
            ),
          })
        : null;

      const bannerLoadError = loadError
        ? h(Banner, {
            tone: 'error',
            text: runtime.errorText(loadError.code),
            live: true,
            actions: h(
              Button,
              { size: 'sm', variant: 'outline', onClick: () => void load(false) },
              translate('page.refresh'),
            ),
          })
        : null;

      const bannerNotice = notice
        ? h(Banner, {
            tone: notice.tone === 'error' ? 'error' : 'success',
            text: notice.text,
            detail: notice.detail || '',
            live: true,
            actions: h(
              Button,
              {
                size: 'sm',
                variant: 'outline',
                'aria-label': translate('a11y.dismiss'),
                title: translate('a11y.dismiss'),
                onClick: () => setNotice(null),
              },
              '✕',
            ),
          })
        : null;

      const bannerOfficial =
        page && !officialClient
          ? h(Banner, { tone: 'warning', text: translate('page.officialUnavailable') })
          : null;

      const listContent = h(
        'div',
        { className: 'mcpg-section' },
        h(
          'div',
          { className: 'mcpg-toolbar' },
          h(
            Button,
            {
              variant: 'primary',
              disabled: Boolean(busy) || !page || servers.length >= limited,
              onClick: openCreate,
              'aria-label': translate('page.add'),
            },
            translate('page.add'),
          ),
          h(
            Button,
            { variant: 'outline', disabled: Boolean(busy) || !page, onClick: () => setModal({ kind: 'import' }) },
            translate('page.import'),
          ),
          h(
            Button,
            { variant: 'outline', disabled: Boolean(busy) || !page, onClick: () => setModal({ kind: 'export' }) },
            translate('page.export'),
          ),
          h('span', { className: 'mcpg-grow' }),
          h(
            Button,
            { variant: 'outline', disabled: loading || Boolean(busy), onClick: () => void load(false), 'aria-label': translate('a11y.refresh') },
            loading ? translate('page.loading') : translate('page.refresh'),
          ),
        ),
        h(
          'div',
          { className: 'mcpg-sectionline' },
          h('h3', { className: 'mcpg-h3', 'aria-label': translate('a11y.managedSection') }, translate('page.managed')),
          h('span', { className: 'mcpg-count' }, '(' + servers.length + ')'),
          toolsTotal ? h(Tag, { tone: 'quiet' }, translate('page.tools') + ': ' + toolsTotal) : null,
        ),
        servers.length === 0
          ? h('p', { className: 'mcpg-empty' }, page ? translate('page.empty') : translate('page.loading'))
          : h(
              'div',
              { className: 'mcpg-cards' },
              servers.map((row) =>
                h(ServerCard, {
                  key: row.serverName,
                  runtime,
                  row,
                  officialClient,
                  busy: Boolean(busy) || Boolean(checkingName),
                  checking: checkingName === row.serverName,
                  onToggle: toggleServer,
                  onEdit: openEdit,
                  onDelete: (item) => setModal({ kind: 'delete', serverName: item.serverName }),
                  onCheck: runCheck,
                }),
              ),
            ),
        external.length
          ? h(
              'div',
              { className: 'mcpg-section' },
              h(
                'div',
                { className: 'mcpg-sectionline' },
                h('h3', { className: 'mcpg-h3', 'aria-label': translate('a11y.externalSection') }, translate('page.external')),
                h('span', { className: 'mcpg-count' }, '(' + external.length + ')'),
              ),
              h('p', { className: 'mcpg-hint' }, translate('page.externalHint')),
              h(
                'div',
                { className: 'mcpg-cards' },
                external.map((row, index) => h(ExternalCard, { key: row.serverName || index, runtime, row })),
              ),
            )
          : null,
        page ? h(AuditSection, { runtime, entries: page.audit }) : null,
      );

      const modals = [];
      if (modal && modal.kind === 'enable') {
        modals.push(
          h(EnableModal, {
            key: 'enable',
            runtime,
            preview: modal.preview,
            busy: busy === 'enable',
            error: modal.error || null,
            onClose: () => setModal(null),
            onConfirm: confirmEnable,
          }),
        );
      } else if (modal && modal.kind === 'disable') {
        modals.push(
          h(ConfirmModal, {
            key: 'disable',
            runtime,
            title: translate('modal.disableTitle', { name: modal.serverName }),
            body: translate('modal.disableBody'),
            confirmLabel: translate('modal.disableConfirm'),
            tone: 'primary',
            busy: busy === 'disable',
            error: modal.error || null,
            onClose: () => setModal(null),
            onConfirm: confirmDisable,
          }),
        );
      } else if (modal && modal.kind === 'delete') {
        modals.push(
          h(ConfirmModal, {
            key: 'delete',
            runtime,
            title: translate('modal.deleteTitle', { name: modal.serverName }),
            body: translate('modal.deleteBody'),
            confirmLabel: translate('modal.deleteConfirm'),
            tone: 'danger',
            busy: busy === 'delete',
            error: modal.error || null,
            onClose: () => setModal(null),
            onConfirm: confirmDelete,
          }),
        );
      } else if (modal && modal.kind === 'import') {
        modals.push(
          h(ImportModal, {
            key: 'import',
            runtime,
            latestRevision: page ? page.revision : '',
            busy: busy === 'import',
            error: modal.error || null,
            onClose: () => setModal(null),
            onPreview: previewImport,
            onImport: runImport,
          }),
        );
      } else if (modal && modal.kind === 'export') {
        modals.push(h(ExportModal, { key: 'export', runtime, onClose: () => setModal(null) }));
      }

      if (editView) {
        return h(
          'section',
          { className: 'mcpg-section' },
          page ? null : h('p', { className: 'mcpg-empty' }, translate('page.loading')),
          page
            ? h(EditPage, {
                runtime,
                page,
                mode: view.mode,
                serverName: view.serverName,
                onBack: () => setView({ kind: 'list' }),
                onSaved,
                report,
              })
            : null,
          bannerAuth,
          bannerStale,
          bannerLoadError,
          bannerNotice,
        );
      }

      return h(
        'section',
        { className: 'mcpg-section' },
        h(
          'div',
          { className: 'mcpg-head' },
          h('h2', { className: 'mcpg-title' }, translate('nav.label')),
          h(
            'p',
            { className: 'mcpg-intro' },
            translate('page.intro'),
            page && page.profileName ? ' · ' + translate('page.profile', { name: page.profileName }) : '',
          ),
        ),
        bannerAuth,
        bannerStale,
        bannerLoadError,
        bannerOfficial,
        bannerNotice,
        !page && loading ? h('p', { className: 'mcpg-empty' }, translate('page.loading')) : null,
        page ? listContent : null,
        modals,
      );
    }

    /* ------------------------------------------------------------------ */
    /* Icons                                                               */
    /* ------------------------------------------------------------------ */

    function McpGuardIcon({ size }) {
      const pixels = typeof size === 'number' ? size : 16;
      return h(
        'svg',
        {
          width: pixels,
          height: pixels,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        h('path', {
          d: 'M12 2.4 20 5.6v6.1c0 4.6-3.2 8.2-8 9.9-4.8-1.7-8-5.3-8-9.9V5.6L12 2.4Z',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M8.4 9.2h2.6v2.6H8.4V9.2Zm4.6 0h2.6v2.6h-2.6V9.2Zm-2.3 4.1h2.6v2.6h-2.6v-2.6Z',
          fill: 'currentColor',
        }),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Plugin definition                                                   */
    /* ------------------------------------------------------------------ */

    const inject = ['slots', 'locale'];

    function apply(ctx) {
      const runtime = createRuntime(ctx);

      ctx.effect(() => installStyles(), 'dsh-mcp-guard: styles');

      if (ctx.locale && typeof ctx.locale.register === 'function') {
        ctx.effect(() => {
          try {
            return ctx.locale.register(LOCALE_NS, { en: DICT_EN, ru: DICT_RU });
          } catch (error) {
            const message = String((error && error.message) || error || '');
            if (/already has locale/.test(message)) return () => {};
            throw error;
          }
        }, 'dsh-mcp-guard: dictionaries');
      }

      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'mcp-guard',
                order: 22,
                label: () => runtime.translate('nav.label'),
                locale: LOCALE_NS,
                inject: () => ({ runtime }),
              },
              McpGuardPage,
            ),
          ),
        'dsh-mcp-guard: settings section',
      );

      ctx.effect(
        () =>
          ctx.slots.inject('settings.section.icon', () =>
            ctx.slots.register(
              {
                name: 'settings.section.icon',
                id: 'mcp-guard',
                locale: LOCALE_NS,
              },
              McpGuardIcon,
            ),
          ),
        'dsh-mcp-guard: settings icon',
      );
    }

    return { inject, apply };
  },
});
