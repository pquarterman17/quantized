# Code bug-hunt (lane `bughunt-code`, 2026-11-25)

Scope: PRs #993-#1023 (everything merged since 2026-11-24). Method: read the
diffs adversarially, then confirm each suspicion with a failing test or a
numeric script against an external oracle. Only confirmed bugs are listed as
bugs; unconfirmed suspicions are separated below and marked as such.

Counts: **P0: 0, P1: 2, P2: 1** (all three fixed, each with a regression test
that failed before the fix).

## Confirmed and fixed

### BH-01 (P1) Find in folder: one malformed file aborts the whole scan

- `src/quantized/io/workspace_search.py` `workspace_text` (editableFigures
  branch, `(rec.get("plot") or {}).get("view")`) and `scan_folder`'s except
  clauses (only `OSError`, `ValueError`, `MemoryError`).
- Evidence: a `.dwk` with `"editableFigures": [{"name": "a", "plot": "oops"}]`
  raised `AttributeError: 'str' object has no attribute 'get'` out of
  `scan_folder`, i.e. HTTP 500 from `POST /api/project-search/folder` and no
  result for any other file. The module promises "every file that cannot be
  searched is listed in `skipped`".
- Fix: a wrongly typed field now costs only that file, which is listed under
  `skipped` ("malformed workspace (unexpected field types)").
- Test: `tests/test_bughunt_code.py::test_folder_scan_skips_a_malformed_file_instead_of_aborting`.

### BH-02 (P1) Animation export: pixel limits only measured frame 1

- `src/quantized/routes/export_figure_animation.py` `_export_animation`.
- Evidence: `check_frame_pixels` ran only for `index == 0`. For `format="zip"`
  (which never reaches `_open_frames`' mixed-size check) frames 2..N could be any
  size, so neither `MAX_FRAME_PIXELS` nor `MAX_TOTAL_PIXELS` bounded the output.
  Reproduced: frame 1 at 60 dpi, frame 2 at 120 dpi, `MAX_FRAME_PIXELS` lowered
  to 200 000: HTTP 200 before the fix, 422 "megapixels" after.
- Fix: every rendered frame is measured; the running total is checked against
  `MAX_TOTAL_PIXELS`.
- Test: `tests/test_bughunt_code.py::test_animation_zip_checks_every_frame_pixel_area`.

### BH-03 (P2) Row states: a stale row style is re-aligned into a valid-looking one

- `frontend/src/lib/rowStyle.ts` `sliceRowStyle`; callers in
  `store/sortRows.ts` and `store/cellEditRun.ts` (insert, delete).
- Evidence: `lib/rowStyle.ts` promises a wrong-length array is stale and ignored
  ("never a colour on the wrong measurement"), but `sliceRowStyle` remapped
  whatever array was stored. A remap always emits `n` entries, so a stale array
  (6 colours on a 4-row sheet, e.g. after a correction trimmed rows) became a
  length-4 array that `usableRowStyle` accepted, with colours on the wrong rows.
  Reproduced for sort, insert and delete.
- Fix: callers pass the pre-operation row count; an array of another length is
  dropped, not remapped (optional 4th parameter, existing calls unchanged).
- Test: `frontend/src/store/rowStyleStale.test.ts` (2 tests, failed before).

## Checked against an external oracle, no defect found

Numeric scripts (scratchpad `bh_1.py` .. `bh_4.py`) and code review:

- ACF / PACF vs `statsmodels.tsa.stattools` (max abs diff 1e-14); KPSS statistic,
  lags and p vs `statsmodels.kpss` (1e-15); Ljung-Box and Bartlett band formulas.
- `adjust_pvalues` bh / by / holm / bonferroni vs `statsmodels.multipletests`
  (1e-16).
- Magnetic uncertainty: `ols_intercept_gradients` vs central finite differences
  (5e-10) and `trapezoid_weights` vs `np.trapezoid(np.interp)` (2e-15); the
  Arrott and entropy propagation formulas re-derived by hand.
- PELT change points vs a brute-force dynamic program, 300 random series,
  min_size 2-5, mean / var / meanvar costs: identical objective every time.
- Reviewed and found consistent: Dunn-Sidak, Mood's median, exact Poisson (R
  `poisson.test` convention), Wilks tolerance limits, LS-means Tukey-Kramer,
  PLS (NIPALS, VIP, CV), LDA, Turnbull, interval-censored MLE, EWMA / CUSUM,
  Nelson rules 5-8, D-optimal exchange, DOE blocking, IIR design / zero-phase
  padlen, 2-D FFT axes and filter, phase matching, time-series route
  validation, Time series result freshness (key covers tab, fingerprint,
  channel, options), `localStorage` use in `toolDock` (try/catch).

## Plausible but NOT confirmed (no failing test written)

- `stats_lm_leverage._project_out`: QR of a rank-deficient `others` matrix keeps
  arbitrary orthonormal directions for the dependent columns, so a leverage x
  could be projected too far. Needs a model whose design is rank deficient; not
  shown to be reachable.
- `calc/substrates.get_substrate` / `substrate_table` return the cached dicts
  (now with a nested mutable `material` dict): a caller that mutates a row
  corrupts the process-wide table. Shown by hand-mutation only; no caller found.
- `routes/export_figure_animation`: the per-frame size check still runs after
  frame 1 is rendered, so a very large first frame is rendered before refusal
  (bounded by the DPI clamp 1200 and the request's page size).
- `io/workspace_search`: `text.lower().find()` can shift the snippet window for
  characters whose lower-case form has another length; the timeout is only
  checked between files, so one huge JSON parse is not interruptible.
- `stats_lda` cross-validation with a class of exactly 2 rows and `folds=2`
  ends in "need more observations than classes" (misleading, fail closed).
- `ts_changepoint` PELT with a near-zero penalty is O(n^2) up to the 50 000
  point cap (slow, not wrong).
