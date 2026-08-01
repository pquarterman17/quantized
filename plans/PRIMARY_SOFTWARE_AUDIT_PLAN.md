# Primary Software Readiness Audit & Work Plan

**Status:** Active
**Parent:** `plans/MAIN_PLAN.md`
**Created:** 2026-07-25
**Updated:** 2026-07-31 latest (queue sweep: P3.4 payload decimation
SHIPPED — 147.5→3.5 MB @1M×7 — and P2.8's regrid defect-class SHIPPED —
37→1.24 s @1M; zoom-refetch residual booked. Earlier same day: both
2026-07-27-wave export-dialog defects CLOSED —
the fix had been sitting COMPLETE but UNMERGED on an orphaned worktree branch
since 2026-07-26 (`29ad044`); found by a `git branch --no-merged main` check
during a dashboard verification, adversarially reviewed, gated, merged.
Prior: 2026-07-29, header-date correction only.
Prior: 2026-07-26 latest (P3.4 slices 1–3 SHIPPED `3c3ccee`/`08c6a5b`/
`481e0ea`; slice 3 corrected the freeze attribution — render/mount, not
parse — booked as slice 4, now the actionable queue; branding drop merged
`8fad871`; eager-bundle headroom down to 0.8 kB → P4.1 lazy-boundary item
imminent. Prior: actionable-queue execution: `_detect_layout`
shipped `9f12216` — 1M import now 4.72 s; the >500 ms feedback/cancel audit
completed with gaps booked as P3.4 slices 1–3; the large derived-`.dwk`
measurement is in flight. Earlier: ChatGPT-Sol status reconciliation after
v0.12.0:
the performance sprint shipped, but not all owner-free engineering is done.
Three P0.4 tasks are actionable now; P1/P2/P3/P4 engineering remains
incomplete where its boxes are open, even when sequencing waits for Gate A.
Earlier same day: P0.3 fixtures/checklists `9d4ce6d`; P0.4 core envelope
`5a2ce6e`/`5c938b9`; point reduction `244551c`; import efficiency `51af22d`;
viewport fix `bcbfb2e`. See the session log. The `P0.1`-style IDs remain the
stable identifiers cited by BACKLOG rows and PR history)
**Audit author:** ChatGPT-Sol
**Audited baseline:** Quantized 0.11.1, commit `261cd3a` on `main`
**Reconciled baseline:** Quantized 0.12.0, commit `0527a14` on `main`
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
7. The performance envelope now covers million-row import/plot, backend 2-D
   maps, and many-window projects, but large derived workspaces, browser-side
   maps, long-operation feedback/cancel, offline paths, and a real-GPU
   interaction confirmation remain.
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
| Large 2-D workflow | Partially measured | Browser interaction envelope and targeted fixes |
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
9. **Owner-gated** means progress actually requires owner judgment, credentials,
   hardware interaction, or a missing specimen. It does not mean "not selected
   for the current sprint."
10. **Sequencing-gated** work remains unfinished engineering. Gate A controls
    its order and scope; it must never be reported as implemented or as an
    owner action merely because it is not yet scheduled.
11. `BACKLOG.md`'s immediate queue is a start-here view, not an exhaustive list
    of every unfinished agent-implementable criterion in this plan.

### Current work-state summary (2026-07-26)

| State | Work |
|---|---|
| **Actionable now; no owner gate** | The heavy-window-mount divergence (window ~6 s vs stage 874 ms for the same 1M dataset — the last term before the restore-freeze target). ~~Slice 4~~ and the ~~P4.1 lazy boundary~~ shipped 2026-07-26 late; ~~slices 1–3~~, ~~`_detect_layout`~~, the ~~>500 ms audit~~, and the ~~`.dwk` measurement~~ earlier the same day |
| **Owner/environment evidence now** | P0.1 switch-trigger project; P0.2 screenshot review; P0.3 timed journeys; P0.4 real-GPU confirmation |
| **Sequencing-gated engineering; incomplete** | P1.1-P1.7 after Gate A; P2.1-P2.8 in the owner-ranked Gate D order; P3.1-P3.7 and P4.1-P4.2 as Gate E evidence warrants |
| **Credentials/release acceptance** | P4.3; agents can implement and automate supporting work, but signing identities and clean-machine acceptance require the owner/environment |
| **Specimen/demand gated** | P2.9 and P4.4; do not implement speculative scientific or Origin behavior |

This table classifies scheduling, not completion. Open checkboxes below remain
the authoritative acceptance criteria.

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

- [x] CSV/TSV with pre-header metadata;
- [x] magnetometry parametric series;
- [x] XRD peak/phase work;
- [x] XRR/PNR layered curves;
- [x] SIMS depth profiles;
- [x] large 2-D maps and slices;
- [x] grouped box plot with multiple factors;
- [x] save/close/reopen/relink/export/Office copy.

Record gestures, time, confusing labels, failures, and discoverability.
Commit reusable, non-sensitive fixtures and dated results.

**Progress:** all eight fixture/checklist sets shipped 2026-07-26 (`9d4ce6d`):
deterministic generator `tools/baselines/` (9 committed fixtures, 172 KiB,
byte-stability enforced by `tests/test_baseline_fixtures.py`; all nine route
through the parsers matrix), protocol + results template in
`docs/timed_workflow_baselines.md`. P0.4-scale fixtures generate via
`--large` (never committed). **P0.3 stays open** for the first dated timed
RUNS — the gesture/confusion fields need the owner's hands.

### P0.4 — Large-data and long-session performance envelope

**Goal:** find real limits before choosing rendering/storage architecture.

**Models:** GPT-5.6 Terra medium / Claude Sonnet 5. Escalate only after
profiling. **Dependency:** P0.3 fixtures (shipped 2026-07-26 —
`uv run python tools/baselines/make_fixtures.py --large`).

Measure import, first render, interaction, memory, save/autosave, reopen,
copy/export, and cleanup for:

- [x] 1 million-row numeric worksheet (import/plot/interaction/memory
  measured 2026-07-26; worksheet-GRID interaction, save/reopen and
  copy/export at 1M remain residuals);
- [x] several large 2-D matrix sizes (backend 500²/1000²/2000² measured
  2026-07-26; browser-side measured 2026-07-27 (`2ea1f9a`): 12–13 s /
  52–59 s to map-visible at 500²/1000², mechanism = full-input
  re-triangulation per regrid — class fix booked under P2.8; 4M-point
  case pending payload decimation);
- [x] 50+ datasets and 20+ plot windows;
- [x] a large `.dwk` with derived data, figures, and results — MEASURED
  2026-07-26 (`be40a69`, with the 1M worksheet-grid residual in the same
  run): 188 MB `.dwk`, 641 ms serialize, autosave SUCCEEDS at that size,
  full integrity round-trip; reopen freezes the main thread **5.8 s** in
  synchronous `JSON.parse` (→ P3.4 slice 3 evidence); worksheet grid
  bounded + 51 ms scroll p95 at 1M rows;
- [x] dense multi-series plots before and after window-aware min/max
  decimation (`244551c`; 7M → ~82k points fed to uPlot);
- [ ] **Sequencing-blocked by P1.1:** network/offline source transitions
  (unmeasurable until P1.1 creates
  an offline-vs-deleted distinction; re-measure after P1.1).

**Acceptance**

- [x] Every result records hardware, fixture, command, and measurement
  (`docs/envelope/2026-07-26-*.json`).
- [ ] **Environment/evidence gate:** direct manipulation targets <100 ms —
  pan meets it everywhere
  (≤60 ms even at 7M points). Zoom, after decimation (`244551c`) AND the
  viewport-rebuild fix (`bcbfb2e`): 20×100k **meets** the target (p95
  86 ms); 1M×7 is at p95 112 ms under HEADLESS software-rendered Chromium
  — close the box only after a real-GPU re-measure confirms (or refutes)
  the last 12 ms. History: 259 → 238 → 112 ms across the three fixes.
- [x] Operations >500 ms have suitable busy/progress feedback; safe long
  jobs offer cancellation — AUDITED 2026-07-26 (criterion not met), then
  CLOSED the same day in four passes: slices 1–3 (import feedback +
  cancel + double-import guard; universal async-command signal;
  workspace-open busy state), slice 4 (staged restore), and the tails
  (`9e2e476`): fit scan is now the job queue's SECOND producer with
  per-model progress + cooperative cancel (DREAM pattern generalized,
  sync route preserved), `fitEach` reports per-peak progress and cancels
  between iterations, ReportPanel names the running format. Every
  audited operation now has feedback; cancel exists wherever the work
  loop allows it. Remaining PERF residuals (window-mount divergence,
  real-GPU zoom) are latency targets tracked on their own lines, not
  feedback gaps.
- [ ] Failed thresholds have profiles (mechanism-level attribution exists:
  import wall time is now `_detect_layout` scoring; F1's last 12 ms appears
  to be headless canvas draw. Capture formal profiles if the targeted fix or
  real-GPU run disputes either attribution).
- [x] WebGL/workers/downsampling/chunked arrays/format changes are booked only
  where evidence supports them (downsampling + import efficiency booked
  below; WebGL/workers/chunked arrays deliberately NOT booked — no evidence;
  P1.2 format change answered "not at 50-dataset scale").

**Progress (2026-07-26):** core envelope SHIPPED — backend harness
(`tools/baselines/envelope.py`, `5a2ce6e`) + frontend harness
(`tools/bench/frontend_envelope.mjs`, real app end-to-end, `5c938b9`) +
first dated run on the Ryzen 7800X3D machine. Raw records in
`docs/envelope/`, synthesis + residuals in `docs/performance_envelope.md`.
Three measured follow-ups shipped; P0.4 stays open for the residuals above
and `_detect_layout` below.

**Booked follow-ups (evidence-backed):**

- [x] ~~Wire point reduction into the interactive plot path~~ SHIPPED
  2026-07-26 (`244551c`): window-aware min/max decimation behind ONE
  chokepoint (`lib/plotDecimate.ts`), default-on pref, engages only >10k
  rows AND >4 pts/px; disengages (documented) for scatter, non-monotonic x,
  overlay/selection companions, and error-bar series (index-coupling needs
  a live-getter refactor of the overlay plugins). 7M → ~82k points fed to
  uPlot; zoom p95 259→238 ms only, because the REAL bottleneck surfaced —
  see the viewport-rebuild item below.
- [x] ~~Import-path efficiency (tokenize/convert + sniffer reads)~~ SHIPPED
  2026-07-26 (`51af22d`): shared bounded `read_head` (io/base) converted
  all five whole-file sniffers (`resolve_parser` on a 70 MB CSV: 63 ms →
  0.5 ms); vectorized `_convert_column` with an exact-semantics per-cell
  fallback (isolated convert step −25 % time / −67 % peak; end-to-end peak
  1,117→869 MB). Wall time flat — the layout-detection item below is why.
  P1.4-booked text-column warts preserved and re-verified.
- [x] ~~**Viewport rebuild on committed zoom**~~ SHIPPED 2026-07-26
  (`bcbfb2e`): lim-only commits now no-op (epsilon vs live scale) or
  `u.setScale`; only null/autoscale transitions rebuild (a concrete lim is
  a static range TUPLE in opts, null a range function/absent — the
  brief's log-splits theory was corrected by the implementer against
  code). Latest-ref pattern keeps exhaustive-deps clean. Zoom p95:
  F1 238→**112 ms** (−53 %), F3 116→**86 ms (meets target)**; pan
  unchanged. F1's 12 ms residual is canvas draw under headless
  software rendering — NOT booked further; re-measure on a real GPU
  first (Graph25 discipline).
- [x] ~~**`_detect_layout` per-cell numeric scoring**~~ SHIPPED 2026-07-26
  (`9f12216`): scoring made lazy (the header scan provably consumes only a
  prefix — pinned by a monkeypatch test) + chunk-vectorized for full-scan
  files; `delimited.py` split to `io/_delimited_layout.py` (hdf5
  precedent). Isolated 1,328→48 ms (27.9×); end-to-end 1M-row import
  ~7→4.72 s. 36 new differential tests pin the fast path bit-identical to
  the old per-cell logic; full suite 3,197 passed / 3,209 collected (no
  corpus shrinkage).

---

The P1 campaigns below are **sequencing-gated, not owner-gated and not
complete**. Gate A determines their evidence-based order and exact scope.
Agents implement them afterward; the owner is needed again only for the
acceptance journeys explicitly named by the gates.

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
with localStorage fallback. P0.4 (2026-07-26) measured persistence at a
50-dataset/20-window session: 13 ms serialize, 3.6 MB file, 194 ms restore,
~17 ms autosave write — "compressed containers/chunked binary arrays only
if P0.4 requires it" answered NOT REQUIRED at that scale. The 1M-row-member
case (measured 2026-07-26): 188 MB `.dwk`, serialize/autosave still fine,
but reopen freezes the main thread 5.8 s in synchronous `JSON.parse` — the
near-term mitigation is P3.4 slice 3 (worker/chunked parse); P1.2 should
weigh chunked/binary arrays for large members with that number in hand.

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
sidecars but are not uniformly first-class plot channels. The P0.3 fixture
work (2026-07-26) measured the import boundary directly: a CSV with a text
column FIRST imports with a silently all-NaN positional time axis, and a
numeric-first CSV with trailing text columns raises `ValueError: no valid
data columns` — categorical columns cannot enter as data at all today. The
baseline box-plot fixture (`grouped_factors_boxplot.csv`) had to encode
factors as integer codes with the name legend in the preamble.

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
  lower priority until demand is shown. **Demand shown 2026-07-28**: the
  owner directed a full JMP replacement; the JMP-side platform work now
  lives in `plans/JMP_GAP_PLAN.md` (J3/J5/J8 layer on this item; its
  Gate J census picks the platforms). P2.6's own boxes stay here.

### P2.7 — Equation/fit authoring polish

**Goal:** approachable Python-syntax custom models.

**Models:** GPT-5.6 Terra medium / Claude Sonnet 5.

- [ ] Identify variables/parameters/fitted/fixed/start/bounds before run.
- [ ] Precise inline syntax feedback.
- [ ] Save model with units/description.
- [ ] Stretch: pretty LaTeX rendering while Python remains editable source.

### P2.8 — 2-D map polish

**Goal:** measured performance plus linked slice/ROI work.

**Models:** GPT-5.6 Terra high / Claude Sonnet 5. **Dependency:** P0.4
(SATISFIED 2026-07-27 — the profile exists; see below).

- [ ] Preserve existing H/V/segment slices and link positions.
- [ ] Add ROI statistics/export only from real need.
- [ ] Persist color limits/scale/map/slices/annotations.
- [ ] Fix profiled rendering/memory bottlenecks — **profile delivered
  2026-07-27** (`docs/envelope/2027…-final-residuals.json` M1 +
  `tools/baselines/measure_map_regrid.py`): the default linear regrid
  runs `scipy griddata` (full Delaunay) over ALL input points on every
  call — 8.5 / 37 / 153 s at 250k / 1M / 4M — while output resolution is
  irrelevant (<2 % across 200²→2000²). RSM input is typically a regular
  grid; the class fix is a gridded-input fast path (detect + bin/decimate,
  no triangulation), falling back to griddata only for genuinely
  scattered input. This sub-item is defect-class and actionable now; the
  rest of P2.8 stays Gate D-sequenced.
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

**Audit evidence (2026-07-26 — this satisfies P3.4's Gate E evidence
requirement; full table in `docs/performance_envelope.md`):** the job
queue (`routes/jobs_api` + `jobs.py`, poll-based ~1 s GET, not WebSocket)
has exactly ONE producer — `routes/fitting_bumps.py` (DREAM), which is
also the only operation with a progress bar and end-to-end cancel
(`useBumpsFit.ts`/`BumpsSection.tsx` — the reference pattern to
generalize). No `AbortController` exists anywhere in the frontend.
Ranked gaps: (1) file import — 14–28 s at 1M rows, status-bar text only
(`store/importDatasets.ts` `runImport`), import button never disabled,
double-import possible, no cancel; (2) every command-palette export —
`CommandPalette.tsx` fires `a.run()` untracked, zero in-flight signal
until the completion toast; (3) workspace open/append
(`commands/fileCommands.ts` `openWorkspaceCommand`) — totally silent
synchronous `JSON.parse`, feedback only on failure.

Prioritized slices (in pain order):

- [x] ~~**Slice 1 — import progress + cancel**~~ SHIPPED 2026-07-26
  (`08c6a5b`): batch imports register a cancellable pendingOps entry with
  a live "Importing 3/19: name…" label; AbortController threaded through
  `lib/api.ts`; cancel keeps files already imported ("cancelled — N/M
  completed"); double-import guarded at the `runImport` chokepoint (covers
  ⌘O, Library button, drag-drop, Recents) plus command pre-flight checks.
  Live-verified against the 1M-row file (cancel → 0 datasets, clean
  re-import, guard toast). Import wizard `importParse` left unwired (the
  brief's optional carve-out).
- [x] ~~**Slice 2 — command-palette in-flight signal**~~ SHIPPED 2026-07-26
  (`3c3ccee`): standalone `store/pendingOps.ts` + one `runAction`
  chokepoint (palette + both MenuBar call sites); StatusBar shows ops
  older than 250 ms. `ContextMenu`'s fire-and-forget `ContextAction`
  contract deliberately out of scope (different type, right-click actions
  weren't the audit gap).
- [x] ~~**Slice 3 — workspace open feedback + off-main-thread parse**~~
  SHIPPED 2026-07-26 (`481e0ea`) **with a corrected attribution**: busy
  state + worker parse (sync fallback, equivalence-tested; also fixed a
  real latent bug — `parseWorkspace` read `window.innerWidth`, absent in
  workers; viewport now threaded explicitly). HONEST OUTCOME: the freeze
  did NOT move (~6.5 s A/B both ways) because parse is only ~0.4–0.6 s of
  it — the dominant term is render/mount (slice 4). Autosave-restore not
  converted (its `pickRestorable` validity predicate is synchronous by
  contract; noted follow-up).
- [x] ~~**Slice 4 — staged workspace-restore rendering**~~ SHIPPED
  2026-07-26 (`65e3670`): bulk restores hydrate the active window first
  and stage the rest one-per-frame (`store/windowHydration.ts`;
  force-hydrate on focus/export/link-cycle; linked windows hydrate
  eagerly to keep windowsync live; append-workspace correctly unwired —
  it never mounts windows). A/B on one machine: **time-to-first-paint
  906 → 106 ms (−88 %)**, restore wall −21 %, max freeze 7.6 → 5.7 s
  (−24 %). The <1.5 s freeze target was MISSED for a named reason: the
  1M-row window's OWN mount is ~6 s regardless of staging — see the
  divergence item below.
- [x] ~~**Heavy plot-window mount diverges from the stage path**~~ FIXED
  2026-07-26 (`89499cc`) with a corrected diagnosis: the paths were NEVER
  divergent code — the cost was `channelModelingType`/`inferModelingType`
  and `defaultDenseChannels` running unmemoized IN RENDER
  (O(rows×channels), ~14 calls per Inspector render at 100–300 ms each on
  1M rows), blocking render→commit→effect before the plot fetch starts.
  Fixed with WeakMap caches keyed on the `values` reference (the same
  identity convention `usePlotPayload` already relies on) — benefits every
  consumer, not just windows. Window open 6,066→~3,800 ms; restore freeze
  5,604→~3,660 ms; wall 6,519→4,540 ms. Six cache-correctness tests.
  Honest anomaly flagged: TTFP varied 89 ms vs ~2,300 ms between runs —
  suspected save-time focused-window nondeterminism in the harness, being
  settled by the final measurement wave.
- [ ] **Server-side plot-payload decimation** (the pre-authorized second
  half of the point-reduction follow-up — "server-side payload decimation
  second only if still needed": it IS needed): `/api/plot/series` ships
  **78 MB of JSON** for 1M×7, whose network+encode+parse (~2–5 s) is now
  the measured remaining term in both window-mount (~3.8 s) and restore
  freeze (~3.7 s vs the 1.5 s target). Decimate at the route/pure layer
  to what the client will draw (the min/max bucketing contract
  `lib/downsample.ts`/`plotDecimate.ts` already define), with a
  full-resolution opt-out for analysis consumers — audit who reads the
  payload besides the plot before changing the default.

Original acceptance criteria (unchanged):

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
(2026-07-26 late: after the P3.4 slices the eager bundle sits at
**948.4 kB — 0.8 kB headroom**. The "lazy-load the next coherent heavy
boundary before adding substantial UI" item below is now IMMINENT: the
next eager feature cannot land without it.)

- [ ] Characterization tests before moves.
- [ ] Split one owned domain per PR with unchanged behavior/contracts.
- [ ] Generate clients/types where it reduces drift.
- [ ] Add a growth ratchet, not an arbitrary rewrite.
- [x] ~~Profile the eager graph and lazy-load the next coherent heavy
  boundary~~ SHIPPED 2026-07-26 (`95bf0b2`): profiling found `main.tsx`'s
  STATIC import of `CalcOnlyApp` (the `?view=calc` DiraCulator launcher)
  pinned the whole calculator tree into eager JS even though the in-app
  panel was already lazy — reachability from an eager root defeats
  code-splitting. Dynamic-imported: eager **948.4 → 881.2 kB** on the
  merged tree; budget ratcheted DOWN 949.2 → 919.2 kB (38 kB working
  headroom restored). Demand-load proven both directions (calc view
  fetches its chunks; default view never does). The profile's top-15
  eager contributors are in the agent report; react-dom (453 kB source)
  + uplot (121 kB) + useApp.ts (59 kB) dominate what remains — no
  further coherent boundary is currently cheap.
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

- ~~**P0.3 fixtures + checklists slice**~~ (2026-07-26) — `tools/baselines/`
  deterministic generator + 9 matrix-validated committed fixtures (172 KiB) +
  `docs/timed_workflow_baselines.md` (8 journey checklists + results template).
  P0.3 stays open for the first dated timed runs (owner hands).
- ~~**P0.4 follow-up 3: `_detect_layout` scoring**~~ (2026-07-26,
  `9f12216`) — lazy + chunk-vectorized layout scoring, 1M-row import
  ~7→4.72 s; 36 differential tests pin exact semantics.
- ~~**P0.4 >500 ms feedback/cancel AUDIT**~~ (2026-07-26) — criterion NOT
  met; single-producer job queue + zero AbortController confirmed; ranked
  gaps booked as P3.4 slices 1–3 (its Gate E evidence requirement is now
  satisfied). The acceptance box stays open until the slices ship.
- ~~**P0.4 follow-up 2: viewport rebuild on committed zoom**~~ (2026-07-26,
  `bcbfb2e`) — lim commits via `u.setScale`/no-op instead of instance
  teardown; zoom p95 F1 238→112 ms, F3 116→86 ms (meets target). F1's
  residual deliberately unbooked pending a real-GPU measure.
- ~~**P0.4 follow-up: plot-path point reduction**~~ (2026-07-26,
  `244551c`) — window-aware min/max decimation, default-on, 7M→~82k points;
  zoom p95 259→238 ms, exposing the viewport-rebuild bottleneck now booked.
- ~~**P0.4 follow-up: import-path efficiency**~~ (2026-07-26, `51af22d`) —
  bounded `read_head` across all five whole-file sniffers (63→0.5 ms sniff)
  + vectorized column conversion (peak 1,117→869 MB); layout-detection
  scoring booked as the remaining wall-time term.
- ~~**P0.4 core envelope + first dated run**~~ (2026-07-26) — backend +
  frontend harnesses, raw records in `docs/envelope/`, synthesis in
  `docs/performance_envelope.md`. Headlines: 78 MB plot payload at 1M×7,
  zoom p95 259 ms vs the 100 ms target (pan fine everywhere), 16× import
  memory expansion, persistence cheap at 50-dataset scale. Two
  evidence-backed follow-ups booked; P0.4 stays open for the residuals.
- ~~**Export-dialog defects (booked by the 2026-07-27 measurement wave)**~~
  (2026-07-31, merge of `29ad044`) — BOTH closed by one three-layer fix:
  (1) root cause of the SVG hang: ParamDialog's `useEffect`-based value
  reset ran post-paint, leaving a window where a fast field edit and the
  reset both closed over stale state; whichever `setValues` landed second
  wiped the other's keys, and `runExportFigureCommand`'s unguarded
  `(params.x_label as string).trim()` then threw OUTSIDE `exportActive`'s
  try/catch — swallowed by `runAction`'s deliberate rejection sink (zero
  network, no toast: exactly the measured 0/3 signature). Reset now runs
  synchronously during render (react.dev "adjusting state when a prop
  changes"). (2) `coerceParams` now guarantees every field key (default
  fallback) — defense in depth for every other `askParams` caller.
  (3) The missing "Copy figure (vector)" item was pure wiring:
  `PlotStage.tsx` destructured `copyFigureSvg` but omitted it from both
  `actions` literals, so `plotMenu`'s presence-check never saw it.
  +428 test lines (dialog race, coercion, command guards, menu render).
  NOTE the fix was authored 2026-07-26 by a worktree agent and sat
  UNMERGED for five days — found only by `git branch --no-merged main`.
- ~~**P3.4 second half: server-side plot-payload decimation**~~
  (2026-07-31, `ca80a4c` merged `d775100`) — `/api/plot/series` now
  min/max-bucket decimates to the client draw contract (pure
  `calc/decimate.py` mirroring `lib/plotDecimate.ts` semantics; route
  takes `decimate_width` + `full_resolution` opt-out, refuses
  non-ascending x so hysteresis loops stay full-res). Measured at 1M×7:
  147.5 MB → 3.49 MB JSON (~93×), serialize 2,605 → 64 ms. Consumer
  audit found exactly one call path (`fetchPlot` ← usePlotPayload +
  useMultiPanelStage); worksheet/stats/export never touch the route.
  Client requests decimation only when dense AND no row-position-keyed
  companion is active (error bars, colour-mapped scatter, overlays,
  selection, grey-exclusion — toggling one triggers a full-res refetch);
  `alignOverlayY` now refuses rather than mis-slices a full-length
  overlay onto a decimated base. KNOWN RESIDUAL booked as a BACKLOG row:
  zoom into a server-decimated payload shows the kept envelope only
  (client re-bucketing is inert below its min-points threshold) — a
  viewport-driven re-fetch on zoom is the finishing touch.
- ~~**P2.8 defect-class: map-regrid gridded-input fast path**~~
  (2026-07-31, `231a1b8` merged after review) — `method="linear"` regrid
  Delaunay-triangulated the full input cloud every call; new
  `calc/_grid_detect.py` (vectorized jitter-vs-pitch axis clustering,
  uniform-spacing check, ≥0.9 cell coverage) routes detected grids
  through `RegularGridInterpolator` instead. 1M-point grid: 37.0 → 1.24 s
  (30×); scattered input byte-identical to the old path (differential
  tests); documented divergence: NaN holes block interpolation instead
  of Delaunay-bridging. `natural`/`cubic` share the Delaunay cost class
  but had no measured evidence — deliberately untouched (Graph25
  discipline). P2.8's other profiled bottlenecks remain open.

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

#### 2026-07-26 — P0.3 fixtures + checklists slice (Sonnet agent, Fable orchestrating)

- Shipped `9d4ce6d` (fast-forward to main after worktree review): deterministic
  seeded generator `tools/baselines/` (10 modules, none over 145 lines), 9
  committed fixtures under `tests/fixtures/baselines/` (172 KiB total), and
  `docs/timed_workflow_baselines.md` — the 8-journey timing protocol with a
  dated results-log template using the P0.1 friction taxonomy.
- All nine fixtures route through the registry and joined the parsers matrix
  automatically (its walk is recursive); post-merge gate: 392 passed / 8
  xfailed across the fixture guard + full matrix + repo integrity, ruff and
  mypy clean.
- `tests/test_baseline_fixtures.py` regenerates via the real CLI and
  byte-compares against the committed set (catches hand-edits AND proves
  determinism). Negative control verified: a planted one-line tamper fails
  exactly the right parametrized case.
- `--large` writes the P0.4-scale set (1M-row CSV, ≥1000×1000 map, dense
  multi-series) to gitignored `tools/baselines/out/` — deliberately OUTSIDE
  `tests/fixtures/`, whose matrix walk is filesystem-based, not git-based.
- **P1.4 evidence found while building the grouped-factors fixture:** text
  columns cannot enter as data (silent all-NaN time axis when text is column
  0; `ValueError` when text columns trail) — recorded under P1.4's Current
  evidence.
- **Journey-5 format brittleness:** SIMS species names resolve only via
  `io/sims.py`'s `_recover_paired_names` when the exact 3-row banner of
  `sims_barrier.csv` is mirrored; deviations silently yield placeholder
  labels. Noted in the journey checklist.
- Residual: the first dated timed RUNS (owner). P0.4 is now unblocked and is
  the next owner-free item.

#### 2026-07-26 — P0.4 core envelope, both halves (two parallel Sonnet agents, Fable orchestrating)

- Backend harness (`tools/baselines/envelope*.py`, 4 modules ≤415 lines,
  stdlib-only hardware fingerprint, timing separated from tracemalloc runs —
  tracing itself inflates the 1M import 6 s → 22 s) + frontend harness
  (`tools/bench/frontend_envelope.mjs` + `envelope-lib.mjs`, drives the REAL
  app: `qz` on :8942, built SPA, Chromium, real Command-Palette import, real
  pan/zoom gestures, IndexedDB autosave polled from outside).
- First dated run committed (`docs/envelope/2026-07-26-{backend,frontend}.json`);
  human synthesis written by the orchestrator (`docs/performance_envelope.md`).
- Key numbers: 1M×8 import 5.96 s / 1,117 MB peak (16×); `/api/plot/series`
  payload 78.0 MB at 1M×7; F1 plots all 7M points (no cap), zoom p95 259 ms,
  pan p95 52 ms; maps healthy to 2000² backend; `.dwk` 13 ms / 3.6 MB at 50
  datasets + 20 windows; no O(n) window-open drift.
- Findings booked as P0.4 follow-ups (plot-path point reduction; import-path
  efficiency incl. whole-file sniffer reads); WebGL/workers/chunked-arrays
  deliberately NOT booked (no evidence). P1.2's container question annotated
  "not required at measured scale".
- Frontend agent's harness caught a real race in its own methodology (UI
  `clearAutosave()` is fire-and-forget; navigating away immediately lets
  autosave-restore repopulate silently) and one self-reporting bug it fixed
  before the committed run. Run-to-run variance on F1 upload+parse (14 s vs
  28 s) recorded; qualitative conclusions held across both runs.
- Both worktrees merged (`5a2ce6e`, `5c938b9` via `753864d`), targeted gate
  green post-merge (byte-guard + repo integrity + ruff + mypy), worktrees
  removed.

#### 2026-07-26 — Both P0.4 follow-ups shipped (two parallel Sonnet agents, Fable orchestrating + verifying)

- **Frontend (`244551c`)**: `lib/plotDecimate.ts` (287 lines + 29 unit
  tests) — threshold-gated (>10k rows AND >4 pts/px), window-aware
  (debounced `setScale` re-bucket from full columns, ±1 bucket pad), real
  samples only, error-bar series disengaged rather than risk index
  mispairing, prefs toggle default ON. Gates: 4,651 vitest, e2e 33/33,
  lint 0 errors, bundle ratchet 944.8/949.2 kB.
- **Backend (`51af22d`)**: `read_head` in io/base converted the five
  whole-file sniffers (audit found the other nine already bounded);
  vectorized `_convert_column` with the old per-cell loop as exact-semantics
  fallback for NA-token/text columns. Full suite 3,161 passed / 3,173
  collected (up 3 = the new tests; no corpus shrinkage), ruff + mypy clean.
- **Orchestrator verification**: latin-1 head-read equivalence confirmed
  against the old code (it already used latin-1/replace); the agent's
  "zoom rebuilds the viewport" diagnosis confirmed at
  `PlotViewport.tsx` (xLim/yLim in the create/destroy deps) BEFORE booking
  it; merged tree re-gated (backend targeted 468 passed; frontend full
  4,651 + build).
- Envelope re-measured by the frontend agent (real harness): numbers in
  `docs/performance_envelope.md` §Follow-up run. Net: the <100 ms zoom
  target is NOT yet met; the two newly-booked items (viewport rebuild,
  layout-detection scoring) are the measured remaining terms.

#### 2026-07-26 — Viewport-rebuild fix (Haiku Explore map → Sonnet implement, Fable spec/verify/gate)

- Cost routing per owner directive: a Haiku Explore agent mapped every
  lim writer/reader (one factual error in its map — the view-history
  shortcut — caught by the implementer); Fable wrote the spec; Sonnet
  implemented (`lib/plotLimApply.ts` pure classifier + 11 unit tests +
  PlotViewport latest-ref wiring, 3 files only).
- The implementer CORRECTED the spec's log-splits rationale against real
  code (fixedLogAxisSplits is unconditional; the true rebuild reason is
  range tuple-vs-function in opts) — documented in both files.
- Gates on the merged tree: 4,662 vitest, lint at the exact pre-existing
  baseline (verified via stash diff), build + bundle ratchet 945.6/949.2 kB,
  e2e 33/33 plus a 7-scenario view-lifecycle scratch spec (zoom→undo→redo,
  reset, Inspector set/clear, workspace reopen) run and then deleted.
- Envelope re-measured: zoom p95 F1 238→112 ms, F3 116→86 ms; the <100 ms
  acceptance box stays open pending a real-GPU confirm of F1's last 12 ms.
- `_detect_layout` scoring remains the one open P0.4 follow-up.

#### 2026-07-26 — Actionable-queue execution after the Sol reconciliation (Sonnet agents, Fable orchestrating)

- Sol's reconciliation reviewed adversarially and committed (`b1b32e7`) —
  no box changes found, classifications verified against plan/code state.
- **`_detect_layout` scoring shipped** (`9f12216`, see the struck follow-up):
  laziness proven semantics-pure by differential tests; import now 4.72 s
  end-to-end at 1M×8 (was ~6–7 s before today's three io fixes combined).
- **>500 ms feedback/cancel audit completed** (read-only agent, static +
  live observation on :8952): findings + ranked P3.4 slices booked; the
  audit also caught CLAUDE.md's "WebSocket job queue" drift (poll-based in
  reality; only DREAM uses the queue) — CLAUDE.md corrected this pass.
- **Large derived-`.dwk` + 1M worksheet-grid measurement COMPLETED**
  (`be40a69`, merged `1713e96`): 188 MB `.dwk`, autosave succeeds, full
  integrity round-trip, worksheet bounded at 1M rows — and a measured
  **5.8 s main-thread freeze** in the reopen `JSON.parse`, which upgrades
  P3.4 slice 3 from conditional to confirmed. Note: the agent's worktree
  spawned one commit behind (`b1b32e7`, pre-`9f12216`), so its upload
  timing predates the layout fix — caveated in the envelope doc; all
  other numbers unaffected.

#### 2026-07-27 — Final measurement wave (Sonnet agent; every locally-measurable P0.4 case now settled)

- `2ea1f9a` merged: map/export envelope harnesses + the workspace-harness
  determinism fix (focused-window pin before save — TTFP anomaly RESOLVED,
  4–13 ms deterministic). 134 measurement rows in
  `docs/envelope/2026-07-27-final-residuals.json`.
- THREE new evidence-backed items booked: map regrid gridded-input fast
  path (P2.8, defect-class — 37 s for a 1M-point map, output resolution
  irrelevant); the export-dialog SVG hang (0/3, zero network — dialog
  orchestration, not backend); the missing "Copy figure (vector)" menu
  item (capability probe passes, item never renders).
- Caveat recorded: the wave's tree predates `89499cc`, so its
  freeze/restore numbers slightly understate current main.
- P0.4's unmeasured set is now exactly: offline transitions (P1.1),
  real-GPU zoom (owner), and the 4M map (pending payload decimation).
- Orchestrator note: two lint nits in the new tools were fixed at merge;
  a third agent idle-stopped awaiting its own background run — the
  commit-before-idle rule is now in the worktree-gotchas memory.

#### 2026-07-27 — Feedback/cancel tails shipped; divergence hunt in flight

- Tails (`9e2e476`, Sonnet agent, parallel with the divergence agent):
  job-queued model scan (queue's second producer; per-model progress,
  cooperative cancel, result shape byte-identical to the sync route,
  which stays for other callers), per-peak `fitEach` progress + cancel
  (finished peaks keep results), ReportPanel format labels. Live-verified
  end-to-end (cancel mid-scan → clean re-scan; StatusBar per-peak ticks).
  Backend 3,205 passed / 3,217 collected (+9 = the new tests), frontend
  4,757, e2e 33/33. The P0.4 feedback/cancel acceptance box is CLOSED.
- The window-mount divergence agent is instrumenting/AB-measuring; its
  result books separately.

#### 2026-07-26 latest — Slice 4 + the P4.1 lazy boundary (two parallel Sonnet agents, fenced territories)

- Parallel by construction: slice 4 owned Stage/window/restore; P4.1 was
  forbidden from that area and told to pick its boundary from a profile.
  The fencing worked — zero merge conflicts, and P4.1's ratchet-down
  (949.2 → 919.2 kB) absorbed slice 4's +1 kB that had failed the OLD
  budget by 181 bytes in its worktree (merge order: P4.1 first).
- Slice 4 (`65e3670`): TTFP 906 → 106 ms; freeze −24 %; target missed for
  a named, now-booked reason (the 1M window's own ~6 s mount).
- P4.1 (`95bf0b2`): the eager graph's hidden sin was `main.tsx` statically
  importing `CalcOnlyApp` — 69.9 kB of calculators pinned eager despite
  the in-app panel being lazy. Eager 948.4 → 881.2 kB merged.
- New evidence-backed item: the window-vs-stage mount divergence
  (~6 s vs 874 ms, same dataset) — booked under P3.4, now the queue head.
- Merged-tree gates: 4,745 vitest / lint baseline / build 881.2 kB with
  38 kB headroom / e2e 33/33.

#### 2026-07-26 late — P3.4 slices 1–3 shipped (3 Sonnet agents: sequential primitive, then parallel; Fable spec/verify/merge)

- **Slice 2 first** (`3c3ccee`) because slices 1/3 consume its primitive:
  `store/pendingOps.ts` + `runAction` chokepoint + age-gated StatusBar
  indicator. Then **slices 1 and 3 in parallel worktrees** per the owner's
  parallelize-agents directive; the predicted `fileCommands.ts` conflict
  was a one-line import overlap, resolved at merge.
- Slice 1 (`08c6a5b`): cancellable batch import, live-verified against the
  1M-row file; pendingOps gained `cancel`/`updateOp`.
- Slice 3 (`481e0ea`): worker parse + busy state — and the session's most
  valuable output: **the 5.8 s freeze attribution was WRONG** (parse is
  ~0.4–0.6 s; render/mount is ~5–6 s). Corrected in the envelope doc;
  booked as slice 4. Also fixed a latent `window.innerWidth`-in-worker
  bug found during the split.
- Merged-tree gates: 4,726 vitest / lint baseline / build 948.4 kB
  (0.8 kB headroom — P4.1's lazy-boundary item flagged IMMINENT) /
  e2e 33/33. Both parallel agents hit the known stale-worktree-base
  gotcha and self-corrected because the expected base sha was pinned.
- Also landed this pass: the owner's branding drop (icons/favicon/brand
  source) — reviewed per the external-contribution rule (tracked-set vs
  `tauri.conf.json` consistency verified so clean-checkout release builds
  stay green) and merged via `feat/branding-drop` (`8fad871`).

#### 2026-07-26 — Non-owner work status reconciliation (ChatGPT-Sol)

- Audited v0.12.0 at `0527a14` read-only against this plan, `BACKLOG.md`,
  current code, recent history, and green main CI/E2E/CodeQL.
- Corrected the claim that all work not requiring the owner was implemented.
  The performance sprint is complete, but `_detect_layout` scoring, the large
  derived-workspace measurement, and the long-operation progress/cancel audit
  are owner-free P0.4 work that is actionable now.
- Confirmed the Gate A owner work: P0.1 switch-trigger project, P0.2 screenshot
  review, P0.3 timed journeys, and the real-GPU acceptance measurement.
- Confirmed P1.1-P1.7 are not owner actions and are not implemented. They are
  sequencing-gated by Gate A so the owner’s friction evidence chooses their
  order and exact scope. Direct code checks still show no Tauri file-command
  bridge or relink path, numeric-index PlotSpec bindings, and the single-row
  Import Wizard contract.
- Confirmed later P2/P3/P4 open boxes also remain incomplete engineering,
  mixed with explicit owner, specimen, credential, and evidence gates. They
  are not part of the immediate queue, but must not be described as completed.
- No completion checkbox changed: this pass clarified state and reconciled
  the derived dashboard only.

#### 2026-07-31 — Orphaned export-dialog fix recovered and merged (Fable review/gate/merge)

- A routine dashboard verification ran `git branch --no-merged main` and
  found `29ad044` (2026-07-26, worktree agent) — a COMPLETE, tested fix
  for both 2026-07-27-wave export defects that never got merged; the
  spawning session apparently ended between commit and merge. Five days
  invisible: no PR, no BACKLOG note, green CI throughout.
- Adversarially reviewed before merge per the external-contribution
  discipline: the `runAction` rejection-swallow, the `exportActive`
  try/catch boundary, and the `PlotStage`→`PlotContextMenu`→`plotMenu`
  `copyFigureSvg` wiring gap were each re-verified against CURRENT main,
  not taken from the commit message. Base was 41 commits stale but had
  ZERO overlap with the JMP campaign — clean ort merge, no drift in any
  touched file.
- Merged-tree gates: lint 0 errors / **5,076 vitest across 351 files** /
  build + bundle ratchet 894.9 kB eager (24.3 kB headroom).
- Process lesson: worktree-agent merges are the orchestrator's job and a
  session can die before doing it. `git branch --no-merged main` belongs
  in every reconciliation pass (booked in the worktree-gotchas memory).

#### 2026-07-31 — Four-agent queue sweep (Sonnet agents, Fable spec/review/gate/merge)

- Four parallel worktree agents, fenced territories, zero merge
  conflicts: P3.4 payload decimation (`d775100`), P2.8 regrid fast path,
  ROBUSTNESS Tier 1 (`cc02e65`), JMP residual wave (`060c11c`) — details
  in each plan's Completed section.
- Merged-tree gate: backend **3,422 passed** / ruff / mypy clean (241
  files); frontend suite + build + lint green, eager **898.4 kB**
  (20.8 kB headroom).
- Review notes: decimation's overlay-alignment gating verified against
  the real `usePlotPayload` diff (not the report); the zoom-envelope
  residual booked rather than blocking; regrid's NaN-hole divergence
  accepted as documented + tested.
- Same session, before the sweep: the owner answered the four import→
  plot workflow design questions — booked as `plans/PLOT_WORKFLOW_PLAN.md`
  (silent technique defaults, batch overlay offer, Layer 1 pre-P1.3,
  per-technique view memory). P1.3 recipes will build on its technique
  tag.

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
