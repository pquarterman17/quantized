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
| `oracle.json` | status, Origin version (`@V`), date, the exact LabTalk sent, scalar `values`, every worksheet Origin created (`books`) | no (date) |

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
