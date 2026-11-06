/**
 * Operational plugin settings stored outside the Loader profile:
 * `~/.dsh/skill-curator/settings.json`.
 *
 * Keeping this apart from the profile patch avoids restarting the plugin row
 * on every toggle. Only low-risk UI preferences live here; the live-source
 * switch is the first one.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { appendAudit, ensureHome, skillCuratorHome } from './state.js';

export const SETTINGS_VERSION = 1;
const SOURCE_KEY = /^[A-Za-z0-9:_-]{1,64}$/;

export function defaultSettings() {
  return { version: SETTINGS_VERSION, liveSources: {} };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Return a sanitized settings object; unknown values are dropped. */
export function normalizeSettings(value) {
  const settings = defaultSettings();
  if (!isPlainObject(value)) return settings;
  if (Number.isInteger(value.version) && value.version > 0) settings.version = value.version;
  if (isPlainObject(value.liveSources)) {
    for (const [key, enabled] of Object.entries(value.liveSources)) {
      if (SOURCE_KEY.test(key) && enabled === true) settings.liveSources[key] = true;
    }
  }
  return settings;
}

export function settingsPath(paths) {
  return join(paths.root, 'settings.json');
}

export async function readSettings(paths) {
  const text = await readFile(settingsPath(paths), 'utf8').catch(() => null);
  if (text === null) return defaultSettings();
  try {
    return normalizeSettings(JSON.parse(text));
  } catch {
    return defaultSettings();
  }
}

async function writeSettings(paths, settings) {
  await ensureHome(paths);
  const target = settingsPath(paths);
  const temp = join(paths.root, `.settings.json.tmp-${randomUUID()}`);
  await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, target);
}

/** Toggle one live source and persist the settings file. */
export async function setLiveSource(config, key, enabled) {
  const paths = skillCuratorHome({ config: config ?? {} });
  await ensureHome(paths);
  if (typeof key !== 'string' || !SOURCE_KEY.test(key)) {
    throw Object.assign(new Error('SOURCE_KEY_INVALID'), { code: 'SOURCE_KEY_INVALID', status: 400 });
  }
  if (typeof enabled !== 'boolean') {
    throw Object.assign(new Error('ENABLED_INVALID'), { code: 'ENABLED_INVALID', status: 400 });
  }
  const settings = await readSettings(paths);
  if (enabled) settings.liveSources[key] = true;
  else delete settings.liveSources[key];
  await writeSettings(paths, settings);
  await appendAudit(paths, { action: enabled ? 'live-enable' : 'live-disable', sourceKey: key });
  return settings;
}
