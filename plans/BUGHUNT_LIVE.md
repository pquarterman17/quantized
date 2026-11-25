# Live bug hunt (lane `bughunt-live`, 2026-11-25)

Method: `qz --no-browser` (temp `QZ_CONFIG_DIR`) driven by Playwright/Chromium at
1440 and 1024 px, dark and light. Console errors/warnings, 4xx/5xx responses and
the server log were watched throughout. Journeys: import (CSV, `.xrdml`, Rigaku
`.raw`, QD `.dat`, malformed, truncated and corrupted copies of each), plotting
(multi series, log axes, axis limits, zoom, undo/redo, resize), worksheet
(formula columns, cell edit, sort, rename/duplicate/delete), curve fit, peaks,
baseline, Distribution / Multivariate / Time series / Fit model / DOE, result
save and reopen, `.dwk` save and reload, PDF/SVG/PNG export, keyboard-only menu
and tab traversal, Preferences at 1024, and a random-click "monkey". Besides the
UI: every POST route that takes plain JSON (about 330) was fuzzed with empty,
single-point, all-NaN, constant, huge and two-point inputs, and every file in
`quantum-design`, `panalytical`, `rigaku` and a dozen other test-data folders
was uploaded: no 5xx from any parser.

Screenshots: `/tmp/claude-0/-home-user-quantized/26fdd960-ce78-5d7d-b7e8-e38c841ca77c/scratchpad/bughunt-live/`
(`SHOTS` below). Severity: P0 data loss / crash / wrong number, P1 broken or
confusing, P2 polish.

Counts: P0 0, P1 4 (all fixed), P2 10 open (one unreproduced).

## Fixed (each has a regression test)

### F1 (P1) A column of only `NaN` words fails the whole import with an internal message
- Repro: drop `x,y\n1,NaN\n2,NaN\n` (or `x,y,z` with `y=NaN`, `z` empty). Toast: "the file couldn't be parsed".
- API detail: `cat_levels[0] must be a non-empty tuple of str, got ()` (DataStruct invariant text leaking to the user).
- Expected: "no valid data columns in t.csv" (or the other columns import). Actual: the invariant message; only an all-blank column had been guarded (D6).
- Root cause: the text-candidate tests used `any(cells)`, which counts "NaN" as filled, but `encode_categorical` reads NaN words as missing, so the column had zero levels. `src/quantized/io/delimited.py` (f2 candidate loop and the promoted-time branch) now test `ck.levels_only(cells)`.
- Test: `tests/test_io_delimited_text_columns.py` (two refusal cases, one that a real text column beside an all-NaN one still imports).
- Shot: `04-nan_cols.png`.

### F2 (P1) Descriptive statistics 422 "math range error" for data near 1e308
- Repro: import `x,y\n1,1e300\n2,-1e308\n3,1e-300\n4,5`. Console: `422 POST /api/stats/descriptive`; the Channel statistics card and Distribution tool get nothing.
- Root cause: `math.frexp(peak)[1]` is 1024 for a peak >= 2**1023; `math.ldexp(1.0, 1024)` overflows. `src/quantized/calc/stats.py:82` caps the exponent at 1023 (|z| < 2 there; every smaller peak unchanged, results bit-identical).
- Test: `tests/test_calc_descriptive_scaling.py::test_values_at_the_top_of_the_float_range_do_not_overflow_the_scale` (calc and route).
- Shot: `04-huge.png`.

### F3 (P1) An isolated point is never drawn, on screen or in the export
- Repro: import `x,y\n1,2` (one row) and look at the plot; export PDF/SVG/PNG. Same for `y = 2, inf, -inf, 4` (both finite points are bracketed by non-finite rows) and any lone reading between gaps.
- Expected: the point is visible. Actual: an empty frame (axes and legend entry only), exported as an empty figure too.
- Root cause: a line joins two points and the default Line trace has no markers, so nothing paints a point with no finite neighbour. Screen: `frontend/src/lib/uplotSeries.ts` now gives a markerless series a uPlot `points.filter` (`isolatedPoints`) that marks only those rows (show stays false; defaults unchanged). Export: `calc/figure_bars.mark_isolated`, called from `draw_series`, `figure_marks._plain` and the styled branch of `_draw_marked` (the one the browser takes), adds legend-less dots.
- Tests: `frontend/src/lib/uplotSeries.lonePoint.test.ts`, `tests/test_calc_figure_isolated_points.py` (ink comparison through `render_figure`, plain and styled).
- Shots: `04-single.png` (before; after the fix the dot is drawn), `dl/single.csv.png`, `dl/inf.csv.png` (exports before the fix).

