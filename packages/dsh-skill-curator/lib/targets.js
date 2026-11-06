/**
 * Target resolution shared by skill creation and import.
 *
 * A target is one of the writable roots the plugin may write to:
 *  - `user`    — `~/.dsh/skills`;
 *  - `agents`  — `~/.agents/skills`;
 *  - `project` — `<workspace>/.dsh/skills` for a configured project root.
 *
 * The source descriptor must already be present in the scanned catalog (the
 * catalog is the authority for paths), and it must be writable.
 */
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { CuratorError } from './errors.js';

/**
 * @param {{ sources: Array<object> }} catalog
 * @param {{ scope?: string, workspacePath?: string }} options
 */
export function findTargetSource(catalog, { scope = 'user', workspacePath = '' } = {}) {
  if (scope === 'project') {
    if (typeof workspacePath !== 'string' || workspacePath === '' || !isAbsolute(workspacePath)) {
      throw new CuratorError('INVALID_TARGET', 400);
    }
    const expected = resolve(join(workspacePath, '.dsh', 'skills'));
    const source = catalog.sources.find((candidate) => (
      candidate.kind === 'project' && resolve(candidate.path) === expected
    ));
    if (!source) throw new CuratorError('PROJECT_NOT_CONFIGURED', 404);
    return source;
  }
  const kind = scope === 'agents' ? 'dsh-agents' : 'dsh-user';
  const source = catalog.sources.find((candidate) => candidate.kind === kind);
  if (!source) throw new CuratorError('TARGET_NOT_FOUND', 404);
  return source;
}

/** Resolve the workspace directory from a project source path. */
export function workspaceFromProjectSource(sourcePath) {
  const text = String(sourcePath ?? '');
  const suffix = `${sep}.dsh${sep}skills`;
  if (text.endsWith(suffix)) return text.slice(0, -suffix.length);
  return dirname(dirname(text));
}

/** True when `target` is `root` or a descendant of it. */
export function isInside(root, target) {
  const base = resolve(root);
  const candidate = resolve(target);
  return candidate === base || candidate.startsWith(`${base}${sep}`);
}
