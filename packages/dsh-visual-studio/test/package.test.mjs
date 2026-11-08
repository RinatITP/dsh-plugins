import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_DIR, '..', '..');

function read(relative) {
  return readFileSync(join(PACKAGE_DIR, relative), 'utf8');
}

test('manifest declares the bundle patch, the client half and the DSH range', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.name, 'dsh-visual-studio');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.exports['.'], './index.js');
  assert.equal(manifest.exports['./client'], './client.js');
  assert.ok(manifest.exports['./locale/*.json']);
  assert.ok(manifest.exports['./icon']);
  assert.equal(manifest.dsh.manifestVersion, 1);
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.dsh.client.immediately, true);
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'));
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-tool'));
  assert.match(manifest.engines.dsh, /0\.2\.2-rc\.1/);
  for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'lib/host.js', 'lib/store.js', 'lib/ask.js', 'lib/http.js', 'lib/spec.js', 'lib/guidelines.js',
    'lib/templates.js',
    'lib/project.js', 'locale/en.json', 'locale/ru.json']) {
    assert.ok(existsSync(join(PACKAGE_DIR, file)), `missing ${file}`);
  }
});

test('bundle patch inserts one local row', () => {
  const patch = read('cordis.patch.yml');
  assert.match(patch, /- insert:/);
  assert.match(patch, /id: dsh-visual-studio/);
  assert.match(patch, /name: dsh-visual-studio/);
});

test('locales carry display metadata in both shipped languages', () => {
  for (const locale of ['en', 'ru']) {
    const value = JSON.parse(read(`locale/${locale}.json`));
    assert.equal(typeof value.meta?.title, 'string');
    assert.equal(typeof value.meta?.description, 'string');
    assert.ok(value.meta.title.length > 3);
    assert.ok(value.meta.description.length > 10);
  }
});

test('icon is a bounded SVG inside the package', () => {
  const icon = read('icon.svg');
  assert.ok(icon.trimStart().startsWith('<svg'));
  assert.ok(statSync(join(PACKAGE_DIR, 'icon.svg')).size <= 256 * 1024);
  assert.match(icon, /viewBox="0 0 64 64"/);
});

test('client half is a plain module-loader factory with no bundler output', () => {
  const client = read('client.js');
  assert.match(client, /window\.__ModuleLoader__\.load\(\{/);
  assert.match(client, /id: 'dsh-visual-studio'/);
  assert.match(client, /factory\(require\)/);
  assert.match(client, /const React = require\('react'\)/);
  assert.match(client, /const inject = \['slots', 'locale'\]/);
  assert.match(client, /key: 'visual_ask'/);
  assert.match(client, /key: 'visual_publish'/);
  assert.doesNotMatch(client, /window\.open\(/);
});

test('host ships the starter-template tool beside the publish tools', () => {
  const host = read('lib/host.js');
  assert.match(host, /name: 'visual_template'/);
  assert.match(host, /from '\.\/templates\.js'/);
  const templates = read('lib/templates.js');
  assert.match(templates, /export const TEMPLATES/);
  assert.match(templates, /export function templateFor/);
});

test('publish supports an optional project copy beside the plugin store', () => {
  const host = read('lib/host.js');
  assert.match(host, /saveToProject/);
  assert.match(host, /from '\.\/project\.js'/);
  assert.match(host, /writeProjectCopy\(/);
  const project = read('lib/project.js');
  assert.match(project, /export async function writeProjectCopy/);
  assert.match(project, /export function projectTarget/);
});

test('published visuals always render in a sandboxed iframe', () => {
  const client = read('client.js');
  assert.match(client, /sandbox: 'allow-scripts'/);
  assert.doesNotMatch(client, /allow-same-origin/);
  assert.doesNotMatch(client, /document\.body\.appendChild/);
  assert.doesNotMatch(client, /innerHTML\s*=/);
});

test('no external network dependencies are declared', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.peerDependencies, undefined);
  const client = read('client.js');
  assert.doesNotMatch(client, /https?:\/\/(?!cdn)[a-z0-9.-]+/i);
});

test('the repository README lists the package', () => {
  const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /dsh-visual-studio/);
});
