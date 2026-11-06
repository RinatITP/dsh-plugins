# Architecture

This document describes how **dsh-mcp-guard** is wired into DeepSeek Harness
(DSH). The binding details — request/response shapes, actions, error codes, risk
codes and validation rules — live in [`API-CONTRACT.md`](API-CONTRACT.md), which is
the shared source of truth for both halves. The threat model is in
[`SECURITY-MODEL.md`](SECURITY-MODEL.md).

Target host: DSH **0.2.2-rc.1** (Desktop). Node.js ≥ 22.19.0.

## Two halves in one package

DSH plugins can ship a **Host** half and a web **Client** half. This package ships
both:

| Half | Entry | Manifest declaration | Runs in |
|---|---|---|---|
| Host (bundle + plugin) | `index.js` + `lib/*.js` | `dsh.bundle.patch` → `cordis.patch.yml` (one `insert` row, id `dsh-mcp-guard`) | the DSH Host process |
| Client (settings UI) | `client.js` | `dsh.client` → `{ platform: "web", inject: [...] }` | the DSH web UI (browser) |

The package is installed as a **bundle**: `dsh.bundle.patch` points at
`cordis.patch.yml`, whose single `insert` row mounts the Host plugin. Bundle
layers are composed at DSH startup, which is why installation/upgrade needs a
restart of the Host.

## Host architecture

```text
                         DSH Host process
┌──────────────────────────────────────────────────────────────────────┐
│  dsh-mcp-guard (index.js → lib/host.js)                              │
│                                                                      │
│  ctx.webServer.register('/api/dsh-mcp-guard', 'exact')               │
│        │  GET → snapshot          POST → one action (contract table) │
│        ▼                                                             │
│  lib/http.js        request envelope: content-type, 1 MiB body,      │
│                     intent header, ctx.connection.admit(req),        │
│                     no-store responses, stable error codes           │
│        │                                                             │
│        ▼                                                             │
│  lib/manager.js     serialized mutation queue: revision check,       │
│                     confirm/acknowledge, create/update/remove/       │
│                     toggle/import/check/export                       │
│        │                        │                                    │
│        │                        ├─ lib/security.js   risk analysis,  │
│        │                        │                     secret detect,  │
│        │                        │                     hard blocks    │
│        │                        ├─ lib/validate.js   field/URL/env/   │
│        │                        │                     argv validation │
│        │                        └─ lib/import.js     strict mcpServers│
│        │                                              import parsing  │
│        ▼                                                             │
│  lib/host.js        read/edit the managed list through the official  │
│                     configEditor (profile plugin row); lib/config.js  │
│                     provides the pure row/revision helpers           │
│        │                                                             │
│        ▼                                                             │
│  child mount        one official @deepseek-ai/dsh-mcp-client         │
│                     instance per ENABLED server (stdio spawn or      │
│                     Streamable HTTP session); tools register as      │
│                     mcp__<serverName>__<tool>                        │
│                                                                      │
│  lib/projection.js  snapshot projection: key names only, endpoint    │
│                     origin/basename, external rows read-only, audit  │
└──────────────────────────────────────────────────────────────────────┘
```

### Responsibilities

- **`index.js`** — thin package entry: re-exports `name`, `inject` and `apply`
  from `lib/host.js` (the manifest `exports["."]` target).
- **`lib/host.js`** — the Host plugin implementation: declares
  `inject = ['webServer', 'configEditor', 'connection']`, registers the exact
  route, reads the plugin row's configuration and edits it through
  `ctx.configEditor`, mounts/unmounts enabled rows as official MCP client
  children, and serves the `check` action through the shared resource tool.
- **`lib/http.js`** — HTTP surface and request envelope. Only the exact route
  `/api/dsh-mcp-guard`; every request carries `x-dsh-mcp-guard: 1` and must pass
  DSH's peer admission; JSON UTF-8 responses, `cache-control: no-store`,
  `x-content-type-options: nosniff`.
