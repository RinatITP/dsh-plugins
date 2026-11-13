/**
 * Plugin-owned storage for published visuals.
 *
 * Layout under `<dshHome>/visual-studio/`:
 *
 *   catalog.json                       index: artifacts and their versions
 *   artifacts/<id>/v<rev>.html         one immutable file per published version
 *
 * The catalog is a derived index: version files are the source of truth. Every
 * mutation is serialized, written to a temporary file and renamed, so a crash
 * never leaves a half-written catalog. No user project file is touched.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_ARTIFACTS = 200;
export const MAX_VERSIONS_PER_ARTIFACT = 50;
const CATALOG_VERSION = 1;
const ID_PATTERN = /^[a-z0-9-]{3,64}$/;
const REV_PATTERN = /^[1-9][0-9]{0,5}$/;

/** Resolve plugin-owned paths for the current environment. */
export function visualStudioHome({ env = process.env, home = homedir() } = {}) {
  const configured = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '' ? env.DSH_HOME.trim() : undefined;
  const dshHome = configured ?? join(home, '.dsh');
  const root = join(dshHome, 'visual-studio');
  return {
    root,
    artifacts: join(root, 'artifacts'),
    catalog: join(root, 'catalog.json'),
    answersFile: join(root, 'answers.json'),
  };
}

