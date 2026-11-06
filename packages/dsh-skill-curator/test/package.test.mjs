/**
 * Package manifest, bundle patch, locales and display resources.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'));

test('manifest identifies the plugin and targets the DSH 0.2.x line', () => {
  assert.equal(manifest.name, 'dsh-skill-curator');
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.license, 'MIT');
  assert.match(manifest.engines.dsh, />=0\.2\.2-rc\.1 <0\.3\.0-0/);
  assert.match(manifest.engines.node, />=22/);
});

test('declares the bundle patch and the web client half', () => {
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.ok(Array.isArray(manifest.dsh.client.inject));
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'));
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'));
});

test('exports the host, client, locales and icon', () => {
  assert.equal(manifest.exports['.'], './index.js');
  assert.equal(manifest.exports['./client'], './client.js');
  assert.equal(manifest.icon, './icon.svg');
  assert.ok(Object.keys(manifest.exports).some((key) => key.includes('locale')));
});

test('ships runtime files, patch, locales and icon in the published files list', () => {
  const files = manifest.files;
  for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md']) {
    assert.ok(files.includes(required), `missing files entry: ${required}`);
    assert.ok(existsSync(path.join(PACKAGE_DIR, required)), `missing file: ${required}`);
  }
  assert.ok(files.includes('lib'));
  assert.ok(files.some((entry) => entry.startsWith('locale')));
  assert.ok(existsSync(path.join(PACKAGE_DIR, 'lib', 'host.js')));
});

test('bundle patch mounts exactly one row with the package name', () => {
  const patch = readFileSync(path.join(PACKAGE_DIR, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /^-\s+insert:\s*$/m);
  assert.match(patch, /\bid:\s*dsh-skill-curator\s*$/m);
  assert.match(patch, /\bname:\s*dsh-skill-curator\s*$/m);
});

test('locale files carry meta.title and meta.description', () => {
  for (const locale of ['en', 'ru']) {
    const data = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'locale', `${locale}.json`), 'utf8'));
    assert.equal(typeof data.meta.title, 'string');
    assert.ok(data.meta.title.length > 0);
    assert.equal(typeof data.meta.description, 'string');
    assert.ok(data.meta.description.length > 0);
  }
});

test('icon is an SVG under the display limit', () => {
  const text = readFileSync(path.join(PACKAGE_DIR, 'icon.svg'), 'utf8').trim();
  assert.ok(text.startsWith('<svg'));
  assert.ok(Buffer.byteLength(text) < 256 * 1024);
});

test('the package declares no third-party runtime dependencies', () => {
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.peerDependencies, undefined);
});
