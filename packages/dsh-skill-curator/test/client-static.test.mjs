/**
 * Static checks for the Client half. Nothing here renders React: the source is
 * parsed for the registration contract, the API transport, dictionary parity
 * and the absence of unsafe DOM patterns.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(PACKAGE_DIR, 'client.js'), 'utf8');

function extractObjectLiteral(variableName) {
  const marker = new RegExp('const\\s+' + variableName + '\\s*=\\s*\\{');
  const match = marker.exec(source);
  assert.ok(match, `missing object literal: ${variableName}`);
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
  assert.fail(`unterminated object literal: ${variableName}`);
}

const DICT_EN = extractObjectLiteral('DICT_EN');
const DICT_RU = extractObjectLiteral('DICT_RU');

test('registers the plugin through the browser module loader', () => {
  assert.match(source, /window\.__ModuleLoader__\.load\(\{/);
  assert.match(source, /id:\s*'dsh-skill-curator'/);
  assert.match(source, /const inject = \['slots', 'locale'\]/);
});

test('registers one settings section and one icon in the same slot id', () => {
  assert.match(source, /ctx\.slots\.inject\('settings\.section'/);
  assert.match(source, /name:\s*'settings\.section',\s*\n\s*id:\s*'skill-curator'/);
  assert.match(source, /order:\s*SECTION_ORDER/);
  assert.match(source, /name:\s*'settings\.section\.icon',\s*\n\s*id:\s*'skill-curator'/);
  assert.match(source, /ctx\.locale\.register\(LOCALE_NS/);
});

test('talks to the exact host route with the intent header', () => {
  assert.match(source, /const API_PATH = '\/api\/dsh-skill-curator'/);
  assert.match(source, /const API_HEADER = 'x-dsh-skill-curator'/);
  assert.match(source, /headers\[API_HEADER\] = '1'/);
  assert.match(source, /credentials: 'same-origin'/);
  assert.match(source, /requestApi\('snapshot'/);
  assert.match(source, /requestApi\('detail'/);
  assert.match(source, /requestApi\('readFile'/);
  for (const action of ['validate', 'save', 'writeFile', 'toggle', 'create', 'remove', 'trashList', 'restore', 'importScan', 'importApply']) {
    assert.match(source, new RegExp("requestApi\\('" + action + "'"), `missing mutation action: ${action}`);
  }
  assert.match(source, /confirm: true/);
  assert.match(source, /x-dsh-skill-curator/);
});

test('Russian and English dictionaries have identical, non-empty keys', () => {
  const enKeys = Object.keys(DICT_EN).sort();
  const ruKeys = Object.keys(DICT_RU).sort();
  assert.deepEqual(ruKeys, enKeys);
  for (const key of enKeys) {
    assert.equal(typeof DICT_EN[key], 'string');
    assert.equal(typeof DICT_RU[key], 'string');
    assert.ok(DICT_EN[key].length > 0, `empty EN value for ${key}`);
    assert.ok(DICT_RU[key].length > 0, `empty RU value for ${key}`);
  }
  assert.equal(DICT_RU['nav.label'], 'Навыки');
  assert.equal(DICT_EN['nav.label'], 'Skills');
});

test('uses theme tokens and plugin-scoped styles only', () => {
  assert.match(source, /data-plugin="dsh-skill-curator"/);
  assert.match(source, /--dsw-alias-label-primary/);
  assert.match(source, /<style/);
  assert.doesNotMatch(source, /document\.body/);
  assert.doesNotMatch(source, /insertAdjacentHTML/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /\beval\(/);
});

test('declares the read-only stage capability in the UI copy', () => {
  assert.match(source, /read-only|только чтение/i);
  assert.match(source, /requestApi\('readFile'/);
  for (const action of ['validate', 'save', 'writeFile', 'toggle', 'create', 'remove', 'trashList', 'restore', 'importScan', 'importApply']) {
    assert.match(source, new RegExp("requestApi\\('" + action + "'"), `missing mutation action: ${action}`);
  }
  assert.match(source, /confirm: true/);
  assert.match(source, /x-dsh-skill-curator/);
});
