# dsh-mcp-guard — Host ↔ Client contract (v1)

Working name: **dsh-mcp-guard** — a security-first MCP server manager for
DeepSeek Harness (DSH). This file is the single source of truth shared by the
Host half (`index.js`, `lib/*.js`) and the Client half (`client.js`).

Host: DSH 0.2.2-rc.1 (Desktop app). No shell is ever used; stdio MCP servers are
spawned by the official `@deepseek-ai/dsh-mcp-client`, which we mount as a child
plugin per enabled server.

## Product shape

A first-class settings page (`settings.section`, id `mcp-guard`, order `22`,
label localized) called **MCP servers**:

1. Server list: managed servers + read-only rows managed by other plugins.
2. Add / edit page with **Form** and **JSON** tabs (GLM-like).
3. Import `mcpServers` JSON (strict, preview, imported disabled).
4. Enable confirmation with an execution preview (argv / URL) and risk findings.
5. Security panel: live risk analysis, secret handling, audit trail.

## Security stance (must be enforced by the Host)

- Fail-closed: every new or edited server is saved **disabled**. Enabling is a
  separate user action that requires `confirm: true` plus `acknowledgeRisk: true`
  when the highest risk level is `high` or `critical`.
- Secrets are **write-only**. Env and header values are never returned to the
  browser, never put into errors, audit entries or logs. The API returns keys
  only. Editing uses `keep` semantics per key (see `env`/`headers` entries).
- No expressions: a config containing Loader expressions (`__jsExpr`) can never
  be written; such external rows stay read-only.
- Hard blocks (cannot be overridden from the UI): execution-influencing env
  variables, non-loopback plaintext HTTP unless the server row has
  `allowPlainHttp: true`, URLs with userinfo, CR/LF in header values, prototype
  pollution keys, duplicate/unsafe JSON keys, names that clash with existing
  MCP server names, unknown fields, oversized input.
- Command execution is reviewed before enabling: the confirmation shows the
  argv that will be passed to spawn (no shell interpretation) and all risk
  findings.
- Mutations are serialized, revision-guarded and confirmed (`confirm: true`).

## HTTP endpoint

Exact route: `/api/dsh-mcp-guard` (registered with `ctx.webServer.register`,
kind `exact`). Every request must carry header `x-dsh-mcp-guard: 1` and pass
`ctx.connection.admit(req)` (DSH signed-peer admission). Responses:
`cache-control: no-store`, `x-content-type-options: nosniff`, JSON UTF-8.

- `GET` → snapshot.
- `POST` with `content-type: application/json` → one action from the table.
- Body limit: 1 MiB. JSON object required. Unknown action → 400.
- Errors use HTTP status + `{ "ok": false, "error": { "code": string, "path"?: string } }`.
  Error codes are stable, value-free strings (localized by the Client). No
  upstream error text is ever returned. Success: `{ "ok": true, "value": ... }`.

### Revision

`revision` is a hex SHA-256 of the canonical managed state
(`JSON.stringify({ servers: rawServers })`). Every mutating request carries the
`revision` the Client last saw; mismatch → HTTP 409 `STALE_CONFIGURATION`.
Confirmation is required for every mutation (`confirm: true`); missing →
`CONFIRM_REQUIRED`.

### Snapshot (GET)

```jsonc
{
  "revision": "hex",
  "officialClient": true,          // false when @deepseek-ai/dsh-mcp-client cannot be loaded
  "profileName": "desktop",
  "servers": [ ServerView ],
  "external": [ ExternalView ],
  "tools": { "total": 12, "byServer": { "github": ["mcp__github__create_issue"] } },
  "audit": [ AuditEntry ],         // newest first, max 50
  "limits": { "maxServers": 100, "maxBodyBytes": 1048576 }
}
```

`ServerView` (managed row). Env/header **values** are never included. Execution
coordinates (`command`/`args`/`cwd` for stdio, `url` for HTTP) **are** included so
the authenticated local settings UI can show a Z.ai-style command line and prefill
the editor; they are not treated as secret material (secret-shaped arguments are
still flagged as risks).

```jsonc
{
  "serverName": "github",
  "transport": "stdio",            // "stdio" | "streamable-http"
  "enabled": true,
  "source": "managed",
  "endpoint": "npx",               // stdio: command basename; http: URL origin
  "command": "npx",                // stdio only
  "args": ["-y", "@scope/server"], // stdio only (execution coordinates, not secret values)
  "cwd": "",                       // stdio only
  "url": "",                       // streamable-http only
  "argumentCount": 3,
  "envKeys": ["GITHUB_TOKEN"],
  "headerKeys": [],
  "hasSecrets": true,              // lookedSecret(key, value) on any env/header/argv value
  "toolCount": 12,
  "tools": ["mcp__github__create_issue"],
  "risk": [ Risk ],
  "highestRisk": "high",           // "critical"|"high"|"medium"|"low"|"info"|null
  "timeoutMs": 60000,
  "reconnect": { "enabled": true, "maxAttempts": 10 },
  "failOnStartupError": false,
  "maxInstructionBytes": 32768,
  "allowPlainHttp": false,
  "lastCheck": { "successful": true, "at": "2026-11-06T00:00:00.000Z", "method": "resources/list" }
}
```

