/**
 * Dependency-free reader for the YAML frontmatter used by Agent Skills.
 *
 * This is deliberately a *subset* parser, not a YAML implementation. It reads
 * the fields the DSH skill loader and this plugin act on:
 *
 *  - `name`, `description`, `license`, `compatibility`, `allowed-tools`;
 *  - `disable-model-invocation`, `user-invocable`;
 *  - one level of nested mapping (`metadata:` with two-space children);
 *  - block sequences (`tags:` followed by `- item`) and inline `[a, b]` lists;
 *  - plain, single-quoted and double-quoted scalars; `true`/`false` literals.
 *
 * Anything outside that subset is kept as raw text and reported through
 * `warnings`, so the catalog can show a diagnostic instead of silently
 * dropping or mangling a skill. The body is returned verbatim, and the raw
 * frontmatter text is preserved for later text-preserving edits.
 */

const BOM = 0xfeff;

/** Strip one leading UTF-8 BOM. */
export function stripBom(value) {
  const text = String(value ?? '');
  return text.charCodeAt(0) === BOM ? text.slice(1) : text;
}

function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];
    if (quote !== null) {
      if (ch === '\\' && quote === '"') {
        index += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, index);
  }
  return line;
}

function unquoteDouble(text) {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = text[index + 1];
    index += 1;
    switch (next) {
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case '"':
        out += '"';
        break;
      case '\\':
        out += '\\';
        break;
      case 'u': {
        const hex = text.slice(index + 1, index + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          index += 4;
        } else {
          out += 'u';
        }
        break;
      }
      default:
        out += next ?? '';
        break;
    }
  }
  return out;
}

/** Parse one scalar value. Returns string | boolean | null | array | string. */
function parseScalar(input, warnings) {
  const text = String(input ?? '').trim();
  if (text === '') return '';
  if (text === '~' || text === 'null' || text === 'Null' || text === 'NULL') return null;
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return unquoteDouble(text.slice(1, -1));
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('"') || text.startsWith("'")) {
    warnings.push('frontmatter-unterminated-quote');
    return text.replace(/^["']|["']$/g, '');
  }
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim();
    if (inner === '') return [];
    const values = [];
    let current = '';
    let quote = null;
    for (let index = 0; index < inner.length; index += 1) {
      const ch = inner[index];
      if (quote !== null) {
        current += ch;
        if (ch === quote && inner[index - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        current += ch;
        continue;
      }
      if (ch === ',') {
        values.push(parseScalar(current, warnings));
        current = '';
        continue;
      }
      current += ch;
    }
    values.push(parseScalar(current, warnings));
    return values;
  }
  if (text.startsWith('{') || text.startsWith('|') || text.startsWith('>')) {
    // Inline maps and block scalars are outside the supported subset.
    warnings.push('frontmatter-unsupported-value');
    return text;
  }
  if (/^true$/i.test(text)) return true;
  if (/^false$/i.test(text)) return false;
  return text;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asContainer(value) {
  if (Array.isArray(value)) return value;
  if (isPlainObject(value)) {
    if (Object.keys(value).length === 0) return [];
    return value;
  }
  return value;
}

function parseMapping(text, warnings) {
  const target = Object.create(null);
  const lines = text.split(/\r?\n/);
  let pendingKey = null;

  for (const rawLine of lines) {
    if (rawLine.trim() === '' || /^\s*#/.test(rawLine)) continue;
    const line = stripComment(rawLine);
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    const sequence = /^-\s*(.*)$/.exec(trimmed);
    if (sequence) {
      if (pendingKey === null) {
        warnings.push('frontmatter-unsupported-sequence');
        continue;
      }
      const container = asContainer(target[pendingKey]);
      if (!Array.isArray(container)) {
        warnings.push('frontmatter-unsupported-mix');
        continue;
      }
      container.push(parseScalar(sequence[1], warnings));
      target[pendingKey] = container;
      continue;
    }

    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (match === null) {
      warnings.push('frontmatter-unsupported-line');
      continue;
    }
    const key = match[1];
    const rest = match[2];

    if (indent === 0) {
      pendingKey = key;
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        warnings.push('frontmatter-duplicate-key');
      }
      if (rest === '') {
        target[key] = Object.create(null);
      } else {
        target[key] = parseScalar(rest, warnings);
      }
      continue;
    }

    if (pendingKey === null) {
      warnings.push('frontmatter-unsupported-indent');
      continue;
    }
    const parent = target[pendingKey];
    if (!isPlainObject(parent)) {
      warnings.push('frontmatter-unsupported-nesting');
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(parent, key)) {
      warnings.push('frontmatter-duplicate-key');
    }
    parent[key] = rest === '' ? Object.create(null) : parseScalar(rest, warnings);
  }

  return target;
}

/**
 * Split a SKILL.md document into frontmatter data and body.
 *
 * @param {string} input file content
 * @returns {{
 *   ok: boolean,
 *   reason: string | null,
 *   data: Record<string, unknown>,
 *   raw: string,
 *   body: string,
 *   bodyStartLine: number,
 *   warnings: string[],
 * }}
 */
export function splitFrontmatter(input) {
  const text = stripBom(input);
  const result = {
    ok: false,
    reason: null,
    data: Object.create(null),
    raw: '',
    body: text,
    bodyStartLine: 1,
    warnings: [],
  };
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== '---') {
    result.reason = 'frontmatter-missing';
    return result;
  }
  let closing = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      closing = index;
      break;
    }
  }
  if (closing === -1) {
    result.reason = 'frontmatter-unclosed';
    return result;
  }
  result.raw = lines.slice(1, closing).join('\n');
  result.body = lines.slice(closing + 1).join('\n');
  result.bodyStartLine = closing + 2;
  try {
    result.data = parseMapping(result.raw, result.warnings);
    result.ok = true;
  } catch {
    result.reason = 'frontmatter-invalid';
    result.data = Object.create(null);
  }
  return result;
}

/** Case-insensitive invocation boolean used by the DSH loader. */
export function parseInvocationBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(normalized)) return true;
  if (['false', 'no', 'off', '0'].includes(normalized)) return false;
  return undefined;
}

/** Read a scalar field as a trimmed string, or '' when absent/non-scalar. */
export function scalarField(data, key) {
  const value = data?.[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
