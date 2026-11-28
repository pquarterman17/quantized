# Origin Feature Gap Plan

Turns the 2026-11-25 Origin audit into prioritised work. The audit compared
quantized with the locally installed OriginPro 2026b (Learning Edition) four
ways: the install's own feature inventory, a COM probe, OriginLab's online
documentation, and a walk through the live menus and dialogs. This plan books
what is worth building, in what order, and which model should build it. The
evidence stays in the appendix `ORIGIN_STUDENT_GAP_FINDINGS.md`.

**Status:** Active
**Parent:** `MAIN_PLAN.md`
**Appendix:** `ORIGIN_STUDENT_GAP_FINDINGS.md` (evidence tables, sections A–H)
**Contracts:** `ROW_RANGE_CONTRACT.md` (items 31, 34) and `PRESET_BAR_CONTRACT.md` (item 40), both accepted 2026-11-26
**Related:** `SCIENTIFIC_WORKBENCH_REPLACEMENT_PLAN.md` (cross-product journeys and acceptance criteria; its criteria for items 31, 34, 43, 44 and 47 are booked on those items)
**Created:** 2026-11-25
**Updated:** 2026-11-28 (wave 17 closed: #1241–#1244; items 39 and 44 complete; 16 items open; acceptance pass 15 found 0 broken and 0 wrong; OG24 opened; wave 18 booked under item 51. Before that, wave 16 closed: #1186–#1238; 15 items completed overnight; 18 items open including the new item 51 for the wave's residue; OG22 and seven follow-ups answered; OG15 and OG23 to revisit after testing)
**Baseline:** `origin/main` at `0f4b7bac0` (v0.45.0 + #1032)

---

## Context

### How the pieces fit together

- **Evidence.** The appendix holds one row per Origin feature with its
  quantized status (Have / Partial / Missing / Out) and the file that proves
  it. Sections A–D come from the install (383 rows), E–G from the online docs
  (200 rows), H from the GUI pass (44 rows plus 16 usability ideas). Every
  item below names the appendix sections it closes.
- **Where the code goes.** New analysis is a pure `calc/` module, a thin
  `routes/` adapter and a `components/workshops/` panel. New plot types need
  the screen renderer (uPlot) and the export renderer (matplotlib) to agree,
  pinned by a shared wire fixture. New parsers register once in
  `io/registry.py`.
- **Sibling plans. This plan does not duplicate them:**
  - `ORIGIN_PLOT_TYPE_PARITY_PLAN.md` owns the *import* mapping of Origin plot
    types. A plot type created here books its import mapping there.
  - `GAP_AUDIT_9.md` owns gaps G1–G27 and owner decisions D1–D8. Items here
    cite those IDs and inherit those decisions.
  - `JMP_GAP_PLAN.md` owns the census gate for clustering (J13).
  - `FIGURE_AUTHORING_WORKFLOW_PLAN.md` and `GUI_INTERACTION_PLAN.md` own the
    figure-document and object-editing contracts that W2 and W4 build on.
- **The oracle.** The local Origin runs with Pro features unlocked and no
  export watermark, so it can produce reference answers for most analysis
  items. Only a session on the Origin PC can run it (item 1).

### Data / control flow

```
Origin install + COM probe + online docs + GUI pass
        │
        ▼
ORIGIN_STUDENT_GAP_FINDINGS.md   (appendix: one row per feature, with evidence)
        │  grouped and ranked
        ▼
this plan: numbered items, tier, size, model
        │  one lane per item: claude/<lane> or codex/<lane> branch + PR
        ▼
lane codes against the item's oracle fixture (item 1) or a cited reference
        │
        ▼
merge → appendix row flips to Have → item struck into ## Completed
```

### How priority was set

1. **General before specialised** (owner rule): tools that work on any curve
   or any worksheet come before domain families.
2. **Daily friction first:** things a lab user hits weekly (curve readouts,
   peak labels, formula functions) outrank things hit yearly.
3. **Cheap and verifiable first:** small items with an Origin oracle rank
   above large items without one.
4. **Nothing speculative:** anything that needs an owner decision, a real
   specimen file or a census is listed but gated, not scheduled.
5. **New behaviour is a UI option, and it fails closed** (owner rule). No
   item changes a default silently.

### Model routing

Checked 2026-11-25; recheck in later sessions. Claude names are the current
5.5 family. OpenAI's lineup moved after the July routing table in
`PRIMARY_SOFTWARE_AUDIT_PLAN.md`. Its release notes list GPT-6.2 Astra and
GPT-6.2 Sol (2026-11-17) and GPT-6.1 Terra (2026-10-26), with Luna as the
efficient tier. Secondary guides disagree on the exact version numbers, so
this plan names ChatGPT *tiers*; use the current version of each.

| Work | Claude | ChatGPT |
|---|---|---|
| Mechanical work from a written spec: registry entries, thin wrappers, test expansion, docs | Haiku 5.5 | Luna |
| Bounded multi-file feature: calc + route + panel | Sonnet 5.5 | Terra medium |
| Complex UI or state on a settled architecture | Sonnet 5.5 | Terra high |
| New contracts: schemas, persistence, row-state or security design; review of large PRs | Opus 5.5 | Sol high |
| Unscheduled; only for a tightly scoped problem that defeats the tier above | Fable 5.2 | Astra |

Rules of thumb carried over from earlier plans:

- **Cheapest model that can own the decision**, not the cheapest that
  compiles. Where an item says "contract first", the stronger model writes
  the contract and reviews; the cheaper one fills it in.
- **Claude Sonnet is the default for numerics, parsers, persistence and
  canonical-state writes.** ChatGPT Terra / Sol give the best return on
  interaction design, spatial UI and visual acceptance.
- **Oracle runs need the Origin PC.** A cloud lane cannot start Origin. It
  codes against fixtures a local session has frozen.

Sizes: **S** under a day, **M** one focused PR, **L** several PRs or
design-heavy.

### Dependency map

- Item 1 (oracle harness) feeds every item marked "Oracle: yes". Lanes may
  start without it but cannot close without a reference answer.
- Items 2–5, 17, 18, 28, 29 and 37–39 are independent of each other
  (parallelisable).
- Items 6 and 11 are open (OG6, OG4); their Origin fixtures come first
  (item 1). Item 14 is per project (OG5) and item 46 is out (OG8). Items 30
  and 36 wait on specimen files (OG7).
- Items 31 and 34 share one contract (row ranges, named ranges and mirror
  columns all touch the row-state model and the recalculation graph); write
  it before either is built.
- Item 9 (fit library) should follow item 1, so each ported function is
  checked against Origin's own fit.
- Item 33 follows item 28, which fixes the contract for non-row-local
  formula functions.
- Item 39 (gallery presets) follows item 20 for the new statistical types;
  presets of existing types can ship first.
- Item 40 touches every workshop. Its store and file-format contract comes
  first; roll it out one workshop at a time, after the smaller W4 items.
  Item 41 is not scheduled (OG13).

### Running a lane wave

- **A changed dialog needs its e2e specs run (2026-11-28).** #1211 relabelled one confirm button and turned main's e2e red; no spec used a renamed label, so the lane never looked. A lane that changes a dialog's fields, buttons or confirm label, or adds a step to a command, greps `frontend/e2e/specs` for the command or dialog name and runs the matches. Where the e2e app cannot load locally, it names the specs so their CI run is watched.
- **A lane that could not run its e2e keeps auto-merge off until the PR's E2E is in (wave 17).** E2E is not a required check, so #1243 merged with two red shards: it had changed the spec of a dialog it did not convert (the Y3 Axis parameter dialog still confirms with Apply), and #1244 fixed main forward. When a lane edited specs it could not run, arm auto-merge only after its E2E passes.
- **A fold over a shared stack checks that nothing else moved it (wave 17).** #1243's popup session folded every history entry since its first Apply, so an entry another action pushed in between (a fit finishing, an undo pressed mid-session) would have been reverted with the popup's step. Review caught it; the fix and a test that fails without it landed in the same PR.

Waves 1–3 (2026-11-26) ran as Sonnet worker lanes: one git worktree each under
`.claude/worktrees/<lane>` on branch `claude/<lane>`, one PR each with
auto-merge armed. 18 lane PRs merged; every item they touched is struck below
or keeps its unfinished parts as sub-tasks. What the next wave should repeat or
avoid:

- **Check the shared budgets before launching.** Every lane draws on the same
  eager-bundle headroom. Two lanes can each fit alone and together go over, and
  because `main` is not strict both merge green into an over-budget `main`.
  Measure `main`'s headroom first; if the wave needs more, land a headroom slice
  first (`BUNDLE_HEADROOM.md`; slice 35 freed 9,975 B for this wave) or pause
  auto-merge on the later PR until the earlier one lands.
- **Create worktrees serially** (parallel `git worktree add` contends on git's
  lock), and never share or junction `node_modules` between worktrees: removing
  one deleted another's.
- **Every lane runs** its targeted tests, `npx tsc -b --force`,
  `npx eslint --max-warnings=0 src`, `npm run build`, the 13 frontend repo-wide
  guard files, and the backend guards `tests/test_heavy_import_guard.py` and
  `tests/test_repo_integrity.py`. Skipping eslint (#1041) and the heavy-import
  guard (#1053) each cost a failed CI round. CI runs the full gate; twelve
  concurrent full gates thrash the machine. Logs go to lane-unique paths
  (`/tmp/<lane>-*.log`).
- **Never get under a line pin by joining statements onto one line**; extract
  a module. The ternary lane did it to `store/useApp.ts`; it was replaced by
  `store/persistedViewState.ts`.
- **Landing.** Two required checks (`frontend`, `backend (windows-latest,
  3.13)`), not strict. The 3.11 leg runs on main pushes and nightly, not on
  PRs (2026-11-27); a red 3.11 leg on main is fixed forward. For a DIRTY PR:
  merge `origin/main`, keep both sides of additive conflicts (registries, unions,
  menus, the forward-compat field maps), regenerate `frontend/api/openapi.json`
  and `frontend/src/lib/api/schema.d.ts` (see `frontend/CLAUDE.md`; never trust
  their text merge), rerun the checks above, push. Semantic collisions do not
  show as conflicts: two lanes claimed the same glyph (#1051), and two parallel
  fixes of one spec merged into a duplicate (#1037, #1054; fixed by #1057).
  E2E is not required, so look at `main`'s E2E run after a burst of merges.
- **Wave 4 additions to the checks every lane runs:** `tests/test_routes_malformed_dataset.py`
  (every dataset-bearing route needs a sweep case) and `src/lib/api/endpoints.test.ts` (every
  `/api/` literal must name a real route) failed #1059; a parametrised "every kind renders"
  test failed #1066, so extending a registry means running every test that iterates it; and
  computed floats are compared with a tolerance, never `==` (Windows CI differs in the last
  digit).
- **An acceptance pass belongs in every wave.** The waves 1–3 pass (item 47) found two broken
  and three wrong features with every unit and CI check green.
- **Wave 5 additions:** run every test that pins a registry or a menu you extend, not only your
  own: the gadget-mode list (#1077) and the 12-item Plot > Layout menu ratchet (#1079) both
  failed CI. Run full-`src` eslint as the very last step after the final edit; two lanes changed
  code after their last full run (#1080, #1081). Before starting the oracle lane, check that no
  other Origin is running (`Get-Process Origin64`); another agent's open project paused it once.
- **Plans from other agents arrive as PRs.** A Codex roadmap (#1074) landed with no parent; bring
  such a doc into the tree on arrival (parent, MAIN_PLAN, BACKLOG, owners per item).
- **Docs pushed straight to `main` run `tests/test_repo_integrity.py` first.**
  It checks `BUGS_AND_ISSUES.md` (every Active queue id needs its own `##`
  entry); skipping it broke every PR's backend check once (fixed in
  `644b60044`).
- **Only the oracle lane may start Origin.** Origin facts measured in wave 1
  (formula semantics for `normcdf` tail, `weeknum` n2, the name options; York
  error columns are sigmas; `FitLRXErr` is menu-only, so it goes through Origin
  C) are pinned in the lanes' tests.
- **Known local-only failures on the Origin PC** (CI passes them):
  `tests/test_axis_scales.py::test_fixture_matches_the_live_export` and six
  Origin realdata tests (`test_io_origin_figures_opju` ×3,
  `test_io_origin_fidelity` ×1, `test_origin_migration_corpus` ×2).
  `fileCommands.test.ts` and `test_fit_robust::test_routes` flake under heavy
  load and pass alone.

- **Wave 6 additions:**
  - **Forward-compat after a release.** v0.45.0 reads the top rung (v8), so 28 fields gated since it were
    silently dropped by it until #1092 added v9. Once a release that reads the top rung ships, a new gated field
    needs a new rung (`RELEASE.md` says so now). The type check covers only top-level keys: a new nested key or
    kind value needs a check against the released code (`git show v0.45.0:<path>`). #1098 would have made v0.45.0
    drop the whole 3D view.
  - **Origin safety incident.** The oracle lane force-killed an Origin (PID 33392) it had not recorded starting,
    after a probe outside the harness hung. No other session was running and no autosave was written, so it was
    probably the lane's own. Every Origin probe goes through the harness, which records the PIDs it starts; never
    stop an Origin by name or by a PID the harness did not record.
  - **Check `main`'s E2E at the end of every wave.** E2E is not required, so it had failed silently since wave 5
    (four specs, fixed in #1099). The File menu root is at 353 of 360 px with no unit ratchet.
  - **Two lanes extending one registry conflict predictably** (the statistics catalog, `app.py` routers,
    `openapi.json`). The second to land merges `main`, keeps both sides, regenerates the API files and reruns every
    test that iterates the registry.
  - **Multi-term models need term-swap-aware recovery tests** (`Dhyperbl` swapped its terms on Python 3.13).
  - **Run the tests that render what you changed, wherever they live.** Grep the component's name in
    `frontend/src` for tests: #1101 changed the Multivariate review card, and its CI failed in
    `analysisselection/statsInputReview.test.tsx`, a directory the lane never ran.
  - **Clustering and the power panel sit in the 13-row menu ratchet's headroom.** Plot and Analyze roots are 12
    rows each after #1099, so the next new root-level flyout must go into an existing one.
  - **An acceptance lane may be unable to write its report file**; the orchestrator saves it.

- **Wave 7 additions:**
  - **Required checks are now two:** `frontend` and `backend (windows-latest, 3.13)`. PRs no longer run Python 3.11 (#1102,
    owner: dev speed first); main pushes and the nightly keep 3.11 and 3.13, so a version-specific break shows up there.
  - **Run the full suite beside the corpus after every wave.** CI never runs realdata tests: seven corpus-only
    expectations had gone stale unseen (#1110).
  - **GitHub can mark a branch that carries merge commits DIRTY even when `git merge origin/main` is clean.** Merge `main`
    and push.
  - **A lane's merged branch can supersede another PR.** #1116 carried #1114's commits; close the redundant PR.
  - **Merging two lanes can push a shared module over the 500-line ceiling.** Extract a cohesive sibling module; do not
    raise a pin.
  - **Keep a lane brief's default rule evidence-based.** An "X leads the ternary composition" default broke a summary
    test; #1117 made X lead only on evidence.
  - **A far-tail float fixture can encode a Python-version error** (#1120): check such a fixture on 3.11, 3.13 and 3.14.

- **Wave 8–9 additions:**
  - **`main`'s CI and e2e never finish during a merge burst**, because concurrency cancels the older run on each push. Check
    them after the burst settles, not during it. #1126 was a red e2e found this way: #1107's row-range fields had pushed
    Curve Fit's table out of view.
  - **Chain the merge and the push: push only if the merge succeeded** (`git merge origin/main && git push`). A conflicted
    merge was pushed once.
  - **A lane's merged-in fix branch can hit a full-suite failure nobody ran.** When a lane absorbs another branch, run the
    full suite on the merged tree, not only the lane's targeted tests.
  - **A strict xfail can start passing after a regeneration** (the Pulse fixtures, #1135). Strict is right: the pass is
    the signal to delete the marker, and an unexplained pass is a finding.
  - **ESLint's type-aware rules ran out of the default Node heap in CI (exit 134)**; the script now runs under a 6 GB heap (#1137).
  - **The bundle:** #1129 (slice 36) moved ten figure-lifecycle actions behind a lazy proxy for -7,298 B eager, which paid
    for R2's +1.1 kB; about 8.5 kB of headroom remains (`BUNDLE_HEADROOM.md` holds the figures).
  - **A flaky test is booked, not retried until green:** `CurveFitPanel.york.test.tsx` was, and #1152 forced and fixed its race.

**Next wave candidates (ungated):** wave 18, from item 51: text columns in the remaining group-by pickers; the raw
fingerprint and text cells; `savgol` boundary modes and the `movavg` family in scripts; the axis-break export range and
CSV time-of-day columns; lollipop caps and a shared ridgeline scale; the row window on ternary and vector-field figures
and on colour-by series; and pass 15's fixes. Then the plot tools on turned plots. OG24 is open but blocks nothing;
OG15 and OG23 are to be revisited after the owner tests them.

### Resolved decisions

- **2026-11-28 (owner), OG22 and seven follow-up questions answered:**
  - **OG22:** Shift+F2 stays the column-header editor; the cell-note editor stays on Alt+Shift+F2.
  - **Item 44 (staged edits):** the figure popups become Origin-style. Apply updates the plot and keeps the popup open, OK applies and closes, and Cancel closes and keeps what was already applied, discarding only later edits (Origin's Plot Details). One Ctrl+Z afterwards undoes the whole popup session. Built in #1243 for the Axis, Plot details, Legend and Color gradient popups.
  - **Rise time (C9, #1232):** new measurements keep the IEEE 181 state-level default.
  - **Distribution CI settings (#1198):** an off-default confidence setting becomes safe-drop, so older releases open the file and fall back to 95 % with no bootstrap. It no longer gates the file at v9. Built in #1241.
  - **Publication Preview with a map in front (#1212):** say that Publication Preview is for plots, and offer an Export map button instead of running the export. Built in #1241.
  - **Akaike weights (#1219):** keep them over converged fits only.
  - **Item 39 (gallery presets):** lift the 20-tile cap and group the preset tiles by plot family (Distribution, Violin, Histogram, …) with a small "more" fold. Built in #1242.
  - **Palette "sample" (#1218):** keep the Sample gallery first.
- **2026-11-25 (owner):** the audit is exhaustive; ranking comes afterwards.
  Evidence lives in `plans/`, committed.
- **2026-11-25 (owner):** agents on this work are "cheap but capable": Sonnet
  or below unless an item says otherwise.
- **2026-11-25 (owner):** borrow Origin's good usability ideas without
  cloning its interface (W4).
- **Standing (2026-11-21):** general before specialised; fail closed;
  permissive dependencies only; MATLAB is not a gate.
- **Standing:** EM and imaging stay in `fermiviewer`; 3D plotting beyond
  surface, waterfall, scatter, bars and vectors is out of scope (set 2026-11-15;
  the owner brought scatter, bars and vectors back on 2026-11-26 as item 48);
  watched-folder auto-import is out of scope.
- **Settled by code reading, 2026-11-25:** ternary contour is Missing;
  custom ticks with labels, full-precision copy, a worksheet table on a plot
  and EPS export already exist; "Change X / Y" exists only through Layer
  Contents; the X-and-Y-error line fit exists as Deming, without per-point
  weights.
- **2026-11-26 (owner), was OG14:** line widths and marker sizes stay in points in the export
  (the figure wire's screen-pixels-read-as-points rule is kept). Published figures are specified
  in points, and matching the canvas's relative weight would make absolute widths depend on the
  export size. The fields are labelled "pt" and the canvas is documented as a screen-scale
  preview, so the number means what lands in the PDF.

- **2026-11-26 (owner), OG1–OG13 answered:**
  - **OG1:** the scope list stays out, except 3D scatter, bars and vectors, which come back as item 48.
    Venn / UpSet and the rest of the list stay out.
  - **OG2:** port the general families now (item 9's first sub-task); implicit and surface families only
    on demand.
  - **OG3:** no domain families for now; items 15 and 36 wait for a project that needs one.
  - **OG4:** clustering goes ahead (item 11), SciPy only. This lifts GAP_AUDIT_9 D1 and JMP Gate J for
    J13 only; SPC, MSA and DOE keep their gates.
  - **OG5:** advanced statistics per project: a method is built only when a real project names it, on
    the existing statsmodels `[stats]` extra. scikit-learn stays a test oracle (item 14).
  - **OG6:** PyWavelets (MIT) as an optional, import-guarded dependency for item 6.
  - **OG7:** no specimen files on hand; item 30 waits for a real file of each format.
  - **OG8:** automation surfaces stay out, and so does the MAIN in-app scripting console gate (neither a
    DSL nor a kernel for now). Scripting stays headless: `qz run`, exported scripts, `quantized.client`.
  - **OG9:** PDF and SVG are enough; item 26 is closed.
  - **OG10:** only ternary vector and line plots (item 25). Radar, polar bar / wind rose, Smith chart,
    skewed axes, isosurface and Voronoi join item 27's record.
  - **OG11:** row-range views go ahead (item 31), contract first.
  - **OG12:** named ranges, cell notes and mirror columns go ahead (item 34); graphs or images in cells
    stay out.
  - **OG13:** the preset bar goes ahead (item 40); the properties navigator (item 41) is not scheduled.
- **2026-11-27 (owner), OG23 answered (item 50):** the double-click popup is the one editor for an axis,
  a curve and the legend, as in Origin, Igor and Prism. The right panel names what is selected with an
  Edit… button and keeps plot-wide settings (grid, frame, template, plot title). An outside click on an
  edited popup asks before discarding. Claude recommended the reverse (the right panel as the only editor,
  like Excel's Format pane); the owner chose the popup. OG15 is a tool window, not an object editor, so it
  is unaffected, but the two are worth weighing together at the OG15 revisit.
  **Reversible (owner, 2026-11-27):** the owner may go back to the docked direction. Lane D hides the
  panel controls behind one switch (`lib/objectEditorMode.ts`) instead of deleting them, and every item 50 PR
  logs its change in the contract's reversal ledger (E11).
- **2026-11-27 (owner), OG15–OG21 answered:**
  - **OG15 (provisional):** Curve Fit docks in the right column, stacked after Style, so the plot keeps its
    full height; Dock all and Reset layout do the same, and saved layouts keep their placement. The owner
    will revisit dock versus float (floating beside the plot, like Origin's NLFit dialog) after testing.
  - **OG16:** the Zoom tool stays armed after a zoom, as Origin's does; Esc returns to Pointer (today's
    behaviour, `useGlobalShortcuts.ts`, unless the persistent-tool preference is on). No change.
  - **OG17:** the 3-D Map tools panel starts collapsed and remembers its last open or closed state (a local
    preference, not the `.dwk`), so the scene gets the window.
  - **OG18:** a "Show toolbar button labels" preference, off by default; off keeps today's icon toolbar.
  - **OG19:** a Python 3.14 backend leg on the nightly and manual runs only; PRs and main pushes unchanged,
    and it is not a required check.
  - **OG20:** a ranged tool's saved result or output worksheet records the row range it used under a new
    gated key (v9), so older releases refuse the file, as for cell notes; the refusal from #1127 goes.
  - **OG21:** Weibull3 and Beta keep y0 outside their support: the curve stays defined everywhere and no
    point is dropped silently. Origin masks those points; the difference stays stated in the descriptions
    and pinned by the strict xfail.
- **2026-11-26 (owner):** the desktop installer stays lean while the app is in development, so dev speed
  comes first. No optional extra is bundled until the final product, which takes every analysis extra
  (item 49).

### Owner gates

The only place open questions for this plan live. Each names the items it
blocks.

OG1–OG23 are answered (OG1–OG14 on 2026-11-26, OG15–OG21 and OG23 on 2026-11-27, OG22 on 2026-11-28);
the answers are under Resolved decisions, and item text that says "OGn"
means that answer. Open:

- **OG24 (item 44's reach, 2026-11-28):** should the other dialogs that apply and close follow item 44's model
  (Apply stays open, OK, Cancel keeps what was applied, one undo step)? They are Layer contents, Layer properties,
  Plot setup, the Plot type gallery and the parameter-dialog axis settings (Y3+ through Plot ▸ Y axis settings…).
  Today they keep Apply-and-close (#1243). Blocks nothing; a yes becomes one lane per dialog.



- **To revisit (owner, 2026-11-27):** OG23, popup versus docked editing of plot objects. It is built
  as popup-only behind one switch, with a reversal ledger in `OBJECT_EDITOR_CONTRACT.md` (E11).

- **To revisit (owner, 2026-11-27):** OG15, Curve Fit docked in the right
  column versus floating beside the plot. The owner went back and forth and
  will decide again after testing the right-column dock. Keep the choice in
  one place so it is a one-line flip.

---

## Cross-cutting priorities

The "start here" view: the open work worth doing next, ungated. Items 2, 3, 4, 5, 7, 10, 11, 12, 13, 17, 18, 21, 22, 23, 24, 25, 28, 29, 32, 33, 34, 35, 37, 38, 39, 40, 42, 43, 44, 45 and 50
are complete; the others shipped their main part and keep the sub-tasks listed under each item.

| # | Item | Workstream | Why first | Model |
|---|------|------------|-----------|-------|
| 51 | Wave 18: item 51's residue lanes and pass 15's fixes | W4 | Booked from the lanes' own Not done lists and pass 15 | Sonnet 5.5 |
| 47 | Pass 16 over waves 17 and 18, plus what pass 15 did not reach: #1207 spatial-panel windows, Volume's trapezoid and backgrounds, gridding beyond Linear, a Variability chart with text factors | W2 | Every pass so far found a defect behind a green suite | Sonnet 5.5 |
| 9 | The 23 functions Origin cannot fit headless and the other fit-library remainders | W1 | Imported fits cannot find the functions yet | Sonnet 5.5 on the Origin PC |
---

## W1 — Analysis & fitting

### Tier 1 — High Impact

1. **Analysis oracle harness** — freeze Origin's answers for the analysis gaps as fixtures, so each lane codes against a known result.
   - Model: **Claude Sonnet 5.5 in a local session on the Origin PC** (a local Codex session on Terra also works). Size M.
   - Source: appendix "Origin Student as an oracle" and "Reproduce".
   - [x] Generalise `tools/plot_corpus/origin_session.py` into a runner that takes seeded input plus one X-Function call and writes the result as JSON (#1036, `tools/origin_oracle/`)
   - [x] Ship a `.truth.json` beside each seeded input; inputs come from quantized's own generators, not a copy
   - [ ] Fixtures for items 2–8, 10, 11, 13 and 32; treemap calls run in their own session. Covered: items 2, 3, 5, 7, 8 (row-wise t-test), 10, 13 and 32 (#1036, #1060, #1088). Items 6 and 11 and the power and sample-size engines were added in #1094 (19 fixtures; Mann-Kendall, Steel-Dwass, eta and omega squared and a probability calculator are absent from this install). Still to add: proportion power (menu-only, no `ocmath_*` engine), and `interp3` (a 3-D gridder whose signature does not match quantized's scattered query). Item 4 has no oracle (an App), and this install has no Zoom FFT X-Function
   - [x] Store under the private `test-data/origin/` corpus with a `realdata`-style marker
   - [x] Force the timeout-and-respawn path with a real hang (#1060: the 60 s deadline killed only the harness's own Origin; the next case ran on a fresh one)
   - [ ] Known convention differences stay as strict xfails, not defects: Renka gridding at the hull edge (Clough-Tocher, up to 0.52 off along the edge); Origin's `fir` decimation keeps an aliased tone; `corr2` does not subtract means (quantized does); Origin's trace `spline` is a natural cubic on chord length (no quantized equivalent); scattered linear / nearest are not scaled to the unit box in Origin; `marea` splits a cell into 2 triangles (quantized 4, 0.02% apart); Origin's NAG Shepard is unstable on the test data; Origin's Ward, centroid and median linkage apply Lance-Williams to unsquared distances; Origin's Welch confidence limits are the pooled interval; Origin's default k-means starting rows are unidentified (Lloyd from given centres reproduces it exactly). Revisit only when a user needs Origin's exact numbers (#1060, #1088, #1094)

### Tier 2 — Medium Impact

6. **Wavelets** — continuous and discrete transforms, wavelet denoise and smooth, in the Signal Processing workbench. *Opened 2026-11-26 (OG6): PyWavelets.*
   - Model: **Claude Sonnet 5.5**. Size M. Oracle: yes (`cwt`, `dwt`, `wtdenoise`).
   - Source: A4; GAP_AUDIT_9 G10 residue.
   - [x] PyWavelets as an optional, import-guarded `[wavelets]` extra (#1095)
   - [x] CWT, DWT, reconstruct from levels, wavelet smooth and denoise (#1095). DWT with zero padding, IDWT and CWT (`gaus2` exactly, `mexh` within 3%) agree with Origin (#1094); Origin's `periodic` mode is a rolled periodization, so only level 1 and Haar match `wavedec`
   - [x] Installer decision (owner, 2026-11-26): the installer stays lean while the app is in development; bundling `[wavelets]` and the other extras is item 49, much later
   - [x] Origin's conventions as options, defaults unchanged: the `origin-periodic` edge extension, a "percent of largest detail" denoise rule and a smooth cutoff, matching the frozen Origin cases to 1e-10; the CWT normalisation is pinned (L2, s^-1/2, scale in samples) and the 3% `mexh` gap is sampling and edge truncation, not normalisation (#1199)
   - [ ] Origin's `wtdenoise` sqtwolog: hard thresholding with one global threshold, but its noise sigma is unidentified (several fit the frozen cases; MAD of the finest level is excluded). The evidence is a realdata test; nothing guessed
   - [x] 2-D wavelet denoise and smooth on maps, a new linked map dataset, against `wavedec2` / `waverec2`; threshold 0 round-trips to 1e-12 (#1199)

9. **Fit-function library port** — bring Origin's remaining general built-in models into the registry from the install's FDF definitions. *Opened 2026-11-26 (OG2): general families first.*
   - Model: contract and generator by **Claude Sonnet 5.5**; bulk conversion and per-function tests by **Claude Haiku 5.5** (alt ChatGPT Luna). Size L. Oracle: yes (Origin's own fit per function).
   - Source: A2 (about 33 of 305 shipped before #1096).
   - [x] General families: 140 functions under Origin's names and parameter order, with automatic guesses and recovery tests (#1096). PFW is not a category in this install
   - [x] Origin's own fit of 117 of the 140 ported functions, frozen and compared in a realdata test (#1111)
   - [ ] The 23 functions Origin cannot fit headless: compare them another way or record each as untestable
   - [x] Pulse matches Origin (y0 below x0) and SchulzFlory matches Origin (x, xc and w are log10); Weibull3 and Beta keep y0 outside their support, stated in their descriptions, while Origin drops those points (a convention the owner kept, OG21; strict xfail); better generic guesses and a catalogue-start retry for a poor auto-guess; all 140 recover in a regression test (#1116)
   - [x] Every fit path honours each model's domain bounds (`with_domain_bounds`, `hard=`), so Pseudo-Voigt fits the YIG peak; an audit of all 211 models found only Pseudo-Voigt raising out of domain (#1130)
   - [x] The Pulse and SchulzFlory fixtures were regenerated after #1116's formula fixes: the Pulse optimiser stall is gone, and SchulzFlory reaches Origin's optimum (#1135)
   - [ ] SchulzFlory: two standard errors differ from Origin's although an independent central-difference JᵀJ agrees with quantized (strict xfail `STD_ERRORS_DIFFER`); the cause is not found
   - [ ] Dhyperbl through the picker: the backend reproduces Origin to a noise-level 0.15%, so the picker's range or start is the suspect (pass 5 W4; booked for the next pass)
   - [ ] FarazdaghiHarris from Origin's degenerate start
   - [ ] Map an imported `.opju` fit's function name to the registry (no importer reads fit-function names today)
   - [ ] Registry mismatches with Origin: `Sine` orders its parameters (xc, w, A, y0) against Origin's (y0, xc, w, A); `ExpGrow2` lacks Origin's t1, t2 > 0 bounds
   - [ ] Implicit (diode, solar cell) and surface families, on demand only (OG2)

### Tier 3 — Nice-to-Have

14. **Advanced statistics** — MANOVA, mixed models, factor analysis, Gaussian mixtures, ICA, canonical correlation, NMDS, GAM, trees and forests, neural-net regression, probit. *Per project (OG5, 2026-11-26): a method is built only when a real project names it, on the statsmodels `[stats]` extra.*
    - Model: scope and contracts by **Claude Opus 5.5** (alt ChatGPT Sol high); implementation by Sonnet 5.5. Size L.
    - Source: A6, E, F, G; GAP_AUDIT_9 G12, G14.

15. **Domain analysis families** — electrochemistry (impedance / Nyquist, Tafel, cyclic voltammetry), rheology (time-temperature superposition, Redlich-Kister, rheology fits) and the chromatography, electrophysiology, pharmacology and enzyme fit sets. *Not scheduled (OG3, 2026-11-26): none wanted for now.*
    - Model: **Claude Sonnet 5.5** with the `materials-science-expert` agent for formulas. Size M per family.
    - Source: A2, F, G.

16. **Niche signal Apps** — empirical mode decomposition, dynamic time warping, rainflow counting, Hurst exponent, ridge extraction, comb filter. Build on request only.
    - Model: **Claude Sonnet 5.5**. Size S each.
    - Source: F, G.

---

## W2 — Graphs & figure styling

### Tier 1 — High Impact

47. **Browser and export acceptance** — check each shipped feature in a running app and, for figure features, against the export. The waves 1–3 pass found defects no unit test had.
    - Model: **ChatGPT Sol** for visual acceptance (alt Claude Sonnet 5.5 driving the browser). Size M.
    - Source: the "Not done" sections of #1039, #1041, #1042, #1044, #1045, #1046, #1048 and #1052, and of #1049, #1051, #1053 and #1055.
    - [x] Screen against export and in a browser, through Playwright on the built app (2026-11-26): 7 work as claimed (#1053, #1051, #1046 with York matching the published values exactly, #1048, #1038, #1044, #1035), 3 cosmetic, 3 wrong, 2 broken
    - [x] Broken (#1045): Ctrl+Backspace on a focused Library row reached the delete handler (#1072: one shared `isDeleteKey` in every delete-on-key handler; the same bug also let Ctrl+Delete remove a dataset from the global shortcuts and Ctrl+Backspace clear worksheet cells)
    - [x] Broken (#1055): heatmap cell values never drew (#1071: labels describe the measured cells, on screen and in export, pinned by the wire fixture)
    - [x] Wrong (#1039): Avoid overlaps changed nothing (#1068: grid thinning no longer runs before placement; the stray "t" and the screen offset were uPlot's leftover right text alignment; the export note is a footer)
    - [x] Wrong (#1052): the map peak fit returned a duplicate and a low volume (#1067: windows sized to the peak, overlapping peaks fitted jointly; both test peaks within 0.05, volumes within 1%)
    - [x] Wrong (#1040): Align to peak reported noise maxima as aligned (#1069: a row needs a peak 6 noise levels above the window baseline, else it fails closed with a reason)
    - [x] Cosmetic: gridding pickers (#1067), the Align window placement (#1069), line over default symbols in export, the re-bound legend label and the York fit header (#1070), measurement labels in the frame and clear of the angle's arms (#1071)
    - [x] Label the line-width and marker-size fields "pt" and document that the canvas previews at screen scale (#1073; owner decision 2026-11-26, was OG14: widths stay points in the export). Rug length, "every N" and leader distance keep their own units; the font-size preference stays px because it styles screen text only
    - [x] Text columns as point labels (#1075; persisted, remap-safe, exported)
    - [x] Follow-ups: `min_snr` and a follow-the-peak window in Align to peak (#1076), the map-peaks minimum label and `n_merged` (#1076), jitter-tolerant cell labels with an Inspector note (#1080)
    - [x] Point-label font sizes: labels are drawn at the export's size relative to the ticks, so a crowded label lands in the same slot (#1115)
    - [ ] Not yet exercised: the map formula and extraction jobs (#32) and the Curve measurements panel's own modes, including intersection (#2). The third pass covered the clipboard, conditional formats, ROI volume, the tangent baseline, the derivative finder, Change Worksheet and repeat; all work
    - [x] The same pass over wave 4 (2026-11-26, on `10091c0e3`): 15 work, 3 cosmetic, 1 wrong (an Align to peak false peak on a sloped baseline), with the earlier fixes re-verified in the app; fixed in #1082 and #1084
    - [x] The same pass over wave 5 (2026-11-26, on `f3a93abe2`, scripted by the replacement plan's journey): 38 work, 14 cosmetic, 1 wrong (Curve Fit ignored its range under the window layout's auto-pin, fixed in #1100); the cosmetics fixed in #1101, including the unreachable stack-total and X-error controls
    - [x] The same pass over wave 6 (#1089–#1101), pass 4 (2026-11-27): 0 broken, 3 wrong, 10 cosmetic. Fixed: W1 (#1116), W2, C4 and C8 (#1118), W3, C7 and C10 (#1119), C1, C2 and C3 (#1117: X leads the ternary composition only on evidence), C5 (#1121); gadget markers now sit on their curve's own Y scale (#1121)
    - [x] Pass 9 over #1167–#1178 (2026-11-27, on `07ea3a62d`): about 55 work, 1 broken, 1 wrong, 1 cosmetic, 2 usability. Fixed in #1185: B1 (`rng("Name")` could not be typed in the formula bar or Set Column Values; adding a derived column also dropped its range link and skipped the cycle check), W1 (a one-group statistics box plot failed to export), the stale beta help, `rng` in Insert function, and range names that look like cell references
    - [x] Pass 10 over #1180–#1189 (2026-11-28, on `239723322`): about 60 work, 0 broken, 4 wrong, 4 cosmetic, 3 usability. Fixed in #1205: W1 (Axis popup tabs dropped each other's edits), W2 (an Apply with limits took two undos), W3 (fixed legend corners sat over the tick labels), W4 (a Y2 scale froze its format), the discard bar, the preset bar's name, round date ticks in export, an error-column picker in Plot details, duplicate preset imports. C3 was not a defect. U3 (a plain HH:MM:SS CSV imports as an index) is open
    - [x] Pass 10 U3: a plain CSV `HH:MM:SS` column imports as a clock axis through one strict rule; the wizard's broader proposal is unchanged and pinned; 0 type changes across 640 corpus files (#1214)
    - [x] Pass 4 C6: a 10,000-bar 3-D SVG goes from 10.2 MB to 3.5 MB, still vector, by culling back faces, a same-colour seam stroke and compact paths (#1213)
    - [x] Pass 4 C9: rise time takes its base and top from the IEEE Std 181 histogram state levels and refuses a trace with no two-level shape; saved steps from before keep their band-estimate numbers, with a "Re-measure with state levels" action (#1232)
    - [x] Third-pass leftovers: a CSV date column with blank cells imports as dates, one shared rule for direct import and the wizard, with 0 type changes across the corpus (#1103); export, copy and send act on the front window, maps included, and refuse with a reason when none is a figure (#1115)
    - [x] Publication Preview resolves its target through the front-window resolver; with a map in front it runs that map's Export map (#1212)
    - [x] Leading blank X values draw and range correctly (#1125)
    - [x] Middle-blank X values plot correctly: a missing x anywhere draws and ranges nothing, screen and export (pass 5 W1; #1139)
    - [x] The same pass over wave 7 (#1103–#1122), pass 5 (2026-11-27): 1 broken, 4 wrong, 12 cosmetic, 16 usability; all fixed except the open lines here (W1, the date-only CSV export, W4) and pass 4's C6 and C9
    - [x] Pass 5 fixes: the dark overlay key, gadget chips clear of the legend, legible pick rings, the probability axis winning over log with ticks thinned by length, power panel labels and 3-D groups from a text column (#1131); error columns named `x_err` and similar bind to X in the frontend and the Python mirror, export note wording, series card rows (#1132); first-run drop hint, the fit failure reason beside Fit, the model list closing on pick, a thinned log minor grid, the "Row range is set: Use it" offer, new floating tools opening beside the plot, the gadget hint and the 2-peak suggestion (#1134); mirror messages naming the column once by label, one Data window per sheet and a row-gutter menu with Exclude, Keep only and Use as row range (#1138; the stale-mirror message was already fixed by #1123)
    - [x] Date-only CSV export: an all-midnight date column writes plain dates (pass 5 C6; #1139)
    - [x] The same pass over waves 8 and 9 (#1122–#1138), pass 6 (2026-11-27): 1 broken, 2 wrong, 6 cosmetic, 8 usability. Fixed: cell notes through every paste path (#1140), outlier rows shown 1-based (#1141), 3-D bars coloured by a text column (#1143), and in #1144 bare `dx`/`dy` no longer seed error bars on import (a #1132 regression), the row-window chip in a clear corner, the Curve Fit preset bar's false "(edited)", skip names and save message, date-only X ticks and cells, and fits with more free parameters than points refused (an exactly determined fit warns and reports no uncertainties). Main's e2e was red from #1129's lazy `openEditableFigure` in a test helper (#1142)
    - [x] Pass 6 leftovers: "Plot only these rows" and "Extract selected rows" on the gutter menu, Multi-panel export pre-filled from the front plot with "Add this plot again", sweep-order level crossings and a Hysteresis pointer on loops, Go to Source scrolls the column fully into view (#1171). Still open: the 3-D scene small in a narrow window
    - [x] The same pass over #1139–#1159, pass 7 on v0.46.0-rc1 (2026-11-27): 1 broken, 3 wrong, 4 cosmetic, 6 usability, about 40 checks with numbers. Fixed: the box filter never offered and Curves per step duplicating curves (#1166), "Not saved" after a ranged save (#1165), the legend ignoring subgroup size, clipped text symbols and a tiny text swatch (#1163), and the 3-D strip, wording, refusal reason, Escape and complex column names (#1162)
    - [x] The same pass over #1160–#1166 and pass 7's not-exercised list, pass 8 (2026-11-27): 0 broken, 1 wrong, 2 cosmetic, 4 usability, about 60 checks with numbers (seasonal Mann-Kendall, effect sizes, the binomial detectable effect, ranged commits). Fixed in #1178: the Result book input line now states the recorded range, one reopen notice, the note shortcut per platform, presets ignore hidden knobs, a notice for text symbols on split plots, and Open as worksheet reuses its sheet and keeps the range
    - [x] The same pass over #1167 onward: passes 9, 10 and 11 (#1185, #1205, #1220)
    - [x] Pass 11 over #1186–#1209 (2026-11-28, on `6f0657bca`): about 40 numeric checks work, 0 broken, 2 wrong, 5 cosmetic. The owner's original report (double-click showing two editors) is confirmed fixed. Fixed in #1220: W1 (a CSV pair table's second text column could not feed significance marks), W2 (a Curve Fit from a named range was marked stale at once: the pin release re-seeded its input), the legend double-click by part, Show formulas on range rows only, the solver's active-bound tolerance and a non-unique-system warning, given-centre cluster numbering, date tick steps
    - [x] Pass 12 over #1211–#1220 (2026-11-28, on `e0a8b43ba`): 2 broken, 1 wrong, 5 cosmetic. Fixed in #1227: the Sample gallery's cards stacked on one spot, Map stack fit crashed with no maps, text symbols were missing from a colour-by scatter's export, Show formulas from the palette missed the side-by-side Data pane, the heat-map sample opened a stray plot, the solver's zero-derivative wording, facet export axes starting at 0 (a rug's axes-fraction collection was read as error-bar ends)
    - [x] A CI flake (a Column list rename on a protected sheet) was a real race: a text field's mount-time draft reset could overwrite the first keystrokes (#1228, forced-race test); the same shape fixed in six more fields, the annotation text dialog among them, and a guard test that passed vacuously now reads the real stylesheets (#1229)
    - [x] Pass 13 over #1221–#1230 (2026-11-28, on `0237e549a`): 4 broken, 7 usability; every number checked matched numpy. The broken: the Column list lost focus on the first key, Edit annotation text reopened after Enter, a Stat stage error covered its own mode tabs, and the group and facet pickers ignored CSV text columns (so the #1223 facet variants were unreachable from a plain CSV)
    - [ ] Pass 13's fixes (lane running), then acceptance pass 14 over #1231 onward
    - [x] Owner gates OG15–OG21 built (2026-11-27): Curve Fit docks in the right column after Style at a 0.6 share, one flip point `RIGHT_DOCKED_TOOLS` (#1148, provisional); a "Toolbar button labels" preference, off by default (#1147); Python 3.14 nightly (#1145); the macOS nightly's ternary wire tests compare floats at rel 1e-9 (#1146)
    - [x] Toolbar button labels on the Map toolbar; the Data window toolbar needed none, since every action already shows its word (#1212)
    - [x] The macOS legs are green after #1146: a full-matrix run on main passed all nine backend legs (Windows, Ubuntu, macOS × Python 3.11, 3.13, 3.14), 2026-11-27
    - [x] Flaky test: `CurveFitPanel.york.test.tsx` (failed in #1136 and on main at eb1b78fbf): the line fit told the header in a passive effect, a render after its table, so a frame showed "slope" beside "Not fitted yet"; it now publishes in a layout effect, and a MutationObserver test forces the race (3/3 failing before, 5/5 passing after; #1152)
    - [x] Re-verify the replacement plan's GUI audit findings on current main: 8 of 10 still reproduced and are fixed in #1083 (one import entry, named quick-export target), #1085 (stale-result recovery), #1086 (one worksheet-open intent that never retargets a running tool) and #1087 (exact method launchers, Classic layout terms, shortcuts through the launcher)
    - [x] Replacement plan residue (#1097): a durable "How this was imported" card, Freeze without retargeting, Publication Preview exports and names the previewed revision, Import as sheets and Import & append through the shared picker, and the stale-result note names the failing column. Gauge R&R stays with JMP J15 (gated)
    - [x] Adopt the replacement plan's journey as the next pass's script (used by the third pass): import, plot, fit a named range, edit an input, reopen, go to source, rerun and export, plus missing-source and canceled-edit variants
    - [ ] The HTML clipboard copy pasted into a real Word document (#29; tested against mocks only)

### Tier 2 — Medium Impact

20. **Statistical plot types** — CDF / ECDF, rug marks, marginal plots, ridgeline, half and split violin, paired before-after, lollipop / dot, stacked histogram, P-P plots for more distributions.
    - Model: first type by **Claude Sonnet 5.5** to set the render pattern; the rest by **ChatGPT Terra high** or Sonnet 5.5; ChatGPT Sol for visual acceptance. Size L. Oracle: yes for the templates that build over COM.
    - Source: B1, E, F, G, H1.
    - [x] CDF / ECDF and rug (#1053)
    - [x] Rug on facet, break and inset panels, on screen and in export (#1217)
    - [x] A client-side CDF (ECDF steps, DKW band, count scale) when the backend is offline; a fitted CDF refuses offline (#1217)
    - [x] Marginal plots (#1066: histogram, box or rug margins)
    - [x] Ridgeline (#1066)
    - [x] Half and split violin (#1078)
    - [ ] Marginal plots with per-point colour, size or group split; ridgeline with per-ridge normalisation and facets; free numeric overlap and bandwidth
    - [x] Paired before-after, lollipop, stacked histogram (#1078)
    - [x] A half violin on either side with inner marks; paired lines coloured by direction; a horizontal lollipop (dot chart); a stacked histogram split by a group column (#1183)
    - [x] The #1183 variants under facets, one panel per level on screen and in export, against numpy per panel; breaks and insets refuse with a note, since the Stat stage has no break or inset panels (#1223)
    - [x] A violin mean marker and rain points, a "no change" tolerance on the paired direction, a 100% split histogram, SD / SEM / 95% CI whiskers on the lollipop, and a plain histogram per facet (#1231)
    - [ ] Book each type's Origin import mapping in `ORIGIN_PLOT_TYPE_PARITY_PLAN.md`

### Tier 3 — Nice-to-Have

26. ~~**EMF export and printing**~~ **Not planned** — closed 2026-11-26 (owner, OG9): PDF and SVG export are enough; current Office inserts SVG as vectors.
    - Source: B2, H1.

27. **Families not scheduled** — the OG1 list (confirmed out 2026-11-26, except 3D scatter, bars and vectors, now item 48); the specialised types OG10 did not pick (radar, polar bar / wind rose, Smith chart, skewed axes, isosurface, Voronoi; item 25 had booked a symmetric-log axis check for them, since `symlog` appears only in `calc/axis_cross.py`); and the remaining gallery types (Scatter Central, point-segment lines, variable-radius pie, kite, ribbon, circular packing, cluster and correlation plots, heatmap with dendrogram). Kept for the record; no work unless the owner reopens one.
    - Source: B1, F, G, H1.

---

## W3 — Data, worksheet & import

### Tier 1 — High Impact

### Tier 2 — Medium Impact

30. **Imports by specimen** — JSON tables, NI TDMS, Princeton SPE, Tektronix ISF / WFM, LeCroy, WAV, Igor `.pxp`, HTML and PDF tables, NASA CDF, MDF4. *Waits for a real file of each format (OG7, 2026-11-26: none on hand).*
    - Model: **Claude Sonnet 5.5** per parser, with the `data-format-detective` agent; Opus 5.5 or ChatGPT Sol only for an undocumented binary. Size M each. Oracle: yes (Origin imports most of them).
    - Source: C1, F, G; GAP_AUDIT_9 G17.

31. **Row-range views** — plot or fit a row window without masking rows. *Opened 2026-11-26 (OG11); contract accepted.*
    - Model: contract by **Claude Opus 5.5** (alt ChatGPT Sol high), because the row-state model is the single source of truth; implementation by Sonnet 5.5. Size L.
    - Source: H1; H2 idea 12.
    - [x] Contract, shared with item 34: `ROW_RANGE_CONTRACT.md` (accepted 2026-11-26)
    - [x] Slice R1: row ranges in analysis inputs and fits, and the worksheet "Use as row range" action (#1107; no persisted state)
    - [x] The statistics tools honour a row range (Distribution, Fit Y by X, Multivariate, Variability, Fit Model, Outliers, Stats tests, Time series and more), with "Clear row range" on the input line; Baseline's single Estimate states it does not apply the range, and Pie, Ternary, Curie-Weiss, Signal Processing and Mag Background say "not applied" (#1127)
    - [x] Slice R0, the metadata-key gate: `GATED_METADATA_KEYS` in `lib/workspaceMetadataGate.ts` gates `__quantized_cell_notes`; `__quantized_source_rows` is deliberately not gated (Extract links are droppable, the contract's D5 / D14 amendment); a rung audit found nothing missing from `NEW_SINCE_V045` (#1122)
    - [x] Slice R2: the plot row window (`PlotView.rowRange`, gated v9); "Plot only these rows" sets it from the worksheet and a chip shows and clears it; export holds exactly the window's rows (wire fixture `row_range_figure.json`); insert and delete move the window, one undo restores it, recipes do not capture it; +1.1 kB eager, covered by #1129 (#1136)
    - [x] The row-gutter menu offers Exclude, Keep only and Use as row range (#1138)
    - [x] Saving a result from a ranged tool records the range instead of refusing: a snapshot result in `parameters.rowRange`, an output worksheet in the private `__quantized_input_row_range` key, both gated at v9 and in no export; the range is part of the duplicate key and the panel reads "rows 21-44 of 48 (when saved)" (OG20; #1150)
    - [x] A saved ranged result's Go to source rows selects its recorded rows, and Reopen in tool restores the recorded range, refusing when the source changed (R3; #1165). The panel's live key now matches the saved one, so a ranged save reads Saved (pass 7 W1; #1165)
    - [x] The Stage plots from `useStatStage`, polar and the plain stack honour the row window on screen and in export; fit, baseline and peak overlays are cut to the window; a worksheet gutter bar shows the window; an outside row-count change clears it with a reason (#1174)
    - [x] R2 remainders: facet, axis-break and spatial plots honour the row window on screen and in export, a named link that is deleted or stale draws no rows, and the overlay and panel wire fixtures (#1207)
    - [x] Slice R3: `__quantized_source_rows` (ungated) on Extract and "Create subset from region", Go to Source rows after sort, insert and delete, random row identity tokens (#1165)
    - [x] R3 remainders: "Create subset from region" asks the source series and the destination workbook; Go to Source rows from the palette and the Library (#1207)
    - [x] The polar map and the five G15 plots honour the row window on screen and in export, a deleted or stale named link refusing; "Extract rows…" asks the series and destination beside the unchanged one-click Extract (#1224)
    - [ ] Row-window residue: per-panel windows for other sheets need a contract; break panels draw no row styles on screen (with or without a window) while the export does; ternary and vector-field figures ignore the window

### Tier 3 — Nice-to-Have

36. **Other-software and domain imports** — Prism, Minitab, SAS, SigmaPlot; battery cyclers (BioLogic, Neware, Ivium, Metrohm); ChemStation and NMR; ODBC / SQL servers; Google Sheets. *Not scheduled (OG3, OG7, 2026-11-26): no domain family wanted and no specimen files yet.*
    - Model: **Claude Sonnet 5.5** per format. Size M each.
    - Source: C1, E, F, G.

---

## W4 — Workflow & usability (ideas borrowed from Origin)

### Tier 1 — High Impact

### Tier 2 — Medium Impact

41. **Properties navigator** — one properties surface with a graph › layer › plot tree, several axes edited together, "Apply to…" other layers and graphs, and previous / next in column properties. *Not scheduled (OG13, 2026-11-26).*
    - Model: interaction design by **ChatGPT Sol high**, implementation by **ChatGPT Terra high**; Claude Sonnet 5.5 reviews the canonical-state writes. Size L.
    - Source: H2 idea 4.

51. **Wave 16 residue** — the open remainders the wave 16 lanes reported, booked in one place so nothing lives only in a lane report. *Booked 2026-11-28.*
    - Model: **Claude Sonnet 5.5** lanes. Size S each.
    - Source: the Not done sections of #1186–#1244, and acceptance pass 15.
    - [x] Owner answers Q4 and Q5 built (#1241): Distribution CI settings are safe-drop (v0.45.0 has no CI feature, read from its source); Publication Preview with a map in front says it is for plots and offers Export map
    - [x] Pass 14's fixes (#1240). Acceptance pass 15 (2026-11-28, on `a1b85ad65`) confirmed every one, C4 included at 380 px, and found 0 broken, 0 wrong, 2 cosmetic and 6 usability
    - [ ] Pass 15's findings: Fit Y by X and Statistical tests differ in the 5th digit of a far-tail p-value (1.62037e-12 against scipy's 1.620405e-12, likely `1 − cdf` where `sf` belongs); a 3-channel Stat Box titles its Y axis with the first channel only; on a break plot the Curve is missing from Style's object list, and a stray click on the break square removes the break silently; a Library double-click does not activate a derived map row; Pareto defaults to a continuous Category and errors at once; saving a graph template under an existing name overwrites it with no notice; a stale snapshot result's Library row does not say Out of date
    - [ ] Groupable text columns: By partition's Distribution, Curve fit and By-level runs still use real channels only (#1237); Facet by column…, Split by column value… and Statistical tests do not offer text columns either (pass 15)
    - [ ] Staleness: the raw `dataFingerprint` (linked recalc outputs, fit freshness) still ignores text cells (#1238)
    - [ ] Plot tools: a box on a per-channel stack, a page of other sheets' panels or a split grid refuses; Pan, Measure, Region stats, Integrate, Peak / FWHM and Live fit stay off on turned plots (#1225)
    - [ ] Statistics plots: the #1183 variants under breaks and insets need Stat-stage break and inset panels; lollipop whiskers have no caps; ridgeline facet panels each use their own scale; text symbols refuse on a split or greyed facet grid (#1217, #1223, #1231, #1235)
    - [ ] Row windows: per-panel windows for other sheets need a contract; ternary and vector-field figures ignore the window; colour-by and size-by series draw no row states (#1224, #1236)
    - [ ] Formulas in scripts: `savgol` has only the Repeat boundary; the `movavg` family, propagated errors and `fit()` references stay app-only in scripts; no percentile, LOWESS or FFT filter functions (#1202, #1209)
    - [ ] Export and import: the axis-break export pads its y range where the screen uses one exact domain (#1227); a second time-of-day column in direct CSV import stays text, and AM/PM columns differ between the wizard and direct import (#1214)
    - [ ] Smaller: polygons in named ROI files and polygon editing gestures (#1197); frozen figures carry no freeze date and Trash restore is not an undo step (#1222); legend and plot-title fonts have no store field for format by parts (#1211); the hint log's toast actions are not clickable and the gallery has no thumbnails (#1218); map-stack fits are registry models only, unweighted and sequential (#1215)

### Tier 3 — Nice-to-Have

46. **Automation surfaces** — an in-app console, event scripts, custom menus and toolbars, user key chords, an app gallery. *Out of scope (OG8, 2026-11-26): scripting stays headless.*
    - Model: security contract by **Claude Opus 5.5** if approved; then Sonnet 5.5. Size L.
    - Source: D, E, G; GAP_AUDIT_9 G18.

49. **Desktop installer extras** — bundle the optional extras in the desktop installer, so the methods behind them work in the installed app. *At the final product (owner, 2026-11-26): roll every analysis extra in then. Until then the installer stays lean, so development stays fast.*
    - Model: **Claude Sonnet 5.5**. Size S.
    - Source: item 6's installer sub-task (wave 6 checkpoint).
    - Today `release.yml` builds the sidecar after `uv sync --group bundle`, and that group holds only PyInstaller. So no extra is in the installed app: `[stats]` (GLM, survival, ARIMA, ADF), `[wavelets]`, `[bumps]` (bumps fit engine, DREAM) and `[office]` (Word and PowerPoint report export). Installed users cannot add one later. Each method refuses with a reason, so nothing fails silently.
    - [ ] Add every analysis extra (`stats`, `wavelets`, `bumps`, `office`) as `--extra` flags on that `uv sync` line. `desktop` (pywebview) and `origin-com` (pywin32) are not for the Tauri sidecar
    - [ ] Check the PyInstaller spec (`tools/bundle/qz-server.spec`) collects them (hidden imports, statsmodels and lifelines data files), and extend the sidecar smoke test to run one method from each
    - [ ] Measure the installer size and sidecar start-up time before and after
    - [ ] The refusal text names a pip command (`pip install quantized-lab[stats]` and similar, in `calc/stats_glm.py`, `stats_survival.py`, `ts_arima.py`, `ts_stationarity.py`, `wavelets.py`, `fit_bumps.py`, `refl_dream.py`) that an installed-app user cannot follow. Any extra left out of the installer needs desktop wording that says so

---

## Completed

- ~~**#44 Staged edits in the figure popups**~~ (2026-11-28, #1243, #1244) — the Axis, Plot details, Legend and Color gradient popups follow Origin's Plot Details: Apply writes and stays open, OK applies and closes, Cancel and Esc keep what was applied; one undo step per popup session, which never folds in an entry something else pushed meanwhile; the outside-click question covers only edits after the last Apply. Ledger rows are in `OBJECT_EDITOR_CONTRACT.md` (E11). Not done: no live preview; the other Apply-and-close dialogs wait for OG24.
- ~~**#39 Plot-gallery variant presets**~~ (2026-11-28, #1035, #1066, #1078, #1242) — preset tiles for the existing types and the item 20 types, grouped by plot family under each family's own label, three visible per family and the rest behind a "+N more" fold; the 20-tile cap replaced by a per-family visible-count guard; new tiles for half violin with marks, raincloud, paired by direction, dot chart, 100 % stacked histogram and three ridgeline options. Applying a preset resets only the options its sibling presets set. Not done: a split-histogram tile (it needs a group-by column a tile cannot choose); the gallery has not been looked at in a browser.
- ~~**#34 Worksheet structure**~~ (2026-11-28, #1108, #1123, #1133, #1164, #1172, #1175, #1195, #1206, #1219, #1222, #1232) — mirror columns, cell notes, named ranges (with `rng()`, the Name box, a manager, live links for plots, fits and saved figures, out-of-date results, Trash restore), show formulas, a column list, sheet protection, a time-series pivot and inserting a column into similar sheets. Graphs or images in cells stay out (OG12).
- ~~**#22 Browser graph and graph tools**~~ (2026-11-28, #1154, #1217, #1225 and earlier) — step one graph through columns or sheets, pick points into a sheet, Hide Others, scrolling on probability and Y3+ axes, typed legends kept through a group step, and the box, lasso and pick tools on turned plots and inside one facet or break panel. Not done: a box on a per-channel stack, a page of panels from other sheets or a split grid refuses; Pan, Measure, Region stats, Integrate, Peak/FWHM and Live fit stay off on turned plots.
- ~~**#24 Plot Details residue**~~ (2026-11-28, #1154, #1156, #1217 and earlier) — per-point text symbols on grouped, encoded, per-series-X and facet views and in graph templates, the subgroup size kept through Vary dash & marker, and the rest of the Plot Details residue. A facet grid split by a group or an encoding, or greying excluded rows, refuses text symbols with a note.
- ~~**#12 Fit residue**~~ (2026-11-28, #1180, #1193, #1208, #1215, #1219) — a guided standard-curve tool; rank all models by category (AIC, AICc, BIC, adjusted R², reduced χ², Akaike weights over converged models); one model per dataset in Global Fit with shared parameters; a per-pixel fit through a map stack as a job, with parameter, error, χ² and converged maps against per-pixel `curve_fit`. The Pulse family was already present. Not done: map-stack fits are registry models only, unweighted and sequential (~8 ms per pixel).
- ~~**#42 Format by parts**~~ (2026-11-28, #1211, #1216) — Paste format (choose parts) applies only the ticked parts as one undo step; every format field belongs to one part, checked by the type system; themes are graph templates holding a subset of parts. Not done: legend and plot-title fonts have no store field; Paste format to graphs pastes whole.
- ~~**#45 Learning aids**~~ (2026-11-28, #1218) — Help › Recent hints (the last 50 status lines and toasts, in memory), a Sample gallery of six generated graphs with their worksheets, and an optional Tip of the day (off by default; every tip's menu path is checked against the real menus).
- ~~**#33 Formula functions, wave 2**~~ (2026-11-28, #1063, #1155, #1168, #1190, #1202, #1209; contract `COMPLEX_FORMULA_CONTRACT.md`) — special, engineering, data and lookup functions; complex numbers inside formulas, exported to scripts; Set Column Values columns export with their unit; an Argand / Nyquist pair with palette and Plot-menu entries; `savgol`, `movmax`, `movmin`, `cummax`, `cummin` and `cumprod` against scipy / numpy, headless too. Not done: `savgol` has only the Repeat boundary; the `movavg` family stays app-only in scripts; no percentile, LOWESS or FFT filter functions; propagated errors and `fit()` references stay app-only in scripts.
- ~~**#21 Ternary contour and heatmap**~~ (2026-11-28, #1203 and earlier) — composition maps on the triangle; the heatmap now draws cells that straddle the hull and clips them, so the edge is straight, pinned by the hull polygon in the wire fixture. Interior values unchanged; the Renka edge xfail stays.
- ~~**#7 Signal extras**~~ (2026-11-28, #1048, #1062, #1076, #1088, #1198) — coherence, phase unwrap, anti-alias decimation, envelope, percentile and binomial smoothing, Zoom FFT and PSD scalings matching Origin's TISA and MSA; nested recipe fields now have a typed forward-compat map (`lib/workspaceRecipeCompat.ts`), so an unclassified field fails the type check. `psdScaling` gates at v9; off-default Distribution CI settings gated too until #1241 made them safe-drop (owner, 2026-11-28; v0.45.0 has no CI table); the integrate-only baseline never reaches a `.dwk`.
- ~~**#10 General 2D map analysis**~~ (2026-11-28, #1052, #1060, #1064, #1065, #1197) — 2-D peak fits and ROI volume on any map, the box on any map, the trapezoid rule matching Origin's `integ2`, and polygon ROIs drawn, edited and saved (volume against an independent mask; consumers that cannot take a polygon refuse). Not done: polygons in named ROI files, insert-vertex and whole-polygon moves, polygons in a captured analysis selection.
- ~~**#11 Clustering**~~ (2026-11-28, #1089, #1094, #1200) — k-means and hierarchical clustering with a dendrogram, user-given starting centres (equal to sklearn, `kmeans2` and a hand Lloyd loop), squared-Euclidean and cosine distances (Ward stays Euclidean), variable clustering by 1 − |r| or 1 − r, and a Result book section with reopen. The Origin k = 5 default-start case still misses even with Origin's recorded centres; its strict xfail stays.
- ~~**#23 Annotation tools**~~ (2026-11-28, #1201 and earlier) — slope annotation, angle and distance measures, scale-bar objects, heatmap cell labels, and significance marks from a saved post-hoc result or three worksheet columns, with editable thresholds, "show p" and "show ns", the same layout on screen and in export, gated at v9. Not done: Dunnett as a source (its table does not record the control), staleness of the source result, faceted plots and stacked bars.
- ~~**#50 One editor per plot object**~~ (2026-11-28, #1187, #1188, #1189, #1194; contract `OBJECT_EDITOR_CONTRACT.md`, OG23) — the double-click popup is the only editor for an axis, a curve and the legend: the Axis popup gained the title, Y2 "Same as Y" and the X date modes; Plot details became a tabbed curve editor over one draft; an outside click on an edited popup asks before discarding; the right panel names the selection with Edit… and keeps plot-wide settings, with X / Y / Y2 / Y3+ launchers. Reversible: one switch (`lib/objectEditorMode.ts`) and a reversal ledger in the contract. Not done: a channel that is not plotted cannot have its curve style edited.
- ~~**#40 Preset bar on every tool**~~ (2026-11-28, #1104, #1124, #1160, #1169, #1170, #1176, #1178, #1181, #1184, #1191) — named settings and last-used values on every analysis tool the plan lists (26 tools), with export and import, the Recipe Library listing, the hidden-field rule and one option list per tool. #1191 also stopped Optical gap overwriting a preset's unit and signal. Judgement calls in #1191: Surface fit stores no start values or bounds; SIMS Region writes last used on export.
- ~~**#13 Math extras**~~ (2026-11-28, #1059, #1076, #1088, #1192) — areas, trace and scattered interpolation, B-spline resampling, map correlation with "subtract means" (off equals Origin's `corr2`; the strict xfail became a passing test) and a local normalisation over the overlap, a root and minimum solver with systems of equations and equality / inequality constraints (SLSQP or trust-constr, active constraints named). The local window is the per-offset overlap, not a drawn region.
- ~~**#35 Export writers**~~ (2026-11-28, #1180) — SQLite, XML, NetCDF map output and worksheet to PDF on the converter's writer pattern; the XML writer drops the characters XML 1.0 forbids.
- ~~**#43 Role grid at plot time**~~ (2026-11-27, #1182) — Plot setup's role grid picks X, Y, error and label columns per plot, independent of designations; a Y alone with one designated X plots directly and competing matches get a role picker; a read-only plot list shows each plot's range. Built only the difference from Quick Plot and Graph Builder. Not done: the Set As overlay in `resolveSelectionPlot`, a per-row X-error target, role editing from the plot list, a toolbar button.
- ~~**#8 Statistics completions**~~ (2026-11-27, #1091, #1093, #1105, #1161) — power and sample size with curves, probability calculator, row-wise t-tests with adjusted p, Steel-Dwass, ANOVA effect sizes (now also repeated-measures and Welch), Mann-Kendall and seasonal Mann-Kendall with Sen's slope, a Distribution confidence-interval table, exact binomial power and its detectable effect, and reopen entries for the CI table and the row-wise worksheet; each against scipy / statsmodels oracles. Not done: the Hirsch-Slack serial-dependence correction for seasonal Mann-Kendall and a heterogeneity-of-trend test.
- ~~**#48 3D bars and vectors, and 3D scatter extras**~~ (2026-11-27, #1098, #1106, #1128, #1143, #1149, #1153) — 3-D bars and vectors on the shared renderer and camera, scatter colour / size / groups / error bars / wall shadows, vectors coloured by length or any column, bars coloured by a column, grouped side by side, or sized in data units; the 3-D panel starts collapsed, opens for a refusal it can fix and docks beside a wide scene. Screen and export pinned by `plot3d_kinds.json`; every field gated at v9.
- ~~**Origin audit**~~ (2026-11-25) — install inventory, COM probe, three online-docs sweeps and the GUI pass; 627 feature rows and 16 usability ideas in the appendix.
- ~~**Status checks folded into this plan**~~ (2026-11-25) — ternary contour settled Missing; custom ticks with labels, full-precision copy and a worksheet table on a plot settled Have; "Change X / Y" settled Partial; text to columns and Hide Others settled Missing.
- ~~**#19 EPS export**~~ (2026-11-25) — already existed: `eps` is in every figure renderer's format list (`calc/figure.py`), in Preferences › Export and in batch export (`batchFigureBuilderOptions.ts`). The audit row was wrong. No work required.
- ~~**#39 first sub-task: presets of existing types**~~ (2026-11-26, #1035) — 10 variant tiles (step line, line + error band, spline + symbol, scatter + drop lines, 100% stacked column, box + points, box + mean ± SD, violin + points, violin + median, histogram + normal fit). The item stays open for the item 20 types.
- ~~**#1 main part: oracle harness and six cases**~~ (2026-11-26, #1036) — `tools/origin_oracle/` runs each case in its own `Origin.Application` under a 60 s deadline. Cases: intersect, levelcrossing, a nonlinear Gaussian fit, `integ1`, `pkFind` and the York line fit (through Origin C, since `FitLRXErr` is menu-only). Fixtures live in the private corpus. The item stays open for the remaining cases.
- ~~**#2 main part: curve measurements**~~ (2026-11-26, #1038) — intersection of two curves, level crossings and rise / fall time. The item stays open for the gadget kinds.
- ~~**#3 main part: peak-tool completions**~~ (2026-11-26, #1040) — derivative find modes, tangent baseline and alignment to a common peak; the recipe schema gained two optional fields. Two small sub-tasks stay open.
- ~~**#4 Sequential fit**~~ (2026-11-26, #1046) — batch fit can start each dataset from the previous fit's parameters.
- ~~**#5 Per-point (York) weights**~~ (2026-11-26, #1046) — York regression in Curve Fit; it matches Origin's `fitlrxerr` oracle to about 1e-15.
- ~~**#7 main part: signal extras**~~ (2026-11-26, #1048) — coherence, phase unwrap, anti-alias decimation, envelope, percentile and binomial smoothing, Zoom FFT. PSD power scaling stays open.
- ~~**#10 main part: general 2D map analysis**~~ (2026-11-26, #1052) — 2D peak fits and ROI volume on any map. Three sub-tasks stay open.
- ~~**#17 Line and symbol polish**~~ (2026-11-26, #1041) — gap to symbol, line over or under the symbols, double line per series; display-time skip points already existed as `markerEvery`. The visual check moved to item 47.
- ~~**#18 Point labels that avoid overlap**~~ (2026-11-26, #1039) — opt-in overlap avoidance and leader lines. The visual check moved to item 47.
- ~~**#28 main part: formula functions, wave 1**~~ (2026-11-26, #1047, #1043) — distributions and date extras, then moving-window, column-statistic and conditional-aggregate functions. `LET` stays open.
- ~~**#29 main part: worksheet clipboard and cleanup**~~ (2026-11-26, #1044) — clipboard formats, text to columns, label-row sort and more conditional-format rules. Fill patterns stay open.
- ~~**#37 main part: quick wins**~~ (2026-11-26, #1045) — selection stats, repeat last action, reopen last dialog and menu recents. The shipped limits stay open as a sub-task.
- ~~**#38 main part: Change X / Y / Worksheet**~~ (2026-11-26, #1042) — on a curve's right-click menu, plus Hide Others. "Show all" semantics stay open.
- ~~**#20 first sub-task: CDF / ECDF and rug**~~ (2026-11-26, #1053) — a CDF plot with a DKW confidence band, and rug marks on screen and in export. Marginal and panel rugs and an offline CDF stay open.
- ~~**#21 main part: ternary contour and heatmap**~~ (2026-11-26, #1051) — composition maps on the triangle. Three sub-tasks stay open.
- ~~**#23 main part: annotation tools**~~ (2026-11-26, #1055) — slope (power-law exponent on log-log axes), distance, angle and scale-bar shapes, and heatmap cell-value labels, matched on screen and in export through a shared wire fixture. Significance marks, a map-stage scale bar and the angle arc stay open.
- ~~**#32 main part: gridding and map formulas**~~ (2026-11-26, #1049) — Shepard, Kriging and Renka gridding, log-spaced grids, map values from a formula and pixel extraction across maps. Three sub-tasks stay open.
- ~~**#3 Peak-tool completions**~~ (2026-11-26, #1040, #1062) — derivative finder, tangent baseline (including the integrate-only path), alignment to a common peak and reopening aligned outputs. The acceptance pass booked an alignment defect under item 47.
- ~~**#7 PSD power scaling**~~ (2026-11-26, #1062) — density or power per bin, labelled and unit-correct against scipy. The FFT gadget and older-release recipe notes stay open.
- ~~**#10 box on any map, integ2 comparison**~~ (2026-11-26, #1064, #1060, #1065) — the trapezoid volume rule matches Origin's `integ2` to 1e-12; the pixel-cell default is kept.
- ~~**#13 main part: math extras**~~ (2026-11-26, #1059) — one lazy panel with eight jobs, all checked against analytic cases.
- ~~**#20 marginal plots and ridgeline**~~ (2026-11-26, #1066) — screen and export share one vertex builder per language.
- ~~**#21 rest: Z range, append, forward-compat gate**~~ (2026-11-26, #1064) — ternary settings were being silently dropped by v0.34–v0.41 since #1051; they are now gated, and the gate is type-enforced for every top-level key.
- ~~**#28 Formula functions, wave 1**~~ (2026-11-26, #1047, #1043, #1063) — distributions, date extras, moving-window, column-statistic and conditional-aggregate functions, and `LET`.
- ~~**#29 fill patterns**~~ (2026-11-26, #1061) — number and date series, month-end clamping, one undo step.
- ~~**#32 Gridding and map formulas**~~ (2026-11-26, #1049, #1060, #1064) — Shepard, Kriging and Renka gridding, map formulas, pixel extraction with click to pick, map-card options; Shepard and thin-plate agree with Origin within explained tolerances.
- ~~**#33 main part: formula functions, wave 2**~~ (2026-11-26, #1063) — 33 element-wise functions mirrored in the exporter, plus app-only lookups.
- ~~**#37 rest: repeat and reopen coverage**~~ (2026-11-26, #1061) — multi-input repeats, and reopen for menu dialogs.
- ~~**#38 Change X / Y / Worksheet on a curve**~~ (2026-11-26, #1042, #1061) — including Hide Others and a Show all that restores the earlier hidden set.
- ~~**#1 oracle cases for items 7, 10, 13 and 32**~~ (2026-11-26, #1060, #1065) — 12 new Origin fixtures with comparison tests; the envelope's ends now match Origin to 1e-9 (a quantized defect, fixed in #1065).
- ~~**#47 first part: the waves 1–3 acceptance pass**~~ (2026-11-26) — 15 PRs checked in the built app; the defects are booked under item 47.
- ~~**#47 acceptance defects fixed**~~ (2026-11-26, #1067–#1072) — two broken, three wrong and six cosmetic defects, each reproduced by a failing test through the real UI or store path first. The export line weight was settled by the owner on 2026-11-26 (was OG14).
- ~~**#29 Worksheet clipboard and cleanup**~~ (2026-11-26, #1044, #1061, #1080) — clipboard formats, text to columns, label-row sort, conditional formats, and number and date fill series with the unit read from two cells.
- ~~**#37 Quick wins**~~ (2026-11-26, #1045, #1061, #1080) — selection stats, repeat last (single and multi-input, and with inputs reversed), reopen last dialog, menu recents.
- ~~**#2 gadget kinds**~~ (2026-11-26, #1077) — intersect, interpolate and rise time on the plot's ROI chip, sending the panel's own requests.
- ~~**#13 rest: math extras reopen and checks**~~ (2026-11-26, #1076, #1088) — reopen and Replace, query points from a worksheet, surface area within 0.02% of Origin's `marea`.
- ~~**#20 wave 5 types**~~ (2026-11-26, #1078) — half and split violin, paired before-after, lollipop, stacked histogram.
- ~~**#22 main part: browser graph and graph tools**~~ (2026-11-26, #1079) — browse through columns and sheets, pick points into a worksheet with provenance, an axis scroller, a filter from the graph.
- ~~**#24 main part: Plot Details residue**~~ (2026-11-26, #1081) — text symbols, equal-aspect axes, XY error rectangles, stack totals.
- ~~**#1 oracle cases, part 3**~~ (2026-11-26, #1088) — 12 more Origin fixtures (map correlation, interpolation, B-spline, `marea`, NAG gridders, PSD, curve averaging, block mean, row-wise t-test), 18 agreements and 7 recorded conventions.
- ~~**#47 second pass and the workbench findings**~~ (2026-11-26, #1082–#1087) — the wave 4 pass plus the replacement plan's GUI audit re-checked on current main; the sloped-baseline false peak and 8 GUI findings fixed.
- ~~**#6 main part: wavelets**~~ (2026-11-26, #1095) — CWT, DWT, reconstruct, wavelet smooth and denoise behind an optional `[wavelets]` extra; DWT, IDWT and CWT agree with Origin. 2-D wavelets stay open; the installer extras are deferred to item 49.
- ~~**#8 main part: statistics completions**~~ (2026-11-26, #1091, #1093) — power and sample size, a probability calculator, row-wise t-tests (pooled and Welch), Steel-Dwass, ANOVA effect sizes, Mann-Kendall with Sen's slope. The CI panel stays open.
- ~~**#9 general families**~~ (2026-11-26, #1096) — 140 of Origin's general functions with recovery tests; Origin's own fits and an import mapping stay open.
- ~~**#11 main part: clustering**~~ (2026-11-26, #1089, #1094) — k-means and hierarchical clustering with a dendrogram, checked against 20 Origin answers.
- ~~**#25 Ternary vector and line plots**~~ (2026-11-26, #1090) — line plots with series and gaps, vector plots between compositions, screen and export pinned by a wire fixture. Not booked: a start-plus-delta vector input, series by a text column, a colour-bar range.
- ~~**#48 main part: 3D bars and vectors**~~ (2026-11-26, #1098) — on the 3D map stage and in export from one camera, gated at v9.
- ~~**#47 wave 5 pass and its fixes**~~ (2026-11-26, #1097, #1099, #1100, #1101) — 38 work, 14 cosmetic, 1 wrong; the replacement plan's GUI residue and `main`'s E2E fixed too.
- ~~**Forward-compat v9 rung**~~ (2026-11-26, #1092) — 28 fields v0.45.0 would drop now write v9, measured against v0.45.0's own loader.
- ~~**#31, #34, #40 contracts**~~ (2026-11-26) — `ROW_RANGE_CONTRACT.md` and `PRESET_BAR_CONTRACT.md` accepted with two amendments.
- ~~**#2 Curve measurements**~~ (2026-11-27, #1112) — a level-crossings gadget kind, on-plot markers, units in the chip, rise-time settings, Commit / Report and a second curve from another worksheet; with #1038 and #1077 every sub-task is done. The rise-time plateau estimate stays under item 47.
- ~~**#8 CI section, adjusted p and power remainders**~~ (2026-11-27, #1105) — confidence intervals in Distribution (mean t, exact-coverage median, chi-square sd and variance, seeded bootstrap), Bonferroni / Holm / BH adjusted p for row-wise t-tests, exact binomial, Cohen's w and correlation power. Four sub-tasks stay open.
- ~~**#9 Origin's own fit of 117 functions**~~ (2026-11-27, #1111) — frozen and compared in a realdata test; 23 functions cannot be fitted headless in Origin.
- ~~**#9 Pulse, SchulzFlory and generic guesses**~~ (2026-11-27, #1116, carrying #1114's commits; #1114 closed as superseded) — Pulse and SchulzFlory match Origin; Weibull3 and Beta keep y0 outside their support (a stated convention, strict xfail); better guesses plus a catalogue-start retry; all 140 recover.
- ~~**#22 Pick and the log-axis scroller**~~ (2026-11-27, #1113) — Pick toolbar button, on-plot pick markers, its own click path, scrolling on log axes.
- ~~**#24 Centroid, hull and ellipse**~~ (2026-11-27, #1109) — group centroid, convex hull and a data or mean confidence ellipse, gated at v9.
- ~~**#48 3D scatter extras**~~ (2026-11-27, #1106) — colour, size and groups by column, X / Y / Z error bars, wall shadows.
- ~~**#31 slice R1**~~ (2026-11-27, #1107) — row ranges in analysis inputs and fits, and the worksheet "Use as row range" action.
- ~~**#34 slice R5**~~ (2026-11-27, #1108) — mirror columns, plus a recalculation-order fix for `sheet()` readers.
- ~~**#40 slice P1**~~ (2026-11-27, #1104) — preset core, bar and the Resample adapter; user-level `qz.presets`, fail-closed.
- ~~**#47 CSV date columns with blank cells**~~ (2026-11-27, #1103) — one shared rule for direct import and the wizard; the corpus sweep found 0 type changes.
- ~~**#47 export on the front window, point-label size**~~ (2026-11-27, #1115) — export, copy and send act on the front window and refuse with a reason when none is a figure; labels are drawn at the export's size (#1075).
- ~~**#47 pass 4 over wave 6 and its fixes**~~ (2026-11-27, #1116–#1119, #1121) — 0 broken, 3 wrong, 10 cosmetic; all fixed except C6 and C9.
- ~~**#47 stale realdata expectations**~~ (2026-11-27, #1110) — seven corpus-only test expectations re-pinned, all stale and no code regression (ledger row R-40); the full suite beside the corpus is 0 failed.
- ~~**CI: PRs run Windows on Python 3.13 only**~~ (2026-11-27, #1102, owner: dev speed first) — main pushes and the nightly keep 3.11 and 3.13; required checks are `frontend` and `backend (windows-latest, 3.13)`.
- ~~**Probability-axis backward map**~~ (2026-11-27, #1120) — identical on every Python; `NormalDist.cdf` before 3.14 is inaccurate in the far tail, so the fixture had held a 3.13 error. A nightly-only 3.14 CI leg is recommended to the owner, not added.
- ~~**Owner gates OG15–OG21**~~ (2026-11-27, #1145–#1150) — answered in the morning and built the same day: Curve Fit docks right (provisional, to revisit after the owner tests it), the 3-D panel collapsed, toolbar button labels, Python 3.14 nightly, ranged results saved with their range; OG16 and OG21 kept today's behaviour.
- ~~**#31 R0, R1 follow-up and R2**~~ (2026-11-27, #1122, #1127, #1136) — the metadata-key gate, row ranges in the statistics tools, and the plot row window with export. Saving a ranged result and R3 stay open.
- ~~**#34 mirror gaps, cell notes**~~ (2026-11-27, #1123, #1133) — refusals on every edit path, Go to Source in the window layout, `qz.detachMirror`, and cell notes that follow their cell and export as `.xlsx` comments without leaking the private key.
- ~~**#40 slice P2**~~ (2026-11-27, #1124) — Curve Fit preset bar over fit templates; Save-as asks before replacing.
- ~~**#47 leading blank X**~~ (2026-11-27, #1125) — a leading blank X draws and ranges correctly. Middle-blank X is wave 9's lane.
- ~~**#47 e2e fix**~~ (2026-11-27, #1126) — `main`'s e2e had gone red because #1107's row-range fields pushed Curve Fit's table out of view; the fields now sit on one line.
- ~~**#48 vector colour, bar colour, end caps**~~ (2026-11-27, #1128) — vector colour by length, per-bar colour from a column, 3-D scatter error-bar end caps.
- ~~**Bundle slice 36**~~ (2026-11-27, #1129) — ten figure-lifecycle actions behind a lazy proxy, -7,298 B eager; figures in `BUNDLE_HEADROOM.md`.
- ~~**#9 domain bounds on every fit path**~~ (2026-11-27, #1130) — Pseudo-Voigt now fits the YIG peak; only Pseudo-Voigt of the 211 models raised out of domain.
- ~~**#47 pass 5 and its fixes**~~ (2026-11-27, #1131, #1132, #1134, #1138) — 1 broken, 4 wrong, 12 cosmetic, 16 usability over #1103–#1122, all fixed except the lines kept under item 47.
- ~~**#1, #9 Pulse and SchulzFlory fixtures**~~ (2026-11-27, #1135) — regenerated after #1116; the Pulse stall is gone, and SchulzFlory's two standard-error differences stay a strict xfail.
- ~~**CI: ESLint heap**~~ (2026-11-27, #1137) — the eslint script runs under a 6 GB Node heap; the type-aware rules had run out of the default heap in CI (exit 134).