- **`lib/manager.js`** — serialized mutations, revision guard (`409
  STALE_CONFIGURATION`), `confirm: true` requirement, enable/disable and check
  orchestration, audit entries.
- **`lib/security.js` / `lib/validate.js`** — pure validation and risk analysis:
  no I/O, no network, no shell. They produce stable error codes and risk codes
  (never upstream text, never secret values).
- **`lib/import.js`** — strict `mcpServers` parsing: envelope, size/count limits,
  field allowlist, duplicate/unsafe key detection, transport mapping
  (`type: http` → `streamable-http`), redacted export. Preview never executes
  anything.
- **`lib/config.js`** — pure persisted-state helpers: raw `servers` access, the
  canonical revision hash, lenient row reading (a damaged row must not break the
  settings page), stored-row construction and upsert/remove helpers. It does not
  perform I/O itself.
- **`lib/errors.js`** — shared error type for stable API error codes.
- **`lib/projection.js`** — turns stored state into the browser-facing snapshot:
  env/header **key names** only, endpoint as command basename or URL origin,
  external rows read-only, bounded audit.

### Persistence

The managed server list is the plugin row's **configuration**, stored in the DSH
profile by the official `configEditor`:

```text
profile ── plugin row (id: dsh-mcp-guard) ── config.servers = [ raw server entries ]
```

- Writes go through `configEditor.edit(entry, change)`, which validates the
  candidate, serializes it with other profile changes and rejects values a higher
  layer overrides. The plugin never hand-writes profile files.
- The API `revision` is a hex SHA-256 of the canonical managed state
  (`JSON.stringify({ servers: rawServers })`). Every mutating request echoes the
  revision the Client last saw; a mismatch fails with `STALE_CONFIGURATION`.
- Saving through the config editor restarts the plugin row, so enabled server
  instances are re-mounted and reconnect. An in-flight MCP tool call may be
  interrupted.
- MCP rows owned by other plugins or written by hand into the profile are
  **external**: listed read-only, never modified. Rows containing DSH loader
  expressions are always external.

### Delegation to the official MCP client

The plugin contains **no MCP protocol implementation**: no transport, no
handshake, no reconnect logic, no tool discovery and no `mcp__…` naming. For each
enabled row it mounts a child instance of the official
`@deepseek-ai/dsh-mcp-client` with the normalized configuration
(`serverName`, `transport`, `command`/`args`/`env`/`cwd` or `url`/`headers`,
`toolCallTimeoutMs`, `maxInstructionBytes`, `failOnStartupError`, reconnect
policy). Consequences:

- tool names, discovery generations, reconnect budgets and image bridging stay
  owned by the official client and match a hand-written profile entry;
- if the official client package cannot be resolved, the snapshot reports
  `officialClient: false` and the UI cannot enable servers (no fallback path);
- the guard's job is the **decision** (should this configuration be stored/run?),
  not the MCP connection.

For stdio rows, the official client spawns the `argv` without a shell and starts
its child environment from a scrubbed parent environment; the guard additionally
blocks execution-influencing env keys before anything is stored.

### Check semantics

`check` issues `resources/list` through the shared MCP resource tool against an
enabled server's live connection with a 10 s bound. The result is stored as
`lastCheck` (`successful`, `at`, `method: "resources/list"`) and shown as a
historical "last check" — not as live health. Servers that do not support
resources can fail this check while their tools work.

## Client architecture

`client.js` is a single plain-JavaScript module — no JSX, no bundler, no build
step. It is loaded by the DSH web UI according to `dsh.client` in `package.json`
(`platform: "web"`, injects `@deepseek-ai/dsh-client-ui-settings` and
`@deepseek-ai/dsh-client-locale`).

- Registers one `settings.section` page: id `mcp-guard`, order `22`, title
  "MCP servers" / «MCP-серверы», localized through `ctx.locale` (English and
  Russian; unknown server/risk codes fall back to the raw code string, never
  blank).
