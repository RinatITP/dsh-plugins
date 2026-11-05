# Contributing

Thanks for considering a contribution to `dsh-plugins` — a collection of plugins
for **DeepSeek Harness (DSH)**. This repository currently hosts one plugin,
[`dsh-mcp-guard`](packages/dsh-mcp-guard/), a security-first MCP server manager.

This is a personal open-source project. Contributions are reviewed on a
best-effort basis; there is no SLA.

## Before you start

- **Security first.** Never commit credentials, tokens, personal data or real
  endpoint URLs. If you find a vulnerability, follow [`SECURITY.md`](SECURITY.md)
  instead of opening a public issue or PR with exploit details.
- **Read the contract.** [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md) is the
  source of truth for `dsh-mcp-guard`'s Host ↔ Client behavior, error codes and
  file ownership. Changes that alter that contract must update it deliberately.
- **Match the current scope.** The project is a development preview; large
  redesigns and dependency additions are unlikely to be accepted before a
  first stable release. Open an issue to discuss a non-trivial idea first.
- **No build tooling.** Packages are plain ESM JavaScript with no build step and
  no third-party runtime code in this repository. Plugins resolve official
  `@deepseek-ai/*` packages from the DSH host.

## Requirements

- Node.js **≥ 22.19.0** (the repository is developed and tested on Node 22).
- A DSH **0.2.2-rc.1** installation if you want to exercise the plugin in the
  actual application. Installing plugins into your own profile is a local change
  you make explicitly.

## Local checks (no install step, no dependencies)

Run these from the repository root before opening a PR:

```sh
node --test packages/dsh-mcp-guard/test/*.test.mjs   # unit tests
node scripts/validate.mjs                            # manifest, patch, locales, icon, files, syntax
node --check packages/dsh-mcp-guard/client.js        # Client half syntax
node --check packages/dsh-mcp-guard/index.js         # Host half syntax
```

CI (`.github/workflows/ci.yml`) runs the same commands on Ubuntu with Node 22. A
PR should not change CI to hide a failing check; fix the code or explain why the
check is wrong in the PR.

## What a good PR contains

1. **A focused change** with a clear description of the problem and the behavior
   after the change. Link the issue when one exists.
2. **Tests** for behavior changes — especially anything security-relevant
   (validation, import parsing, secret handling, risk analysis). Tests use Node's
   built-in runner (`node:test`) and `node:assert`; no third-party frameworks.
3. **Contract-first changes.** If you change a request/response shape, error code,
   risk code or validation rule, update `docs/API-CONTRACT.md` and the localized
   strings, and keep the Client fallback behavior for unknown codes.
4. **Security review notes** in the PR description when the change touches
   persistence, HTTP handling, secret projection, execution preview, process
   arguments or the risk engine: what can now execute, what can be written, and
   what is still blocked.
5. **Honest documentation.** Do not claim a manual/visual verification you did not
   perform. State platform, DSH version and observed result; if the UI was not
   inspected, say so. No invented screenshots or "verified" badges.
6. **Licensing.** Contributions are accepted under the repository's MIT license
   (see [`LICENSE`](LICENSE)). If you reuse third-party code or design, update
   [`NOTICE`](NOTICE) with the attribution and license, and confirm the license is
   compatible. Do not copy third-party trademarks or branding.

## Security expectations for changes

Do not merge code that:

- returns env/header **values** to the Client, into errors, logs, audit entries,
  risk parameters or exports;
- weakens fail-closed defaults (for example enabling a server without an explicit
  confirmation or saving new rows enabled);
- adds an **agent** tool or command that can create/enable/disable servers, or
  bypasses the user-only enable rule;
- removes a hard block (execution-influencing env keys, non-loopback plaintext
  HTTP, userinfo URLs, CR/LF in headers, prototype-pollution keys, unknown
  fields, oversized input) without a documented threat-model update;
- builds DOM from API strings, injects markup outside the plugin's settings
  section, or reintroduces raw upstream error text into responses;
- broadens the local HTTP surface beyond the exact `/api/dsh-mcp-guard` route or
  drops peer admission / intent-header / `no-store` handling;
- adds shell interpretation to stdio command execution, or install/build scripts
  to a package without explicit maintainer approval.

If you are unsure whether a change is security-relevant: assume it is and say so
in the PR.

## Repository conventions

- **Language:** English for code, comments, commit messages, docs and PR
  descriptions. User-facing plugin strings are localized (English + Russian in
  `locale/*.json`); the root README has a Russian translation
  (`README.ru.md`).
- **Formatting:** 2-space indentation, LF line endings, UTF-8, final newline — see
  [`.editorconfig`](.editorconfig). No formatter dependency is configured; keep
  diffs minimal and consistent with surrounding code.
- **File ownership:** `docs/API-CONTRACT.md` lists which part of the plugin owns
  which files. Don't reformat or edit files owned by another area in the same PR
  unless the change requires it, and say so in the description.
- **Commits:** imperative, scoped subjects (for example
  `dsh-mcp-guard: reject CRLF in header values`). Squash or keep history tidy;
  don't include generated artifacts.
- **No generated/vendored artifacts:** no `node_modules`, no `*.tgz`, no
  minified bundles, no profile dumps or local absolute paths in committed files.

## Reporting bugs and proposing features

Open a GitHub issue with:

- plugin name/version, DSH version, OS and profile name (`desktop`/`web`);
- exact steps, expected vs. observed behavior, and the relevant stable error code
  from the UI/API if any;
- a minimal, redacted configuration sample if needed (no secrets);
- whether the problem reproduces in a fresh profile / after a full DSH restart.

Feature requests: explain the user problem and how it fits the security stance.
Not every plugin idea will be accepted, and the maintainer may keep the repo to a
small, auditable set of plugins.

## License of contributions

By contributing, you agree that your contribution is licensed under the MIT license
of this repository, and that you have the right to submit it (including any
third-party code you add under a compatible license with attribution).
