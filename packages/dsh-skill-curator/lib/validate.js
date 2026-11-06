/**
 * Pure diagnostics for one skill file. No I/O, no exceptions for bad input:
 * every problem becomes a stable diagnostic code with value-free params that
 * the Client localizes.
 */
import { parseInvocationBoolean, scalarField } from './frontmatter.js';

export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
export const RECOMMENDED_DESCRIPTION_LENGTH = 200;
export const MIN_DESCRIPTION_LENGTH = 20;
export const MAX_BODY_LINES = 500;
export const MAX_BODY_BYTES = 50 * 1024;
export const MAX_COMPATIBILITY_LENGTH = 500;

function diagnostic(code, severity, params = undefined) {
  return params === undefined ? { code, severity } : { code, severity, params };
}

/**
 * Validate one skill definition.
 *
 * @param {object} input
 * @param {ReturnType<import('./frontmatter.js').splitFrontmatter>} input.frontmatter
 * @param {string} input.body
 * @param {string} [input.dirName] bundle directory name (absent for flat markdown)
 * @param {boolean} [input.isFlat]
 * @param {boolean} [input.isSymlink]
 * @param {string | null} [input.symlinkTarget]
 */
export function diagnoseSkill({ frontmatter, body, dirName = '', isFlat = false, isSymlink = false, symlinkTarget = null }) {
  const diagnostics = [];
  /** @type {{modelInvocable: boolean, userInvocable: boolean}} */
  const invocation = { modelInvocable: true, userInvocable: true };
  const data = frontmatter?.data ?? Object.create(null);

  if (!frontmatter?.ok) {
    const reason = frontmatter?.reason ?? 'frontmatter-invalid';
    diagnostics.push(diagnostic(reason, 'error'));
    for (const warning of frontmatter?.warnings ?? []) {
      diagnostics.push(diagnostic(warning, 'warn'));
    }
    return { diagnostics, invocation, name: '', description: '', bodyLines: countLines(body), bodyBytes: byteLength(body) };
  }
  for (const warning of frontmatter.warnings ?? []) {
    diagnostics.push(diagnostic(warning, 'warn'));
  }

  const name = scalarField(data, 'name');
  if (name === '') {
    diagnostics.push(diagnostic('name-missing', 'error'));
  } else {
    if (name.length > MAX_NAME_LENGTH) {
      diagnostics.push(diagnostic('name-too-long', 'error', { length: name.length, max: MAX_NAME_LENGTH }));
    }
    if (!NAME_PATTERN.test(name)) {
      diagnostics.push(diagnostic('name-invalid', 'error', { pattern: 'kebab-case', max: MAX_NAME_LENGTH }));
    }
    if (!isFlat && dirName !== '' && name !== dirName) {
      diagnostics.push(diagnostic('name-folder-mismatch', 'error', { name, folder: dirName }));
    }
  }

  const description = scalarField(data, 'description');
  if (description === '') {
    diagnostics.push(diagnostic('description-missing', 'error'));
  } else {
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      diagnostics.push(diagnostic('description-too-long', 'error', { length: description.length, max: MAX_DESCRIPTION_LENGTH }));
    } else if (description.length > RECOMMENDED_DESCRIPTION_LENGTH) {
      diagnostics.push(diagnostic('description-long', 'warn', { length: description.length, recommended: RECOMMENDED_DESCRIPTION_LENGTH }));
    }
    if (description.length < MIN_DESCRIPTION_LENGTH) {
      diagnostics.push(diagnostic('description-short', 'warn', { length: description.length, min: MIN_DESCRIPTION_LENGTH }));
    }
  }

  for (const field of ['disable-model-invocation', 'user-invocable']) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    if (parseInvocationBoolean(data[field]) === undefined) {
      diagnostics.push(diagnostic('invocation-invalid', 'error', { field }));
    }
  }
  const disableModel = parseInvocationBoolean(data['disable-model-invocation']);
  const userInvocable = parseInvocationBoolean(data['user-invocable']);
  invocation.modelInvocable = disableModel !== true;
  invocation.userInvocable = userInvocable !== false;

  const compatibility = scalarField(data, 'compatibility');
  if (compatibility !== '' && compatibility.length > MAX_COMPATIBILITY_LENGTH) {
    diagnostics.push(diagnostic('compatibility-too-long', 'warn', { length: compatibility.length, max: MAX_COMPATIBILITY_LENGTH }));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'metadata')
    && (data.metadata === null || typeof data.metadata !== 'object' || Array.isArray(data.metadata))) {
    diagnostics.push(diagnostic('metadata-invalid', 'warn'));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'allowed-tools')) {
    const allowed = data['allowed-tools'];
    if (typeof allowed !== 'string' && !Array.isArray(allowed)) {
      diagnostics.push(diagnostic('allowed-tools-invalid', 'warn'));
    }
  }

  const bodyText = typeof body === 'string' ? body : '';
  const bodyLines = countLines(bodyText);
  const bodyBytes = byteLength(bodyText);
  if (bodyText.trim() === '') {
    diagnostics.push(diagnostic('body-empty', 'error'));
  } else if (bodyLines > MAX_BODY_LINES || bodyBytes > MAX_BODY_BYTES) {
    diagnostics.push(diagnostic('body-too-large', 'warn', {
      lines: bodyLines,
      bytes: bodyBytes,
      maxLines: MAX_BODY_LINES,
      maxBytes: MAX_BODY_BYTES,
    }));
  }

  if (isSymlink) {
    if (typeof symlinkTarget !== 'string' || symlinkTarget === '') {
      diagnostics.push(diagnostic('symlink-broken', 'error'));
    } else {
      diagnostics.push(diagnostic('symlink', 'info', { target: symlinkTarget }));
    }
  }

  return { diagnostics, invocation, name, description, bodyLines, bodyBytes };
}

export function countLines(text) {
  if (typeof text !== 'string' || text === '') return 0;
  return text.split(/\r?\n/).length;
}

export function byteLength(text) {
  return Buffer.byteLength(typeof text === 'string' ? text : '', 'utf8');
}

/** Count diagnostics by severity for a snapshot summary. */
export function summarize(diagnosticsLists) {
  let errors = 0;
  let warnings = 0;
  for (const list of diagnosticsLists) {
    for (const item of list) {
      if (item.severity === 'error') errors += 1;
      else if (item.severity === 'warn') warnings += 1;
    }
  }
  return { errors, warnings };
}
