/**
 * Unit tests for the dependency-free frontmatter reader.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseInvocationBoolean, scalarField, splitFrontmatter, stripBom } from '../lib/frontmatter.js';

test('parses a minimal frontmatter and keeps the body verbatim', () => {
  const document = splitFrontmatter('---\nname: my-skill\ndescription: Use when testing.\n---\n\n# Title\n\nBody text.\n');
  assert.equal(document.ok, true);
  assert.equal(document.reason, null);
  assert.equal(document.data.name, 'my-skill');
  assert.equal(document.data.description, 'Use when testing.');
  assert.equal(document.body, '\n# Title\n\nBody text.\n');
  assert.equal(document.bodyStartLine, 5);
  assert.deepEqual(document.warnings, []);
});

test('parses boolean-like invocation fields and quoted values', () => {
  const document = splitFrontmatter([
    '---',
    'name: "quoted-skill"',
    "description: 'single quoted'",
    'disable-model-invocation: yes',
    'user-invocable: "off"',
    'license: MIT',
    '---',
    'body',
  ].join('\n'));
  assert.equal(document.ok, true);
  assert.equal(document.data.name, 'quoted-skill');
  assert.equal(document.data.description, 'single quoted');
  assert.equal(document.data['disable-model-invocation'], 'yes');
  assert.equal(parseInvocationBoolean(document.data['disable-model-invocation']), true);
  assert.equal(parseInvocationBoolean(document.data['user-invocable']), false);
});

test('parses inline arrays and block sequences', () => {
  const document = splitFrontmatter([
    '---',
    'name: skill',
    'description: desc',
    'allowed-tools: [Read, Write]',
    'tags:',
    '  - alpha',
    '  - beta',
    '---',
    'body',
  ].join('\n'));
  assert.deepEqual(document.data['allowed-tools'], ['Read', 'Write']);
  assert.deepEqual(document.data.tags, ['alpha', 'beta']);
});

test('parses one level of nested metadata', () => {
  const document = splitFrontmatter([
    '---',
    'name: skill',
    'description: desc',
    'metadata:',
    '  author: Rinat',
    '  version: 2',
    '---',
    'body',
  ].join('\n'));
  assert.equal(document.data.metadata.author, 'Rinat');
  assert.equal(document.data.metadata.version, '2');
});

test('reports missing and unclosed frontmatter without throwing', () => {
  const missing = splitFrontmatter('# Just markdown\n');
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'frontmatter-missing');
  assert.equal(missing.body, '# Just markdown\n');

  const unclosed = splitFrontmatter('---\nname: x\nbody\n');
  assert.equal(unclosed.ok, false);
  assert.equal(unclosed.reason, 'frontmatter-unclosed');
});

test('reports unsupported constructs as warnings instead of losing the document', () => {
  const document = splitFrontmatter([
    '---',
    'name: skill',
    'description: desc',
    'weird: {a: 1}',
    '---',
    'body',
  ].join('\n'));
  assert.equal(document.ok, true);
  assert.ok(document.warnings.includes('frontmatter-unsupported-value'));
});

test('accepts a BOM and CRLF line endings', () => {
  const document = splitFrontmatter('\uFEFF---\r\nname: skill\r\ndescription: desc\r\n---\r\nbody\r\n');
  assert.equal(document.ok, true);
  assert.equal(document.data.name, 'skill');
  assert.equal(document.body.trim(), 'body');
  assert.equal(stripBom('\uFEFFx'), 'x');
});

test('scalarField falls back to empty string for structured values', () => {
  assert.equal(scalarField({ name: 'x' }, 'name'), 'x');
  assert.equal(scalarField({ name: ['x'] }, 'name'), '');
  assert.equal(scalarField({}, 'name'), '');
  assert.equal(scalarField({ name: 3 }, 'name'), '3');
});
