# Installation

This document installs **dsh-mcp-guard** into a DeepSeek Harness (DSH) profile
from this repository. The plugin is a development preview `0.1.0` targeting DSH
**0.2.2-rc.1**.

> **Verification status:** the local-directory install below **was** executed
> against a DSH Desktop `0.2.2-rc.1` profile and activated without a restart; the
> settings section is registered in the live slot ledger and the Host route is
> live. The rendered page has **not** been visually inspected (no browser
> control in the build environment). See [Verification](#verification) and
> [`VERIFICATION.md`](VERIFICATION.md) for the exact record and known limits.

## Prerequisites

| Requirement | Notes |
|---|---|
| DSH `0.2.2-rc.1` | Desktop application or a `dsh web` deployment. The plugin declares `engines.dsh: ">=0.2.2-rc.1 <0.3.0-0"`. |
| A DSH **profile** | Plugins are installed per profile, not globally. DSH Desktop normally runs the `desktop` profile; `dsh web` commonly uses `web`. Use the profile your GUI actually runs. |
| Node.js ≥ 22.19.0 | Only for CLI/development outside the Desktop application, which ships its own runtime. |
| Network access | A **local directory install** does not fetch the MCP client: the package declares the official `@deepseek-ai/dsh-mcp-client` only as an optional peer dependency and resolves it from the running DSH host installation. Installing a future published package through the plugin manager would use your npm registry as usual. |

There is nothing to `npm install` inside this repository: it has no dependencies
for development, and tests/validation use Node built-ins.

## What the installer does

For a bundle package (`package.json` → `dsh.bundle.patch`), DSH:

1. records the package in the profile (a linked checkout for a local directory
   install) and resolves what the package actually declares — this package has no
   third-party runtime dependencies, only the official client as an optional peer
   resolved from the host;
2. reconciles `dsh.profile.bundles` against installed packages and appends
   `dsh-mcp-guard` to the bundle stack;
3. merges the bundle's own `cordis.patch.yml` (one `insert` row with id
   `dsh-mcp-guard`) at profile boot, so the plugin is mounted without editing the
   user's `cordis.patch.yml`.

Your own profile patch file is not rewritten by the install. A local directory
install links the checkout instead of copying it, so edits in this repository
take effect after the next plugin/application reload.

> Bundle layers are composed at startup and then kept current by DSH's
> hot-module reload. In the verified Desktop profile a **new** local bundle
> activated without a restart; replacing an already installed package needs a
> restart to load a fresh JavaScript module generation, and DSH may report
> `restart-required`. When it does, fully quit and reopen the application —
> refreshing the browser page alone is not enough for the Host half.

## Option A — DSH Plugin Manager (Desktop, recommended)

1. Open DSH Desktop and go to **Plugin Manager**.
2. Install a bundle from a local package directory and give the **absolute path**
   of this package:
   `/absolute/path/to/dsh-plugins/packages/dsh-mcp-guard`
   (in the agent-facing API this is the official `install_bundle` action with that
   directory as its target).
3. Read the returned result: `application` / `warnings` / pending-build state.
   A new bundle may activate through hot module replacement; a **replacement** of
   an already installed package needs a restart to load a fresh JavaScript module
   generation.
4. If DSH reports that a restart is required, fully quit and reopen the
   application.