### F4 (P1) `/api/timeseries/stationarity` 500 for huge values
- Repro: `{"y": [1e308, -1e308, ...]}` (found by the route fuzz). First differences overflow to inf and statsmodels raises `MissingDataError` (not in `CALC_ERRORS`), so an unhandled 500.
- Fix: `calc/ts_stationarity.adf_test` refuses with `ValueError("values are too large: their first differences overflow")` (422) when finite data has a non-finite difference.
- Test: `tests/test_api_timeseries.py::test_stationarity_refuses_values_whose_differences_overflow`.

## Open (documented, not fixed)

### O1 (P2) Axes with a range near 1e308 draw no tick labels
Repro: import `huge.csv` above (ticks absent, y title only), or set Y minimum to `-1e308` in Axes. Expected: some ticks or a clear "range too large" note. Suspect: uPlot tick generation on an inf-span; `uplotOpts` axis values. Shots `04-huge.png`, `29-Yaxisminimum-1e308.png`. Extreme input, low priority.

### O2 (P2) A file dropped while an import is running is discarded
Repro: drop a 200k-row CSV, then within about 600 ms drop another. The toast "an import is already running — cancel it first" shows (`store/importDatasets.ts` `runImport` guard, intentional since P3.4), but the second file is lost and must be dropped again. A small queue would be a design change. Shot `14-drop-while-busy.png`.

### O3 (P2) Pareto chart defaults Category to the first continuous column
Plot > Charts > Pareto chart on a two-column numeric file picks Category = y (600 distinct values) and Value = x, which the server refuses ("600 categories exceed the Pareto limit of 30") with a 422 in the console on first open. Suggest defaulting to a text/low-cardinality column and not requesting until valid. Shot `08-pareto.png`.

### O4 (P2) Design of experiments plots every generated column
"Generate worksheet" (2^3) auto-plots all nine columns, StdOrder and PointType included, as a tangle of lines; only the factors/response are meaningful. Shot `10-Designofexperiments-run.png`.

### O5 (P2) Analyze menu shows "Curve fit..." twice after first use
A recent-tools entry is pinned at the top with the same label and shortcut as the permanent item (two `role=menuitem` buttons with identical names; also breaks name-based automation). Shot `24-analyze-menu2.png`.

### O6 (P2) A formula column that evaluates to nothing is added silently
Worksheet formula `log(-1)`, `sqrt(-4)` or `A/0` adds a column of "—" with no warning (an unknown name or syntax error does report). Shot `11-ws-formula2.png`.

### O7 (P2) Refused cell edit leaves a green status dot
Typing `abc` into a numeric cell is refused with `"abc" is not a number — the cell was not changed` but the status dot stays green (success colour). Shot `12-ws-edit.png`.

### O8 (P2) Axis-limit "Enter a number" sticks
After an invalid limit (`abc`, `1e999`) the red "Enter a number" under the Limits row stays while later valid edits to the other axis are accepted. Shot `29-Yaxisminimum-1e308.png`.

### O9 (P2) An all-`NaN` column beside numeric ones is read as text
`x,y,z` with `z=NaN` throughout: `z` is kept as a text column ("kept as text, not plotted", levels "NaN") rather than an all-missing numeric channel. Consistent with the numeric-column rule (`_column_kind.numeric_column`), but surprising; owner call. `io/delimited.py` text-column sidecar loop.

### O10 (P2, not reproduced) `pageerror: object null is not iterable`
Seen once in a random-click run (seed 1, step 159; repeated on later clicks) shortly after Macro recorder > Record and "Live fit / quick analysis" were toggled. Six further monkey runs (about 1,700 random actions at 1440 and 1024 px) and two targeted replays (recording + formula column + sort; live fit + drag) gave no error, so it is timing-dependent. Stack was not captured on the first sighting (the harness now logs it). Look for a `for (... of x)` over a null in the macro-recorder / live-fit store code if it recurs.

## Checked and fine
Fit results (ExpDec1 recovered A=3.000, tau=5.06, C=1.992 on a noisy A=3, tau=5, C=2 curve); Find peaks (two peaks at 19.9 and 39.8 on a 20/40 synthetic); ACF/PACF; `.dwk` round trip (datasets, log axes, view) in a fresh browser; PDF/SVG/PNG export of unicode names, huge and Inf data; closing Curve fit mid-run and refitting; `Ctrl+Z`/`Ctrl+Shift+Z` chains; cell edit then undo/redo; delete confirmation; menu keyboard navigation (arrows, Home/End, Escape returns to the opener, roving tab stop); Preferences at 1024x700 fits the viewport; resize 480 to 1440 mid-plot; light theme. Parsers never 5xx on any test-data file, nor on truncated or byte-corrupted xrdml/raw/dat.