`ExternalView` (row owned by another plugin / hand-written profile patch):
`{ "serverName": "personal-memory", "transport": "stdio", "enabled": true,
"source": "external" }` — no config details, no risks, read-only.

`AuditEntry`: `{ "at": ISO, "action": "create"|"update"|"remove"|"enable"|
"disable"|"import"|"check", "serverName": string|null, "transport"?: string,
"result": "ok"|"error", "highestRisk"?: string }`.

`Risk`: `{ "level": "critical"|"high"|"medium"|"low"|"info", "code": string,
"params": object }`. `params` never contains secret values or full secret-like
arguments (at most a key name or a safe command basename).

### Actions

| action | request fields | value |
|---|---|---|
| `analyze` | `draft`, optional `existingName` | AnalyzeResult |
| `create` | `draft`, `revision`, `confirm`, optional `acknowledgeRisk` | `{ saved: true }` |
| `update` | `serverName`, `draft`, `revision`, `confirm`, optional `acknowledgeRisk` | `{ saved: true }` |
| `remove` | `serverName`, `revision`, `confirm` | `{ saved: true }` |
| `toggle` | `serverName`, `enabled`, `revision`, `confirm`, optional `acknowledgeRisk` | `{ saved: true }` |
| `executionPreview` | `serverName` | ExecutionPreview |
| `check` | `serverName`, `revision` | `{ successful, at, method: "resources/list" }` |
| `previewImport` | `text` | ImportPreview |
| `import` | `text`, `revision`, `confirm` | `{ saved: true }` |
| `export` | — | `{ json: string, redacted: true }` |

`update` always saves the row disabled (re-review before enabling) and cannot
rename the server. `remove` is allowed regardless of enabled state.

#### Draft (Form payload)

```jsonc
{
  "serverName": "github",
  "transport": "stdio",            // "stdio" | "streamable-http"
  "command": "npx",                // stdio only
  "argsText": "-y\n@modelcontextprotocol/server-github", // newline- or space-separated, shell-like quotes
  "cwd": "",                       // stdio only, optional, must be absolute when set
  "url": "",                       // streamable-http only
  "env": [ EnvEntry ],             // stdio only
  "headers": [ HeaderEntry ],      // streamable-http only
  "timeoutMs": 60000,
  "reconnectEnabled": true,
  "reconnectAttempts": 10,
  "failOnStartupError": false,
  "maxInstructionBytes": 32768,
  "allowPlainHttp": false
}
```

`EnvEntry` / `HeaderEntry`: `{ "key": "GITHUB_TOKEN", "value": "..." }` for new
values, or `{ "key": "GITHUB_TOKEN", "keep": true }` to keep the stored value
during `update`. `analyze` with an `existingName` resolves `keep` from the
current config; `create`/`import` reject `keep`.

#### AnalyzeResult

```jsonc
{
  "normalized": ClientConfig | null,   // Host-normalized official client config; null when errors
  "argv": ["npx", "-y", "..."],        // stdio execution preview; null for http
  "endpoint": "npx" | "https://host",  // safe display endpoint
  "errors": [ { "code": string, "path": string } ],
  "risk": [ Risk ],
  "blocked": false,                    // true when errors or a hard block exists
  "allowPlainHttp": false,
  "hasSecrets": true
}
```

#### ExecutionPreview (used by the enable confirmation)

```jsonc
{
  "revision": "hex",
  "serverName": "github",
  "transport": "stdio",
  "argv": ["npx", "-y", "@modelcontextprotocol/server-github"],
  "cwd": "",
  "endpoint": null,                    // http: URL origin (no path/query/userinfo)
  "envKeys": ["GITHUB_TOKEN"],
  "headerKeys": [],
  "risk": [ Risk ],
  "blocked": false
}
```

`check` runs the shared resource tool (`list_mcp_resources`) against the live
connection of an enabled server, 10 s bound. It is not a liveness guarantee; the
Client labels it "last check".

#### ImportPreview

```jsonc
{
  "revision": "hex",
  "count": 2,
  "servers": [ { "serverName": "...", "transport": "...", "endpoint": "...",
                 "risk": [ Risk ], "highestRisk": "high" } ],
  "errors": [ { "code": string, "path": string } ]   // empty on success
}
```

