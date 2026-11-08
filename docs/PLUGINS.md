# Plugin catalog

This is the registry-style catalog of plugins published from this repository.
Every entry is an installable DSH bundle package under `packages/`.

## Available plugins

### `dsh-mcp-guard` 0.1.0

| Field | Value |
|---|---|
| Package | `dsh-mcp-guard` |
| Directory | [`packages/dsh-mcp-guard`](../packages/dsh-mcp-guard/) |
| Version | 0.1.0 (development preview) |
| License | MIT |
| DSH target | 0.2.2-rc.1 (`engines.dsh: ">=0.2.2-rc.1 <0.3.0-0"`; official MCP client as optional peer) |
| Node | ≥ 22.19.0 |
| npm | not published yet |
| Transports | `stdio`, `streamable-http` |
| Bundle patch | `cordis.patch.yml` — one `insert` row, id `dsh-mcp-guard` |
| Client injection | `settings.section` page "MCP servers" (id `mcp-guard`, order 22) |
| Docs | [plugin README](../packages/dsh-mcp-guard/README.md) · [install](INSTALL.md) · [security model](SECURITY-MODEL.md) · [architecture](ARCHITECTURE.md) |

**What it does.** Adds a security-first MCP server manager to the DSH settings UI:
server list, add/edit (form and JSON), strict `mcpServers` import, execution
preview + risk acknowledgement before enabling, last-check via `resources/list`,
redacted export, and a bounded audit trail. Connections and tool discovery are
delegated to the official `@deepseek-ai/dsh-mcp-client`.

**Security posture.** Fail-closed: rows are saved disabled; secrets are write-only
(API returns key names only); no loader expressions; non-loopback plaintext HTTP is
blocked unless explicitly allowed per row; execution-influencing environment
variables are hard-blocked; the local API is exact-route, peer-admitted,
intent-header and no-store; no agent tool can enable servers.

**Status and verification.** Development preview. Automated tests, the repository
validator and CI are in place. The bundle was installed into a DSH Desktop
`0.2.2-rc.1` profile, its settings slot registered and its Host route trust gates
and end-to-end child MCP mount were exercised with a fixture server. Visual
verification of the rendered page is still **pending** — the build environment has
no browser control, and no screenshots are claimed. Record:
[`VERIFICATION.md`](VERIFICATION.md).

**Install.** From this checkout, into the profile your GUI runs:

```sh
dsh plugin --profile desktop add "/absolute/path/to/dsh-plugins/packages/dsh-mcp-guard"
```

or install the same directory through DSH's Plugin Manager. See
[`INSTALL.md`](INSTALL.md).

### `dsh-skill-curator` 0.1.0

| Field | Value |
|---|---|
| Package | `dsh-skill-curator` |
| Directory | [`packages/dsh-skill-curator`](../packages/dsh-skill-curator/) |
| Version | 0.1.0 (development preview, redesigned UX: library-first + import wizard + AI chat handoff) |
| License | MIT |
| DSH target | 0.2.2-rc.1 (`engines.dsh: ">=0.2.2-rc.1 <0.3.0-0"`) |
| Node | ≥ 22.19.0 |
| npm | not published yet |
| Bundle patch | `cordis.patch.yml` — one `insert` row, id `dsh-skill-curator` |
| Client injection | `settings.section` page "Skill Curator" / «Навыки» (id `skill-curator`, order 23) |
| Docs | [package README](../packages/dsh-skill-curator/README.md) |

