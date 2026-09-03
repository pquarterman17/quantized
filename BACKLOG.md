# BACKLOG — quantized

The aggregated open-items dashboard, **derived from the plans in
`plans/`** (per the plan-hygiene rules: the code/git history is truth
#1, each plan's `## Completed` section is truth #2, this file is the
derived view — when they disagree, fix the plan first, then this file,
in the same commit). Every edit here must have a matching plan edit.

**Last reconciled:** 2026-09-03 (pass-history split, no plan-content
reconciliation). The reconciliation-pass narrative (pass 1 through the
twenty-fourth pass, 2026-08-28) has moved to
`plans/archive/BACKLOG_HISTORY.md` — append-only, moved verbatim; future
passes append there, not here. Current state carried forward from the old
header: **`v0.24.0` is the current stable release** (resolved 2026-09-01 per
`RC_RELEASE_NOTES_DRAFT.md`, superseding the `v0.23.x`/rc2 candidate state
the prior header tracked); Dependabot alert #24 (extract-zip) is open,
upstream-blocked; alert #1 (glib) is dismissed as tolerable risk
(re-evaluated 2026-09-02, decision unchanged).

Shipped so far this session on branch `claude/repo-evaluation-l7y7k9` (not
yet on `main`; `git log --oneline origin/main..HEAD`, newest first):

- `d7b7bb3` ci: parallel backend tests (pytest-xdist), dependency caching, trimmed redundant job
- `7923a7b` feat(api): OpenAPI-generated frontend types with drift detection
- `33c5af3` refactor(routes): route every 422 calc adapter through the shared CALC_ERRORS
- `851d664` fix(io): share delimited helpers across parsers; apply the D5 nan-row fix to SIMS
- this docs-only pass: the `BACKLOG.md`/`BACKLOG_HISTORY.md` split above,
  and one new row below for the dead `errlog.ts` → `/api/debug/report` call.

---

## Actionable dev work (no blockers, no owner gate)

The table below is the immediate cross-plan queue. Detailed goals,
dependencies, acceptance criteria, and model routing for the new campaign live
in `PRIMARY_SOFTWARE_AUDIT_PLAN.md`.

The prior implementation campaign is complete. New work is organized by the
readiness plan and begins with evidence instead of another speculative feature
stack.

Historical: the 2026-07-24 reconciliation left this table empty. The 2026-07-25 plan-tree
consolidation first refilled it from the deleted Sol audit docs; the later
ChatGPT-Sol implementation audit then added eight current-code gaps that could
still make the owner switch back to Origin.