Import is strict: `mcpServers` envelope only, 1 MiB, ≤100 servers, field
allowlist (`type|url|headers|command|args|env|cwd`), `type: http` maps to
`streamable-http`, duplicate JSON keys / `__proto__` / `prototype` / `constructor`
rejected, transport conflicts rejected, URLs validated. Imported servers save
**disabled**; no command is executed and no expression is expanded during
preview.

#### Export

`export` returns an `mcpServers` JSON document with env/header **values removed**
and replaced by `"${KEY}"` placeholders, plus `"//"`-free plain JSON. It is a
backup/migration aid, not a secret backup; the Client says so.

## Client UI requirements

- Register a `settings.section` page (id `mcp-guard`, order `22`) with title
  "MCP servers" / «MCP-серверы», localized through `ctx.locale`.
- Match host settings UI: theme tokens only (`--dsw-alias-*`), cards like Plugin
  Manager rows, 20px page title, 14px body, outlined buttons, primary Save.
- Localized English + Russian. Unknown server error/risk codes fall back to the
  raw code string (never blank).
- Fetch with `credentials: "same-origin"` and header `x-dsh-mcp-guard: 1`.
  Handle 401/403 by showing a localized "reopen the authenticated page" notice.
- Never display secret values (the API does not send them). All env/header
  values are write-only inputs.
- Views: List; Add/Edit (Form|JSON tabs); Import modal; Enable modal;
  Export modal; read-only "Managed by other plugins" section; audit log section.
- JSON tab: editable `mcpServers` entry JSON for the draft. Validate through
  `analyze` after converting it back into a draft. For an existing server,
  secrets are omitted from the JSON view; saving JSON that drops env/headers
  requires an explicit "clear stored secrets" confirm.
- No DOM injection outside the plugin's slot; one `<style>` element with
  `data-plugin="dsh-mcp-guard"` registered in an effect with cleanup.
- Accessible controls: real buttons, `role="switch"` + `aria-checked`, focus
  rings, Escape closes modals, `aria-live` for errors.

## Error codes (stable, localized by the Client)

Validation / analysis: `NAME_INVALID`, `NAME_CONFLICT`, `TRANSPORT_INVALID`,
`STDIO_COMMAND_REQUIRED`, `STDIO_COMMAND_INVALID`, `STDIO_ARGS_INVALID`,
`STDIO_CWD_INVALID`, `STDIO_ENV_INVALID`, `HTTP_URL_REQUIRED`,
`HTTP_URL_INVALID`, `HTTP_PLAINTEXT_BLOCKED`, `HTTP_HEADERS_INVALID`,
`ENV_EXECUTION_OVERRIDE`, `FIELD_UNKNOWN`, `EXPRESSION_UNSUPPORTED`,
`SECRET_KEEP_UNAVAILABLE`, `TIMEOUT_INVALID`, `RECONNECT_INVALID`,
`MAX_INSTRUCTION_INVALID`, `TOO_MANY_SERVERS`, `TOO_MANY_ENV`,
`TOO_MANY_HEADERS`, `VALUE_TOO_LONG`.

Import: `IMPORT_INPUT_INVALID`, `IMPORT_TOO_LARGE`, `IMPORT_JSON_INVALID`,
`IMPORT_UNSAFE_KEY`, `IMPORT_DUPLICATE_KEY`, `IMPORT_SHAPE`,
`IMPORT_TOO_MANY_SERVERS`, `IMPORT_NAME_INVALID`, `IMPORT_NAME_CONFLICT`,
`IMPORT_SERVER_INVALID`, `IMPORT_UNKNOWN_FIELD`, `IMPORT_TYPE_INVALID`,
`IMPORT_TRANSPORT_CONFLICT`, `IMPORT_URL_INVALID`, `IMPORT_COMMAND_INVALID`,
`IMPORT_ARGS_INVALID`, `IMPORT_ENV_INVALID`, `IMPORT_HEADERS_INVALID`,
`IMPORT_CWD_INVALID`.

API: `NOT_FOUND`, `CONFIRM_REQUIRED`, `STALE_CONFIGURATION`,
`CONFIGURATION_UNAVAILABLE`, `CONFIGURATION_INVALID`, `INVALID_REQUEST`,
`METHOD_NOT_ALLOWED`, `CONTENT_TYPE`, `BODY_TOO_LARGE`, `UNAUTHENTICATED`,
`FORBIDDEN`, `OPERATION_FAILED`, `OFFICIAL_CLIENT_UNAVAILABLE`,
`CHECK_UNAVAILABLE`, `RISK_BLOCKED`, `RISK_ACK_REQUIRED`.

## Risk codes

