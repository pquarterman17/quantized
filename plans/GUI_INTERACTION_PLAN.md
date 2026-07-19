# GUI Interaction & Origin-Parity UX Plan

The interaction/UX campaign that turns quantized's broad-but-scattered gesture
set into one coherent, discoverable, reversible workbench — the work most likely
to keep the owner in quantized instead of reopening OriginPro. Backend analysis
parity is essentially done; the remaining risk is **"the capability exists, but
the user can't discover it, can't predict which gesture applies, or can't safely
undo the result."** Also folds in the scientific-selection correctness traps
(fits/baselines silently using the wrong column or ignoring error bars), which
for a publication tool outrank any discoverability gap.

**Status:** Active
**Created:** 2026-07-12
**Updated:** 2026-07-18 (#12 CLOSED — all 5 slices + parts A/B/C shipped
same day: Part A's `y2Fmt` store field/setter, Part B's grouped-series wire
contract + Figure Builder handoff, and Part C's `decor` block
(annotations/shapes/legend) with its `plotspecApply.ts` REPLACE-semantics
apply on Send; see Completed for the full slice-by-slice record)
**Parent:** MAIN_PLAN.md
**Origin:** ChatGPT-"Sol" GUI interaction audit, 2026-07-12 (raw audit preserved
at `plans/SOL_FEATURE_GUI_INTERACTION_AUDIT.md` — reference only; THIS file is the
live tracker, update here, not there).

---

## Context

### How the pieces fit together
The interaction surface spans several subsystems that today each own their own
editing grammar:
- **Plot canvas** (`components/Stage/`, `lib/uplot*`) — pointer/zoom/pan/cursor
  tools, annotations, shapes, reference lines, baseline anchors, axis-label drag +
  Format, legend drag; many competing pointer plugins on one DOM node.
- **Inspector / context menus** (`PlotContextMenu`, `ContextMenu`, Inspector
  cards) — series/axis/annotation/shape/dataset/worksheet actions.
- **Library** (`components/Library/`) — folders, smart folders, tags, figures,
  reports, book families; dense drag/drop with 3-zone folder drops.
- **Workshops** (`components/workshops/*`, floating `ToolWindow`s) — the no-code
  analysis UIs (curve fit, peaks, baseline, filter, pipeline…).