| Item | Plan / item |
|------|-------------|
| **Map ROI: one owner design call** (owner-reported 2026-08-12; every other part of that report — the drag, Delete, ✕, `x`/`y` labels and toolbar icons — is FIXED, see GUI_INTERACTION Completed). A near-miss on a resize handle (>7 px) does not fail to resize: it starts a NEW box at the click point, destroying the old one, and `mapRoi` is deliberately out of undo so it is unrecoverable. The real question is whether ONE gesture should keep both drawing and editing duty, with two sub-questions worth settling alongside it: should the box survive its tool being disarmed, and should `mapRoi` join the undo snapshot after all | GUI_INTERACTION (2026-08-12) |
| Figure-authoring campaign, residue — F2.1–F2.5 all COMPLETE except **F2.3i facet editing**, still BLOCKED (needs a multi-panel Publication Preview contract) and two owner-gated legacy-convergence decisions (see Owner actions); F4.1–F4.3 COMPLETE; **F4.4 is `[~]`** — live grouping/faceting parity and its export path both shipped (2026-08-23/24, PRs #222/#226/#227/#232/#234), leaving SPATIAL/BREAK composition rebuild as the one genuinely open item; A1–A10 acceptance journeys are the exit gate, all owner-run, none checked | FIGURE_AUTHORING F2.3i, F4.4, A1–A10 |
| **Silent-state-corruption task #10** — the Corrections card is mounted for a derived worksheet with no `derivedFrom` gate (`Inspector.tsx`), so Apply/Reset there bypasses `recomputeDerivedSheet` and feeds the source-cache `raw` into `corrections.ts`; store-side refusal (class) + Inspector gate (instance), red-first. Surfaced by #259's `Dataset.raw` audit; pre-existing | SILENT_STATE_CORRUPTION #10 |
| **Dead frontend call: `errlog.ts` → `/api/debug/report`** — `downloadBugReport()` fetches a backend route that does not exist (no matching FastAPI route anywhere in `routes/`; already flagged as a known dead call in `frontend/src/lib/api/endpoints.test.ts`'s literal-path ALLOWLIST). The 404 leaves `r.ok` false, the branch no-ops, and every bug report a user generates silently omits its server half. Ported verbatim from fermiviewer, whose backend HAS the matching route. Decide: add the route (mirroring fermiviewer) or delete the fetch + its allowlist entry (repo evaluation 2026-09-03) | MAIN (unbooked) |

The plan's other two Gate A items, **P0.1** (run a real switch-trigger project)
and **P0.2** (review the Origin visual corpus), are NOT dev work — they are
owner actions, and both already existed as owner-gate rows before this plan was
written. They are annotated on those rows under Owner actions below rather than
duplicated here; P0.1 is GOTO gate Q9 and P0.2 is the ORIGIN #55/#56 screenshot
review.

After Gate A, the current dependency-ordered implementation candidates are
**unfinished engineering campaigns, not owner actions**. Gate A controls
their order and exact scope; it does not make them complete:

| Item | Plan / item |
|------|-------------|
| Native packaged-desktop file/project bridge and real paths | PRIMARY SOFTWARE P1.1 |
| Named project identity, atomic save/recovery, bounded autosave, and scalable workspace | PRIMARY SOFTWARE P1.2 |
| First-class categorical/text/metadata channels | PRIMARY SOFTWARE P1.4 |
| Import Wizard multi-row metadata and complete error-role mapping | PRIMARY SOFTWARE P1.6 |
| Live Stage parity for Graph Builder grouping/faceting | PRIMARY SOFTWARE P1.5 |
| Full semantic plot-recipe templates with technique scope and opt-in application | PRIMARY SOFTWARE P1.3 |
| Portable projects and safe source relinking | PRIMARY SOFTWARE P1.7 |
| Continue contextual help after the first five Inspector `?` links, using real-use friction to select workshops and context actions | PRIMARY SOFTWARE P3.1 |

The table above is the first dependency chain, not the whole unfinished
engineering inventory. P2.1-P2.8 contain technique-workbench implementation,
P3.2-P3.7 contain usability/accessibility/recovery/export engineering, and
P4.1-P4.2 contain decomposition and regression-matrix engineering. Their
open boxes remain open. They are intentionally scheduled after evidence and
higher-impact gates; they are neither implemented nor automatically owner-gated.

Carried over from the prior campaign, one item is a judgment call its plan
explicitly parked for the owner rather than a task (the `clearShapes`
confirm call that stood beside it was DECIDED and SHIPPED 2026-08-13, see
the twenty-third pass above):

| Item | Plan / item |
|------|-------------|
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

### Frontend hardening rounds (standing — re-sweep as feature waves land)

**First round (2026-08-14).** Four parallel finders (state/gesture,
persistence round-trips, mechanical scan, live-GUI adversarial) over the 66
files shipped since v0.20.0. Eight real bugs found, ALL FIXED same session
(9 fixes counting the orchestrator's extension of the focus-guard class to
the x-axis-breaks rows): (1) library-target Publication Preview Apply could
silently clobber an unsaved live Stage edit — found independently by
code-trace AND live repro; the session UI's `targetBlocked` check was also
coincidentally short-circuiting for library sessions, so both layers now
guard (`store/liveWindowDocument.ts` extracted to break the import cycle).
(2) `.dwk` duplicate-document-id repair dropped `publication` on reopen.
(3) `openFigureDocInWindow` silently dropped a FigureDoc's error-bar
bindings; `figureDocPlotCompatibility`'s loss inventory was blind to the
field (now applied, with coupled regression tests). (4) Decor-card ✕ removal
let a follow-up Delete fall through to DATASET removal (focus fell to body)
— fixed as a class via `lib/focusGuard.ts` across 10 surfaces; container
focus alone measured insufficient, the preventDefault absorber is the
load-bearing half. (5) Inspector decor-card numeric fields corrupted
negative typing ("-5" became 15) — `BufferedNumberField` primitive extracted
from PropertyNumberField, adopted in RegionShades/Shapes cards.
(6) Library saved-figure rows clipped ALL action buttons at the default
210 px panel width (the new ⎙ was unreachable). (7) duplicate error-binding
Add is now a no-op (React key collision). (8) window-target preview session
showed a blank name for a never-renamed window. Negative evidence recorded:
PlotView↔sanitize is compile-time complete; promotion decomposition has no
double-apply; export field semantics match the Stage (incl. shade alpha);
zero console errors across the whole adversarial run; JSON.parse/floating-
promise/cleanup classes all clean. Follow-ups booked, NOT fixed:
`ErrorRolesCard`'s remove control is a `<span role="button">`, not
keyboard-reachable (a11y gap, pre-existing); `SavedFiguresSection`'s delete
button still ~31 px past the panel edge at the 160 px MINIMUM width
(pre-existing "Editable" label-width constraint; fine at default);
F2.1e's detached-session fallback branch in `fileCommands.ts` may be dead
code (`focusWindow` invariant seems to make it unreachable — verify before
deleting, it is a deliberate fallback).

### Backend hardening rounds (standing — re-sweep as routes land)

**Third round (2026-08-12, `872a26f`).** Audited ~29 route/calc modules added
or substantially changed since the second round (RSM, outliers/varcomp,
dataset/upload caches, database/sqlite, multivar/statplot exports,
crystallography/electrical/xray, plot, parsers + the new SPC old-format
decoder, stats/design, fitting, diffusion, substrates, thin film, books,
import templates, reference, corrections, peaks, page/figure exports).
One confirmed live 500, fixed at the calc chokepoint: a unit expression that
decomposes to a literal zero scale (e.g. converting to `"0"` or `"m/0"`)
raised an uncaught ZeroDivisionError via both `/api/reference/convert` and
`/api/calc/call` — `calc/unit_convert.py`'s underflow guard generalized to
reject any zero-scale token, regression test in
`tests/test_calc_degenerate_inputs.py`. Everything else clean. Gate: 3943
passed / ruff / mypy green.

**Second round (2026-07-19, `4d61e56`).** A sweep of the "route catches a
narrow exception tuple, callee raises something else" class first named on
2026-07-05. Three live HTTP 500s on plausible user input, all confirmed
against the real app before fixing and all now 422: `DataStruct.from_dict`'s
TypeError on a non-numeric `dataset` (the class-wide one — ~17 handlers
across 7 route modules, fixed in the ONE shared constructor),
`semiconductor.fermi_level`'s ZeroDivisionError from an underflowed `ni`, and
`fitting.curve_fit`'s ZeroDivisionError on empty arrays. Backend 3000 + ruff
+ mypy green. The class recurs as new routes land — re-sweep periodically.

## Owner actions & owner-gated decisions

| Item | Plan / item |
|------|-------------|
| **R2: packaged-app + owner acceptance, against the now-stable `v0.23.0`/`v0.23.1`** — install Windows/macOS, run import→browse→Quick Plot/Quick Figure→edit→annotate→Office copy/paste→save/reopen→recovery; exercise real native dialogs; verify installer/Start-menu/Dock/taskbar icons; run the 60–90 min real-data session with Origin/JMP closed; judge Origin comparison images for visual fidelity. Promotion already happened 2026-08-28 ahead of this checklist (see `POST_SPRINT_INDEPENDENT_REVIEW.md`'s dated Stable-promotion-gate note) — this is retroactive/ongoing acceptance evidence, not a blocker to something already shipped. `RELEASE_BLOCKERS.md`'s "OWNER-ONLY VERIFICATION OUTSTANDING" list is the detailed inventory | `POST_SPRINT_INDEPENDENT_REVIEW` R2 / Stable-promotion gate |
| **Library/workbook L0.44 revisit** — after real cross-workbook use, confirm that folder-level placement of multi-workbook figures/analyses stays understandable (provisionally confirmed 2026-08-13; the interview's ONLY remaining owner item — everything else through L0.57 confirmed, spot-verified in the Claude session 2026-08-14) | LIBRARY_WORKBOOK_UX L0.44 |
| **In-app scripting console** — decide DSL-over-`executeSteps` (a REPL over the macro recorder's typed `{kind, params}` objects, no string ever evaluated as code, needs no new backend surface) vs. a real out-of-process Python kernel (genuinely arbitrary code, but heavier: process lifecycle, stdout/stderr streaming, kernel death/restart, packaging) before building either. `quantized.client` (slice 1, shipped 2026-08-05) is what either option would end up driving | MAIN gate (was MAIN #39 owner gate) |
| **First dated timed-workflow runs** — follow `docs/timed_workflow_baselines.md` (8 journey checklists, results template at the bottom); the gesture/confusion/discoverability fields need the owner's hands. Fixtures + protocol SHIPPED 2026-07-26 | PRIMARY SOFTWARE P0.3 residue |
| **Gate J: JMP usage census + JMP switch trial** — list the JMP platforms actually opened in the last ~6 months (ranks JMP Tier 2, decides census-gated clustering/SPC/MSA/DOE), then run one real JMP-shaped deliverable under the P0.1 protocol with JMP closed. Can share a session with P0.1/Q9 | JMP_GAP Gate J |
| **Real-GPU F1 interaction acceptance** — the automated headless run is 112 ms p95, 12 ms over target under software rendering; close only after a visible hardware-accelerated run on the owner workstation confirms or refutes it | PRIMARY SOFTWARE P0.4 acceptance |
| **PyPI fresh-machine acceptance run** — on a machine without dev tools: `pipx install quantized-lab` → import a CSV within 2 min; also verify the v0.8.1 installer's two Start Menu entries (#23). Registration + first publish DONE 2026-07-12 (`quantized-lab` 0.8.1 live) | MAIN gate (was ORIGIN_GAP #41) |
| **Corpus publish licensing sign-off** — `../test-data` repo is `git init`-ed; publish gated on the licensing pass + 6 flagged public files | MAIN gate (was ORIGIN_GAP #45) |
| **Defaults-audit eyeball** — rule on the taste calls in `plans/design/DEFAULTS_AUDIT.md` (aps preset height vs. log-decade label thinning; data-aware legend placement) | MAIN gate (was GAP_TIER3 #2) |
| **Legacy figures: auto-migrate on open, or explicit promotion forever?** — today saved legacy Publication Figures convert to editable copies ONLY via the explicit "Editable" button (deliberate, documented in three places: never rewritten on load, source never mutated). Auto-migrating would let the whole "Publication figures" Library section retire (and answer whether its thin ◉/◇ visual distinction needs fixing) but rewrites user data on open and breaks `.dwk` round-trip with older builds | FIGURE_AUTHORING convergence D-1/D-5 (2026-08-12) |
| **Do #15 user graph templates survive legacy-mode retirement?** — `useGraphTemplates` is structurally legacy-only (writes through legacy setters; UI is `!canonical`-gated), and Origin `.otp/.otpu` template imports write into the same `qz.graphTemplates` localStorage store, so this is not a one-user feature. Its own doc defers the canonical equivalent to F4's semantic recipes. Retiring legacy mode (F2.1g) kills it unless re-hosted — decide re-host vs. accept-loss vs. block F2.1g on F4 | FIGURE_AUTHORING convergence D-3 (2026-08-12) |
| **Delete legacy figure mode, or keep it as a read-only archive renderer?** — routing old saved figures through the canonical builder mostly ADDS fidelity (view decor, error bars, hidden/order), but "the figure I saved last year renders differently now" is a legitimate objection for a publication tool. A read-only "renders exactly as saved" mode with all AUTHORING canonical is a coherent third option nothing currently names | FIGURE_AUTHORING convergence D-4 (2026-08-12) |
| **Origin corpus screenshot review** — the #55 review dashboard exposes 62 paired Origin↔Quantized screenshots (Moke 8, PNR 50, RockingCurve 4); review state is 0/353 until the owner exports gallery marks. The campaign (#56) closes only on this visual sign-off; new mismatches get booked in the decode plan | ORIGIN_FILE_DECODE #55/#56 gate = PRIMARY SOFTWARE **P0.2** |
| **Pop-out books/plots into windows** — PLAN WITH OWNER FIRST (gesture, "pop out a BOOK" semantics, bulk "window everything" command) | MAIN gate (was MULTI_PLOT #19) |
| **Worksheet view-state persistence** — decide once, with usage evidence, whether sort/widths/selection persist per-dataset in `.dwk` (default: no) | MAIN gate (was WORKSHEET #14) |
| **Code-signing cert + auto-update E2E** (two consecutive signed releases to verify the updater) | MAIN gate (was PORT #47/#49 residue) |
| **Node version-manager standardization** — Volta (fermiviewer) vs `.nvmrc` (quantized); fix the machine-level cause first (fnm precedes `~/.volta/bin` in PATH, so neither pin takes effect). Comfort, not correctness — CI is already authoritative via `node-version-file` | MAIN gate (was ROBUSTNESS #8, folded 2026-08-01) |
| **GOTO owner gates** — 3-D (Q4), signal-processing non-goal (Q8), switch-trigger project pick + start timing (Q9; protocol in the plan's Context — Q9 is the same task as PRIMARY SOFTWARE **P0.1**, whose friction log gates that plan's Gate A). ~~Q6 worksheet reshape~~ and ~~Q7 date-time axes~~ were DECIDED YES and SHIPPED 2026-07-19 (Codex PRs #67/#68) — struck here 2026-07-24 | GOTO_PLAN Owner gates |
| **Shared AnalysisSelection contract timing** — when to generalize the #4 `lib/fitweights` seed into the full cross-workflow selection contract | GUI_INTERACTION gate |
| ~~**Undo scopes** (#1)~~ **RESOLVED 2026-07-19** — one flat current-session EDIT history (data + visual/layout + organization) with a SEPARATE Back/Forward view history for zoom/pan/autoscale; neither persists across restart. Owner-approved during the Codex-stack review; #1 shipped behind it | GUI_INTERACTION #1 gate |
| ~~**Baseline: frontend channel-bind vs. backend corrections-DAG** (#5)~~ **RESOLVED 2026-07-19** — the established DAG stays authoritative for its default time/value-0 channel; an arbitrary plotted X/Y baseline subtracts into a DERIVED dataset carrying explicit channel provenance, so the raw source and unrelated channels are never silently rewritten | GUI_INTERACTION #5 gate |
| ~~**Plot Objects tree scope** (#2)~~ **MOOT 2026-07-24** — the large bet was taken and delivered (PR #66) as a bounded Inspector extension, not a full Object Manager; every #2 sub-item is struck. The gate was simply never closed behind the shipped work | GUI_INTERACTION #2 gate |

### Dependency security — alert #24 OPEN, upstream-blocked (booked 2026-08-13)

**extract-zip <= 2.0.1, high, unvalidated symlink path traversal** (Dependabot
alert #24, created 2026-08-12). Chain: `puppeteer-core@23.11.1 →
@puppeteer/browsers@2.6.1 → extract-zip@2.0.1` in
`tools/visual/package-lock.json` — the dev-only screenshot harness, never
shipped. Triage 2026-08-13:

- **No patched version exists** — 2.0.1 IS the latest release, so no bump can
  close it; the alert is upstream-blocked, not negligence.
- **Reachability is low**: extract-zip only unpacks Chrome-for-Testing
  archives fetched from Google's CDN, not attacker-controlled zips.
- **Owner decision 2026-08-13: leave OPEN, do not dismiss.** Re-check on
  every reconcile pass: (a) a patched extract-zip ships (then the ordinary
  lockfile bump auto-resolves the alert), or (b) puppeteer replaces the dep.
  The structural fix — migrating `tools/visual` from puppeteer-core to the
  Playwright already used for e2e — was presented and not chosen; it remains
  the fallback if the upstream stall drags on.

### Dependency security (swept 2026-08-06 — 6 alerts closed)

`fd7c5d0` applied all 5 open Dependabot PR groups as ONE commit (same
mutually-conflicting-lockfile rationale as the 2026-07-24 sweep below):

- **aiohttp 3.14.1 → 3.14.3 closed 3 alerts** (1 high: OOB heap read in the
  C response parser; 2 moderate: WS request smuggling + unnegotiated
  compressed frames). Transitive RUNTIME dep via `bumps` (DREAM fit engine,
  reached through `routes/jobs_api`).
- **ip-address 10.2.0 → 10.4.0 closed 3 alerts** (1 high SSRF-class octal
  decode + 2 moderate misclassifications) in `tools/visual` — dev-only
  screenshot harness, low reachability, fix was free within semver range.
- Routine riders: fastapi 0.141.1 + ruff 0.16.1, frontend npm dev-tooling
  minors (vite 8.2.0, playwright 1.62.1, types), `codeql-action` pinned
  v4.37.4 at both call sites. TypeScript untouched at ~6.0.3 (deliberate).
- Full dual gate green: pytest 3745 passed / **3822 collected** (no
  shrinkage), ruff/mypy clean, frontend 5,639 tests + build, tools/visual
  audit now 0.
- **Left for owner:** `brace-expansion` shows as an npm-audit high
  (eslint→minimatch, frontend devDependency only) but has NO Dependabot
  alert and no PR — out of the sweep's scope, not yet fixed.

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

### Dependabot alert #1 (dismissed 2026-07-25 as tolerable risk; REOPENED by GitHub by 2026-08-29 — re-dismiss, decision unchanged)

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
- **Owner decision:** the 2026-07-19 session deliberately did NOT dismiss
  autonomously (a visible security-posture change on a public repo) and parked
  it as an owner call. **Resolved 2026-07-25**: the owner delegated the
  standing-issues decisions ("you just figure this out"), and an independent
  re-investigation reproduced the identical chain and reachability analysis —
  dismissed as `tolerable_risk` with a dated rationale on the alert naming
  the re-eval condition (Tauri adopting the gtk-rs 0.20 line; the alert then
  auto-resolves via the ordinary lockfile bump).
- **Reopened without a lockfile change — re-evaluated 2026-09-02.** GitHub's
  push notice listed only alert #24 as open on 2026-08-16 and "1 moderate"
  at alert #1 on 2026-08-29; `src-tauri/Cargo.lock` had no glib/gtk change in
  between (only `quantized-shell` version bumps), so the reopen came from
  GitHub's side, not from a dependency change. Re-measured 2026-09-02:
  `cargo update -p glib|gtk|tauri --dry-run` each lock 0 packages; tauri
  2.11.5 (2026-07-01) is still the newest release and its `dev` branch still
  pins `gtk = 0.18`; the weekly OSV sweep (run #10, on `75f887b`) reports
  nothing beyond the registered ignores. Chain, reachability and shipping
  surface are unchanged, so the decision is unchanged: re-dismiss as
  `tolerable_risk` with the same dated rationale (an owner click in the
  Security tab — the agent session has no Dependabot-alerts API path). The
  re-eval trigger stays: Tauri adopting the gtk-rs 0.20 line.

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
- **Golden parity: `sector_profile` vs MATLAB `extract2DArcIntegral.m`** (MAIN deferral, was RSM_CUTS_PLAN #11, folded up 2026-08-10 when the plan archived) — SKIPPED by owner decision, not a task; revisit only if a sector discrepancy ever surfaces.

## Plans dashboard

The plan TREE (per the global plan-consolidation rule): `MAIN_PLAN.md` is
the root; every active plan below is its declared sub-plan.

| Plan | Status | Open items |
|------|--------|-----------|
| `plans/MAIN_PLAN.md` | Active (ROOT) | MAIN #9–#41 are ALL shipped (#39 = `quantized.client` slice 1, its in-app-console sub-item moved to the owner gates below; #40 = the Origin/Host request guard; **#41 shipped 2026-08-10** `5ad96db` — sector ROI state moved into `store/rois.ts`, struck 2026-08-11 after the parallel-worktree race described in the twenty-second pass above); the Apache-2.0 copyright-holder owner gate was REMOVED 2026-08-10 — resolved since the first commit, never actually open; remaining work is owner gates, evidence-gated deferrals, and the active sub-plans |
| `plans/PORT_PLAN.md` (+ `PORT_CHECKLIST.md` appendix) | Active | #10+#15 (blocked), #12 (partial), #47 (owner cert), #48 (owner acceptance-run residual only — its Trusted Publisher claim was stale, corrected 2026-08-10), #49 (owner, gated on #47), #50 (continuous); **#1/#2/#5 (W0 repo scaffold/enforcement/CI) drift-fixed 2026-08-10** — shipped since 2026-06-21 with sub-boxes checked but never struck; **#54 SPC/JCAMP gaps CLOSED 2026-07-25 same-day booked** |
| `plans/GOTO_PLAN.md` | Active | ALL numbered items #1–#11 SHIPPED (2026-07-11); Tier 3 pending gates **Q4/Q8/Q9 only** — Q6 (worksheet reshape) and Q7 (date-time axes) were DECIDED YES and shipped 2026-07-19. **Considered for fold-up 2026-08-10, rejected**: reads as the standing mission doc for the whole initiative (the switch-trigger acceptance protocol IS the go/no-go test), Tier 3 is deliberately empty pending these very gates, and Q9 is duplicate-tracked as PRIMARY SOFTWARE's own Gate A item — not finished residue |
| `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` | Active | Gate A: owner switch-trigger trial, Origin visual review, timed workflows, and the real-GPU performance check. **P3.4 is fully SHIPPED** — server-side payload decimation 2026-07-31 (147.5→3.49 MB @1M×7) and the zoom-refetch residual 2026-08-01 (`232cf4f`); P2.8's regrid defect-class and both export-dialog defects also landed 2026-07-31. **Sequencing-gated, incomplete engineering:** P1.1-P1.7 native lifecycle/portability/metadata/import/grouping/recipes (P1.3 recipes will key on the technique tag), followed by evidence-ranked P2/P3/P4 work. **Considered for fold-up 2026-08-10, rejected**: 188 open `- [ ]` items across P0–P4 and five acceptance gates (A–E) as of this pass — nowhere near the fold-up threshold |
| `plans/TEST_DETERMINISM_PLAN.md` (+ `weak-waits-inventory.md` appendix) | Active | Created 2026-08-09; **worked-example backstop recalibrated 2026-08-11** (8→90 s — a five-for-five deterministic failure initially mistaken for a load flake; root cause was a mis-calibrated file-selection premise, verified NOT a product regression by timing the calibration commit; lesson recorded in the plan); **campaign essentially complete 2026-08-10** — #1 forced-race test (15/15 deterministic, red-on-revert verified), #2 Python wall-clock budgets (all four sites assert load-invariant properties; budgets never lowered after one corrected round), #3 GridViewport (time budgets dropped, DOM-node-count assertions kept), #4 triage (98-SUSPECT classification proved unreliable — its negative evidence redirected the campaign), and #6 the per-file weak-wait count ratchet in `architecture.test.ts` (33 files / 124 sites pinned) ALL shipped, plus the two 2026-08-09 worked examples. **#7 CLOSED 2026-08-12** — the substance already lived in `docs/testing.md`; what was missing was a contributor-facing home, so `CONTRIBUTING.md` was added (gate commands + flake-fix evidence + the wait-on-state and never-lower-a-budget corollaries) and linked from README. Open: **#5 only, and it is a STANDING RULE, never "done"** (fix weak waits opportunistically when editing an inventoried file; ratchet down in the same commit) |
| `plans/ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md` (+ `POST_SPRINT_INDEPENDENT_REVIEW.md`, `RELEASE_BLOCKERS.md`, `RC_RELEASE_NOTES_DRAFT.md`, `CHATGPT_SOL_TO_CLAUDE_RELEASE_HANDOFF.md`) | Active | RC published and engineering sprint complete (Day 7 all three states tracked separately). R1/R3/R4/R6/R7/R9 fixed + independently reviewed (#207/#208/#210/#211/#212/#213); R5 (Apple-silicon-only) decided; R8 (bundle headroom) closed twice over (C2, then #218). **Stable promotion happened 2026-08-28** (`v0.23.0`/`v0.23.1`) ahead of R2's full owner-acceptance checklist — see the dated note under `POST_SPRINT_INDEPENDENT_REVIEW.md`'s Stable-promotion gate and the Owner actions row below. `RELEASE_BLOCKERS.md`: nothing at BLOCKER, owner-verification list unchanged. Next acceptance candidate: `v0.23.2-rc2` = `1264b2a4` (rc1/`cd68ad16` was published, then superseded by `#260`-`#264`) |
| `plans/SILENT_STATE_CORRUPTION_PLAN.md` | Active | ALL of tasks #1–#9 SHIPPED (`#253`/`#254`/`#255`/`#259`), plus the Completed-table backend D1–D8 rows (`#256`/`#257`). Open: #10 only (Corrections card reachable on a derived worksheet bypasses its pipeline). Standing owner call in Notes: eager-bundle headroom is ~0 after #259 — the `ContextMenu` lazy-split decision is due before the next eager-path change |
| `plans/DIRACULATOR_AUDIT_PLAN.md` (Parent `PORT_PLAN.md` W4 / `PORT_CHECKLIST.md` W4) | Complete | Merged as `#143` (`ebe06c3`, 2026-08-16); MATLAB campaign frozen from `quantized_matlab@aee70d12`. Final follow-ups completed 2026-08-28: exact invocation-time history inputs, Scherrer Card 6 (campaign now 94 cases), and method-level MATLAB parity for `critical_thickness` using the two already-frozen cases. |
| `plans/FIGURE_AUTHORING_WORKFLOW_PLAN.md` | Active | **F0 + F1 COMPLETE** (honest transitions; versioned FigureDocument with lifecycle, reversible conversions, migration). F2 mid-campaign: seven bounded slices shipped 2026-08-02 (canonical Publication Preview session PR #111, F2.1a–d/F2.2a–c/F2.3a/F2.4a/F2.5a); **F2.5 COMPLETE 2026-08-11** (F2.5b routed Stage copy/export through the focused window's canonical document — the last reduced-path caller; grouping/X-breaks/publication overrides no longer silently dropped, grouped+y2 now fails visibly); **F2.4 COMPLETE 2026-08-12** (F2.4e shape drag closed the gesture set — legend, annotation, text, reference line, shape); F2.1–F2.3 stay open for legacy convergence only — the F2.3 panel set is EXHAUSTED 2026-08-12 (F2.3c–h all shipped; F2.3i facet editing is BLOCKED on a multi-panel preview contract; region shades DECIDED editable 2026-08-13 → **F2.3j SHIPPED 2026-08-14**), and **convergence round 1 SHIPPED 2026-08-12** (figdoc page panels through the canonical adapter, the F0.3 promotion compatibility report, and in-place library editing F2.1h/F2.2d); **convergence round 2 SHIPPED 2026-08-12** (F2.1e canonical unfocused-window fallback — Apply now available there; F2.1i promotion override decomposition — the rendered-but-uneditable class closed, seriesStyles left raw with documented evidence); **ALL unblocked convergence work is now done** — what remains of F2.1 is F2.1f/g, both owner-gated (see the D-1/D-3/D-4 rows under Owner actions). **F3 COMPLETE 2026-08-07** (F3.1–F3.6: versioned PageDocument + persistence, missing/frozen panel semantics, Save/Save As/dirty/reopen lifecycle, unified panel editing, complete layout controls, unified export — one `buildSpec` path for preview/file-export/clipboard-copy, a real window-panel fidelity fix (error bars/y2/groups/breaks/overrides now render from the window's own canonical document instead of a reduced ad-hoc spec), and Library "export a saved page without reopening it"); the plan's own F3 exit criterion is coded-and-tested (round-trip test proves save→close→reopen→export byte-identical) but NOT owner-verified in the live app — A6 stays an owner acceptance check, not ticked here. F4 open except F4.2a (plot type + error designations, with the Graph Builder error-bar wells + step/Line+Symbol marks, v0.16.0). A1–A10 acceptance journeys unchecked. Authored by ChatGPT-Sol, not Claude. **Update 2026-08-23/24 (P1.3 recipe waves #203/#204/#209 + F4.4 slices #222/#226/#227/#232/#234): F4.1–F4.3 now COMPLETE** (recipe apply is always explicit opt-in, ambiguous-match preview+confirm, ordinary application never touches an already-customized figure). **F4.4 is `[~]`**: GROUPING was already live; this closed the FACET half the same way (`facetKey` promoted to a bindings-owned `PlotView` field, survives focus switch/`.dwk` reopen/recipe rebuild) and then closed facet EXPORT (small-multiples grid on every export path, not a silently-flattened overlay). The one item F4.4 leaves genuinely open: SPATIAL/BREAK composition rebuild-on-apply, which needs per-panel placement/break-range inputs the recipe-resolve step doesn't produce. |
| `plans/LIBRARY_WORKBOOK_UX_PLAN.md` | Active (**milestone 1 implementing**) | Created 2026-08-12 by ChatGPT-Sol from an owner interview. **Interview COMPLETE through L0.57 (2026-08-14)** — recorded confirmations spot-verified by the owner in the Claude session (L0.2 one-file-one-workbook, L0.45 dependency-safe deletion, L0.54 sidecars, L0.57 three-milestone order all re-confirmed); the plan's technical boundary audit adversarially verified against the code, all claims exact. **Implementation AUTHORIZED**: three milestones as stacked PRs — (1) Library foundation A1–A4/B/C/D/D2/E/E2, (2) Quick Plot F/G/H + transfer I/I2, (3) advanced organization J–N. Routing: Fable orchestrates + designs contracts + adversarially reviews; Sonnet implements; ChatGPT-Sol owns E/G + UX acceptance (B implementation flipped to Claude 2026-08-14). **PR A1 SHIPPED 2026-08-14** (`914042e` — pure `lib/workbooks.ts` model + derivation + repair, 27 tests, one red-proven review fix); **PR A2 SHIPPED 2026-08-14** (`64af36c` — `.dwk` v4, one parse path for all versions, store/history/autosave/merge wiring, pins workspace.ts 633→609 + useApp.ts 2868→2835, 6,515-test gate). **PR A4 SHIPPED 2026-08-14** (`aa789bc` — append/merge workbook transfer, fresh-id policy, root placement); **PR A3 SHIPPED 2026-08-14** (`152c3d8` — import-time workbook creation delegated to `deriveWorkbooks` (consistency by construction), surrogate-folder retirement + legacy conversion, workspace.ts pin 609→592; L0.46 re-booked to PR C where folder selection first exists). **PR A COMPLETE — the whole workbook data layer is in.** **PR B SHIPPED 2026-08-14** (PR #138 merged `8239d21` — ChatGPT-Sol's pure `lib/libraryHierarchy.ts` canonical hierarchy + Fable's adversarial review with two red-proven fixes: byOrder parity for unkeyed items, workbook/artifact section separation; plan decision-history rewrite amended). **Standing debt: two view models coexist until PR C replaces `useLibraryTree` consumption — C's contract must include that replacement.** **PR C at VETTED-PR stage — PR #139 open + re-reviewed, NOT merged** (2026-08-15: tree renderer, useLibraryTree retired, workbook L0.5/L0.6 semantics, first workbook mutations, registry menus, L0.46. ChatGPT-Sol's blocking review posted 5 findings — ALL verified real by Fable: Delete-shortcut misfire, trash dangling workbookId, worksheet-drag folderId divergence, keyboard hijack of nested controls, folder-offer Origin fan-out gap — ALL fixed on the branch `6120240`..`93ec05c` with regression tests, incl. workbook→folder drag as the replacement gesture and store-chokepoint selection exclusivity (L0.25). Gate after fixes: 6,692 tests, lint 0, bundle 7.4 kB under. PR marked ready with a point-by-point reply; awaiting Sol re-review + owner merge decision). Then D–D2, E, E2 (M1). Owner residue: L0.44 revisit (see Owner actions). **Update 2026-08-19/23 (milestone 2, per the plan's own header):** PR C merged; H (Quick Plot templates) shipped and reviewed; **I + I2 SHIPPED** (`6cbfacc` + adversarial review round — cross-instance workbook transfer via clipboard-text copy/paste and a four-state single-writer project lock, filesystem-backed provider deferred as a named follow-up); J and L each landed slice 2 (`9b364583` combine/separate UI, Details-column persistence) on top of their slice-1 landings; M got slice 1 (transactional multi-source Reimport All, **L0.33 merged 2026-08-23 as `#221`**); N stays deferred with evidence (item 14). Owner residue unchanged: L0.44 revisit |
| `plans/JMP_GAP_PLAN.md` | Active | **Every census-independent register item is SHIPPED** — campaign 2026-07-28/29 (J3, J5, J6, J7, J9, J10, J11, J12, J17 + J8 backend) + the 2026-07-31 residual wave (J8 UI, J10 export parity, J3 mosaic/prediction band, J7 curve-fit By, Dixon table verified) + #14 module splits w/ `MODULE_PINS` ratchet (2026-07-29). **Tier-section duplicate copies of J3/J6/J7/J8/J9/J10/J11/J12/J17/#14 removed 2026-08-10** (already recorded in Completed, guard drift). **J2 recode and J4 live group split both SHIPPED 2026-08-18/19** (2026-08-19 header update) — J2's Recode workshop landed with PRIMARY P1.6b in the same slice; J4 was already satisfied by P1.5's 2026-08-18 acceptance criteria, just unflipped until then. Open: J1 string categoricals only, `[~]` partial (rides P1.4 — recode landing on top of it doesn't close J1's own remaining sub-item, user-settable level order); Tier 3 census-gated = J13 clustering, J14 control charts/capability, J15 MSA, J16 DOE. Owner gate: Gate J census + switch trial |
| `plans/GUI_INTERACTION_PLAN.md` | Active | **Tier 1 #1, #2, #5 ALL SHIPPED 2026-07-19** (Codex PRs #65/#66 + the two gate resolutions); **#17 CLOSED** (its last three items — split buttons, cross-menu ownership move, first-run hints — are struck); **#2/#5/#15/#17 struck and moved to Completed 2026-08-10** (guard drift — every sub-box was checked but the tier-section copies were never removed); the ONLY open box in the whole plan is #16's `.opju` migration edges (owner-dependent). Remaining gates: the AnalysisSelection contract timing. Historical: #8, #11, #12 CLOSED and #15 fully covered except the #1-gated folder-undo journey, ALL 2026-07-18 (#8: palette bridge + mini-toolbar + worksheet/window/annotation retrofits; #11: stat-mark faceting end-to-end; #12: PlotSpec v2 canonical spec (display/axes/decor blocks) across Stage/Graph Builder/Figure Builder/export — all 5 slices + parts A (y2Fmt)/B (grouped-series export)/C (decor: annotations/shapes/legend) shipped same day, `page` block deferred to ORIGIN_FILE_DECODE #54; #15: channel-drag + annotation/shape + window-arrange journeys, e2e 33/33 across the zoom matrix); #4 SHIPPED 2026-07-12, #6 SHIPPED 2026-07-16, #3+#7+#9+#10+#13+#14 SHIPPED 2026-07-17 (#10 docking deferred, #13 undo sub-item deferred to the #1 gate), #8 core SHIPPED 2026-07-17 (registry + keyboard-complete menu + resting cue + confirm; residual = Command Palette/Plot Objects tree/mini-toolbar reuse + remaining menu retrofits), #11 core SHIPPED 2026-07-17 (residual = stat-mark faceting; arbitrary multi-panel ordering belongs to #54), #15 core harness + 7 journeys SHIPPED 2026-07-17 and export round-trip SHIPPED 2026-07-18 (residual = folder undo, channel→axis drag, annotation/shape edit, window arrange); 4 owner gates (undo scopes, baseline framing, tree scope, selection contract) |
| `plans/ORIGIN_FILE_DECODE_PLAN.md` | Active | Plot Fidelity campaign: #48–#52 complete; #54 page-setup control + spatial-export residual + overlap/inset layout slice ALL SHIPPED 2026-07-17 (Codex PR #55); visual-import campaign #58–#63 ALL SHIPPED 2026-07-18 (Codex stack #56–#61 `854271c`: spatial legends, region bands, imported-view + spatial-page export parity, saved-preview window, presentation templates); **#54's generalized page/layer MODEL is COMPLETE — pass B shipped `50b4c9c` 2026-07-24**, joining A + C; **#21 (`.otp`/`.otpu` templates) struck 2026-08-10** — its deferred frontend half actually shipped 2026-07-11, recorded in MAIN_PLAN's Completed, but this item's own text was never updated; open = #53 graphic objects (evidence-gated; subsumes #47) and #54's specimen-gated >2-Y-axes rendering (now in the blocked table); #55 tooling is complete and #55/#56 close on owner screenshot review — **still 0/353 reviewed, confirmed still-open 2026-08-10**. #27 deferred; #42 reopens only on new corpus evidence. **2026-08-21 real-data + live-Origin verification campaign:** the "25 pre-existing renderer failures" every sweep since 2026-07-25 had carried were PHANTOM — a 2026-07-19 refactor (`5cdc7303`) removed the raw `spatialPanels` store field and the harness kept reading it, misclassifying every spatial multi-panel apply; fixed (`a8b3970a`), full 12-project corpus re-swept clean: 350 graphs, 332 fully-consistent, 18 known-unresolved (Hc2 register), 0 renderer/process failures. Same campaign added live Origin 2026b COM export oracles for the 9 projects that had none, made COM checkpoint manifests survive corpus relocation (`85e99d30`), and ran the long-pending DiraCulator W4 golden freeze (93 cases, 248/248 — see `DIRACULATOR_AUDIT_PLAN.md`) |
| `plans/archive/` | Complete | 16 plans incl. the 2026-07-10 fold-ups (MULTI_PLOT, WORKSHEET, PROJECT_ORGANIZATION, GAP_TIER3, GAP_ECOSYSTEM, ORIGIN_GAP), PLOT_WORKFLOW (Complete 2026-08-01 — all 4 owner design decisions shipped in ~24 h; #6 interface note folded into PRIMARY P1.3), ROBUSTNESS (Complete 2026-08-01 — Tiers 1+2 and #7/#9 shipped, #10 decided NO, owner-parked #8 folded to MAIN Owner gates), RSM_CUTS_PLAN (Complete, folded up 2026-08-10 — items #1–10, #16–23 SHIPPED, #11 skipped by owner decision (folded to MAIN Deferrals), #25 was its only genuinely open residue (folded to MAIN #41)), and **ERROR_LABEL_CLASSIFIER_PLAN (archived 2026-08-28 — its generate/rank/select rewrite shipped as `#238`, no open items, never had a BACKLOG row)** |
