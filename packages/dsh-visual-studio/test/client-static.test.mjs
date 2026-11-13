import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const client = readFileSync(join(PACKAGE_DIR, 'client.js'), 'utf8');

test('client registers both tool views and the sidebar tab type', () => {
  assert.match(client, /ctx\.slots\.inject\('tool\.call\.toolview'/);
  assert.equal((client.match(/key: 'visual_ask'/g) ?? []).length, 1);
  assert.equal((client.match(/key: 'visual_publish'/g) ?? []).length, 1);
  assert.match(client, /ctx\.inject\(\['sidebarRightTabs'\]/);
  assert.match(client, /sidebarTabs\.register\(\{/);
  assert.match(client, /name: 'sidebar\.right\.pane\.tab'/);
  assert.match(client, /guide: \[\{/);
});

test('client polls the manifest and embeds visuals through a sandbox', () => {
  assert.match(client, /const POLL_MS = 2500/);
  assert.match(client, /setInterval\(/);
  assert.match(client, /sandbox: 'allow-scripts'/);
  assert.match(client, /\/plugins\/dsh-visual-studio\/manifest/);
  assert.match(client, /\/plugins\/dsh-visual-studio\/artifact/);
  assert.match(client, /\/plugins\/dsh-visual-studio\/ask/);
});

test('client posts the answer with the intent header and the call id', () => {
  assert.match(client, /const HEADER = 'x-dsh-visual-studio'/);
  assert.match(client, /headers\[HEADER\] = '1'/);
  assert.match(client, /body: \{ callId, selections \}/);
});

test('client uses theme tokens, not literal palette colors, for chrome', () => {
  assert.match(client, /--dsw-alias-bg-layer-1/);
  assert.match(client, /--dsw-alias-label-primary/);
  assert.match(client, /--dsw-alias-brand-primary/);
  assert.doesNotMatch(client, /\.dvs-widget[^}]*background:\s*#fff/);
});

test('client does not reach outside its slot contract', () => {
  assert.doesNotMatch(client, /document\.write/);
  assert.doesNotMatch(client, /localStorage/);
  assert.doesNotMatch(client, /require\('@deepseek-ai/);
  assert.doesNotMatch(client, /from '@deepseek-ai/);
});

test('download responses use an ASCII-safe disposition header', () => {
  const http = readFileSync(join(PACKAGE_DIR, 'lib', 'http.js'), 'utf8');
  assert.match(http, /filename\*=UTF-8''/);
  assert.doesNotMatch(http, /content-disposition.*[А-Яа-я]/);
});

test('answered widget stays reviewable: expandable summary and replay parser', () => {
  assert.match(client, /deriveAskAnswer/);
  assert.match(client, /dvs-done-head/);
  assert.match(client, /showAnswers/);
  assert.match(client, /\^•\(\\\*\)\?/);
  assert.match(client, /resultText\(props\)/);
});

test('host records structured widget metadata for replay', () => {
  const host = readFileSync(join(PACKAGE_DIR, 'lib', 'host.js'), 'utf8');
  assert.match(host, /presentationMeta/);
  assert.match(host, /dsh-visual-studio\/ask/);
  assert.match(host, /•\$\{selection\.changed/);
});
