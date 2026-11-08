import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_MODULES, TEMPLATES, templateFor } from '../lib/templates.js';

const MODULES = ['diagram', 'mockup', 'slide'];

test('ships exactly the three documented starters', () => {
  assert.deepEqual([...TEMPLATE_MODULES].sort(), [...MODULES].sort());
  assert.deepEqual(Object.keys(TEMPLATES).sort(), [...MODULES].sort());
});

for (const module of MODULES) {
  test(`${module} starter is a complete offline document`, () => {
    const html = TEMPLATES[module];
    assert.equal(typeof html, 'string');
    assert.ok(html.startsWith('<!doctype html>'), 'starts with a doctype');
    assert.match(html, /<meta charset="utf-8">/i);
    assert.match(html, /lang="ru"/);
    assert.match(html, /@media print/);
    assert.ok(html.length > 8 * 1024, 'not a stub');
    assert.ok(html.length < 18 * 1024, 'kept small enough for the model');
    assert.doesNotMatch(html, /https?:\/\//i, 'no external URLs');
    assert.doesNotMatch(html, /<script/i, 'no scripts');
    assert.doesNotMatch(html, /<link\b/i, 'no external stylesheets');
    assert.doesNotMatch(html, /\bsrc\s*=/i, 'no external sources');
    assert.doesNotMatch(html, /url\(/i, 'no CSS url() resources');
    assert.match(html, /\[[^\]]+\]/, 'keeps bracketed placeholders for the agent');
  });
}

test('templateFor falls back to the process diagram', () => {
  assert.equal(templateFor('diagram'), TEMPLATES.diagram);
  assert.equal(templateFor('mockup'), TEMPLATES.mockup);
  assert.equal(templateFor('slide'), TEMPLATES.slide);
  assert.equal(templateFor('unknown'), TEMPLATES.diagram);
  assert.equal(templateFor(undefined), TEMPLATES.diagram);
});
