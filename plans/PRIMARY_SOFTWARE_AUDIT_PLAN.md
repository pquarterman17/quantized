# Primary Software Readiness Audit & Work Plan

**Status:** Active
**Parent:** `plans/MAIN_PLAN.md`
**Created:** 2026-07-25
**Updated:** 2026-07-25 late (standing-issues sweep: P4.1 + the P4.2 npm-ci
item shipped, PORT_PLAN #54 closed, glib alert dismissed — see the session
log; earlier same day: pre-merge review of the four P3.1 discoverability PRs:
one keyword-vocabulary regression fixed and guarded, and this doc re-headed onto
`plan-format.md`'s Tier 1/2/3 + `## Completed` structure — the `P0.1`-style IDs
are kept as the stable identifiers cited by BACKLOG rows and the PR history)
**Audit author:** ChatGPT-Sol
**Audited baseline:** Quantized 0.11.1, commit `261cd3a` on `main`
**Repository:** `C:\Users\patri\git\quantized`

> The former OneDrive checkout is gone. Do not use or recreate
> `C:\Users\patri\OneDrive\Coding\git\quantized`; synchronization caused
> merge conflicts. All future work belongs in the repository above.

## Purpose

This is the long-horizon plan for making Quantized the owner's primary
interactive data-analysis and plotting application instead of OriginPro. It
records the audited status, realistic switch-back risks, dependency order,
acceptance criteria, and enough context for an agent to resume each task weeks
later. The target is not every Origin menu: it is faster, trustworthy,
reproducible scientific work with figures that remain editable without code.

## Executive verdict

Quantized is a substantial application, not a prototype. It has broad import
coverage, a large analysis surface, strong 1-D plotting and direct
manipulation, publication export, multi-panel composition, worksheet editing,
fitting, peak analysis, 2-D maps/slices, project organization, undo, search,
home/recent-file flows, and significant Origin migration support.

The audited baseline is healthy:

- backend: **3,106 passed, 4 skipped, 12 expected failures**;
- frontend: **4,581 passed across 324 files**;
- a 100,000-row by 200-column worksheet mounts with bounded DOM use;
- committed benchmarks passed for a 50,000-row CSV, 100,000-row correction
  chain, 2,000-point Gaussian fit, and three 5,000-point SVG series;
- 16 Playwright specifications exercise important browser interactions;
- the Origin visual matrix has 353 entries and 62 paired screenshots.

Primary-software readiness is **not yet proven**. The largest risks are:

1. No completed real switch-trigger project and no owner sign-off on the
   Origin screenshot matrix (currently 0/353 owner-reviewed).
2. No unified native Tauri lifecycle for real paths, named Save/Save As,
   workspace recents, atomic recovery, and network/offline paths.
3. Saved graph templates capture style, not a complete reusable plot recipe.
4. Preserved text and metadata are not uniformly first-class Group/Facet/X
   channels.
5. Graph Builder grouping is not fully live/editable on Stage.
6. The Import Wizard does not expose the full metadata-row and error-role
   contract.
7. Large 2-D maps, million-row sessions, many-window projects, and large
   workspaces lack a measured performance envelope.
8. Some strong backend analysis engines are not cohesive, discoverable daily
   workflows.
9. Help covers less than the command, Inspector, and workshop surface.
10. Fresh-machine signing/notarization/update acceptance remains unfinished.

### Readiness by area

| Area | Assessment | Remaining proof/work |
|---|---|---|
| Scientific core | Strong | Technique validation on real owner datasets |
| 1-D plotting/editing | Strong | Hands-on timing and taste review |
| Publication export | Strong | Windows/macOS Office acceptance |
| Import breadth | Strong, wizard gaps | Multi-row metadata and explicit error roles |
| Fitting/peaks | Strong foundation | Cohesive technique workflows/result reuse |
| Multi-panel figures | Strong | Owner acceptance on publication figures |
| Project persistence | Medium | Native named-project lifecycle and stress tests |
| Reusable plot recipes | Medium-low | Full semantic recipes, not style only |
| Categorical/JMP workflow | Medium-low | First-class factors and grouped plots |
| Large 2-D workflow | Unproven | Performance envelope and targeted fixes |
| Origin migration | Technically strong, owner-unverified | Visual review and real migration |
| Discoverability | Medium | Comprehensive contextual help |
| Desktop distribution | Medium | Clean-machine, signing, notarization, updates |

## Evidence and audit limitation

The audit inspected the current code, tests, recent history, parser/route
inventories, workspace and plotting contracts, all active plans, E2E/visual
harnesses, and official Origin/OriginPro feature documentation.

A new live visible desktop session could not be performed because the in-app
browser-control runtime was unavailable. Tests and static evidence cannot
replace the owner's judgment of appearance and friction, so the Gate A items gate
further large feature work.

## Already built — do not rebuild without evidence

Reopen these only for a reproduced defect, failed acceptance journey, or a
specific residual below:

- [x] Pointer-first plot interaction, pan/zoom/reset, selection, and keyboard.
- [x] Rich right-click menus, double-click properties, Inspector cards,
  mini-toolbar actions, and direct manipulation.
- [x] Current-session edit undo/redo and separate view history.
- [x] Publication copy/export, including 300-DPI raster and vector routes.
- [x] Major 1-D/statistical marks and 2-D map foundations.
- [x] Symmetric/asymmetric X and Y errors in plots and Inspector.
- [x] Secondary linked Y axis and axis breaks.
- [x] Legend/series editing, annotations, shapes, scientific rich text.
- [x] Multi-panel builder, rearrangement, alignment, axis sharing, spacing.
- [x] Vertical waterfall offsets with adjustable spacing.
- [x] Import preview, line skipping, metadata preservation, provenance,
  re-import, and import-filter templates.
