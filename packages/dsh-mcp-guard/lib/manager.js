/**
 * Pure controller behind the dsh-mcp-guard settings page.
 *
 * No filesystem, no transport, no child processes: all effects are injected
 * (`readRaw`, `editRaw`, `checkConnection`, ...). Every mutating operation is
 * serialized, revision-guarded and confirmed. Secret values never leave this
 * module in a projection.
 */
import { createHash } from 'node:crypto';
import { ManagerError } from './errors.js';
import { MAX_BODY_BYTES, MAX_SERVERS, managedNames, readRows, revisionOf, storedRow } from './config.js';
import { analyzeServer, isLoopbackHost } from './security.js';
import { normalizeDraft, validateClient } from './validate.js';
import { ImportError, parseImport, exportServers } from './import.js';
import {
  clientHasSecrets,
  highestRiskLevel,
  projectServer,
  projectToolMap,
  requiresAcknowledgement,
  safeEndpoint,
} from './projection.js';

/** Raw stored rows, preserving unknown top-level keys for data safety. */
const rawRowList = (rows) => rows.map((row) => row.original ?? { enabled: false, client: null });

/** In-memory connection checks; deliberately not persisted. */
const checks = new Map();
/** In-memory audit ring, newest first, max 50. */
const auditLog = [];

/** Test/diagnostic reset of module-level ephemeral state. */
export function resetManagerState() {
  checks.clear();
  auditLog.length = 0;
}

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function requireConfirm(body) {
  if (body?.confirm !== true) throw new ManagerError('CONFIRM_REQUIRED', 400);
}

/**
 * @param {object} deps
 * @param {() => object | Promise<object>} deps.readRaw returns the plugin's raw config
 * @param {(change: (current: object) => object) => Promise<void>} deps.editRaw persists a complete config
 * @param {() => Promise<{serverName:string|null,transport:string,enabled:boolean}[]>} deps.external external MCP rows
 * @param {() => {name:string}[]} deps.toolSchemas registered tool schemas
 * @param {() => Promise<{id:string,kind:string,label:string,path:string,error?:string,servers:{serverName:string,scope?:string|null,entry:object}[]}[]>} [deps.discover] read-only config discovery
 * @param {(patchId: string) => Promise<Record<string, unknown> | null>} [deps.externalClient] resolved external row config
 * @param {(patchId: string, enabled: boolean) => Promise<void>} [deps.setExternalEnabled] official plugin toggle
 * @param {(serverName: string) => Promise<boolean>} [deps.checkConnection]
 * @param {boolean} [deps.officialClient] whether @deepseek-ai/dsh-mcp-client loaded
 * @param {string|null} [deps.profileName]
 * @param {() => string} [deps.now]
 */
