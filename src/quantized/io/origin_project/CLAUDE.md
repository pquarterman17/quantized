# CLAUDE.md: Origin import (`io/origin_project/`)

Rules for any change to Origin decode, binding or apply code: this package,
`frontend/src/lib/origin*`, `frontend/src/store/originApply*`. Step-by-step
workflow: the `origin-change` skill
([SKILL.md](../../../../.claude/skills/origin-change/SKILL.md)). Human entry
point: [docs/origin_re/README.md](../../../../docs/origin_re/README.md).

## Origin graph-recovery safety (2026-07-13 incident)

- **Read [DECODE_LEDGER.md](../../../../docs/origin_re/DECODE_LEDGER.md)
  first** (proven facts with their guards, owner decisions, regression
  history). Every fix or newly proven fact adds a one-line row there in the
  same PR, with a guarding test. Never weaken a guard to pass; a wrong guard
  is proven wrong with new evidence and logged in its section 4.
- **Every Origin import change passes `uv run python tools/gate.py --origin`**
  and explains every corpus change (see "Regress gate" below).
- Graph recovery is ONE pipeline: **file bytes -> per-curve `(book, X, Y)`
  binding -> dataset construction -> acquisition order -> renderer path ->
  axis state**. A local field decode is not valid if the final graph is wrong.
- **Never reintroduce byte-17 `connect=segment2`.** PRs #30/#31 were reverted
  by #32 after a corpus-wide false positive broke continuous curves (ledger
  R-01, B-09; [curve_axis_fidelity.md](../../../../docs/origin_re/curve_axis_fidelity.md),
  `plans/ORIGIN_FILE_DECODE_PLAN.md` item 52). Line and line+symbol curves
  stay continuous unless specimen + COM/LabTalk oracle + rendered-Origin
  reference + plausible corpus distribution ALL prove another mode. Only
  byte-17 value 11 (step) is read.
- **Protect multi-X worksheets.** `X,Y,X,Y,X,Y`: each Y binds its
  nearest-preceding X-designated column (`opj_curves.py`, `opju_curves*.py`).
  Never collapse to the book's first X or form a sorted X union.
- **Protect non-monotonic X.** Hysteresis loops need full-data X/Y extents,
  full-range line/marker path builders, original row order. Any curve-render
  change exercises a non-ascending fixture and checks interactive/export
  agreement.
- **Fail closed.** An explicitly referenced but undecoded X/Y is omitted and
  diagnosed; never coerced to time/default X or a similarly named book/column.
- **Evidence bar for a backend visual decode:** controlled specimen,
  independent Origin/COM/rendered oracle, plausible whole-corpus
  distribution, positive AND negative controls, and gallery review (at
  minimum Moke, PNR, RockingCurve). Synthetic tests lock proven behaviour;
  they cannot establish it. A COM plot list is a binding oracle, never a
  visibility oracle (it lists hidden plots: ledger F-044, R-25).
- Default to UI/rendering work. Treat backend contracts (byte layouts, column
  bindings, parser rules, axis semantics) as deliberate: do not reinterpret
  them without an explicit handoff and independent evidence.

## Owner decisions (ledger section 3)

- **A curve's recorded X wins** (2026-11-20, A2, B-01). When the curve record
  itself names the X (`curve.xRecorded`: the `.opju` token in
  `opju_figure_curves.py`; the `.opj` anchor offsets 35-38,
  `opj_curves._record_x`) and that X decoded, draw against it even where
  `lib/perSeriesX.ts`'s nearest-preceding rule picks another
  (`lib/originRecordedX.ts`, per-curve-X overlay). Evidence: Etna `origin.opju`
  Graph16, Catchment A-E Graph6 vs Origin's saved previews; hc2convert 89/89 equal the COM-verified
  `.opju` save.
- **An inferred X never wins** (B-02). A `.opj` X the reader only infers
  carries no `xRecorded` (Moke Graph8/9: inferred x=E mirrors the loop; the
  record names A). Nearest-preceding applies only when the file names no X.
- **A recorded X that did not import is never replaced** (B-03): the curve is
  left out with a diagnosis.
- **All recorded curves unresolved -> draw EMPTY with a note** (A3, B-04),
  never the book's every channel (the old fallback drew 11-33 phantom series
  on Moke Graph2 / hc2convert).
- Screen-only 1 device-px line floor (B-05); pale colours keep their hue
  (B-06); hidden-in-Origin plots are left out, not lost (B-11).

## Regress gate (`tools/origin_regress.py`, #785)

1. `uv run python tools/gate.py --origin [--origin-allow FILE]` fingerprints
   every local project (structure only, never values) on HEAD and on a fresh
   `origin/main` worktree, and fails on any unexplained difference (curves
   lost/gained, X binding, colour, hidden, omission reason, axis, books,
   figures). No corpus (CI) -> it skips.
2. Explain every change in `docs/origin_re/regress_allow/<lane>.json`:
   `{"<project or glob>": [{"kind": ..., "contains": ..., "reason": ...}]}`.
   A reason states the evidence, not "expected".
3. Subcommands `snapshot` / `diff` / `check`: `tools/origin_regress.py --help`.
   Snapshots are refused inside the repo.

## Corpus layout (local only, never committed)

Sibling of the checkout root: `<root>/test-data/origin/`.

- `public/`: third-party `.opj`/`.opju` corpus (`QZ_ORIGIN_PUBLIC_CORPUS`).
- the remaining projects under `origin/`: the owner corpus
  (`QZ_ORIGIN_OWNER_CORPUS`).
- `_exports/<stem>/`: graphs Origin exported itself via COM (`manifest.json`
  + PNGs), the best visual oracle.
- `ground_truth_public/`: COM oracle data; `_baselines/<sha>.json`: regress
  snapshots (`QZ_ORIGIN_BASELINE` overrides); `generated/` and synthetic sets
  are skipped.
- Tests find it through `tests/origin_corpus.py` (`conftest.TEST_DATA_CORPUS`,
  which walks up from worktrees); `realdata` tests skip without it.
- **Never** commit corpus bytes, values, or absolute/private paths; tests
  compute expectations at run time.

## Origin COM oracle runs: dispatch `Origin.Application`, never `ApplicationSI`

- `Origin.ApplicationSI` is single-instance: even via `DispatchEx` it attaches
  to the owner's open Origin (measured 2026-11-15), loads a corpus project
  into their window, and its `Exit()` closes it, unsaved work included
  (ledger R-18). PID-tracking kill logic cannot prevent this: no kill is
  involved.
- Oracle/specimen tools (`tools/origin_compare/`, `tools/origin_trial/`,
  `tools/plot_corpus/`) dispatch `Origin.Application` (own process). Run one
  instance at a time; kill only the exact PID the tool recorded (e.g.
  `run_axis_oracle.py` kills only the PID its own export recorded), never by
  image name (R-17). Guarded by `tests/test_plot_corpus_tools.py`.
- The live "Send to Origin" path (`io/origin_com.py`) keeps `ApplicationSI` on
  purpose (sending into the open session IS the feature), asks first, and
  never calls `Exit()`/`Quit()` (B-15).
- Oracle data: `test-data/origin/ground_truth_public/` (Origin 2026b Student
  loaded 400+ page `.opju` files fine).
