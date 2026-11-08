#!/usr/bin/env node
/**
 * Repository validator for dsh-plugins.
 *
 * Dependency-free (Node built-ins only). Run from the repository root or from CI:
 *
 *   node scripts/validate.mjs
 *
 * It checks the repository shell, every plugin package manifest, bundle patches,
 * locales, icons, required files, test-file presence and the syntax of every
 * JavaScript file in each package via `node --check`.
 *
 * Exit code: 0 = every check passed, 1 = at least one check failed.
 * Output: one `ok`/`FAIL`/`WARN` line per check and a final summary. Nothing is
 * written and no network is used.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every plugin package in this repository. `requiresOfficialMcpClient` is the
 * only package-specific carve-out: dsh-mcp-guard must declare the official MCP
 * client as a peer dependency, while newer plugins may have no dependencies at
 * all.
 */
const PACKAGES = [
  {
    rel: 'packages/dsh-mcp-guard',
    name: 'dsh-mcp-guard',
    requiresOfficialMcpClient: true,
    requiredFiles: [
      'package.json',
      'cordis.patch.yml',
      'index.js',
      'client.js',
      'icon.svg',
      'locale/en.json',
      'locale/ru.json',
      'README.md',
      'lib/host.js',
      'test/security.test.mjs',
      'test/import.test.mjs',
      'test/client-static.test.mjs',
    ],
  },
  {
    rel: 'packages/dsh-visual-studio',
    name: 'dsh-visual-studio',
    requiresOfficialMcpClient: false,
    requiredFiles: [
      'package.json',
      'cordis.patch.yml',
      'index.js',
      'client.js',
      'icon.svg',
      'locale/en.json',
      'locale/ru.json',
      'README.md',
      'lib/host.js',
      'lib/spec.js',
      'lib/store.js',
      'lib/ask.js',
      'lib/http.js',
      'lib/guidelines.js',
      'lib/templates.js',
      'lib/project.js',
      'test/package.test.mjs',
      'test/client-static.test.mjs',
      'test/http.test.mjs',
      'test/templates.test.mjs',
      'test/project.test.mjs',
    ],
  },
  {
    rel: 'packages/dsh-skill-curator',
    name: 'dsh-skill-curator',
    requiresOfficialMcpClient: false,
    requiredFiles: [
      'package.json',
      'cordis.patch.yml',
      'index.js',
      'client.js',
      'icon.svg',
      'locale/en.json',
      'locale/ru.json',
      'README.md',
      'lib/host.js',
      'lib/discovery.js',
      'test/package.test.mjs',
      'test/client-static.test.mjs',
    ],
  },
]

const REQUIRED_ROOT_FILES = [
  'README.md',
  'README.ru.md',
  'LICENSE',
  'NOTICE',
  'SECURITY.md',
  'CONTRIBUTING.md',
  '.gitignore',
  '.editorconfig',
  'docs/API-CONTRACT.md',
  'docs/INSTALL.md',
  'docs/SECURITY-MODEL.md',
  'docs/ARCHITECTURE.md',
  'docs/PLUGINS.md',
  '.github/workflows/ci.yml',
  'scripts/validate.mjs',
]

const ICON_MAX_BYTES = 256 * 1024
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

let passed = 0
const failures = []
const warnings = []

function displayPath(abs) {
  return relative(ROOT, abs).split(sep).join('/')
}

function section(title) {
  console.log(`\n${title}`)
}

