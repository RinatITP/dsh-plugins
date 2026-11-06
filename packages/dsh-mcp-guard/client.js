/**
 * dsh-mcp-guard — Client (browser) half.
 *
 * Registers one `settings.section` page (id `mcp-guard`, order 22) into the DSH
 * Web settings UI. The presentation is a close adaptation of the Z.ai (GLM)
 * "MCP Servers" settings design (list with search/scope pill/row cards, Form and
 * JSON tabs with one bordered card, breadcrumbs), while the behaviour stays the
 * fail-closed security manager over the Host HTTP endpoint:
 *
 *  - managed servers list (rows) + read-only "managed by other plugins" group;
 *  - Add/Edit form with Form | JSON tabs, debounced `analyze` validation,
 *    risk findings and an argv/endpoint preview;
 *  - enable confirmation with an execution preview and an explicit risk
 *    acknowledgement for high/critical findings;
 *  - delete / disable confirmation, strict JSON import preview, redacted export;
 *  - per-server tool list, last check and an audit log.
 *
 * Secrets are write-only: the API never returns env/header values and this file
 * never mirrors them. The list subtitle and the edit prefill use the non-secret
 * execution coordinates of `ServerView` (`command`/`args`/`cwd`/`url`) when the
 * Host provides them. All copy goes through a local English/Russian dictionary
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

    /** True when the Host snapshot carries non-secret execution coordinates. */
    function serverHasDetails(server) {
      return Boolean(server) && (typeof server.command === 'string' || typeof server.url === 'string');
    }

    /** Z.ai-style command/endpoint line for one managed server row. */
    function serverSubtitle(server) {
      if (!server) return '';
      if (server.transport === TRANSPORT_HTTP) {
        const url = typeof server.url === 'string' && server.url !== '' ? server.url : server.endpoint;
        return 'streamable-http · ' + (url || '—');
      }
      const command =
        typeof server.command === 'string' && server.command !== '' ? server.command : server.endpoint || '—';
      const args = Array.isArray(server.args) ? server.args : [];
      return ['stdio · ' + command, ...args].join(' ');
    }

    /** Command/endpoint line for one external row (detail is fetched lazily). */
    function externalSubtitle(detail, row) {
      const transport = (detail && detail.transport) || (row && row.transport) || TRANSPORT_STDIO;
      const base = transport === TRANSPORT_HTTP ? 'streamable-http' : 'stdio';
      if (detail) {
        if (transport === TRANSPORT_HTTP) return base + ' · ' + (detail.url || '—');
        const args = Array.isArray(detail.args) ? detail.args : [];
        const command = typeof detail.command === 'string' && detail.command !== '' ? detail.command : '—';
        return [base + ' · ' + command, ...args].join(' ');
      }
      const name = row && typeof row.serverName === 'string' ? row.serverName : '';
      return base + (name ? ' · ' + name : '');
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
      'action.copy': 'Copy',
      'action.close': 'Close',
      'action.edit': 'Edit',
      'action.delete': 'Delete',
      'list.search': 'Search MCP servers...',
      'list.searchAria': 'Search MCP servers',
      'list.scope': 'This computer · User',
      'list.scopeUser': 'This computer: User',
      'list.scopeProjects': 'Projects',
      'list.scopeComingSoon': 'Coming soon',
      'list.scopeAria': 'Switch scope',
      'list.scopeLabel': 'Scope',
      'list.mcp': 'MCP',
      'list.installed': 'Installed',
      'list.externalHint': 'Provided by another plugin or a hand-written profile entry — read-only.',
      'list.noResults': 'No MCP servers match your search.',
      'list.new': 'New',
      'list.more': 'More actions',
      'list.importMenu': 'Import…',
      'list.exportMenu': 'Export…',
      'list.riskBadge': 'Risk: {level}',
      'list.secretsBadge': 'Contains secret values',
      'list.statusAria': 'Status: {status}',
      'list.tools': '{count} tools',
      'list.auditTitle': 'Audit log',

      'external.source': 'Source',
      'external.sourceLabel': 'Declared in the DSH profile by another plugin or a hand-written entry.',
      'external.notOwned':
        'MCP Guard does not manage this row. Inspect it here or take a validated copy under management.',
      'external.detailTitle': 'External MCP server',
      'external.loading': 'Loading details…',
      'external.unavailable': 'Details are unavailable for this row.',
      'external.takeOver': 'Take under management',
      'external.adoptTitle': 'Take {name} under management?',
      'external.adoptStep1':
        'A validated copy of this configuration is created in MCP Guard and saved disabled.',
      'external.adoptStep2':
        'The original profile row is disabled through the official DSH plugin manager, which frees the name.',
      'external.adoptStep3': 'If saving the copy fails, the original row is enabled again.',
      'external.adoptOk':
        '{name} is now managed by MCP Guard and saved disabled. Review it and enable it when ready.',
      'external.patchId': 'Profile entry',
      'external.toolsEmpty': 'No registered tools for this row.',
      'external.openAria': 'Inspect external server {name}',
      'external.lockHint': 'Read-only: this row is owned by another plugin or the profile patch.',
      'discover.menu': 'Find MCP configs…',
      'discover.title': 'Find MCP configs',
      'discover.hint':
        'Scans known MCP configuration files on this computer. Nothing runs during the scan; selected servers are imported disabled.',
      'discover.loading': 'Scanning configuration files…',
      'discover.rescan': 'Scan again',
      'discover.empty': 'No MCP configs found.',
      'discover.emptyHint':
        'Checked known locations for Cursor, Claude Code, Claude Desktop, VS Code, DSH and project configs.',
      'discover.sourceError': 'Source error: {code}',
      'discover.alreadyManaged': 'Already managed',
      'discover.alreadyExternal': 'Provided by another plugin',
      'discover.needsPlainHttp': 'Plaintext HTTP will be allowed',
      'discover.unsupported': 'Cannot import: {code}',
      'discover.selectAll': 'Select all in this source',
      'discover.selected': 'Selected: {count}',
      'discover.importSelected': 'Import selected (disabled)',
      'discover.importing': 'Importing…',
      'discover.importSummary': '{imported} imported disabled, {skipped} skipped.',
      'discover.importSkipped': 'Skipped: {list}',
      'discover.importNothing': 'Nothing was imported. Skipped: {list}',
      'discover.noSelection': 'Select at least one server to import.',
      'discover.scope': 'Project scope: {scope}',
      'discover.loadFailed': 'Discovery failed.',
      'status.enabled': 'Enabled',
      'status.disabled': 'Disabled',
      'transport.stdio': 'stdio',
      'transport.http': 'streamable-http',
      'transport.stdioLong': 'stdio (local command)',
      'transport.httpLong': 'Streamable HTTP',
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
      'form.newTitle': 'New MCP server',
      'form.subtitleCreate': 'Fill in the new MCP configuration, then save to return to the list.',
      'form.subtitleEdit': 'Update the MCP configuration, then save to return to the list.',
      'form.back': 'Back to list',
      'form.name': 'Name',
      'form.nameHint': 'Letters, digits, _ and - only; 1–32 characters.',
      'form.namePlaceholder': 'my-mcp-server',
      'form.nameLocked': 'The server name cannot be changed after creation.',
      'form.type': 'Type',
      'form.typeStdio': 'stdio (local command)',
      'form.typeHttp': 'Streamable HTTP',
      'form.timeout': 'Timeout MS',
      'form.timeoutPlaceholder': '60000',
      'form.timeoutHint': 'Per-call timeout, 1000–600000 ms.',
      'form.protocol': 'Protocol version',
      'form.protocolAuto': 'Auto (recommended)',
      'form.command': 'Command',
      'form.commandPlaceholder': 'npx',
      'form.commandHint': 'Executable or path; it is spawned directly, without a shell.',
      'form.args': 'Arguments',
      'form.argsLabel': 'Arguments (space separated)',
      'form.argsPlaceholder': '-y @modelcontextprotocol/server-memory',
      'form.argsHint':
        'Space- or newline-separated. Single and double quotes group one argument; nothing is evaluated.',
      'form.cwd': 'Working directory',
      'form.cwdHint': 'Optional absolute path.',
      'form.url': 'URL',
      'form.urlHint': 'Full URL including path, for example https://host.example/mcp.',
      'form.env': 'Environment variables',
      'form.envOptional': 'Environment variables (optional)',
      'form.headers': 'Headers',
      'form.headersOptional': 'Headers (optional)',
      'form.envJsonHint':
        'Stored values are never shown. Leave an existing key empty to keep its value, set a value to replace it, or remove the key to delete it.',
      'form.envJsonInvalid': 'Environment variables must be a JSON object with string values.',
      'form.headersJsonInvalid': 'Headers must be a JSON object with string values.',
      'form.envPlaceholder': '{\n  "MY_API_KEY": "your-key"\n}',
      'form.headersPlaceholder': '{\n  "Authorization": "Bearer …"\n}',
      'form.fullConfiguration': 'Full configuration',
      'form.tabForm': 'Form',
      'form.tabJson': 'JSON',
      'form.tabsLabel': 'Configuration editor',
      'form.jsonHint':
        'Editable configuration for this draft. Stored secrets appear blank; advanced options stay on the Form tab.',
      'form.jsonHintLong':
        'You can paste {"server-name": {...}} or {"mcpServers": {"server-name": {...}}}.',
      'form.jsonInvalid': 'Invalid JSON.',
      'form.jsonShape': 'Expected a single server configuration object.',
      'form.jsonUnknownField': 'Unsupported field in the JSON configuration.',
      'form.clearSecrets': 'Stored secret values will be deleted for: {keys}',
      'form.clearAck': 'I understand these stored values will be deleted.',
      'form.saveDisabled': 'Save becomes available when the draft passes validation.',
      'form.save': 'Save',
      'form.cancel': 'Cancel',
      'form.required': 'Required',
      'form.advanced': 'Advanced',
      'form.reconnectEnabled': 'Reconnect automatically',
      'form.reconnectAttempts': 'Max reconnect attempts',
      'form.failOnStartupError': 'Fail on startup error',
      'form.maxInstructionBytes': 'Max instruction bytes',
      'form.allowPlainHttp': 'Allow plaintext HTTP to a non-loopback host',
      'form.allowPlainHttpWarning':
        'Only enable this for a trusted host you control: the connection will be unencrypted.',
      'form.analysis': 'Analysis',
      'form.analysisValid': 'Configuration is valid.',
      'form.editNotice':
        'For security, the stored command, arguments, URL and secret values are not returned by this Host version. Re-enter the command and arguments (or the URL) completely; secret values are kept by key when their value is left empty.',
      'analyze.pending': 'Validating…',
      'analyze.valid': 'Configuration is valid.',
      'analyze.problems': 'Validation problems',
      'analyze.noFindings': 'No risk findings.',
      'analyze.blocked': 'This configuration is blocked and cannot be saved or enabled.',
      'analyze.argv': 'Command that will run (no shell):',
      'analyze.endpoint': 'Endpoint:',
      'analyze.risks': 'Risk findings',
      'analyze.secretsNote': 'Secret values are never displayed; empty stored values are kept.',
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
      'audit.action.adopt': 'Taken over',
      'audit.result.ok': 'ok',
      'audit.result.error': 'error',
      'a11y.enable': 'Enable server {name}',
      'a11y.disable': 'Disable server {name}',
      'a11y.edit': 'Edit server {name}',
      'a11y.delete': 'Delete server {name}',
      'a11y.check': 'Check server {name}',
      'a11y.refresh': 'Refresh server list',
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
      'a11y.openServer': 'Open server {name}',
      'a11y.rowMenu': 'Actions for {name}',
      'a11y.newServer': 'Add MCP server',
      'a11y.importServers': 'Import MCP servers',
      'a11y.exportServers': 'Export MCP servers',
      'a11y.scopePill': 'Scope selector',
      'a11y.selectIcon': 'Select',
      'a11y.externalRow': 'Inspect external server {name}',
      'a11y.takeOver': 'Take server {name} under management',
      'a11y.discover': 'Find MCP configs',
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
      'error.EXTERNAL_UNAVAILABLE': 'This MCP row cannot be inspected or toggled through the official plugin manager.',
      'error.EXTERNAL_DISABLE_FAILED': 'The original profile row could not be disabled through the official plugin manager.',
      'error.ADOPT_FAILED': 'Taking the row under management failed.',
      'error.ADOPT_ROLLBACK_FAILED':
        'Taking the row under management failed and the original row could not be re-enabled. Check the profile manually.',
      'error.DISCOVERY_UNAVAILABLE': 'MCP config discovery is unavailable in this deployment.',
      'error.SOURCE_NOT_FOUND': 'The configuration source disappeared. Scan again.',
      'error.SOURCE_TOO_LARGE': 'The configuration file is too large to scan.',
      'error.SOURCE_UNREADABLE': 'The configuration file cannot be read.',
      'error.SOURCE_INVALID_JSON': 'The configuration file is not valid JSON.',
      'error.SOURCE_INVALID_ENTRY': 'A server entry in this source is invalid.',
    };

    const DICT_RU = {
      'nav.label': 'MCP-серверы',
      'page.intro': 'Просматривайте, включайте и отслеживайте MCP-серверы, которыми управляет этот плагин.',
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
      'action.copy': 'Копировать',
      'action.close': 'Закрыть',
      'action.edit': 'Изменить',
      'action.delete': 'Удалить',
      'list.search': 'Поиск MCP-серверов…',
      'list.searchAria': 'Поиск MCP-серверов',
      'list.scope': 'Этот компьютер · Пользователь',
      'list.scopeUser': 'Этот компьютер: Пользователь',
      'list.scopeProjects': 'Проекты',
      'list.scopeComingSoon': 'Скоро',
      'list.scopeAria': 'Сменить область',
      'list.scopeLabel': 'Область',
      'list.mcp': 'MCP',
      'list.installed': 'Установленные',
      'list.externalHint': 'Предоставлен другим плагином или ручной записью профиля — только чтение.',
      'list.noResults': 'Нет MCP-серверов, соответствующих поиску.',
      'list.new': 'Новый',
      'list.more': 'Ещё действия',
      'list.importMenu': 'Импорт…',
      'list.exportMenu': 'Экспорт…',
      'list.riskBadge': 'Риск: {level}',
      'list.secretsBadge': 'Содержит значения секретов',
      'list.statusAria': 'Статус: {status}',
      'list.tools': 'Инструментов: {count}',
      'list.auditTitle': 'Журнал аудита',

      'external.source': 'Источник',
      'external.sourceLabel': 'Объявлен в профиле DSH другим плагином или вручную.',
      'external.notOwned':
        'MCP Guard не управляет этой записью. Здесь её можно изучить или взять под управление проверенную копию.',
      'external.detailTitle': 'Внешний MCP-сервер',
      'external.loading': 'Загрузка сведений…',
      'external.unavailable': 'Сведения об этой записи недоступны.',
      'external.takeOver': 'Взять под управление',
      'external.adoptTitle': 'Взять {name} под управление?',
      'external.adoptStep1':
        'Проверенная копия этой конфигурации создаётся в MCP Guard и сохраняется отключённой.',
      'external.adoptStep2':
        'Исходная запись профиля отключается через официальный менеджер плагинов DSH — имя освобождается.',
      'external.adoptStep3': 'Если сохранить копию не удастся, исходная запись будет снова включена.',
      'external.adoptOk':
        'Сервер {name} теперь управляется MCP Guard и сохранён отключённым. Проверьте его и включите, когда будете готовы.',
      'external.patchId': 'Запись профиля',
      'external.toolsEmpty': 'Зарегистрированных инструментов нет.',
      'external.openAria': 'Открыть сведения о внешнем сервере {name}',
      'external.lockHint': 'Только чтение: запись принадлежит другому плагину или патчу профиля.',
      'discover.menu': 'Найти MCP-конфиги…',
      'discover.title': 'Найти MCP-конфиги',
      'discover.hint':
        'Сканирует известные файлы конфигурации MCP на этом компьютере. Во время сканирования ничего не запускается; выбранные серверы импортируются отключёнными.',
      'discover.loading': 'Сканирование файлов конфигурации…',
      'discover.rescan': 'Сканировать снова',
      'discover.empty': 'Конфиги не найдены.',
      'discover.emptyHint':
        'Проверены известные места: Cursor, Claude Code, Claude Desktop, VS Code, DSH и конфигурации проектов.',
      'discover.sourceError': 'Ошибка источника: {code}',
      'discover.alreadyManaged': 'Уже управляется',
      'discover.alreadyExternal': 'Предоставлен другим плагином',
      'discover.needsPlainHttp': 'Plaintext HTTP будет разрешён',
      'discover.unsupported': 'Импорт невозможен: {code}',
      'discover.selectAll': 'Выбрать всё в этом источнике',
      'discover.selected': 'Выбрано: {count}',
      'discover.importSelected': 'Импортировать выбранные (выключены)',
      'discover.importing': 'Импорт…',
      'discover.importSummary': 'Импортировано отключёнными: {imported}, пропущено: {skipped}.',
      'discover.importSkipped': 'Пропущено: {list}',
      'discover.importNothing': 'Ничего не импортировано. Пропущено: {list}',
      'discover.noSelection': 'Выберите хотя бы один сервер для импорта.',
      'discover.scope': 'Область проекта: {scope}',
      'discover.loadFailed': 'Поиск не удался.',
      'status.enabled': 'Включён',
      'status.disabled': 'Отключён',
      'transport.stdio': 'stdio',
      'transport.http': 'streamable-http',
      'transport.stdioLong': 'stdio (локальная команда)',
      'transport.httpLong': 'Streamable HTTP',
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
      'form.newTitle': 'Новый MCP-сервер',
      'form.subtitleCreate': 'Заполните конфигурацию нового MCP-сервера и сохраните, чтобы вернуться к списку.',
      'form.subtitleEdit': 'Обновите конфигурацию MCP-сервера и сохраните, чтобы вернуться к списку.',
      'form.back': 'Назад к списку',
      'form.name': 'Имя',
      'form.nameHint': 'Только латинские буквы, цифры, _ и -; 1–32 символа.',
      'form.namePlaceholder': 'my-mcp-server',
      'form.nameLocked': 'Имя сервера нельзя изменить после создания.',
      'form.type': 'Тип',
      'form.typeStdio': 'stdio (локальная команда)',
      'form.typeHttp': 'Streamable HTTP',
      'form.timeout': 'Таймаут, мс',
      'form.timeoutPlaceholder': '60000',
      'form.timeoutHint': 'Таймаут вызова, 1000–600000 мс.',
      'form.protocol': 'Версия протокола',
      'form.protocolAuto': 'Авто (рекомендуется)',
      'form.command': 'Команда',
      'form.commandPlaceholder': 'npx',
      'form.commandHint': 'Исполняемый файл или путь; запускается напрямую, без shell.',
      'form.args': 'Аргументы',
      'form.argsLabel': 'Аргументы (через пробел)',
      'form.argsPlaceholder': '-y @modelcontextprotocol/server-memory',
      'form.argsHint':
        'Разделяются пробелом или переводом строки. Одинарные и двойные кавычки группируют один аргумент; ничего не вычисляется.',
      'form.cwd': 'Рабочий каталог',
      'form.cwdHint': 'Необязательный абсолютный путь.',
      'form.url': 'URL',
      'form.urlHint': 'Полный URL, включая путь, например https://host.example/mcp.',
      'form.env': 'Переменные окружения',
      'form.envOptional': 'Переменные окружения (необязательно)',
      'form.headers': 'Заголовки',
      'form.headersOptional': 'Заголовки (необязательно)',
      'form.envJsonHint':
        'Сохранённые значения не показываются. Оставьте существующий ключ пустым, чтобы сохранить значение, задайте значение для замены или удалите ключ, чтобы удалить его.',
      'form.envJsonInvalid': 'Переменные окружения должны быть JSON-объектом со строковыми значениями.',
      'form.headersJsonInvalid': 'Заголовки должны быть JSON-объектом со строковыми значениями.',
      'form.envPlaceholder': '{\n  "MY_API_KEY": "your-key"\n}',
      'form.headersPlaceholder': '{\n  "Authorization": "Bearer …"\n}',
      'form.fullConfiguration': 'Полная конфигурация',
      'form.tabForm': 'Форма',
      'form.tabJson': 'JSON',
      'form.tabsLabel': 'Редактор конфигурации',
      'form.jsonHint':
        'Редактируемая конфигурация черновика. Сохранённые секреты показаны пустыми; дополнительные параметры остаются на вкладке «Форма».',
      'form.jsonHintLong':
        'Можно вставить {"server-name": {...}} или {"mcpServers": {"server-name": {...}}}.',
      'form.jsonInvalid': 'Некорректный JSON.',
      'form.jsonShape': 'Ожидается объект конфигурации одного сервера.',
      'form.jsonUnknownField': 'Неподдерживаемое поле в JSON-конфигурации.',
      'form.clearSecrets': 'Сохранённые значения секретов будут удалены для ключей: {keys}',
      'form.clearAck': 'Я понимаю, что эти сохранённые значения будут удалены.',
      'form.saveDisabled': 'Сохранение станет доступно, когда черновик пройдёт проверку.',
      'form.save': 'Сохранить',
      'form.cancel': 'Отмена',
      'form.required': 'Обязательно',
      'form.advanced': 'Дополнительно',
      'form.reconnectEnabled': 'Переподключаться автоматически',
      'form.reconnectAttempts': 'Максимум попыток переподключения',
      'form.failOnStartupError': 'Прерывать при ошибке запуска',
      'form.maxInstructionBytes': 'Максимум байт инструкций',
      'form.allowPlainHttp': 'Разрешить plaintext HTTP не на loopback',
      'form.allowPlainHttpWarning':
        'Включайте только для доверенного хоста под вашим контролем: соединение будет незашифрованным.',
      'form.analysis': 'Проверка',
      'form.analysisValid': 'Конфигурация корректна.',
      'form.editNotice':
        'В целях безопасности эта версия Host не возвращает сохранённые команду, аргументы, URL и значения секретов. Введите команду и аргументы (или URL) полностью заново; значения секретов сохраняются по ключам, если поле значения оставить пустым.',
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
      'audit.action.adopt': 'Взят под управление',
      'audit.result.ok': 'успешно',
      'audit.result.error': 'ошибка',
      'a11y.enable': 'Включить сервер {name}',
      'a11y.disable': 'Отключить сервер {name}',
      'a11y.edit': 'Изменить сервер {name}',
      'a11y.delete': 'Удалить сервер {name}',
      'a11y.check': 'Проверить сервер {name}',
      'a11y.refresh': 'Обновить список серверов',
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
      'a11y.openServer': 'Открыть сервер {name}',
      'a11y.rowMenu': 'Действия для {name}',
      'a11y.newServer': 'Добавить MCP-сервер',
      'a11y.importServers': 'Импорт MCP-серверов',
      'a11y.exportServers': 'Экспорт MCP-серверов',
      'a11y.scopePill': 'Выбор области',
      'a11y.selectIcon': 'Выбрать',
      'a11y.externalRow': 'Открыть сведения о внешнем сервере {name}',
      'a11y.takeOver': 'Взять сервер {name} под управление',
      'a11y.discover': 'Найти MCP-конфиги',
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
      'error.EXTERNAL_UNAVAILABLE': 'Эту запись MCP нельзя изучить или переключить через официальный менеджер плагинов.',
      'error.EXTERNAL_DISABLE_FAILED':
        'Не удалось отключить исходную запись профиля через официальный менеджер плагинов.',
      'error.ADOPT_FAILED': 'Не удалось взять запись под управление.',
      'error.ADOPT_ROLLBACK_FAILED':
        'Не удалось взять запись под управление, и исходную запись не удалось включить обратно. Проверьте профиль вручную.',
      'error.DISCOVERY_UNAVAILABLE': 'Поиск MCP-конфигов недоступен в этом развёртывании.',
      'error.SOURCE_NOT_FOUND': 'Источник конфигурации исчез. Запустите поиск снова.',
      'error.SOURCE_TOO_LARGE': 'Файл конфигурации слишком велик для сканирования.',
      'error.SOURCE_UNREADABLE': 'Не удалось прочитать файл конфигурации.',
      'error.SOURCE_INVALID_JSON': 'Файл конфигурации не является корректным JSON.',
      'error.SOURCE_INVALID_ENTRY': 'Запись сервера в этом источнике некорректна.',
    };

    const DICTS = { en: DICT_EN, ru: DICT_RU };

    /* ------------------------------------------------------------------ */
    /* Styles (single <style data-plugin="dsh-mcp-guard">)                 */
    /* ------------------------------------------------------------------ */

    const STYLES = `
.mcpg-page{box-sizing:border-box;display:flex;flex-direction:column;gap:18px;width:100%;max-width:960px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.mcpg-page-title{margin:0;font-size:28px;font-weight:600;line-height:36px;letter-spacing:-.01em}
.mcpg-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-width:0}
.mcpg-grow{flex:1 1 auto}
.mcpg-scope-wrap{position:relative;display:inline-flex}
.mcpg-scope-pill{box-sizing:border-box;display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;white-space:nowrap}
.mcpg-scope-pill:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.mcpg-scope-pill:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.mcpg-scope-pill:disabled{cursor:default;opacity:.5}
.mcpg-scope-text{overflow:hidden;text-overflow:ellipsis}
.mcpg-scope-chevron{flex:none;color:var(--dsw-alias-label-tertiary)}
.mcpg-toolbar-divider{flex:none;width:1px;height:20px;background:var(--dsw-alias-border-l3);border-radius:1px}
.mcpg-mcp-count{display:inline-flex;align-items:baseline;gap:6px;font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}
.mcpg-mcp-count b{font-weight:600}
.mcpg-mcp-count span{color:var(--dsw-alias-label-tertiary);font-size:13px}
.mcpg-search{position:relative;flex:0 1 260px;min-width:150px;margin-left:auto}
.mcpg-search-icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--dsw-alias-label-tertiary);pointer-events:none;display:flex}
.mcpg-search-input{box-sizing:border-box;width:100%;height:40px;padding:0 12px 0 36px;border:.5px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.mcpg-search-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.mcpg-search-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.mcpg-group-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0;margin-top:2px}
.mcpg-group-title{margin:0;display:inline-flex;align-items:baseline;gap:8px;font-size:15px;font-weight:600;line-height:22px}
.mcpg-group-count{color:var(--dsw-alias-label-tertiary);font-weight:500;font-size:13px}
.mcpg-group-actions{display:inline-flex;align-items:center;gap:8px;margin-left:auto;flex:none}
.mcpg-icon-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.mcpg-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mcpg-icon-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.mcpg-icon-btn:disabled{opacity:.4;cursor:not-allowed}
.mcpg-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.mcpg-group{box-sizing:border-box;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:12px;background:var(--dsw-alias-settings-card-fill)}
.mcpg-group>.mcpg-row:first-child{border-top-left-radius:11px;border-top-right-radius:11px}
.mcpg-group>.mcpg-row:last-child{border-bottom-left-radius:11px;border-bottom-right-radius:11px}
.mcpg-group-hint{margin:0;padding:0 2px;color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:18px}
.mcpg-row{display:flex;align-items:center;gap:12px;min-height:74px;padding:10px 14px;background:transparent}
.mcpg-row+.mcpg-row{border-top:.5px solid var(--dsw-alias-border-l2)}
.mcpg-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mcpg-row-main{box-sizing:border-box;display:flex;align-items:center;gap:12px;min-width:0;flex:1 1 auto;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:8px}
.mcpg-row-main:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:4px}
.mcpg-row-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.mcpg-row-text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.mcpg-row-name{display:flex;align-items:center;gap:6px;min-width:0;font-size:15px;font-weight:600;line-height:20px}
.mcpg-row-name-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mcpg-row-sub{display:flex;align-items:center;gap:6px;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:18px}
.mcpg-row-sub-text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.mcpg-row-sub-note{color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mcpg-row-end{display:flex;align-items:center;gap:8px;flex:none}
.mcpg-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
.mcpg-dot[data-on="false"]{background:var(--dsw-alias-border-l3)}
.mcpg-dot[data-warn="true"]{background:var(--dsw-alias-state-warn-primary)}
.mcpg-mark{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;opacity:.9}
.mcpg-mark-risk[data-level="critical"],.mcpg-mark-risk[data-level="high"]{color:var(--dsw-alias-state-error-primary)}
.mcpg-mark-risk[data-level="medium"]{color:var(--dsw-alias-state-warn-primary)}
.mcpg-mark-risk[data-level="low"],.mcpg-mark-risk[data-level="info"]{color:var(--dsw-alias-state-business-primary)}
.mcpg-mark-secret{color:var(--dsw-alias-label-tertiary)}
.mcpg-tools-note{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px;white-space:nowrap}
.mcpg-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:44px;height:26px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}
.mcpg-switch[aria-checked="true"]{background:var(--dsw-alias-button-primary-fill)}
.mcpg-switch:disabled{cursor:default;opacity:.5}
.mcpg-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.mcpg-switch-thumb{display:block;width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-switch-thumb);transition:transform .14s ease}
.mcpg-switch[aria-checked="true"] .mcpg-switch-thumb{background:var(--dsw-alias-label-primary-foreground);transform:translate(18px)}
.mcpg-menu-wrap{position:relative;display:inline-flex}
.mcpg-menu{position:absolute;z-index:40;top:calc(100% + 6px);right:0;min-width:190px;box-sizing:border-box;padding:6px;display:flex;flex-direction:column;gap:2px;border:.5px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 10px 30px color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent)}
.mcpg-menu[data-align="left"]{left:0;right:auto}
.mcpg-menu-label{padding:6px 10px 2px;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px}
.mcpg-menu-item{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.mcpg-menu-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.mcpg-menu-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.mcpg-menu-item:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.mcpg-menu-item-danger{color:var(--dsw-alias-state-error-primary)}
.mcpg-menu-item-icon{display:inline-flex;flex:none;color:var(--dsw-alias-label-tertiary)}
.mcpg-menu-item-check{margin-left:auto;display:inline-flex;color:var(--dsw-alias-label-primary)}
.mcpg-menu-note{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px}
.mcpg-empty-state{box-sizing:border-box;padding:32px 16px;border:.5px dashed var(--dsw-alias-border-l3);border-radius:12px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.mcpg-audit{border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:12px;background:var(--dsw-alias-settings-card-fill);overflow:hidden}
.mcpg-audit>summary{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;list-style:none;cursor:pointer;font-size:14px;font-weight:500;line-height:20px}
.mcpg-audit>summary::-webkit-details-marker{display:none}
.mcpg-audit>summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.mcpg-audit-chevron{margin-left:auto;display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}
.mcpg-audit[open]>summary .mcpg-audit-chevron{transform:rotate(180deg)}
.mcpg-auditlist{display:flex;flex-direction:column;margin:0;padding:0 14px 10px;list-style:none}
.mcpg-auditrow{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;padding:7px 0;border-top:.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px}
.mcpg-audittime{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.mcpg-auditserver{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.mcpg-banner{box-sizing:border-box;display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;font-size:13px;line-height:20px}
.mcpg-banner-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.mcpg-banner-detail{color:var(--dsw-alias-label-tertiary);font-size:12px}
.mcpg-banner-actions{display:flex;align-items:center;gap:6px;flex:none}
.mcpg-banner-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.mcpg-banner-warning{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary)}
.mcpg-banner-info{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.mcpg-banner-success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}
.mcpg-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 16px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;white-space:nowrap;text-decoration:none}
.mcpg-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.mcpg-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.mcpg-btn:disabled{opacity:.4;cursor:not-allowed}
.mcpg-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.mcpg-btn-outline{box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l3)}
.mcpg-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.mcpg-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.mcpg-btn-ghost{color:var(--dsw-alias-label-secondary)}
.mcpg-btn-ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.mcpg-btn-danger{color:var(--dsw-alias-state-error-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l3)}
.mcpg-btn-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.mcpg-btn-sm{height:30px;padding:0 12px;font-size:12px;line-height:18px;border-radius:7px}
.mcpg-breadcrumbs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;font-size:13px;line-height:20px}
.mcpg-crumb{background:none;border:0;padding:0;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.mcpg-crumb:hover{color:var(--dsw-alias-label-primary)}
.mcpg-crumb:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:4px}
.mcpg-crumb-sep{display:inline-flex;color:var(--dsw-alias-label-tertiary)}
.mcpg-crumb-current{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.mcpg-form-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.mcpg-form-titles{display:flex;flex-direction:column;gap:4px;min-width:0}
.mcpg-form-title{margin:0;font-size:24px;font-weight:600;line-height:32px}
.mcpg-form-subtitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:20px}
.mcpg-tabs{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);flex:none}
.mcpg-tab{height:30px;padding:0 16px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.mcpg-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500;box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent)}
.mcpg-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.mcpg-card{box-sizing:border-box;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:12px;background:var(--dsw-alias-settings-card-fill);padding:20px}
.mcpg-form-card{display:flex;flex-direction:column;gap:16px}
.mcpg-form-fields{display:flex;flex-direction:column;gap:14px;min-width:0}
.mcpg-field-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;min-width:0}
.mcpg-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.mcpg-field-grow{flex:1 1 240px}
.mcpg-field-narrow{max-width:320px}
.mcpg-label{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px}
.mcpg-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.mcpg-invalid{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.mcpg-input,.mcpg-select,.mcpg-textarea{box-sizing:border-box;width:100%;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px}
.mcpg-input,.mcpg-select{height:40px;padding:0 12px}
.mcpg-input::placeholder,.mcpg-textarea::placeholder{color:var(--dsw-alias-label-tertiary)}
.mcpg-input:focus-visible,.mcpg-textarea:focus-visible,.mcpg-select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.mcpg-input[aria-invalid="true"],.mcpg-textarea[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.mcpg-input:disabled,.mcpg-select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.mcpg-textarea{padding:10px 12px;min-height:76px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:18px}
.mcpg-select-wrap{position:relative;display:block}
.mcpg-select{appearance:none;padding-right:34px;cursor:pointer}
.mcpg-select-chevron{position:absolute;right:13px;top:50%;width:7px;height:7px;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transform:translateY(-70%) rotate(45deg);pointer-events:none}
.mcpg-scope-inline{display:inline-flex;align-items:center;gap:8px;flex:none}
.mcpg-scope-label{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.mcpg-details{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.mcpg-details>summary{display:flex;align-items:center;gap:8px;min-height:42px;padding:0 14px;list-style:none;cursor:pointer;color:var(--dsw-alias-label-primary);font-size:13.5px;font-weight:500;line-height:20px}
.mcpg-details>summary::-webkit-details-marker{display:none}
.mcpg-details>summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.mcpg-details-chevron{margin-left:auto;display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}
.mcpg-details[open]>summary .mcpg-details-chevron{transform:rotate(180deg)}
.mcpg-details-body{display:flex;flex-direction:column;gap:12px;padding:0 14px 14px}
.mcpg-status-tag{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;border:.5px solid transparent;box-sizing:border-box}
.mcpg-status-tag[data-tone="neutral"]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.mcpg-status-tag[data-tone="quiet"]{color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l3)}
.mcpg-status-tag[data-tone="success"]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}
.mcpg-status-tag[data-tone="warning"]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-primary)}
.mcpg-status-tag[data-tone="danger"]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.mcpg-status-tag[data-tone="info"]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary)}
.mcpg-risks{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.mcpg-risk{display:flex;align-items:flex-start;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.mcpg-risk-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.mcpg-risk-params{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;overflow-wrap:anywhere}
.mcpg-preview{display:flex;flex-direction:column;gap:6px;min-width:0}
.mcpg-preview-label{display:flex;align-items:center;gap:8px;margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}
.mcpg-code{margin:0;padding:9px 11px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;max-height:220px}
.mcpg-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.mcpg-chip{padding:1px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;overflow-wrap:anywhere}
.mcpg-form-footer{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding-top:2px}
.mcpg-analysis-summary-state{margin-left:auto;display:inline-flex;align-items:center;gap:8px}
.mcpg-modal-root{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:24px}
.mcpg-modal-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:blur(2px)}
.mcpg-modal{position:relative;z-index:1;box-sizing:border-box;display:flex;flex-direction:column;width:min(600px,100%);max-height:min(760px,calc(100vh - 48px));overflow:hidden;border:.5px solid var(--dsw-alias-border-l3);border-radius:16px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 12px 40px color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent)}
.mcpg-modal:focus{outline:none}
.mcpg-modal-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:20px 16px 10px 22px}
.mcpg-modal-title{margin:0;color:var(--dsw-alias-label-primary);font-size:18px;font-weight:600;line-height:26px}
.mcpg-modal-body{display:flex;flex-direction:column;gap:12px;min-height:0;padding:0 22px;overflow-y:auto;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.mcpg-modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:16px 22px 20px}
.mcpg-check{display:inline-flex;align-items:flex-start;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer}
.mcpg-check input{flex:0 0 auto;width:16px;height:16px;margin:2px 0 0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.mcpg-check input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.mcpg-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.mcpg-mini-row{display:flex;align-items:center;gap:10px;min-width:0}
.mcpg-mini-main{display:flex;flex-direction:column;gap:2px;min-width:0}
.mcpg-mini-name{font-size:13px;font-weight:600;line-height:18px;overflow-wrap:anywhere}
.mcpg-mini-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
@media (max-width:620px){.mcpg-page-title{font-size:24px;line-height:32px}.mcpg-form-title{font-size:22px;line-height:30px}.mcpg-field-narrow{max-width:none}.mcpg-search{flex:1 1 100%;margin-left:0}.mcpg-card{padding:16px}.mcpg-row{padding:10px 12px}}
.mcpg-modal-wide{width:min(760px,100%)}
.mcpg-menu-sep{height:1px;margin:4px 2px;background:var(--dsw-alias-border-l2);border:0}
.mcpg-external-link{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;color:var(--dsw-alias-label-tertiary);flex:none}
.mcpg-detail{display:flex;flex-direction:column;gap:12px;min-width:0}
.mcpg-detail-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.mcpg-detail-name{margin:0;font-size:16px;font-weight:600;line-height:24px;overflow-wrap:anywhere}
.mcpg-facts{display:flex;flex-direction:column;gap:8px;margin:0}
.mcpg-fact{display:flex;align-items:baseline;gap:10px;min-width:0}
.mcpg-fact-label{flex:0 0 132px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.mcpg-fact-value{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.mcpg-fact-value code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.mcpg-steps{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.mcpg-steps li{padding-left:2px}
.mcpg-source{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:visible}
.mcpg-source>summary{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:42px;padding:6px 14px;list-style:none;cursor:pointer;color:var(--dsw-alias-label-primary);font-size:13.5px;font-weight:500;line-height:20px}
.mcpg-source>summary::-webkit-details-marker{display:none}
.mcpg-source>summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.mcpg-source-chevron{margin-left:auto;display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}
.mcpg-source[open]>summary .mcpg-source-chevron{transform:rotate(180deg)}
.mcpg-source-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px;overflow-wrap:anywhere}
.mcpg-source-body{display:flex;flex-direction:column;gap:8px;padding:0 14px 12px}
.mcpg-pick-row{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-top:.5px solid var(--dsw-alias-border-l2);min-width:0}
.mcpg-pick-row:first-of-type{border-top:0}
.mcpg-pick-row[data-disabled="true"]{opacity:.62}
.mcpg-pick-box{flex:none;display:inline-flex;margin-top:2px}
.mcpg-pick-box input{width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.mcpg-pick-box input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.mcpg-pick-box input:disabled{cursor:default}
.mcpg-pick-main{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto}
.mcpg-pick-name{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px;font-weight:600;line-height:18px;overflow-wrap:anywhere}
.mcpg-pick-meta{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px;overflow-wrap:anywhere}
.mcpg-pick-badges{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.mcpg-selectbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.mcpg-selectbar .mcpg-hint{margin:0}
.mcpg-selectbar-actions{display:inline-flex;align-items:center;gap:8px;margin-left:auto;flex:none}
.mcpg-discover-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.mcpg-tools-grid{display:flex;flex-direction:column;gap:8px;min-width:0}
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
    /* Icons (currentColor only; no literal colors)                        */
    /* ------------------------------------------------------------------ */

    function SvgBase({ size, children, viewBox }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: viewBox || '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        children,
      );
    }

    function MonitorIcon({ size = 14 }) {
      return h(
        SvgBase,
        { size },
        h('rect', { x: 3, y: 4, width: 18, height: 13, rx: 2, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M8 21h8M12 17v4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      );
    }

    function SearchIcon({ size = 16 }) {
      return h(
        SvgBase,
        { size },
        h('circle', { cx: 11, cy: 11, r: 7, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'm20 20-3.6-3.6', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      );
    }

    function RefreshIcon({ size = 16 }) {
      return h(
        SvgBase,
        { size },
        h('path', {
          d: 'M20 12a8 8 0 1 1-2.35-5.65M20 4v6h-6',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    function PlugIcon({ size = 18 }) {
      return h(
        SvgBase,
        { size },
        h('path', {
          d: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    function GlobeIcon({ size = 18 }) {
      return h(
        SvgBase,
        { size },
        h('circle', { cx: 12, cy: 12, r: 8, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('ellipse', { cx: 12, cy: 12, rx: 3.5, ry: 8, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M4 9h16M4 15h16', stroke: 'currentColor', strokeWidth: 1.5 }),
      );
    }

    function LockIcon({ size = 16 }) {
      return h(
        SvgBase,
        { size },
        h('rect', { x: 5, y: 10, width: 14, height: 10, rx: 2, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M8 10V7a4 4 0 0 1 8 0v3', stroke: 'currentColor', strokeWidth: 1.5 }),
      );
    }

    function ShieldIcon({ size = 13 }) {
      return h(
        SvgBase,
        { size },
        h('path', {
          d: 'M12 3 19 6v5c0 4-2.8 7.2-7 9-4.2-1.8-7-5-7-9V6l7-3Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
      );
    }

    function KeyIcon({ size = 13 }) {
      return h(
        SvgBase,
        { size },
        h('circle', { cx: 8, cy: 15, r: 4, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'm11 12 8-8M17 4h3v3', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      );
    }

    function FolderIcon({ size = 15 }) {
      return h(
        SvgBase,
        { size },
        h('path', {
          d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
          stroke: 'currentColor',
          strokeWidth: 1.5,
        }),
      );
    }

    function UserIcon({ size = 15 }) {
      return h(
        SvgBase,
        { size },
        h('circle', { cx: 12, cy: 9, r: 3.5, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M5.5 20a6.5 6.5 0 0 1 13 0', stroke: 'currentColor', strokeWidth: 1.5 }),
      );
    }

    function CheckIcon({ size = 14 }) {
      return h(
        SvgBase,
        { size },
        h('path', { d: 'm5 12 4 4L19 6', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    function PlusIcon({ size = 14 }) {
      return h(
        SvgBase,
        { size },
        h('path', { d: 'M12 5v14M5 12h14', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
      );
    }

    function ChevronDownIcon({ size = 12 }) {
      return h(
        SvgBase,
        { size },
        h('path', { d: 'm6 9 6 6 6-6', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    function ChevronRightIcon({ size = 12 }) {
      return h(
        SvgBase,
        { size },
        h('path', { d: 'm9 6 6 6-6 6', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    function EllipsisIcon({ size = 16 }) {
      return h(
        SvgBase,
        { size },
        h('circle', { cx: 5, cy: 12, r: 1.7, fill: 'currentColor' }),
        h('circle', { cx: 12, cy: 12, r: 1.7, fill: 'currentColor' }),
        h('circle', { cx: 19, cy: 12, r: 1.7, fill: 'currentColor' }),
      );
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
      else if (variant === 'ghost') classes.push('mcpg-btn-ghost');
      if (size === 'sm') classes.push('mcpg-btn-sm');
      if (className) classes.push(className);
      const elementProps = { ...rest };
      elementProps.className = classes.join(' ');
      if (!elementProps.type) elementProps.type = 'button';
      return h('button', elementProps, children);
    }

    function Tag({ tone, children, title }) {
      return h('span', { className: 'mcpg-status-tag', 'data-tone': tone || 'neutral', title }, children);
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
          onClick: (event) => {
            event.stopPropagation();
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
      const { id, label, value, onChange, hint, errors, placeholder, disabled, type, readOnly, inputMode, min, max, autoComplete, className } = props;
      const hasError = Boolean(errors && errors.length);
      return h(
        'div',
        { className: 'mcpg-field' + (className ? ' ' + className : '') },
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
      const { id, label, value, onChange, hint, errors, rows, placeholder, ariaLabel, className } = props;
      const hasError = Boolean(errors && errors.length);
      return h(
        'div',
        { className: 'mcpg-field' + (className ? ' ' + className : '') },
        label ? h('label', { className: 'mcpg-label', htmlFor: id }, label) : null,
        h('textarea', {
          id,
          className: 'mcpg-textarea',
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

    function SelectField(props) {
      const { id, label, value, onChange, options, disabled, hint, errors, className } = props;
      const hasError = Boolean(errors && errors.length);
      return h(
        'div',
        { className: 'mcpg-field' + (className ? ' ' + className : '') },
        label ? h('label', { className: 'mcpg-label', htmlFor: id }, label) : null,
        h(
          'span',
          { className: 'mcpg-select-wrap' },
          h(
            'select',
            {
              id,
              className: 'mcpg-select',
              value,
              disabled: disabled === true,
              'aria-invalid': hasError ? 'true' : undefined,
              'aria-describedby': hasError || hint ? id + '-meta' : undefined,
              onChange: (event) => onChange(event.target.value),
            },
            options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
          ),
          h('span', { className: 'mcpg-select-chevron', 'aria-hidden': 'true' }),
        ),
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

    function Menu({ trigger, children, label, align }) {
      const [open, setOpen] = useState(false);
      const wrapRef = useRef(null);
      useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const node = wrapRef.current;
          if (node && !node.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
        };
      }, [open]);
      return h(
        'div',
        { className: 'mcpg-menu-wrap', ref: wrapRef },
        trigger({ open, toggle: () => setOpen((previous) => !previous), close: () => setOpen(false) }),
        open
          ? h(
              'div',
              { className: 'mcpg-menu', role: 'menu', 'aria-label': label, 'data-align': align || 'right' },
              children(() => setOpen(false)),
            )
          : null,
      );
    }

    function Modal({ title, closeLabel, onClose, children, footer, wide }) {
      const titleId = useId ? useId() : 'mcpg-modal-title';
      const dialogRef = useRef(null);
      const onCloseRef = useRef(onClose);
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
            className: 'mcpg-modal' + (wide ? ' mcpg-modal-wide' : ''),
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
    /* Shared presentation pieces                                          */
    /* ------------------------------------------------------------------ */

    function ScopePill({ runtime }) {
      return h(Menu, {
        label: runtime.translate('list.scopeAria'),
        align: 'left',
        trigger: ({ open, toggle }) =>
          h(
            'button',
            {
              type: 'button',
              className: 'mcpg-scope-pill',
              'aria-haspopup': 'menu',
              'aria-expanded': open ? 'true' : 'false',
              'aria-label': runtime.translate('a11y.scopePill'),
              onClick: toggle,
            },
            h(MonitorIcon, null),
            h('span', { className: 'mcpg-scope-text' }, runtime.translate('list.scope')),
            h('span', { className: 'mcpg-scope-chevron' }, h(ChevronDownIcon, null)),
          ),
        children: (close) => [
          h('div', { key: 'label', className: 'mcpg-menu-label' }, runtime.translate('list.scopeLabel')),
          h(
            'button',
            {
              key: 'user',
              type: 'button',
              role: 'menuitemradio',
              'aria-checked': 'true',
              className: 'mcpg-menu-item',
              onClick: close,
            },
            h('span', { className: 'mcpg-menu-item-icon' }, h(UserIcon, null)),
            h('span', null, runtime.translate('list.scopeUser')),
            h('span', { className: 'mcpg-menu-item-check' }, h(CheckIcon, null)),
          ),
          h(
            'button',
            {
              key: 'projects',
              type: 'button',
              role: 'menuitem',
              className: 'mcpg-menu-item',
              disabled: true,
              title: runtime.translate('list.scopeComingSoon'),
            },
            h('span', { className: 'mcpg-menu-item-icon' }, h(FolderIcon, null)),
            h('span', null, runtime.translate('list.scopeProjects')),
            h('span', { className: 'mcpg-menu-note' }, runtime.translate('list.scopeComingSoon')),
          ),
        ],
      });
    }

    function SearchField({ runtime, value, onChange }) {
      return h(
        'div',
        { className: 'mcpg-search' },
        h('span', { className: 'mcpg-search-icon' }, h(SearchIcon, null)),
        h('input', {
          type: 'search',
          className: 'mcpg-search-input',
          value,
          placeholder: runtime.translate('list.search'),
          'aria-label': runtime.translate('list.searchAria'),
          spellCheck: 'false',
          autoComplete: 'off',
          onChange: (event) => onChange(event.target.value),
        }),
      );
    }

    function StatusDot({ runtime, enabled, lastCheck }) {
      const failed = lastCheck && typeof lastCheck === 'object' && lastCheck.successful === false;
      const title = failed
        ? runtime.translate('page.checkFailed')
        : runtime.translate('list.statusAria', {
            status: runtime.translate(enabled ? 'status.enabled' : 'status.disabled'),
          });
      return h('span', { className: 'mcpg-dot', 'data-on': enabled ? 'true' : 'false', 'data-warn': failed ? 'true' : 'false', title, 'aria-hidden': 'true' });
    }

    function RiskMark({ runtime, level }) {
      if (!level) return null;
      const label = runtime.translate('list.riskBadge', { level: runtime.levelText(level) });
      return h(
        'span',
        { className: 'mcpg-mark mcpg-mark-risk', 'data-level': level, title: label, role: 'img', 'aria-label': label },
        h(ShieldIcon, null),
      );
    }

    function SecretMark({ runtime }) {
      return h(
        'span',
        { className: 'mcpg-mark mcpg-mark-secret', title: runtime.translate('list.secretsBadge'), role: 'img', 'aria-label': runtime.translate('list.secretsBadge') },
        h(KeyIcon, null),
      );
    }

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
    /* Entries <-> JSON text (write-only values)                           */
    /* ------------------------------------------------------------------ */

    function entriesToJsonText(entries) {
      const record = {};
      let count = 0;
      for (const entry of Array.isArray(entries) ? entries : []) {
        const key = String(entry.key || '').trim();
        if (key === '') continue;
        record[key] = typeof entry.value === 'string' ? entry.value : '';
        count += 1;
      }
      if (count === 0) return '';
      return JSON.stringify(record, null, 2);
    }

    /**
     * Parse an env/header JSON object.
     * `""` keeps the stored value for an existing key; other strings replace it.
     */
    function jsonTextToEntries(text, storedKeys, invalidMessage) {
      const trimmed = String(text ?? '').trim();
      if (trimmed === '') return { ok: true, entries: [] };
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return { ok: false, message: invalidMessage };
      }
      if (!isPlainObject(parsed)) return { ok: false, message: invalidMessage };
      const stored = Array.isArray(storedKeys) ? storedKeys : [];
      const entries = [];
      for (const [key, value] of Object.entries(parsed)) {
        if (key === '' || typeof value !== 'string') return { ok: false, message: invalidMessage };
        if (value === '' && stored.includes(key)) {
          entries.push({ key, value: '', stored: true });
        } else {
          entries.push({ key, value, stored: stored.includes(key) });
        }
      }
      return { ok: true, entries };
    }

    function entriesToPayload(entries) {
      const payload = [];
      for (const entry of Array.isArray(entries) ? entries : []) {
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
    /* List page pieces                                                    */
    /* ------------------------------------------------------------------ */

    function ToolsSection({ runtime, servers }) {
      const rows = (Array.isArray(servers) ? servers : []).filter(
        (server) => Array.isArray(server.tools) && server.tools.length > 0,
      );
      if (rows.length === 0) return null;
      const total = rows.reduce((sum, server) => sum + server.tools.length, 0);
      return h(
        'details',
        { className: 'mcpg-audit' },
        h(
          'summary',
          { 'aria-label': runtime.translate('page.tools') },
          h('span', null, runtime.translate('page.tools')),
          h('span', { className: 'mcpg-group-count' }, String(total)),
          h('span', { className: 'mcpg-audit-chevron' }, h(ChevronDownIcon, null)),
        ),
        h(
          'div',
          { className: 'mcpg-details-body', style: { padding: '0 14px 12px' } },
          rows.map((serverRow) =>
            h(
              'div',
              { key: serverRow.serverName, className: 'mcpg-preview' },
              h('p', { className: 'mcpg-preview-label' }, serverRow.serverName),
              h(
                'ul',
                { className: 'mcpg-chips', 'aria-label': runtime.translate('a11y.toolsOf', { name: serverRow.serverName }) },
                serverRow.tools.map((tool) => h('li', { key: tool, className: 'mcpg-chip' }, tool)),
              ),
            ),
          ),
        ),
      );
    }

    function ServerRow({ runtime, row, busy, officialClient, checking, onToggle, onEdit, onDelete, onCheck }) {
      const name = row.serverName || '';
      const toggleDisabled = busy || officialClient !== true || Boolean(row.configurationError);
      const subtitle = serverSubtitle(row);
      return h(
        'div',
        { className: 'mcpg-row' },
        h(
          'button',
          {
            type: 'button',
            className: 'mcpg-row-main',
            onClick: () => onEdit(row),
            'aria-label': runtime.translate('a11y.openServer', { name }),
          },
          h(
            'span',
            { className: 'mcpg-row-icon' },
            row.transport === TRANSPORT_HTTP ? h(GlobeIcon, null) : h(PlugIcon, null),
          ),
          h(
            'span',
            { className: 'mcpg-row-text' },
            h(
              'span',
              { className: 'mcpg-row-name' },
              h('span', { className: 'mcpg-row-name-text' }, name),
              row.highestRisk ? h(RiskMark, { runtime, level: row.highestRisk }) : null,
              row.hasSecrets ? h(SecretMark, { runtime }) : null,
              row.configurationError ? h(Tag, { tone: 'danger' }, runtime.translate('page.invalid')) : null,
            ),
            h(
              'span',
              { className: 'mcpg-row-sub' },
              h(StatusDot, { runtime, enabled: row.enabled === true, lastCheck: row.lastCheck }),
              h('span', { className: 'mcpg-row-sub-text', title: subtitle }, subtitle),
            ),
          ),
        ),
        h(
          'div',
          { className: 'mcpg-row-end' },
          row.toolCount > 0
            ? h('span', { className: 'mcpg-tools-note' }, runtime.translate('list.tools', { count: row.toolCount }))
            : null,
          h(Menu, {
            label: runtime.translate('a11y.rowMenu', { name }),
            trigger: ({ open, toggle }) =>
              h(
                'button',
                {
                  type: 'button',
                  className: 'mcpg-icon-btn',
                  'aria-haspopup': 'menu',
                  'aria-expanded': open ? 'true' : 'false',
                  'aria-label': runtime.translate('a11y.rowMenu', { name }),
                  title: runtime.translate('list.more'),
                  disabled: busy,
                  onClick: toggle,
                },
                h(EllipsisIcon, null),
              ),
            children: (close) => [
              row.enabled
                ? h(
                    'button',
                    {
                      key: 'check',
                      type: 'button',
                      role: 'menuitem',
                      className: 'mcpg-menu-item',
                      disabled: Boolean(checking),
                      onClick: () => {
                        close();
                        onCheck(row);
                      },
                    },
                    h('span', { className: 'mcpg-menu-item-icon' }, h(RefreshIcon, { size: 14 })),
                    h('span', null, checking ? runtime.translate('page.checking') : runtime.translate('page.check')),
                  )
                : null,
              h(
                'button',
                {
                  key: 'edit',
                  type: 'button',
                  role: 'menuitem',
                  className: 'mcpg-menu-item',
                  onClick: () => {
                    close();
                    onEdit(row);
                  },
                },
                h('span', { className: 'mcpg-menu-item-icon' }, h(ChevronRightIcon, null)),
                h('span', null, runtime.translate('action.edit')),
              ),
              h(
                'button',
                {
                  key: 'delete',
                  type: 'button',
                  role: 'menuitem',
                  className: 'mcpg-menu-item mcpg-menu-item-danger',
                  onClick: () => {
                    close();
                    onDelete(row);
                  },
                },
                h('span', { className: 'mcpg-menu-item-icon' }, h('span', { 'aria-hidden': 'true' }, '✕')),
                h('span', null, runtime.translate('action.delete')),
              ),
            ],
          }),
          h(Switch, {
            checked: row.enabled === true,
            disabled: toggleDisabled,
            label: runtime.translate(row.enabled ? 'a11y.disable' : 'a11y.enable', { name }),
            onChange: (next) => onToggle(row, next),
          }),
        ),
      );
    }

    function ExternalRow({ runtime, row, detail, onOpen }) {
      const subtitle = externalSubtitle(detail, row);
      const name = row.serverName || '';
      const transport = (detail && detail.transport) || row.transport;
      return h(
        'div',
        { className: 'mcpg-row' },
        h(
          'button',
          {
            type: 'button',
            className: 'mcpg-row-main',
            onClick: () => onOpen(row),
            'aria-label': runtime.translate('a11y.externalRow', { name }),
            title: runtime.translate('external.lockHint'),
          },
          h('span', { className: 'mcpg-row-icon' }, transport === TRANSPORT_HTTP ? h(GlobeIcon, null) : h(PlugIcon, null)),
          h(
            'span',
            { className: 'mcpg-row-text' },
            h(
              'span',
              { className: 'mcpg-row-name' },
              h('span', { className: 'mcpg-row-name-text' }, name),
              h(Tag, { tone: 'quiet' }, runtime.translate('page.externalLocked')),
              detail && detail.highestRisk ? h(RiskMark, { runtime, level: detail.highestRisk }) : null,
            ),
            h(
              'span',
              { className: 'mcpg-row-sub' },
              h(StatusDot, { runtime, enabled: row.enabled !== false, lastCheck: null }),
              h('span', { className: 'mcpg-row-sub-text', title: subtitle }, subtitle),
            ),
          ),
        ),
        h(
          'div',
          { className: 'mcpg-row-end' },
          typeof row.toolCount === 'number' && row.toolCount > 0
            ? h('span', { className: 'mcpg-tools-note' }, runtime.translate('list.tools', { count: row.toolCount }))
            : null,
          h('span', { className: 'mcpg-external-link', 'aria-hidden': 'true' }, h(ChevronRightIcon, { size: 14 })),
        ),
      );
    }

    function AuditSection({ runtime, entries }) {
      const list = Array.isArray(entries) ? entries : [];
      return h(
        'details',
        { className: 'mcpg-audit' },
        h(
          'summary',
          { 'aria-label': runtime.translate('a11y.audit') },
          h('span', null, runtime.translate('list.auditTitle')),
          h('span', { className: 'mcpg-group-count' }, '(' + list.length + ')'),
          h('span', { className: 'mcpg-audit-chevron' }, h(ChevronDownIcon, null)),
        ),
        list.length === 0
          ? h('p', { className: 'mcpg-hint', style: { padding: '0 14px 14px' } }, runtime.translate('page.auditEmpty'))
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
    /* Modals                                                              */
    /* ------------------------------------------------------------------ */

    function EnableModal({ runtime, preview, busy, error, onClose, onConfirm }) {
      const [acknowledged, setAcknowledged] = useState(false);
      const needsAck = requiresAcknowledgement(preview.risk);
      const blocked = preview.blocked === true;
      const canConfirm = !busy && !blocked && (!needsAck || acknowledged);
      const title = runtime.translate('modal.enableTitle', { name: preview.serverName });
      return h(
        Modal,
        {
          title,
          closeLabel: runtime.translate('modal.close'),
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
          { className: 'mcpg-inline', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
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
      return h(
        Modal,
        {
          title,
          closeLabel: runtime.translate('modal.close'),
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
          closeLabel: runtime.translate('modal.close'),
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
                    { className: 'mcpg-risks' },
                    preview.errors.map((item, index) => h('li', { key: index, className: 'mcpg-invalid' }, runtime.errorText(item && item.code))),
                  )
                : null,
              h(
                'div',
                { className: 'mcpg-cards', style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                (preview.servers || []).map((server, index) =>
                  h(
                    'div',
                    { key: index, className: 'mcpg-details-body', style: { padding: '10px 12px', border: '.5px solid var(--dsw-alias-border-l2)', borderRadius: '10px' } },
                    h(
                      'div',
                      { className: 'mcpg-mini-row' },
                      h('span', { className: 'mcpg-row-icon' }, server.transport === TRANSPORT_STDIO ? h(PlugIcon, { size: 16 }) : h(GlobeIcon, { size: 16 })),
                      h(
                        'span',
                        { className: 'mcpg-mini-main' },
                        h(
                          'span',
                          { className: 'mcpg-mini-name' },
                          server.serverName || '',
                          server.highestRisk
                            ? h(Tag, { tone: riskTone(server.highestRisk) }, runtime.levelText(server.highestRisk))
                            : null,
                        ),
                        server.endpoint ? h('span', { className: 'mcpg-mini-meta' }, server.endpoint) : null,
                      ),
                    ),
                    Array.isArray(server.risk) && server.risk.length ? h(RiskList, { runtime, risks: server.risk }) : null,
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
          closeLabel: runtime.translate('modal.close'),
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

    function ExternalDetailModal({ runtime, row, detail, loading, error, busy, onClose, onTakeOver }) {
      const tr = runtime.translate;
      const effective = detail && typeof detail === 'object' ? detail : null;
      const name = (effective && effective.serverName) || (row && row.serverName) || '';
      const transport = (effective && effective.transport) || (row && row.transport) || TRANSPORT_STDIO;
      const patchId = effective && typeof effective.patchId === 'string' ? effective.patchId : '';
      const enabled =
        effective && typeof effective.enabled === 'boolean'
          ? effective.enabled
          : row
            ? row.enabled !== false
            : true;
      const canTakeOver = Boolean(effective) && patchId !== '' && !loading && !busy && !error;
      const facts = [];
      if (effective) {
        facts.push({ key: 'source', label: tr('external.source'), value: tr('external.sourceLabel') });
        facts.push({
          key: 'transport',
          label: tr('page.transport'),
          value: tr(transport === TRANSPORT_HTTP ? 'transport.httpLong' : 'transport.stdioLong'),
        });
        if (patchId) facts.push({ key: 'patch', label: tr('external.patchId'), value: patchId, code: true });
        if (transport === TRANSPORT_STDIO) {
          facts.push({ key: 'cwd', label: tr('form.cwd'), value: effective.cwd || tr('preview.hostDefault') });
        }
      }
      return h(
        Modal,
        {
          title: tr('external.detailTitle'),
          closeLabel: tr('modal.close'),
          wide: true,
          onClose: busy ? () => {} : onClose,
          footer: [
            h(Button, { key: 'close', variant: 'outline', disabled: busy, onClick: onClose }, tr('action.close')),
            h(
              Button,
              {
                key: 'adopt',
                variant: 'primary',
                disabled: !canTakeOver,
                title: canTakeOver ? undefined : tr('external.unavailable'),
                onClick: () => onTakeOver(effective),
              },
              tr('external.takeOver'),
            ),
          ],
        },
        h('p', { className: 'mcpg-hint' }, tr('external.notOwned')),
        h(
          'div',
          { className: 'mcpg-detail-head' },
          h('h3', { className: 'mcpg-detail-name' }, name),
          h(Tag, { tone: enabled ? 'success' : 'neutral' }, tr(enabled ? 'status.enabled' : 'status.disabled')),
          h(Tag, { tone: 'quiet' }, tr('page.externalLocked')),
          effective && effective.highestRisk
            ? h(Tag, { tone: riskTone(effective.highestRisk) }, runtime.levelText(effective.highestRisk))
            : null,
        ),
        loading ? h('p', { className: 'mcpg-hint' }, tr('external.loading')) : null,
        error ? h(Banner, { tone: 'error', text: error, live: true }) : null,
        effective
          ? h(
              'div',
              { className: 'mcpg-detail' },
              facts.length
                ? h(
                    'dl',
                    { className: 'mcpg-facts' },
                    facts.map((fact) =>
                      h(
                        'div',
                        { key: fact.key, className: 'mcpg-fact' },
                        h('dt', { className: 'mcpg-fact-label' }, fact.label),
                        h(
                          'dd',
                          { className: 'mcpg-fact-value' },
                          fact.code ? h('code', null, fact.value) : fact.value,
                        ),
                      ),
                    ),
                  )
                : null,
              transport === TRANSPORT_STDIO
                ? ArgvPreview({
                    runtime,
                    argv: [effective.command, ...(Array.isArray(effective.args) ? effective.args : [])].filter(
                      (item) => typeof item === 'string',
                    ),
                    endpoint: null,
                    cwd: effective.cwd,
                    transport: transport,
                  })
                : h(ArgvPreview, {
                    runtime,
                    argv: [],
                    endpoint: effective.url,
                    cwd: null,
                    transport: transport,
                  }),
              h(KeyChips, { label: tr('preview.envKeys'), keys: effective.envKeys }),
              h(KeyChips, { label: tr('preview.headerKeys'), keys: effective.headerKeys }),
              h(
                'div',
                { className: 'mcpg-preview' },
                h('p', { className: 'mcpg-preview-label' }, tr('analyze.risks')),
                h(RiskList, { runtime, risks: effective.risk }),
              ),
              h(
                'div',
                { className: 'mcpg-preview' },
                h(
                  'p',
                  { className: 'mcpg-preview-label' },
                  tr('page.tools') + (typeof effective.toolCount === 'number' ? ' (' + effective.toolCount + ')' : ''),
                ),
                Array.isArray(effective.tools) && effective.tools.length
                  ? h(
                      'ul',
                      { className: 'mcpg-chips', 'aria-label': tr('a11y.toolsOf', { name }) },
                      effective.tools.map((tool) => h('li', { key: tool, className: 'mcpg-chip' }, tool)),
                    )
                  : h('p', { className: 'mcpg-hint' }, tr('external.toolsEmpty')),
              ),
            )
          : null,
        !effective && !loading ? h('p', { className: 'mcpg-hint' }, tr('external.unavailable')) : null,
      );
    }

    function AdoptConfirmModal({ runtime, detail, busy, error, onClose, onConfirm }) {
      const tr = runtime.translate;
      const name = (detail && detail.serverName) || '';
      return h(
        Modal,
        {
          title: tr('external.adoptTitle', { name }),
          closeLabel: tr('modal.close'),
          onClose: busy ? () => {} : onClose,
          footer: [
            h(Button, { key: 'cancel', variant: 'outline', disabled: busy, onClick: onClose }, tr('form.cancel')),
            h(
              Button,
              { key: 'confirm', variant: 'primary', disabled: busy === true, onClick: onConfirm },
              tr('external.takeOver'),
            ),
          ],
        },
        h(
          'ol',
          { className: 'mcpg-steps' },
          h('li', null, tr('external.adoptStep1')),
          h('li', null, tr('external.adoptStep2')),
          h('li', null, tr('external.adoptStep3')),
        ),
        error ? h(Banner, { tone: 'error', text: error, live: true }) : null,
      );
    }

    function normalizeImportResult(value) {
      const source = value && typeof value === 'object' ? value : {};
      const imported = Array.isArray(source.imported)
        ? source.imported.filter((name) => typeof name === 'string')
        : [];
      const skipped = Array.isArray(source.skipped)
        ? source.skipped
            .filter((item) => item && typeof item.serverName === 'string')
            .map((item) => ({
              serverName: item.serverName,
              code: typeof item.code === 'string' && item.code !== '' ? item.code : 'OPERATION_FAILED',
            }))
        : [];
      return { imported, skipped };
    }

    function DiscoverModal({ runtime, onClose, onError, onImported }) {
      const tr = runtime.translate;
      const [state, setState] = useState({ status: 'loading', sources: [], error: null });
      const [selection, setSelection] = useState({});
      const [importing, setImporting] = useState(false);
      const [importError, setImportError] = useState('');
      const onCloseRef = useRef(onClose);
      const onErrorRef = useRef(onError);
      const onImportedRef = useRef(onImported);
      useEffect(() => {
        onCloseRef.current = onClose;
        onErrorRef.current = onError;
        onImportedRef.current = onImported;
      }, [onClose, onError, onImported]);

      const load = useCallback(async () => {
        setState({ status: 'loading', sources: [], error: null });
        setSelection({});
        setImportError('');
        try {
          const value = await runtime.request('discover');
          const sources = value && Array.isArray(value.sources) ? value.sources : [];
          setState({ status: 'ready', sources, error: null });
        } catch (error) {
          const kind = typeof onErrorRef.current === 'function' ? onErrorRef.current(error) : 'error';
          if (kind !== 'error') {
            if (typeof onCloseRef.current === 'function') onCloseRef.current();
            return;
          }
          setState({ status: 'error', sources: [], error: runtime.errorText(error && error.code) });
        }
      }, [runtime]);

      useEffect(() => {
        void load();
      }, [load]);

      const sources = state.sources;
      const isEligible = (row) =>
        Boolean(row) && !row.error && row.alreadyManaged !== true && row.alreadyExternal !== true;

      function selectedNames(sourceId) {
        const set = selection[sourceId];
        return set ? Array.from(set) : [];
      }

      function toggleName(sourceId, name) {
        setSelection((previous) => {
          const next = { ...previous };
          const set = new Set(previous[sourceId] || []);
          if (set.has(name)) set.delete(name);
          else set.add(name);
          if (set.size) next[sourceId] = set;
          else delete next[sourceId];
          return next;
        });
      }

      function toggleAll(sourceId, rows) {
        const eligible = rows.filter(isEligible).map((row) => row.serverName);
        setSelection((previous) => {
          const next = { ...previous };
          const current = previous[sourceId] || new Set();
          const allSelected = eligible.length > 0 && eligible.every((name) => current.has(name));
          if (allSelected) {
            delete next[sourceId];
          } else {
            next[sourceId] = new Set(eligible);
          }
          return next;
        });
      }

      async function importSourceOnce(sourceId, names) {
        let lastError = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const snapshot = await runtime.request(null);
          const revision = snapshot && typeof snapshot.revision === 'string' ? snapshot.revision : '';
          try {
            return await runtime.request('importDiscovered', {
              sourceId,
              serverNames: names,
              revision,
              confirm: true,
            });
          } catch (error) {
            lastError = error;
            const stale = error && (error.status === 409 || error.code === 'STALE_CONFIGURATION');
            if (!stale || attempt === 1) throw error;
          }
        }
        throw lastError || { code: 'OPERATION_FAILED' };
      }

      async function runImport() {
        const groups = sources
          .map((source) => ({
            source,
            names: selectedNames(source.id).filter((name) => {
              const row = (Array.isArray(source.servers) ? source.servers : []).find((item) => item.serverName === name);
              return isEligible(row);
            }),
          }))
          .filter((group) => group.names.length > 0);
        if (groups.length === 0) {
          setImportError(tr('discover.noSelection'));
          return;
        }
        setImporting(true);
        setImportError('');
        const imported = [];
        const skipped = [];
        try {
          for (const group of groups) {
            try {
              const result = normalizeImportResult(await importSourceOnce(group.source.id, group.names));
              imported.push(...result.imported);
              skipped.push(...result.skipped);
            } catch (error) {
              const kind = typeof onErrorRef.current === 'function' ? onErrorRef.current(error) : 'error';
              if (kind !== 'error') {
                if (typeof onCloseRef.current === 'function') onCloseRef.current();
                return;
              }
              const code = error && typeof error.code === 'string' && error.code !== '' ? error.code : 'OPERATION_FAILED';
              skipped.push(...group.names.map((name) => ({ serverName: name, code })));
            }
          }
          if (typeof onImportedRef.current === 'function') onImportedRef.current({ imported, skipped });
        } finally {
          setImporting(false);
        }
      }

      const selectedCount = Object.values(selection).reduce((sum, set) => sum + (set ? set.size : 0), 0);

      const sourcesView =
        state.status === 'loading'
          ? h('p', { className: 'mcpg-hint' }, tr('discover.loading'))
          : state.status === 'error'
            ? h(Banner, { tone: 'error', text: state.error, live: true })
            : sources.length === 0
              ? h(
                  'div',
                  { className: 'mcpg-empty-state' },
                  tr('discover.empty'),
                  ' ',
                  h('span', null, tr('discover.emptyHint')),
                )
              : sources.map((source) => {
                  const rows = Array.isArray(source.servers) ? source.servers : [];
                  const eligible = rows.filter(isEligible);
                  const current = selection[source.id] || new Set();
                  const allSelected = eligible.length > 0 && eligible.every((row) => current.has(row.serverName));
                  return h(
                    'details',
                    { key: source.id, className: 'mcpg-source', open: true },
                    h(
                      'summary',
                      null,
                      h('span', null, source.label || source.kind || source.id),
                      h('span', { className: 'mcpg-group-count' }, String(rows.length)),
                      source.path ? h('span', { className: 'mcpg-source-path' }, source.path) : null,
                      source.error ? h(Tag, { tone: 'danger' }, tr('discover.sourceError', { code: source.error })) : null,
                      h('span', { className: 'mcpg-source-chevron' }, h(ChevronDownIcon, null)),
                    ),
                    h(
                      'div',
                      { className: 'mcpg-source-body' },
                      source.error
                        ? h(Banner, { tone: 'warning', text: runtime.errorText(source.error) })
                        : null,
                      rows.length === 0
                        ? h('p', { className: 'mcpg-hint' }, tr('discover.empty'))
                        : h(
                            'label',
                            { className: 'mcpg-check' },
                            h('input', {
                              type: 'checkbox',
                              checked: allSelected,
                              disabled: importing || eligible.length === 0,
                              'aria-label': tr('discover.selectAll'),
                              onChange: () => toggleAll(source.id, rows),
                            }),
                            h('span', null, tr('discover.selectAll')),
                          ),
                      rows.map((row) => {
                        const eligible2 = isEligible(row);
                        const checkboxId = 'mcpg-pick-' + source.id + '-' + row.serverName;
                        const meta =
                          row.transport === TRANSPORT_HTTP
                            ? row.url || ''
                            : [row.command, ...(Array.isArray(row.args) ? row.args : [])].filter(Boolean).join(' ');
                        return h(
                          'label',
                          {
                            key: source.id + '/' + row.serverName,
                            className: 'mcpg-pick-row',
                            'data-disabled': eligible2 ? 'false' : 'true',
                            htmlFor: checkboxId,
                          },
                          h(
                            'span',
                            { className: 'mcpg-pick-box' },
                            h('input', {
                              id: checkboxId,
                              type: 'checkbox',
                              checked: current.has(row.serverName),
                              disabled: importing || !eligible2,
                              onChange: () => toggleName(source.id, row.serverName),
                            }),
                          ),
                          h(
                            'span',
                            { className: 'mcpg-pick-main' },
                            h(
                              'span',
                              { className: 'mcpg-pick-name' },
                              h('span', null, row.serverName || ''),
                              h(
                                Tag,
                                { tone: 'quiet' },
                                runtime.translate(
                                  row.transport === TRANSPORT_HTTP ? 'transport.http' : 'transport.stdio',
                                ),
                              ),
                              row.highestRisk
                                ? h(Tag, { tone: riskTone(row.highestRisk) }, runtime.levelText(row.highestRisk))
                                : null,
                              row.alreadyManaged ? h(Tag, { tone: 'quiet' }, tr('discover.alreadyManaged')) : null,
                              row.alreadyExternal ? h(Tag, { tone: 'quiet' }, tr('discover.alreadyExternal')) : null,
                              row.needsPlainHttpAllow ? h(Tag, { tone: 'warning' }, tr('discover.needsPlainHttp')) : null,
                              row.error ? h(Tag, { tone: 'danger' }, tr('discover.unsupported', { code: row.error })) : null,
                            ),
                            meta ? h('span', { className: 'mcpg-pick-meta' }, meta) : null,
                            row.scope ? h('span', { className: 'mcpg-pick-meta' }, tr('discover.scope', { scope: row.scope })) : null,
                          ),
                        );
                      }),
                    ),
                  );
                });

      return h(
        Modal,
        {
          title: tr('discover.title'),
          closeLabel: tr('modal.close'),
          wide: true,
          onClose: importing ? () => {} : onClose,
          footer: [
            h(Button, { key: 'cancel', variant: 'outline', disabled: importing, onClick: onClose }, tr('form.cancel')),
            h(
              Button,
              {
                key: 'import',
                variant: 'primary',
                disabled: importing || selectedCount === 0 || state.status !== 'ready',
                onClick: runImport,
              },
              importing ? tr('discover.importing') : tr('discover.importSelected'),
            ),
          ],
        },
        h('p', { className: 'mcpg-hint' }, tr('discover.hint')),
        h(
          'div',
          { className: 'mcpg-discover-toolbar' },
          h(
            Button,
            {
              size: 'sm',
              variant: 'outline',
              disabled: importing || state.status === 'loading',
              onClick: () => void load(),
            },
            h(RefreshIcon, { size: 14 }),
            tr('discover.rescan'),
          ),
          selectedCount > 0 ? h('span', { className: 'mcpg-hint' }, tr('discover.selected', { count: selectedCount })) : null,
        ),
        importError ? h(Banner, { tone: 'error', text: importError, live: true }) : null,
        sourcesView,
      );
    }

    /* ------------------------------------------------------------------ */
    /* Draft helpers                                                       */
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

    function storedEntries(keys) {
      return (Array.isArray(keys) ? keys : []).map((key) => ({ key, value: '', stored: true }));
    }

    function draftFromServer(server) {
      const draft = emptyDraft();
      if (!server) return draft;
      draft.serverName = server.serverName || '';
      draft.transport = server.transport === TRANSPORT_HTTP ? TRANSPORT_HTTP : TRANSPORT_STDIO;
      if (typeof server.command === 'string') draft.command = server.command;
      if (Array.isArray(server.args)) draft.argsText = server.args.map((arg) => quoteArg(arg)).join(' ');
      if (typeof server.cwd === 'string') draft.cwd = server.cwd;
      if (typeof server.url === 'string') draft.url = server.url;
      draft.env = storedEntries(server.envKeys);
      draft.headers = storedEntries(server.headerKeys);
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
        env: entriesToPayload(draft.env),
        headers: entriesToPayload(draft.headers),
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

    /* ------------------------------------------------------------------ */
    /* JSON tab helpers (<name> object or mcpServers envelope)             */
    /* ------------------------------------------------------------------ */

    function toJsonText(draft) {
      const parsed = parseArgsText(draft.argsText);
      const name = String(draft.serverName || '').trim() || 'my-mcp-server';
      const entry = {};
      if (draft.transport === TRANSPORT_HTTP) {
        entry.type = 'http';
        entry.url = typeof draft.url === 'string' ? draft.url : '';
        if (draft.headers.length) {
          const headers = {};
          for (const item of draft.headers) {
            const key = String(item.key || '').trim();
            if (key === '') continue;
            headers[key] = typeof item.value === 'string' ? item.value : '';
          }
          entry.headers = headers;
        }
      } else {
        entry.type = 'stdio';
        entry.command = typeof draft.command === 'string' ? draft.command : '';
        entry.args = parsed.ok ? parsed.args : [];
        if (String(draft.cwd || '').trim() !== '') entry.cwd = draft.cwd;
        if (draft.env.length) {
          const env = {};
          for (const item of draft.env) {
            const key = String(item.key || '').trim();
            if (key === '') continue;
            env[key] = typeof item.value === 'string' ? item.value : '';
          }
          entry.env = env;
        }
      }
      return JSON.stringify({ [name]: entry }, null, 2);
    }

    function fromJsonText(text, storedEnvKeys, storedHeaderKeys) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, message: 'form.jsonInvalid' };
      }
      if (!isPlainObject(parsed)) return { ok: false, message: 'form.jsonShape' };
      let servers;
      if (isPlainObject(parsed.mcpServers)) {
        servers = parsed.mcpServers;
      } else {
        servers = parsed;
      }
      const names = Object.keys(servers);
      if (names.length !== 1) return { ok: false, message: 'form.jsonShape' };
      const name = names[0];
      const entry = servers[name];
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
      function recordToEntries(record, storedKeys, invalidMessage) {
        if (!hasOwn(entry, record)) return [];
        const map = entry[record];
        if (!isPlainObject(map)) return { invalid: invalidMessage };
        const stored = Array.isArray(storedKeys) ? storedKeys : [];
        const entries = [];
        for (const [key, raw] of Object.entries(map)) {
          if (key === '' || typeof raw !== 'string') return { invalid: invalidMessage };
          if (raw === '' && stored.includes(key)) {
            entries.push({ key, value: '', stored: true });
          } else {
            entries.push({ key, value: raw, stored: stored.includes(key) });
          }
        }
        return entries;
      }
      const env = recordToEntries('env', storedEnvKeys, 'form.envJsonInvalid');
      if (!Array.isArray(env)) return { ok: false, message: env.invalid };
      const headers = recordToEntries('headers', storedHeaderKeys, 'form.headersJsonInvalid');
      if (!Array.isArray(headers)) return { ok: false, message: headers.invalid };
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

    function problemText(runtime, problem) {
      if (typeof problem === 'string') {
        const known = runtime.optionalText(problem);
        return known === null ? problem : known;
      }
      if (problem && typeof problem === 'object') {
        const known = runtime.optionalText(problem.key);
        return (known === null ? problem.key : known) + (problem.field ? ' · ' + problem.field : '');
      }
      return runtime.translate('error.unknown');
    }

    /* ------------------------------------------------------------------ */
    /* Edit page                                                           */
    /* ------------------------------------------------------------------ */

    function EditPage({ runtime, page, mode, serverName, onBack, onSaved, report }) {
      useLocaleRevision(runtime);
      const server = mode === 'edit' && page ? page.servers.find((item) => item.serverName === serverName) || null : null;
      const initial = useMemo(() => draftFromServer(server), []);
      const [draft, setDraft] = useState(initial);
      const [tab, setTab] = useState('form');
      const [jsonText, setJsonText] = useState('');
      const [jsonProblem, setJsonProblem] = useState(null);
      const [envText, setEnvText] = useState(() => entriesToJsonText(initial.env));
      const [headersText, setHeadersText] = useState(() => entriesToJsonText(initial.headers));
      const [envProblem, setEnvProblem] = useState(null);
      const [headersProblem, setHeadersProblem] = useState(null);
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

      function changeTransport(nextTransport) {
        setEnvProblem(null);
        setHeadersProblem(null);
        if (nextTransport === TRANSPORT_HTTP) {
          patch({ transport: nextTransport, env: [] });
          setEnvText('');
        } else {
          patch({ transport: nextTransport, headers: [] });
          setHeadersText('');
        }
      }

      useEffect(() => {
        if (!touched) return undefined;
        if (tab === 'json' && jsonProblem) return undefined;
        if (envProblem || headersProblem) return undefined;
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
      }, [payloadKey, touched, tab, jsonProblem, envProblem, headersProblem, mode, serverName, server, runtime]);

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
        !envProblem &&
        !headersProblem &&
        (!needsClearAck || clearAck) &&
        analysis.status !== 'pending';

      function handleEnvChange(value) {
        setEnvText(value);
        setTouched(true);
        const parsed = jsonTextToEntries(value, storedEnvKeys, runtime.translate('form.envJsonInvalid'));
        if (!parsed.ok) {
          setEnvProblem(parsed.message);
          return;
        }
        setEnvProblem(null);
        setDraft((previous) => ({ ...previous, env: parsed.entries }));
      }

      function handleHeadersChange(value) {
        setHeadersText(value);
        setTouched(true);
        const parsed = jsonTextToEntries(value, storedHeaderKeys, runtime.translate('form.headersJsonInvalid'));
        if (!parsed.ok) {
          setHeadersProblem(parsed.message);
          return;
        }
        setHeadersProblem(null);
        setDraft((previous) => ({ ...previous, headers: parsed.entries }));
      }

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
          setJsonProblem(problemText(runtime, parsed.message));
          return;
        }
        setDraft((previous) => ({ ...previous, ...parsed.value }));
        setEnvText(entriesToJsonText(parsed.value.env));
        setHeadersText(entriesToJsonText(parsed.value.headers));
        setEnvProblem(null);
        setHeadersProblem(null);
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
          setJsonProblem(problemText(runtime, parsed.message));
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

      const showEditNotice = mode === 'edit' && server && !serverHasDetails(server);
      const generalErrorTexts = Object.keys(errorsByRoot)
        .filter((root) => !renderedRoots.includes(root))
        .flatMap((root) => (errorsByRoot[root] || []).map((item) => runtime.errorText(item.code)));
      const bannerTexts = apiErrors.map((item) => runtime.errorText(item && item.code));
      const analysisLevel = highestRisk(risks);
      const analysisTone = blocked ? 'danger' : analysisLevel ? riskTone(analysisLevel) : 'success';
      const analysisLabel = blocked
        ? runtime.translate('analyze.blocked')
        : analysisLevel
          ? runtime.translate('risk.level') + ': ' + runtime.levelText(analysisLevel)
          : runtime.translate('analyze.valid');

      if (mode === 'edit' && !server) {
        return h(
          'section',
          { className: 'mcpg-page' },
          h('h1', { className: 'mcpg-page-title' }, runtime.translate('form.newTitle')),
          h(Banner, { tone: 'warning', text: runtime.translate('error.NOT_FOUND') }),
          h('div', null, h(Button, { variant: 'outline', onClick: onBack }, runtime.translate('form.back'))),
        );
      }

      const title = mode === 'create' ? runtime.translate('form.newTitle') : serverName || '';
      const subtitle = runtime.translate(mode === 'create' ? 'form.subtitleCreate' : 'form.subtitleEdit');

      const scopeInline = h(
        'div',
        { className: 'mcpg-scope-inline' },
        h('span', { className: 'mcpg-scope-label' }, runtime.translate('list.scopeLabel')),
        h(ScopePill, { runtime }),
      );

      const advanced = h(
        'details',
        { className: 'mcpg-details' },
        h(
          'summary',
          null,
          runtime.translate('form.advanced'),
          h('span', { className: 'mcpg-details-chevron' }, h(ChevronDownIcon, null)),
        ),
        h(
          'div',
          { className: 'mcpg-details-body' },
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
          draft.transport === TRANSPORT_STDIO
            ? h(TextField, {
                id: 'mcpg-cwd',
                label: runtime.translate('form.cwd'),
                value: draft.cwd,
                onChange: (value) => patch({ cwd: value }),
                hint: runtime.translate('form.cwdHint'),
                errors: fieldErrorTexts('cwd'),
              })
            : h(CheckboxField, {
                id: 'mcpg-plain-http',
                label: runtime.translate('form.allowPlainHttp'),
                checked: draft.allowPlainHttp,
                onChange: (checked) => patch({ allowPlainHttp: checked }),
                hint: runtime.translate('form.allowPlainHttpWarning'),
                errors: fieldErrorTexts('allowPlainHttp'),
              }),
        ),
      );

      const analysisDetails = h(
        'details',
        { className: 'mcpg-details' },
        h(
          'summary',
          null,
          runtime.translate('form.analysis'),
          h(
            'span',
            { className: 'mcpg-analysis-summary-state' },
            analysis.status === 'pending'
              ? h('span', { className: 'mcpg-hint' }, runtime.translate('analyze.pending'))
              : analysisResult
                ? h(Tag, { tone: analysisTone }, analysisLabel)
                : h('span', { className: 'mcpg-hint' }, runtime.translate('risk.none')),
          ),
          h('span', { className: 'mcpg-details-chevron' }, h(ChevronDownIcon, null)),
        ),
        h(
          'div',
          { className: 'mcpg-details-body' },
          generalErrorTexts.length
            ? h(
                'ul',
                { className: 'mcpg-risks' },
                generalErrorTexts.map((text, index) => h('li', { key: index, className: 'mcpg-risk' }, h('span', null, text))),
              )
            : null,
          blocked ? h(Banner, { tone: 'error', text: runtime.translate('analyze.blocked') }) : null,
          h(RiskList, { runtime, risks }),
          analysisResult
            ? ArgvPreview({
                runtime,
                argv: Array.isArray(analysisResult.argv) ? analysisResult.argv : [],
                endpoint: analysisResult.endpoint,
                cwd: draft.transport === TRANSPORT_STDIO ? draft.cwd : null,
                transport: draft.transport,
              })
            : null,
          h('p', { className: 'mcpg-hint' }, runtime.translate('analyze.secretsNote')),
        ),
      );

      const clearSecretsBlock = needsClearAck
        ? h(
            'div',
            { className: 'mcpg-field' },
            h(Banner, { tone: 'warning', text: runtime.translate('form.clearSecrets', { keys: droppedSecrets.join(', ') }) }),
            h(CheckboxField, {
              id: 'mcpg-clear-ack',
              label: runtime.translate('form.clearAck'),
              checked: clearAck,
              onChange: setClearAck,
            }),
          )
        : null;

      const formCard = h(
        'div',
        { className: 'mcpg-card mcpg-form-card' },
        h(
          'div',
          { className: 'mcpg-form-fields' },
          h(
            'div',
            { className: 'mcpg-field-row' },
            h(TextField, {
              id: 'mcpg-name',
              label: runtime.translate('form.name'),
              value: draft.serverName,
              disabled: mode === 'edit',
              onChange: (value) => patch({ serverName: value }),
              placeholder: runtime.translate('form.namePlaceholder'),
              hint: mode === 'edit' ? runtime.translate('form.nameLocked') : undefined,
              errors: fieldErrorTexts('serverName'),
              className: 'mcpg-field-grow',
            }),
            scopeInline,
          ),
          h(SelectField, {
            id: 'mcpg-type',
            label: runtime.translate('form.type'),
            value: draft.transport,
            onChange: changeTransport,
            options: [
              { value: TRANSPORT_STDIO, label: runtime.translate('form.typeStdio') },
              { value: TRANSPORT_HTTP, label: runtime.translate('form.typeHttp') },
            ],
            errors: fieldErrorTexts('transport'),
            className: 'mcpg-field-narrow',
          }),
          h(TextField, {
            id: 'mcpg-timeout',
            label: runtime.translate('form.timeout'),
            value: draft.timeoutMs,
            inputMode: 'numeric',
            placeholder: runtime.translate('form.timeoutPlaceholder'),
            onChange: (value) => patch({ timeoutMs: value }),
            hint: runtime.translate('form.timeoutHint'),
            errors: fieldErrorTexts('timeoutMs'),
            className: 'mcpg-field-narrow',
          }),
          h(SelectField, {
            id: 'mcpg-protocol',
            label: runtime.translate('form.protocol'),
            value: 'auto',
            onChange: () => {},
            disabled: true,
            options: [{ value: 'auto', label: runtime.translate('form.protocolAuto') }],
            className: 'mcpg-field-narrow',
          }),
          draft.transport === TRANSPORT_STDIO
            ? h(TextField, {
                id: 'mcpg-command',
                label: runtime.translate('form.command'),
                value: draft.command,
                onChange: (value) => patch({ command: value }),
                placeholder: runtime.translate('form.commandPlaceholder'),
                hint: runtime.translate('form.commandHint'),
                errors: fieldErrorTexts('command'),
              })
            : h(TextField, {
                id: 'mcpg-url',
                label: runtime.translate('form.url'),
                value: draft.url,
                onChange: (value) => patch({ url: value }),
                placeholder: 'https://example.com/mcp',
                hint: runtime.translate('form.urlHint'),
                errors: fieldErrorTexts('url'),
              }),
          draft.transport === TRANSPORT_STDIO
            ? h(TextField, {
                id: 'mcpg-args',
                label: runtime.translate('form.argsLabel'),
                value: draft.argsText,
                onChange: (value) => patch({ argsText: value }),
                placeholder: runtime.translate('form.argsPlaceholder'),
                hint: runtime.translate('form.argsHint'),
                errors: [...fieldErrorTexts('argsText'), ...fieldErrorTexts('args')],
              })
            : null,
          draft.transport === TRANSPORT_STDIO
            ? h(
                'details',
                { className: 'mcpg-details' },
                h(
                  'summary',
                  null,
                  runtime.translate('form.envOptional'),
                  h('span', { className: 'mcpg-details-chevron' }, h(ChevronDownIcon, null)),
                ),
                h(
                  'div',
                  { className: 'mcpg-details-body' },
                  h(TextAreaField, {
                    id: 'mcpg-env-json',
                    value: envText,
                    onChange: handleEnvChange,
                    rows: 4,
                    placeholder: runtime.translate('form.envPlaceholder'),
                    hint: runtime.translate('form.envJsonHint'),
                    errors: envProblem ? [envProblem] : fieldErrorTexts('env'),
                    ariaLabel: runtime.translate('form.envOptional'),
                  }),
                ),
              )
            : h(
                'details',
                { className: 'mcpg-details' },
                h(
                  'summary',
                  null,
                  runtime.translate('form.headersOptional'),
                  h('span', { className: 'mcpg-details-chevron' }, h(ChevronDownIcon, null)),
                ),
                h(
                  'div',
                  { className: 'mcpg-details-body' },
                  h(TextAreaField, {
                    id: 'mcpg-headers-json',
                    value: headersText,
                    onChange: handleHeadersChange,
                    rows: 4,
                    placeholder: runtime.translate('form.headersPlaceholder'),
                    hint: runtime.translate('form.envJsonHint'),
                    errors: headersProblem ? [headersProblem] : fieldErrorTexts('headers'),
                    ariaLabel: runtime.translate('form.headersOptional'),
                  }),
                ),
              ),
          advanced,
          analysisDetails,
        ),
        clearSecretsBlock,
        h(
          'div',
          { className: 'mcpg-form-footer' },
          h(Button, { variant: 'ghost', disabled: saving, onClick: onBack }, runtime.translate('form.cancel')),
          h(
            Button,
            { variant: 'primary', disabled: !canSave, onClick: handleSave, title: canSave ? undefined : runtime.translate('form.saveDisabled') },
            runtime.translate('form.save'),
          ),
        ),
      );

      const jsonCard = h(
        'div',
        { className: 'mcpg-card mcpg-form-card' },
        h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, scopeInline),
        h('div', { className: 'mcpg-form-fields' },
          h(TextAreaField, {
            id: 'mcpg-json',
            label: runtime.translate('form.fullConfiguration'),
            value: jsonText,
            onChange: handleJsonChange,
            rows: 14,
            hint: runtime.translate('form.jsonHintLong'),
            errors: jsonProblem ? [jsonProblem] : [],
          }),
        ),
        clearSecretsBlock,
        h(
          'div',
          { className: 'mcpg-form-footer' },
          h(Button, { variant: 'ghost', disabled: saving, onClick: onBack }, runtime.translate('form.cancel')),
          h(
            Button,
            { variant: 'primary', disabled: !canSave, onClick: handleSave, title: canSave ? undefined : runtime.translate('form.saveDisabled') },
            runtime.translate('form.save'),
          ),
        ),
      );

      return h(
        'section',
        { className: 'mcpg-page' },
        h(
          'div',
          { className: 'mcpg-breadcrumbs' },
          h(
            'button',
            { type: 'button', className: 'mcpg-crumb', onClick: onBack },
            runtime.translate('nav.label'),
          ),
          h('span', { className: 'mcpg-crumb-sep', 'aria-hidden': 'true' }, h(ChevronRightIcon, null)),
          h('span', { className: 'mcpg-crumb-current', 'aria-current': 'page' }, title),
        ),
        h(
          'div',
          { className: 'mcpg-form-head' },
          h(
            'div',
            { className: 'mcpg-form-titles' },
            h('h1', { className: 'mcpg-form-title' }, title),
            h('p', { className: 'mcpg-form-subtitle' }, subtitle),
          ),
          h(Tabs, {
            value: tab,
            onChange: selectTab,
            formLabel: runtime.translate('form.tabForm'),
            jsonLabel: runtime.translate('form.tabJson'),
            labels: tokens,
          }),
        ),
        showEditNotice ? h(Banner, { tone: 'info', text: runtime.translate('form.editNotice') }) : null,
        bannerTexts.length ? h(Banner, { tone: 'error', text: bannerTexts.join(' · '), live: true }) : null,
        analysis.status === 'error'
          ? h(Banner, { tone: 'error', text: runtime.errorText(analysis.error && analysis.error.code), live: true })
          : null,
        tab === 'form' ? formCard : jsonCard,
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
      const [search, setSearch] = useState('');
      const [externalDetails, setExternalDetails] = useState({});
      const externalDetailsRef = useRef({});

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

      useEffect(() => {
        const rows = page && Array.isArray(page.external)
          ? page.external.filter((row) => row && (row.patchId || row.serverName))
          : [];
        if (rows.length === 0) return undefined;
        let cancelled = false;
        (async () => {
          for (const row of rows) {
            const key = row.patchId || row.serverName;
            if (hasOwn(externalDetailsRef.current, key)) continue;
            try {
              const detail = await runtime.request(
                'externalDetail',
                row.patchId ? { patchId: row.patchId } : { serverName: row.serverName },
              );
              if (cancelled) return;
              if (detail && typeof detail === 'object') {
                externalDetailsRef.current[key] = detail;
                if (typeof detail.patchId === 'string') externalDetailsRef.current[detail.patchId] = detail;
                if (typeof detail.serverName === 'string') externalDetailsRef.current[detail.serverName] = detail;
                setExternalDetails((previous) => {
                  const next = { ...previous, [key]: detail };
                  if (typeof detail.patchId === 'string') next[detail.patchId] = detail;
                  if (typeof detail.serverName === 'string') next[detail.serverName] = detail;
                  return next;
                });
              }
            } catch {
              externalDetailsRef.current[key] = null;
            }
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [page, runtime]);

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
      const query = search.trim().toLowerCase();

      function matchesQuery(row) {
        if (query === '') return true;
        const haystack = [
          row && row.serverName,
          serverSubtitle(row),
          row && row.transport,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      }

      const visibleServers = servers.filter(matchesQuery);
      const visibleExternal = external.filter((row) => {
        if (query === '') return true;
        const detail = externalDetails[externalDetailKey(row)] || null;
        const haystack = [row && row.serverName, externalSubtitle(detail, row), row && row.transport]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      });
      const totalCount = servers.length + external.length;
      const limited = page && page.limits && typeof page.limits.maxServers === 'number' ? page.limits.maxServers : 100;

      function openCreate() {
        setView({ kind: 'edit', mode: 'create' });
      }

      function openEdit(row) {
        setView({ kind: 'edit', mode: 'edit', serverName: row.serverName });
      }

      function externalDetailKey(row) {
        return row ? row.patchId || row.serverName || '' : '';
      }

      function cacheExternalDetail(key, detail) {
        if (!detail || typeof detail !== 'object') return;
        externalDetailsRef.current[key] = detail;
        if (typeof detail.patchId === 'string') externalDetailsRef.current[detail.patchId] = detail;
        if (typeof detail.serverName === 'string') externalDetailsRef.current[detail.serverName] = detail;
        setExternalDetails((previous) => {
          const next = { ...previous, [key]: detail };
          if (typeof detail.patchId === 'string') next[detail.patchId] = detail;
          if (typeof detail.serverName === 'string') next[detail.serverName] = detail;
          return next;
        });
      }

      async function fetchExternalDetail(row) {
        const detail = await runtime.request(
          'externalDetail',
          row.patchId ? { patchId: row.patchId } : { serverName: row.serverName },
        );
        cacheExternalDetail(externalDetailKey(row), detail);
        return detail;
      }

      async function openExternalDetail(row) {
        const key = externalDetailKey(row);
        const cached = externalDetailsRef.current[key] || null;
        const requestRow = row;
        setModal({ kind: 'externalDetail', row: requestRow, detail: cached, loading: !cached, error: null });
        try {
          const detail = await fetchExternalDetail(requestRow);
          setModal((previous) =>
            previous && previous.kind === 'externalDetail' && externalDetailKey(previous.row) === key
              ? { ...previous, detail, loading: false, error: null }
              : previous,
          );
        } catch (error) {
          const kind = classify(error);
          if (kind !== 'error') {
            setModal(null);
            report(error);
            return;
          }
          setModal((previous) =>
            previous && previous.kind === 'externalDetail' && externalDetailKey(previous.row) === key
              ? { ...previous, loading: false, error: runtime.errorText(error && error.code) }
              : previous,
          );
        }
      }

      function openTakeOver(detail) {
        if (!detail) return;
        const row = modal && modal.kind === 'externalDetail' ? modal.row : null;
        setModal({ kind: 'adoptConfirm', detail, row, error: null });
      }

      /** Auth/stale errors escape the discovery modal to the page banners. */
      function discoveryError(error) {
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
        return kind;
      }

      async function confirmAdopt() {
        const detail = modal && modal.kind === 'adoptConfirm' ? modal.detail : null;
        if (!detail || !page) return;
        if (typeof detail.patchId !== 'string' || detail.patchId === '') {
          setModal((previous) => (previous ? { ...previous, error: runtime.translate('external.unavailable') } : previous));
          return;
        }
        setBusy('adopt');
        try {
          await runtime.request('adoptExternal', {
            patchId: detail.patchId,
            revision: page.revision,
            confirm: true,
          });
          setModal(null);
          setNotice({ tone: 'success', text: translate('external.adoptOk', { name: detail.serverName }) });
          await load(true);
        } catch (error) {
          failModal(error);
        } finally {
          setBusy(null);
        }
      }

      function handleDiscoveryImported(summary) {
        setModal(null);
        const imported = summary && Array.isArray(summary.imported) ? summary.imported : [];
        const skipped = summary && Array.isArray(summary.skipped) ? summary.skipped : [];
        const codeList = skipped.map((item) => item.serverName + ': ' + item.code).join(', ');
        const text =
          imported.length > 0
            ? translate('discover.importSummary', { imported: imported.length, skipped: skipped.length })
            : translate('discover.importNothing', { list: codeList || '—' });
        const detail = skipped.length > 0 ? translate('discover.importSkipped', { list: codeList.slice(0, 400) }) : '';
        setNotice({ tone: imported.length > 0 ? 'success' : 'error', text, detail });
        void load(true);
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

      if (editView) {
        return h(
          'section',
          { className: 'mcpg-page' },
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
            : h('p', { className: 'mcpg-hint' }, translate('page.loading')),
          bannerAuth,
          bannerStale,
          bannerLoadError,
          bannerNotice,
        );
      }

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
      } else if (modal && modal.kind === 'externalDetail') {
        modals.push(
          h(ExternalDetailModal, {
            key: 'externalDetail',
            runtime,
            row: modal.row,
            detail: modal.detail || null,
            loading: modal.loading === true,
            error: modal.error || null,
            busy: busy === 'adopt',
            onClose: () => setModal(null),
            onTakeOver: openTakeOver,
          }),
        );
      } else if (modal && modal.kind === 'adoptConfirm') {
        modals.push(
          h(AdoptConfirmModal, {
            key: 'adoptConfirm',
            runtime,
            detail: modal.detail,
            busy: busy === 'adopt',
            error: modal.error || null,
            onClose: () =>
              setModal({
                kind: 'externalDetail',
                row: modal.row,
                detail: modal.detail,
                loading: false,
                error: null,
              }),
            onConfirm: confirmAdopt,
          }),
        );
      } else if (modal && modal.kind === 'discover') {
        modals.push(
          h(DiscoverModal, {
            key: 'discover',
            runtime,
            onClose: () => setModal(null),
            onError: discoveryError,
            onImported: handleDiscoveryImported,
          }),
        );
      }

      const installedEmpty = page && visibleServers.length === 0;
      const emptyMessage = query !== '' ? translate('list.noResults') : translate('page.empty');

      return h(
        'section',
        { className: 'mcpg-page' },
        h('h1', { className: 'mcpg-page-title' }, translate('nav.label')),
        h(
          'div',
          { className: 'mcpg-toolbar' },
          h(ScopePill, { runtime }),
          h('span', { className: 'mcpg-toolbar-divider', 'aria-hidden': 'true' }),
          h(
            'span',
            { className: 'mcpg-mcp-count' },
            h('b', null, translate('list.mcp')),
            h('span', null, String(totalCount)),
          ),
          h(SearchField, { runtime, value: search, onChange: setSearch }),
        ),
        bannerAuth,
        bannerStale,
        bannerLoadError,
        bannerOfficial,
        bannerNotice,
        h(
          'div',
          { className: 'mcpg-group-head' },
          h(
            'h2',
            { className: 'mcpg-group-title', 'aria-label': translate('a11y.managedSection') },
            translate('list.installed'),
            h('span', { className: 'mcpg-group-count' }, String(servers.length)),
          ),
          h(
            'div',
            { className: 'mcpg-group-actions' },
            h(Menu, {
              label: translate('list.more'),
              trigger: ({ open, toggle }) =>
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'mcpg-icon-btn',
                    'aria-haspopup': 'menu',
                    'aria-expanded': open ? 'true' : 'false',
                    'aria-label': translate('list.more'),
                    title: translate('list.more'),
                    disabled: !page || Boolean(busy),
                    onClick: toggle,
                  },
                  h(EllipsisIcon, null),
                ),
              children: (close) => [
                h(
                  'button',
                  {
                    key: 'discover',
                    type: 'button',
                    role: 'menuitem',
                    className: 'mcpg-menu-item',
                    disabled: !page,
                    onClick: () => {
                      close();
                      setModal({ kind: 'discover' });
                    },
                  },
                  h('span', { className: 'mcpg-menu-item-icon' }, h(SearchIcon, { size: 14 })),
                  h('span', null, translate('discover.menu')),
                ),
                h('hr', { key: 'sep', className: 'mcpg-menu-sep', 'aria-hidden': 'true' }),
                h(
                  'button',
                  {
                    key: 'import',
                    type: 'button',
                    role: 'menuitem',
                    className: 'mcpg-menu-item',
                    disabled: !page,
                    onClick: () => {
                      close();
                      setModal({ kind: 'import' });
                    },
                  },
                  h('span', { className: 'mcpg-menu-item-icon' }, h(ChevronRightIcon, null)),
                  h('span', null, translate('list.importMenu')),
                ),
                h(
                  'button',
                  {
                    key: 'export',
                    type: 'button',
                    role: 'menuitem',
                    className: 'mcpg-menu-item',
                    disabled: !page,
                    onClick: () => {
                      close();
                      setModal({ kind: 'export' });
                    },
                  },
                  h('span', { className: 'mcpg-menu-item-icon' }, h(ChevronRightIcon, null)),
                  h('span', null, translate('list.exportMenu')),
                ),
              ],
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'mcpg-icon-btn',
                'aria-label': translate('a11y.refresh'),
                title: translate('a11y.refresh'),
                disabled: loading || Boolean(busy),
                onClick: () => void load(false),
              },
              h(RefreshIcon, null),
            ),
            h(
              Button,
              {
                variant: 'primary',
                disabled: Boolean(busy) || !page || servers.length >= limited,
                onClick: openCreate,
                'aria-label': translate('a11y.newServer'),
              },
              h(PlusIcon, null),
              translate('list.new'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'mcpg-group' },
          !page
            ? h('div', { className: 'mcpg-empty-state' }, translate('page.loading'))
            : installedEmpty
              ? h('div', { className: 'mcpg-empty-state' }, emptyMessage)
              : visibleServers.map((row) =>
                  h(ServerRow, {
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
        h(ToolsSection, { runtime, servers: visibleServers }),
        external.length
          ? h(
              'div',
              { className: 'mcpg-group-head', style: { marginTop: '10px' } },
              h(
                'h2',
                { className: 'mcpg-group-title', 'aria-label': translate('a11y.externalSection') },
                translate('page.external'),
                h('span', { className: 'mcpg-group-count' }, String(external.length)),
              ),
            )
          : null,
        external.length ? h('p', { className: 'mcpg-group-hint' }, translate('list.externalHint')) : null,
        external.length
          ? h(
              'div',
              { className: 'mcpg-group' },
              visibleExternal.length
                ? visibleExternal.map((row, index) =>
                    h(ExternalRow, {
                      key: row.serverName || index,
                      runtime,
                      row,
                      detail: externalDetails[externalDetailKey(row)] || null,
                      onOpen: openExternalDetail,
                    }),
                  )
                : h('div', { className: 'mcpg-empty-state' }, translate('list.noResults')),
            )
          : null,
        page ? h(AuditSection, { runtime, entries: page.audit }) : null,
        modals,
      );
    }

    /* ------------------------------------------------------------------ */
    /* Icons for the settings navigation                                   */
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
