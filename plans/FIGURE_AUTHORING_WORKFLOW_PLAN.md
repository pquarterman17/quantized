# Figure Authoring Workflow Plan

**Status:** Active
**Parent:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md`
**Created:** 2026-08-01
**Updated:** 2026-08-12 — F2.3g channels + F2.3h group-by panels land; F2.3's
named panel set is now exhausted except facet (no wire — needs the
multi-panel preview contract) and region shades (owner call)
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
  - [x] **F2.3c Shapes property panel (Claude Sonnet 5).** Canonical draft
        now exposes per-shape coordinates, stroke/fill, opacity, width,
        dash, and remove (kind read-only — no Stage surface mutates it
        either). No schema change: `shapes` already lived on
        `document.plot.view`. No context-menu wiring — the backend hitmap
        has no `shape:N` elements to route from; the panel lives in the
        always-visible panel list. See the 2026-08-11 F2.3c log entry.
  - [x] **F2.3d Reference-line property panel (Claude Opus 5).** Canonical
        draft now exposes per-line value and remove, plus an axis+value Add
        form — full parity with `Inspector/RefLinesCard.tsx`. Axis stays
        read-only per row (nothing in the app flips an existing line's axis).
        Unlike F2.3c's shapes, ADD belongs here: a reference line needs no
        live canvas. No schema change: `refLines` already lived on
        `document.plot.view`. **Region shades are deliberately NOT in this
        slice** — see the 2026-08-12 log entry for why they need an owner
        call first.
  - [x] **F2.3e Axis tick-format panel (Claude Opus 5).** Canonical draft now
        exposes the X/Y/Y2 number formats (Auto/Fixed/Sci/Eng + digits, the
        X-only date modes gated on `time_is_datetime`, and Y2's inherit-Y
        rule). No schema change and no render change: `xFmt`/`yFmt`/`y2Fmt`
        already lived on `document.plot.view` AND already reached the wire
        (`x_fmt`/`y_fmt`/`secondaryAxisWire`) — the panel was the only
        missing piece. Vocabulary shared with `Inspector/TickFormat.tsx` via
        the new `lib/tickFormat.ts` so the two surfaces cannot drift.
  - [x] **F2.3f Editable error-column bindings (Claude Sonnet 5).** The
        Error columns group closes the gap F2.3b deliberately left as
        read-only summary text: per-binding target/axis/side, remove, an Add
        form, half-pair warning, and "Detect from names" (pure
        `inferErrorBindings`, writing into the DRAFT — never the dataset's
        own `errorRoles`). Vocabulary matches `Inspector/ErrorRolesCard.tsx`.
        Subtlety: `bindings.errors` lives on `document.bindings`, not the
        PlotView, so edits patch the document directly rather than routing
        through `setCanonicalView`. A real latent bug surfaced en route —
        see the 2026-08-12 F2.3f log entry.
  - [x] **F2.3g Channels reassignment panel (Claude Sonnet 5).** X-axis
        select + per-channel Y/Y2/not-plotted toggles on
        `document.bindings.xKey/yKeys/y2Keys`, matching
        `Inspector/ChannelsCard.tsx`'s vocabulary AND guard semantics —
        which live nowhere else: `sanitizePlotView` only typechecks these
        fields, so the membership invariants (≥1 Y remains; Y2 requires
        already-plotted, keeping ≥1 primary) were ported into
        `canonicalChannels.ts`. See the 2026-08-12 F2.3g log entry.
  - [x] **F2.3h Group-by binding panel (Claude Sonnet 5).** The GROUP half
        only: `bindings.groupKey` already reached the renderer
        (`group_col`), and the grouped+y2 rejection surfaces through the
        existing readiness banner. **Facet was deliberately DECLINED with
        evidence**: `bindings.facetKey` has no render-request wire and no
        creation surface anywhere in the app — the working facet feature
        (`facetByColumn`/`MultiPanelStage`) is an unrelated store singleton
        sharing only the name. Editing it here would write dead state.
        Remains open below. See the 2026-08-12 F2.3h log entry.
  - [ ] **F2.3i Facet editing (BLOCKED — needs a multi-panel Publication
        Preview contract first).** Booked by F2.3h's scoping:
        `figureCompatibility.ts` already blocks faceted Graph Builder specs
        from opening Publication Preview for exactly this reason. Unblocks
        if/when the preview grows a multi-panel contract (relates to F3's
        PageDocument, but per-figure faceting is a different mechanism).
- [x] **F2.4 Preserve direct manipulation.** Drag legend/annotations and
      double-click text on the live document, with matching property panels.
      **COMPLETE 2026-08-12** — the named gesture set (legend drag, annotation
      drag, text double-click, reference-line drag, shape drag) all work on
      the canonical draft with matching panels. Region shades have NO gesture
      anywhere in the app (no surface creates or edits one); that is the
      owner-gated F2.3 residue, not an F2.4 gap.
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
  - [x] **F2.4c Decor hit targets (Claude Opus 5).** The backend hitmap now
        emits `refline:N` and `shape:N` elements (matplotlib `gid`, padded to
        a 6 px band on a degenerate axis), so right-clicking a reference line
        or a shape in the preview opens its property panel — the exact wiring
        F2.3c's log entry recorded as impossible ("the backend hitmap has no
        `shape:N` elements to route from"). Selection only; DRAG for these
        objects stays open under F2.4.
  - [x] **F2.4d Reference-line drag (Claude Opus 5).** Dragging a reference
        line in the preview moves it, the gesture the Stage canvas has always
        had — unblocked by F2.4c's hit target and F2.3d's panel. Value only:
        a line's axis is fixed everywhere in the app, so a sideways drag of a
        Y line is a no-op rather than a reinterpretation. Shape drag stays
        open (four coordinates and a grab-handle model, not one value).
  - [x] **F2.4e Shape drag (Claude Sonnet 5).** Dragging a shape in the
        preview translates it by the pointer's DELTA (drop minus press
        origin), preserving the grab offset instead of jumping its reference
        point to the drop location. `shapeIdForHit` resolves the hit index
        through `viewOverrides`' finite-coordinate filter, mirroring F2.4d's
        `refLineIdForHit` exactly. Page-anchored shapes needed genuinely
        different delta math from data-anchored ones — canvas fractions with
        NO y-flip (the backend's `calc/figure_shapes.py` flips at render
        time), verified against the backend before writing the frontend
        conversion. See the 2026-08-12 F2.4e log entry.
- [x] **F2.5 Unify render paths.** Stage copy, Stage export, publication
      preview, saved preview, and reopen must derive from the same document and
      produce equivalent output. **COMPLETE 2026-08-11** — all five named
      paths now route through `buildFigureSpecFromDocument`: publication
      preview (F2.1b), saved preview/readiness (F2.5a), page panels + reopen
      round-trip (F3.6), and Stage copy/export (F2.5b, the last reduced-path
      caller — `buildFigureSpec` retains zero production callers outside its
      own fallback). The legacy Figure Builder export path is a DIFFERENT
      surface, tracked under F2.1/F2.2's broader legacy convergence.
  - [x] **F2.5a Canonical preview readiness errors (planned PR #113).**
        Publication Preview distinguishes unavailable document sources from
        invalid render specifications and fails visibly without a fallback.
  - [x] **F2.5b Stage copy/export from the canonical document (Claude
        Sonnet 5).** "Copy figure", "Copy figure (vector)", and "Export
        figure…" now prefer the focused window's canonical FigureDocument
        (grouping, X-breaks, publication overrides — fields `PlotView`
        cannot represent), falling back to the live-view builder only when
        no canonical document applies. See the 2026-08-11 decision-log
        entry for the routing guard's three verified cases.

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
- [x] **F3.2 Reference FigureDocument IDs.** Do not flatten panels into lossy
      reduced configs. Define missing-source and frozen-snapshot behavior.
- [x] **F3.3 Support save/reopen/edit.** Add Save, Save As, dirty state, recent
      access, duplicate, rename, and delete.
- [x] **F3.4 Unify panel editing.** Double-click or context-menu a panel to edit
      the referenced figure; provide explicit unlink/duplicate-for-page actions.
- [x] **F3.5 Complete layout controls.** Preserve manual rearrangement,
      adjustable spacing, shared/independent axes, link/unlink, alignment, and
      recommended resize modes.
- [x] **F3.6 Export from PageDocument.** Clipboard and file export must consume
      the same reopened page model used by the internal preview.

**F3 exit:** Page → save → close → reopen → edit → copy/export retains every
panel, relationship, and visual setting. **Coded-and-tested as of F3.6
(2026-08-07):** a fail-before/pass-after characterization test plus a direct
round-trip test (pre-save spec vs. post-reopen spec, byte-for-byte) prove
this holds for the paths this campaign built. Still NOT owner-verified in the
live desktop app — per this plan's own "Required acceptance journeys" rule,
A6 (multi-panel) stays an unchecked owner acceptance journey, not implied
complete by F3's checkboxes.

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
      document/spec for equality. **Automated half DONE 2026-08-12** —
      `e2e/specs/figure-document-roundtrip.spec.ts`, a real-Chromium journey
      against the real backend: Save Editable Figure via the File menu, close
      the window, reopen from the Library row, assert the reopened document
      `toEqual` the saved one. Runs in CI's `e2e.yml`. Owner desktop run still
      gates the checkbox.
- [ ] **A4 Complex 1-D:** Repeat A3 with y2, asymmetric errors, hidden/reordered
      series, custom formats, annotations, shapes, and waterfall offset.
      **Automated half DONE 2026-08-12** — the same spec carries y2 keys,
      hidden + reordered series, a renamed series, per-series styles, all three
      tick formats, an annotation, a shape, two reference lines, and explicit
      limits, and asserts each is present in the SAVED document before
      comparing, so a lossy round trip cannot pass by comparing two empty
      objects. Waterfall offset and ASYMMETRIC Y errors are covered too — the
      latter is the one A4 construct that is not a view field (it rides
      `bindings.errors`, seeded from the dataset's `errorRoles` at window
      creation) and is exactly what proves the live-facade rebuild PRESERVES
      bindings instead of re-deriving them from the legacy symmetric-only
      projection. Verified load-bearing twice, by planting a shapes-dropping
      reopen and an asymmetric-error-dropping rebuild; each reddens it.
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

### 2026-08-12 — F2.3g channels reassignment panel (Claude Sonnet 5)

- X-axis select + per-channel Y/Y2/not-plotted toggles on the canonical draft
  (`document.bindings.xKey/yKeys/y2Keys`), matching
  `Inspector/ChannelsCard.tsx`'s vocabulary and guard semantics (≥1 Y channel
  remains; Y2 requires the channel already be plotted, keeping ≥1 primary;
  dropping a channel from Y also drops it from Y2).
- **The finding: `sanitizePlotView` enforces no membership invariants at
  all** — it only typechecks (integer-or-null, integer-list-or-null). The
  real guards live in ChannelsCard's `toggle`/`toggleAxis` on the live
  store, which the document path never touches. They were ported into
  `canonicalChannels.ts` as pure helpers; a rejected toggle returns the SAME
  object reference so the hook skips the patch (and its history entry) —
  proven by a test asserting the store object is reference-identical after
  a guarded no-op.
- One deliberate divergence from ChannelsCard: the draft materializes an
  explicit `yKeys` list instead of collapsing back to the live store's null
  "auto" sentinel — a saved document should freeze intent, not re-derive
  channels when the dataset changes.
- Channel ROLE/modeling-type and the inline ±error picker stayed out of
  scope (dataset-scoped fields / F2.3f's territory).
- Funded by two extractions: `exportNow` → `previewExport.ts`
  (previewDrag.ts's deps-object pattern) and the six panel-prop interfaces →
  `propertyPanelTypes.ts` (re-exported; no importer changed).

### 2026-08-12 — F2.3h group-by binding panel; facet declined with evidence (Claude Sonnet 5)

- Ships the GROUP half only. `document.bindings.groupKey` already reaches
  the renderer (`group_col` via `buildFigureSpecFromDocument`), including
  the grouped+y2 "cannot use a secondary Y axis" rejection, which surfaces
  through the existing readiness banner — the panel does not pre-block or
  duplicate it. Vocabulary matches the Graph Builder's Group well (None +
  column labels, no eligibility restriction).
- **Facet deliberately declined — an F2.3d-style scoping finding, not an
  oversight.** `bindings.facetKey` has no wire to the render request
  (`figureSpec.ts`'s own doc says so) and no creation surface anywhere in
  the app; only test fixtures and pass-through preservation code touch it.
  The live "facet" feature that DOES work (Stage's `facetByColumn` →
  `MultiPanelStage`) is an unrelated store singleton sharing only the name.
  A control here would edit dead state or invent a second "facet" concept.
  Booked as F2.3i, blocked on a multi-panel Publication Preview contract
  (`figureCompatibility.ts` already blocks faceted Graph Builder specs from
  opening the preview for the same reason).
- Funded by extracting the select/edit/textOf dispatch to
  `previewSelect.ts` (previewDrag.ts's pattern).
- **Merge note:** built in parallel with F2.3g; the prescribed disjoint
  funding extractions (`previewExport.ts` vs `previewSelect.ts`) held — the
  only resolutions were unioning the two bindings blocks in the hook, moving
  `GroupingPanelProps` into F2.3g's new `propertyPanelTypes.ts` for
  consistency, and splicing both new test suites. Merged-tree gate: lint 0
  errors, 6,319 tests green (427 files), build + bundle budget green
  (880.0 kB eager, 23.3 kB headroom); `useFigureBuilder.ts` at 492 and
  `PropertyPanels.tsx` at 371, both under their ceilings.

### 2026-08-12 — F2.3f editable error-column bindings in the preview (Claude Sonnet 5)

- Closes the gap F2.3b deliberately shipped as read-only designation text.
  `bindings.errors` already reached the render request via `figureSpec.ts`'s
  `exportErrorSpans` (`error_spans`, asymmetric halves included) — like
  F2.3e, the panel was the only missing piece.
- Vocabulary matches `Inspector/ErrorRolesCard.tsx`: target/axis/side
  selects, half-pair warning (an asymmetric binding without its partner
  draws nothing, so say so), remove, an Add form (channel from the canonical
  dataset's labels — no live canvas needed, so the group renders even
  empty), and "Detect from names" via the pure `inferErrorBindings`, which
  writes into the draft and never touches the dataset's own `errorRoles`.
  Channel is read-only per row, like a reference line's axis.
- **A real latent bug surfaced en route**: `figureDocument.ts`'s
  `legacyErrorBindings` built `ErrorBinding` literals in a different key
  order (`{target, channel, …}`) than every other constructor
  (`{channel, target, …}`), and `figureLifecycle.ts`'s stale-baseline check
  compares documents via `JSON.stringify`, which is key-order-sensitive — so
  any document with a symmetric-Y binding could see a legitimate Apply
  spuriously flagged stale. Fixed at the source (literal reordered), with
  the reasoning documented at the constructor.
- **Merge note (the pin story):** F2.4e and F2.3f were built in parallel and
  each funded itself by extracting the same output format/style/DPI
  constants, so the merged hook went 21 lines over its 522 pin. Resolved by
  keeping ONE constants module (`figureOutputConstants.ts`) and additionally
  extracting the drag-to-place dispatch whole to `previewDrag.ts` (pure
  logic over injected state; the hook keeps a thin binding wrapper) — which
  dropped `useFigureBuilder.ts` to 497 and GRADUATED it off the pin list
  under the ratchet's own shrink-below-ceiling rule. The pin was never
  raised.
- Gate on the merged tree: lint 0 errors, 6,262 frontend tests green
  (424 files), build + bundle budget green (880.0 kB eager, 23.3 kB
  headroom).

### 2026-08-12 — F2.4e shape drag in the preview (Claude Sonnet 5)

- Closes F2.4: with shape drag landed, the preview's named direct-manipulation
  set (legend, annotation, text, reference line, shape) is complete — every
  gesture F2.4b's matrix recorded as blocked behind missing panels now exists.
- **Translates by the pointer's delta, never jumps to the drop point.** A
  reference line is one value, so F2.4d could commit the drop position
  directly; a shape is four coordinates, so the drag diffs the press origin
  against the drop point and translates all four — the grab offset is
  preserved, matching the Stage's own shape-drag feel. `PreviewOverlay`'s
  `onDragEnd` now reports the press origin too (it always had it in
  `dragRef`); `dragElement` takes the two extra args as optional so every
  pre-existing 3-arg caller is untouched.
- **The two anchor modes needed genuinely different delta math.** A
  page-anchored `Shape` stores canvas fractions (top-left origin, y-down, NO
  y-flip — `calc/figure_shapes.py`'s `1.0 - y1` does the flip at render
  time, verified before writing the frontend conversion), unlike a
  page-anchored legend/annotation, which is a matplotlib figure fraction
  (y-up). New `pxToCanvasFraction` is deliberately unclamped: it only ever
  feeds a two-point difference, and clamping the endpoints would distort the
  delta.
- The hit index resolves through `shapeIdForHit`, applying the same
  finite-coordinate filter `viewOverrides` applies — the F2.4d index-mapping
  discipline, kept in `canonicalShapes.ts` next to its sibling helpers.
  Non-finite translation results are dropped, not committed
  (`translateShape` returns null). Commits go through `setShapeStyle` →
  `setCanonicalView`, so Apply/Cancel round-trips and Cancel stays
  mutation-free.
- `useFigureBuilder.ts` sat exactly at its 522-line MODULE_PINS pin, so the
  output format/style/DPI constants moved to a new
  `figureOutputConstants.ts` (re-exported — no importer changed) to fund the
  addition; the file lands at exactly 522 again.
- Gate: lint 0 errors, 6,229/6,229 frontend tests, build + bundle budget
  green (880.0 kB eager, 23.3 kB headroom).

### 2026-08-12 — Figure Page (F3) usability sweep: two real defects (Claude Opus 5)

F3's exit criterion is "Page → save → close → reopen → edit → copy/export
retains every panel, relationship, and visual setting", and F3.6 proved it
with a byte-for-byte round-trip test — but the plan is explicit that it was
never owner-verified in the live app (A6 stays open). Driving it in a real
browser: **the journey itself passes.** Two editable figures saved, both
assigned to slots, the save gate cleared, the page saved, closed, reopened
byte-identical, and `figure_page.pdf` exported — no console errors. Two
defects around it did not:

1. **The save gate's instruction was 84% invisible.** A page can only
   reference SAVED editable figures (F3.2's no-lossy-flattening rule), so
   assigning an unsaved plot window correctly refuses with: *"slot (a): … is
   an open plot window not yet saved as an editable figure — save it (its
   title-bar Save button, or File > Save Editable Figure), then Save this
   page again"*. That message renders with `.qzk-ds-meta`, a SINGLE-LINE
   utility (`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`)
   built for a dataset's "201 pts · 1 ch" row. Measured: `scrollWidth` 988 px
   in a `clientWidth` 154 px column — and because the text overflowed a
   nowrap line rather than filling one, not even an ellipsis hinted anything
   was missing. The user saw "slot (a): "two-channel.csv"" and no way
   forward. Fixed with a `.qzk-msg` modifier that restores wrapping
   (`scrollWidth` now equals `clientWidth`). The Save button is left ENABLED
   deliberately: it already toasts the full reason, which is louder than a
   disabled button with a tooltip.
2. **Saving the default window produced a figure named `""`.** Reached
   through the documented UI in three steps: import a file → File ▸ Save
   Editable Figure. The main window is created at store init, before any
   dataset exists, so its `title` is the `""` sentinel forever; the title BAR
   resolves that via `displayedWindowTitle` (explicit title → bound dataset's
   name → "Untitled graph"), but `saveFigure` read `title` raw. Result: a
   nameless Library row, a bare glyph in this very Figure Page's
   panel-source list (which is how it was spotted), and the status line
   `figure "" saved`. `saveFigure` now resolves the same name the title bar
   shows — only when blank, so an explicit title and `saveFigureAs`'s dialog
   name are never overridden. `saveFigureAs`'s default and the close-confirm
   prompt had the same raw read with a WEAKER fallback ("Untitled graph"
   instead of the file name); both now use the shared resolver.

**The clipping is a class, so it got a guard**, not just seven edits: an
`architecture.test.ts` check that every `role="alert"`/`role="note"` element
borrowing `.qzk-ds-meta` also carries `.qzk-msg`. It paid for itself
immediately — it caught a SEVENTH site (`FigureBuilderView`'s own
"Editing … Apply updates this figure; Cancel discards them." note) that a
grep missed because its `className` sits on a separate line from its `role`.
Six of the seven are multi-sentence instructions; the rule is mechanical, so
the guard has no false positives to allowlist.

### 2026-08-12 — F2.4d reference-line drag in the preview (Claude Opus 5)

- The gesture F2.4 was waiting on. F2.4b's matrix said the remaining gesture
  types "F2.3's still-missing shape/reference-object panels would need to
  exist first (nothing to attach a drag to yet)"; F2.3d built the panel and
  F2.4c the hit target, so this is the first of them to land.
- **The index mapping is the whole subtlety, and it gets its own pure
  function.** A `refline:N` element's N is the RENDER REQUEST's array
  position: `figureSpec`'s `viewOverrides` emits
  `st.refLines.filter((r) => Number.isFinite(r.value))`, so one non-finite
  value in the draft (reachable from a legacy `.dwk` — both add paths reject
  one today) shifts every later index by one and a bare `refLines[n]` would
  drag the WRONG line. `refLineIdForHit` applies the same filter and lives
  next to the reasoning, so the two cannot drift apart unnoticed.
- Value only, never axis: a reference line's axis is fixed everywhere in this
  app once created, so a sideways drag of a Y line moves nothing rather than
  being reinterpreted as an X line. Non-finite results are dropped rather than
  committed.
- Shape drag stays open under F2.4 — four coordinates and a grab-handle model,
  not a single value. Its tooltip still advertises right-click only, so the
  preview never promises a gesture it does not have.
- **Verified with a real mouse**, which is the only thing that can prove it:
  press on the line's hitbox, move 90 px right, release → the draft value goes
  0 → 3702 (the axis spans ±5000 across ~250 px of axes), the tooltip reads
  "drag to move; right-click for properties", the cursor is `move`, and the
  LIVE store's `refLines` stays untouched because the draft is detached. The
  CSS↔image pixel scale is already handled by PreviewOverlay's
  `scale = map.width / rect.width`, which is why the committed value matches
  the drop position rather than being off by the display ratio.

### 2026-08-12 — Publication Preview usability sweep (Claude Opus 5)

A deliberate hunt for more defects of the drift-bug class: drive the real
preview in a browser and measure, rather than read the code. Nine checks over
a 3-channel dataset with a secondary axis. **Six confirmed the design already
holds** — Apply is correctly disabled with zero edits; the y2 limit fields and
the Y2 tick row appear only with a y2 channel plotted; unticking "inherits Y"
seeds the current Y format; Cancel on a dirty draft raises the discard confirm
and then discards; a reopened session starts clean; Export from the preview
produces the PDF; zero console errors throughout. **Two were real and are
fixed here:**

1. **Export/Apply/Cancel scrolled away with the settings.** Measured: with the
   property groups expanded the settings column is ~2,400 px tall inside an
   ~890 px scrollport, which put Apply at y≈1163 in a 950 px viewport — the
   buttons that COMMIT the work sat below the fold and had to be hunted for,
   and every panel added since F2.3b made it worse. They are now a sticky
   footer row (y≈909 after the fix, comfortably in view) pinned inside the
   same scroller, so no ToolWindow structure changed. A second pass was needed
   on the styling: `bottom: 0` parks the row one `--pad-lg` ABOVE the
   scrollport edge, so scrolling content showed through the gap beneath it —
   fixed by sticking past the padding and adding it back inside.
2. **The F2.3d Add field ignored Enter**, while `Inspector/RefLinesCard`'s
   identical field commits on it. Adding several lines meant a mouse trip per
   line. Now matches the Stage.

The jsdom test for #1 asserts the MECHANISM (the sticky container holds all
three buttons), not a pixel position — jsdom has no layout, so a coordinate
assertion there would be theatre. The measurement that justifies it is
recorded above instead.

### 2026-08-12 — F2.4c decor hit targets: right-click a reference line or shape (Claude Opus 5)

- **Closes a gap this plan had already written down as impossible.** F2.3c's
  log entry says, verbatim: "No PreviewOverlay/context-menu wiring:
  `calc/figure_hitmap.py` (backend, unmodified) emits `series:N`/`ann:N` hit
  elements but NO `shape:N` … drawn shapes render into the preview PNG but
  have no individual hitbox to route a right-click menu from." F2.3d landed
  with the same limitation. So both new panels were reachable only by hunting
  the collapsed group list — the objects were visible in the figure and inert.
- **Identity by `gid`, not by position.** `figure_decor._apply_ref_lines` and
  `figure_shapes._apply_shapes` now tag each artist with matplotlib's own
  `gid` (`refline:N` / `shape:N`), and `collect_map` harvests any artist in
  `ax.lines`/`ax.patches` carrying one. Position would not work: reference
  lines share `ax.lines` with the series, and a colour-mapped series is not in
  `ax.lines` at all — the exact misalignment `collect_map`'s existing
  `series_artists` doc already warns about.
- **The bug the smoke test caught before any test was written.** The first
  build emitted nothing for reference lines: an `axvline` is EXACTLY zero
  pixels wide (an `axhline` zero tall), and `add`'s
  `if bbox.width <= 0 or bbox.height <= 0: return` guard — correct for an
  absent title — silently dropped every one. Fixed with a separate `add_decor`
  that grows a degenerate axis to ±3 px, i.e. a 6 px target matching the
  tolerance `lib/uplotOverlays.ts`'s `pickRefLine` already uses on the live
  canvas, so the preview and the plot are equally forgiving to click.
- Frontend is three small pieces: `groupForElement` routes `refline:` →
  "Reference lines" and `shape:` → "Shapes"; `PreviewOverlay`'s `elementName`
  names them (the generic fallback would have rendered "Refline:0"); and the
  tooltip advertises right-click only, since drag is not wired for them.
- **The routing key is a bare group-title STRING shared by two files**, so a
  rename in `PropertyPanels` would break click-to-focus with every test still
  green. Added a parametrized guard that asserts every title
  `groupForElement` can return is actually rendered as a `Group` — verified by
  planting a rename, which reddens exactly the `refline:0` case.
- Deliberately NOT in this slice: dragging a reference line in the preview to
  move it. That needs the element index mapped back to a specific draft object
  through the same finite filter `viewOverrides` applies, plus per-object
  commit semantics. F2.4 stays open for it — but it now has something to
  attach to, which it did not before.
- Verified in the running app: both hitboxes appear with correct tooltips,
  right-click offers "Properties…", and choosing it opens and scrolls to the
  matching group.

### 2026-08-12 — F2.3e axis tick-format panel in Publication Preview (Claude Opus 5)

- **The narrowest gap of the F2.3 set, and the one with the most direct
  publication value.** `xFmt`/`yFmt`/`y2Fmt` were already canonical
  `document.plot.view` fields AND already reached the renderer —
  `lib/figureSpec.ts` sends `x_fmt`/`y_fmt` through `axisFmtParam` and the
  secondary format through `secondaryAxisWire`. So the *only* thing missing
  was a control: a figure's tick notation ("2 decimals", "scientific") could
  be changed on the Stage alone, i.e. only by the action that invalidates an
  open preview session. Nothing in the render path changed for this slice.
- **Shared vocabulary instead of a second copy.** The mode list, the date-mode
  set, the `time_is_datetime` gate, and the 0..20 digit clamp moved to a new
  pure `lib/tickFormat.ts` that BOTH `Inspector/TickFormat.tsx` and the new
  panel import. Two surfaces editing the same `AxisFormat` must offer the same
  four modes in the same order, or a figure's ticks change meaning depending
  on which panel the user reached for. The Inspector refactor is import-only:
  its 99 tests pass untouched.
- **Placed inside the existing "Axes & ticks" group**, under a `tick format`
  caption, rather than as a seventh top-level group. Tick notation IS an axis
  property; a separate group would have split the axis controls in two.
- **Two behaviours kept verbatim from the Stage, both deliberate:** Y2 renders
  only when the draft actually plots a secondary axis (without one
  `resolveSecondaryAxis` returns null and no `y2_fmt` is ever sent — the field
  would be a placebo, the same reasoning as F2.3a's `hasY2` gate on y2 limits);
  and unticking "inherits Y" seeds Y2 from the CURRENT Y format rather than a
  fresh default, so turning inheritance off shows what the axis is already
  rendering instead of silently resetting it to Auto.
- A date mode displays as "Auto" in the numeric segmented control with the
  date select beside it carrying the truth — the four numeric modes cannot
  represent "datetime", and showing no selection at all would read as broken.
- Verified in the real app: Y → Sci/3 re-renders the preview's Y ticks as
  `4.000e+0`; the live store's `yFmt` stays untouched while the draft
  diverges; Apply commits to both the window document and the legacy facade;
  the date select correctly stays hidden on a physics (Field/Oe) X axis.
- **Funded by extraction again, pin DOWN again.** The #15 graph-template block
  moved to `useGraphTemplates.ts` (legacy-mode-only by nature — its UI renders
  only when `!f.canonical`). 37 lines freed, 19 spent; pin 570 → 552. Across
  F2.3d and F2.3e: 598 → 552, two slices added, zero bumps.
- Gate: 419 files / 6151 tests, tsc clean, eslint 0 on every touched file,
  build green (879.9 kB eager, 23.4 kB under budget).
- F2.3 remains open: channels/errors reassignment, grouping/faceting, and
  region shades (owner-gated) are still unreached by the canonical preview.

### 2026-08-12 — F2.3d reference-line property panel in Publication Preview (Claude Opus 5)

- **The gap, confirmed in the running app before any code changed.** With two
  reference lines and a region shade on the plot, Publication Preview RENDERS
  all three (the 2026-08-11 `figure_decor.py` slice made sure of it) but its
  panel list was Text & fonts / Axes & ticks / Legend / Series / Canvas /
  Annotations — no way to touch any of them. They were the only visible
  elements of the figure with no property panel. Worse, the one alternative —
  reaching for the Stage's own Reference Lines card — is precisely the action
  that invalidates the open session (see the drift entry below). So "adjust
  the Hc marker before exporting" had no non-destructive path at all.
- **Scope: reference lines, matched field-for-field to the Stage.**
  `RefLinesCard` adds (axis + value), removes, and drag-on-canvas moves
  (`updateRefLine`, value only). So the panel edits VALUE, removes, and adds;
  AXIS is read-only per row, the same call F2.3c made for shape `kind` —
  nothing in this app flips an existing line's axis, and adding that only in
  the detached panel would be a one-sided divergence. ADD *does* belong here,
  unlike shapes: a reference line is fully specified by an axis and a number,
  so it needs no live canvas to draw on. That is also why the group renders
  when the list is EMPTY (Series and Shapes hide themselves) — hiding it would
  put "add the first reference line" back on the Stage, i.e. back on the one
  action that kills the session.
- **Region shades were deliberately left out, and that is an owner call, not
  an oversight.** `regionShades` has NO creation or editing surface anywhere
  in the app — they exist only as Origin-decoded film-stack decor
  (`originRegionShades`, applied on figure import). Adding editing solely in
  the detached preview would invent a capability the live plot lacks, which is
  the exact inconsistency F2.3c declined for shape `kind`. The consistent fix
  is a Stage card *and* a preview panel together; the honest question first is
  whether decoded decor should be user-editable at all. Booked as an open
  F2.3 residue rather than answered unilaterally.
- **Verified end to end in the real app, not only in jsdom:** edit an existing
  line's value → the preview PNG re-renders with it moved; Add a Y line → it
  appears in the preview; the live store's `refLines` stays untouched while the
  draft diverges (detached draft, as designed); Apply commits both edits to the
  window document AND the legacy top-level facade. A hook test also pins that
  the edit reaches `overrides.ref_lines` on the render request — without it the
  panel could edit a field the rendered figure never shows.
- **A usability defect found by looking at the rendered panel, not the DOM:**
  the first build labelled rows "X reference 1", which wraps mid-phrase in the
  ~210px panel, and captioned every single-field row "value". Rows now read
  "X 1" with no per-row caption (the group title already says "Reference
  lines"), while `aria-label` keeps the full phrase — the visible-vs-accessible
  split `PropertyNumberField`'s own `ariaLabel` prop documents. The Add form's
  axis picker also gained a visible "axis" label, which the Stage card's bare
  X/Y pair lacks.
- New pure module `canonicalRefLines.ts` (row derivation, patch/remove/append
  by id) and view `RefLinePropertiesPanel.tsx`, both unit tested standalone.
  Draft-created lines use a `pref-` id namespace, NOT the store's `ref-`:
  `useApp` mints those from a module-global counter that knows nothing about a
  detached draft, so a shared prefix would let a later Stage Add re-mint an id
  the draft had already applied.
- **Funded by extraction, as required — and the pin still went DOWN.**
  `useFigureBuilder.ts` was at its exact 598 pin with zero headroom, so the
  legacy-mode spec + FigureDoc builders moved to `legacyFigure.ts` as pure
  functions (the canonicalReadiness.ts pattern from F2.3c). 47 lines freed, 28
  spent by the new wiring; pin ratcheted 598 → 570.
- Gate: 417 files / 6120 tests, tsc clean, eslint 0, ruff clean, build green
  (879.8 kB eager, 23.5 kB under budget), backend 3616 passed unchanged.
- F2.3 remains open: channels/errors reassignment, grouping/faceting, tick
  formats, and region shades are still unreached by the canonical preview.

### 2026-08-12 — F2.2 defect: the pre-emptive drift check was blind to Stage edits (Claude Opus 5)

- **Found by driving the real app, not by reading code.** With a Publication
  Preview open on the focused window, adding a reference line through the
  Inspector left **Apply enabled**. Clicking it rejected the entire session —
  `staleBaseline: true`, status "publication preview target changed; changes
  not applied" — discarding every preview edit made up to that point. That is
  precisely the failure item 1 (`sessionLiveDrifted`, F2.2a) exists to
  prevent: "flag Apply as blocked BEFORE the user clicks it instead of only
  after a rejected Apply".
- **Root cause: a computation without a subscription.** `useFigureBuilder`
  read `useApp.getState()` inline, with a comment asserting that "existing
  [selectors] re-render the hook enough for a real edit to reach this check
  on its own." That assumption is false. A focused window's LIVE document is
  derived (`liveWindowDocument` → `snapshotView`) from the store's top-level
  view SINGLETONS — `refLines`, `regionShades`, `shapes`, `annotations`,
  `hiddenChannels`, `plotTitle`, every `VIEW_KEYS` field — and the hook
  subscribes to none of them. No re-render, no re-check.
- **Why item 1's own test missed it:** it drifts `plotWindows[i].document`,
  and `plotWindows` IS one of the hook's selectors. The test proved the
  drift *computation* and never the *subscription*. The new test drifts
  `refLines` — exactly what `Inspector/RefLinesCard`'s Add does — and was
  confirmed red before the fix, with the failure matching the live app's.
- **Fix:** `selectSessionLiveDrifted(state)` in `canonicalSession.ts`, a
  Zustand selector returning a boolean. Cost is the reason it's shaped this
  way: it runs on every store notification, so the no-session case (nearly
  the whole life of the app — Publication Preview is one transient tool
  window) short-circuits on a single property read before touching
  `plotWindows` or building any document. **Measured in the running app**
  rather than argued: 2000 store notifications took 66.0 ms with no session
  and 119.8 ms with a preview open — ~0.027 ms per notification, and that
  delta is an upper bound since it includes everything else an open preview
  adds. At a 60 Hz drag that is ~1.6 ms/s.
- Ratchets, both DOWN, in the same commit: `useFigureBuilder.ts` 600 → 598
  (the long rationale moved to `canonicalSession.ts`, where the contract it
  documents lives), and the weak-wait allowlist for
  `useFigureBuilder.test.ts` 22 → 2 — the guard caught the new test copying
  the file's own weak-wait idiom, so all 22 sites were converted to wait on
  `result.current.preview` (strictly stronger: it is null until the debounced
  hit-map resolves AND commits). `weak-waits-inventory.md` updated;
  figurebuilder is the first directory cleared under TEST_DETERMINISM #5.
- **Swept the whole class, and it is a clean negative.** A
  render-time-`getState()` detector (brace/scope walk over every non-test
  `.ts`/`.tsx` under `frontend/src`, flagging `useApp.getState()` reached
  during render rather than inside a callback) was first VALIDATED against
  this very bug — run over the pre-fix file it flags the exact line — then run
  over the fixed tree. 255 `getState()` call sites exist; every one outside
  this fix is either an action function (`newGraphWindow`, `runUndo`,
  `exportSavedPage`, the whole `folderOps`/`contextActions` family — reading
  freshest state at action time, which is the correct idiom) or one of two
  DELIBERATE, documented render-time reads in `Stage/PlotStage.tsx`
  (`qfitRoi`, `gadgetCursors`), where the comment explains that subscribing
  would rebuild the uPlot instance and orphan the plugin's in-flight drag
  listeners. Those two are correct; recorded here so they are not
  re-investigated as suspects.
- **No standing guard was added, deliberately.** The detector needs ~60
  allowlist entries to go green because "action function" vs "render body" is
  a judgement call at the syntax level — the same unreliable-classification
  trap TEST_DETERMINISM #4 hit three times before that campaign abandoned
  classification for a plain count ratchet. A guard that must be maintained
  against 60 false positives gets disabled, not maintained. The method is
  recorded here instead so it can be re-run cheaply after new hooks land.
- **F2.2 stays open.** This closes a defect in F2.2a's shipped mechanism, not
  the remaining broader-entry-point parity work.

### 2026-08-11 — Reference lines and region shades in publication export (Claude Sonnet 5)

- **The audited gap, re-verified against live code before touching anything.**
  `PlotView` carries `refLines: RefLine[]` (`id, axis: "x"|"y", value`) and
  `regionShades: RegionShade[]` (`id, x1, x2, y1, y2, fill, axis?: 0|1`) —
  both render on the live uPlot canvas (`lib/uplotOverlays.ts`'s
  `refLinePlugin`/`regionShadePlugin`), persist in `.dwk`, and are canonical
  `decor.referenceLines`/`decor.regionShades` document fields
  (`lib/figureContract.ts`). But `lib/figureSpec.ts`'s `viewOverrides` — the
  ONE function every export/copy/page-panel path shares — had no mapping for
  either, and its own doc comment said so ("region/ref-line concepts remain
  unsupported here"). `lib/figureOverrides.ts` had no wire fields, and the
  backend `calc/figure_overrides.py` had no handling. Net effect: every
  publication export/copy (PDF/SVG/PNG, clipboard, page panels) silently
  dropped Hc/Tc reference markers and Origin-decoded film-stack region shades
  that the screen showed.
- **The fix, layer by layer.** Backend: new sibling module
  `calc/figure_decor.py` (needed to be shared between `figure_overrides.py`
  and `figure_y2.py` for the y2 routing below, so it followed
  `figure_shapes.py`'s split-module precedent rather than growing either
  existing file) with `_validate_ref_lines`/`_validate_region_shades` (reject
  non-finite values, malformed `#RRGGBB` fill, bad axis tags) and
  `_apply_ref_lines`/`_apply_region_shades` (matplotlib `axvline`/`axhline`
  dashed lines; `Rectangle` patches at `zorder=0`). `figure_overrides.py`'s
  `_validate_overrides`/`_apply_overrides` call them for the primary axes.
  Frontend: `FigureOverrides` gains `ref_lines`/`region_shades` wire fields
  (`figureOverrides.ts`, with sanitizer + `compactOverrides` array-key
  updates); `viewOverrides` (`figureSpec.ts`) maps `PlotView.refLines`/
  `regionShades` onto them, filtering non-finite values and stripping the
  screen-only `id` (same pattern as `shapes`/`annotations`).
  `buildStageFigureSpec`/`buildFigureSpecFromDocument` needed no changes —
  they already route through `viewOverrides` via
  `figureDocumentToPlotView`'s full `PlotView` clone.
