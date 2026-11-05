# Verification record

This page records what was actually observed while building `dsh-mcp-guard`,
where it was observed, and what remains unverified. It supersedes optimistic
wording elsewhere; if the two disagree, this page is the evidence.

## Environment

| Item | Value |
|---|---|
| DSH | Desktop application, runtime `0.2.2-rc.1` |
| Host | macOS (Darwin), Node `v22.23.1` available to the app |
| Profile | `desktop` (`~/.dsh/profiles/desktop`) |
| Install method | local directory bundle (`plugin_manager` → `install_bundle`, target = package directory) |
| Date | 2026-11-06 |

## Automated tests (reproducible)

```sh
cd packages/dsh-mcp-guard
node --test test/*.test.mjs        # 147 tests, 0 failures
cd ../..
node scripts/validate.mjs         # 59 checks, 0 failures
node --check packages/dsh-mcp-guard/client.js
node --check packages/dsh-mcp-guard/index.js
```

Coverage of the unit suite: the strict import parser, every validation and risk
code in the contract, secret non-leak assertions, the manager controller
(revision guards, confirmations, fail-closed saves, keep-secret semantics,
risk acknowledgement, import/export, audit), the HTTP façade (intent header,
signed-peer admission, body limits, value-free error mapping), package wiring
(manifest, bundle patch, locale resources, icon, client registration strings)
and static client checks (loader format, single style sheet, token-only colours,
locale key/placeholder parity, no secret-shaped literals).

## Installed Host-side observations

1. `plugin_manager` `install_bundle` with the package directory returned
   `application: "applied"`, `enabled: true`, a `link:` dependency in the
   profile and no restart requirement. The pre-existing warning about an
   unrelated profile plugin (`@deepseek-ai/dsh-hooks-claude-code` could not be
   imported) was present before this install and is not caused by this package.
2. The composed row appears as `include:dsh-mcp-guard` (`patchId`
   `dsh-mcp-guard`) in the live Loader tree.
3. The local management route is registered: a request without the intent
   header is rejected `403 FORBIDDEN`; a request with the header but without a
   DSH-admitted peer is rejected `401 UNAUTHENTICATED`. This proves the exact
   route and both trust gates are live; it does not prove authenticated reads.
4. The Client half registered its settings page: the live
   `settings.section` slot lists occupant `{ id: "mcp-guard", order: 22,
   active: true }`, and the matching `settings.section.icon` registration is
   present (both registered by the installed module).
5. `@deepseek-ai/dsh-mcp-client` resolved from the running host installation
   (not from a vendored copy) — confirmed by instrumented `apply` output during
   development.

## End-to-end child-server check

A temporary configuration (not shipped in the repository) pointed one enabled
managed server at `test-fixtures/mini-mcp-server.mjs`:

- the plugin's `apply` read the row (`servers: 1`, `enabled: true`), imported the
  official client, mounted the child plugin and reported `child-ready`;
- the official client spawned the fixture process (PID observed) and registered
  the model-facing tool `mcp__mini__echo`;
- the shared MCP resource layer listed `mini` among its servers;
- after reverting the test configuration and reloading the bundle, the process,
  the tool registration and the resource entry were gone.

This verifies the official-client resolution, config reading, child mount,
process spawn, tool registration and teardown. It does **not** exercise a save
through `configEditor` from the browser UI (that path is covered by manager
unit tests and uses the documented `ctx.fiber.entry` + `editor.edit` pattern).

## Not verified

- **Visual rendering / console of the settings page.** The build environment had
  no browser control. The page is registered and active in the slot ledger, but
  nobody has looked at it; layout, spacing, light/dark themes and interactive
  behaviour are unconfirmed. Treat screenshots as absent.
- **Browser-driven save → configEditor persistence.** Unit-tested only.
- **Other platforms and host versions.** Linux, Windows, `dsh web`, DSH other
  than `0.2.2-rc.1`, and future `0.2.x` releases were not run.
- **npm publication** and installation from a GitHub subdirectory.
- **Concurrency with other plugins** that also manage MCP servers; the
  read-only external listing and name-conflict pre-check are the only
  interoperability measures implemented.

## Cleanup

The end-to-end test configuration was reverted: the shipped
`cordis.patch.yml` contains only the `dsh-mcp-guard` row with no server
configuration, the fixture process is not running, and the repository tests
pass against that shipped state.
