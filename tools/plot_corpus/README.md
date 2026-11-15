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

```bash
uv run python tools/plot_corpus/generate.py --out <gen>
# under the shared COM lock (see CLAUDE.md "Origin COM oracle runs"):
uv run --with pywin32 python tools/plot_corpus/origin_build.py --corpus <gen> --out <corpus>
```

Output stays out of the repo. Specimens join the private `test-data` corpus
only through plan item 8.

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
