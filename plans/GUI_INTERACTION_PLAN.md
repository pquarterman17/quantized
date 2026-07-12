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
**Updated:** 2026-07-12
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
- **Graph/Figure Builder** — plot construction, currently ephemeral.
- **History** (`store/history.ts`) — undo/redo, today scoped to DATA mutations
  only; visual/layout/organization edits are excluded by design.

### The central thesis
quantized has the individual gestures Origin has, but not one **object-editing
language**. An expert can be productive; the owner after weeks away, or a new
user, must remember too much. The return-on-effort is making existing
capability **visible, predictable, and reversible** — not adding algorithms.

### Default-tool readiness (condensed from the audit)
Highest return-to-Origin risk: **direct graph editing** (capable but hidden),
**undo/recovery** (strong for data, weak for visual/organizational), **buttons &
tooltips** (dense, icon-only), **reusable graph construction** (Graph Builder is
ephemeral). Lower risk: core 2-D plotting, publication export.

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

3. **Make powerful gestures discoverable** — advertise drag/drop and double-click
   affordances in the resting UI.
   - [ ] Drag handles / grip dots on draggable rows + legend entries.
   - [ ] Cursor changes over draggable/editable objects; reveal valid drop targets
         the moment a drag begins (not only after).
   - [ ] 3-zone folder drop: insertion line for before/after + filled highlight for
         "move inside", with a temporary `Move inside Results` label.
   - [ ] Every drag action gets an equivalent menu/button path — never drag-only.

5. **Baseline analysis honors the plotted X/Y channels** — the baseline workshop
   still computes on `time`/`values[0]` and subtracts into `values[0]`, diverging
   from the displayed channels. (Correctness trap.)
   - [ ] Bind baseline to the plotted X + selected primary Y, show those names in
         the workshop, store them in provenance, subtract into that same channel.
   - [ ] OWNER GATE: the OriginPro audit frames baseline as a BACKEND corrections/
         recalc-DAG change (`bgAnchors`/`applyCorrections`), not a frontend read —
         scope which before starting (see Owner gates).

6. **Pipeline fit execution reproduces the interactive fit** — `pipeline/
   executeSteps.ts` still fits `time`/`values[0]` unweighted, so a recorded
   pipeline can't reproduce the fit it came from. (Correctness/reproducibility.)
   - [ ] Store + execute the same typed fit spec: X, Y, row filters, ROI, model,
         bounds, and **weighting** (the #4 `FitSpec.weight` already exists — thread
         it through the macro step params, which today carry only `{model}`).

## Tier 2 — Medium Impact

7. **Plot toolbar legibility** — ~2 dozen glyph-only buttons with `title`-only hints.
   - [ ] Shared tooltip component: name + one-line behaviour + shortcut.
   - [ ] `aria-label`/`aria-pressed`/focus styles on every icon button.
   - [ ] Split into named flyouts: Navigate / Inspect / Analyze / Annotate / View /
         Export; persist toolbar config; disable impossible actions with a reason.

8. **Context menus as a complete system** — one **context-action registry** keyed
   by selected object type, reused in right-click menus, the Plot Objects tree
   (#2), Command Palette, and an optional mini-toolbar.
   - [ ] Keyboard-complete menus: `role="menu"`/`menuitem`/`menuitemcheckbox`,
         arrow-key nav, type-ahead, Home/End, Esc-returns-focus.
   - [ ] A resting cue that right-click is available; shared confirm/undo policy for
         destructive/reorganizing actions.

9. **Active-tool feedback + universal cancel** — a consistent interaction HUD/
   status strip (e.g. `Peak/FWHM — drag across one peak · Esc cancels`).
   - [ ] Esc always cancels the in-progress gesture and returns to Pointer (unless a
         persistent-tool pref is set); right-click cancels an unfinished gesture
         before opening a menu; cursor/overlay reflect the active mode.

10. **Floating workshops recoverable** — `ToolWindow` clamps left/top only.
    - [ ] Clamp the full title bar to the viewport; add `Reset window positions`;
          persist positions in the workspace; support collapse + resize; later,
          dock into the right panel.

11. **Graph Builder → durable artifact** — promote its output to a first-class
    saved `PlotSpec` in `.dwk`.
    - [ ] Save / Save As / Duplicate / Open in Figure Builder / Export; Stage shows
          which saved spec it renders + unsaved-changes state; finish faceting for
          statistical marks; allow plot/layer reordering.

12. **One canonical plot specification** across Stage / Graph Builder / Figure
    Builder / export — all edit or render the same underlying object.
    - [ ] Keep Stage=fast renderer, Figure Builder=page editor, export=vector
          renderer, but over ONE spec; add export-preview + parity tests (axis
          limits, labels, fonts, colours, widths, markers, annotations, error bars,
          legends, facets, panel geometry). Do NOT dissolve the canvas/vector split.

13. **Folder organization density** — reduce accidental drags + hidden meanings.
    - [ ] Dedicated drag handle (not the whole header); breadcrumbs / `Show in
          folder` for filtered results; a multi-select bar
          (`7 selected · Plot · Move · Tag · Export · Clear`); folder Properties
          (name/notes/colour/default template); persist expand/collapse + width;
          Undo for all folder moves/creates/renames/deletes (rides #1).

14. **Worksheet windows: scope selection state** — multiple worksheet windows
    share global row-selection + plotted-column highlight.
    - [ ] Key selection / active cell / range / plotted-column emphasis by
          worksheet-window ID; make any cross-sheet linking explicit + labelled.

15. **Real-browser interaction coverage** — jsdom can't validate canvas hit
    targets, pointer capture, drag/drop, high-DPI, overlapping-plugin contention.
    - [ ] Playwright journeys at 100/125/200%: file-drop import; folder create/nest/
          reorder + undo; channel→X/Y/Y2 drag; right-click curve restyle;
          annotation/shape move/edit/delete/undo; axis title+limits edit; graph
          build/save/reopen/export; window arrange/restore; each analysis drag +
          Esc-cancel; the same essential journey keyboard-only.

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
    - [ ] Text on high-consequence actions (Fit/Apply/Subtract/Export/Delete/Save/
          Send to Stage); standard dialog button order (secondary first, primary
          last, destructive separated); split buttons for last-used tool.
    - [ ] Regroup menus: Analyze by Fit/Peaks-Baseline/Magnetometry/XRD-Reflectivity/
          Transform-Signal/Statistics/Workflow; Graph owns builders/plot-types/
          layers/themes/templates/export; Data owns worksheet/row-col/filter/
          reshape/merge/correction/metadata; fill out Help (searchable tool help,
          mouse interactions, import guides, Origin migration, `What is this?` mode).
    - [ ] Show shortcuts in menus; Command Palette labels match menu labels exactly;
          optional first-run "show interaction hints" mode.

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
