# Security model

**dsh-mcp-guard** is a security-first manager for MCP servers in DeepSeek Harness
(DSH). "Security-first" here means *fail-closed defaults and honest limits* — not
that the plugin makes MCP safe. This document states what the plugin controls, what
it only detects, and what remains the user's responsibility. Contract-level
details (validation rules, error codes, risk codes) are in
[`API-CONTRACT.md`](API-CONTRACT.md); wiring is in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

Target host: DSH **0.2.2-rc.1**.

> **Verification status:** this threat model is derived from the design contract
> and automated tests; the Host half was additionally exercised on an installed
> DSH Desktop `0.2.2-rc.1` profile (route trust gates, child MCP mount) — see
> [`VERIFICATION.md`](VERIFICATION.md). The rendered UI has not been visually
> verified, and the project does not claim an independent security audit.
> Findings described here are design intent; the implementation must be reviewed
> against them.

## 1. Assets

| Asset | Why it matters |
|---|---|
| OS account privileges | stdio MCP servers run as the user. |
| Credentials in env/header values | Often long-lived API tokens with broad scope. |
| The DSH profile configuration | Contains the managed server list and those credentials in plaintext profile files. |
| Agent conversation and tool results | May contain confidential data a server could read or exfiltrate. |
| Other MCP connections / tool sets | A malicious enabled server can influence the agent's actions. |
| The local settings API | Same-origin control surface for the plugin. |

## 2. Actors and trust boundaries

```text
┌────────────────────── browser (same origin as the DSH web UI) ────────────────────┐
│  settings page (client.js)        ← untrusted display code; gets key names only   │
└───────────────────────────────────────┬──────────────────────────────────────────┘
                                        │ same-origin fetch + intent header
┌───────────────────────────────────────▼──────────────────────────────────────────┐
│  DSH Host: /api/dsh-mcp-guard → peer admission → validation → configEditor        │
└───────────────────────────────────────┬──────────────────────────────────────────┘
                                        │ profile configuration (plaintext on disk)
┌───────────────────────────────────────▼──────────────────────────────────────────┐
│  official @deepseek-ai/dsh-mcp-client children                                   │
│    stdio  → child process as the OS user (no shell)                              │
│    HTTP   → network request to a user-specified endpoint                         │
└───────────────────────────────────────┬──────────────────────────────────────────┘
                                        │ MCP tool results / server instructions
┌───────────────────────────────────────▼──────────────────────────────────────────┐
│  model context (untrusted server output can look like instructions)              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **User (human)** — the only actor allowed to enable execution of a server.
- **Client half** — untrusted for secret handling and for authority: it can only
  request actions; the Host validates every request and never returns values.
- **Host** — the enforcing authority for storage, validation and confirmation.
- **Official MCP client** — owns connections, process spawning, reconnection and
  tool registration. It is not a sandbox either.
- **MCP server** — third-party code or service. It is trusted only as far as the
  user's explicit enablement goes.
- **Other plugins / hand-written profile rows** — can add MCP entries; the guard
  does not modify or vouch for them.

## 3. Threat model

### T1 — stdio MCP servers are arbitrary local code execution, by design

**Scenario.** A `stdio` server is a command the Host spawns. Enabling it runs that
command (and, as the official client documents, a temporary negotiation probe
process before the serving process) with the user's OS privileges. The command can
read files, make network calls, modify anything the user can, or persist itself.
Without a shell, the command is still arbitrary: any executable can do anything.

**Controls.**
- Enabling is a separate action after the row is saved disabled.
- The enable confirmation shows the exact `argv` that will be spawned (no shell
  interpretation) and all risk findings; risky patterns are surfaced first:
  shell interpreters, eval flags, `sudo`/`su`/`doas`, auto-installing package
  runners, secret-shaped arguments.
- High/critical findings require an explicit risk acknowledgement, not just one
  "yes".
- No expressions: config containing DSH loader expressions can never be written by
  the plugin; such external rows are read-only.
- Audit entry for every enable/disable.

**Residual risk.** Once approved, the server is **not sandboxed**: no OS sandbox,
no filesystem/network isolation, no per-server capability limits. Approval is a
trust decision the user must make per server. The plugin cannot make a malicious
or compromised package harmless.

### T2 — Secret disclosure

**Scenario.** API tokens and passwords live in env/header values. Leak paths: (a)
returned to the browser or another page; (b) embedded in error messages, logs,
audit entries or risk `params`; (c) included in a JSON/export view; (d) read from
the plaintext profile file by another local process or a backup; (e) sent over the
network in plaintext HTTP headers.

**Controls.**
- **Write-only API contract:** env/header values are never returned; the snapshot
  and analysis results contain **key names only**. Editing uses per-key `keep`
  semantics so a value can be preserved without revealing it.
- Error responses are stable, value-free codes (`{ code, path? }`), never upstream
  text; risk `params` may contain a key name or safe command basename, never a
  value.
- Audit entries contain action, server name, transport, result and highest risk —
  never values.
- Export renders `${KEY}` placeholders and states clearly that it is not a secret
  backup.
- Secret-shaped literals are detected (`risk.envSecretLiteral`,
  `risk.secretInArgs`) so the UI can nudge users toward env references rather than
  stored literals.

**Residual risk.** The **profile configuration stores secrets in plaintext host
files** — write-only protects the browser and error surfaces, not the disk. Anyone
who can read the profile (same OS user, backup, sync, malware) can read the
secrets. Uninstalling does not guarantee erasure. Use scoped/short-lived tokens.

### T3 — Plaintext HTTP and SSRF-style endpoint choices

**Scenario.** A `streamable-http` server URL determines where the Host connects and
which headers (including bearer tokens) it sends. A mistaken or malicious entry
can point at a plaintext endpoint on the LAN, at an internal service, or at a
cloud metadata address; data and tokens can be sniffed or sent to the wrong
service.

**Controls.**
- `https:` is allowed anywhere; plaintext `http:` is allowed only for **loopback**
  hosts (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`) by default.