function emptyCatalog() {
  return { version: CATALOG_VERSION, revision: 0, artifacts: [] };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStoredArtifact(value) {
  if (!isRecord(value) || typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) return undefined;
  if (typeof value.title !== 'string' || value.title === '') return undefined;
  if (typeof value.module !== 'string') return undefined;
  const versions = Array.isArray(value.versions)
    ? value.versions
      .filter((version) => isRecord(version) && Number.isInteger(version.rev) && version.rev > 0)
      .map((version) => ({
        rev: version.rev,
        at: typeof version.at === 'string' ? version.at : new Date(0).toISOString(),
        bytes: Number.isInteger(version.bytes) ? version.bytes : 0,
      }))
      .sort((a, b) => a.rev - b.rev)
    : [];
  if (versions.length === 0) return undefined;
  return {
    id: value.id,
    title: value.title,
    module: value.module,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : versions[0].at,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : versions[versions.length - 1].at,
    versions,
  };
}

function normalizeStoredCatalog(value) {
  if (!isRecord(value)) return emptyCatalog();
  const revision = Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0;
  const artifacts = Array.isArray(value.artifacts)
    ? value.artifacts.map(normalizeStoredArtifact).filter(Boolean)
    : [];
  return { version: CATALOG_VERSION, revision, artifacts };
}

function slugId(module) {
  const stamp = Date.now().toString(36);
  const suffix = randomUUID().slice(0, 4);
  const base = typeof module === 'string' && /^[a-z]+$/.test(module) ? module : 'visual';
  return `${base}-${stamp}-${suffix}`;
}

function versionFile(artifactId, rev) {
  return `v${rev}.html`;
}

function publicArtifact(artifact) {
  const latest = artifact.versions[artifact.versions.length - 1];
  return {
    id: artifact.id,
    title: artifact.title,
    module: artifact.module,
    rev: latest.rev,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    versions: artifact.versions.map((version) => ({ rev: version.rev, at: version.at })),
  };
}

/**
 * @param {ReturnType<typeof visualStudioHome>} paths
 */
export function createStore(paths) {
  let catalog = emptyCatalog();
  let loaded = false;
  let loadPromise = null;
  let queue = Promise.resolve();

  async function ensureLoaded() {
    if (loaded) return;
    if (loadPromise === null) {
      loadPromise = (async () => {
        await mkdir(paths.artifacts, { recursive: true, mode: 0o700 });
        try {
          const raw = await readFile(paths.catalog, 'utf8');
          catalog = normalizeStoredCatalog(JSON.parse(raw));
        } catch {
          catalog = emptyCatalog();
        }
        loaded = true;
      })();
    }
    return loadPromise;
  }

  function serialize(task) {
    const run = queue.then(async () => {
      await ensureLoaded();
      return task();
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function persist() {
    const payload = `${JSON.stringify(catalog, null, 2)}\n`;
    const temporary = `${paths.catalog}.tmp`;
    await writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, paths.catalog);
  }

  async function removeArtifactFiles(artifact) {
    await rm(join(paths.artifacts, artifact.id), { recursive: true, force: true }).catch(() => {});
  }

  async function prune() {
    const removed = [];
    catalog.artifacts.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
    while (catalog.artifacts.length > MAX_ARTIFACTS) {
      removed.push(catalog.artifacts.shift());
    }
    catalog.artifacts.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    for (const artifact of removed) await removeArtifactFiles(artifact);
  }

  async function ensureReady() {
    await ensureLoaded();
    return snapshot();
  }

  function snapshot() {
    return {
      revision: catalog.revision,
      artifacts: [...catalog.artifacts]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .map(publicArtifact),
    };
  }

  /**
   * Store one new version of a visual. Returns the public artifact summary.
   * @param {{title: string, module: string, html: string}} input
   */
  async function publish(input) {
    return serialize(async () => {
      const now = new Date().toISOString();
      let artifact = catalog.artifacts.find((candidate) => candidate.title === input.title && candidate.module === input.module);
      if (artifact === undefined) {
        artifact = {
          id: slugId(input.module),
          title: input.title,
          module: input.module,
          createdAt: now,
          updatedAt: now,
          versions: [],
        };
        catalog.artifacts.push(artifact);
      }
      const rev = (artifact.versions[artifact.versions.length - 1]?.rev ?? 0) + 1;
      const directory = join(paths.artifacts, artifact.id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = join(directory, versionFile(artifact.id, rev));
      await writeFile(file, input.html, { encoding: 'utf8', mode: 0o600 });
      const bytes = Buffer.byteLength(input.html, 'utf8');
      artifact.versions.push({ rev, at: now, bytes });
      artifact.updatedAt = now;
      if (artifact.versions.length > MAX_VERSIONS_PER_ARTIFACT) {
        const dropped = artifact.versions.splice(0, artifact.versions.length - MAX_VERSIONS_PER_ARTIFACT);
        for (const version of dropped) {
          await rm(join(directory, versionFile(artifact.id, version.rev)), { force: true }).catch(() => {});
        }
      }
      catalog.revision += 1;
      await prune();
      await persist();
      return publicArtifact(artifact);
    });
  }

  /** Find one artifact by id. */
  async function get(artifactId) {
    await ensureLoaded();
    const artifact = catalog.artifacts.find((candidate) => candidate.id === artifactId);
    return artifact === undefined ? undefined : publicArtifact(artifact);
  }

  /**
   * Read one stored version (defaults to the latest). Paths are derived from a
   * validated id and a numeric revision, never from the request string.
   */
  async function readVersion(artifactId, rev) {
    await ensureLoaded();
    if (typeof artifactId !== 'string' || !ID_PATTERN.test(artifactId)) return undefined;
    const artifact = catalog.artifacts.find((candidate) => candidate.id === artifactId);
    if (artifact === undefined) return undefined;
    const target = rev === undefined
      ? artifact.versions[artifact.versions.length - 1]
      : artifact.versions.find((version) => version.rev === rev);
    if (target === undefined) return undefined;
    try {
      const html = await readFile(join(paths.artifacts, artifact.id, versionFile(artifact.id, target.rev)), 'utf8');
      return { html, rev: target.rev, title: artifact.title, module: artifact.module };
    } catch {
      return undefined;
    }
  }

  /** Number of stored artifacts (test helper). */
  async function count() {
    await ensureLoaded();
    return catalog.artifacts.length;
  }

  return { ensureReady, snapshot, publish, get, readVersion, count, paths };
}

/** Parse a revision query value; returns undefined for the latest version. */
export function parseRevision(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value);
  if (!REV_PATTERN.test(text)) return null;
  return Number.parseInt(text, 10);
}

export { ID_PATTERN };
