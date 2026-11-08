# Changelog

## 0.2.0 — 2026-11-09

- `visual_template(module)` with three offline starters: process diagram, screen
  mockup and 16:9 slide; the model adapts bracketed placeholders and publishes.
- Print/PDF export: a plugin-owned print wrapper renders the stored version with
  `script-src 'none'` and a same-origin iframe, then calls `contentWindow.print()`.
- Optional project copy: `visual_publish` accepts `saveToProject` and writes
  `artifacts/visuals/<id>/v<rev>.html` plus `meta.json` into the session project;
  `projectByDefault` enables it for every publish.
- System prompt: when to use a widget versus a page, starter templates, the
  print/PDF rule (data in HTML, not in scripts) and the project-copy flag.
- 52 unit tests, repository validator and CI cover the new modules.

## 0.1.0 — 2026-11-08

- Inline choice widget (`visual_ask`) that returns the user's answer as a tool
  result and lets the same turn continue.
- Published interactive visuals (`visual_publish`) with immutable versions in
  the right-sidebar «Визуализации» tab: list, versions, device widths, HTML
  download, open-in-tab and full-screen.
- `visual_guidelines` complexity budget for diagram, mockup, interactive and
  chart modules; published HTML runs in a capability-keyed sandboxed iframe.
