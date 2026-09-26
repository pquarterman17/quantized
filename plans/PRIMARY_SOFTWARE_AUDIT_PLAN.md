# Primary Software Readiness Audit & Work Plan

**Status:** Active
**Parent:** `plans/MAIN_PLAN.md`
**Created:** 2026-07-25
**Updated:** 2026-09-25 (latest): **P2.1 per-peak uncertainties, model-fit path** — the Peak Analyzer publishes its model fit (values + standard errors + shapes + provenance) into the durable peak table (see P2.1). Previous: 2026-09-25: **P2.4 slice 4** — Peak Analyzer batch recipe + uncertainty/diagnostic table (see P2.4). Previous: 2026-09-06: **P1.7 Pack Project PR 5** — adversarial
audit of the whole Pack Project stack (PR 1-4/#305-#308): two real defects
found and fixed (a POSIX TOCTOU race letting `publish_bundle`'s atomic
rename silently absorb an empty directory created in its check-then-act
window; `pack_preview` propagating a raw, path-carrying `RuntimeError`
instead of a structured refusal), a shared cross-language fixture pinning
`is_bundle_relative`/`isBundleRelativePath` parity, and a write-site-scan
gap (`portable/copying.py`'s `os.open` flags held in a local variable) —
see the new PR 5 entry under P1.7 below; backend `portable` mode is now
marked complete (pack → move → reopen roundtrip-tested), the visual
workflow remains unshipped. Earlier the same day: **P1.7 Pack Project PR
4** — pack
orchestration bridge (`quantized.desktop_bridge_pack`), the write-directory
consent kind + `revoke_paths` (`desktop_consent.py`), and the frontend
state machine (`store/packProject.ts`/`.packProjectRun.ts`) consuming PR
1-3's manifest/copy/publish primitives — see the new PR 4 entry under P1.7
below. Earlier the same day: **P1.7 Pack Project PR 2 + PR 3** — atomic
staging + verified source copying (`quantized.portable.staging`/
`.copying`), then atomic bundle publication + bundle validation
(`quantized.portable.publish`/`.pack`) and the `kind: "bundle"`
dataset-source extension on both sides (backend resolution with
`base_dir`; frontend parse with a known `projectDir`, written back at
serialize time only when saving into that same directory) — see the PR 2
and PR 3 entries under P1.7 below. Then the **PR 1 review fix**: an
eleventh defect found on PR #305 review — source dedup was by folded
`path_key`, which silently merged two DIFFERENT files on a case-sensitive
filesystem into one shared source; fixed by grouping on the exact
`original_path` string and collapsing only on proven filesystem identity
(`(dev, ino)`, new fields on `desktop_source_probe.probe_source_path`),
with the dedup/collapse logic split into `portable/grouping.py`. Earlier
the same day: **P1.7 Pack Project PR 1** —
bundle contract + dry-run manifest (`quantized.portable`, backend-only, no
copying) — see the new subsection under P1.7 below. Earlier: **P1.7 slice
2 — collision-safe relinking**
shipped (the P3 residual booked on slice 1); the Pack Project stack
continues with the portable-bundle packer. Earlier the same day: **P1.1's
two uncontracted boxes closed** (working-
directory hint for Open Project / Save As; project reopen with per-state
remedies incl. `permission_denied` and the lapsed-consent dialog degrade) —
only the owner-gated long-path and packaged-E2E boxes remain. Prior:
2026-09-04 (#294): **P1.2 is COMPLETE** — its `[~]` tag is
dropped, the P0.4-conditional compressed/chunked-container box is DECIDED NOT
REQUIRED (see the box), and Gate B step 2 is ticked; the 2026-08-19 note
below that added P1.2's `[~]` is superseded for P1.2 (still current for
P1.1/P1.5). Prior: 2026-08-19 (Day-5 sprint reconciliation, QA lane): P1.1,
P1.2, and P1.5 had shipped partial slices (2026-08-17/18) with no `[~]`
status tag in their section headers, unlike P1.4/P1.6/P1.7 — added the tag
to all three for consistency; flipped two stale P1.2 boxes to `[x]`
("recovered work does not overwrite without consent" — `RecoveryChoiceDialog`
+ `applyRecoveryChoice.ts` already gate every named-project overwrite behind
an explicit three-way choice; "define embedded versus linked portability" —
P1.7's `lib/projectPortability.ts` already defines all three modes). No
overclaim found in P1.1/P1.2/P1.4/P1.5/P1.6/P1.7's own per-box text — each
narrows its claim inline already (a discipline this plan already practices
well); the corrections here are status-tag/checkbox omissions, not content
fixes. Full list, the release-blocker list, and the N verdict are in
`plans/RELEASE_BLOCKERS.md` and `plans/LIBRARY_WORKBOOK_UX_PLAN.md`'s item
14. Prior: 2026-08-13 (second child plan registered:
`LIBRARY_WORKBOOK_UX_PLAN.md`, ChatGPT-Sol's 2026-08-12 Library / workbook /
Quick Plot UX discovery from an owner interview — decisions L0.1–L0.14
recorded, LQ.1 confirmed 2026-08-13, NO implementation authorized yet.
Prior: 2026-08-01 — ChatGPT-Sol's v0.14.0 figure-authoring
round-trip audit is now the child plan `FIGURE_AUTHORING_WORKFLOW_PLAN.md`;
it expands operating rule #3 and P1.3/P1.5 into a lossless document campaign.
Prior: 2026-07-31 queue sweep: P3.4 payload decimation
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

The focused Stage → Graph Builder → Figure Builder → saved figure → Figure
Page → clipboard/export contract is tracked in
`plans/FIGURE_AUTHORING_WORKFLOW_PLAN.md`. That child plan was authored by
ChatGPT-Sol on 2026-08-01; do not attribute it to Claude. Its checkboxes are
authoritative for figure-document round-trip work, while P1.3/P1.5 retain the
broader recipe and grouping dependencies here.

The Library → workbook → children hierarchy, tile/tree/details view modes,
and the known-data-only Quick Plot / Quick Figure Builder contract are
tracked in `plans/LIBRARY_WORKBOOK_UX_PLAN.md`, a second child plan authored
by ChatGPT-Sol on 2026-08-12 from an owner interview (also not Claude's).
Its confirmed L0.x decisions are authoritative for Library organization and
Quick Plot behavior; its proposed PR A–H sequence is NOT authorized until
the interview completes.

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
   workspace recents, atomic recovery, and network/offline paths. **Day-5
   reconciliation note (2026-08-19):** this verdict predates the P1.1/P1.2
   slices — the shipped bridge uses pywebview (`desktop_bridge.py`,
   matching CLAUDE.md's actual stack), not Tauri, and named Save/Save As,
   recents, atomic write-validate-replace, bounded autosave generations, and
   a consent-gated recovery dialog are now real (see P1.1 `[~]` below for
   its itemized, still-partial state; P1.2 is COMPLETE as of 2026-09-04 —
   `#291` plus the decided container box). Packaged Windows/macOS E2E
   and long-Unicode/network-path behavior remain unverified — that part of
   this risk item still stands.
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
  copy/export at 1M remain residuals — the single-cell EDIT path of that
  interaction residual is now CLOSED, 2026-09-06 (`#299`): incremental
  formula recompute cut a 1M-row edit from ~4.2 s to ~18 ms; scroll/mount
  were already in-budget per the 2026-07-26 run above);
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
  import wall time was `_detect_layout` scoring (fixed `9f12216`); the
  residual then moved to the tokenize/transpose/convert stages, formally
  profiled and closed 2026-09-06 (`#298`, bulk `np.loadtxt` fast path):
  1M×7 CSV `import_auto` 10.25 → 1.88 s, 989 → 546 MB peak. F1's last 12 ms
  appears to be headless canvas draw — that half is still open pending a
  real-GPU run; capture a formal profile only if that run disputes the
  attribution).
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

**Progress (2026-09-06):** three more evidence-backed follow-ups shipped in
the same envelope-adjacent class (import path, plot-path re-fetch, worksheet
edit path — see the Booked follow-ups list below for `#295`/`#296`/`#298`,
and the bullet/box updates above for `#299`). Dated record in
`docs/performance_envelope.md`. P0.4 still stays open for exactly the two
owner-gated residuals: real-GPU zoom confirmation, and network/offline
transitions blocked on P1.1.

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
- [x] ~~**Import-path efficiency, continued: bulk numeric parse**~~ SHIPPED
  2026-09-06 (`#298`): after the sniffer-read and layout-detection fixes
  above, the remaining cost was Python-level `line.split`/`zip` transpose/
  per-column conversion; a start/middle/end sample of the data block now
  gates one `np.loadtxt` call over the whole block, and that full parse is
  what validates it — any failure or shape mismatch falls back unchanged
  (ragged row, text/NA cell, datetime column). 1M×7 CSV `import_auto`
  10.25→1.88 s wall, 989→546 MB peak; 100k rows 0.56→0.16 s. Bit-identical
  to the old path on every fixture plus targeted ragged/text/NA/datetime
  cases.
- [x] ~~**Upload/import responsiveness under concurrent load**~~ SHIPPED
  2026-09-06 (`#295`): `upload_file`/`upload_template` ran the synchronous
  parse directly on the event loop, so `GET /api/health` (and any other
  concurrent request) stalled for the whole parse — measured 15.5 s of a
  16.8 s 1M-row upload. Parse now runs via `run_in_threadpool`; response
  encoding (`routes/_payload.py`'s `DataStructResponse`) and the delimited
  transpose chunk their C-level calls (~8k-element budget) so the GIL is
  released between chunks too. `tests/test_upload_concurrency.py` drives a
  live uvicorn socket and asserts health answers in <0.5 s while a parse is
  held in flight.
- [x] ~~**Plot-path point reduction, continued: dataset-handle cache for
  `/api/plot/series`**~~ SHIPPED 2026-09-06 (`#296`): a committed zoom/pan
  on a series over 10k points re-posted the WHOLE dataset even though it
  never changed; `/api/plot/series` now takes the same dataset-handle cache
  (`routes/_datasetcache.py`, `X-Dataset-Handle`) the map/RSM routes already
  used. Measured (1M×7): windowed re-fetch 11.76→0.31 s server wall time;
  request body 154 MB→112 bytes.

---

The P1 campaigns below are **sequencing-gated, not owner-gated and not
complete**. Gate A determines their evidence-based order and exact scope.
Agents implement them afterward; the owner is needed again only for the
acceptance journeys explicitly named by the gates.

### P1.1 — Native desktop file and project bridge [~]

**Goal:** native Open, re-import, Save/Save As, recents, working directories,
and safe missing/offline path handling in packaged Tauri.

**Models:** GPT-5.6 Sol high / Claude Opus 4.8.
**Dependencies:** retain browser fallback; coordinate with P1.2.

**Current evidence:** pywebview supports paths; Tauri's dialog plugin is
Rust-only/unwired to the remote frontend; recents are files, not workspaces;
the existing remote-IPC security boundary must remain.

- [x] Native Open Files/Project returns durable paths. (Contract slice —
  `desktop_bridge.py`'s `open_project_file`/`read_project_file`,
  `desktopBridge.ts`'s `openProject`; pywebview only. Datasets already had
  this via `pick_files` — MAIN_PLAN #31 — this ships it for **projects**.)
- [x] Save/Save As chooses and retains a project identity. Save AS shipped
  this slice (`saveProjectAs` — native dialog, real path, direct write);
  project IDENTITY (open path + dirty-state tracking, so a plain "Save"
  exists as distinct from "Save As") was **P1.2's** to wire up, and it did:
  **Day-5 reconciliation (2026-08-19):** this box read "nothing calls
  [`saveProjectTo`] from a UI command yet," but P1.2 (2026-08-18,
  `store/workspaceIO.ts:138`) wires Ctrl/Cmd+S to it via `store/project.ts`'s
  identity+dirty slice, with no dialog on the known path. Verified with a
  grep of `frontend/src` for `saveProjectTo` call sites — flipped to `[x]`.
- [x] Re-import uses its path and distinguishes offline from deletion.
  Datasets already had this (MAIN_PLAN #31, `pathState`/`path_status`).
  Projects get the same distinction this slice, reused verbatim
  (`recentProjectsCommands.ts` checks `pathState` before reopening a Recent
  Projects entry) — but full "re-import a project" semantics beyond reopen
  are **P1.2's** (project identity again). **Completed 2026-09-06:** the
  reopen now has a distinct remedy per state — `offline` stops (retry is
  clicking again; nothing is cleaned up), `permission_denied` (new in
  `path_status`, which now delegates to `probe_source_path`) says the file
  is present but unreadable, `missing`/`invalid` offer **Locate…** (the
  native dialog seeded at the old folder; a located file supersedes the
  stale entry only once the workspace is actually applied), and a failed
  direct read on an `ok` path — the NORMAL first reopen after a relaunch,
  since consent is per-process — degrades to the dialog seeded at the
  file's own folder instead of a dead-end toast. Quick save refuses to
  write to a project whose volume is `offline` (never through an absent
  mount point) while a merely `missing` file is recreated by the write.
- [x] Recent Files and Recent Projects are separate. (`qz.recentProjects`
  vs. `qz.recent`, separate storage keys, separate stores — `lib/
  recentProjects.ts` / `store/recentProjects.ts` vs. the pre-existing
  `lib/recentFiles.ts` / `store/recents.ts`. Surfaced as ⌘K palette
  commands, not a MenuBar row — see `recentProjectsCommands.ts`'s header for
  why: `store/useApp.ts`, which the MenuBar's Recent Files row reads, was
  pinned for this contract slice.)
- [x] Working-directory selection affects the next chooser. Datasets already
  had this (MAIN_PLAN #31, `useWorkingPaths`). **Completed 2026-09-06:**
  Open Project and Save As open at `useWorkingPaths.current` (the SAVE
  dialog gained the `directory` hint `pick_files`/`open_project_file`
  always had), Save As suggests the open project's own name, and the
  folder actually opened from / saved into / located in is recorded back
  via `use()` — so a project picked on a share seeds the next import
  dialog too, and vice versa.
- [x] Drag/drop and browser inputs remain fallbacks. (Every native call
  degrades to the pre-existing `openFilePicker`/`saveBlob` path exactly —
  verified by the full existing jsdom suite passing untouched, plus new
  fallback-branch tests.)
- [~] Long Unicode/network paths and canceled dialogs work. Cancel semantics
  ARE covered (`CANCELLED` sentinel, red-first-tested both sides of the
  bridge). **Updated (this slice, `tests/test_desktop_bridge_path_shapes.py`):**
  every piece of this that is Python/TypeScript logic reachable with
  `FakeWindow`/`tmp_path` (no packaged app, no real OS dialog) is now
  red-first tested: CJK/combining-mark(NFD)/astral-plane filenames round-trip
  through `pick_files`/`write_project_file`/`path_status`/`probe_source`/
  `is_declared_source`; a path >260 chars (Windows' legacy MAX_PATH) and a
  single component near Linux's 255-byte NAME_MAX both round-trip through
  `write_project_file` (confirming the temp file never incorporates the
  destination's own name); `#`/`%`/`?`/leading-or-trailing-space/embedded-
  newline filenames round-trip (newline/`?` POSIX-only, skip-marked on
  Windows); UNC-shaped-path classification (`volume_present`/
  `probe_source_path`/`path_status` reachable-share-vs-unreachable-share ->
  `missing` vs. `offline`) is exercised via a mocked `os.path.splitdrive`/
  `isdir`/`realpath` — classification logic only, no real SMB/CIFS
  connection; and quick-save through a mount that vanishes AFTER consent was
  granted fails cleanly (`ok: False`) rather than recreating the missing
  directory. **A real defect was found and documented, not fixed (needs a
  design decision):** `is_declared_source`/`payload_declares_source` key on
  a path STRING post-`realpath`/`normcase`, never on filesystem identity
  (dev/ino) — a hard-linked alias of a declared/open source (proven on Linux,
  `test_a_hardlinked_alias_...` xfail-strict) is NOT recognized as that
  source, so `write_project_file` wrongly permits a save through it; the
  same string-keyed design means an NFC/NFD respelling of one file on a
  normalization-insensitive filesystem (macOS HFS+/APFS — NOT reproducible
  on this Linux-only gate) is a plausible sibling case. The practical damage
  is bounded and also locked in by test: `atomic_replace_file`'s
  temp-plus-`os.replace` severs the alias rather than mutating the shared
  inode's bytes in place, so the ORIGINAL source file survives byte-for-byte
  even when the check is bypassed. A real fix means stat-ing every declared
  source at every quick-save to compare dev/ino against the destination —
  exactly the extra per-source I/O `payload_declares_source`'s own docstring
  says was deliberately avoided (an unreachable network source pays a full
  SMB-timeout stat per save) — so this needs an owner decision, not a silent
  patch. **Still genuinely untested** (owner: the packaged-E2E item below):
  a real OS dialog actually returning a long/Unicode/UNC path, real Windows
  MAX_PATH/`\\?\` enforcement, a real SMB/CIFS mount going offline, and the
  macOS normalization-insensitive-filesystem case above.
- [x] Bridge schemas/security assumptions are documented and tested. (The
  "## Bridge contract (P1.1)" section in `desktop_bridge.py`'s module
  docstring; the write-consent security rule is red-first tested in
  `tests/test_desktop_bridge.py`.)
- [ ] Packaged Windows/macOS E2E covers the lifecycle. Not shipped —
  **owner: the packaged-E2E work item**, tracked separately; this slice's
  tests run the bridge logic against `FakeWindow`/a mocked
  `window.pywebview`, never a packaged app. The Tauri shell itself is
  **also** out of scope here — its own contract PR, noted in
  `desktop_bridge.py`'s docstring (different consent story, cross-process
  IPC rather than in-process js_api).

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

- [x] Show project name/path and dirty state. (2026-08-18: `store/project.ts`
  identity+dirty slice, Ctrl/Cmd+S "Save" routes to the known path via
  `saveProjectTo` with no dialog, Shell `TitleBar` shows name + dirty marker.)
- [x] Atomic temporary-write, validation, then replace. (2026-08-18:
  `desktop_bridge.py`'s `write_project_file` gained a structural
  format/version/datasets validation gate before the existing temp+
  `os.replace`; a bad payload is refused before any file touches disk.)
- [x] Save failure preserves the last good project. (2026-08-18: pytest
  pins validation-abort + mocked `os.replace`/disk-full failures leave the
  prior file byte-identical; frontend quick-save surfaces a clear error
  status and does NOT fall back to a browser download on failure.)
- [x] Bounded autosave generations by count/age/total size. (2026-08-18:
  `autosaveGenerations.ts` gains `capByAge` — count via `MAX_GENERATIONS`,
  age via `MAX_GENERATION_AGE_MS` (30 days), size via existing `capBySize`;
  all three always keep the newest generation.)
- [x] Explain crash recovery source/time/choices. (2026-08-18:
  `RecoveryChoiceDialog` offers Recover autosave / Keep last project /
  Cancel — with SOURCE+TIME for both candidates — ONLY when the autosave is
  newer than the last-known named project; otherwise the pre-P1.2 silent
  restore is unchanged, since there is nothing named to protect.)
- [x] Recovered work does not overwrite without explicit consent. **Day-5
  reconciliation (2026-08-19):** `RecoveryChoiceDialog`/
  `lib/applyRecoveryChoice.ts` (landed with the 2026-08-18 items above) gate
  every recovery behind an explicit Recover autosave / Keep last project /
  Cancel choice with source+time shown — narrowly, only when there IS a
  named project the autosave is newer than; with nothing named to protect,
  the pre-P1.2 silent restore is unchanged (stated in this section's own
  "Current evidence" text above), which is not a consent gap since nothing
  named could be overwritten in that case.
- [x] Missing sources remain relinkable, metadata-rich placeholders.
  **(2026-09-02: resolved BY THE EMBEDDED MODE'S DESIGN.)** The only
  implemented `ProjectPortabilityMode` (`lib/projectPortability.ts`) is
  `"embedded"`, so every dataset always carries its full `DataStruct`
  snapshot in the `.dwk` regardless of whether `source` is reachable
  (`Dataset.source`'s own doc: the path is set "ONLY where a real path is
  actually knowable" — the DATA is never gated on it). A missing/offline/
  changed source can therefore never produce a placeholder, because no
  data is ever missing to begin with — the dataset stays fully usable, and
  `store/relink.ts`'s `RelinkPreviewRow` (datasetId/datasetName/oldPath/
  candidatePath/status/changeVerdict/candidateChecksum/candidateMtime/
  candidateSize) is exactly the rich metadata the Relink panel surfaces
  for a `"missing"`/`"offline"`/`"permission_denied"` row. Verified: no
  code path clears `Dataset.source` or `Dataset.data` on a failed probe. A
  future `"linked"` mode (named, still deferred below) re-opens this box —
  that mode's entire point is data NOT riding along.
- [x] Define embedded versus linked portability. **Day-5 reconciliation
  (2026-08-19):** shipped under P1.7 slice 1, not this item —
  `lib/projectPortability.ts`'s `ProjectPortabilityMode = "embedded" |
  "linked" | "portable"` defines all three with full rationale; only
  "embedded" is implemented, "linked"/"portable" are named and deferred to a
  P1.7 follow-up (see that section). The definition itself — this box's
  actual ask — is done.
- [x] Add workspace version/migration tests. **(2026-09-02.)**
  `frontend/src/lib/__fixtures__/workspace/` gains four frozen
  `v1.dwk.json`..`v4.dwk.json` documents (see that directory's own README
  for provenance — derived from one real `serializeWorkspace` call, never
  hand-typed) and `lib/workspaceMigration.test.ts` (65 cases): every
  fixture parses with zero `migrationWarnings`, re-serializes as
  `version: 4`, round-trips idempotently (normalized for the one
  documented, by-design volatile field — see the fixtures' README),
  preserves dataset/folder/pipeline-and-recalc-mode/workbook content at
  the version tier that introduced each, confirms `deriveWorkbooks`
  derives exactly one workbook per dataset-group for v1-v3, and a
  `version: 5` copy throws `/unsupported workspace version/`.
- [x] ~~Use compressed containers/chunked binary arrays only if P0.4 requires
  it.~~ DECIDED NOT REQUIRED 2026-09-04: P0.4's own measurement (above)
  answered the condition at the 50-dataset/20-window scale, and the one
  large-member cost it flagged — the 5.8 s synchronous `JSON.parse` on a
  188 MB `.dwk` reopen — was closed by P3.4 slice 3's worker parse
  (`481e0ea`), so no format change is owed. Reopen only on new evidence
  (a measured member the worker parse cannot hold).
- [x] Kill-process/interrupted-write and old-version round trips pass.
  **(2026-09-02.)** Backend: `desktop_bridge.py`'s `write_project_file` now
  `flush`+`fsync`s the temp file BEFORE `os.replace`, and best-effort
  `fsync`s the containing directory after (POSIX-only, swallowed on
  failure/Windows) — closing the "a crash right after `os.replace` can
  still leave a partial `.dwk` at the real path" gap the module's own
  docstring used to claim couldn't happen.
  `tests/test_desktop_bridge.py` red-first-pins the fsync-before-replace
  call order, that an fsync failure leaves the prior file byte-identical
  with no stray temp, and that a directory-fsync failure never fails the
  save. Frontend: `lib/workspaceMigration.test.ts` truncates each of the
  four version fixtures at 25%/50%/90%/`length-1` and asserts
  `parseWorkspace` always throws (never returns a partial workspace) and
  `workspaceParseCore.parseWorkspaceBlob` reports `{ok: false}` with the
  same message; `lib/openWorkspaceCommand.test.ts` (new) pins the native-
  open consumer fact (a throw never reaches `dispatch`, `setStatus`
  reports `open failed: …`); `lib/autosave.test.ts` extends the existing
  "falls back past a corrupt newest generation" case with a
  TRUNCATED-real-document variant (not just a `"junk"` string) for the
  realistic torn-write shape.
- [x] Raw source files are never rewritten — **scoped to the application's
  project-save path** (review round, 2026-09-03). **(2026-09-02.)** Backend:
  `write_project_file` refuses — before touching disk — when the target
  path is a declared dataset source of the workspace being written, judged
  TWO ways: the payload's own `datasets[].source.path` entries (the
  authoritative description of the current workspace, realpath-resolved so
  a symlink or `sub/../` spelling cannot slip by — covers a never-opened,
  freshly imported or relinked workspace) AND the cached set a native
  project open recorded (`desktop_consent.is_declared_source`);
  `save_file_dialog` refuses the cached set at pick time. Red-first-tested
  in `tests/test_desktop_bridge.py` (stale-write-consent, alias spelling,
  symlink, relinked-source and positive-control cases).
  `tests/test_write_sites.py` (new) is a heuristic INVENTORY of every
  filesystem-write site under `src/quantized/` (an `ast` scan matching a
  hand-justified allowlist exactly, two-sided) — it keeps the set of
  writers visible and reviewed, it is not a proof about arbitrary output
  paths; library exporters that take a caller path are listed with the
  justification that no route feeds them user input. Frontend:
  `store/workspaceIO.ts`'s `runSaveWorkspaceToFile` gains a fast, friendly
  pre-check refusing a Save As destination equal to a live dataset's
  `source.path`, tested in `store/workspaceIO.test.ts`. (P1.2 is
  all-checked as of 2026-09-04: the compressed-containers box above,
  the last one open, is DECIDED NOT REQUIRED on P0.4's evidence — #294.)

### P1.3 — Complete reusable plot-recipe templates [~]

> **Interface contract from the archived PLOT_WORKFLOW plan** (was
> PLOT_WORKFLOW #6, folded up 2026-08-01 when that plan completed):
> recipes key their "technique scope" on the SHIPPED `metadata.technique`
> tag (`io/technique.py` vocabulary, mirrored as `Technique` in
> `lib/types.ts`); suggestions follow the confidence framing (parser-
> identified technique = silent built-in defaults, recipe match = subtle
> opt-in prompt, never auto-apply cross-technique); and the built-in
> `lib/techniqueDefaults.ts` table + `lib/techniqueViewMemory.ts` become
> the zero-recipe fallback tiers below recipes. Precedence when P1.3
> lands: explicit recipe > per-technique memory > technique defaults >
> density heuristic.

**Goal:** explicitly save a successful figure as an opt-in recipe for related
future data without rebuilding it or writing code.

**Models:** GPT-5.6 Sol high / Claude Opus 4.8.
**Dependencies:** canonical PlotSpec/FigureDoc; coordinate P1.4-P1.6.

**Current evidence:** saved templates primarily contain style/series
overrides. FigureDoc is complete but tied to a data/live-source context;
templates are localStorage-oriented rather than portable project/library
objects.

**Waves 1-3 shipped (PRs #203, #204, wave 3 pending):** `lib/plotRecipe.ts`'s
schema + `captureRecipe` (wave 1, #203), `store/plotRecipes.ts`'s CRUD/apply/
preview-confirm pipeline + `.dwk` project-scope persistence (wave 2, #204),
and wave 3's global scope (`store/globalPlotRecipes.ts`), Recipe Manager
panel (rename/duplicate/delete/move-scope/import/export/apply-to-dataset),
preview+confirm dialog, an explicit "apply anyway, drop unmatched" opt-in
(`confirmPendingRecipeApplicationPartial`), a "Save as Plot Recipe…" entry
point on the focused plot window, and a subtle (never-auto-apply) post-import
suggestion toast. See F4.2b in `FIGURE_AUTHORING_WORKFLOW_PLAN.md` for the
itemized still-open gaps (live grouping/faceting composition parity,
version migration beyond the v1 schema parse-gate, waterfall settings beyond
the scalar offset, preview thumbnails).

Recipes should include:

- [x] plot type and line/scatter/error mode;
- [x] semantic X/Y/error matching by role, label, unit, and alias—not index;
- [~] grouping, faceting, ordering, and legend-source metadata (ordering +
  legend fields captured/applied; the group/facet BINDINGS are captured and
  re-key correctly, but rebuilding the actual live composition/panels on
  apply is a documented gap — F4.4);
- [~] scales, autoscale policy, ranges, secondary axes, breaks, labels, units,
  tick formats, and outlier policy (everything but outlier policy, which
  isn't captured);
- [~] style cycle, visibility/order, annotations/shapes, maps/panels (style
  cycle/visibility/order/annotations/shapes are captured/applied; maps/panels
  are not);
- [~] waterfall settings (only the scalar offset; no richer settings exist to
  capture);
- [x] technique scope such as XRD, XRR, SIMS, or magnetometry;
- [~] provenance, schema version, description, and preview (provenance +
  schema version + description are captured; preview thumbnails do not
  exist).

Behavior:

- [x] Explicit save with global, project, and exportable scopes.
- [x] Opt-in apply; suggestions stay subtle.
- [x] Never overwrite a customized plot without explicit warning (applying a
  recipe always creates a NEW figure; it never edits a live window in place).
- [x] Ambiguous matches show mapping/preview and report unmatched fields.
- [~] Import/export/duplicate/rename/version migration work (import, export,
  duplicate, and rename all work in both scopes via the Recipe Manager
  panel; schema version migration beyond the v1 parse-gate does not exist).
- [x] Reordered equivalent XRD columns map correctly, but the recipe is not
  auto-applied to SIMS.
- [x] Stage/Figure Builder/reopen/export/clipboard remain equivalent —
  `plotRecipes.test.ts` applies a DECORATED recipe (log axes, limits, legend
  placement, series style, annotation, shape, region shade) through the real
  store and asserts those decorations survive into the render spec Stage
  builds, then saves and reopens the `.dwk` and asserts the reopened figure
  produces the identical spec. The reopen leg is the strong evidence: both
  sides come from the same builder but from DIFFERENT inputs (live store vs.
  a serialize/parse round trip), so anything the `.dwk` drops shows up.
  Scope, stated honestly: Stage and Figure Builder are equivalent BY
  CONSTRUCTION, not by test — `buildStageFigureSpec` delegates to
  `buildFigureSpecFromDocument` whenever it can route through the document,
  so comparing them is an identity, and export/clipboard reach the same
  builder through that same chokepoint. That part remains an architectural
  inference (a sound one — `exportFigureCommand`/`copyFigureCommand` are
  one-line calls to it), and the absolute assertions are what actually
  protect the decoration those paths carry. Owner acceptance remains useful
  release QA.

### P1.4 — First-class categorical and metadata channels [~]

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

**Slice 1 shipped (2026-08-17, Lane C):** the CONTRACT itself — lossless
representation, import capture for the two measured failures, the
sanctioned accessor layer, and P1.5/P1.6-ready group-label plumbing. Backend
`DataStruct.cat_levels: Mapping[int, tuple[str,...]] | None` (channel index
-> ordered level strings) + `is_categorical`/`level_labels`/`level_of`
accessors (`src/quantized/datastruct.py`); frontend `DataStruct.cat_levels?:
Record<number, string[]>` + `lib/categorical.ts`'s
`isCategoricalChannel`/`categoricalLevels`/`levelLabel`.

**Review round fixed same-day (P1-1 blocker + adjudicated P2s/P3s):** the
slice-1 frontend field was originally declared `catLevels` (camelCase)
while the backend wire payload (`routes/_payload.datastruct_payload`) emits
`cat_levels` (snake_case, the established convention — see `book_source`/
`origin_fidelity`) — nothing translated, so every categorical accessor was
DEAD CODE against any real imported dataset; a reviewer probe caught it
because same-language test fixtures had (wrongly) used the same broken key
on both sides and so never noticed. Fixed by renaming the TS field to match
the wire, and the boundary is now pinned by a SHARED fixture
(`tests/fixtures/wire/categorical_import.csv` +
`categorical_import_payload.json`) that both suites read: a backend test
asserts the ACTUAL `datastruct_payload()` output equals the committed JSON
byte-for-byte, and a frontend test parses that SAME JSON file through the
real `parseWorkspace`/`isCategoricalChannel`/`levelLabel` path — this is
what "round-trip proven both languages" now means, PRECISELY: shared-fixture
wire parity, one JSON file two suites read, not two hand-synced fixtures
that could silently drift apart the way the camelCase bug did. Also this
round: `lib/datasetsplit.ts`'s row-slice and `lib/merge.ts`'s row-concat
were dropping `cat_levels` entirely (split now carries it forward
unconditionally — a row slice preserves column layout; merge carries a
channel's level table only when every merged dataset has an IDENTICAL,
same-order table for it, dropping just that channel on any mismatch — real
conflict-resolution/remapping is booked under P1.5, not built); a
whitespace-strip gap in the Import Wizard's `label`-role sidecar capture
matched to `io/delimited.py`'s convention; `barlayout.ts`'s
`resolveCategoryLabels` now reads the generic `text_columns` sidecar (not
only Origin's `origin_text_columns`, matching `columnmeta.ts`'s own `??`
order); and both languages' `cat_levels` read paths were hardened against a
structurally corrupted table (e.g. `{0: "AB"}`, a bare string where a
string array belongs) to DEGRADE (drop the field, or that one channel) that
worst case never had a spec quite as tight — the backend's `__post_init__`
was already shape-only by construction and just gained an explicit
docstring ruling; the frontend's `lib/categorical.ts` accessors and
`lib/workspace.ts`'s `.dwk` load path both gained a real runtime check
(without it, a corrupted string level "list" reads as truthy and JS happily
INDEXES INTO it character-by-character — silent, plausible-looking, wrong
output, not a caught error).

- [x] Stable numeric/datetime/text/categorical semantics for GENERIC
  delimited import (`io/delimited.py`'s two measured failures) and the
  Import Wizard's `parse_import` (`io/import_preview.py`, new `categorical`
  role + `label` role no longer drops raw strings). Metadata semantics
  (multiple comment rows) were already stable pre-slice and are unchanged.
- [x] Display multiple header/comment rows with clear roles — unchanged this
  slice (P1.6's Import Wizard UI territory; the backend `label_rows`/
  `text_columns` sidecars this depends on already existed and are untouched
  except for staying aligned to the (possibly larger) final channel list).
  **Reconciled 2026-09-09:** this line and P1.6's "Preview/select multiple
  header/comment/metadata rows" (below, already `[x]`) describe the SAME
  capability, not two different ones — verified against the code:
  `ImportWizardPanel.tsx` renders exactly the three independently-settable
  `header_line`/`units_line`/`label_line` fields P1.6 describes, with every
  other preamble row retained as `comments` metadata automatically (no
  separate "clear roles" display was ever missing; P1.4 just hadn't been
  pointed at where P1.6 had already shipped it). Re-verified: `npx vitest
  run` over `components/workshops/importwizard` + `lib/importwizard.ts` —
  9 files, 126 tests passed. See P1.6's item below for the shipped detail
  and rulings; do not duplicate tracking here going forward.
- [ ] Any suitable factor can drive Group, Facet, Legend, Color, Symbol, or
  X — the REPRESENTATION and the Group-label rendering path
  (`calc/plotting.build_grouped_series`, `lib/plotspec.ts` `buildXY`) are
  done; wiring Facet/Legend/Color/Symbol pickers and the Data
  Filter/Tabulate/Stat Stage workbenches through `is_categorical`/
  `isCategoricalChannel` is P1.5 (live Graph Builder) and P1.6 (Import
  Wizard UI) territory — this contract is what they now build against.
- [x] Multiple ordered factors and missing-value policy — level ORDER is
  represented (the tuple's own order; NaN = missing is the representation's
  missing-value policy). **Verified 2026-09-12, shipped 2026-09-10 commit
  `09f88d6e` (#345), "the level reorder UI (Group O-2b)":** user-settable
  REORDERING (J1's ask, this box's original text called it "not built yet")
  is now a real UI — `components/workshops/levelorder/LevelOrderPanel.tsx` +
  `LevelOrderTable.tsx`, reachable from the worksheet column context menu
  ("Reorder levels…", `WorksheetPane.tsx:280`) — that writes
  `DataStruct.level_order` (`lib/categorical.ts`). The order round-trips
  through `.dwk` (`workspace.test.ts:2430-2457`) and is consumed by
  `calc/plotting.py:185`, so it reaches matplotlib export too. See
  `JMP_GAP_PLAN.md` J1's own level-ordering box for the full evidence.
- [~] Preserve factors through derived data, filter/join, reopen, recipes,
  and export — reopen (`.dwk` round-trip) is proven, now via the SHARED wire
  fixture (`lib/workspace.test.ts` + `tests/test_wire_fixtures.py`), not
  just a same-language round trip. CONFIRMED (review round, not a hedge
  anymore): merge (`lib/merge.ts`) and split (`lib/datasetsplit.ts`) BOTH
  silently dropped `cat_levels` — split is FIXED (a row slice preserves
  column layout, so it now always carries the table forward unchanged);
  merge CARRIES-IF-IDENTICAL (a channel's level table survives only when
  every merged dataset agrees on it, same strings, same order; any mismatch
  drops just that channel, never the whole merge) — REAL conflict
  resolution (remapping each dataset's codes onto one union level table when
  they disagree) SHIPPED under P1.5 (2026-08-18): `lib/merge.ts`'s
  `planChannel`/`remapFor` now do exactly that; the one remaining drop case
  (a channel missing its table on even one input) is unchanged, since there
  is nothing to remap FROM.

  **Filter/recipes/export propagation AUDITED 2026-09-09 (Group J)** — a
  read-only sweep of DataStruct-deriving and -serializing sites in both
  languages, then each finding verified by reading the code rather than
  trusting the sweep — and then the whole diff put through a high-effort
  adversarial review, which found the sweep had MISSED sites and that two of
  the "fixes" rested on overstated claims (both corrected below; the review
  round is the honest part of this record, not a footnote). Result at the time:
  **three real drops fixed, two deliberate strips documented**; two categories
  that do not exist yet; one open owner question; and one bug the fix itself
  surfaced. **BUG-005 closed 2026-09-20:** Corrections now passes level-code
  channels through every y transform, Resample refuses a genuinely new grid
  rather than interpolating codes or silently mixing methods, and coincident
  grids preserve levels, order and row sidecars.

  Fixed, each sabotage-verified:
  - `lib/dataset.ts`'s `cloneDataStruct` was a hand-written ALLOWLIST of the
    five required fields, so it dropped every optional one — `duplicateDataset`
    (store/useApp.ts) and `freezeCopy` (store/derivedWorksheets.ts) turned a
    categorical dataset into a plain numeric one — doubly odd next to
    `duplicateDataset`'s careful copying of `channelTypes`/`channelRoles`/
    `errorRoles`. Duplicate is an everyday action, and the allowlist would have
    failed again for the NEXT field added, so it is now spread-first: a new
    field is carried by default, and only the arrays callers mutate get an
    explicit deep copy. **Review-round correction:** the first version of this
    entry also claimed the allowlist stripped an Origin import's
    `books`/`book_source`/`figures`/`origin_fidelity`. It does not — and cannot:
    `store/importDatasets.ts` deletes all four (`:166-167`, `:249-250`) before
    `data` ever becomes a stored `Dataset.data`, so they never reach
    `cloneDataStruct`. `cat_levels` is the only demonstrated loss; the rest is
    the CONTRACT being future-proofed, which is what its test actually pins.
  - `useWorksheetView.ts`'s `extractSubset` (the Extract action — the ONE place
    a Data-Filter-narrowed row set becomes a real dataset) built its subset by
    hand and dropped the level table. It now delegates to
    `lib/datasetsplit.ts`'s `sliceDataStruct`, the one row-slice primitive, via
    a new pure sibling `components/Stage/worksheet/extractRows.ts`.
    **Review-round correction, and the most valuable thing this slice found:**
    that delegation was NOT the behaviour-preserving swap the first version
    claimed. Extract's row indices run over `max(numeric rows, TEXT rows)` — an
    Origin book can carry more inline-text rows than numeric ones, and a
    text-only book has `time.length === 0` with the text columns as the whole
    grid — so an index can point PAST `values`. The hand-built literal wrote
    `undefined` into the child for such a row (silent corruption, and the reason
    the sibling stats subset already writes `values[r]?.[c]`); `sliceDataStruct`
    spreads it, so the same input became a `TypeError`. Both were wrong.
    `planExtract` now clamps to rows that have numeric data, refuses when none
    do, and the status line NAMES the rows left behind. Sabotage-verified: the
    clamp removed, the test fails with exactly that `TypeError`.
  - `routes/export.py`'s `export_opj` rebuilt the dataclass by hand to stamp
    `origin_book`, naming five of six fields. Now `dataclasses.replace`, the
    pattern `io/technique.py` and `io/origin_project/__init__.py` already use.
  - `calc/corrections.py` and `calc/resample.py` originally dropped
    `cat_levels`; the audit correctly filed the conservative strip and the
    underlying transformation as **BUG-005**. Closed 2026-09-20 in `df06a518`:
    Corrections masks categorical channels from every y transform and preserves
    their tables/order; Resample refuses a new grid when categories are present
    and treats a coincident grid as a true identity. Browser reimport's related
    allowlist loss is closed by its spread-first projection, and store/workspace
    round-trip tests cover the raw and corrected copies.

  Ruled out by direct inspection, worth recording so it is not re-audited:
  - **No key-shifting mis-map exists** (the worst class, where a column
    insert/delete would slide `cat_levels`' integer keys onto the wrong
    channel). There is no base-column insert/delete/reorder feature; formula
    columns only ever APPEND and `computeFormulas` rebuilds the table from
    scratch on every recompute, including on `removeFormula`. This becomes a
    live risk the day a column-reorder feature lands.
  - **Recipes construct no datasets** — `store/plotRecipes.ts`,
    `globalPlotRecipes.ts`, `plotRecipeApply.ts` and `lib/plotRecipe*.ts` carry
    channel-selection and styling specs only. There is no transformation-recipe
    feature producing derived data, so there is nothing here to propagate
    through yet.
  - Correct already: `lib/facet.ts` (spread row-slice), `store/cellEdit.ts`'s
    `setCategoricalCell`, `store/recode.ts`, `store/split.ts`,
    `store/workbookCombine.ts` (constructs no DataStruct at all).

  **Sites the sweep MISSED, found by the review round** — recorded rather than
  quietly fixed, because they are latent, not live:
  `io/origin_project/preview.py:69` and `io/origin_project/opj.py:332` are two
  more hand-listed `DataStruct(...)` row-slice rebuilds of exactly the allowlist
  shape this slice calls the bug. They cannot drop a level table TODAY because
  OPJ/OPJU import never produces one (the sweep established that separately —
  neither file mentions `cat_levels` or `categorical` anywhere), so fixing them
  now would be a change with no test able to observe it. They become real the
  day OPJ import gains categorical detection, and that is the moment to convert
  them to `dataclasses.replace`. The lesson for the audit record: "every
  DataStruct-deriving site" was a claim the sweep could not support, and a
  second reader found the gap in one pass.

  **Open owner question, not a defect:** every data-export writer
  (`io/xrd_csv.py`, `io/consolidated.py`, `io/origin.py`,
  `io/origin_project/writer.py`, `io/hdf5.py`) and every clipboard/worksheet
  copy path (`lib/clipboardGrid.ts`, `useWorksheetBlockOps.ts`,
  `useWorksheetView.ts`'s row-copy) emits the **raw numeric code**, never the
  level label — uniformly, so it reads as deliberate rather than scattered.
  But it is undocumented and untested for the categorical case, and it is the
  one place the app's otherwise-absolute "never show a raw code" rule does not
  hold. Needs a ruling, then a test either way. Also found this round, booked (not
  fixed) for P1.6/the worksheet-UI slice: `store/cellEdit.ts`'s
  `setCellValue`/`setCellBlock` write a raw `number` into any cell,
  categorical channels included, with NO awareness that the channel is
  categorical — a user can type a code with no entry in the level table
  (e.g. `7.5`, or `-1`) and the write succeeds unguarded. This degrades
  SAFELY today (`level_of`/`levelLabel` render "no label" for that one
  cell per the P2-3/P3-1 ruling, never garbage or a crash) but there is no
  UX yet to prevent, flag, or guide the edit (a level-picker/dropdown, a
  Recode-and-extend-the-table flow) — P1.6's worksheet-UI slice owns
  closing that gap, not this contract.
- [~] Keep ignored instrumental metadata searchable — **this box was FALSE as
  written, and saying so is the finding.** It read "unchanged (pre-existing
  `text_columns`/`comments` sidecars; still stand)". The sidecars did stand and
  the data in them was preserved; it was never SEARCHABLE, which is what the box
  claimed. `lib/projectSearch.ts`'s `metadataEntries` emits only SCALAR metadata
  values and skips `origin_books`/`text_columns`/`label_rows` by name — and
  every sidecar carrying metadata a parser declined to make a channel is a
  COLLECTION, so all four fell through: `comments` (`list[str]`),
  `text_columns` (`{header: [cells]}`), `label_rows` (`list[dict]`) and
  `all_column_names` (`list[str]`). Nothing in any of them was reachable from
  Find in project. Preserving data nobody can find is not the same as keeping it
  searchable, and only a check would have caught the difference.

  **Now searchable (2026-09-09, Group K)** via `lib/projectSearchSidecars.ts`,
  one hit per (dataset, column) or (dataset, row) so a wide sheet cannot flood
  the results: text-column NAMES (revealed in the worksheet, with no `channel`
  claimed — a text column has no channel index); `all_column_names`, minus any
  name that is already a searchable channel label; `label_rows` CELLS, which is
  where sample ids live; and the `comments` preamble, one hit per dataset with a
  count of the other matching lines. Ranked below scalar metadata — someone
  typing "Rxy" means the column, not a mention of it in a discarded header row.
  `origin_books` stays skipped for the original, correct reason. The
  corrupted-sidecar hazard is guarded (a bare string where a string ARRAY
  belongs reads as truthy and JS indexes it character by character);
  sabotage-verified.
  **Review round (same day), eight findings, all real** — recorded because they
  are the substance of this slice, not a footnote:
  - The module **undercut its own performance argument**: it read text-column
    NAMES through `columnmeta.ts`'s `originTextColumns`, which materializes every
    cell (`rows.map(String)`), so it re-materialized every text cell per
    keystroke while claiming to refuse that cost. Measured **55.6 ms** at
    20x2x50k versus **0.0 ms** reading the keys. Now reads the keys.
  - The `all_column_names`-vs-channel-label dedupe compared RAW headers to
    unit-STRIPPED labels (`io/delimited.py`'s `_extract_units` turns
    "Rxy (Ohm)" into "Rxy"), so it no-opped for any header carrying a unit — the
    common case. **The original test could not have caught it: its fixture used
    unit-free headers, which no real `import_csv` output produces.**
  - A text column is listed in BOTH `text_columns` and `all_column_names`;
    reading them independently emitted the same name twice with contradictory
    reveal targets. Now one deduped pass.
  - `labelRows()` also returns the header and units rows, whose cells ARE the
    column names and units — a third near-identical hit for one query. Now only
    `role === "label"` rows, the descriptive ones this feature is about.
  - `colname:<ds>:<name>` was not a unique id (duplicate non-blank headers
    survive the parser), so React keys could collide. Now indexed.
  - An x-cell label-row hit revealed to the plot tab while its row-siblings went
    to the worksheet. The x column renders in the worksheet like any other; that
    was an inconsistency, not a decision.
  - A comment hit showed the HEAD of the matching line, so a long instrument
    line truncated the match away. Now `excerpt()`, like a note hit.
  - The `channel`-index rationale claimed a hit naming the wrong channel "would
    scroll to the wrong place". Nothing scrolls today — `SearchPanel` uses
    `channel` only for status phrasing. The index is still carried correctly,
    but the justification described a consequence that does not exist.

  **`[~]`, not `[x]`, because text-column CELL contents are deliberately NOT
  searched, and that is a measured decision rather than an oversight.**
  `searchProject` runs in a `useMemo` on every keystroke; a full substring scan
  of text-column cells measured (node, this repo, 2026-09-09) at 322 ms for 2.0M
  cells and 2560 ms for 15.0M, in the common NO-MATCH case. A capped scan would
  be silent incompleteness — the exact failure class this plan keeps closing —
  so row-level full-text search over data columns is booked as its own feature
  needing an index, not faked here. What ships searches metadata ABOUT the file,
  bounded by the header block, not by the data.
- [ ] Sample ID, field, or temperature can independently label the legend —
  the representation supports it (any categorical channel can be the group
  column); the Graph Builder wiring to pick ANY such channel as the legend
  source specifically is P1.5.
- [x] Lot/wafer/type can form nested grouping for a box plot. The COMPUTE half
  landed 2026-09-11 (#351); the PICKER landed the same day, so it is reachable.
  **Compute:** `lib/statschooser.groupsByNestedCategory` and its
  index-preserving twin return one group per (factor-A, factor-B) cell with
  finite values, in nested display order, labelled `lot = 1 / wafer = 3`. Flat,
  not hierarchical — a box axis has one slot per box, so they return the same
  shapes the single-factor path does and box stats, the Canvas renderer and the
  pre-aggregated export are untouched. The level ORDER decision lives once in
  `lib/nestedLevels.ts`, shared with the variability chart
  (`lib/variability.buildNestedLevels` was refactored onto it) so the two cannot
  disagree about what a user's level order means — the failure Group O-1 and O-2
  each cost a review round.
  **A PREREQUISITE was broken and is now fixed (#350):** box/violin/strip took
  their axis order from a private ascending-by-code sort and ignored
  `level_order` entirely, while bar layout, the XY split, Tabulate and facets all
  honoured it. Nesting on top of that would have cemented it.
  **Picker (R2b):** a "then by" `<select>` beside "group by" in the Stat Stage
  toolbar, for Box/Violin/Strip. It funded itself with two extractions out of
  `useStatStage.ts`, which sat at exactly its 704-line pin:
  `components/Stage/useStatStagePicks.ts` (the column picks, their per-dataset
  reset, the Graph Builder seed and the staleness mask — moved together because
  the reset MUST stay declared before the seed, "so a same-dataset send wins")
  and `components/Stage/statStageExport.ts` (the whole server-side figure export
  path — the flat spec builder and the faceted variant). The pin ratcheted
  704 -> 569.
  Four rules govern the pick. The first three live together in
  `maskStaleCategoricalPicks`, so one pure function answers "is this pick still
  valid?", and each is sabotage-verified; the fourth is deliberately elsewhere
  and is verified only for Bar (see its bullet):
  * masked back to null when its column stops reading as categorical — the
    `groupCol` treatment (BUG-004), not the `facetCol` one. Every way to set a
    GROUP factor is categorical-gated, so a non-categorical one can only be a
    stale leftover; masking `facetCol` was a review-caught regression because
    Graph Builder legitimately facets on non-categorical columns.
  * inert with no first factor — `groupCol` null selects the per-plotted-channel
    fallback, whose groups are columns rather than levels.
  * inert when the two factors name the same column. The picker omits the chosen
    column from its own list, but "group by" can MOVE onto an already-picked
    second factor, which no list can prevent; review measured
    `groupsByNestedCategory(D, 0, 1, 1)` returning `"lot = 0 / lot = 0"`.
  * inert in Bar/Q-Q/Histogram, gated in the hook rather than the mask (the mask
    answers "is this pick still valid?", not "does this mode use it?"). Bar
    builds a category x series MATRIX from one column; the toolbar hides the
    control there rather than showing one that does nothing, and the pick
    survives a round-trip through Bar. Only the BAR half is testable: Q-Q and
    Histogram resolve no groups at all, so nesting is unobservable there
    whatever the gate says. The claim was originally written as "each with its
    own sabotage-verified test" and narrowed when review checked it.
  The axis names both factors ("lot / wafer"), matching the tick convention
  underneath it, and facet panels nest identically to the flat panel. The TICKS
  stack the two halves on separate lines (`statRenderAxes.drawCategoryAxis`):
  review found the composite label being truncated to 14 characters, so
  `lot = 0 / wafer = 0` painted as `lot = 0 / waf...` and every box under one lot
  shared a tick — the caption promised two factors the axis could not show. The
  connect-means interaction line is segmented at each outer-factor boundary
  (`lib/statstage.connectMeansBreaks`) for the same reason the channel fallback
  refuses it: a line from `lot = 0 / wafer = 1` to `lot = 1 / wafer = 0` asserts
  a trend between two lots that share no wafer.
  **Residual fixed (follow-up to this change):** `facetByOptions` now omits
  BOTH the current `groupCol` and the current `group2Col`, the same shape
  `thenByOptions` already used to omit `groupCol`. Facet by `site` + then by
  `site` gave every box in a panel the same constant nested half; faceting by
  the "group by" column was equally degenerate (one level per panel -> one
  box). Both are picker-level exclusions in `StatStage.tsx` — the data was
  always correct, only the plot was noise, so this is a UI-layer fix with no
  calc change. `lib/statstage.ts`'s `maskStaleCategoricalPicks` deliberately
  stays untouched: it does not mask `facetCol` at all (see its comment) — the
  Graph Builder seeds `facetCol` from `spec.zones.facet?.channel` with no
  categorical gate, and faceting on a non-categorical column is a supported
  configuration; masking `facetCol` was already tried once and reverted as a
  regression. Picker-level exclusion is the right layer: it stops the user
  from ASKING for the degenerate case through this picker, while a value that
  arrives another way (a Graph Builder seed, or "group by" moving onto the
  current facet afterwards) is left alone because the data stays correct
  either way. Covered by `StatStage.test.tsx` (facet-by omits `groupCol`;
  facet-by omits `group2Col`; both sabotage-verified — removing either half of
  the filter turned the corresponding new test red) and
  `useStatStage.test.ts` (a Graph Builder seed with `facetCol` equal to
  `groupCol` still applies `facetCol` unmasked — also sabotage-verified).
  **No backend change, as predicted and now asserted:**
  `routes/export_statplots.py` takes pre-aggregated `data[][]` + `labels[]`, so
  it is already group-count-agnostic and composite labels flow through as
  ordinary strings — pinned by a test that exports a nested plot and reads the
  spec back.
  **It cost eager bundle bytes, and the budget moved to pay for them**
  (915,735 -> 917,635, with the measurements in `check-bundle-size.mjs`). #351's
  compute was tree-shaken out because nothing eager imported it; R2b wires it
  into `resolveGroups`, which the stage calls synchronously during render, so it
  arrives in the eager graph for the first time. Two reductions were taken first
  (deduping the two nested builders into one walk, ~0.1 kB; moving the export
  path out of the hook), and the lazy split the gate prescribes was built,
  measured and REVERTED for the second time in this repo's history — it made the
  eager total worse, 895.2 -> 895.6 kB, because the chunk plumbing cost more
  than the 1.93 kB it moved.
- [x] Existing numeric projects migrate unchanged — additive by
  construction (`cat_levels` absent = byte-identical to before this field
  existed, both languages); pinned by `test_cat_levels_absent_is_additive_
  byte_identical` and the full existing suite passing unmodified (`uv run
  pytest -m golden`: 155 passed, 0 failed, same as pre-slice).

### P1.5 — Live Graph Builder grouping parity [~]

**Goal:** Group/Facet must match and remain editable across preview, Stage,
Figure Builder, workspace, and export.

**Models:** GPT-5.6 Terra high / Claude Sonnet 5. **Dependency:** P1.4.

**Slice shipped (2026-08-18, Lane C, `claude/p15-live-grouping`):** the Group
well's channel is now a durable LIVE binding, not just a Publication-Preview-
only one. Root cause traced precisely before writing any code: the canonical
`FigureDocument.bindings.groupKey` already existed (F2.3h) and already drove
Publication Preview + backend export (`calc.plotting.build_grouped_series`)
end to end — but `figureDocumentToPlotView`, the ONE bridge that projects a
document into the shape the interactive Stage canvas (`usePlotPayload` ->
`PlotViewport`/uPlot) actually reads, silently dropped `groupKey` on the
floor. `PlotView` gains a `groupKey: number | null` field (bindings-owned,
excluded from `FigureViewState` exactly like `xKey`/`yKeys`/`errKeys` —
`figureDocument.ts`); `store/useApp.ts` gains a `groupKey` singleton +
`setGroupKey` (mirrors `setXKey` — undo history + macro record) that rides
the SAME `snapshotView`/`hydrateView`/`.dwk` machinery every other PlotView
field already does, for free, since `VIEW_KEYS` is derived from
`defaultPlotView()`'s own keys. A new `lib/plotGroupSplit.ts` (a fresh
sibling module, funding itself rather than growing `lib/plotdata.ts` past
its `architecture.test.ts` pin) INDEPENDENTLY implements the same split
algorithm `lib/plotspec.ts`'s `buildXY` already has (same finite-code sort,
same `${label} (${groupLabel}=${levelLabel})` format, same
`lib/categorical.ts` `groupLevelLabel` accessor) — review round P2
corrected an initial claim that this was merely "a second call site" of
shared code; it is two hand-written functions, proven equivalent by a REAL
runtime parity test (`plotGroupSplit.test.ts`: builds the identical payload
through both and asserts `toEqual`), not by construction. That test also
caught and fixed one real, if previously inert, divergence: `applyGroupSplit`
was missing `buildXY`'s explicit `Number.isFinite` mask on a non-finite Y
value (harmless today only because the upstream fetch already nulls
non-finite values before either function sees them — fixed to not rely on
that invariant). Item 3 is satisfied by this proven equivalence, not by a
new backend/frontend label-resolution site. `usePlotPayload.ts` calls
it client-side, row-position-aligned to the already-loaded dataset, on the
never-decimated fetch (`plotDecimate.ts`'s `decimationRequestEligible` gains
`hasGroupSplit`, same "can't tolerate a reduced row set" reasoning error
bars/color-by-column already established). `useGraphBuilder.ts`'s
`commitToPlot` now calls `setGroupKey` instead of toasting "series-split by
group is preview-only in v1" (item 6's stale wording — the toast itself
WAS the stale artifact; removed, not reworded).

- [x] Durable live grouped series with stable identity/style — GROUP-WELL
  CORE, per the dispatch's own scoping. Identity is stable by construction:
  `usePlotPayload`'s `plotted` array (the SAME array `styleList`/
  `labelList`/`hidden`/`PlotLegend.tsx`/`PlotContextMenu.tsx` already keyed
  restyle/hide/legend/context-menu against) repeats each real channel once
  per level rather than inventing a separate per-level identity — see the
  edit-one/edit-all ruling below for why. Survives hide/reorder/restyle/
  legend-interaction/undo/redo/close-reopen/export — pinned in
  `usePlotPayload.groupSplit.test.ts`, `groupKey.test.ts` (undo + `.dwk`
  round trip), `useGraphBuilder.test.ts`, and the E2E journey below.
  A genuine bug caught by the `.dwk`-round-trip test before it shipped:
  `windowDocumentPersistence.ts`'s `migrateLegacyWindow` (the pre-F1/
  document-less window bridge) built its `FigureDocument` without threading
  `view.groupKey` through at all — a document-less grouped window would have
  silently lost its binding on the very next save/reload. Fixed
  (`groupKey: window.view.groupKey` now threaded explicitly, since
  `createFigureDocument`'s `groupKey` is bindings-owned and never reads
  `view.groupKey` on its own — see that function's own doc).
- [x] Explicit edit-one/edit-all behavior — RULING (JMP-parity, pinned in
  `lib/plotGroupSplit.ts`'s header, not re-litigated per call site): restyle,
  hide/show, and legend-click on ANY one of a group's expanded levels affect
  the WHOLE group — there is no separate per-level identity to edit
  individually. Matches (a) JMP Graph Builder's own default overlay
  behavior (one style setup per grouping variable; per-level colour is
  automatic, not independently editable) and (b) this codebase's OWN
  pre-existing Figure Builder precedent (`GroupingPanel.tsx`'s single
  group-by picker + one `seriesStyles[channel]` entry per Y channel, no
  per-level styling surface already existed before this slice). The
  Inspector needs no changes at all under this ruling — it always operated
  on real dataset channel indices, never the render-time expanded series, so
  a grouped channel's Inspector entry is unaffected by construction.
- [x] Editable after Send (G4 commit semantics) — confirmed already-durable
  via the canonical `FigureDocument.bindings.groupKey` path (unchanged this
  slice); the NEW live-Stage wiring rides the identical binding, so a
  grouped figure committed from Graph Builder, edited on either surface
  (live Stage OR Publication Preview), and reopened from either the Library
  or a `.dwk` load, reads back the same group.
- [x] Merge level-table remap (P1.4's booked item) — `lib/merge.ts`'s
  `mergeDatasets` now does REAL conflict resolution instead of the P1.4-era
  safe "drop the channel on any mismatch" default: a channel whose datasets
  ALL carry SOME level table (possibly differing in strings or order) merges
  onto a coherent UNION table (first dataset's own order, then each
  subsequent dataset's genuinely NEW levels appended in first-seen order),
  remapping every dataset's own codes losslessly (`planChannel`/`remapFor`).
  The one remaining drop case — a channel with NO table at all on even one
  input dataset — is intentionally unchanged: there is nothing to remap FROM
  when a dataset's raw values were never codes into anything.
- [x] Update stale wording/help — the "preview-only" toast (the one stale
  artifact a repo-wide search found) is gone; `group-facet-journey.spec.ts`'s
  own header, which had explicitly documented "the interactive uPlot Stage
  canvas has NO live rendering for a group split at all today" as an
  architectural fact shaping that journey's scope, is corrected to describe
  the new reality and points at the new live-Stage test below.
- [x] E2E covers drag-to-Group, edit, undo, reopen, export parity —
  `group-facet-journey.spec.ts` gains a SECOND journey (the first,
  Publication-Preview-only journey is untouched and still passes): drag Y +
  Group via the real Graph Builder wells -> "Create New Plot" -> the live
  Stage legend renders one row per group level (real uPlot canvas, no
  mocks) -> undo collapses to one series -> redo restores the split ->
  close the window (real title-bar context menu) -> undo-the-close (a
  genuine close/reopen round trip through the real UI, mirroring
  `window-arrange.spec.ts`'s own close pattern — the original default
  window stays open throughout, so the ≥1-window invariant is never at
  risk) -> a real "Export figure…" request from the reopened window still
  carries `group_col`. NOT independently run in this session's sandbox: the
  Playwright browser download (`cdn.playwright.dev`) is blocked by this
  session's egress policy (confirmed via the agent-proxy's own diagnostic,
  not assumed) — the spec is verified syntactically (`tsc -p e2e/tsconfig.json`
  clean, `playwright test --list` discovers both tests) but has NOT been
  executed against a real browser this session. Needs a CI run or a
  developer machine with network access before merge.

**Review round fixed same-day:** P1 (probe-proven blocker) — `groupKey` was
a channel-indexed field that never reached `store/windowDefaults.ts`'s
`datasetViewDefaults()` reset table, the shared choke point `setActive`
(Library click), `addDataset` (import/paste/merge), and a shape-changed
reimport all rely on; a stale group binding rode into a differently-shaped
dataset. Fixed with the one-line addition the choke point's own design
calls for, plus a NEW coverage test pinning `datasetViewDefaults`'s full
channel-indexed field list (`store/windows.test.ts`) so the next such field
addition can't silently skip it the same way. P2 (doc accuracy) —
`plotGroupSplit.ts`'s "second call site of the identical algorithm" claim
was falsifiable as written (two independently hand-written functions, no
shared code, no runtime check backing the claim); fixed with a REAL
parity test (`plotGroupSplit.test.ts`, `buildXY` exported for it) plus the
one real (previously inert) divergence it surfaced — `applyGroupSplit`
missing `buildXY`'s explicit non-finite-Y mask, harmless today only because
the upstream fetch already nulls those values first. P3 (nitpick) — a
one-line comment in the E2E spec now names which assertion is load-bearing
for the close/reopen proof, since the final export step also re-commits
the Graph Builder's own live spec.
- [x] Supported statistical/scientific faceting — completed later by the
  F4.4 campaign (#222/#226/#227/#232/#234): `facetKey` is a durable
  bindings-owned field, rebuilds the small-multiples grid after focus change,
  `.dwk` reopen, and recipe application, and reaches every export/page/hitmap
  path. Background-window and restored-single-series regressions are pinned
  too. The older slice note claiming `facetKey` remained unwired was stale.
- [x] Data Filter workbench wiring through `is_categorical`/
  `isCategoricalChannel` — verified: `useDataFilter.ts` already ran every
  column through `lib/modeling.ts`'s `channelModelingType` (itself gated on
  `isCategoricalChannel` as its strongest signal, checked before the
  numeric-shape heuristic and after a `channelTypes` override) since the
  workbench's original creation (#53) — a categorical column already got a
  level-membership ("set") predicate + imported level labels
  (`fix(filter): show categorical level labels`, #321), not a numeric
  range, and a continuous one already got a range. The `datafilter`
  directory carrying no *direct* import of `isCategoricalChannel`/
  `is_categorical` (the grep this box was written from) reflected the
  correct chokepoint discipline — go through `channelModelingType`, not the
  raw accessor — not a missing wire. What this slice actually added: test
  coverage pinning the override-wins rule THROUGH this workbench (not just
  `lib/modeling.test.ts`), a categorical filter's save/reopen round trip
  through `lib/workspaceSerialize.ts`/`workspace.ts` (`useDataFilter.test.ts`),
  and a fix for a real gap the review surfaced — a filter predicate written
  under a column's prior classification is now masked from display (not
  silently misrendered) rather than left to garble whichever control can't
  represent it; see BUG-003 (`plans/BUGS_AND_ISSUES.md`) for the still-open
  question that leaves about `lib/datafilter.ts`'s row-filtering side.
  **Tabulate and Stat Stage are OUT OF SCOPE for this slice** (one
  workbench per PR) — their halves of this box stay open below. NOTE for
  whoever picks either up: a quick grep while scoping this slice shows
  `useTabulate.ts` and `lib/statstage.ts` ALSO already import
  `channelModelingType`/`isCategorical` (group-column auto-selection,
  category-label resolution via `resolveCategoryLabels`) — this box's
  "never consume it" premise may be stale for them too, the same way it
  was for Data Filter, but that was not verified here (no test-suite read,
  no override/round-trip check, no sabotage-verified coverage) and must
  not be assumed done from a grep alone.
- [x] Tabulate workbench wiring through `is_categorical`/
  `isCategoricalChannel` — verified: `useTabulate.ts` runs every group-by
  candidate through `lib/modeling.ts`'s `channelModelingType` (override
  checked before `isCategoricalChannel`/inference, same chokepoint Data
  Filter uses) for its default group-column pick (`firstCategorical`), its
  `groupIsCategorical` warning flag (">30 rows, one group column looks
  continuous" notice), and Stat Stage's sibling default picker
  (`lib/statstage.categoricalChannels`/`firstValueChannel` mirror the same
  functions — see below). Override wins immediately: pinned by
  `useTabulate.test.ts`'s "a channelTypes override wins for
  groupIsCategorical, without hiding the stale selection or breaking the
  table" — sabotage-verified (reverting `lib/modeling.ts`'s override
  precedence makes it fail; the rest of the suite stays green). The
  classification does NOT drive the actual bucketing algorithm
  (`lib/tabulate.ts`'s `tabulateNested` groups by distinct OBSERVED value
  regardless of type — that's deliberate, matching JMP's own Tabulate,
  which tabulates whatever column you drop in), only the default pick and
  the warning; both are recomputed fresh every render (not memoized behind
  stale state), so an override applied while Tabulate is open self-heals
  immediately with no BUG-003-style stale-selection risk — the ZoneWell
  "Group by" well never filters its option list by classification in the
  first place, unlike Stat Stage's pickers (see below), so there is no
  control whose option list could stop matching a stored value.
  **Persistence:** none — `groupCols`/`valueCols`/`statKeys`/`grandTotal`
  are local `useState` in the hook, not part of `.dwk`/workspace
  serialization (only the window's open/closed boolean, `tabulateOpen`,
  persists); the underlying `channelTypes` override itself DOES persist
  (`lib/workspaceSerialize.ts:213`, `lib/workspaceDatasetParse.ts:173-183`)
  since it lives on the `Dataset`, not the workbench. This mirrors how
  Distribution/other on-demand summary panels work in this codebase (a
  recomputed view, not saved config) and was not treated as a defect.
- [x] Stat Stage workbench wiring through `is_categorical`/
  `isCategoricalChannel` — verified, and wired MORE strongly than Tabulate:
  `useStatStage.ts`'s "group by"/"facet by" `<Select>` OPTION LISTS
  themselves are restricted to `lib/statstage.categoricalChannels`
  (`channelModelingType`-gated, override-first), so a non-categorical column
  is not offered in the pickers — a stronger wiring than merely defaulting
  away from one. **Corrected in review the same day:** an earlier version of
  this entry said a non-categorical column "cannot even be picked through the
  real UI". That is FALSE, and acting on it caused a regression. The pickers
  are not the only entry point: `useGraphBuilder` seeds the stage directly, and
  while it gates `groupCol` on `isCategorical(...)`, it passes `facetCol =
  spec.zones.facet?.channel` through UNGATED — and `facetSlices` has no
  categorical gate either. Faceting on a non-categorical column is therefore a
  supported configuration Graph Builder produces deliberately and announces as
  "faceted by <label>". See BUG-004 for the consequence.
  Classification genuinely changes behavior, not just defaults: `groupCol
  != null` vs `null` switches `resolveGroups`/`resolveGroupsIndexed`/
  `computeBarData` between a real per-category partition
  (`groupsByCategory`) and the per-plotted-channel fallback
  (`groupsFromColumns`); `showConnectMeans` ("connect means" interaction-
  plot line) is force-gated off under the fallback regardless of the
  toggle state. Override wins (same `channelModelingType` chokepoint).
  **Found and fixed the exact analogue of BUG-003 this box's own note
  predicted** ("a stored selection ... can outlive the column's
  classification"): a picked `groupCol`/`facetCol` survived a
  `channelTypes` override that de-categorized it, stranding a stale index
  its own picker no longer offered — filed and fixed as **BUG-004**
  (`plans/BUGS_AND_ISSUES.md`). Unlike BUG-003's Data Filter finding (left
  display-only pending an owner call on `lib/datafilter.ts`'s shared
  row-filtering), this fix masks BOTH the picker display AND the actual
  grouping/faceting computation, since `groupCol`/`facetCol` have exactly
  one consumer — this hook — so there's no app-wide blast radius to defer;
  see BUG-004 for the full reasoning and the cross-reference back to
  BUG-003's still-open question. Sabotage-verified:
  `useStatStage.test.ts`'s "stale channelTypes override on groupCol/
  facetCol (BUG-004)" block (3 tests; reverting the masking makes all
  three fail, 26 others stay green). One pre-existing test in the same
  file had to be reworked to force its "zero groups" edge case through a
  column that stays genuinely categorical (see BUG-004's Tests section for
  why). **Persistence:** none for `mode`/`groupCol`/`facetCol`/`valueCol`
  (local `useState`, reset on dataset-id change, no `.dwk` entry) — only
  the `statMode` boolean (Stage-view-open/closed) persists via `PlotView`
  in `lib/plotview.ts`; same "recomputed view, not saved config" pattern as
  Tabulate, and the underlying `channelTypes` override persists via the
  `Dataset` itself regardless.

### P1.6 — Import Wizard metadata and error roles [~]

**Goal:** fully describe arbitrary scientific data during import and save the
mapping as a reusable template.

**Models:** GPT-5.6 Terra medium / Claude Sonnet 5. **Dependency:** P1.4.

**Slice 2 shipped (2026-08-18, Lane C, `claude/p16-import-wizard`, built on
the merged P1.4 backend, PR #173):** the Import Wizard role-assignment UI
over `routes/import_preview.py`'s payload. Backend: `ImportSettings` gains
`label_line: int | None` (the "default legend-label row" — its per-column
cells override each channel's display label) and every preamble line above
`data_start_line` not consumed as header/units/label is retained verbatim
in `metadata["comments"]` (`io/import_preview.py`, mirrors
`io/delimited.py`'s existing convention exactly) instead of silently
dropped. Frontend: `lib/errorRoles.ts`'s pairing algorithm extracted to a
label-only `inferErrorBindingsFromLabels` (zero behavior change, existing
tests pin the equivalence) so the wizard can seed error-role SUGGESTIONS
from a preview's column names before any DataStruct exists; a new
`ErrorRolesEditor.tsx` + `useImportErrorRoles.ts` (a second, narrower state
hook alongside `useImportWizard.ts` — not a Zustand slice, matching that
hook's own existing all-local-state convention) render one editable
target/axis/side row per `error`-role column, pre-filled with the
suggestion ONLY when unambiguous — an ambiguous column renders as an
explicit "— unassigned —" row, never a guessed default, and only rows the
user leaves assigned become `Dataset.errorRoles` on Import. Saved-filter
reapply (`applyFilter`) now re-previews the CURRENT file under the
candidate filter's settings and refuses the WHOLE apply — current
settings/preview untouched, every unmatched column named — on a column-
count or name mismatch (`lib/importwizard.resolveImportFilter`, mirroring
`quickPlotTemplates.resolveTemplate`'s refusal SHAPE only, no coupling to
that module). An explicit Cancel button was added alongside the existing
window-close control (both leave zero state behind — `ImportWizardPanel`
only mounts while `importWizardOpen`, AppOverlays.tsx).

- [x] Preview/select multiple header/comment/metadata rows — INTERPRETED as
  three independently-selectable rows (header/units/label, each with its
  own field) plus automatic retention of everything else in the preamble
  as searchable `comments` metadata, rather than a per-line multi-select
  checkbox UI (every preamble line is ALREADY retained by default, so an
  explicit per-line "mark as metadata" toggle would add UI weight with no
  behavioral gain — see the Day-1 scope note if that changes).
- [x] Select the default legend-label row — `label_line`, above. At the
  `io/import_preview.py` function level, an out-of-range `label_line`
  silently no-ops (falls back to the header-derived name) — same
  convention `header_line`/`units_line` always had, not a new gap (review
  round P3(c) audit: doc claim now matches the actual, always-shared,
  out-of-range behavior of all three line settings). The ONE path where
  this convention is deliberately overridden is a saved-filter reapply
  (`resolveImportFilter`, review round P1-2): there, a saved line landing
  at-or-past the FRESH file's own detected data start is treated as a
  signal the filter no longer fits this file at all, and the whole apply
  is refused rather than silently no-op-ing into a wrong-looking import.
- [x] Assign symmetric/asymmetric X and Y error roles explicitly —
  `ErrorRolesEditor`'s target/axis/side pickers, above.
- [x] Suggest common adjacent/name patterns, confirm ambiguity —
  `inferErrorBindingsFromLabels`-seeded suggestions, editable before Import.
  TWO-TIER (review round P1-1): a NAME-driven match (base-name, e.g. `dR`
  -> `R`; or an explicit `x`-prefix) is always a real, pre-filled
  suggestion. A POSITION-only match (nearest preceding column, no name
  signal) is a real suggestion ONLY when single-candidate — nothing
  plausible follows the error column, e.g. `Temp, M, err`; when another
  non-error column ALSO follows (e.g. `T1, "T err", T2`, genuinely
  ambiguous between the two), it demotes to unassigned instead of binding
  to whichever happens to precede. Surgical to the wizard's own
  `suggestErrorBindings` — `errorRoles.inferErrorBindingsFromLabels`
  itself is untouched for its other callers.
- [x] Assign categorical/text roles without losing raw strings — the P1.4
  `categorical` role (and `label`'s `text_columns` capture) now appear in
  the wizard's own `ROLE_OPTIONS` (previously P1.4 built the backend role
  but "the existing wizard simply doesn't offer it yet" — now it does).
- [x] Retain ignored preamble as searchable metadata — `comments`, above.
- [x] Save/reapply mappings/transforms with mismatch explanation —
  `resolveImportFilter`, above. Import mappings (`ImportFilterWire`/
  `io.import_filters`) stay their OWN object; no coupling to
  `store/quickPlotTemplates.ts` was added.
- [x] Live preview plus Apply/Cancel — preview was already live (debounced
  re-preview on every edit); Cancel is now an explicit button in addition
  to the window's close control. NARROWED (review round P2-2): "live"
  covers every OTHER settings edit (delimiter/header/units/data-start/
  role/name), but a `label_line` override's RESOLVED text is not itself
  reflected anywhere in the preview table's per-column name cell — that
  cell is `c.name` (header-derived, or `column_names` if hand-edited),
  the SAME field wired to `setColumnName`, so folding the label override
  into it would silently conflate a derived suggestion with a user's own
  typed name (and a later hand-edit would permanently clobber the
  override display for no data reason). The raw-lines table already
  highlights the selected `label_line` row with a "label line (legend
  labels)" badge so the row itself is visible; showing its RESOLVED
  per-column text needs its own display slot in `PreviewTable`/
  `preview_import`, not a same-field overwrite. Booked to P1.6b.
  SHIPPED (P1.6b audit, 2026-09-07): `preview_import`'s half was already
  done — `ImportPreviewColumn.effective_name` (backend PR #197, "P1-5
  DEFECT 2") is exactly this display slot: `label_overrides[k]` when
  `label_line` applies, else the header-derived `name` unchanged, its OWN
  field alongside `name` rather than overwriting it. Checked before
  re-adding it, per this booking's own instruction; nothing new was added
  backend-side. The `PreviewTable`/`useImportErrorRoles`/`importwizard.ts`
  frontend already CONSUME `effective_name` (suggestion classification,
  figure labels) but do not yet RENDER it as a visible cell distinct from
  the editable `name` input — that visual half remains open, is a frontend
  (not backend/import-contract) change, and is unbooked.
  **Closed 2026-09-12, shipped 2026-09-07 commit `3b1ad5a1` (#314), "show
  metadata and effective legend labels":** `PreviewTable.tsx`'s header cell
  (lines 96-104) now renders `Legend label: {c.effective_name}` whenever
  it differs from the editable `c.name`, styled distinctly (`--accent`) and
  titled to explain what it means; `PreviewTable.test.tsx` (lines 71-80)
  pins it showing for a changed column and staying absent for an unchanged
  one.
- [x] No guess can silently attach error to the wrong signal — pinned
  red-first (`suggestErrorBindings` leaves a genuinely ambiguous column
  with NO suggestion at all; `confirmedErrorBindings` drops any row the
  user leaves unassigned before it ever reaches `Dataset.errorRoles`).

**P1.6b (worksheet categorical UI) — SHIPPED 2026-08-19 (Lane C2,
`claude/j2-recode-worksheet`, same slice as JMP_GAP_PLAN's J2 Recode
workshop — the two share `store/cellEdit.ts`/`lib/categorical.ts`, which is
why one lane owned both):** the two items booked here, not shipped in the
P1.4 review slice below —
1. Worksheet C/O/N modeling-type visibility: `GridHeader.tsx` now shows a
   per-column badge/select (`auto·C`/`auto·O`/`auto·N` or an explicit
   override), wired to `setChannelType`. That action's signature widened to
   take an EXPLICIT dataset id rather than `get().activeId` — the
   worksheet's floating MDI window (GUI_INTERACTION #14) can browse a
   NON-active dataset, so the old signature would have silently mutated
   the wrong one the first time this control was used from there.
2. `store/cellEdit.ts`'s categorical cell-edit guard: `setCellValue`/
   `setCellBlock` now REFUSE (zero mutation, status message) a non-NaN
   numeric write that isn't an existing level code for a categorical
   column. RULING on the three named options (pick-existing / extend-the-
   table / refuse) — all three are offered, at different layers: the new
   `setCategoricalCell(id, row, col, label)` action is the level-aware
   entry point the worksheet's cell editor calls with a TYPED LABEL (not a
   code) — it picks an existing level case-insensitively, extends the
   table with a genuinely new label (one undo entry, never implicit), or
   clears to missing on blank input; the raw numeric path
   (`setCellValue`/`setCellBlock`, used by paste/fill) REFUSES an
   out-of-range/non-integer code instead, since a bare number gives no
   signal whether it's a typo or a deliberate pre-coded paste. `GridRow.tsx`
   displays the LEVEL LABEL (not the raw code) and edits via a level-picker
   `<select>` (+ "Add new level…") instead of a free numeric input.
   Gates: full `vitest run` 522 files / 7705 tests passed; bundle-size OK,
   862.0 kB eager (21.9 kB under budget) — the Recode workshop itself is a
   separate lazy chunk, not part of this cost.

### P1.7 — Project portability and source relinking [~]

**Goal:** move/share projects without confusing raw, linked, corrected, and
derived data.

**Models:** GPT-5.6 Sol high / Claude Opus 4.8. **Dependencies:** P1.1-P1.2.

**Slice 1 shipped (2026-08-18, Lane B, `claude/p17-relink-portability`,
built on the merged P1.1 bridge `#169` and P1.2 lifecycle `#180`):** the
relink core (path matching + provenance + missing/offline/changed/
permission-denied probing + atomic commit) and the mode CONTRACT. The full
portable-bundle packer ("Pack Project") is explicitly deferred — see below.

**The mode contract (box 1).** Written in `lib/projectPortability.ts`
(`ProjectPortabilityMode = "embedded" | "linked" | "portable"`, full
rationale in that module's doc):
- **embedded** — today's ONLY implemented behavior and the de-facto default
  (L0.32): the `.dwk` carries a full `DataStruct` snapshot per dataset, so
  opening never depends on sources being reachable; a source going
  missing/offline/changing is entirely a Relink/Reimport concern (this
  slice), never an open-time failure. `Dataset.source` (path + provenance)
  still rides along even in this mode.
- **linked** — NOT implemented: no writer strips a save-time snapshot and no
  reader rehydrates one from sources at open time yet. Needs its own
  save-time UI decision and open-time "resolve every source first" flow, a
  materially different shape from what box 3 (relink) needed. Named home:
  a future P1.7 follow-up slice.
- **portable** — **BACKEND COMPLETE (2026-09-06, PRs #305-#308 + this PR
  5 audit); the visual workflow SHIPPED the same day in PR 6 (#310) — see
  below. (Corrected 2026-09-09: this bullet previously said "the visual
  workflow is NOT shipped" in the same breath as describing PR 6 shipping
  it two sentences later — stale wording left over from drafting the PR 5
  audit before PR 6 landed; the sentence never reflected a real gap once
  both were read together.)** The raw-file-copying
  "Pack Project" packer (`quantized.portable` + `desktop_bridge_pack
  .DesktopPackBridge`) builds a bundle, and the resulting bundle is
  physically MOVED to a new location and reopened, proven in tests: the
  pack → move → reopen roundtrip in
  `tests/test_portable_pack_roundtrip.py::test_pack_move_and_reopen_roundtrip`
  (backend) plus `lib/workspace.test.ts`'s "workspace bundle-relative
  source" describe block, including a full `checksum`/`mtime`/`size`/
  `packedFrom` provenance round trip (frontend parse side). The visual
  "Pack Project" workflow shipped in PR 6 (2026-09-06, `#310`,
  `sol/pack-project-ui-1`; verified 2026-09-09 against `main` commit
  `5b9b89b0` "feat(pack): P1.7 PR 6 — Pack Project workflow UI (#310)",
  with `frontend/src/components/workshops/packproject/
  PackProjectPanel.tsx` + its 21-case `PackProjectPanel.test.tsx` present
  on `main`):
  File → "Pack Project…" opens a lazy `ToolWindow`
  (`components/workshops/packproject/PackProjectPanel.tsx`) driven by PR
  4's state machine — destination picker, review step (per-source
  readiness/size, warnings, blockers, refuse-overwrite), per-file and
  byte progress, cancel, and completed/cancelled/failed outcomes, every
  one carrying the "nothing original was modified" note. The panel's open
  flag is a store (`store/packProjectPanel.ts`); the command body is the
  lazily imported `commands/packProjectCommands.ts`. Three review rounds
  on that PR closed a mount-time open/idle race, a store wedged by a
  preview throw, a headless preview after an early close, clipped review
  text, and two consent-footprint leaks (`pack_reset` now clears the
  write-dir grant; a cancelled picker resets fully). See the "Pack Project
  stack" subsection below. Named home: same P1.7 follow-up, tracked as
  "Pack Project".

**Provenance (box 2).** `Dataset.source` (`lib/datasetSource.ts`) gained
`checksum`/`mtime`/`size`, captured from the desktop bridge's new
`probe_source` js_api method at IMPORT time (desktop-only — "where
practical" per L0.32; a browser upload has no bridge to ask, and degrades
honestly to path-only provenance, pinned in `importDatasets.test.ts`) and
again at RELINK/reimport-as-new-version time. **Gap found and closed
honestly:** before this slice, `Dataset.source` recorded ONLY `path` — no
checksum, no observed mtime, despite L0.32's plan text already promising
both; `importedAt` existed but nothing captured a source FINGERPRINT at
all, so "did the source change" was structurally unanswerable. Never
silently rewritten: a relink backfills provenance only for a row whose
verdict is `unchanged` (same bytes, still true) or `unknown` (nothing was
ever recorded — filling a gap, not overwriting a value); a `changed` row is
excluded from commit entirely (box 5). Raw source files on disk are never
written to by anything in this slice — the desktop bridge's probe/checksum
path opens files strictly read-only (`open(path, "rb")`).

**Relink-one / relink-folder + dry-run preview (box 3).** One store
(`store/relink.ts`) covers both — relink-one is just relink-folder with a
single dataset's own path as the "old root". `lib/relink.ts` is the pure,
cross-platform path-matching core (`suffixUnderRoot`/`relinkedCandidate`,
unit-tested for POSIX, Windows drive-letter, UNC, and cross-platform-move
shapes, case-insensitive, either separator). The preview runs entirely
before commit (`runPreview` populates `RelinkPreviewRow[]` with a
per-dataset status); `commit()` is ONE `recordHistory` call covering every
resolved row, so undo restores every relinked path in a single step
(pinned in `relink.test.ts`).

**Missing/offline/changed/permission-denied (box 4).** New
`desktop_bridge.py` js_api method `probe_source` (backed by the pure
`desktop_source_probe.py`, split out to stay under the 500-line ceiling)
returns `ok`/`missing`/`offline`/`invalid`/`permission_denied` plus
`size`/`mtime`/an optional checksum. **The consent ruling** (documented in
full in `desktop_bridge.py`'s module doc): a checksum needs a full file
READ, a strictly bigger ask than the reachability check `path_status`
already makes with zero consent — so a NEW js_api method,
`grant_source_paths`, extends read consent for paths eligible under a
server-tracked *declared-source set*. `probe_source` itself still computes
a checksum only when the resolved path is already consented at call time —
an unconsented path never yields file content, only reachability. Browser
degrade: with no desktop bridge, every preview row reports `unavailable` —
box 4's "say so, never guess" — never a guessed reachability state
(`store/relink.ts`'s `bridgeAvailable` gate, pinned red-first in
`relink.test.ts`).

**P1-A fix round (adversarial review, 2026-08-18, same slice):** the FIRST
version of `grant_source_paths` was a bare passthrough to `grant_paths`,
trusting the frontend's own argument list as authority — the reviewer
verified this as a real, unconditional arbitrary-file-read-consent oracle
(no dialog, no project even open, any JS in the window could self-grant
read consent for e.g. a user's SSH key, then read it through the existing
`/api/parsers/import` route). Fixed by making the declared-source set
BACKEND-tracked and enforced server-side: `desktop_consent.py`'s
`set_declared_sources`/`is_declared_source`, populated ONLY as a side
effect of `_read_granted` (`open_project_file`/`read_project_file`, both
reachable only via a real native dialog) parsing the just-opened payload's
OWN `datasets[].source.path` values (`desktop_project_file
.extract_declared_source_paths`) — wholesale replacing any prior project's
declared set, never accumulating. `grant_source_paths` now intersects its
request against that set before ever calling `grant_paths`; the frontend's
argument list is a request against backend state, never an authority of
its own. Red-first proven both directions (`test_desktop_bridge.py`): a
path no open project declared stays ungranted; the SAME request mixing a
legitimately declared path with a poisoned one grants only the declared
one (the "compositional pin" — `store/relink.ts`'s argument list, computed
from in-memory frontend state, cannot smuggle in anything the backend
didn't itself see declared). Accepted residual scope, stated plainly in
`desktop_bridge.py`'s doc: once a project IS opened via a real dialog,
whatever it declares is eligible — the same trust act `pick_files` already
grants a physically-selected file, applied to content instead of
selection; this fix closes the unconditional oracle, not full sandboxing
against a hostile payload's own declared paths.

**P1-B fix round (adversarial review, same slice): provenance completeness.**
`workspace.ts`'s `parseSource` reconstructed a bare `{kind,path}` on every
load, silently dropping checksum/mtime/size — and `versionOf` was missing
from the serializer entirely — so after the first save/reopen,
`sourceChangeVerdict` degraded to `"unknown"` for every dataset, defeating
box 5's protection in the realistic import-today/reopen-tomorrow/relink
workflow. Fixed: the validator moved to `lib/datasetSource.ts`
(`parseDatasetSource`, also resolving `workspace.ts`'s own line-ceiling
pin) and now validates/carries every field; `versionOf` was added to both
the serializer and the parser. Red-first in `workspace.test.ts` (the exact
reviewer-predicted failures — `expected {kind,path} to deeply equal
{kind,path,checksum,mtime,size}` and `expected undefined to be
'orig-id'`), now green; the pre-existing "workspace source reference"
round-trip describe block was extended in place rather than duplicated.

**P2 fix (TOCTOU at commit, adversarial review):** `commit()` used to write
whatever `runPreview` had captured with no re-check — a file deleted or
overwritten in the window between Preview and clicking Relink would land a
stale checksum silently. Fixed cheaply: `commit()` re-probes every
committing candidate immediately before writing and drops (never trusts)
any row whose reachability changed or whose checksum changed again since
Preview, reported in the success toast rather than silently absorbed.
Red-first in `relink.test.ts`.

**Changed source -> new version (box 5).** `sourceChangeVerdict`
(`lib/relink.ts`) diffs checksum first when both sides have one, falls back
to size+mtime only when neither side has a checksum, and reports
`"unknown"` — never `"unchanged"` — when there isn't enough information to
say anything (pinned: a recorded-but-unprobeable checksum must not read as
fine). A `changed` row is excluded from `commit()`; `importChangedAsNewVersion`
reuses the EXISTING import path (`importPaths`) and tags the newly created
dataset(s) with `versionOf` — the original is never touched in place, per
L0.32.

**Cross-platform folder-tree relinking (box 6).** `lib/relink.test.ts`
covers POSIX-root/POSIX-move, Windows-drive-root/Windows-move, a UNC root,
a cross-platform move (Windows-recorded path relinked onto a POSIX new
root and vice versa), case-only differences, mixed/doubled separators, and
sibling-name false positives (`/data/run1` vs `/data/run10`).

**Raw originals never replaced (box 7).** Pinned three ways: (1)
`desktop_source_probe.py`'s checksum path opens strictly `"rb"`, no write
mode, ever; (2) relink only ever rewrites `Dataset.source.path` in the
in-memory store (and, on save, the `.dwk` — never the file at either the
old or new path); (3) `importChangedAsNewVersion` imports a SECOND dataset
alongside the original rather than refreshing it in place.

- [x] Define linked, embedded, and portable bundle modes — contract above;
  only "embedded" is implemented, "linked"/"portable" are named + deferred
  with a home, per this slice's own explicit scoping allowance.
- [x] Preserve checksum/time/import filter/correction/source provenance —
  checksum/mtime/size closed this slice (the honestly-found gap above);
  import-filter/correction provenance was already preserved pre-slice
  (`ImportSettings`/`Dataset.corrections`) and untouched by this work.
- [x] Relink-one and relink-folder with dry-run preview.
- [x] Distinguish missing, offline, changed, and permission denied.
- [x] Changed source warns and can import as a new version.
- [x] Cross-platform folder-tree relinking passes.
- [x] Raw originals are never replaced.
- [x] Collision-safe relinking (**slice 2, 2026-09-06**): Preview flags
  every row whose candidate names ONE file (`lib/relink.pathKey` — the same
  tolerant either-separator, case-insensitive identity the root matcher
  uses) from DIFFERENT recorded old paths (`findCandidateCollisions`; byte-
  identical old paths are a shared source, not a collision). Contested rows
  are excluded from `commit()` until the user picks exactly ONE keeper per
  file (`resolveCollision`; the rest are marked skip and stay as recorded —
  never a default winner), and a write-side guard in `commit()` fails the
  whole group closed even if the per-row flags were edited underneath it.
  The panel labels contested/kept/skipped rows distinctly and offers "Keep
  this one" per row. Red-first in `store/relink.test.ts` (both rows
  committed before the slice).

**Explicitly booked, NOT shipped this slice — named home "P1.7 Pack
Project" (no owner/slice assigned yet):** the full portable-bundle packer
(copying every dataset's raw source file into a project-adjacent bundle at
save time) and "linked" mode's save-time strip / open-time rehydrate flow.
Both build directly on this slice's path-matching + provenance + probing
primitives; neither needed to exist for the relink core itself.

**P3 booked (adversarial review, cheap-if-fixed-else-book call): `commit()`
has no dedup when two DIFFERENT old paths case-collide onto the SAME new
candidate (e.g. two old sources differing only by case, or by a segment
that normalizes identically under `lib/relink.ts`'s case-insensitive
matching) — both would relink onto one path with no collision warning.
CLOSED 2026-09-06 by slice 2 (the collision-safe relinking box above),
the first PR of the "P1.7 Pack Project" stack; the packer's own
name-collision handling (L0.34's precedent) will reuse `pathKey`/
`findCandidateCollisions`.

**Pack Project stack (2026-09-06 →), backend numbering.** Slice 2 above
(the frontend collision-safe relink fix) is the precedent the packer's own
collision handling reuses, not itself one of the numbered backend PRs
below — the packer's own implementation work starts fresh here:

- **PR 1 (this branch, #305) — bundle contract + dry-run
  manifest, backend-only, copies nothing:** new pure package
  `quantized.portable` (added to `tests/test_repo_integrity.py`'s
  `PURE_LAYERS`).
  - `portable/layout.py` — the bundle DIRECTORY layout
    (`<bundle dir>/<project stem>.dwk` + `quantized-bundle.json` +
    `sources/<bundle-relative name>`, bundle-relative paths always
    forward-slash and rooted at `sources/`), `basename_of`/`path_key`
    (mirroring `lib/importEntry.ts`'s `baseName` and `lib/relink.ts`'s
    `pathKey`, the latter plus Unicode NFC normalization for a macOS
    NFD-reporting volume), `sanitize_component` (cross-platform-safe
    filenames: illegal/control characters, Windows reserved device names,
    trailing dot/space, a `MAX_COMPONENT_BYTES=200` truncate+hash for an
    over-long name — every change reports why), and the one containment
    rule every future consumer must apply before turning a manifest path
    into a real one: `is_bundle_relative` + `join_bundle_path` (raises on
    `..`, an absolute path, a drive letter, a UNC prefix, a backslash, an
    empty/NUL-bearing segment, or anything outside `sources/`).
  - `portable/manifest.py`'s `build_dry_run_manifest(payload, project_name,
    probe, consented=None)` — takes an already-parsed workspace payload
    (`desktop_project_file.parse_workspace_payload`) and a probe callback
    shaped like `desktop_source_probe.probe_source_path`; reads no file
    itself. **Corrected 2026-09-06 (PR #305 review):** the original text
    here said sources were "deduped by `path_key(original_path)`" — that
    was the bug. Sources are deduped by the EXACT `original_path` STRING
    (several datasets naming the byte-identical path share ONE row, each
    with its own recorded provenance + a `sourceChangeVerdict`-equivalent
    verdict, ported field-for-field from `lib/relink.ts`); every other
    distinct spelling — including one that only differs by case, Unicode
    normalization form, or separator style — gets its OWN row unless later
    PROVEN to be the same physical file. `probe`/`consented` are invoked
    exactly once per distinct exact spelling, never once per folded
    `path_key`, and never at all for a path `consented` rejects. Two
    spellings' rows COLLAPSE into one only when both probe `ok` and report
    the identical, non-zero `(dev, ino)` filesystem-identity pair (new
    fields on `desktop_source_probe.probe_source_path`'s `ok` result) — a
    folded-key match alone is never sufficient (a case-sensitive
    filesystem's `/data/A.csv` and `/data/a.csv` are two different files;
    the prior fold-based dedup would have silently mapped both onto one
    packed copy). The actual dedup/collapse logic lives in
    `portable/grouping.py` (split out to keep `manifest.py` under the
    500-line ceiling). Source rows are sorted by
    `(path_key(original_path), original_path)` — the exact-path tiebreak
    is now load-bearing, since two rows can share a folded `path_key`
    without having collapsed — so the same payload always yields
    byte-identical `manifest_json` (2-space, sorted-key,
    `ensure_ascii=False` JSON) — including a merged row's `original_path`,
    which is always the CANONICAL spelling among however many
    case/Unicode-normalization-form variants were PROVEN to be one file
    (the lexicographically-least by `(NFC-normalized string, raw
    string)`, never whichever spelling happened to appear first in
    payload order), with every other distinct spelling in that merged
    group recorded in `original_path_variants` (empty list when there was
    only one spelling, or when a same-`path_key` group never collapsed).
    **Downstream note for the future "PR 3" project-rewrite work:**
    anything that maps a dataset back onto a manifest row (e.g. a future
    `project_rewrite.rewrite_payload_for_bundle`) MUST match by exact
    `original_path` or membership in `original_path_variants` — never by
    folded `path_key` — for the identical reason.
    Destination-name collisions get L0.34's visible-suffix treatment
    (`name.ext`, `name (2).ext`, `name (3).ext`, ... — never a silent
    overwrite, and never able to duplicate another group's own plain name:
    `portable/naming.py`'s `plan_bundle_names` reserves every group's
    keeper name in one pass before any suffix is generated, split into its
    own module to keep `manifest.py` under the 500-line ceiling), each
    renamed row carrying `collision_group` + `renamed_from` and an entry
    in the manifest's own `warnings` list. Five distinct, non-packable
    source states (`missing`/`offline`/`permission_denied`/`invalid`/
    `not_consented`) plus `ok`; `changed` (provenance mismatch) and
    `unverified` (verdict `unknown`) are warnings, not blockers — still
    `packable`, per this PR's own scoping. `project_name` is itself
    sanitized and validated (`ValueError` for a path-traversal shape — a
    separator or a literal `..` — or a name that sanitizes to nothing);
    the manifest's `project` object carries the sanitized `name`, the
    derived `project_file` (a trailing `.dwk` is stripped before one is
    appended, so `"x.dwk"` never becomes `"x.dwk.dwk"`), and
    `renamed_from` (the original name, or `null` if sanitizing changed
    nothing).
  - **Security/trust boundary** (also the module's own docstring):
    `consented` is checked BEFORE `probe` is ever called for a path —
    `probe` (which may do real I/O) never even runs for a source the
    caller hasn't vouched for; reachability/size/mtime/checksum otherwise
    come ONLY from `probe`, type-validated (a non-`str` checksum or
    non-numeric size/mtime is treated as absent, never trusted or allowed
    to crash the summary); the manifest reads no file content itself and
    GRANTS NOTHING — a row's presence is never authorization to read or
    copy anything; every bundle destination is built from a sanitized
    BASENAME only, never from any part of the original directory tree, so
    a bundle's own internal layout can never leak a source's original
    location; `is_bundle_relative` (which also rejects a segment that is
    well-formed as a bare path component but Windows-illegal on its own
    merits — a colon, an illegal character, a reserved device name, a
    trailing dot) + `join_bundle_path` are the only sanctioned
    path-containment check for every future consumer (PR 2's copier, PR
    3's opener); the builder itself asserts every planned `bundle_path` is
    pairwise-unique before returning (`RuntimeError`, never a silent
    duplicate).
  - Frozen schema fixture: `tools/freeze_portable_manifest.py` builds one
    synthetic payload covering a shared source, a plain and a case-variant
    destination collision, a keeper-suffix collision (two `keep.csv`s plus
    two pre-existing `keep (2).csv`s, proving the collision-safe planning
    above), Windows/UNC/POSIX/`/Volumes` paths, missing/offline/
    permission-denied sources, a Unicode name, a reserved name (plain and
    multi-dot extension — `CON.tar.gz`), an over-long name, a no-source
    dataset, and a malformed source — writes
    `tests/fixtures/portable/manifest_v1.json`;
    `tests/test_portable_manifest_fixture.py` byte-compares against it
    forever (regenerate with `uv run python
    tools/freeze_portable_manifest.py` on a deliberate behavior change).
    **Extended 2026-09-06 (PR #305 review)** with the two cases the fix
    itself exists to distinguish, same folder, differing only by case:
    `/data/case/A.csv` vs `/data/case/a.csv` with DIFFERENT fake `(dev,
    ino)` identities and checksums (two rows, visible suffix — the
    regression for the defect) and `/data/same/Run1.csv` vs
    `/data/same/run1.csv` with the SAME fake identity and checksum (one
    row, `original_path_variants` populated — the legitimate collapse
    case).
  - **Review round (2026-09-06):** ten defects found and fixed, each with
    a regression test — see the commit fixing this PR for the full list;
    highlights: the keeper-suffix collision above (a silent-overwrite
    hazard), `_looks_absolute` no longer trusts the host's own
    `os.path.isabs` (checks `posixpath.isabs`/`ntpath.isabs` explicitly),
    `sanitize_component`'s over-long truncation now truncates the WHOLE
    name when the extension alone doesn't fit the budget, and its
    reserved-device-name check now keys off the part before the FIRST dot
    (Windows' own rule) rather than the last.
  - **Follow-up review round (2026-09-06, PR #305 feedback):** an
    eleventh defect — dedup was by folded `path_key`, not exact path
    string, so two DIFFERENT files on a case-sensitive filesystem
    (`/data/A.csv`/`/data/a.csv`) could be silently treated as one shared
    source and mapped to a single packed copy. Fixed by grouping on the
    exact `original_path` string and collapsing two groups into one row
    only when both probe `ok` and report the identical, non-zero `(dev,
    ino)` filesystem-identity pair — new fields on
    `desktop_source_probe.probe_source_path`'s `ok` result — never on a
    folded-key match alone. The dedup/collapse mechanism moved into its
    own `portable/grouping.py` module (keeping `manifest.py` under the
    500-line ceiling); see that module's docstring for the full rationale
    and this section's corrected description above for the field-level
    detail. Regression tests: two spellings with different `(dev, ino)`
    never collapse even when their `path_key`s match (fake-probe and
    real-filesystem-with-real-`probe_source_path` versions, in both
    payload orders); two spellings with the same `(dev, ino)` do collapse
    (fake-probe and a real-filesystem "two spellings resolve to one file"
    version); a `(dev, ino)` of zero or absent ("unknown identity") never
    collapses with anything.
- **PR 2 (this branch, #306) — atomic staging + verified source
  copying, backend-only, still no `.dwk` write, no publish:** the first
  PR that touches a filesystem for real. New pure modules
  `quantized.portable.staging` (public API: `create_staging_dir`,
  `cleanup_staging_dir`, `stage_sources`, and the `StageProgress`/
  `StagedFile`/`StageError`/`StageResult` dataclasses) + `.copying` (split
  out under the 500-line ceiling; the per-file verified-copy state
  machine, `stage_one_file`).
  - **Fresh SIBLING staging dir.** `create_staging_dir(parent_dir)` always
    `tempfile.mkdtemp`s INSIDE the caller-supplied `parent_dir` (never a
    system temp location) with a fixed `STAGING_PREFIX = ".qz-pack-"` —
    PR 3's eventual `os.replace`/rename into the final bundle location is
    only atomic when both live on the same filesystem, which requires the
    caller to pick the bundle's own parent directory.
  - **Verified per-file copy (9 steps, `stage_one_file`):** re-probe the
    source right now (never trust the manifest's snapshot) → compare
    against the manifest's recorded size/mtime/checksum (any field both
    sides have) → resolve the destination and confirm its parent stays
    inside the staging root (symlink-aware, `os.path.realpath` +
    `os.path.commonpath`) → create the destination with
    `O_CREAT|O_EXCL|O_NOFOLLOW` (never overwrites, never follows a
    symlink) → open the source strictly `"rb"`, fstat it against the
    fresh probe's size → stream `chunk_bytes` at a time (default
    `desktop_source_probe._CHECKSUM_CHUNK_BYTES`, 1 MiB) hashing +
    writing each chunk, polling `should_cancel` between chunks → fsync +
    close, then re-stat the SOURCE and compare against the pre-copy fstat
    → cross-check the fresh probe's checksum (when it has one) against
    the hash computed while streaming → re-read the WRITTEN file and hash
    it a SECOND time to catch a short write fsync alone would miss.
  - **Nine distinct, non-overlapping failure codes** on `StageError.code`
    (`changed_since_preview`, `changed_during_copy`, `read_failed`,
    `write_failed`, `checksum_mismatch`, `destination_exists`,
    `escape_rejected`, `invalid_manifest`, `cancelled`) — never a generic
    failure, and `message` never contains an absolute path (original or
    staging), only `source_id`/`bundle_path` plus a state/reason.
  - **All-or-nothing.** Sources are copied in manifest order and the very
    first problem of any kind stops the whole run — a partial destination
    file is removed, then the ENTIRE staging directory is torn down via
    `cleanup_staging_dir` (which itself refuses to touch anything whose
    basename doesn't carry `STAGING_PREFIX`, and never follows a symlinked
    subdirectory — it unlinks the link itself rather than descending) — a
    staging directory missing even one packable source must never be
    publishable. On success `staging_root` is retained for the caller
    (PR 3) and `cleanup_ok` is `None` (nothing was cleaned up).
  - **Cancellation is cooperative:** `should_cancel` is polled before each
    file and between every chunk, so a cancel mid-copy leaves no partial
    file on disk.
  - **`originals_modified` is always `False`** — every original path is
    opened `open(path, "rb")` only; nothing under an original path is
    ever created, written, renamed, or deleted. `StageResult` carries the
    field explicitly so every reporting path states the guarantee, not
    just infers it.
  - **Write-site ratchet:** `tests/test_write_sites.py`'s allowlist gained
    `portable/copying.py` (`_remove_partial`'s `os.remove`, only ever a
    staging-dir destination path) and `portable/staging.py`
    (`cleanup_staging_dir`'s `os.remove`, gated on `STAGING_PREFIX`) —
    both justified as never touching an original dataset source.
  - 23 tests across `tests/test_portable_staging.py` (happy path,
    12 MiB/64 KiB bounded-chunk streaming, mid-copy cancellation,
    shared-source dedup, read-only-source enforcement) and
    `tests/test_portable_staging_failures.py` (every `StageError.code`,
    the cleanup contract parametrized across failure classes, the
    no-absolute-path-in-messages guarantee, symlink-escape rejection at
    both the parent-directory and destination-file level).
- **PR 3 (this branch, #307) — atomic bundle publish + bundle
  validation + open-time resolution, backend-only, no bridge method yet:**
  the packed `.dwk` and its manifest actually land on disk, and a moved
  bundle opens cleanly. New pure modules `quantized.portable.project_rewrite`
  (`rewrite_payload_for_bundle`, `resolve_bundle_source`),
  `quantized.portable.publish` (`atomic_replace_file`, `finalize_manifest`,
  `write_bundle_files`, `publish_bundle`, `validate_bundle`), and
  `quantized.portable.pack` (`pack_project`, pure orchestration of PR 1-3's
  pieces — PR 4 wraps this in the bridge + job/state machine).
  - **The `kind: "bundle"` source extension — no `WORKSPACE_VERSIONS` bump.**
    A packed copy's dataset rewrites `source` from
    `{"kind": "path", "path": <absolute>, ...}` to `{"kind": "bundle",
    "path": "sources/<name>", "checksum", "size", "mtime"?, "packedFrom":
    <original absolute path>}` — `path` is bundle-relative
    (`layout.is_bundle_relative`) and resolves against the `.dwk`'s own
    directory via the ONE sanctioned resolver, `resolve_bundle_source`.
    Ordinary (non-packed) projects are completely unaffected: they never
    carry `kind: "bundle"` at all, so every existing `WORKSPACE_VERSIONS`
    (1-4) payload round-trips unchanged — verified across all four in
    `tests/test_portable_pack_roundtrip.py`. An older build opening a
    packed copy that predates this PR simply doesn't recognize `"bundle"`
    and degrades to no source (same as today's "missing" source handling),
    never a crash.
  - **`rewrite_payload_for_bundle`** deep-copies the payload and rewrites
    ONLY `datasets[i].source` for a dataset whose `kind: "path"` matches
    (by `path_key`, original or any `original_path_variants`) a manifest
    row that is `packable` AND was actually staged this run (matched by
    `bundle_path` — a row can be planned-packable without ever having been
    staged if the caller stopped early). Every other dataset (embedded,
    browser-upload, missing-source) and every other part of the payload —
    corrections, figures, recipes, analyses, annotations, history,
    project metadata — passes through byte-for-byte, verified in the
    roundtrip test by stripping `source` fields and comparing
    `json.dumps(sort_keys=True)`. The rewritten result is re-validated
    with `parse_workspace_payload` before being returned; `ValueError` on
    a failure, never a silently-broken `.dwk`.
  - **The publish contract (`publish_bundle`): one atomic `os.rename`,
    nothing partial, ever.** Staging is always a SIBLING of the
    destination (PR 2's own contract), which makes cross-device rename
    (`EXDEV`) impossible by construction — so the only realistic
    `os.rename` failures are permission/race errors, and the documented
    safe fallback on ANY of them is: clean the staging directory
    (`cleanup_staging_dir`) and report `publish_failed` — never copy-tree,
    never a partial publish. Refuses outright (staging cleaned,
    destination untouched) when the destination already exists
    (`destination_exists` — no overwrite/replace behavior in this PR),
    when staging is not actually a sibling of the destination
    (`invalid_destination`), or when staging has no completion marker yet
    (`incomplete_staging`).
  - **The manifest is the completion marker, written LAST.**
    `write_bundle_files` writes the packed project file first, then
    `quantized-bundle.json` deliberately last, through the same atomic
    single-file sequence `desktop_bridge.write_project_file` already used
    (`atomic_replace_file`, extracted out of that module into
    `portable/publish.py` so neither duplicates it — `desktop_bridge.py`
    shrank in the process, staying under the 500-line ceiling with room
    for the `base_dir`-threading fix below). A crash between the two
    writes leaves a staging directory `validate_bundle`/`publish_bundle`
    both recognize as incomplete, never one that looks done but is
    missing its project file.
  - **`validate_bundle(bundle_dir, verify_checksums=False)`** — is a
    (possibly moved) directory a complete, openable bundle? Fails safe on
    a missing/unreadable/foreign/unsupported-version manifest
    (`manifest_missing`/`manifest_invalid`/`not_a_bundle`/
    `unsupported_manifest_version`, `complete=False`, manifest attached
    only "for display" on the last two); accumulates every other finding
    (`incomplete`, `project_file_missing`, `escape_rejected` for a hand-
    edited `bundle_path` that fails `is_bundle_relative`, `source_missing`,
    `source_size_mismatch`, and — only with `verify_checksums=True` — a
    re-hashed `source_checksum_mismatch`). `problems` entries are always
    bundle-relative or manifest-field values, never an absolute path.
  - **Declared-source resolution gained `base_dir`.**
    `desktop_project_file.declared_source_paths_of`/
    `extract_declared_source_paths`/`payload_declares_source` all gained an
    optional `base_dir` parameter (the `.dwk`'s own directory) so a
    `kind: "bundle"` source resolves to its bundle copy — `kind: "path"`
    (or no `kind` at all, every pre-existing fixture's shape) is
    unaffected. `desktop_bridge_dialogs._read_granted` passes
    `base_dir=os.path.dirname(granted)` so a reopened packed project's
    bundle copies become declared sources under their RESOLVED, ABSOLUTE
    paths (not the original machine's now-possibly-gone paths) — this
    backend half declares those absolute copies; it does not itself
    resolve a bundle-relative path anywhere `grant_source_paths`/relink
    act on it (`grant_source_paths` realpaths the caller's argument
    against the process cwd, not the bundle directory), so a caller must
    always pass an absolute path. The separate frontend half of PR 3
    is what guarantees that in practice, resolving every `kind: "bundle"`
    source to an absolute path at parse time; `desktop_bridge.write_project_file` passes
    the same so a save can never land on a packed project's own bundle
    copy either. The cross-package call is deliberately function-local
    (not a module-level import) on the `desktop_project_file` side to
    avoid a real circular import with `portable.publish` (which needs
    `desktop_project_file.WRITE_TEMP_PREFIX` at module load) — verified by
    importing each module first, in both orders.
  - **Write-site ratchet:** `desktop_bridge.py` dropped OUT of
    `tests/test_write_sites.py`'s allowlist (it no longer contains any
    AST-visible write call once `atomic_replace_file` moved out) and
    `portable/publish.py` was added in its place, covering
    `atomic_replace_file`'s mkstemp/write/replace sequence and
    `publish_bundle`'s `os.rename` — both scoped to a staging directory
    this package created or a destination that must not already exist,
    never a dataset source.
  - 42 new tests: `tests/test_portable_publish.py` (22 — `finalize_manifest`,
    `write_bundle_files`, `publish_bundle` including an interrupted-
    rename/`os.rename`-failure case, and every `validate_bundle` finding
    code including a tampered-manifest and a hand-edited relative-escape
    case), `tests/test_portable_pack_roundtrip.py` (14 — full pack → move →
    reopen with a shared source AND a case-variant bundle-name collision
    in the same project, byte-for-byte non-source-content equality,
    originals-untouched hashing, mixed dataset shapes, all four
    `WORKSPACE_VERSIONS`, an existing-destination refusal, an interrupted-
    publish case, and `resolve_bundle_source` edge cases), and
    `tests/test_desktop_project_file.py` extended (6 — `base_dir` on all
    three declared-source functions, including a hand-edited relative
    escape and the "no `base_dir`, not declared" case).
- **PR 3 frontend half (`claude/p17-pack-3-frontend`) — shipped ahead of
  the backend publish/copy work above, additive-optional, no
  `WORKSPACE_VERSION` bump:** the frontend's read/write contract for a
  dataset `source` that names a bundle-relative path, so the frontend is
  ready the moment PR 2/3's backend copier lands. `lib/bundlePath.ts`'s
  `isBundleRelativePath` is a rule-for-rule port of `layout.py`'s
  `is_bundle_relative`; `resolveBundlePath` mirrors `join_bundle_path`'s
  "validate, then join" shape (returning `null` instead of raising — this
  side's documented malformed-field degrade, not an error) **plus that
  function's own post-join containment re-check** (review round below) —
  not the "line-for-line port" an earlier draft of this note claimed.
  `Dataset.source` stays `kind: "path"` in memory always (every existing
  consumer — reimport, relink, pathState — is untouched); a source
  resolved from a packed project's `kind: "bundle"` manifest entry
  carries only an optional `packedFrom` (the absolute path the packer
  copied from — display-only provenance, never resolved) as extra
  provenance — no separate bundle-relative field is kept on the
  in-memory source (review round below). Resolution happens at PARSE
  time only, and only when the caller actually knows the `.dwk`'s own
  directory: `parseWorkspace(text, viewport, { projectDir })` threads
  `projectDir` to `lib/workspaceDatasetParse.ts`'s per-dataset parse,
  which threads it to `lib/datasetSource.ts`'s `parseDatasetSource` — a
  `kind: "bundle"` entry with no `projectDir` (an EMPTY string counts as
  none), or a non-conforming path, degrades to "no source" exactly like
  any other malformed source (silent drop, no migration warning). The
  two native-file callers that actually have a directory —
  `lib/openWorkspaceCommand.ts`'s native-open branch and
  `commands/recentProjectsCommands.ts`'s reopen — pass it (via
  `parentDirectory(path) || undefined`, never a bare `parentDirectory(path)`
  — its own "" no-separator sentinel must read as "unknown", not root);
  the browser-picker/Worker path (`lib/parseWorkspaceFile.ts`) and every
  autosave/browser-download round trip never do (no durable path to
  derive one from), so a bundle source degrades there by design — noted
  in `parseWorkspace`'s own doc comment. Serialization
  (`lib/workspaceSerialize.ts`'s `serializeWorkspace(state, { projectDir })`)
  writes a source back as `kind: "bundle"` ONLY when `projectDir` is
  given AND `source.path` sits directly under `<projectDir>/sources/` —
  an EXACT, case-sensitive prefix compare on the forward-slash-normalized
  forms, derived FRESH from the live `path` at every save
  (`lib/bundlePath.ts`'s `deriveBundleRelativePath`) rather than recalled
  from a parse-time field. Any other case (Save As into a different
  folder, no known directory, a relink that moved `path` since, a
  case-different directory on the same volume) writes the ordinary
  absolute `kind: "path"` shape instead — still fully valid, just no
  longer relocatable as one portable unit. A workbook's own `source`
  (import provenance) is routed through the identical
  `serializeDatasetSource`/`parseDatasetSource` pair, so it gets the same
  `kind: "bundle"` treatment rather than always leaking an absolute path
  (review round below). `store/workspaceIO.ts` wires this: quick Save
  (`runSaveWorkspace`) already knows its destination
  (`currentProject.path`) before serializing, so it passes `projectDir`
  straight through; Save As (`runSaveWorkspaceToFile`) splits the
  existing "resolve pending books, fold the live view" preface
  (`prepareWorkspaceState`) from the actual `JSON.stringify`, so the
  stringify itself happens AFTER the native dialog returns a destination
  — every existing Save/Save As test stayed green through that split.
  Existing (unpacked) projects are completely unaffected: their sources
  never sit under a `<projectDir>/sources/` prefix, so
  `serializeDatasetSource` always takes the `kind: "path"` branch for
  them, byte-for-byte as before this PR. Tests: `lib/bundlePath.test.ts`,
  `lib/datasetSource.test.ts`, `lib/workbooks.test.ts`, the new
  "workspace bundle-relative source" describe in `lib/workspace.test.ts`,
  the native-open/reopen resolution tests in
  `commands/openWorkspaceNative.test.ts` /
  `commands/recentProjectsCommands.test.ts`, and the quick-save/Save-As
  `kind` tests in `store/workspaceIO.test.ts`.
  - **Review round (2026-09-06):** six defects found and fixed, each with a
    regression test — see the commit fixing this PR for the full list;
    highlights: the parse-time `bundlePath` field (and its case-folding
    `bundlePathsMatch` save-time identity check) is gone entirely, replaced
    by the fresh-derivation-at-save-time design above (the case-folding
    check would have written a bundle reference against a case-DIFFERENT,
    nonexistent directory on a case-sensitive volume); `parentDirectory`'s
    `""` no-directory sentinel was flowing through as a truthy "known"
    `projectDir` at three new call sites, resolving a bundle source against
    a bogus root-anchored path — fixed both at the call sites
    (`parentDirectory(p) || undefined`) and inside `resolveBundlePath`/
    `deriveBundleRelativePath` themselves (empty `projectDir` treated as
    unknown); `resolveBundlePath` now re-verifies containment on the
    JOINED result, mirroring `join_bundle_path`'s own post-join check
    rather than trusting pre-join validation alone; `WorkbookNode.source`
    is now routed through the dataset-source serialize/parse pair instead
    of being written/read verbatim; and a single module-level
    `TextEncoder` replaced one constructed per path segment.
- **PR 4 (#308) — pack orchestration bridge, consent scoping, and the
  frontend state-machine contract (the visual dialog followed in PR 6,
  #310):** the pywebview bridge method a "Pack Project" UI
  action calls, wiring PR 1-3's manifest/copy/publish primitives into one
  cancellable, pollable job, plus the frontend contract consuming it.
  - **A fourth, orthogonal consent kind: the WRITE-DIRECTORY grant**
    (`desktop_consent.grant_write_dir`/`is_write_dir_consented`, capped at
    8 entries) — separate from the existing per-file write grant (that
    names one file about to be overwritten) and the read-only directory
    grant (that permits reading descendants of a relink root); this one
    permits CREATING a bundle directory under a picked destination root,
    and never satisfies a read or write file check. Minted only from
    `pick_pack_destination`'s native folder dialog return (never a typed
    path), which clears every prior write-dir grant first so a destination
    picked but never started never accumulates. `revoke_paths(paths)` is
    the new companion primitive — removes SPECIFIC entries from the
    ordinary per-file READ grant store by exact resolved key, letting a
    pack operation unwind precisely the read grants IT minted without
    disturbing anything else live in the process.
  - **`quantized.desktop_bridge_pack.DesktopPackBridge`** (a mixin added
    to `DesktopApi`'s bases, the `DesktopDialogBridge` precedent) — six
    js_api methods, none raising into JS, none leaking an absolute path
    into a `message`/`error` string: `pick_pack_destination` (mints the
    write-dir grant); `pack_preview` (dry-run plan, gated by an
    `_eligible` predicate — already read-consented, covered by a
    directory grant, or declared by the open project's own payload —
    grants nothing itself); `pack_start` (re-verifies the stored preview's
    token AND a fresh `sha256(content)` — either mismatch is
    `stale_preview`, never a silent re-plan; mints real read consent for
    the eligible-but-ungranted sources about to be copied, remembers
    exactly which, spawns `portable.pack.pack_project` on a daemon
    thread, and revokes exactly those grants plus the write-dir grant in
    a `finally` on EVERY outcome — success, failure, or cancellation);
    `pack_status`/`pack_cancel`/`pack_reset` (pure reads/mutations of one
    in-memory job record behind a single `threading.Lock`, no filesystem,
    no consent). `pack_start` passes the STORED preview's own manifest to
    `pack_project` VERBATIM (`manifest=`, PR 4 review round 2's fix — see
    the bug note below): `pack_project` never rebuilds a manifest from
    current disk/consent state when one is supplied, so the operation
    executes exactly the snapshot the user reviewed and approved, and
    `portable.staging.stage_sources`'s own re-probe (unchanged) enforces it
    — a source not `packable` in the approved manifest is never staged even
    if it exists by start time, and a source whose bytes changed fails
    closed with `changed_since_preview` against the manifest's PREVIEW-TIME
    checksum. Separately, the approved manifest is a plan, not a read
    grant: `pack_start` re-checks every `packable` row against `_eligible`
    before minting anything, and refuses with `consent_changed` (preview
    again) if any row's consent lapsed between preview and start — a lost
    grant fails closed rather than copying. Progress's `"publishing"` stage is
    INFERRED (the last
    source's `"verifying"` tick, or immediately with nothing to stage) —
    `pack_project` itself never emits a tick for the
    rewrite/finalize/write/publish steps that follow the staged copy in
    the same synchronous call.
  - **The frontend state machine** (`store/packProject.ts` + the lazily-
    imported `store/packProjectRun.ts`, the `store/relink.ts`/
    `relinkCommit.ts` precedent): `idle → selecting_destination →
    scanning → awaiting_confirmation → packing → completed`; any active
    state → `cancelling` → `cancelled` (pre-`packing` active states go
    straight to `cancelled` locally — nothing backend-side to cancel yet);
    any active state → `failed`. Illegal calls record `lastRejected`
    rather than mutating state. `startPackProject` requires its
    `approvedManifest` to be REFERENCE-IDENTICAL to the stored preview's
    manifest (a fresh preview always creates a new object, so identity IS
    "is this still the current plan") and re-serializes the live workspace
    to fingerprint-compare (a `contentFingerprint` helper that strips
    `serializeWorkspace`'s own live `savedAt` stamp before comparing — a
    raw string compare would treat the timestamp alone as a change) — on
    a match it resends the EXACT `preview.content` string to `pack_start`,
    byte-identical to what `pack_preview` saw, so the backend's own
    `sha256` check passes trivially. The poll loop (250ms) lives in
    MODULE scope, not a React effect — it survives regardless of mount and
    stops itself on a terminal phase — and a trailing-edge throttle
    (`scheduleStatusApply`, driven by an explicit `now` parameter rather
    than `Date.now()`, for determinism) coalesces bursts of status changes
    to at most one store update per 200ms, always carrying the LATEST
    status. `bytesCopied`/`completedCount` are clamped (`Math.max` against
    the current value) so an out-of-order/misbehaving status can never
    regress the displayed progress. A minimal `pack-project` palette
    command (`commands/packProjectCommands.ts`, under 40 lines) previews
    and toasts a packable/blocked summary — exercising the contract, not
    the real dialog.
  - **Tests:** `tests/test_desktop_bridge_pack.py` (24 — destination pick
    mints/clears the write-dir grant, preview refused without it, token
    storage, wrong-token/changed-content/existing-destination refusals,
    double-start `already_running`, a REAL end-to-end pack reaching
    `completed` with a `validate_bundle`-checked bundle and every minted
    grant revoked, cancel-mid-copy → `cancelled` with `cleanup_ok: true`,
    a thrown exception → `failed` with no raw path in `message`, idempotent
    `pack_cancel`, monotonic `pack_status` progress, `pack_reset` gating),
    `tests/test_desktop_consent.py` extended (24 new — the write-dir grant
    kind's full read-only-directory-grant-shaped suite plus `revoke_paths`),
    `store/packProject.test.ts` (50 — a table-driven legality matrix over
    every phase × action, double-start, cancel in every pre-packing state
    and mid-packing via a scripted `cancelling`→`cancelled` status
    sequence, both staleness cases, a bridge-null failure, a
    `cleanup_ok: false` failure surfaced verbatim, retry-via-reset, the
    progress clamp, and the throttle's coalescing proven by asserting a
    middle status value never reaches a subscriber), `lib/
    desktopPackBridge.test.ts` (21 — every wire call's null/ok/refusal/
    malformed-response/throw paths).
  - **A genuine bug found and fixed via a flaky-test investigation
    (2026-09-06):** the FIRST content-staleness design compared raw
    `serializeWorkspace` strings directly, which embeds a live `savedAt`
    on every call — two serializations of the IDENTICAL workspace
    routinely differed by nothing but that timestamp, making the
    stale-preview check spuriously fire (or spuriously NOT fire, depending
    on millisecond timing) independent of any real edit. Caught by running
    the new test file back to back with `architecture.test.ts` (whose
    slower module graph load widened the timing window) rather than by
    inspection — see `docs/testing.md`'s evidence standard. Fixed by the
    `contentFingerprint`/resend-the-original-string design above.
  - **A blocking review finding on PR #308, fixed the same slice:**
    `pack_start` validated the token and the workspace JSON, but the
    worker called `pack.pack_project(payload, ...)` with no `manifest=`,
    which REBUILT the manifest from CURRENT filesystem/consent state and
    never compared it against the stored, user-approved preview manifest —
    (1) a source `missing` (blocked) at preview time that appeared on disk
    before start became packable and was copied, though the approved
    preview excluded it; (2) a source whose content changed between
    preview and start was staged against its NEW checksum (the rebuilt
    manifest recorded whatever the file looked like right now), so the
    approved snapshot was never actually enforced despite `stage_sources`'s
    own `changed_since_preview` re-probe already existing — it was just
    being compared against the wrong values. Fixed by giving
    `pack_project` a `manifest: Mapping[str, Any] | None = None` keyword
    that, when supplied, is used VERBATIM (no `build_dry_run_manifest`
    call, rejecting anything that isn't itself a valid dry-run manifest as
    `invalid_manifest`), and having `pack_start` pass
    `self._pack_preview["manifest"]`. Because the executed manifest no
    longer reflects current consent, `pack_start` now re-checks every
    `packable` row against `_eligible` up front and refuses with
    `consent_changed` if any lapsed (the prior round's finding #1 check in
    `_grant_eligible_packable_sources` stays as defence in depth) — the
    approved plan never becomes a substitute for a live read grant.
- **PR 5 (this branch, `claude/p17-pack-5-audit`) — adversarial audit of
  the whole Pack Project stack (PR 1-4/#305-#308), in the same spirit as
  P1.7 slice 1's P1-A/P1-B fix rounds above.** A 14-item checklist run
  against `portable/` (layout, naming, grouping, manifest, staging,
  copying, copy_stream, project_rewrite, publish, pack), `desktop_consent.py`,
  `desktop_bridge_pack.py`/`_pack_state.py`/`_common.py`,
  `desktop_project_file.py`, and the frontend's `lib/bundlePath.ts`/
  `datasetSource.ts`/`workspaceSerialize.ts`/`workspaceDatasetParse.ts`/
  `desktopPackBridge.ts` + `store/packProject.ts`/`packProjectRun.ts`.
  Two real defects found and fixed, both with forcing regression tests;
  every other item verified to already hold, each closed with a new
  regression test proving it rather than answered from memory.
  - **Defect 1 — `publish_bundle`'s check-then-rename was not atomic**
    (item 3, TOCTOU). `os.path.lexists(destination_dir)` and the
    following `os.rename` are two separate syscalls; on POSIX,
    `os.rename` onto an EXISTING EMPTY directory silently succeeds and
    replaces it (unlike a non-empty one, which raises `ENOTEMPTY`), so a
    directory created in the split second between the check and the
    rename — another process, a concurrent pack run racing the same
    path, a user's own `mkdir` — was silently absorbed instead of
    refused, contradicting the module's own "never overwrites" contract.
    The FIRST fix attempt (an `os.mkdir` reservation immediately before
    the rename, rolled back with `os.rmdir` on a subsequent rename
    failure) was itself reviewed by the owner on PR #309 and found to
    still be non-atomic: a THIRD party can `rmdir` the reservation and
    `mkdir` its own empty directory at the same path before the
    following `os.rename` runs, and POSIX `rename` absorbs that foreign
    empty directory exactly as it would have absorbed the original one —
    two syscalls with a gap between them are not one atomic operation,
    however narrow, and the code's own comment claiming "nothing else can
    have raced ahead of it" was not true.
    **Fixed for real in this commit** with a new pure module,
    `quantized.portable.atomic_rename`, exposing `rename_noreplace` — a
    SINGLE syscall wherever the platform provides one: glibc's
    `renameat2(..., RENAME_NOREPLACE)` via `ctypes` on Linux, Darwin's
    `renamex_np(..., RENAME_EXCL)` via `ctypes` on macOS, and plain
    `os.rename` on Windows (already atomic no-replace there). `publish_bundle`
    tries this first and reports `PublishResult.no_replace: "atomic"` when
    it ran. Only when the platform/kernel/filesystem has none of those at
    all (`NoReplaceUnsupported` — an old kernel/glibc without `renameat2`,
    a filesystem that rejects the flag) does it fall back to the OLD
    `os.mkdir` reservation + `os.rename` sequence, reporting
    `no_replace: "best_effort"` — an HONEST contract now: the module
    docstring and `PublishResult.no_replace`'s own doc say plainly that
    the fallback leaves the same narrow residual race described above
    open, rather than claiming it is closed. `PackResult` (`pack.py`) and
    the `pack_status` result dict (`desktop_bridge_pack.py`) both carry
    `no_replace` through to the frontend
    (`frontend/src/lib/desktopPackBridge.ts`'s `PackStatus.result` gained
    an optional `no_replace` field). Verified on this Linux dev runner:
    `no_replace_available()` is `True` (glibc `renameat2` with
    `RENAME_NOREPLACE` is supported) — every real publish on this
    platform gets the atomic path, never the fallback, in normal
    operation.
    Regression coverage, forced rather than merely observed
    (CLAUDE.md's evidence standard): `tests/test_portable_atomic_rename.py`
    exercises the real primitive (skipped with a precise reason when
    `no_replace_available()` is `False`) plus a seam test that fakes the
    platform primitive to prove `NoReplaceUnsupported` routes correctly
    without needing an actually unsupported kernel.
    `tests/test_portable_publish.py` keeps the original
    `test_publish_bundle_fails_closed_when_an_empty_directory_appears_during_the_race`
    passing on the new atomic path, adds
    `test_publish_bundle_atomic_primitive_seam_refuses_a_directory_planted_during_the_race`
    (the owner's exact seam ask, with the primitive faked so it is
    deterministic on any runner), and adds
    `test_publish_bundle_fallback_absorbs_a_directory_planted_between_reservation_and_rename`
    — which PINS the fallback's residual race by forcing it (wrapping
    `os.mkdir` to rmdir-and-recreate a foreign empty directory right after
    the reservation) and asserting the honest outcome: the foreign
    directory IS absorbed, the publish still reports `ok=True`, and
    `no_replace` is `"best_effort"`, never `"atomic"` — the fix is an
    honest contract, not a claim that this residual race is closed.
  - **Defect 2 — `pack_preview` had no catch for its own internal
    assertion failures** (item 13, path-leak). `build_dry_run_manifest`
    (via `naming.plan_bundle_names`) can raise `RuntimeError` from a
    "this should be structurally impossible" assertion (a duplicate
    planned bundle path) whose own message embeds the offending
    bundle-relative path; `pack_preview` caught only `ValueError`, so a
    latent bug there would propagate the raw, path-carrying exception
    straight out of the js_api method into pywebview's own exception
    surface — unlike `pack_start`'s worker thread, which already has an
    equivalent blanket catch for exactly this "genuine bug, still
    reported, never raised" case. Fixed with a matching `except
    RuntimeError` returning a generic `internal_error` refusal. Forced
    in `test_pack_preview_reports_an_internal_manifest_bug_without_raising_or_leaking_a_path`
    (`tests/test_desktop_bridge_pack.py`) by monkeypatching
    `build_dry_run_manifest` to raise with a marker path embedded.
  - **Checklist items verified to already hold, each with a new or
    cited test** (see the PR 5 commits for the full per-item mapping):
    (1) arbitrary read/write authorization — the backend never executes
    a frontend-supplied manifest (`pack_start`/`packStart` carry only
    `token`+`content`; the approved manifest PR 4's second review round
    added is the backend's OWN stored preview, never anything the
    frontend sends), `project_name` traversal is rejected before
    planning, and a symlinked destination-parent fails
    `is_write_dir_consented` (new test:
    `test_is_write_dir_consented_rejects_a_destination_symlinked_elsewhere`,
    `tests/test_desktop_consent.py`); (2) a new shared cross-language
    fixture, `tests/fixtures/portable/bundle_paths.json`, consumed by
    both `tests/test_portable_bundle_paths_fixture.py` and
    `frontend/src/lib/bundlePath.fixture.test.ts`, pins
    `is_bundle_relative`/`isBundleRelativePath` parity; an NFC/NFD
    Unicode-normalization collision case was added alongside the
    existing ASCII-case one
    (`test_nfc_nfd_unicode_variant_collision_still_suffixed`,
    `tests/test_portable_manifest.py`); a symlinked `sources/` and a
    symlinked destination file were already covered
    (`tests/test_portable_staging_failures.py`); Windows junctions are
    NOT exercised by any test in this repo (only `os.symlink`, which
    needs elevated privilege on Windows CI and is skipped there) — noted
    as a real, currently-unclosed coverage gap rather than claimed
    covered; (3) TOCTOU — see Defect 1 above; a source replaced under an
    open descriptor, a manifest-grouping fold across case/Unicode
    spellings, and every `str(exc)` path-leak were independently found
    and fixed on PRs #305-#307 during this same audit window (`(dev,
    ino)` filesystem-identity checks in `portable/grouping.py` and
    `copying.py`, `safe_os_error` throughout); (4) a new whole-stack
    hash-before/after test suite
    (`test_a_completed_pack_never_touches_the_original_dwk_or_sources`,
    `..._cancelled_...`, `..._failed_...`,
    `tests/test_desktop_bridge_pack.py`) hashes the project `.dwk` and
    every source before and after a real bridge-driven pack run on each
    outcome; the write-site allowlist gained `portable/copying.py`
    after a real gap was found — its `os.open` write flags are built
    into a local variable, invisible to the AST scan's flags-expression
    check, closed with a targeted resolver
    (`_simple_assignments` in `tests/test_write_sites.py`); (5)
    `write_bundle_files`'s "manifest written last" ordering was forced
    directly (raising between the two writes) and `validate_bundle`
    confirmed `manifest_missing`/incomplete on the result, plus a
    published bundle's `sources/` directory renamed away independently
    confirmed `source_missing`
    (`tests/test_portable_publish.py`); (6) every content hash in
    `portable/` streams in `chunk_bytes`-sized reads (cited:
    `test_large_file_streams_in_bounded_chunks`,
    `tests/test_portable_staging.py`) — the one bare `.read()` in
    `publish.py`'s `validate_bundle` is the small `quantized-bundle.json`
    manifest file, not a source, and is proportional to source COUNT,
    never dataset size; `pack_status`'s warnings/errors lists are set
    once per run (bounded by manifest size and, by `stage_sources`'s own
    "stop at the first problem" model, `errors` is always ≤1 entry) and
    never accumulate across polls; (7) `pack_preview`'s own
    manifest-building/naming/serialization cost on a 200-source
    synthetic payload with a faked probe stays under 1s
    (`test_pack_preview_cost_on_200_sources_stays_well_under_a_second`),
    and `pack_start` returning before its Event-gated fake worker
    finishes was already proven
    (`test_two_starts_report_already_running`); (8) a forced
    cancel-during-publishing race
    (`test_cancel_during_publishing_cannot_corrupt_or_delete_the_finished_bundle`)
    confirms the already-committed rename survives intact and the
    outcome reports an honest `completed`/`cleanup_ok: None`, never a
    misleading `cancelled`; (9) a full `checksum`/`mtime`/`size`/
    `packedFrom` round trip through
    `parseWorkspace`→`serializeWorkspace`→`parseWorkspace` again
    (`lib/workspace.test.ts`) and through
    `rewrite_payload_for_bundle`→`parse_workspace_payload`
    (`tests/test_portable_pack_roundtrip.py`) closes a gap where each
    field alone had a test but never all four together through the real
    production path; (10) both `open_project_file` and
    `read_project_file` (Recent Projects) resolve `base_dir` from the
    OPENED file's own resolved directory, never CWD
    (`desktop_bridge_dialogs._read_granted`), and crash-recovery autosave
    never even serializes a bundle-relative source in the first place
    (`saveAutosave` calls `serializeWorkspace` with no `projectDir`,
    proven by a new test in `lib/autosave.test.ts`); (11) a new test
    (`store/packProject.test.ts`) proves `useApp`'s `history`/
    `future`/`datasets` stay REFERENCE-identical across a full
    preview→start→completed run; (12) consent/write-dir-grant counts
    return to baseline after completed, cancelled, failed, AND
    thread-start-failed outcomes (the last three closed with new
    assertions on existing tests in `tests/test_desktop_bridge_pack.py`);
    (13) see Defect 2 above, plus a new recursive scan of an entire
    failing `pack_status()` snapshot for the tmp_path root
    (`test_a_failing_pack_status_snapshot_never_contains_the_tmp_path_anywhere`).
  - **Ratchet audit (item 14):** diffed `tests/test_repo_integrity.py`,
    `tests/test_write_sites.py`, `frontend/scripts/check-bundle-size.mjs`,
    and `frontend/src/architecture.test.ts` against `origin/main`. The
    bundle-size and architecture ratchets are byte-for-byte UNCHANGED —
    no pin was raised. `test_repo_integrity.py` gained exactly `portable`
    in `PURE_LAYERS` (`MAX_MODULE_LINES` untouched). The write-site
    allowlist gained `portable/{copying,copy_stream,publish,staging}.py`
    (all justified — see PR 2/3's own writeups above and Defect-adjacent
    item 4 above for `copying.py`'s late addition) and legitimately
    DROPPED `desktop_bridge.py` once `write_project_file` stopped
    containing any AST-visible write call of its own (PR 3 moved its
    atomic-write sequence into the now-covered `portable/publish
    .atomic_replace_file`) — every change accounted for, none an
    unjustified weakening.
  - **`portable` mode status.** Backend COMPLETE: a packed bundle is
    built, physically MOVED to a new location, and reopened in tests —
    the pack → move → reopen roundtrip in
    `tests/test_portable_pack_roundtrip.py::test_pack_move_and_reopen_roundtrip`
    plus the frontend's own parse-side proof
    (`lib/workspace.test.ts`'s "workspace bundle-relative source"
    describe block, including this PR's own full-provenance round trip).
    The VISUAL "Pack Project" workflow — the destination-picker dialog,
    the preview/progress UI a user actually clicks through — is NOT
    shipped; it is assigned to ChatGPT/Sol against the bridge contract
    PR 4 (#308) already ships (`desktopPackBridge.ts` + `store/
    packProject.ts`/`packProjectRun.ts`), which is fully tested end to
    end but has no visible surface in the app yet (only the
    exercise-only `commands/packProjectCommands.ts` palette command
    noted under PR 4 above). `linked` mode remains NOT implemented (per
    the mode contract above).

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

**Reconciliation, 2026-09-14 (verified against the code before building).**
This item's first two boxes were NOT stale — but neither was the gap in the
physics, which already existed and was already golden. The map:

- **Williamson-Hall — present and correct, end to end.**
  `calc/reductions.py::williamson_hall` implements the uniform-strain model
  (β·cosθ vs 4·sinθ, K factor, instrumental broadening subtracted in
  quadrature with MATLAB's 1e-16 clamp), exposed by
  `routes/reductions.py::williamson_hall_route` (POST
  `/api/reductions/williamson-hall`), wrapped by `lib/api/reductions.ts`, and
  driven by `components/workshops/reductions/{useWilliamsonHall.ts,
  WilliamsonHallSection.tsx}`. No formula was added or changed by this work.
- **The gap was WIRING plus DATA MODEL, not UI and not physics.**
  `useWilliamsonHall.ts`'s own header stated it: the Peaks workshop's fitted
  peaks "live only in ITS OWN component state, never published to the store,
  so there is nothing durable to prefill from without new cross-workshop
  plumbing". `usePeaks.ts` held the fit in `useState<MultiFitResult>` and
  cleared it on every dataset change; the user retyped every 2θ/FWHM by hand.
- **DATA MODEL, specifically.** `FittedPeak`/`MultiFitResult` (then in
  `lib/types.ts`, now in `lib/peakTable.ts`) carried center/fwhm/height/bg/
  eta/area/status/model and nothing else — no stable id, no uncertainty, no
  exclusion flag, no provenance — and `lib/workspaceSerialize.ts` /
  `lib/workspaceDatasetParse.ts` named no peak field at all, so nothing about
  a fit survived a save. That is what `Dataset.peakTable` now closes.
- **Pawley is not "available capability".** `calc/pawley.py::pawley_refine`
  is implemented and invariant-tested, but has no route, no API wrapper and no
  UI, and its inputs (whole pattern + a `phase_info` unit cell) are not
  derivable from a peak table — so it got its own box below rather than a
  wire-up here.
- **Uncertainties are modelled, not measured.** Neither fit engine returns a
  covariance, and `williamson_hall` accepts no weights; the columns are
  durable, the numbers are a separate box that needs a MATLAB golden first.
- Boxes 3-5 ("Manual peak edits and reviewed batch recipe",
  "Technique-specific plot recipe…", "Validate on representative owner
  instruments/phases") were checked and are genuinely NOT shipped; left
  untouched.

- [x] Connect peak results to Williamson-Hall. **(2026-09-14)** One "Use
  fitted peaks" action fills the Williamson-Hall peak list from the active
  dataset's durable peak table, honouring the per-peak `excluded` flags and
  adopting the wavelength recorded at fit time. Tests:
  `WilliamsonHallSection.test.tsx`'s "Williamson-Hall — Use fitted peaks
  (P2.1)" suite — "one click fills the table from the fitted peaks instead of
  manual entry", "omits peaks excluded in the Peaks workshop, and says so"
  (asserts the API call carries only the included peaks), "adopts the
  wavelength the pattern was measured at", "names the provenance of the loaded
  rows", "drops the provenance line the moment a row is edited by hand".
- [x] Expose the Pawley engine. **Implemented 2026-09-23 in PR #403;
  hardened 2026-09-24 after review.**
  `calc/pawley.py::pawley_refine` is reachable through
  `POST /api/reductions/pawley`, a typed frontend wrapper, and the Reductions
  workshop under Analyze → XRD & reflectivity.
  - **Input:** the active dataset's x axis must be a 2θ scan in degrees:
    the fitted-peak table's rule (`xAxisIsTwoThetaDegrees`), tightened to
    refuse labels naming another angle (phi, omega, chi, psi), 2-D datasets,
    and x outside 0–180°. The user picks the intensity channel, the starting
    cell, an explicit axis tie (cubic / a = b / independent), the centering
    (R is the hexagonal-axes rule), the wavelength (read from the file when it
    records one), the fixed profile FWHM, and whether to refine. Empty or
    out-of-range fields disable Refine with the reason shown, using the
    route's own bounds; the route re-checks every field (422).
  - **Scope and cost:** only reflections inside the measured 2θ window are
    fit and counted. `hkl_max` is derived from the cell and window, capped at
    20; more than 500 reflections in range, or more than 2M points ×
    reflections, is refused with advice to narrow the range (each of the ~100
    grid-search trials solves that least-squares problem). No reflections in
    range, or no more points than parameters, is a 422 rather than a
    fake-perfect R_wp.
  - **Output:** refined a/b/c to 4 decimals, α/β/γ shown as fixed (the
    engine never refines angles; they are inputs only), and R_wp for the fit,
    the starting cell and the linear background alone, as percentages, with
    the in-range reflection count. A warning is shown beside the result (not
    in place of it) and saved with it when R_wp exceeds 0.6 × the
    background-only R_wp, when the fit ended worse than its start, or when
    the search ran out of iterations. The derived Library dataset keeps the
    exact fitted rows (observed, model, background, residual), is stamped as
    a 2θ/deg XRD powder pattern, and records the full request, the warning
    and the per-reflection table under `metadata.pawley`.
  - **Known limits:** the engine is a local grid search with a small capture
    radius that depends on peak width (measured: well under 1 % in some
    cases), and from further out it can settle on a wrong minimum; the 0.6
    warning ratio is a heuristic measured on synthetic Si; no uncertainties
    are reported; glide and screw absences are not applied; the fit runs
    synchronously on the request thread rather than through the job queue.
- [x] Durable peak identity, uncertainty, exclusion, model, and provenance —
  **the columns; the uncertainty NUMBERS are the next box.** **(2026-09-14)**
  `lib/peakTable.ts` defines `PeakTable`: per-peak durable `id`,
  `center`/`fwhm`/`height` with `centerErr`/`fwhmErr`/`heightErr` slots, the
  per-row `model`, a user-controlled `excluded` flag, and a
  `PeakTableProvenance` naming the source dataset id/name, the fit method and
  its parameters, R²/RMSE, the instrument wavelength and the fit instant. It
  hangs off `Dataset.peakTable` (additive-optional, absent = no table, no
  `WORKSPACE_VERSION` bump) and round-trips the `.dwk`. Tests:
  `lib/peakTable.test.ts` (24 cases incl. id uniqueness, exclusion carry-over
  across a re-fit, sanitizer fail-soft), `store/peakTables.test.ts`,
  `lib/workspace.test.ts`'s "workspace durable peak table
  (PRIMARY_SOFTWARE_AUDIT_PLAN P2.1)" save→reopen suite, and
  `PeaksPanel.test.tsx`'s "durable table exclusion column (P2.1)".
**Review round, 2026-09-14 (adversarial re-read of the two boxes above).**
The physics held exactly — `git diff` over `src/quantized/` is empty, and the
one-click path sends the byte-identical request the manual path sends — but the
DURABILITY half did not. Three confirmed defects, three plausible, seven nits;
all thirteen closed in one commit, with the findings recorded here because every
one of them was a claim this plan had already ticked.

- **The table was durable but never INVALIDATED.** `Dataset.peakTable` survived
  every change to the data it was fit from: an `applyCorrections` xOff moved
  `data.time` to `[10.5, 20.5, …]` while `peaks[0].center` stayed `20.0`; a
  column-changing `reimportDataset` cleared `fitSpec` and kept the table
  verbatim; a `setCellValue` re-ran detection and the panel effect then
  RESTORED the pre-edit fit over the changed data. Williamson-Hall's "Use
  fitted peaks" would then load centers and widths measured from data that no
  longer exists, under a provenance line asserting they came from this dataset.
  FIXED two ways, both needed: `PeakTableProvenance.fingerprint` — a
  deterministic digest of the dataset's numbers (`lib/peakTableFit.ts`'s
  `peakDataFingerprint`: row/column counts, the x channel's first/last/min/max,
  FNV-1a over every value's float bytes — *this composition was widened in
  round 2 below*) stamped at publish time and compared
  on every read — plus outright clears wherever `fitSpec` already clears
  (`store/reimport.ts`'s column branch, `store/corrections.ts`'s
  `applyCorrections` and `rowsChangedGuard`, `store/cellEdit.ts`'s
  `setCellValue`). The Peaks workshop refuses to rehydrate a mismatched table
  and Williamson-Hall disables the action with the reason. Deliberately NOT a
  `peaks:<id>` node in `lib/recalc.ts`: that graph marks artifacts an EXECUTOR
  re-derives automatically (`recalcDatasets.ts`/`recalcFits.ts`), a peak table
  has none — re-deriving it means a new peak search plus a user-chosen model —
  and its only writer, `touchDataset`, returns early when `recalcMode` is
  "off". The fingerprint also survives a `.dwk` reopen, which no in-memory
  stale list does.
- **The "incl." checkbox was not keyboard-operable**, and the one keystroke a
  user would try did what the mouse path is careful to prevent: the enclosing
  `<tr>` handles `" "`/`"Enter"` with `preventDefault()` + select, so Space on a
  focused box cancelled the browser's own toggle AND moved the row selection.
  FIXED with an `onKeyDown` stopper beside the existing `onClick` one.
- **"Use fitted peaks" left the previous result on screen**, newly captioned by
  the fresh provenance line — a number computed from inputs that had just been
  replaced wholesale. FIXED: `loadFittedPeaks` clears the result, and a
  hand-typed wavelength now drops the provenance line like every other edit.
- **No x-channel identity was recorded**, so a q-axis pattern in Å⁻¹ loaded
  silently into the 2θ column and produced a plausible grain size (`canCompute`
  only checks `0 < 2θ < 180`). FIXED: the provenance records the x label and
  unit — TEXT, never a column index, so `architecture.test.ts`'s
  `DATASET_CHANNEL_REMAP_EXCLUDED` reason stays true — and the reduction
  refuses anything whose unit is present and not degrees. An unrecorded unit
  still loads; most XRD files carry none. *(That last rule was the round-1
  fix's weak point and was replaced in round 2 below: a substring test passed
  `degC`, and "an unrecorded unit still loads" re-admitted the very q-axis
  case this box exists to refuse, because a unit-less q CSV is the common
  spelling of it.)*
- **Exclusion carry-over across a re-fit was positional** with only a length
  guard, and `fitEach` publishes only the SUCCESSES — so an N-of-M run whose
  success count merely happened to match carried the user's exclusions onto
  different physical peaks. FIXED: matched by nearest centre within half the
  smaller FWHM, each prior exclusion claiming at most one row, unmatched
  exclusions dropped.
- **`lib/xrdWavelength.ts` documented four metadata keys; two are dead.**
  Measured over `src/quantized/io/`: `wavelength_a` (xrdml, `_xrdml_scan`) and
  `alpha_average` (bruker_raw) are written; `k_alpha1`/`kAlpha1` are written by
  no parser (`xrd_csv.py:285` is the ASCII EXPORTER reading them back out, and
  `xrdml.py:86` is an XML element name), so the stated "explicit Kα1 beats the
  average" preference could never fire. FIXED in the frontend: the dead keys
  are gone and the preference now names `wavelength_a`, which IS the Kα1 line.
  The Bruker half stays open — `bruker_raw.py` documents `alpha1` at byte 624
  and emits only `alpha_average` (Cu: 1.5418 vs 1.540598, +0.08 % into
  `D = Kλ/intercept`), so every Bruker RAW pattern still adopts the average;
  decoding byte 624 is a backend change and is the box below.
- **Nits, all closed:** `lib/workspace.test.ts`'s "does not alias the live
  record" was vacuous (`serializeWorkspace` returns a JSON STRING, so
  `serializePeakTable = (t) => t` left it green) and now asserts the copy on the
  helper itself; the `lib/types.ts` pin comment said `1053 -> 1008` above a pin
  of 1009 (`wc -l` vs the split-length convention) and now says 1009; the Pawley
  grep claim above is corrected to its measured one hit; `PeaksPanel`'s fitted
  rows no longer pair a reactive `peakTable` read with local `fitResult` state
  positionally across a dataset switch; and `duplicateDataset` still does NOT
  carry the table — documented in `lib/peakTable.ts`'s header, because a
  duplicate is an INDEPENDENT dataset that carries no derived analysis at all
  (not `fitSpec`, not `excludedRows`) and the copied provenance would name the
  SOURCE dataset's id.

**Sabotage (every new guard broken, its tests run, restored — all 14 caught).**

| # | Mutation | Caught by |
|---|---|---|
| 1 | `peakTableMatchesData` always true | `peakTable.test.ts` "does NOT match once a value changed"; `usePeaks.test.ts` "does NOT rehydrate a table whose data moved under it"; `PeaksPanel.test.tsx` "does NOT re-present a saved fit…"; `WilliamsonHallSection.test.tsx` "disables the action, and says why…" |
| 2 | drop the checkbox `onKeyDown` stopper | `PeaksPanel.test.tsx` "Space on a focused checkbox…", "Enter on a focused checkbox…" |
| 3 | `loadFittedPeaks` keeps the previous result | `WilliamsonHallSection.test.tsx` "clears the result when one click swaps every input" |
| 4 | `peakTableXIsDegrees` always true | `peakTable.test.ts` "refuses a reciprocal-space or real-space axis"; `WilliamsonHallSection.test.tsx` "refuses a table fit on a q axis…" |
| 5 | exclusion carry-over back to positional | `peakTable.test.ts` "carries an exclusion onto the peak at the same CENTRE…", "drops an exclusion whose peak the re-fit no longer found", "refuses to carry an exclusion onto a centre that moved…" |
| 6 | `applyCorrections` keeps the table | `corrections.test.ts` "drops a fit measured from data the correction just re-derived" |
| 7 | `rowsChangedGuard` keeps the table | `corrections.test.ts` "names peakTable alongside excludedRows on a row-count change" |
| 8 | column-changing reimport keeps the table | `reimport.test.ts` "clears it on a COLUMN-changing re-import…" |
| 9 | `setCellValue` keeps the table | `cellEdit.test.ts` "drops a fit measured from the value that was just typed over"; `usePeaks.test.ts` "a cell edit re-runs detection and does not bring the pre-edit fit back" |
| 10 | `setWavelength` stops clearing `fittedSource` | `WilliamsonHallSection.test.tsx` "a hand-typed wavelength drops the provenance line…" |
| 11 | `serializePeakTable = (t) => t` | `workspace.test.ts` "routes the saved table through serializePeakTable's defensive copy" (the vacuous predecessor stayed GREEN under this exact mutation) |
| 12 | `xrdWavelength` reads `k_alpha1` again | `xrdWavelength.test.ts` "ignores `k_alpha1`/`kAlpha1` — NO parser writes either" |
| 13 | `PeaksPanel` pairs the table positionally again | `PeaksPanel.test.tsx` "renders no checkbox rather than a MISPAIRED one…" |
| 14 | `publishFitResult` stamps no fingerprint / x identity | `peakTables.test.ts` "stamps a fingerprint of the LIVE data…", "names the x axis from the time column's Origin metadata…", "names the x axis from the PLOTTED column…" |

**Gate (2026-09-14).** `npx tsc -b --force` exit 0; `npx eslint src
--max-warnings=0` exit 0; `npx vitest run src/lib src/store
src/components/workshops/peaks src/components/workshops/reductions
src/architecture.test.ts` **362 files / 7,118 tests passed**; `uv run pytest -q tests/test_repo_integrity.py`
**12 passed**. Backend untouched (`git diff --stat -- src` empty). Eager bundle,
exact bytes on clean `npm ci` builds either side: **919,781 -> 919,693, a delta
of -88 B** against a 920,400 budget left where it was (headroom 619 -> 707 B) —
everything new is in the lazy-only `lib/peakTableFit.ts`, and the eager
additions are funded by a shared `str()` coercion in `lib/peakTable.ts` and by
folding `clearOverlaysFor`'s four identical `if`s into one typed loop.

**Review round 2, 2026-09-15 (adversarial re-review of the fix commit above).**
The round-1 CONFIRMEDs 2 and 3 were re-probed and are genuinely closed, and the
backend is still untouched. Four new CONFIRMEDs and five nits, all closed in one
commit; the theme is that round 1's invalidation was right in shape and too
narrow in every detail that had been reduced to a summary statistic.

- **The bulk sibling of the fixed cell writer did not clear, and the digest
  could not see the write either.** `setCellValue` got `peakTable: undefined`;
  `setCellBlock` twenty lines below — reachable from the same worksheet by
  PASTING instead of typing — did not, and the fingerprint reduced the x
  channel to `length/first/last/min/max`, so an INTERIOR 2θ paste changed
  nothing it could see. Measured through the real panel and the real store:
  after `setCellBlock("d1", [{row: 3, col: -1, value: 3.4}], "paste")` the
  table was still present, `peakTableMatchesData` still returned **true**, and
  the Peaks workshop re-presented the pre-paste fit over the moved abscissa.
  FIXED both ways: `setCellBlock` and `setCategoricalCell` (the third cell
  writer, safe only because a level code lands in `values`) now clear like
  `setCellValue`, and the digest hashes the whole x column.
- **The x-axis rule still passed a q axis whenever the unit string was
  EMPTY**, which is the common spelling of the case round 1 set out to refuse
  (a unit-less CSV) — probed end to end: `xLabel: "q"`, `xUnit: ""`, button
  enabled, `two_theta_deg: [2.15, 3.04]` posted. The same expression's
  `includes("deg")`/`includes("°")` also passed `degC` and `°C`, i.e. a
  magnetometry M(T) curve in Celsius, whose 0..180 range clears `canCompute`
  too. FIXED, and THE EXACT RULE IS NOW THIS, in `peakTableXIsDegrees`:
  1. the unit is trimmed and lower-cased; a PRESENT unit passes only on an
     EXACT match against `{"deg", "°", "degree", "degrees"}` — exact, never
     substring, so `degC`/`°C`/`deg C`/`degrees C` are refused;
  2. an EMPTY unit passes only on LABEL evidence — `xLabel` matching
     `/2\s*-?\s*(theta|θ)|two[_ -]?theta/i`, i.e. `2Theta`, `2-Theta`,
     `2 theta`, `2θ`, `two_theta`, `Two Theta`. A unit-less `q`/`Q`/`d` axis,
     and a record naming no axis at all, are refused.
  Real files clear clause 1 without needing clause 2 (`io/_xrdml_scan.py`
  writes `x_column_name: "2-Theta"` AND `x_column_unit: "deg"`).
- **Nearest-centre exclusion carry-over inherited an exclusion onto a peak the
  user had explicitly KEPT.** Measured at Kα1/Kα2 spacing (0.20° apart, FWHM
  0.50°, tolerance 0.25°): old table `[20.00 EXCLUDED, 20.20 INCLUDED]`, re-fit
  finds only `[20.20]`, and the surviving peak — the one the user kept — came
  back excluded and dropped silently out of Williamson-Hall. Under the OLD
  positional rule the 2→1 length change abandoned the mapping, so for this
  shape round 1 was a regression. FIXED: the match must be MUTUALLY nearest —
  an old exclusion may claim a new row only when no other row of the whole
  prior table (excluded or not) is as close to that row's centre. A tie (the
  merged-peak case: 30.0 excluded + 30.1 kept re-fit as one 30.05) resolves to
  NOT carrying, because an ambiguous inheritance that silently drops a peak
  from a reduction is worse than a checkbox the user re-ticks.
- **A row-state change moved the fit's real input while the digest said "still
  valid".** The digest was taken from `ds.data`; the fit runs on
  `analysisData(ds)` (`selectedFitData`, and `peakInputs`'s fallback). Probed:
  fit over 6 rows, set `excludedRows = [3]`, detection re-ran on the 5-row
  subset and the same effect rehydrated the 6-row fit over it. The header's
  stated reason ("those select a SUBSET of unchanged measurements and the Peaks
  workshop already re-runs detection on them") did not survive the measurement,
  because re-running DETECTION never refreshes the FIT. FIXED by taking the
  digest over the analysis view on both sides.
- **The digest was widened ONCE, and that one edit retires three findings**
  (the interior-x hole, this row-state hole, and the nit below about a stale
  unit). It is now a single FNV-1a pass over `analysisData(ds) ?? ds.data`
  covering: every x value's float bytes, every value column's float bytes,
  every column label and unit (UTF-16 code units, each terminated so `["ab"]`
  and `["a","b"]` differ), plus the kept row count, the column count and the
  RAW row count in the prefix. The four x order statistics are gone — the
  whole-column hash replaces them and the min/max loop, so this is not a second
  pass (round-2 NIT 5's concern). The prefix is versioned `2:`; a round-1
  fingerprint therefore reads as a mismatch, which asks for a re-fit — the safe
  direction — rather than trusting a digest whose fields meant something else.
- **Nits, all closed.** (2) `publishFitResult` stamped `st.xKey` while
  `peakInputs` falls back to `data.time` whenever `effectiveChannels(...)[0]`
  is undefined (`lib/fitselection.ts:48-49`), so the provenance could name a
  channel the fit never touched; `peakInputs` now returns the `xKeyUsed` it
  actually took and that is what is stamped. (3) closed by the digest above.
  (4) the Williamson-Hall refusal now names the REMEDY ("this dataset has
  changed since the fit — re-fit the peaks in the Peaks workshop") rather than
  a cause that reads as wrong to a user who only added a computed column; the
  q-axis note spells an empty unit as "no unit recorded" instead of "()".
  (5) closed by hashing the x column in the one pass. (1) was the commit
  trailer, which is this session's standing convention, not a code finding.
  `peakInputs` moved to its own `components/workshops/peaks/peakInputs.ts` so
  `usePeaks.ts` did not grow toward its ceiling (497 -> 478 by the split rule).

**Invalidation completeness, as it now stands** — every store path that writes
a dataset's numbers: (a) clears the table, (b) carries it and the fingerprint
REJECTS at read time, (c) carries it and it still matches.

| Path | Site | Verdict |
|---|---|---|
| `applyCorrections` | `corrections.ts:211` | **(a)** unconditional |
| `rowsChangedGuard` (trims, derived recompute) | `corrections.ts:105` | **(a)** |
| column-changing `reimportDataset` | `reimport.ts:242` | **(a)** |
| same-shape `reimportDataset` | `reimport.ts:177` | **(b)** — correctly KEPT when the bytes are identical |
| `setCellValue` | `cellEdit.ts:273` | **(a)** |
| `setCellBlock` (value cells AND the x column) | `cellEdit.ts:341` | **(a)** — round 2's fix |
| `setCategoricalCell` | `cellEdit.ts:397` | **(a)** — round 2's fix |
| `insertRows` / `deleteRows` | `cellEdit.ts:149-212` | (b) |
| `addFormula` / `removeFormula` | `computedColumns.ts` | (b) |
| `recomputeStaleDatasets`, derived-sheet branch | `recalcDatasets.ts:94-104` | (a) on a row-count change, else (b) |
| `recomputeStaleDatasets`, bgRef branch | `recalcDatasets.ts:110+` | (a) — delegates to `applyCorrections` |
| `levelOrder` / `recode` | `levelOrder.ts:274`, `recode.ts` | (b) |
| `splitDatasetByColumn`, `mergeSelected`, `duplicateDataset`, `createDerivedWorksheet` | `split.ts:153`, `useApp.ts:1731`, `derivedWorksheets.ts` | whitelist constructions — no table carried |
| `setDatasetFilter` / row-exclusion toggle | `rowState.ts` | **(b)** — was (c); closed by digesting the analysis view |
| same-shape `reimportDataset` with changed headers (labels/units) | `reimport.ts:177` | **(b)** — was uncaught; closed by digesting labels/units. (No in-app path writes labels/units today — `grep -rn "renameColumn\|setColumnLabel\|setColumnUnit\|setColumnMeta"` over `frontend/src` is 0 hits, and `components/Inspector/ChannelsCard.tsx` renders `labels`/`units` read-only; this row names the real path a re-read of a file whose headers changed while the shape did not.) |

No (c) rows remain. Readers are all gated exactly as round 1 left them, except
that `publishFitResult`'s unchecked read into the exclusion matcher is now safe
for the neighbour case as well (the mutual-nearest rule above).

**Sabotage (every new guard broken, its tests run, restored — all 14 caught).**

| # | Mutation | Caught by |
|---|---|---|
| S1 | x column no longer hashed (round-1 order statistics) | `peakTable.test.ts` "changes when an INTERIOR x value moves and the extremes do not", "changes when the x channel is shifted…", "does NOT match once an interior x cell is pasted over"; `WilliamsonHallSection.test.tsx` "disables the action, and says why…" (4) |
| S2 | labels/units no longer hashed | `peakTable.test.ts` "changes when a column LABEL or UNIT is corrected", "does NOT match once a column is renamed", "does not split labels ambiguously…" (3) |
| S3 | digest the RAW data, not `analysisData` | `peakTable.test.ts` "changes when a row is EXCLUDED…", "does NOT match once a row is excluded"; `peakTables.test.ts` "stamps a fingerprint of the LIVE data…"; `usePeaks.test.ts` "does NOT re-present the fit once a ROW IS EXCLUDED"; `WilliamsonHallSection.test.tsx` "disables the action once a ROW IS EXCLUDED…" (5) |
| S4 | drop `fnvText`'s string terminator | `peakTable.test.ts` "does not split labels ambiguously — ['ab'] and ['a','b'] differ" |
| S5 | fold `ds.id` into the digest (non-data input) | `peakTable.test.ts` "still matches a structurally IDENTICAL re-import of the same numbers" |
| S6 | `setCellBlock` stops clearing | `cellEdit.test.ts` "setCellBlock drops it too — a PASTE is the bulk sibling of typing", "…for a VALUE-column paste as well" (2) |
| S7 | `setCategoricalCell` stops clearing | `cellEdit.test.ts` "setCategoricalCell drops it — a level code IS a number in `values`" |
| S8 | drop the mutual-nearest guard (nearest-only again) | `peakTable.test.ts` "does NOT inherit a vanished exclusion onto the neighbour the user KEPT", "does NOT inherit onto a peak that MERGED an excluded and a kept one" (2) |
| S9 | mutual-nearest never holds (the over-correction) | `peakTable.test.ts` 6 carry-over tests incl. "still carries when the excluded peak IS the nearest prior row"; `peakTables.test.ts` "re-fitting keeps the exclusions the user set…" (7) |
| S10 | unit test back to `includes("deg")`/`includes("°")` | `peakTable.test.ts` "refuses a unit that merely CONTAINS a degree spelling (degC, °C)"; `WilliamsonHallSection.test.tsx` "refuses a Celsius axis…" (2) |
| S11 | an empty unit always passes (round-1 rule) | `peakTable.test.ts` "refuses a unit-less axis with no 2θ evidence in its label"; `WilliamsonHallSection.test.tsx` "refuses a UNIT-LESS q axis…" (2) |
| S12 | an empty unit always refused (over-correction) | `peakTable.test.ts` "accepts an unrecorded unit only on 2θ LABEL evidence…"; `WilliamsonHallSection.test.tsx` "still loads a unit-less table whose LABEL names the 2θ axis" (2) |
| S13 | stamp the plotted `xKey` again, not `xKeyUsed` | `usePeaks.test.ts` "stamps the x axis the fit RAN on, not the plotted one" |
| S14 | refusal text stops naming the remedy | `WilliamsonHallSection.test.tsx` "disables the action, and says why…", "disables the action once a ROW IS EXCLUDED…" (2) |

**Gate (2026-09-15).** `npx tsc -b --force` exit 0; `npx eslint src
--max-warnings=0` exit 0; `npx vitest run src/lib src/store
src/components/workshops/peaks src/components/workshops/reductions
src/architecture.test.ts` **362 files / 7,147 tests passed**; `uv run pytest -q
tests/test_repo_integrity.py` **12 passed**; `node scripts/check-bundle-size.mjs`
OK. Backend untouched. Eager bundle, exact bytes on clean `npm ci` builds either
side (`ff45a200` -> this commit): **919,693 -> 919,674, a delta of −19 B**
against the 920,400 budget left where it was (headroom 707 -> 726 B). The two
new eager `peakTable: undefined` clears in `store/cellEdit.ts` cost 34 B and are
funded by hoisting that file's twice-spelled paste-skip reason into one
`PASTE_SKIP_REASON` constant (−53 B, measured); everything else new is in the
lazy-only `lib/peakTableFit.ts` and the lazy peaks/reductions workshops.

**Review round 3, 2026-09-15 (adversarial re-review of the round-2 fix commit,
`b8cb5e16`).** Verdict **CLEAN** — 0 confirmed defects; every round-2 CONFIRMED
and NIT re-probed through the real store and re-verified closed. Seven nits
(documentation/plan accuracy or pre-existing, none behavioural): NITs 1, 2, 3,
5 and 6 were closed in this same commit (the invalidation-table row above now
names the real `reimportDataset` path instead of a nonexistent Inspector
rename/unit-correction UI; the digest-prefix comment names all four emitted
fields; the x-axis rule documents clause 2 as positive-evidence-only; the NaN-
hash header now states the "stable, distinct from 0" guarantee is per bit
pattern, fail-safe direction only; `peakInputs.ts`'s `fullX` doc now says
exactly what it returns on each branch instead of "the same x channel"). NIT 4
(the `.dwk` round trip losing `-0`/`NaN`, pre-existing and outside this
commit's diff) is filed as **BUG-017** in `plans/BUGS_AND_ISSUES.md` rather
than fixed here. NIT 7 (the commit trailer) is this session's standing
attribution convention, not a code finding, and is not actionable from inside
a plan edit.

- [ ] Decode Bruker RAW's `alpha1` (byte 624) so `lib/xrdWavelength.ts`'s
  documented Kα1-over-average preference can fire for Bruker patterns.
  `io/bruker_raw.py`'s own header documents the field; the metadata dict emits
  only `alpha_average` at byte 616, so every Bruker RAW pattern currently
  adopts the Kα1/Kα2 average as "the wavelength this pattern was measured at".
  Backend change; needs a golden RAW fixture.
- [ ] Per-peak fit uncertainties — **the classic producers.** The model-fit
  path now fills the `*Err` columns (progress note below); what stays open is
  `calc/peak_multifit.fit_multi_peak` and `calc/peak_fit.fit_peak` (the Peaks
  workshop's "Fit all" / "Fit each"), which return no covariance and no
  standard error, so a table they write keeps every `*Err` null. Filling
  those in is new numerics and needs a MATLAB golden first (CLAUDE.md's
  golden-parity rule). `calc/reductions.williamson_hall` likewise still takes
  no weights — see "Not done" below.
  **Progress 2026-09-25 (model-fit publish; Opus 5.5):** the Peak Analyzer's
  step ④ has "Publish to peak table". `peakwizard/modelFitPublish.ts` builds
  the table draft statically; `modelFitPublishRun.ts` + `store/
  peakTablePublish.ts` (loaded on demand — a measured bundle seam, see the
  first file's header) mint ids, carry the prior table's exclusions by peak
  identity, stamp the live dataset and record one undo step. One row per
  peak: centre / FWHM / height / area, each with the P2.4 engine's
  delta-method standard error (`calc/peak_model_fit.py`, pinv covariance in
  `calc/_bounded_lsq.py`) in its `*Err` column — wiring, no new numerics, so
  no golden. A missing error (fixed, tied, on a bound, undetermined, or not a
  positive finite number) stays NULL, never 0 or NaN, and keeps its reason in
  the new optional `errReasons` (the results view's tooltip text); the `.dwk`
  sanitizer now also reads a 0 / negative / non-numeric error as null. New
  OPTIONAL row fields: `areaErr`, `errReasons`, and a Voigt row's
  `fwhmG`/`fwhmL` (`eta` for pseudo-Voigt as before; `model` is the per-row
  shape). New OPTIONAL provenance: `producer: "model_fit"` (absent =
  classic), `engine`, `recipe` (name / range / baseline) and `objective`
  (SSR, or χ² only for a weighted fit, with its reduced value; `R2` = the
  fit's R², `rmse` null). `bg` is the fitted polynomial at the centre plus
  the step-① baseline there, so `height + bg` is the raw-data apex as for
  the classic producer; `bgCoeffs` are the polynomial in ascending powers of
  x, EMPTY after a baseline subtraction (they would describe the subtracted
  trace), with `bgDegree` -1 for no background. No `PEAK_TABLE_VERSION` bump:
  an old `.dwk` loads with none of the new keys. Refused (button disabled,
  reason on hover): a stale fit, a non-converged one, a peak with no finite
  value; a failed publish is shown, not swallowed. Consumers: the Peaks
  workshop shows "value ± err" (or "± —" with the reason), names the
  producer and objective, and its → Report now carries the errors and the
  objective (`calc/report_emit.from_multipeak_fit` prints "±" columns and
  SSR/χ² rows when a table has them; classic reports unchanged);
  Williamson-Hall loads the table unweighted, captioned "model fit". A
  manual edit clears the error of each field whose value moved — including
  an area rescaled by a height/FWHM edit — records "edited by hand" as the
  reason where the field had uncertainty information, drops a Voigt row's
  component widths on an FWHM edit, and clears the objective with R²/RMSE;
  removal clears the objective too. Verified by unit tests (builder, store,
  hook, panel, report emitter), a `.dwk` round trip, and the Chromium e2e
  `peak-model-fit.spec.ts` (fit, publish, read "value ± error" in the Peaks
  table). Eager bundle unchanged (865,631 B).
  **Not done:** publishing from the batch table's rows (each dataset would
  need its own live stamp checked against the data the batch prepared — a
  fingerprint taken at prep time — so it is its own slice); **Williamson-Hall
  weighting by `fwhmErr`/`centerErr` is deliberately NOT added** — it changes
  the WH regression and needs a MATLAB golden (or an independent oracle)
  first; the errors are carried and saved so that slice is additive. No WH
  error bars either (optional, display-only; not taken). The live-dataset
  stamp exists twice (`store/peakTables.ts` `publishFitResult` and
  `store/peakTablePublish.ts`) because sharing it costs eager bytes; both
  files say so.
- [~] Manual peak edits and reviewed batch recipe. **2026-09-23 slice:** fitted
  peak rows can now be selected, edited (center/FWHM/height/area), or removed
  directly in the Peaks workshop. The durable `PeakTable` is the source of
  truth, so edits survive save/reopen and feed downstream consumers such as
  Williamson-Hall. An edit invalidates global R²/RMSE and clears the
  uncertainty slot of each field it actually changed (every current producer
  writes null uncertainties, so today this is a contract, not a visible
  change). Only the fields an edit changes are validated: FWHM must stay
  positive, and height/area may not become zero or change sign (a fitted dip
  is a legitimate negative peak and stays editable). When height or FWHM
  changes and area is left as it was, area is rescaled by the same ratio
  (exact for Gaussian/Lorentzian/pseudo-Voigt at fixed η, approximate for an
  independently fitted Split Pearson VII).
  **Review hardening, 2026-09-23/24:** publishing a fit, and each effective
  manual edit, removal and include/exclude toggle, creates one undo step
  (no-op submissions create none); undo/redo rehydrates both the visible fitted table and its overlay
  from the durable artifact. Async hydration is generation-guarded (a store
  subscription bumps the generation on any active-dataset switch), so a
  delayed resolve cannot restore an old dataset's fit after navigation. An
  exclusion toggle no longer replaces the fit result, so the fitted-row
  selection survives it. Hand-edited rows are declared as such: the Peaks
  header ("N edited by hand"; "fit metrics cleared by manual changes" instead
  of "independent fits"), the Williamson-Hall source caption, and a Source
  column in the peak-fit report. Recording every writer matters because undo
  snapshots the whole dataset list: an unrecorded write made after a recorded
  one is rolled back by undoing it (an unrecorded re-fit was lost this way).
  Batch recipe remains open, as does direct manual peak creation.
- [ ] Technique-specific plot recipe is manually chosen, never auto-overwrites.
- [ ] Validate on representative owner instruments/phases.

### P2.2 — XRR/PNR fit-to-data workbench

**Goal:** connect layer model/reflectivity engine to measured data, constraints,
fit, uncertainty, SLD, residuals, results, and publication output.

**Models:** GPT-5.6 Sol high / Claude Opus 4.8.

- [x] Bind measured X/Y/errors and fit ranges to layer stack. Slice 1 (PR
  #405): `calc/refl_fit.py` + `POST /api/reflectivity/fit` fit named layer
  parameters to one or more measured channels (R, dR, per-point dQ or dQ/Q,
  Q window, spin +/- for a joint PNR pair), dR or log weighting, bounded and
  time-limited; truth recovered on the committed XRR and PNR fixtures. Slice
  2 (PR #406): the Fit mode binds library datasets/columns (Q or 2-theta with
  lambda) in the Reflectivity workshop.
- [x] Starts, bounds, fixed/shared parameters, resolution/background. Slices
  1-2 (PRs #405, #406): value/vary/min/max/tie per parameter, scale and
  background (per-channel names allowed), resolution from a dQ column or
  dQ/Q; a model that cannot mean what it says is refused.
- [~] Linked data/model/residual/SLD views. Slices 2-3 (PRs #406, #407): the
  fitted curve overlays its data, and "Add fit curves" adds each channel's R
  and model and each SLD profile (log-Y plot one click away). Open: no linked
  multi-panel view, and residuals are returned but not yet plotted.
- [x] Posterior uncertainty. Slice 4 (PR TBD, 2026-09-24): "Estimate
  uncertainty (DREAM)" on a live or saved dR-weighted fit samples the
  posterior through the job queue (`calc/refl_dream.py`,
  `POST /api/reflectivity/dream`; progress, cancel, seed, time limit) and
  shows 68%/95% intervals beside the least-squares values, R-hat (flagged
  above 1.2), a bound-limited flag, and R(Q)/SLD(z) credible bands as
  library datasets; a compact summary (never the chains) is stored on the
  fit record and reaches the report. Validation (synthetic): converged 95%
  widths 0.93-1.04x least squares on the XRR fixture; 77/80 thickness/SLD
  truths inside the 95% interval over 20 fresh noise realisations; a
  degenerate same-material pair gets bound-wide intervals and correlation
  -1. User doc: `docs/tutorials/reflectivity-fit-workbench.md`.
- [~] Durable results table and FigureDoc. Slice 3 (2026-09-24): every
  finished fit is a durable record on its channel datasets (`Dataset.reflFits`,
  last 10, `.dwk` round-trip with the BUG-017 sentinels), shown again with a
  history picker, Apply-to-model guard, Restore fit setup and Add to report
  (`calc/report_emit.from_refl_fit`); fit curves carry `metadata.reflFit`
  provenance and export through the existing vector path (tested). Follow-up:
  records also store the fitted curves (≤ 2,000 points each, thinned and
  labelled past that), so a saved fit overlays and adds its curves without a
  re-run; fit curves carry the Library's derived mark. Open: no dedicated
  FigureDoc template for data/model/residual/SLD panels.
- [ ] Validate representative XRR and PNR fits against trusted results. Open:
  needs the owner's real instrument data and a trusted reference fit (e.g.
  refl1d/GenX) — the synthetic-fixture checks above do not close it.

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

- [x] Add/edit/delete peaks directly in selection. Edit + delete of fitted
  durable rows shipped in the 2026-09-23 durability slice; direct add (plot
  click / "add peak at x", data-seeded) and delete from the model table in
  slice 3, 2026-09-25.
- [x] Mixed functions and shared/fixed/start/bound parameters. (slice 2,
  2026-09-25 — Peak Analyzer UI; saved in PeakRecipe v2 since slice 3)
- [x] Context submenu: Peak Fitting > Fit this range. (slice 3, 2026-09-25)
- [x] Explicit model metrics/warnings. (slice 2, 2026-09-25)

**Progress 2026-09-25 (slice 1, engine + route, no UI; Opus 5.5):** new
`calc/peak_model.py` + `calc/peak_model_fit.py` and `POST
/api/peaks/model-fit`. Each peak picks gaussian / lorentzian / pseudo_voigt /
voigt (`peakshapes.voigt` added); background none/constant/linear/quadratic in
`(x - x_ref)`. Parameters `p{i}.{center,height,fwhm,eta,fwhm_g,fwhm_l}` and
`bg.c{k}` (height convention, area derived) each take value/vary/min/max and
an identity tie of the same kind to a varying root. Scale-normalised TRF with
deadline, equilibrated-SVD covariance, at-bound/undetermined -> stderr None,
chi2 only when weighted (SSR always), R2/adj-R2/AIC/BIC, per-peak
centre/FWHM/height/area with delta-method errors, x-range + non-finite drop
counts, warnings (convergence, deadline, bounds, degeneracy, centre outside
range, overlap < 0.5 mean FWHM, negative peaks). `peak_multifit` (golden
parity) untouched. Verified by truth recovery + invariants
(`tests/test_calc_peak_model_fit.py`, `tests/test_api_peak_model_fit.py`); six
sabotages went red. The three boxes above stay open until the Peak Analyzer UI
drives this engine (slice 2).

**Progress 2026-09-25 (slice 2, Peak Analyzer UI on the model engine; Opus
5.5):** the wizard's fit step now defaults to the mixed-shape engine
(`peakwizard/useModelFit.ts`); "Classic multi-peak (MATLAB parity)" stays one
select away on step 3 and its path is unchanged. Step 3: a shape per included
peak (default = the recipe's global shape; SPVII/TCH-pV -> pseudo-Voigt with a
note), background none/constant/linear/quadratic (default from the recipe's
degree), "Share FWHM across peaks" (ties only; the recipe's Shared-FWHM link
pre-applies it), and an editable table (start / vary / min / max / tie to a
same-kind varying untied parameter) seeded from the detected peaks
(`peakModelParams.ts`: centres bounded to the window, heights above a seeded
end-to-end background with min 0, FWHM max = window, Voigt split 0.61/0.61,
eta 0.5). Step 4: run / cancel over the wizard's range-cut, baseline-corrected
trace; `seq` + AbortController so a cancelled, superseded or config-cleared
response writes nothing; the backend's ASCII detail shown verbatim; results
with values +- stderr, a tooltip reason on every "—" (not converged / on a
bound / fixed / tied / undetermined), derived centre/FWHM/height/area,
metrics labelled SSR unless `metrics.objective` is chi2, warnings listed
first; the model and fitted background go to the plot's `fitOverlay` /
`baselineOverlay` (baseline added back, rows matched by x, taken back only
while still ours), components + residuals in an in-panel SVG preview; "Start
from fit". Step 5 reports it through a new `peak_model_fit` emitter
(`calc/report_emit.from_peak_model_fit`: per-peak shape and every stderr incl.
area, parameter status, honest objective label, warnings). PERSISTENCE: the
report is the wizard's durable output and carries all of it; the wizard never
wrote the Peaks workshop's durable peak table and still does not, and the
engine choice / shapes / parameter table are NOT in the saved PeakRecipe
(in-memory for this slice). Verified: vitest (`peakModelParams`,
`modelFitReasons`, `useModelFit`, `PeakWizardModelFit` tests),
`tests/test_report_peak_model_fit.py`, Chromium e2e
`peak-model-fit.spec.ts` (real backend, two-peak synthetic fixture); sabotages
of the stale guard, the chi2 label and the null-stderr reason went red.
Review round (same day, 10 findings fixed): one content key (dataset id,
included peaks, recipe model, working x/y digest) now invalidates the result,
in-flight request and overlays — toggle/add/remove peak and same-id data
edits included; a table edit leaves the fit STALE (curves off the plot,
integrate/report blocked with the reason); a new fit or engine switch clears
the integration; a dataset switch never restores the old baseline; curves map
to plot rows 1:1 by position (repeated-x sweeps, excluded rows); a background
change re-seeds unedited coefficients AND heights together; a degree > 2 note;
Share FWHM adds/removes only ties to the first peak and restores the root's
vary; a parameter others are tied to cannot be fixed, and a client mirror of
the backend's parameter rules blocks Fit with the reason; no x_min/x_max sent.
Remaining: slice 3 — PeakRecipe v2 carrying engine/shapes/table (and the
recipe-file importer), durable peak-table publishing with stderr + shape, a
correlation view; slice 4 — "Fit this range" context submenu and batch recipe.

**Progress 2026-09-25 (slice 3, recipe v2 + direct add + Fit this range;
Opus 5.5):** PeakRecipe v2 (`lib/peakRecipeFit.ts`) stores the model fit's
engine, per-peak shapes (null = the global shape), background (null = from
the degree) and FIELD-LEVEL parameter edits keyed by the backend's stable
names, plus the share-FWHM memory. The table is `applyEdits(seedSetup(...),
fit)` — re-seeded from the data it runs on, every stored edit re-applied —
so a recipe carries "fix p0.eta at 0.3" or "tie p1.fwhm to p0.fwhm" to a new
dataset while unedited centres/heights follow the new peaks. The edits live
IN the wizard's recipe state (so save/apply is exact) and follow their peak:
remove / exclude / re-include renumber them (`remapFitPeaks`) — this replaces
slice 2's "any peak change re-seeds everything"; Find keeps them by index (the
recipe semantic). v1 migrates losslessly (DEFAULT_FIT = the old behaviour, no
warning); a malformed fit section or a newer version FAILS CLOSED — skipped
with a named warning (`loadRecipesChecked` -> `notifyMigrationWarnings`),
never half-loaded, and carried through untouched by later saves (only a
same-name save replaces it). One validator serves storage and the file
importer (`nameKeyedRecipes` refuses "fit.params["p0.center"]: min > max" /
"unsupported version 3" by name); the library sniffer routes any numeric
peak-recipe version to the peak parser; library details show the engine.
Direct add: `addPeakAt` seeds from the data around the click
(`lib/peakSeed.ts`: snap to an apex within ~1.5 % of the points unless on a
slope, half-maximum FWHM) and the peak joins the table as the next `p{i}`
without renumbering anything; each model-table peak has a delete (x).
"Peak Fitting > Fit this range" on the plot context menu takes the Gadget
band, else the integration region, else the selected rows' x extent
(`lib/plotRangeSelection.ts`; the Background Region pick is not a source —
nothing stays drawn) and hands it to the analyzer through a standalone store
(`store/peakFitRange.ts`, zero useApp lines): range applied, step 2, peaks
found once THAT range's baseline is in; disabled with the reason when nothing
is selected; a range from another dataset is refused with a toast. Bug fix
(slice-2 review): the step-1 baseline preview (and useModelFit's restore of
it) expanded analysis-view indices as full rows and drifted past excluded
rows — now mapped by `modelFitOverlay.segmentRows`, shared with the model
overlay; the baseline estimate and its error are tied to the segment they
were computed for; a cancelled estimate no longer leaves "estimating" up.
`usePeakCandidates.ts` split out of usePeakWizard.ts (ceiling). Verified:
vitest (`peakRecipeFit`, `peakSeed`, `plotRangeSelection`, `peakwizard`,
`nameKeyedRecipes`, `recipeFile`, `recipeDetails`, `plotMenu`,
`PlotContextMenu`, `PeakWizardSlice3`, `PeakWizardModelFit`, `useModelFit`),
Chromium e2e `peak-fit-range-and-add.spec.ts` (real backend); sabotages went
red: segment mapping of the preview, baseline-to-segment tie, peak-delete
remap, min > max validation, v1 migration, shoulder detection, the busy
reset, and (e2e) the menu's hand-off. Eager bundle unchanged (844.7 kB; all new code lazy).
Review round (same day, 9 findings fixed): an armed "Fit this range" find
remembers the dataset + range it was asked for and fires or disarms on the
first terminal outcome (no data -> the reason; baseline in / failed / dataset
unavailable), never later; save refuses a table with problems (with the
reason) and the STORAGE loader drops an unusable edit field (min > max, a
name past the 500-peak cap) with a warning instead of losing the recipe
(files stay strict); remaps never write a name past the cap; unticking a
peak sets its edits aside by candidate id and reticking restores them (x
deletes); Share FWHM is a flag (`shareFwhm`), never tie edits, reset by a
width-link change; the Gadget band / integration region are stamped with the
dataset + X column they were drawn on and ignored when stale; an unreadable
record's name is taken (save refuses, rename / duplicate / import dedupe
around it); the plotted-X copy is built only when the row selection decides;
each load warning shows once per session.
Remaining for slice 4: batch recipe (run a saved v2 recipe over many
datasets) and the uncertainty/diagnostic result table; durable peak-table
publishing with stderr + shape and a correlation view are still open.

**Progress 2026-09-25 (slice 4, batch recipe + result table; Opus 5.5):**
the Peak Analyzer has a "Batch" mode (`peakwizard/PeakBatchView.tsx`, kept
mounted while the wizard is shown, so switching never cancels a run): pick a
SAVED v2 recipe and datasets (checklist, "Library selection", All/None),
Run, Cancel, n/N progress. SPLIT: the client prepares each dataset with the
wizard's own code — X/Y are the wizard's plotted columns MATCHED BY NAME in
every dataset (a missing column is an error row naming it, never another
column), analysis rows, range cut, gap drop, the recipe's baseline and find
(`peakwizard/recipeSteps.ts`, now shared with `usePeakBaseline` /
`usePeakCandidates`), then `buildSetup` (fresh seed + the stored edits) and
the model-table checks (`peakBatchPrep.ts`) — because the seeding lives in
TS and a Python copy would be a second definition of a recipe that could
drift. The fits (the long part) run as ONE job on the poll queue: `POST
/api/peaks/model-fit-batch` (`routes/peaks_batch.py`; each item is a
`/model-fit` body, caps 200 items / 2M points / 30 s per fit / 30 min per
batch) over `calc/peak_model_batch.py`: each fit in its own try (a rejected
or crashing item is an error row — uncurated exception text never reaches
it), cancel polled before every item AND before every model evaluation (new
optional `abort_check` in `_bounded_lsq.solve_bounded` /
`fit_peak_model`), total deadline -> named "not_run" rows. A Classic-engine
recipe is refused with the way out. TABLE (`peakBatchTable.ts` +
`PeakBatchTable.tsx`): one row per (dataset, peak) — shape, centre / FWHM /
height / area +- stderr ("—" with `modelFitReasons`' reason on hover),
status, R², the objective under its honest label (SSR, or χ² only when
`metrics.objective` is chi2; separate SSR / χ² columns in CSV and table
dataset, χ² empty/NaN when unweighted), AIC/BIC, points, warnings (count;
texts on hover and expand), at-bound / undetermined flags per peak (+ bg);
a failed dataset is ONE row with the stage and reason. Sortable (missing
last), CSV export, and "Add as table" — the standard `addDataset` derived
path, so it saves with the workspace: numeric channels (NaN kept by
`nonFiniteCells`), text as `metadata.text_columns`, provenance
`metadata.peakBatch` = recipe name + the recipe as run + every source id /
name + time. Verified: `tests/test_calc_peak_model_batch.py` (truth
recovery on 3 synthetic datasets, isolation incl. an unexpected exception,
cancel between items and mid-fit, total + per-item deadline, progress
propagation), `tests/test_api_peak_model_batch.py` (real job queue, rows ==
calc, error row, cancel via `/api/jobs` mid-fit, ASCII 422s, caps); vitest
`peakBatchTable` (incl. `.dwk` save/reopen of the table), `peakBatchPrep`
(item == the wizard's body with stored edits; by-name columns; reasons),
`PeakBatchView` (run, isolation, SSR/χ², reasons, sort, cancel while
preparing / fitting / on close, failed job, CSV, add-as-table provenance,
mode switch keeps the run); Chromium e2e `peak-batch.spec.ts` (3 datasets,
real backend, one isolated). Sabotages went red: backend isolation, cancel,
total deadline; χ² label, null-stderr reason, client isolation, cancel
reaching the job API, stored edits applied. Eager bundle unchanged (845.0
kB). Residuals: the in-panel table is session state (the added table
dataset is the durable result; it does not reopen as the interactive
table); the wizard sends no y errors, so a χ²-labelled batch is reachable
only through the API today; durable peak-table publishing with stderr +
shape and a correlation view remain open (below the boxes, not new boxes).
**Progress 2026-09-25 (durable publish):** the single-dataset model fit now
publishes into the durable peak table with its standard errors, shapes and
provenance — see P2.1's "Per-peak fit uncertainties" progress note. Of the
residuals named above, "durable peak-table publishing with stderr + shape" is
done for the live fit; publishing from batch rows and the correlation view
remain open.
Review round (same day, 10 findings fixed, each with a test that went red
when the fix was reverted): a dataset whose LOADING throws is an error row
and preparation always ends; preparation runs 4 at a time (`mapPool`, rows
in picked order); the route's 2M-point total is enforced client-side
before submit (`applyPointBudget`: overflow datasets are "not run" rows
saying to pick fewer); the route validates each item INSIDE the job
(`TypeAdapter`), so one bad item (a NaN start sent as null, an unknown
shape) is its error row, never a 422 for the batch — the envelope (count,
unique ids, total points) still 422s — and `setupProblems` now rejects
non-finite starts/bounds; the job closure no longer holds the parsed
request; the total deadline is `min(1800, n x 10 s + 30 s)`, not a flat 30
min; `stopped = "deadline"` also when the budget cut the LAST fit short,
and the status says so; Export CSV follows the on-screen sort (sort state
lifted to the view); batch items and `/model-fit` share one
`PeakModelProblem` model; only ValueError / ArithmeticError / LinAlgError
text reaches a row (KeyError / IndexError / TypeError get the generic
type-only message).
- [x] Batch recipe and uncertainty/diagnostic result table. (slice 4,
  2026-09-25)

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

- [x] Identify variables/parameters/fitted/fixed/start/bounds before run.
  (slice 1, 2026-09-25) The equation table gained a hold column (mirrors
  `FitParamsSection`); `fixed` reaches `/equation/fit`, where a held
  parameter keeps its guess and reports no stderr (results say "held").
  `/equation/validate` now returns the before-run summary (`variable`,
  `usesX`, `functions`, `constants` from `calc.fit_equation.describe_equation`)
  and `EquationSummary` shows x / free / held / constants / functions, warning
  when x is unused. Every-parameter-held, min > max and a held value outside
  its bounds are refused before the request (`lib/equationRows`) AND by the
  route (`check_param_vectors`), since `curve_fit` clips starts into the box.
- [x] Precise inline syntax feedback. (slice 2, 2026-09-25) Tokenizer,
  grammar check and shunting-yard moved to `calc/fit_equation_syntax.py`.
  Python `**` is a synonym of `^` (right-associative; `-x**2` is
  `-(x**2)`, `2**-1` is 0.5). Every syntax error is an
  `EquationSyntaxError` (a ValueError) with a code-point span into the
  ORIGINAL text and an ASCII-only message ending "(column N)": unclosed /
  unmatched parentheses, a function without `(`, a missing argument, a
  second argument, a missing operand, a missing operator (`2x`, `a b`),
  unknown function / called `x` or constant, a malformed number, an
  unexpected character. `/equation/validate` returns `errorStart`/`errorEnd`;
  `EquationEditor` underlines the span in the field (an aria-hidden overlay
  tied to the exact text it was reported for) with the message under it,
  converting code points to UTF-16 (`lib/equationSpan`). **Numeric change,
  deliberate:** a unary minus AFTER an operator used to be encoded as
  `0 - operand` and was silently wrong (`3*-2` gave -2, `2^-3` gave -2,
  `3--2` gave 1, `2/-4*2` raised); it is now a prefix negation. A minus at
  the start or after `(` keeps the historical encoding bit for bit, so every
  previously-correct equation (and the golden set) is unchanged. The
  identifier rule is deliberately the historical one (letters/digits/`_`,
  so saved names like `A₀`, `τ` keep working): a mistyped `x²` is still a
  parameter named `x²`, which the before-run summary exposes ("x is not
  used"); a middle dot `a·x` is an error, not a name.
- [x] Save model with units/description. (slice 3, 2026-09-25) Saved
  custom models (`lib/fitmodels`) are versioned: v2 adds an optional
  `description` and per-parameter `units`; a record is written as v2 only
  when it carries one of them (otherwise still v1, readable by older
  builds), and old v1 records load byte for byte unchanged. Load is
  tolerant: an unreadable stored record is skipped and reported ONCE per
  session (`loadCustomModelsChecked` -> a Curve Fit toast), and saves /
  deletes rewrite the slot AROUND it instead of destroying it. File import
  stays strict (`parseFitModelFile`: unsupported version, misaligned or
  non-string units, a non-string description are refused; the sniffer routes
  any numeric version to it). The equation table has a unit column; the
  picker labels a model with the start of its description and the panel
  shows the full text; fitted values and errors carry their unit; the Recipe
  Library details list the description and units. E2E:
  `e2e/specs/equation-fit.spec.ts` (inline error position, `**`, hold,
  units, save + picker, six-column table fits the window).
  - **Follow-up (not done): saved models in the workspace (.dwk).** Custom
    fit models are a GLOBAL localStorage library, not store state, so there
    is no existing seam: carrying them in a project would need a
    serialize/parse slot, a merge policy on open (a same-named model with a
    different equation in the file vs the browser), the Recipe Library's
    `recipeSourcesComplete` fidelity flag, the merge-workspace path and
    autosave triggers -- the project-scoped recipes that do ride the .dwk
    (`quickPlotTemplates`, `plotRecipes`) touch ~34 files. Deferred rather
    than half-done; until then a model travels between machines via the
    Recipe Library's export/import.
- [ ] Stretch: pretty LaTeX rendering while Python remains editable source.
- **Progress 2026-09-25:** slices 1-3 plus a self-review round (identifier
  rule restored to the historical one; a damaged storage slot is moved aside
  rather than overwritten; one description field; the validate response
  type comes from the generated schema; the registry table also refuses a
  held start outside its bounds). Gates green, golden unchanged, eager
  bundle 845.0 -> 845.1 kB (budget 846.1). Open: the stretch box, saved
  models in the .dwk (above), and one shared row parser for
  `lib/fitParams` + `lib/equationRows`.
- **Review round 2 (2026-09-26, coordinator code review, nine findings):**
  a held start outside its bounds is now refused at EVERY route that takes
  `fixed` (`/fit` and `/equation/fit`, shared `calc/fit_holds.py`;
  `curve_fit` itself is unchanged and golden-locked -- `calc.batch_fit` is
  the one internal caller that relies on its clipping, for auto-guessed
  starts it may hold, and has no route); `EquationSyntaxError` survives
  pickle / deepcopy; a save onto a name held by an unreadable stored model
  is refused and that name counts as taken for rename/duplicate/import; the
  results table's units are snapshot at fit time; the recorded
  `qz.fitEquation(equation, { guesses, lower, upper, fixed })` step carries
  the whole setup (second argument optional, so old one-argument steps stay
  valid); Unicode decimal digits start a number again, as before P2.7; one
  shared row validator (`lib/paramRowCheck`) with one wording for both fit
  tables (which closes the "shared row parser" follow-up above); fitmodels
  reads its slot once per operation.
  - **MATLAB-parity item, NEEDS VERIFICATION:** `^`/`**` are
    right-associative and a sign after `^` binds the rest of the chain, so
    `2^3^2` = 512 and `2^-3^2` = 2^-9. MATLAB evaluates `^` left to right
    (`2^3^2` = 64 there). The right-associative `2^3^2` predates P2.7; it is
    pinned by `test_exponent_chain_associativity_is_pinned` and documented
    in `calc/fit_equation_syntax.py`, pending a check against
    `quantized_matlab`'s parseEquation (not available in this environment).
    Semantics deliberately NOT changed.

### P2.8 — 2-D map polish

**Goal:** measured performance plus linked slice/ROI work.

**Models:** GPT-5.6 Terra high / Claude Sonnet 5. **Dependency:** P0.4
(SATISFIED 2026-07-27 — the profile exists; see below).

- [x] Preserve existing H/V/segment slices and link positions. **Done
  2026-09-17.** Before this, nothing was preserved because nothing was kept:
  an H/V click and a segment drag fired a backend cut and landed a 1-D
  dataset, and the map retained no record of WHERE the cut was taken — there
  was no slice object, no position, and nothing drawn. A committed cut now
  also records a durable `MapSliceDef` (kind + linked position in map DATA
  coordinates + width + cut space; `lib/mapView.ts`), drawn over the heatmap
  by `components/Stage/MapSliceOverlay.tsx` through the SAME
  `mapRender.dataToPx` projector the canvas paints with. Slices survive a
  regrid (resolution AND grid method), a colour-limit change, a re-activation
  of the same dataset, AND a switch to another dataset and back — the views
  are keyed by dataset id (`mapViews`), so each map keeps its own and nothing
  is ever dropped except with the dataset itself. Proven at the DOM layer in
  `components/Stage/MapStage.mapView.test.tsx` (the drawn line, not just the
  store field), with the drawn pixels compared against the projector's own
  output in `components/Stage/MapSliceOverlay.test.tsx`. The RSM angular⇄Q
  toggle is NOT a dataset change, so the overlay draws only definitions
  recorded in the space now displayed; toggling back brings them back, and a
  definition that cannot be drawn right now is listed in a muted "parked"
  strip saying why, so it can always be removed.
- [ ] Add ROI statistics/export only from real need.
- [x] Persist color limits/scale/map/slices/annotations. **Done 2026-09-17.**
  The five are one durable record PER DATASET (`mapViews`, `lib/mapView.ts` +
  `store/mapView.ts`) instead of `MapStage`'s local `useState` (colormap,
  log scale) and nothing at all (colour limits, slices, annotations — colour
  limits did not exist; the canvas always painted the payload's own z
  extent). It rides the existing persistence contract: `.dwk` save/reopen,
  autosave (`shouldAutosave` trigger + `AutosaveState`) and Pack Project's
  whole-state spread, plus undo via `HistorySnapshot`. Additive-optional and
  written ONLY when some dataset's view is non-default, so a project that
  never opened a map — and one that opened a map and decided nothing —
  serializes byte-identically to before, pinned as BUG-017's fix was
  (`lib/workspaceMapView.test.ts`). Explicit limits clip the heatmap AND its
  colourbar, verified against a real raster in
  `components/Stage/mapRenderLimits.test.ts`. NOT persisted, deliberately:
  the regrid inputs `mapMethod`/`mapRes`/`contour*` (app-wide render
  settings with their own HISTORY_EXCLUDED entries) and the working
  `mapRoi`/`mapRuler`/`mapSector` geometry (see `store/rois.ts`). Workbook
  transfer deliberately does not carry it: that package is one workbook's
  data, and a map view belongs to the project, not to a workbook.
- **Review round 2026-09-17** (adversarial review of the first cut,
  `c1757fb1`; both boxes above stay `[x]` — the behaviour they claim is real,
  but three user-visible defects and three false green lights were found and
  are now closed).
  - **One view per dataset.** `MapStage` mounts in the Stage Map tab AND in
    every `kind:"map"` document window at once, and each instance ran
    `bindMapView`, so opening a second map silently destroyed the first
    one's slices, colour limits and annotations — outside undo, because the
    rebind recorded no history. `mapView` became `mapViews`, a record keyed
    by dataset id; reading a view is a pure lookup, `bindMapView` is gone,
    and the drop-on-switch rule went with it (it was a consequence of
    sharing one record, not a decision). A dataset REMOVAL still drops that
    dataset's entry, in `store/removeDatasets.ts`'s one shared patch. The
    `.dwk` field stays additive: `parseWorkspace` migrates a first-cut
    single `mapView` object into the keyed record.
  - **Opening a map is not an edit.** `isDefaultMapView` required
    `datasetId === null`, so the mount-time bind wrote an all-default record,
    made `shouldAutosave` true (hence `markProjectDirty`) and grew the saved
    document by a field recording no decision. A view is now default by
    VALUE; with the keyed record the bind writes nothing at all. Pinned at
    the DOM layer.
  - **Every slice keeps a handle.** Chips were built from the DRAWN list, so
    a slice recorded in the other axis space or off the current extent had no
    UI and could never be removed. Undrawable definitions are now listed in a
    muted parked strip that says why, and remove on click.
  - **An h/v slice is judged by its HELD coordinate only.** `endpoints`
    projected the whole clicked point, so an `h` slice vanished when its
    unheld x left a narrower regrid — contradicting the module's own doc. The
    unheld component is clamped into its axis range; `seg` keeps the strict
    both-ends test.
  - **Log limits never blank a map that has something to paint.** The log
    floor raise could push `lo` past an explicit `hi`
    (`effectiveColorLimits([-1,2], 7, 9, log)` → null, i.e. no heatmap and no
    colourbar). Any unusable explicit pair now falls back to the auto extent;
    null is reserved for a grid with no paintable range (in log mode, no
    positive cell).
  - **Three false green lights, now pinned.** The "does not alias the live
    store object" test asserted through a JSON round trip and could not fail;
    nothing pinned that ADDING a slice is undoable; and the overlay's geometry
    was never compared to a ground truth (a projector swap to raw data
    coordinates left the DOM suite green). All three have failing-first pins.
  - **Also closed:** an unknown slice `space` is dropped rather than coerced
    to angular; the sanitizer bounds slices/annotations (200 each), label
    length (200 chars) and rejects a negative width; `COLORMAP_NAMES` is
    pinned equal to `Object.keys(COLORMAPS)`; `loadWorkspace` passes the live
    dataset ids so a hand-built workspace cannot install a dangling entry;
    `DEFAULT_MAP_VIEW` is deep-frozen; `lib/workspaceMerge.ts`'s never-merged
    matrix names the field; the view writers early-return on an unchanged
    value (no undo step, no dirty flag); and `MapColorLimits` has its own
    test.
  - **Bundle.** `effectiveColorLimits` moved from the eagerly-reachable
    `lib/mapView.ts` (`lib/workspaceSerialize.ts` imports it) into
    `components/Stage/mapRender.ts`, which only loads with the map itself —
    it is a renderer decision, not part of the document contract. Eager total
    **909,888 B at the parent `90ea30fa` → 910,287 B on `35b97380`, +399 B**
    (both trees built after their own `npm ci` and a `node_modules/.vite`
    wipe). Everything left is sanitizer/serializer/store logic that is eager
    by construction. **Record corrected 2026-09-18** (review round 3, finding
    3): this pair was first recorded as 916,782 → 917,181 B "against
    `e93b193b`", which is NOT this commit's parent — `git rev-parse HEAD~1` is
    `90ea30fa`, the lazy-seam bundle diet that landed in between, so both
    absolutes (and the headroom they implied, by ≈7 kB) belonged to an older
    tree. The +399 B delta was right; only the baseline was. Second occurrence
    of exactly this on this branch — see the P4.1 review's F1 below.
  - **Residuals, recorded not fixed.** (a) Contour levels still come from
    `p.zMin`/`p.zMax`, not from the explicit colour limits — a contour level
    is a feature of the data, and clipping the colour mapping is not a
    statement about where the isolines are. The levels are derived in
    `drawContours`, which `draw` calls after painting the heatmap, and the
    decision is written into `drawContours`' own header (corrected in round 3,
    finding 6: both this sentence and `draw`'s own comment placed the code
    inside `draw`, where it is not).
    (b) A blank field in `MapColorLimits` reads as 0 (`Number("")`), inherited
    from the sibling `AxisLimits.tsx`, so "clip the top, leave the bottom
    auto" is not expressible; pinned as it behaves in
    `components/Inspector/MapColorLimits.test.tsx`. (c) The colormap and the
    linear/log scale are now per-dataset rather than carried across a switch —
    the carry was an artifact of the single shared record, and the per-dataset
    memory is the stronger P2.8 promise.
- **Review round 3 2026-09-18** (adversarial review of `35b97380`; both boxes
  above stay `[x]`). Round 2's five user-visible fixes and three pins were
  re-attacked and held — ten independent sabotage mutations, all killed — and
  three things were found: one new way to lose work, one half-landed promise
  from round 1, and a bundle record measured against the wrong parent.
  - **Trash ▸ Restore keeps the map view** (finding 1, the only user-visible
    one). Round 2 put `mapViews` in `RemovableState`, correctly — but
    `removeDatasets` is ALSO the send-to-Trash path, and the trash entry
    carried only the `Dataset`. Restore re-added it under the same id with its
    colour limits, slices and annotations gone for good; **Undo** of the same
    delete restored them (`HistorySnapshot.mapViews`), so the loss depended on
    which recovery the user reached for. The view now travels ON the
    `DatasetTrashEntry` (captured in `sendToTrash`, the one chokepoint every
    delete path goes through) and `restoreDatasetInto` re-installs it in the
    same transaction — dependency-aware exactly like the
    `editableFigure`/`figureDoc` restores beside it. A view that came back some
    other way (an undo, a re-import) WINS: restore never overwrites a live
    entry. Pinned at the store layer, delete → Restore → entry-identical.
  - **The Colour limits row says what is being painted** (finding 2, the
    unlanded half of round 1's finding 5). `effectiveColorLimits` can replace
    the stored pair — in log mode a non-positive `lo` is raised to the grid's
    smallest positive cell, and a pair unusable after that raise falls back to
    the auto extent — and the Inspector went on showing the pair the renderer
    was ignoring (type `-1 … 2` in log mode on data starting at 7 and the map
    paints 7 … 9). `draw` now RETURNS the pair it painted;
    `components/Stage/useMapPaint.ts` reports it into a transient, per-dataset
    `mapPaintedLimits` (not persisted, not undoable — its own
    `HISTORY_EXCLUDED` entry), and `MapColorLimits` shows an "effective 7 – 9"
    line beside the fields, ONLY when the two differ. The typed pair stays in
    the fields, editable and recoverable. Proven end to end at the DOM layer:
    a real `MapStage` paint on the RSM fixture drives the Inspector row to
    `effective 100 – 403`.
  - **Also closed.** (4) The first-cut migration is detected by a `datasetId`
    STRING, so a keyed record holding a dataset id of literally `"datasetId"`
    no longer discards every other dataset's entry with it. (5)
    `effectiveColorLimits` returns null — not a non-positive auto pair — when
    log mode has no positive floor, honouring its own header. (6) The contour
    residual is attributed to `drawContours`, in the code and in residual (a)
    above. (7) `sanitizeMapViews` caps the ENTRY count at 256 unconditionally;
    the other three caps already were, and this one was a property of its
    callers. (9) Every map history label names its dataset
    (`change map colormap "rsm.xrdml"`) — with two maps open the label was the
    only disambiguator and it had none. (10) `MapStage` subscribes to its OWN
    dataset's entry, pinned with a React `Profiler` commit count: another
    dataset's map edit now re-renders it zero times. (11) The parked strip has
    a geometry budget (per-chip `max-width` + ellipsis, `max-height` +
    scroll) — a 200-character label, the sanitizer's own cap, used to render
    as one 202-character row and wrap the strip up across the plot. (12)
    `removeDatasetsPatch` allocates a new `mapViews` only when it actually
    prunes one.
  - **New residual, named** (finding 8): a `kind:"map"` document window on a
    NON-active dataset still has no colour-limit control. The Inspector
    describes the active dataset by rule, and that rule is what makes the
    per-dataset keying coherent; the window's own toolbar covers colormap and
    scale, and a per-window limits control is a toolbar change this round did
    not take. Deliberate, not an oversight — recorded beside residuals (a)–(c).
    **CLOSED round 6, 2026-09-18 — see below, referred to there as residual
    (a) per the tracking issue that scheduled the fix.**
  - **Sabotage.** 15 mutations, one at a time, each reverted: dropping the
    restore, dropping the trash capture, letting the restore overwrite a live
    entry, never reporting the painted pair, reporting the STORED pair instead,
    hiding the effective row, the bare `"datasetId" in o`, removing the entry
    cap, the non-positive log floor, the bare history label, the wide
    `mapViews` selector, the chip's text budget, the strip's height budget, the
    unconditional `mapViews` allocation, and the no-op guard on the painted
    report. **15 RED, 0 survivors.**
  - **Bundle** (finding 3, re-measured against the real parent). Eager total
    **910,371 B at the parent `c29fc0e3` (`git rev-parse HEAD~1` of this
    commit) → 910,824 B on this commit, +453 B**; both trees built after their
    own `npm ci` and `rm -rf node_modules/.vite`, exact eager bytes on each
    side. 889.5 kB against the 898.8 kB budget, 9.4 kB under; `EAGER_JS_BUDGET`
    untouched. The growth is the transient painted-limits channel in the store
    slice and the Inspector row that reads it, both eager by construction;
    `useMapPaint.ts` rides the map chunk with the renderer it was extracted
    from. (Round 4 correction: this entry originally named the parent
    `b621c5fa`, which is `c29fc0e3`'s OWN parent, not this commit's — a
    same-tree slip, since `c29fc0e3` touches only `plans/BUNDLE_HEADROOM.md`
    and is therefore bundle-identical to `b621c5fa`, so the 910,371 B figure
    itself needed no re-measurement, only the label.)
- **Review round 4 2026-09-18** (adversarial review of `2074fba4`; both boxes
  above stay `[x]`). Sixteen independent sabotage mutations, fourteen killed;
  two survivors exposed a real user-visible bug and a real test gap, plus five
  NITs, all now closed.
  - **A loading map no longer reports "nothing to paint at these limits"**
    (finding 1, user-visible). `draw` returns `null` both when there is
    nothing to paint YET (no `payload` — a map mid-regrid, or a <3-channel
    dataset that never gets one) and when the limits genuinely paint nothing;
    `useMapPaint.ts` reported both alike, so opening a saved project with map
    colour limits flashed the "nothing to paint" row for as long as the async
    regrid took, blaming the typed limits for a load that just hadn't
    finished. `useMapPaint.ts:~90` now reports only when `payload` is
    non-null. DOM-pinned: a `MapStage` render before the offline regrid
    resolves shows neither the "effective" row nor the "nothing to paint" one.
  - **`loadWorkspace` also clears `mapPaintedLimits`** (finding 2,
    user-visible). The transient painted-limits channel was reset nowhere on
    project load, only `mapViews` was — so a `.dwk` whose dataset ids
    collided with the PREVIOUS project's (an ordinary reopen) could show an
    "effective" pair computed from the previous project's canvas, on the
    eager `MapColorLimits` row, before the lazy `MapStage` chunk even loads.
    `store/useApp.ts:1417` now resets `mapPaintedLimits: {}` in the same
    packed line as `mapViews`, for the same cross-project-leak reason.
  - **The figure-dependency restore's `mapViews` carry is now pinned**
    (finding 3, test gap). `trashRestore.ts`'s `resolveDatasetDependency`
    already carried the restored dataset's map view correctly; nothing
    guarded it, so deleting that one line broke no test. Added to
    `trash.test.ts`'s existing "branch A" case: after a figure-dependency
    restore, `mapViews["d1"].colorLimits` is asserted back.
  - **The trash entry's `bytes` now pins the carried view's own term**
    (finding 4, test gap). `trash.ts:304`'s `bytes: datasetByteEstimate(dataset)
    + (mapView ? byteSize(mapView) : 0)` was correct and unguarded; a new
    `trash.test.ts` case measures the exact sum and asserts it is strictly
    greater than the dataset-alone estimate.
  - **`effectiveColorLimits` applies its own null rule to BOTH branches**
    (finding 5, NIT). Round 3 fixed only the explicit-`colorLimits` branch: a
    non-positive log floor there now returns `null`, honouring the header's
    "null is reserved for … no positive cell at all". The no-`colorLimits`
    branch still returned a non-positive `auto` pair as a log range.
    `mapRender.ts:~41` now applies the same rule there; both branches agree,
    and the header needed no change.
  - **`sanitizeMapViews`'s 256 cap is documented as key-order, not file-order**
    (finding 6, NIT/doc). `Object.entries` on a parsed JS object lists every
    INTEGER-LIKE key ascending numerically ahead of every other key in
    insertion order — a language invariant applied by the engine when
    `JSON.parse` builds the object, before `sanitizeMapViews` ever sees it, so
    the original `.dwk` text order of an integer-like key is unrecoverable
    from a parsed value. The cap already iterates `Object.entries(o)`
    directly (no re-sort), so no code changed; `lib/mapView.ts`'s `MAX_VIEWS`
    doc now says so explicitly, and `lib/mapView.test.ts` pins the resulting,
    documented behaviour (an integer-like key written last in the file is
    kept FIRST).
  - **The parked strip's own `pointer-events` is `auto`** (finding 7, NIT).
    The strip scrolls (round 3, finding 11) but inherited `pointer-events:
    none` from the overlay's outer click-through layer, so its scrollbar
    could not be grabbed — the content stayed reachable some other way (wheel
    scroll-chaining from a chip, Tab-into-view), but the direct affordance
    never worked. `MapSliceOverlay.tsx`'s parked strip now opts into `auto`
    unconditionally (it renders only when it holds at least one chip, and
    each chip was already `auto`), while the overlay's outer container stays
    `none` — pinned, with the existing click-through shape re-asserted in the
    same test.
  - **History labels disambiguate by dataset id when names collide** (finding
    8, NIT). Round 3's per-dataset label names the dataset — but two live
    datasets routinely share a NAME (the same file imported twice, or from
    two workbooks), and the label was ambiguous again. `store/mapView.ts`'s
    `edit()` now appends a short id disambiguator (`nextDatasetId`'s own
    sequence suffix, e.g. `"#4"`) only when another LIVE dataset shares the
    name; a unique name is untouched.
  - **Sabotage.** 8 mutations, one at a time, each reverted: skipping the
    `payload` guard before reporting (finding 1), dropping
    `mapPaintedLimits: {}` from `loadWorkspace` (finding 2), dropping the
    `mapViews` carry in `trashRestore.ts` (finding 3), dropping the
    `byteSize(mapView)` term (finding 4), reverting the no-`colorLimits` log
    branch (finding 5), reversing `sanitizeMapViews`'s entry iteration order
    (finding 6), removing the parked strip's `pointer-events: auto` (finding
    7), and removing the history-label disambiguator (finding 8). **8 RED, 0
    survivors.**
  - **Bundle** (finding 9, record only — the 910,371/910,824 B pair from
    round 3 needed no re-measurement, only its parent's name). This round's
    own commit: eager total **911,634 B at the parent `1b285a14`
    (`git rev-parse HEAD~1` of this commit) → 911,785 B on this commit,
    +151 B**; both trees built after `rm -rf node_modules/.vite` (the parent
    from its own `npm ci`), exact eager bytes on each side via
    `exactbytes.mjs`. 890.4 kB against the 898.8 kB budget, 8.4 kB under;
    `EAGER_JS_BUDGET` untouched. The growth is the round-4 fixes themselves
    (the loading-payload guard, the `loadWorkspace` reset, the
    `effectiveColorLimits` branch, the parked strip's `pointerEvents`
    constant, and the history-label disambiguator), all already eager by
    construction with the code they extend.
- **Review round 5 2026-09-18** (adversarial review of `9c6abc5a`; both boxes
  above stay `[x]`). One real, measured finding — round 4's own fix for its
  finding 7 introduced a new click-blocking regression it had no way to
  measure (jsdom lays nothing out); everything else that round re-checked
  held.
  - **The parked strip no longer intercepts the plot underneath it** (finding
    1, user-visible regression). Round 4 opted the WHOLE strip container into
    `pointer-events: auto` so its scrollbar could be grabbed. A real-browser
    hit-test (Chromium via Playwright, not jsdom) on the shipped CSS shape
    measured that this made the container's FULL bounding box — not just its
    chips — swallow clicks and drags on the map underneath: `justify-content:
    flex-end`-wrapped rows rarely fill exactly to `max-width`, so the box
    routinely holds real, non-trivial dead space that was never a chip
    (≈21% of the strip's own box in the reviewer's fixture). That directly
    contradicted round 2's click-through guarantee, in exactly the corner a
    long-running project with several parked slices is most likely to also
    want to pan or box-select. `MapSliceOverlay.tsx`'s `PARKED_STRIP` is back
    to `pointerEvents: "none"` — only each chip opts into `auto` (unchanged) —
    and the round-4 `maxHeight: 72` + `overflowY: "auto"` clip/scroll budget
    is REMOVED along with it: a scrollbar under `pointer-events: none` was
    never reachable (the very defect round 4 was trying to fix), and a hard
    clip with no way to reach it would HIDE parked chips outright, breaking
    round 2's "every slice stays removable" guarantee. The strip wraps and
    grows instead of clipping; the per-chip text budget (`max-width` +
    ellipsis, round 3 finding 11) is untouched. A very large parked set can
    now visually cover map area, but it can never BLOCK a pointer event on
    the map underneath — only its own chips can, each over its own tight
    content box, the same shape every DRAWN chip in this file already has.
    Also fixed: the round-4 comment's "a shape that already exists on every
    individual DRAWN chip and box-select bar elsewhere in this file" named a
    "box-select bar" that does not exist anywhere in `MapSliceOverlay.tsx`
    (`grep -n pointerEvents` finds exactly the chip style and the strip
    constant) — the comment is corrected, with the DRAWN-chip comparison kept
    (it is accurate) and the fabricated one dropped.
  - **Measured with a real hit-test, not just DOM assertions.** jsdom cannot
    lay anything out, so the DOM-level test suite could not have caught round
    4's regression (or verify this round's fix) on its own; a standalone
    Playwright/Chromium probe against the shipped CSS shape (absolute strip,
    `right`/`bottom`, `flex-wrap`, `justify-content: flex-end`, five chips of
    varied width) sampled 420 points across the strip's bounding box, found
    153 empty (non-chip) points, and **zero** resolved to the strip `<div>` —
    all fell through to the canvas underneath (`elementFromPoint` at an empty
    corner point → `CANVAS`), and a real mouse click at that point fired the
    plot's own `onclick`. Not run as part of the Playwright e2e suite (no
    spec references this DOM, and the change is a style-value-only diff with
    no role/tabindex/class change on Library, Details, Stage or Shell, so the
    "run the full e2e suite" rule does not apply) — the DOM-level pointer-
    events assertions in `MapSliceOverlay.test.tsx` are the lasting pin;
    the hit-test was a one-time, out-of-band confirmation.
  - **Sabotage.** 3 mutations, one at a time, each reverted: restoring
    `pointerEvents: "auto"` on `PARKED_STRIP` (test "the strip container's own
    pointer-events is none; every chip's is auto" → RED), adding back
    `maxHeight: 72`/`overflowY: "auto"` (test "has no maxHeight/overflowY
    budget…" → RED), and dropping the chip's `maxWidth`/ellipsis budget
    (round-3 test "a chip is width-capped and truncates instead of growing" →
    RED). **3 RED, 0 survivors.** A fourth test — 40 parked chips, all 40
    remove buttons present and clickable, removing the last one removes that
    exact entry from the live `mapViews` store (not just firing a mocked
    callback) — has no dedicated sabotage of its own; it is a direct
    behavioural pin on the "every slice stays removable" guarantee this round
    protects, and passed unmodified throughout.
  - **Bundle.** Eager total **911,785 B at the parent `9c6abc5a`
    (`git rev-parse HEAD~1` of this commit) → 911,785 B on this commit, +0 B**;
    both trees built after their own `npm ci` and `rm -rf node_modules/.vite`,
    exact eager bytes on each side via `exactbytes.mjs`. 890.4 kB against the
    898.8 kB budget, 8.4 kB under, unchanged from round 4; `EAGER_JS_BUDGET`
    untouched. Zero delta because this round only changes a style-object
    property VALUE and a comment — no import, export, or code-shape change
    for the bundler to see.
- **Review round 6 2026-09-18** (P2.8 residual (a) — round 3's finding 8: a
  `kind:"map"` document window on a NON-active dataset had no colour-limit
  control at all; the Inspector's row edits only the ACTIVE dataset by rule,
  and `MapToolbar` already covered colormap/scale per window — every write it
  makes already keys off THAT window's own dataset id, never the active one —
  but limits were the one thing that per-window coverage had not taken).
  **CLOSED.**
  - **A compact two-field colour-limit control now lives in the map
    toolbar** (`components/Stage/MapToolbarColorLimits.tsx`), so it appears in
    every mounted `MapStage` — the Stage tab AND every `kind:"map"` document
    window — bound to that instance's own `datasetId` prop, exactly like the
    colormap picker and log-scale toggle beside it. It writes through
    `setMapColorLimits(datasetId, …)`, so a window on a non-active dataset
    edits THAT dataset's own `mapViews` entry, never `activeId`'s.
  - **The commit/undo/effective-pair logic is SHARED, not duplicated.**
    `lib/useMapColorLimitsField.ts` is the one implementation both the
    Inspector's `MapColorLimits.tsx` (unchanged behaviour, still bound to
    `activeId`) and the new toolbar control call: blank+blank commits auto
    (`null`); a non-finite, inverted, or unchanged pair is a no-op (no store
    write, no undo step); Enter/blur commits; and the "effective" note shows
    what the renderer actually painted (`mapPaintedLimits[datasetId]`) when it
    differs from what was typed — the same log-mode-floor-raise/fallback
    story round 3's finding 2 gave the Inspector row. New in the shared hook:
    **Escape reverts** the field to the last committed pair without touching
    the store (neither control had this before; both get it for free).
  - **History labelling is inherited for free.** `store/mapView.ts`'s
    `setMapColorLimits`/`edit()` already names the dataset and disambiguates
    by id when two live datasets share a name (round 4, finding 8) — the
    toolbar control's commits get the identical label
    (`change map colour limits "<name>"[ #<id>]`) with no new code.
  - **A selector pitfall the shared hook had to avoid** (caught by the
    existing round-3 finding-10 pin, not a new test): the Inspector's
    original code read `useApp((s) => s.mapViews)` and computed
    `mapViewFor(mapViews, dsId)` OUTSIDE the selector — harmless there, but
    reused verbatim in the hook it would have made `MapToolbarColorLimits`
    (now living INSIDE the profiled `MapStage` tree) re-render on every OTHER
    open map's edit, exactly the regression round 3 closed for `MapStage`
    itself. The hook selects `mapViewFor(s.mapViews, datasetId).colorLimits`
    AS the selector, so zustand's default equality skips the re-render on an
    unrelated dataset's write — `MapStage.mapView.test.tsx`'s existing
    Profiler-commit-count pin (round 3, finding 10) catches a regression here
    without a dedicated test of its own.
  - **Not dirtied by opening a window.** The control reads via the same pure
    `mapViewFor` lookup every other map reader uses; nothing in it writes on
    mount. Pinned in `MapStage.windowColorLimits.test.tsx` the same way round
    2's "opening a map is not an edit" is: no `mapViews` write, no history
    entry, `shouldAutosave` false, byte-identical `.dwk`.
  - **Tests.** `components/Stage/MapToolbarColorLimits.test.tsx` (8 cases,
    the control rendered directly) and `components/Stage/
    MapStage.windowColorLimits.test.tsx` (6 cases, through a REAL `MapStage
    dataset={…}` — what `DocumentWindow.tsx`'s `MapWindow` actually mounts)
    cover: the control renders for a map window on a non-active dataset;
    typing + Enter/blur commits to THAT dataset and not the active one (and,
    with two open windows, not each other's either); both fields blank
    commits auto; a log-mode clamped pair shows the effective hint; Escape
    reverts the field without committing; one history entry per commit,
    labelled with the dataset; and opening the window is not an edit. The
    existing `components/Inspector/MapColorLimits.test.tsx` (13 cases) was
    re-run unmodified against the refactored Inspector row and stayed green,
    proving the extraction changed no ACTIVE-dataset behaviour.
  - **Sabotage.** 6 mutations, one at a time, each reverted: removing the
    control's render call from `MapToolbar` (kills every DOM-level test that
    looks for it), wiring `MapStage`'s toolbar `datasetId` to the ACTIVE
    dataset instead of the window's own (kills the "not the active one"
    tests), dropping the blank-both-fields auto branch (kills the auto tests
    in BOTH the new toolbar suite and the untouched Inspector suite — proof
    the logic really is shared, not copied), forcing `effective` to always be
    `undefined` (kills the effective-hint tests in all three suites), routing
    only `"Enter"` through `onKeyDown` and dropping `"Escape"` (kills the
    revert tests), and having `commit()` write the pair TWICE with a
    floating-point nudge on the second write (kills the exact-value AND the
    one-entry-per-commit assertions, again across all three suites). **6 RED,
    0 survivors** (some mutations reddened more than one describe block, all
    tallied above).

    | Sabotage | Failing tests |
    |---|---|
    | Remove `<MapToolbarColorLimits/>` from `MapToolbar` | 5/6 in `MapStage.windowColorLimits.test.tsx` |
    | `MapStage` passes the toolbar the ACTIVE id, not the window's own | 4/6 in `MapStage.windowColorLimits.test.tsx` |
    | Hook's blank+blank branch no longer commits `null` | 1/8 `MapToolbarColorLimits.test.tsx` + 1/13 `MapColorLimits.test.tsx` |
    | Hook's `effective` forced to `undefined` | **Correction (review round 7):** 7 tests across FOUR suites, not 6 across three — 1/8 `MapToolbarColorLimits.test.tsx` + 1/6 `MapStage.windowColorLimits.test.tsx` + 4/13 `MapColorLimits.test.tsx` + 1 in `MapStage.mapView.test.tsx` ("log limits the data cannot honour are shown as the effective pair", which mounts the real `MapColorLimits` row and reads the same hook) |
    | Toolbar's `onKeyDown` drops the `"Escape"` branch | 2/8 `MapToolbarColorLimits.test.tsx` + 1/6 `MapStage.windowColorLimits.test.tsx` |
    | Hook's `commit()` writes the pair twice (2nd nudged by 1e-9) | 1/8 `MapToolbarColorLimits.test.tsx` + 2/6 `MapStage.windowColorLimits.test.tsx` + 2/13 `MapColorLimits.test.tsx` |

  - **Bundle.** Eager total **911,295 B at the parent `3f43467b`
    (`git rev-parse HEAD~1` of this commit) → 911,351 B on this commit, +56
    B**; both trees built after their own `npm ci` and `rm -rf
    node_modules/.vite`, exact eager bytes on each side via `exactbytes.mjs`.
    890.0 kB against the 898.8 kB budget, 8.8 kB under. As expected — `
    MapToolbar`/`MapToolbarColorLimits.tsx` are new code but sit entirely
    inside the `MapStage-*.js` lazy chunk (absent from `index.html`'s eager
    `<script type="module">`/`<link rel="modulepreload">` set, confirmed by
    grep), so the whole toolbar control costs the eager bundle nothing.
    **Correction (review round 7, finding 2): the +56 B's CAUSE was
    mis-stated here** — `Inspector-*.js` is NOT eager (it is absent from
    `index.html` too; `grep -c "Inspector-" index.html` is 0, and it is
    dynamically imported from `index.js`), so "`lib/useMapColorLimitsField.ts`
    is a new eager module because `MapColorLimits.tsx` is in the eager
    Inspector graph" does not hold — both the hook and the component it lives
    in are LAZY. The real mechanism is chunk hoisting: the new shared hook is
    imported by TWO lazy chunks (`Inspector-*.js` and `MapStage-*.js`), so the
    bundler lifts it into THEIR common ancestor, the eager entry `index.js` —
    the only eager chunk that moved (+56 B). Per-chunk deltas confirm it:
    `index.js` 407,635→407,691 (+56, eager), `Inspector-*.js`
    55,952→55,647 (**-305**, lazy — the Inspector chunk shrank), `MapStage-*.js`
    51,110→52,537 (+1,427, lazy, costs the eager budget nothing). The byte
    figure itself needed no re-measurement, only this paragraph.
- **Review round 7 2026-09-18** (adversarial review of `b50f6602`; P2.8
  residual (a) stays `[x]` — the feature itself was correctly built; this
  round closes one real cross-window defect, one stale hint, two doc-vs-code
  gaps, one dead-code guard, and one accessibility NIT). **CLOSED.**
  - **F1 (real defect) — the painted pair is now per WINDOW, not per
    dataset.** The "effective" hint's store slot (`mapPaintedLimits`) is keyed
    by dataset id, but the pair `draw()` returns is a property of ONE mounted
    `MapStage` instance's own z-channel pick — two windows on the SAME
    dataset with different channels fought over that one slot, and every
    toolbar but the last writer's showed a wrong pair. `useMapPaint.ts` now
    always keeps its OWN paint in local state and returns it; `MapStage.tsx`
    hands it to its own `MapToolbar` → `MapToolbarColorLimits`, which passes
    it to `useMapColorLimitsField` as an explicit override that wins over the
    store lookup. Only the Stage-tab instance (`dataset` prop omitted) still
    mirrors into the store slot the Inspector's active-dataset row reads.
    Test: `MapStage.windowColorLimits.test.tsx` — two real `MapStage
    dataset={…}` mounts on ONE dataset, different z channels, each toolbar
    asserts its OWN "eff …" text; sabotage (ignore the override prop) → RED
    on that test and the existing clamped-log-mode test (2 failures).
  - **F4 — a reopened window no longer shows a stale painted pair.**
    `mapPaintedLimits` was never pruned; nothing cleared a dataset's entry on
    unmount, so a closed-then-reopened Stage tab went on showing a PREVIOUS
    mount's pair — a canvas that no longer exists — until its first fresh
    repaint landed. New `clearMapPaintedLimits(datasetId)` store action, called
    from `useMapPaint.ts`'s cleanup on unmount of the reporting instance only.
    Tests: `store/mapView.test.ts` (drops the entry / leaves other datasets
    alone / no history / no-op with nothing to drop) and
    `MapStage.mapView.test.tsx` (unmount clears the store entry; a fresh mount
    shows no "effective" row until ITS OWN repaint lands). The pre-existing
    "records per dataset and ignores a repeat of the same pair" no-op guard on
    `reportMapPaintedLimits` is untouched and still passes. Sabotage (drop the
    cleanup) → RED on both new `MapStage.mapView.test.tsx` cases; sabotage
    (no-op the store action) → RED on those two plus the store-level "drops
    the entry" case (3 failures).
  - **F3 — the Inspector row's Escape-to-revert is now guarded by its own
    test.** The shared hook's Escape branch was documented as applying to
    "both controls" since round 6, but only the toolbar's suite ever
    exercised it. Added to `components/Inspector/MapColorLimits.test.tsx`.
    Sabotage (drop the Escape branch from both of the row's `onKeyDown`s) →
    RED, exactly that one test.
  - **F5 — the hook's dead "no change, no undo entry" guard is deleted, not
    kept.** `store/mapView.ts`'s `setMapColorLimits` already short-circuits on
    an unchanged pair; the hook's own copy of that guard was provably dead
    (deleting it earlier changed nothing observable — round 6's own sabotage
    table proved as much). Deleted, with the reasoning now in `commit()`'s
    comment instead of a redundant `if`.
  - **F6 — the half-blank-pair asymmetry is now named in the hook's header,
    not only in the Inspector test that pins it.** `Number("")` is `0`, so a
    blank min with a typed max commits `[0, max]`; a typed min with a blank
    max stays a no-op (`min < max` fails). Pre-existing, deliberately pinned
    behaviour (`MapColorLimits.test.tsx`'s "a half-filled pair commits with
    the blank side read as 0"), carried verbatim from the sibling
    `AxisLimits.tsx`; the header now says so, so a reader of the hook alone
    does not have to find the Inspector's test to learn the contract exists.
  - **F7 — `MapCard.tsx`'s comment no longer contradicts the code.** It said
    the colour-limit control lived "beside the grid controls rather than in
    the float toolbar" — as of round 6 the float toolbar carries it too.
    Comment corrected to say both exist and why neither is redundant with the
    other (one binds to the active dataset, the other to its own window's).
  - **F8 — each toolbar colour-limit field now sits in its OWN `<label>`.**
    A single `<label>` wrapping both inputs only formally associates with the
    FIRST (an HTML implicit-label rule), so "clim" named the min field alone;
    both inputs' `aria-label`s were already correct and are untouched — only
    which field(s) "clim" is associated with changes. Test: each field is
    inside its own `<label>`, plus the existing `aria-label`-based queries
    keep working unmodified. Sabotage (one wrapping label again) → RED,
    exactly that one test.
  - **Sabotage.** 5 mutations, one at a time, each reverted (S1–S3 target the
    component/hook layer per finding above; S4 targets the store action
    directly; S5 covered under F8 above):

    | # | Mutation | Result |
    |---|---|---|
    | S1 (F1) | `MapToolbarColorLimits` ignores the `painted` prop override entirely | RED — 2 (`MapStage.windowColorLimits.test.tsx`: the new two-window test + the existing clamped-log-mode test) |
    | S2 (F4) | `useMapPaint.ts`'s unmount cleanup does nothing | RED — 2 (`MapStage.mapView.test.tsx`'s two new cases) |
    | S3 (F4, store) | `clearMapPaintedLimits` is a no-op | RED — 3 (the store-level "drops the entry" case + both `MapStage.mapView.test.tsx` cases) |
    | S4 (F3) | Inspector row's `onKeyDown` drops the `"Escape"` branch | RED — 1 (`MapColorLimits.test.tsx`'s new Escape case only) |
    | S5 (F8) | Both toolbar fields back under one wrapping `<label>` | RED — 1 (`MapToolbarColorLimits.test.tsx`'s new label-structure case only) |
    | S6 (review round 7, finding 2 — coverage gap, closed by a follow-up tests-only commit) | `MapStage.tsx` forces `reportToStore: true` unconditionally (a window would win the Stage tab's store slot) | Was a SURVIVOR against the committed suite at round 7; now RED — 1 (`MapStage.windowColorLimits.test.tsx`'s new "the Inspector shows the STAGE TAB's painted pair, never a window's" case) |
    | S7 (review round 7, finding 3 — coverage gap, closed by a follow-up tests-only commit) | `useMapPaint.ts`'s render-time reset (`paintedForRef`/`setPainted(undefined)` on a `dsId` change) deleted | Was a SURVIVOR against the committed suite at round 7; now RED — 1 (`useMapPaint.dsSwitch.test.ts`'s new "clears THIS instance's painted pair synchronously the moment dsId changes" case; the hook layer, not DOM, per the round-7 review's warning that a naive DOM reproduction races MapStage's own unrelated payload-fetch race) |

    **5 for 5 at round 7 itself, 0 survivors; the review's own two follow-up sabotages (S6, S7) also now RED, 0 survivors.**
  - **Bundle.** Eager total **887,615 B at the parent `8a6f49ca`
    (`git rev-parse HEAD~1` of this commit) → 887,746 B on this commit, +131
    B**; both trees built after their own `npm ci` and `rm -rf
    node_modules/.vite`, exact eager bytes on each side via `exactbytes.mjs`.
    866.9 kB against the 898.8 kB (920,400 B) budget, 31.9 kB under;
    `EAGER_JS_BUDGET` untouched. Per-chunk diff (matched by stripping each
    build's content hash from the filename): every other eager chunk is
    BYTE-IDENTICAL between the two trees except `plural-*.js`, 51,862→51,993
    (+131) — `index-*.js` itself is unchanged (382,829 both sides), unlike
    round 6, because the chunk graph has been reshaped by intervening
    bundle-diet commits since then, and the shared ancestor that absorbs code
    reachable from both the Inspector and MapStage lazy chunks is now this
    "plural" chunk rather than the entry. It carries the new
    `clearMapPaintedLimits` store action (confirmed: its name is a literal
    object-property string in the built chunk, `grep -c clearMapPaintedLimits
    plural-*.js` = 1) plus the small amount of added branching in the shared
    `useMapColorLimitsField.ts` hook — both already-eager modules this round
    only extends, not a new dependency edge.
  - **F2 (record, not code) — the round-6 bundle entry's stated CAUSE for its
    +56 B was corrected above** (`Inspector-*.js` is lazy, not eager; the
    growth is chunk hoisting of the new shared hook into the eager entry
    because two LAZY chunks import it, not "a new eager module"), and the
    round-6 sabotage table's "Hook's `effective` forced to `undefined`" row
    is corrected from 6 tests/three suites to 7 tests/four suites (a fourth
    failure in `MapStage.mapView.test.tsx` was omitted).
- [~] Fix profiled rendering/memory bottlenecks — **profile delivered
  2026-07-27** (`docs/envelope/2027…-final-residuals.json` M1 +
  `tools/baselines/measure_map_regrid.py`): the default linear regrid
  runs `scipy griddata` (full Delaunay) over ALL input points on every
  call — 8.5 / 37 / 153 s at 250k / 1M / 4M — while output resolution is
  irrelevant (<2 % across 200²→2000²). RSM input is typically a regular
  grid; the class fix is a gridded-input fast path (detect + bin/decimate,
  no triangulation), falling back to griddata only for genuinely
  scattered input. This sub-item is defect-class and actionable now; the
  rest of P2.8 stays Gate D-sequenced. **The gridded-input fast path
  shipped** (see the "P2.8 defect-class: map-regrid gridded-input fast
  path" Completed-log entry below, `231a1b8`) — `calc/_grid_detect.py`
  (jitter-vs-pitch axis clustering, ≥0.9 coverage) + `interp2d.py`'s
  `_query_grid_linear`/`_thin_scattered` route a detected grid through
  `RegularGridInterpolator` (1M points: 37.0 → 1.24 s, 30×) with a
  griddata fallback for genuinely scattered input. Re-verified 2026-09-09:
  `tests/test_calc_interp2d.py` + `tests/test_calc_grid_detect.py` — 54
  passed. Left `[~]`, not `[x]`: this box is the WHOLE P2.8 bottleneck
  list and the `natural`/`cubic` Delaunay paths (same cost class, no
  measured evidence) are deliberately untouched, per that same log entry.
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

- [x] One metadata source for name, one-sentence tooltip, keywords, context,
  shortcut, and help target. **Verified 2026-09-13:** `store/commands.ts`'s
  `Action` interface carries all of it in one place — `label` (name),
  `description` (one-sentence tooltip, `>20` chars enforced), `keywords`,
  `group`/`section` (context), `shortcut`, and `id` (the help target key
  both `actionToHelpItem` and the command palette resolve by) — consumed
  identically by `lib/helpContent.ts` and the palette so the two discovery
  surfaces cannot drift into parallel catalogs.
- [x] Generate help coverage/tests from it. **Verified 2026-09-13, tests
  run:** `helpContent.test.ts`'s "documents every curated command at its
  command definition" fails the build if any of the >80 `buildAppActions`
  commands lacks a `description`; `workshopHelp.test.ts` fails if a
  `WORKSHOP_HELP` entry stops matching a real command. Ran
  `npx vitest run src/lib/helpContent.test.ts src/lib/workshopHelp.test.ts
  src/components/overlays/HelpDialog.test.tsx` — 81 passed.
- [ ] Small contextual `?` links on complex workshops/property groups.
- [ ] Progressive disclosure; tooltips remain one sentence.
- [x] Audit stale capability wording. **Audited 2026-09-13** against the
  three most recent capability changes: P3.3's dash/marker cycle (this
  branch's HEAD, `1b60872a`), L1.4 Details parity (LIBRARY_WORKBOOK_UX_PLAN
  L1.4), and the baseline "Fit from region" 2-D y-box (`65097f6e`/
  `ed596ec3`/`5f65ec8a`). Grepped help/tooltip/description strings across
  `frontend/src` for each.
  - P3.3 dash/marker cycle and L1.4 Details parity: no stale wording found.
    `AppearanceMenu.tsx`'s "Vary dash & marker" copy and comment already
    describe the shipped one-function/one-position invariant; the
    `SeriesStyleCard.tsx` "STORED choice, not the drawn one" comment and its
    PRIMARY_SOFTWARE_AUDIT_PLAN P3.3 cross-reference (~3141-3145, "Deliberately
    NOT done") both describe a still-current, deliberate limitation, not a
    stale claim. `DetailsRow.tsx`'s header describes the Tree/Details parity
    change accurately as before/after history, and its "available in Tiles
    view" disabled-Browse tooltip is accurate — Browse is not one of L1.4's
    seven parity verbs.
  - 2-D region box: ONE real gap found, already on record but not
    cross-referenced here — `frontend/src/lib/plotToolbarDefs.ts:78`'s
    `REGION_TOOL.desc` ("Drag to select a background range for baseline
    fitting") never mentions that a taller drag also picks a y-range, even
    though the y-box shipped. Not editing it here per this item's own
    scope (the string lives in `frontend/src`, not `plans/`); it is also
    already recorded, in more detail, as PORT_CHECKLIST.md's own "Residual"
    note on the 2-D y-box entry (~line 96: "a hint update was dropped for
    bundle bytes, so the feature is discoverable only by trying it or
    reading this checklist") — a deliberate, budget-driven omission, not an
    oversight.

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
- [~] Extend the same source to Inspector cards, context actions, and
  workshops, then add contextual `?` links. **Narrowed 2026-09-12 — the
  WORKSHOPS half is shipped, checked separately from context actions
  rather than assumed together:** `lib/workshopHelp.ts`'s `WORKSHOP_HELP`
  map (PR #266, commit `8a44f9fe`) keys every workshop `ToolWindow` id to
  a Help search query — `ToolWindow` looks its own id up so no per-panel
  edit is needed, and `workshopHelp.test.ts` fails if an entry stops
  matching a real command, the same discipline the Inspector-card `?`
  actions below already use. Inspector cards were already `[x]` in this
  same box (2026-07-25). Still open, verified 2026-09-12 by reading both
  files rather than trusting a grep alone: contextual `?` links on
  right-click CONTEXT ACTIONS — neither
  `components/overlays/ContextMenu.tsx` (the file's real path; not
  `components/ContextMenu.tsx`) nor `lib/contextActions.ts` carries a help
  affordance of any kind. That is what keeps this box `[~]` rather than
  `[x]`; see the (separate, narrower) fix below, which only closed the
  *search-coverage* half for registry commands, not this UI gap.
- [x] Channels, Error columns, Corrections, Series style, and Axes Inspector
  cards have compact `?` actions that open Help with a relevant search already
  applied (2026-07-25).
- [x] Help's search index now also merges the runtime command registry
  (`useCommands`/`setMenuCommands`), not just `buildAppActions` — closing the
  gap `lib/workshopHelp.ts`'s header comment named ("relink-sources,
  paste-workbook, take-over-editing, open-as-copy" were real, described
  commands invisible to Help search). `HelpDialog.tsx` snapshots
  `useCommands.getState().menuCommands` on open (the same non-reactive
  discipline `CommandPalette.tsx` already uses) and merges described entries
  in via `mergeCommands`, so a *future* registry-published command reaches
  Help automatically instead of needing another hand-edit here — verified by
  a guard test (`HelpDialog.test.tsx`, "guard: an arbitrary described
  registry command becomes searchable with no HelpDialog change") (2026-09-09).
  This is deliberately narrower than the box above: it fixes *search
  coverage* for registry commands, not the still-open "contextual `?` links
  on workshops/context actions" UI work, which is untouched.

### P3.2 — First-plot onboarding/Home

**Goal:** a technical newcomer makes a respectable first plot in five minutes.

**Models:** GPT-5.6 Terra medium / Claude Sonnet 5.

- [ ] Home foregrounds projects, drop/import, working path, first-plot path.
- [ ] Familiar Origin gesture tips without copying Origin's architecture.
- [ ] Optional 1-D, grouped, and 2-D examples.
- [ ] Hints stop once learned.

### P3.3 — Accessibility/input-quality pass

**Models:** GPT-5.6 Terra medium / Claude Sonnet 5.

- [~] Keyboard reachability, focus, order, cancel. **Audited in full and
  fixed across nine rounds, 2026-09-18–19.** Round 7 closed R1's focus half;
  **round 8 NARROWED R1** after measuring that its Escape half was closed on
  a false claim, and filed the measured defect as **BUG-018**; **round 9 fixed
  BUG-018 and CLOSED R1 and R13**; **round 10 (2026-09-25) CLOSED R12**:
  modality is now a browser-enforced `inert` background instead of
  `aria-modal`, with the live regions exempt (`frontend/src/lib/modalInert.ts`).
  Round 10's review follow-up also CLOSED R16, the residual that round opened,
  and **round 11 (2026-09-25) CLOSED R15**: a modal now gates the app's
  window-level shortcuts (`frontend/src/lib/appShortcuts.ts`).
  Stays `[~]` rather than `[x]`: eleven residuals remain (R2–R11 and R14
  below — R1, R12, R13, R15 and R16 are closed, R14 was opened by the round-9
  re-review), each a distinct, smaller gap — none of them a
  dialog with no keyboard dismissal at all, which is what the audit originally
  found.

  **The audit** — every `.tsx` under `components/overlays`, the `ToolWindow`
  workshop host, and the three Library views. Columns: focus moves INTO the
  surface on open / Tab is trapped inside it / Escape cancels / focus returns
  to the opener on close.

  | Surface | in | trap | Esc | restore | after this pass |
  |---|---|---|---|---|---|
  | ConfirmDialog | Y | **N** | Y | Y | trap added |
  | ParamDialog | partial | **N** | **dead** | **N** | all four |
  | RecoveryChoiceDialog | **N** | **N** | **none** | **N** | all four |
  | PlotRecipeApplyDialog | **N** | **N** | **dead** | **N** | all four |
  | QuickPlotWithDialog | **N** | **N** | **dead** | **N** | all four |
  | AnnotationTextDialog | **N** | **N** | weak | **N** | all four |
  | Split / Separate / Combine / ReimportAll / Shortcuts / TextFormatHelp / Preferences / Help | Y | Y | Y (stacked too, round 9) | Y | R1 CLOSED — focus-in + trap + restore in round 7; Escape ownership in round 9, on `escapeStack`'s `modal` layer (BUG-018) |
  | CommandPalette | Y | (single input) | Y | **N** | unchanged — residual |
  | ContextMenu | Y | n/a (roving menu) | Y | Y | already correct |
  | ToolWindow (all 48 workshops) | **N** | n/a (non-modal) | **none** | **N** | focus-in + Escape + restore (round 2); Escape re-homed on the shared ordered registry (round 3); a DECLINED close keeps the key (round 4) |
  | LibraryTree / LibraryDetails / LibraryTile | Y | n/a | Y | — | already correct, untouched |

  "dead" means the dialog HAD an Escape handler — on the dialog box's React
  `onKeyDown` — but nothing ever moved focus into the box, so the key never
  reached it. That distinction is the main thing the audit bought: four of
  these looked done by grep and were not.

  **What shipped.**
  - `components/overlays/useDialogFocus.ts` (new, no new dependency).
    `useFocusTrap(ref, open)` wraps Tab/Shift+Tab; `useDialogFocus(ref, open)`
    adds focus-in on open and restore-to-opener on close. The opener is read
    during the RENDER that opens the dialog, not in the effect — by effect
    time an `autoFocus` field has already taken focus, so an effect-time read
    remembers a node inside the dialog and restores to nothing. Focus-in is
    skipped when focus is already inside, so a dialog's own `autoFocus` wins.
  - `RecoveryChoiceDialog` — the worst of the set, and a STARTUP modal: no
    keyboard dismissal at all and focus left on `<body>`. Escape now cancels
    (matching the backdrop, the choice that touches nothing), plus focus-in,
    restore, `role="dialog"`/`aria-modal`/`aria-labelledby`.
  - `ParamDialog`, `PlotRecipeApplyDialog`, `QuickPlotWithDialog`,
    `AnnotationTextDialog` — focus-in, so their existing Escape is reachable,
    plus trap and restore. `QuickPlotWithDialog`'s "source worksheet was
    removed" branch had no Escape handler at all; both branches now share one.
  - `ConfirmDialog` — trap only. Its focus-in/restore were already argued out
    and test-pinned, and are untouched.
  - `ToolWindow` — Escape closes a workshop, once at the shared host instead
    of in 48 panels, guarded by the repo's editing-target convention (a text
    field keeps Escape). The frame also takes focus on mount (`tabIndex={-1}`),
    because a workshop opened from the command palette otherwise leaves focus
    on the unmounted trigger, where a root-level React handler never fires.
    **Round-2 correction:** as first written this ALSO claimed a
    `defaultPrevented` guard that let another Escape consumer keep the key.
    That claim was false — the handler called `stopPropagation()` on a React
    synthetic event, which kills the native event at React's root container,
    so the window-BUBBLE consumers it named never ran at all. See the round-2
    entry below for the measurement and the fix.
  - Tests: `overlays/dialogFocus.a11y.test.tsx` (7 cases) and six cases
    appended to `overlays/ToolWindow.test.tsx`, all driven at the DOM layer
    with `userEvent.tab()`/`userEvent.keyboard()`, because the bug class here
    is "the handler exists but the key never reaches it". Every one is
    sabotage-verified. Eager bundle +1,437 B (911,295 → 912,732).

  **Round 2 (2026-09-18) — the adversarial review's three findings, closed.**
  The pass above shipped three defects of its own. Each is fixed here with the
  test that was missing, and every claim it made that measurement contradicted
  is corrected in place rather than left standing.
  - **It created the very focus-loss its own hook header condemns.** The frame
    took focus on mount and nothing gave it back, so Escape-closing a workshop
    left the user on `<body>` — where `useGlobalShortcuts`' Delete/Backspace
    removes the active dataset. `ToolWindow` now shares the dialogs'
    render-time opener latch (`useOpenerRestore`, extracted from
    `useDialogFocus`) and restores BEFORE the panel unmounts, the pattern
    `lib/focusGuard.ts`'s `removeRowSafely` already documents: React runs a
    deleted tree's passive destroy in a LATER flush, and measured in jsdom
    focus was still on `<body>` when the assertions ran. The unmount cleanup
    stays as the backstop for closes that do not come through the component.
    When the opener is gone (a menu item that unmounted with the click), focus
    lands on the Library's own focus-loss container (`lib/scrollOutFocus.ts`)
    — CORRECTED in round 3: that container exists only where a virtualized
    Library view is rendered, so the fallback now continues to the shell root
    (`lib/appRoot.ts`) and the "never `<body>`" promise is finally true. The audit table's `n/a` restore cell for ToolWindow now
    reads the truth: it was **N**, and it was this pass that made it matter.
  - **The `defaultPrevented` guard protected nobody.** `onWindowKey` called
    `stopPropagation()` on a React SYNTHETIC event, which also stops the
    native event at React's root container — and every Escape consumer the
    comment named is a window-BUBBLE listener downstream of that root.
    Measured: with a bubble consumer, `onClose` 1 call / consumer 0; with a
    capture consumer, `onClose` 0 / consumer 1. The `stopPropagation()` is
    gone (the event reaches every consumer as it always should have) and the
    close waits one macrotask, then re-reads `defaultPrevented` — a LIVE
    property of the event — so a consumer that claimed the key wins whatever
    phase or registration order it ran in. Registration order could not have
    fixed this: `usePeakWizard` registers its Escape listener when the wizard
    reaches step ②, long after the hosting window mounted. That panel now also
    CLAIMS the key with `preventDefault()`, so one Escape pauses marker-edit
    instead of closing the whole Peak Analyzer; a second Escape, with nothing
    left to pause, closes the panel as usual.
  - **Three of the six fixed dialogs had no test at all.** Sabotage S10 —
    delete the `useDialogFocus` call from `PlotRecipeApplyDialog`,
    `QuickPlotWithDialog` and `AnnotationTextDialog` at once — left all 226
    `components/overlays` tests green, because each dialog's own suite fires
    Escape AT the box (`fireEvent.keyDown(box, …)`), which passes whether or
    not anything ever moved focus into it. Six cases (focus-in + Escape each,
    covering BOTH QuickPlotWith branches) now press the key the way a user
    does, via `userEvent.keyboard` at `document.activeElement`.

  Also closed, from the same review: stacked traps (a module-level stack of
  open trap roots — only the top acts, so two open dialogs no longer deadlock
  Tab on the first control of each); the frame no longer overrides a child's
  `autoFocus`; the restore no longer yanks focus the user has since moved to a
  live control elsewhere; `FOCUSABLE` gained `[contenteditable]`, `iframe`,
  `summary` and `audio`/`video[controls]`; the hidden/`aria-hidden` check
  walks ancestors up to the trap root instead of asking only the element; and
  the fourth hand-rolled copy of the `isEditing` predicate became one shared
  `lib/editingTarget.ts` (`useHistoryCommands` keeps its documented WIDER
  variant, which answers a different question).

  | Sabotage (round 2) | Result | Failing tests |
  |---|---|---|
  | S10 `useDialogFocus` removed from all three untested dialogs | **RED** 6 | the six new focus-in/Escape cases |
  | S11 ToolWindow's restore-to-opener removed | **RED** 2 | "gives focus back to the opener…", "lands on the shared safe spot…" |
  | S12 safe-landing fallback removed (opener gone) | **RED** 1 | "lands on the shared safe spot, never `<body>`…" |
  | S13 round-1 Escape restored (`stopPropagation`, close at once) | **RED** 2 | "a panel hook that claims Escape keeps it…", "an unclaimed Escape still closes the panel…" |
  | S14 top-of-stack check removed from the trap | **RED** 1 | "only the TOP trap acts…" |
  | S15 frame focuses on mount unconditionally | **RED** 1 | "leaves a child's autoFocus alone…" |
  | S16 `usePeakWizard` stops claiming Escape | **RED** 1 | "CLAIMS the Escape it consumes…" |

  Eager bundle: parent `b50f6602` **912,824 B** → tip **913,548 B**, **+724 B**
  (budget 920,400 B, so 6,852 B of headroom left). Both built after
  `rm -rf node_modules/.vite`; the tip figure reproduced twice.

  **Round 3 (2026-09-18) — the review's regression, closed; the ladder made
  one rule.** Round 2 removed `ToolWindow`'s `stopPropagation()` (correctly —
  it was killing every window-bubble Escape consumer) but left two
  PRE-EXISTING listeners that `preventDefault()` on every Escape they see:
  `LibraryWorkspace` (Tiles) and `QuickFigureBuilderWorkspace`. Reproduced in
  real Chromium: with Tiles open and a workshop focused, Escape closed the
  WORKSPACE and left the workshop open — and the second Escape did nothing at
  all, because closing Tiles pulled focus out of the panel onto a Library row.
  The only keyboard dismissal a workshop has was dead exactly where a user
  would reach for it, and no spec in the suite paired the two surfaces.
  - **The invariant, now one mechanism: the innermost open surface claims
    Escape, and the next Escape goes to the one below it.** **(Overstated as
    written — CORRECTED in round 4 below: two of `useGlobalShortcuts`' three
    tiers were still claiming inline ahead of every registered surface, and
    the Stage's four deselect listeners still fired alongside whatever claimed
    the key. Round 4 moved every one of them into the registry and restates the
    invariant with its two documented exceptions.)**
    `frontend/src/lib/escapeStack.ts` (new, 143 lines) is a module-level
    ordered registry. Surfaces register on open with a handler; ONE listener —
    `window`, BUBBLE phase, the last stop on the propagation path — walks the
    stack top-down and the first handler that returns `true` stops the walk.
    Order is layer first (`window` ▸ `workspace` ▸ `app`), then OPEN order
    within a layer (`useEscapeSurface` registers once per mount and reads the
    handler through a ref, so a new callback identity cannot reshuffle the
    stack). `ToolWindow`, `LibraryWorkspace` and `QuickFigureBuilderWorkspace`
    stopped listening individually; `useGlobalShortcuts`' revert-the-armed-tool
    tier moved into the `app` layer so an open surface is always dismissed
    first. A `ToolWindow` DECLINES when focus is not inside its own frame,
    which is how Escape from a Library row still closes Tiles with a panel
    open, and how several open windows stay sane.
  - Bubble phase is what keeps the other owners intact with no special case:
    everything that already owns Escape does it by stopping propagation
    (`ConfirmDialog` and the eight backdrop dialogs on window-capture,
    `ContextMenu` on document-bubble, `CommandPalette` through React), so the
    dispatcher is simply never reached. Round 2's one-macrotask deferral is
    kept verbatim, and is what still lets `usePeakWizard` keep an Escape it
    claimed with `preventDefault()` from inside its own window.
  - **One keystroke, one close.** `closeTimer` was a single ref every keydown
    OVERWROTE without clearing: two Escapes called `onClose` twice (the second
    after unmount) and a HELD Escape called it twelve times. The registry
    ignores `event.repeat`, clears any pending walk before arming a new one,
    and `ToolWindow` carries a `closed` ref so a panel already on its way out
    does not close twice.
  - **The safe landing always exists.** `focusSafeLanding()` aimed only at
    `[data-scroll-out-focus]`, which just the three VIRTUALIZED Library
    renderers put in the DOM — with zero rows the Library takes its flat
    branch and renders none, and `?.focus()` was a silent no-op that left the
    user on `<body>`. It now falls back to the shell root
    (`frontend/src/lib/appRoot.ts`, `tabIndex={-1}` on `App.tsx`'s `.qzk-app`),
    and only then — in a harness that renders neither — to the browser's own
    `<body>`, documented rather than silent. **Round 2's absolute claim
    ("focus lands on the Library's focus-loss container …, never `<body>`") was
    false as written and is corrected here: the landing is the Library
    container when one is rendered, otherwise the shell root.**
  - **Round 2's three unpinned "also closed" claims are pinned** (the no-yank
    guard, the `FOCUSABLE` widening, the `hiddenWithin` ancestor walk), each
    with a DOM case that goes red when the behaviour is reverted — the same
    defect class round 2 existed to close. So are two of its NITs: the trap
    stack now orders by MOUNT order (reopening an OUTER dialog no longer traps
    Tab in the dialog behind the topmost one), and `useGlobalShortcuts`' Escape
    branch has a top-level `defaultPrevented` check so a key a closer handler
    claimed is not also double-handled here. The fifth hand-rolled `isEditing`
    copy (`LibraryWorkspace`) is gone — that predicate is the dispatcher's now.
  - **e2e gap closed.** `frontend/e2e/specs/workshop-escape-ladder.spec.ts`
    pairs a workshop with Tiles in a real browser, both directions (focus
    inside the panel, and focus on a Library row). That pairing is what the
    56-test suite never had, which is why a real regression shipped green.

  | Sabotage (round 3) | Result | Failing test |
  |---|---|---|
  | S-R1 `LibraryWorkspace` back to its own unconditional-`preventDefault` document listener | **RED** 1 | "Escape closes the WORKSHOP and leaves Tiles open; the next Escape closes Tiles" |
  | S-R2 `QuickFigureBuilderWorkspace` back to its own unconditional-`preventDefault` window listener | **RED** 1 | "Escape closes the WORKSHOP and leaves the builder open; the next Escape closes the builder" |
  | S17a registry stops ignoring an auto-repeating Escape | **RED** 1 | "a HELD Escape runs the walk once, not once per repeat" |
  | S17b registry stops clearing the pending walk before arming a new one | **RED** 1 | "two Escapes inside one tick arm ONE walk, not two" |
  | S17c `ToolWindow` drops the `closed` one-close-per-window guard | **RED** 1 | "a second Escape on a panel that is already closing does not close it again" |
  | S-F4 `focusSafeLanding` loses the app-root fallback | **RED** 1 | "lands on the app root when the Library renders no focus-loss container" |
  | S18 restore yanks focus back unconditionally | **RED** 1 | "does NOT yank focus the user has already moved elsewhere (S18)" |
  | S19 `FOCUSABLE` reverted to the five classic form controls | **RED** 1 | "traps a contenteditable field, not just the classic form controls (S19)" |
  | S20 `hiddenWithin` reverted to the element-only check | **RED** 1 | "skips a focusable inside an aria-hidden wrapper, not only a hidden element (S20)" |
  | S-N6 trap stack back to push order | **RED** 1 | "orders traps by OPEN order, so reopening an outer one does not steal Tab (NIT 6)" |
  | S-N9 `useGlobalShortcuts`' Escape branch drops its `defaultPrevented` check | **RED** 1 | "leaves a live gesture alone when a closer handler already claimed the Escape" |

  Each sabotage applied alone against a 324-test scope (`lib/escapeStack`,
  `components/overlays`, `LibraryWorkspace`, `quickfigurebuilder`,
  `useGlobalShortcuts`), green at baseline, and restored after.

  Eager bundle: parent `5e651e48` **888,455 B** → tip **889,632 B**,
  **+1,177 B** (budget 920,400 B, so **30,768 B** of headroom left). Both
  built after `rm -rf node_modules/.vite`, the parent in its own worktree
  after `npm ci`.

  **Named residuals added in round 3.**
  - **R7** (round 3, review NIT 7) — the multi-Escape ladder is real and is now
    deliberate: an Escape dismisses ONE thing, innermost first. Measured with
    the real hook and a real `ToolWindow`:
    · workshop open + `plotTool: "region"` → Esc① closes the window, tool stays
      `region`; Esc② reverts it to `pointer`.
    · a panel hook claiming Escape (the `usePeakWizard` shape) + a tool armed →
      Esc① pauses the marker edit (window open, tool `region`); Esc② closes the
      window (tool still `region`); Esc③ reverts the tool.
    · Tiles open + `plotTool: "zoom"` → Esc① closes Tiles, tool stays `zoom`;
      Esc② reverts it.
    · **(added round 6)** a LIVE drag + the Peak Analyzer at step ② → Esc①
      cancels the drag ONLY (marker edit still live, tool still armed); Esc②
      pauses the marker edit (tool still armed, because the wizard's
      `preventDefault()` stops the walk); Esc③ then falls to the surfaces
      below — the hosting `ToolWindow` if focus is inside its frame, otherwise
      the `app` tier's tool revert. The first two keystrokes are measured with
      the real hooks in `usePeakWizard.test.ts`; on round 5's tree Esc① did
      both of those actions at once (review finding 1).
    Round 2's order was the inverse for the workshop case (the tool reverted
    first and the panel stayed), which is the inconsistency this fixes; the
    workspace case already behaved this way and still does.
  - **R9** (round 3, found while writing the e2e spec) — `App.tsx` renders
    `LibraryWorkspace` and `QuickFigureBuilderWorkspace` LAZILY behind a
    `Suspense` fallback that carries the same `aria-label`, and that
    placeholder registers no Escape handler. For the few hundred ms before the
    chunk arrives, Escape does nothing. Pre-existing (the listener always lived
    in the real component) and invisible to a user who did not press Escape
    within that window; recorded because it cost an afternoon to diagnose in
    the spec, which now waits for a real tile rather than the label.
  - **R8** (round 3, review NIT 10) — `hiddenWithin` moves the WRAP boundary
    only. A focusable inside an `aria-hidden` wrapper is still reached by an
    ordinary Tab BETWEEN the first and last stops, because the trap intervenes
    at the two ends and nowhere else. Delivering the attribute's full meaning
    needs `inert`, which is a separate decision from this pass.

  **Round 4 (2026-09-18) — every Escape consumer is in the ladder, and a
  declined close keeps the key.** Rounds 2 and 3 each shipped a fix that
  inverted Escape somewhere else, because each was verified only where it was
  aimed. Round 3's review found two NEW user-visible inversions of the same
  class the registry exists to kill, plus an unpinned guard and seven nits.
  This round closes all of them and states the invariant so it is true as
  written.

  **The corrected invariant.** *The innermost open surface claims Escape, ONE
  Escape performs ONE action, and the next Escape goes to the surface below.*
  Round 3's wording ("the innermost open surface claims Escape") was false on
  two counts: two of `useGlobalShortcuts`' three tiers still claimed inline
  ahead of every registered surface, and four Stage listeners fired
  ALONGSIDE whatever claimed the key. The invariant now has exactly two
  documented exceptions, both named in `lib/escapeStack.ts`'s header and both
  conditional on their own surface being present (so neither can swallow an
  Escape nothing wanted): `SymbolPalette`, a popover opened FROM a text field,
  which must keep Escape in the one state the dispatcher deliberately gives to
  the field (`isEditingTarget`); and `usePeakWizard`'s marker-edit pause, a
  window-bubble claim from inside its own `ToolWindow`.

  **The ladder as it now stands**, top (innermost) to bottom. The first four
  layers are new or newly populated this round.

  | Layer | Consumer | Why it sits there |
  |---|---|---|
  | `menu` | `MenuBar`, `AppearanceMenu` | GUI_INTERACTION #9: an open menu OWNS Escape. Both used to close on a plain document-keydown with no `preventDefault`, so the registry walked too and a surface below acted on the same keystroke (measured: menu closed AND the armed tool reverted). **Not unconditional — CORRECTED in round 6 (review finding 3): with the Peak Analyzer at step ②, `usePeakWizard`'s window-bubble `preventDefault()` lands during the dispatch, the walk's re-read then returns, and the open menu does NOT close. Measured at round 5's tip and unchanged by round 6: menu registered + wizard at step ② → the menu stays open and the wizard pauses instead. That is residual R11's class (the wizard claims without checking that focus is inside its own window), and closing it is R11's fix, not a table edit.** |
  | `gesture` | `useGlobalShortcuts` → `cancelActiveGesture()` | A drag happening RIGHT NOW is genuinely innermost — the user's hand is on it — so it outranks even the window focus is in. Declines (returns false) when nothing is mid-drag. Resolved synchronously at keydown since round 5, and since round 6 a claim here also `preventDefault()`s, so a late window-bubble consumer cannot act on the same key. |
  | `window` | `ToolWindow` (every workshop host, incl. `OriginSavedPreviewWindow`) | A floating panel is in front of the workspace behind it. Declines when focus is not inside its own frame. **("all 48 hosts" as written in round 4 was not reproducible — CORRECTED in round 6, review finding 5. Measured at round 6's tip: **40** production `.tsx` files render `<ToolWindow` across **41** render sites, and **44** import it; counting test files too gives 45 files / 78 sites / 50 importers. The substance — one registry entry per `ToolWindow` mount, so every host gets it — is unchanged; only the decorative count was wrong.)** |
  | `workspace` | `LibraryWorkspace` (Tiles), `QuickFigureBuilderWorkspace` | Full-Stage workspaces; mutually exclusive in `App.tsx`, so two can never co-exist. |
  | `selection` | the four Stage deselects (`useShapeEdit`, `useAnnotationEdit`, `useShapeDraw`, `worksheet/useWorksheetView`) + the idle-armed quick-fit gadget | A live selection or an idle-armed gadget is BELOW any open surface (finding 3: a committed ROI sitting behind a focused window is not innermost) and ABOVE the tool revert (clearing a selection is a smaller undo than disarming the tool that made it). Each registers only while it has something to clear, so the most recently armed one claims first. |
  | `app` | `useGlobalShortcuts` → revert the armed plot tool to Pointer | The whole-app fallback: it only ever sees an Escape every surface declined. |

  Never reached, because they stop propagation upstream: `ConfirmDialog` and
  the eight backdrop dialogs (window capture), `ContextMenu` (document bubble,
  plus the dispatcher's `.qzk-ctx` belt-and-braces), `CommandPalette` (React
  synthetic, plus the dispatcher's `cmdkOpen` early-out). Guarded away by the
  dispatcher's one `isEditingTarget` check: every rename / cell-edit /
  label-edit `onKeyDown`. Deliberately NOT surfaces: `TooltipLayer` (dismissing
  a passive hint alongside another action is correct) and `LibraryTree`'s
  Escape-blur (a focus move, not a dismissal — and the e2e ladder spec depends
  on an Escape from a Library row still reaching Tiles).

  **What changed.**
  - **Finding 1 — a declined close no longer kills the key** (`ToolWindow.tsx`).
    The per-mount `closed` ref was set before `onClose()` ran and never reset.
    Two shipped panels legitimately do not unmount on close
    (`usePageLifecycle.requestClose` on a declined "Close without saving?",
    `PackProjectPanel` while packing/cancelling), and for those the latch stuck
    on: every later Escape was dead AND, because the guard DECLINED rather than
    doing nothing, the walk fell through and the workspace behind the focused
    panel closed instead. The window now claims whenever it is the innermost
    surface and invoked `onClose` — claiming is not conditional on unmounting.
    One-keystroke-one-close stays entirely in the registry, where it belongs
    (`event.repeat` + the pending-walk clear); a later, separate keypress is a
    second intent and brings the confirm back.
  - **Findings 2+3 — the two tiers left inline moved in**
    (`useGlobalShortcuts.ts`). Round 3 re-homed only the tool-revert. Measured
    on that tree: with Tiles open over a committed `qfitRoi`, Escape destroyed
    the ROI and left Tiles open (the parent closed Tiles and kept the ROI); and
    with a focused workshop over an idle committed ROI, the ROI was cleared
    while the window stayed open. Escape is now handled in NO raw listener in
    that file — the gesture cancel is a `gesture` surface, the idle gadget a
    `selection` surface, the tool revert the `app` surface.
  - **The deleted `stopPropagation`'s promise, restored.** `LibraryWorkspace`'s
    removed shield was commented "This workspace owns the keystroke"; the four
    Stage deselect listeners (none of which `preventDefault`) had been firing
    alongside the workspace close ever since — two actions, one key. All four
    are `selection` surfaces now.
  - **Finding 4 — the mid-walk staleness skip is pinned.**
    `escapeStack.ts`'s `if (!stack.includes(entry)) continue;` was deletable
    with the whole suite still green.
  - **NIT 5** — a handler that throws no longer eats the key for every surface
    below it: the walk catches, logs and continues (it is treated as a
    decline). Previously the exception escaped the `setTimeout` outside any
    React error boundary and recurred on every Escape.
  - **NIT 6** — the Quick Figure Builder's new editing guard is disclosed here,
    not only in a code comment: Escape in one of that builder's own fields now
    belongs to the field, so pressing it on its one `<select>` (dropdown
    closed) no longer dismisses the builder.
  - **NIT 7 — the menus own Escape.** `MenuBar` and `AppearanceMenu` are
    `menu`-layer surfaces. `SymbolPalette` could not join (see the exceptions
    above) and instead claims explicitly with `preventDefault()`, which the
    walk's re-read honours — so it too is now one Escape, one action.
  - **NIT 8 — `OriginSavedPreviewWindow` joined the registry.** Its bespoke
    window-CAPTURE listener with `stopPropagation()` and no focus / editing /
    palette / menu guard swallowed every Escape in the app while the preview
    was open — including one aimed at a text field — and its own `ToolWindow`
    entry never ran. Deleted; the host's `window`-layer entry does the same
    close, correctly scoped to focus inside the frame.
  - **NIT 10 — one `defaultPrevented` gate, not two.** The synchronous copy in
    `onKeyDown` could only ever fire for a document-bubble claimant, which the
    deferred re-read catches too (along with every claim that lands after the
    keydown, which the synchronous copy could not see). Removed, and the
    re-read is pinned by a document-bubble case of its own.
  - **NIT 11** — `useFocusTrap`'s lazy per-instance id is `useState(() =>
    nextTrapSeq++)` instead of a render-phase module mutation.

  | Sabotage (round 4) | Result | Failing test(s) |
  |---|---|---|
  | R4-1 `ToolWindow` gets its per-mount `closed` latch back | **RED** 1 | "claims Escape every time, and the workspace behind it never sees the key" |
  | R4-2 the idle-gadget tier claims inline again (round 3 shape) | **RED** 2 | "closes Tiles and PRESERVES a committed quick-fit ROI (finding 2)", "the focused window closes first; the committed ROI survives until the next Escape" |
  | R4-3 `useShapeEdit` back to a bare window-keydown deselect | **RED** 1 | "one Escape performs ONE action: the Stage deselect does not fire with it" |
  | R4-4 the `gesture` layer drops to rank 0 | **RED** 2 | "cancels a registered gesture instead of reverting the tool", "ranks menu ▸ gesture ▸ window ▸ workspace ▸ selection ▸ app" |
  | R4-5 `walk` drops the mid-walk staleness skip (finding 4) | **RED** 1 | "does not call a handler that unregistered during this same walk" |
  | R4-6 the walk stops catching a throwing handler (NIT 5) | **RED** 1 | "logs it, and the surface below still gets its turn" |
  | R4-7 `MenuBar` stops registering (NIT 7) | **RED** 1 | "closes the open menu and claims the key, so nothing below also acts" |
  | R4-8 `OriginSavedPreviewWindow` keeps its capture-phase swallow (NIT 8) | **RED** 1 | "does not swallow an Escape aimed at a text field" |
  | R4-9 `walk` stops re-reading `defaultPrevented` (NIT 10) | **RED** 5 | incl. "a DOCUMENT-bubble consumer that preventDefaults still stops the walk", "a panel hook that claims Escape keeps it — the window does NOT close" |
  | R4-10 every focus trap gets the same seq (NIT 11's ordering) | **RED** 1 | "only the TOP trap acts, and closing it hands control back to the outer one" |

  Each applied alone against a 12-file / **253-test** scope (`escapeStack`,
  `ToolWindow`, `LibraryWorkspace`, `useGlobalShortcuts`, `MenuBar`,
  `AppearanceMenu`, the three Stage deselect hooks, `Worksheet`,
  `FiguresSection`, `dialogFocus.a11y`), green at baseline, and restored after.

  Eager bundle: parent `eb696722` **889,632 B** → tip **889,141 B**,
  **−491 B** (the deleted listeners outweigh the new registrations; budget
  920,400 B, so **31,259 B** of headroom). Both built after
  `rm -rf node_modules/.vite`, the parent in its own worktree after `npm ci`.

  **Named residuals added in round 4.**
  - **R10** — `components/windows/PlotWindowFrame.tsx` (multi-plot document
    windows) still has no Escape dismissal and no registry entry, so Escape
    with focus inside one falls through to the `workspace`/`selection`/`app`
    layers. Deliberately left as a hole rather than filled: a plot window is a
    DURABLE container with saved layout, not a transient workshop panel, and
    giving it Escape-to-close is a product decision for the owner, not an a11y
    fix. Recorded so the ladder has no silent gaps.
  - **R11** — `usePeakWizard`'s marker-edit pause claims Escape with
    `preventDefault()` without checking that focus is inside its own window, so
    at step ② it can pause the edit from a keystroke aimed elsewhere. Narrow
    (step ② only, and only while there is something to pause) and pre-existing;
    it is one of the two documented exceptions above, and closing it needs the
    hook to reach its host frame's ref.

    **Widened in the recording, not in the code (round 9).** The stray-keystroke
    half above is only one side of it: because the pause is a window-BUBBLE
    `preventDefault()` claimant that does not check focus, it also OUT-RANKS
    surfaces that should beat it. The `menu` row of the layer table above
    already records it beating an open menu. Round 9 measured it beating a
    `modal` too, while that layer was still deferred — Preferences stayed open
    and the pause fired instead — and fixed the MODAL side by resolving that
    layer at keydown. The menu side is unchanged and still R11's to close: a
    `menu` is resolved in the deferred walk, so the pause still wins there.

  - **R12** (round 8, review NIT 4) — **two `aria-modal="true"` dialogs can be
    mounted at once, and each one hides the app's live regions.** Follows
    directly from BUG-018: with Preferences and Shortcuts both open, both
    carry `aria-modal="true"`, and AT behaviour with two concurrent modals is
    undefined. Separately and more reachably, `aria-modal` on any one of these
    ten hides everything outside that dialog from assistive tech for as long
    as it is open — including the two `aria-live` regions the app raises
    announcements through, `components/overlays/Toaster.tsx` and the status
    bar (`StatusBar.tsx`). A toast raised while a dialog is open is therefore
    silently not announced. Pre-existing for `ConfirmDialog`; extended to six
    more dialogs by round 7 (Preferences and Help had `role` but not
    `aria-modal`). Closing it properly means `inert` on the background plus
    hoisting the live regions out of the inert subtree, which is a design
    decision of its own, not a markup tweak. Not fixed here; recorded.

    **CLOSED (round 10, 2026-09-25, `46ed0750` on `c1d92758`).** This is a
    re-application of the unmerged `7f0d0a25` (written 2026-09-19 on
    `281ee552`). The tree had moved since then: slice 8 made the
    Confirm/Param bodies lazy, BUG-018 added the `modal` Escape tier, and
    UX-003 added the seam boundaries. The re-application also resolves the
    three hypotheses that commit's review never checked.

    *The decision.* `aria-modal` is dropped from **every dialog: 16
    `role="dialog"` elements in 15 components.** These are
    AnnotationText, CombineWorkbooks, ConfirmDialogBody, Help,
    ParamDialogBody, PlotRecipeApply, Preferences, QuickPlotWith (two
    branches), RecoveryChoice, ReimportAll, SeparateWorksheets, Shortcuts,
    SplitDataset, TextFormatHelp and `Library/WorkbookPropertiesDialog`. No
    placement of `aria-modal` can leave a live region announceable, because
    it tells AT to ignore everything outside the dialog. Modality now
    comes from `lib/modalInert.ts`: the background is made `inert` PER
    ELEMENT, walking from the active dialog's root up to `<body>` and
    marking every sibling off that path. Elements marked `data-live-region`
    are exempt, and so is anything that contains one, which is descended
    into instead. Three elements carry the marker: the Toaster, the status
    bar's "Background operations" region, and the status bar's
    autosave-failure `role="alert"`, which is new since `7f0d0a25`.
    `architecture.test.ts` fails the build if `aria-modal` returns, in
    either the JSX spelling or the `"aria-modal"` string-key spelling.

    *(a) Engine support.* Measured: the SPA's build target is Vite 8's
    default, Chrome/Edge 111, Firefox 114 and Safari 16.4. Every one of
    those is at or past the version that shipped `inert` (102, 112 and 15.5
    respectively). The pywebview desktop embeds meet the same bar: WebView2
    is evergreen Chromium on Windows, and WKWebView uses the system WebKit
    (Safari 15.5+). Headless Chromium 141 here reports
    `"inert" in HTMLElement.prototype` as true. One documented target falls
    short: the PyQt5/PySide2 backend that `server_launch.py`'s
    `_WEBVIEW_HINT` suggests on Linux is QtWebEngine 5.15, i.e. Chromium 87,
    which has no `inert`. It also lacks `structuredClone`, which store code
    already calls, so that backend was already broken in practice. The
    fallback is therefore cheap and honest: when the property is missing,
    the same elements get `aria-hidden="true"`. That is still per element,
    so the live regions stay exposed; Tab stays trapped and the backdrop
    still blocks the pointer. A test covers it, and there jsdom CAN see the
    effect, because its role queries honour `aria-hidden`. **Not measured
    here: Firefox, Safari, WebView2, WKWebView and WebKitGTK.** This
    container has Chromium only, so those rest on published support
    versions.

    *Cross-browser coverage runs in CI (2026-09-25). Status: MEASURED --
    first run on PR #414 (head 1fa096df) went 16/16 green on both Firefox
    and WebKit, merged in 22dfcd57.* The
    new `e2e-xbrowser` job in `.github/workflows/e2e.yml` runs Firefox and
    WebKit, one matrix leg each, over the engine-sensitive specs:
    `modal-inert` (all 7 R12/R16 cases), `workshop-escape-ladder`,
    `region-tool-escape`, `quick-figure-builder`, `library-tiles`,
    `details-keyboard` and `keyboard-only`. That is 16 tests per engine; the
    same 16 take 57 s in local Chromium under CI settings. What it will and
    will not settle:
    - Firefox and WebKit: focus refusal, the Tab trap, pointer blocking,
      inert placement, paint order and the Escape ladder, all measured by
      the real engine.
    - The accessibility-tree assertions stay Chromium-only. They read the
      tree over CDP, which the other engines lack, so they are skipped
      there with an `ax-tree-unmeasured` annotation, not approximated.
    - The WebKit leg is Playwright's Linux WebKit build, not macOS
      WKWebView. It is the closest engine CI can run, not the shipped
      embed. WebView2 is Chromium, so the existing `e2e` job covers its
      engine but not the embed itself.
    - The `aria-hidden` fallback is still exercised only by the unit test,
      because every engine in CI has `inert`.
    - Recorded run: PR #414, `e2e cross-browser (firefox)` and
      `(webkit)`, 16 passed each.

    *(b) The DOM-mutation gap, closed.* `7f0d0a25` walked only when the
    modal stack changed, so a node that mounted while a dialog was open
    stayed live. A MutationObserver (childList, subtree) is now attached
    only while a dialog is open. It re-walks for a node added outside every
    marked subtree (a child of a path node, or of a descended container),
    and for a live region added under a marked ancestor, which needs the
    descent. A node inside a marked subtree is covered by inheritance: a
    test adding 50 such nodes records zero `inert` writes. The costs were
    measured in Chromium as the median of 15 runs, each appending 2,000
    nodes in one task:
    - with no dialog open: 1.0 ms;
    - under an inert ancestor: 3.1 ms, about 1 µs per added node;
    - inside the dialog: 2.0 ms;
    - one full re-walk with 7 marked elements: ~0.1 ms, which is the timer
      resolution.

    Registration moved into a LAYOUT effect, so a dialog mounting over
    another registers before the observer sees its insertion. The slice-8
    case is pinned directly. A lazy confirm body resolves over Preferences
    after the ask; a test records every `inert` write during that and finds
    none on the body's subtree. Moving the registration back to a passive
    effect reddens that test. Four more cases are pinned:
    - A dialog that re-renders into a different root element
      (QuickPlotWith's "source removed" branch) stays modal, because the
      registry reads the ref live.
    - A background window or `<body>` portal that mounts while a dialog is
      open goes inert. In the browser, pressing `f` in Preferences mounts
      the curve-fit window inert, and its focus-on-mount is refused.
    - The autosave alert and a toast raised meanwhile stay live.
    - A symbol palette that the dialog itself opens is portaled to
      `<body>`. It is marked `data-modal-layer` and belongs to that dialog,
      even when it arrives in the same mutation batch as a background node.

    *(c) Release on abnormal unmount.* Each of the following ends with no
    `[inert]` in the document and an empty registry:
    - an error boundary catching a render throw inside the open dialog;
    - an error boundary catching an effect throw after registration;
    - an uncaught throw that unmounts the whole React root;
    - StrictMode's double mount, which also registers exactly once;
    - UX-003's lazy-confirm load failure, stacked over Preferences.
      Preferences stays the one active modal, the failure toast is exempt,
      and focus is untouched.

    *Ordering, found and fixed on the way.* `7f0d0a25` ordered dialogs by
    the trap's per-instance MOUNT `seq`, and that rule proved wrong once
    losing meant going inert. Measured in Chromium: Preferences stays
    mounted after its first close. Ctrl+, then reopened it over Help, and
    it was painted on top but ranked below, so the dialog the user saw was
    inert and dead to the pointer. `46ed0750` answered with document
    order; the review follow-up replaced that with **open order for
    everything**: see R16 below, which records why and what was measured.
    The Tab trap asks `isTopModal` for the same answer as the inert walk,
    so `trapStack` and `seq` are gone. A second case was measured the same
    way. With
    Preferences ▸ "Confirm before removing" on, Delete inside Preferences
    asked "Remove 1 dataset?" UNDERNEATH Preferences, completely covered.
    That was already so on `main`, because ParamDialog and ConfirmDialog
    mounted first in `AppOverlays`, and it becomes fatal once the covering
    dialog is inert. Both now render last among the dialogs.

    *Focus.* The eager restore of `WorkbookPropertiesDialog` runs inside
    its close handler, while the background is still inert, and `focus()`
    is refused there. It now releases the modal first; a test checks that
    the opener has no inert ancestor at the moment it is focused.
    `ConfirmDialogBody` captures its opener at render time
    (`useOpenerCapture`). Measured: Chromium 141 does NOT blur a focused
    element whose ancestor becomes inert. The render-time capture still
    holds regardless, because HTML's focus-fixup rule permits the blur.

    *Stacked and lazy.* While the confirm chunk is still in flight over
    Preferences, the pending guard is active and nothing new is modal:
    Preferences keeps the walk and the focus, and Escape cancels the ask.
    Once the body mounts it is the one active modal and Preferences is
    inert. Cancel then gives Preferences back its interactivity and its
    focus, landing on the control inside it that opened the ask.

    *Measured.* Unit tests: `overlays/modalInert.test.tsx` (13),
    `modalInertMutations.test.tsx` (10), `modalInertOrder.test.tsx` (2),
    `modalInertRelease.test.tsx` (6), plus one case in
    `WorkbookPropertiesDialog.test.tsx`. `src/test/setup.ts` reflects the
    `inert` property jsdom lacks, and adds nothing else. Browser:
    `e2e/specs/modal-inert.spec.ts` (5), which reads Chromium's own AX tree
    over CDP, because Playwright's ARIA snapshot is inert-blind. It checks
    the following:
    - focus to the Library is refused;
    - 40 Tabs stay inside the dialog;
    - a real click that lands on the Library's "Tiles" button does nothing;
    - the button is absent from the AX tree;
    - a toast raised by Delete inside Preferences is visible, not inert,
      and present in the AX tree;
    - Preferences over Help and the confirm over Preferences behave as
      described above;
    - nothing is `[inert]` after everything closes.

    A manual check against `uv run qz --no-browser` repeated all of this
    and found every result as expected. Sabotage: nine unit sabotages and
    two browser sabotages each reddened only their intended cases:
    - passive-effect registration;
    - no observer;
    - no release before the eager restore;
    - no cleanup release;
    - no Toaster marker;
    - no layer claim;
    - no fallback;
    - open-order ranking;
    - skipping the rest of a batch;
    - no `inert` at all (browser);
    - the old promise-dialog mount order (browser).

    **Bundle:** eager bytes went from 867,284 B to **867,350 B (+66 B)**
    against the unmoved 868,308 B pin. The measurement ran after `npm ci`
    with `node_modules/.vite` removed, and was reproduced. The eager cost
    is the literal markers only: `modalInert.ts` ships in
    `useDialogFocus`'s lazy chunk, and the eager components spell
    `data-live-region` as a literal so that they never import it (a test
    pins the spelling).

    *Review follow-up (the second commit on this branch).* Three nits were
    fixed as well as R16.
    - The `aria-hidden` fallback hid the background from AT only. A
      window's focus-on-mount or any `.focus()` could still land there. A
      `focusin` guard, active in fallback mode only, now sends focus back
      into the active dialog. It is tested with `inert` removed from the
      prototype, and removing the guard reddens exactly that test.
    - `lazyRegion`'s load-failure alert is not inside any dialog, so it
      could not become the active one. When a dialog fails to load while
      another is open, the failed dialog never mounts and never registers;
      its boundary's alert lands in the background and was going inert
      whole. Its message `<span>` now carries `data-live-region`, so the
      message is announced while the Retry beside it stays inert until the
      open dialog closes. A test pins both halves, and removing the marker
      reddens it.
    - The `WhatIsThis` badge (`role="status"`, portaled to `<body>`) is
      deliberately NOT exempt. It can only appear by toggling the mode from
      a command, which is unreachable while a dialog makes the background
      inert. Its text is fixed, and was announced when the mode began, so
      a dialog opened during the mode costs no announcement. Exempting it
      would only leave its Done button live over the modal, and Escape still
      ends the mode through its own window listener.
    - The optional diff-based `sync()` was NOT done. A full re-walk costs
      ~0.1 ms, and the zero-`inert`-writes proof that covered additions
      skip the re-walk depends on a re-walk rewriting every mark.
    - Follow-up gates, after `npm ci`: `tsc -b --force` 0 and lint 0.
      vitest ran 726 files, 12,159 passed. The build passed. e2e (CI
      settings) had 69 passed, 1 skipped (already skipped before), 0
      retries; `modal-inert.spec.ts` now has 7 cases.
      `test_repo_integrity` had 13 passed. The manual checks against
      `uv run qz` were repeated, including both `?` pairs and a
      forced-fallback page. Eager bytes are **867,372 B** against the
      unmoved 868,308 pin, measured twice with `.vite` removed: +22 B for
      the `lazyRegion` marker. The stamp and the guard ship in the lazy
      chunk.

    **Left open:**
    - Residual R15 below (closed in round 11).
    - The engines not measured, listed under (a). Firefox and (Linux)
      WebKit now run in CI through `e2e-xbrowser`, first green on #414
      (recorded under (a)); the shipped WKWebView and WebView2 embeds
      themselves are still unmeasured.
    - Live regions INSIDE background panels, such as a workshop's
      `role="alert"`, are not exempt. They sit in an inert window beside
      interactive controls, so an alert raised there while a dialog is open
      is not announced until the dialog closes.
    - Tooltips (`TooltipLayer`, portaled to `<body>`) for a dialog's own
      controls mount inert. Nothing is lost today, because they are visual
      only and not `aria-describedby`-linked. Linking them would need
      `data-modal-layer`.
    - During a lazy body's chunk fetch, nothing new is inert. The pending
      guard owns the keys, and pointer behaviour for that window, one
      localhost fetch, is unchanged from before.

  - **R13** (round 8, review NIT 5) — **three of round 7's eight new Escape
    cases discriminate only on focus-in/restore, not on Escape
    reachability.** Each "Escape … gives focus back to the opener" case
    drives `user.keyboard("{Escape}")`, which is right, but because the
    handler is a window-CAPTURE listener the dialog closes whether or not
    focus ever moved in. What actually distinguishes the fixed tree in those
    cases is `expect(opener).not.toHaveFocus()` right after open and
    `expect(opener).toHaveFocus()` after close — both genuinely pinned, so
    the cases are sound; the case NAMES just promise more than they check.
    Escape reachability itself is pinned only by the pre-existing
    `fireEvent.keyDown(window, …)` tests, which exist in five of the eight
    files (`ShortcutsDialog`, `TextFormatHelp`, `PreferencesDialog`,
    `HelpDialog`, `SplitDatasetDialog`) and **not** in `SeparateWorksheets`,
    `CombineWorkbooks` or `ReimportAll`. Recorded rather than renamed: the
    three missing reachability pins are worth adding with BUG-018's fix,
    when the mechanism they would pin is the one that will actually ship.

    **CLOSED (round 9).** The three pins were added with BUG-018's fix, against
    the mechanism that shipped — `SeparateWorksheetsDialog.test.tsx`,
    `CombineWorkbooksDialog.test.tsx` and `ReimportAllDialog.test.tsx` each
    gained a `fireEvent.keyDown(window, …)` case beside their focus-in/restore
    one, and ReimportAll's asserts `cancelReimportAll()`'s effect rather than a
    raw close (G1). Sabotaging the registration reddens both cases in that
    file, so reachability is now discriminated separately from focus. The case
    NAMES this residual complained about are unchanged; what they promised is
    covered by the new cases beside them.

    Side effect worth recording rather than leaving to be rediscovered: the
    registry's walk is deferred one macrotask, so five pre-existing
    `fireEvent`-then-read-state Escape tests (Help, Preferences, Shortcuts,
    Split, TextFormatHelp) now wait on the STATE the close produces. They are
    state waits, not mock-call waits, so `architecture.test.ts`'s weak-wait
    ratchet is unmoved.

  - **R14** (round 9 re-review) — **an Escape pressed while an IME composition
    is in flight now closes the dialog AND suppresses the composition's own
    cancel.** `isComposing` is checked NOWHERE in this tree (measured: zero
    hits across `frontend/src`), so this is pre-existing — but the round-9
    delta makes it strictly worse, and that is recorded here rather than left
    in a review thread. Before it, `modal` acted on the deferred walk and
    never called `preventDefault()`, so Escape's default composition-cancel
    survived and the IME behaved normally; the synchronous claim now marks the
    event, so the candidate window is denied its own cancel and the dialog
    closes underneath it. The correct shape is the standard one — bail out of
    the dispatcher on `event.isComposing` (or `keyCode === 229`) so the key
    belongs to the IME, exactly as `isEditingTarget` gives it to a text field
    — and it would have to be applied to the `modal` bypass too, since a
    composition is happening IN an editing target.

    **UNVERIFIED, deliberately.** Neither jsdom nor headless Chromium here can
    drive a real IME, and `KeyboardEvent.isComposing` cannot be forged through
    Playwright's input pipeline, so a fix could be written but not measured —
    and an unmeasured keyboard-dispatch change is what rounds 2–5 each
    regressed on. Booked for someone with a real IME (Japanese/Chinese/Korean
    input on Windows or macOS) rather than guessed at. Scope: any Escape
    pressed mid-composition anywhere in the app; the ten backdrop dialogs are
    where the new `preventDefault()` makes it visible.

  - **R15** (round 10, R12 closure) — **global shortcuts still fire while a
    modal dialog is open.** `useGlobalShortcuts` does not check for an open
    modal, so a key pressed on a focused dialog button still reaches the
    surface behind the dialog. `f`/`y`/`p` open workshop windows, Ctrl+K
    opens the palette, `?` opens Shortcuts and Delete removes the active
    dataset. R12 changed the effect of this, not the cause. A surface opened
    this way now mounts INERT behind the dialog: measured in Chromium, `f`
    mounts the curve-fit window inert, its focus-on-mount is refused, and
    focus stays in the dialog. Before R12 that window took focus from
    behind the backdrop. Delete still acts, because it changes data, not
    DOM. It is the e2e spec's own path to a toast raised during a dialog,
    and with "confirm before removing" on it asks OVER the dialog, which is
    now correct. Whether a modal should suppress global shortcuts outright
    is a product decision. It is recorded here rather than taken silently.

    **CLOSED (round 11, 2026-09-25).** The decision taken: a modal suppresses
    every shortcut that acts on the app BEHIND it, and keeps only the two
    that open another dialog ON TOP of it, which R16 made correct.

    *Inventory.* Every `keydown` listener on `window`/`document`:
    - App shortcuts. `useGlobalShortcuts` handles Delete/Backspace
      (remove), `?` (Shortcuts), Alt+←/→ (view history), `a` (autoscale),
      `f`/`y`/`p` (workshops), ↑/↓ (step dataset), H/Z/D/M/I/W (plot
      tools) and Ctrl/Cmd + K (palette), O (open), V (paste a dataset),
      `[`/`]` (panels), Shift+L (theme), `,` (Preferences) and S (save).
      `useHistoryCommands` handles Ctrl/Cmd+Z and Shift+Z (undo/redo).
      `useWindowCommands` handles Ctrl+Tab/Shift+Tab (window focus) and
      Ctrl/Cmd+Shift+N/D/W (new, duplicate, close window).
      `CalcOnlyApp` handles Ctrl/Cmd+Shift+L (theme).
    - Not app shortcuts, and unchanged. `escapeStack` (Escape, already
      modal-aware), `useDialogFocus` (the Tab trap), `ConfirmDialogBody`
      (its own Enter/Escape), `usePendingDialogGuard` (Enter/Space during
      a lazy load), `WhatIsThis`, `ContextMenu`, `TooltipLayer`,
      `SymbolPalette` and `usePeakWizard` (each owns Escape for its own
      surface).

    *The rule.* It lives in one place, `lib/appShortcuts.ts`. All four app
    handlers now register through `listenForAppShortcuts` instead of
    `window.addEventListener`. While any modal hold exists, the gate
    passes only `?` and Ctrl/Cmd+, to them. It never calls
    `preventDefault()` or stops propagation, so a dialog's own fields and
    handlers are untouched. Typing, Backspace and a text field's native
    Ctrl+Z all keep working. `lib/modalInert.ts` takes a hold for every
    registered dialog, the same set the background `inert` is walked for.
    `usePendingDialogGuard` takes one while a lazy body is still loading
    (slice 8). The module is eager and tiny. `modalInert.ts` stays in its
    lazy chunk.

    *A pre-existing hole closed on the way.* `useHistoryCommands` hands
    Ctrl+Z to the app on a range, checkbox or radio input (Group S finding
    5). So Ctrl+Z on Preferences ▸ Plot's line-width slider undid the last
    edit behind the dialog. It no longer does, and a test pins it.

    *Evidence.* Unit: `overlays/modalShortcuts.test.tsx` (34), which runs
    the three real hooks. Each of 14 background shortcut classes acts with
    no dialog, and does nothing from a Preferences button. It also covers
    the slider's Ctrl+Z, the pending guard, reopening the keys on close,
    `?` over Preferences, Ctrl+, over Help, and editing keys in Help's
    search box, including an unclaimed Ctrl+Z. Four sabotages:
    - gate removed: exactly the 17 cases that expect a blocked key go red;
    - layering allowance removed: the 2 layering cases and both R16
      `modalInertOrder` cases go red;
    - no pending hold: only the pending-guard case goes red;
    - gate claims a blocked key with `preventDefault()` instead of
      skipping it: the text-field case goes red, and so do the three R16
      `modalInertOrder` cases, whose Escape it swallows.

    Browser: `e2e/specs/modal-inert.spec.ts` gained "R15: background
    shortcuts pressed inside Preferences leave the app untouched". It
    presses 18 keys, then runs a positive control with the dialog closed.
    Three cases used a shortcut as their path INTO a dialog. They now
    raise the toast, the confirm and the window from outside a key event:
    `__qz` exposes `requestDatasetRemoval` under `?harness`, and the window
    opens through `setCurveFitOpen`. What they prove about `inert` is
    unchanged. The toast case and the window case also assert, from the
    STORE, that their old key (Delete, `f`) now does nothing. A DOM read
    cannot tell: the first cut checked `.qzk-win` count 0 right after `f`,
    and it stayed green with the gate removed, because the window's body is
    lazy. Browser sabotage (gate removed, SPA rebuilt): exactly those two
    cases and the R15 case go red, on both attempts.

    Manual check against `uv run qz --no-browser` in Chromium: with a
    dataset imported and Preferences opened by Ctrl+,, each of 15 keys
    left the store snapshot unchanged. The keys were Ctrl+Z, Ctrl+Shift+Z,
    Delete, Backspace, z, h, f, p, y, ↓, Ctrl+K, Ctrl+[, Ctrl+Shift+L,
    Ctrl+Shift+N and Ctrl+Tab. The snapshot covered datasets, history,
    tool, workshops, palette, panels, theme, windows and toasts. `?` then
    opened Shortcuts painted on top, with Preferences inert. Escape, then
    Escape again, closed both and left 0 `[inert]`. With no dialog open,
    `z` and Delete acted.

    **Bundle:** eager bytes went from 867,372 B to **867,524 B (+152 B)**
    against the unmoved 868,308 pin. Measured twice after `npm ci` with
    `node_modules/.vite` removed.

    **Gates**, after `npm ci`: `tsc -b --force` 0 and lint 0. vitest ran
    727 files, 12,193 passed and 2 expected-fail. The build passed. e2e (CI
    settings) had 70 passed, 1 skipped (already skipped before), 0
    retries; `modal-inert.spec.ts` now has 8 cases. `test_repo_integrity`
    had 13 passed.

    **Left open.** The command palette is a backdrop surface but not a
    modal dialog. It registers no hold, and it keeps its own
    editing-target guard. Preferences' tabs are `<div>`s with click
    handlers only, so they are not keyboard-reachable. That was found
    while writing the slider test and is not part of R15.

  - **R16** (round 10, R12 closure) — **Escape was ranked by OPEN order;
    Tab and `inert` by PAINT order; paint by TREE order.**
    `lib/escapeStack.ts` allocates `seq` on every enable, so the most
    recently OPENED `modal` surface takes Escape. Equal-z backdrops paint in
    tree order. `46ed0750`'s Tab trap and inert walk followed paint.

    The first write-up called this "reopen only, unmeasured". The
    branch's independent review MEASURED it in real Chromium, on this
    branch and on `main`, and it is worse than that. Pressing `?` in Help
    (focus on a Help tab), or in Preferences, opened Shortcuts. Shortcuts
    sits EARLIER in `AppOverlays`, so it painted UNDERNEATH the dialog it
    was opened from, invisible. Focus and Tab stayed in that dialog, and
    the first Escape closed the hidden Shortcuts, so nothing visible
    changed. This happened on first open as well as on reopen. On `main`,
    first open moved focus into the hidden dialog, and reopen was already
    split. In short: `?` in Help opened nothing the user could see.

    **CLOSED (round 10 follow-up, 2026-09-25).** Open order now equals
    draw order. The active modal is the dialog OPENED LAST (`topmost()`
    walks the registry newest-first), which is what Escape already used.
    Every walk also stamps each open dialog's `.qz-overlay-backdrop` with
    an inline z-index in open order (101, 102, …), so the stylesheet's 100
    is only a floor, the toast stack at 200 stays above, and the newest
    dialog PAINTS on top wherever it sits in the tree. The stamps are
    lifted with the walk. Escape (`escapeStack`), the Tab trap
    (`isTopModal`), the inert walk and the paint now all name one dialog.

    This was preferred over portaling each dialog to the end of `<body>`,
    or remounting it on reopen: it touches no dialog component, React tree
    or event path, and costs nothing eager. A confirm or a parameter prompt
    asked from a dialog is opened last, so it stays on top as before
    (ParamDialog and ConfirmDialog also still render last in the tree). NIT
    6's case changes answer, deliberately. Its reopened outer trap was
    opened last, is now painted on top, and is what Escape closes, so it is
    also the active trap. `dialogFocus.a11y.test.tsx` now pins that
    exactly one trap acts and that it is the one Escape closes.

    Evidence:
    - `modalInertOrder.test.tsx`, which now presses Escape. It covers
      Help → `?` and Preferences → `?` on first open and on reopen through
      the real `useGlobalShortcuts`. In each case Shortcuts is live and
      stamped above the dialog under it although it sits earlier in the
      tree. Focus and Tab are Shortcuts'. The first Escape closes
      Shortcuts and returns focus to the opener in the dialog beneath; the
      second closes that dialog; nothing is left inert and every stamp is
      lifted. A third case covers a Preferences mounted first but opened
      last, with Escape.
    - `modal-inert.spec.ts`, which has two new Chromium cases for the same
      pairs. "Painted on top" is checked by a hit test with every `inert`
      lifted for one synchronous `elementFromPoint`: `inert` removes
      elements from hit testing, so a plain hit test looks straight
      through an inert dialog painted on top. The first cut of this check
      had that flaw and stayed green with the stamp removed. The fixed
      check goes red on exactly the two R16 cases.
    - Sabotages: removing the stamp reddens the three order tests and both
      browser R16 cases. Ranking by OLDEST open reddens those three and
      three `modalInertMutations` cases.

  - **Round 5 2026-09-18 — the ladder is resolved at KEYDOWN, not one
    macrotask later.** Round 4 landed locally and was NOT pushed, because
    `e2e/specs/region-tool-escape.spec.ts` ("Esc mid-drag cancels the gesture
    without committing a result; tool stays armed") went intermittent on it —
    1–2 of the spec's 6 projects failing in each of three consecutive runs,
    always at `aria-pressed` reading `"false"`: the tool was DISARMED as well
    as the gesture cancelled.

    **The measured mechanism** (instrumented build, real Chromium,
    deviceScaleFactor 2.0 — timestamps from one run):

    | t (ms) | what happened |
    |---|---|
    | 1525.5 | mousedown on the plot arms the Integrate drag; `setActiveGestureCancel(fn)` |
    | 1628.9 | **Escape keydown** — the dispatcher sees the stack `gesture, app` and arms the walk with `setTimeout(…, 0)` |
    | 1632.3 | **the queued `mouseup` is delivered FIRST** — Chromium runs a pending input task ahead of a 0 ms timer |
    | 1632.4 | `uplotRegionTools`' own release handler clears the canceller and COMMITS the region (`dpx=430`) |
    | 1657.3 | the walk finally runs, 25 ms late: `gesture` has nothing to cancel and declines → `app` reverts the tool |

    So it is not the stack that went stale — the `gesture` entry never
    unregisters — it is the CLAIM. Round 4 chose the acting surface inside the
    deferred walk, so a surface could lose its claim in the gap and the key
    fell through to a lower layer: one keystroke, a committed result AND a
    disarmed tool, the same class rounds 2–4 kept producing.

    **The fix** (`lib/escapeStack.ts`, ~+80 lines of code and rationale; no
    new surfaces, no layer added, moved or reordered).
    - `onKeyDown` snapshots the ordered stack, and `walk` runs THAT snapshot
      instead of re-reading `stack`. A surface that goes away between the
      keydown and the walk was the innermost one when the key was pressed, so
      the walk now STOPS there rather than handing the keystroke to a lower
      layer. Round 4's mid-walk staleness skip is kept and is now explicitly a
      different moment in time — an entry killed DURING the walk (by a handler
      that already ran) is still skipped, and the walk continues.
    - The `gesture` layer is resolved SYNCHRONOUSLY, inside the keydown
      listener (`RESOLVES_AT_KEYDOWN`). This layer cannot be deferred at all:
      cancelling a drag means removing the listeners that would commit it, so
      it has to happen before the browser can deliver the release. Acting there
      costs nothing, because a claim that arrived BEFORE the dispatcher
      (window-capture / document-bubble — how `SymbolPalette` claims) is
      already visible in `defaultPrevented` and still wins, and nothing below
      `gesture` may outrank it anyway. The synchronous scan stops at the first
      surface of another layer, so an open `menu` still owns Escape and still
      goes through the walk exactly as before.

    **Evidence.** A forced-race Playwright probe dispatching the Escape
    keydown and the drag's `mouseup` in the SAME task (the worst ordering the
    scheduler can produce, every time) against two builds of the identical
    tree: parent `6fd193f9` → `aria-pressed=false, chips=1`; with the fix →
    `aria-pressed=true, chips=0`. Then `region-tool-escape` **passed 10
    consecutive runs** (6 tests each, 11.3–11.9 s), against 3 of 3 runs
    failing before it.

    | Sabotage (round 5) | Result | Failing test(s) |
    |---|---|---|
    | R5-1 the walk falls through a surface that died in the gap | **RED** 1 | "STOPS when the surface that owned the key at keydown is gone by the walk" |
    | R5-2 the `gesture` layer is resolved in the deferred walk again | **RED** 2 | "gives the gesture layer the key SYNCHRONOUSLY, before the walk is armed", "a gesture that ends between keydown and the walk cannot disarm the tool" |
    | R5-3 the synchronous path ignores `defaultPrevented` | **RED** 2 | "a claim that landed BEFORE the dispatcher still beats the gesture layer", "leaves a live gesture alone when a closer handler already claimed the Escape" |
    | R5-4 the synchronous scan walks past surfaces of other layers | **RED** 6 | incl. "an open menu still outranks a live gesture, and the walk still decides", "a bubble consumer that claims the key with preventDefault keeps it" |
    | R5-5 the walk re-reads the live stack instead of the snapshot | **RED** 1 | "STOPS when the surface that owned the key at keydown is gone by the walk" |

    Each applied alone against `escapeStack.test.ts` + `useGlobalShortcuts.test.ts`
    (**40 tests**, green at baseline) and restored after.

    Eager bundle: parent `6fd193f9` **889,141 B** → tip **889,423 B**,
    **+282 B** (budget 920,400 B, **30,977 B** of headroom). Both built after
    `rm -rf node_modules/.vite` on the same `npm ci` tree.

    **Lesson.** A deferred dispatch must resolve its TARGET synchronously and
    defer only the action — and any surface whose claim is destroyed by
    waiting (a live drag) has to act synchronously too. Deciding later who
    should have acted is how one keystroke becomes two actions.

  - **Round 6 2026-09-18 — a synchronous claim consumes the KEY, and only an
    offered surface can swallow it.** Round 5's review found that the new
    synchronous `gesture` claim reproduced the rounds 2–4 defect class one more
    time, plus a swallow-direction regression and three false records. Two
    one-rule code changes, both in `lib/escapeStack.ts`; no surface, layer or
    order changed.

    - **Finding 1 — the synchronous claim now `preventDefault()`s.** The
      dispatcher returned from a synchronous claim without marking the event,
      so the keystroke carried on down the propagation path un-claimed. The
      dispatcher's own listener is attached FIRST and stays for the life of the
      app (`useGlobalShortcuts` registers `gesture` and `app` unconditionally),
      so every later window-bubble consumer runs after it; there is exactly one
      in the tree, `usePeakWizard`'s marker-edit pause. **Measured with the
      real hooks** (`useGlobalShortcuts` mounted first, then `usePeakWizard` at
      step ②, a live gesture registered through `setActiveGestureCancel`), ONE
      Escape:

      | tree | drag cancelled | marker edit paused | actions on one key |
      |---|---|---|---|
      | round 5 `a67b3222` | yes | **yes** | **2** |
      | round 6 (tip) | yes | no | **1** |

      At registry level the same A/B is `["gesture","late-bubble-claimant"]` →
      `["gesture"]`, and `event.defaultPrevented` after a synchronous claim goes
      `false` → `true`.
    - **The round-5 commit body's corner-case note is CORRECTED here.** It said
      *"Escape now cancels the drag where it previously paused the wizard's
      marker edit … the second Escape pauses the marker edit as before."* On the
      round-5 tree that was false: the FIRST Escape already did both, so nothing
      was left for the second. Round 6 makes the sentence true — Esc① cancels
      the drag only, Esc② pauses the marker edit (and, because the wizard's
      claim stops the walk, still does not revert the tool). Both keystrokes are
      pinned in `usePeakWizard.test.ts`.
    - **Finding 2 — only the keydown CLAIMANT can swallow the key by dying.**
      Round 5 stopped the walk for ANY snapshot entry that was gone at walk
      time. An entry below the first was never the claimant — the walk reaches
      it only because everything above it declined, and it is not offered the
      key either — so stopping there let a surface that was never in the running
      swallow the keystroke. Measured on round 5: a `window` surface that
      DECLINES (focus outside its frame) over a `workspace` that closes itself
      in the gap gave `["window"]`, and the `app` tier below never ran; round 6
      gives `["window","app"]`, which is what round 4 did. The rule is now
      `ordered[0]` only.
    - **What finding 2 deliberately does NOT change, and why.** The review's two
      cited probes — Tiles under a declining `ToolWindow` that unregisters in
      the gap, and close-and-identical-reopen in the gap — are both cases where
      the dying surface IS `ordered[0]`, the claimant. Reproduced at round 5's
      tip: both give `[]`, and they still give `[]` at round 6. They are
      indistinguishable at walk time from the case round 5 exists to protect
      (the pinned "STOPS when the surface that owned the key at keydown is gone
      by the walk"): in all three the innermost entry at keydown is simply gone,
      and what its handler WOULD have returned is unknowable. Restoring them
      means deleting round 5's rule outright, which sabotage M-e shows reddens
      that test. Recorded as the accepted cost of the round-5 protection rather
      than silently "fixed"; reachability is a ~0 ms unregistration window and
      the next Escape does the job.
    - **The three staleness rules stay separately pinned**, one sabotage each
      (S6-2 / S6-3 / S6-4 below) — they are not merged.
    - **Finding 3 (record)** — the `menu` row of round 4's ladder table above is
      corrected in place: with the wizard at step ② an open menu does not close,
      and that is residual R11's class.
    - **Finding 4 (record), both numbers restated from measurement.**
      `useWorksheetView.ts`'s pin was **never ratcheted**: the file went 647 →
      646 lines in round 4 and its `architecture.test.ts` pin stayed **648**
      (comment still "Unchanged at 648 (BUG-009)"). That is legal — pins are
      ceilings and the rule is "never raise" — and `architecture.test.ts` is
      untouched by rounds 4, 5 and 6, so no pin was raised anywhere; the brief's
      "ratcheted DOWN 648 → 646" simply did not happen. And "all 48 ToolWindow
      hosts" is not reproducible: measured at round 6's tip, **40** production
      `.tsx` files render `<ToolWindow` across **41** render sites and **44**
      import it (45 files / 78 sites / 50 importers if test files are counted).
      The table and `ToolWindow.tsx`'s header now say what was measured.

    | Sabotage (round 6) | Result | Failing test(s) |
    |---|---|---|
    | S6-1 the synchronous claim stops calling `preventDefault()` | **RED** 4 | "stops a LATE window-bubble consumer from acting on the same key", "marks the event itself, which is how a later consumer can tell", "Esc① cancels the drag only; the marker edit stays live", "Esc② then pauses the marker edit, and still does not revert the tool" |
    | S6-2 any dead snapshot entry stops the walk again (round 5's blanket rule) | **RED** 1 | "walks PAST a snapshot entry that was never the claimant and died in the gap" |
    | S6-3 the keydown claimant no longer swallows the key by dying | **RED** 2 | "STILL stops when the CLAIMANT itself dies, with the same stack below it", "STOPS when the surface that owned the key at keydown is gone by the walk" (round 5) |
    | S6-4 the mid-walk staleness skip becomes a stop (round 4's rule, M-d) | **RED** 1 | "still skips — and walks past — a surface killed DURING the walk (round 4)" |

    Each applied alone against `escapeStack.test.ts` +
    `useGlobalShortcuts.test.ts` + `components/workshops/peakwizard`
    (**69 tests**, green at baseline), and restored after.

  **Round 7 (2026-09-19) — R1 closed: the eight backdrop dialogs now take
  focus, trap Tab, and restore it.** Split, Separate, Combine, ReimportAll,
  Shortcuts, TextFormatHelp, Preferences, Help all adopt
  `useDialogFocus`/`useFocusTrap` (`components/overlays/useDialogFocus.ts`,
  unchanged — this is applying existing infrastructure, not building new).
  `role="dialog"`, `aria-modal="true"` and an `aria-labelledby` from
  `useId()` were added wherever missing (Preferences and Help already had
  `role="dialog"` + `aria-label`; both are now `aria-labelledby` pointing at
  their own heading, matching every other dialog in the app).
  - **Escape: all eight KEEP their own window-capture listener** rather than
    joining `lib/escapeStack.ts`. Reason, same for all eight and consistent
    with `ConfirmDialog`/`RecoveryChoiceDialog` (never rewritten onto the
    registry either): a backdrop dialog is a true MODAL that blocks the
    pointer entirely, so it must always win over anything mounted behind
    it. Window-capture already guarantees that — it runs ahead of the
    registry's one window-BUBBLE listener on every keystroke — so joining
    the registry would add ordering machinery (a `menu`/`window`/`workspace`
    layer decision) that a dialog which can never be out-ranked does not
    need. `ReimportAllDialog` additionally keeps calling `cancelReimportAll()`
    specifically (never a raw close), per its existing coordinator-review G1
    contract — untouched by this pass.
  - **Landing spot, one line per dialog:**
    - Split — the Column select (DOM-order default): it is the first
      decision and gates whether Tolerance even renders below it.
    - Separate — the Name field (default): the one control every commit
      needs a look at.
    - Combine — the Name field (default): drives whether Combine is even
      enabled.
    - ReimportAll — default (Close, or Close + "Reimport Available
      Sources"): no field outranks either.
    - Shortcuts / TextFormatHelp — default (Close): read-only sheets with
      one real control.
    - **Preferences** — deliberately NOT the default. This dialog's own tab
      nav (`.qzk-prefs-nav`) is a row of plain, non-focusable `<div>`s (a
      pre-existing, separate gap this pass does not touch — they were
      mouse-only before and after), so the raw DOM-order default would land
      on the "✕" close button, telling a keyboard user nothing about what
      the dialog is for. A second effect (declared before `useDialogFocus`,
      so the shared hook's own "already inside" skip applies — the same
      composition `ParamDialog`'s `autoFocus` and `HelpDialog`'s own
      search-box focus already rely on) instead focuses the first focusable
      control INSIDE THE ACTIVE PANE — the setting a user opening
      Preferences almost certainly came for. The Keyboard tab has no
      focusable content at all, so there this is a no-op and the shared
      hook's Close-button fallback is what actually fires — verified by
      sabotage (below).
    - **Help** — the pre-existing "focus the search box on the Topics tab"
      effect is kept (same composition as Preferences), and for the other
      four tabs the shared hook's plain default already lands on the
      "Topics" tab button — unlike Preferences, Help's tabs ARE real
      `role="tab"` `<button>`s, so no override was needed there.
  - **Sabotage — one dialog's `useDialogFocus` call removed at a time (never
    all eight at once, the exact failure mode a prior round shipped):**

    | Dialog sabotaged | Result | Failing test(s) |
    |---|---|---|
    | Shortcuts | **RED** 2/2 | "moves focus into the dialog on open…", "Escape … closes it and gives focus back to the opener" |
    | TextFormatHelp | **RED** 2/2 | same two case names |
    | SeparateWorksheets | **RED** 2/2 | same two case names |
    | ReimportAll | **RED** 2/2 | same two case names |
    | CombineWorkbooks | **RED** 3/3 | + "Tab wraps through the checklist and buttons…" |
    | SplitDataset | **RED** 3/3 | + "Tab wraps between Column, Tolerance, Cancel, and Split…" |
    | Preferences | **RED** 2/3 | "Tab traps at the dialog's real boundary…", "Escape … gives focus back to the opener" — **NOT** "moves focus into the ACTIVE PANE…", which stays green because that assertion is satisfied by the dialog's OWN separate landing-spot effect, independent of `useDialogFocus`. Sabotaging that effect's own line instead (a second, additive check) turns the focus-in case red too — landing on the "✕" close button — confirming the deliberate-landing-spot claim is itself tested, just not by the same case that pins the trap/restore. |
    | Help | **RED** 2/3 | "falls back to the shared hook's default…", "Escape … gives focus back to the opener" — **NOT** "moves focus into the Search box…", which is HelpDialog's own pre-existing effect, same reasoning as Preferences. |

    Each sabotage applied alone against that one dialog's own test file
    (`components/overlays/*.test.tsx`), green at baseline, and restored
    after. The full `components/overlays` suite (23 files, 268 tests, 20 new)
    is green with every sabotage reverted.
  - Eager bundle — **CORRECTED in round 8; the pair below was measured
    against the wrong parent.** `cee0494f~1` is **`4179b166`**, not
    `b10bcad3`, which is three commits back (`b10bcad3` → `c841c38d` →
    `4179b166` → `cee0494f`); the two intervening P4.1 commits moved 218
    lines out of eager `store/useApp.ts` into a new 265-line
    `store/workspaceHydration.ts`, both eager sources, so the old pair folded
    that extraction into this commit's number. Re-measured 2026-09-19 in a
    throwaway worktree, `npm ci` once (no lock or `package.json` drift
    between the two commits) and `rm -rf node_modules/.vite` before each
    build: parent **`4179b166` 889,496 B** → tip **`cee0494f` 889,498 B**,
    **+2 B**. The delta was right; **both absolute numbers were wrong by
    21 B**, and the parent SHA was wrong outright. Budget 920,400 B, so
    30,902 B of headroom at that tip. (Superseded arithmetic, kept so the
    correction is auditable: `b10bcad3` **889,475 B** → **889,477 B**.)
    No new library code — only existing-hook adoption plus
    `role`/`aria-modal`/`aria-labelledby` markup, so the delta is negligible.

  **Round 8 (2026-09-19) — R1 narrowed, BUG-018 filed, landing spot fixed.**
  This round changed almost no product code, on purpose. It started from an
  adversarial review of `cee0494f` that reproduced a stacked-dialog Escape
  double-close in real Chromium with three keystrokes and no mouse.
  - **The preferred fix was built and MEASURED, then reverted.** All ten
    backdrop dialogs were migrated onto `useEscapeSurface("window", …)`,
    keeping each dialog's close semantics (`ReimportAll` still `cancel()`,
    `RecoveryChoice` still `applyCancelRecovery()`, `ConfirmDialog` keeping
    Enter on its own window-capture listener and moving only Escape). It
    **does** fix the ladder, measured: Preferences over Shortcuts went 2 → 1
    → 0 on two Escapes, and Preferences over a pending `ConfirmDialog` closed
    Preferences on the first Escape with the confirm **still pending**,
    resolving `false` only on the second — exactly the target behaviour.
  - **It was reverted because it inverted the ladder elsewhere.**
    `escapeStack`'s dispatcher returns early on
    `isEditingTarget(event.target)` (INPUT/TEXTAREA/SELECT), and FOUR of the
    ten dialogs land focus on such a control **by design**, per round 7's own
    landing-spot table: Help's search box, Separate's and Combine's Name
    field, Split's Column select. Measured: with Help open and focus on its
    search box, Escape did nothing at all — twice — and `SeparateWorksheets`
    alone would not close from its own documented landing spot. The scoped
    suite went from 268 green to **9 failed / 264 passed across 7 files**; of
    those 9, four are this genuine regression (Help, Separate, Combine,
    Split's `user.keyboard("{Escape}")` cases) and the rest are the
    synchronous-`fireEvent` tests meeting the registry's one-macrotask
    deferral. Making it work would mean giving `escapeStack` a new modal tier
    that bypasses `isEditingTarget`, `cmdkOpen` and the `.qzk-ctx` guard —
    a redesign of the dispatcher that has already produced an inversion in
    each of rounds 2, 3, 4 and 5, not an adoption of existing infrastructure.
    Out of scope for a bounded round; recorded as BUG-018's design note so
    the next attempt starts from the measurement rather than repeating it.
  - **What shipped instead:** this narrowing, BUG-018, the corrected bundle
    record above, two new residuals (R12, R13), and one real fix — the
    Preferences landing spot (below).
  - **Preferences lands on the SELECTED segment, not the first one** (review
    NIT 3). `SegmentedControl` gives every option a plain focusable
    `<button role="tab">` with no roving `tabindex`, so round 7's
    `focusablesIn(paneRef.current)[0]` was always the FIRST option. Measured
    with `theme: "light"`: focus landed on **"Dark"**, carrying
    `aria-selected="false"` — a screen-reader user's entry point was "Dark,
    tab, not selected", and Enter/Space there flipped the theme. The new
    `landingSpotIn` helper prefers the selected option of the `role="tablist"`
    group the default belongs to, falling back to the plain DOM-order default
    for every non-tablist pane. Round 7's test covered only the default dark
    theme, where first-in-DOM and selected coincide; **both themes are pinned
    now** (`it.each`), and the assertion is stated as the property —
    `aria-selected="true"` on whatever it landed on — not just the label.
  - **Round 7's per-dialog sabotage property is preserved.** Re-verified
    after the landing-spot change: commenting out `useDialogFocus` in
    Preferences alone still reddens exactly its trap and restore cases
    (**RED 2/10**), and the two landing-spot cases correctly stay green
    because the dialog's own effect satisfies them — the same disclosure
    round 7 made.

  **Round 9 (2026-09-19) — R1 CLOSED: BUG-018 fixed, R13 closed.** Built the
  option-1 fix BUG-018's entry offers: `lib/escapeStack.ts` gains a `modal`
  layer ranked above `menu`, and all ten backdrop dialogs are surfaces on it
  rather than on their own `window`-capture listeners. Option 2
  (`stopImmediatePropagation()` plus a shared sequence number) was rejected for
  the reason round 8 recorded: it would have left ten dialogs permanently
  outside the single ordered walk — the split that produced the bug.
  - **The bypass is keyed on THE CLAIMANT resolving to a modal**
    (`ordered[0].layer === "modal"`), not on "a modal is registered anywhere".
    The two coincide while `modal` is the top rank, but the claimant form is
    the narrower statement of the same rule — it can only suspend a guard for a
    keystroke a modal is actually going to be offered, and it stays correct if
    a layer is ever added above this one. Nothing below a modal is offered the
    key either, whether the modal claims it or declines it, so a modal that
    DECLINES cannot hand a text field's Escape down to a workspace or the app
    fallbacks — the surfaces `isEditingTarget`/`cmdkOpen`/`.qzk-ctx` exist to
    protect.
  - **The modal claim resolves SYNCHRONOUSLY at keydown and marks the event**
    (round-9 review, MED-HIGH — a measured regression in the first cut, fixed
    before landing). Built on the DEFERRED walk, the layer could be beaten by
    a window-BUBBLE listener that claims with `preventDefault()` during the
    same dispatch: `walk`'s own `defaultPrevented` re-read then aborted the
    dialog's close. Measured with Preferences open and a listener of
    `usePeakWizard`'s exact shape — its marker-edit pause, live at step ②
    whenever there is something to pause — **the pause fired and the dialog
    stayed open**, where the parent tree's per-dialog window-capture
    `stopPropagation()` had shielded it. Reachable with no mouse: Peak
    Analyzer at step ②, then `Ctrl+,`. The fix is rounds 5–6's `gesture`
    treatment applied to the same class of problem, and it is what makes the
    `menu`-row correction at the top of this table (the wizard out-claiming an
    open menu) NOT extend to modals. What the layer guarantees is therefore
    stated precisely rather than as "it traps Escape": it outranks every
    registry surface and every later listener that honours `defaultPrevented`;
    it cannot stop one that ignores it, and it does not try to beat a claim
    that landed before the dispatcher (window-capture / document-bubble — how
    `SymbolPalette` claims and how `WhatIsThis` still owns Escape outright).
    Pinned at both levels: "stops a LATE window-bubble consumer from killing a
    MODAL's claim" (`lib/escapeStack.test.ts`) and "a window-bubble claimant
    behind the dialog cannot swallow the dialog's Escape"
    (`stackedDialogEscape.test.tsx`).
  - **The four editing-target landing spots, which killed round 8's attempt,
    are measured one test each** (jsdom, real components,
    `user.keyboard("{Escape}")` at the dialog's own landing spot): Help's
    search box (`INPUT`), Separate's and Combine's Name field (`INPUT`) and
    Split's Column select (`SELECT`) each close on ONE Escape, where the
    reverted attempt left all four Escape-DEAD.
  - **A second blocker round 8 never reached.** Combine, Separate and Split
    call `e.stopPropagation()` for EVERY key in the dialog box's React
    `onKeyDown`. Measured: a React synthetic `stopPropagation()` calls
    `stopPropagation()` on the NATIVE event at the React root container, which
    is below `window`, so the registry's window-BUBBLE listener was
    unreachable from inside those three dialogs. Escape is now let through
    there; every other key still stops.
  - **The ladder is not disturbed.** Rounds 2–5 each produced an inversion, so
    this was measured rather than assumed: the full frontend suite is 680 files
    / 11552 passed, and in Chromium `e2e/specs/region-tool-escape.spec.ts` ran
    6 consecutive clean runs (6 passed each) plus a full `npm run e2e` at 62
    passed / 1 skipped, every run under `CI=1` so `reuseExistingServer` could
    not serve another checkout's SPA. Five sabotages each reddened exactly the
    cases they should — see BUG-018's completion record.
  - **What did NOT change: R12.** This fix decides who gets the KEY, not the
    ARIA surface. Two `aria-modal="true"` dialogs can still be mounted at once
    and `aria-modal` still hides the toaster and status-bar live regions;
    R12's wording below stands unaltered.
  - `escapeStack.ts` 324 → **465** lines (ceiling 500 — 35 lines of headroom,
    worth watching: the next substantial change to this dispatcher should
    extract a sibling rather than grow it). Bundle: **888,757 B** eager
    against the parent `8f79207d`'s 888,562 B (+195 B), 221 chunks either
    side — no seam moved and the pin is untouched. (Both figures were stale in
    an earlier draft of this record — 377 lines and 888,754 B, measured before
    the two review rounds below; corrected here from a fresh `npm ci` build.)
  - **Re-review (2026-09-19), before landing.** No inversion in the sync-claim
    delta — confirmed in real Chromium for the mid-drag case (Preferences
    opened mid-drag: Escape ① closes the dialog only and the tool stays armed,
    Escape ② reverts the tool), held-Escape, the native `<select>` popup and
    `SymbolPalette` (which claims on document-bubble, before the dispatcher,
    so it cannot race the synchronous claim). Four findings, all closed here:
    - **A modal that DECLINES traps the key; a modal that THROWS does not.**
      `offer()` folded an exception into "declined", and once a decline
      started trapping that meant one throwing dialog made Escape dead
      app-wide for as long as it was mounted — reintroducing, through the
      back door, the very defect review NIT 5 added that catch to prevent.
      `offer()` now returns `claimed`/`declined`/`threw`; the walk still
      treats a throw as a decline (it has no trap to lift), and under a modal
      a throw lifts the trap so the layers below get the key. Both halves
      pinned, and the `offer()` header's "the surface below still gets its
      turn" is narrowed to where it is actually true.
    - **The trapped return no longer leaked a stale walk.** It skipped the
      `clearTimeout` the fall-through path runs, so a walk armed by keydown ①
      survived keydown ② and fired a macrotask later, handing the key to a
      surface BENEATH the modal — precisely what the trap exists to prevent.
      Needs two keydowns in one macrotask, so it is ~unreachable from real
      input; fixed and pinned regardless.
    - **The IME residual is booked as R14** rather than guessed at.
    - **Stale numbers in this record corrected** (see the bullet above).

  - **Review round (2026-09-19), before landing.** One behavioural finding —
    the deferred-modal regression above — plus four doc/gating defects, all
    fixed on top: two orphaned comments that still said this fix was
    impossible (`SeparateWorksheetsDialog`, `SplitDatasetDialog`, both on
    unrelated effects, a pre-existing misplacement); eight stale "kept as its
    own window-capture listener rather than joining `lib/escapeStack.ts`"
    preambles sitting directly above the call that joins it; this plan's own
    residual miscount; and `SplitDatasetDialog` registering its modal on
    `targetId` alone while the render and `useDialogFocus` also require the
    dataset — a stale id put an INVISIBLE modal on the stack, and since
    nothing below a modal is offered the key, one Escape did nothing at all.
    Registration is now gated on the same condition as render, pinned by "a
    stale target id registers no modal, so Escape still reaches the surface
    below". The other nine dialogs were audited for the same mismatch: all
    nine already register and render on the same condition.

  **Named residuals (why this is `[~]`).**
  - **R1** — **CLOSED (round 9).** Both halves now hold. The FOCUS half closed
    in round 7 and stays closed: the eight backdrop dialogs (Split, Separate,
    Combine,
    ReimportAll, Shortcuts, TextFormatHelp, Preferences, Help) take focus on
    open, trap Tab, and restore it to the opener on close, via the same
    `useDialogFocus`/`useFocusTrap` infrastructure every other dialog in this
    box uses — round 7's per-dialog sabotage table reproduces exactly, and an
    independent review re-ran all eight.

    The ESCAPE half is **not** closed, and round 7's reason for keeping the
    window-capture listener was false where it mattered. It claimed a backdrop
    dialog "can never be out-ranked" and that "joining the registry buys
    nothing". Both hold for a dialog over a NON-dialog surface — measured, and
    still true. Neither holds for a dialog over ANOTHER dialog, which is the
    one case the registry's ordering exists to settle: all ten backdrop
    dialogs (these eight plus `ConfirmDialog` and `RecoveryChoiceDialog`)
    listen with `window.addEventListener("keydown", …, true)` and call
    `stopPropagation()`, which does not stop a same-node, same-phase sibling,
    so both handlers run on one keystroke. Measured on this tree
    (`490243f9`), jsdom, real components, `user.keyboard("{Escape}")`:
    Preferences + Shortcuts, Preferences + Help and Preferences + a pending
    `ConfirmDialog` each go from 2 open `[role="dialog"]` to **0** on ONE
    Escape, and the confirm resolves `false` on the same keystroke that
    dismissed Preferences. **Filed as BUG-018** (`plans/BUGS_AND_ISSUES.md`)
    with that reproduction and pinned by
    `components/overlays/stackedDialogEscape.test.tsx`. Pre-existing, not
    introduced by round 7 — the Escape effects are byte-identical to base.

    **The ESCAPE half closed in round 9** (`5d6ef1b9`): all ten backdrop
    dialogs are now `modal`-layer surfaces in `lib/escapeStack.ts`, so the
    innermost open dialog closes and nothing below it acts on the same
    keystroke — the three stacked pairs go 2 → 1 → 0 on two Escapes, a pending
    `ConfirmDialog` underneath stays PENDING and resolves `false` only on the
    second, and a lone dialog is unchanged at 1 → 0.
    `stackedDialogEscape.test.tsx` is inverted from the `DIVERGENCE` pin to an
    assertion of the ladder, covering all four rows. Round 7's claim that a
    backdrop dialog "can never be out-ranked" is now true of the mechanism
    rather than asserted of it: the ordering is the registry's, not listener
    phase's.
  - **R2** — `CommandPalette` focuses its input but never restores focus to
    the opener on close.
  - **R3** — floating workshop windows have no keyboard MOVE or RESIZE. No
    plan-level promise commits to one; GUI_INTERACTION #10's recoverability
    promise is met by title-bar clamping plus the keyboard-reachable View-menu
    "Reset window positions". Not invented here.
  - **R4** — `ToolWindow`'s ✕ takes its accessible name from `title="Close"`
    alone and does not say WHICH panel it closes. That belongs to the
    accessible-names box above, not this one.
  - **R5** (round 2, review NIT 12) — under React StrictMode's dev-only
    mount→cleanup→mount, `useOpenerRestore`'s cleanup restores to the opener
    mid-open and the re-run pulls focus back in. Net-correct, one dev-only
    flicker; not worth a latch that would complicate the real path.
  - **R6** (round 2, review NIT 13) — a SECOND `ToolWindow` mounting takes
    focus from the first. Correct for a user-initiated open, wrong for a panel
    that appears by itself; `ResultsWindow` is the only auto-appear candidate
    and nothing currently renders it, so there is no such path to fix against.
- [~] Accessible names/state for icons, plots, trees, dialogs, progress.
  ~143 `aria-label`s already exist app-wide; this box has NOT had a full
  audit and stays `[~]` for that reason. What was verified and fixed
  (2026-09-09): `Shell/StatusBar.tsx`'s P3.4 pending-op feed (import/export/
  fit progress) rendered with only `aria-label="Cancel"` on its cancel
  button and no live-region semantics on the progress text itself — a
  screen-reader user was never told progress changed. Added
  `role="status" aria-live="polite" aria-atomic="true"` to the `.qzk-pending`
  span (`polite` because progress should not interrupt, unlike the adjacent
  `role="alert"` autosave-failure banner, which was already correct and is
  untouched). Covered by `StatusBar.test.tsx`'s "StatusBar pending-op live
  region (accessibility gap)" describe block. No other icon/plot/tree/dialog
  accessible-name gap was investigated as part of this slice.
  **Fixed 2026-09-13 (round-2 review, F5):** the P3.4 F6 fix (one Cancel
  control per concurrent op, instead of only the oldest) had multiplied
  this exact gap instead of closing it — every Cancel control
  still rendered the identical `aria-label="Cancel"`/`title="Cancel"`, so two
  concurrent ops gave a screen-reader user "Cancel button, Cancel button"
  with nothing to distinguish them. Each control's name/title is now
  `Cancel ${op.label}` (e.g. "Cancel Importing a.dat…"), using the label
  already in hand. Pinned by `StatusBar.test.tsx`'s "shows a Cancel control
  for EVERY visible op … each with a distinct accessible name" test.
- [~] Contrast and non-color encodings — **audited 2026-09-09; what exists and
  what does not, stated precisely instead of left as one unchecked line.**

  EXISTS:
  - Three colour-blind-safe series palettes (`lib/palettes.ts`: Okabe–Ito, Paul
    Tol "bright", viridis), applied as `--series-1..8` overrides on `<html>`, so
    they flow to plot, legend, multi-panel, inset, sparkline and export alike.
  - Real WCAG-style contrast MATH in `lib/contrastColor.ts` (`contrastRatio`,
    relative luminance), with `MIN_CONTRAST = 2.2`, used at render time to swap
    a literal series colour for the ink token when it would be invisible against
    the effective plot background. Unit-tested.
  - Per-series `line` style (`solid`/`dashed`/`dotted`) and eight marker SHAPES
    (`lib/types.ts` `MarkerShape`), both settable and both honoured on screen.

  DID NOT EXIST at the 2026-09-09 audit. The FIRST of the three is now built
  (2026-09-12, detail below); the other two are still open, which is why this
  box stays `[~]`:
  - ~~**No automatic non-colour differentiator.**~~ **BUILT 2026-09-12 — the
    auto dash/marker cycle now exists, opt-in, with export parity.** What
    shipped, precisely:

    - **The preference.** `autoSeriesStyles` in the `qz.prefs` blob
      (`store/prefs.ts`: `Prefs` field, `PREF_DEFAULTS` **false**, guarded
      `loadPrefs` parse, `prefsOf` snapshot), reached through the existing
      generic `setPref`. Unlike `palette`, `syncPrefs` does **not** push it into
      a lib singleton — see "how parity is guaranteed" below for why that was
      the first cut's central mistake; the render paths that have a matching
      export read the store field directly and pass it on as an argument.
      Exposed as a **"Vary dash & marker"** checkbox in
      `Shell/AppearanceMenu.tsx` **directly under "Series palette"** — the same
      menu, because it is the same cycle: the palette varies hue, this varies
      what survives greyscale. (Hand-written `qz-check` markup rather than
      `primitives/Checkbox`, which is deliberately not in the eager bundle.)
      Pinned by `store/prefs.test.ts` (default off, persists, survives a
      localStorage round-trip, a non-boolean falls back) and
      `AppearanceMenu.test.tsx`.
    - **The cycles** (`lib/seriesStyleCycle.ts`, new). Dash:
      `solid → dashed → dotted`, three entries because `LineStyle` and the wire
      type `ExportSeriesStyle.line` → `calc.figure._LINESTYLE` carry exactly
      those three, so the cycle uses the vocabulary that already round-trips
      (3 dashes × 8 palette colours = 24 combinations before a repeat).
      Markers: `circle, square, triangle, diamond, downtriangle, plus, cross,
      star` — all eight `MarkerShape`s, closed glyphs first. **Both start at the
      value that reproduces today's look for series 1** (`solid`/`circle`).
      Assignment is by SERIES DISPLAY POSITION and deterministic.
    - **Explicit always wins**, including an explicit `"solid"`/`"circle"` —
      that is a deliberate "no encoding here", not an absence.
    - **Off is the identity, with ONE stated exception.** `resolveSeriesStyle`
      returns the CALLER'S OWN reference with no cycle (asserted with `toBe`, not
      `toEqual` — a copy would compare equal and still break prop identity
      downstream), and `buildOpts` output for an unstyled plot is pinned
      dash-free/marker-free. "Off" means two things that are both pinned: the
      preference is off, OR the call site passed no positions — an explicit
      `null` cycle is asserted deep-equal to omitting the argument entirely.

      THE EXCEPTION, stated because "with it off every render path is
      byte-identical to before the feature" was claimed twice and is false for
      one of them. The LEGEND SWATCH changed with the preference off, and the
      change is correct rather than accidental. `Stage/LegendSample.tsx` used to
      decide markers locally — `showMarker = marker || scatter || line+markers`,
      then `shape = style.markerShape ?? "circle"` — so a stored
      `{marker:false, markerShape:"diamond", markerSize:9}` on a `Scatter` series
      (the combination `Inspector/SeriesStyleCard.tsx` leaves behind when
      "Markers" is unticked) rendered `data-marker="diamond"` at a 4.5px polygon
      while `buildOpts` drew uPlot's plain 5px circle and `buildExportStyles`
      emitted no marker at all. Sharing `markers.markerDecision` corrects the
      swatch to a 2.5px circle: the legend was describing a glyph nothing else
      drew. Frozen as a literal expectation in `PlotLegend.test.tsx` ("the
      deliberate OFF-state change"). The 32-combination differential OFF proof
      beside it CANNOT see this — it compares `PlotLegend` against the
      post-change `LegendSample`, i.e. the component against itself — so it
      proves the cycle argument is inert, not that the swatch is unchanged from
      before the feature. Those are two different claims and only the first one
      holds everywhere.
    - **How parity is guaranteed** (this is the FEATURE-001 lesson applied, and
      the first cut of it got this WRONG — see "what the review found" below).
      The cycle is an **explicit argument**, not an ambient flag: a
      `SeriesCycle` is the list of DISPLAY POSITIONS of the series a render path
      draws, and both `uplotOpts.buildOpts` (via `BuildOptsArgs.seriesCycle`)
      and `exportStyles.buildExportStyles` (via a third parameter) are the
      identity function without one. A render path therefore cycles only if
      somebody wired its export and passed positions, and a NEW render path is
      uncycled until they do. The backend is still handed an **ordinary explicit
      `line`/`marker_shape`** and never learns a cycle exists.

      **THE UNIT THAT CYCLES IS A PLOT WINDOW**, not the focused Stage, and the
      rule is one sentence: a canvas cycles exactly when an export that
      reproduces THAT canvas's current appearance cycles the same series at the
      same positions. Focus is a transient UI state, so it is not an input; and
      anything that renders a STORED artifact rather than a live canvas stays
      uncycled, so a document's output never depends on the reader's preference.
      The complete, verified table (second review round, 2026-09-13):

      | Canvas on screen | The export that reproduces it | Cycles? |
      |---|---|---|
      | A plot window's plain single-panel XY overlay while FOCUSED (`PlotStage` → `PlotViewport`, plus `PlotLegend`'s swatch and `InsetPlot`), via `useStageSeriesCycle` | `figureSpec.buildStageFigureSpec` → `buildExportStyles` (Copy figure, Copy figure (vector), Export figure…) | **yes** |
      | The SAME window while UNFOCUSED (`BackgroundPlotWindow` → `PlotViewport` + `InsetPlot`), via `useWindowSeriesCycle` on ITS OWN view | the same `buildStageFigureSpec`, produced the moment it is focused | **yes** — focus is not a styling input |
      | Publication Preview's preview image AND its Export, for a `window`-target session whose TARGET WINDOW cycles — focused or not (`canonicalReadiness` / `previewExport`, gated by `canonicalSession.selectSessionCyclesSeriesStyles`) | itself — the same `buildFigureSpecFromDocument` opt-in | **yes** — focus is not a styling input here either |
      | Spatial page cells (`useMultiPanelStage` → `multipanel.spatialCellStyling`, incl. `SpatialPanelLegend`'s entries) | `spatialPageExport.spatialPanelFigure` → `buildExportStyles` (Export page…) | **yes** |
      | Grouped (`group_col`) view | `series_styles` **not applied** — `routes/export_figures.py:114-117` | no, both sides |
      | Faceted view | `series_styles` **unused once `facets` is set** — `:125-127` | no, both sides |
      | Stacked / x-break panels (`stackMode`) | one single-panel figure; the screen shows N panels | no, both sides |
      | POLAR (`PolarStage`) / STATISTICS (`StatStage`) | `buildStageFigureSpec` is not gated on the render mode and still emits a plain XY figure | no, both sides |
      | Any window whose document SETS `publication.seriesStyles` at all — an exact array, an empty array, or `null` | the array shipped verbatim, or (for `null`) no `series_styles` key at all; `buildExportStyles` is never called either way | no, both sides |
      | A view whose X channel is ALSO in `yKeys` (two clicks: `setXKey` does not prune it) — `allowExplicitXAsY` keeps it in the document export's list AS a Y series, which the canvas always drops | there is no shared position space to resolve against | no, both sides |
      | Waterfall (`WaterfallView`), reflectometry (`ReflPanel`) | none | no |
      | Composite `kind:"panel"` window cells (`PanelCell`) | none — a panel window is not a Figure Page source (`panelResolve` requires `win.kind === "plot"`), and `focusWindow` never moves `focusedWindowId` to a non-`plot` kind, so the focused-window export commands can never serve one | no |
      | Snapshot window (`SnapshotPlotWindow`) | none | no cycle is re-derived; the styles were frozen ALREADY RESOLVED (below) |
      | Figure Page panels, graph templates, saved Library figures, `plotSpecFigure`, `legacyFigure` | server-rendered from a STORED document/template | no, both sides |

      Every **plot-window** row above is decided by **ONE function**,
      `seriesStyleCycle.windowCyclesSeriesStyles(on, view, document)`, which is
      the preference AND the two predicates under it: the view test
      `overlayExportsSeriesStyles({groupKey, facetKey, stackMode, polarMode,
      statMode, xKey, yKeys})` — whose last clause is `displayListsAgree`, the
      X-also-in-`yKeys` refusal — and the document test
      `documentPinsSeriesStyles(document)`. Both canvases
      (`useStageSeriesCycle` / `useWindowSeriesCycle`), the Publication Preview
      gate (`canonicalSession.selectSessionCyclesSeriesStyles`) and the Stage
      export (`buildStageFigureSpec`) all call that one function, and
      `buildFigureSpecForView` calls the view half again on the spec it is
      actually building, so none of them can drift into a different opinion about
      which views cycle. `buildStageFigureSpec` asks against the LIVE view
      because the document it may route through carries its own copy of that
      view — and its document refusal is load bearing for the FALLBACK branch
      (`buildFigureSpec`, taken when the focused document's dataset disagrees
      with the one being exported), which never sees `document.publication` at
      all. Two row families above are NOT decided by it: spatial page cells (a
      "yes" row) go through a bare `displayPositions(autoSeriesStyles, n)`,
      identically on both sides (`lib/multipanel.ts:240` canvas,
      `lib/spatialPageExport.ts:195` export) — neither predicate is consulted,
      so there is no parity bug, only a narrower claim than "every row"; and
      every "no" row is a render path that simply passes no cycle at all, which
      is those modules' own design, not this function's.

      THE THIRD ROUND'S TWO HOLES IN THAT SENTENCE, both now closed. (a) The
      Publication Preview gate asked `session.windowId === focusedWindowId`
      while `useWindowSeriesCycle` has never gated on focus, so with the preview
      open on w1 and w2 focused, w1's background canvas dashed while w1's preview
      and its Export rendered solid. It now asks the same function over the
      target window's own document and view — the live singletons when that
      window holds focus (what its canvas draws from), its own record otherwise.
      (b) The display-list agreement test lived as a local `xAlsoPlotted`
      expression inside `figureSpec.ts`, invisible to both canvases: with
      `xKey:1, yKeys:[1,2,3]` the canvas drew channels 2 and 3 solid/dashed and
      the PDF drew all three solid. It is `displayListsAgree` inside the shared
      predicate now, so both sides refuse together (pinned by a test that
      asserts the canvas hook and the real export builder in the same case).

      **A snapshot freezes the RESOLVED styles, not the cycle.** `plotsnapshot`
      and `useLiveSnapshotPublish` both promise the snapshot command "freezes
      exactly what's on screen". Carrying the raw styles plus a cycle broke that
      twice over: a snapshot of a dashed plot rendered solid, and — worse — a
      snapshot taken months earlier would have changed retroactively the moment
      somebody toggled the preference. `useLiveSnapshotPublish` therefore applies
      `resolveSeriesStyle` before publishing the bundle, and
      `SnapshotPlotWindow` passes no cycle. With the preference off the resolver
      is the identity and returns the caller's own array, so the frozen bundle is
      byte-identical to before the feature.

      **RESIDUALS, stated rather than hidden.** Two, and neither is a
      screen-vs-export STYLING divergence:

      1. A Figure Page panel sourced from a live plot WINDOW (`panelResolve`'s
         `"window"` branch) renders that window's document uncycled, while the
         same window's own Stage export cycles. Deliberate: a page is a composed
         artifact, not a screenshot of a window, and cycling it would make a
         page's appearance depend on the preference of whoever last rendered it —
         exactly the "saved documents never bake the cycle in" property below. It
         is recorded because it IS a screen-vs-export difference, just one whose
         two sides are different products rather than two renderings of the same
         one.
      2. The Publication Preview IMAGE is built from the session's DRAFT
         document, so an edit made to the live window behind the non-modal dialog
         is not reflected in the picture until the session is reopened. The
         mechanism, exactly: `useFigureBuilder` -> `computeCanonicalReadiness` ->
         `buildFigureSpecFromDocument(publicationSession.draft, …)`, and the
         draft is only ever patched by the dialog's own controls
         (`patchFigurePublicationDraft`). `selectSessionLiveDrifted` detects the
         divergence and blocks Apply with "the plot changed while previewing —
         Cancel and reopen Publication Preview to pick up the changes", so it is
         reported rather than silent, but the stale image stays on screen until
         then. The third round checked whether the CYCLE rode that staleness —
         toggling polar on the live window leaving the preview dashed — and it no
         longer can: `selectSessionCyclesSeriesStyles` reads the LIVE singletons
         for a focused target, so the dashes stop in the same store notification
         the canvas's do (pinned). What remains is the general draft-vs-live
         staleness of the picture, which is item 1's territory and not this
         feature's.

      **Hidden series resolve at the same position on both sides.** The canvas
      leaves a hidden series in `payload.series` with `show:false`, so a
      channel's display position is its index in the UNFILTERED plotted list;
      the export drops hidden channels from `y_keys` entirely. Two
      independently-derived indices meant channel B drew dashed on screen and
      solid in the PDF. `figureSpec` now keeps the unfiltered `displayChannels`
      list and hands `buildExportStyles` each surviving channel's position in
      IT. The positions also stop at `plotted.length`, so the fit / baseline /
      peak / derivative overlays spliced on after the channels — which no export
      draws — stay undashed.

      **The palette rides the same positions**, but only when the cycle is on.
      `seriesColor(i)` had the identical skew (a hidden series shifted every
      later channel's hue in the PDF but not on screen); `buildExportStyles`
      now indexes it by the supplied position too. RESIDUAL, stated precisely:
      with the preference **off** the export passes no positions, so that
      pre-existing palette skew remains exactly as it was — deliberate, because
      "off is byte-identical to before" is the stronger invariant and is pinned
      by a test ("OFF: a hidden series leaves the export byte-identical to
      before the cycle"). Turning the preference on fixes the hue skew as a side
      effect; that is tested too.

      **Guards.** `exportStyles.test.ts`'s "canvas/export parity (FEATURE-001
      guard)" block drives both real builders over one plot and asserts the two
      resolved sets are **EQUAL series-for-series** — over a NON-IDENTITY
      plotted list (`[2,0,1]`, a reordered legend) and with a hidden series,
      because with `plotted[i] === i` resolving by channel and resolving by
      position are the same function and the guard proves nothing.
      `figureSpec.test.ts` pins the same thing end to end through the real
      request builders, plus every "no, both sides" row above.
      `useStageSeriesCycle.test.ts` pins the canvas half of those refusals, for
      the focused Stage AND for a background window, including that the two agree.
      `PlotLegend.test.tsx` and `multipanel.test.ts` pin that the two legends
      resolve through the same function as their own canvases —
      `PlotLegend.test.tsx` also carries the legend's differential OFF proof (32
      style x trace combinations, each asserted to render the SAME markup as
      handing `LegendSample` the raw stored style, which is the call the component
      made before the cycle existed) and the ambient-default-trace glyph cases the
      first cut's legend test never set. `markers.test.ts` pins the shared
      `markerDecision` rule directly. `BackgroundPlotWindow.test.tsx` and
      `SnapshotPlotWindow.test.tsx` pin the two window paths at their uPlot
      options, `useLiveSnapshotPublish.test.ts` pins that a snapshot freezes the
      RESOLVED styles (and that with no cycle it publishes the caller's own
      array), and `useFigureBuilder.test.ts` pins that the Publication Preview
      image and its Export cycle exactly when the TARGET window's own canvas
      does — including UNFOCUSED, where it renders that window's canvas cycle in
      the same test, and NOT when the target's own view (unfocused) or the live
      view (focused) refuses, nor when the target window is gone.
      `useStageSeriesCycle.test.ts` carries the two-sided display-list pin: the
      canvas hook and the real `buildFigureSpecFromDocument` asserted in ONE test
      to refuse together on `xKey:1, yKeys:[1,2,3]` and to cycle together on
      `xKey:0`. `PlotLegend.test.tsx` carries the frozen literal for the
      deliberate OFF-state legend change.
      Backend half in `tests/test_calc_figure.py`: three cycle positions map to
      three distinct matplotlib linestyles/markers, and both reach the rendered
      output.
    - **Saved documents never bake the cycle in.** `publication.seriesStyles`
      is an "exact" array (the F2.1a contract), so a cycled `line` frozen into
      one would keep exporting dashed on a machine whose preference is off. The
      producers that PERSIST styles — `legacyFigure`'s `saveAsFigure`,
      `useGraphTemplates` — pass no cycle at all, so what they store is the raw
      user style; and `buildFigureSpecFromDocument` cycles only when a caller
      whose LIVE CANVAS is on screen explicitly asks it to — the focused window's
      Stage export, and the Publication Preview of a `window`-target session on
      that same window. Nothing that renders a stored artifact asks. A document
      authored with the preference ON and reopened with it OFF therefore renders
      identically, and vice versa — both directions tested, along with "an exact
      publication style array stays exact". And an exact array does not merely
      survive: it now switches the CANVAS off too (`documentPinsSeriesStyles`),
      because a document that pins every style is one `buildExportStyles` never
      sees at all — and so does an explicit `null`, which drops `series_styles`
      from the request entirely and reaches `buildExportStyles` just as little.
    - **The marker rule is shared, not restated.** `markers.markerDecision` is the
      ONE function that decides whether a series draws markers and with which
      glyph; `markers.seriesPoints` (canvas) and `Stage/LegendSample.tsx` (legend
      swatch) both call it. `buildExportStyles` is NOT a third caller and calling
      its explicit-`marker` gate "the third side of the same rule" overstated the
      agreement: it shares only the EXPLICIT half, because it has no
      `defaultTrace` to consult — that preference never rides the wire. So an
      ambient `Scatter` / `Line + markers` series shows markers on screen and
      none in the export. That gap PREDATES the cycle and is not narrowed by it;
      it is precisely why the default-trace branch must not cycle a glyph, since
      doing so would widen a divergence the export cannot follow. (It is filed as
      a known gap, not fixed here: sending the resolved default-trace marker
      would change every existing ambient-Scatter export.) The legend restating
      the rule is exactly how it drifted: it took the glyph from
      `style.markerShape` whenever markers showed
      at all, so with the preference on and a `Scatter` / `Line + markers` default
      trace it drew circle / square / triangle (measured) while the canvas drew
      three plain 5px circles and the export emitted no marker whatsoever. Sharing
      the rule also stops the legend showing a stored
      `{marker:false, markerShape:"star", markerSize:11}` as an 11px star on a
      default-trace series the canvas has always drawn as a plain circle — a
      legend-only divergence that predates the cycle.
    - **Two things the work turned up.** (1) `sanitizeExportSeriesStyles` never
      restored `marker_shape`, so a saved FigureDocument's exact publication
      styles came back shape-less and every marker reverted to a circle on
      re-export — the same parity break the `_MARKER` table closed, one layer
      down; fixed, and now value-checked against `MARKER_SHAPE_VALUES` like
      `line`/`step` beside it rather than accepting any string. (2) Sabotaging
      the opt-in gate exposed a REAL bug in the first cut: `uplotOpts`'s
      ambient-`Step`-trace branch tests `!style.line`, so with the cycle on
      every series had a dash and the plot silently stopped stepping. Fixed by
      reading the RAW style list there — an auto dash is a DEFAULT and must
      never impersonate the user's explicit choice. Both halves pinned.
    - **Ceilings hit.** Growth was funded by extraction every time, never by
      raising a pin. `lib/uplotOpts.ts` (pinned 1446) gave up three cohesive
      siblings: the `DASH` table and the palette (`cssVar` / `SERIES_VARS` /
      `seriesColor`) to `lib/seriesStyleCycle.ts` — which also stops
      `lib/exportStyles.ts` importing the whole plot builder to resolve one
      colour — and the marker `points` decision to `lib/markers.seriesPoints`.
      Pin → **1428**. `lib/figureSpec.ts` had FOUR lines of headroom under the
      general 500-line ceiling, so the screen-parity override projection moved to
      `lib/figureViewOverrides.ts` (unchanged, three importers repointed).
      `components/Stage/PlotStage.tsx` had ZERO — it sat exactly ON the 400-line
      component ceiling — so its opt-in is a named hook, `useStageSeriesCycle`.
      (Both numbers were one too high in the first rework's own text. The guard
      counts `src.split("\n").length`, which is `wc -l` PLUS ONE for the trailing
      newline, so a file at `wc -l` 495 counts as 496 against a ceiling of 500,
      and one at 399 counts as 400. Worth recording because every ceiling claim
      in this repo is off by one if read as `wc -l`.)
      `useMultiPanelStage.ts` (pinned 791) paid for the spatial opt-in by moving
      its per-cell styles/labels/legend derivation to
      `multipanel.spatialCellStyling` — where the spatial EXPORT's own channel
      list already lives, so the two cannot drift. Pin unchanged.
      `lib/plotspec2.ts` → **636** (its private `MARKER_SHAPE_VALUES` moved to
      the shared module). `store/useApp.ts` → **2328**, funded by replacing 17
      hand-maintained `x: _initialPrefs.x` lines with one `..._initialPrefs`
      spread.

      SECOND ROUND (2026-09-13), same discipline, no pin raised anywhere:
      `lib/types.ts` gained the `DefaultTrace` union (the `defaultTrace`
      preference's four values, previously a bare `string` through ten
      declarations) inside its existing headroom, pin **1053** and a counted 1052
      — ONE UNDER, not "held at": the second round's own text said "unchanged",
      which is true of the pin but reads as "at it". `lib/uplotOpts.ts` is the
      same shape: counted **1427** against a pin of 1428, one under, where that
      round said "held at 1428". Both are shrink-only pins, so one line of
      headroom is the whole difference between the next edit fitting and not.
      `store/useApp.ts` and `useMultiPanelStage.ts` each took the new type on an
      EXISTING `lib/types` import line rather than a new one, so both stayed
      exactly at their pins; `useFigureBuilder.ts`, at zero headroom, funded its
      one new store subscription by collapsing the three-line `canonicalData`
      ternary, and now sits AT the general ceiling (counted 499 of 500 — one line
      left) — the next slice there must extract first.

      THIRD ROUND (2026-09-13): no pin raised and none approached. The shared
      `windowCyclesSeriesStyles` collapsed a three-clause gate that FOUR call
      sites each spelled out (both `useStageSeriesCycle` hooks,
      `buildStageFigureSpec` and `buildFigureSpecForView`), plus ONE more, the
      Publication Preview, that spelled it WRONG, so `lib/figureSpec.ts` came
      DOWN — counted 483 of 500, from 493 —
      and `components/Stage/useStageSeriesCycle.ts` went from seven store
      subscriptions to one.

      **Eager bundle, measured on THIS tree after `npm ci` and a
      `node_modules/.vite` wipe (2026-09-13, re-measured in the FOURTH round
      against the THIRD round's real parent):** parent `6797e77c` **915,638 B**;
      third-round commit `95a211fc` **915,587 B** — 51 B smaller, and 4,813 B
      under the 920,400 budget, which therefore does NOT move. The fourth
      round's own fix measures 916,102 -> 916,102 against ITS parent
      `cd402c1b` (0 B; see round-four finding 2 below).

      All three earlier blocks' numbers are superseded and must not be quoted
      forward, for three rounds of the same mistake. The original measured
      against `3145fe33`, which is not in this branch's history at all. The
      second measured against `2b60d4e6`, which IS an ancestor but sits FIVE
      commits behind the actual parent of that work, `5f65ec8a` — `78cbc808`
      (a twelve-finding Library fix, the most likely mover), `d8c6f0f3` (a
      test-only pin) and `55870ed8` (a plans-only docs commit) came first, and
      only the last two, `ed596ec3` and `5f65ec8a` themselves, are the region
      2-D y-box work — so its "810 B under budget" was really 311 B
      (`1b60872a` measures 920,089 here). That is not the whole story: the
      second round ALSO
      mis-measured its OWN tree — it claimed 919,590 B, and that same tree
      checks out at 920,089 here, 499 B off — which a stale baseline cannot
      explain, because a stale baseline moves the DELTA, not a measurement of
      one's own build. The third round then repeated the identical mistake in
      a new shape: it measured against `dc0dbae9`, an ancestor of this
      commit's real parent `6797e77c` — two commits back, across `d6e67fb7`
      (P3.4's export-cancel work), which moved substantial frontend code onto
      lazy import paths and shifted the bundle by roughly 4.4 kB. Naming an
      ancestor "this round's PARENT" is exactly the error the paragraph above
      exists to warn against. Corrected in full in `scripts/check-bundle-size.mjs`.
      It also records the one measurement worth keeping from the third round,
      measured on that (superseded) tree rather than this one: having
      `figurebuilder/canonicalSession.ts` import the focused-window selector from
      `components/Stage/useStageSeriesCycle.ts` cost **626 B** (920,715 — over
      that tree's budget), because that single cross-directory import moved a
      chunk boundary. Putting the shared decision in `lib/seriesStyleCycle.ts`,
      which both files already imported, avoided it with identical behaviour.
      The checkbox reduction re-measured at 102 B on that same superseded tree
      (74 B, then 111 B, in the two earlier rounds — it moves with the module
      graph, so it is re-measured every round).
    - **Deliberately NOT done.** The glyph cycle does **not** reach the ambient
      `Scatter` / `Line + markers` default trace, and `markers.seriesPoints`
      keeps those two branches apart on purpose: the export emits a marker only
      for an EXPLICIT `style.marker`, so a glyph taken from the default trace
      would be drawn on screen and dropped from the PDF. (The first cut merged
      them, which both widened that gap and made a stored
      `{marker:false, markerShape:"star", markerSize:11}` — reachable, since
      `SeriesStyleCard` keeps both fields when "Markers" is unticked — start
      rendering an 11px star with the preference OFF.) The Inspector's "Line"
      picker and the plot context menu still show the STORED value, so an
      unstyled series reads "solid" there while the canvas draws its cycled
      dash; picking an entry still does exactly what it says, and the stored
      value then wins everywhere, but the display is a known gap. `thumbnailSvg`
      draws no dashes at all (it never did). No fourth dash pattern (it would
      need the Inspector picker, the wire type and `_LINESTYLE` extended
      together).
    - **What the adversarial review found**, and what the rework did about it.
      All twelve findings were confirmed by a reviewer who ran them. The first
      cut kept the on/off flag in a module-level singleton that `syncPrefs`
      pushed in, on the argument that threading it was "a dozen chances to miss
      one". The opposite was true: an ambient flag meant every `buildOpts` and
      `buildExportStyles` caller opted in by default, and five render paths
      (facets, `group_col`, waterfall, reflectometry, stacked panels) cycled on
      screen with no export that could reproduce them. The singleton is gone;
      the positions argument replaced it, and forgetting it now fails safe. The
      other confirmed findings, all addressed above: the hidden-series position
      skew; the widened default-trace marker divergence; `SpatialPanelLegend`
      contradicting its own canvas (whose "index spaces do not line up"
      justification was simply false — both come from
      `spatialPlottedChannels`); parity tests that used an identity `plotted`
      and so could not catch a channel-vs-position mix-up; a legend half that no
      test exercised; an SVG-bytes backend test that could not fail because
      matplotlib stamps `<dc:date>` (now `fmt="png"`, with a determinism
      assertion above it so the comparison means something); cycled styles
      frozen into saved documents; `marker_shape` restored without value
      validation; and a bundle number measured off a warm vite cache.

      **The SECOND review round** (2026-09-13) confirmed all twelve were closed
      and found eight more, every one of them a place the "cycles on screen IFF
      the export renders the same dash at the same position" rule had a hole.
      Fixed, in the order the table above now states them: the legend drew a
      cycled GLYPH for the ambient default trace that neither the canvas nor the
      export drew (finding 1, now `markerDecision`); background, snapshot and
      composite-panel windows drew SOLID beside a dashed focused window, so a
      window changed appearance on focus move and a "frozen" snapshot rendered
      solid (2 — background windows cycle from their own view, snapshots freeze
      the resolved styles, panel cells have no export and are recorded as such);
      `allowExplicitXAsY` gave the export a display list the canvas never drew
      from, shifting every later channel (3); a document with an EXACT
      publication style array bypassed `buildExportStyles` while the canvas
      cycled anyway (4); the Figure Builder preview and Export — the "what will I
      get" widget for the focused window — were a third and fourth drifting
      render path (5); `polarMode`/`statMode` were missing from the shared
      predicate, so "Export figure…" dashed a figure the screen never dashed
      (6); the bundle justification block measured against a commit that was
      never an ancestor of this branch (7); and a batch of stale or contradictory
      comments the rework itself introduced (8). Two of the eight were purely
      about honesty rather than behaviour, and both are recorded above rather
      than quietly corrected: the ceiling-headroom off-by-one, and the
      publication-styles module header whose "never pulls screen colour code in"
      claim its own import had made false.

      **THE THIRD REVIEW ROUND** (2026-09-13) confirmed seven more, every one
      again a place the "cycles on screen IFF the export renders the same dash at
      the same position" rule leaked, and all seven are fixed above with a test
      that fails when the fix is reverted:

      1. The Publication Preview gate kept FOCUS as a styling input
         (`session.windowId === focusedWindowId`) after the canvas half had
         stopped doing so — a dashed background canvas beside a solid preview and
         Export. It asks the target window's own view+document now.
      2. The display-list agreement test (`allowExplicitXAsY`) lived only in
         `figureSpec.ts`, so the canvases could not see it and `xKey:1,
         yKeys:[1,2,3]` — two clicks, since `setXKey` does not prune the channel
         out of `yKeys` — dashed on screen and drew solid in the PDF. It is
         `displayListsAgree`, inside the shared predicate, asserted on both sides
         in one test.
      3. `documentPinsSeriesStyles` returned false for `publication.seriesStyles
         === null`, but `figureSpec` maps `null` to "drop `series_styles`
         entirely" — the canvas dashed a figure the PDF had no per-series styling
         for at all. Reachable through `useGraphTemplates`. `null` pins now (the
         predicate is `!== undefined`, so ONLY an absent field derives styles),
         and `[]` counting as pinned is stated at the code.
      4. The bundle justification block measured against `2b60d4e6`, an ancestor
         FIVE commits behind that round's actual parent `5f65ec8a` (only the
         last two of them region y-box work) — the second round repeating the
         first round's mistake in a subtler form, and the 810 B of headroom it
         claimed was really 311 B. The third round then rewrote it against
         `dc0dbae9`, which was ITSELF an ancestor and not the parent; the fourth
         round re-measured against the real parent `6797e77c` (see below).
      5. "With it OFF every render path is byte-identical to before the feature"
         is false for the legend swatch, and the change is CORRECT rather than
         accidental. Narrowed to what holds, with the exact case frozen as a
         literal expectation; the 32-combination differential proof structurally
         cannot see it.
      6. `PanelCell.tsx` cited `store/windows.ts` for an export-path exclusion of
         `kind:"panel"` that does not exist there. The real reason is that
         `focusWindow` never moves `focusedWindowId` to a non-`plot` kind, so the
         focused-window export commands can never serve a panel. Citation fixed.
      7. The Publication Preview cycling off the DRAFT view while the live window
         behind the dialog changed mode. Closed by fix 1 (a focused target reads
         the live singletons); the remaining draft-vs-live staleness of the
         preview IMAGE is recorded as residual 2 above with its mechanism.

      Plus two nits: the two ceiling claims that read as "at the pin" when both
      files are one line UNDER it, and `markers.ts`'s "third side of the same
      rule", which overstated how much of the marker decision
      `buildExportStyles` shares.

      **THE FOURTH REVIEW ROUND** (2026-09-13) confirmed six more findings, all
      fixed:

      1. Two consumer comments still asserted fix 1's own premise — that the
         preview cycles only for a session previewing the FOCUSED window's own
         figure — after fix 1 had made that false: `canonicalReadiness.ts` and
         `previewExport.ts` reworded to "a session whose TARGET window cycles
         per `windowCyclesSeriesStyles`, focused or not".
      2. `canonicalSession.ts` judged an unfocused target by `target.view`, a
         DIFFERENT projection than the one the canvas it is meant to agree with
         actually uses — `WindowCanvas.tsx` passes `plotWindowView(win)`, which
         derives the view from the DOCUMENT when one exists
         (`store/windowDocuments.ts`). The two agreed only because every writer
         of a document-backed window already re-derives `view` from the
         document; nothing enforced it, and no real window is document-less.
         Now calls `plotWindowView(target)` directly, so the preview gate reads
         the same projection the canvas draws from by construction rather than
         by every writer's discipline. Measured against the commit's REAL
         parent `cd402c1b` (the export-cancel fix round, which sits between
         `95a211fc` and this work): 916,102 -> 916,102, 0 B. The fix agent
         first charged +515 B to this change by measuring against `95a211fc`
         — the ancestor-is-not-a-parent mistake a fourth time; the 515 B is
         `cd402c1b`'s own, recorded in its own bundle entry. Inlining
         `figureDocumentToPlotView(target.document)` instead of importing
         `plotWindowView` measured the same bytes; the import is kept rather
         than a duplicate, drift-prone reimplementation. Still 4,298 B under
         the unmoved 920,400 budget.
      3. The table's summary sentence overstated "every row above is decided by
         ONE function" — narrowed to every plot-WINDOW row, above.
      4. `windowCyclesSeriesStyles` — the one function this round's whole
         subject is about — had no direct unit test of its own; it was
         exercised only through its four callers. Added a dedicated block to
         `seriesStyleCycle.test.ts`: off; on with a pinning document (`null` and
         `[]`); on with each of the view-disagreement clauses in turn
         (`groupKey`, `facetKey`, `stackMode`, `polarMode`, `statMode`, and the
         X-also-in-`yKeys` case); and on with a clean view and no document.
      5. The bundle justification block measured against `dc0dbae9`, an
         ancestor two commits behind this commit's real parent `6797e77c` —
         repeating, in a new shape, the exact "ancestor is not a parent"
         mistake the block exists to police, and miscounting the second
         round's own history error as three commits rather than five. Rewritten
         against the real parent, measured here (see "Eager bundle" above).
      6. `useFigureBuilder.test.ts`'s unfocused-target pin built a window with
         `view: {…, polarMode:true}` and no `document` — a shape no real window
         can be in. Rebuilt with a document whose derived view is polar and a
         stale, non-polar `view` left on the record, so the pin actually
         exercises fix 2: a sibling case (stale `view` polar, document not) now
         proves the DOCUMENT wins, not whichever field happens to be read.

      Plus four nits: `lib/seriesStyleCycle.ts`'s header still said "the one
      residual" after the plan came to list two; `useStageSeriesCycle.test.ts`
      built a window record with `x/y/w/h` instead of `geometry`, through
      `as unknown as` — a shape `PlotWindow` does not have; the "three call
      sites... and a fourth spelled WRONG" text undercounted by one
      (`buildFigureSpecForView` was a fourth site that spelled it out, so it
      was four plus one wrong — fixed above); and the `[]` half of fix 3 — an
      empty `seriesStyles` array ships as `series_styles: []` on the wire — had
      no test, now pinned in `figureSpec.test.ts`.
  - ~~`contrastColor.ts` checks series-vs-BACKGROUND legibility only. Nothing
    checks series-vs-SERIES distinguishability under colour-vision deficiency;
    there is no CVD simulation anywhere.~~ **CLOSED as a CHECK (2026-09-13) —
    and the check FOUND the palette does not clear its own bar, which is now
    an OPEN OWNER DECISION.** `lib/cvd.ts` (pure, canvas-free) adds: CVD
    simulation for protan/deutan/tritan via the Machado, Oliveira & Fernandes
    (2009) severity-1.0 matrices applied in linear RGB; CIE76 ΔE in CIELAB;
    `seriesDistinguishability` (worst pairwise ΔE, per simulation, with the
    losing pair's indices); `distinguishabilityVerdict` (pass/fail against a
    documented default threshold of 10 — well above the ~2.3 ΔE "just
    noticeable difference" floor, sized for confident at-a-glance reading of
    thin plotted lines, not a side-by-side swatch comparison). Known-answer
    tests in `lib/cvd.test.ts` (11 cases as of round 2: red-vs-green contrast
    collapses under protan/deutan and mostly survives tritan; grey is
    invariant; a hand-built quartet's deutan-only-confusable pair is found
    correctly; fewer-than-2-colours is a non-vacuous fail, not a silent
    pass).
    `styles/seriesPalette.cvd.test.ts` is THE CHECK THAT MATTERS: it decodes
    the actual `--series-1..8` OKLCH tokens out of `styles/colors.css` (both
    themes' base blocks; a pure OKLCH decoder transcribed from the CSS Color
    4 spec's reference implementation, because the `canvas` package this
    repo's tests run on does not parse `oklch()` — verified directly, and
    documented in the test file so no one "fixes" it back to the silently-
    wrong canvas path) and runs the real audit. Series-vs-background
    legibility is reused (not reimplemented) via `contrastColor.ts`'s own
    `resolveDrawColor` and is unregressed. **Measured result: the shipped
    8-series cycle FAILS `distinguishabilityVerdict` (threshold 10) in BOTH
    themes** — dark theme's global worst is series-1 vs series-6 under
    deutan simulation (ΔE 3.23, versus ΔE 38.50 for that same pair under
    normal vision), light theme's global worst is series-5 vs series-7
    under deutan (ΔE ~1.98, i.e. below even the raw ~2.3 JND floor; light
    theme's own normal-vision worst pair, series-4 vs series-7, is already
    only ΔE ~6.62 before any CVD simulation is applied). Full per-simulation
    breakdown for both themes is in the test file's header comment and the
    closing commit body. Per this plan's stated policy, the failure is NOT
    hidden by loosening the threshold or silently reshuffling the palette:
    both audit assertions are kept as documented `it.fails` (a real palette
    fix must flip them back to `it`, or the ratchet catches the silent case
    where they start passing without anyone noticing).

    **Round 2 (2026-09-13, adversarial review of 07a05241):** the review found
    the decoder had no known-answer assertions (a broken decoder made the
    audit "fail as expected" for the wrong reason — fixed with pinned OKLCH
    known-answers plus the full dark/light hex lists in
    `seriesPalette.cvd.test.ts`), the `it.fails` audits had no floor (a
    palette regression that stayed failing would go unnoticed — fixed with
    non-`it.fails` companion floor tests at today's measured worst ΔE), and —
    the material finding — **the audit never covered `lib/palettes.ts`'s
    runtime presets, the actual remedy a user reaches for.** Table-driven
    coverage added there (`seriesPalette.cvd.test.ts`'s "shipped palette
    presets" describe block) measures all four: `okabe-ito` PASSES threshold
    10 (worst ΔE ~14.9, deutan) and serves as this suite's positive control
    for the threshold — independent, externally-documented CB-safe design
    clearing it comfortably is the strongest evidence 10 isn't arbitrary.
    `tol-bright` shipped `#4477AA` as BOTH series-1 and series-8 (an exact
    duplicate — 0 ΔE under every condition, including normal vision, not
    just a CVD failure); fixed by giving slot 8 `#332288` (indigo, borrowed
    from Tol's companion "muted" scheme — "bright" itself defines only 7
    colours and has no official 8th), which also newly PASSES threshold 10
    (worst ΔE ~13.2, tritan) — **superseded in round 3 below: `#332288` fails
    this app's own dark-canvas legibility floor.** `tableau10` and `viridis`
    failing at 10 is recorded, not fixed — neither claims to be CB-safe. The
    "color-blind-aware" provenance claim about the default palette ("several
    derive from Okabe-Ito") is dropped from this entry: nothing in the repo
    supports it, and the default's own measured numbers (ΔE 3.23/1.98
    worst-case) are far below Okabe-Ito's (~14.9), so the two are evidently
    not the same design.

    **Round 3 (2026-09-13, adversarial review of `48556a04`, round 2's fix
    commit):** the review found round 2's `#332288` choice fails
    `lib/contrastColor.ts`'s own dark-canvas legibility floor (MIN_CONTRAST
    2.2; measured contrast 1.54), so `resolveDrawColor` would silently
    substitute the ink token at render time and the legend would disagree
    with the canvas — the preset labelled CB-safe would never actually show
    the audited indigo. Fixed by re-picking slot 8 as `#999933` (Tol-muted
    olive): contrast 6.21 on dark / 2.85 on light (both clear 2.2), and the
    distinguishability verdict is unchanged (still worst ΔE ~13.2, tritan,
    series-1 vs series-3 — that pair never involves slot 8). The existing
    dark-canvas legibility guard (`seriesPalette.cvd.test.ts`'s
    "series-vs-background legibility" describe) is now extended to cover
    every `PALETTES` preset, not just the default theme tokens, as an
    explicit per-preset ratchet: a NEW substitution fails the suite; today's
    one pre-existing substitution (`viridis` slot 1, `#482878`, contrast
    1.65) is recorded, not fixed. Also fixed: the gamut-diagnostic header's
    claim that the naive clamp diverges from CSS Color 4 §13.2 was backwards
    — measured `deltaEOK(clip(origin), origin)` = 0.0179/0.0111/0.0111 for
    the three out-of-gamut light tokens, all under §13.2's own 0.02 JND, so
    §13.2 returns the clip unchanged and the naive clamp is spec-equivalent;
    the two `[approximate]` annotations and the "would move under spec-
    correct mapping" claim are removed, and the check is now a real
    assertion (`deltaEOK(...) < 0.02`) rather than prose. The
    `LIGHT_OKLCH`/`DARK_OKLCH` literals are now cross-checked against the
    tokens parsed from `colors.css` (previously independent, so an edit to
    one and not the other could silently audit a stale palette). The
    "this test does NOT change the palette" claim is narrowed to the
    default theme tokens — the tol-bright preset hex IS changed by this
    round, on the design owner's behalf (see below).

    **OPEN OWNER DECISION** (unchanged in substance, reframed by the above):
    the default 8-slot series cycle still fails its own distinguishability
    bar in both themes. What round 2 changes is that this is no longer a
    choice between "redesign the default" and "accept the gap" in a vacuum —
    **two PASSING CB-safe presets (`okabe-ito`, and now `tol-bright`) already
    ship one dropdown away** (`lib/palettes.ts`), so an immediate low-cost
    mitigation (default new users to one of them, or surface the CVD-safe
    presets more prominently) exists independent of any future default-
    palette redesign. Owner still needs to decide whether to redesign the
    default 8-slot cycle, narrow the "safe" simultaneous series count, make
    a CB-safe preset the default, or accept the default's gap as-is for a
    niche 8-series plot.

    **Also needs owner ratification (round 3):** `tol-bright`'s 8th slot is
    now `#999933` (Tol-muted olive) — chosen by this audit to fix a
    legibility bug (round 2's `#332288` failed the dark-canvas contrast
    floor), not by design-owner sign-off. Owner should ratify `#999933` or
    substitute a preferred distinct 8th hue that clears both
    `lib/contrastColor.ts`'s MIN_CONTRAST (2.2, both themes) and the ΔE-10
    distinguishability verdict — `seriesPalette.cvd.test.ts`'s "shipped
    palette presets" and extended "series-vs-background legibility" describe
    blocks will catch a regression on either axis if one is picked.
    **Round 4 (2026-09-14, light-canvas twin of the round-3 preset ratchet):**
    round 3's dark-canvas legibility ratchet covered every `PALETTES` preset
    only against the DARK axes background; a per-window override (`PlotBg`)
    can pin a window to the LIGHT background independent of the app's global
    theme, and that side was unratcheted. `seriesPalette.cvd.test.ts`'s
    "series-vs-background legibility" describe now adds the light-canvas
    mirror (`resolveDrawColor(hex, false)`), table-driven the same way.
    Measured, pre-existing, none introduced by this round: `okabe-ito` slots
    0/1/3/7 (contrast 2.12/2.18/1.25/1.81), `tol-bright` slots 3/4/6
    (1.84/1.73/1.81), `tableau10` slots 3/5/7 (2.16/1.52/1.86), `viridis`
    slots 6/7 (1.88/1.19) — all below the 2.2 floor, all recorded rather than
    fixed, matching the counts already noted in this test file's "Shipped
    palette presets" header comment (4/3/3/2). No preset colour changed. A
    companion assertion pins both the dark and light substitution tables
    verbatim so a future silent addition or removal on either canvas fails
    the suite instead of quietly changing what counts as "pre-existing".
    - [ ] Owner decision recorded above (P3.3 CVD default-palette gap).
    - [ ] Owner has ratified (or replaced) `tol-bright`'s `#999933` 8th slot.
  - ~~**No greyscale/print-safe export mode.**~~ **BUILT — a `greyscale`
    export option now exists, opt-in, EXPORT-ONLY.** What shipped, precisely:

    - **The field.** `FigureRequest.greyscale: bool = False`
      (`routes/export_figures.py`), forwarded into `render_figure`/
      `render_figure_map` (`calc/figure.py`). An EXPORT-ONLY divergence from
      the canvas by design: the on-screen plot stays coloured regardless —
      this is a user-chosen export transform, not a derived style, so it
      does not touch the P3.3 dash/marker-cycle parity invariant
      (`series_styles`/`overlayExportsSeriesStyles`) at all.
    - **The mapping** (`calc/figure_greyscale.py`, new, pure/no matplotlib
      import). NOT a naive per-colour luminance conversion — two series
      that differ only in hue (exactly what a categorical palette is built
      to keep apart) can sit at nearly the same relative luminance, so that
      approach can collapse two on-screen-distinct series into
      indistinguishable greys. Instead every series gets an EVENLY SPACED
      grey by DISPLAY POSITION alone, spanning CIE L* 15..70
      (`greyscale_ramp`), independent of its actual colour — a guaranteed
      minimum step regardless of how close the original hues were.
    - **The forced dash/marker cycle** (`apply_greyscale`). A grey ramp
      alone runs out of separable steps well before a realistic series
      count, so greyscale mode ALSO forces the P3.3 auto dash cycle
      (`solid → dashed → dotted`) by display position, and the marker-SHAPE
      cycle for any series that already draws a marker — the same
      `LINE_CYCLE`/`MARKER_SHAPES` vocabularies
      `frontend/src/lib/seriesStyleCycle.ts`'s `AUTO_DASH_CYCLE`/
      `AUTO_MARKER_CYCLE` use, copied verbatim and pinned equal by a test
      that reads the TS source directly (`test_calc_figure_greyscale.py`),
      so the two cannot drift apart unnoticed. Explicit per-series choices
      still win (an explicit `line`/`marker_shape` is kept, exactly like
      the frontend cycle's own contract); greyscale never turns a marker ON
      for a series that did not request one.
    - **Where it applies.** Every path that reaches `_render_impl`'s
      `series_styles` list: the flat single-panel render, the y2
      (secondary-axis) split, manual x-axis breaks, AND a `group_col`
      grouped-series request (whose `series_styles` is `None` today but
      still draws through the same `draw_series_axes` — greyscale still
      ramps it). Error bars and fills inherit their series' drawn colour
      automatically (`artist.get_color()`), so they follow the grey ramp
      with no extra code. A `color_by` colour-mapped scatter (MAIN #14) is
      passed through UNCHANGED, colourmap included — its colour IS the
      plotted quantity, not a categorical distinction, so forcing it grey
      would delete information rather than make the figure print-safe; this
      is a deliberate, documented residual, not an oversight.
    - **RESIDUAL — facets stay a no-op, honestly.** A faceted small-
      multiples request (`FigureRequest.facets`) renders through
      `calc.figure_facets`, which never resolves per-series colour at all
      today (FEATURE-001, `plans/BUGS_AND_ISSUES.md` — the screen's own
      facet grid draws default matplotlib colours too, so there is nothing
      for a per-series style to override). `greyscale` is therefore a
      documented no-op there: the route never threads it into the facet
      renderer, pinned byte-identical by
      `test_figure_facets_greyscale_is_a_no_op` (`tests/test_api_export.py`).
      Fixing this for real is FEATURE-001's job (screen AND export
      together), not this item's.
    - **REVIEW FIX (2026-09-13) — `/api/export/figure-page` was a silent
      no-op; `/api/export/map-figure` documented.** An adversarial review of
      this item (commit `bc8f14fa`) found `PagePanelSpec.figure` is this SAME
      `FigureRequest`, so `greyscale` was already part of the figure-page
      OpenAPI schema and 200'd, but `export_figure_page`
      (`routes/export_page.py`) never read `f.greyscale` and
      `calc.figure_page.PagePanel` had no such field — exactly the "silently
      doing nothing while looking wired" failure mode this item's own doc
      says it avoided, just on the sibling route. Fixed: `PagePanel.greyscale`
      (per panel, not page-wide — a page can mix a greyscale panel next to a
      coloured one), applied in `_draw_panel` via the same one-line
      `apply_greyscale` call `_render_impl` uses, before either the flat or
      the y2-twinx draw path. `/api/export/map-figure` (contour/heatmap/
      surface/**waterfall**) has no `greyscale` field at all and stays that
      way, now documented in its own field doc, `figures.ts`'s JSDoc, and
      pinned by a byte-identity test (an unrecognized `greyscale` key on that
      route's JSON body is silently ignored by pydantic, same result as
      never having sent it) — every `kind` there colours by a continuous
      z-value (`cmap`), the same "colour IS the plotted quantity" case this
      flag already leaves untouched for a `color_by` scatter, so there is no
      categorical palette for a print-safe ramp to replace. ~~**RESIDUAL —
      page-route greyscale is API-only today.**~~ **CLOSED.** The spatial
      page composer's "Export page…" dialog (`lib/exportPageCommand.ts`)
      now reuses `lib/exportFigureCommand.ts`'s own `GREYSCALE_FIELD`
      (never a duplicate definition) and threads the answer as ONE
      page-level choice onto EVERY panel's own `FigureSpec.greyscale`
      (`lib/spatialPageExport.ts`'s `SpatialPageAppearance.greyscale` ->
      `spatialPanelFigure`) — `PagePanel.greyscale` stays genuinely
      per-panel on the backend, but this dialog has no per-panel UI, so
      "on" means "on for the whole page". Omitted/false is byte-identical
      to before, mirroring the single-figure dialog's own wire convention.
      A facet panel would be a documented no-op (`FigureSpec.greyscale`
      never applies once `.facets` is set) — moot today since
      `spatialPanelFigure` never emits `.facets`. Tests:
      `exportPageCommand.test.ts` pins the field's presence (identical to
      `GREYSCALE_FIELD`) and the threaded/omitted wire value across every
      panel; `spatialPageExport.test.ts` pins the same at the request-
      builder layer. ~~**A SEPARATE residual remained — the two `PageDocument.output`
      export paths.**~~ **CLOSED 2026-09-14.** The Figure Page composer
      (`components/workshops/figurepage/`, its own export path with no modal
      dialog) and Library's export-a-saved-page-without-reopening
      (`components/Library/PagesSection.tsx`) now offer it. Greyscale is a
      PAGE-WIDE output setting on those paths: `PageOutputSettings.greyscale`
      (`lib/pageDocument.ts`), ADDITIVE (absent === off, no schema version
      bump — the same convention `createdAt`/`modifiedAt` use, and unlike
      `layout`'s v1->v2, since an
      older build ignoring the field still renders exactly what it always
      did). `sanitizeOutput` keeps only a literal `true`, and the composer's
      setter DELETES the key when unticked, so "off" has one canonical shape:
      a page toggled on and off again is byte-identical to one that never had
      it and does not read as dirty. The route is per-panel, so one shared
      pure helper (`lib/pageGreyscale.ts`'s `withPageGreyscale`, an identity
      when off) spreads `greyscale: true` onto EVERY panel's own figure spec
      for both paths — `buildPageSpecFromDocument` (Library's "export a saved
      page without reopening it", `components/Library/PagesSection.tsx`) and
      the Figure Page composer's `buildSpec`
      (`workshops/figurepage/usePagePreviewExport.ts`). Applying it inside
      `buildSpec` — the ONE spec-derivation path that feeds the file export,
      the debounced PNG preview and the clipboard copy alike — is deliberate:
      the preview is the same server route, so the on-screen page is the page
      that gets exported (`greyscale` joined the preview effect's dep list for
      that reason). The composer's control is one "Greyscale" checkbox beside
      the existing format/style/DPI controls (`FigurePageView.tsx`), and the
      flag rides the saved PageDocument, so a reopened page remembers it and
      Library's export-without-reopening honours it. Tests:
      `FigurePageView.test.tsx` (new — the checkbox at the DOM layer, both
      directions), `useFigurePage.test.ts` (export/preview/copy all carry
      `greyscale: true` on every panel, absence when off, the off-again key
      removal, and a save -> reopen persistence round trip),
      `PagesSection.test.tsx` (the saved page's own flag on every panel of the
      export request, and its ABSENCE when the page never turned it on), and
      `pageDocument.test.ts` (a pre-P3.3 document loads unchanged with the key
      absent; a saved `greyscale: true` survives the JSON round trip; `false`
      and junk both load as absent). The spatial close's review (2026-09-13)
      also found and fixed a vector-only defect: error-bar CAPS (`capsize=2`)
      kept a chromatic `fill: #1f77b4` in SVG/PDF output even in greyscale mode
      (invisible in raster only because the cap glyph's fill path happens to
      be degenerate) — `calc/figure_errorbars.py` now sets the cap markers'
      face/edge colour explicitly from the series' own (now grey) colour.
      **A second, latent fix riding the same change:** this also corrects the
      ORDINARY COLOURED case — before it, every series' cap FACE stayed
      matplotlib's default C0 regardless of that series' own colour, so a
      coloured multi-series vector export with error bars silently drew every
      cap in series 1's colour (measured: two series + error bars, coloured
      SVG, `fill:` hexes went from `{#1f77b4: 20}` to `{#1f77b4: 10, #ff7f0e:
      10}`). Pinned by
      `test_greyscale_error_span_caps_use_their_own_series_colour_when_coloured`
      (`tests/test_calc_figure.py`), a non-greyscale render.
    - **Frontend.** A "Greyscale (print-safe)" checkbox in the "Export
      figure…" dialog (`lib/exportFigureCommand.ts`, a `ParamField` of
      `type: "boolean"` — the Export-figure dialog's own first boolean
      field; `ParamDialog`/`ParamFields` already rendered `type: "boolean"`
      for three other production call sites (`LibraryDetails.tsx`,
      `BookFamiliesSection.tsx`, `worksheetTransformCommands.ts`) before this
      one, so review finding F7 narrowed the claim to the dialog it is
      actually true of), titled with the export-only-divergence warning
      verbatim. Threaded through `FigureRenderOpts.greyscale`
      (`lib/figureSpec.ts`) onto the wire only when true (`{ greyscale: true
      }` spread) — omitted/false is byte-identical to before this option
      existed. Review finding F8: this truthiness-gating convention is NOT
      "matching every other optional boolean field's own convention" as
      originally claimed here — the nearest analogue, `transparent`
      (`figureSpec.ts`), gates on `undefined` instead and DOES send
      `transparent: false` on the wire. greyscale's own convention (omit
      when false) is deliberate and correctly pinned by `figureSpec.test.ts`;
      the two fields are simply not aligned, and that is fine. NOT persisted: the
      dialog does not persist `fmt`/`style`/`dpi`/labels across opens
      either (every field re-defaults each time it opens), so `greyscale`
      mirrors that — no new store, per the design brief's own instruction.
      Classified `unsupported` (not `output`) in `figureContract.ts`'s
      FigureSpec census: it is a per-export dialog choice, never part of a
      saved FigureDocument's canonical/output state, so a document's own
      `series_styles`/`overrides` stay the RAW authored (coloured) choices
      regardless of whether any one export of it happened to be greyscaled.
      "Copy figure"/"Copy figure (vector)" — which render with no dialog at
      all, by design — do not gain a greyscale option; that is consistent
      with those commands never exposing `style` either.
    - **Tests.** Backend: `tests/test_calc_figure_greyscale.py` (ramp order/
      min-step/pinned values, `apply_greyscale`'s explicit-wins/no-op-for-
      color_by/never-mutates behaviour, the frontend-vocabulary drift
      guard) plus render-level assertions in `test_calc_figure.py` (a
      greyscale PNG differs from the coloured one; every SVG stroke is
      achromatic; three unstyled series produce >=2 distinct
      `stroke-dasharray` patterns; the facets no-op). Frontend:
      `figureSpec.test.ts` pins `greyscale: true` on the wire when opted in
      and its ABSENCE when off or omitted, through both the live-view and
      document-routed builders; `ParamDialog.test.tsx` gained the dialog's
      first-ever boolean-field coverage (unchecked default, click-to-toggle,
      the hint surfacing as the label's title); `exportFigureCommand.test.ts`
      pins the command threading the dialog's answer onto the wire.
      **Review-fix pass (2026-09-13) added:** figure-page route-level tests
      (a panel's bytes/SVG differ with `greyscale: true`, mixed
      grey+coloured panels on one page both render correctly); a
      `map-figure` no-op byte-identity test (mirrors the facets one); a
      real `group_col`/y2/x_breaks route-level greyscale test each (the prior
      `group_col` "coverage" called `render_figure` directly, the SAME path
      the flat-series test already covered — it never actually went through
      the route's `group_col` branch, so it proved nothing extra); a
      greyscale + `error_spans` and a greyscale + `fill` route test; and
      `test_greyscale_explicit_line_style_is_kept` now asserts the actual
      dashed pattern is present for an explicit-line series AND that a
      same-position series with NO explicit line renders solid (LINE_CYCLE's
      position 0) — deleting the explicit-wins check silently reverts the
      explicit series to solid too, which the old "some dasharray exists
      somewhere" assertion could not detect (LINE_CYCLE's other positions
      already guarantee a non-empty dasharray regardless).
      **Round-2 review-fix pass (2026-09-13) added:** the stroke-only
      achromatic guards (`test_greyscale_svg_every_stroke_is_achromatic`,
      `test_greyscale_applies_when_series_styles_is_none`, and
      `test_api_export.py`'s shared `_assert_only_achromatic_strokes`) now
      check `fill:` as well as `stroke:`, closing the same fill-blind-spot
      F6 fixed for the two error-bar/fill unit tests but had left open on
      every route-level (group_col/y2/x_breaks/figure-page) and default
      3-series path; the cap-colour test above pins the non-greyscale
      latent fix; and a figure-page facet-panel byte-identity test
      (`test_figure_page_facet_panel_greyscale_is_a_no_op`) closes the one
      of the three documented facet no-ops that had no guard.

  Two things the audit turned up on the way. One was a real bug and is FIXED;
  the other looked like a bug, was investigated properly, and turned out to be a
  MISSING FEATURE whose "fix" would have made things worse. Both are recorded
  because the second is the more useful record.

  **FIXED — exported markers were always filled circles.** `calc/figure.py`
  hardcoded `kw["marker"] = "o"`, so all eight on-screen `MarkerShape` glyphs
  collapsed on export while the canvas drew them correctly
  (`uplotOpts.ts`'s `markerPaths`). That is a genuine screen-vs-export parity
  break. Now a `_MARKER` table, with `marker_shape` actually SENT by
  `lib/exportStyles.ts` — the backend half alone would have been dead code. It
  is emitted inside `buildExportStyles`, so every producer (spatialPageExport,
  legacyFigure, useGraphTemplates, plotSpecFigure) gets it. An unrecognized
  shape falls back to a circle, matching `line`/`step`'s existing
  degrade-gracefully contract.

  **NOT a bug — per-series styling is unimplemented for facets END TO END, and
  the export was consistent with the screen.** The audit reported that a faceted
  export "silently dropped every per-series style"
  (`calc/figure_facets.py` passes a hardcoded `None` where the flat path passes
  the style spec). True, and I built the fix. Two rounds of review then
  established that shipping it would have been a regression:

  1. **The first fix was misaligned.** `series_styles` is indexed by `y_keys` ==
     the frontend's hidden-FILTERED, `seriesOrder`-REORDERED `plotted` list,
     while facet panels are built from the RAW `st.yKeys`. An existing passing
     test (`figureSpec.test.ts`'s all-hidden facet case) already showed them
     diverging. A delegated agent caught this and refused to wire it — correctly.
  2. **The second fix was ALSO misaligned, and worse than expected.** Sending a
     separate list built from the facet's own channels still fails when
     `st.yKeys` is null, because `buildColumns` re-runs the `defaultDenseChannels`
     DENSITY heuristic on each row-sliced panel. Measured directly on a
     QD-shaped fixture (M_DC finite only on level-0 rows, M_AC only on level-1):
     panel 0 resolved `[level, M_DC]`, panel 1 resolved `[level, M_AC]` — the
     panels differ from the whole-dataset list AND from each other, so no single
     style list can serve the grid at all.
  3. **And the premise was inverted.** `useMultiPanelStage.ts`'s facet branch
     passes NO `seriesStyles` to `buildOpts`, so the ON-SCREEN facet grid draws
     default lines too. The export was not losing something the screen showed;
     both ignore per-series styling. Making only the export honour it would
     create a NEW screen-vs-export divergence — the exact invariant
     `figureSpecFacets.ts` documents ("renders the SAME faceted grid Stage
     shows").

  So the work was reverted rather than shipped, and the real item is filed as
  **FEATURE-001: per-series styling for faceted plots**, which must land on the
  screen and the export together and must first decide what a small-multiples
  grid does when panels resolve different channels (arguably it should pin one
  channel set for every panel — comparing like with like is the point of small
  multiples — but that is a product decision, not a silent one).

  Kept from the attempt: the `docs/testing.md` lesson it produced (a monkeypatch
  that passes alone and fails under `-n auto` is usually a patch that never
  applied, because `from x import f` binds at import time).
- [ ] Windows/macOS scaling and high-DPI readability.
- [x] Reduced motion — **verified complete 2026-09-09; the box was simply
  stale.** Two independent sources, either sufficient on its own: the OS
  setting (`@media (prefers-reduced-motion: reduce)`) and the in-app
  Preferences ▸ Appearance switch (`[data-reduce-motion]`, set by
  `store/prefs.ts`). Both apply the SAME four declarations
  (`transition-duration`, `animation-duration`, `animation-iteration-count`,
  `scroll-behavior`) through the UNIVERSAL selector plus `::before`/`::after`
  in `styles/index.css` — deliberately universal, since enumerating animated
  selectors is what left five of the seven motion declarations uncovered
  originally, and a new transition (or one inside a dependency's stylesheet)
  is covered without anyone remembering to add it.

  Pinned by `styles/reducedMotion.test.ts`, which asserts on the STYLESHEET
  SOURCE rather than a rendered page, because jsdom does not evaluate
  `@media (prefers-reduced-motion)` — a DOM test there would pass whatever the
  CSS said, which is the kind of vacuous coverage this plan keeps rejecting.
  It checks both sweeps and that they carry the same declarations, so the two
  cannot drift apart. `store/diagnostics.ts` also reports the OS setting in the
  diagnostic bundle.

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
- [x] **Server-side plot-payload decimation** (the pre-authorized second
  half of the point-reduction follow-up — "server-side payload decimation
  second only if still needed": it IS needed): `/api/plot/series` ships
  **78 MB of JSON** for 1M×7, whose network+encode+parse (~2–5 s) is now
  the measured remaining term in both window-mount (~3.8 s) and restore
  freeze (~3.7 s vs the 1.5 s target). Decimate at the route/pure layer
  to what the client will draw (the min/max bucketing contract
  `lib/downsample.ts`/`plotDecimate.ts` already define), with a
  full-resolution opt-out for analysis consumers — audit who reads the
  payload besides the plot before changing the default. **SHIPPED** (see
  the "P3.4 second half: server-side plot-payload decimation"
  Completed-log entry below, `ca80a4c`/`d775100`, zoom residual closed
  `232cf4f`): `routes/plot.py` takes `decimate_width` + `full_resolution`
  and refuses non-ascending x; pure `calc/decimate.py` mirrors
  `plotDecimate.ts`'s min/max-bucket semantics; consumed by
  `Stage/usePlotPayload.ts`, `Stage/useMultiPanelStage.ts`, and
  `lib/plotdata.ts`'s `fetchPlot`. 147.5 → 3.49 MB JSON at 1M×7 (~93×).
  Re-verified 2026-09-09: `tests/test_calc_decimate.py` +
  `tests/test_api_plot.py` — 54 passed, 1 skipped;
  `usePlotPayload.test.ts` + `lib/plotdata.test.ts` — 116 passed.
- [x] ~~**Slice 5 — export cancel**~~ SHIPPED 2026-09-13 (the audit's
  remaining "export" gap from the 2026-07-26 evidence table — import and
  the DREAM/bumps fit already had cancel). CSV/HDF5 export, figure export,
  Origin (.ogs) export, and figure copy (PNG + vector SVG) all route
  through the shared `lib/exportActive.ts` chokepoint, which now registers
  a cancellable pendingOps entry the same way `runImport` (slice 1) does:
  one `AbortController` per call, a StatusBar Cancel button via
  `beginOp`/`endOp`, `controller.signal.aborted` (never the shape of a
  caught error) deciding "this was a cancel". The spatial "Export page…"
  composer (`lib/exportPageCommand.ts`) does not route through
  `exportActive` (N panel datasets + its own params dialog, not one active
  dataset) so it wires the identical AbortController/pendingOps shape
  itself rather than a second mechanism. `signal?: AbortSignal` threaded
  through `postJSON`/`postForm`'s existing pattern into `postBlob`/
  `postDownload` (`lib/api/http.ts`). **Corrected 2026-09-13** (adversarial
  review): NOT "every export wrapper that calls them" as originally
  claimed here — only 5 of the 16 `postDownload` call sites across the
  frontend actually take a `signal` (the ones this slice's own commands
  use: `lib/api.ts`'s xrd-csv/hdf5/origin wrappers, `lib/api/figurePage.ts`'s
  `exportFigurePage`, `lib/api/figures.ts`'s `exportFigure`). The other 11
  `postDownload` sites — `lib/api/exportMultivar.ts` (4), `lib/api/
  report.ts` (1), and 5 more in `lib/api/figures.ts` (corner/ternary/field/
  statplot/categorical) — plus every consuming component that calls one of
  them without ever building an AbortController to pass, stay uncancelled;
  see the acceptance-criteria bullet below for the full residual list.
  HONEST RESIDUAL: `routes/export*.py` (`export.py`,
  `export_figures.py`, `export_page.py`) are synchronous `def`s with no
  `Request` parameter or disconnect check, so the backend renders to
  completion regardless of a client abort — cancel is "stop waiting and
  discard the result," not "stop the server," for every export kind. That
  result can never be written late: `postDownload`/`postBlob` re-check the
  SAME signal synchronously, right before `saveBlob`/returning the blob
  (no `await` in between), closing the race where the response lands the
  instant Cancel is clicked — covered by `lib/api/http.test.ts`'s
  abort-race-guard tests. "Send to Origin (COM)" and "Export consolidated
  CSV" (`commands/fileCommandsLazy.ts`'s `runSendToOrigin`/
  `runExportConsolidated`) are bulk, multi-dataset operations with no
  single active-dataset chokepoint to hang cancel off, and are left
  uncancelled — a deliberate carve-out, not an oversight, matching slice
  1's own "import wizard `importParse` left unwired" precedent. Tests:
  `lib/exportActive.test.ts` (new, the shared mechanism), kind-specific
  cancel cases added to `lib/exportFigureCommand.test.ts` (figure),
  `lib/exportPageCommand.test.ts` (page), `lib/copyFigureCommand.test.ts`
  (copy-to-clipboard), the abort-race guard in `lib/api/http.test.ts`, a
  double-pendingOps-registration regression guard in
  `commands/fileCommands.test.ts`, and a DOM-level StatusBar integration
  test in `components/Shell/StatusBar.test.tsx`. Bundle: moving
  `export-csv`/`export-hdf5`/`export-page`'s command bodies to the same
  click-only dynamic-import pattern `export-figure`/`export-origin`
  already used took `lib/exportActive.ts`/`lib/exportPageCommand.ts`
  (and this slice's own growth) off the eager path entirely — eager JS
  measured 920,089 → 915,638 B after `npm ci` (net DOWN despite the new
  cancel machinery), budget unchanged at 920,400 B.

Original acceptance criteria (unchanged):

- [~] Consistent progress location and job identity. **Narrowed
  2026-09-13:** slices 1-4 gave import, command-palette actions, and
  workspace open ONE shared location (`StatusBar.tsx`'s `.qzk-pending`
  span reading `store/pendingOps.ts`) and ONE identity scheme (`OpId`, a
  monotonic `beginOp`/`endOp` sequence number). Verified NOT extended to
  the job-queue path: `useBumpsFit.ts` keeps its own `progress` state and
  `job_id` (`jobRef`, from `lib/jobs.ts`'s poll loop), rendered only inside
  `BumpsSection.tsx`'s own panel — `StatusBar.tsx` imports only
  `usePendingOps` and never reads a job-queue id, so a DREAM/fit-scan job's
  progress and identity are invisible to the shared location. Two
  progress systems coexist, not one; box stays open for that specific gap.
- [~] Safe cancel for long import/fit/batch/export. **Narrowed 2026-09-13**
  (adversarial review of the export-cancel commit): import (slice 1) and
  the DREAM/bumps fit shipped earlier and are unaffected. Export cancel
  shipped above (slice 5), but only at the File-menu single-dataset export
  chokepoint (`lib/exportActive.ts`: CSV/HDF5/Origin export + figure copy)
  and the spatial "Export page…" command (`lib/exportPageCommand.ts`) —
  with the honest caveat already recorded: cancel means "stop waiting,
  discard the result," since the export routes don't honor a client
  disconnect server-side (and — new this round — a sync route occupies one
  of the backend's ~40 anyio threadpool workers to completion regardless,
  so repeated cancels of a slow render can saturate it faster than the
  client-side UI suggests). Two carve-outs were already named (Send to
  Origin COM, Export consolidated CSV); this round's review found the rest
  of the surface was neither wired NOR named. The full residual — every
  `postDownload`/`postBlob` call with no `signal` and no `pendingOps` entry
  — stays uncancelled and untracked: `components/workshops/figurepage/
  usePagePreviewExport.ts:204,235` (the Figure Page composer's OWN export +
  clipboard copy — the longest render in the app, and the most-requested
  cancel target of anything on this list), `components/workshops/
  figurebuilder/previewExport.ts:53,77`, `components/Library/
  PagesSection.tsx:37`, `lib/api/exportMultivar.ts:31,54,80,98`, `lib/api/
  figures.ts:169,188,210,265,309` (recounted 2026-09-13, round-2 review N7 —
  this same commit's own doc edits to that file shifted these by a few
  lines and the citation was not re-measured), `lib/api/report.ts:37`,
  `components/Library/MultiSelectBar.tsx:83`,
  `components/Stage/useStatStage.ts:485`.
  None of these registers a `pendingOp`, so none shows a Cancel control or
  even a busy indicator today — this is a partial win on the acceptance
  criterion, not the full one. **Narrowed further 2026-09-13 (round-2
  review, F1):** even inside the wired chokepoint, a clipboard copy (Copy
  figure / Copy figure as SVG) is not actually cancellable once its render
  blob is produced. `postBlob`'s own signal check (`lib/api/http.ts`) and
  `lib/clipboard.ts`'s `copyImageAsync`/`copySvgAsync` re-check close the
  race only up to the point the `ClipboardItem` is CONSTRUCTED — one
  microtask after the render settles — not at the browser's own read of
  that value promise or its actual write, for which there is no JS hook on
  any engine. Cancel clicked after that point still stops the STATUS from
  lying (fixed the same round: `exportActive.ts` no longer reports "copy
  cancelled" when the write already went through) but does not, and cannot,
  stop the clipboard write itself. Also found and left as a named residual
  rather than fixed (F5/N6): the same unguarded `void import(...)` shape
  F5 fixed via `runLazy` in `commands/fileCommands.ts` survives at
  `components/Stage/usePlotStageActions.ts:134,140` (Copy figure / Copy
  figure as SVG — the same P3.4 export/copy surface, just routed through a
  different File menu), `components/Library/MultiSelectBar.tsx:83`,
  `components/Library/PagesSection.tsx:82`,
  `components/Library/EditableFiguresSection.tsx:67`,
  `components/windows/useWindowCommands.ts:190`, and the three startup
  loads in `App.tsx:82,101,146` (recipe hydration and the two lock
  providers) — a failed chunk load at any of these is still a silent no-op
  plus an unhandled-rejection console warning. (`store/recordRecipeUse.ts`
  is NOT on this list: it carries its own explicit `.catch` with a
  fire-and-forget rationale, so its failure is a deliberate silent no-op.)
- [~] Errors say what failed, whether data changed, and next action.
  **Audited 2026-09-14, census corrected in the 2026-09-14 review round** —
  intended as the whole user-facing failure surface, not a sample; the first
  pass fell short of that by construction (below), fixed in this pass.
  A single-line `grep` over `frontend/src` excluding tests found **132**
  `toast(…, "danger")` call sites. That grep structurally cannot see a call
  wrapped across lines — and this pass's own `ReportPanel.tsx` fix (below) is
  exactly that shape — so it is not "the whole surface" on its own. A
  brace-matched scan (walks `toast(` to its matching close-paren; written for
  this pass, kept under the scratchpad rather than the repo) found **7** more,
  for **139** total. Two of the seven have a conditional kind
  (`components/Library/folderOps.ts:183`, `components/workshops/pipeline/
  useTemplates.ts:153`); the other five were unlisted before this pass —
  `store/figureLifecycle.ts:289`, `store/dataIntake.ts:101`,
  `lib/plotSelectedTogether.ts:57`, `commands/projectLockCommands.ts:40`, and
  `components/workshops/report/ReportPanel.tsx:148` (this pass's own fix,
  listed in the FIXED table below) — with rubric verdicts for the first four
  added below.

  Separately, **263** total `setStatus(` sites. **83** ("of which 34 sit
  beside a toast built from the same `msg` variable — this codebase's
  established shape, one message/one status line/one toast, see
  `store/workbookTransfer.ts`'s `fail()` — and 49 status-line-only") is a
  CLASSIFICATION against the rubric below, not a grep figure — the previous
  wording of this box implied it had the same "measured by grep" provenance
  as the 132/139, which is not reproducible with one grep. The reproducible
  grep bounds it is built from: **52** `setStatus(` sites whose own line
  carries failure wording (`fail|error|could not|unable|refus|cannot|
  unavailable|invalid|nothing`, case-insensitive; corrected in the 2026-09-14
  re-review — **60** only reproduces against the paren-less `setStatus`
  pattern, a 334-site superset that also counts declarations, types and
  comments, not the 263-site `setStatus(` figure this box is about) and
  **26** inside a brace-matched `catch` block. **52 corrected to 51 in the
  round-3 re-review**: `grep -rn` prefixes every output line with
  `path:lineno:` before the pattern is matched, so a file whose PATH
  contains a failure word inflates the count — `components/Inspector/
  ErrorRolesCard.tsx:126`'s own `setStatus(` line carries no failure wording
  (its message is on the following line) and matched only on "Error" in the
  filename. Reproducible method: strip the `path:lineno:` prefix before
  matching (`grep -rnE 'setStatus\(' … | grep -v '\.test\.' | sed
  's/^[^:]*:[0-9]*://' | grep -icE '…'`), or equivalently `grep -rhE` (no
  filename) in place of `-rnE`.

  Rubric, because "all three facts in every message" would be noise in most of
  them:
  - **(a) what failed** — the message names the OPERATION, not only the
    underlying error. A bare `e.message` FAILS this: `lib/api/http.ts`'s
    `ensureOk` throws the backend's `detail` or, failing that, the status line,
    and `fetch` itself throws `TypeError: Failed to fetch` — so the user can be
    shown "500 Internal Server Error" with no hint of what they had clicked.
  - **(b) whether data changed** — required EXPLICITLY where the operation's
    target is data or a file the user ALREADY HAS (save over a project,
    re-import over a dataset, a batch that is part-way through), i.e. where
    "did I just lose or half-change what I had?" is the question the message
    leaves open. Satisfied structurally, and not demanded in the text, for a
    precondition refusal (nothing was attempted) or an operation that can only
    add (a failed merge creates nothing) or only read (export, copy, report,
    preview). One sharper line inside the save flow: only the path where the
    write was actually ATTEMPTED (`store/workspaceIO.ts:444`) leaves the
    "is my existing file damaged?" question open; the gates that refuse before
    the write — `:77/:95` (books still loading), `:212/:241/:257/:297`
    (backend refusal), `:368/:381` (read-only / offline), `:429/:440` (lock
    lost) — answer it by saying the save was refused.
  - **(c) next action** — required where the user can do something. Recorded
    EXCEPTION class: a transient backend or chunk-load failure whose only
    remedy is retry, raised from a control still on screen — the affordance IS
    the next action, and "try again" appended to forty messages is noise
    rather than guidance.

  Every site was classified against that rubric. The ones that FAILED are
  listed below; the rest pass through its structural clauses — refusals that
  are themselves the instruction ("select at least 2 datasets first", "Find
  (or fit) peaks before labeling.", `store/figureLifecycle.ts`'s "publication
  figure was not found; no editable copy created"), and read-only failures
  that name the operation ("export page failed: …", "clipboard image
  unavailable — use Save as PNG or Export figure"). Two sites already carried
  all three facts and were used as the model for the fixes:
  `store/reimportAllRun.ts:410` ("reimport all: N problems — nothing changed")
  and `components/Stage/worksheet/useWorksheetBlockOps.ts:165` ("clipboard
  unavailable — nothing was cut").

  Four more, brought in by the brace-matched re-scan above (multi-line, so the
  original single-line grep missed them) — all PASS, added here rather than
  to the FIXED table:
  - `store/figureLifecycle.ts:289` — "the plot changed while previewing —
    Cancel and reopen Publication Preview to pick up the changes." Names the
    state (the preview target changed) and the recovery (Cancel + reopen);
    the session's draft is untouched, satisfying (b) structurally the same
    way a precondition refusal does.
  - `lib/plotSelectedTogether.ts:57` — "need at least N plottable datasets to
    overlay…". A precondition refusal (nothing was attempted) that is itself
    the instruction, same class as "select at least 2 datasets first".
  - `commands/projectLockCommands.ts:40` — "Take Over Editing is not
    available — the other instance is still responding" / "nothing to take
    over — this project is not locked by another instance". Both branches are
    precondition refusals naming the reason; nothing is attempted either way.
  - `store/dataIntake.ts:101` — "couldn't load full data for "<name>" —
    <why>". Names the operation (loading that dataset's full data); falls
    under the recorded retry exception for (c) since `ensureBookData` is
    re-triggered the next time the pending dataset is touched. NOTE: this
    site's message embeds the dataset NAME — evidence for, not against, the
    toast-ring redaction rationale in the diagnostics-bundle box below,
    which is exactly why that ring never recorded message text.

  FIXED this pass — message text only; no flow, no control flow, no new state.
  Each says a fact the code already guaranteed and simply did not voice:

  | Site | Missing | Now says / test |
  |---|---|---|
  | `store/importDatasets.ts:456` (the toast call — corrected 2026-09-14 review round, was cited at the comment above it) | (b) | `imported 1/2 — failed <file>: <why> — try the Import wizard`. The status line already said "imported 1/2"; the TOAST — what actually appears over the stage — named only the broken file. `importDatasets.test.ts` › "the failure toast carries the imported count, not just the failure". |
  | `store/workspaceIO.ts:451-453` (msg + setStatus + toast — corrected 2026-09-14 re-review, the prior correction's 451-452 range covered msg+setStatus but dropped the toast line) | (b) | `save failed — could not write to <path>; the file on disk is unchanged (try Save As)`. `runSaveWorkspace`'s own header had already promised this sentence — "the atomic temp-file-plus-`os.replace` write (desktop_bridge.py) already guarantees the previous good file on disk is untouched, so the only job left here is to say so plainly" — and the message never said it. `workspaceIO.test.ts` › "surfaces a clear error and does NOT fall back to a browser download when the write fails" (extended to all three facts). |
  | `store/reimport.ts:335` (the toast call — corrected 2026-09-14 review round, was cited at the comment above it) | (b) | `re-import "<name>" failed: <why> — the dataset is unchanged`. True by construction: `applyReimportMerge` is the last STORE-MUTATING statement of the `try` (the comment originally said "the LAST statement", which is wrong — a `setStatus`/`toast` follow it; neither touches the store), so any throw lands before the store is touched. Re-import exists to overwrite data the user already has, which is exactly what makes "failed" alone unreadable. `reimport.test.ts` › "a failed re-import says the dataset is unchanged, and it really is". |
  | `store/useApp.ts:1712` | (a), (b) | `could not merge the selected datasets: <why> — nothing was added` (was a bare `e.message`). `addDataset` runs after the throwing call. |
  | `store/dataIntake.ts:175-177` (msg + toast — corrected 2026-09-14 review round, was cited at the comment above them) | (a), (b) | `could not create a dataset from the pasted text: <why> — nothing was added` (was a bare parser message). `useApp.test.ts` › "surfaces the backend's error message and adds nothing on a parse failure" (extended). |
  | 9 × "Add to report" — `components/Stage/useGadgetChip.ts`, `components/workshops/{variability,peaks/PeaksPanel,curvefit,tabulate,peakwizard,statschooser,fityx,distribution}` | (a) | `could not add to report — <why>` (all nine were a bare `e.message`, so an HTTP failure reported itself without ever mentioning reports). |
  | `components/workshops/report/ReportPanel.tsx:148` | (a), (b) | `could not export the report as <format> — <why>; nothing was saved`. |

  REMAINING — not reachable by a message edit, so this box stays open:
  - `components/workshops/roicuts/useRoiBatch.ts:265` — "batch failed: …" is
    the OUTER catch of a loop that has already landed `newIds` datasets. It can
    honestly claim neither "nothing changed" nor a count without the flow
    handing it the partial outcome.
  - `components/workshops/peaks/usePeaks.ts:466` — "labeling peaks failed" is
    raised from inside `withHistoryBatch`, where some annotations may already
    have been added; same shape, same reason it is not a rename.
  - `store/recalcDatasets.ts:107,122` — "derived worksheet recompute failed" /
    "recalculation failed" say nothing about which worksheets took the new
    values and which kept the old ones.
  All three need the operation to report its own partial outcome — a flow
  change, and the shape `store/reimportAllRun.ts:410` already has.
- [x] Copyable diagnostic bundle excludes raw/private data by default.
  **Verified shipped 2026-09-14** (it landed with #267/#268 and their
  follow-up reviews; the box was simply never ticked). Help ▸ Copy diagnostics
  → `commands/uiCommands.ts` → `store/diagnostics.ts` (the impure collector,
  dynamically imported so none of it is on the eager path) → `lib/diagnostics.ts`
  (a pure renderer over an explicit `DiagnosticsSnapshot`). The exclusion is
  STRUCTURAL rather than filtered: a field absent from that type cannot be
  collected, and `lib/storageKeys.ts` plus the storage-key ratchet in
  `architecture.test.ts` stop even a `localStorage` KEY name from becoming a
  back door. Tests: `store/diagnostics.test.ts` › "omits the dataset name,
  column label, path and both kinds of cell value" — a real store holding a
  distinctive numeric value, a distinctive TEXT cell, a collaborator's compound
  as a column label and an absolute source path, none of which (nor the
  directory part, nor the basename) reaches the output — with "still describes
  THAT dataset by shape, so the exclusion test is not vacuous" as its
  non-vacuity companion; `components/Shell/copyDiagnosticsMenu.test.tsx`
  asserts both properties of the bytes that actually reach the clipboard when
  the REAL Help menu item is clicked (neither pure-module test would catch a
  command wired to `JSON.stringify(useApp.getState())`); `lib/diagnostics.test.ts`
  holds the renderer's own redaction and usefulness cases.
  EXTENDED the same day, since a bundle that cannot say what state the session
  was in is half a bug report: the backend identity from `/api/health`
  (`{app, version}` — the launcher's existing handshake route, so no new
  endpoint; "unreachable" when nothing answers, which is itself an answer), and
  a Session-health section — autosave ok/FAILING, generations kept,
  last-autosave age, whether a recovery prompt is open, operations in flight,
  and notification counts with the age of the last error.
  DELIBERATE DEVIATION, recorded because it is the interesting half: the last N
  toast/status MESSAGES are NOT included, and neither is the autosave failure
  reason. Message text in this app IS project content — the audit table above
  is the evidence, message after message embedding a dataset name, a column
  label or an absolute source path. `store/toasts.ts` therefore keeps three
  content-free, monotonic counters (`totalCount`/`errorCount`/`lastErrorAt`,
  corrected from a bounded `{kind, at}` ring in the 2026-09-14 review round
  below — a ring is a window, not a total, and could under-report both), which
  answer the triage question ("were errors firing, and how recently?") and
  cannot leak by construction rather than by review. The wording stays on
  screen, where the user can read it and quote it deliberately.

  **Review round, 2026-09-14** (a later pass over the same-day P3.4
  diagnostics-bundle commit): adversarial review found 2 CONFIRMED issues, 1
  PLAUSIBLE, and 8 nits, all fixed in one follow-up commit. Findings and
  fixes:
  1. **CONFIRMED — the notification ring could under-report both counts.**
     `store/toasts.ts`'s old `{kind, at}[]` ring evicted past `MARKS_MAX = 50`
     entries; a `"danger"` push followed by 50 later `"ok"`/`"info"` pushes
     evicted it, so `errors`/`lastErrorAgeSec` read `0`/`never` even though an
     error really had fired, and a 500-push burst reported `total 50` with no
     way to tell "exactly 50" from "500, 449 evicted". Fixed: `totalCount`,
     `errorCount`, `lastErrorAt` are monotonic scalars incremented once per
     `push` and never trimmed; the ring is gone (nothing else read it).
     `lib/diagnostics.ts`'s doc updated to match (the `NotificationMark`
     reference no longer exists).
  2. **CONFIRMED — the danger-toast census was grep-shaped and missed 5
     multi-line sites (139 real total, not 132).** A single-line `grep` for
     `toast(…, "danger")` cannot see a call wrapped across lines, and this
     same commit's own `ReportPanel.tsx` fix was exactly that shape. A
     brace-matched scan (kept under the scratchpad, not the repo) found 132
     single-line + 7 multi-line = 139 sites; 2 of the 7 were already noted
     (conditional kind); the other 5 — `store/figureLifecycle.ts:289`,
     `store/dataIntake.ts:101`, `lib/plotSelectedTogether.ts:57`,
     `commands/projectLockCommands.ts:40`, and this commit's own
     `ReportPanel.tsx:148` — are now in the audit table above with rubric
     verdicts (all PASS). The "83 failure `setStatus(` sites" figure was also
     presented as "measured by grep" when it is a classification; the box
     above now says so and gives the reproducible grep bounds (263 total / 52
     failure-worded / 26 in catch blocks — corrected from 60 in the 2026-09-14
     re-review below, see nit 4 there).
  3. **PLAUSIBLE — an awaited network probe sat between the click and the
     clipboard write.** `diagnosticsText()` used to `await probeBackend()` (a
     fresh `/api/health` fetch, up to 1.5 s) on every "Copy diagnostics"
     click — the same hazard `lib/clipboard.ts` already documents for the
     PNG-copy path (an awaited round-trip can drop the transient
     user-activation `navigator.clipboard.writeText` requires), and one that
     degrades exactly when the backend is slow or hung, i.e. the situation
     this bundle exists to report. Fixed: `App.tsx`'s existing startup
     `health()` call now also records the result into a new, deliberately
     tiny `store/backendHealth.ts` module (kept separate from
     `store/diagnostics.ts` so `App.tsx` does not drag that whole
     dynamically-imported chunk into the eager bundle); `collectDiagnostics`/
     `diagnosticsText` read it back synchronously and `probeBackend` plus its
     1.5 s timeout are deleted outright — no sync fallback needed one, since
     the startup probe runs at startup; a click before it answers reads "not
     yet answered" (corrected in the 2026-09-14 re-review below — the
     original wording, "already runs before any click is possible", conflated
     STARTING with ANSWERING). `lib/api.ts`'s `health()` return type widened
     from `{status}` to `{status, app?, version?}` so `App.tsx` has the data
     to record.
  4. NITs fixed: control characters stripped/length-clamped from the echoed
     backend `app`/`version` (`lib/diagnostics.ts`'s new `sanitizeServerString`
     — these are server-generated but same-origin-relative, and the sibling
     `fermiviewer` answers the same shape on the same default port);
     `store/reimport.ts`'s comment corrected from "the LAST statement" to "the
     last STORE-MUTATING statement" (a `setStatus`/`toast` actually follow it);
     `resetNotificationMarks` renamed `resetNotificationCountsForTests` to
     match the repo's `…ForTests` convention (`store/windowHydration.ts`,
     `store/packProject.ts`, `store/originApplyLibs.ts`); `store/importDatasets.ts`'s
     danger toast now reuses `summary` instead of re-interpolating the same
     string; the four fix-table line refs that had drifted onto comments were
     re-pointed at the actual message/toast lines (all four; `useApp.ts`,
     `ReportPanel.tsx` and the three REMAINING refs already landed exactly,
     confirmed unchanged). Not fixed, with reasons: the `age()`/`takenAt`
     privacy-vs-readability wording (kept `takenAt` at full precision — several
     tests pin the literal ISO string, and reducing it would be a real behavior
     change, not a nit — so the comment was reworded to drop the privacy claim
     instead); `probeBackend`'s missing `AbortController`/`clearTimeout` is
     moot, since finding 3 deletes the function entirely; a BUG-009-style reset
     ratchet for `store/backendHealth.ts`'s new module state was considered and
     NOT added at the time — **the stated reason was wrong and is corrected in
     the 2026-09-14 re-review below (nit 9)**: the module state IS reachable by
     the POISONING failure mode the precedent exists to catch (a stale
     `{reachable: true, app, version}` left by an earlier test in the same file
     can misdirect a later test asserting `backend unreachable`); the honest
     reason to decline the ratchet is narrower — no test recorded backend
     health at the time, so nothing was poisoning anything YET, not that the
     module structurally cannot be poisoned.

  Sabotage (all verified failing, then reverted):

  | # | Mutation | Result |
  |---|---|---|
  | 1a | `store/toasts.ts`: cap `totalCount` at 50 (re-introduce ring-style eviction) | caught — `toasts.test.ts`'s "500 pushes report a total of 500" AND "a danger toast survives 50 later ok toasts" both fail |
  | 1b | (same file) — confirms both new tests are load-bearing, not just one | see above |
  | 2 | n/a — finding 2 is a documentation/census fix, nothing to sabotage in code | — |
  | 3 | `commands/uiCommands.ts`: reinsert `await fetch("/api/health")` before building the diagnostics text | caught — `copyDiagnosticsMenu.test.tsx`: 3 of 4 tests fail, including the new "completes the clipboard write without awaiting any network call" test (the 4th, "carries none of the workspace's names/values/paths", passes VACUOUSLY on an empty copied string — the same shape the review's own S2 sabotage found) |
  | nit (dedup) | `store/importDatasets.ts`: revert the toast to the pre-fix `` toast(`${lastError}${hint}`) `` | caught — `importDatasets.test.ts`'s "the failure toast carries the imported count, not just the failure" |
  | nit (control chars) | `lib/diagnostics.ts`: make `sanitizeServerString` a no-op | caught — `diagnostics.test.ts`'s "strips control characters from the echoed backend identity" |

  Gate: `npx tsc -b --force` clean; `npx eslint src --max-warnings=0` clean;
  `npx vitest run src/lib/diagnostics.test.ts src/store src/commands
  src/components/Shell src/architecture.test.ts` — 99 files, 1941 passed, 0
  failed; `uv run pytest -q tests/test_repo_integrity.py` — 12 passed.
  `store/useApp.ts` untouched (2321 lines, exactly its pin).

  Bundle (eager JS = entry + modulepreload chunks, measured the same way
  `check-bundle-size.mjs` does): this commit's parent (`git rev-parse HEAD~1`
  = `a7e158bc`, matching the commit this review round repairs) measured
  **917,224 B** in a scratch worktree (`npm ci`'d node_modules); this commit
  (HEAD) measured **917,385 B** — **+161 B**, from the comment/doc growth and
  the `sanitizeServerString` call plus the `backendHealth.ts` module (tiny;
  most of its lines are comments, stripped by minification). `EAGER_JS_BUDGET`
  is 920,400 B (`check-bundle-size.mjs`), unchanged — the commit lands 3,015 B
  under budget, no pin edit owed.

  **Re-review round, 2026-09-14** (an adversarial re-review of the review-
  round commit above, `d4c06387`): found 3 CONFIRMED issues and 8 nits, all
  fixed in one follow-up commit. Findings and fixes:
  1. **CONFIRMED — `sanitizeServerString` turned a non-string `app`/`version`
     into a total loss of the report.** `lib/api.ts`'s `health()` response is
     an unchecked `as`-cast; a hostile or buggy backend answering with a
     number or object for `app`/`version` made `v.replace` throw, and the
     throw propagated out of `diagnosticsText()` into the command's outer
     `.catch` — no report at all, exactly the case the sanitizer exists to
     harden against. Fixed at BOTH layers: `sanitizeServerString` now calls
     `String(v)` before `.replace`, and `App.tsx`'s mount effect guards the
     recording site itself (`typeof info.app === "string" ? info.app : null`,
     same for `version`) so `BackendInfo` stays honest at its source. Hostile
     test extended with a `42` and a `{}` — both render as text (`"42"`,
     `"[object Object]"`), neither throws.
  2. **CONFIRMED — the `backend` row became a startup snapshot rendered as
     live state.** `recordBackendHealth` has exactly one non-test caller, in
     a mount effect that runs once; nothing ever refreshed or invalidated it,
     so a backend that died minutes ago still read as "quantized 0.25.0" and
     a click before the handshake settled read as "unreachable" —
     indistinguishable from a truly dead backend. Fixed: `store/backendHealth.ts`
     now stamps `Date.now()` at record time and computes the age at READ
     time (not cached at record time, so it keeps growing while the report
     sits open); the row renders `quantized 0.25.0 (startup handshake, 2520 s
     ago)` (`age()`'s convention is seconds, not minutes — see
     `store/diagnostics.test.ts:~245`), and the unreachable case renders
     `unreachable or not yet answered`, honestly covering THREE indistinguishable cases (dead
     backend, offline/file-served page, click before the handshake answers)
     instead of the two the field doc used to enumerate — `lib/diagnostics.ts`'s
     `backend` field doc corrected to say so. The finding-3 paragraph above
     also had the same conflation ("the startup probe already runs before
     any click is possible") — corrected there to "runs at startup; a click
     before it answers reads 'not yet answered'". Tests: before any
     `recordBackendHealth` call → "not yet answered"; immediately after →
     the timestamped row at 0 s; and (new) recording under fake timers, then
     advancing 42 minutes before reading → the row shows 2520 s, proving the
     age is computed at read time and not frozen at record time.
  3. **CONFIRMED (doc-promise) — "depends on nothing but synchronous module
     state" was false on the first click.** `commands/uiCommands.ts` still
     does `await import("../store/diagnostics")` before building the text;
     that chunk is deliberately excluded from the eager bundle, so in
     production the first "Copy diagnostics" click of a session can fetch it
     over the network inside the user gesture — the same hazard class the
     network probe removal was for, one order of magnitude rarer (once per
     page load). Fixed two ways: the claims in `store/backendHealth.ts`'s
     header and the `copyDiagnosticsMenu.test.tsx` test title are narrowed to
     "removes the app's own `/api/health` round-trip; the one remaining await
     is the lazily-imported renderer chunk"; and `components/Shell/MenuBar.tsx`
     now warms that chunk (`void import("../../store/diagnostics").catch(() =>
     {})`) when the Help menu opens (a closed→open transition only, via a
     small `onOpen` callback added to the shared `title()` helper — no static
     or eager import, so it stays off `dist/index.html`'s modulepreload list;
     verified by diffing the eager-ref list before/after, unchanged at 35
     files). From the SECOND "Copy diagnostics" click of a session onward the
     import resolves from the module cache instantly; the FIRST click of a
     session can still be waiting on a real fetch for the chunk if the user
     reaches the command before the warm import (started when they opened
     Help) has finished — narrower than the pre-fix hazard (every click) but
     not eliminated. **Corrected in the round-3 re-review (finding 2
     below):** the LATENCY the warm import saves is genuinely not testable
     in vitest — it resolves a mocked or real dynamic import from the
     in-process module graph effectively instantly regardless of whether
     `warmDiagnosticsChunk` ran, the same limitation the original review's
     own F3 probe used a manual `vi.mock` + `sleep` harness to work around,
     not a per-commit test — but that is a narrower claim than "an automated
     test cannot distinguish 'warmed early' from 'fetched cold'", which
     conflated timing with the regression that actually matters: whether the
     chunk is imported when the Help menu opens, before any item is clicked.
     That IS observable, and is now pinned by
     `components/Shell/copyDiagnosticsMenu.test.tsx`'s "Help menu warms the
     diagnostics chunk" tests.
  4. NIT — the census bound was not reproducible with the pattern it named:
     the plan claimed **60** `setStatus(` sites carry failure wording, but
     that number only reproduces against the paren-less `setStatus` pattern
     (334 sites, a superset that also counts declarations/types/comments);
     the reproducible figure for `setStatus(` (263 sites, matching the box's
     other number) is **52**. Re-measured independently with a plain grep
     over non-test `frontend/src`; both boxes above corrected to 52.
     **Corrected again to 51 in the round-3 re-review**: `grep -rn` matches
     the pattern against each output line's `path:lineno:code` haystack,
     not just `code` — `components/Inspector/ErrorRolesCard.tsx:126` counted
     only because "Error" appears in the FILENAME, the exact class of defect
     this nit was originally filed for. Corrected method: strip the
     `path:lineno:` prefix before matching (or use `grep -rhE`, which omits
     the filename) — see the box above for the reproducible command.
  5. NIT — the plan's recorded gate run (99 files, 1941 passed) predates this
     commit's own five new tests (1936 prior + 5 = 1941, i.e. it was the
     PARENT's run). Re-measured — **corrected twice more since**: the figure
     first written here (100 files, 1954 passed) turned out to be the
     PARENT's run again (`5af88343`, not this commit), caught by the
     round-3 re-review; this commit's own count at the time was 101 files,
     1962 passed (`store/backendHealth.test.ts` new at +5,
     `lib/diagnostics.test.ts` +2, `store/diagnostics.test.ts` +1, over
     `5af88343`'s 100/1954). The round-3 fixes below (a new warm-import test
     plus doc/plan edits) move the count again — see this entry's closing
     Gate line for the number that is actually current, measured from a
     fresh worktree of the finished commit rather than the working tree that
     produced it, per the round-3 reviewer's own suggested guard.
  6. NIT — the sanitizer regex (`/[\x00-\x1f\x7f]+/g`) stripped only ASCII C0
     controls plus DEL; U+2028 LINE SEPARATOR, U+2029 PARAGRAPH SEPARATOR and
     U+0085 NEL are ALSO forced line breaks under CSS Text, and U+202E
     RIGHT-TO-LEFT OVERRIDE reorders rendered text — none of them were
     caught, so a hostile backend identity pasted into a `<pre>` (a GitHub
     issue) could still break the column layout or forge a heading. Fixed:
     `/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu` (Unicode control + format + line/
     paragraph separator categories). Hostile test extended with all four.
  7. NIT — the truthiness check ran BEFORE sanitizing, so a control-
     character-only identity (`"\n\n"`) was "present", sanitized to `""`,
     and rendered with the app slot simply missing — indistinguishable from
     a field that was never collected. Fixed: sanitize first, then
     `|| "unknown app"`. New test: `"\n\n"` renders "unknown app".
  8. NIT — one of the four re-pointed plan line refs from the prior round
     still missed: `workspaceIO.ts:451-452` covers msg+setStatus but drops
     the toast line at `:453`. Corrected to `451-453`.
  9. NIT — the stated reason for declining a BUG-009-style reset ratchet on
     `store/backendHealth.ts` was wrong: it claimed the module "cannot
     produce" the poisoning failure mode the ratchet exists to catch, but it
     can — a stale `{reachable: true, app, version}` left by an earlier test
     in the same file would misdirect a later test asserting `backend
     unreachable`, and `copyDiagnosticsMenu.test.tsx` was exactly such a
     test, passing only because the file never called
     `resetBackendHealthForTests`. Verified by temporarily removing that
     call and injecting a leaked `recordBackendHealth` in an earlier test in
     the same file: the later "unreachable" assertion failed, reproducing
     the exact scenario described. Fixed: `resetBackendHealthForTests()`
     added to `copyDiagnosticsMenu.test.tsx`'s `beforeEach`; the plan's
     stated reason corrected to the honest one — no test recorded backend
     health at the time, not that the module structurally cannot be
     poisoned.
  10. NIT — the network-call exclusion test asserted the property only
      through `vi.waitFor`'s default-timeout backstop, which proves "under
      about a second," not "fetch was never called." Added a direct,
      unconditional `expect(hungFetch).not.toHaveBeenCalled()` outside any
      `waitFor` (exempt from the weak-wait ratchet, which only flags
      `waitFor(() => expect(mock).toHaveBeenCalled())`).
  11. NIT — `BACKEND_UNREACHABLE` was an exported, unfrozen object handed out
      by reference (`getBackendHealth()` returns it directly when nothing has
      been recorded); any consumer that wrote to it would poison the shared
      constant for the rest of the session. Fixed: `Object.freeze`, matching
      the repo's frozen `DataStruct` convention. New test asserts both
      `Object.isFrozen` and that an assignment attempt throws.
  12. NIT (**fixed in the round-3 re-review, 2026-09-14**, not this commit) —
      `lib/diagnostics.ts`'s `DIAGNOSTICS_SCHEMA_VERSION` did not move even
      though the `backend` row's rendered layout changed in BOTH this round
      and the round above it: `"backend  quantized 0.23.2"` became
      `"backend  quantized 0.23.2 (startup handshake, 12 s ago)"`, and
      `"backend  unreachable"` became `"backend  unreachable or not yet
      answered"` — both breaking for a line-scoped parser (`/^backend\s+
      unreachable$/` no longer matches; an "app version" split now picks up
      extra tokens), and this commit had to rewrite its own regexes in three
      test files as a direct result, which is the evidence the layout truly
      changed. Precedent: `3cbc115b`, which bumped 1 → 2 for *adding* the
      `backend` row, a strictly smaller change than reshaping its content.
      Fixed: `DIAGNOSTICS_SCHEMA_VERSION = 3`. No in-repo consumer reads the
      constant; the only test asserts the stamp against the constant itself
      (`lib/diagnostics.test.ts`'s "stamps the report schema..."), so the
      bump needed no test changes beyond the constant.

  Sabotage (all verified failing, then reverted):

  | # | Mutation | Result |
  |---|---|---|
  | 1 | `lib/diagnostics.ts`: drop `String(v)` from `sanitizeServerString` | caught — `diagnostics.test.ts`'s "renders a numeric or object backend identity as text rather than throwing" |
  | 2a | `store/backendHealth.ts`: hardcode `ageSec = 0` instead of computing it from `recordedAt` | caught — `store/backendHealth.test.ts`'s "computes the age at READ time..." AND `store/diagnostics.test.ts`'s "ages the recorded backend identity..." |
  | 2b | `lib/diagnostics.ts`: revert `backendRow`'s unreachable case to `"unreachable"` | caught — `diagnostics.test.ts`, `store/diagnostics.test.ts` and `copyDiagnosticsMenu.test.tsx` all fail (3 files) |
  | 6 | `lib/diagnostics.ts`: narrow the sanitizer regex back to `/[\x00-\x1f\x7f]+/g` | caught — `diagnostics.test.ts`'s "strips control, format and line/paragraph-separator characters..." |
  | 7 | `lib/diagnostics.ts`: check truthiness before sanitizing (revert order) | caught — `diagnostics.test.ts`'s "renders a control-character-only identity as 'unknown app'..." |
  | 9 | `copyDiagnosticsMenu.test.tsx`: remove `resetBackendHealthForTests()` from `beforeEach` AND record a leaked backend identity in an earlier test | caught — the later "unreachable" assertion fails, reproducing the exact poisoning scenario nit 9 describes |
  | 10 | `commands/uiCommands.ts`: reinsert a fire-and-forget `void fetch("/api/health")` in the click handler (does not stall the clipboard write) | caught by the new DIRECT assertion (`hungFetch` called once) — a `waitFor`-only check would have missed this, since nothing stalls |
  | 11 | `store/backendHealth.ts`: drop `Object.freeze` from `BACKEND_UNREACHABLE` | caught — `store/backendHealth.test.ts`'s "freezes BACKEND_UNREACHABLE..." |
  | 12 (round-3) | `components/Shell/MenuBar.tsx`: revert `title("Help", warmDiagnosticsChunk)` to `title("Help")` in a scratch copy | caught — `copyDiagnosticsMenu.test.tsx`'s "opening Help imports the chunk exactly once, before any item is clicked" fails (`diagnosticsEvals.length` stays `0`); reverted |

  **Round-3 re-review, 2026-09-14** (closing the round-3 adversarial
  re-review of this commit): fixed finding 1 (this Gate line and nit 5 above
  both recorded the PARENT's test count, not this commit's own — a third
  recurrence of the exact mistake nit 5 itself was filed to correct; see nit
  5's text above, now corrected) and finding 2 (item 12 above: the warm
  import shipped with no test — added and sabotage-verified) as CONFIRMED,
  and nits 3/4/5 (this section's items 2 and 12, and the two boxes corrected
  to 51 earlier in this P3.4 entry) as NITs. The round-3 re-review found the
  CODE clean on every one of the 11 prior items it re-probed (nothing there
  needed a fix); its two CONFIRMED findings and three nits are all
  record/test-level — item 12's new test and the `DIAGNOSTICS_SCHEMA_VERSION`
  bump above are the only code changes this round, everything else is the
  plan's own record catching up to what the code already did.

  Gate (measured in THIS worktree, after all round-3 edits landed, so it is
  this commit's own run — not a parent's): `npx tsc -b --force` clean;
  `npx eslint src --max-warnings=0` clean;
  `npx vitest run src/lib/diagnostics.test.ts src/store src/commands
  src/components/Shell src/architecture.test.ts` — **101 files, 1965 passed,
  0 failed**; `uv run pytest -q tests/test_repo_integrity.py`
  — 12 passed.
  `store/useApp.ts` untouched (`wc -l` 2321, unchanged, at its 2322 pin).

  Bundle (eager JS = entry + modulepreload chunks, measured the same way
  `check-bundle-size.mjs` does, via a standalone byte-exact re-implementation
  since the script itself only prints rounded kB): this commit's parent
  (`git rev-parse HEAD~1` = `1593cdee`, the branch tip this round started
  from) measured **917,739 B** in a scratch worktree (`git worktree add` +
  `npm ci`); this commit (HEAD) measured **918,124 B** — **+385 B**, from the
  doc/comment growth, the `App.tsx` guard, `MenuBar.tsx`'s `warmDiagnosticsChunk`,
  and `backendHealth.ts`'s `recordedAt`/age arithmetic. `EAGER_JS_BUDGET` is
  920,400 B, unchanged — the commit lands 2,276 B under budget, well clear of
  the `EAGER_JS_BUDGET - SLACK` (880,400 B) floor that would force a lower
  pin, no pin edit owed. Confirmed the warm import stayed lazy: `dist/assets/`
  contains a `diagnostics-*.js` chunk that appears in neither build's
  `index.html` (no `<script type="module">`, no `<link rel="modulepreload">`),
  and the eager-ref list is the same 35 files before and after (three files'
  content hashes shifted from unrelated upstream edits — `index`,
  `contextActions`, `datasetRemoval` — no file added or removed).
- [x] Persistent recovery/write-failure notices. **Verified 2026-09-13:**
  write-failure — `StatusBar.tsx`'s `role="alert"` autosave banner
  (`health.error`, MAIN_PLAN #32) "stays visible until the next SUCCESS"
  (`store/autosaveStatus.ts` header) rather than a toast that scrolls away.
  Recovery — `RecoveryChoiceDialog.tsx` (P1.2) has no auto-dismiss and no
  default action ("Cancel touches nothing... there is no default/auto
  action" per its own header); it stays up until the user makes an
  explicit Cancel/Keep/Recover choice. Both notices persist until resolved
  rather than expiring on their own.

### P3.5 — Unified recipe library

**Goal:** organize Import, Plot, Analysis, and Technique Workflow recipes.

**Models:** GPT-5.6 Terra high / Claude Sonnet 5. **Dependencies:** P1.3/P1.6.

- [x] Common browse-first library for Plot, Quick Plot, Analysis, Peak,
  Graph, and Fit Model recipes, with project/global scope where the backing
  format supports it.
- [x] Favorites, tags, last-used ordering, type/scope filters, and stale-index
  pruning with incomplete-source safeguards.
- [x] Capability-aware Apply/Open, duplicate, rename, export, scope-copy, and
  safe delete actions. Unsupported operations are omitted rather than shown
  disabled. Secondary actions use a keyboard-accessible overflow menu so long
  recipe names remain readable; one busy state prevents conflicting edits.
- [x] ~~Add a selected-recipe details/preview surface, including visible schema
  version and useful kind-specific metadata. Do not imply that a recipe can be
  edited or applied when its kind does not support that operation.~~ SHIPPED
  2026-09-04 (#290): per-row Details disclosure built by `lib/recipeDetails.ts`
  — schema version shown even when "unversioned", kind-specific facts, and an
  "Available actions" line derived only from `supportsOperation`, so a row
  never lists an operation its kind lacks. Quick-plot channel usage is derived
  from the mapping, not from the label snapshot (self-review finding).
- [x] ~~Add a library-level import entry point and finish import/export parity
  for recipe kinds with safe, portable formats. Keep capability gating for
  kinds that cannot yet round-trip without loss.~~ SHIPPED 2026-09-04 (#290):
  "Import recipe…" sniffs the kind from the file (`lib/recipeFile.ts`); peak,
  graph and fit-model recipes gained serializers and file-boundary parsers
  that check every field (type, enum, and the semantic bounds the owning
  wizard/backend enforce — mirrored exactly, via `peakClamp`, so a recipe the
  app saved always re-imports) and drop unknown keys. quickPlot stays
  non-importable by capability gate: bound to a workbook/schema signature, no
  portable form.
- [ ] Search comes later if real use proves navigation insufficient.
- [ ] Revisit organization after usage; do not freeze it prematurely.

**Status update — 2026-08-31 (ChatGPT / Sol):** core P3.5 browsing, usage
tracking, cleanup, and row operations shipped through PRs #271 (common
contract + sidecar index), #272 (source-aware completeness), #273 (the
browse-first library), #276 (workspace recipe-source fidelity, which is what
makes the incomplete-source safeguard above real), #277, #278, and #282. The remaining work is details/preview/version plus library-level
import and round-trip parity; the prior single unchecked line obscured that
split. New eager UI work must respect the bundle ratchet (the 2026-08-31
verification had about 4.0 kB of headroom).

**Status update — 2026-09-04:** #290 closed both of the boxes Sol's update
above left open — details/preview/version and library-level import with
round-trip parity. The only boxes still open in P3.5 are the two
usage-gated ones (search, revisit organization). Bundle headroom after the
stack (through #292) is about 3.0 kB, measured locally at #292; the pin
was not raised.

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

- [x] ~~**Extend to folders, figures, reports, and durable objects.**~~ SHIPPED
  2026-09-04 (#292) (`frontend/src/store/trash.ts`): `TrashEntry` is now a
  discriminated union (`dataset`/`editableFigure`/`figureDoc`/`page`/
  `report`/`folder`); every delete path (`deleteEditableFigure`,
  `removeFigureDoc`, `deletePageDocument`, `removeReport`,
  `deleteFolder(…, "reparent"|"cascade")`) captures before removing.
  `deleteFolder` deletes no dataset either way (corrects the earlier
  wording implying cascade destroys data — it only un-parents); the
  `folder` entry captures the removed subtree plus which live
  dataset/workbook members lost their `folderId`, so both delete modes
  restore. Tests: `store/trash.test.ts`, `store/folderDelete.test.ts`.
- [x] ~~**Coherent dependency restore or clear limitation.**~~ SHIPPED
  2026-09-04 (#292): `restoreFromTrash` returns `{ok, note?}`/`{ok:false, reason}`.
  `dataset` restore is unchanged (workbook self-heal). A live
  `editableFigure`/`figureDoc` whose bound dataset is gone restores the
  dataset too when it is ALSO in trash (same transaction, noted), else
  restores with the binding nulled the same way a `.dwk` load clamps a
  dangling ref (noted as a residual: renders frozen/disabled until
  relinked). `folder` restore re-adds the subtree (dangling parent -> root,
  reusing `pruneOrphans`/`parseFolders`'s own rule) and re-homes every
  still-un-parented captured member, leaving a member the user has since
  moved where they put it (noted). `report` restores as-is. `page` restore
  is as-is too — a residual: its panels' missing-figure state follows the
  existing F3 `resolvePagePanel` semantics unchanged, not a new mechanism.
  Review round (same day): the "reparent" mode sends members and child
  folders to the deleted node's PARENT, not the root, so the entry now
  records that destination (`dest`) plus the re-parented `childFolders`,
  and restore re-homes whatever still sits exactly there. Restore is
  deliberately NOT an undo step: `trash` is outside the history snapshot,
  so an undoable restore would let Ctrl+Z remove the object again with its
  entry already consumed (`store/trash.test.ts` pins it).
- [x] ~~**Bound by count/age/total size, with purge preview.**~~ SHIPPED
  2026-09-04 (#292): `TRASH_MAX_BYTES` = 128 MiB (justified in `trash.ts` against
  P0.4's measured 188 MB/1M-row `.dwk`), `evictTrash` always keeps the
  newest entry even alone over cap (mirrors `autosaveGenerations.capBySize`).
  `bytes` computed once at trash time, never per render — a dimension ESTIMATE
  for datasets (`datasetByteEstimate`; the exact `JSON.stringify` measured
  1.2 s on P0.4's 1M-row dataset, a stall this would have added to every
  delete). An `editableFigure`/`figureDoc` entry whose document carries a
  FROZEN data snapshot also uses the dimension estimate for that snapshot
  (`editableFigureByteEstimate` / `figureDocByteEstimate`, same cost reason);
  exact for the rest. `lib/trashSummary.ts`
  (lazy, panel-only) rolls up count/bytes/byKind/oldest/newest;
  `TrashPanel`'s "Empty trash" opens `askConfirm` with a purge-preview body
  naming exactly what would be lost, destructive-styled, before `purgeTrash()`.
- [x] ~~**Allow explicit warned permanent deletion.**~~ SHIPPED 2026-09-04 (#292):
  `removeDatasets(ids, {permanent: true})` skips trash capture entirely;
  the Library dataset menu's new "Delete permanently…" action
  (`lib/datasetRemoveActions.ts`) confirms with a body stating the trash
  bypass and irreversibility before calling it. Review round (2026-09-03):
  the permanent branch records no undo step AND scrubs the dataset from
  every retained history/future snapshot (`scrubDatasetsFromHistory`), so
  neither Ctrl+Z nor an undo of an older edit can bring it back — the
  confirmation's "cannot be undone" is literally true; a non-dataset
  restore re-validates its entry inside the final transaction, so a purge
  that lands while the restore chunk loads wins; the per-row ✕ / Sure?
  controls carry row-naming accessible labels. Tests:
  `lib/datasetDeletePermanently.test.ts`, `store/trash.test.ts`,
  `components/workshops/trash/TrashPanel.test.tsx`.

**Status update — 2026-09-04 (#292 self-review round):** permanent delete now
does a full snapshot scrub — `scrubDatasetsFromHistory` maps every retained
history and future snapshot through `removeDatasetsPatch`, not just the
`datasets` array, so a stray `activeId`/binding/Origin ref naming the deleted
id can't survive an undo. Trash is one entry per object: re-trashing the same
id (e.g. delete → Undo → delete again) drops the older copy instead of
double-counting it. A restored FROZEN `editableFigure`/`figureDoc` clamps a
dangling dataset binding to null without attempting dependency restore — a
frozen document renders from its own snapshot and needs none. The eager-
bundle growth this round was funded by deferring
`components/Library/folderOps.ts` to the click: its two eager importers
(`lib/contextActions.ts`'s six folder actions and `MultiSelectBar.tsx`'s
Export) now reach it through a dynamic `import()` inside the handler.

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

**2026-09-14 — lazy-seam diet, `EAGER_JS_BUDGET` unmoved at 920,400 B.**
Headroom was under 1 kB again (919,781 B on the branch tip `4aafd3a3`).
Four modules left the eager entry graph behind dynamic `import()` seams —
`lib/worksheetTransformCommands.ts` (the four Data-menu reshapes),
`components/Library/OriginSavedPreviewWindow.tsx` (with
`overlays/ToolWindow.tsx` and `lib/workshopHelp.ts`, which nothing else
eager reached), `lib/workbookTransfer.ts` (the Copy/Paste/Duplicate core,
whose four callers were already `async`, so no signature changed) and
`lib/pageSetupCommand.ts`. Measured cumulatively with `npm run build` after
`npm ci` and a `node_modules/.vite` wipe, summed exactly as
`check-bundle-size.mjs` sums: **919,781 → 910,172 B, −9,609 B**, leaving
10.2 kB of headroom and staying well clear of the
`EAGER_JS_BUDGET - SLACK` floor (880,400 B) that would force a lower pin.
This is `plans/BUNDLE_HEADROOM.md` slice 2's shape (metadata eager, handler
lazy), not its whole scope — the command *metadata* stays eager, so the
palette, menus and Help search are untouched. A fifth seam
(`lib/originTemplate.ts` behind the "Import Origin template…" picker) was
built, measured at **+219 B** — Rollup's new chunk boundary cost more than
the ~1 kB of modules it moved — and **reverted**, the same way the
2026-09-09 `DatasetRowPreview` split was. Seams rejected without building,
on this file's and `check-bundle-size.mjs`'s own recorded grounds:
`lib/contextActions.ts` / `PlotContextMenu` (right-click latency),
the command registry itself (first press of every shortcut),
`lib/openWorkspaceCommand.ts` (its `openFilePicker()` must stay in the
click's own task or a browser blocks the dialog) and every first-paint
Library section.

**2026-09-15 review round — two narrower claims and the trees the numbers
were measured on.** *Failure reporting:* seams 1, 3 and 4 do report a
chunk-load failure and do retry on the next gesture — the reshape and
Page-setup commands through `runLazy`'s danger toast, Copy/Paste/Duplicate
through that slice's own status line + toast. **Seam 2 does neither.**
`FigureRow`'s `lazy()` + `Suspense` inherits what all 17 `lazy()` sites in
`frontend/src` already do: measured 2026-09-15, there is no error boundary
anywhere under `frontend/src` (0 files match
`componentDidCatch|getDerivedStateFromError|ErrorBoundary`), so a failed
chunk unmounts the React root with no toast and no status, and React caches
the rejected payload so the next gesture does not retry. That is a
pre-existing class the seam is merely consistent with, not something it
introduced; it is filed as `plans/BUGS_AND_ISSUES.md` **UX-003** and a root
error boundary is its own task, deliberately not done here. *Measurement
trees:* both absolutes above (919,781 and 910,172 B) were measured on
`4aafd3a3`, an ANCESTOR of the commit that landed the work (`b749f804`,
whose real parent is `50b30a04`, five commits later). The **−9,609 B delta**
is the load-bearing figure; `EAGER_JS_BUDGET` was not edited, so nothing in
the repo depends on those absolutes — re-measure them on the branch before
the pin is next touched. Also closed that round: `copyTextAsync`
(`lib/clipboard.ts`) so seam 3's Copy starts its clipboard write inside the
click's own task instead of after the chunk `await` (the same
user-activation rule `openWorkspaceCommand` was rejected on), and the
two-argument `.then(onRun, onLoadFailure)` form at every `runLazy` call site
so a loaded handler's own throw is no longer swallowed with the load's.

- [~] Characterization tests before moves. **First domain done 2026-09-17**
  (see the box below): `store/plotViewSettings.characterization.test.ts`, 119
  specs, written and run GREEN against the pre-extraction `store/useApp.ts`
  and passing byte-unchanged after the move. **Second domain done the same
  day**: `store/reportsFigureDocs.characterization.test.ts`, 55 specs (57
  after the 2026-09-17 review round added F3's `openFigureDocInWindow`
  "writes ONLY" spec and F7's `renameReport` exact-string pin), same
  discipline (green before, byte-identical `md5` after), and it starts with
  the two guards the first net needed a review round to gain — every writer
  diffs the WHOLE `getState()` snapshot (so an EXTRA field written is caught,
  not only a missing one) against a POISONED baseline (so a write that
  "clears" a field back to its own default still shows as a diff). Still
  `[~]` because the practice is per-domain and `store/useApp.ts` has more
  domains left.
- [~] Split one owned domain per PR with unchanged behavior/contracts.
  **ONE domain extracted 2026-09-17**, characterization tests first: the
  singleton **PlotView writers** — axis scales/limits/steps/tick formats/
  titles, legend/grid/axis-box flags, stack mode + panel fit + page setup,
  the x/y/y2/group channel keys, reference lines, annotations, per-channel
  series styles/labels/error pairings, draw order, hidden/solo channels and
  the waterfall offset (43 actions) — moved verbatim from `store/useApp.ts`
  to the new `store/plotViewSettings.ts` (277 lines by the repo's
  `split("\n")` ceiling metric, `PlotViewSettingsSlice`, composed like
  `datasetMeta.ts`/`gadget.ts`). `store/useApp.ts` **2,322 →
  2,122 lines (−200)**; its `architecture.test.ts` STORE_PINS entry ratcheted
  DOWN to 2,122 with a dated justification. Eager bundle for the landed pair:
  913,336 B at parent `7a1ebd43` (the characterization commit — its body named
  an orphaned pre-amend twin `7961f865`, same tree, unreachable SHA; corrected
  here per review F3) → 913,376 B at `6686c23d` (+40 B). Chosen by measured
  coupling, not size: nothing in the cluster writes `datasets`, so the
  pending-edit ratchet has nothing to say about it. Deliberately left behind
  as NOT this domain:
  `setChannelRole`/`setChannelType` (per-dataset channel config that
  round-trips the `.dwk`, not view state), the preference setters and the
  shell-layout toggles.
  **SECOND domain extracted 2026-09-17**, same discipline: the **report-sheet
  (#36) and figure-document (#12) lifecycle** — `addReport`, `removeReport`,
  `renameReport`, `setOpenReport`, `addFigureDoc`, `removeFigureDoc`,
  `renameFigureDoc`, `duplicateFigureDoc`, `openFigureDraft`, `openFigureDoc`,
  `openFigureDocInWindow`, `clearFigureDocSeed` (12 actions) — moved to the new
  `store/reportsFigureDocs.ts` (183 lines, `ReportsFigureDocsSlice`, composed
  with one import + one word on the `extends` clause + one spread, exactly like
  `plotViewSettings.ts`). `store/useApp.ts` **2,122 → 2,012 lines (−110)**; its
  `STORE_PINS` entry ratcheted DOWN to 2,012 with a dated justification.
  11 of the 12 bodies are byte-identical after whitespace normalisation;
  the twelfth (`duplicateFigureDoc`) differs by exactly one expression,
  `` `figd-${Date.now().toString(36)}-${++_idSeq}` `` → `nextFigureDocId()`,
  because a module-level `let` cannot be incremented across an ES-module
  boundary. Rather than split the counter per domain (which would renumber
  ids), the whole shared sequence moved to the new leaf module
  `store/idSeq.ts` (45 lines, imports nothing); `store/useApp.ts` re-exports
  `nextDatasetId`/`nextFolderId` from there, so none of its eight importers
  changed, and `addSmartFolder` — which stays behind — now calls
  `nextSmartFolderId()`. One characterization spec pins the property that
  makes this safe: `addReport`, `duplicateFigureDoc`, `addSmartFolder` and
  `nextDatasetId` still draw four CONSECUTIVE suffixes from one counter.
  Chosen by measured coupling over the two larger candidates: `loadWorkspace`
  (170 lines) writes 40 `AppState` fields and is where every newly persisted
  field gets wired, and `applyOriginFigure` + `facetByColumn` + `breakAtGaps`
  (336 lines) write 24 PlotView fields that `plotViewSettings.ts` also writes;
  this cluster writes 15, of which the 4 it owns means this module holds every
  ACTION that edits them one at a time — bulk restores write them wholesale
  and stay outside the cluster on purpose: `loadWorkspace`'s `.dwk` hydrate,
  `store/trash.ts`'s delete delegates, `store/trashRestore.ts`'s
  restore-from-trash, `store/workbookTransfer.ts`'s workbook import, and
  `store/historySnapshot.ts`'s undo/redo restore. Verified beyond the suite:
  the composed store is unchanged at **587 keys (380 functions)** with
  byte-identical initial values, the `recordHistory`/`recordMacro`/`status:`
  literal multisets are unchanged (15/10/6), and neither new module is in any
  of the repo's 26 modules across 7 pre-existing runtime import cycles
  (type-only imports erased; `reportsFigureDocs → useApp` has no runtime
  edge). Eager bundle, the real parent-to-landed pair: **916,718 B at the
  parent `23914f95`** (the characterization commit, i.e. `HEAD~1` of the
  extraction) **→ 916,782 B at `e93b193b`, +64 B**; the budget
  (`EAGER_JS_BUDGET = 920,400`) was not touched and keeps ≈3.6 kB headroom.
  The box stays `[~]`: `store/useApp.ts` is still far
  over the 500-line module ceiling, and `lib/api.ts` / `lib/uplotOpts.ts` /
  `lib/uplotOverlays.ts` are untouched by this pass.

  **2026-09-17 review round — records corrected (findings closed, tests/docs
  only; verdict CLEAN).** F1: the bundle pair above originally cited two SHAs
  from an abandoned pre-cherry-pick worktree lineage that are unreachable from
  this branch (the real work was cherry-picked onto a tip carrying P2.8 +
  BUG-016 r2 first) — corrected to the real parent/landed pair above, with
  both SHAs removed from this note. The **+64 B delta stands** (both
  lineages differ only by the extraction), only the absolutes and headroom
  (~6.8 kB → ≈3.6 kB) were stale. F2: "578 keys (372 actions)" was
  the same abandoned-lineage measurement — the true parent `23914f95` (=
  P2.8's tip) already carries the `mapView` slice (9 extra keys, 8 extra
  functions), so the correct invariant pair is **587 keys (380 functions)**
  before and after — the invariance claim itself was always true, only the
  absolutes were stale. F4: "the four it owns are touched by nothing else
  outside `loadWorkspace`'s bulk hydrate" was false — `store/trash.ts`,
  `store/trashRestore.ts`, `store/workbookTransfer.ts` and
  `store/historySnapshot.ts`'s undo/redo restore all touch them too; reworded
  above (and in `store/reportsFigureDocs.ts`'s header and
  `architecture.test.ts`'s pin justification) to what is actually true: this
  cluster owns every INCREMENTAL action, not exclusive write access. F8: "26
  pre-existing runtime import cycles" undercounted by conflating SCC count
  with module count — corrected to "26 modules across 7 pre-existing
  cycles" everywhere in this note. Also closed that round: F3, a missing
  "writes ONLY" spec for `openFigureDocInWindow` (the one writer of the
  twelve without one — sabotage-proven: a stray `showGrid: false` folded
  into its `set()` passed all 55 existing specs and the whole
  `src/store` + `architecture.test.ts` scope silently); F5, `store/gadget.ts`,
  `store/split.ts`, `store/dataIntake.ts`, `store/derivedWorksheets.ts`,
  `store/importDatasets.ts`, `store/workspaceIO.ts` and
  `store/workbookTransfer.ts` repointed their `nextDatasetId`/`nextFolderId`
  import from `./useApp` to the leaf `./idSeq` (import line only, same
  module instance, no behavior change) — measured with Tarjan over runtime
  imports (type-only erased): the store's main cyclic SCC shrank **15 → 9**
  modules and the repo's cyclic-module total **26 → 20**; `gadget`, `split`,
  `dataIntake`, `derivedWorksheets` and `workbookTransfer` left every cycle,
  while `importDatasets`/`workspaceIO` stay in a (smaller) one via
  `lib/plotSelectedTogether.ts`, which still needs the `useApp` VALUE import
  and so keeps that edge alive. `useApp.ts`'s `nextDatasetId`/`nextFolderId`
  re-export was KEPT (one real importer remains:
  `lib/plotSelectedTogether.ts`, which reads the live `useApp` store too, not
  just the minters). F6, three stale comments pointing the id sequence at
  `useApp.ts` (`store/workbookIds.ts:~3,~8`, `store/figureLifecycle.ts:~19`)
  now say `store/idSeq.ts`. F7, one spec added pinning `renameReport`'s
  stored string EXACTLY (no `trim()`), sabotage-proven. Eager bundle for this
  closing pass, both trees built after their own `npm ci` and a
  `node_modules/.vite` wipe: **916,782 B at the parent `e93b193b`** →
  **916,778 B on this commit, −4 B** (the F5 import repoint moved one chunk
  boundary slightly; the net effect was a decrease, not a cost) — comfortably
  inside the ≈3.6 kB headroom and `EAGER_JS_BUDGET` untouched. All findings
  were test/doc/comment-only, plus the seven import-line repoints in F5; no
  other runtime behavior changed.

  **THIRD domain extracted 2026-09-18**, same discipline: the **bulk view
  appliers** — the three actions that install a WHOLE plot view in one gesture
  from a source description rather than editing one setting at a time:
  `applyOriginFigure` (an imported Origin graph window, in its four branches —
  cross-book overlay, double-Y layer pair, spatial multi-panel family, and the
  single-layer fallback), `facetByColumn` (a small-multiples partition by a
  category column) and `breakAtGaps` (a paneled x-break arrangement). 336
  implementation lines (base `useApp.ts` 985-1320: `applyOriginFigure`
  985-1215, `facetByColumn` 1226-1281, `breakAtGaps` 1288-1320), plus their
  24 interface-declaration lines and the
  `ORIGIN_FIGURE_AXIS` constant all three spread, moved to the new
  `store/viewAppliers.ts` (443 lines by the repo's `split("\n")` ceiling
  metric, `ViewAppliersSlice`, composed with one import + one word on the
  `extends` clause + one spread, exactly like `plotViewSettings.ts` and
  `reportsFigureDocs.ts`). `store/useApp.ts` **2,012 → 1,639 lines (−373)**;
  its `STORE_PINS` entry ratcheted DOWN to 1,639 with a dated justification.
  The three bodies are byte-identical modulo one indentation level (they moved
  from an object literal at depth 1 into the creator's `return {` at depth 2);
  nothing else changed, and nine now-unused imports left `useApp.ts` with them.
  This is the LARGER of the two candidates the second domain's note deferred —
  chosen now *because* of that note's coupling objection rather than despite
  it: these three do write PlotView fields `plotViewSettings.ts` also writes,
  but they write them as one whole-view INSTALL, which is a different job from
  a per-setting writer, and `plotViewSettings.ts`'s own header already listed
  all three by name as the bulk-appliers it does not own. The split is by
  gesture, not by field. `loadWorkspace` (170 lines) is still in `useApp.ts`
  and is the obvious next domain. Deliberately left behind as NOT this domain:
  the Origin-apply PREFLIGHTS (`confirmOriginReapplyDiscard`,
  `deferOriginFigureApply`, `deferOriginApplyLibs`), which stay in
  `store/originFigureApply.ts` — one of the three modules grandfathered to
  import `components/` — so that `viewAppliers.ts` sits below the component
  layer and the store layering guard gains **no new grandfathered entry**.
  Characterization net: `store/viewAppliers.characterization.test.ts`, 28
  specs at the extraction (35 after 2026-09-18 review round 3 F1 added the
  cross-book overlay branch's own key-set specs, closing the one branch the
  net didn't cover — see that round's findings below), written and run GREEN
  against the pre-extraction `store/useApp.ts` and passing byte-unchanged
  after the move. It pins, per action AND per
  branch, the exact set of top-level store keys each call changes — a whole
  `getState()` diff against a POISONED baseline that now also poisons
  `composition`/`qfitBusy`/`qfitError`/`gadgetBusy`/`gadgetError`, so the
  `focusTransientReset()` a rebind performs is visible in the diff too — plus
  the applied axis/channel/composition values, the undo label pushed (or that
  none is) and the macro step recorded; the four no-op branches (missing
  dataset, empty analysis view, no finite levels, no qualifying x-gap) are
  pinned with an EMPTY changed set and their toast text. The pins are explicit
  `toEqual` arrays, not inline snapshots, so a stray `vitest -u` cannot
  rewrite them. Sabotage-proven both directions: an EXTRA key written by
  `breakAtGaps` (`plotTitle`) and a SKIPPED key in `facetByColumn`
  (`facetKey: col`) each turn the net red. Eager bundle, both trees built after
  their own `npm ci` and a `node_modules/.vite` wipe: **911,295 B at
  `16535ee0`** (`HEAD~2` of the extraction; tree-identical to the branch base
  `3f43467b` — `git rev-parse 16535ee0^{tree}` = `3f43467b^{tree}`) →
  **911,331 B on the extraction commit, +36 B**
  (the new chunk boundary's own cost; `EAGER_JS_BUDGET` untouched and 8.9 kB
  under budget). `HEAD~1` is the test-only characterization commit, which
  cannot move the eager graph. The box stays `[~]`: `store/useApp.ts` is still far over the 500-line module
  ceiling, and `lib/api.ts` / `lib/uplotOpts.ts` / `lib/uplotOverlays.ts` are
  untouched by every pass so far.

  **Review round 3, 2026-09-18 (adversarial review of `977fc5f5` +
  `b2cde0a2`; verdict CLEAN, nine findings, all closed test/doc-only — no
  product-code change).** F1: the cross-book OVERLAY branch of
  `applyOriginFigure` had NO changed-key spec at all, despite this note (and
  `architecture.test.ts`'s pin justification) claiming coverage "per action
  AND per branch" across all four branches — closed by adding two new-overlay
  and two already-active-overlay specs to
  `store/viewAppliers.characterization.test.ts` (28 → 35), sabotage-proven
  against both mutations the review reproduced (an extra carried-along
  `plotTitle` write, and a dropped `facetKey: null` clear — the latter only
  observable in the already-active scenario, since a genuine dataset switch
  masks it via `setActive`'s own `datasetViewDefaults` reset). Closing that
  gap also surfaced a real hole in the characterization file's own `poison()`
  helper: `plotTitle` was never poisoned or reset at all, so a sabotage that
  wrote it would silently leak into every later test's baseline within the
  same run — fixed by adding it to `poison()`. F3: `poison()`'s `pageSetup:
  null` matched the field's own default AND what the spatial branch actually
  writes for every fixture (undecoded page), making that write invisible —
  fixed to a non-default `PageSetup`, `pageSetup` added to the spatial
  branch's expected key set, and the rest of `poison()` audited (documented
  inline: `regionShades: []` is safe by array IDENTITY despite matching its
  default by value; `stackMode`/`legendStatic`/`showGrid` match their own
  defaults but are safe because no branch in this domain ever writes them
  back to that value). F4: `breakAtGaps` had only a DIFFERENT-dataset
  key-set spec, the one case that cannot observe its `facetKey: null` clear
  being dropped (same masking as F1) — added the ALREADY-active-dataset
  spec `facetByColumn` already had. F5: `recordMacro`'s LABEL argument was
  never asserted anywhere in the file, only its `code` — added a
  `macroLabels()` helper and label assertions for all three actions. F6:
  `facetByColumn`'s `recordHistory`/`setActive` ordering (and the L3 dedup
  that keeps our own undo entry over `setActive`'s pinned-window
  `createWindow` fallback) was unpinned — added a spec that pins the pushed
  snapshot as the PRE-rebind state and the surviving label. F9: a FIFTH
  `breakAtGaps` no-op branch (`compositionPanelCount(composition) < 2` — an
  explicit break list that leaves fewer than 2 panels) was untested and
  unmentioned; "four no-op branches" corrected to five here and in
  `architecture.test.ts`'s pin justification, and a spec added. F2: "342
  implementation lines" was measured wrong — the removal hunk is
  authoritative at 336 (`985-1320`, three sub-ranges above); corrected here,
  in the earlier 2026-09-17 note's mention above, and in
  `architecture.test.ts`'s pin justification. F7: the bundle-parent SHA
  above was labeled `3f43467b` "`is` `HEAD~2`" when `HEAD~2` is actually
  `16535ee0` (the #365 merge) and `3f43467b` is that merge's second
  parent — corrected above to measure and label `16535ee0`, noting the two
  are tree-identical so the number itself was never wrong. F8: two stale
  `store/useApp.ts` comments pointing at the moved actions —
  `lib/originPanels.ts:5` and `lib/exportParity2.test.ts:289` — now say
  `store/viewAppliers.ts`. All changes were to
  `store/viewAppliers.characterization.test.ts`, the two comment files, this
  plan and `architecture.test.ts`'s comments; no gate command, budget or
  pin changed, and the extraction's own byte-identical bodies (this note's
  earlier paragraph) are untouched.

  **FOURTH domain extracted 2026-09-19**, same discipline: **workspace
  hydration** — `loadWorkspace` (replace the whole library from a
  restored/parsed `.dwk`; the autosave restore on startup AND an explicit
  File ▸ Open `.dwk` both run it) and `appendWorkspace` (Origin's "Append
  Project", MAIN_PLAN #16 — the additive opposite: only the flat dataset
  list + referenced workbooks join the CURRENT library). This is exactly
  the candidate the third domain's own note named as "the obvious next
  domain" once the bulk view appliers landed. 170 implementation lines
  (`loadWorkspace`, base `useApp.ts` 954-1123) plus `appendWorkspace`'s
  one-line delegate (1124) and their 9 interface-declaration lines — 171
  lines total, matching the plan's estimate — moved to the new
  `store/workspaceHydration.ts` (266 lines by the repo's `split("\n")`
  ceiling metric, `WorkspaceHydrationSlice`, composed with one import +
  one word on the `extends` clause + one spread, exactly like
  `plotViewSettings.ts`, `reportsFigureDocs.ts` and `viewAppliers.ts`).
  `appendWorkspace`'s own body (`runAppendWorkspace`) stays in
  `store/workspaceIO.ts` — that module is not moving, it is already its
  own file below the store-size pin — so only the action's one-line
  delegate travelled. `store/useApp.ts` **1,639 → 1,451 lines (−188)**;
  its `STORE_PINS` entry ratcheted DOWN to 1,451 with a dated
  justification. The bodies are byte-identical modulo one indentation
  level (object literal at depth 1 → the creator's `return {` at depth
  2); ten import STATEMENTS were narrowed or removed, covering 13
  bindings, leaving `useApp.ts` without them
  (`migrateGroupsToFolders`, `mainWindow`, `focusTransientReset`,
  `sanitizeDocumentBackedPlotWindows`, `hydrateView`, `defaultErrKeys`,
  `originHiddenChannels`, `sanitizeVisibleDetailsColumns`,
  `sanitizeTechniqueViewMemory`, `loadedMapViews`, `runAppendWorkspace`,
  `WorkspaceState`, `LoadedWorkspace`) — 5 statements removed outright
  (`lib/errorbars`, `lib/workspace` types, `lib/libraryDetailsColumns`,
  `lib/techniqueViewMemory`, `lib/windowDocumentPersistence`) and 5
  narrowed (`lib/foldertree`, `lib/plotview`, `store/windows`,
  `store/workspaceIO`, `store/rois`). The FIELDS stay declared and
  initialized on AppState here, same shape as all three earlier
  extractions — `loadWorkspace` writes nearly all of them (a
  full-library replace has to), but plenty of other actions read and
  write them too, so the fields are not this cluster's alone to own. No
  new store/ layering grandfathered entry: `workspaceHydration.ts`
  imports only `lib/` helpers and sibling store modules, never
  `components/`. Four stale comments pointing at "`store/useApp.ts`'s
  `loadWorkspace`" (`store/rois.ts` x2, `store/mapView.ts`,
  `lib/openWorkspaceReplace.ts`) now say `store/workspaceHydration.ts`.
  Characterization net:
  `store/workspaceHydration.characterization.test.ts` (20 specs), written
  and run GREEN against the pre-extraction `store/useApp.ts` and passing
  byte-unchanged after the move. It pins, for both actions and every
  branch, the exact set of top-level store keys each call changes — a
  poisoned whole-`getState()` diff covering every `lib/plotview.ts`
  `VIEW_KEY`, so both the restored-plot-window branch's write AND the
  legacy/fresh path's deliberate NON-write are visible — plus the
  `toolWindowLayout` key's conditional presence (omitted under
  `skipLayout`, not reset to `{}`), the `mapPaintedLimits`/`mapViews`
  P2.8 reset (always clears `mapPaintedLimits`; restores `mapViews` only
  for datasets this load actually has), that `loadWorkspace` pushes no
  undo entry and records no macro step, and `appendWorkspace`'s
  `recordHistory`-before-mutation ordering. Sabotage-proven three ways:
  dropping the `mapPaintedLimits` reset and adding an extra unconditional
  key write (`xAxisLabel`) both turn the fresh-path key-set spec red; and
  moving `appendWorkspace`'s `recordHistory` call to AFTER the mutation
  is invisible to every OTHER spec (they only assert the post-append
  state) — closed by adding a dedicated ordering spec asserting the
  pushed undo snapshot is the PRE-append dataset list, which then failed
  as expected. Eager bundle, both trees built after their own `npm ci`
  and a `node_modules/.vite` wipe: **889,475 B at `c841c38d`** (`HEAD~1`
  of the extraction, the characterization-only commit, which cannot move
  the eager graph) → **889,496 B on the extraction commit, +21 B** (the
  new chunk boundary's own cost; `EAGER_JS_BUDGET` untouched, well clear
  of budget). The box stays `[~]`: `store/useApp.ts` is still over the
  500-line module ceiling, and `lib/api.ts` / `lib/uplotOpts.ts` /
  `lib/uplotOverlays.ts` are untouched by every pass so far.

  **Adversarial review of the fourth extraction (2026-09-19), net gaps
  closed same day.** Verdict CLEAN — the moved body and the composed
  store are byte-/reference-identical (C1/C5); seven findings, none a
  live behaviour regression. F1: the "before" SHA above was recorded as
  `fb0aa64b`, an orphaned amend that is neither this commit's parent nor
  on any branch — corrected above to `c841c38d` (the real `HEAD~1`); the
  two commits' trees are byte-identical, so the **889,475 B number
  itself was always right**, only the SHA was unreproducible (same class
  as review-1 F3, review-2 F1, review-3 F7 — a recurring mistake this
  plan and `agent_rules.md` now both call out). F7: "ten now-unused
  imports … (13 names)" conflated import STATEMENTS with BINDINGS;
  corrected above to say both numbers explicitly (10 statements / 13
  bindings), and a stale `lib/workspace.test.ts:1424` comment naming
  `useApp.ts`'s `loadWorkspace` (missed by the otherwise-thorough
  four-site cross-reference sweep) now names `store/workspaceHydration.ts`.
  F2-F6 were holes in the characterization net itself, closed in
  `store/workspaceHydration.characterization.test.ts` (20 → 23 specs):
  F2, a "surviving windows are all non-plot" spec used a `kind:
  "snapshot"` fixture with no `snapshot:` payload, which
  `sanitizeDocumentBackedPlotWindows` discards outright — `restored` was
  `[]` either way, so the spec never reached the branch it named;
  changed to `kind: "worksheet"` (a document-backed kind that round-trips
  on a live dataset binding with no extra payload) and asserts BOTH the
  restored window and the appended fresh one survive. F3: the
  restored-plot-window-layout branch had only a `toContain` loop over the
  VIEW_KEYS, which cannot see an extra key written only on that branch
  (proven with a `history: []` write gated on `restoredHasPlot` — 23/23
  and the full 7,559-test wide suite both stayed green); given the same
  exact `toEqual` key-set treatment the legacy/fresh branch already had.
  F4: `stageTab`'s write and the persisted `focusedWindowId` restore were
  each unpinned here (`stageTab` survived the ENTIRE wide suite; the
  `focusedWindowId` restore was caught only by `store/plotRecipes.test.ts`,
  never by this file or `useApp.test.ts`) — pinned with a poison seed
  `nextStageTab` actually recomputes past, and a second restored window
  so the persisted focus can be told apart from the fallback's "first
  plot window". F5: `appendWorkspace`'s header claims the delegate call
  is "provably still wired to the same function with the same
  arguments", but no spec pinned the ARGUMENTS — a silently truncated
  `ws.datasets` passed 20/20; closed with one assertion on the joined
  dataset ids. F6: BUG-010's `migrationNotice` status-line fold had no
  spec here (only in `useApp.test.ts`/`lib/openWorkspaceReplace.test.ts`);
  added. Each of the five closures was verified red under its own
  reviewer-identified mutation and green on honest code before landing.
  Test-only change: `git diff` outside
  `workspaceHydration.characterization.test.ts` (plus the two comment
  fixes above) touches no `frontend/src` product code.

  **FIFTH domain extracted 2026-09-19**, same discipline: the **macro
  recorder + pipeline view** — `startMacro`/`stopMacro`/`clearMacro`/
  `recordMacro` (the recorder; curated call sites throughout the store
  invoke `recordMacro` unconditionally — the gate on whether it actually
  appends a step, and the anti-self-recording-loop guard while the pipeline
  runner replays steps, both live in this cluster) and
  `updateStepParams`/`toggleStep`/`removeStep`/`moveStep`/`insertStep`/
  `loadSteps`/`setPipelineRunning` (the editable pipeline view, #6, over the
  SAME `macroSteps` list the recorder fills) — 11 actions over 3 fields
  (`macroRecording`, `macroSteps`, `pipelineRunning`) — moved verbatim to
  the new `store/macroPipeline.ts` (`MacroPipelineSlice`), composed exactly
  like `plotViewSettings.ts`/`reportsFigureDocs.ts`/`viewAppliers.ts`/
  `workspaceHydration.ts`: one import line, one word on the `extends`
  clause, one creator-spread line. `store/useApp.ts` **1,451 → 1,386 lines
  (−65, measured by `src.split("\n").length` as `architecture.test.ts`
  measures it — one more than the `wc -l` count because the file ends with
  a trailing newline)**; its `STORE_PINS` entry ratcheted DOWN to 1,386 with
  a dated justification.
  Unlike the fourth extraction (workspace hydration) immediately above,
  the FIELDS moved WITH the actions — declared and initialized on
  `MacroPipelineSlice` itself, not on `AppState` — because this is a genuine
  own-state slice (`store/gadget.ts`'s shape), not a shared-field mutator
  (`store/corrections.ts`'s/`plotViewSettings.ts`'s shape): grep across
  `store/*.ts` before the move found nothing outside this cluster WRITING
  `macroRecording`/`macroSteps`/`pipelineRunning` except
  `store/workspaceHydration.ts`'s `loadWorkspace` (`ws.macroSteps ?? []`, a
  plain-object-literal bulk `.dwk` restore — the same "bulk restores stay
  outside the cluster" shape every earlier P4.1 domain already documents for
  its own fields, not a functional dependency on this slice). Chosen for
  its isolation: unlike every other candidate left in `useApp.ts`
  (dataset CRUD/selection, the folder tree, the ~30 workshop open-flags),
  this domain touches no `datasets`, no windows, no history, and — unlike
  every earlier P4.1 domain — none of its 11 actions call
  `get().recordHistory` or `toast(...)` at all; macro/pipeline edits are
  simply not part of the undo stack (`history.ts`'s own exclusion list),
  which is why this extraction's characterization file has no undo-label/
  toast half the way the first four do. No new `store/` layering
  grandfathered entry: `macroPipeline.ts` imports only `lib/pipeline`'s pure
  step primitives and the `AppState` TYPE from `./useApp`.
  Characterization net: `store/macroPipeline.characterization.test.ts` (26
  specs), written and run GREEN against the pre-extraction `store/useApp.ts`
  and passing unchanged after the move. It pins, per action AND per branch,
  the exact set of top-level store keys each call changes — a poisoned
  whole-`getState()` diff — including the one genuine short-circuit
  (`moveStep`'s "id not found" branch returns a literal `{}` and writes
  nothing at all, not even a new `macroSteps` array reference) told apart
  from every OTHER unmatched-id branch (`updateStepParams`/`toggleStep`/
  `removeStep`), which still produces a NEW `macroSteps` array reference via
  `.map`/`.filter` even though its content is unchanged — and from the three
  plain boolean flip-setters (`startMacro`/`stopMacro`/`setPipelineRunning`),
  where a store-wide non-default poison would have hidden half of each
  writer's behavior (the "already at the target value" case), so each of
  those specs arranges its own starting value instead and a dedicated pair
  of specs pins the "no observable diff when already at the target" case as
  real, documented behavior. Sabotage-proven four ways: removing the
  `!pipelineRunning` half of `recordMacro`'s gate, removing `moveStep`'s
  `i < 0` short-circuit, dropping `clearMacro`'s `macroRecording: false`
  half, and skipping `updateStepParams`'s `regenerateStep` call for a
  runnable kind — each reddened exactly the spec written to catch it and
  nothing else, confirmed by re-running the file after each single-line
  break and restoring it before the next.

  **Adversarial review of the fifth extraction (2026-09-19), findings closed
  same day.** Verdict: all four sabotages reproduced exactly as claimed, the
  pre-extraction green was confirmed at the characterization commit, the
  layering guard and the 1,386 pin both check out, and the full gate
  matched. Two findings, both test/doc-only. MED (confirmed): `poison()`
  seeded only `macroSteps`/`pipelineRunning` — `macroRecording` was never
  poisoned for the seven pipeline-view actions
  (`updateStepParams`/`toggleStep`/`removeStep`/`moveStep`/`insertStep`/
  `loadSteps`/`setPipelineRunning`), which passed only via file-order
  carryover from the preceding `recordMacro` block leaving it `true` —
  proven by isolating them (`vitest run -t`), where it read back as the
  default `false`, contradicting the file's own "each spec arranges its own
  starting value" rule and leaving that coverage order-dependent. Fixed by
  seeding `macroRecording: true` in `poison()`; all 26 specs still pass, and
  each of the seven pipeline-view describes was re-run in isolation
  (`vitest run -t` on all seven, not just two) and still passes — none of
  the seven writes `macroRecording` (confirmed by source), so no
  changed-key `toEqual([...])` array needed updating; the fix makes
  existing, correct coverage order-independent rather than surfacing a new
  gap. LOW (confirmed): this note's own "the two plain boolean
  flip-setters (`startMacro`/`stopMacro`/`setPipelineRunning`)" named three,
  not two — corrected to "three" above.
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

- [x] ~~Goldens for plain/errors/group/facet/y2/break/waterfall/2-D/decor/panels~~
  SHIPPED 2026-09-14 (tests only): eight committed figure goldens plus a
  page golden under `frontend/src/lib/__fixtures__/regressionMatrix/` (`plain`, `errors`,
  `group`, `facet`, `y2`, `break`, `waterfall`, `decor`, `page`), each the
  canonical structural projection of a deterministic TS-built fixture
  (`lib/regressionMatrixFixtures.testkit.ts`). **2-D could not be built and is
  deliberately absent:** this repo has no first-class 2-D/heatmap FIGURE —
  `/api/export/map-figure` has no frontend wrapper at all (stated in
  `lib/api/figures.ts`), `PLOT_MARKS` has no 2-D member, and `FigureDocument`
  therefore cannot express one, so it has no place on the document path the
  three legs share. How to add a fixture: add a builder, list it in
  `MATRIX_FIXTURES`, regenerate with `node
  frontend/scripts/freeze-regression-matrix.mjs` (added 2026-09-14; `--check`
  diffs without writing), commit the JSON.
- [x] ~~Screen/export/reopen STRUCTURAL equivalence~~ SHIPPED 2026-09-14
  (tests only — no production code changed): `frontend/src/lib/
  regressionMatrix.test.ts` asserts SCREEN ≡ EXPORT ≡ REOPEN on one canonical
  structural payload for every fixture, where screen reads the real uPlot
  options object (`lib/uplotOpts.ts`'s `buildOpts` over `usePlotPayload`'s own
  pipeline), export reads the real `FigureSpec`
  (`buildFigureSpecFromDocument`), and reopen reads the FigureDocument that
  comes back out of `serializeWorkspace` -> `parseWorkspace`; the page leg adds
  `buildPageSpecFromDocument` vs `resolvePagePanel`/`pagePanelLabels`.
  Extractors: `lib/regressionMatrix.testkit.ts` (payload + shared helpers),
  `lib/regressionMatrixLegs.testkit.ts` (screen + export),
  `lib/regressionMatrixReopen.testkit.ts` (reopen),
  `lib/regressionMatrixPage.testkit.ts` (the page). The box's wording was
  narrowed from "structural **and visual** equivalence" to "STRUCTURAL
  equivalence" on 2026-09-14 so the strike-through matches the delivered scope;
  the visual half is its own open box below.
  **Five divergences found, each filed as a bug and pinned by a test asserting
  BOTH concrete values, none fixed here** (all in `regressionMatrix.test.ts`'s
  "divergences found" block): D1/BUG-012 a document's `plot.axisBreaks.x`
  reaches the export wire and survives reopen but NOTHING on screen renders it
  (`PlotView`, the canvas's whole input, has no break field;
  `useEffectiveComposition`'s durable fallback covers `facetKey` only and the
  on-screen break is the transient `composition` from `breakAtGaps`);
  D2/BUG-013 the canvas offsets every series by `view.waterfall` (measured
  0.8125 on the fixture) while `FigureSpec` has no waterfall field, so the
  export draws un-offset curves; D3/BUG-014 a legend rename replaces the whole
  on-screen label but only `dataset.labels[ch]` on the wire, so the exported
  legend re-appends the unit ("Loop 1 (au)"); D4/BUG-015 hiding a series shifts
  later series' palette positions on export (`buildExportStyles` with
  `cycle: null` over the hidden-FILTERED list) but not on the canvas;
  D5/BUG-016 a grouped figure's per-series styling reaches the canvas (every
  level drawn dashed) but `routes/export_figures.py:236-238` drops
  `series_styles` on the `group_col` branch, so the exported curves are solid
  and default-coloured.

  **Review round 2026-09-14 (findings closed, tests/fixtures/plans only).** An
  adversarial review of the matrix found three load-bearing comparisons that
  were vacuous or false comfort, and eight nits; all are closed here.
  (1) `FIXTURE_COLORS` — the only fixture with explicit `SeriesStyle.color`
  overrides — was byte-identical to the first two `TEST_SERIES_PALETTE` slots,
  so "the override wins" was indistinguishable from "the palette was used";
  the colours are now disjoint (`#ffe066`/`#66ffd9`/`#ff8fa3`/`#b0ff7f`, all
  clearing `resolveDrawColor`'s MIN_CONTRAST on the pinned dark theme by 8.7x
  or more), `decor.json` is regenerated, and the `decor` test asserts both
  `=== FIXTURE_COLORS[0]` and `!== TEST_SERIES_PALETTE[0]`.
  (2) `projectExportPage` resolved its panel labels by calling
  `pagePanelLabels(page.panels, page.output.labelFormat)` — the screen leg's
  own call on the screen leg's own input — so `spec.label_format` was read by
  no leg at all; it now rebuilds the slot list from `spec.panels` at
  `row*cols+col` and resolves from `spec.label_format`, and the `page`
  parameter is gone.
  (3) GROUP mode compared `spec.series_styles`, a wire field the renderer
  provably never reads on that branch, which both gave false comfort and hid
  D5; `styleComparable("group")` is now `false` (facet's treatment, with the
  `export_figures.py` citation) and the divergence is BUG-016 with its own
  test. Nits closed: the five `it.fails` pins became explicit
  `DIVERGENCE (BUG-01x): …` tests asserting both concrete values and their
  difference (an `it.fails` passes on any throw); the two wrong fixture counts
  in the fixtures header (eight figures + page = nine goldens); a committed
  regeneration script, `frontend/scripts/freeze-regression-matrix.mjs`
  (`--check` diffs without writing) replacing the "temporarily add a test that
  writes the JSON" ritual, verified to reproduce the seven unchanged goldens
  byte-identically; `reopenProject` widened to round-trip ALL four page
  figures instead of panel 0 only; the module-scope `function document(...)`
  in the fixtures testkit renamed to `makeFigure` (and the reopen leg split
  into its own module, the legs testkit having been at 486/500); and two
  KNOWN-LIMIT notes recorded in the testkit header — colour equality is
  conditional on contrast-safe colours because of `resolveDrawColor`, and the
  facet partition plus `mode` are shared-input rather than independent
  evidence, as is the screen leg's hand-written mirror of `usePlotPayload`
  (driving the real hook was measured as not cheap: it delivers its payload
  through an async `fetchPlot` state transition, while `projectScreen` is a
  synchronous function called ~20 times across the suite).
  Sabotage-verified: dropping `style?.color` in `seriesStyleCycle.ts` and
  forcing `label_format: "roman"` in `panelResolve.ts` — both of which the
  matrix passed before this round — now fail named tests, as do the four
  product-code mutations the original commit recorded.
- [ ] Visual (rendered-output) equivalence for the same nine fixtures — the
  half of the box above that 2026-09-14's structural matrix did not cover.
  Today's rendered-bytes coverage is `tests/test_export_vector_structure.py`
  on ONE A8 fixture; the screen canvas has no rendered-output comparison at
  all.
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
2. [x] ~~P1.2 project lifecycle.~~ COMPLETE 2026-09-04 — lifecycle slices
   `#180`, recovery hardening `#291`, and the P0.4-conditional container box
   decided NOT REQUIRED (`#294`). Gate B itself stays open for steps 1, 3, 4.
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
  overlay onto a decimated base. ~~KNOWN RESIDUAL: zoom shows the kept
  envelope only~~ CLOSED 2026-07-31 (`232cf4f`): `PlotRequest` gains
  `x_min`/`x_max` (both-or-neither, rows windowed before decimation in
  pure `window_columns`); committed zoom/pan re-fetches the window
  latest-wins via AbortController; reset restores the CACHED full-range
  payload with no fetch; stale responses compared against the current
  window before applying; overlay-companion datasets never enter the
  path (their base is never decimated). Pushed `lib/api.ts` over its pin
  → `api/plot.ts` extracted, pin lowered 1895→1866. Documented boundary:
  background/panel windows don't wire `xLim` (non-interactive preview
  scope; cross-window sync is a separate question).
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
  "not required at measured scale" (recorded as DECIDED NOT REQUIRED and the
  P1.2 box closed 2026-09-04, #294).
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

#### 2026-08-17 — P1.4 categorical/metadata CONTRACT, Slice 1 (Sonnet agent, worktree `lane-c`)

- Shipped the representation + import capture + accessor layer +
  P1.5/P1.6-ready group-label plumbing on `claude/p14-categorical-contract`
  (NOT merged to `main` by this slice — orchestrator to land). NOT in
  scope: the Import Wizard UI overhaul (P1.6) and Graph Builder
  live-grouping parity (P1.5) — this slice is backend/lib contract only.
- Red-first on both P0.3-measured failures, verified against pre-fix
  `import_csv` by hand before the fix landed: f1 (leading text column) gave
  `ds.time == [nan, nan, nan]`; f2 (trailing text-only columns) raised
  `ValueError: no valid data columns`. Also red-first on a third bug found
  while implementing (not one of the two P0.3 failures, but the same
  "silent loss" class): the Import Wizard's `label` role dropped its raw
  strings with literally no metadata trace — worse than a default import,
  which never offers that role and so never lost anything.
- `DataStruct.cat_levels` is deliberately narrow-gated: `import_csv`'s
  f2-style promotion (text -> categorical) fires ONLY when the numeric-only
  column selection is EMPTY (the actual failure condition), so a file with
  at least one real numeric data column plus a text column is
  byte-identical to before (`text_columns` sidecar, unchanged) — verified
  by re-running the pre-existing `test_csv_keeps_a_text_column_as_metadata`
  family unmodified.
- Found and deliberately did NOT fix: an all-text CSV with NO numeric column
  anywhere (e.g. `"Sample,Tag\nA,X\nB,Y\n"`) has its header row misdetected
  as a THIRD data row by `_delimited_layout._detect_layout` (numeric-score
  layout detection has no signal when literally nothing in the file is
  numeric) — pre-existing, unrelated to f1/f2, out of scope for this
  narrow slice. Left as a residual for whoever next touches layout
  detection or all-text-file import. Honest severity note (review round):
  this slice's f2 fix changed that pre-existing bug's OUTWARD BEHAVIOR from
  loud to silent — before, this exact file raised `ValueError: no valid
  data columns` (a visible failure); after, it "succeeds" silently with the
  misdetected header row folded in as spurious categorical levels
  (`cat_levels` picks up `"Sample"`/`"Tag"` alongside the real `"A"`/`"B"`
  values, and `n_points` is off by one) — worse to debug than a raised
  error, even though it is not itself one of the two contracted failure
  modes. Flagging it here rather than letting the silence stand unremarked.
- Gates: backend `uv run pytest -q` 3431 passed / 268 skipped / 18 xfailed
  (0 failed); `-m golden` 155 passed / 93 skipped (missing MATLAB freeze
  files, expected outside CI) / 0 failed — untouched by this slice, as the
  contract requires; ruff + mypy --strict clean. Frontend `tsc --noEmit`
  clean, `eslint --max-warnings=0` on every touched/new file clean, full
  `vitest run`: 480 test files / 7077 tests, ALL passed on a clean re-run
  (a first run under heavy shared-machine contention showed one flake in
  `GridViewport.perf.test.tsx`'s wall-clock fan-out assertion — a
  pre-existing, unrelated, documented-flaky-under-load test per this
  plan's own "Test determinism" notes; confirmed unrelated by file-overlap
  check and by passing 4/4 in isolation before the clean full re-run
  settled it). `npm run build`: bundle-size OK, 826.5 kB eager (27.5 kB
  under the 854.0 kB budget). Also discovered and fixed in-flight: the new
  field pushed `lib/plotspec.ts`/`lib/types.ts` over their
  `architecture.test.ts` line-count pins — fixed by extracting the shared
  group-label-resolution logic into the new `lib/categorical.ts` sibling
  (the ceiling test's own prescribed remedy) rather than raising either
  pin; both files land at their ORIGINAL line counts.

#### 2026-08-18 — P1.4 review round: P1-1 blocker + adjudicated P2s/P3s fixed same-day (Sonnet agent, worktree `lane-c`)

- **P1-1 (blocker, RESOLVED):** the wire-key mismatch — backend
  `cat_levels` (snake_case) vs. frontend `catLevels` (camelCase), so every
  categorical accessor was dead code against a real import. Renamed the TS
  field everywhere (`types.ts`, `categorical.ts`, `barlayout.ts`,
  `modeling.ts`, `plotspec.ts`, all touched tests) and pinned the boundary
  with a SHARED fixture: `tests/fixtures/wire/categorical_import.csv` +
  `categorical_import_payload.json`, read by a new backend test
  (`test_wire_fixtures.py`, byte-for-byte against the real
  `datastruct_payload()` output) AND a new frontend test
  (`categoricalWireFixture.test.ts`, through the real `parseWorkspace`/
  `isCategoricalChannel`/`levelLabel` path). Red-first evidence: the
  frontend fixture test, run against the still-camelCase code before the
  rename, failed exactly as predicted (`isCategoricalChannel` false,
  `levelLabel` null against the backend's real payload).
- **P2-2 (split drops levels), FIXED:** `lib/datasetsplit.ts`'s
  `sliceDataStruct` now carries `cat_levels` forward (a row slice preserves
  column layout). Red-first: a dedicated test showed `sliced.cat_levels ===
  undefined` before the one-line fix.
- **P2-1 (merge drops levels), FIXED per ruling:** `lib/merge.ts` now
  carries a channel's level table forward IFF every merged dataset has an
  IDENTICAL (same order) table for it; any mismatch (differing strings,
  differing order, or a missing table) drops just that channel. Real
  conflict resolution (remapping codes onto a union table) is explicitly
  booked under P1.5, not built. Red-first on both branches (identical ->
  carried was red before the fix; differing -> dropped already matched the
  old unconditional-drop behavior, so it wasn't itself a red case, but is
  pinned going forward).
- **P2-4, FIXED:** `io/import_preview.py`'s `label`-role `text_columns`
  capture gained the `.strip()` `io/delimited.py`'s sidecar always applies
  (one line). Red-first: a whitespace-padded cell round-tripped verbatim
  before the fix.
- **P2-5, FIXED:** `lib/barlayout.ts`'s `textLabelsFor` now reads
  `metadata["text_columns"] ?? metadata["origin_text_columns"]`, matching
  `columnmeta.ts`'s exact `??` order (was Origin-only). Red-first with the
  reviewer's probe shape: a generic `text_columns` sidecar labeling a
  numeric group column returned formatted numeric levels, not the text
  labels, before the fix.
- **P2-3 + P3-1 (validation teeth), ruling applied — document + degrade,
  never throw:** backend `DataStruct`'s docstring now states explicitly
  that construction validates `cat_levels`' TABLE SHAPE only; a value
  cell's code/level COHERENCE degrades at read time (`level_of` -> `None`),
  pinned by a new test constructing a DataStruct with out-of-range/
  negative/NaN codes in a categorical column (construction succeeds,
  `level_of` degrades per-cell). Frontend: BOTH `lib/categorical.ts`'s
  accessors (`isValidLevelList`, checked directly in `isCategoricalChannel`/
  `categoricalLevels`) AND `lib/workspace.ts`'s `.dwk` load path
  (`sanitizeDataStruct`, imported from `lib/categorical.ts` to stay under
  `workspace.ts`'s OWN `architecture.test.ts` line-count pin — moving the
  logic to the sibling module the SAME lesson slice 1 already applied to
  `plotspec.ts`/`types.ts`) now reject a structurally corrupted table.
  Red-first with the reviewer's exact `{0: "AB"}` corruption shape: before
  the fix, `isCategoricalChannel` returned `true` and `levelLabel`
  returned the individual CHARACTERS `"A"`/`"B"` (JS indexes into a string
  the same as an array) — silent, plausible-looking, wrong data, not a
  caught error. After: no categorical status, `levelLabel` returns `null`.
  Pinned twice — directly in `categorical.test.ts` (any ingestion path) and
  through the real `.dwk` load in `workspace.test.ts` (including a
  mixed-corruption case: one bad channel entry is dropped, a well-formed
  sibling entry survives).
- **P3 bookings (plan text only, this entry + the P1.4 section above):**
  `store/cellEdit.ts`'s `setCellValue`/`setCellBlock` write raw numbers
  into any cell, categorical channels included, with no level-aware guard
  or UI — degrades safely today (P2-3/P3-1's ruling) but has no
  discoverability; booked under P1.6's worksheet-UI slice. The all-text
  header-misdetection residual (noted above) got an honest severity-change
  sentence: this slice's f2 fix turned that PRE-EXISTING bug from a loud
  `ValueError` into a SILENT wrong-shape import for that one edge case —
  flagged, not fixed (out of scope). Round-trip language narrowed
  throughout this plan and `JMP_GAP_PLAN.md`: "proven both languages" now
  means, precisely, SHARED-FIXTURE WIRE PARITY (P1-1's one JSON file two
  suites read) — distinguished from the pre-existing hand-synced
  parity-fixture pattern (`build_grouped_series`/`buildXY`'s matching test
  pair), which only catches the two implementations drifting from EACH
  OTHER, not from the real wire shape (exactly the class of bug P1-1 was).
- Gates: backend `uv run pytest -q` 3436 passed / 268 skipped / 18 xfailed
  (0 failed, +5 over the slice-1 count: 2 wire-fixture + 1 shape-only-
  validation + 1 whitespace-strip + the new fixture CSV auto-joining the
  parser matrix walk); `-m golden` 155 passed / 93 skipped / 0 failed,
  unchanged; ruff + mypy --strict clean. Frontend `tsc --noEmit` clean,
  `eslint --max-warnings=0` on every touched/new file clean, full `vitest
  run`: **481 test files / 7100 tests, ALL passed** (clean run, no
  contention this time). `npm run build`: bundle-size OK, 827.3 kB eager
  (26.7 kB under the 854.0 kB budget). Also fixed in-flight (same lesson as
  slice 1): the P2-3/P3-1 fix initially pushed `lib/workspace.ts` over its
  OWN `architecture.test.ts` pin (592 lines, zero headroom, same as
  `plotspec.ts`/`types.ts` before it) — moved `sanitizeDataStruct` to
  `lib/categorical.ts` instead of raising the pin; `workspace.ts` lands at
  its exact original line count.

#### 2026-08-18 — P1.6 Import Wizard role assignment, Slice 2 (Sonnet agent, worktree `lane-c`, branch `claude/p16-import-wizard`)

- Built on the merged P1.4 backend (PR #173). Backend:
  `src/quantized/io/import_preview.py` gains `ImportSettings.label_line`
  and preamble-comment retention (`tests/test_io_import_preview.py`, +12
  tests). Frontend: `lib/errorRoles.ts` (label-only extraction, +2 tests),
  `lib/importwizard.ts` (`finalChannelOrder`/`suggestErrorBindings`/
  `errorRoleChannels`/`seedErrorRows`/`confirmedErrorBindings`/
  `errorTargetOptions`/`resolveImportFilter`, +18 tests), `lib/types.ts`
  (wire shape additions), new `components/workshops/importwizard/
  useImportErrorRoles.ts` (+6 tests) and `ErrorRolesEditor.tsx` (+7 tests),
  `useImportWizard.ts` + `ImportWizardPanel.tsx` + `PreviewTable.tsx`
  updated and their existing test suites extended (+2/+6/+2 tests
  respectively) rather than replaced.
- Red-first evidence (by hand, before each fix): label_line —
  `ImportSettings` had no such field at all (TypeError on construction);
  preamble comments — `parse_import`'s `metadata` never carried a
  `"comments"` key, confirmed via a direct call before the fix. The
  "confirm, never silently attach" invariant (item 2) is pinned going
  forward by `suggestErrorBindings`/`confirmedErrorBindings` tests (an
  ambiguous column yields no suggestion; an unassigned row never reaches
  `Dataset.errorRoles`) — this is a NEW feature, not a behavior flip, so
  "red" here means "did not exist to test" rather than "regressed"; the
  filter-refusal tests (item 4) are the same shape. One GENUINE bug caught
  by its own new test during development (not a review find): the reseed
  effect in `useImportErrorRoles.ts` was gated on a `useMemo`'d signature
  STRING as the effect dependency, so React's own value-based dependency
  comparison silently skipped `resetErrorRows`'s forced reseed when the
  signature string was unchanged — fixed by depending on the `columns`
  ARRAY reference instead and doing the value comparison manually inside
  the effect body; `useImportErrorRoles.test.ts`'s "resetErrorRows...
  forces a fresh reseed" test is the regression guard.
- Explicitly NOT shipped (booked, see P1.6b above): the worksheet C/O/N
  modeling-type UI and `cellEdit`'s categorical-write guard — neither fell
  out naturally from the routes/store work this slice owned.
- Gates: backend `uv run pytest -q` 3469 passed / 268 skipped / 18 xfailed
  (0 failed); `-m golden` 155 passed / 93 skipped / 0 failed, unchanged;
  ruff + mypy --strict clean. Frontend `tsc --noEmit` clean, `eslint
  --max-warnings=0` clean on every touched/new file, full `vitest run`:
  **493 test files / 7332 tests, ALL passed** (0 failed). `npm run build`:
  bundle-size OK, 841.2 kB eager (12.8 kB under the 854.0 kB budget — the
  narrowest headroom yet; the next slice touching `useApp.ts`'s bundle
  chunk should watch this). Also fixed in-flight (same lesson as both
  prior rounds): `lib/types.ts`'s wire-shape additions pushed it back over
  its `architecture.test.ts` pin (1053 lines, zero headroom yet again) —
  compressed the new/touched doc comments to single trailing-line style
  (matching the file's own `values: number[][]; // row-major: ...`
  precedent) rather than raising the pin; lands at its exact original line
  count.

#### 2026-08-18 — P1.5 live Graph Builder grouping parity (Sonnet agent, worktree `lane-c`, branch `claude/p15-live-grouping`)

- Root cause traced before writing code: `FigureDocument.bindings.groupKey`
  already existed and already drove Publication Preview + backend export;
  `figureDocumentToPlotView` (the ONE bridge into the interactive Stage's
  render pipeline) silently dropped it. `lib/plotview.ts` (`PlotView.
  groupKey`, `+3` net lines after two ratchet trims to stay at its
  978-line pin — `wc -l` undercounts this repo's `split("\n").length`-based
  guards by 1 whenever a file ends with a trailing newline, a discrepancy
  worth remembering for future line-budget arithmetic), `lib/figureDocument.ts`
  (bindings-owned exclusion + the two projection functions), `store/useApp.ts`
  (`groupKey` singleton + `setGroupKey`, mirrors `setXKey`), new
  `lib/plotGroupSplit.ts` (a fresh sibling module funding itself rather than
  growing `lib/plotdata.ts` past ITS pin — `applyGroupSplit`/
  `groupSplitChannelMap`, algorithm-identical to `plotspec.ts`'s `buildXY`),
  `components/Stage/usePlotPayload.ts` (wires it into the fetch pipeline,
  suppresses error-bars/spans/color-by when grouped, same ruling `buildXY`'s
  own preview already applies), `components/workshops/graphbuilder/
  useGraphBuilder.ts` (`commitToPlot` calls `setGroupKey` instead of
  toasting "preview-only"). `lib/merge.ts`'s real conflict-resolution remap
  (P1.4's booked item) shipped alongside it. `lib/windowDocumentPersistence.ts`
  gained one real bug fix caught by its own new red-first test:
  `migrateLegacyWindow` never threaded `view.groupKey` into
  `createFigureDocument`, silently losing a document-less grouped window's
  binding on its very next save/reload.
- Red-first evidence: `useGraphBuilder.test.ts`'s 3 new P1.5 tests confirmed
  RED (`groupKey` stayed null / stale-2 leaked / toast still showed) before
  the `commitToPlot` fix; `groupKey.test.ts`'s `.dwk`-round-trip test caught
  the `migrateLegacyWindow` bug as a genuine RED (not manufactured) before
  that fix; `merge.test.ts`'s remap assertions were hand-computed against
  the algorithm before running, confirmed correct on first green run.
  `usePlotPayload.groupSplit.test.ts`/`plotGroupSplit.test.ts` were composed
  alongside their (carefully hand-traced) implementations rather than
  strictly red-first, given the small blast radius of pure functions — noted
  honestly rather than overclaimed.
- Explicitly booked, NOT shipped: statistical/scientific faceting parity
  (Facet's own live mechanism, `facetByColumn`, is structurally unrelated —
  see `group-facet-journey.spec.ts`'s header) and the Data Filter/Tabulate/
  Stat Stage workbench wiring through `is_categorical` (P1.4's own booking,
  still no named-home slice).
- Gates: no `src/` (backend) files touched this slice, so no backend gate
  run. Frontend `tsc --noEmit` clean; `eslint --max-warnings=0` clean on
  every touched/new file except ONE pre-existing warning in
  `useGraphBuilder.ts` (line 184, an unrelated effect ~170 lines from this
  slice's own 6-line diff there — confirmed pre-existing via `git diff`
  line-correlation, not introduced by this slice); full `vitest run`:
  **514 test files / 7574 tests, ALL passed** (0 failed) — this run also
  caught and fixed 2 genuine regressions in a PRE-EXISTING F2.5b export
  test file (`exportFigureCommand.test.ts`): two tests constructed a
  `FigureDocument` with `groupKey` set directly without ALSO setting the
  new live `groupKey` singleton, which `windowsForSave()`'s existing
  live-view rebuild (an established pattern the SAME file's own header
  already documents for `xKey`/`yKeys`) now legitimately overwrites — fixed
  by setting the singleton too, matching that established pattern, plus a
  stale doc-comment correction (item 6) in the same file. `npm run build`:
  bundle-size OK, 849.9 kB eager (34.0 kB under the 883.9 kB budget).
  E2E: `group-facet-journey.spec.ts` extended with a second journey (live
  Stage render/undo/redo/close-reopen/export) and its stale header
  corrected; verified via `tsc -p e2e/tsconfig.json --noEmit` (clean) and
  `playwright test --list` (both tests discovered) but NOT executed against
  a real browser this session — Playwright's Chromium download
  (`cdn.playwright.dev`) is blocked by this sandbox's egress policy
  (confirmed via the agent-proxy's own status diagnostic). Needs a CI run
  or a networked dev machine before merge.

#### 2026-08-18 — P1.5 review round: P1 blocker + P2 doc-accuracy fixed same-day (Sonnet agent, worktree `lane-c`, branch `claude/p15-live-grouping`)

- P1 (probe-proven): `store/windowDefaults.ts`'s `datasetViewDefaults()` —
  the shared choke point `setActive`/`addDataset`/a shape-changed reimport
  all rely on to reset channel-indexed PlotView fields — never listed
  `groupKey`, so a stale group binding survived a dataset switch and rode
  into the new dataset's (differently-shaped) columns. One-line fix
  (`groupKey: null` added to the reset object), plus a new coverage test
  (`store/windows.test.ts`) pinning the full channel-indexed field list so
  a future field can't slip the same way unnoticed.
- P2 (doc accuracy): `plotGroupSplit.ts`'s claim that `applyGroupSplit` was
  "a second call site of the identical algorithm" `buildXY` uses was
  falsifiable — the two share no code and the existing test never checked
  against `buildXY` at runtime. Fixed with a REAL parity test
  (`plotGroupSplit.test.ts`, `buildXY` exported to make it possible), which
  surfaced one genuine (previously inert) divergence — `applyGroupSplit`
  lacked `buildXY`'s explicit non-finite-Y mask — fixed to not rely on the
  upstream-already-nulled coincidence that made it harmless today.
- P3 (nitpick): one-line comment added to the E2E spec naming which
  assertion is load-bearing for the close/reopen proof.
- Red-first evidence: P1's 4 new tests (setActive/addDataset/reimport/
  coverage) all confirmed genuinely RED against the pre-fix
  `datasetViewDefaults` (quoted: `expected 1 to be null` / `expected 2 to
  be null` / `expected +0 to be null` / a missing `"groupKey"` key in the
  coverage diff) before the one-line fix. P2's finite-guard divergence was
  verified to actually matter (not just theoretically) by temporarily
  reverting the guard and confirming the new direct unit test failed
  (`expected [...NaN...] to equal [...null...]`) before restoring it.
- Gates: no backend files touched. `tsc --noEmit` clean; `eslint
  --max-warnings=0` clean on every touched file; full `vitest run`:
  **514 test files / 7584 tests, ALL passed** (+10 over the prior count,
  matching the new tests added this round). `npm run build`: bundle-size
  OK, 849.9 kB eager (34.0 kB under the 883.9 kB budget, unchanged). E2E:
  `tsc -p e2e/tsconfig.json --noEmit` clean, `playwright test --list`
  still discovers both tests — still not executable in this sandbox (same
  blocked-host constraint as the prior entry).

#### 2026-09-07 — P1.6 backend/import-contract lane: header_fields + categorical guards (Sonnet agent, branch `claude/p16-import-metadata`, stacked on `claude/p16-import-error-bindings`)

- Part A (additive): `io/import_metadata.py` (new, 131 lines) parses the
  SAME preamble lines `_preamble_comments` already retains verbatim into an
  ordered `dict[str, str]` (`key: value` / `key = value`, optional leading
  `# % // ;` marker, both halves trimmed) — `metadata["header_fields"]`,
  omitted entirely when empty, never a replacement for `comments`. Keys
  stay VERBATIM (never normalized). A repeated key: LAST value wins,
  reported once per key (`{"type": "duplicate_header_field", "key": ...}`)
  in `preview_import`'s new `header_field_problems` list — the SAME
  structured-problems-channel convention `error_binding_problems` already
  established. Capped independently at `MAX_HEADER_FIELDS` = 200 distinct
  keys (documented reasoning: real instrument preambles carry a handful to
  a few dozen fields; the comment-line cap of 500 already bounds this in
  practice, but the field cap doesn't ride on that constant so a future
  change to one can't silently move the other).
- Part B: checked FIRST per the booking's own instruction —
  `ImportPreviewColumn.effective_name` (already shipped, PR #197, "P1-5
  DEFECT 2", well before this lane) already IS the booked display slot: a
  resolved-label field of its own, `label_line`-applied text without
  overwriting `name`. Nothing added backend-side; the P1.6b booking bullet
  above updated to record it SHIPPED rather than re-adding the field. The
  frontend's `PreviewTable` doesn't yet RENDER `effective_name` as a
  visible cell — flagged as a separate, unbooked, frontend-only follow-up.
  **Closed 2026-09-12** — see the P1.6 item's own box above (~line 1578)
  for the evidence: shipped 2026-09-07, commit `3b1ad5a1` (#314),
  `PreviewTable.tsx:96-104` + `PreviewTable.test.tsx:71-80`.
- Part C: `io/import_categorical_guards.py` (new, 118 lines) adds two
  guards around `delimited._encode_categorical` WITHOUT touching its
  lossless round trip or level order: a level-count cap
  (`MAX_CATEGORICAL_LEVELS` = 500, chosen to mirror `MAX_PREAMBLE_COMMENTS`'s
  order of magnitude — real categoricals span a few to a few hundred
  levels, not thousands) that REFUSES `parse_import` (a `ValueError` naming
  the column(s)/counts) but only REPORTS in `preview_import`
  (`categorical_problems`, never raises there); and case-collision
  reporting (`"Fe"`/`"fe"` kept distinct, whitespace already merged by
  `_encode_categorical` itself) that never raises anywhere, informational
  only. Deliberately does NOT touch `import_csv`'s own automatic
  categorical-promotion fallback (f2/D6) — that path exists to rescue an
  otherwise-unimportable file with no numeric columns at all, and applying
  a hard refusal there would turn a previously-importable messy file into
  an import failure with no user decision behind it; pinned by
  `test_import_csv_categorical_fallback_is_not_capped`.
- One legitimate wire-fixture shift: `tests/fixtures/wire/
  label_import_payload.json` regenerated (its committed recipe) to include
  the new `header_fields` key its 2-line preamble now parses into — no
  other fixture moved.
- `io/import_preview.py` sits at exactly 500 lines (the god-module
  ceiling) after this PR — trimmed several pre-existing docstrings
  (meaning preserved, prose tightened) to make room; `io/delimited.py`
  untouched at 468 lines (the two new guard modules were split out
  specifically so this wouldn't need to grow).
- Tests: +26 in `tests/test_io_import_preview.py` (header-field parse
  shapes/non-shapes, duplicate-key rule, both caps, the lossless round
  trip with fields extracted, the level-cap refusal + its preview-only
  report, the case-collision report + its never-blocks proof, the
  omit-when-empty rules) and +6 in `tests/test_io_delimited.py`
  (`encode_categorical_columns` unit coverage: unmodified vs
  `_encode_categorical`, the cap problem shape, no-problem-at-exactly-cap,
  one/multiple collision groups, independent per-column problems).
- Gates: `ruff check src tests tools` / `mypy src` / `pytest -q -n auto`
  all clean (4453 passed, 183 skipped, 18 xfailed — 0 failed, +32 over the
  pre-PR count). Frontend: `tsc --noEmit` clean, `eslint --max-warnings=0`
  clean on `src`, `vitest run src/architecture.test.ts src/lib` clean
  (wire types only — `lib/importTypes.ts`/`lib/types.ts` gained the new
  optional `header_fields`/`header_field_problems`/`categorical_problems`
  fields, no component changed).

- ~~**Plans reconciliation (Claude)**~~ (2026-09-09) — corrected a
  self-contradicting P1.7 "portable" mode bullet (line ~1260) that said
  "the visual workflow is NOT shipped" two sentences before describing PR 6
  (#310) shipping exactly that; verified PR 6's commit (`5b9b89b0`) is on
  `main` and `frontend/src/components/workshops/packproject/
  PackProjectPanel.tsx` + its test file exist, then reworded the bullet to
  say SHIPPED. Also flipped JMP_GAP_PLAN.md's stale "Worksheet-visible,
  editable type C/O/N" box (already correctly marked `[x]` here under
  P1.6b) — see that plan's own 2026-09-09 change-log entry.

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
