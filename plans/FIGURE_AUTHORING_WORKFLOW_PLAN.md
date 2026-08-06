# Figure Authoring Workflow Plan

**Status:** Active
**Parent:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md`
**Created:** 2026-08-01
**Updated:** 2026-08-05 — F3.1 PageDocument persistence + F2.4b direct-manipulation parity
**Audit author:** ChatGPT-Sol (not Claude)
**Audited baseline:** Quantized 0.14.0, commit `6b8b891` on `main`
**Repository:** `C:\Users\patri\git\quantized`

> This plan came from a ChatGPT-Sol audit, not a Claude audit. Preserve that
> attribution in later summaries and completion logs so independently produced
> findings are not confused.

> The former OneDrive checkout is gone. Do not use or recreate
> `C:\Users\patri\OneDrive\Coding\git\quantized`; synchronization caused merge
> conflicts.

## Purpose

Make figure creation one coherent, mouse-first workflow from imported data to
an editable internal figure, a saved/reopened figure, a multi-panel page, and
Office/publication output. The target is the owner's OriginPro expectation:
build quickly, tweak without code, save without losing state, and copy a
production-ready figure in seconds.

This plan is narrower than the parent readiness audit. It owns the figure
document contract and the transitions among Stage, Graph Builder, Figure
Builder, saved figures, Figure Page, clipboard, and export. It does not own
general import inference (archived `PLOT_WORKFLOW_PLAN.md`), scientific
analysis engines, or unrelated desktop lifecycle work.

## Executive verdict

The owner's concern is correct: **Figure Builder is currently a publication
and export preview, not the primary internal plot editor.** The Stage plot
window is the richer editable object, but the product does not present it as a
durable figure document. Passing a plot through Graph Builder, Figure Builder,
saved figures, or Figure Page can create detached state or lose supported plot
features.

This is the highest-leverage remaining plotting-workflow gap. Adding isolated
controls to Figure Builder before unifying the document contract would deepen
the duplication.

## Audited workflow and evidence

| Surface/model | Actual role today | Persistence | Audited gap |
|---|---|---|---|
| Stage `PlotWindow` / `PlotView` | Rich internal interactive plot editor | `.dwk` | Not identified or managed as the canonical figure document |
| Graph Builder / `PlotSpec` | Data-role mapping and reusable construction recipe | Saved specs in `.dwk` | Sending is not a live link; create-vs-replace intent is unclear |
| Figure Builder / `FigureDoc` | Publication preview and export settings | Live/frozen docs in `.dwk` | Detached reduced model; no apply-back; limited save lifecycle |
| Saved Figures | Publication configurations | `.dwk` | Reopening as an editable graph is intentionally lossy |
| Figure Page | Multi-panel export compositor | Local component state | Page cannot be saved/reopened as an editable document |
| `FigureSpec` | Backend render/export payload | None | One-way transport object, not an authoring document |

### What already works — preserve it

- [x] Import-to-first-plot defaults and batch plotting exist.
- [x] Stage supports mouse-first axes, series, legend, annotation, and shape
      editing.
- [x] `PlotView` persists a broad interactive state surface.
- [x] Direct Stage copy/export uses the mature `buildFigureSpec` adapter.
- [x] Figure Builder supplies publication dimensions, DPI, margins, fonts,
      legend placement, annotations, preview, and export.
- [x] Graph Builder saves PlotSpecs and maps X/Y/Group/Facet roles.
- [x] Figure Page composes exportable grids from windows and saved figures.

Do not rebuild these features. Reuse their contracts and controls while making
the transitions lossless and discoverable.

### Confirmed workflow defects

1. `PlotView` carries more state than `FigureConfig`/`FigureDoc`, including
   secondary axes, error roles, series order/visibility, richer formatting,
   shapes, and waterfall/page state.
2. Figure Builder copies Stage state into local React state and does not edit
   or apply changes to the Stage plot.
3. Saving in Figure Builder creates a new FigureDoc instead of providing a
   normal named-document lifecycle with update, Save As, and dirty state.
4. Opening a saved FigureDoc as a graph window applies only channels, scales,
   title, and axis labels; styles and other state are not inverted.
5. Graph Builder's “Send to Stage” can rebind the focused plot without a clear
   Create New versus Apply to Current decision.
6. Some group-split behavior remains preview-only, and unsupported constructs
   fail closed when converted to Figure Builder.
7. Figure Page is ephemeral and its panel adapters omit parts of the source
   plot state, so composed output can differ from the interactive plot.
8. Direct Stage export can preserve more state than the apparently more
   advanced Figure Builder path.
9. The archived `PLOT_WORKFLOW_PLAN.md` completed initial import-to-plot
   behavior, not this full figure-authoring round trip.

### Audit verification

- [x] Static contract inspection completed across Stage, Graph Builder, Figure
      Builder, Figure Page, saved figures, and export adapters.
- [x] Targeted frontend tests passed: **101 tests** covering the relevant
      hooks, conversions, saved figures, and export specs.
- [ ] Perform a visible, timed desktop usability session. The in-app browser
      control runtime was unavailable during this audit, so static evidence
      and tests could not establish appearance, discoverability, or timing.

## Product contract

The user should be able to think:

> This window is my figure. Graph Builder creates or remaps it, properties edit
> it, publication preview shows the same document at output size, Figure Page
> arranges it, and save/reopen/copy/export never silently reduce it.

The implementation must maintain these distinctions:

- **Plot recipe:** semantic rules for turning compatible data into a plot.
- **Style template:** reusable visual defaults, applied explicitly.
- **Figure document:** one specific, editable plot with data bindings and full
  visual state.
- **Page document:** one specific, editable multi-panel composition referencing
  figure documents.
- **FigureSpec:** generated render/export transport only.

`PlotView` is the recommended starting point for the canonical FigureDocument
because it already owns the richest persisted interactive state. Do not make
the smaller `FigureConfig` canonical merely because Figure Builder currently
uses it.

## Implementation campaign

### F0 — Make current transitions honest and safe

**Goal:** Remove ambiguity and prevent silent state loss before changing the
underlying architecture.

**Recommended models:** GPT-5.6 Terra medium / Claude Sonnet 5. Escalate only if
the compatibility inventory exposes an unexpected state-ownership problem.

- [x] **F0.1 Clarify Figure Builder's role.** Rename user-facing entry points
      to “Publication Preview” or “Publication Setup” until the surface edits
      the canonical document. Add a short, non-distracting explanation that
      changes are local until applied/saved.
- [x] **F0.2 Make Graph Builder intent explicit.** Replace ambiguous “Send to
      Stage” behavior with “Create New Plot” and “Apply to Current Plot.”
      Default to Create New; require a compatible focused plot to apply.
- [x] **F0.3 Add compatibility reporting.** Before Graph Builder → publication
      preview, saved FigureDoc → graph, or any partial adapter, show which
      features cannot transfer. Do not silently drop secondary axes, errors,
      grouping/facets, annotations, shapes, formats, or series styles.
- [x] **F0.4 Separate Library terminology.** Distinguish Saved Plot Recipes,
      Saved Figures, and multi-panel pages. Tooltips should state whether an
      item reuses data rules, preserves an editable result, or stores output.
- [x] **F0.5 Add transition regression tests.** Pin user-facing labels,
      create/apply behavior, warnings, keyboard paths, and fail-closed rules.

**F0 exit:** A user cannot reasonably mistake a detached publication preview
for the editable internal plot, and no supported state disappears without a
specific warning.

### F1 — Establish one canonical editable FigureDocument

**Goal:** Give every editable plot a stable identity and lossless persistence.

**Recommended models:** GPT-5.6 Sol high / Claude Opus 4.8 for schema and
migration design; GPT-5.6 Terra high / Claude Sonnet 5 for bounded UI slices.

- [x] **F1.1 Inventory and freeze the contract.** Produce a typed mapping table
      for every field in `PlotView`, `PlotSpec`, `FigureConfig`, `FigureDoc`,
      and `FigureSpec`; classify canonical, recipe-only, export-only, derived,
      or unsupported fields.
- [x] **F1.2 Define a versioned FigureDocument.** Include stable ID/name,
      dataset bindings, plot type, channels/errors/groups/facets, axes and
      breaks, series state, legend, annotations/shapes, page/output settings,
      and migration behavior.
- [x] **F1.3 Adapt existing plot windows.** A Stage/window plot should open and
      edit the FigureDocument rather than maintain a parallel authoritative
      copy. Preserve current interaction performance and view-history behavior.
- [x] **F1.4 Add document lifecycle.** Implement Save, Save As, dirty state,
      close confirmation, update-in-place, duplicate, rename, and delete using
      normal workspace undo/recovery conventions.
- [x] **F1.5 Make conversions reversible.** Provide one tested path among
      FigureDocument, interactive PlotView, and export FigureSpec. Where exact
      reversal is impossible, keep the original canonical field and derive the
      transport representation without deleting information.
- [x] **F1.6 Migrate existing workspaces.** Load old PlotViews/FigureDocs
      deterministically, preserve frozen figures, and record migration tests.

**F1 exit:** Figure → save → close → reopen produces an equivalent editable
figure, including error bars, y2, styles, formats, legend, and annotations.

### F2 — Turn publication preview into an editor of the same document

**Goal:** Publication sizing and precise properties operate on the live figure
instead of a reduced shadow model.

**Recommended models:** GPT-5.6 Terra high / Claude Sonnet 5 after F1's schema
decisions are merged.

- [ ] **F2.1 Bind the preview to FigureDocument.** Display document name and
      dirty state; stop creating a detached source of truth.
  - [x] **F2.1a Model/adapters.** FigureDocument v2 retains lossless
        publication-only overrides and exact export styles; v1 migrates without
        publication state. UI binding and Apply/Cancel remain open.
  - [x] **F2.1b Focused canonical session.** File ▸ Publication Preview opens
        a transient FigureDocument draft from the focused window; legacy and
        Graph Builder entry points remain compatibility paths pending bridging.
  - [x] **F2.1c Explicit legacy promotion (planned PR #114).** A saved legacy
        Publication Figure can create a separately named canonical editable
        copy without rewriting or auto-migrating the source.
  - [x] **F2.1d Graph Builder detached canonical preview (planned PR #115).**
        Graph Builder now opens a fresh detached FigureDocument transaction,
        never an ephemeral legacy FigureDoc seed.
- [ ] **F2.2 Add Apply/Cancel semantics.** Preview changes live; Apply commits
      one undoable edit and Cancel restores the pre-dialog document.
  - [x] **F2.2a Focused-window transaction.** Apply replaces one verified
        focused window document and Cancel is mutation-free; broader entry
        points and parity remain open.
  - [x] **F2.2b Promotion transaction (planned PR #114).** Creating an
        editable legacy copy is one undoable mutation; invalid sources fail
        visibly without opening a fallback dataset/window.
  - [x] **F2.2c Detached-create transaction (planned PR #115).** Applying a
        Graph Builder preview creates one undoable editable figure, including
        an unchanged draft; Cancel remains mutation-free.
- [ ] **F2.3 Reach full property parity.** Expose or link to plot type,
      channels, series, errors, y2, grouping/faceting, ordering/visibility,
      tick formats, breaks, shapes, and reference objects.
  - [x] **F2.3a Publication-property parity slice (planned PR #112).**
        Canonical preview now exposes supported y2 limits, legend title,
        in-place annotation/frame properties, and validated x-axis breaks.
  - [x] **F2.3b Series property parity (Claude Sonnet 5).** Canonical draft
        now exposes per-series color/width/mode (line/scatter/line+symbol/
        step, reusing the shipped mark vocabulary), visibility, and display
        order, plus read-only error-bar designation text. No schema change:
        these already lived on `document.plot.view`.
- [ ] **F2.4 Preserve direct manipulation.** Drag legend/annotations and
      double-click text on the live document, with matching property panels.
  - [x] **F2.4a Preview element context menu.** Hitmapped text, legend, and
        annotations expose their existing property panel; text also exposes
        the existing inline editor. Series remain visibly Stage-owned.
  - [x] **F2.4b Canonical direct-manipulation parity (Claude Sonnet 5).**
        Gap analysis found every EXISTING gesture already worked and wrote
        to the draft correctly (established by two prior commits, not this
        slice); the real gap was zero Apply/Cancel round-trip test coverage
        and zero xlabel/ylabel coverage. Closed both with tests; no
        production code changed. F2.4 stays open only for gesture types
        F2.3's still-missing shape/reference-object panels would need to
        exist first (nothing to attach a drag to yet) — see the decision
        log for the full matrix.
- [ ] **F2.5 Unify render paths.** Stage copy, Stage export, publication
      preview, saved preview, and reopen must derive from the same document and
      produce equivalent output.
  - [x] **F2.5a Canonical preview readiness errors (planned PR #113).**
        Publication Preview distinguishes unavailable document sources from
        invalid render specifications and fails visibly without a fallback.

**F2 exit:** Opening publication preview can no longer reduce a figure, and
every edit remains available in the internal plot after the dialog closes.

### F3 — Make multi-panel figures durable

**Goal:** A composed page is an editable project artifact, not a temporary
export session.

**Recommended models:** GPT-5.6 Sol high / Claude Opus 4.8 for PageDocument
ownership; Terra high / Sonnet 5 for panel-editor slices.

- [x] **F3.1 Define and persist PageDocument.** Store ID/name, page geometry,
      grid/free placement, panel references, panel labels, links, gaps,
      alignment, and output settings in `.dwk`.
- [ ] **F3.2 Reference FigureDocument IDs.** Do not flatten panels into lossy
      reduced configs. Define missing-source and frozen-snapshot behavior.
- [ ] **F3.3 Support save/reopen/edit.** Add Save, Save As, dirty state, recent
      access, duplicate, rename, and delete.
- [ ] **F3.4 Unify panel editing.** Double-click or context-menu a panel to edit
      the referenced figure; provide explicit unlink/duplicate-for-page actions.
- [ ] **F3.5 Complete layout controls.** Preserve manual rearrangement,
      adjustable spacing, shared/independent axes, link/unlink, alignment, and
      recommended resize modes.
- [ ] **F3.6 Export from PageDocument.** Clipboard and file export must consume
      the same reopened page model used by the internal preview.

**F3 exit:** Page → save → close → reopen → edit → copy/export retains every
panel, relationship, and visual setting.

### F4 — Recipes and templates on top of the document contract

**Goal:** Reuse semantic and visual decisions without overwriting customized
figures.

**Recommended models:** GPT-5.6 Terra high / Claude Sonnet 5. This coordinates
with parent items P1.3 and P1.5.

- [ ] **F4.1 Keep PlotSpec recipe semantics explicit.** A recipe creates or
      deliberately remaps a figure; it is not itself a saved figure.
- [ ] **F4.2 Add complete technique-scoped recipes.** Store plot type, roles,
      errors, groups/facets, transformations, axes, and style-template choice.
  - [x] **F4.2a Plot-type + error designations (Claude, 2026-08-02).** The
        recipe now stores a step mark (pre/post/mid), a Line+Symbol markers
        toggle, and position-paired Y/X error wells with Origin-style
        unambiguous-only prefill; committed marks finally translate into
        Stage series styles (previously silently dropped), and error
        designations flow through commit, preview whiskers, publication
        handoff, and export. Transformations/style-template choice remain
        open. A direct "Plot in new window" action (Library + palette)
        closed the one-plot-per-dataset misconception.
- [ ] **F4.3 Apply templates explicitly.** Never overwrite an already
      customized figure without a preview and confirmation.
- [ ] **F4.4 Complete live grouping/faceting parity.** Grouped/faceted results
      must remain editable on Stage and survive save/reopen/export.

**F4 exit:** The owner can manually save an XRD-specific recipe/template,
choose it for later XRD data, and leave SIMS or customized plots untouched.

## Required acceptance journeys

Check these only with automated coverage plus an owner-visible desktop run.

- [ ] **A1 Arbitrary data:** Drop/import data, confirm inferred roles, and
      reach a production-quality editable plot without code.
- [ ] **A2 Mouse editing:** Change line/scatter mode, colors, widths, errors,
      scales, limits, legend, and labels through direct manipulation/properties.
- [ ] **A3 Lossless figure:** Save, close, reopen, and compare the complete
      document/spec for equality.
- [ ] **A4 Complex 1-D:** Repeat A3 with y2, asymmetric errors, hidden/reordered
      series, custom formats, annotations, shapes, and waterfall offset.
- [ ] **A5 Group/facet:** Build with Group/Facet, edit on Stage, save/reopen,
      and export with the same series and labels.
- [ ] **A6 Multi-panel:** Build a 2×2 page, link then unlink axes, rearrange,
      save/reopen, edit one panel, and preserve layout.
- [ ] **A7 Office clipboard:** Copy a 300-DPI image into PowerPoint and Word in
      seconds and visually compare it with the internal figure.
- [ ] **A8 Vector export:** Export SVG/PDF and compare limits, ticks, text,
      legend, errors, annotations, and panel placement.
- [ ] **A9 Time targets:** First unfamiliar dataset to acceptable figure in at
      most 20 minutes; routine figure in at most 2 minutes; copy/paste in
      seconds.
- [ ] **A10 Platforms:** Complete the core journey on Windows and macOS;
      Ubuntu is bonus coverage if inexpensive.

## Recommended PR sequence

Keep each slice independently reviewable and update this document in the same
PR that changes its status.

1. **PR 1 — F0 terminology and role cues:** rename user-facing Figure Builder
   entry points, add the local-change explanation, and update tests/help.
2. **PR 2 — F0 create versus apply:** explicit Graph Builder actions with
   focused-plot compatibility tests.
3. **PR 3 — F0 compatibility report:** central loss inventory and warnings at
   every partial transition.
4. **PR 4 — F1 contract census/design:** typed mapping, schema decision, and
   serialization/round-trip characterization tests before migration.
5. **PR 5+ — F1 vertical migrations:** identity/lifecycle, PlotWindow binding,
   adapters, and old-workspace migration as separate stacked PRs.
6. Continue F2, F3, then F4 only after the canonical contract is green.

## Agent handoff checklist

Before starting a slice:

- [ ] Rebase on current `main`; Claude and ChatGPT may be working concurrently.
- [ ] Read this plan, the linked parent tasks, and current code before trusting
      checkbox or backlog summaries.
- [ ] Confirm the change does not reinterpret Origin parser/binding semantics.
- [ ] Identify the canonical owner of every state field touched.
- [ ] Add characterization tests before changing a lossy adapter.
- [ ] Exercise keyboard and mouse paths for new controls.
- [ ] Run targeted tests, full frontend tests when shared contracts change,
      TypeScript build, and applicable backend tests.
- [ ] Update the dated log and checked items with commit/PR evidence.

## Revisit after owner use

- [ ] Reassess names (“Publication Preview” versus “Figure Builder”) after F2;
      the original name may become accurate once the surface edits the canonical
      document.
- [ ] Reassess whether Stage and publication preview should remain separate
      windows or become modes/dockable views of one editor.
- [ ] Reassess organization and search after real projects accumulate; keep
      figure search low priority until the Library hierarchy is exercised.
- [ ] Reassess automatic template suggestions only after manual templates are
      trusted and non-destructive.

## Completed / decision log

### 2026-08-05 — F2.4b direct-manipulation parity on the canonical draft (Claude Sonnet 5)

- Gap-analysis matrix for the three EXISTING `PreviewOverlay` gestures in
  CANONICAL mode, each traced through `useFigureBuilder.ts` to its write
  target and confirmed by a passing test:

  | Gesture | Before this slice | Write target |
  |---|---|---|
  | Legend drag | (a) already worked | `document.publication.overrides.legend` via the F2.3a `effectiveFigureOverrides`/`publicationOverridesDelta` bridge (commit 4e74bc4) |
  | Annotation drag | (a) already worked | `document.publication.overrides.annotations[i]`, same bridge |
  | Double-click title | (a) already worked | `document.plot.view.plotTitle` via `setCanonicalView` |
  | Double-click xlabel | (a) already worked, but ZERO test coverage anywhere | `document.plot.view.xAxisLabel` |
  | Double-click ylabel | (a) already worked, but ZERO test coverage anywhere | `document.plot.view.yAxisLabel` |
  | Double-click annotation text | (b) does nothing — in BOTH legacy and canonical alike (`TEXT_ELEMENTS` never included `ann:*`; annotation text is Properties-panel-only) — not a canonical/legacy disparity, out of scope | n/a |

  The canonical branches in `dragElement`/`editElementText` date to the
  original canonical-session commit (`a6c809c`) and were already routed
  through the correct view/publication-overrides bridge by the F2.3a
  bugfix (`4e74bc4`, "route canonical preview edits through the rendered
  overrides merge") — both landed before this slice. No gesture silently
  no-oped or wrote to the wrong place.
- What was actually missing, and what this slice closed: (1) `editElementText`
  had never been exercised for `"xlabel"`/`"ylabel"` in canonical mode at
  all (only `"title"`); (2) no test proved the full contract — gesture on
  the canonical draft → Apply → the WINDOW document (and legacy top-level
  facade) reflects it; Cancel → no persistent mutation — the pattern F2.3b
  established for series properties but never applied to drag/text-edit.
  Added both, plus legacy (non-canonical) characterization tests pinning
  `dragElement`/`editElementText`'s unchanged plain-state behavior, all in
  `useFigureBuilder.test.ts`. Zero production code changed.
- Confirmed (documented, not "fixed"): the legend/annotation drag position
  lands in `document.publication.overrides`, not `document.plot.view` —
  so after Apply, the Stage's OWN interactive legend/annotation position is
  unchanged; only the editable figure's publication-preview/export
  rendering picks it up. This is the SAME architecture F2.3a's property
  panels already use (`FigurePublicationState`: "exact publication-only
  settings that PlotView cannot represent") and is consistent between
  legacy and canonical — matplotlib's figure-fraction legend anchor and
  the Stage canvas's own plot-fraction `legendXY` are different coordinate
  systems with no converter in this codebase. Not a parity gap; verified
  and left alone.
- Incidental finding, not fixed (pre-existing, legacy-only, unreachable
  from the real UI): legacy (non-canonical) `dragElement` writes through a
  plain, non-functional `useState` setter, so two drags dispatched in the
  same synchronous batch lose the first — real pointer gestures always
  arrive as separate event-handler commits, so this never fires from
  actual mouse/keyboard use; canonical mode is immune (Zustand's
  functional `set()` doesn't share this trait). Left as a documented
  observation rather than an in-scope fix.
- F2.4 stays open: new gesture types (e.g. shape/reference-object drag)
  remain deferred, and nothing exists yet to attach them to until F2.3
  reaches shapes/reference objects.

### 2026-08-05 — F3.1 versioned PageDocument with workspace persistence (Claude Sonnet 5)

- New pure module `lib/pageDocument.ts`: a versioned `PageDocument` (schema/
  version, id/name, rows/cols grid geometry, `panels: PagePanel[]`, output
  settings — format/stylePreset/dpi/labelFormat/labelPos). Panels reference
  an `editableFigures` (F1) entry BY ID ONLY (`figureId: string | null`) —
  never a flattened copy of its config; a panel's live/frozen behavior is
  inherited entirely from whichever FigureDocument it references, since F1
  already solved "detached panels" at that layer. `resolvePagePanel` is the
  fail-closed resolver: a `figureId` that no longer matches any
  `editableFigures` entry reports `{status:"missing"}`, never silently
  collapsed to `{status:"empty"}` or dropped from the page.
- `lib/workspace.ts` persists `pages: PageDocument[]` through `.dwk`
  (serialize/parse + a `sanitizePageDocuments` migration: an absent field
  loads as `[]`, no crash; malformed entries drop; a future schema version
  is skipped, never silently coerced — same discipline as `editableFigures`).
  New `store/pageDocuments.ts` slice (`pages` on `AppState`, empty by
  default) wired into `loadWorkspace`, `store/history.ts`'s undo/redo
  snapshot, and `useWorkspaceAutosave.ts`'s trigger field list, so pages
  survive save/reopen, undo/redo, and autosave the same way `editableFigures`
  does. `useApp.ts` was at its exact 2868-line pin (zero headroom); paid for
  the new wiring by extracting `appendWorkspace`'s body to
  `store/workspaceIO.ts` (`runAppendWorkspace`, mirroring the existing
  `runSaveWorkspaceToFile`), landing at 2860 — net PIN COMPLIANT, not raised.
- The ephemeral Figure Page workshop (`useFigurePage.ts`) now holds its grid
  geometry + output settings as one `PageDocument` draft (`useState<PageDocument>`)
  instead of seven parallel useStates, and exposes the full resolved
  projection as `pageDocument`: each slot's session source (open window /
  legacy FigureDoc) resolves to a canonical `figureId` ONLY when that
  window's document has actually been saved into `editableFigures` — an
  open-but-unsaved window or a legacy FigureDoc resolves to `null` rather
  than a lossy flattened copy (F3.2's "reference, don't flatten", applied at
  the session boundary too). The interactive assignment model itself (open
  windows + legacy FigureDocs as pickable sources, drag/click onto slots)
  is UNCHANGED — replacing it with "canonical figures only" would drop a
  currently-working capability and is deliberately left to F3.4 (unify panel
  editing) once a save/promote path exists for an in-session figure.
- **F3.1a (honest partial, left for later slices):** the plan's F3.1 text
  also lists "free placement" and "links, gaps, alignment" — none of those
  are modeled here. Grid-only placement matches every other implementation
  in the product today (no free-placement compositor exists anywhere to
  port); links/gaps/alignment are F3.5's own deliverable ("Complete layout
  controls") and adding placeholder fields now would only need revising once
  that item defines their real shape. F3.2 (broader missing-source/frozen-
  snapshot UI surfacing), F3.3 (Save/Save As/dirty-state/library UI), F3.4
  (double-click/unlink panel editing), F3.5 (layout controls), and F3.6
  (export from PageDocument) remain fully open — this slice is schema +
  persistence plumbing only, with nothing yet writing into the store's
  `pages` collection.
- New tests: `lib/pageDocument.test.ts` (15, create/sanitize/migrate/resolve/
  round-trip), `lib/workspace.test.ts` (+4, persistence/migration/dangling-
  reference), `useFigurePage.test.ts` (+4, draft tracking + figureId
  resolution). Full frontend gate green (see commit).

### 2026-08-05 — F2.3b series property parity in Publication Preview (Claude Sonnet 5)

- Added canonical-draft controls for per-series properties: color, line
  width, and mode (line / scatter / line + symbol / step — reusing the
  `StepMode`/marker/width vocabulary `feat(plot)` commits 954c8bf and
  163864b shipped, not a parallel enum), visibility (hidden/shown), and
  display order. All write straight through `setCanonicalView` into
  `document.plot.view.{seriesStyles,hiddenChannels,seriesOrder}` — the
  same mechanism F2.3a's title/label edits already use — because, unlike
  legend/annotations/breaks, these fields have no `FigureOverrides`
  equivalent to bridge through. No schema, backend, or shape changes were
  needed: `FigureViewState` already carried them losslessly (F1.2).
- Error-bar DESIGNATIONS (`document.bindings.errors`) are DISPLAY-only in
  this slice: each series row shows its bound error channel(s) read-only,
  and a shared line above the list shows any x-axis-wide binding.
  Reassigning bindings needs the same channel-picker "well" UI Graph
  Builder already owns (`useGraphBuilder.ts`'s Y/X error wells); building
  a second, narrower reassignment surface here would duplicate that
  contract instead of reaching parity with it, so it was left out of
  scope rather than half-built.
- The F2.4a "Series properties — edit on Stage" disabled context-menu
  entry now enables once the canonical draft has a Series group to open
  (`PreviewOverlay`'s new `canonicalSeries` prop, default `false` — every
  other/legacy caller is byte-identical); a plain click on a rendered
  series hitbox also now focuses the new Series group, the same way
  clicking the legend or an annotation already does.
- New pure module `canonicalSeries.ts` (mode derivation/patch, error-text
  summaries) and view component `SeriesPropertiesPanel.tsx`, both unit
  tested standalone; `useFigureBuilder.ts` gained the setters/derived
  state (canonical-only — empty/no-op in legacy mode). Pinned: draft edit
  → Apply → the window document and legacy top-level facade both reflect
  it; Cancel → no persistent mutation; full JSON serialize/deserialize
  round-trips `seriesStyles`/`seriesLabels`/`seriesOrder`/`hiddenChannels`.
- F2.3 remains open: channels/errors reassignment, grouping/faceting,
  tick formats, shapes, and reference objects are still unreached by the
  canonical preview.

### 2026-08-02 — F2.4a Publication Preview element context menu (ChatGPT-Sol / GPT-5.6 Terra)

- Hitmapped Publication Preview elements now open the shared keyboard-accessible
  context menu on right-click. Text, legend, and annotations route Properties
  through the same existing panel-selection path as a click; text additionally
  reuses the inline editor.
- Series deliberately remain Stage-owned and expose a disabled explanatory
  entry instead of a no-op property action. Existing click, double-click, and
  legend/annotation drag behavior is unchanged.
- F2.4 remains open: Stage/preview direct-manipulation parity is broader than
  this bounded menu slice.

### 2026-08-02 — F2.1d/F2.2c Graph Builder detached canonical preview (planned PR #115)

- Graph Builder's characterized PlotSpec-to-legacy-FigureDoc bridge now ends
  immediately at the tested FigureDocument adapter and a detached canonical
  Publication Preview transaction; it no longer writes `figureDocSeed`.
- The detached draft receives a fresh identity, derives preview/export solely
  from its canonical document, and only Apply creates one editable figure and
  one undo entry. Apply never opens a window, while Cancel is mutation-free.
- Both entry paths reject replacing an existing preview; detached sources fail
  visibly when their exact live dataset or frozen snapshot is unavailable.
- F2.1/F2.2 remain open for broader legacy convergence and full preview parity.

### 2026-08-02 — F2.1c/F2.2b explicit legacy-figure promotion (planned PR #114)

- Saved Publication Figures now offer an explicit “Create editable copy” flow.
  It converts only the selected legacy document into a fresh-named canonical
  FigureDocument and leaves the legacy entry byte-for-byte unchanged; no
  workspace-load migration occurs.
- Promotion is one undoable copy action. It does not auto-open a window because
  doing so would add a second history entry; the status directs the user to
  Editable figures. Frozen snapshots promote unbound, while live figures
  require their exact current dataset.
- F2.1/F2.2 remain open until all legacy and Graph Builder paths converge on
  the canonical session and broader editor parity is complete.

### 2026-08-02 — F2.5a canonical preview readiness errors (planned PR #113)

- Canonical Publication Preview now preserves adapter failures as explicit
  readiness states: a missing live/frozen source is distinguished from a
  document whose render specification is incompatible (for example, grouped
  secondary-axis output).
- The preview shows an accessible, specific failure rather than the legacy
  “Select a dataset” prompt, and Export is disabled until the exact canonical
  document can produce a valid specification. Apply and Cancel remain available
  for the draft transaction.
- F2.5 remains open: this does not yet unify every Stage, saved-preview, and
  reopen render path.

### 2026-08-02 — F2.3a publication-property parity slice (planned PR #112)

- Added canonical-draft controls for existing render overrides only: y2 limits,
  legend title, editable annotation text/coordinates/font/anchor/frame, and
  finite non-overlapping x-axis breaks. No backend, schema, or shape changes
  were needed.
- Numeric controls now synchronize a replaced canonical draft without clobbering
  unfinished valid typing; required annotation coordinates restore their last
  committed finite value on blur.
- F2.3 remains open: this focused publication slice does not yet bridge the
  remaining Stage properties, channels, series, errors, ordering, shapes, or
  reference objects.

### 2026-08-02 — F2.1b/F2.2a canonical Publication Preview session (PR #111)

- File ▸ Publication Preview now opens a clone-isolated FigureDocument draft
  for the focused plot window. Canonical preview and export derive directly
  from that draft; legacy FigureDoc and Graph Builder seeds remain unchanged
  compatibility paths until their explicit bridge slice.
- Apply verifies the focused window still folds to the session baseline before
  making exactly one undoable document replacement and hydrating the focused
  facade. Cancel and window close discard the session without persistent or
  history mutation; concurrent Stage changes reject Apply rather than being
  overwritten.
- This covers the focused-window transaction only. F2.1/F2.2 stay open until
  every entry point shares the session and publication controls reach parity.

### 2026-08-02 — F2.1a FigureDocument publication-state model (PR #110)

- Bumped the canonical FigureDocument schema to v2 before adding persisted
  publication state: older builds must reject, rather than silently strip,
  fields they do not understand. v1 documents deterministically migrate to v2
  with publication absent.
- Added a safe, clone-isolated publication payload for raw FigureOverrides and
  exact legacy export styles, plus a pure legacy FigureDoc-to-FigureDocument
  adapter. This is an explicit opening boundary, not an automatic rewrite of
  saved Publication Preview entries.
- Rendering now layers explicit publication overrides over canonical view
  derivation without replacing partial nested groups; explicit null styles
  omit the wire field. F2.1/F2.2 remain open until the preview UI owns one
  canonical draft with Apply/Cancel.

### 2026-08-02 — F1.6 deterministic and isolated migration (ChatGPT-Sol; bounded implementation delegated to GPT-5.6 Terra)

- Legacy PlotView-only windows still promote deterministically into canonical
  FigureDocuments. A future-version window document now degrades only that
  window to its sanitized PlotView projection instead of aborting the whole
  workspace; valid siblings continue loading.
- Future-version saved editable figures are isolated per entry. They are not
  rewritten as v1; the load status names the first skipped/degraded item and
  summarizes additional warnings so the user knows not to overwrite the
  original file with an older Quantized version.
- Frozen JSON snapshots normalize `null` cells produced by serialization of
  NaN or infinities back to missing-data `NaN`, while invalid nonnumeric cells
  still fail closed and snapshots remain mutation-isolated.
- Legacy Publication Preview FigureDocs, including frozen snapshots, remain
  unchanged and separate. Automatic promotion is deferred to F2 because their
  preview-only overrides do not yet have lossless FigureDocument fields.
- Migration warnings are transient and never written into `.dwk`. Mixed-schema,
  frozen-data, legacy-figure, warning visibility, and deterministic promotion
  paths have regression coverage. This slice is stacked on PR #108.

### 2026-08-02 — F1.5 reversible document/export conversion (ChatGPT-Sol; bounded implementation delegated to GPT-5.6 Terra)

- Added one shared PlotView/data-to-FigureSpec core. The established live-store
  export remains byte/deep-equal, while a canonical FigureDocument can now
  derive the same transport without a second field-by-field implementation.
- The document adapter uses canonical rich error roles, grouping, X breaks,
  secondary-axis settings, series state, legend/decor, page geometry, and
  saved output defaults. Live documents require the exact bound dataset;
  frozen documents render from a cloned snapshot.
- Preserved information that FigureSpec cannot represent (`mark`, `facetKey`,
  and Y/Y2 breaks) in the FigureDocument instead of deleting or pretending to
  serialize it. Grouping plus secondary Y fails early with an actionable error
  because the current backend rejects that combination.
- Characterization tests cover the document → PlotView → document canonical
  round trip, document → FigureSpec projection, frozen/live resolution,
  backend-invalid combinations, and exact parity for the pre-existing export
  path. Implemented in stacked draft PR #108.

### 2026-08-02 — F1 guardrails and bundle-headroom preflight (ChatGPT-Sol; implementation delegated to GPT-5.6 Terra)

- Centralized canonical PlotWindow document replacement and dataset-reference
  pruning in `store/windowDocuments.ts`; an architecture regression guard now
  rejects new direct document writes outside reviewed construction and
  persistence seams.
- Added shrink-only module pins for the previously unguarded oversized
  `lib/workspace.ts` and `lib/plotview.ts`; the latter shrank when dataset
  pruning moved to its canonical owner.
- Lazy-loaded four ordinary, store-flag-driven dialogs only after first use,
  retaining them thereafter so their local state survives close/reopen.
  Measured eager JavaScript fell from about 919.1 kB to 904.1 kB under the
  unchanged 919.2 kB budget, creating about 15.1 kB for the next F1/F2 slices.
- Adversarial follow-up tightened the raw write guard so inferred writes cannot
  evade it and added a non-vacuous stale-facade test proving the canonical
  document wins during dataset pruning.

### 2026-08-01 — Claude adversarial review of the F1 stack (PRs #103–#106)

- Four defects found and FIXED in-stack (two by direct review, two by the
  guards-reviewer sweep), plus two smaller cleanups:
  1. **Stale error-binding resurrection** (`store/windowDocuments.ts`) — a
     `resetErrors` sync with no explicit list (the reimport path) fell
     through `createPlotWindowDocument`'s `?? previous.bindings.errors`
     fallback, resurrecting the old document's bindings whose channel
     indices a shape change had just invalidated, and re-deriving them into
     the freshly-reset view errKeys — instance #5 of the 2026-07-19/21
     index-staleness class, proven by a failing probe before the fix. An
     `errors: null` sentinel now means "derive fresh from the view";
     regression pinned in `windowDocuments.test.ts`.
  2. **Close-confirm over-firing** (`figureLifecycleUi.ts`) — the F1.4
     discard gate keyed on `editableFigureDirty`, which is true for EVERY
     window never saved as a figure, so every routine MDI close popped a
     confirm. Close is undoable (`closeWindow` records history;
     `plotWindows` is history-snapshotted) and windows persist in the
     workspace, so per the GUI #17 confirm-exemption convention the gate
     now keys on `editableFigureHasUnsavedEdits` (a SAVED figure drifted);
     never-saved windows close plainly. The window-arrange e2e reverted to
     the no-confirm journey; both gate branches unit-pinned.
  3. **Duplicate windows shared the source's document identity**
     (`store/windows.ts` duplicateWindow) — `createPlotWindowDocument`
     inherits `previous.id`, so Save on a duplicate overwrote the ORIGINAL
     saved figure and the open-figure lookup was ambiguous. The stack's own
     test asserted the opposite but on a document-less fixture, so it never
     exercised the real path. Fixed with a `freshIdentity` option
     (plant-verified: reverting it fails the now-document-bearing test).
  4. **Autosave never fired on figure-only changes**
     (`useWorkspaceAutosave.ts`) — the trigger's field list omitted
     `editableFigures`, so a figure delete/duplicate alone was lost (or
     resurrected) on restart. Field added to the Pick + comparison.
  5. The new `figure-save`/`figure-save-as` commands shipped without
     `description`/`keywords` (the #78–#81 Help-search class) — added.
  6. Perf: `editableFigureDirty` ran a document rebuild + two stringifies
     inside a per-window Zustand selector on every store notification; the
     common never-saved case now answers from an id lookup alone.
- Follow-ups booked for a later slice, not this stack: an
  `architecture.test.ts` guard for the document-write chokepoint (the
  stack added a new invariant — documents written only through
  `store/windowDocuments.ts` — without adding its guard; B1/B2 above are
  exactly the desync class it would catch), and `MODULE_PINS` entries for
  the unpinned oversize `lib/workspace.ts` (753) and `lib/plotview.ts`
  (997), which grew invisibly to every guard. `useApp.ts` sits at exactly
  its 2868 pin — zero headroom for the next feature. Most urgent: the
  stack's eager store additions took the bundle to **919.1 of 919.2 kB
  (0.1 kB headroom)** — the next eager byte fails the build; F1.5/F2 must
  open with an eager-weight diet (or a deliberate, justified budget bump).
- Booked, not changed: (a) the future-version `throw` in both persistence
  boundaries makes a whole workspace unopenable if ONE entry carries a
  newer schema — when v2 ships, prefer degrading that entry to its
  synchronized view projection; (b) `sanitizeFigureDocument` rejects frozen
  snapshots containing non-finite cells, but NaN→null survives every JSON
  round trip of real instrument data — F1.6's saved-figure migration must
  relax the finite-cell requirement before frozen documents ride it.
- Verified sound: legacy `.dwk` promotion (windows without documents build
  them from their own sanitized view; malformed documents degrade to the
  view projection; duplicate ids re-key), every focus/close/minimize/
  restore/duplicate/rename/save handoff routes through the sync bridge,
  history covers `editableFigures`, and the pinned store modules stayed
  lean via the extracted `windowDefaults`/`windowDocuments` bridges.

### 2026-08-01 — F1.4 editable FigureDocument lifecycle (ChatGPT-Sol, PR #106)

- Added a workspace-persisted **Editable figures** collection distinct from
  legacy **Publication figures**, with Save, Save As, update-in-place, reopen,
  rename, duplicate, and undoable delete actions.
- Added dirty-state feedback to plot-window chrome plus close-without-saving
  confirmation on the title button, right-click menu, command palette, and
  Window menu paths. The sole maximized plot remains operable through commands.
- Reopening focuses an already-open document or creates a document-backed plot
  window without reducing its canonical state to the legacy export model.
- Saved documents round-trip `.dwk`, repair dangling dataset bindings without
  being dropped, reject unsupported future schema versions, and participate in
  normal workspace undo/redo. The Library section is lazy-loaded to preserve
  the startup bundle budget.
- F1.3 is now complete: both live/resting plot windows and workspace restore use
  FigureDocument as the authority, with PlotView retained only as the focused
  compatibility/rendering facade.

### 2026-08-01 — F1.3b FigureDocument workspace migration (ChatGPT-Sol)

- Persisted canonical FigureDocuments through the existing additive `.dwk`
  window payload and made the document authoritative during restore.
- Added deterministic promotion for older PlotView-only windows, including
  stable document IDs and legacy symmetric error bindings.
- Added safe missing-dataset handling and duplicate-ID repair without dropping
  an editable plot. Unknown future FigureDocument versions fail closed so an
  older Quantized build cannot overwrite newer figure state.
- Full legacy FigureDoc/frozen-publication migration remains under F1.6; this
  slice covers editable PlotWindow persistence only.

### 2026-08-01 — F1.3a document-backed plot windows (ChatGPT-Sol)

- Added a canonical FigureDocument to each editable plot window while keeping
  the singleton PlotView as the focused rendering/performance facade.
- New, duplicated, rebound, renamed, minimized, focused, and save-snapshotted
  windows now synchronize through one document bridge; background rendering
  resolves from the document rather than trusting a stale compatibility copy.
- Preserved the existing view-history split: focus commits editable state, but
  zoom/pan remains in its dedicated navigation history.
- Kept the legacy `view`/`title`/`datasetId` fields temporarily as synchronized
  projections so this architectural change does not require a repository-wide
  UI rewrite. Workspace sanitization/migration is the next stacked slice.

### 2026-08-01 — F1.5a hardened document boundary (ChatGPT-Sol)

- Added full untrusted-input sanitization and serialization for the versioned
  FigureDocument envelope; malformed identities/data modes and unknown future
  versions fail closed while optional display fields degrade safely.
- Added the reverse FigureDocument → PlotView projection and regression tests
  for a customized plot, including styles, order, annotations, shapes, errors,
  and axis breaks.
- Made document creation, hydration, and frozen snapshots mutation-isolated so
  Apply/Cancel, history, and later persistence cannot share nested references.
- This completes the safety prerequisite for F1.3; the full reversible
  FigureDocument/FigureSpec path in F1.5 remains open.

### 2026-08-01 — Claude adversarial review of the F0/F1.1/F1.2 stack (PRs #95–#102)

- Verified the audit's two load-bearing claims against the code before
  accepting the thesis: `PlotView` does carry far more state than
  `FigureConfig` (y2 axes, error keys, order/visibility, shapes,
  annotations, waterfall, page setup), and `useFigureBuilder` does snapshot
  store values into detached local `useState` with no write-back.
- One blocking defect found and FIXED in-stack: the F0.1/F0.4 command
  renames carried no legacy `keywords`, so palette/Help searches for
  "figure builder" and "figure page" returned zero results (the exact
  #78–#81 keyword-migration regression class — fuzzy match is an in-order
  subsequence and "Publication preview…" contains no "f"). Both commands
  now carry legacy keywords, a stale `originTips.ts` "Figure page" tip was
  updated, and a findability regression test pins the legacy queries.
- Follow-up booked, deliberately NOT restructured during review:
  `useGraphBuilder.ts` grew 517 → 566 lines (over the 500-line habit,
  unpinned by `MODULE_PINS`). F1.3 reworks this hook anyway — split
  `commitToPlot` (or pin the file) as part of that slice, not before.
- Everything else held: store APIs verified real (`createWindow`,
  `focusWindow`, `rebindWindow`, window kinds), loss-inventory field names
  verified against `FigureOverrides`, the dropped `specDatasetId` blocker
  check proven unreachable, schema module proven isolated (no non-test
  consumers), zero new lint warnings, row-state/no-eval/token guards green.

### 2026-08-01 — F1.2 versioned FigureDocument schema (ChatGPT-Sol)

- Defined the version-1 `quantized.figure` persistence boundary with stable
  identity, live/frozen data ownership, data bindings, plot mark and complete
  visual state, rich error roles, grouping/faceting, and output preferences.
- Removed channel/error bindings from the nested visual state so the new model
  cannot develop two competing authorities for the same editable decision.
- Added a pure seed adapter from today's `PlotView`, including a lossless rich
  error-role path and a legacy symmetric-Y fallback.
- Pinned JSON round-trip behavior, schema-version routing, and live/frozen
  invariants. Store integration and legacy workspace migration remain F1.3 and
  F1.6, respectively; this PR does not change application behavior.

### 2026-08-01 — F1.1 typed figure-contract census (ChatGPT-Sol)

- Added a compile-time-exhaustive ownership table for every top-level field in
  `PlotView`, `PlotSpec`, `FigureConfig`, `FigureDoc`, and `FigureSpec`.
- Classified each field as canonical, recipe-only, export-only, derived, or
  unsupported, with its intended FigureDocument path and ownership rationale.
- Confirmed `PlotView` as the richest canonical starting point, `PlotSpec` as a
  reusable recipe, `FigureConfig` as a legacy projection, and `FigureSpec` as a
  generated transport object.
- Kept this slice characterization-only: it changes no persistence schema,
  conversion behavior, or UI and prepares the F1.2 schema decision.

### 2026-08-01 — F0.5 transition regression gate (ChatGPT-Sol)

- Completed the F0 regression matrix across role labels, Create versus Apply
  behavior, compatibility confirmations, cancellation, and hard blockers.
- Added keyboard activation coverage for both Graph Builder destinations and
  a view-level pin proving incompatible Publication Preview actions stay
  disabled and inert.
- F0 now meets its exit criterion: current transitions state their role,
  require explicit destinations, and cannot silently discard known state.
- Test-only gate PR is stacked on the F0.4 artifact-terminology PR.

### 2026-08-01 — F0.4 artifact terminology (ChatGPT-Sol)

- Renamed Graph Builder's saved artifacts to Saved Plot Recipes throughout
  its toolbar and dialogs.
- Renamed Saved Figures to Publication Figures in the Library and multi-panel
  source list, with tooltips routing them back to Publication Preview.
- Renamed the unsaved Figure Page surface to Multi-panel Export and added a
  visible warning that closing it discards the temporary composition.
- Kept internal IDs and persisted schema names unchanged for compatibility.
- Added terminology regression coverage; implementation PR is stacked on the
  F0.3 transition-warning PR.

### 2026-08-01 — F0.3 figure-transition compatibility reports (ChatGPT-Sol)

- Added one pure compatibility inventory for the current partial figure
  adapters instead of duplicating loss rules in buttons and store actions.
- Graph Builder now confirms before Publication Preview omits supported state
  such as order/visibility, tick formatting, decor, or page settings.
- Saved Figure → editable plot now confirms with a specific omitted-settings
  list; frozen or missing-source figures remain blocked.
- Source PlotSpecs and FigureDocs remain unchanged when a user cancels or
  continues a lossy transition.
- Added pure-report and interaction regression coverage; implementation PR is
  stacked on the F0.2 Graph Builder destination PR.

### 2026-08-01 — F0.2 explicit Graph Builder destinations (ChatGPT-Sol)

- Replaced “Send to Stage” with separate Create New Plot and Apply to Current
  Plot actions; creation is the primary/default action.
- Create opens and focuses a fresh editable plot. Apply targets only the
  focused editable plot and deliberately rebinds it when the recipe uses a
  different dataset.
- Export now states its existing behavior explicitly: apply to the current
  plot, then use the ordinary export path.
- Added hook and view regression coverage; implementation PR is stacked on
  the F0.1 Publication Preview PR.

### 2026-08-01 — F0.1 publication-preview role cues (ChatGPT-Sol)

- Renamed user-facing Figure Builder entry points to Publication Preview while
  retaining internal IDs and module names for compatibility.
- Added an always-visible note that preview settings affect saved/exported
  output and do not change the editable Stage plot.
- Updated Graph Builder tooltips/status, compatibility messages, and Inspector
  contextual-help routing to use the same terminology.
- Added view and command regression coverage; implementation PR is stacked on
  the initial plan PR.

### 2026-08-01 — ChatGPT-Sol initial audit

- Audited the complete import → Graph Builder → Stage → Figure Builder → saved
  figure → Figure Page → clipboard/export workflow on Quantized 0.14.0.
- Confirmed that Stage is the richer internal editor and Figure Builder is a
  detached publication/export surface.
- Confirmed intentional lossy boundaries with 101 passing targeted tests.
- Selected `PlotView` as the recommended foundation for a canonical
  FigureDocument; implementation remains open.
- Booked F0 as the first campaign because it improves honesty and protects
  work immediately without prejudging the F1 migration design.
