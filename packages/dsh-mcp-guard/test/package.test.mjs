/**
 * Package wiring tests: manifest, bundle patch, locale resources, icon and the
 * Host entry export shape. These run without a DSH profile.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { name, inject, apply } from '../index.js';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function readText(relative) {
  return readFile(join(packageDir, relative), 'utf8');
}

test('package.json declares the DSH bundle and client surfaces', async () => {
  const pkg = JSON.parse(await readText('package.json'));
  assert.equal(pkg.name, 'dsh-mcp-guard');
  assert.match(pkg.version, /^0\.\d+\.\d+$/);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.exports['.'], './index.js');
  assert.equal(pkg.exports['./client'], './client.js');
  assert.equal(pkg.exports['./icon'], './icon.svg');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.match(pkg.engines.dsh, />=/);
  assert.ok(pkg.files.includes('client.js'));
  assert.ok(pkg.files.includes('locale/*.json'));
  assert.ok(pkg.files.includes('icon.svg'));
  assert.equal(Object.keys(pkg.peerDependencies ?? {}).length, 1);
  assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh-mcp-client'].optional, true);
});

test('bundle patch inserts exactly the plugin row', async () => {
  const patch = await readText('cordis.patch.yml');
  assert.match(patch, /^- insert:/m);
  assert.match(patch, /^\s+- id: dsh-mcp-guard$/m);
  assert.match(patch, /^\s+name: dsh-mcp-guard$/m);
  assert.equal((patch.match(/^- insert:/gm) ?? []).length, 1);
});

test('Host entry exports a Cordis plugin with the required services', () => {
  assert.equal(name, 'dsh-mcp-guard');
  assert.deepEqual(inject, ['webServer', 'configEditor', 'connection']);
  assert.equal(typeof apply, 'function');
});

test('Client module registers the settings section without leaving the slot', async () => {
  const client = await readText('client.js');
  assert.match(client, /window\.__ModuleLoader__\.load\(/);
  assert.match(client, /id: 'dsh-mcp-guard'/);
  assert.match(client, /ctx\.slots\.inject\('settings\.section'/);
  assert.match(client, /name: 'settings\.section'/);
  assert.match(client, /id: 'mcp-guard'/);
  assert.match(client, /order: 22/);
  assert.match(client, /x-dsh-mcp-guard/);
  assert.match(client, /\/api\/dsh-mcp-guard/);
  assert.match(client, /require\('react'\)/);
  assert.ok(!client.includes('document.body.appendChild'));
  assert.ok(!client.includes('@deepseek-ai/dsh-client-ui-primitives'));
  // The only bare module required from the browser table is React.
  const requires = [...client.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(requires)], ['react']);
});

test('locale resources carry display metadata for both languages', async () => {
  const files = (await readdir(join(packageDir, 'locale'))).filter((file) => file.endsWith('.json'));
  assert.deepEqual(files.sort(), ['en.json', 'ru.json']);
  for (const file of files) {
    const document = JSON.parse(await readText(join('locale', file)));
    assert.equal(typeof document.meta?.title, 'string');
    assert.ok(document.meta.title.length > 3);
    assert.equal(typeof document.meta?.description, 'string');
    assert.ok(document.meta.description.length > 10);
  }
});

test('icon is a small self-contained SVG', async () => {
  const iconPath = join(packageDir, 'icon.svg');
  const info = await stat(iconPath);
  assert.ok(info.size > 100, 'icon is not empty');
  assert.ok(info.size < 256 * 1024, 'icon stays below 256 KiB');
  const svg = await readText('icon.svg');
  assert.match(svg.trimStart(), /^<svg[\s>]/);
  assert.match(svg, /viewBox=/);
  assert.ok(!/href\s*=\s*['"]?(?:https?:)?\/\//i.test(svg), 'icon references no remote resource');
  assert.ok(!/url\(\s*['"]?(?:https?:)?\/\//i.test(svg), 'icon references no remote url');
  assert.ok(!/<script/i.test(svg), 'icon contains no script');
});
