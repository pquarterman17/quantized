# Origin analysis oracle

Freezes OriginPro's own answers for analysis functions as test fixtures, so a
quantized lane can code against Origin's numbers instead of a guess. Windows
only, local Origin only; CI never runs it (CI runs the non-COM unit tests).

## Run

```bash
uv run python tools/origin_oracle/run.py --list                       # no Origin
uv run --with pywin32 python tools/origin_oracle/run.py --case intersect
uv run --with pywin32 python tools/origin_oracle/run.py --all
```

pywin32 is not in the dev venv, hence `--with pywin32`. `--out <dir>`
overrides the corpus root (default: the `test-data` sibling, or
`$QZ_TEST_DATA`). Exit code is 1 when any case failed or timed out.

Each case writes `<test-data>/origin/analysis_oracle/<case-id>/`:

| File | Content | Deterministic? |
|---|---|---|
| `input.csv` | the seeded input (header = column names, `repr` floats) | byte for byte |
| `truth.json` | seed, column designations, planted parameters | byte for byte |
| `oracle.json` | status, Origin version (`@V`), date, the exact LabTalk sent, scalar `values`, every worksheet Origin created (`books`), every matrix (`matrices`: `x`, `y`, `z[row][col]`, rows along Y) | no (date) |

`status` is `ok` only when every step's `Execute` returned True and every
read worked; otherwise `failed`, `timeout` or `not_exercised` (with the calls
tried). A failure is never an empty success. Nothing is written into the
quantized repo; the owner decides what to commit in `test-data`.

## Safety (read before touching Origin)

- Only `Origin.Application` is dispatched, through `tools/plot_corpus/origin_session.py`.
  Never `Origin.ApplicationSI`: it attaches to the owner's open Origin and
  its `Exit()` closes their unsaved work. Do not write a second session manager.
- Before every run: `tasklist //FI "IMAGENAME eq Origin*"`. If an Origin is
  running that you did not start, it is the owner's: stop, never close it.
  `OriginSession` refuses to start beside one. After every run, confirm none is left.
- Every case runs under a 60 s deadline. A hang kills only the owned PID; the
  case is recorded `timeout` and the run continues on a new instance.
- Never call `plottreemapm` (crashes the instance).

## Add a case

1. Add (or reuse) a seeded generator in `oracle_inputs.py`. It takes a
   `numpy.random.Generator` and returns `InputSpec(columns, truth)`. Import
   shapes from `quantized.calc` (e.g. `peakshapes.gaussian`); never retype one.
