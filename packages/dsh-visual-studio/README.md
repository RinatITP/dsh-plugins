# dsh-visual-studio

Visual studio for DeepSeek Harness: **inline choice widgets in the chat**,
**published interactive visuals in the right sidebar**, and a **design guideline
tool** the model reads before it draws.

The plugin covers two distinct jobs that are usually confused:

1. **Synchronize on a decision.** The agent proposes options, the user adjusts
   them in a widget rendered in the chat, presses *Send choice*, and the same
   turn continues with that answer as a tool result. The widget is a structured
   spec (rows and actions), not agent HTML, so it always matches the host theme,
   stays small and renders fast.
2. **Explain a topic.** The agent publishes one self-contained HTML visual —
   process diagram, link graph, screen mockup, dashboard or chart — into the
   *Visual studio* sidebar tab. Every publish is a new immutable version of the
   same title; the panel keeps the list, versions, device widths, download and
   full-screen mode.

Before either mode the model calls `visual_guidelines`, which returns the
complexity budget for that kind of visual (labels, palettes, grid, what belongs
on the page).

## Tools

| Tool | Purpose | Result |
|---|---|---|
| `visual_guidelines` | Design rules for `overview`, `diagram`, `mockup`, `interactive` or `chart` | Guidelines text for that module |
| `visual_ask` | Inline widget: title, optional metric, 3–7 rows, 2–4 actions per row, submit | One selected action per row, changed count, optional note |
| `visual_publish` | Publish a complete self-contained HTML visual for the current title | Artifact id, version, module, URL |
| `visual_template` | Ready-to-adapt HTML starter for a `diagram`, `mockup` or `slide` | Complete self-contained HTML document with bracketed placeholders |

`visual_ask` blocks the tool call until the user answers or the configured
timeout expires; a timeout, an abort and a plugin unload all return a structured
"not answered" result instead of leaving the call hanging.

## Surfaces

- **Chat** — custom tool views (`tool.call.toolview`) for both tools. The widget
  submits its answer to the plugin's own exact route; the publish card opens the
  panel automatically once the visual is stored.
- **Right sidebar** — tab type `dsh-visual-studio` with a discoverable guide
  entry. Artifact list, version selector, width presets (fit/390/768/1440),
  refresh, HTML download, print/PDF, open-in-tab and full-screen mode.
- **System prompt** — one section that tells the model when to use a widget, when
  to publish a page, and that published pages have no network access.

## Storage

Plugin-owned files only, under `<dshHome>/visual-studio/` (normally
`~/.dsh/visual-studio/`):

```
catalog.json                  derived index: artifacts and their versions
artifacts/<id>/v<rev>.html    one immutable file per published version
```

The catalog is written atomically (temporary file + rename) and serialized
behind one queue. Up to 200 artifacts and 50 versions per artifact are kept; the
oldest entries are pruned together with their files. User project directories
are never touched.

## Security

- Published HTML is served with `Content-Security-Policy: sandbox allow-scripts`
  and `default-src 'none'`, so the visual always runs on an opaque origin: no
  access to the DSH origin, cookies or local storage, no network, no frames.
- The panel embeds visuals through `<iframe sandbox="allow-scripts">` — never
  `allow-same-origin`.
- `visual_publish` rejects external scripts, stylesheets, images, fonts, CSS
  imports and `fetch` calls, so a published visual cannot depend on the network
  or leak the page context.
- The manifest route requires the plugin intent header and peer admission; the
  widget answer route validates the answer against the pending spec before it
  resolves the tool call. Paths are derived from a validated artifact id and a
  numeric revision, never from the request string.

## Install

```sh
dsh plugin --profile <profile> add "/absolute/path/to/dsh-plugins/packages/dsh-visual-studio"
```

Then make sure the bundle is in the profile's bundle list (the Plugin Manager
does this for you) and reload the page.

## Configuration

The bundle row accepts an optional config object:

| Field | Default | Meaning |
|---|---|---|
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Root that holds the `visual-studio` directory |
| `askTimeoutMs` | `1200000` (20 min) | How long one widget may wait for an answer |

## Export

- **HTML** — the panel downloads the exact stored version.
- **PDF** — the *Print / PDF* button opens a plugin-owned wrapper page whose
  same-origin iframe carries the visual with `script-src 'none'` (no
  `sandbox`, so the parent may call `contentWindow.print()`); the browser print
  dialog then saves a PDF. The artifact itself never runs scripts in this mode.
- The print route runs the visual with `script-src 'none'`, so a page whose
  content is built by JavaScript prints only its static markup. Keep the data in
  the HTML when a PDF is expected (the whole system prompt says so as well).
- **PNG** is not supported in v1/v2: a sandboxed iframe has an opaque origin, so
  the client cannot rasterise its DOM. A later version can convert SVG-based
  diagrams through canvas, or render on the Host with a headless browser.

## Status and verification

Development preview `0.1.0`, targeting DSH Desktop/Web `0.2.2-rc.1`.

Automated checks: 47 Node unit tests cover spec normalization, answer validation,
storage versions and pruning, the pending-widget lifecycle, and the three HTTP
routes including the capability-key gate; `node scripts/validate.mjs` and CI
cover the package shell, locales, icon, manifest and JavaScript syntax.

Live verification on 2026-11-08 in a separate `viz-test` Web profile
(DSH `0.2.2-rc.1`, macOS, модель `deepseek-account/deepseek-flash`):

- `visual_guidelines("interactive")` ran; `visual_ask` blocked and rendered an
  inline widget with 4 rows and 12 action buttons, a headline metric, changed-row
  highlighting and a working submit;
- changing two rows and submitting returned the answer as the tool result — the
  agent continued in the same turn and recalculated the program;
- `visual_publish` stored version 1 of a diagram; the right-sidebar tab opened by
  itself, the artifact rendered in `<iframe sandbox="allow-scripts">` with a
  capability-key URL, the width selectors and full-screen mode worked;
- the manifest required the intent header and peer admission; the artifact route
  answered `403` without the capability key for a non-admitted peer; the download
  returned the document with an RFC 5987 UTF-8 filename.

Recorded screenshots from that run: `01-widget.png`, `02-widget-changed.png`,
`03-published-panel.png`, `04-fullscreen.png`, `05-agent-continued.png` in the
`dsh-visual-studio` research folder of the owner's Brain vault.

Not verified yet: Windows and Linux, locales other than Russian/English, many
concurrent widgets in one session, pruning under a full catalog, and the mobile
layout of the panel.

## Limitations in v1

- The inline widget is spec-driven. Arbitrary HTML widgets are a later escape
  hatch; a free-form visual belongs in `visual_publish`.
- A published page is interactive for exploration but cannot send answers back
  to the agent. Decisions return through `visual_ask`; a page-to-chat answer
  channel is deliberately out of scope until its security model is designed.
- Versions are keyed by the visual title; renaming the title starts a new
  artifact.
- The pending-widget registry lives in the Host process: restarting the Host
  aborts open widgets.
