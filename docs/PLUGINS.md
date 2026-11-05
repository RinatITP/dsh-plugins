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

## Planned / not yet available

Nothing is currently planned in this repository beyond `dsh-mcp-guard`. This
section will list accepted additions with their status.

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
