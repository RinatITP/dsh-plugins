# Security policy

This repository contains DeepSeek Harness plugins, starting with
`dsh-mcp-guard`, a security-first MCP server manager. Security reports are
welcome and will be handled as privately as the project's tooling allows.

## Supported versions

| Version | Supported |
|---|---|
| `0.1.x` (current development preview) | ✅ security fixes |
| anything older / unpublished snapshots | ❌ |

The plugin targets DSH **0.2.2-rc.1**. A fix may require a DSH update, and fixes
are published as patch releases of the plugin.

## Reporting a vulnerability

**Please do not open a public issue for an exploitable problem.**

Preferred channel: use GitHub's private vulnerability reporting —
[**Report a vulnerability**](https://github.com/RinatITP/dsh-plugins/security/advisories/new)
for this repository (Security → Advisories → Report a vulnerability). The report
stays private between you and the maintainer until an advisory is published.

If GitHub private reporting is unavailable, open a **minimal public issue** that
only asks for a private channel — include no vulnerability details, no exploit
steps and no secrets in it.

Please include:

- affected plugin and version (`packages/dsh-mcp-guard/package.json`), DSH
  version and OS;
- a description of the issue and the security property it breaks;
- reproduction steps or a proof of concept (safe, non-destructive);
- the impact you believe it has, and any suggested fix.

Do **not** include real credentials, personal data or production endpoint URLs.
Redact secrets. If a live credential may have leaked, rotate it first.

## What to expect

This is a personal open-source project. There is **no SLA, no bounty and no
guaranteed response time**; reports are handled on a best-effort basis.
Reasonable goals:

- acknowledge a valid report when the maintainer is available;
- investigate, request clarification and agree on a disclosure timeline with the
  reporter;
- ship a fix in a patch release and credit the reporter in the advisory/release
  notes unless they prefer otherwise.

Please give the maintainer a reasonable window to fix the issue before any public
disclosure.

## Scope

**In scope**

- `packages/dsh-mcp-guard/**` — every file of the plugin (Host, Client, locales,
  icon, patch, tests).
- This repository's documentation, CI workflow and `scripts/validate.mjs` when they
  could mislead users into an insecure installation or configuration.

**Out of scope**

- DeepSeek Harness itself and official `@deepseek-ai/*` packages — report those to
  the DSH/DeepSeek project, not here.
- Third-party MCP servers and the packages/commands a user chooses to enable.
  Enabling an untrusted stdio server executes its code by design; that is a user
  trust decision, not a vulnerability in this plugin (see
  [`docs/SECURITY-MODEL.md`](docs/SECURITY-MODEL.md)).
- Prompt injection through MCP tool output or server instructions: it is an
  inherent property of connecting an untrusted server. Reports showing that the
  plugin *claims* to prevent it, or a specific bypass of a documented control,
  are in scope; "a malicious MCP server can influence the model" alone is not.
- Local attackers who already control the user's OS account, the DSH profile
  files, or the DSH process.
- Missing hardening suggestions with no demonstrated security impact, and scanner
  output without a reproducible issue.
- Social engineering and physical access.

## Safe harbour

Good-faith research that follows this policy, stays within scope and does not
access other people's data is welcome. Do not run destructive payloads against
other users' installations, and do not test against infrastructure you do not
own or have permission to test.

## Related documents

- [`docs/SECURITY-MODEL.md`](docs/SECURITY-MODEL.md) — threat model, controls,
  secure defaults, residual risks.
- [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md) — Host ↔ Client security contract.
- [`NOTICE`](NOTICE) — attribution.