- **Graph/Figure Builder** — plot construction; builder output is a durable
  saved `PlotSpec` since 2026-07-17 (#11 core; Figure-Builder handoff still open).
- **History** (`store/history.ts`) — undo/redo, today scoped to DATA mutations
  only; visual/layout/organization edits are excluded by design.

### The central thesis
quantized has the individual gestures Origin has, but not one **object-editing
language**. An expert can be productive; the owner after weeks away, or a new
user, must remember too much. The return-on-effort is making existing
capability **visible, predictable, and reversible** — not adding algorithms.

### Default-tool readiness (condensed from the audit; risk labels as of the
2026-07-12 audit — the 2026-07-17 campaign has since addressed much of this)
Highest return-to-Origin risk THEN: **direct graph editing** (capable but
hidden — #3/#7/#8/#9 shipped since), **undo/recovery** (strong for data, weak
for visual/organizational — still true, gated on #1), **buttons & tooltips**
(dense, icon-only — #7 shipped since), **reusable graph construction**
(was ephemeral — #11 core shipped saved PlotSpecs). Lower risk: core 2-D
plotting, publication export.

### Dependency map / sequencing notes
- **Correctness traps first.** #5 (baseline channel) and #6 (pipeline channel)
  produce silently-wrong published results — worse than any UX gap. #4 (weighted
  fitting) already shipped.
- **#1 (undo) underpins #2/#3** — direct manipulation only feels safe when
  reversible; build the undo scopes before widening drag/edit surfaces.
- **#8 (context-action registry) feeds #2 (Plot Objects tree)** — one action
  definition reused across right-click / tree / palette / mini-toolbar.
- **#12 (canonical plot spec) touches everything** — Graph Builder (#11), export,
  Figure Builder; do it deliberately and do NOT dissolve the intentional
  fast-canvas (uPlot) vs. vector-export (matplotlib) split — unify the SPEC, keep
  the renderers.
- The **friction-log acceptance test** (Reference) is the empirical re-prioritizer
  — run it once against a real month of projects and let it reorder the middle.

---

## Tier 1 — High Impact

1. **Undoable mouse-driven visual edits** — every committed visual/layout/
   organization edit becomes one named, coalesced history transaction.
   - [ ] Decide the undo **scopes** first (Origin uses scoped undo; a single flat
         stack mixing "undo my fit" with "undo my axis colour" is confusing) —
         this is an owner gate, see Owner gates.
   - [ ] Coalesce a drag into ONE step (`Move annotation`, not 80 pointer moves).
   - [ ] Cover: axis-title drag/format, annotation/shape move/resize/delete, curve
         colour/marker/width/order/visibility/Y-axis, ref-line move, window
         move/resize/close/rebind, folder/dataset reparent, graph-spec changes.
   - [ ] Show the action name in Edit▸Undo + a brief toast; keep navigation-only
         zoom/pan as a SEPARATE Back/Forward view history (resolve the "one Ctrl+Z
         restores exactly the previous state" vs. separate-view-history tension).

2. **Unified "select object → edit it" model (Plot Objects tree)** — one
   synchronized tree (Inspector mode) exposing curves/axes/layers/legends/
   annotations/shapes.
   - [ ] Two-way selection sync (click canvas ↔ tree row highlights).
   - [ ] Row actions: visibility, reorder, delete, duplicate, Properties — map
         these onto the channel model (a "curve" = a dataset channel; settle what
         "duplicate"/"delete" mean per object type before building).
   - [ ] Multi-select: align, distribute, group, shared styling for graphic objects.
   - [ ] Large bet — size it deliberately; reuses #8's action registry.

5. **Baseline analysis honors the plotted X/Y channels** — the baseline workshop
   still computes on `time`/`values[0]` and subtracts into `values[0]`, diverging
   from the displayed channels. (Correctness trap.)
   - [ ] Bind baseline to the plotted X + selected primary Y, show those names in
         the workshop, store them in provenance, subtract into that same channel.
   - [ ] OWNER GATE: the OriginPro audit frames baseline as a BACKEND corrections/
         recalc-DAG change (`bgAnchors`/`applyCorrections`), not a frontend read —
         scope which before starting (see Owner gates).

## Tier 2 — Medium Impact

8. **Context menus as a complete system** — CLOSED 2026-07-18 (see Completed).
   The one remaining consumer — the Plot Objects tree — rides the owner-gated
   #2 itself; the registry's `run(target)` shape is ready for it.

11. **Graph Builder → durable artifact** — CLOSED 2026-07-18 (see Completed;
    core + every sub-box shipped 2026-07-17/18). Faceting-adjacent export
    gaps ride #12's canonical-spec work.

12. **One canonical plot specification** across Stage / Graph Builder / Figure
    Builder / export — CLOSED 2026-07-18 (see Completed). Deliberately still
    open, but NOT part of this item: the `page` block (panel/facet/layer
    geometry) is tracked at ORIGIN_FILE_DECODE_PLAN #54; spec-level parity
    upgrades (new adapters/consumers reading `display`/`axes`/`decor`) land
    opportunistically as those surfaces evolve, not as a standing item here.

15. **Real-browser interaction coverage** — jsdom can't validate canvas hit
    targets, pointer capture, drag/drop, high-DPI, overlapping-plugin contention.
    - [x] Playwright harness (`frontend/e2e/`) — own `playwright.config.ts`,
          separate `npm run e2e` script (never runs inside `npm test`/vitest),
          synthetic CSV fixtures only (never `../test-data`), 100/125/200%
          zoom-matrix projects.
    - [x] File-drop import
    - [x] Folder create/nest/reorder + drag a dataset into one via its grip
          handle (3-zone drop)
    - [x] Right-click curve restyle (colour + marker)
    - [x] Axis title + limits edit
    - [x] Graph build/save/reopen (PlotSpecBar)
    - [x] Each analysis drag + Esc-cancel (region-tool arm/cancel + ToolHud)
    - [x] The same essential journey keyboard-only (Command Palette import,
          Shift+F10 context menu, Enter activates)
    - [ ] Folder reorder/nest **undo** — gated on the #1 undo-scopes owner
          decision; there is no visual-edit undo to test yet. (The ONLY
          remaining sub-item as of 2026-07-18.)
    - [x] channel→X/Y/Y2 drag (2026-07-18, `channel-axis-drag.spec.ts` @core —
          hand-built `DataTransfer` + dispatched drag events, since the axis
          bands only mount mid-drag and `dragTo` can't resolve them upfront)
    - [x] annotation/shape move/edit/delete (2026-07-18,
          `annotation-shape-lifecycle.spec.ts` @core, 3 tests: create via
          Annotations card → dblclick-edit → canvas drag-move → menu delete;
          mini-toolbar delete; shape draw/Dashed/delete. Undo halves stay
          gated on #1.)
    - [x] window arrange/restore (2026-07-18, `window-arrange.spec.ts`,
          100%-only: New Graph Window ×2, Tile, Cascade, maximize/restore,
          close via the #8 title-bar menu)
    - [x] Export round-trip — a real-browser journey now carries ordered
          Graph Builder XY/scatter intent into Figure Builder, downloads real
          FastAPI/matplotlib PDF/SVG/PNG artifacts, validates MIME types,
          filenames, and file signatures, then saves/reopens the FigureDoc and
          proves the publication request is identical. A companion regression
          keeps connected line and line+marker series connected.
    - [x] Palette-race hardening (2026-07-18, `46669e7`): the one observed
          window-arrange flake reproduced as CommandPalette's open-effect
          `setQuery("")` clobbering automation-typed input (test-timing
          artifact, not a production bug — humans can't type inside React's
          effect-flush gap). Shared `e2e/utils/palette.ts` `runPaletteCommand`
          (exact-text row click + Esc-reopen retry) adopted by
          window-arrange/graph-builder/export-roundtrip; keyboard-only keeps
          its own sequence (filechooser arming). 30× repeat + 2 full suites
          clean.
    - [x] CI workflow — `.github/workflows/e2e.yml` VERIFIED LIVE 2026-07-17:
          first push-run failed 4 menu tests (spec `role="button"` locators vs
          the #8 registry's explicit `role="menuitem"`; local runs had masked
          it via `reuseExistingServer` against a STALE server), fixed in
          `a2fb74a` — second live run green 18/18 (run 29610916988).

    _Progress (2026-07-18):_ core harness + 8 journeys shipped. Server under
    test: `uv run qz --no-browser --port 8934` (cwd = repo root), Playwright's
    `webServer.url` polls `/api/health`; `--no-browser` means
    `QZ_AUTO_SHUTDOWN` never arms, so the server survives the browser
    contexts' `/api/ws` presence-socket churn between tests. Prerequisite is
    `npm run build` (documented in `frontend/e2e/README.md`) — the backend
    serves the built SPA from `src/quantized/web/`, exactly the `qz` run
    model. State assertions read the `?harness` seam already used by
    `tools/visual` (`window.__qz.useApp.getState()`) for store fields a DOM
    query can't reach cleanly (series style, axis label/limits,
    `savedPlotSpecs`, folder tree). Zoom matrix: `chromium-100` runs all 10
    tests (8 spec files; `region-tool-escape.spec.ts` and
    `export-roundtrip.spec.ts` each have 2); `chromium-125`/
    `chromium-200` run only the 4 `@core`-tagged specs (import-drop,
    folder-organize, curve-restyle, region-tool-escape) — the ones touching
    canvas hit-testing/pointer capture/native drag-drop, the actual gaps this
    plan item names; axis-limits/graph-builder/keyboard-only are plain DOM
    form/keyboard interactions, not DPI-sensitive, so they run at the 100%
    baseline only. 20 tests total (10+5+5), all green in the current full-suite
    run. Zero `frontend/src` changes — the `?harness` seam
    (`main.tsx`) already existed for `tools/visual`; no new testability seam
    was needed. Menu-dependent selectors (context-menu items, the
    concurrently-refactored `ContextMenu.tsx`/`PlotContextMenu.tsx`) are
    located by accessible name/text, never DOM structure, so they survive
    that refactor. `npm test` (3671 tests) and `npm run build` both still
    green.

## Tier 3 — Nice-to-Have

16. **Owner-dependent Origin feature gaps** — prioritize ONLY from real projects
    (the friction-log test), not Origin's checklist.
    - [ ] Candidates: worksheet stack/unstack/reshape/transpose/pivot/join-by-key;
          date/time axes + date-aware ops; broad signal processing; general 3-D
          surface/mesh/contour outside the RSM path; database/query connectors;
          `.opju` migration edges (matrix books, some 2-D instrument data, richer
          graphic-object/callout fidelity). (Several overlap MAIN owner gates /
          deferrals — reconcile, don't double-book.)

17. **Buttons / labels / menus / tooltips polish**
    - [ ] Split buttons for last-used tool. **High-consequence-action audit
          DONE 2026-07-19** — and it found two REAL DEFECTS, not polish:
      - [x] **Unconfirmed dataset delete** (`320df6f`). The Library row's
            footer "✕" called `removeDataset()` straight on the store, while
            the SAME deletion via the row's context menu was confirm-gated
            (`dataset.remove`, `destructive: true`). One irreversible action,
            two paths, one confirm. Fixed at the mechanism: the button routes
            through the same registry action (looked up BY ID, never by array
            index), so the confirm is structural. Adversarially verified —
            restoring the direct call fails the new tests.
      - [x] **Unconfirmed calculator-history wipe** (`9593165`). A one-click
            ghost button labelled bare "Clear" irrecoverably wiped accumulated
            work. History is not in the "cheap to recreate" category
            `contextActions.ts` carves out for canvas objects, so it gets a
            confirm; the label now names what it clears and the confirm counts
            the results and states favourites survive.
      - [x] Audit outcome for the rest: every other high-consequence control
            already carries text or `title`+`aria-label`, and the five
            annotation/shape/ref-line/table-row "✕" buttons are a DOCUMENTED
            deliberate exception (`contextActions.ts` — cheap-to-recreate
            canvas objects, undo is the eventual answer under the #1 gate),
            not a silent gap. `CorrectionsCard`'s bare "Apply"/"Reset" was
            considered and deliberately LEFT: it sits inside a Card titled
            "Corrections", and widening button text in the fixed 296px
            Inspector column without visual verification risks exactly the
            truncation this item complains about elsewhere.
      - [x] **Dialog button order DONE 2026-07-19** (`2bb2b04`): an audit found the order already
          correct everywhere (secondary first, primary last, hand-copied from
          ParamDialog/ConfirmDialog across all 8 backdrop dialogs) — the gap
          was the "destructive separated" half. `.qz-btn-row` is a plain
          equal-width flex row, so a destructive Confirm sat flush against
          Cancel as its identical-width twin, distinguished by colour alone.
          A danger confirm now gets `.qz-btn-row--danger`: buttons size to
          content and a flexible gap pushes them apart. Order deliberately
          unchanged (moving the destructive button would contradict the same
          convention); non-destructive dialogs render byte-identically, pinned
          from both sides.
    - [x] Two real-browser findings from the 2026-07-18 e2e work (fixed
          2026-07-18): the selection mini-toolbar's rightmost buttons could
          sit under the floating plot toolbar at common viewports — fixed
          by offsetting `.qzk-mini-toolbar` below the toolbar's row
          (`shell.css`), since the toolbar can span nearly the full stage
          width and z-index would only relocate the obstruction; and the
          Channels card's checkbox visually overflowed into its sibling
          select in the Inspector's fixed 296px column — fixed by giving
          the checkbox `flex-shrink: 0` + a small min-width floor on its
          label so the squeeze falls on the (truncating) text and the
          right-hand selects instead. Both e2e workarounds (a synthetic
          `.click()` in annotation-shape-lifecycle.spec.ts, a left-edge
          `position` click in channel-axis-drag.spec.ts) were removed in
          favor of real center clicks, verified passing at all three DPI
          scales.
    - [ ] **Menu regrouping — SUB-TOPIC HEADERS DONE 2026-07-19** (`a13e273`,
          `3947d8d`); the cross-menu ownership move and the Help build-out
          remain open.
      - [x] Analyze (17 flat items) -> Fit / Peaks & baseline / Magnetometry /
            XRD & reflectivity / Transform & signal / Statistics / Workflow;
            Data (14) -> Combine & split / Rows & summary / Recalculation /
            Composite windows; Plot (14) -> Axes / Display / Layout. New
            OPTIONAL `Action.section` field + pure `lib/menuSections.ts`,
            reusing the `.qzk-menu-sep`/`.qzk-menu-label` markup the File
            menu's "Recent" block established. Grouping is STABLE, not
            contiguous (a contiguous run emits a duplicate header the first
            time a command is added in the "wrong" place — the exact
            maintenance trap this item removes). Unsectioned menus render
            byte-identically. The palette ignores `section` — it is searched,
            not browsed. Guarded by a `describe.each` over all three menus:
            every command filed, vocabulary restricted, non-vacuous floor.
      - [ ] Cross-menu OWNERSHIP move (Graph owns builders/plot-types/layers/
            themes/templates/export; Data owns worksheet/row-col/filter/
            reshape/merge/correction/metadata). Deliberately NOT done as a
            side effect of sectioning: relocating commands between menus
            breaks muscle memory and deserves a deliberate call.
      - [ ] Fill out Help: searchable tool help, mouse interactions, import
            guides, Origin migration, `What is this?` mode. Help currently
            holds only Keyboard shortcuts + Text formatting (+ a palette entry
            and an About link).
    - [ ] **Shortcuts + palette labels DONE 2026-07-19** (`42b4174`,
          `8b66988`); the first-run hints mode remains open.
      - [x] Shortcuts were already RENDERED in menus and the palette, but only
            the Shortcuts DIALOG localized them: `Action.shortcut` bakes in the
            macOS glyphs and the translation lived inside `shortcutGroupsFor`,
            so on Windows the File menu showed the Cmd glyph + O while Help ▸
            Keyboard shortcuts showed Ctrl+O — one app, two answers for one
            key. Translation is now an exported `formatShortcut(keys, isMac)`
            every surface runs. Also de-duplicated `IS_MAC` (two copies of the
            same regex over the DEPRECATED `navigator.platform`).
      - [x] Palette/menu label parity: "open the command palette" is reachable
            from four surfaces and three hard-coded three DIFFERENT strings.
            Now one exported `PALETTE_LABEL`/`PALETTE_SHORTCUT`. Note
            `MenuBar.test.tsx` had been DOCUMENTING the divergence (fixture
            said "Command palette…", assertion clicked "Command palette"), so
            it was rewritten to assert the parity it previously encoded as
            expected.
      - [x] Cheat-sheet drift: the Help sheet and the registry are two
            independently-authored lists whose spacing conventions differ
            ("Cmd Z" vs "CmdZ"), hiding that undo, redo, paste and Preferences
            were registered commands MISSING from the sheet — a user pressing
            `?` was told undo has no shortcut. Added, and guarded by a
            normalizing cross-check that was adversarially verified (removing
            an entry fails it) rather than assumed.
      - [x] All of the above pinned at the CLASS level by
            `src/shortcutDisplay.test.ts`, which scans raw module text: no
            module may interpolate `.shortcut` outside `formatShortcut`, no
            component may hard-code a modifier glyph in `qz-shortcut` markup,
            and only `store/commands.ts` may spell the palette label. The
            glyph scan immediately caught a THIRD offender the manual audit
            had missed (AppearanceMenu's "All preferences…").
      - [ ] Optional first-run "show interaction hints" mode.

---

## Owner gates (decide before the gated item starts)

- **Undo scopes (#1)** — one unified stack vs. scoped undo (visual / data /
  organization) + a separate view-history for zoom/pan. Origin uses scoped;
  pick the model before building.
- **Baseline: frontend bind vs. backend DAG (#5)** — cross-audit contradiction.
  This plan says "bind to plotted X/Y"; the OriginPro audit says baseline is
  entangled with the corrections/recalc DAG. Resolve the scope first.
- **Plot Objects tree scope (#2)** — full Origin-style Object Manager is a large
  bet; confirm it's wanted vs. better-signposted existing gestures + undo.
- **Shared AnalysisSelection contract** — the OriginPro audit wants ONE selection
  contract across fitting/peaks/baseline/magnetometry; #4 shipped a small shared
  `lib/fitweights` helper as the seed. Decide when to generalize it into the full
  contract (before #5/#6 vs. after).

---

## Completed

- ~~**#12 One canonical plot specification**~~ (2026-07-18) — PlotSpec v2:
  today's zones+mark grammar extended with ADDITIVE-OPTIONAL blocks
  (`display`: per-series style/axis/hidden; `axes`: label/limits/scale/
  step/format for x/y/y2 + title; `decor`: annotations/shapes/legend
  placement), each omitted-when-default so a plain spec never flips to
  version 2; `page` (panel/facet/layer geometry) stays RESERVED — deferred
  to ORIGIN_FILE_DECODE_PLAN #54's generalized FigureDoc/page-layer model,
  not a slice of this item. Landed in 5 numbered slices plus 3 same-day
  "finish" parts:
  - **Slice 1** (`79766bb`) — export-parity contract harness
    (`lib/exportParity{,2}.test.ts`, 25 tests over the full 8-row matrix
    against the real store + request-assembly path) that DEFINES "one
    spec" empirically; found + pinned 3 residuals, all closed later
    (stale `y2_lim`, log-y2 minor ticks, missing `y2_fmt` store field).
  - **Slice 2** (`9fe0bcb`) — `lib/plotspec2.ts`: the `display`/`axes`
    schema (field vocabulary matched to the real store, e.g. `line` not
    "lineStyle"), tolerant per-field validators, pure capture builders
    (all-default → `undefined`), `page`/`decor` reserved placeholders;
    `version` RECOMPUTED from block content on every validate/serialize,
    never trusted from the incoming tag; v1 payloads regression-pinned
    byte-stable.
  - **Slice 3** (`a7a4eac`) — `useGraphBuilder`'s save now captures the
    LIVE display/axes state (`captureLiveBlocks`, scoped to the spec's
    own plotted channels ∪ active-dataset only); `plotSpecCoreEqual`
    (zones+mark only) replaces `plotSpecsEqual` for the dirty check so a
    styled save/reopen never false-flags; `plotSpecToFigureDoc` reads a
    v2 spec's own blocks as the primary source for the Figure Builder
    handoff.
  - **Slice 4** (`a90048d` 4a, `bc0929d` 4b) — export-adapter residuals:
    gated the stale `y2_lim` override + log-y2 minor ticks onto the twinx
    overrides sweep; faceted stat export (new `calc/figure_facets.py`,
    box/violin/bar, optional `facets` list, byte-identical when absent);
    the xy family's facet-export xKey/yKeys reset (`store/windows.ts`'s
    `focusedRebindPatch` now only resets on a GENUINE dataset switch, not
    a same-dataset re-activate); page-export y2 (`PagePanel` gains y2
    params mirroring `figure._render_impl`, `routes/export_page.py`'s 422
    guard removed).
  - **Slice 5** (`a45c0a0`) — new `lib/plotspecApply.ts`: the Stage
    adapter, applying a spec's captured `display`/`axes` onto the live
    store on Send (`useGraphBuilder.sendToStage`'s xy branch only —
    box/violin/bar deliberately not wired, `useStatStage` has no
    store-driven title/label override for a block to feed). Closes the
    save → reopen → send loop (full-loop-tested). Investigated (not
    implemented, 30-min cap) a grouped-xy wire-contract extension for
    Figure Builder/export — landed same day as Part B below.
  - **Part A** (`6356b37`) — Slice 4's own still-open residual: a real
    `y2Fmt` store field + `setY2Fmt` action (`store/useApp.ts`,
    `PlotView`), threaded through `uplotOpts`/`PlotStage`/export so the
    secondary axis gets an independent tick format instead of hardcoding
    `yFmt`.
  - **Part B** (`490ae35`) — Slice 5's investigated-not-implemented
    residual, implemented: a grouped xy spec's per-level synthetic series
    gets a real wire representation (`calc.plotting.build_grouped_series`,
    a faithful port of the frontend `buildXY` colour split;
    `FigureRequest`/`FigureConfig`/`FigureSpec` gain additive-optional
    `group_col`), un-fail-closing the Graph Builder → Figure Builder
    handoff for a plain grouped spec (still fail-closed for grouped + Y2
    — `buildXY` never assigns a grouped series to the secondary axis).
    Cross-language parity fixture in both `test_calc_plotting.py` and
    `plotspec.test.ts` guards `buildXY` ↔ Python port drift.
  - **Part C** (this commit) — the item's last reserved block: `decor`
    (annotations/shapes/legend). `lib/plotspec2.ts` gains `DecorBlock`
    (`annotations?: Annotation[]`, `shapes?: Shape[]`,
    `legend?: {pos?, xy?, title?}`), validated through the SAME
    sanitizers `.dwk` window restore already uses (`sanitizeAnnotations`/
    `sanitizeShapes`, exported from `lib/plotview.ts` for reuse — never a
    second, drifting validator); `legendFrameXY`/`legendStatic` are
    deliberately excluded from the block — both are Origin-decode-only
    artifacts with no store setter at all (`applyOriginFigure` writes
    them via a direct `set()` call). `buildDecorBlock` wires into
    `useGraphBuilder`'s `captureLiveBlocks` with the SAME active-dataset
    scoping as display/axes; annotations/shapes are GLOBAL plot overlays,
    so — unlike `display` — captured verbatim rather than channel-
    filtered. `plotspecApply.ts`'s `applyDecorBlock` applies on Send with
    REPLACE semantics: shapes via the existing bulk `clearShapes` +
    `addShape` (which already accepts the full payload); annotations via
    a loop of the existing per-id `removeAnnotation` (no bulk action
    exists) + `addAnnotation`/`updateAnnotation` (an annotation's `axis`
    field has no setter ANYWHERE — a documented gap, not a silent drop);
    legend via `setLegendPos`/`setLegendXY` (`legend.title` is captured
    for round-trip fidelity but has no `setLegendTitle` action to push it
    back through — same documented-gap category as `axes.*.step`).
    `store/useApp.ts`/`components/Stage/PlotStage.tsx` UNTOUCHED (zero
    ratchet cost — decor apply is pure orchestration over existing store
    actions, no new setters needed). Full save → reset → reopen → send
    loop test extended with annotation/shape/legend assertions, including
    a REPLACE-not-merge proof (a "wandered off" stale annotation set
    before reopen is gone after Send; the captured one is back).
    Frontend 4035 tests (up from Part B's 4008) + build green.

  Two deliberate remaining pointers, not open work on this item: the
  `page` block lives at ORIGIN_FILE_DECODE_PLAN #54 (which explicitly
  wants a generalized FigureDoc/page-layer model over more singleton
  plot-state branches), and spec-level parity upgrades (new adapters or
  consumers growing to read `display`/`axes`/`decor`) happen
  opportunistically as those surfaces evolve, not as a standing backlog
  item.

- ~~**#11 Graph Builder → durable artifact**~~ (2026-07-18; core 2026-07-17,
  Figure-Builder handoff + series reorder via Codex PRs #62/#63) — the last
  open box, **faceting for statistical marks**, shipped: `lib/facet.ts` gains
  the shared `facetSlices` row-slicing primitive (facetPayloads now delegates
  to it, output-identical); `specToRender`'s box/violin and bar variants gain
  optional per-level `facets` (same groupCol/valueCol pipeline re-run per
  slice; empty levels drop, all-empty omits the field; flat fields still
  computed from ALL rows); `StatStageSeed` gains `facetCol`; `useStatStage`
  computes `drawFacets` per slice (per-slice offline degrade — a backend
  hiccup on one slice never takes down the others; violin degrades to box
  per the never-fabricate-a-KDE rule; flat `draw` goes null while faceted,
  auto-disabling Export with a "lands with the canonical-spec work" note);
  `StatStage` renders a captioned CSS grid of independent `StatStageCanvas`
  cells + a "facet by" picker (box/violin/bar only); `GraphPreview` mirrors
  the same grid for box/bar facets (`statRender.ts` untouched — the grid is
  N canvases, not a rect-aware renderer); `sendToStage` seeds carry
  `facetCol` and the status names the facet column. Implemented by a sonnet
  agent from spec, adversarially reviewed. Frontend 279 files / 3845 tests
  (+28) + build green on the merged tree. Remaining faceting-adjacent gaps
  now live where they belong: faceted figure EXPORT + the xy family's
  facet-export xKey/yKeys reset both ride #12's canonical-spec work.

- ~~**#8 Context menus as a complete system**~~ (2026-07-18; core 2026-07-17) —
  the residual consumers + retrofits all landed: the ⌘K **Command Palette**
  merges context-registry actions computed at open time
  (`lib/paletteContextActions.ts` — active dataset with `askParams` dialog
  fallbacks for the row-local Rename/Add-tag editors, selected annotation,
  selected shape; hidden/disabled entries omitted, destructive entries keep
  their confirm); a **selection mini-toolbar**
  (`Stage/SelectionMiniToolbar.tsx`) shares ToolHud's HUD slot (mutually
  exclusive by construction: HUD = non-pointer tools, toolbar = pointer +
  selection) offering the selected annotation/shape's registry actions as
  buttons; the **worksheet column/row menus** (`worksheetMenus.ts`) and the
  **annotation/shape object menus** (`annotationShapeActions.ts`, composed by
  `useAnnotationEdit`/`useShapeEdit`) rebuilt from registry entries with
  IDENTICAL menu output (parameterized pickers — Frame presets, swatches,
  opacity/width — deliberately stay hand-built, the plotMenu precedent); a
  **window title-bar right-click menu** (`windows/windowMenu.ts` +
  `WindowTitleButtons`, delegated native listener since `PlotWindowFrame` is
  at its ratchet pin) with labels PINNED verbatim to `useWindowCommands`'s
  palette wording by a drift-guard test — same words, different target (this
  window vs. the focused one); bgCycle kind-gated to plot+snapshot like the
  physical ◐ button. `ContextAction` gained `danger` (red, no confirm — for
  cheap-to-recreate canvas objects) and `checked` (toggle ✓). Registry engine
  + annotation/shape registries hand-written (pattern-setting), remainder
  implemented by a sonnet agent from spec, adversarially reviewed. Frontend
  278 files / 3817 tests green (+81 vs. pre-residual), build green. Remaining
  registry consumer = the Plot Objects tree, riding owner-gated #2.

- ~~**#15 Export round-trip browser validation**~~ (2026-07-18, PR #64) —
  `frontend/e2e/specs/export-roundtrip.spec.ts` exercises the production
  browser→FastAPI→matplotlib download path without mocked requests: ordered
  XY keys, labels, colours, widths, marker state/size, and scatter connection
  mode survive Figure Builder save/reopen; PDF/SVG/PNG downloads have the
  expected MIME type, filename, and binary signature. A negative regression
  protects continuous line and line+marker series from being rewritten as
  disconnected scatter/segment paths. Full Playwright suite: 20/20 green.

- ~~**#3 Make powerful gestures discoverable**~~ (2026-07-17) — closed as a
  gap-audit-and-fill: sibling work landed earlier the SAME day already
  delivered most of it — #13 (grip-dot drag handles + hover "⋯" menu cue on
  dataset/folder rows) and #8 (keyboard-complete context menus + the
  `lib/contextActions.ts` registry) — this pass audited every OTHER drag
  surface and closed the remaining gaps against the item's 4 sub-boxes.
  (1) **Drag handles**: Library rows already had `.qzk-drag-handle`; legend
  rows + the Channels-card row (both channel→axis-band drags) got
  `cursor: grab` via a `[draggable="true"]` CSS selector (a dedicated handle
  doesn't fit a checkbox/legend-entry row — the existing hover tooltips
  cover the rest); the panel-cell/plot-window/tool-window title-bar drag
  surfaces got discoverability tooltips (PanelCell already had
  `cursor: grab`; MDI/ToolWindow title bars deliberately KEEP
  `cursor: default`, matching real OS title-bar convention — changing that
  would be the actual regression). (2) **Cursor + drop-target reveal**:
  audited every plot-canvas draggable object (annotations, shapes, ref
  lines, axis titles, the legend box) — all already show grab/move/resize
  cursors on hover, zero gap found there. Added a `store/libraryPanel.ts`
  `activeDrag` field (set on a dataset/folder row's `.qzk-drag-handle`
  dragstart, cleared on dragend) so EVERY eligible drop target gets a
  resting `.drop-candidate` dashed-outline tint the MOMENT a drag starts,
  not only the one the pointer happens to hover — wired into FolderRow (the
  named primary case) and PlotWindowFrame (the window-rebind case, same
  `DATASET_DND` gesture, second real drop-target family). `AxisDropZones`'
  pre-existing "reveal all 3 axis bands once the drag enters the stage" was
  left as-is — a partial but reasonable implementation of the same idea;
  making it fire on drag-START across every mounted plot window would be a
  materially bigger lift for a lower-traffic gesture, noted rather than
  silently skipped. (3) **3-zone drop label**: a small `.qzk-drop-label`
  floating near the pointer, positioned/updated on every `FolderRow`
  dragover, reading `Move inside X` / `Place before X` / `Place after X`.
  (4) **A menu path for every drag** (audit table): dataset→folder =
  pre-existing (folder-row menu's dynamic "Move to …" list); **folder
  reorder = ADDED** (`folderRowMenu.ts`'s new "Move to …" list, mirroring
  the dataset one, built from the newly-split `folderCoreActions`/
  `folderBulkActions`/`folderDeleteActions` groups); legend/curve reorder =
  pre-existing (PlotLegend's own arrows + hand-built menu) **+ ADDED** to
  the shared `curveActions` registry so the plot-canvas right-click curve
  menu offers "Move earlier/later" too, not just the legend's own menu;
  channel→X/Y/Y2 = pre-existing (Channels card checkboxes/Select/Y2 pill —
  reachable from the plot side, not just the worksheet); annotation/shape
  **nudge = ADDED** — precise X/Y (Shapes: x1/y1/x2/y2) edit fields on their
  Inspector-card rows, strictly more useful than a nudge and the first
  non-mouse path either object ever had; window **rebind = ADDED**
  (`WindowTitleButtons`'s new "⇄" button opens a dataset picker, guarded the
  same `kind !== snapshot/panel` way the drag gesture already is). All 4
  sub-boxes close — none left open. `store/useApp.ts` untouched (3229/3240,
  zero ratchet cost — the new `activeDrag` state and every new action live
  in existing slice files); `PlotWindowFrame.tsx` 398/400, `DatasetRow.tsx`
  395/400 (both inside their pins). Frontend 269 files / 3736 tests green
  (+2 files / +28 tests); build green.

- ~~**#13 Folder organization density**~~ (2026-07-17) — 5 of 6 sub-items
  shipped: a dedicated grip-dot drag handle (`.qzk-drag-handle`, the ONLY
  draggable element) on both dataset and folder rows, replacing whole-header
  dragging without touching the existing 3-zone drop-target logic; "Show in
  folder" (DatasetRow's context menu, gated on `folderId`) posts a
  `revealTarget` signal (new tiny `store/libraryPanel.ts` slice) that
  Library.tsx consumes to clear the filter, expand ancestor folders, select,
  and scroll into view — plus a "Folder › Subfolder" path caption on filtered/
  smart-folder rows and an Inspector breadcrumb for the active dataset
  (`lib/foldertree.folderPath`/`folderPathLabel`); a compact multi-select bar
  (`N selected · Plot · Move · Tag · Export · Clear`) wired entirely to
  existing bulk ops (`createPanelWindow`/`moveDatasetToFolder`/
  `addDatasetTag`/the new shared `folderOps.exportDatasets` core); folder
  Properties (name/notes/colour/default template) via `askParams` + a new
  `updateFolder` store action, with `notes`/`color`/`defaultTemplate` added
  as ADDITIVE-OPTIONAL `FolderNode` fields round-tripped through `.dwk`
  (`lib/workspace.ts`'s `parseFolders`) — colour reuses the SAME
  `ACCENT_SWATCHES` fixed-paint table now shared with the Preferences accent
  swatches (de-duplicated); default template pre-selects
  `runTemplateOnFolder`'s picker. Panel width persists via a new
  `libraryPanelWidth` pref (`store/prefs.ts`, applied to the `--lw` CSS
  custom property `shell.css` already declared but never wired) with a
  drag-resize handle (`useLibraryResize.ts`, mirrors
  `worksheet/useColResize.ts`); expand/collapse already lived in the
  workspace (`expandedFolders`, unchanged). Undo for folder moves/creates/
  renames/deletes is DEFERRED — it rides the owner-gated undo-scopes decision
  (#1), out of scope here. `store/useApp.ts` held to 3231/3240 (offset via
  the `store/libraryPanel.ts` slice + reusing the generic `setPref`, not new
  per-field setters); `DatasetRow.tsx` extraction (`datasetRowMenu.ts`) kept
  it at 367/400 despite the new handle/caption/reveal wiring. Frontend
  3463 green (+42 tests), build green.

- ~~**#9 Active-tool feedback + universal cancel**~~ (2026-07-17) — a floating
  `ToolHud.tsx` strip shows the armed non-Pointer tool's name + one-line
  gesture hint + "Esc cancels" (e.g. `∩ Peak / FWHM — drag a range to measure
  a peak's width · W · Esc cancels`), sourced from `plotToolbarDefs.ts`
  (extended with an optional `hint` override + a `region`-tool entry +
  `toolDefFor` lookup, one source of truth with the toolbar's own tooltips)
  and `plotToolKeys.ts`'s `keyForTool`. A new `lib/gestureCancel.ts` registry
  lets a drag (pan/measure/stats/integrate/FWHM/quick-fit ROI/gadget cursors —
  every custom-JS gesture in `uplotTools`/`uplotRegionTools`/`uplotGadgets`)
  register a canceller at mousedown and be aborted from OUTSIDE its own
  closure: Esc (the one centralized handler in `useGlobalShortcuts`) cancels
  a live gesture first (tool stays armed for an immediate retry), then an
  idle-armed qfit gadget (folded in from `useGadgetChip`'s old per-effect
  listener, which re-registered on every drag tick and could race the new
  gesture-cancel for the same keypress), and only then reverts the tool to
  Pointer — skipped while typing in a field or when the new "Persistent plot
  tool" preference (`store/prefs.ts`, own `qz.interactionPrefs` key, default
  off — `store/useApp.ts` has zero ratchet headroom) is set. Right-click
  (`useStageContextMenu.ts`, extracted from `PlotStage.tsx` to hold its
  line-ceiling pin while mounting the HUD) now always cancels any live
  gesture and opens the menu, replacing an `e.buttons & 1` guard that
  silently swallowed the click while the drag's listeners stayed live
  underneath. `ContextMenu.tsx` now `stopPropagation()`s on Escape so an open
  menu owns the key (matches the dialogs' capture+stopPropagation
  precedence) instead of also reaching the new tool-revert handler. Cursor
  audit found ONE real gap — the "select" tool (native uPlot rubber-band, no
  plugin to set one inline) had no crosshair; added to `shell.css`'s existing
  rule. uPlot's own native rubber-band (zoom box, select/region x-band) has
  no exposed "abort this drag" API — documented as a deliberate scope gap,
  not silently dropped. `PlotStage.tsx` 398/400 lines (was exactly at 400,
  net negative after the context-menu extraction); `store/useApp.ts`
  untouched (3238/3240). Frontend 263 files / 3568 tests green; build green.

- ~~**#7 Plot toolbar legibility**~~ (2026-07-17) — the shared `TooltipLayer`
  (already mounted app-wide) now renders a bold NAME + one-line BEHAVIOUR
  description + optional keyboard SHORTCUT, shows on keyboard focus (not just
  hover, via delegated focusin/focusout) and dismisses on Esc. Every
  `PlotToolbar` button carries `aria-label` + `aria-pressed` (toggle/tool-
  select buttons) sourced from a single `{tool: key}` table
  (`lib/plotToolKeys.ts`'s new `keyForTool`, the exact inverse of the existing
  `toolForKey`, so the tooltip can't drift from the real handler). Buttons
  regrouped into six named ARIA groups (Navigate/Inspect/Analyze/Annotate/
  View/Export, new `PlotToolbarGroup`) with a subtle uppercase caption
  toggleable from a new "..." flyout — persisted via `store/prefs.ts`'s
  `loadToolbarPrefs`/`saveToolbarPrefs` (own `qz.toolbarPrefs` key,
  deliberately NOT `store/useApp.ts`, which sits at its ratchet ceiling with
  zero headroom). No button moved behind a flyout — pointer/zoom/pan/
  autoscale stay one click away. Two buttons disable with a real reason:
  Reset View when `xLim`/`yLim` are both null (mirrors the "A" key's own
  no-op guard), and Copy Image when `clipboardImageSupported()` is false (the
  same condition `usePlotStageActions`' `snapshot()` already falls back on).
  Data lives in the new pure `lib/plotToolbarDefs.ts`; `PlotToolbar.tsx` stays
  at 255 lines, `PlotStage.tsx` (already at its exact 400-line ceiling) and
  `store/useApp.ts` (3239/3240) untouched. Frontend 258 files / 3534 tests
  green; build green.

- ~~**#14 Worksheet windows: scope selection state**~~ (2026-07-17) — an MDI
  worksheet document window's row selection now lives in its own entry in the
  new `store/worksheetSelection.ts` slice (`worksheetSelections`, keyed by
  window id), fully independent of every other worksheet window — including
  another document window on the SAME dataset (root cause: the legacy actions
  keyed off `activeId`, not the worksheet's own dataset, so a background
  window's clicks silently wrote into whatever was active). The Stage
  "Worksheet" tab keeps the legacy active-dataset `selection` singleton — the
  ONE deliberate link to the live plot's brush-select/highlight — now surfaced
  explicitly via a "⧟ Linked to plot" badge (`WorksheetToolbar`) instead of
  silently; a document window is NEVER linked. The column context menu's
  "Set as X axis"/"Plot as Y" now claim the focused plot for the worksheet's
  own dataset first (`claimForPlotIntent`, shared with "Plot selection") so
  they can no longer silently retarget an unrelated active plot, and read as
  gated-null (no stale checkmark) while unlinked. `windows.ts`'s `closeWindow`
  drops the closed window's selection entry (no leak); a document-window
  rebind leaves the old entry pointing at the old dataset, self-healing via
  the same "live only if datasetId matches" guard the legacy singleton always
  used. No new allowlist entries — `excludeSelectedRows`/`keepOnlySelectedRows`
  (the only actions touching `Dataset.excludedRows`) stayed in `useApp.ts`,
  widened with an optional `windowId`. "Active cell"/"range" don't exist as
  separate dimensions today — nothing to scope. Frontend 3457 green;
  `useApp.ts` 3236/3240, `windows.ts` 750/750 (both at their ratchet pins).

- ~~**#10 Floating workshops recoverable**~~ (2026-07-17) — `ToolWindow`
  (`components/overlays/ToolWindow.tsx`) now clamps the ENTIRE title bar
  (not just the top-left corner) inside the viewport, both on drag end and
  on every `window resize` (the monitor-unplug loss scenario); a View-menu
  `Reset window positions` command (`commands/uiCommands.ts`) restores every
  ToolWindow to its default layout in one shot. Geometry (position/size/
  collapsed) moved out of local `useState` into a new `store/toolwindows.ts`
  slice keyed by each window's `id` prop (threaded through all 24 consumers
  + `ResultsWindow`), so a window survives close/reopen and round-trips
  through the `.dwk` workspace (`lib/workspace.ts`'s `toolWindowLayout`
  field, additive-optional — legacy files load unchanged — and
  viewport-clamped on load). Added collapse (double-click the title bar or
  its chevron button) and corner-drag resize (`.qzk-win-resize`), both
  persisted alongside position. Docking into the right panel deferred per
  the plan. Frontend 3483 tests green; `store/useApp.ts` 3231/3240.

- ~~**#6 Pipeline fit execution reproduces the interactive fit**~~ (2026-07-16,
  Opus worktree agent, merged `7d49fd9`) — recorded "fit" steps now carry the
  typed recipe via `lib/fitselection.fitStepParams`/`fitSpecFromStepParams`
  (model + xKey/yKey + non-`none` weight; the result snapshot is never encoded
  — a step is a recipe, not a result), and `executeSteps` replays it through
  the SAME `fitDataForSpec` path the recalc graph uses: target's analysis rows
  (exclusion∪filter) honored, unresolvable weight column fits unweighted with
  the `dyForFit` issue surfaced in the step log note (folder batches see it).
  Legacy `{model}`-only template steps deliberately keep the old
  `time`/`values[0]` unweighted behavior so saved templates' outputs never
  silently change (regression-pinned). Scope check: the interactive registry
  fit sends only model/x/y/dy — no ROI (quickfit ROI is preview-only by
  documented decision) and no bounds to thread; custom-equation fits remain
  the separately-booked follow-up. Frontend 3357 green; useApp.ts held at
  3311/3312.

- ~~**#4 Weighted fitting by plotted error columns**~~ (2026-07-12, PR #24
  `dbb0c5c`) — Curve Fit workshop weighting selector (none / Y-error column /
  Poisson / manual); `dy` is the single canonical error→weight convention across
  `/fit`+`/equation/fit`+`/scan` (`weights_from_dy`), recorded in
  `FitSpec.weight` provenance and reproduced by the recalc graph via
  `fitDataForSpec`; shared `lib/fitweights.dyForFit` builds `dy` over the #50/#53
  analysis rows. Registry-model path; custom-equation + pipeline + X-error (ODR)
  are booked follow-ups (#6 covers pipeline). Backend 262 + frontend 3294 green.

---

## Reference

### Universal interaction spec (adopt + enforce across all features)
| Gesture | Universal meaning |
|---|---|
| Single click | Select / activate the object |
| Ctrl/Shift-click | Extend / range-select where valid |
| Double-click | Open the object's primary Properties editor |
| Right-click | Select the target, then open its contextual actions |
| Drag selected object | Move it; show destination/coords; one Undo step |
| Drag handle | Reorder / reparent; show the exact result before drop |
| Delete | Delete the selected editable object, with Undo |
| Enter | Edit / confirm the selected object |
| Escape | Cancel the gesture/dialog/tool, restore prior state |
| Ctrl+Z / Ctrl+Shift+Z | Undo/redo the last committed data/visual/org edit |

Every action must also have a non-mouse path (Properties, menu, or Command
Palette). NOTE the double-click conflict: today double-click-empty = autoscale
(uPlot-native) and double-click-text = edit; reconcile with "double-click =
Properties" before adopting the table literally.

### "Great app" acceptance test (the empirical re-prioritizer)
From a clean install, no dev tools: import a real month of files by drag/drop →
organize into a project tree → clean/filter/mask/fit/compare with no code →
build a multi-panel publication figure (error bars, fitted curves, annotations,
precise formatting) → save/close/reopen/alter/undo/re-export without losing
intent → complete it using only visible UI + Help. Keep a **friction log**: every
guessed glyph, recalled hidden gesture, repeated accidental action, or
Origin-reopen becomes a concrete issue that re-ranks this plan.
