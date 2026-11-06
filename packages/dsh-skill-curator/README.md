# dsh-skill-curator

**Skill Curator** («Студия навыков») — a DeepSeek Harness plugin that makes agent
skills visible and manageable in one place: DSH user and shared roots, project
roots, bundled skills and the skill libraries of other agents (Claude Code,
Codex, Hermes, ZCode, Cursor, Gemini/Antigravity, Kimi, OpenCode).

> **Status: 0.1.0 development preview, stage 2 (catalog + editing).** The Web
> settings page lists every discovered skill, renders `SKILL.md`, the bounded
> resource tree and validation diagnostics, and can edit writable skills:
> validate and save `SKILL.md`, edit `references/`/`scripts/`/`assets/` files,
> toggle model and slash-menu invocation, create new skills in the user, shared
> or project root, and move skills to a restorable trash. Every write is
> confirmation-gated, revision-guarded and backed up first. Import from external
> agents (symlink/copy), the AI Skill Creator, live sources and the optional
> sidebar entry are the next stages. Tested against DSH `0.2.2-rc.1`; no visual
> acceptance of the rendered page has been claimed yet.

## What it does today

- **Library of every known skill root.** DSH `~/.dsh/skills`,
  `~/.agents/skills`, project `.dsh/skills` (when configured), the bundled
  `office-skills` directory, and read-only external roots:
  `~/.claude/skills`, `~/.codex/skills` (including `.system`),
  `~/.hermes/skills` (nested categories, up to three levels),
  `~/.zcode/skills`, `~/.cursor/skills`, `~/.gemini/skills`,
  `~/.kimi-code/skills`, `~/.config/opencode/skills`, plus custom folders.
- **Per-skill diagnostics** with stable codes: kebab-case name, folder/name
  mismatch, required description (length limits and recommendations), invocation
  booleans, frontmatter problems, empty or oversized body, symlink state,
  duplicate and shadowed names inside the DSH catalog.
- **Skill card** with the raw `SKILL.md`, a bounded file tree
  (`references/`, `scripts/`, `assets/`), traversal-safe preview of text
  resources, and RU/EN copy.
- **Read-only sources stay read-only.** External agent roots (Claude Code,
  Codex, Hermes, ZCode, Cursor, Gemini, Kimi, OpenCode) are never written.
  Writes go only to `~/.dsh/skills`, `~/.agents/skills` or a configured project
  `.dsh/skills` root (`allowProjectWrites: false` locks project roots too).
- **Safe writes.** Every mutation requires `confirm: true` and a matching
  catalog revision; the current skill is backed up under
  `~/.dsh/skill-curator/backups/` before replacement; deletions move the whole
  skill into `~/.dsh/skill-curator/trash/` with metadata and a restore action.
  Symlinked skills are not edited in place, and resource writes are restricted
  to `references/`, `scripts/` and `assets/` inside the skill directory.
- **Validation before writing.** An edited `SKILL.md` must pass the same
  diagnostics the catalog uses (kebab-case name, matching folder, description
  limits, boolean invocation fields, non-empty body); otherwise the write is
  rejected with the diagnostics attached to the error.

## Not implemented yet

Import from external agents (symlink or copy, global/project), the AI Skill
Creator, live sources (exposing external skills to DSH without importing) and
the optional sidebar entry. Enabling/disabling **read-only external** skills via
the overlay provider is also not implemented yet: the toggle in this stage only
edits skills the plugin may write.

## Installation

Requires DeepSeek Harness `0.2.2-rc.1` (or a later `0.2.x`) and Node ≥ 22.19.0.

```sh
dsh plugin --profile desktop add "/absolute/path/to/dsh-plugins/packages/dsh-skill-curator"
```

For a development checkout an explicit link keeps the package live:

```sh
dsh plugin --profile desktop add "link:/absolute/path/to/dsh-plugins/packages/dsh-skill-curator"
```

