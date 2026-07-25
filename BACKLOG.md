# BACKLOG — quantized

The aggregated open-items dashboard, **derived from the plans in
`plans/`** (per the plan-hygiene rules: the code/git history is truth
#1, each plan's `## Completed` section is truth #2, this file is the
derived view — when they disagree, fix the plan first, then this file,
in the same commit). Every edit here must have a matching plan edit.

**Last reconciled:** 2026-07-25 — a ChatGPT-Sol follow-up audit added MAIN
#31–#38 after checking the current implementation against the owner's
OriginPro daily-driver workflows. Summarized in Actionable dev work below;
MAIN_PLAN holds the problem, goal, completion criteria and dependencies for
each. **All eight problem statements were verified against the code before
booking** — several are quoted from the implementation's own docstrings
(`recentFiles.ts` on picker-only reopen, `autosave.ts` on the ~5 MB quota,
`plotExport.plotPngBlob` on the screen-resolution grab). Two corrections were
applied during that review: #32's quota failure is NOT silent
(`useWorkspaceAutosave.ts` sets a status message — the real gap is that a
transient line is weaker than a persistent error, plus no durable generations),
and the audit's per-item Claude-model routing was dropped from both files as
stale process detail that does not belong in a plan. Earlier the same day, a
plan-TREE consolidation audited the set of plan FILES and found two that no
dashboard derived from:

- **The two orphan ChatGPT-"Sol" audit docs were absorbed and DELETED**
  (`SOL_FEATURE_GUI_INTERACTION_AUDIT.md`, 924 lines / 257 permanently-unchecked
  boxes; `SOL_ORIGINPRO_REPLACEMENT_AUDIT.md`, 261 lines). Neither declared a
  `**Parent:**`, neither appeared in the plans dashboard below, and
  `GUI_INTERACTION_PLAN.md` had to carry a standing disclaimer that the raw
  audit's unchecked boxes were *not* current status. That is the
  plan-consolidation rule's warning sign verbatim. Full text stays in git
  history @ `e4f6590`.
- **Absorption was verified against the code before deleting, not assumed.** Of
  the findings the audit itself still listed as open: the pipeline
  `executeSteps` fit-step channel residual is **shipped** (it replays a typed
  per-step spec via `fitSpecFromStepParams`/`fitDataForSpec` with a legacy
  fallback — exactly the prescribed fix), and the baseline residual is **shipped**
  behind the GUI #5 gate resolution. The Origin-migration and owner-decision
  findings were already tracked as gates or blocked rows below.
- **Two findings were booked NOWHERE and became MAIN #29 and #30** — the
  frontend bundle (measured today at **1,120.96 kB** in one chunk, up from ~969 kB
  at audit time) and the fit-recipe residual fields.
- **#29 SHIPPED the same day** — eager JS **1,120,960 → 932,219 B (−16.8%)** by
  lazy-loading the 25 flag-gated workshop panels out of `AppOverlays.tsx`, plus a
  `check-bundle-size.mjs` ratchet wired into `npm run build` that budgets *eager*
  JS (entry + modulepreloads = what the browser fetches before first paint) and
  fails BOTH over budget and well under it. Both branches were verified by
  planting violations. #30 remains the one open dev row.

Prior: 2026-07-24 — a FULL reconciliation pass, prompted by
finding that several rows below had gone stale against the plans they derive
from. What changed:

- **ORIGIN #54's generalized page/layer MODEL is COMPLETE.** Pass B (the y2
  singleton) shipped `50b4c9c`, joining A + C. One pure `lib/axisspec.ts`
  now owns the y2 representation and derivation; the pass surfaced a real
  screen-vs-export divergence (the spatial page export omitted `y2_fmt`
  entirely, so a non-default Y tick format formatted the primary axis only).
  Corpus swept both ways: identical, zero regressions. #54's only remaining
  sub-item is the specimen-gated >2-Y-axes rendering, which is evidence-
  blocked, not actionable — it has moved to the blocked table.
