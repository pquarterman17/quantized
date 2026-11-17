# `tools/plot_corpus` — Origin plot-type corpus harness

Item 1 of `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md`. Plants known data, has the
locally installed Origin build every 2D plot type from it over COM, and saves
Origin's own answers as `oracle.json` for the import and from-scratch scorers
(plan items 2 and 3).

| File | Role |
|---|---|
| `families.py` | Seeded data families (pure numpy + quantized). Each asserts its own edge case. |
| `generate.py` | Writes `<out>/<family>/family.json` + `<family>.truth.json`. Same seed → same bytes. |
| `plot_types.py` | The 2D types and Origin's own menu recipe for each (`worksheet -p <code> <template>`, from Origin's `Plot.ogs`). |
| `styles.py` | Known per-curve styles; LabTalk designation codes derived from quantized's writer table. |
| `origin_session.py` | One owned `Origin.Application` instance: exact-PID kill, job object, deadline. |
| `origin_oracle.py` | Reads the built graph back from Origin (plot type, `%Z`, refs, axes, styles). |
| `qz_oracle.c` | Origin C `DataPlot::GetPlotType()`, the only plot-type readback found. |
| `origin_build.py` | Builds every (family × type) specimen: `.opju`, PNG, `oracle.json`, `manifest.json`. |
| `scratch_recipes.py` | Plan item 3: the clicks that build each type from scratch in quantized, or what is missing. |
| `scratch_data.py` | The graphed sheet as the CSV a user imports; channel map; the worksheet edits to replay. |
| `scratch_run.py` | Imports, runs the vitest recipe harness (`frontend/src/test/plotCorpus/`) against a live backend, renders each request, scores, writes the review page. |
| `scratch_score.py` / `scratch_review.py` | Score a built figure against `oracle.json`; the per-type table and side-by-side HTML. |
| `score_import.py` | Check 1 (plan item 2): imports every specimen through the import route's own composition and scores it; writes `scorecard.json` + `scorecard.md`. No Origin needed. |
| `import_compare.py` / `import_values.py` | Pure verdict logic: curves, axes, styles, plot type / values, column metadata, sheet pairing. Every item is match / wrong / phantom / omitted + reason. |
| `frontend_view.py` | Mirror of what the frontend draws for a figure; pinned to the real frontend by `tests/fixtures/plot_corpus/frontend_view_cases.json` (pytest + vitest). |
| `score_report.py` | Tallies, grouped wrong/phantom findings (listed first), markdown. |
| `roundtrip_run.py` | Plan item 9, step 1: re-runs check 2 and, for every match, posts the bodies the app's own Origin export commands build (`frontend/src/test/plotCorpus/originExports.ts`) to `/api/export/origin`, `/opj`, `/origin-project`; saves the COM body. |
| `roundtrip_origin.py` | Step 2 (COM lock): opens each export in an owned `Origin.Application` (`.ogs` run as shipped, then with its CSV path made absolute; `.opj` loaded; COM through the shipped `send_to_origin` with this session's app) and reads books + graphs back. |
| `score_roundtrip.py` / `roundtrip_compare.py` | Step 3: match / wrong / missing / phantom per (path x plot type x family) against the planted sheet and `oracle.json`; `scorecard.md` lists the wrong values first. |
| `scorecard.py` / `scorecard_page.py` | Plan item 4: merges both scorecards into one row per (type x family) with the owning plan item; writes `scorecard.md`, `scorecard.json` and the owner review page `index.html` (Origin PNG / import render / from-scratch PNG; the import column is empty, nothing rasterises the import). |

```bash
uv run python tools/plot_corpus/generate.py --out <gen>
# under the shared COM lock (see CLAUDE.md "Origin COM oracle runs"):
uv run --with pywin32 python tools/plot_corpus/origin_build.py --corpus <gen> --out <corpus>
# check 1, no Origin needed:
uv run python tools/plot_corpus/score_import.py --corpus <corpus> --generated <gen> --out <dir>
# check 2, no Origin needed:
uv run python tools/plot_corpus/scratch_run.py --corpus <corpus> --gen <gen> --out <review>
# round trip quantized -> Origin (item 9); step 2 under the shared COM lock:
uv run python tools/plot_corpus/roundtrip_run.py --corpus <corpus> --gen <gen> --out <rt>
uv run --with pywin32 python tools/plot_corpus/roundtrip_origin.py --dir <rt>
uv run python tools/plot_corpus/score_roundtrip.py --dir <rt> --corpus <corpus> --gen <gen>
```

Output stays out of the repo. The built corpus is committed to the private
`test-data` repo at `origin/generated/` (specimens as `<type>/<family>/`, the
generator output as `_families/<family>/`; see its README). Check 1 against it:

```bash
uv run python tools/plot_corpus/score_import.py --corpus ../test-data/origin/generated   --generated ../test-data/origin/generated/_families --out <dir>
```

`tests/test_plot_corpus_import_floor.py` (realdata) ratchets that score against
`tests/fixtures/plot_corpus/import_floor.json`.

## Findings the code relies on (Origin 2026b Student, 2026-11-15)

- `plotxy plot:=N` reports success for any N, including 999. LabTalk has no
  plot-type property: every `layer.plotN.*` and `get %C -<a..z>` value was
  identical across line, column, box and histogram. The COM `DataPlot`
  object has no type property either. Origin C `DataPlot::GetPlotType()` is
  the readback that works.
- `run.LoadOC` returned 3 for a forward-slash path to an LF-only file and 0
  for a backslash path to a CRLF file. `OriginSession.load_oc` does the
  latter.
- `plotxy plot:=231` on a sheet with no error columns killed Origin. Codes
  231 and 233 are the Y- and X-error-bar plots.
- The plot type is one byte. Codes 256 and above read back mod 256, except
  the template-level ids (263, 265-271, 343-349), which map onto base types.
- `layer.plotN.line.connect`: 1 none, 2 straight, 3/4 2-/3-point segment,
  7 step horizontal, 8 step vertical, 9/10 centred steps. `set %C -l` uses a
  different numbering.
- `layer.x.type`: 1 linear (default), 2 log10.
- Export round trip (item 9, 2026-11-16): `plotxy iy:=(1,2):(1,3)` FAILS (no
  graph); `iy:=((1,2),(1,3))` and `(1,2:3)` work, a triple `(1,2,3)` adds a
  231 error-bar plot. A relative `impASC fname:="x.csv"` resolves against
  neither `cd` nor the script's folder. `run.file` needs a backslash path. A
  script file without a BOM is read as ANSI. `impASC` titles the book after
  the CSV. `range r = [Book]1!col(n); r.type = 3;` sets a designation where
  `win -a` cannot find a book `newbook ... option:=lsname` named by its long
  name.