export function createManager(deps) {
  const {
    readRaw,
    editRaw,
    external = async () => [],
    externalClient,
    setExternalEnabled,
    discover,
    toolSchemas = () => [],
    checkConnection,
    officialClient = false,
    profileName = null,
    now = () => new Date().toISOString(),
  } = deps;

  /** Serialize every mutation so revision checks cannot race. */
  let chain = Promise.resolve();
  function serialize(operation) {
    const run = chain.then(operation, operation);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** True when the stored URL is plaintext HTTP to a non-loopback host. */
  function plainHttpNeedsAllow(client) {
    if (!client || client.transport !== 'streamable-http' || typeof client.url !== 'string') return false;
    try {
      const url = new URL(client.url);
      return url.protocol === 'http:' && !isLoopbackHost(url.hostname);
    } catch {
      return false;
    }
  }

  /** Strict official-client config from one raw `mcpServers` entry. */
  function clientFromEntry(serverName, entry) {
    const parsed = parseImport(JSON.stringify({ mcpServers: { [serverName]: entry } }), []);
    return parsed.servers[0];
  }

  async function snapshot() {
    const raw = await readRaw();
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ManagerError('CONFIGURATION_UNAVAILABLE', 503);
    }
    const rows = readRows(raw);
    return {
      raw,
      revision: revisionOf(raw),
      rows,
      external: await Promise.resolve(external()),
    };
  }

  function externalNames(externalRows) {
    return new Set(
      (externalRows ?? [])
        .map((row) => row?.serverName)
        .filter((name) => typeof name === 'string' && name.length > 0),
    );
  }

  function occupiedNames(rows, externalRows, exceptServerName = null) {
    const names = managedNames(rows);
    if (exceptServerName !== null) names.delete(exceptServerName);
    for (const name of externalNames(externalRows)) names.add(name);
    return names;
  }

  function findRow(rows, serverName) {
    const index = rows.findIndex((row) => row?.client?.serverName === serverName);
    if (index === -1) throw new ManagerError('NOT_FOUND', 404);
    return { index, row: rows[index] };
  }

  function riskOf(row) {
    return analyzeServer(row.client, { allowPlainHttp: row.allowPlainHttp === true });
  }

  function lastCheckFor(serverName, revision) {
    const entry = checks.get(serverName);
    return entry && entry.revision === revision ? entry.result : null;
  }

  async function saveRows(nextRows, expectedRevision, audit) {
    await editRaw((current) => {
      if (revisionOf(current) !== expectedRevision) {
        throw new ManagerError('STALE_CONFIGURATION', 409);
      }
      return { ...current, servers: nextRows };
    });
    pushAudit(audit);
    checks.clear();
    return { saved: true };
  }

  function pushAudit(entry) {
    if (!entry) return;
    auditLog.unshift({ at: now(), serverName: entry.serverName ?? null, ...entry });
    if (auditLog.length > 50) auditLog.length = 50;
  }

  async function resolveDraft(body, rows, externalRows) {
    const existingName = typeof body?.existingName === 'string' ? body.existingName : null;
    const existingRow = existingName === null ? null : rows.find((row) => row?.client?.serverName === existingName) ?? null;
    const normalized = normalizeDraft(body?.draft ?? {}, { existingClient: existingRow?.client ?? null });
    const conflictNames = occupiedNames(rows, externalRows, existingName);
    if (conflictNames.has(normalized.client.serverName)) {
      throw new ManagerError('NAME_CONFLICT', 400);
    }
    return normalized;
  }

  return {
    /** Settings list snapshot. */
    async list() {
      const snap = await snapshot();
      const schemas = toolSchemas();
      const knownNames = [
        ...managedNames(snap.rows),
        ...externalNames(snap.external),
      ];
      const map = projectToolMap(schemas, knownNames);
      const servers = snap.rows.map((row) => {
        const risk = row.invalid ? [] : riskOf(row).risk;
        const view = projectServer(row, {
          tools: map.byServer?.[row.client?.serverName] ?? [],
          lastCheck: lastCheckFor(row.client?.serverName, snap.revision),
          risk,
        });
        if (row.invalid) view.configurationError = 'CONFIGURATION_INVALID';
        return view;
      });
      return {
        revision: snap.revision,
        officialClient: officialClient === true,
        profileName,
        servers,
        external: snap.external.map((entry) => ({
          ...entry,
          source: 'external',
          toolCount: map.byServer?.[entry.serverName]?.length ?? 0,
          tools: [...(map.byServer?.[entry.serverName] ?? [])].sort(),
        })),
        tools: { total: map.total, byServer: map.byServer },
        audit: auditLog.slice(0, 50),
        limits: { maxServers: MAX_SERVERS, maxBodyBytes: MAX_BODY_BYTES },
      };
    },

    /** Validate a draft without saving; never throws for validation errors. */
    async analyze(body) {
      const snap = await snapshot();
      try {
        const normalized = await resolveDraft(body, snap.rows, snap.external);
        const analysis = analyzeServer(normalized.client, { allowPlainHttp: normalized.allowPlainHttp });
        return {
          normalized: normalized.client,
          argv: normalized.client.transport === 'stdio'
            ? [normalized.client.command, ...(normalized.client.args ?? [])]
            : null,
          endpoint: safeEndpoint(normalized.client),
          errors: [],
          risk: analysis.risk,
          blocked: analysis.blocked === true,
          allowPlainHttp: normalized.allowPlainHttp === true,
          hasSecrets: normalized.hasSecrets === true || clientHasSecrets(normalized.client),
        };
      } catch (error) {
        if (error instanceof ManagerError || error instanceof ImportError) {
          return {
            normalized: null,
            argv: null,
            endpoint: null,
            errors: [{ code: error.code, path: error.path ?? '' }],
            risk: [],
            blocked: true,
            allowPlainHttp: body?.draft?.allowPlainHttp === true,
            hasSecrets: false,
          };
        }
        if (typeof error?.code === 'string') {
          return {
            normalized: null,
            argv: null,
            endpoint: null,
            errors: [{ code: error.code, path: error.path ?? '' }],
            risk: [],
            blocked: true,
            allowPlainHttp: body?.draft?.allowPlainHttp === true,
            hasSecrets: false,
          };
        }
        throw error;
      }
    },

    /** Add one server; always saved disabled. */
    create(body) {
      return serialize(async () => {
        requireConfirm(body);
        const snap = await snapshot();
        if (body.revision !== snap.revision) throw new ManagerError('STALE_CONFIGURATION', 409);
        if (snap.rows.length >= MAX_SERVERS) throw new ManagerError('TOO_MANY_SERVERS', 400);
        const normalized = await resolveDraft(body, snap.rows, snap.external);
        const analysis = analyzeServer(normalized.client, { allowPlainHttp: normalized.allowPlainHttp });
        if (analysis.blocked) throw new ManagerError('RISK_BLOCKED', 400);
        const nextRows = [...rawRowList(snap.rows), storedRow(normalized.client, normalized.allowPlainHttp)];
        const result = await saveRows(nextRows, snap.revision, {
          action: 'create',
          serverName: normalized.client.serverName,
          transport: normalized.client.transport,
          result: 'ok',
          highestRisk: highestRiskLevel(analysis.risk),
        });
        return result;
      });
    },

    /** Replace one server; always saved disabled. */
    update(body) {
      return serialize(async () => {
        requireConfirm(body);
        const snap = await snapshot();
        if (body.revision !== snap.revision) throw new ManagerError('STALE_CONFIGURATION', 409);
        const { row } = findRow(snap.rows, body.serverName);
        if (row.invalid) throw new ManagerError('CONFIGURATION_INVALID', 400);
        const normalized = await resolveDraft({ ...body, existingName: body.serverName }, snap.rows, snap.external);
        if (normalized.client.serverName !== body.serverName) throw new ManagerError('NAME_INVALID', 400);
        const analysis = analyzeServer(normalized.client, { allowPlainHttp: normalized.allowPlainHttp });
        if (analysis.blocked) throw new ManagerError('RISK_BLOCKED', 400);
        const nextRows = rawRowList(snap.rows).map((stored) =>
          stored?.client?.serverName === body.serverName ? storedRow(normalized.client, normalized.allowPlainHttp) : stored,
        );
        const result = await saveRows(nextRows, snap.revision, {
          action: 'update',
          serverName: normalized.client.serverName,
          transport: normalized.client.transport,
          result: 'ok',
          highestRisk: highestRiskLevel(analysis.risk),
        });
        return result;
      });
    },

    /** Remove one managed server. */
    remove(body) {
      return serialize(async () => {
        requireConfirm(body);
        const snap = await snapshot();
        if (body.revision !== snap.revision) throw new ManagerError('STALE_CONFIGURATION', 409);
        const { serverName } = body;
        const found = snap.rows.some((row) => row?.client?.serverName === serverName);
        if (!found) throw new ManagerError('NOT_FOUND', 404);
        const nextRows = rawRowList(snap.rows).filter((row) => row?.client?.serverName !== serverName);
        return saveRows(nextRows, snap.revision, {
          action: 'remove',
          serverName,
          result: 'ok',
        });
      });
    },

    /** Enable or disable one managed server. */
    toggle(body) {
      return serialize(async () => {
        if (typeof body?.enabled !== 'boolean') throw new ManagerError('INVALID_REQUEST', 400);
        requireConfirm(body);
        const snap = await snapshot();
        if (body.revision !== snap.revision) throw new ManagerError('STALE_CONFIGURATION', 409);
        const { row } = findRow(snap.rows, body.serverName);
        const analysis = riskOf(row);
        if (analysis.blocked) throw new ManagerError('RISK_BLOCKED', 400);
        if (body.enabled) {
          if (externalNames(snap.external).has(body.serverName)) throw new ManagerError('NAME_CONFLICT', 400);
          if (requiresAcknowledgement(analysis.risk) && body.acknowledgeRisk !== true) {
            throw new ManagerError('RISK_ACK_REQUIRED', 400);
          }
        }
        const nextRows = rawRowList(snap.rows).map((stored) =>
          stored?.client?.serverName === body.serverName ? { ...stored, enabled: body.enabled } : stored,
        );
        return saveRows(nextRows, snap.revision, {
          action: body.enabled ? 'enable' : 'disable',
          serverName: body.serverName,
          transport: row.client?.transport,
          result: 'ok',
          highestRisk: highestRiskLevel(analysis.risk),
        });
      });
    },

    /** Exact command/endpoint that enabling would run, plus its risks. */
    async executionPreview(body) {
      const snap = await snapshot();
      const { row } = findRow(snap.rows, body?.serverName);
      if (row.invalid) throw new ManagerError('CONFIGURATION_INVALID', 400);
      const analysis = riskOf(row);
      const client = row.client;
      return {
        revision: snap.revision,
        serverName: client.serverName,
        transport: client.transport,
        argv: client.transport === 'stdio' ? [client.command, ...(client.args ?? [])] : null,
        cwd: client.transport === 'stdio' ? client.cwd ?? '' : null,
        endpoint: safeEndpoint(client),
        envKeys: Object.keys(client.env ?? {}).sort(),
        headerKeys: Object.keys(client.headers ?? {}).sort(),
        risk: analysis.risk,
        blocked: analysis.blocked === true,
      };
    },

    /** Run the shared MCP resource tool against an enabled live connection. */
    async check(body) {
      const snap = await snapshot();
      if (body?.revision !== undefined && body.revision !== snap.revision) {
        throw new ManagerError('STALE_CONFIGURATION', 409);
      }
      const { row } = findRow(snap.rows, body?.serverName);
      if (!row.enabled) throw new ManagerError('NOT_FOUND', 404);
      if (typeof checkConnection !== 'function') throw new ManagerError('CHECK_UNAVAILABLE', 503);
      let successful = false;
      try {
        successful = (await checkConnection(row.client.serverName)) === true;
      } catch {
        successful = false;
      }
      const result = { successful, at: now(), method: 'resources/list' };
      checks.set(row.client.serverName, { revision: snap.revision, result });
      pushAudit({ action: 'check', serverName: row.client.serverName, transport: row.client.transport, result: successful ? 'ok' : 'error' });
      return result;
    },

    /** Strict JSON preview; validation failures are returned, not thrown. */
    async previewImport(body) {
      const snap = await snapshot();
      const names = occupiedNames(snap.rows, snap.external);
      try {
        const parsed = parseImport(body?.text, [...names]);
        const preview = parsed.servers.map((client) => {
          const analysis = analyzeServer(client, { allowPlainHttp: false });
          return {
            serverName: client.serverName,
            transport: client.transport,
            endpoint: safeEndpoint(client),
            risk: analysis.risk,
            highestRisk: highestRiskLevel(analysis.risk),
          };
        });
        return { revision: snap.revision, count: preview.length, servers: preview, errors: [] };
      } catch (error) {
        if (error instanceof ImportError || typeof error?.code === 'string') {
          return { revision: snap.revision, count: 0, servers: [], errors: [{ code: error.code, path: '' }] };
        }
        throw error;
      }
    },

    /** Import servers; all saved disabled. */
    importServers(body) {
      return serialize(async () => {
        requireConfirm(body);
        const snap = await snapshot();
        if (body.revision !== snap.revision) throw new ManagerError('STALE_CONFIGURATION', 409);
        const names = occupiedNames(snap.rows, snap.external);
        const parsed = parseImport(body?.text, [...names]);
        if (snap.rows.filter((row) => !row.invalid).length + parsed.servers.length > MAX_SERVERS) {
          throw new ManagerError('TOO_MANY_SERVERS', 400);
        }
        let nextRows = rawRowList(snap.rows);
        for (const client of parsed.servers) {
          nextRows = [...nextRows, storedRow(client, false)];
        }
        return saveRows(nextRows, snap.revision, {
          action: 'import',
          serverName: null,
          result: 'ok',
        });
      });
    },

    /**
     * Read-only detail for one MCP row that belongs to another plugin or a
     * hand-written profile entry. No env/header values.
     */
    async externalDetail(body) {
      const snap = await snapshot();
      const row = snap.external.find(
        (item) => (typeof body?.patchId === 'string' && item.patchId === body.patchId)
          || (typeof body?.serverName === 'string' && item.serverName === body.serverName),
      );
      if (!row || !row.patchId) throw new ManagerError('NOT_FOUND', 404);
      if (typeof externalClient !== 'function') throw new ManagerError('EXTERNAL_UNAVAILABLE', 503);
      const resolved = await externalClient(row.patchId);
      if (!resolved) throw new ManagerError('NOT_FOUND', 404);
      const client = resolved.client;
      const risk = analyzeServer(client, { allowPlainHttp: plainHttpNeedsAllow(client) }).risk;
      const schemas = toolSchemas();
      const map = projectToolMap(schemas, [client.serverName]);
      return {
        patchId: row.patchId,
        serverName: client.serverName,
        source: 'external',
        enabled: resolved.enabled === true,
        transport: client.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
        ...(client.transport === 'streamable-http'
          ? { url: typeof client.url === 'string' ? client.url : '' }
          : {
              command: typeof client.command === 'string' ? client.command : '',
              args: Array.isArray(client.args) ? [...client.args] : [],
              cwd: typeof client.cwd === 'string' ? client.cwd : '',
            }),
        envKeys: Object.keys(client.env ?? {}).sort(),
        headerKeys: Object.keys(client.headers ?? {}).sort(),
        risk,
        highestRisk: highestRiskLevel(risk),
        toolCount: map.byServer?.[client.serverName]?.length ?? 0,
        tools: [...(map.byServer?.[client.serverName] ?? [])].sort(),
      };
    },

    /**
     * Take an external MCP row under management: copy its validated config,
     * disable the original profile row through the official plugin manager and
     * save the copy disabled for review. Rollback re-enables the original row
     * when saving fails.
     */
    adoptExternal(body) {
      return serialize(async () => {
        requireConfirm(body);
        const snap = await snapshot();
        if (body.revision !== snap.revision) throw new ManagerError('STALE_CONFIGURATION', 409);
        const row = snap.external.find(
          (item) => (typeof body?.patchId === 'string' && item.patchId === body.patchId)
            || (typeof body?.serverName === 'string' && item.serverName === body.serverName),
        );
        if (!row || !row.patchId) throw new ManagerError('NOT_FOUND', 404);
        if (typeof externalClient !== 'function' || typeof setExternalEnabled !== 'function') {
          throw new ManagerError('EXTERNAL_UNAVAILABLE', 503);
        }
        const resolved = await externalClient(row.patchId);
        if (!resolved) throw new ManagerError('NOT_FOUND', 404);
        const allowPlainHttp = plainHttpNeedsAllow(resolved.client);
        let client;
        try {
          client = validateClient(resolved.client, { allowPlainHttp });
        } catch (error) {
          throw error instanceof ManagerError ? error : new ManagerError(error?.code ?? 'CONFIGURATION_INVALID', 400);
        }
        if (managedNames(snap.rows).has(client.serverName)) throw new ManagerError('NAME_CONFLICT', 400);
        await setExternalEnabled(row.patchId, false);
        try {
          const result = await saveRows(
            [...rawRowList(snap.rows), storedRow(client, allowPlainHttp)],
            snap.revision,
            {
              action: 'adopt',
              serverName: client.serverName,
              transport: client.transport,
              result: 'ok',
              highestRisk: highestRiskLevel(analyzeServer(client, { allowPlainHttp }).risk),
            },
          );
          return { ...result, adopted: client.serverName };
        } catch (error) {
          try {
            await setExternalEnabled(row.patchId, true);
          } catch {
            throw new ManagerError('ADOPT_ROLLBACK_FAILED', 500);
          }
          throw error instanceof ManagerError ? error : new ManagerError('ADOPT_FAILED', 500);
        }
      });
    },

    /** Read-only scan of known MCP configuration files on this computer. */
    async discoverConfigs() {
      const snap = await snapshot();
      if (typeof discover !== 'function') throw new ManagerError('DISCOVERY_UNAVAILABLE', 503);
      const sources = await discover();
      const managed = managedNames(snap.rows);
      const occupied = externalNames(snap.external);
      return {
        revision: snap.revision,
        sources: (Array.isArray(sources) ? sources : []).slice(0, 30).map((source) => {
          const servers = [];
          for (const item of Array.isArray(source.servers) ? source.servers : []) {
            const serverName = typeof item?.serverName === 'string' ? item.serverName : '';
            const view = {
              serverName,
              scope: typeof item?.scope === 'string' ? item.scope : null,
              alreadyManaged: managed.has(serverName),
              alreadyExternal: occupied.has(serverName),
            };
            try {
              const client = clientFromEntry(serverName, item.entry);
              const allowPlainHttp = plainHttpNeedsAllow(client);
              const risk = analyzeServer(client, { allowPlainHttp }).risk;
              servers.push({
                ...view,
                transport: client.transport,
                ...(client.transport === 'streamable-http'
                  ? { url: client.url }
                  : { command: client.command, args: [...(client.args ?? [])], cwd: client.cwd ?? '' }),
                envKeys: Object.keys(client.env ?? {}).sort(),
                headerKeys: Object.keys(client.headers ?? {}).sort(),
                needsPlainHttpAllow: allowPlainHttp,
                risk,
                highestRisk: highestRiskLevel(risk),
              });
            } catch (error) {
              servers.push({ ...view, error: typeof error?.code === 'string' ? error.code : 'SOURCE_INVALID_ENTRY' });
            }
            if (servers.length >= 200) break;
          }
          return {
            id: source.id,
            kind: source.kind,
            label: source.label,
            path: source.path,
            error: typeof source.error === 'string' ? source.error : null,
            servers,
          };
        }),
      };
    },

    /** Import selected servers discovered on disk; always saved disabled. */
    importDiscovered(body) {
      return serialize(async () => {
        requireConfirm(body);
        const snap = await snapshot();
        if (body.revision !== snap.revision) throw new ManagerError('STALE_CONFIGURATION', 409);
        if (typeof discover !== 'function') throw new ManagerError('DISCOVERY_UNAVAILABLE', 503);
        const sources = await discover();
        const source = (Array.isArray(sources) ? sources : []).find((item) => item?.id === body.sourceId);
        if (!source) throw new ManagerError('SOURCE_NOT_FOUND', 404);
        const requested = Array.isArray(body.serverNames) ? body.serverNames.filter((name) => typeof name === 'string') : [];
        if (requested.length === 0) throw new ManagerError('INVALID_REQUEST', 400);
        if (requested.length > MAX_SERVERS) throw new ManagerError('TOO_MANY_SERVERS', 400);
        const occupied = occupiedNames(snap.rows, snap.external);
        let nextRows = rawRowList(snap.rows);
        const imported = [];
        const skipped = [];
        for (const name of requested) {
          const item = (source.servers ?? []).find((candidate) => candidate.serverName === name);
          if (!item) {
            skipped.push({ serverName: name, code: 'SOURCE_NOT_FOUND' });
            continue;
          }
          if (occupied.has(name)) {
            skipped.push({ serverName: name, code: 'NAME_CONFLICT' });
            continue;
          }
          try {
            const client = clientFromEntry(name, item.entry);
            const allowPlainHttp = plainHttpNeedsAllow(client);
            validateClient(client, { allowPlainHttp });
            if (nextRows.length >= MAX_SERVERS) throw new ManagerError('TOO_MANY_SERVERS', 400);
            nextRows = [...nextRows, storedRow(client, allowPlainHttp)];
            occupied.add(name);
            imported.push(name);
          } catch (error) {
            skipped.push({
              serverName: name,
              code: typeof error?.code === 'string' ? error.code : 'IMPORT_ERROR',
            });
          }
        }
        if (imported.length === 0) {
          return { saved: false, imported: [], skipped };
        }
        const result = await saveRows(nextRows, snap.revision, {
          action: 'import',
          serverName: null,
          result: 'ok',
        });
        return { ...result, imported, skipped };
      });
    },

    /** Redacted `mcpServers` export; never includes secret values. */
    async export() {
      const snap = await snapshot();
      const rows = snap.rows.filter((row) => !row.invalid).map((row) => ({ client: row.client, allowPlainHttp: row.allowPlainHttp }));
      return exportServers(rows);
    },
  };
}
