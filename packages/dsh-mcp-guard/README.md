# dsh-mcp-guard

Security-first **MCP server manager** for [DeepSeek Harness](https://github.com/RinatITP/dsh-plugins)
(DSH). Adds an **MCP servers** page to the DSH settings UI, manages stdio and
Streamable HTTP MCP servers, validates them strictly, previews execution before
enabling and keeps a bounded audit trail.

Development preview `0.1.0`, targeting DSH **0.2.2-rc.1**.

- Repository: <https://github.com/RinatITP/dsh-plugins>
- Docs: [install](../../docs/INSTALL.md) · [architecture](../../docs/ARCHITECTURE.md) ·
  [security model](../../docs/SECURITY-MODEL.md) · [plugin catalog](../../docs/PLUGINS.md)
- License: MIT

## What it does

| Capability | Details |
|---|---|
| Server list | Z.ai/GLM-inspired list: scope pill, search, grouped full-width rows with transport glyph, status dot, monospace command line and pill toggle. MCP rows owned by other plugins or hand-written profiles are shown **read-only**, with their resolved name, transport, command line and tools; clicking one opens a detail view. |
| Existing servers | "Managed by other plugins" rows can be inspected (command/URL, env/header **keys**, risks, tools) and **taken under management**: a validated copy is saved disabled and the original profile row is disabled through the official plugin manager, with rollback if saving fails. |
| Find configs | A read-only scanner discovers MCP servers already configured for Cursor, Claude Code (including per-project entries), Claude Desktop, VS Code and registered DSH workspaces; selected servers can be imported into MCP Guard, always **disabled** for review. Nothing is executed during discovery. |
| Add / edit | Form tab and JSON tab for one `mcpServers` entry, following the Z.ai MCP form layout (Type, Timeout MS, read-only Protocol version, Command, Arguments, env/header JSON editors, Advanced). The form prefills command/args/cwd/url from the stored row; env/header **values** stay write-only. Editing keeps the server name and re-saves the row disabled so it is reviewed again before it can run. |
| Design | Settings page visual language adapted from the Z.ai (GLM) MCP Servers screen: 28px title, scope pill, search field, grouped rows with circular icons, Form/JSON pill tabs, full-configuration JSON tab — implemented with DSH theme tokens only (light and dark). |
| Import | Strict `mcpServers` JSON import: 1 MiB / ≤100 servers, `type: http` converted to `streamable-http`, unknown fields, duplicate keys and prototype-pollution keys rejected. Imported servers are saved **disabled**; nothing runs during the preview. |
| Enable confirmation | Every enable shows the resolved execution — the `argv` passed to `spawn` for stdio, or the URL origin for HTTP — with risk findings. High-risk rows require an extra risk acknowledgement. |
| Live risk analysis | Risk findings such as auto-installing package runners, shell interpreters, eval flags, elevated commands, plaintext non-loopback HTTP, secret-shaped argv values, ambiguous namespaces and disabled reconnect. |
| Connection check | "Last check" runs `resources/list` through the shared MCP resource tool against an enabled server (10 s bound). It is a historical check, **not** a liveness guarantee. |
| Import / export | `export` produces an `mcpServers` JSON document with env/header **values replaced by `${KEY}` placeholders** — a migration aid, not a secret backup. |
| Audit trail | Newest-first, bounded to the 50 most recent actions; no secret values are recorded. |

Connections, reconnects, tool discovery and `mcp__<server>__<tool>` naming are
**not** reimplemented here: every enabled server is mounted as a child instance
of the official `@deepseek-ai/dsh-mcp-client` plugin. This package is
configuration storage, safety checks, HTTP API and settings UI.

## Security model in eight lines

1. **Fail closed.** New and edited servers are saved disabled; enabling is a
   separate, confirmed user action.
2. **Secrets are write-only.** Env and header values are stored by the host in the
   profile and never returned to the browser — the API exposes key names only.
3. **No expressions.** The plugin never writes DSH loader expressions and treats
   expression-bearing rows as read-only.
4. **No shell.** stdio servers are executed as an argv vector; commands and
   arguments are never passed through a shell.
5. **Hard blocks** that the UI cannot override: execution-influencing environment
   variables, non-loopback plaintext HTTP without an explicit per-row allowance,
   URLs with userinfo, CR/LF in header values, prototype-pollution keys, unknown
   fields, names that collide with existing MCP servers, oversized input.
6. **Serialized, revision-guarded mutations.** Every write carries the revision the
   UI last saw (`STALE_CONFIGURATION` otherwise) and `confirm: true`.
7. **Local API only.** The exact route `/api/dsh-mcp-guard` requires a DSH-admitted
   peer plus the `x-dsh-mcp-guard: 1` intent header; responses are `no-store`.
8. **User-only enablement.** The plugin registers **no agent tool or command** for
   creating, enabling or disabling servers. The agent cannot turn an MCP server
   on; only the human in the settings UI can.

The full threat model, residual risks and the list of remaining risks this plugin
does *not* eliminate are in [`docs/SECURITY-MODEL.md`](../../docs/SECURITY-MODEL.md).

## Installation

Prerequisite: DSH **0.2.2-rc.1** (`engines.dsh: ">=0.2.2-rc.1 <0.3.0-0"` in
`package.json`; the official MCP client is an optional peer dependency resolved
from the host) and Node.js **≥ 22.19.0** for development or CLI use. The Desktop
application ships its own runtime.

Install the `packages/dsh-mcp-guard` **directory** of a checkout into the profile
the GUI uses — with the DSH Desktop Plugin Manager (recommended) or the CLI:

```sh
# DSH Desktop profile
dsh plugin --profile desktop add "/absolute/path/to/dsh-plugins/packages/dsh-mcp-guard"

# A `dsh web` deployment instead of Desktop
dsh plugin --profile web add "/absolute/path/to/dsh-plugins/packages/dsh-mcp-guard"
```

A local directory install links the checkout instead of copying it. Bundle layers
are composed at startup, so **fully restart DSH** after installing, updating or
removing the plugin (a page reload is not enough for the Host half). Step-by-step
instructions, the Plugin Manager route, verification and uninstall are in
[`docs/INSTALL.md`](../../docs/INSTALL.md).

> The plugin is not yet published to npm, and installing it directly from a
> GitHub subdirectory of this monorepo is **not tested**.

## Usage

1. Open DSH settings → **MCP servers** (the page is registered through the official
   `settings.section` slot; title localized as English "MCP servers" and Russian
   «MCP-серверы»).
2. **Add server**: choose `stdio` or `streamable-http`, fill the form (or paste a
   single `mcpServers` entry into the JSON tab), review the live risk analysis in
   the security panel, save. The row is saved **disabled**.
3. **Enable** the row. A confirmation modal shows the exact argv/endpoint and the
   risk findings; rows with `high` risk also require the risk acknowledgement.
4. Enabled servers register their tools as `mcp__<serverName>__<tool>` and become
   callable by the agent.
5. **Import** a `mcpServers` document, review the preview, confirm. All imported
   rows start disabled.
6. **Export** for migration: secrets are replaced by `${KEY}` placeholders.

Editing a row keeps the same server name and saves it disabled again. Removing a
row works regardless of its enabled state. Rows created by other plugins (or
hand-written in the profile) are listed in a separate read-only section and are
never modified by this plugin.

## Configuration

- The plugin's own row configuration is the **managed server list**, persisted in
  the DSH profile by the official `configEditor` when you save in the UI. There is
  no separate sidecar registry, daemon or transport.
- Per-server fields exposed by the form: `serverName`, `transport`, `command`,
  `args` (newline/space separated, shell-like quoting), `cwd`, `url`, `env`,
  `headers`, per-call timeout (`timeoutMs`, mapped to the official client's
  `toolCallTimeoutMs`), reconnect (`reconnectEnabled` / `reconnectAttempts`),
  `failOnStartupError`, `maxInstructionBytes`, and per-row `allowPlainHttp`.
- Env and header values are entered write-only. During an edit, `keep` semantics
  preserve a stored value per key without revealing it.
- Hard limits (from the contract): server name `^[A-Za-z0-9_-]{1,32}$`, ≤100
  servers, ≤64 args, ≤64 env entries, ≤64 headers, 1 MiB API body.
- Bypass/backup: use **Export**, not hand-editing the profile. A manual edit of the
  plugin's persisted list is outside the supported path: it bypasses the UI
  checks, and the plugin's guardrails are not a runtime sandbox that re-vets
  arbitrary profile content.

Saving the managed list goes through DSH's config editor, which restarts this
plugin row; enabled servers are re-mounted and reconnect. An in-flight MCP tool
call can be interrupted.

## Privacy

- **No telemetry, analytics or remote calls of its own.** The plugin only manages
  the MCP endpoints you configure; network traffic to those endpoints is performed
  by the official MCP client on your behalf.
- **No secret values** are returned to the browser, written to errors, audit
  entries or logs.
- The local API returns stable error **codes**, not upstream error text.

## Limitations

- Target DSH line is `0.2.2-rc.1`; the plugin uses official Host/Client services
  (`webServer`, `configEditor`, `connection`, `settings.section`, `locale`) and is
  coupled to their release-candidate contracts. Newer DSH releases may require an
  update.
- If `@deepseek-ai/dsh-mcp-client` cannot be resolved, the snapshot reports
  `officialClient: false` and enabling is unavailable — there is no fallback
  transport.
- "Last check" is a resource-listing check, not a health monitor: a server without
  resources support may fail it while its tools work.
- The audit snapshot is bounded (newest 50 entries); it is a review aid, not
  tamper-evident storage.
- External/hand-written profile rows are read-only until taken under management;
  the takeover disables the original profile row through the official plugin
  manager (reversible from the Plugin Manager).
- Discovery reads a fixed allowlist of configuration files only; it never runs a
  discovered command and never shows env/header values (only key names).
- Only `stdio` and `streamable-http` transports are supported.
- Tool names are global (`mcp__<server>__<tool>`); the guard does not add per-tool
  allowlists or inspect tool payloads — it is a configuration guard, not a
  firewall or a sandbox.
- **Visual verification pending:** the Host half and bundle were installed and
  exercised on a DSH Desktop `0.2.2-rc.1` profile (settings slot registration,
  route trust gates, end-to-end child MCP mount with a fixture); the rendered
  settings page itself has not been visually inspected because the build
  environment has no browser control. See the repository status section and
  [`docs/VERIFICATION.md`](../../docs/VERIFICATION.md).

## Development

The package has no build step and no third-party runtime code of its own; tests use
Node's built-in runner:

```sh
node --test packages/dsh-mcp-guard/test/*.test.mjs
node scripts/validate.mjs
node --check packages/dsh-mcp-guard/client.js
node --check packages/dsh-mcp-guard/index.js
```

`docs/API-CONTRACT.md` in the repository root is the shared Host ↔ Client contract.
File ownership is documented there; do not edit files owned by another part of the
plugin.

## License

MIT © 2026 Rinat Fathutdinov. See [`LICENSE`](../../LICENSE) and [`NOTICE`](../../NOTICE).
