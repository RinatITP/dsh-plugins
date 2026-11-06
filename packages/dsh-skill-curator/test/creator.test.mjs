/**
 * Tests for the embedded creator skill and the AI prompt.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CREATOR_SKILL_NAME,
  CREATOR_SKILL_SOURCE,
  createSkillPrompt,
  creatorSkillDefinition,
} from '../lib/creator.js';

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

test('creator skill definition is valid for the DSH runtime registry', () => {
  const skill = creatorSkillDefinition();
  assert.match(skill.name, NAME_RE);
  assert.ok(skill.name.length >= 1 && skill.name.length <= 64);
  assert.equal(skill.name, CREATOR_SKILL_NAME);
  assert.equal(skill.source, CREATOR_SKILL_SOURCE);
  assert.equal(typeof skill.description, 'string');
  assert.ok(skill.description.length > 0 && skill.description.length <= 1024);
  assert.equal(typeof skill.content, 'string');
  assert.ok(skill.content.includes('skill_curator_create'));
  assert.equal(skill.invocation.modelInvocable, true);
  assert.equal(skill.invocation.userInvocable, true);
});

test('creator instructions cover name, description, modularity and the tool', () => {
  const body = creatorSkillDefinition().content;
  assert.match(body, /kebab-case/);
  assert.match(body, /references/);
  assert.match(body, /scripts/);
  assert.match(body, /skill_curator_create/);
  assert.match(body, /через bash/i);
});

test('prompt starts with the slash skill token and includes the description', () => {
  const prompt = createSkillPrompt('  навык для разбора писем  ');
  assert.ok(prompt.startsWith(`/${CREATOR_SKILL_NAME}\n`));
  assert.match(prompt, /навык для разбора писем/);
  assert.match(prompt, /skill_curator_create/);
  assert.match(prompt, /уточняющих вопроса/);
  assert.doesNotMatch(prompt, /  навык для разбора писем  /);
});

test('empty description produces an interview placeholder', () => {
  const prompt = createSkillPrompt('');
  assert.match(prompt, /Описание пользователя:/);
  assert.match(prompt, /уточняющих вопрос/i);
  assert.doesNotMatch(prompt, /undefined|null/);
});