function ok(name, detail) {
  passed += 1
  console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`)
}

function warn(name, message) {
  warnings.push({ name, message })
  console.log(`  WARN  ${name}${message ? ` - ${message}` : ''}`)
}

function fail(name, message) {
  failures.push({ name, message })
  console.log(`  FAIL  ${name}${message ? ` - ${message}` : ''}`)
}

function readTextFile(relPath) {
  try {
    return readFileSync(join(ROOT, relPath), 'utf8')
  } catch (error) {
    fail(relPath, `cannot read: ${error.message}`)
    return null
  }
}

/** Check that a required file exists, is a regular file and is non-empty. */
function checkFile(relPath) {
  const abs = join(ROOT, relPath)
  if (!existsSync(abs)) {
    fail(relPath, 'missing')
    return false
  }
  let stat
  try {
    stat = statSync(abs)
  } catch (error) {
    fail(relPath, `cannot stat: ${error.message}`)
    return false
  }
  if (!stat.isFile()) {
    fail(relPath, 'not a regular file')
    return false
  }
  if (stat.size === 0) {
    fail(relPath, 'file is empty')
    return false
  }
  ok(relPath, `${stat.size} bytes`)
  return true
}

function readJsonFile(relPath) {
  const text = readTextFile(relPath)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch (error) {
    fail(relPath, `invalid JSON: ${error.message}`)
    return null
  }
}

function listFiles(dir, extension, collected = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return collected
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'coverage') {
      continue
    }
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      listFiles(abs, extension, collected)
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      collected.push(abs)
    }
  }
  return collected
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkNodeVersion() {
  section('Environment')
  const minimum = [22, 19, 0]
  const current = process.versions.node.split('.').map((part) => Number.parseInt(part, 10))
  const below = current[0] < minimum[0]
    || (current[0] === minimum[0] && current[1] < minimum[1])
    || (current[0] === minimum[0] && current[1] === minimum[1] && current[2] < minimum[2])
  if (below) {
    warn('node version', `running Node ${process.versions.node}; engines requires >= 22.19.0`)
  } else {
    ok('node version', process.versions.node)
  }
}

function checkRepositoryFiles() {
  section('Repository files')
  for (const relPath of REQUIRED_ROOT_FILES) checkFile(relPath)

  const license = readTextFile('LICENSE')
  if (license !== null) {
    const problems = []
    if (!/MIT License/i.test(license)) problems.push('missing "MIT License"')
    if (!/2026/.test(license)) problems.push('missing year 2026')
    if (!/Rinat Fathutdinov/.test(license)) problems.push('missing copyright holder')
    if (problems.length > 0) fail('LICENSE', problems.join('; '))
    else ok('LICENSE', 'MIT, 2026, copyright holder present')
  }

  const ci = readTextFile('.github/workflows/ci.yml')
  if (ci !== null) {
    const required = [
      [/runs-on:\s*ubuntu-latest/, 'runs-on: ubuntu-latest'],
      [/node-version:\s*['"]?22/, 'node-version: 22'],
      ['node scripts/validate.mjs', 'validator step'],
    ]
    for (const pkg of PACKAGES) {
      required.push([`node --test ${pkg.rel}/test/*.test.mjs`, `unit tests for ${pkg.name}`])
      required.push([`node --check ${pkg.rel}/client.js`, `client.js syntax for ${pkg.name}`])
      required.push([`node --check ${pkg.rel}/index.js`, `index.js syntax for ${pkg.name}`])
    }
    const missing = required.filter(([pattern]) => (pattern instanceof RegExp
      ? !pattern.test(ci)
      : !ci.includes(pattern)))
    if (missing.length > 0) {
      fail('ci.yml', `missing: ${missing.map(([, label]) => label).join(', ')}`)
    } else {
      ok('ci.yml', `${PACKAGES.length} package(s), tests, validator and syntax steps`)
    }
  }
}

function packageDir(pkg) {
  return join(ROOT, pkg.rel)
}

function checkPackageFiles(pkg) {
  section(`Package files — ${pkg.name}`)
  if (!existsSync(packageDir(pkg))) {
    fail(pkg.rel, 'package directory is missing')
    return
  }
  for (const relPath of pkg.requiredFiles) checkFile(`${pkg.rel}/${relPath}`)

  const libDir = join(packageDir(pkg), 'lib')
  if (!existsSync(libDir)) {
    fail(`${pkg.rel}/lib`, 'directory is missing')
  } else {
    const libFiles = listFiles(libDir, '.js')
    if (libFiles.length === 0) fail(`${pkg.rel}/lib`, 'contains no .js files')
    else ok(`${pkg.rel}/lib`, `${libFiles.length} .js file(s)`)
  }

  const testDir = join(packageDir(pkg), 'test')
  if (existsSync(testDir)) {
    const tests = listFiles(testDir, '.test.mjs')
    if (tests.length === 0) fail(`${pkg.rel}/test`, 'contains no *.test.mjs files')
    else ok(`${pkg.rel}/test`, `${tests.length} test file(s)`)
  } else {
    fail(`${pkg.rel}/test`, 'test directory is missing')
  }
}

function checkPackageManifest(pkg) {
  section(`package.json — ${pkg.name}`)
  const manifest = readJsonFile(`${pkg.rel}/package.json`)
  if (manifest === null) return

  if (manifest.name === pkg.name) ok('name', manifest.name)
  else fail('name', `expected "${pkg.name}", got ${JSON.stringify(manifest.name)}`)

  if (typeof manifest.version === 'string' && SEMVER.test(manifest.version)) {
    ok('version', manifest.version)
  } else {
    fail('version', `not a semver version: ${JSON.stringify(manifest.version)}`)
  }

  if (manifest.type === 'module') ok('type', 'module')
  else fail('type', 'expected "module" for ESM plugin files')

  if (manifest.license === 'MIT') ok('license', 'MIT')
  else fail('license', `expected "MIT", got ${JSON.stringify(manifest.license)}`)

  if (isPlainObject(manifest.exports)) {
    const exports = manifest.exports
    const problems = []
    const expectExport = (key, fragment) => {
      const value = exports[key]
      if (typeof value !== 'string') problems.push(`${key} is not a string`)
      else if (!value.includes(fragment)) problems.push(`${key} does not point at ${fragment}`)
    }
    expectExport('.', 'index.js')
    expectExport('./client', 'client.js')
    if (!Object.keys(exports).some((key) => key.includes('locale'))) problems.push('no locale export')
    if (!Object.keys(exports).some((key) => key === './icon' || key.includes('icon'))) {
      problems.push('no icon export')
    }
    if (problems.length > 0) fail('exports', problems.join('; '))
    else ok('exports', Object.keys(exports).join(', '))
  } else {
    fail('exports', 'missing exports object')
  }

  if (isPlainObject(manifest.dsh) && isPlainObject(manifest.dsh.bundle)
    && typeof manifest.dsh.bundle.patch === 'string' && manifest.dsh.bundle.patch.length > 0) {
    const patchRel = `${pkg.rel}/${manifest.dsh.bundle.patch.replace(/^\.\//, '')}`
    if (existsSync(join(ROOT, patchRel))) ok('dsh.bundle.patch', manifest.dsh.bundle.patch)
    else fail('dsh.bundle.patch', `referenced patch file not found: ${manifest.dsh.bundle.patch}`)
  } else {
    fail('dsh.bundle.patch', 'missing dsh.bundle.patch in package.json')
  }

  if (isPlainObject(manifest.dsh) && isPlainObject(manifest.dsh.client)) {
    const client = manifest.dsh.client
    const problems = []
    if (client.platform !== 'web') problems.push('platform is not "web"')
    if (!Array.isArray(client.inject) || client.inject.length === 0) {
      problems.push('inject is not a non-empty array')
    } else if (!client.inject.every((item) => typeof item === 'string' && item.length > 0)) {
      problems.push('inject contains a non-string entry')
    }
    if (problems.length > 0) fail('dsh.client', problems.join('; '))
    else ok('dsh.client', `platform web, ${client.inject.length} injection(s)`)
  } else {
    fail('dsh.client', 'missing dsh.client in package.json')
  }

  if (Array.isArray(manifest.files)) {
    const files = manifest.files
    const required = ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg']
    const missing = required.filter((name) => !files.includes(name))
    if (!files.some((name) => String(name).startsWith('locale'))) missing.push('locale/*.json')
    if (missing.length > 0) fail('files', `missing entries: ${missing.join(', ')}`)
    else ok('files', `${files.length} entries`)
  } else {
    fail('files', 'missing files array (display resources would be excluded from a pack)')
  }

  if (isPlainObject(manifest.engines)
    && typeof manifest.engines.node === 'string'
    && typeof manifest.engines.dsh === 'string') {
    ok('engines', `node ${manifest.engines.node}, dsh ${manifest.engines.dsh}`)
  } else {
    fail('engines', 'missing engines.node / engines.dsh')
  }

  if (pkg.requiresOfficialMcpClient) {
    const officialClient = isPlainObject(manifest.dependencies)
      ? manifest.dependencies['@deepseek-ai/dsh-mcp-client']
      : undefined
    const officialClientPeer = isPlainObject(manifest.peerDependencies)
      ? manifest.peerDependencies['@deepseek-ai/dsh-mcp-client']
      : undefined
    if (typeof officialClient === 'string') {
      ok('dependency', `@deepseek-ai/dsh-mcp-client@${officialClient}`)
    } else if (typeof officialClientPeer === 'string') {
      ok('dependency', `@deepseek-ai/dsh-mcp-client@${officialClientPeer} (peer, resolved from host)`)
    } else {
      fail('dependency', 'official @deepseek-ai/dsh-mcp-client is not declared as dependency or peerDependency')
    }
  } else {
    const dependencies = isPlainObject(manifest.dependencies) ? Object.keys(manifest.dependencies) : []
    if (dependencies.length > 0) {
      fail('dependencies', `unexpected runtime dependencies: ${dependencies.join(', ')}`)
    } else {
      ok('dependencies', 'none (Node built-ins only)')
    }
  }
}

function checkBundlePatch(pkg) {
  section(`bundle patch — ${pkg.name}`)
  const patchRel = `${pkg.rel}/cordis.patch.yml`
  const patch = readTextFile(patchRel)
  if (patch === null) return

  const escaped = pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const checks = [
    [/^-\s+insert:\s*$/m, 'contains a "- insert:" list'],
    [new RegExp(`\\bid:\\s*['"]?${escaped}['"]?\\s*$`, 'm'), `insert row with id: ${pkg.name}`],
    [new RegExp(`\\bname:\\s*['"]?${escaped}['"]?\\s*$`, 'm'), `insert row with name: ${pkg.name}`],
  ]
  for (const [pattern, label] of checks) {
    if (pattern.test(patch)) ok(label)
    else fail(label, 'pattern not found in cordis.patch.yml')
  }
}

function checkLocales(pkg) {
  section(`locales — ${pkg.name}`)
  const localeDir = join(packageDir(pkg), 'locale')
  if (!existsSync(localeDir)) {
    fail(`${pkg.rel}/locale`, 'directory is missing')
    return
  }
  const localeFiles = listFiles(localeDir, '.json')
  if (localeFiles.length === 0) {
    fail(`${pkg.rel}/locale`, 'contains no .json files')
    return
  }
  for (const abs of localeFiles.sort()) {
    const relPath = displayPath(abs)
    const locale = readJsonFile(relPath)
    if (locale === null) continue
    const meta = isPlainObject(locale.meta) ? locale.meta : null
    const problems = []
    if (meta === null) problems.push('missing meta object')
    else {
      if (typeof meta.title !== 'string' || meta.title.trim().length === 0) {
        problems.push('meta.title is missing or empty')
      }
      if (typeof meta.description !== 'string' || meta.description.trim().length === 0) {
        problems.push('meta.description is missing or empty')
      }
    }
    if (problems.length > 0) fail(relPath, problems.join('; '))
    else ok(relPath, `"${meta.title}"`)
  }
}

function checkIcon(pkg) {
  section(`icon — ${pkg.name}`)
  const iconRel = `${pkg.rel}/icon.svg`
  const iconAbs = join(ROOT, iconRel)
  if (!existsSync(iconAbs)) {
    fail(iconRel, 'missing')
    return
  }
  const stat = statSync(iconAbs)
  if (!stat.isFile()) {
    fail(iconRel, 'not a regular file')
    return
  }
  if (stat.size > ICON_MAX_BYTES) {
    fail(iconRel, `${stat.size} bytes exceeds the 256 KiB display limit`)
  } else {
    ok(iconRel, `${stat.size} bytes (limit 256 KiB)`)
  }
  const text = readTextFile(iconRel)
  if (text === null) return
  let head = text.replace(/^\uFEFF/, '').trimStart()
  if (head.startsWith('<?xml')) {
    const end = head.indexOf('?>')
    if (end !== -1) head = head.slice(end + 2).trimStart()
  }
  if (head.startsWith('<svg')) ok('icon content', 'starts with <svg')
  else fail('icon content', 'does not start with <svg (after an optional XML declaration)')
}

function checkJavaScriptSyntax(pkg) {
  section(`JavaScript syntax — ${pkg.name} (node --check)`)
  if (!existsSync(packageDir(pkg))) {
    fail(pkg.rel, 'package directory is missing')
    return
  }
  const files = listFiles(packageDir(pkg), '.js').sort()
  if (files.length === 0) {
    fail(pkg.rel, 'no .js files found to syntax-check')
    return
  }
  for (const abs of files) {
    const relPath = displayPath(abs)
    const result = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' })
    if (result.error) {
      fail(relPath, `could not run node --check: ${result.error.message}`)
      continue
    }
    if (result.status === 0) {
      ok(relPath)
    } else {
      const firstLine = (result.stderr || '').trim().split('\n').find((line) => line.trim().length > 0)
      fail(relPath, firstLine || `node --check exited with ${result.status}`)
    }
  }
}

function main() {
  console.log('dsh-plugins validation')
  console.log(`root: ${ROOT}`)

  checkNodeVersion()
  checkRepositoryFiles()

  for (const pkg of PACKAGES) {
    checkPackageFiles(pkg)
    checkPackageManifest(pkg)
    checkBundlePatch(pkg)
    checkLocales(pkg)
    checkIcon(pkg)
    checkJavaScriptSyntax(pkg)
  }

  if (warnings.length > 0) {
    section('Warnings')
    for (const warning of warnings) {
      console.log(`  WARN  ${warning.name}${warning.message ? ` - ${warning.message}` : ''}`)
    }
  }

  if (failures.length > 0) {
    section('Failed checks')
    for (const failure of failures) {
      console.log(`  FAIL  ${failure.name}${failure.message ? ` - ${failure.message}` : ''}`)
    }
  }

  console.log('')
  console.log(`Summary: ${passed} ok, ${warnings.length} warning(s), ${failures.length} failed`)
  if (failures.length > 0) {
    console.log('Validation FAILED')
    process.exitCode = 1
  } else {
    console.log('Validation passed')
    process.exitCode = 0
  }
}

try {
  main()
} catch (error) {
  console.log('')
  console.log(`FAIL  validator crashed: ${error && error.stack ? error.stack : String(error)}`)
  console.log('Validation FAILED')
  process.exitCode = 1
}
