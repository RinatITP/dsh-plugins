# Changelog

## 0.2.1 — 2026-11-13

- An answered `visual_ask` card no longer disappears: it stays in the chat as a
  collapsed summary («Принято · изменено: N») that expands into the chosen action
  for every row, with changed rows highlighted.
- The answer is reconstructed after a page reload or session replay from the
  recorded result: the Host attaches `presentationMeta` to the tool result and
  the rendered text uses stable `• title → label` lines as a fallback.
- Keyboard accessible toggle (`role="button"`, Enter/Space) and a closed state
  for widgets that timed out or were aborted.
- 54 unit tests and the repository validator pass.

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
