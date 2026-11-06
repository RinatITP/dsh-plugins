/**
 * Read-only discovery of MCP server entries already configured for other
 * tools on this computer. Nothing is executed, imported or written here: the
 * scanner reads a small allowlist of well-known configuration files and
 * returns their raw `mcpServers` maps for the manager to validate and preview.
 *
 * Only names, transports and non-secret execution coordinates leave this
 * module; env/header values are never returned (the UI receives key names).
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Files larger than this are skipped: configuration files are small, and
 * e.g. `~/.claude.json` can carry unrelated history. */
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

function sourceId(kind, path) {
  return createHash('sha256').update(`${kind}\n${path}`).digest('hex').slice(0, 16);
}

function stringMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** Extract `[serverName, entry]` pairs from a parsed config document. */
function serverPairs(document) {
  const pairs = [];
  const servers = stringMap(document?.mcpServers);
  if (servers) for (const [name, entry] of Object.entries(servers)) pairs.push({ name, entry, scope: null });
  const altServers = stringMap(document?.servers);
  if (altServers) for (const [name, entry] of Object.entries(altServers)) pairs.push({ name, entry, scope: null });
  const projects = stringMap(document?.projects);
  if (projects) {
    for (const [projectPath, project] of Object.entries(projects)) {
      const projectServers = stringMap(project?.mcpServers);
      if (!projectServers) continue;
      for (const [name, entry] of Object.entries(projectServers)) pairs.push({ name, entry, scope: projectPath });
    }
  }
  return pairs;
}

async function readSourceFile(kind, label, path) {
  let info;
  try {
    info = await stat(path);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  if (info.size > MAX_SOURCE_BYTES) {
    return { id: sourceId(kind, path), kind, label, path, servers: [], error: 'SOURCE_TOO_LARGE' };
  }
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { id: sourceId(kind, path), kind, label, path, servers: [], error: 'SOURCE_UNREADABLE' };
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    return { id: sourceId(kind, path), kind, label, path, servers: [], error: 'SOURCE_INVALID_JSON' };
  }
  const pairs = serverPairs(document).filter((pair) => pair.entry !== null && typeof pair.entry === 'object');
  return {
    id: sourceId(kind, path),
    kind,
    label,
    path,
    servers: pairs.map((pair) => ({ serverName: pair.name, scope: pair.scope, entry: pair.entry })),
  };
}

/** Well-known machine-level configuration files, most useful first. */
function globalCandidates(home, dshHome) {
  const candidates = [
    { kind: 'cursor', label: 'Cursor', path: join(home, '.cursor', 'mcp.json') },
    { kind: 'claude-code', label: 'Claude Code', path: join(home, '.claude.json') },
    {
      kind: 'claude-desktop',
      label: 'Claude Desktop',
      path: join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    },
    { kind: 'vscode', label: 'VS Code', path: join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json') },
    { kind: 'dsh', label: 'DeepSeek Harness', path: join(dshHome, 'mcp.json') },
  ];
  return candidates;
}

/** Per-workspace configuration files, recognised by common MCP clients. */
function workspaceCandidates(workspaces) {
  const candidates = [];
  for (const workspace of workspaces) {
    if (typeof workspace !== 'string' || workspace === '') continue;
    candidates.push(
      { kind: 'project-claude', label: 'Project (Claude Code)', path: join(workspace, '.mcp.json') },
      { kind: 'project-cursor', label: 'Project (Cursor)', path: join(workspace, '.cursor', 'mcp.json') },
      { kind: 'project-vscode', label: 'Project (VS Code)', path: join(workspace, '.vscode', 'mcp.json') },
      { kind: 'project-dsh', label: 'Project (DSH)', path: join(workspace, '.dsh', 'mcp.json') },
    );
  }
  return candidates;
}

/**
 * Scan the allowlisted configuration files. Returns sources that actually
 * exist, each with raw `entry` objects for the manager's strict validation.
 *
 * @param {{ home?: string, dshHome?: string, workspaces?: string[] }} [options]
 */
export async function scanSources({ home = '', dshHome = '', workspaces = [] } = {}) {
  if (!home) return [];
  const candidates = [...globalCandidates(home, dshHome || join(home, '.dsh')), ...workspaceCandidates(workspaces)];
  const seen = new Set();
  const sources = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    const source = await readSourceFile(candidate.kind, candidate.label, candidate.path);
    if (source === null) continue;
    if (source.servers.length === 0 && !source.error) continue;
    sources.push(source);
  }
  return sources;
}

/** Find one previously scanned source by id (re-scan to avoid stale paths). */
export function findSource(sources, id) {
  if (!Array.isArray(sources) || typeof id !== 'string') return null;
  return sources.find((source) => source.id === id) ?? null;
}