- Non-loopback plaintext is a **high** risk and must be explicitly allowed on that
  individual row (`allowPlainHttp: true`); it is never a global switch.
- URLs with userinfo, fragments, whitespace, backslashes or control characters are
  rejected; the projected endpoint is only the URL origin.
- Header keys must be RFC 7230 tokens; values reject CR/LF (header injection).
- Import never executes and never expands anything; imported rows are disabled.

**Residual risk.** The plugin validates shape, not intent. A user can enable an
HTTPS endpoint that is hostile, an internal service, or a plaintext LAN endpoint
after explicitly accepting the high-risk warning — tokens then travel unencrypted.
The Host performs no network egress filtering and no certificate pinning beyond
the official client's normal TLS behavior. The URL you approve is the server you
talk to.

### T4 — Supply chain through package runners and dependencies

**Scenario.** `npx -y …`, `bunx`, `pnpm dlx`, `uvx` and similar runners download
and execute packages at server start; an unpinned package or a compromised
registry account runs arbitrary code. The plugin itself declares the official
`@deepseek-ai/dsh-mcp-client` only as an optional **peer** dependency: it is
resolved from the running DSH host installation and adds no installer fetch of its
own. The declared compatibility range is pinned to DSH `0.2.2-rc.1`.

**Controls.**
- `risk.packageRunnerAutoInstall` (**high**) flags package runners with
  `-y`/`--yes` or auto-install behaviour; `risk.packageRunnerUnpinned` (medium)
  flags unpinned specs. Both are shown before enabling; high requires
  acknowledgement.
- The enable preview shows the exact argv so the fetch-on-run is visible.
- The plugin has no install/build scripts of its own and no third-party runtime
  code; the official client is used from the host, not vendored or bundled here.
- The managed list and launch commands are the user's explicit input; the plugin
  never constructs or rewrites a command to install something.