5. The settings section is expected to appear afterwards; see
   [Verification](#verification).

Do not install into a second, unused profile "to be safe": the plugin must be in
the profile that runs the GUI.

## Option B — command line

Use the same profile the GUI runs.

```sh
# DSH Desktop
dsh plugin --profile desktop add "/absolute/path/to/dsh-plugins/packages/dsh-mcp-guard"

# dsh web deployment
dsh plugin --profile web add "/absolute/path/to/dsh-plugins/packages/dsh-mcp-guard"
```

Notes:

- A **local directory path** is the tested-by-ecosystem way to install an
  unpublished checkout. The alternative linked-checkout form is
  `dsh plugin --profile <name> add "link:/absolute/path/to/packages/dsh-mcp-guard"`.
  Both target a package directory, not the repository root.
- If `dsh` is not on `PATH`, the documented equivalent is
  `npx @deepseek-ai/dsh plugin --profile <name> add <spec>` (the CLI still uses a
  local `pnpm`/Node installation under the hood).
- Inspect the result, then restart DSH if the command reports
  `restart-required`.

Useful companion commands (same official CLI):

```sh
dsh plugin --profile <name> list          # installed plugins/bundles in the profile
dsh --profile <name> --dump-config        # compose the profile and print the tree
dsh plugin --profile <name> remove dsh-mcp-guard   # uninstall (see below)
```

## Option C — GitHub / npm

- The repository is <https://github.com/RinatITP/dsh-plugins>, but **installing
  from GitHub is not tested**, especially from a package subdirectory of a
  monorepo. `github:RinatITP/dsh-plugins` points at the repository root, which is
  not a package.
- The plugin is **not published to npm yet**. When it is, the intended route will
  be `dsh plugin --profile <name> add dsh-mcp-guard`.

Until one of these is published and tested, use Options A or B from a checkout.

## Verification

Check the plugin is installed:

```sh
dsh plugin --profile desktop list
# or inspect the composed profile
dsh --profile desktop --dump-config
```

Expected: `dsh-mcp-guard` appears as an installed bundle and its row is present in
the composed tree. Then, in the GUI:

1. Open DSH settings. The sidebar should show an **MCP servers** page (English;
   «MCP-серверы» in Russian), order 22, at the same level as other settings
   sections.
2. The page should show a server list (empty on first run), a security panel, a
   read-only "managed by other plugins" section and an audit section.
3. If the page is missing after a full restart, check the plugin's activation
   result for errors and the profile name (see
   [Troubleshooting](#troubleshooting)).

**What was confirmed:** the settings section is present in the live
`settings.section` slot ledger as `mcp-guard`, order 22, active; the Host route
answers `403 FORBIDDEN` without the intent header and `401 UNAUTHENTICATED`
without a DSH-admitted peer; an end-to-end fixture proved child MCP mount and
tool registration. **What was not confirmed:** the rendered page itself —
layout, themes and interactions — because the build environment had no browser
control. Record your observed state (date, DSH version, profile) in the release
notes rather than assuming it. Full record: [`VERIFICATION.md`](VERIFICATION.md).

## Updating

- **Linked checkout (local directory install):** pull/edit the checkout, then
  restart DSH so the fresh Host modules are loaded. A page reload alone does not
  replace backend modules.
- **Published package (when available):**
  `dsh plugin --profile <name> update dsh-mcp-guard`, then restart.

Saved profile configuration survives updates; new versions may add validation that
marks existing saved rows as needing review — enabling always re-checks the row.

## Uninstalling

1. Prefer removing managed servers in the UI, or at least clearing their env/header
   values, before uninstalling if you want the stored secrets gone.
2. Run `dsh plugin --profile <name> remove dsh-mcp-guard` (or use Plugin Manager's
   remove for the bundle).
3. Fully restart DSH.

Uninstalling removes the plugin row and its settings page. It is **not a secret
erasure tool**: secrets previously saved into the profile configuration may remain
in profile files after removal. Clear them first if that matters to you.

## Troubleshooting

| Symptom | Likely cause / action |
|---|---|
| Settings page does not appear | Host modules were not reloaded: fully quit and reopen DSH. Check that the plugin was installed into the profile the GUI runs, and inspect the activation error in logs. |
| Install result says `restart-required` | Expected for replacements and some bundle changes: restart DSH. |
| Install result says `overridden` | A higher-priority profile layer wins for the same row; remove the conflicting manual mount. |
| `failed` activation | Read the diagnostic: common causes are a DSH version outside `engines.dsh` or an official MCP client that cannot be resolved from the host. |
| Version rejected by DSH | The host refuses packages whose declared version range does not accept the running DSH. Update DSH, or use a plugin version that supports it. Do **not** grant a version exemption casually: it is an explicit risk acceptance that may crash the host. |
| Snapshot reports `officialClient: false` | The official MCP client cannot be resolved from the running host. Make sure the plugin is installed into a profile whose DSH host ships `@deepseek-ai/dsh-mcp-client@0.2.2-rc.1`; there is no fallback MCP transport. |
| `UNAUTHENTICATED` / `FORBIDDEN` from the page | Reopen the authenticated DSH page in the app/browser. The local route requires a DSH-admitted peer. |
| `STALE_CONFIGURATION` | Another tab/session saved a configuration change. Reload the page and retry. |
| Plugin installed but page empty | Expected on first run: no servers are enabled by default and none are managed yet. |
