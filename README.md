# dsh-plugins

[![CI](https://github.com/RinatITP/dsh-plugins/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/RinatITP/dsh-plugins/actions/workflows/ci.yml)

English | [Русский](README.ru.md)

Plugins for **DeepSeek Harness (DSH)** — an independent, MIT-licensed collection
maintained by Rinat Fathutdinov. This is not an official DeepSeek repository.

## What is DeepSeek Harness?

DeepSeek Harness is a local agent workspace with a desktop application and a web
UI. It can be extended with installable plugins: an npm package that ships a
Cordis bundle patch (`dsh.bundle.patch`) for Host-side behavior and, optionally,
a web Client half (`dsh.client`) that renders into the existing UI. DSH provides
an official Plugin Manager and the CLI command
`dsh plugin --profile <name> add <spec>` for installing such packages.

## What this repository is

A small monorepo for DSH plugins that follow the same rules:

- **Official extension points only.** No DOM injection, no patching of DSH
  internals, no profile-file editing behind the user's back.
- **Host-owned state.** Configuration is persisted through DSH's official
  `configEditor`; secrets are never sent back to the browser.
- **Fail closed.** Security-sensitive actions are saved disabled and require an
  explicit user confirmation before they can run.
- **No build step and no dependencies for the repository itself.** Plain ESM
  JavaScript checked by Node's built-in test runner and a dependency-free
  validator — the same commands CI runs.

## Plugins

| Plugin | Version | License | Description |
|---|---|---|---|
| [`dsh-mcp-guard`](packages/dsh-mcp-guard/) | 0.1.0 | MIT | Security-first MCP server manager with a Z.ai/GLM-style settings UI: strict validation, execution preview, bounded audit trail, takeover of existing profile rows and read-only discovery/import of Cursor, Claude and VS Code MCP configs. |
| [`dsh-skill-curator`](packages/dsh-skill-curator/) | 0.1.0 | MIT | RU-first skill studio: catalog of DSH, project and external agent skills (Claude Code, Codex, Hermes, ZCode, Cursor, Gemini, Kimi, OpenCode, custom) with validation diagnostics, a bounded file tree, safe editing of `SKILL.md` and modular resources, invocation toggles, skill creation, backups, a restorable trash, and copy/symlink import from other agents with a preview and per-item report. The AI creator is staged next. |

More plugins may be added over time. [`docs/PLUGINS.md`](docs/PLUGINS.md) is the
catalog and lists the acceptance criteria for new entries.

## Status

`0.1.0` is a **development preview** targeting DSH **0.2.2-rc.1**.

Automated verification in this repository:

- unit tests under `packages/dsh-mcp-guard/test/` and
  `packages/dsh-skill-curator/test/` (Node's built-in `node --test`, no
  third-party test framework);
- `node scripts/validate.mjs` — checks the package manifest, bundle patch,
  locales, icon, required files and JavaScript syntax;
- the GitHub Actions workflow in `.github/workflows/ci.yml`, which runs both on
  Ubuntu with Node 22.

The Host and bundle mechanics **were** verified on a DSH Desktop
`0.2.2-rc.1` profile: the bundle installed and activated without a restart, the
`settings.section` page is registered and active in the live slot ledger, the
management route enforces both the intent header and signed-peer admission, and
an end-to-end check mounted a fixture stdio MCP server through the official
`@deepseek-ai/dsh-mcp-client` and observed its `mcp__<name>__echo` tool until
the test configuration was reverted. See
[`docs/VERIFICATION.md`](docs/VERIFICATION.md) for the record.

**`dsh-skill-curator`** was installed as a linked bundle into the same `desktop`
profile on 2026-11-06 (Host row active; route `403` without the intent header,
`401` without signed-peer admission). Stage 2 adds confirmation-gated writes,
backups and a restorable trash; its rendered page is still awaiting a visual
run-through.

**Remaining verification limit:** this build environment has no browser control,
so the rendered settings pages have **not** been visually inspected — layout,
themes and interactive behaviour are unconfirmed and no screenshots are
included. Treat the visual interface as unverified until a maintainer completes
a manual run-through and records it.

## Security defaults at a glance

These are the defaults and hard rules of `dsh-mcp-guard` (details in
[`docs/SECURITY-MODEL.md`](docs/SECURITY-MODEL.md)):

- Every new or edited MCP server is saved **disabled**. Enabling is a separate
  user action with an execution preview; high-risk rows additionally require an
  explicit risk acknowledgement.
- Environment variables and HTTP headers are **write-only**: the API returns key
  names only, never values, and values never appear in errors, audit entries or
  logs.
- **No expressions.** Configuration containing DSH loader expressions is never
  written by the plugin; such rows from other plugins stay read-only.
- **Plaintext HTTP** to a non-loopback host is blocked unless that individual
  row is explicitly allowed; URLs with userinfo and header injection are
  rejected.
- **Execution-influencing environment variables** (`NODE_OPTIONS`,
  `LD_PRELOAD`, `PATH`, `DYLD_*`, `DSH_*`, and similar) are hard-blocked and
  cannot be overridden from the UI.
- **Strict import**: `mcpServers` envelope only, bounded size, field allowlist,
  no duplicate or prototype-pollution keys; imported rows are saved disabled.
- Mutations are serialized, revision-guarded and confirmed; the local HTTP route
  requires a DSH-admitted peer and an intent header, and responses are never
  cached.
- **The agent cannot enable MCP servers.** There is no agent tool or command that
  creates or enables a server; enabling is a user gesture in the settings UI.

## Installation

The plugin is installed into a DSH **profile**, from this checkout. It is not yet
published to npm.

### A. DSH Plugin Manager (Desktop, recommended)

1. Open DSH Desktop and go to **Plugin Manager**.
2. Install a bundle from the local package directory — the absolute path to
   `packages/dsh-mcp-guard` inside this repository (the official `install_bundle`
   action with that directory as its target).
3. Restart DSH if the application reports that a restart is required. Bundle
   layers are composed at startup.

A local directory install links the checkout rather than copying it, so edits in
this repository are picked up by the next plugin/application reload.

### B. Command line

```sh
dsh plugin --profile desktop add "/absolute/path/to/dsh-plugins/packages/dsh-mcp-guard"
dsh plugin --profile desktop add "/absolute/path/to/dsh-plugins/packages/dsh-skill-curator"
```

- Use the profile the GUI actually runs: `desktop` for DSH Desktop, `web` for a
  `dsh web` deployment.
- If `dsh` is not on `PATH`, the documented equivalent is
  `npx @deepseek-ai/dsh plugin --profile <name> add <spec>`.
- A `link:` spec (for example
  `dsh plugin --profile desktop add "link:/absolute/path/to/dsh-plugins/packages/dsh-mcp-guard"`)
  is the alternative form used by other DSH plugins for a linked source
  checkout.
- After install/update/removal, fully restart DSH (not just reload the page) —
  the Host bundle layer is composed at startup.

### C. From GitHub / npm

The repository is published at <https://github.com/RinatITP/dsh-plugins>. It is a
monorepo, and the plugin package is in a subdirectory:

- **Not yet tested:** installing directly from GitHub, in particular from a
  package subdirectory of a monorepo. Do not assume it works.
- **Not yet available:** the plugin is not published to npm. Once it is, the
  intended route will be
  `dsh plugin --profile <name> add dsh-mcp-guard`.

See [`docs/INSTALL.md`](docs/INSTALL.md) for prerequisites, verification steps,
uninstall, update and troubleshooting.

## Repository layout

```text
dsh-plugins/
├── .github/workflows/ci.yml   # Ubuntu + Node 22: tests, validator, syntax checks
├── docs/
│   ├── API-CONTRACT.md        # Host ↔ Client contract (working source of truth)
│   ├── ARCHITECTURE.md        # Host/Client halves, data flow, persistence
│   ├── INSTALL.md             # Install, verify, update, uninstall, troubleshoot
│   ├── PLUGINS.md             # Plugin catalog and acceptance criteria
│   └── SECURITY-MODEL.md      # Threat model, controls, secure defaults, residuals
├── packages/
│   ├── dsh-mcp-guard/         # MCP server manager (bundle + Host + Client)
│   └── dsh-skill-curator/     # skill studio: catalog, editor, trash (bundle + Host + Client)
├── scripts/validate.mjs       # dependency-free repository validator
├── CONTRIBUTING.md
├── LICENSE
├── NOTICE
├── README.md                  # this file
├── README.ru.md
└── SECURITY.md
```

## Development

There is nothing to install for development: the repository has no dev
dependencies and no third-party runtime code. The plugin uses the official
`@deepseek-ai/dsh-mcp-client` as an optional peer dependency resolved from the
DSH host. Use Node.js 22 or newer.

```sh
node --test packages/dsh-mcp-guard/test/*.test.mjs      # MCP guard unit tests
node --test packages/dsh-skill-curator/test/*.test.mjs  # skill studio unit tests
node scripts/validate.mjs                               # repository/host validation
node --check packages/dsh-mcp-guard/client.js           # Client half syntax
node --check packages/dsh-mcp-guard/index.js            # Host half syntax
node --check packages/dsh-skill-curator/client.js       # skill studio client syntax
node --check packages/dsh-skill-curator/index.js        # skill studio host syntax
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the change process and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the plugin is wired.

## Security

Please report vulnerabilities privately — see [`SECURITY.md`](SECURITY.md). Do
not open a public issue for an exploitable problem.

## License

[MIT](LICENSE) © 2026 Rinat Fathutdinov. Third-party attribution is in
[`NOTICE`](NOTICE).
