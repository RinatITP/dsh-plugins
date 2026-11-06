/**
 * Static check for the Host half: every Cordis service used through `ctx.<name>`
 * must either be declared in the plugin `inject` list or be accessed through the
 * optional `ctx.get(name)` accessor. A direct access to a non-injected service
 * throws at runtime (`cannot get property "…" without inject`) and takes the whole
 * plugin fiber down, which is exactly the failure this test prevents.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(PACKAGE_DIR, 'lib', 'host.js'), 'utf8');

/** Cordis context members that are always available and are not services. */
const CORE_MEMBERS = new Set(['fiber', 'get', 'on', 'effect', 'scope', 'root', 'emit']);

function injectList() {
  const match = /export const inject = \[([^\]]*)\]/.exec(source);
  assert.ok(match, 'host.js must declare an inject list');
  return match[1]
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter((item) => item !== '');
}

test('every ctx.<service> access is covered by inject or ctx.get', () => {
  const declared = new Set(injectList());
  const used = new Set();
  for (const match of source.matchAll(/\bctx\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) used.add(match[1]);
  const missing = [...used].filter((name) => !CORE_MEMBERS.has(name) && !declared.has(name));
  assert.deepEqual(missing, [], `services accessed without inject: ${missing.join(', ')}`);
});

test('inject list contains the services the plugin needs', () => {
  const declared = new Set(injectList());
  for (const service of ['webServer', 'connection', 'skills']) {
    assert.ok(declared.has(service), `missing required injection: ${service}`);
  }
});

test('optional services are reached through ctx.get, not direct access', () => {
  assert.doesNotMatch(source, /\bctx\.tools\b/);
  assert.doesNotMatch(source, /\bctx\.logger\b/);
  assert.doesNotMatch(source, /\bctx\.workspaceRegistry\b/);
  assert.doesNotMatch(source, /\bctx\.sessions\b/);
});