- [x] Virtual worksheet, row/block editing, paste, formulas, conversions,
  corrections, and derived data.
- [x] Project folders/search, Home, recent files, working directories, trash
  for datasets.
- [x] Fitting starts/bounds/fixed values/uncertainty and custom Python models.
- [x] Peak-workflow and selection foundations.
- [x] Horizontal, vertical, and segment slices from 2-D maps.
- [x] Origin migration foundation and native `.opj` export, within the
  evidence-gated boundaries of `ORIGIN_FILE_DECODE_PLAN.md`.

## Operating rules

1. Measure before expanding; real switch-back friction outranks parity lists.
2. Raw data stay immutable; corrections produce derived, provenance-linked
   data.
3. Stage, Graph Builder, Figure Builder, reopen, and export share one figure
   contract.
4. Applying presets is explicit and never silently overwrites customization.
5. Use small vertical PRs; architecture items below are campaigns.
6. No specimen means no reverse engineering.
7. Start with the economical recommended model and escalate only when needed.
8. Check boxes only with code/test or owner-review evidence, then update the
   dated work log and `BACKLOG.md`.

## Model routing

Recommendations are dated **2026-07-25**; recheck them in future sessions.

| Work | ChatGPT | Claude |
|---|---|---|
| Status, docs, tests, mechanical edits | GPT-5.6 Terra low | Haiku 4.5 |
| Normal bounded multi-file feature | GPT-5.6 Terra medium | Sonnet 5 |
| Complex UI/state on established architecture | GPT-5.6 Terra high | Sonnet 5 |
| Persistence architecture/scientific contracts | GPT-5.6 Sol high | Opus 4.8 |
| Difficult Origin RE with specimens/oracles | GPT-5.6 Sol xhigh | Opus 4.8 |

Claude Fable 5 is intentionally unscheduled because its cost is not justified
by identified work. Consider it only after a tightly scoped problem defeats
Sol/Opus or proves to require an unusually hard long autonomous run.

---

## Tier 1 — High Impact

Prove the switch and measure friction (Gate A), then remove the
primary-application blockers: the trustworthy daily project (Gate B) and
the arbitrary-data-to-figure contract (Gate C).

### P0.1 — Real switch-trigger project and friction log

**Goal:** complete one current project from raw files to reopened workspace,
analysis table, publication figure, and PowerPoint/Word paste without silently
finishing steps in Origin.

**Models:** GPT-5.6 Terra low / Claude Haiku 4.5.
**Human:** owner performs and judges the workflow. **Dependency:** none.

- [ ] Choose the representative project required by `GOTO_PLAN` Q9.
- [ ] Time import-to-first-plot and import-to-production-ready-figure.
- [ ] Record every impulse to open Origin, JMP, Python, or request code changes.
- [ ] Classify friction as defect, missing feature, discoverability,
  performance, visual taste, or scientific trust.
- [ ] Include source format/size, desired result, screenshot, and workaround.
- [ ] Verify raw data remain unchanged and the project survives restart.
- [ ] Verify figure copy to PowerPoint and Word takes seconds.

**Acceptance**

- [ ] Arbitrary data are plausibly plotted in under 5 minutes without code.
- [ ] Production-ready figure is reached within 20 minutes.
- [ ] Routine fit/analysis is complete within 30 minutes.
- [ ] Copy/paste takes seconds and looks correct at normal Office scale.
- [ ] Reopen preserves data, plots, styles, annotations, analysis, provenance,
  and organization.
- [ ] Any use of another application is documented and triaged.

### P0.2 — Origin visual-fidelity owner review

**Goal:** turn the existing corpus into owner-approved visual evidence.

**Models:** GPT-5.6 Terra low / Claude Haiku 4.5.
**Human:** owner makes taste/correctness calls. **Dependency:** none.

- [ ] Review all 62 paired Origin/Quantized screenshots.
- [ ] Mark acceptable, ugly, scientifically wrong, layout wrong, or unknown.
- [ ] Check plot mode, errors, colors/widths, autoscale/outliers, axes, ticks,
  legend, fonts, annotations, and panel alignment.
- [ ] Export marks so decode-plan #55/#56 can close or receive concrete tasks.
- [ ] Do not implement graphic objects or >2 Y axes without reviewed evidence.

**Acceptance:** all 353 matrix rows have a review state; each rejection is
reproducible and prioritized; no high-priority scientific mismatch remains.

### P0.3 — Timed workflow baseline

**Goal:** make usability changes measurable across weeks.

**Models:** GPT-5.6 Terra low / Claude Haiku 4.5. **Dependency:** P0.1 helps.

Create fixtures/checklists for:

- [ ] CSV/TSV with pre-header metadata;
- [ ] magnetometry parametric series;
- [ ] XRD peak/phase work;
- [ ] XRR/PNR layered curves;
- [ ] SIMS depth profiles;
- [ ] large 2-D maps and slices;
- [ ] grouped box plot with multiple factors;
- [ ] save/close/reopen/relink/export/Office copy.

Record gestures, time, confusing labels, failures, and discoverability.
Commit reusable, non-sensitive fixtures and dated results.

### P0.4 — Large-data and long-session performance envelope

**Goal:** find real limits before choosing rendering/storage architecture.

**Models:** GPT-5.6 Terra medium / Claude Sonnet 5. Escalate only after
profiling. **Dependency:** P0.3 fixtures.

Measure import, first render, interaction, memory, save/autosave, reopen,
copy/export, and cleanup for:

- [ ] 1 million-row numeric worksheet;
- [ ] several large 2-D matrix sizes;
- [ ] 50+ datasets and 20+ plot windows;
- [ ] a large `.dwk` with derived data, figures, and results;
- [ ] dense multi-series plots before/after downsampling;
- [ ] network/offline source transitions.

**Acceptance**

- [ ] Every result records hardware, fixture, command, and measurement.
- [ ] Direct manipulation targets <100 ms.
- [ ] Operations >500 ms have suitable busy/progress feedback; safe long jobs
  offer cancellation.
- [ ] Failed thresholds have profiles.
- [ ] WebGL/workers/downsampling/chunked arrays/format changes are booked only
  where evidence supports them.

---

### P1.1 — Native desktop file and project bridge

**Goal:** native Open, re-import, Save/Save As, recents, working directories,
and safe missing/offline path handling in packaged Tauri.

**Models:** GPT-5.6 Sol high / Claude Opus 4.8.
**Dependencies:** retain browser fallback; coordinate with P1.2.

**Current evidence:** pywebview supports paths; Tauri's dialog plugin is
Rust-only/unwired to the remote frontend; recents are files, not workspaces;
the existing remote-IPC security boundary must remain.

- [ ] Native Open Files/Project returns durable paths.
- [ ] Save/Save As chooses and retains a project identity.
- [ ] Re-import uses its path and distinguishes offline from deletion.
- [ ] Recent Files and Recent Projects are separate.
- [ ] Working-directory selection affects the next chooser.
- [ ] Drag/drop and browser inputs remain fallbacks.
- [ ] Long Unicode/network paths and canceled dialogs work.
- [ ] Bridge schemas/security assumptions are documented and tested.
- [ ] Packaged Windows/macOS E2E covers the lifecycle.

### P1.2 — Named project lifecycle, atomic recovery, scalable workspace

**Goal:** make a project safe to trust for weeks.

**Models:** GPT-5.6 Sol high / Claude Opus 4.8.
**Dependencies:** P1.1; P0.4 decides if format evolution is needed.

**Current evidence:** `.dwk` is readable JSON with inline arrays; browser save
downloads a generic filename; autosave stores whole workspaces in IndexedDB
with localStorage fallback.

- [ ] Show project name/path and dirty state.
- [ ] Atomic temporary-write, validation, then replace.
- [ ] Save failure preserves the last good project.
- [ ] Bounded autosave generations by count/age/total size.
- [ ] Explain crash recovery source/time/choices.
- [ ] Recovered work does not overwrite without explicit consent.
- [ ] Missing sources remain relinkable, metadata-rich placeholders.
- [ ] Define embedded versus linked portability.
- [ ] Add workspace version/migration tests.
- [ ] Use compressed containers/chunked binary arrays only if P0.4 requires it.
- [ ] Kill-process/interrupted-write and old-version round trips pass.
- [ ] Raw source files are never rewritten.

### P1.3 — Complete reusable plot-recipe templates

**Goal:** explicitly save a successful figure as an opt-in recipe for related
future data without rebuilding it or writing code.

**Models:** GPT-5.6 Sol high / Claude Opus 4.8.
**Dependencies:** canonical PlotSpec/FigureDoc; coordinate P1.4-P1.6.

**Current evidence:** saved templates primarily contain style/series
overrides. FigureDoc is complete but tied to a data/live-source context;
templates are localStorage-oriented rather than portable project/library
objects.

Recipes should include:

- [ ] plot type and line/scatter/error mode;
- [ ] semantic X/Y/error matching by role, label, unit, and alias—not index;
- [ ] grouping, faceting, ordering, and legend-source metadata;
- [ ] scales, autoscale policy, ranges, secondary axes, breaks, labels, units,
  tick formats, and outlier policy;
- [ ] style cycle, visibility/order, annotations/shapes, maps/panels;
- [ ] waterfall settings;
- [ ] technique scope such as XRD, XRR, SIMS, or magnetometry;
- [ ] provenance, schema version, description, and preview.

Behavior:

- [ ] Explicit save with global, project, and exportable scopes.
- [ ] Opt-in apply; suggestions stay subtle.
- [ ] Never overwrite a customized plot without explicit warning.
- [ ] Ambiguous matches show mapping/preview and report unmatched fields.
- [ ] Import/export/duplicate/rename/version migration work.
- [ ] Reordered equivalent XRD columns map correctly, but the recipe is not
  auto-applied to SIMS.
- [ ] Stage/Figure Builder/reopen/export/clipboard remain equivalent.

### P1.4 — First-class categorical and metadata channels

**Goal:** use text columns and multiple metadata rows directly for grouping,
faceting, legends, categorical axes, filters, and statistics.

**Models:** GPT-5.6 Sol high / Claude Opus 4.8.
**Dependency:** contract precedes P1.5/P1.6/P2.6.

**Current evidence:** multiple comment rows/text columns are preserved in
sidecars but are not uniformly first-class plot channels.

- [ ] Stable numeric/datetime/text/categorical/metadata/error semantics.
- [ ] Display multiple header/comment rows with clear roles.
- [ ] Any suitable factor can drive Group, Facet, Legend, Color, Symbol, or X.
- [ ] Multiple ordered factors and missing-value policy.
- [ ] Preserve factors through derived data, filter/join, reopen, recipes,
  and export.
- [ ] Keep ignored instrumental metadata searchable.
- [ ] Sample ID, field, or temperature can independently label the legend.
- [ ] Lot/wafer/type can form nested grouping for a box plot.
- [ ] Existing numeric projects migrate unchanged.

### P1.5 — Live Graph Builder grouping parity