2. Append a `Case` to `oracle_cases.py`: id, description, unique seed, generator,
   `steps` (one `Execute` each; `{book}` is the input book's short name) and
   `reads` (scalar LabTalk variables; `Read("name")` numeric, `Read("name", "str")` string).
3. Find the signature in `C:\Program Files\OriginLab\Origin2026b\X-Functions\**\<name>.OXF`
   (lowercase `<name>`, `<io>` 0 = input / 1 = output, `<type>`, in order).
4. Run `--case <id>`, read `oracle.json`, then add a test in
   `tests/test_origin_oracle_fixtures.py` asserting the property the fixture
   exists for. The unit tests in `tests/test_origin_oracle_tools.py` cover
   the registry automatically.

If it will not run after about ten attempts, set `not_exercised=("call tried: reason", ...)`;
never guess a result.

## Known traps

- `Execute()` returning False is the only failure signal; `xf_get_last_error_code()` stays 0.
- X-Functions whose OXF says `<LabTalk>0</LabTalk>` (e.g. `FitLRXErr`) are
  menu-only: every `Execute` form returns False. `fitlrxerr` therefore calls
  the engine the menu command uses, `ocmath_linear_fit_xyerror_york2003`
  (see `FitLinear.cpp`), through `qz_york.c`. It matches `scipy.odr` with
  sigma weights to about 1e-6 (slope, intercept and chi-square), so the error columns are sigmas.
- `nlend` needs `output:=1` to create the `FitNL*` report sheets; without it
  nothing but the fit variables is produced. Fit results land as new sheets in
  the input book.
- Output vectors (`pkFind ocenter_x:=<new>`, `levelcrossing` crossings) can land
  as new columns of the input sheet; the runner strips the input columns and
  keeps the rest.
- `intersect` and `levelcrossing` interpolate linearly, so crossings differ
  from the analytic root by up to about the local grid step squared; tests use tolerances, not equality.
- Origin C is loaded with CRLF files and a backslash path (`OriginSession.load_oc`).
- Use a fresh small book per case; extra `<new>` sheets break later selections.
- Collect counts, not just the pass line: the fixture tests skip silently
  without `../test-data`.
- Matrix output (`xyz_*`, `w2m`) is captured in `matrices` by `oracle_matrix.py`;
  X and Y come from Origin's own `m2w method:=xyz`. `xyz_regular ... om:=[Name]<new>`
  names the matrix so a later step (`integ2 im:=[Name]1!`) can refer to it.
- `smooth method:=bm` ignores `npts`: the window is `2 * order + 1`, applied as
  `order` passes of [1 2 1]/4 with the edge repeated on each pass.
- `envelope ... method:=spline` returns False; omit `method`. `type:=both`
  makes two X/Y pairs (upper, lower).
- `interp1` columns come out all named `y`: read them by creation order.
- `decimate filter:=fir order:=64` (and higher) returns False. The FIR output
  on a 300 Hz + 5 Hz test signal keeps the alias (see `test_origin_oracle_compare_signal.py`).
- A real hang for exercising the deadline: `double i=0; for (i=0; i<1e12; i=i+1) { }`
  (`while`, `sleep` and `loop` all fail at once instead of hanging). Verified
  2026-11-26: the 60 s deadline killed only the owned PID, the case was
  recorded `timeout`, the next case ran on a new instance, none was left.
- Wave 6 (`oracle_cases_cluster.py`, inputs in `oracle_inputs_cluster.py`): a `Case` may
  carry `conventions` (from `oracle_conventions.py`), written into `truth.json`: what a
  quantized implementation must use to match. Report sheets (kmeans, hcluster) repeat long
  names, so read them by position.
- `PSS_tTest1/2/Pair` and `PSS_ANOVA1` are menu-only like `FitLRXErr`: `qz_pss.c` calls the
  `ocmath_*` engines their OXF bodies call. The proportion tests have no `ocmath_*` engine
  (a report helper class); an Origin C wrapper did not compile, so `pss_proportion` is
  `not_exercised`. `kmeans iter:=1` returns False; `wtdenoise level` is capped at 6 for 256
  samples with db4; a kmeans `iinitial` range must be restricted to the filled rows.
- Wave 7 (`oracle_cases_fit.py`, `oracle_inputs_fit.py`, planted parameters in
  `oracle_fit_planted.py`): one `nlbegin`/`nlfit`/`nlend output:=1` case per built-in function #1096
  ported (140). `nltree:=tt` exposes the start values as `tt.<param>` (set them before `nlfit` to
  restart); copy them into variables declared BEFORE `nlbegin`, since variables created after it do
  not survive `nlend`. The report's "Value" / "Standard Error" columns hold the parameters first
  (derived values follow); the statistics column is points, dof, reduced chi-square, RSS, R-square,
  adjusted R-square, status. A function whose definition has no `[Parameters Initialization]`
  section (20 of the 140) makes `nlbegin` return False however it is called, so it is
  `not_exercised`. `Fit Status` "Succeeded(100)" can still be a diverged fit (BET, b = -4e152):
  judge a fit by RSS against `dof * sigma^2`, not by the status.
- Under machine load the first case of a run can take minutes before Origin appears; allow
  generous `timeout` on batches of about 8 cases.
