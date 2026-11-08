/**
 * Project copies of published visuals.
 *
 * The plugin keeps its own versioned store under `<dshHome>/visual-studio`.
 * When the user works inside a project, the same document can additionally be
 * written next to the task as `artifacts/visuals/<artifact-id>/v<rev>.html`
 * plus a small `meta.json`, so visuals are reviewable and committable with the
 * code they explain.
 *
 * Paths are derived from the session working directory, a validated artifact id
 * and a numeric revision; the resolved file must stay inside the project root.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';

export const PROJECT_DIR = join('artifacts', 'visuals');
const ID_PATTERN = /^[a-z0-9-]{3,64}$/;

export class ProjectPathError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProjectPathError';
    this.code = code;
  }
}

/**
 * Compute the project destination for one stored version.
 * @param {string} cwd absolute session working directory
 * @param {string} artifactId validated artifact id
 * @param {number} rev positive version number
 */
export function projectTarget(cwd, artifactId, rev) {
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    throw new ProjectPathError('PROJECT_CWD_UNAVAILABLE', 'session working directory is unavailable');
  }
  if (!isAbsolute(cwd)) {
    throw new ProjectPathError('PROJECT_CWD_INVALID', 'session working directory must be absolute');
  }
  if (typeof artifactId !== 'string' || !ID_PATTERN.test(artifactId)) {
    throw new ProjectPathError('PROJECT_ARTIFACT_INVALID', 'artifact id is not safe for a path');
  }
  if (!Number.isInteger(rev) || rev <= 0) {
    throw new ProjectPathError('PROJECT_REV_INVALID', 'version must be a positive integer');
  }
  const root = resolve(cwd);
  const dir = join(root, PROJECT_DIR, artifactId);
  if (!dir.startsWith(root + sep)) {
    throw new ProjectPathError('PROJECT_PATH_ESCAPE', 'artifact directory escapes the project root');
  }
  return {
    root,
    dir,
    file: join(dir, `v${rev}.html`),
    metaFile: join(dir, 'meta.json'),
    relativeDir: join(PROJECT_DIR, artifactId),
    relativeFile: join(PROJECT_DIR, artifactId, `v${rev}.html`),
  };
}

/**
 * Write one version plus its metadata into the session project.
 * @param {{cwd: string, artifactId: string, rev: number, title: string, module: string, html: string}} input
 * @returns {Promise<{relativeFile: string, file: string, relativeDir: string}>}
 */
export async function writeProjectCopy(input) {
  const target = projectTarget(input.cwd, input.artifactId, input.rev);
  await mkdir(target.dir, { recursive: true });
  await writeFile(target.file, input.html, { encoding: 'utf8' });
  const meta = {
    artifactId: input.artifactId,
    title: input.title,
    module: input.module,
    rev: input.rev,
    savedAt: new Date().toISOString(),
    source: 'dsh-visual-studio',
  };
  await writeFile(target.metaFile, `${JSON.stringify(meta, null, 2)}\n`, { encoding: 'utf8' });
  return { relativeFile: target.relativeFile, file: target.file, relativeDir: target.relativeDir };
}