Restart DSH and open **Settings → Skills** (the section is labelled «Навыки» in
Russian and "Skills" in English).

## Configuration

The plugin reads its Loader entry options. All fields are optional; by default
every known root is scanned when it exists.

| Field | Default | Meaning |
|---|---|---|
| `externalSources` | `{}` | Per-agent overrides keyed by `claude`, `codex`, `hermes`, `zcode`, `cursor`, `gemini`, `kimi`, `opencode`. Set `false` to hide an agent, or `{ "path": "/home/me/.claude" }` to override its **home** directory (the scanner appends `skills`). |
| `customSources` | `[]` | Extra read-only roots: `[{ "label": "My library", "path": "/srv/skills", "depth": 1 }]`. `~` and `$VAR` are expanded; relative paths are rejected. |
| `projectRoots` | `[]` | Project roots to show: `[{ "path": "/src/app", "label": "App" }]` — the scanner reads `<path>/.dsh/skills`; writes there require a user confirmation unless `allowProjectWrites` is `false`. |
| `allowProjectWrites` | `true` | Set `false` to keep project roots read-only even though they are listed. |
| `bundledSkillDir` | detected | Overrides the bundled skill directory (also `DSH_BUNDLED_SKILL_DIR`). |
| `dshHome` / `agentsHome` | `~/.dsh` / `~/.agents` | Override the DSH roots (also `DSH_HOME` / `DSH_AGENTS_HOME`). |

## Security model

- One exact route `/api/dsh-skill-curator`; every request needs the
  `x-dsh-skill-curator: 1` intent header and must pass
  `ctx.connection.admit(req)` (signed-peer admission). Responses are
  `application/json`, `cache-control: no-store`, `x-content-type-options: nosniff`.
- The route has read and write actions. Writes are confirmation-gated, require a
  matching catalog revision, execute serially, and back up the previous file
  under the plugin home; the target must be a writable non-symlink skill inside
  a writable source root. Resource reads are validated by resolving the target
  path inside the skill directory and rejecting anything outside it.
- Bounded work: at most 2000 skills per snapshot, 4000 directory entries per
  source, 512 KiB per `SKILL.md`, 400 tree entries and 1 MiB per preview.
- `SKILL.md` is fetched only for actions that request it (`detail`) or for the
  list metadata scan; file bodies are never logged. The audit trail stores
  action, skill name, source and file path only.
- External agent roots are read-only for the plugin; no API can change their
  files. Writes are audited in `~/.dsh/skill-curator/audit.jsonl` (rotated at
  1 MiB) and the backup/trash directories are capped at 200 entries each.

## Verification

```sh
node --test packages/dsh-skill-curator/test/*.test.mjs
node scripts/validate.mjs
node --check packages/dsh-skill-curator/client.js
node --check packages/dsh-skill-curator/index.js
```

The repository validator and the GitHub Actions workflow run the same commands.
The tests build synthetic multi-root trees (bundles, flat markdown, nested
categories, `.system`, symlinks, shadowed duplicates), exercise the HTTP
envelope and the static client contract, and run the full mutation cycle against
an isolated home directory: create → save (with backup) → toggle → resource
write → trash → restore, plus read-only, symlink, flat-file, project-scope,
collision and stale-revision refusals.

**Live check performed 2026-11-06** on DSH Desktop `0.2.2-rc.1`: the package was
installed as a linked bundle into the `desktop` profile, DSH appended it to
`dsh.profile.bundles`, the Host row reports `enabled=true` / `fiberPhase=active`,
and the route answered `403 FORBIDDEN` without the intent header and
`401 UNAUTHENTICATED` without signed-peer admission. The rendered settings page
has **not** been visually inspected yet — open **Settings → Навыки** after a page
refresh to complete this stage's acceptance.

## License

MIT. This is a community plugin, not an official DeepSeek AI product. Design
inspiration (Claude Skills pages, ZCode import flow, Hermes category layout) is
credited in the repository `NOTICE`.
