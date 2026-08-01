# Figure Authoring Workflow Plan

**Status:** Active
**Parent:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md`
**Created:** 2026-08-01
**Updated:** 2026-08-01 — initial read-only workflow audit and implementation plan
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
- [ ] **F0.3 Add compatibility reporting.** Before Graph Builder → publication
      preview, saved FigureDoc → graph, or any partial adapter, show which
      features cannot transfer. Do not silently drop secondary axes, errors,
      grouping/facets, annotations, shapes, formats, or series styles.
- [ ] **F0.4 Separate Library terminology.** Distinguish Saved Plot Recipes,
      Saved Figures, and multi-panel pages. Tooltips should state whether an
      item reuses data rules, preserves an editable result, or stores output.
- [ ] **F0.5 Add transition regression tests.** Pin user-facing labels,
      create/apply behavior, warnings, keyboard paths, and fail-closed rules.

**F0 exit:** A user cannot reasonably mistake a detached publication preview
for the editable internal plot, and no supported state disappears without a
specific warning.

### F1 — Establish one canonical editable FigureDocument

**Goal:** Give every editable plot a stable identity and lossless persistence.

**Recommended models:** GPT-5.6 Sol high / Claude Opus 4.8 for schema and
migration design; GPT-5.6 Terra high / Claude Sonnet 5 for bounded UI slices.

- [ ] **F1.1 Inventory and freeze the contract.** Produce a typed mapping table
      for every field in `PlotView`, `PlotSpec`, `FigureConfig`, `FigureDoc`,
      and `FigureSpec`; classify canonical, recipe-only, export-only, derived,
      or unsupported fields.
- [ ] **F1.2 Define a versioned FigureDocument.** Include stable ID/name,
      dataset bindings, plot type, channels/errors/groups/facets, axes and
      breaks, series state, legend, annotations/shapes, page/output settings,
      and migration behavior.
- [ ] **F1.3 Adapt existing plot windows.** A Stage/window plot should open and
      edit the FigureDocument rather than maintain a parallel authoritative
      copy. Preserve current interaction performance and view-history behavior.
- [ ] **F1.4 Add document lifecycle.** Implement Save, Save As, dirty state,
      close confirmation, update-in-place, duplicate, rename, and delete using
      normal workspace undo/recovery conventions.
- [ ] **F1.5 Make conversions reversible.** Provide one tested path among
      FigureDocument, interactive PlotView, and export FigureSpec. Where exact
      reversal is impossible, keep the original canonical field and derive the
      transport representation without deleting information.
- [ ] **F1.6 Migrate existing workspaces.** Load old PlotViews/FigureDocs
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
- [ ] **F2.2 Add Apply/Cancel semantics.** Preview changes live; Apply commits
      one undoable edit and Cancel restores the pre-dialog document.
- [ ] **F2.3 Reach full property parity.** Expose or link to plot type,
      channels, series, errors, y2, grouping/faceting, ordering/visibility,
      tick formats, breaks, shapes, and reference objects.
- [ ] **F2.4 Preserve direct manipulation.** Drag legend/annotations and
      double-click text on the live document, with matching property panels.
- [ ] **F2.5 Unify render paths.** Stage copy, Stage export, publication
      preview, saved preview, and reopen must derive from the same document and
      produce equivalent output.

**F2 exit:** Opening publication preview can no longer reduce a figure, and
every edit remains available in the internal plot after the dialog closes.

### F3 — Make multi-panel figures durable

**Goal:** A composed page is an editable project artifact, not a temporary
export session.

**Recommended models:** GPT-5.6 Sol high / Claude Opus 4.8 for PageDocument
ownership; Terra high / Sonnet 5 for panel-editor slices.

- [ ] **F3.1 Define and persist PageDocument.** Store ID/name, page geometry,
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
