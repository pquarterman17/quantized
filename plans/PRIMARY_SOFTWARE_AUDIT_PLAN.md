# Primary Software Readiness Audit & Work Plan

**Status:** Active
**Parent:** `plans/MAIN_PLAN.md`
**Created:** 2026-07-25
**Updated:** 2026-09-06 (latest): **P1.7 Pack Project PR 5** — adversarial
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
- [ ] Multiple ordered factors and missing-value policy — level ORDER is
  represented (the tuple's own order; NaN = missing is the representation's
  missing-value policy) but user-settable REORDERING (J1's ask) is not
  built yet; that is J2/recode territory.
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
  round is the honest part of this record, not a footnote). Result: **three
  real drops fixed, two deliberate strips documented**; two categories that do
  not exist yet; one open owner question; and one bug the fix itself surfaced.

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
  - `calc/corrections.py` and `calc/resample.py` drop `cat_levels`, and the drop
    is now explicit and documented in both modules rather than reading like the
    accidental omission the sweep took it for, pinned by tests that also assert
    the codes really are invalidated for the parameters they use. **Review-round
    correction:** the first version called the drop simply "CORRECT". It is
    CONSERVATIVE, which is not the same claim. Both functions drop the table
    whenever they run, including identity-parameter paths (an empty correction
    set, a resample onto a grid coincident with the input) where the codes come
    back exactly intact and the table would still have been valid. The strip is
    right for the transforms that change values and over-broad for the ones that
    do not. Both halves — that a categorical channel is transformed at all, and
    that the table is dropped even when nothing changed — are filed as
    **BUG-005**, not papered over.

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
  **Known residual, not fixed here:** "facet by" does not exclude the column
  picked as "then by" (nor, as before this change, the one picked as "group
  by"). Facet by `site` + then by `site` gives every box in a panel the same
  constant nested half. The data stays correct and the existing facet/group
  overlap has the same shape, so widening the picker's exclusion rule is booked
  rather than bolted on here.
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
  workshops, then add contextual `?` links. Still open: the contextual `?`
  links on workshops/context actions themselves — see the (separate,
  narrower) fix below, which only closed the *search-coverage* half.
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

- [ ] Keyboard reachability, focus, order, cancel.
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

  DOES NOT EXIST, and this is the real gap:
  - **No automatic non-colour differentiator.** Plot five series and touch
    nothing and they differ ONLY by hue — `uplotOpts.ts`'s dash is applied only
    when a per-series `style.line` was explicitly set, and markers only when
    explicitly enabled or via a plot-wide default-trace preference. Dash and
    marker shape are available but never cycled. A colour-blind reader, or
    anyone printing greyscale, gets no help by default. Closing this means an
    opt-in auto dash/marker cycle mirroring the palette mechanism, WITH export
    parity — booked, not built.
  - `contrastColor.ts` checks series-vs-BACKGROUND legibility only. Nothing
    checks series-vs-SERIES distinguishability under colour-vision deficiency;
    there is no CVD simulation anywhere. `plans/design/DESIGN_GUIDE.md` calls
    the palette "color-blind-aware", which is a claim about palette CHOICE, not
    a check.
  - No greyscale/print-safe export mode. `export_figures.py`'s `style` presets
    (aps/report/web) have no greyscale variant.

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

Original acceptance criteria (unchanged):

- [ ] Consistent progress location and job identity.
- [ ] Safe cancel for long import/fit/batch/export.
- [ ] Errors say what failed, whether data changed, and next action.
- [ ] Copyable diagnostic bundle excludes raw/private data by default.
- [ ] Persistent recovery/write-failure notices.

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
