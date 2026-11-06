/**
 * Unit tests for pure validation and diagnostic codes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { splitFrontmatter } from '../lib/frontmatter.js';
import {
  MAX_DESCRIPTION_LENGTH,
  NAME_PATTERN,
  diagnoseSkill,
  summarize,
} from '../lib/validate.js';

function skill(frontmatterLines, body = 'Do the thing.') {
  return splitFrontmatter(['---', ...frontmatterLines, '---', body].join('\n'));
}

function codes(result) {
  return result.diagnostics.map((item) => item.code);
}

test('valid skill produces no diagnostics and full invocation policy', () => {
  const result = diagnoseSkill({
    frontmatter: skill(['name: my-skill', 'description: Use this when the user asks to test the skill.']),
    body: 'Do the thing.',
    dirName: 'my-skill',
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.invocation, { modelInvocable: true, userInvocable: true });
  assert.equal(result.name, 'my-skill');
});

test('missing name, invalid name and folder mismatch are errors', () => {
  const missing = diagnoseSkill({ frontmatter: skill(['description: desc']), body: 'b', dirName: 'x' });
  assert.ok(codes(missing).includes('name-missing'));

  const invalid = diagnoseSkill({ frontmatter: skill(['name: Bad Name', 'description: desc']), body: 'b', dirName: 'bad-name' });
  assert.ok(codes(invalid).includes('name-invalid'));
  assert.equal(NAME_PATTERN.test('Bad Name'), false);

  const mismatch = diagnoseSkill({
    frontmatter: skill(['name: other-name', 'description: desc']),
    body: 'b',
    dirName: 'folder-name',
  });
  assert.ok(codes(mismatch).includes('name-folder-mismatch'));
});

test('description length rules: required, maximum and recommendation', () => {
  const missing = diagnoseSkill({ frontmatter: skill(['name: x']), body: 'b', dirName: 'x' });
  assert.ok(codes(missing).includes('description-missing'));

  const long = diagnoseSkill({
    frontmatter: skill(['name: x', 'description: ' + 'a'.repeat(MAX_DESCRIPTION_LENGTH + 1)]),
    body: 'b',
    dirName: 'x',
  });
  assert.ok(codes(long).includes('description-too-long'));

  const recommended = diagnoseSkill({
    frontmatter: skill(['name: x', 'description: ' + 'a'.repeat(250)]),
    body: 'b',
    dirName: 'x',
  });
  assert.ok(codes(recommended).includes('description-long'));

  const short = diagnoseSkill({ frontmatter: skill(['name: x', 'description: short']), body: 'b', dirName: 'x' });
  assert.ok(codes(short).includes('description-short'));
});

test('invocation fields: accepted forms and invalid values', () => {
  const disabled = diagnoseSkill({
    frontmatter: skill(['name: x', 'description: desc', 'disable-model-invocation: true']),
    body: 'b',
    dirName: 'x',
  });
  assert.deepEqual(disabled.invocation, { modelInvocable: false, userInvocable: true });

  const userOnly = diagnoseSkill({
    frontmatter: skill(['name: x', 'description: desc', 'user-invocable: false']),
    body: 'b',
    dirName: 'x',
  });
  assert.deepEqual(userOnly.invocation, { modelInvocable: true, userInvocable: false });

  const invalid = diagnoseSkill({
    frontmatter: skill(['name: x', 'description: desc', 'disable-model-invocation: maybe']),
    body: 'b',
    dirName: 'x',
  });
  assert.ok(codes(invalid).includes('invocation-invalid'));
});

test('empty and oversized bodies are reported', () => {
  const empty = diagnoseSkill({ frontmatter: skill(['name: x', 'description: desc'], ''), body: '   ', dirName: 'x' });
  assert.ok(codes(empty).includes('body-empty'));

  const huge = diagnoseSkill({
    frontmatter: skill(['name: x', 'description: desc']),
    body: 'line\n'.repeat(600),
    dirName: 'x',
  });
  assert.ok(codes(huge).includes('body-too-large'));
});

test('symlink status is reported', () => {
  const broken = diagnoseSkill({
    frontmatter: skill(['name: x', 'description: desc']),
    body: 'b',
    dirName: 'x',
    isSymlink: true,
    symlinkTarget: '',
  });
  assert.ok(codes(broken).includes('symlink-broken'));

  const ok = diagnoseSkill({
    frontmatter: skill(['name: x', 'description: desc']),
    body: 'b',
    dirName: 'x',
    isSymlink: true,
    symlinkTarget: '/tmp/target',
  });
  assert.ok(codes(ok).includes('symlink'));
});

test('summarize counts severities', () => {
  const summary = summarize([[
    { code: 'a', severity: 'error' },
    { code: 'b', severity: 'warn' },
    { code: 'c', severity: 'warn' },
    { code: 'd', severity: 'info' },
  ]]);
  assert.deepEqual(summary, { errors: 1, warnings: 2 });
});