**Residual risk.** Risk findings do not vet the fetched package: no signature,
provenance or integrity check beyond the package manager's own. Pinning a version
reduces but does not eliminate the risk (registry compromise, caches, post-install
scripts of the MCP server's own package). This is the largest supply-chain surface
and it is inherent to running third-party MCP servers.

### T5 — JSON parsing: prototype pollution, duplicate keys, oversized input

**Scenario.** Imported `mcpServers` JSON or a draft body contains `__proto__`,
`prototype` or `constructor` keys, duplicated keys that parse differently than a
human reads them, unknown fields, or is large enough to exhaust memory/CPU.
Polluted prototypes could later alter validation or UI behaviour; extra fields
could smuggle configuration.

**Controls.**
- The request body must be JSON, an object, and within 1 MiB.
- Import is strict: `mcpServers` envelope only, ≤100 servers, field allowlist
  (`type`, `url`, `headers`, `command`, `args`, `env`, `cwd`), duplicate JSON keys
  detected and rejected, `__proto__`/`prototype`/`constructor` rejected,
  transport conflicts rejected, duplicate/unsafe server names rejected.
- Drafts are validated against a fixed field set; unknown fields are errors
  (`FIELD_UNKNOWN`).
- Every value is bounded (name ≤32 chars, argv entry ≤4096 chars, env/header
  values ≤8192 chars, bounded entry counts), and limits apply to the whole
  configuration.
- Preview parsing never executes the server and never expands expressions.

**Residual risk.** Rejection is only as good as the implementation and its tests.
Future fields or formats could reintroduce a parsing mismatch. Review the code and
tests for `lib/import.js` / `lib/validate.js` when changing the schema.

### T6 — Local HTTP API: authentication, CSRF, request abuse

**Scenario.** The plugin exposes a local HTTP route. A malicious web page in the
user's browser could try cross-site form submissions; a local process could send
requests; oversized or malformed bodies could DoS the Host; stale writes could
clobber newer configuration.

**Controls.**
- One **exact** route `/api/dsh-mcp-guard`; no wildcard/prefix exposure.
- Every request must carry the intent header `x-dsh-mcp-guard: 1` and pass DSH's
  `ctx.connection.admit(req)` peer admission. 401/403 responses map to
  `UNAUTHENTICATED`/`FORBIDDEN`.
- POST requires `content-type: application/json` (a cross-site HTML form cannot
  set it), body limit 1 MiB, JSON-object-only, unknown action → 400.
- Responses: JSON UTF-8, `cache-control: no-store`, `x-content-type-options:
  nosniff`; errors are stable codes without upstream text.
- Mutations additionally require `confirm: true` and the current `revision`;
  mutations are serialized so two writes cannot interleave.
- The intent header is not a secret and is not treated as the authentication
  boundary; peer admission is.

**Residual risk.** Any process that can authenticate as an admitted DSH peer (or a
browser page same-origin with the DSH UI, e.g. through a separate vulnerability)
can call the route. Local same-user processes are outside this boundary. The
intent header alone would not stop a determined same-origin attacker; do not
deploy the DSH UI to an untrusted multi-user environment.

### T7 — UI injection (XSS) in the settings page

**Scenario.** Server names, URLs, tool names or audit fields rendered into the
settings page could inject markup if the Client built HTML from API strings;
XSS in a same-origin settings page can call the local API.

**Controls.**
- Server names are restricted to `^[A-Za-z0-9_-]{1,32}$`; URLs are projected as
  origins; the API returns stable codes, not free-form upstream text.
- The Client is required by contract to render API data as text, never as HTML;
  it must not inject DOM outside its own settings section, and adds exactly one
  `<style data-plugin="dsh-mcp-guard">` element with cleanup.
- Localized strings come from the plugin's own `locale/*.json` files, not from
  server data.

**Residual risk.** The UI is **not visually verified** in this build environment;
protection depends on the implementation following the contract and on the static
client tests. Treat any change to DOM construction as security-relevant and
review it.

### T8 — Prompt injection through MCP tool output and server instructions

**Scenario.** MCP servers return text that enters the model's context — tool
results, and (as the official client documents) server instructions are appended
to the system prompt as literal text. A malicious or compromised server can
instruct the model to call other tools, read sensitive data, ignore user intent or
exfiltrate content. Nothing about a valid-looking tool result proves it is benign.

**Controls (partial by nature).**
- Enablement is an explicit trust decision; the risk analysis highlights
  high-risk execution patterns, but **content is not vetted**.
- The plugin keeps a bounded audit trail of configuration actions so users can
  review what was enabled and when.
- External rows are read-only; the guard does not silently adopt or enable them.
- The plugin does not register agent tools, so it adds no new instruction channel
  of its own; the official client's tool naming (`mcp__<server>__<tool>`) keeps
  attribution visible.

**Residual risk.** **The plugin cannot prevent prompt injection.** It is a
configuration guard, not an MCP proxy, firewall or content filter: it does not
inspect tool payloads, instructions, resources or tool results, and DSH passes
them to the model. Only enable servers you trust; prefer least-privilege
credentials and scoped tokens; remember that any agent action available in the
session is reachable by an injected instruction.

### T9 — Execution-influencing environment variables

**Scenario.** Environment variables can change what an "innocent" command
executes: `NODE_OPTIONS` (`--require` preload), `LD_PRELOAD`, `DYLD_*`,
`PATH`/`NODE_PATH`/`PYTHONPATH`, shell startup hooks (`BASH_ENV`, `ENV`,
`SHELLOPTS`), language options (`PERL5OPT`, `RUBYOPT`, `JAVA_TOOL_OPTIONS`),
`GIT_SSH_COMMAND`, `SSH_ASKPASS`, `COMSPEC`, `PSModulePath`, and DSH's own
`DSH_*` variables. Setting them for an MCP server would let the configuration
execute code or redirect behavior regardless of the visible command.

**Controls.**
- These keys are **hard-blocked** (case-insensitive), including `NODE_OPTIONS`,
  `NODE_PATH`, `PATH`, `PYTHONPATH`, `PYTHONHOME`, `PYTHONSTARTUP`, `LD_PRELOAD`,
  `LD_LIBRARY_PATH`, `DYLD_*`, `BASH_ENV`, `ENV`, `SHELLOPTS`, `PERL5OPT`,
  `RUBYOPT`, `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `JDK_JAVA_OPTIONS`,
  `GIT_SSH_COMMAND`, `SSH_ASKPASS`, `COMSPEC`, `PSModulePath`, `DSH_*`, and the
  expression marker `__jsExpr`. They cannot be overridden from the UI
  (`ENV_EXECUTION_OVERRIDE`).
- The official client independently starts stdio children from a scrubbed parent
  environment (dropping names matching `KEY|PASSWORD|SECRET|TOKEN` and `DSH_*`),
  with the configured env merged on top — defence in depth.

**Residual risk.** The blocklist covers execution-influencing names known today.
A future toolchain may honor a variable not on the list, and a command's own
arguments or config files can still change behavior. Review the command itself,
not just the environment.

### T10 — Configuration tampering outside the UI

**Scenario.** Someone with write access to the profile edits the persisted
managed list directly (or another plugin writes it), bypassing UI validation;
loader expressions or incompatible configs appear.

**Controls.**
- The plugin is the only writer through the official `configEditor`; it never
  hand-writes or walks the profile patch.
- External / expression-bearing MCP rows are read-only in the UI.
- The managed state is revision-guarded; concurrent writers cause
  `STALE_CONFIGURATION` instead of silent overwrites.
- There is no supported path for writing an unvalidated row through the UI: every
  draft passes analysis/validation before it can be persisted, and external or
  expression-bearing rows are never written by the plugin.

**Residual risk.** If the local attacker can write profile files, they already
have the user's privileges and can edit any DSH or OS configuration; the guard is
not a defense against a compromised local account. Hand-edited persisted content
is unsupported: the UI guardrails run before saving and are not a runtime sandbox
for arbitrary profile files.

## 4. Secure defaults

| Default | Effect |
|---|---|
| New/edited server saved **disabled** | Nothing runs because it was typed or imported. |
| Enabling is a separate confirmed action | Execution needs a deliberate user gesture. |
| Execution preview before enable | The exact argv / endpoint origin is shown. |
| High-risk rows require acknowledgement | Acknowledging is explicit and per-enable. |
| Plaintext HTTP only to loopback | Non-loopback plaintext requires a per-row exception (high risk). |
| No expressions | Loader expression configs cannot be stored via this plugin. |
| Secrets write-only | Browser/API/errors/audit/export never contain values. |
| Strict JSON import | Envelope + allowlist + size limits + unsafe-key rejection; imported rows disabled. |
| Execution-influencing env blocked | The UI cannot configure known code-injection variables. |
| `failOnStartupError: false` is exposed but not forced | A broken server does not have to abort host startup; users can opt into strict startup. |
| Bounded audit (newest 50) | A review aid without unbounded secret-adjacent history. |
| Local-only API, no-store responses | One authenticated route; nothing cached. |
| No telemetry | No remote calls by the plugin itself. |

## 5. User-only actions: the agent cannot enable servers

The plugin's product rule is that **execution of MCP servers is a human decision**:

- The plugin registers **no agent tool and no agent command**. There is no
  model-facing function to create, edit, enable or disable a server.
- All mutations exist only behind the settings-UI API, and the UI requires an
  interactive confirmation step (plus a risk acknowledgement for high-risk rows).
  The Host additionally requires `confirm: true` and a matching revision on every
  mutation.
- The route requires an admitted DSH peer and the intent header, so a plain
  cross-origin page cannot drive it.
- An agent therefore cannot enable a server through its own tool surface. It can
  call tools of servers a human already enabled — that is intended; enablement is
  the boundary.

**Residual risk.** This is an authority rule, not an OS boundary. A local process
that can authenticate as a DSH peer, a DSH or plugin vulnerability, or direct
write access to the profile can bypass it. Do not treat "the agent has no button"
as a hard sandbox against a compromised host.

## 6. Residual risks (summary)

1. **No sandbox** for stdio servers and no network/egress control for HTTP servers
   (T1, T3).
2. **Secrets at rest are plaintext** in the profile; write-only is an API property
   (T2).
3. **Prompt injection is not preventable** by a configuration guard; server
   instructions and tool output are untrusted model input (T8).
4. **Package-runner supply chain** is only flagged, never verified (T4).
5. **Hostile endpoints** are only shape-validated; enabling one is a user trust
   decision (T3).
6. **Local peers and profile writers** are outside the boundary; same-user local
   processes are not isolated from the DSH UI or profile (T6, T10).
7. **Blocklists and allowlists age:** env blocklist, loopback detection and risk
   heuristics are snapshots of current knowledge (T9).
8. **Audit is bounded and not tamper-evident**; it is a review aid.
9. **UI verification is pending**; security-relevant rendering behaviour relies on
   code/tests, not on an observed interaction.
10. **Version exemptions** can install a plugin not validated for the running DSH
    and are an explicit risk acceptance; this project does not recommend them.

## 7. What this plugin is not

- Not an MCP proxy, firewall or gateway: it does not sit between the model and the
  server, and it does not inspect or filter MCP traffic.
- Not a sandbox or privilege drop for stdio servers.
- Not a secret vault: it stores credentials where DSH stores plugin
  configuration — in the profile.
- Not a supply-chain verifier: risk findings are heuristics that inform a human.
- Not a defense against a compromised host account or a malicious other plugin.

## 8. Reporting a vulnerability

Follow [`../SECURITY.md`](../SECURITY.md). Do not open a public issue for an
exploitable problem.
