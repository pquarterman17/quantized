# Headless automation: saved projects, recipes and scripts

Quantized's answer to Origin's originpro / LabTalk automation: everything you
saved in the app can be read and re-run from a script or the command line, with
no app and no server.

## Re-run a saved recipe on new files: `qz run`

Save the pipeline as a template (Pipeline panel ▸ Templates ▸ Export, or the
Recipe Library) and run it on any number of files:

```bash
qz run "Peak fit.json" scans/*.csv --out results/
qz run recipe.json run1.dat run2.dat --out out/ --format xlsx --figures pdf
qz run subtract.json sample.csv --background empty_cell.csv --out out/
```

| Option | What it does |
| --- | --- |
| `--out DIR` | Output folder (created). Required. |
| `--format csv\|xlsx\|dwk` | The processed data: one `<input> - <recipe>.csv` / `.xlsx` per input, or ONE `<recipe>.dwk` project with every processed dataset (and the summary sheet) to open in the app. Default `csv`. |
| `--figures pdf\|svg\|png` | Also write one figure per input (X against every channel), rendered by the server's own exporter. |
| `--background FILE` | The background a background-subtraction step subtracts, read as loaded. Give it once per such step, in step order. |
| `--overwrite` | Replace outputs that already exist. Inputs are never written. Every output is checked before any input is read; one that would be refused stops the run with nothing written. Files an earlier run of the recipe wrote into `--out` are never taken as inputs. |

When the template declares outputs (the fit parameters a template batch puts in
its summary sheet), `qz run` writes `<recipe> summary.csv`: one row per input,
the LAST fit's parameters and R2, blank for an input that failed. Every run
writes `run-report.json` with each input's status, step log and warnings.

Exit status: 0 when every input ran, 1 when any input failed (the others still
run and are written), 2 for a usage error or a refused recipe.

### What replays, and what is refused

The runner (`quantized/recipe_run.py`) replays a template's steps with the same
`quantized.api` calls the exported Python script makes, so `qz run`, the
script and the app give the same numbers (`tests/test_pipeline_round_trip.py`
pins all three on one pipeline):

| Step | Replayed as |
| --- | --- |
| import | the input file |
| correction | `apply_corrections` on the uncorrected base, formula columns recomputed after; a background subtraction needs `--background` |
| reset | back to the base |
| expression | a formula column, for the element-wise formula subset (below) |
| fit | `fit_model` on the recorded channels, X window, starts, bounds and held parameters |
| transform | resample onto n points / a step / a range; median, despike, LOWESS, (de)convolution, Hilbert, inverse FFT, Reduce XY |
| ui | not replayed (the app's batch skips it too); one that can change data is reported as a warning |

It FAILS CLOSED: a recipe with any step it cannot replay exactly is refused
before a file is read, every such step named. That covers formulas outside the
subset, derived columns with units or error propagation, weighted fits, Curve
Fit template steps, fits on an explicit row selection, and transforms with a
second input (join, merge, dataset math, a resample onto another dataset) or
none in the API yet (stack, unstack, transpose, split, signal recipes, SIMS).
A step that fails on one input fails that input, never the batch.

Not recorded by the app, so not replayed: rows excluded or filtered in the app
(every row is used) and error-column roles changed by hand. The roles the app
seeds on import -- Origin designations, a parser's declaration, then the label
guess (`M` / `M_err`) -- ARE applied (`qz.seed_error_roles`), so a correction
offsets the values but not their bound error column, as in the app.

### The formula subset

`x`, the column letters `A`, `B`, … `AA`, numbers, `+ - * / // % ^ **`,
parentheses, `pi`, `e`, `nan` and the functions `sin cos tan asin acos atan
arcsin arccos arctan atan2 sinh cosh tanh exp log ln log10 log2 sqrt abs sign
floor ceil hypot min max pow` (with `np.` / `numpy.` / `math.` prefixes). It
evaluates exactly as the app does, JavaScript arithmetic included (`1/0` is
inf, `%` keeps the dividend's sign). Comparisons, conditionals, `A[i]`,
`col("Name")` and long column names, `sheet()`, `fit()`, and the row-aware and
aggregate functions (`row()`, `lag`, `diff`, `cumsum`, `mean(A)`, `min(A)`, the grouped `col_mean(A, By)` family …)
are evaluated only in the app.

## Read a saved project from Python

```python
import quantized.api as qz

ws = qz.read_workspace("run42.dwk")
for d in ws.datasets:
    print(d.name, d.folder_path, d.data.n_points, d.source_path)
sweep = ws.dataset("sweep.dat").data          # a DataStruct, as the app shows it
```

Each dataset carries `data` (corrected, computed columns included), `raw` (the
uncorrected base), `formulas`, `corrections`, `folder_path`, `source_path`,
`notes` and `tags`, and `sampled` (True when the rows were saved as a preview
sample, before the file was read in full); the workspace carries the active dataset, the recorded
`pipeline` and `warnings`. A project saved by a NEWER Quantized is refused with
`WorkspaceVersionError`, naming both versions, rather than half-read.
`QuantizedClient.read_workspace(path)` is the same call on the client (it
reads the file; no request).

## The data operations, from code

`quantized.api` exposes the app's own data operations, each taking a
DataStruct first and its options by keyword (`channels=` picks columns;
categorical columns are never transformed): `smooth`, `derivative`,
`log_derivative`, `cumulative_integral`, `normalize`, `resample` (the app's
Resample transform; `.data` plus `.warnings`), `run_signal_op` and the filters
`median_filter`, `despike`, `lowess`, `hilbert_envelope`, Reduce XY
(`bin_average`, `average_duplicates`, `keep_every_nth`), `dataset_algebra`,
`average_curves`, the formula columns `evaluate_formula` / `add_formula_columns`,
and `seed_error_roles`. The maths is the app's own (smoothing, derivative,
normalize and resample are golden-tested against MATLAB).

## Export a recorded pipeline as a script

See [pipeline-studio-replay.md](pipeline-studio-replay.md#exported-python-script).