**What it does (current).** Adds a redesigned skill studio to the DSH settings UI: the union
of DSH user and shared roots, optional project roots, bundled `office-skills`, and
read-only external agent roots (Claude Code, Codex including `.system`, Hermes
nested categories, ZCode, Cursor, Gemini/Antigravity, Kimi, OpenCode, custom
folders). It lists every `SKILL.md` with a stable diagnostic set (kebab-case name,
name/folder match, description length, invocation booleans, frontmatter problems,
oversized body, symlink state, duplicate and shadowed names), renders the raw
`SKILL.md`, exposes a bounded resource tree with traversal-safe text previews, and
speaks Russian and English. For writable skills it can validate and save `SKILL.md`, edit
`references/`/`scripts/`/`assets/` files, toggle model and slash menu invocation,
create new skills in the user, shared or project root, and move skills into a
restorable trash with backups. The Import tab plans a transfer from other agents
into a writable DSH root, supports an independent `copy` or a live `symlink`,
skips existing targets and invalid names, never overwrites, and reports every
selected item as imported, skipped or failed. The page is library-first: import,
create, live sources and trash are focused in-page views with a back
breadcrumb, help popovers and a sticky footer for the primary import action. The
Create view offers guided manual fields and an **AI handoff**: it starts a real
DSH chat with the plugin's embedded `skill-curator-creator` skill (runtime
registration, rank 250) and the user's description in the composer, using the
official `uiWorkspace.startSession`; the agent creates the skill through the
confirmation-gated `skill_curator_create` tool. The Sources view can expose
read-only external sources **live** in the DSH catalog (opt-in, model-only, no
copying) through a rank-350 provider that re-reads the external file on every
load. The visual layer follows the `dsh-mcp-guard` settings language: 28 px page
title, 14/22 body, card surfaces on `settings-card-stroke`, a single business
accent, pill tabs, switches and inline `?` help.

**Not implemented yet.** The overlay provider for toggling read-only external
skills, the optional sidebar entry, marketplaces and direct in-plugin LLM
generation.

**Security posture.** One exact route `/api/dsh-skill-curator` with the
`x-dsh-skill-curator: 1` intent header and signed-peer admission; JSON-only
responses, `no-store`. Every mutation requires `confirm: true` and a matching
catalog revision, runs serially, backs up the previous file under
`~/.dsh/skill-curator/backups/`, and refuses read-only sources, symlinked skills
and paths outside a writable skill bundle. Deletions move the whole skill into
`~/.dsh/skill-curator/trash/`; writes and imports are audited without file
bodies. Import targets must be writable, sources are re-resolved from the scanned
catalog, symlinks point only at discovered source directories, existing target
names are skipped (never overwritten) and the target path is re-checked before
creation. Live sources are read-only and model-only: the provider re-reads the
external `SKILL.md` on every load and cannot write. The agent-facing
`skill_curator_create` tool is confirmation-gated through `tools/pre-execute`.
Reads stay traversal-safe and bounded (2000 skills, 512 KiB per `SKILL.md`, 1 MiB
per preview).

**Status and verification.** Development preview. Unit tests cover the frontmatter
reader and editor, diagnostics, root resolution, discovery across synthetic
multi-root trees (bundles, flat files, nested categories, `.system`, symlinks,
shadowing), the HTTP envelope and the static client contract, plus a full mutation
cycle against an isolated home (create → save with backup → toggle → resource
write → trash → restore, and read-only/symlink/flat/project/stale-revision
refusals), plus import planning and execution in copy and symlink modes, flat
files, project destination and skip/collision guards; live tests cover the
settings store, provider filtering and body loading; creator tests validate the
embedded skill and the AI prompt, and a host static test enforces inject-safe
service access. The full record, including
the still-unverified rendered UI, is in [`VERIFICATION.md`](VERIFICATION.md). The repository validator and CI cover both packages. On 2026-11-06 the
package was installed as a linked bundle into a DSH Desktop `0.2.2-rc.1` `desktop`
profile: the Host row is active and the route returned `403 FORBIDDEN` without the
intent header and `401 UNAUTHENTICATED` without signed-peer admission. The
rendered page has not been visually verified yet.

**Install.** From this checkout, into the profile your GUI runs:

```sh
dsh plugin --profile desktop add "/absolute/path/to/dsh-plugins/packages/dsh-skill-curator"
```

## Planned / not yet available

