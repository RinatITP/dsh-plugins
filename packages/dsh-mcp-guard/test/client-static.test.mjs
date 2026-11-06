/**
 * Static checks for the dsh-mcp-guard Client half.
 *
 * These checks never execute `client.js` in a browser and never attempt React
 * rendering: they parse the file, verify the registration contract strings, the
 * HTTP transport requirements, the locale dictionaries and the icon asset.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_PATH = path.join(PACKAGE_DIR, 'client.js');
const LOCALE_DIR = path.join(PACKAGE_DIR, 'locale');
const ICON_PATH = path.join(PACKAGE_DIR, 'icon.svg');
const PACKAGE_JSON_PATH = path.join(PACKAGE_DIR, 'package.json');

const clientSource = fs.readFileSync(CLIENT_PATH, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));

/** Extract a top-level object literal assigned to `const <name> = { ... }`. */
function extractObjectLiteral(source, variableName) {
  const marker = new RegExp('const\\s+' + variableName + '\\s*=\\s*\\{');
  const match = marker.exec(source);
  assert.ok(match, 'missing object literal: ' + variableName);
  const start = match.index + match[0].length - 1;
  let depth = 0;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const ch = source[index];
    if (quote !== null) {
      if (ch === '\\') {
        index += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const text = source.slice(start, index + 1);
        return new Function('return (' + text + ');')();
      }
    }
  }
  assert.fail('unterminated object literal: ' + variableName);
}

const DICT_EN = extractObjectLiteral(clientSource, 'DICT_EN');
const DICT_RU = extractObjectLiteral(clientSource, 'DICT_RU');

const CONTRACT_ERROR_CODES = [
  'NAME_INVALID',
  'NAME_CONFLICT',
  'TRANSPORT_INVALID',
  'STDIO_COMMAND_REQUIRED',
  'STDIO_COMMAND_INVALID',
  'STDIO_ARGS_INVALID',
  'STDIO_CWD_INVALID',
  'STDIO_ENV_INVALID',
  'HTTP_URL_REQUIRED',
  'HTTP_URL_INVALID',
  'HTTP_PLAINTEXT_BLOCKED',
  'HTTP_HEADERS_INVALID',
  'ENV_EXECUTION_OVERRIDE',
  'FIELD_UNKNOWN',
  'EXPRESSION_UNSUPPORTED',
  'SECRET_KEEP_UNAVAILABLE',
  'TIMEOUT_INVALID',
  'RECONNECT_INVALID',
  'MAX_INSTRUCTION_INVALID',
  'TOO_MANY_SERVERS',
  'TOO_MANY_ENV',
  'TOO_MANY_HEADERS',
  'VALUE_TOO_LONG',
  'IMPORT_INPUT_INVALID',
  'IMPORT_TOO_LARGE',
  'IMPORT_JSON_INVALID',
  'IMPORT_UNSAFE_KEY',
  'IMPORT_DUPLICATE_KEY',
  'IMPORT_SHAPE',
  'IMPORT_TOO_MANY_SERVERS',
  'IMPORT_NAME_INVALID',
  'IMPORT_NAME_CONFLICT',
  'IMPORT_SERVER_INVALID',
  'IMPORT_UNKNOWN_FIELD',
  'IMPORT_TYPE_INVALID',
  'IMPORT_TRANSPORT_CONFLICT',
  'IMPORT_URL_INVALID',
  'IMPORT_COMMAND_INVALID',
  'IMPORT_ARGS_INVALID',
  'IMPORT_ENV_INVALID',
  'IMPORT_HEADERS_INVALID',
  'IMPORT_CWD_INVALID',
  'NOT_FOUND',
  'CONFIRM_REQUIRED',
  'STALE_CONFIGURATION',
  'CONFIGURATION_UNAVAILABLE',
  'INVALID_REQUEST',
  'METHOD_NOT_ALLOWED',
  'CONTENT_TYPE',
  'BODY_TOO_LARGE',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'OPERATION_FAILED',
  'OFFICIAL_CLIENT_UNAVAILABLE',
  'CHECK_UNAVAILABLE',
  'RISK_BLOCKED',
  'RISK_ACK_REQUIRED',
  'CONFIGURATION_INVALID',
  'EXTERNAL_UNAVAILABLE',
  'EXTERNAL_DISABLE_FAILED',
  'ADOPT_FAILED',
  'ADOPT_ROLLBACK_FAILED',
  'DISCOVERY_UNAVAILABLE',
  'SOURCE_NOT_FOUND',
  'SOURCE_TOO_LARGE',
  'SOURCE_UNREADABLE',
  'SOURCE_INVALID_JSON',
  'SOURCE_INVALID_ENTRY',
];