- **The z-order decision, verified against the plugin source, not assumed.**
  `regionShadePlugin` draws in uPlot's `drawClear` hook (fires immediately
  after canvas clear, BEFORE grid/axes/series) — shades sit behind
  everything on screen, confirmed by the plugin's own doc comment ("Drawn
  translucently BEHIND the data"). `refLinePlugin` draws in uPlot's `draw`
  hook, which fires AFTER every series paints — ref lines are actually ON
  TOP of the data on screen, the opposite of an initial assumption. Backend
  match: region shades get `zorder=0` (below matplotlib's Patch default of 1
  and Line2D default of 2, so they land behind grid+data regardless of add
  order); ref lines get no special zorder — `_apply_ref_lines` runs from
  `_apply_overrides`, which is `draw_series_axes`'s last step (series
  already plotted), so the tied default Line2D zorder (2) resolves via
  add-order, landing them on top — confirmed with a direct smoke test, not
  assumed.
- **The y2-shade decision.** `RegionShade.axis === 1` means "expressed in
  the secondary y2 scale," but `_apply_overrides` only ever sees the primary
  `ax` — `ax2` is created by `figure_y2.render_with_secondary_axis` (via
  `ax.twinx()`) AFTER the primary `draw_series_axes` call, of which
  `_apply_overrides` is the last step. Rather than thread a new "is y2 about
  to exist" flag through `draw_series_axes` (whose signature
  `figure_page.py`'s multi-panel composer also depends on), the fix mirrors
  the EXISTING `y2_lim` precedent exactly: `render_with_secondary_axis`
  pre-strips axis-1 shades from the `ov` it hands to the primary
  `draw_series_axes` call (`figure_decor._split_region_shades_by_axis`) and
  applies them to `ax2` directly once it exists, via the same
  `_apply_region_shades`. A render with NO y2 axis at all sees the FULL
  `region_shades` list including axis-1 entries — the documented fallback,
  matching the screen's own `regionShadePlugin` (`hasY2 = u.scales.y2 !=
  null` gates the y2 lookup; absent a real y2 scale, an axis-1 shade still
  draws on the primary scale rather than vanishing). `RefLine` has no
  secondary-axis concept at all (`axis: "x"|"y"` only, no y2 ref-line type
  on screen), so `_apply_ref_lines` only ever targets the primary axes — no
  split needed there. Verified directly with a standalone smoke script
  exercising all three cases before writing the formal suite.
- **Tests.** Backend: new `tests/test_calc_figure_decor.py` (24 tests) —
  validation rejects, primary ref-line/region-shade rendering (dash style,
  zorder, z-order-vs-series ordering), the axis-1-without-y2 fallback, and a
  class exercising `render_with_secondary_axis` directly (axis-1 shade on
  ax2 not ax, axis-0 stays primary, mixed-axis split, byte-identical no-op
  when no shades are set). Frontend: extended `figureSpec.test.ts`'s
  byte-equality tests plus a new viewOverrides describe block
  (closes-the-gap characterization, id-stripping, non-finite filtering,
  axis passthrough, both-keys-omitted-when-unset). Also fixed two
  pre-existing hand-rolled `PlotView`-shaped test fixtures
  (`exportFigureCommand.test.ts`, `copyFigureCommand.test.ts`) that lacked
  `refLines`/`regionShades` and broke at runtime once `viewOverrides`'s
  `Pick<PlotView,...>` widened — both `as never`/`as any`-cast, so
  TypeScript couldn't catch the omission at compile time. Extended
  `figureCompatibility.ts`'s `figureDocPlotCompatibility` loss inventory
  (`ref_lines`/`region_shades`) to close the same silent-drop class one
  layer over.
- **Gate** (agent run + orchestrator-verified on the merged tree): backend
  ruff/mypy clean, pytest 3,932 passed (collected 3,986 → 4,010, +24 =
  exactly the new test file, no shrinkage); frontend lint 0 errors, 412
  files / 6,039 tests, tsc clean, build 879.8 kB eager (23.5 kB headroom).
  The one backend failure during verification was
  `test_calc_map.py::test_auto_qspace_map_builds_fast_on_real_corpus` —
  investigated to root cause and recalibrated in the same session (see
  TEST_DETERMINISM_PLAN's 2026-08-11 note: mis-calibrated budget premise,
  NOT a regression — the same input at the original calibration commit was
  2x slower than today's code).
- `calc/figure_decor.py` (196), `figure_overrides.py` (224), `figure_y2.py`
  (285), `lib/figureOverrides.ts` (326), `lib/figureSpec.ts` (481) all stay
  under their ceilings — no pins needed.

### 2026-08-11 — F2.3c shapes property panel in Publication Preview (Claude Sonnet 5)

- Added canonical-draft controls for per-shape properties: the four
  coordinates, stroke/fill color, opacity, width, and a dash toggle, plus
  per-shape remove — the same `Shape` fields `Stage/useShapeEdit.ts`'s
  right-click object menu and `Inspector/ShapesCard.tsx` already edit,
  now reachable on the detached draft. All write straight through
  `setCanonicalView` into `document.plot.view.shapes` — the same
  mechanism F2.3b's series properties use, since `shapes` has no
  `FigureOverrides` equivalent either. No schema, backend, or shape
  changes were needed: `FigureViewState` already carried `shapes`
  losslessly (F1.2).
- Kind is READ-ONLY (glyph + kind-scoped label, e.g. "arrow 1"): no
  surface in the app, Stage included, ever changes an existing shape's
  kind after it's drawn — adding that only in this detached panel would
  be a new capability with no Stage equivalent to stay consistent with.
  Fill renders only for rect/ellipse, matching `useShapeEdit.ts`'s
  `canFill` check verbatim. Opacity/width are free-typed numeric fields
  here (not the Stage context menu's 3/4-step presets) — `Shape.opacity`/
  `.width` are plain numbers and a full-parity panel should reach any of
  them, not just the menu's coarse shortcuts.
- Adding a NEW shape stays a Stage-only gesture (drag-to-draw needs a
  live canvas) — deliberately out of scope, same as F2.3b left channel/
  error reassignment to Graph Builder's own UI.
- No PreviewOverlay/context-menu wiring: `calc/figure_hitmap.py` (backend,
  unmodified) emits `series:N`/`ann:N` hit elements but NO `shape:N` —
  drawn shapes render into the preview PNG (already flow through
  `buildFigureSpecFromDocument` → `FigureSpec.overrides.shapes`) but have
  no individual hitbox to route a right-click menu from. The Shapes group
  is reachable the same way "Axes & ticks"/"Canvas" already are: a
  manually-opened item in the always-visible panel list, not a hitmap
  shortcut. Not a regression — there was no shape hitbox to enable.
- New pure module `canonicalShapes.ts` (kind-scoped row derivation,
  patch/remove-by-id, fill-applicability check) and view
  `ShapePropertiesPanel.tsx`, both unit tested standalone; `useFigureBuilder.ts`
  gained the setters/derived state (canonical-only — empty/no-op in
  legacy mode). The hook was at its exact 616-line pin with zero
  headroom; extracted `canonicalReadiness.ts` (pure readiness computation)
  first to fund the wiring, landing at 600 — pin ratcheted down, not
  raised. Pinned: draft edit → Apply → the window document and legacy
  top-level facade both reflect it; Cancel → no persistent mutation;
  full JSON serialize/deserialize round-trips edited shapes.
- Gate (verified independently by the orchestrator, not only the
  implementing agent): lint 0 errors, tsc clean, 414 files / 6063 tests,
  build green with the panel in the already-lazy FigureBuilderView chunk
  (eager 878.9 kB, 24.4 kB headroom). One UNRELATED test flaked once
  under three-way concurrent load during verification and passed 2/2
  otherwise; its identity was lost to output truncation — consistent
  with the known flake population TEST_DETERMINISM bounds, noted here
  for honesty rather than papered over.
- F2.3 remains open: channels/errors reassignment, grouping/faceting,
  tick formats, and reference objects are still unreached by the
  canonical preview. F2.4's shape/reference-object drag gestures remain
  deferred — this slice gives shapes something to attach to but adds no
  drag wiring itself.

### 2026-08-11 — F2.5b Stage copy/export from the canonical document (Claude Sonnet 5)

- **The audited gap, re-verified against live code before touching anything.**
  `lib/copyFigureCommand.ts` ("Copy figure", "Copy figure (vector)") and
  `lib/exportFigureCommand.ts` ("Export figure…") built their request via
  `lib/figureSpec.buildFigureSpec`, which derives from the live `PlotView`
  singleton — a projection with NO fields for `groupKey`, `axisBreaks`, or
  publication overrides/series styles (confirmed by grep: those fields exist
  only on `FigureDocument`, which every `kind:"plot"` window has carried
  since F1). `buildFigureSpecFromDocument` (same module) already threads all
  three through its `extras` parameter, and both Publication Preview export
  and F3.6's page-panel "window" branch already route through it. Net
  effect: Stage copy/export of a window whose document carried grouping,
  X-axis breaks (Publication Preview, F2.3a), or publication overrides
  silently dropped all three — the exact "parallel ad-hoc spec assembly"
  F2.5's own text warns against, and the same defect class F3.6 fixed for
  page panels one slice earlier.
- **The fix: one new entry point, not a special case per caller.**
  `lib/figureSpec.ts` gains `buildStageFigureSpec(s, ds, stem, o, extra)` —
  Stage copy/export's shared entry point. It resolves the FOCUSED window via
  `s().windowsForSave().find(w => w.id === s().focusedWindowId)` (the same
  helper F3.6's `panelFigure` uses, and for the same reason: these are
  ordinary async event-handler bodies, not `useShallow`/
  `useSyncExternalStore` selectors, so the `structuredClone`-per-call cost
  documented in F3.6's log — and the infinite-loop trap that cost taught —
  do not apply here). When that window is `kind:"plot"` and its document
  qualifies (see below), the spec routes through `buildFigureSpecFromDocument`;
  otherwise it falls back to the pre-existing `buildFigureSpec`.
  `copyFigureCommand.ts`/`exportFigureCommand.ts` now call
  `buildStageFigureSpec` instead of `buildFigureSpec` directly — no other
  change to either command's structure.
- **The "does this ever misroute?" investigation, not assumed.** Three
  questions had to be answered before the routing guard could be trusted:
  1. *Is the focused window ever NOT `kind:"plot"`?* No — `store/windows.ts`'s
     `focusWindow` refuses to move focus onto a non-`"plot"` window (a
     snapshot or worksheet/map document window only gets its z raised); the
     module's own doc says so explicitly ("`focusedWindowId` always points
     at a `kind:"plot"` window"). Guarded anyway (defensive, not load-bearing).
  2. *Does a live document's `bindings.datasetId` ever disagree with the
     resolved active dataset?* By construction by way of
     `focusedRebindPatch`/`_focusHandoff` it should always match
     `AppState.activeId`, which `exportActive` resolves `ds` from — EXCEPT
     `exportActive` resolves `ds` from `activeId` BEFORE an async
     `resolveDataset()` call, during which the user can refocus to a
     different window bound to a different dataset. `buildStageFigureSpec`
     falls back to the legacy builder in exactly this case, rather than
     either throwing (routing straight into
     `buildFigureSpecFromDocument`'s own dataset-mismatch rejection) or
     silently pairing a stranger window's styling with `ds`'s data. Proven
     reachable, not hypothetical: this is precisely the state Vitest's own
     `useApp` fixtures start in (the default main window is born bound to a
     `null` dataset, independent of whatever `activeId` a test's `setState`
     sets), and the existing 41 `exportFigureCommand.test.ts` tests +14
     `copyFigureCommand.test.ts` tests all already exercised this fallback
     path unmodified once `windowsForSave`/`focusedWindowId` were added to
     their fixtures.
  3. *Can the focused window's document legitimately be FROZEN
     (`data.mode: "frozen"`)?* Yes — `store/figureLifecycle.ts`'s
     `openEditableFigure` can attach a saved frozen editable figure (one
     promoted from a legacy `FigureDoc` via
     `figureDocumentFromLegacyFigureDoc`, which always pairs `mode:
     "frozen"` with `datasetId: null`) onto a brand-new live `kind:"plot"`
     window. A frozen document's `resolveFigureDocumentData` ignores
     whatever dataset is passed and renders its own snapshot — matching
     F3.6's page-panel "window" branch, which already routes a frozen-or-
     live window document through the same adapter unconditionally. So the
     routing guard is `document.data.mode === "frozen" ||
     document.bindings.datasetId === ds.id`, not a bare dataset-id compare —
     dropping the frozen clause would silently reopen this exact gap for a
     window seeded from a frozen editable figure.
- **Grouped + secondary axis fails visibly, for the first time on Stage
  copy/export.** The shared core already rejects that combination
  ("grouped figures cannot use a secondary Y axis") — `buildFigureSpec`
  never exercised the check because it never passed `groupKey` at all, so a
  Stage copy/export of a grouped+y2 window used to silently drop the
  grouping (not fail) before this fix. Now that the document path can be
  reached, the same window throws, and `exportActive`'s existing try/catch
  turns it into the ordinary copy-failed/export-failed toast+status — no
  new wiring needed, only a test proving it (both command test files).
- **Dialog/copy-default choices still win**, per contract:
  `buildStageFigureSpec` maps every `FigureRenderOpts` field (`fmt`,
  `style`, `dpi`, `title`, `xLabel`, `yLabel`) straight onto
  `FigureDocumentRenderOpts`'s superset, with `filename: null` so the
  dataset stem keeps naming the file (Stage's convention) rather than the
  document's own saved output filename. `extra.transparent` (Copy figure's
  `copyFigureTransparent` preference) is applied LAST, after either builder
  runs, so it wins even on the fallback path — matching the pre-fix
  `{...buildFigureSpec(...), transparent: ...}` spread the two commands used
  to write by hand.
- **Characterization test, written before the fix, then flipped.** New
  `describe("buildStageFigureSpec (F2.5b …")` in `figureSpec.test.ts`
  builds one `FigureDocument` with `bindings.groupKey` set,
  `plot.axisBreaks.x` non-empty, and `publication.overrides.font_size` set,
  then asserts BOTH halves in one test: `buildFigureSpec` on the same
  dataset/stem/opts (no focused-window routing) produces a spec with
  `group_col`/`overrides.x_breaks`/`overrides.font_size` all `undefined`
  (the gap, still true today — this is the legacy builder, unchanged); the
  SAME document, reached via a focused window, produces a spec with
  `group_col: 0`, `overrides.x_breaks: [[0.4, 0.6]]`,
  `overrides.font_size: 11` (the fix). Confirmed red-then-green by running
  it against the pre-fix command bodies (`buildFigureSpec` call sites) before
  swapping them to `buildStageFigureSpec`. 8 further unit tests cover the
  fallback conditions individually (no focused window, non-`"plot"` focus,
  no document yet, mismatched live dataset, frozen-document routing,
  dialog-wins, filename:null, and the grouped+y2 throw). 3 new tests each
  in `copyFigureCommand.test.ts` and `exportFigureCommand.test.ts` prove the
  same behavior end-to-end through the actual commands (group_col reaches
  `renderFigureBlob`/`exportFigure`; the dataset-mismatch fallback; the
  grouped+y2 toast/status, asserted via `.resolves.toBeUndefined()` — no
  unhandled rejection). `exportFigureCommand.test.ts`'s version uses the
  REAL store (`useApp`), which surfaced a real fixture gotcha worth
  recording: `windowsForSave()` rebuilds the FOCUSED window's document from
  the store's LIVE singleton PlotView fields (`yKeys`/`y2Keys`/`xKey`/…),
  not from whatever `view` a test attaches to the window's own `document` —
  correct production behavior ("the focused window's live view IS the
  singleton fields"), but it means a fixture must set those live fields
  too, not just the window's document, to exercise a specific plotted/y2
  shape for the focused case. `groupKey`/`axisBreaks`/`publication` are
  NOT part of `PlotView` and survive that rebuild untouched from the
  attached document, which is what makes the group_col tests possible at
  all without also faking a full live-view reconstruction.
- **Scope boundaries respected, not touched:** `useFigureBuilder.ts`'s
  legacy export branch (F2.1/F2.2 convergence residue), stat-stage/multivar
  exports (`useStatStage.ts`, `CorrelationView.tsx`, `SplomTabView.tsx`),
  and everything backend — this slice is 100% frontend TypeScript.
- **Gate:** Frontend — `npm run lint` clean (0 errors, 9 pre-existing
  unrelated warnings, unchanged baseline); full `npx vitest run` **412
  files / 6034 tests passed** (0 new files, +15 tests over the pre-slice
  baseline of 6019: +9 in `figureSpec.test.ts` (7 → 16), +3 in
  `copyFigureCommand.test.ts` (14 → 17), +3 in `exportFigureCommand.test.ts`
  (41 → 44)); `npx tsc -b --noEmit` clean; `npm run build` clean, bundle
  878.9 kB eager / 903.3 kB budget (24.4 kB headroom,
  down ~4 kB from F3.6's 28.4 kB — the new `buildStageFigureSpec` function
  and its doc comment land in the already-lazy `figureSpec` chunk shared by
  both Stage commands, not the eager bundle's largest chunks). Backend
  untouched — no backend gate run.
- **F2.5 status:** this closes the Stage copy/export half of F2.5's
  contract ("Stage copy, Stage export, publication preview, saved preview,
  and reopen must derive from the same document and produce equivalent
  output"). Publication preview export, saved-figure export, and page-panel
  export already routed through `buildFigureSpecFromDocument` (F1.5,
  F2.5a's readiness-error slice, F3.6) — Stage copy/export was the last
  caller still on the reduced legacy path. F2.5 is NOT ticked in this
  entry: "reopen" parity (closing and reopening a Stage-plotted window,
  independent of the page/library round-trip F3.6 already proved) has no
  dedicated round-trip test yet, and this slice did not audit every other
  live-PlotView-only caller in the codebase for the same reduced-spec
  pattern (only the two Stage commands named in scope). The orchestrator
  should decide whether that residue is enough to keep F2.5 open or whether
  it was already covered by F1/F3's own round-trip proofs.

### 2026-08-07 — F3.6 unified export from PageDocument (Claude Sonnet 5)

- **Survey first.** Read the F3.1–F3.5 logs plus the live code before writing
  anything: `useFigurePage.ts`'s `buildSpec()` was ALREADY the one place that
  turns `slots` into a `FigurePageSpec` — both the debounced preview
  (`renderFigurePageBlob`) and file export (`exportFigurePage`) already called
  it, so "preview vs file export disagree" was not a live bug. There was no
  clipboard-copy action anywhere in the Figure Page workshop (`FigurePageView.tsx`
  had only "Export {FMT}"); the app's existing 300-DPI clipboard convention
  (A7) lives entirely in `lib/copyFigureCommand.ts` + `lib/clipboard.ts`,
  wired to the STAGE plot toolbar only (`usePlotStageActions.ts`) — nothing
  reused it for a composed page. Nothing let a SAVED page export without
  first reopening it into the workshop session (`store/pageDocuments.ts`'s
  `openPageDocument` only ever seeds a live session via `pageDocSeed`).
- **The real divergence, found by reading `panelResolve.ts`'s `panelFigure`
  line by line, not assumed from the plan text.** The "window" session-source
  branch hand-assembled a REDUCED `FigureSpec` from ~10 `PlotView` fields
  (x/y key, scale, fmt, step, title, labels, series styles) — while the
  "figure" branch (a saved canonical figure picked directly) already routed
  through F1.5's `buildFigureSpecFromDocument` adapter, which reads the FULL
  `FigureDocument` (error bindings, secondary axis, grouping, x-axis breaks,
  publication overrides, hidden/reordered series). Every `kind:"plot"` window
  has carried a live canonical `FigureDocument` since F1
  (`PlotWindow.document`, `store/windowDocuments.ts`'s `syncPlotWindow` keeps
  it current) — the ad-hoc branch simply wasn't using it. Net effect: a page
  panel sourced from an OPEN WINDOW silently dropped error bars, y2 state,
  groups, x-breaks, and overrides that the SAME window would preserve once
  saved and reopened as a "figure"-kind panel — a real, provable violation of
  the F3 exit criterion ("retains every panel, relationship, and visual
  setting"), and exactly the "parallel ad-hoc spec assembly" this item's own
  text warns against. Fixed by routing the window branch through the SAME
  `buildFigureSpecFromDocument(win.document, dataset, ...)` adapter the
  "figure" branch uses — see `panelResolve.ts`'s module header for the full
  before/after. The "figdoc" (legacy Publication figure) branch is
  UNCHANGED and stays ad hoc: F1 never gave that kind a `FigureDocument`
  counterpart at all (a pre-existing, already-documented gap from F3.1's own
  log), so there is no canonical adapter to route it through.
- **A real bug found while wiring the fix, not invented as scope creep: the
  #8g preview-invalidation fingerprint for a FOCUSED window's document
  infinite-loops React if built naively.** The first attempt fingerprinted
  the window branch on `windowsForSave().find(...).document` (mirroring the
  "figure" branch exactly) — this is safe when called from `panelFigure`
  (an ordinary async function), but `panelRenderInputs` runs inside a
  `useShallow` selector backing `useSyncExternalStore`, which React may call
  several times per commit to verify a stable snapshot. `windowsForSave()`
  reconstructs the FOCUSED window's document via `structuredClone` on every
  call, so two calls in the same tick are never `===`, and two of the
  existing `editSlot` tests failed with "Maximum update depth exceeded"
  (caught by the existing suite, not a new test — proof the guard works).
  Fixed by NOT calling `windowsForSave()` inside the selector: a non-focused
  window's stable `.document` reference is used directly (safe — it only
  changes via an actual store mutation that replaces it); the FOCUSED window
  instead lists the live singleton fields directly (stable references),
  extended from the pre-F3.6 field list to also cover error bindings,
  hidden/reordered series, and secondary-axis state — the same fields the
  fidelity fix newly makes visible. See `panelRenderInputs`'s doc comment for
  the full account, including the acknowledged residual (some live-focused
  fields, e.g. axis breaks/page-setup margins, are not in the tracked list —
  a preview-freshness gap only, since `buildSpec` always re-reads fresh state
  at export/copy time regardless).
- **Clipboard copy (item 3) — reuses A7's mechanism, not a new one.** New
  `copyNow` in the extracted `usePagePreviewExport.ts` calls the SAME
  `buildSpec()` the preview/export already share, then
  `copyImageAsync(renderFigurePageBlob({...spec, fmt:"png", dpi:300}))` —
  the identical gesture-preserving pattern `copyFigureCommand.ts` established
  (hand the PENDING render promise to the Clipboard API rather than awaiting
  it first) and the identical 300 DPI floor (`COPY_PAGE_DPI`, matching
  `COPY_FIGURE_DPI`). Checks `clipboardImageSupported()` BEFORE any render
  work, exactly like the single-figure command. File export stays vector
  (PDF) by default per the repo's export convention; copy is always raster
  (Office pastes vector poorly) — the same split the single-figure copy/export
  pair already makes. Wired as a new "Copy" button beside "Export" in
  `FigurePageView.tsx`.
- **Saved-page export (item 4) — shipped, not deferred; stayed cheap because
  it composes existing pieces.** New `buildPageSpecFromDocument` in
  `panelResolve.ts` walks a PERSISTED `PageDocument`'s panels through
  `resolvePagePanel` (F3.2's fail-closed resolver) and
  `buildFigureSpecFromDocument` (the SAME adapter the fidelity fix above
  uses) — so the Library "Export…" (⤓) action on `PagesSection.tsx` produces
  byte-identical output to reopening the page and exporting it, proven by a
  dedicated test suite (`panelResolve.test.ts`) rather than asserted. A
  dangling `figureId` or an adapter rejection (dataset gone, unsupported
  grouped+secondary-axis combination) throws naming the panel's own
  previewed label ("panel (b): ..."), never silently exports a smaller page.
- **F3 exit criterion — coded-and-tested, not owner-verified.** Added a
  direct round-trip test: build a window-sourced panel's spec, save the page,
  simulate close (unmount the hook) and reopen (seed + fresh mount), rebuild
  the spec, assert byte-for-byte equality. This is the strongest automated
  proof available for "save → close → reopen → export retains every panel,
  relationship, and visual setting" — but per this plan's own "Required
  acceptance journeys" section, only an owner-visible desktop run can check
  A6 (multi-panel journey). That box stays unchecked; this log states the
  automated status honestly instead of implying A6 is done.
- **Size discipline — `useFigurePage.ts` was at 483/500 (F3.5's own log
  flagged it), so it was 0 lines from the ceiling before this slice added
  anything.** Extracted the debounced preview effect, `buildSpec`, and
  `exportNow` (plus the new `copyNow`) to a new sibling
  `usePagePreviewExport.ts`, mirroring F3.4's "extract a cohesive slice"
  precedent (`panelResolve.ts`/`usePageLifecycle.ts`). `useFigurePage.ts`:
  483 → 336 lines (`wc -l`) before any F3.6 feature code density — the hook
  now only owns grid/slot/source-list state and delegates preview/export/copy
  to the new module. `calc/figure_page.py` needed NO backend change (stayed
  at its existing 361 lines) — F3.5 already carries every layout field over
  the wire, and the existing `/api/export/figure-page` route already renders
  PNG at any requested DPI, which is all the 300-DPI clipboard copy needed.
- **Tests:** `useFigurePage.test.ts` (+18: the fidelity-gap characterization
  test — error bindings absent before the fix, present after; the round-trip
  test; 4 `copyNow` tests — success via the shared `buildSpec`, capability
  check before any render, the same missing-source message export uses,
  the same plain "nothing assigned" message; plus 2 existing window-branch
  tests updated for the new canonical-adapter output shape: `x_log` → `x_scale`,
  and the "re-renders on view change" test now updates the window's
  `.document` alongside `.view`, matching how a real committed edit keeps
  both in sync); `panelResolve.test.ts` (new file, 5:
  `buildPageSpecFromDocument` null-when-empty, multi-panel with layout/output
  threading, dangling-figureId fails closed naming the panel, missing-dataset
  fails closed, sparse panels keep their true grid position);
  `PagesSection.test.tsx` (+3: exports using the page's own output settings,
  the no-panels status message, the dangling-reference failure message).
- **Gate:** Frontend — `npm run lint` clean (0 errors, 9 pre-existing
  unrelated warnings, unchanged baseline); full `npx vitest run` **396 files /
  5764 tests passed** (+1 file / +14 tests over F3.5's 395/5750); `npx tsc -b
  --noEmit` clean; `npm run build` clean, bundle 874.9 kB eager / 903.3 kB
  budget (28.4 kB headroom — the new modules land in the already-lazy-loaded
  Figure Page/Library chunks). Backend untouched this slice — no backend gate
  run (nothing to verify that the existing suite doesn't already cover).
- **F3 is now COMPLETE (F3.1–F3.6 all checked).** F4 (recipes/templates) is
  the only fully-open tier left in this plan besides F2's remaining broader-
  parity items; A1–A10 acceptance journeys remain owner-gated as always.

### 2026-08-07 — F3.5 complete layout controls (Claude Sonnet 5)

- **Survey first — nothing in this item's scope existed yet.** Read
  `SlotGrid.tsx`/`FigurePageView.tsx`/`useFigurePage.ts` (frontend) and
  `calc/figure_page.py`/`routes/export_page.py` (backend) before writing
  code: manual rearrangement did NOT exist (a filled `SlotGrid` tile had no
  `draggable`/`onDragStart` — only the source-list items did; a slot could
  only be reassigned by re-dragging a NEW source from the list, not by
  moving an existing panel); no spacing control existed anywhere
  (`SlotGrid`'s CSS grid used a hardcoded `gap: 6`, purely visual; the
  backend's grid path always called `fig.add_gridspec(rows, cols)` with no
  wspace/hspace); no link/unlink or shared-axis concept existed at either
  layer; no alignment control; the backend's grid path always hardcoded
  `layout="constrained"` with no alternative. This item is a from-scratch
  build, not a completion of partial work — confirmed by reading, not
  assumed from the plan text.
- **Schema decision — bump `PAGE_DOCUMENT_VERSION` 1 -> 2, mirroring
  `FigureDocument`'s own v1->v2 precedent (F2.1a), NOT F3.3's
  additive-no-bump precedent.** F3.3's `createdAt`/`modifiedAt` were purely
  informational (zero render-semantics impact), so they landed as additive
  fields. `layout` is the opposite case explicitly flagged by this task:
  `linkX`/`linkY`/`resizeMode`/gaps change what the exported page LOOKS
  LIKE. The risk a version bump defends against is a genuinely OLDER,
  already-shipped Quantized build silently loading a newer `.dwk` and
  dropping the user's link/gap/resize choices with no warning — exactly
  what `figureDocument.ts`'s F2.1a comment names as the reason for its own
  bump ("older builds must reject, rather than silently strip, fields they
  do not understand"). Implemented identically to that precedent:
  `sanitizePageDocument` accepts `version === 1 || version === 2` (a v1
  document migrates, reading `layout` only when `version === 2` — a v1
  envelope that happens to carry a `layout`-shaped key, e.g. hand-edited or
  corrupted, is never read, proven by a dedicated test), always WRITES
  `version: 2` back out (auto-upgrades on next save), and rejects `version
  >= 3` outright (`sanitizePageDocuments` skips it, keeping valid
  siblings) — the existing "future version" tests in `pageDocument.test.ts`
  and `workspace.test.ts` had hardcoded `version: 2` as the "future" probe
  value from when 2 WAS future; both updated to `version: 3` (found by a
  full-suite run, not anticipated in advance — the exact "verify before
  trusting green" class).
- **Link-group design — page-wide "link all" / "unlink all", NOT
  arbitrary per-row/per-column groups.** The task explicitly offered this
  choice; picked the minimal core because (a) it is exactly what A6 (the
  plan's own acceptance journey: "Build a 2x2 page, link then unlink axes")
  needs and nothing more, (b) matplotlib's native `sharex=`/`sharey=`
  mechanism makes "link all" a ~10-line pure function
  (`figure_page_layout.share_targets`: every panel after the first shares
  with panel 0) with zero new schema shape, while per-row/col groups would
  need a group-id-per-panel schema and a UI for assigning panels to groups
  — real added complexity for a capability the acceptance journey doesn't
  ask for. Residue named honestly below, not silently dropped.
- **"Recommended resize modes" — researched, not guessed (the task's own
  instruction).** The phrase has no prior use anywhere in this codebase or
  plan. Delegated to `analysis-software-expert` to check OriginPro's Layout
  Page vocabulary before implementing: Origin actually splits this across
  TWO orthogonal concepts — layer/page **spacing** (`Layer Management`'s
  Horizontal/Vertical Gap, `Fit Page to Layers`'s Margin Control
  Border/Tight) and **element scaling** on resize (`Plot Details` Size
  tab's "Scale With Layer Frame" vs "Fixed Factor" — whether fonts/line
  widths grow with the panel or stay pixel-fixed). Implemented the first
  (spacing/layout-engine choice) as `resizeMode: "constrained" | "tight" |
  "none"`, mapped directly onto matplotlib's OWN real layout-engine
  vocabulary (`Figure.set_layout_engine` accepts exactly these names) —
  "constrained" (default/recommended: auto-avoids overlapping titles/labels
  while still respecting an explicit gap, since gridspec wspace/hspace are
  an ADDITIVE floor under constrained layout) / "tight" (recommended when
  minimizing whitespace matters more — trims the bounding box post-layout;
  an explicit gap is NOT honored in this mode, a named tradeoff, not a
  silently dropped setting) / "none" (fixed manual spacing, what free
  page-coordinate placement has always used implicitly). Origin's SECOND
  concept — element scale-with-frame vs fixed-factor — is NOT built here:
  it would require decoupling font/line-width size from the whole
  publication-style pipeline (`calc/figure_styles.py`), a materially larger
  feature the plan's own bullet list already separates from "adjustable
  spacing" and "recommended resize modes" by listing them as distinct
  items; named as residue, not conflated with what shipped.
- **Manual rearrangement — does the label follow the panel or the slot
  position? The panel.** New `lib/figurepage.ts` `moveSlot(slots, i, j)`
  swaps the WHOLE `PageSlot` record (source + label + title) as one unit —
  deliberately DIFFERENT from the existing `assignSlot`'s "move" semantics
  (re-dragging a source-list item that's already assigned elsewhere only
  relocates `source`, leaving each slot's own label/title override
  behind). Justified from how auto-lettering already works: the letter
  sequence ("(a)", "(b)", ...) is ENTIRELY a function of grid placement
  order — a panel dragged from position 0 to position 3 automatically gets
  whatever letter position 3 implies, nothing to decide there. The only
  real question is the EXPLICIT override a user typed in ("(iv) Special
  result"): that caption describes the PANEL'S CONTENT, not the grid cell
  it happens to occupy, so it travels with the panel — matching how
  PowerPoint/Word treat a moved object's own caption, and avoiding the
  surprising alternative (moving panel A into panel B's old slot silently
  inherits B's leftover caption on A's content). `assignSlot`'s different
  behavior stays as-is: it is "put THIS source into this slot" (a content
  pick, where the position's own caption is legitimate to keep), a
  different interaction from "move this existing panel, caption included."
- **Drag + keyboard, mirroring SlotGrid's existing F3.4 conventions.** A
  filled tile is now `draggable`, writing its own index as a NEW
  `PANEL_SLOT_MIME` payload; `onDrop` checks it FIRST, falling back to the
  existing `PANEL_SOURCE_MIME` (source-list drag) so the two drag kinds can
  never be confused — proven by a regression test asserting each MIME kind
  calls only its own handler. Keyboard: Shift+Arrow (a spreadsheet
  "move-selected-row" idiom) moves the FOCUSED panel one grid step in that
  direction via the same `onMoveSlot`, no-ops on an empty slot or a grid
  edge (`lib/figurepage.ts`'s new `gridNeighborIndex`), and follows DOM
  focus to the panel's new tile so repeated presses keep moving the same
  panel — chosen over inventing a separate "pick up / arrow / drop" grabbed
  -mode (the react-beautiful-dnd keyboard-sensor pattern) as unnecessary
  complexity once a direct swap-in-one-keypress does the same job. Plain
  Arrow (no Shift) is deliberately inert — this slice doesn't add grid
  focus navigation, only the move gesture the task asked for.
- **Backend split — new sibling `calc/figure_page_layout.py`, NOT grown
  inline.** `figure_page.py` was already at 449/500 lines. `validate_layout`
  /`layout_engine_kwargs`/`share_targets` (the pure gap-validation,
  matplotlib-layout-engine-kwarg, and axis-share-index math) moved to the
  new module; `figure_page.py` itself only gained the signature threading,
  the `sharex`/`sharey` wiring in its axes-construction loop, and the
  `fig.align_labels()` call — landing at **492/500 lines** (8 headroom),
  never approaching the ceiling despite the real feature surface. All five
  new params (`row_gap`/`col_gap`/`link_x`/`link_y`/`align_labels`/
  `resize_mode`) default to today's EXACT rendering — proven by a
  byte-identical test at both the calc and route level (mirrors this
  file's own `test_no_y2_mask_is_byte_identical_to_omitting_it` precedent).
- **Frontend size ratchet — `lib/api.ts` was AT its 1828-line pin (zero
  headroom); F3.5's 8 new `FigurePageSpec` fields would have pushed it to
  1836.** Extracted the whole figure-page wrapper block (`PagePanelSpec`,
  `FigurePageSpec`, `exportFigurePage`, `renderFigurePageBlob`) to a new
  `lib/api/figurePage.ts`, re-exported from `api.ts` — the SAME template
  `api/plot.ts`/`api/stats.ts` already established for this exact
  situation. `FigureSpec` (defined in `api.ts` itself) is imported into the
  new sibling as `import type` only — erased at compile time, so there is
  no runtime circular dependency, verified by a clean `tsc -b --noEmit`.
  Net result: `api.ts` DROPPED to 1782 lines (46 headroom, pin lowered to
  match, `architecture.test.ts` updated) despite the net-new fields —
  offsetting a pin overrun with a real extraction rather than trimming
  comments to survive at the wire, per this repo's own ratchet discipline.
- **`useFigurePage.ts` landed at 483/500 lines** (445 after F3.4) — under
  the habit ceiling but the closest this file has been to it. Not split
  this slice (the new surface — one `setLayout` patch-setter instead of six
  field setters, one `moveSlot` wrapper — is already about as compact as it
  can be without a new extraction); logged rather than silently left for a
  future session to discover, per this plan's own discipline.
- **Deliberately out of scope, named honestly:**
  - F3.6 (export from PageDocument) remains fully open.
  - Per-row/per-column (or arbitrary) axis link GROUPS — only page-wide
    link-all/unlink-all shipped; see the link-group design note above.
  - Origin's "Scale With Layer Frame vs Fixed Factor" element-scaling
    behavior on resize — a different, larger concept than the spacing/
    layout-engine `resizeMode` that shipped; see the resize-mode note above.
  - The interactive `SlotGrid` assignment UI's own CSS `gap` was NOT wired
    to `layout.rowGap`/`colGap` — that grid is a lightweight assignment
    surface, not a pixel-accurate preview (the server-rendered PNG below it
    already is); conflating the two would misrepresent the assignment UI as
    WYSIWYG when it never has been.
  - Explicit per-panel axis-limit overrides (`overrides.x_lim`/`y_lim`) can
    still win over a page-wide link, since matplotlib's shared-axis state is
    one underlying object per link group and `_apply_overrides` runs last,
    per-panel, in placement order — a real, documented interaction (last
    panel's explicit override wins for the whole group), not a bug, and not
    solved here (solving it generally needs a link-vs-override precedence
    rule this task didn't ask for).
- **Tests:** backend — `test_calc_figure_page_layout.py` (new file, 15:
  `validate_layout`/`layout_engine_kwargs`/`share_targets` pure-math
  coverage); `test_calc_figure_page.py` (+10: byte-identical defaults,
  explicit-gap changes the render, tight/none resize modes render, unknown
  resize_mode and out-of-range gap raise, link_x/link_y actually share
  `get_xlim()`/`get_ylim()` across panels via `_build_page_figure`, the
  unlinked default is byte-identical, `align_labels` runs without error,
  free placement ignores gap/resize_mode but still honors links);
  `test_api_export_page.py` (+4: layout fields render at the route, unknown
  resize_mode and out-of-range gap 422, route-level byte-identical
  defaults). Frontend — `lib/pageDocument.test.ts` (+8: DEFAULT_LAYOUT on
  create, partial-layout override, v1->v2 migration to DEFAULT_LAYOUT, a v1
  envelope's layout-shaped junk is ignored not read, a valid v2 layout
  passes through, a malformed v2 layout degrades field-by-field, explicit
  `null` gap preserved as auto (not coerced to a fallback number), JSON
  round trip of a non-default layout; 2 existing "future version" tests
  updated 2->3); `lib/figurepage.test.ts` (+5: `moveSlot` swaps the whole
  record/moves onto empty/no-ops out-of-range, `gridNeighborIndex` computes
  every direction and returns null at every edge); `useFigurePage.test.ts`
  (+5: `moveSlot` swaps + follows selection, DEFAULT_LAYOUT flows through
  `buildSpec` as byte-identical defaults, `setLayout` patches only given
  fields, a customized layout threads through `buildSpec`, a layout change
  re-renders the debounced preview like a style change does; 1 existing
  test's hardcoded `version: 1` updated to 2); `SlotGrid.test.tsx` (+8: a
  filled slot is draggable/an empty one isn't, dragstart writes its own
  index as `PANEL_SLOT_MIME`, dropping it elsewhere calls `onMoveSlot` not
  `onDropSource`, a `PANEL_SOURCE_MIME` drop still calls `onDropSource` not
  `onMoveSlot`, Shift+ArrowRight moves the focused panel, Shift+Arrow at a
  grid edge and on an empty slot are no-ops, a plain Arrow key never
  triggers a move); `workspace.test.ts` (1 existing "future version" test
  updated 2->3, found by the full-suite run).
- **Gate:** Backend — `uv run pytest -q`: **3851 collected, 3774 passed, 69
  skipped, 8 xfailed, 0 failed** (no shrinkage from the pre-slice baseline);
  `ruff check src tests` clean; `mypy src` clean (249 source files).
  Frontend — `npm run lint` clean (0 errors, 9 pre-existing unrelated
  warnings, unchanged from F3.3/F3.4's baseline); full `npx vitest run`
  **395 files / 5750 tests passed**; `npx tsc -b --noEmit` clean; `npm run
  build` clean, bundle 874.6 kB eager / 903.3 kB budget (28.7 kB headroom).
- F3.5 is now checked. F3.6 (export from PageDocument) is the only item
  left open in F3.

### 2026-08-06 — F3.4 unified panel editing (Claude Sonnet 5)

- **Size discipline first (separate commit).** `useFigurePage.ts` was 736
  lines (flagged by F3.3's log, not acted on). Extracted, zero behavior
  change: `panelResolve.ts` (panel-source id resolution + single-panel
  FigureSpec building — `resolveSlotFigureId`, `stripPageIncompatibleOverrides`,
  `panelFigure`, `panelRenderInputs`) and `usePageLifecycle.ts` (the save/
  dirty/reopen half — `pageDocument` projection, F3.3's unresolved-slot
  Save gate, dirty predicates, Save/Save As/close-confirm, the `pageDocSeed`
  reopen effect). `useFigurePage.ts`: 736 -> 374 lines before any F3.4 code;
  445 after. Full frontend gate green on both commits.
- **The unification decision (the plan's own open question) — KEEP the
  three-kind session-source model (window/figdoc/figure); do NOT collapse
  pickable sources to "canonical figures only".** F3.1's log deliberately
  deferred this to F3.4 "once a save/promote path exists" — F3.3 built that
  path (Save blocks on an unresolved slot and names the exact fix). Having
  the path available does not, on inspection, obligate REMOVING the
  alternative sources: nothing in F3.4's stated scope (double-click edit,
  unlink/duplicate-for-page) requires it, and doing so would drop a
  currently-working capability F3.1's log explicitly warned against (open
  windows and legacy Publication figures are still real, useful panel
  sources — a plot doesn't stop being pickable just because it hasn't been
  saved as a canonical figure yet). What genuinely unifies this slice is the
  EDITING interaction, not the source list: every panel kind now gets
  exactly ONE double-click/context-menu entry point (never a silent no-op),
  and every kind's menu steers toward acquiring — or, for a "figure" kind,
  already having — a durable canonical identity:
  - **figure** kind: double-click/"Edit figure" opens the editable figure
    for editing (`openEditableFigure`, F1.4) — already durable, nothing to
    convert.
  - **window** kind: double-click/"Focus window" raises (and un-minimizes)
    its window; a new "Save as editable figure" menu entry runs the SAME
    action its title-bar Save button does (`saveFigure`) directly from the
    panel, so resolving F3.3's unresolved-slot Save block no longer requires
    hunting for the window itself. The slot's kind stays "window" — no
    reassignment needed, since `resolveSlotFigureId` already re-checks
    `editableFigures` on every read (F3.1).
  - **figdoc** kind: double-click/"Create editable copy" runs the existing
    promotion (`promoteLegacyFigureDoc`, F2.1c) AND repoints THIS slot at
    the new copy in one step (the Library's own "Editable" button performs
    the same promotion with no slot to repoint) — converts the panel
    straight from non-durable to durable without a second manual
    reassignment.
  - **missing** status (any kind): never a dead end, but also never an
    invented edit target — the menu offers ONLY "Clear panel" (the existing
    × chip's action), since there is nothing left at the far end of a
    dangling reference to open/promote/duplicate.
  - The tooltip on a window/figdoc-kind tile now also names its transient
    (not-yet-durable) status directly ("— open window, not yet a saved
    figure" / "— Publication figure (export-only); double-click to make it
    editable"), so the distinction is visible on the grid itself, not only
    surfaced lazily by F3.3's Save-time block message.
- **Unlink / duplicate-for-page** (a `figure`-kind panel only — the only
  kind with a real duplicable identity; a window has no saved copy to
  duplicate, and a figdoc's "copy" IS what the promotion above performs):
  "Duplicate for this page" calls `duplicateEditableFigure` (one undoable
  store mutation, F1.4) and repoints THIS panel at the copy via the
  existing `assign`, so editing the copy afterward no longer touches the
  original or any OTHER page still referencing it — literal unlink-via-copy
  semantics, named in the UI the way the plan states it.
- **Preview invalidation (item 3) — verified, not fixed.** Traced whether
  editing a referenced canonical ("figure"-kind) figure and re-saving it
  reaches the page preview: `panelRenderInputs`'s existing "figure" branch
  (`lib/figurepage`/now `panelResolve.ts`) already tracks the DOCUMENT
  OBJECT itself (not just its id), and every store action that edits a
  saved `editableFigures` entry (`saveFigure`, rename, `duplicateEditableFigure`,
  `applyFigurePublicationEdit`'s "new-editable" target) replaces it with a
  new reference via `.map()`/spread rather than mutating in place — so the
  `useShallow`-compared render-input array already changes reference and
  re-triggers the debounced preview fetch. This was true before this slice
  but had ZERO test coverage (the existing #8g "re-renders when an assigned
  saved figure (doc) is edited" test exercises the OLDER "figdoc" branch,
  not the F3.3 "figure" one) — added the missing characterization test
  rather than "fixing" a bug that, on inspection, doesn't exist. No
  production code changed for this item.
- **F3.3 residue (Library rename while open) — carried forward, NOT fixed
  here.** F3.3's log flagged that renaming a page in the Library while that
  SAME page is open in the workshop doesn't live-sync (the session's `name`
  is local React state; the next Save from the stale session overwrites the
  Library rename). This slice's editing unification touches panel SOURCES
  (`slots`), not the page-level session identity/name, so the gap doesn't
  fall out of anything built here — `usePageLifecycle.ts`'s `draft` state is
  the exact same local-React-state model F3.3 left in place, just relocated
  to its own module. Still narrow and low-frequency (requires renaming a
  page from the Library while it is ALSO the one open in the workshop). Real
  fix needs the session to read its name reactively from `store.pages`
  instead of a local snapshot — deferred, named honestly rather than
  silently dropped a second time.
- **F3.5 (layout controls) and F3.6 (export from PageDocument) remain fully
  open** — untouched by this slice.
- **Tests:** `panelMenu.test.ts` (new file, 11: `primaryPanelAction`
  null-for-empty/null-for-missing/dispatch-per-kind; `buildPanelMenuItems`
  empty-for-unassigned, Clear-only-for-missing, full per-kind item lists +
  their `run` wiring); `SlotGrid.test.tsx` (new file, 20: double-click
  dispatch per kind incl. no-op for empty/missing, right-click menu
  contents + item clicks incl. missing-shows-only-Clear and
  empty-opens-no-menu, keyboard ContextMenu-key/Shift+F10/Enter/Delete/
  Backspace incl. Enter-no-ops-when-missing and Delete-no-ops-when-empty,
  the transient-tooltip cases including "frozen wins over transient" and a
  durable figure-kind panel carrying no note); `useFigurePage.test.ts`
  (+8: `editSlot` for figure/window/minimized-window kinds, `promoteSlot`
  converting+repointing a figdoc slot, `duplicateForPage` duplicating+
  repointing a figure slot and its no-op on window/figdoc kinds,
  `saveSlotAsFigure` saving a window slot's document (auto-resolving next
  read, no reassignment) and its no-op on figure/figdoc kinds, plus the
  figure-kind preview-invalidation characterization test above).
- **Gate, both commits:** `npm run lint` clean (0 errors, 9 pre-existing
  unrelated warnings); full `npx vitest run` green — 393/5684 after the
  refactor commit (unchanged from F3.3's baseline, confirming zero behavior
  change), 395/5724 after the feature commit; `npm run build` clean, bundle
  873.6 kB eager / 903.3 kB budget (unchanged — all F3.4 code lives in the
  already-lazy-loaded Figure Page workshop chunk); `npx tsc -b --noEmit`
  clean on both.
- F3.4 is now checked.

### 2026-08-06 — F3.3 page save/reopen lifecycle (Claude Sonnet 5)

- **Unresolved-slot Save policy (the core design decision) — BLOCK, with a
  specific per-slot message, never save-with-empty-panel.** A filled slot
  whose session source has no canonical `figureId` yet (an open plot window
  never saved as an editable figure, or a legacy Publication figure — F1
  never gave that kind a FigureDocument counterpart at all) refuses Save
  entirely rather than persisting `figureId: null` for that panel — silently
  dropping it is exactly the F3.2 failure this item exists not to repeat.
  Chose blocking over "save with a warning" because it matches every other
  save-refusal precedent already in this codebase
  (`applyFigurePublicationEdit`'s missing-dataset/missing-snapshot checks,
  `promoteLegacyFigureDoc`'s source-unavailable check) — none of them save a
  degraded document and warn after the fact. Investigated whether a "save
  this window's figure into the Library" action already exists (F1.4): yes
  (`saveFigure`/the title-bar Save button), and the block message for a
  window-sourced slot names it directly ("save it (its title-bar Save
  button, or File > Save Editable Figure), then Save this page again") —
  once that figure is saved, the SAME slot assignment auto-resolves next
  render (no reassignment needed, since `resolveSlotFigureId` re-checks
  `editableFigures` on every recompute). A figdoc-sourced slot's message
  instead points at F1.4's other existing action, "Create editable copy"
  (SavedFiguresSection's "Editable" button), because a figdoc can NEVER
  resolve on its own — the user must assign the resulting copy to the slot.
  A "figure"-kind slot (a saved figure picked directly, or a reopened page's
  hydrated panel) is NEVER blocking, even once its target is deleted: it
  already carries a real canonical id, so Save persists that reference
  as-is and it resolves through `resolvePagePanel` to `{status:"missing"}`
  on its next read — F3.2's fail-closed contract, not a reason to block.
- **Reopen source-model choice — one new session source kind, not full
  unification (deferred to F3.4, per F3.1's own log).** `lib/figurepage.ts`'s
  `PanelSourceKind` gained `"figure"` alongside the existing `"window"` and
  `"figdoc"` — a saved `editableFigures` entry picked directly. A reopened
  `PageDocument`'s panels ONLY ever reference a canonical `figureId` (F3.1/
  F3.2), so every occupied panel hydrates to this new kind
  (`store.openPageDocument` seeds `pageDocSeed`; `useFigurePage.ts`'s effect
  consumes it once, mirroring `useFigureBuilder.ts`'s existing `figureDocSeed`
  pattern exactly — including its "unconditionally overwrite the current
  session" behavior on a new seed, not a new confirm surface). Rendering a
  "figure"-kind panel reuses F1.5's `buildFigureSpecFromDocument` adapter
  UNCHANGED — the same one Publication Preview's export/copy already uses —
  so a page panel sourced from a saved figure renders identically to opening
  that figure on its own. Its `x_breaks`/`margins` overrides are stripped
  (page-incompatible, a 422 otherwise) via a new shared
  `stripPageIncompatibleOverrides` helper, deduplicating what used to be a
  figdoc-only inline destructure. `resolvePanelSource` gained a 5th,
  DEFAULTED (`= []`) `editableFigures` parameter rather than being inserted
  positionally, so every pre-F3.3 call site (including all of
  `lib/figurepage.test.ts`'s existing cases) keeps compiling and behaving
  identically without being touched.
- **Dirty state — two predicates, mirroring `figureLifecycle.ts`'s corrected
  convention, not its original one.** `pageDocumentDirty` (broad: true when
  never saved OR a saved page has drifted) drives the Save affordance's name
  + "•" cue in the ToolWindow title, matching `editableFigureDirty`.
  `pageDocumentHasUnsavedEdits` (narrow: false for a page never saved at
  all) gates the close-confirm — deliberately the CORRECTED convention the
  2026-08-01 adversarial review arrived at for editable figures
  (`editableFigureHasUnsavedEdits`, after finding the broader predicate
  popped a confirm on every routine never-saved close), applied here from
  the start rather than rediscovered. A fresh, never-saved page still
  discards plainly on close — the pre-F3.3 "this composition is temporary"
  note now shows CONDITIONALLY (only while `!everSaved`) instead of always,
  since it stopped being universally true the moment Save existed.
- **Schema addition — `createdAt`/`modifiedAt`, no version bump.** Purely
  informational timestamps (recency sorting only, zero render-semantics
  impact) are additive to `PageDocument` without bumping
  `PAGE_DOCUMENT_VERSION` — unlike `FigureDocument`'s v1->v2 `publication`
  field, which changes what a document RENDERS AS and so genuinely needed a
  version fork. The sanitizer defaults an absent value to the Unix epoch
  (not "now"), so a genuinely undated pre-F3.3 document — none has actually
  been written yet; F3.1/F3.2 shipped the schema before any writer existed —
  sorts LAST in a recency list rather than first. `modifiedAt` is stamped by
  the store's save actions (`store/pageDocuments.ts`), never by the pure
  `createPageDocument` constructor, mirroring `lib/plotspec.ts`'s
  `SavedPlotSpec`/`store/graphBuilder.ts` split.
- **A real bug found and fixed while building the fix, not just the intended
  feature:** the session draft's id (`DRAFT_PAGE_ID`) was a SHARED LITERAL
  constant ("figurepage-draft") reused by every never-saved session, on the
  reasoning that "this hook has at most one page open at a time." But
  `savePage` upserts `store.pages` BY ID — so saving a fresh page A, closing,
  opening a SECOND fresh page B (same literal id), and saving B would
  silently overwrite A's saved entry instead of creating a second one.
  Fixed with a per-mount counter (`nextDraftId()`), the same pattern
  `figureLifecycle.ts`'s `nextFigureId()` already uses for exactly this
  reason.
- **Library section:** new `components/Library/PagesSection.tsx`, mirroring
  `EditableFiguresSection.tsx`'s list/rename/duplicate/delete pattern
  (confirm + Undo via the existing history snapshot — `pages` already rides
  it, F3.1), lazy-loaded the same way. Listed most-recently-modified first
  (`modifiedAt` descending) — F3.3's minimal take on "recent access": a
  plain sort by the new timestamp field, no separate recency index.
- **Deferred, named honestly:**
  - F3.4 (unify panel editing — double-click a panel to edit its referenced
    figure, explicit unlink/duplicate-for-page) and F3.5 (layout controls)
    remain fully open, as does F3.6 (export from PageDocument specifically —
    export today still goes through the SESSION model's `buildSpec`, not a
    reopened `PageDocument` directly; the two happen to agree today because
    reopening fully hydrates the session, but F3.6 is the item that commits
    to that path explicitly).
  - Renaming a page via the Library while that SAME page happens to be open
    in the Figure Page workshop does not live-sync into the open session —
    the session's `name` is local React state (this hook's model predates a
    store-backed session, and F3.3 deliberately did not restructure it into
    one; that is F3.4/full-source-model-unification territory). The next
    Save from that stale session would overwrite the Library rename with
    the session's own (older) name. Narrow and low-frequency (requires
    renaming a page from the Library while it is ALSO the one open in the
    workshop), not fixed in this slice.
  - `components/workshops/figurepage/useFigurePage.ts` is now 736 lines
    (`wc -l`), unpinned by any ratchet (`MODULE_PINS` covers specific listed
    `.ts` files only, not every workshop hook) but above the 500-line
    habit — the SAME already-acknowledged-but-unaddressed class as
    `useFigureBuilder.ts` (615) and `useGraphBuilder.ts` (662; flagged in
    this plan's 2026-08-01 review log as a booked follow-up, not yet acted
    on). Not fixed here — a rushed split at the end of an already large,
    fully-green slice risked more than it saved — but logged rather than
    left silently discovered later, per this plan's own discipline.
- **Tests:** `lib/pageDocument.test.ts` (+9: createdAt/modifiedAt stamping/
  sanitization/epoch-fallback, `pageDocumentDirty`/`pageDocumentHasUnsavedEdits`
  across never-saved/clean/drifted); `lib/figurepage.test.ts` (+5:
  `resolvePanelSource`'s new "figure" kind across omitted-param/live/frozen/
  missing/dataset-removed); `store/pageDocuments.test.ts` (new file, 14:
  save insert/update-in-place/undo, Save As new-id/blank-name-rejection,
  rename/duplicate/delete/undo, `openPageDocument` seed/not-found/clear, and
  a `.dwk` serialize/parse round trip); `components/workshops/figurepage/
  useFigurePage.test.ts` (+14: figureSources enumeration, Save blocked for
  an unsaved window and for a figdoc with the exact expected messages, Save
  succeeding + clearing dirty, re-dirtying after a further edit, Save As
  rebind, reopen restoring grid/output/panel references, reopen of a page
  whose figure was since deleted surfacing as missing-not-dropped and
  surviving a re-save, and `requestClose`'s three branches: never-saved
  discards plainly, a saved-and-drifted page gates + respects cancel/
  confirm, an unmodified reopened page closes plainly);
  `components/Library/PagesSection.test.tsx` (new file, 7: empty state,
  recency ordering, open/reopen, rename, duplicate, delete + cancel).
- **Gate:** `npm run lint` clean (0 errors, 9 pre-existing unrelated
  warnings); full `npx vitest run` 393 files / 5684 tests passed; `npm run
  build` clean, bundle 873.5 kB eager / 903.3 kB budget (29.8 kB headroom;
  +2.3 kB over the F3.2 baseline — only the store-composed
  `pageDocuments.ts`/`pageDocument.ts`/`figurepage.ts` additions are eager,
  everything else (the workshop hook/view/PagesSection) is already
  lazy-loaded); `npm run typecheck` (`tsc -b --noEmit`) clean.
- F3.3 is now checked. F3.4 (unify panel editing) and F3.5 (layout controls)
  remain fully open; F3.6 (export from PageDocument) is open and now has a
  reopened session to actually export from, which it didn't before this slice.

### 2026-08-06 — F3.2 missing-source and frozen-snapshot panel semantics (Claude Sonnet 5)

- **What F3.1 already covered (verified by reading it, not re-done):** the
  "reference by id, never flatten" contract itself. `PagePanel.figureId` is
  ID-only; `resolvePagePanel` was already the fail-closed resolver for a
  PERSISTED panel, returning `{status:"missing"}` for a dangling id (never
  silently "empty", never dropped) — that data-level contract needed no
  changes. What F3.1 explicitly left open was surfacing that behavior
  anywhere a person could see it, plus the session-level (pre-F3.3) model
  that the actual running Figure Page workshop uses today.
- **The real remaining gap, found by reading the live workshop, not the
  schema:** nothing yet loads a persisted `PageDocument` back into an editable
  workshop session (`store.pages` has no Save/reopen UI — that is F3.3, and no
  double-click/reassign panel editor — that is F3.4, both correctly out of
  this slice's scope). So `resolvePagePanel`'s "missing" status has no live
  caller in the app yet. The workshop that DOES run today (`useFigurePage.ts`)
  uses an OLDER, separate session model — `PanelSource` (an open plot window
  or a legacy `figureDocs` entry) assigned into `PageSlot`s — and THAT model
  had the exact bug class F3.2 exists to prevent, live and reachable:
  `SlotGrid` rendered `slot.source.name` unconditionally once assigned, with
  no check that the window/figdoc it pointed at still existed. Closing the
  window or deleting the figdoc left the tile looking like a perfectly normal
  panel until the whole page's preview/export failed.
- **Two real bugs found and fixed while building the fix, not just the
  intended surfacing:**
  1. The preview `useEffect` unconditionally called `setError(null)`
     immediately after `buildSpec()` had already called `setError(<specific
     "slot N: source ... no longer exists" message>)` for a dead source — so
     the message was set and then clobbered back to null in the same tick,
     and the preview pane silently fell back to the plain "assign plots to
     grid slots" empty-state text. Exactly the "render a hole without
     explanation" failure mode this item rules out. Fixed by only clearing
     `preview`, not `error`, in that branch (see the comment at the fix site,
     `useFigurePage.ts`).
  2. `exportNow()` reported the same "assign at least one panel to export a
     figure page" status whether NOTHING was assigned or something WAS
     assigned but had gone missing — actively misleading in the second case.
     Fixed by checking `filledCount(slots) === 0` first and giving a distinct,
     accurate message when `buildSpec()` fails for a different reason.
- **Missing-source, surfaced (item 1):** new `resolvePanelSource` in
  `lib/figurepage.ts` re-checks a slot's assigned `PanelSource` every render
  using the EXACT SAME renderability rules `windowSources`/`docSources`
  already use to decide what's pickable (a window must still be a
  dataset-bound plot; a figdoc must still be `docRenderable`) — "can I assign
  it" and "is it still valid" can't drift apart. `useFigurePage.ts` exposes
  the per-slot result as `sourceStatuses`; `SlotGrid.tsx` renders a `missing`
  status as a labeled, danger-colored warning tile ("⚠ missing: <stale
  name>") instead of a normal-looking panel, keeps the existing × clear
  affordance reachable, and the page-level failure (preview/export) now
  surfaces the SAME specific message instead of a generic one (the two bugs
  above).
- **Frozen-snapshot, defined and surfaced (item 2):** decided the contract —
  a panel's live/frozen cue is inherited ENTIRELY from whatever it currently
  resolves to; the page layer defines no second freeze mechanism (per the
  plan's explicit instruction). Implemented at BOTH layers this slice
  touches: `resolvePanelSource`'s `lifecycle: "live" | "frozen"` for the live
  session (`window.document.data.mode`, or a legacy figdoc's `.live` flag),
  surfaced in `SlotGrid` as a small "❄" glyph + tooltip; and
  `pagePanelLifecycle(resolution)` in `lib/pageDocument.ts` for the PERSISTED
  layer, reading `FigureDocument.data.mode` straight off whatever
  `resolvePagePanel` resolved — ready for F3.3/F3.4 to surface without
  redefining the contract, though nothing calls it live yet (same "no UI path
  exists yet" gap as the missing-source persisted case above).
- **Referential integrity at the delete site (item 3):** new
  `pagesReferencingFigure(pages, figureId)` in `lib/pageDocument.ts` finds
  every persisted page and panel (by previewed label, e.g. "(a)") that
  references a figure. Wired into `EditableFiguresSection.tsx`'s existing
  delete confirm (mirroring its established pattern — this is the ONE place
  in the codebase that already confirms before an unrecoverable-without-undo
  removal): the confirm message now names the affected page(s)/panel(s) when
  any exist. The delete itself still never cascades — `deleteEditableFigure`
  is unchanged; a referencing panel's `figureId` simply dangles and resolves
  to `{status:"missing"}` on its next read, exactly like any other stale
  reference (fail closed, not dropped).
  - **Deliberately NOT extended to the active in-session workshop draft:**
    the plan text asks to warn on "the active page draft (or any stored page
    in store.pages)". Traced why the ACTIVE draft needs no equivalent check
    for `editableFigures` deletion specifically: a "window"-sourced slot in
    the live session renders from the window's OWN live view, never through
    the `editableFigures` id (`resolveSlotFigureId`, F3.1) — deleting the
    saved copy does not touch the open window's rendering at all, only
    silently changes what a FUTURE save-as-page-panel would reference (a
    pre-existing, already-null-safe resolution, not a new break). There is
    nothing live to warn about there. The workshop's session state
    (`useFigurePage`'s slots) is also plain React-local state with no store
    presence a `deleteEditableFigure` caller could inspect even if there were.
  - **Deliberately out of scope, named honestly:** the legacy `figureDocs`
    ("Publication figures") delete site (`SavedFiguresSection.tsx`) has no
    equivalent warning, even though a "figdoc" session source IS the kind
    that can actually go missing live in today's workshop (confirmed by the
    new `resolvePanelSource` tests). `PageDocument.panels` deliberately never
    modeled figdoc references at all (F3.1: "F1 never gave it a
    FigureDocument counterpart") — extending referential-integrity warnings
    to that older, separate collection is a different, pre-F1 gap the plan
    doesn't ask this item to close, and doing it would have meant touching a
    file this slice has no other reason to change.
- **Tests:** `lib/figurepage.test.ts` (+11: `resolvePanelSource` for every
  empty/ok-live/ok-frozen/missing combination across both source kinds,
  including a live figdoc whose dataset alone was removed);
  `lib/pageDocument.test.ts` (+9: `pagePanelLifecycle`,
  `pagesReferencingFigure` across zero/one/multiple pages and non-matching
  ids); `useFigurePage.test.ts` (+6: `sourceStatuses` wiring, missing-on-
  window-close, missing-on-figdoc-delete, a fail-before/pass-after test for
  the error-clobbering bug with the fix reverted as the falsifying check, and
  both branches of the corrected `exportNow` status message);
  `EditableFiguresSection.test.tsx` (new file, 5 tests: plain delete, a
  referencing page named in the confirm message, delete-still-proceeds
  without cascading, cancel leaves the figure, empty-state render).
- **Gate:** `npm run lint` clean (0 errors, pre-existing unrelated warnings
  only); full `npx vitest run` 391 files / 5639 tests passed (one flaky,
  order-dependent failure in `useFigureBuilder.test.ts` on the first full run
  — unrelated to this slice, passed standalone and on a clean rerun);
  `npm run build` clean, bundle 871.2 kB eager / 903.3 kB budget (32.1 kB
  headroom, essentially unchanged — all new logic is in already-lazy-loaded
  workshop code plus small pure `lib/` additions).
- F3.2 is now checked. F3.3 (Save/Save As/dirty/library UI for pages) and F3.4
  (unify panel editing, double-click/unlink) remain fully open and are what
  would give the PERSISTED-layer missing/frozen contracts (`resolvePagePanel`,
  `pagePanelLifecycle`) their first live caller.

### 2026-08-05 — F2.4b direct-manipulation parity on the canonical draft (Claude Sonnet 5)

> **KNOWN FLAKE — RESOLVED 2026-08-09 (RSM_CUTS_PLAN #22).** Booked
> 2026-08-07 after two sightings: the "Apply commits legend drag …" test
> in `useFigureBuilder.test.ts` failed intermittently (`expected undefined
> to match { loc: 'custom' }`, i.e. the legend-drag pendingEdit missing at
> Apply) while passing standalone and on rerun. NOT an inter-test state
> leak as suspected here — reproduced directly with
> `--no-file-parallelism` (single file, no cross-worker contention: 1/30),
> so it was a race purely within the test: `await waitFor(() =>
> expect(renderFigureHitmap).toHaveBeenCalled())` only proves the debounced
> preview fetch STARTED, not that its resolved `hitmap` reached
> `result.current` — `dragElement` no-ops on a still-null hitmap. Fixed by
> adding the second, stronger wait (`await waitFor(() =>
> expect(result.current.hitmap).not.toBeNull())`) this file already used
> elsewhere, to the three tests missing it. Verified 0/90 at the same repro
> method post-fix. No production code changed.

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