`dsh-skill-curator` continues in staged increments: (2) editing `SKILL.md` and
resource files with backups and validation, enable/disable via frontmatter or the
overlay provider, trash; (3) import from external agents with symlink/copy,
global and project destinations, conflict handling; (4) the AI Skill Creator and
the optional sidebar entry; (5) writing to `~/.dsh/skills`/project roots with a
documented confirmation policy. Planned entries are listed here until they are
implemented, tested and documented in the package README.

## Adding a plugin to this catalog

A new plugin is accepted into `packages/` and listed here when it meets all of the
following. Keep the table row and the plugin README in sync with the package
manifest (`version`, `license`, `engines`).

1. **Bundle shape.** The package declares `dsh.bundle.patch` pointing at a patch
   whose `- insert:` rows use a unique `id`/`name` pair matching the package name;
   the Client half (if any) declares `dsh.client` with platform/inject lists.
2. **No hidden host pokes.** Uses official extension points (webServer routes,
   configEditor, slots, locale, services). No DOM injection outside the plugin's
   slot, no rewriting the user's profile patch by hand, no sidecar daemons.
3. **Display resources.** Exported `locale/*.json` with `meta.title` and
   `meta.description`; an original or license-compatible icon (`icon.svg`/PNG ≤
   256 KiB) or the package-root `icon` field; `files` includes runtime files,
   patch, locales and icon.
4. **Security documentation.** A short security model in the plugin README and, for
   anything security-relevant, a threat-model section: assets, controls, secure
   defaults and residual risks. State honestly what is not verified.
5. **Tests and validation.** Node built-in tests work without third-party
   dependencies; `node scripts/validate.mjs` passes; the package adds no install
   scripts and no third-party runtime code unless justified in the PR.
6. **Failure behaviour.** Fail-closed defaults for anything that executes code or
   stores credentials; secrets are write-only in API surfaces.
7. **License and attribution.** MIT-compatible inbound contribution, updated
   `NOTICE` when third-party code or design is used, no third-party trademarks.
8. **Agent authority.** If the plugin can alter execution, the mutating action is
   user-only (no agent tool/command may enable it without a human gesture), or the
   exception is documented and accepted in review.
9. **Honest status.** Version, compatibility target, tested platforms and
   verification limits are stated in the README; no screenshots or "verified"
   claims for behaviour that was not observed.


### `dsh-visual-studio` 0.1.0

| Field | Value |
|---|---|
| Package | `dsh-visual-studio` |
| Directory | [`packages/dsh-visual-studio`](../packages/dsh-visual-studio/) |
| Version | 0.1.0 (development preview) |
| License | MIT |
| DSH target | 0.2.2-rc.1 (`engines.dsh: ">=0.2.2-rc.1 <0.3.0-0"`) |
| Node | ≥ 22.19.0 |
| npm | not published yet |
| Bundle patch | `cordis.patch.yml` — one `insert` row, id `dsh-visual-studio` |
| Client injection | `tool.call.toolview` views for `visual_ask` and `visual_publish`; right-sidebar tab type `dsh-visual-studio` with a guide entry |
| Docs | [plugin README](../packages/dsh-visual-studio/README.md) |

**What it does.** Adds two visual modes to a session and the guideline tool that
governs them: an inline structured choice widget that returns the user's answer
to the agent as a tool result, and a published interactive HTML visual with
immutable versions in the right-sidebar panel (list, versions, device widths,
download, full screen). Published visuals are stored under
`<dshHome>/visual-studio/`, never in the user's project.

**Security posture.** Agent HTML runs in a sandbox: the panel uses
`<iframe sandbox="allow-scripts">`, the artifact route sets
`Content-Security-Policy: sandbox allow-scripts` with `default-src 'none'`, and
`visual_publish` rejects external scripts, styles, images, fonts and `fetch`
calls. The manifest route requires the intent header and peer admission; widget
answers are validated against the pending spec; file paths derive from a
validated artifact id and a numeric revision.

**Status and verification.** Development preview. Unit tests cover spec
normalization, answer validation, storage versions and the pending-widget
lifecycle; the repository validator and CI cover the package shell and JavaScript
syntax. Live verification in a DSH Desktop window is recorded in the repository
research notes and the package README.