- Renders with DSH theme tokens only (`--dsw-alias-*`), card/list styling aligned
  with the Plugin Manager, accessible controls (real buttons, `role="switch"` +
  `aria-checked`, focus rings, Escape closes modals, `aria-live` for errors).
- Fetches the Host route with `credentials: "same-origin"` and
  `x-dsh-mcp-guard: 1`; handles 401/403 with a localized "reopen the authenticated
  page" notice.
- Never sees secret values: env/header values are write-only inputs and the API
  returns key names only.
- Adds exactly one `<style data-plugin="dsh-mcp-guard">` element inside an effect
  with cleanup; it never injects DOM outside its settings section.
- Views: List; Add/Edit (Form | JSON tabs); Import modal; Enable confirmation with
  execution preview; Export modal; read-only "managed by other plugins" section;
  audit log section.

## Data flow

```text
User (settings UI)
   │  same-origin fetch  x-dsh-mcp-guard: 1   (revision, confirm, ack)
   ▼
/api/dsh-mcp-guard (Host)
   │  peer admission ─ body limit ─ content-type ─ action dispatch
   ▼
validate + analyze (pure) ──► errors/risk codes ──► 400 / AnalyzeResult
   │
   ▼  accepted mutation
revision check ──► configEditor.edit(entry) ──► profile saved (row disabled or toggled)
   │
   ▼
re-mount enabled rows as official dsh-mcp-client children
   │
   ▼
model tool list: mcp__<server>__<tool>        audit entry (no secrets)
```

## Design principles

1. **Least authority.** The Client is untrusted display code: it cannot mutate
   state without `confirm: true` + fresh revision, and it never receives secrets.
2. **Fail closed.** Anything that fails validation or analysis blocks the save; a
   saved row is disabled until a human re-reviews it.
3. **One writer.** Only the Host mutates configuration, only through the official
   config editor; per-server connections are owned by the official client.
4. **No hidden surfaces.** One exact HTTP route, one settings section, no DOM
   injection outside the slot, no sidecar registry or daemon.
5. **Honest state.** Projections expose what is known (`officialClient`,
   `lastCheck`) and never invent health; errors carry codes, not upstream text.

## Version coupling and upgrade notes

The plugin is coupled to release-candidate contracts of official DSH packages:
`webServer` route registration, `connection.admit`, `configEditor`, the
`settings.section` slot, locale service, and `@deepseek-ai/dsh-mcp-client`'s config
shape. It is pinned by `engines.dsh` in `package.json`. When DSH changes these
contracts, the plugin needs a matching update — the coupling is intentionally
centralized in `index.js`/`lib/*` (Host) and the slot/fetch bootstrap in
`client.js` (Client) to keep upgrades mechanical.

## Existing servers and discovery

Two additional read-only-looking surfaces feed the managed list:

1. **External rows** are active `@deepseek-ai/dsh-mcp-client` entries owned by
   other plugins or hand-written profile entries. The Host reads their resolved
   config through `configEditor` and projects a non-secret detail view. Taking
   one under management copies the validated config into this plugin (saved
   disabled) and disables the original row through the official
   `pluginManager.setPluginEnabled`; a save failure re-enables the original row.
2. **Discovery** (`lib/discovery.js`) scans an allowlist of well-known MCP
   configuration files (Cursor, Claude Code incl. per-project entries, Claude
   Desktop, VS Code, `$DSH_HOME/mcp.json`, registered workspace MCP files) and
   returns raw entries to the manager, which validates and previews them. Import
   saves the selection disabled.

## Verification status

Static and unit-level verification is automated (Node test runner + the
repository validator + CI). The plugin was installed into a DSH Desktop
`0.2.2-rc.1` profile; the settings slot registration, both route trust gates and
an end-to-end child MCP mount through the official client were observed there.
Visual inspection of the rendered settings page remains **pending** — the build
environment has no browser control. Do not treat this document as evidence that
the UI was visually observed; the record is
[`VERIFICATION.md`](VERIFICATION.md).