const CONTRACT_RISK_CODES = [
  'risk.localExecution',
  'risk.remoteEndpoint',
  'risk.packageRunnerAutoInstall',
  'risk.packageRunnerUnpinned',
  'risk.shellInterpreter',
  'risk.codeEvalFlag',
  'risk.elevatedCommand',
  'risk.plainHttpLoopback',
  'risk.plainHttpAllowlisted',
  'risk.secretInArgs',
  'risk.envSecretLiteral',
  'risk.namespaceAmbiguous',
  'risk.cwdSystemRoot',
  'risk.timeoutLong',
  'risk.reconnectDisabled',
];

test('files required by the client half exist', () => {
  for (const file of ['client.js', 'locale/en.json', 'locale/ru.json', 'icon.svg']) {
    assert.ok(fs.existsSync(path.join(PACKAGE_DIR, file)), 'missing file: ' + file);
  }
});

test('client.js parses as plain JavaScript (node --check)', () => {
  const result = execFileSync(process.execPath, ['--check', CLIENT_PATH], { encoding: 'utf8', stdio: 'pipe' });
  assert.equal(typeof result, 'string');
});

test('client.js is loaded through the DSH module loader with the package id', () => {
  assert.match(clientSource, /window\.__ModuleLoader__\.load\(\{/);
  assert.match(clientSource, /id:\s*'dsh-mcp-guard'/);
  assert.match(clientSource, /factory\(require\)\s*\{/);
  assert.match(clientSource, /const React = require\('react'\)/);
  assert.match(clientSource, /const inject = \['slots', 'locale'\]/);
  assert.match(clientSource, /return \{ inject, apply \}/);
});

test('client.js imports only react from the browser module table', () => {
  const modules = [...clientSource.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(modules)], ['react']);
  assert.doesNotMatch(clientSource, /@deepseek-ai\/dsh-client/);
});

test('settings.section registration matches the contract (id, order, localized label, cleanup)', () => {
  assert.match(clientSource, /ctx\.slots\.inject\('settings\.section'/);
  assert.match(clientSource, /name:\s*'settings\.section'/);
  assert.match(clientSource, /id:\s*'mcp-guard'/);
  assert.match(clientSource, /order:\s*22/);
  assert.match(clientSource, /label:\s*\(\)\s*=>\s*runtime\.translate\('nav\.label'\)/);
  assert.match(clientSource, /locale:\s*LOCALE_NS/);
  assert.match(clientSource, /ctx\.effect\(/);
  assert.ok(clientSource.includes("'nav.label'"));
  assert.ok(clientSource.includes("'MCP servers'"));
  assert.ok(clientSource.includes('MCP-серверы'));
});

test('locale dictionaries are registered through ctx.locale with a safe fallback', () => {
  assert.match(clientSource, /ctx\.locale\.register\(LOCALE_NS, \{ en: DICT_EN, ru: DICT_RU \}\)/);
  assert.match(clientSource, /already has locale/);
});

test('HTTP transport uses the exact route, header, credentials and actions', () => {
  assert.ok(clientSource.includes("const API_PATH = '/api/dsh-mcp-guard'"));
  assert.ok(clientSource.includes("const API_HEADER = 'x-dsh-mcp-guard'"));
  assert.match(clientSource, /credentials:\s*'same-origin'/);
  assert.match(clientSource, /headers\[API_HEADER\] = '1'/);
  for (const action of [
    'analyze',
    'create',
    'update',
    'remove',
    'toggle',
    'executionPreview',
    'check',
    'previewImport',
    'import',
    'export',
  ]) {
    assert.ok(clientSource.includes("'" + action + "'"), 'missing action: ' + action);
  }
  assert.ok(clientSource.includes('acknowledgeRisk'));
  assert.ok(clientSource.includes('confirm: true'));
  assert.ok(clientSource.includes('409') || clientSource.includes('STALE_CONFIGURATION'));
  assert.ok(clientSource.includes('STALE_CONFIGURATION'));
  assert.ok(clientSource.includes('UNAUTHENTICATED'));
  assert.ok(clientSource.includes('FORBIDDEN'));
});

test('write-only secret handling is present', () => {
  // Env/header values are edited as JSON text with keep-on-empty semantics; the
  // client never renders a stored secret and sends {key, keep:true} for blanks.
  assert.ok(clientSource.includes('keep: true'));
  assert.ok(clientSource.includes('entriesToPayload'));
  assert.ok(clientSource.includes('jsonTextToEntries'));
  assert.ok(clientSource.includes('clearAck'));
  assert.match(clientSource, /stored === true && \(entry\.value === undefined \|\| entry\.value === ''\)/);
  assert.match(clientSource, /value: '', stored: true/);
});

test('Z.ai-style list markup is present (title, scope pill, search, groups, rows)', () => {
  assert.match(clientSource, /className: 'mcpg-page-title'/);
  assert.match(clientSource, /mcpg-scope-pill/);
  assert.ok(clientSource.includes("'list.scope'"));
  assert.ok(clientSource.includes("'list.scopeUser'"));
  assert.ok(clientSource.includes("'list.scopeProjects'"));
  assert.ok(clientSource.includes("'list.scopeComingSoon'"));
  assert.match(clientSource, /className: 'mcpg-search-input'/);
  assert.ok(clientSource.includes("'list.search'"));
  assert.match(clientSource, /className: 'mcpg-group-title'/);
  assert.ok(clientSource.includes("'list.installed'"));
  assert.match(clientSource, /className: 'mcpg-row'/);
  assert.match(clientSource, /className: 'mcpg-row-icon'/);
  assert.match(clientSource, /className: 'mcpg-row-sub-text'/);
  assert.match(clientSource, /className: 'mcpg-row-end'/);
  assert.ok(clientSource.includes("'list.new'"));
  assert.ok(clientSource.includes("'list.importMenu'"));
  assert.ok(clientSource.includes("'list.exportMenu'"));
  assert.ok(clientSource.includes("'list.noResults'"));
  assert.ok(clientSource.includes("'page.external'"));
  assert.ok(clientSource.includes('Managed by other plugins'));
  assert.ok(clientSource.includes('MCP-серверы'));
  assert.ok(clientSource.includes("'list.externalHint'"));
});

test('list subtitle and edit prefill use the new non-secret Host fields defensively', () => {
  // Subtitle: command/args for stdio, url for streamable-http, with endpoint fallback.
  assert.match(clientSource, /typeof server\.command === 'string'/);
  assert.match(clientSource, /Array\.isArray\(server\.args\)/);
  assert.match(clientSource, /typeof server\.url === 'string'/);
  assert.match(clientSource, /serverSubtitle/);
  assert.ok(clientSource.includes("'stdio · '"));
  assert.ok(clientSource.includes("'streamable-http · '"));
  // Edit prefill from ServerView when the Host provides it.
  assert.match(clientSource, /draft\.argsText = server\.args\.map/);
  assert.match(clientSource, /draft\.command = server\.command/);
  assert.match(clientSource, /draft\.url = server\.url/);
  assert.match(clientSource, /draft\.cwd = server\.cwd/);
  assert.match(clientSource, /serverHasDetails/);
});

test('Z.ai-style form and JSON tabs are present (breadcrumbs, card, segmented tabs)', () => {
  assert.match(clientSource, /className: 'mcpg-breadcrumbs'/);
  assert.match(clientSource, /className: 'mcpg-crumb-current'/);
  assert.match(clientSource, /className: 'mcpg-form-title'/);
  assert.match(clientSource, /className: 'mcpg-form-subtitle'/);
  assert.match(clientSource, /className: 'mcpg-card mcpg-form-card'/);
  assert.match(clientSource, /className: 'mcpg-form-footer'/);
  assert.match(clientSource, /className: 'mcpg-tabs'/);
  assert.ok(clientSource.includes("'form.fullConfiguration'"));
  assert.ok(clientSource.includes("'form.subtitleCreate'"));
  assert.ok(clientSource.includes("'form.newTitle'"));
  assert.ok(clientSource.includes("'form.envOptional'"));
  assert.ok(clientSource.includes("'form.headersOptional'"));
  assert.ok(clientSource.includes("'form.envJsonHint'"));
  assert.ok(clientSource.includes("'form.jsonHintLong'"));
  assert.ok(clientSource.includes("'form.protocolAuto'"));
  assert.ok(clientSource.includes("Auto (recommended)"));
  assert.ok(clientSource.includes("stdio (local command)"));
});

test('JSON tab accepts both server-key and mcpServers envelopes', () => {
  assert.match(clientSource, /isPlainObject\(parsed\.mcpServers\)/);
  assert.ok(clientSource.includes('You can paste'));
  assert.ok(clientSource.includes("'form.jsonHintLong'"));
});

test('style is a single injected style element owned by the plugin with token-only colors', () => {
  assert.equal((clientSource.match(/document\.createElement\('style'\)/g) || []).length, 1);
  assert.match(clientSource, /tag\.dataset\.plugin = PLUGIN_ID/);
  assert.match(clientSource, /const PLUGIN_ID = 'dsh-mcp-guard'/);
  assert.match(clientSource, /ctx\.effect\(\(\) => installStyles\(\)/);
  assert.match(clientSource, /--dsw-alias-label-primary/);
  assert.match(clientSource, /--dsw-alias-settings-card-fill/);
  assert.match(clientSource, /--dsw-alias-settings-card-stroke/);
  assert.match(clientSource, /--dsw-alias-bg-mask-1/);
  assert.doesNotMatch(clientSource, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(clientSource, /\brgba?\(/i);
  assert.doesNotMatch(clientSource, /\bhsla?\(/i);
  assert.doesNotMatch(clientSource, /document\.body/);
  assert.doesNotMatch(clientSource, /document\.documentElement/);
});

test('accessibility contracts are present', () => {
  assert.match(clientSource, /role:\s*'switch'/);
  assert.match(clientSource, /'aria-checked'/);
  assert.match(clientSource, /'aria-live'/);
  assert.match(clientSource, /role:\s*'dialog'/);
  assert.match(clientSource, /'aria-modal':\s*'true'/);
  assert.match(clientSource, /event\.key === 'Escape'/);
});

test('no literal credential material is embedded in client.js', () => {
  // Patterns are assembled from fragments so this test file itself contains no
  // secret-shaped literal that a repository scanner could mistake for a leak.
  const shapes = [
    new RegExp('s' + 'k-[A-Za-z0-9_-]{16,}'),
    new RegExp('g' + 'hp_[A-Za-z0-9]{20,}'),
    new RegExp('xo' + 'xb-[A-Za-z0-9-]{10,}'),
    new RegExp('AK' + 'IA[0-9A-Z]{16}'),
  ];
  for (const shape of shapes) assert.doesNotMatch(clientSource, shape);
});

test('English and Russian dictionaries have identical key sets', () => {
  const enKeys = Object.keys(DICT_EN).sort();
  const ruKeys = Object.keys(DICT_RU).sort();
  assert.deepEqual(ruKeys, enKeys);
  assert.ok(enKeys.includes('nav.label'));
  assert.ok(enKeys.includes('error.unknown'));
});

test('dictionary values are non-empty and placeholders survive translation', () => {
  for (const key of Object.keys(DICT_EN)) {
    assert.equal(typeof DICT_EN[key], 'string', 'non-string EN value: ' + key);
    assert.equal(typeof DICT_RU[key], 'string', 'non-string RU value: ' + key);
    assert.ok(DICT_EN[key].trim().length > 0, 'empty EN value: ' + key);
    assert.ok(DICT_RU[key].trim().length > 0, 'empty RU value: ' + key);
    const placeholders = (DICT_EN[key].match(/\{[a-zA-Z]+\}/g) || []).sort();
    const ruPlaceholders = (DICT_RU[key].match(/\{[a-zA-Z]+\}/g) || []).sort();
    assert.deepEqual(ruPlaceholders, placeholders, 'placeholder mismatch: ' + key);
  }
});

test('every contract error code is localized', () => {
  for (const code of CONTRACT_ERROR_CODES) {
    assert.ok(Object.hasOwn(DICT_EN, 'error.' + code), 'missing EN message for ' + code);
    assert.ok(Object.hasOwn(DICT_RU, 'error.' + code), 'missing RU message for ' + code);
  }
});

test('every contract risk code is localized with a level label', () => {
  for (const code of CONTRACT_RISK_CODES) {
    assert.ok(Object.hasOwn(DICT_EN, code), 'missing EN risk text for ' + code);
    assert.ok(Object.hasOwn(DICT_RU, code), 'missing RU risk text for ' + code);
  }
  for (const level of ['critical', 'high', 'medium', 'low', 'info']) {
    assert.ok(Object.hasOwn(DICT_EN, 'risk.level.' + level), 'missing EN level ' + level);
    assert.ok(Object.hasOwn(DICT_RU, 'risk.level.' + level), 'missing RU level ' + level);
  }
});

test('every literal translate() key used by the client exists in the dictionaries', () => {
  const keys = new Set();
  for (const match of clientSource.matchAll(/(?:translate|optionalText)\(\s*'([^']+)'/g)) keys.add(match[1]);
  for (const key of [...keys].sort()) {
    if (key.endsWith('.')) continue;
    if (key.startsWith('error.') || key.startsWith('risk.')) continue;
    assert.ok(Object.hasOwn(DICT_EN, key), 'missing EN dictionary key: ' + key);
    assert.ok(Object.hasOwn(DICT_RU, key), 'missing RU dictionary key: ' + key);
  }
});

test('locale json files parse and carry Plugin Manager metadata', () => {
  for (const locale of ['en', 'ru']) {
    const file = path.join(LOCALE_DIR, locale + '.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(typeof parsed.meta.title, 'string');
    assert.equal(typeof parsed.meta.description, 'string');
    assert.ok(parsed.meta.title.trim().length > 0);
    assert.ok(parsed.meta.description.trim().length > 0);
  }
  const en = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, 'en.json'), 'utf8'));
  const ru = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, 'ru.json'), 'utf8'));
  assert.notEqual(en.meta.title, ru.meta.title);
  assert.notEqual(en.meta.description, ru.meta.description);
});

test('icon.svg is a valid, self-contained SVG under 256 KiB', () => {
  const stat = fs.statSync(ICON_PATH);
  assert.ok(stat.size > 0 && stat.size < 256 * 1024, 'icon size out of range: ' + stat.size);
  const svg = fs.readFileSync(ICON_PATH, 'utf8').trim();
  assert.ok(svg.startsWith('<svg'), 'icon must start with <svg');
  assert.ok(svg.endsWith('</svg>'), 'icon must end with </svg>');
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, /<foreignObject/i);
  assert.doesNotMatch(svg, /href="https?:/i);
  assert.doesNotMatch(svg, /xlink:href/i);
});

test('package.json wires the delivered client, locale files and icon', () => {
  assert.equal(packageJson.exports['./client'], './client.js');
  assert.equal(packageJson.dsh.client.platform, 'web');
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'));
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'));
  assert.equal(packageJson.icon, './icon.svg');
  assert.ok(packageJson.files.includes('client.js'));
  assert.ok(packageJson.files.includes('icon.svg'));
});


test('external rows: read-only detail modal and takeover are wired', () => {
  // Host actions for inspecting and adopting an external MCP row.
  assert.match(clientSource, /runtime\.request\(\s*'externalDetail'/);
  assert.match(clientSource, /runtime\.request\(\s*'adoptExternal'/);
  assert.ok(clientSource.includes("patchId: detail.patchId"));
  assert.ok(clientSource.includes('revision: page.revision'));
  assert.ok(clientSource.includes("confirm: true"));
  // The external row renders like a managed row and opens the detail modal.
  assert.match(clientSource, /function ExternalRow\(/);
  assert.match(clientSource, /function ExternalDetailModal\(/);
  assert.match(clientSource, /function AdoptConfirmModal\(/);
  assert.match(clientSource, /onOpenExternalDetail|onOpen: openExternalDetail/);
  assert.ok(clientSource.includes("'a11y.externalRow'"));
  assert.ok(clientSource.includes("'external.notOwned'"));
  assert.ok(clientSource.includes("'external.takeOver'"));
  assert.ok(clientSource.includes("'external.adoptTitle'"));
  assert.ok(clientSource.includes("'external.adoptStep1'"));
  assert.ok(clientSource.includes("'external.adoptStep2'"));
  assert.ok(clientSource.includes("'external.adoptStep3'"));
  assert.ok(clientSource.includes("'external.sourceLabel'"));
  assert.ok(clientSource.includes("'external.toolsEmpty'"));
  // External rows are read-only: no switch inside ExternalRow.
  const start = clientSource.indexOf('function ExternalRow(');
  const end = clientSource.indexOf('function AuditSection(', start);
  assert.ok(start > 0 && end > start);
  const externalBody = clientSource.slice(start, end);
  assert.ok(!externalBody.includes('h(Switch'));
  assert.ok(!externalBody.includes('toggle'));
  const adoptStart = clientSource.indexOf('function AdoptConfirmModal(');
  const adoptEnd = clientSource.indexOf('function normalizeImportResult(', adoptStart);
  assert.ok(adoptStart > 0 && adoptEnd > adoptStart);
  const adoptBody = clientSource.slice(adoptStart, adoptEnd);
  assert.ok(adoptBody.includes("tr('external.adoptStep2')"));
});

test('external detail falls back from patchId to serverName and caches lookups', () => {
  assert.match(clientSource, /patchId\s*\?\s*\{\s*patchId:\s*row\.patchId\s*\}\s*:\s*\{\s*serverName:\s*row\.serverName\s*\}/);
  assert.match(clientSource, /function externalDetailKey\(/);
  assert.match(clientSource, /function cacheExternalDetail\(/);
  assert.match(clientSource, /function fetchExternalDetail\(/);
});

test('discovery modal and per-source import are wired with a fresh revision', () => {
  assert.match(clientSource, /function DiscoverModal\(/);
  assert.match(clientSource, /runtime\.request\(\s*'discover'\s*\)/);
  assert.match(clientSource, /runtime\.request\(\s*'importDiscovered'/);
  // A fresh GET snapshot is fetched before each per-source import call.
  assert.match(clientSource, /const snapshot = await runtime\.request\(null\)/);
  assert.ok(clientSource.includes('sourceId'));
  assert.ok(clientSource.includes('serverNames: names'));
  assert.ok(clientSource.includes("confirm: true"));
  // Menu entry, selection, badges and empty/loading states.
  assert.ok(clientSource.includes("'discover.menu'"));
  assert.ok(clientSource.includes("'discover.title'"));
  assert.ok(clientSource.includes("'discover.hint'"));
  assert.ok(clientSource.includes("'discover.loading'"));
  assert.ok(clientSource.includes("'discover.empty'"));
  assert.ok(clientSource.includes("'discover.selectAll'"));
  assert.ok(clientSource.includes("'discover.importSelected'"));
  assert.ok(clientSource.includes("'discover.importSummary'"));
  assert.ok(clientSource.includes("'discover.importSkipped'"));
  assert.ok(clientSource.includes("'discover.importNothing'"));
  assert.ok(clientSource.includes("'discover.alreadyManaged'"));
  assert.ok(clientSource.includes("'discover.alreadyExternal'"));
  assert.ok(clientSource.includes("'discover.needsPlainHttp'"));
  assert.ok(clientSource.includes("setModal({ kind: 'discover' })"));
  assert.match(clientSource, /onImported: handleDiscoveryImported/);
  // Import aggregate is normalized defensively (array / count forms).
  assert.match(clientSource, /function normalizeImportResult\(/);
  assert.ok(clientSource.includes('Array.isArray(source.imported)'));
});

test('new audit/adoption and discovery keys exist in both dictionaries', () => {
  const required = [
    'external.source',
    'external.sourceLabel',
    'external.notOwned',
    'external.detailTitle',
    'external.loading',
    'external.unavailable',
    'external.takeOver',
    'external.adoptTitle',
    'external.adoptStep1',
    'external.adoptStep2',
    'external.adoptStep3',
    'external.adoptOk',
    'external.patchId',
    'external.toolsEmpty',
    'discover.menu',
    'discover.title',
    'discover.hint',
    'discover.loading',
    'discover.rescan',
    'discover.empty',
    'discover.emptyHint',
    'discover.sourceError',
    'discover.alreadyManaged',
    'discover.alreadyExternal',
    'discover.needsPlainHttp',
    'discover.unsupported',
    'discover.selectAll',
    'discover.selected',
    'discover.importSelected',
    'discover.importing',
    'discover.importSummary',
    'discover.importSkipped',
    'discover.importNothing',
    'discover.noSelection',
    'discover.scope',
    'audit.action.adopt',
  ];
  for (const key of required) {
    assert.ok(Object.hasOwn(DICT_EN, key), 'missing EN dictionary key: ' + key);
    assert.ok(Object.hasOwn(DICT_RU, key), 'missing RU dictionary key: ' + key);
  }
});