- **Security: 13 of 14 Dependabot alerts CLOSED** (`c63f7af`) — pillow
  12.2.0→12.3.0 (10 high + 3 medium) and setuptools 82.0.1→83.0.0. Only the
  upstream-blocked `glib` alert remains. All ten open Dependabot PRs were
  applied in that one commit, plus TypeScript 5.9.3→7.0.2 (`f398ac9`).
- **Four owner gates were already answered and are struck below** — GOTO Q6
  (worksheet reshape) and Q7 (date-time axes) were DECIDED YES and SHIPPED
  on 2026-07-19; GUI #1 (undo scopes) and #5 (baseline framing) were RESOLVED
  the same day during the Codex-stack review; GUI #2 (Plot Objects tree
  scope) was delivered by PR #66, so its gate is moot.
- **GUI #17 is fully complete** — the three items this file still listed as
  remaining (split buttons, the cross-menu ownership move, first-run
  interaction hints) are all struck in the plan.
- **v0.11.1 is the version in `pyproject.toml`** (v0.10.0 in the old note
  below was two releases stale).

Prior: 2026-07-21, after the three index-staleness follow-ups
booked 2026-07-19 ALL shipped (background-window view remap, spec re-key by
label, corrections overlay-clear — see the section below), plus a fourth
`reimportDataset` view-scoped clear found and fixed while working the first.
Prior: 2026-07-19, after ORIGIN_FILE_DECODE #54's page/layer
model passes A + C shipped (composition discriminated union replacing the three
parallel panel arrays, then PlotSpec's reserved `page` block filled). Prior context:
2026-07-18, after the six-PR Origin visual-import stack
merged and received an independent tip verification (frontend 3,759 + build,
18/18 Playwright, full corpus baseline-identical). The last full regeneration
was 2026-07-17, at the end of the autonomous GUI_INTERACTION campaign (11
merges; CI + CodeQL + live E2E all green): the
entire no-blocker actionable list was worked — #3, #7, #9, #10, #13, #14
CLOSED in full; #8, #11, #15 CORE shipped with residuals re-dashboarded
below; plus the ORIGIN_FILE_DECODE #54 spatial page-coordinate export
residual and an `appCommands.ts` decomposition (684→36, per-domain
`commands/*` modules, pin 684→56). Verified on the final merged tree:
frontend 3736 unit + 18 Playwright e2e + build green; backend 2906 + ruff +
mypy green. What remains actionable = the #8/#11/#15 residual rows
(#12 CLOSED 2026-07-18, see the plan's Completed section),
Tier 3 larger bets, and #54's explicit page/layer architecture residual.
Origin graphic objects (#53) are evidence-gated, not routine implementation.
The #55 owner screenshot-review
gate is unchanged (62 paired screenshots, 0/353 reviewed). v0.10.0 is the
current release. Prior context: GUI_INTERACTION adopted 2026-07-12 from the
ChatGPT-Sol audit; MAIN holds only owner gates + deferrals; the
fresh-machine PyPI acceptance run is still open.)

---

## Actionable dev work (no blockers, no owner gate)

From `GUI_INTERACTION_PLAN.md` (see it for the full tiered list + per-item
detail). Owner-gated items in that plan (#1 undo scopes, #2 tree scope, #5
baseline framing) are under Owner actions below, not here.

The 2026-07-24 reconciliation left this table empty. The 2026-07-25 plan-tree
consolidation first refilled it from the deleted Sol audit docs; the later
ChatGPT-Sol implementation audit then added eight current-code gaps that could
still make the owner switch back to Origin.

| Item | Plan / item |
|------|-------------|
| **Fit-recipe residual fields** — `FitSpec` now carries `xKey`/`yKey`/`weight`/`params`/`exitFlag`; still missing explicit fit range, starting values, parameter bounds, covariance/uncertainty method, preprocessing state, and a historical-vs-recomputed UI distinction. Partly design-constrained (registry fits expose no user bounds) | MAIN #30 |
| **Native file/workspace handling** — retain real source references on desktop; working/recent/pinned paths; true reopen, Save As, reimport/relink; distinguish offline network targets from deleted files | MAIN #31 |
| **Durable autosave/recovery/trash** — replace the `localStorage`-only recovery ceiling with rotating durable generations, visible health, crash recovery, and age/size-bounded project trash | MAIN #32 |
| **Import metadata/categorical/error roles** — preserve multiple label rows and text columns for legends/grouping/search; carry explicit error roles and provenance through templates and `DataStruct` | MAIN #33 |
| **Spreadsheet-style block editing** — rectangular clipboard operations, fill/clear/insert/delete, undo, and corrected-data provenance | MAIN #34 |
| **Publication-quality clipboard copy — RESIDUAL ONLY** — SHIPPED 2026-07-25 (`70342fa` extracts the shared `buildFigureSpec`, `e45cb48` routes "Copy figure" through the publication renderer at 300 DPI; screen grab demoted to "Copy image (screen)"). Transparent-background preference SHIPPED `ac78218` (threaded through both render paths, route, spec and Preferences ▸ Plot; opaque default pinned by tests). Remaining: clipboard SVG where the platform supports it | MAIN #35 |
| **Complete X/Y error bars** — symmetric/asymmetric X and Y pairing, override UI, and interactive/export parity — after MAIN #33 | MAIN #36 |
| **Home screen/project navigation** — recent and pinned work, working paths, recovery health, safe missing-source handling; defer global search until the base organization is validated | MAIN #38 |

The remaining dev item is a judgment call the plan explicitly parked for the
owner rather than a task:

| Item | Plan / item |
|------|-------------|
| `clearShapes` ("Clear all" in ShapesCard) — a one-click, un-undoable BULK wipe of N hand-placed shapes, riding on a confirm-exemption policy written for deleting them ONE at a time. Arguably in the spirit of the documented canvas-object exception, arguably not; the 2026-07-19 destructive-action class sweep flagged it and deliberately left it | GUI_INTERACTION #17 (open judgment call) |
| Owner-dependent Origin feature gaps — prioritize ONLY from real projects (#16); its one open sub-item is `.opju` migration edges (matrix books, some 2-D instrument data), which needs owner-supplied real files to prioritize | GUI_INTERACTION #16 |

(The two rows that stood here through 2026-07-21 — GUI #17's polish tail and
the ORIGIN #54 layout-generality residual — are CLOSED as of 2026-07-24 and
have been removed per the plan-hygiene archival rule. Their outcomes live in
the respective plans' Completed/struck entries; the header above summarizes
what landed. Do not re-add shipped work here.)

### Index-staleness follow-ups (booked 2026-07-19 by a class sweep)

A fourth instance of the row/column-index staleness class was found and fixed
(`5ac2674` — `removeFormula` remapped the dataset-scoped index-keyed fields but
not the parallel VIEW-scoped ones, so hiding a formula column and then removing
it silently hid a DIFFERENT column). The same sweep confirmed three more, each
with a concrete reproduction; **all three shipped 2026-07-21**, each with a
fail-before/pass-after regression test:

- ~~**Background windows keep a stale `PlotView`**~~ (2026-07-21) — `removeFormula`
  now walks every `PlotWindow.view` bound to the dataset via a new pure
  `remapWindowViews` (`lib/channelRemap.ts`), not just the live singleton that
  the `5ac2674` fix covered.
- ~~**Saved Graph Builder specs go stale and are re-applied blind**~~ (2026-07-21)
  — `buildDisplayBlock` now captures the plotted channels' labels
  (`DisplayBlock.labels`) and `applyDisplayBlock` re-keys `series`/`order` by
  label at apply time (identity-first + duplicate-safe; drop when the label is
  gone; by-index fallback for legacy specs).
- ~~**`alignOverlayY` assumes a TAIL trim; `xTrimMin` is a FRONT trim**~~
  (2026-07-21) — the four fit/peak/baseline/deriv overlays are now cleared at the
  source (`store/corrections.ts`) whenever a trim changes the row count, the same
  `rowsChanged` guard that already clears `excludedRows`.

- ~~**`reimportDataset` view-scoped clear on a shape change**~~ (2026-07-21) — a
  fourth instance of the same class, found while fixing the first: reimport
  cleared the dataset-scoped index-keyed state on a shape change but never the
  view-scoped state. Now resets the live view (if active) AND every bound window
  to the new shape's `datasetViewDefaults` (the derivation setActive/addDataset
  already use, re-seeding errKeys/hiddenChannels from the fresh columns); an
  unchanged shape still keeps the user's styles/hidden/keys.

### Backend hardening round (2026-07-19, `4d61e56`)

A second sweep of the "route catches a narrow exception tuple, callee raises
something else" class first named on 2026-07-05. Three live HTTP 500s on
plausible user input, all confirmed against the real app before fixing and all
now 422: `DataStruct.from_dict`'s TypeError on a non-numeric `dataset` (the
class-wide one — ~17 handlers across 7 route modules, fixed in the ONE shared
constructor), `semiconductor.fermi_level`'s ZeroDivisionError from an
underflowed `ni`, and `fitting.curve_fit`'s ZeroDivisionError on empty arrays.
Backend 3000 + ruff + mypy green. The class recurs as new routes land —
re-sweep periodically.

## Owner actions & owner-gated decisions

| Item | Plan / item |
|------|-------------|
| **PyPI fresh-machine acceptance run** — on a machine without dev tools: `pipx install quantized-lab` → import a CSV within 2 min; also verify the v0.8.1 installer's two Start Menu entries (#23). Registration + first publish DONE 2026-07-12 (`quantized-lab` 0.8.1 live) | MAIN gate (was ORIGIN_GAP #41) |
| **Corpus publish licensing sign-off** — `../test-data` repo is `git init`-ed; publish gated on the licensing pass + 6 flagged public files | MAIN gate (was ORIGIN_GAP #45) |
| **Defaults-audit eyeball** — rule on the taste calls in `plans/design/DEFAULTS_AUDIT.md` (aps preset height vs. log-decade label thinning; data-aware legend placement) | MAIN gate (was GAP_TIER3 #2) |
| **Origin corpus screenshot review** — the #55 review dashboard exposes 62 paired Origin↔Quantized screenshots (Moke 8, PNR 50, RockingCurve 4); review state is 0/353 until the owner exports gallery marks. The campaign (#56) closes only on this visual sign-off; new mismatches get booked in the decode plan | ORIGIN_FILE_DECODE #55/#56 gate |
| **Pop-out books/plots into windows** — PLAN WITH OWNER FIRST (gesture, "pop out a BOOK" semantics, bulk "window everything" command) | MAIN gate (was MULTI_PLOT #19) |
| **Worksheet view-state persistence** — decide once, with usage evidence, whether sort/widths/selection persist per-dataset in `.dwk` (default: no) | MAIN gate (was WORKSHEET #14) |
| **Dependabot alert #1 — `glib` unsoundness (medium), BLOCKED UPSTREAM, owner call** | security |
| **Apache-2.0 copyright holder line** for LICENSE/NOTICE | PORT_PLAN #1 |
| **Code-signing cert + auto-update E2E** (two consecutive signed releases to verify the updater) | MAIN gate (was PORT #47/#49 residue) |
| **GOTO owner gates** — 3-D (Q4), signal-processing non-goal (Q8), switch-trigger project pick + start timing (Q9; protocol in the plan's Context). ~~Q6 worksheet reshape~~ and ~~Q7 date-time axes~~ were DECIDED YES and SHIPPED 2026-07-19 (Codex PRs #67/#68) — struck here 2026-07-24 | GOTO_PLAN Owner gates |
| **Shared AnalysisSelection contract timing** — when to generalize the #4 `lib/fitweights` seed into the full cross-workflow selection contract | GUI_INTERACTION gate |
| ~~**Undo scopes** (#1)~~ **RESOLVED 2026-07-19** — one flat current-session EDIT history (data + visual/layout + organization) with a SEPARATE Back/Forward view history for zoom/pan/autoscale; neither persists across restart. Owner-approved during the Codex-stack review; #1 shipped behind it | GUI_INTERACTION #1 gate |
| ~~**Baseline: frontend channel-bind vs. backend corrections-DAG** (#5)~~ **RESOLVED 2026-07-19** — the established DAG stays authoritative for its default time/value-0 channel; an arbitrary plotted X/Y baseline subtracts into a DERIVED dataset carrying explicit channel provenance, so the raw source and unrelated channels are never silently rewritten | GUI_INTERACTION #5 gate |
| ~~**Plot Objects tree scope** (#2)~~ **MOOT 2026-07-24** — the large bet was taken and delivered (PR #66) as a bounded Inspector extension, not a full Object Manager; every #2 sub-item is struck. The gate was simply never closed behind the shipped work | GUI_INTERACTION #2 gate |

### Dependency security (swept 2026-07-24 — 13 of 14 alerts CLOSED)

`c63f7af` applied all ten open Dependabot PRs in one commit. They fell into
three mutually-conflicting groups (`uv.lock` ×3, frontend lock ×3, workflows
×4), so merging them serially would have meant nine rebase waits for no
added safety.

- **pillow 12.2.0 → 12.3.0 closed 13 alerts** (10 high, 3 medium): heap
  out-of-bounds writes in `ImageCmsTransform.apply()`, `Image.paste`/`crop`,
  `ImageFilter.RankFilter` and the mmap path, plus several
  decompression-bomb-check bypasses (`GdImageFile`, `BdfFontFile`,
  `FontFile.compile`, `PcfFontFile`) and an EPS infinite loop. Pillow is NOT
  a declared dependency — it arrives transitively via `matplotlib`, which
  `routes/export` renders user-supplied data through, so the exposure is
  real. This is also why the whole class was missing from this file: the
  repo enforces a dependency *policy* (Apache-2.0, no GPL) but has no
  standing check on transitive *vulnerability* surface. Re-sweep with
  `gh api repos/:owner/:repo/dependabot/alerts` periodically.
- **setuptools 82.0.1 → 83.0.0** closed the fourteenth (MANIFEST.in
  exclusion bypass via Unicode NFC/NFD collision on macOS).
- `npm audit` separately flagged a high-severity unbounded-expansion DoS in
  `brace-expansion`; fixed in the same pass. Frontend is at 0
  vulnerabilities.
- CI action versions had drifted to an inconsistent v4/v6/v7 mix across the
  five workflows; now uniform (checkout v7, setup-node v7, upload-artifact
  v7, download-artifact v8).
- **TypeScript 5.9.3 → 7.0.2** (`f398ac9`) was held back since 2026-07-13 as
  the one major bump deserving a deliberate call, because `npm run build` is
  `tsc -b && vite build` — TypeScript IS this repo's type-check gate. Adopted
  only after a forced full `tsc -b --force` came back clean, the emitted
  bundle hashes proved byte-identical, and a PLANTED type error confirmed the
  gate still fails (zero errors from a major bump is also what a silently
  disabled checker looks like).

### Dependabot alert #1 (investigated 2026-07-19 — no action available)

`glib` 0.18.5, `RUSTSEC` unsoundness in the `Iterator`/`DoubleEndedIterator`
impls for `glib::VariantStrIter`. Medium, runtime scope, `src-tauri/Cargo.lock`.

- **Not fixable here.** Patched upstream in glib 0.20.0, but the chain is
  `glib 0.18.5 <- gtk 0.18.2 <- tauri 2.11.5`. Tauri 2.11.5 IS the current
  latest and our `Cargo.toml` already floats on `tauri = "2"`, so we are on
  the newest release; Tauri v2's GTK stack has not moved to the glib 0.20
  ecosystem. `cargo update -p glib` locks 0 packages — 0.18.5 is already the
  latest COMPATIBLE version. Forcing it would mean patching Tauri.
- **Linux-only, but genuinely shipped.** gtk/webkit2gtk are Tauri's Linux
  backend and are not compiled on Windows/macOS — however `release.yml` does
  build a `.deb`, so the artifact exists. Exposure is not zero.
- **Not reachable from our code.** Quantized never calls `glib` directly, let
  alone `VariantStrIter`; it sits deep inside GTK bindings driven by Tauri.
  It is a soundness hole, not a directly exploitable RCE.
- **Owner decision:** dismiss the alert as "no fix available" (keeps the
  security tab honest) vs. leave it open pending a Tauri GTK bump. Deliberately
  NOT dismissed autonomously — that is a visible security-posture change on a
  public repo. Re-check whenever Tauri v2 bumps its GTK stack.

## Blocked on external samples / specs

| Item | Unblocks when | Plan |
|------|---------------|------|
| `importOxford` (Oxford Instruments MagLab) — no published spec, not attempted | a real example file arrives | PORT_PLAN #15 / PORT_CHECKLIST W1 |
| Rigaku `.raw` 2-D RSM — reverse-engineered header has no ω field | a multi-range Rigaku RSM sample arrives | PORT_PLAN #10 / PORT_CHECKLIST W1 |
| Consolidated-CSV polarized-asymmetry path (shared-Q interp + ++/−− spin asymmetry) | files with ++/−− polarization metadata | PORT_PLAN #12 / PORT_CHECKLIST W1 |
| Origin graphic objects / rich annotations (#53) | controlled specimens plus Origin COM/LabTalk and rendered-output oracles establish each object record, with negative controls and a plausible corpus distribution | ORIGIN_FILE_DECODE #53 (subsumes #47) |
| Native >2-Y-axes rendering (#54's last open sub-item; moved here 2026-07-24 now that the page/layer MODEL is complete) | a corpus figure with a proven ≥3-coincident-axis composition exists AND the decoder can attribute a third axis — today `figure_text._TITLE_OBJECT_BUCKETS` buckets only YL/YR titles. Until then the ≥3 case fails closed with provenance + a toast (the Graph25 discipline: don't build unproven mechanisms) | ORIGIN_FILE_DECODE #54 |

## Deliberate deferrals (decision gates — revisit on demand, don't schedule)

- **Interactive WebGL 3-D** (MAIN deferral; gate UNIFIED with GOTO Q4) — revisit when users ask to rotate views the static 3-D export can't satisfy.
- **`.opju` writer** (MAIN deferral = ORIGIN_FILE_DECODE #27) — revisit only if a real Origin build refuses `.opj`.
- **`quantized-plugin-template` starter repo** (MAIN deferral, was ORIGIN_GAP #8) — a separate repo, out of scope for this codebase.
- **Plugin pipeline-step route + frontend palette wiring** (MAIN deferral, was GAP_ECOSYSTEM #2) — v1 registers steps server-side only.
- **Database connectors** (MAIN deferral, was ORIGIN_GAP #47) — paste/append shipped; connectors on user pull.
- **Worksheet designation editing** (MAIN deferral, was WORKSHEET D2) — read-only in v1, deferred unless requested.
- **Stat-stage residuals** (archived GAP_PLOTTYPES, accepted): horizontal bar orientation; in-canvas legend for the bar view; `payloadToTSV` exports ordinal positions, not category labels; `statRender.ts` (539) / `useStatStage.ts` (416) split candidates (non-`.tsx`, no guard fails).
- **PORT_CHECKLIST tails** (all noted inline there): crystal cache (stateful), crystal bond angles (needs CIF coords), BG-region 2-D y-box, per-dataset view-config promotion (x-key/styles/limits), reflectivity density↔SLD toggle, user-defined plot templates. (The reductions-frontend tail was refiled as actionable MAIN #11 by the 2026-07-11 audit.)
- **CI golden-test host** — de facto resolved as committed frozen values (option a); formalize or drop the open question (PORT_PLAN "still to decide").

## Plans dashboard

The plan TREE (per the global plan-consolidation rule): `MAIN_PLAN.md` is
the root; every active plan below is its declared sub-plan.

| Plan | Status | Open items |
|------|--------|-----------|
| `plans/MAIN_PLAN.md` | Active (ROOT) | **#30 fit-recipe residual** (folded up 2026-07-25 from the deleted Sol audits), plus owner gates + deferrals. #29 bundle code-splitting SHIPPED 2026-07-25; MAIN #9–#28 ALL shipped 2026-07-11/12 |
| `plans/PORT_PLAN.md` (+ `PORT_CHECKLIST.md` appendix) | Active | #10+#15 (blocked), #12 (partial), #47/#49 (owner cert), #50 (continuous) |
| `plans/GOTO_PLAN.md` | Active | ALL numbered items #1–#11 SHIPPED (2026-07-11); Tier 3 pending gates **Q4/Q8/Q9 only** — Q6 (worksheet reshape) and Q7 (date-time axes) were DECIDED YES and shipped 2026-07-19 |
| `plans/GUI_INTERACTION_PLAN.md` | Active | **Tier 1 #1, #2, #5 ALL SHIPPED 2026-07-19** (Codex PRs #65/#66 + the two gate resolutions); **#17 CLOSED** (its last three items — split buttons, cross-menu ownership move, first-run hints — are struck); the ONLY open box in the whole plan is #16's `.opju` migration edges (owner-dependent). Remaining gates: the AnalysisSelection contract timing. Historical: #8, #11, #12 CLOSED and #15 fully covered except the #1-gated folder-undo journey, ALL 2026-07-18 (#8: palette bridge + mini-toolbar + worksheet/window/annotation retrofits; #11: stat-mark faceting end-to-end; #12: PlotSpec v2 canonical spec (display/axes/decor blocks) across Stage/Graph Builder/Figure Builder/export — all 5 slices + parts A (y2Fmt)/B (grouped-series export)/C (decor: annotations/shapes/legend) shipped same day, `page` block deferred to ORIGIN_FILE_DECODE #54; #15: channel-drag + annotation/shape + window-arrange journeys, e2e 33/33 across the zoom matrix); #4 SHIPPED 2026-07-12, #6 SHIPPED 2026-07-16, #3+#7+#9+#10+#13+#14 SHIPPED 2026-07-17 (#10 docking deferred, #13 undo sub-item deferred to the #1 gate), #8 core SHIPPED 2026-07-17 (registry + keyboard-complete menu + resting cue + confirm; residual = Command Palette/Plot Objects tree/mini-toolbar reuse + remaining menu retrofits), #11 core SHIPPED 2026-07-17 (residual = stat-mark faceting; arbitrary multi-panel ordering belongs to #54), #15 core harness + 7 journeys SHIPPED 2026-07-17 and export round-trip SHIPPED 2026-07-18 (residual = folder undo, channel→axis drag, annotation/shape edit, window arrange); 4 owner gates (undo scopes, baseline framing, tree scope, selection contract) |
| `plans/ORIGIN_FILE_DECODE_PLAN.md` | Active | Plot Fidelity campaign: #48–#52 complete; #54 page-setup control + spatial-export residual + overlap/inset layout slice ALL SHIPPED 2026-07-17 (Codex PR #55); visual-import campaign #58–#63 ALL SHIPPED 2026-07-18 (Codex stack #56–#61 `854271c`: spatial legends, region bands, imported-view + spatial-page export parity, saved-preview window, presentation templates); **#54's generalized page/layer MODEL is COMPLETE — pass B shipped `50b4c9c` 2026-07-24**, joining A + C; open = #53 graphic objects (evidence-gated; subsumes #47) and #54's specimen-gated >2-Y-axes rendering (now in the blocked table); #55 tooling is complete and #55/#56 close on owner screenshot review. #27 deferred; #42 reopens only on new corpus evidence |
| `plans/archive/` | Complete | 12 plans incl. the 2026-07-10 fold-ups (MULTI_PLOT, WORKSHEET, PROJECT_ORGANIZATION, GAP_TIER3, GAP_ECOSYSTEM, ORIGIN_GAP) |