**Goal:** Group/Facet must match and remain editable across preview, Stage,
Figure Builder, workspace, and export.

**Models:** GPT-5.6 Terra high / Claude Sonnet 5. **Dependency:** P1.4.

**Current evidence:** grouped FigureDoc/export exists, while the Graph Builder
live path still treats group splitting as preview-oriented; some help wording
appears stale.

- [ ] Durable live grouped series with stable identity/style.
- [ ] Supported statistical/scientific faceting.
- [ ] Explicit edit-one/edit-all behavior.
- [ ] Hide/order/restyle/legend/Inspector/menu/undo/reopen/export parity.
- [ ] Update stale wording/help.
- [ ] E2E covers drag-to-Group, edit, undo, reopen, copy.

### P1.6 — Import Wizard metadata and error roles

**Goal:** fully describe arbitrary scientific data during import and save the
mapping as a reusable template.

**Models:** GPT-5.6 Terra medium / Claude Sonnet 5. **Dependency:** P1.4.

- [ ] Preview/select multiple header/comment/metadata rows.
- [ ] Select the default legend-label row.
- [ ] Assign symmetric/asymmetric X and Y error roles explicitly.
- [ ] Suggest common adjacent/name patterns, confirm ambiguity.
- [ ] Assign categorical/text roles without losing raw strings.
- [ ] Retain ignored preamble as searchable metadata.
- [ ] Save/reapply mappings/transforms with mismatch explanation.
- [ ] Live preview plus Apply/Cancel.
- [ ] No guess can silently attach error to the wrong signal.

### P1.7 — Project portability and source relinking

**Goal:** move/share projects without confusing raw, linked, corrected, and
derived data.

**Models:** GPT-5.6 Sol high / Claude Opus 4.8. **Dependencies:** P1.1-P1.2.

- [ ] Define linked, embedded, and portable bundle modes.
- [ ] Preserve checksum/time/import filter/correction/source provenance.
- [ ] Relink-one and relink-folder with dry-run preview.
- [ ] Distinguish missing, offline, changed, and permission denied.
- [ ] Changed source warns and can import as a new version.
- [ ] Cross-platform folder-tree relinking passes.
- [ ] Raw originals are never replaced.

---

## Tier 2 — Medium Impact

Technique and JMP-replacement workbenches (Gate D), then the
usability-and-trust pass (Gate E). Start these in the order the Gate A
friction log demands, and compose the existing engines rather than
duplicating them.

### P2.1 — XRD end-to-end workbench

**Goal:** corrected pattern to durable peak table, structural analysis,
reusable recipe, and figure in one flow.

**Models:** Sol high/Opus 4.8 for scientific contracts; Sonnet 5 for bounded UI.

- [ ] Connect peak results to Williamson-Hall and available Pawley capability.
- [ ] Durable peak identity, uncertainty, exclusion, model, and provenance.
- [ ] Manual peak edits and reviewed batch recipe.
- [ ] Technique-specific plot recipe is manually chosen, never auto-overwrites.
- [ ] Validate on representative owner instruments/phases.

### P2.2 — XRR/PNR fit-to-data workbench

**Goal:** connect layer model/reflectivity engine to measured data, constraints,
fit, uncertainty, SLD, residuals, results, and publication output.

**Models:** GPT-5.6 Sol high / Claude Opus 4.8.

- [ ] Bind measured X/Y/errors and fit ranges to layer stack.
- [ ] Starts, bounds, fixed/shared parameters, resolution/background.
- [ ] Linked data/model/residual/SLD views.
- [ ] Durable results table and FigureDoc.
- [ ] Validate representative XRR and PNR fits against trusted results.

### P2.3 — SIMS depth profiles

**Goal:** calibration, correction, comparison, stacked/log plotting, and
summary without leaving Quantized.

**Models:** GPT-5.6 Terra high / Claude Sonnet 5.

- [ ] Depth/time calibration with units/provenance.
- [ ] Normalization, baseline/smoothing into derived data.
- [ ] Log comparison, vertical offsets, and saved recipe.
- [ ] Region measures and summary export.
- [ ] Validate on owner data before expanding.

### P2.4 — Peak Analyzer refinement

**Goal:** Origin-like convenience plus reproducibility.

**Models:** Sol high/Opus 4.8 for fit semantics; Sonnet 5 for UI.

- [ ] Add/edit/delete peaks directly in selection.
- [ ] Mixed functions and shared/fixed/start/bound parameters.
- [ ] Context submenu: Peak Fitting > Fit this range.
- [ ] Explicit model metrics/warnings.
- [ ] Batch recipe and uncertainty/diagnostic result table.

### P2.5 — Transform/combine/clean wizard

**Goal:** cover common trips to Python/JMP for joins, derived quantities, and
messy metadata. Begin only from Gate A examples; much pipeline logic exists.

**Models:** GPT-5.6 Terra high / Claude Sonnet 5.

- [ ] Previewed append, keyed join, align/interpolate, reshape, split.
- [ ] Python-like derived expressions, units, fitted-value use, defined error
  propagation.
- [ ] Metadata cleanup/promotion to factors.
- [ ] Saved transformation recipe, undo, provenance, derived output.
- [ ] Warnings for duplicate keys, unit mismatch, or row loss.

### P2.6 — Categorical/JMP-style plot workbench

**Goal:** drag Y and factors such as lot/wafer/type into production box,
violin, bar, strip, or summary plots.

**Models:** GPT-5.6 Terra high / Claude Sonnet 5. **Dependencies:** P1.4-P1.5.