| code | min level | meaning |
|---|---|---|
| `risk.localExecution` | info | stdio server will run a local program |
| `risk.remoteEndpoint` | info | streamable-http endpoint |
| `risk.packageRunnerAutoInstall` | high | `npx`/`bunx`/`pnpm dlx`/`uvx` with `-y`/`--yes` or auto-install behaviour |
| `risk.packageRunnerUnpinned` | medium | package-runner spec without a pinned version |
| `risk.shellInterpreter` | high | command is a shell/interpreter (`sh`, `bash`, `zsh`, `pwsh`, `powershell`, `cmd`, `osascript`, …) |
| `risk.codeEvalFlag` | high | interpreter eval flag in argv (`-c`, `-e`, `--eval`, `-Command`, …) |
| `risk.elevatedCommand` | high | `sudo`/`su`/`doas` |
| `risk.plainHttpLoopback` | info | plaintext HTTP to loopback |
| `risk.plainHttpAllowlisted` | high | plaintext HTTP to a non-loopback host explicitly allowed on the row |
| `risk.secretInArgs` | medium | argv value looks like a credential |
| `risk.envSecretLiteral` | medium | secret-shaped literal env/header value instead of an env reference |
| `risk.namespaceAmbiguous` | low | server name contains `__` |
| `risk.cwdSystemRoot` | medium | working directory is a system root (`/`, `/etc`, `C:\Windows`, …) |
| `risk.timeoutLong` | low | per-call timeout above 10 minutes |
| `risk.reconnectDisabled` | low | reconnect disabled |

`blocked` is true when `errors` is non-empty or any risk level is `critical`.
`high` risks require `acknowledgeRisk: true` to enable (never to save disabled).

## Hard rules for `lib/security.js` / `lib/validate.js`

- Server name: `^[A-Za-z0-9_-]{1,32}$`, unique among managed rows, external MCP
  rows and the managed names of the same batch.
- stdio: `command` non-empty string ≤4096 chars, no NUL, no CR/LF; `args` ≤64
  entries, each ≤4096 chars, no NUL; `cwd` empty or absolute, no NUL; `env` ≤64
  entries, key `^[A-Za-z_][A-Za-z0-9_]{0,127}$`, value ≤8192 chars, no NUL.
- Hard-blocked env keys (case-insensitive): `NODE_OPTIONS`, `NODE_PATH`,
  `PATH`, `PYTHONPATH`, `PYTHONHOME`, `PYTHONSTARTUP`, `LD_PRELOAD`,
  `LD_LIBRARY_PATH`, `DYLD_*`, `BASH_ENV`, `ENV`, `SHELLOPTS`, `PERL5OPT`,
  `RUBYOPT`, `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `JDK_JAVA_OPTIONS`,
  `GIT_SSH_COMMAND`, `SSH_ASKPASS`, `COMSPEC`, `PSModulePath`, `DSH_*`, and any
  key matching `^__jsExpr$`.
- streamable-http: URL must parse, protocol `https:` always allowed; `http:` only
  when the host is loopback (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`)
  unless the row has `allowPlainHttp: true`. Reject userinfo, fragment,
  whitespace, backslash, control characters. `headers` ≤64 entries, key is an
  RFC 7230 token, value ≤8192 chars with no CR/LF.
- `toolCallTimeoutMs` integer 1000..600000; `maxInstructionBytes` integer
  1..1048576; reconnect delays 1..2147483647; `maxAttempts` integer 1..100.
- Drop/normalize empty optional fields; never persist `null`/`undefined`/
  `__jsExpr` marker objects.
- Secret detection: key matches `/(api[_-]?key|token|secret|passw|pwd|authorization|bearer|private[_-]?key|credential|cookie|session)/i`, or value matches a credential shape (`sk-…`, `ghp_…`, `xoxb-…`, `AKIA…`, `Bearer …`, long base64-ish strings). Secret values are never returned, logged or echoed in errors/risk params.
- `argsText` parser: whitespace separates; single and double quotes group and
  are removed; backslash escapes the next char outside single quotes; rejects
  unbalanced quotes with `STDIO_ARGS_INVALID`; never evaluates anything.

## Files and ownership (advisory)

- Lead: `index.js`, `lib/host.js`, `lib/manager.js`, `lib/http.js`,
  `lib/projection.js`, `lib/config.js`, `package.json`, `cordis.patch.yml`,
  this contract.
- Core/security teammate: `lib/security.js`, `lib/validate.js`, `lib/import.js`,
  `test/security.test.mjs`, `test/import.test.mjs`.
- UI teammate: `client.js`, `locale/*.json`, `icon.svg`,
  `test/client-static.test.mjs`.
- Repo teammate: repository root docs, `LICENSE`, `NOTICE`, `SECURITY.md`,
  `CONTRIBUTING.md`, `.github/workflows/ci.yml`, `scripts/validate.mjs`,
  `.gitignore`, `README*`, `docs/INSTALL.md`, `docs/SECURITY-MODEL.md`,
  `docs/ARCHITECTURE.md`.