- [ ] Nested grouping/order/labels/jitter/summary/errors/raw-point visibility.
- [ ] Missing levels and unbalanced groups are explicit.
- [ ] Summary table links to selected groups.
- [ ] ANOVA/post-hoc, PCA, regression/correlation, GLM, survival, and ROC stay
  lower priority until demand is shown.

### P2.7 — Equation/fit authoring polish

**Goal:** approachable Python-syntax custom models.

**Models:** GPT-5.6 Terra medium / Claude Sonnet 5.

- [ ] Identify variables/parameters/fitted/fixed/start/bounds before run.
- [ ] Precise inline syntax feedback.
- [ ] Save model with units/description.
- [ ] Stretch: pretty LaTeX rendering while Python remains editable source.

### P2.8 — 2-D map polish

**Goal:** measured performance plus linked slice/ROI work.

**Models:** GPT-5.6 Terra high / Claude Sonnet 5. **Dependency:** P0.4.

- [ ] Preserve existing H/V/segment slices and link positions.
- [ ] Add ROI statistics/export only from real need.
- [ ] Persist color limits/scale/map/slices/annotations.
- [ ] Fix profiled rendering/memory bottlenecks.
- [ ] Interactive 3-D remains gated by GOTO Q4; static 3-D is adequate now.

### P2.9 — Signal-processing UI

Expose the existing backend only if GOTO Q8 and a real project justify it.
**Models:** GPT-5.6 Terra medium / Claude Sonnet 5.

---

### P3.1 — Complete contextual help

**Goal:** make current breadth findable without clutter.

**Models:** GPT-5.6 Terra low / Claude Haiku 4.5; Sonnet 5 only for broad UI.

**Current evidence:** roughly 94 command labels exist, while searchable help
covers a much smaller subset and guards focus on Analyze.

- [ ] One metadata source for name, one-sentence tooltip, keywords, context,
  shortcut, and help target.
- [ ] Generate help coverage/tests from it.
- [ ] Small contextual `?` links on complex workshops/property groups.
- [ ] Progressive disclosure; tooltips remain one sentence.
- [ ] Audit stale capability wording.

**Progress**

- [x] Plot and Insert commands carry one shared plain-language description
  used by both Help and the command palette (2026-07-25).
- [x] Help and the command palette search those descriptions, with coverage
  guards preventing a new Plot/Insert command from shipping undocumented.
- [x] File and Data commands use the same metadata and coverage contract,
  including import/workspace/export and combine/reshape/recalculate actions
  (2026-07-25).
- [x] The growing Help catalog loads only when Help opens; its 14.4 kB chunk
  reduced audited eager startup from 945.5 kB to 934.4 kB.
- [x] Edit, View, Analyze, and Help commands use the shared description
  contract; the separate 17-item Analyze help catalog was deleted
  (2026-07-25).
- [ ] Extend the same source to Inspector cards, context actions, and
  workshops, then add contextual `?` links.
- [x] Channels, Error columns, Corrections, Series style, and Axes Inspector
  cards have compact `?` actions that open Help with a relevant search already
  applied (2026-07-25).

### P3.2 — First-plot onboarding/Home

**Goal:** a technical newcomer makes a respectable first plot in five minutes.

**Models:** GPT-5.6 Terra medium / Claude Sonnet 5.

- [ ] Home foregrounds projects, drop/import, working path, first-plot path.
- [ ] Familiar Origin gesture tips without copying Origin's architecture.
- [ ] Optional 1-D, grouped, and 2-D examples.
- [ ] Hints stop once learned.

### P3.3 — Accessibility/input-quality pass

**Models:** GPT-5.6 Terra medium / Claude Sonnet 5.

- [ ] Keyboard reachability, focus, order, cancel.
- [ ] Accessible names/state for icons, plots, trees, dialogs, progress.
- [ ] Contrast and non-color encodings.
- [ ] Windows/macOS scaling and high-DPI readability.
- [ ] Reduced motion.

### P3.4 — Error/progress/cancel/diagnostics

**Models:** GPT-5.6 Terra medium / Claude Sonnet 5.

- [ ] Consistent progress location and job identity.
- [ ] Safe cancel for long import/fit/batch/export.
- [ ] Errors say what failed, whether data changed, and next action.
- [ ] Copyable diagnostic bundle excludes raw/private data by default.
- [ ] Persistent recovery/write-failure notices.

### P3.5 — Unified recipe library

**Goal:** organize Import, Plot, Analysis, and Technique Workflow recipes.

**Models:** GPT-5.6 Terra high / Claude Sonnet 5. **Dependencies:** P1.3/P1.6.

- [ ] Project/global scope, favorites, recent, tags, version, preview,
  duplicate, rename, import/export.
- [ ] Search comes later if real use proves navigation insufficient.
- [ ] Revisit organization after usage; do not freeze it prematurely.

### P3.6 — Office/report export acceptance

**Models:** GPT-5.6 Terra medium / Claude Sonnet 5.

- [ ] Windows/macOS vector copy and 300-DPI raster fallback.
- [ ] Expected bounding box, transparency, fonts, and scale.
- [ ] Office report export embeds the actual rendered figure when SVG is
  requested, not placeholder text.
- [ ] Consider EMF only if Windows Office tests show material benefit.
- [ ] Editable embedded figures remain a future goal, not release blocker.

### P3.7 — Complete project trash

**Models:** GPT-5.6 Terra low / Claude Haiku 4.5.

- [ ] Extend to folders, figures, reports, and durable objects.
- [ ] Coherent dependency restore or clear limitation.
- [ ] Bound by count/age/total size, with purge preview.
- [ ] Allow explicit warned permanent deletion.

---

## Tier 3 — Nice-to-Have

Sustainability, distribution, and specimen-gated edges.

### P4.1 — Decompose high-risk frontend modules

**Goal:** reduce regression risk without mass rewrite.

**Models:** GPT-5.6 Terra high / Claude Sonnet 5.

**Evidence:** `store/useApp.ts` is ~2,840 lines, `lib/api.ts` ~1,868,
`lib/uplotOpts.ts` ~1,384, `lib/uplotOverlays.ts` ~1,125, with several
700-950 line state/contracts. The audited production build is also **945.5 kB
eager against a 949.2 kB budget**, leaving only 3.7 kB headroom.

- [ ] Characterization tests before moves.
- [ ] Split one owned domain per PR with unchanged behavior/contracts.
- [ ] Generate clients/types where it reduces drift.
- [ ] Add a growth ratchet, not an arbitrary rewrite.
- [ ] Profile the eager graph and lazy-load the next coherent heavy boundary
  before adding substantial UI; do not merely raise the existing budget.
- [x] ~~Restore `npm run lint`~~ SHIPPED 2026-07-25 (PR #88, `ecbf99b`):
  flat `eslint.config.js` (typescript-eslint recommended + classic
  react-hooks rules), wired into CI's frontend job; 0 errors / 9
  exhaustive-deps warnings. Cost taken with owner sign-off: root
  `typescript` 7.0.2 → 6.0.3 (typescript-eslint hard-errors on TS 7.0,
  their #10940; revert when it supports ≥7.1). hooks v7's six
  React-Compiler-prep rules are deliberately OFF — adopting them (73
  flagged sites) is its own reviewed campaign. Lint immediately caught a
  real rules-of-hooks trip (store action named `usePath` → renamed) and
  six stale disable directives.

### P4.2 — Canonical plot/project regression matrix

**Models:** GPT-5.6 Terra high / Claude Sonnet 5.

- [ ] Goldens for plain/errors/group/facet/y2/break/waterfall/2-D/decor/panels.
- [ ] Screen/export/reopen structural and visual equivalence.
- [ ] Migration fixtures for supported contract/workspace versions.
- [ ] Document one ownership path per field before deleting adapters.
- [x] ~~Make the e2e job reproducible against the lockfile~~ SHIPPED
  2026-07-25 (PR #87, `034fdb4`): both `ci.yml` and `e2e.yml` now run
  `npm ci` (the class fix — pypi/release already did), landed right after
  #77 synced the lockfile to the floated versions so the pin changed no
  resolved dependency. Backstory kept for the record: `npm install` off
  `^1.61.1` had CI on a different Playwright than any local run, which
  hid a real e2e regression and cost two wrong diagnoses (1.61 vs 1.62
  `getByText` exactness semantics).

### P4.3 — Installer/signing/notarization/update

**Goal:** clean Windows/macOS install and update without developer tools or
security workarounds.

**Models:** GPT-5.6 Terra medium / Claude Sonnet 5.
**Owner gates:** signing identities, certificates, release credentials.

- [ ] Fresh-machine PyPI and packaged acceptance.
- [ ] Windows signing and two-release updater E2E.
- [ ] macOS signing/notarization, launch, update, uninstall.
- [ ] Ubuntu `.deb` smoke test when low effort.
- [ ] Record OS, checksum, timing, first import, upgrade, recovery.

### P4.4 — Sample-gated edges

**Models:** Terra medium/Sonnet 5 for normal parsers; Sol xhigh/Opus 4.8 only
for Origin RE with specimens.

- [ ] Origin graphic objects wait for evidence (#53).
- [ ] Origin >2 Y axes wait for specimen (#54).
- [ ] `.opju` matrix/2-D edges prioritize supplied real files.
- [ ] Rigaku variable-step, unsupported SPC, and Oxford import wait for
  samples/specification.
- [ ] Multi-chain MCMC R-hat is booked when posterior work becomes routine.

---

## Gates — acceptance sequence

Each gate is a checklist over the tier items above; the P-IDs are the
identifiers, the gates are the order.

### Gate A — Evidence first

1. [ ] P0.1 switch-trigger.
2. [ ] P0.2 visual review.
3. [ ] P0.3 timed baselines.
4. [ ] P0.4 performance envelope.
5. [ ] Re-rank or remove later tasks from findings.

### Gate B — Trustworthy daily project

1. [ ] P1.1 native bridge.
2. [ ] P1.2 project lifecycle.
3. [ ] P1.7 portability/relink.
4. [ ] Repeat P0.1 and compare friction.

### Gate C — Arbitrary data to desired figure

1. [ ] P1.4 categorical/metadata contract.
2. [ ] P1.6 Import Wizard roles.
3. [ ] P1.5 live grouping.
4. [ ] P1.3 full plot recipes.
5. [ ] P3.5 library.
6. [ ] Repeat CSV, parametric, and grouped-stat journeys.

### Gate D — Technique replacement

Choose by owner frequency after Gate A: P2.1 XRD, P2.2 XRR/PNR, P2.3 SIMS,
P2.4 peaks, then P2.5/P2.6. Each must pass a real project before another large
workflow begins.

### Gate E — Release-quality comfort

Complete relevant P3 usability/Office work, P4.1-P4.3 sustainability and
distribution, and only triggered P4.4 edges.

### PR discipline

- Contract PRs include migrations and characterization tests.
- User campaigns land one reviewable vertical journey per PR.
- PR descriptions name the plan ID, outcome, non-goals, and verification.
- Stacked PRs state bases and are rebased/retargeted after merges.
- Never mix major refactoring with new scientific behavior.

## Definition of primary software

- [ ] Three representative real projects finish without unplanned Origin/JMP.
- [ ] First plot <5 minutes; production figure <20 minutes.
- [ ] Office copy takes seconds and passes Windows/macOS visual review.
- [ ] Projects survive reopen, moved/offline sources, interrupted save, and
  recovery without silent loss.
- [ ] Technique-scoped recipes work on new related datasets, opt in, and never
  overwrite custom plots.
- [ ] Multiple metadata rows/factors drive legend/group/facet/category without
  code.
- [ ] Representative large 2-D/long sessions meet documented targets.
- [ ] High-priority Origin screenshot mismatches are fixed or accepted.
- [ ] Frequent techniques have validated end-to-end workflows.
- [ ] Fresh Windows/macOS install and upgrade pass.
- [ ] Remaining Origin-only features are low-frequency, explicitly deferred,
  or have a documented fallback.

## Update and handoff protocol

At the end of each session:

1. Update the date above.
2. Check only boxes proven by tests or owner review.
3. Log date, agent/model, IDs, PR/commit, tests, user outcome, residuals, and
   next dependency below.
4. Reconcile `BACKLOG.md` and affected plans in the same change.
5. If code contradicts the plan, code/tests are truth; correct stale text.

## Completed

- ~~**Fresh readiness audit**~~ (2026-07-25) — audited 0.11.1 at `261cd3a`;
  booked P0–P4 and this plan into the MAIN_PLAN tree.
- ~~**P3.1 Plot/Insert discoverability slice**~~ (2026-07-25) — shared
  descriptions on every Plot and Insert command; Help and the command palette
  both derive from the command registry; Help lazy-loaded (945.5 → 934.4 kB
  eager).
- ~~**P3.1 File/Data discoverability slice**~~ (2026-07-25) — the same
  descriptions on every File and Data command, with the coverage guard extended
  so a new one cannot ship undocumented.
- ~~**P3.1 Analyze/UI discoverability slice**~~ (2026-07-25) — remaining
  Analyze/View/Edit/Help commands documented; deleted the parallel
  hand-authored Analyze help catalog, so a dangling help topic is now
  structurally impossible.
- ~~**P3.1 contextual Inspector help slice**~~ (2026-07-25) — optional `?`
  action on the shared `Card` primitive, wired into the five
  highest-complexity property groups.

- ~~**P3.1 keyword-vocabulary repair**~~ (2026-07-25) — pre-merge review of the
  four slices above found that folding the hand-authored catalog into the
  command registry migrated its `desc` field but dropped its `keywords` field
  from 15 of 17 tools, so 27 of 34 domain terms ("SNIP", "Parratt", "ANOVA",
  "FWHM", "VSM") no longer found their tool. Vocabulary restored onto the
  `Action`s — the chokepoint both Help and the palette read — and locked with a
  31-case `it.each` guard in `helpContent.test.ts`.

**P3.1 stays OPEN.** The four slices above cover curated commands and the first
five Inspector cards; workshop-level coverage is the remaining evidence-led
work (its BACKLOG row).

### Session log

#### 2026-07-25 — Fresh readiness audit (ChatGPT-Sol)

- Audited 0.11.1 at `261cd3a`.
- Verified backend 3,106 passed, 4 skipped, 12 expected failures.
- Verified frontend 4,581 passed across 324 files.
- Verified Ruff and mypy (228 source files) clean.
- Existing four-scenario performance benchmark passed with headroom.
- Production TypeScript/Vite build passed; bundle ratchet passed at 945.5 kB
  eager but has only 3.7 kB remaining headroom, recorded under P4.1.
- Confirmed MAIN #30-#38 shipped; recorded boundaries instead of duplicating
  finished work.
- Identified acceptance, native project lifecycle, full plot recipes,
  categorical metadata, live grouping, import roles, large-data evidence,
  workflow cohesion, help, and distribution as remaining risks.
- Live visible review was unavailable, so P0.1/P0.2 are first gates.

#### 2026-07-25 — P3.1 Plot/Insert discoverability slice (ChatGPT-Sol)

- Added shared descriptions to every Plot and Insert command, including Graph
  Builder, Figure Builder/Page, export, axes, display, layout, and shapes.
- Searchable Help now derives those topics from the real commands; the command
  palette shows the same sentence and searches its words.
- Added coverage, search, rendering, no-duplicate, Origin-tip, and lazy-boundary
  tests.
- Lazy-loaded Help behind its standalone open state: production build passes
  at 934.4 kB eager, restoring 14.9 kB budget headroom.
- Validation: full frontend suite **4,588 passed across 325 files**; focused
  slice 46 passed; production TypeScript/Vite build and bundle ratchet passed.
- Found and recorded the pre-existing broken ESLint 10 configuration under
  P4.1 rather than expanding this usability slice.

#### 2026-07-25 — P3.1 File/Data discoverability slice (ChatGPT-Sol)

- Added the same shared descriptions to every File and Data command.
- Help now finds lifecycle and worksheet operations by outcomes such as
  "recovery snapshot" or "matching values," not only exact menu names.
- Coverage prevents future File/Data commands from shipping undocumented.
- Validation: focused suite **47 passed**; production build and bundle ratchet
  passed at 937.4 kB eager.

#### 2026-07-25 — P3.1 Analyze/UI discoverability slice (ChatGPT-Sol)

- Added shared descriptions to every remaining curated Analyze, View, Edit,
  and Help command.
- Deleted the parallel hand-authored Analyze help catalog; all curated command
  topics now derive from the real command registry.
- One coverage test now fails on any undocumented curated command, regardless
  of menu group, and Origin migration tips resolve against the same metadata.
- Validation: focused suite **44 passed**; production build and bundle ratchet
  passed at 940.4 kB eager.

#### 2026-07-25 — P3.1 contextual Inspector help slice (ChatGPT-Sol)

- Added a reusable optional help topic to the shared collapsible Card
  primitive.
- Added unobtrusive `?` actions to the five highest-complexity plotting
  property groups: Channels, Error columns, Corrections, Series style, Axes.
- Contextual help opens the existing lazy Help hub with a relevant query
  prefilled; clicking help does not expand/collapse the property card.
- Validation: full frontend suite **4,590 passed across 325 files**; focused
  contextual/architecture suites passed; production build and bundle ratchet
  passed at 941.0 kB eager.

#### 2026-07-25 — Pre-merge review of the four P3.1 PRs (Claude Opus 5)

- Reviewed the #78→#79→#80→#81 stack. The architecture is endorsed: deriving
  Help topics from the command registry makes a dangling help entry
  structurally impossible, which the deleted hand-authored catalog could not.
- **Found one real regression the 4,590-test suite did not catch.** The catalog
  carried `desc` AND `keywords`; only `desc` was migrated. Because descriptions
  are written in plain outcome language they contain no jargon, so 27 of 34
  domain-term searches that worked on `main` returned nothing. Measured through
  the real search path, not by inspection. Fixed + guarded (see Completed).
- Lesson recorded: the coverage guard was rewritten alongside the code it
  guards, so it validated the new shape ("every command has a description")
  instead of preserving the old contract ("the search vocabulary did not
  shrink"). Rewritten guards need a preservation assertion.
- Re-headed this plan onto `plan-format.md` (Tier 1/2/3, one H1, `## Completed`);
  removed the `# Phase N` banners the rule forbids. P-IDs kept.
- Reconciled BACKLOG: P0.1 and P0.2 were booked as "actionable dev work (no
  owner gate)" but are owner actions that **already existed** as owner-gate rows
  (GOTO Q9; ORIGIN #55/#56). Annotated those rows instead of duplicating.
- Verified: frontend **4,621 passed across 325 files**, production build clean,
  bundle ratchet 942.0 kB eager against the 949.2 kB pin (7.2 kB headroom).
- **E2E regression from the contextual-help slice, found after merge and fixed
  (`bc55463`).** The `?` action was a direct child of the Card's `<summary>`
  beside a bare title text node, fusing them: the Axes card's summary text
  became "Axes?", so `axis-title-limits.spec.ts`'s
  `getByText("Axes", { exact: true })` matched zero elements. E2E was green 3/3
  on #78–#80 and red 5/5 from `71581c5` (#81). Fixed at the primitive (the
  title is now its own node), because every future header affordance would
  fuse with a bare text child the same way.
- **`e2e.yml` runs `npm install`, not `npm ci`** — so CI resolves
  `^1.61.1` to a newer Playwright than the lockfile's 1.61.1, and the two differ
  in whether `getByText` exactness reads immediate text or full `textContent`.
  The bug is therefore invisible to any local run on the pinned version. Booked
  under P4.2 as a reproducibility gap; it is why this slice shipped red.
- Two review-method corrections worth carrying forward: a local test pass proves
  nothing until the negative control shows the failure returning (mine passed
  with AND without the fix), and Playwright's downloadable `error-context.md`
  ARIA snapshot settles DOM questions that repeated theorising did not.
- Audit-claim spot check: "16 Playwright specifications" is 11 spec files /
  15 `test()` blocks. Imprecise, not fabricated; no owner approval was invented
  anywhere in the doc.

#### 2026-07-25 — Standing-issues sweep (Claude, owner: "you just figure this out")

- **P4.1 lint restore and the P4.2 npm-ci item both SHIPPED** (PRs #88/#87 —
  see the struck items for detail).
- **PORT_PLAN #54 closed entirely** (PR #89): all four SPC/JCAMP corpus
  defects fixed same-day — including the silent m_xyxy multifile data loss no
  test could express — plus the 0x4D old-format decoder implemented off the
  new specimens. Matrix known-gaps 13→9.
- **Dependabot alert #1 (glib) dismissed as tolerable risk** with a dated
  rationale: Linux-only transitive dep (glib←gtk 0.18←tauri 2.11.5, newest
  2.x), fix requires the gtk-rs 0.20 line Tauri hasn't adopted, our code
  never touches glib, Win/mac builds omit it. Auto-resolves when Tauri moves.
- **Repo cruft cleared**: 9 fully-merged stale remote branches deleted, 4
  dead remote-tracking namespaces removed, `src-tauri/gen/schemas` gitignored,
  icon PR (#82→#86) rebased/verified/merged, Dependabot #77 verified in an
  isolated worktree and merged.
- Corpus MANIFEST corrected in `../test-data` (`a42900d`): the "512 × 8 pts"
  oracle note was shorthand from a GRAMS update-in-place artifact; ground
  truth (4,344 pts, variable 3–53-pt scans) established from the file's own
  directory and recorded.

## Reference baseline

Recheck current versions before future model assignment:

- OpenAI model catalog: <https://developers.openai.com/api/docs/models>
- OpenAI current model-selection guidance:
  <https://developers.openai.com/api/docs/guides/latest-model>
- Anthropic model overview:
  <https://platform.claude.com/docs/en/about-claude/models/overview>
- Anthropic model-selection guidance:
  <https://platform.claude.com/docs/en/about-claude/models/choosing-a-model>

Origin comparison references used for this audit:

- Origin overview: <https://www.originlab.com/Origin>
- OriginPro capability guide:
  <https://docs.originlab.com/user-guide/originpro/>
