# Origin Plot-Type Parity Plan

Every 2D plot type a researcher makes in Origin must (1) be buildable from
scratch in quantized and (2) import from an Origin-made `.opju` to the same
figure. The evidence comes from a generated corpus. A seeded data generator
plants known data, and the locally installed Origin 2026b Student builds each
plot type from it over COM. Origin's own answers are saved as the oracle: the
plotted datasets, the plot type, axis ranges, styles and a PNG. quantized is
then scored against those answers on both paths. Passing examples join the
private `test-data` corpus.

**Parent:** MAIN_PLAN.md
**Status:** Active
**Created:** 2026-11-15
**Updated:** 2026-11-15

---

## Context

### How the pieces fit together

- **Creation side.** Gallery `frontend/src/lib/plotTypes.ts` (line, scatter,
  line+symbol, area, column, stacked column, box, violin, histogram,
  contour/heatmap, double-Y, polar, waterfall, stacked panels, ternary). Stat
  modes are in `lib/plotviewSanitize.ts`, which also has strip. Marks are in
  `lib/plotspec.ts`, which also has step. Multi-panel is in
  `lib/composition.ts`, insets in `components/Stage/InsetPlot.tsx`, and
  quiver/streamline in `workshops/fieldplot`.
- **Import side.** `.opj` plot type byte 76 is in
  `io/origin_project/opj_curves.py`; `_PLOT_TYPES` covers 203 column, 215 bar
  and 219 histogram. `.opju` reads the `8f 01 <type> 83` style tag;
  `opju_sheet_signals.py` draws only types 200-203. The frontend routes
  histograms in `lib/originFigureSelection.ts`.
- **Gaps known at creation:**
  - column and bar are decoded but never reach the bar renderer;
  - `.opju` sets no `plotType`;
  - box, violin, polar, contour, ternary and waterfall Origin graphs have no
    mapping;
  - there is no horizontal bar;
  - step and strip have no gallery tile.
- **Oracle.** `Origin.Application` over COM only, never `ApplicationSI`; see
  CLAUDE.md "Origin COM oracle runs". Student saves `.opju` but not `.opj`
  (measured 2026-11-15: `Save("x.opj")` writes `.opju`), so Origin-made
  specimens are `.opju` only. Export with
  `expGraph type:=png path:=... filename:=...` works.

### Data / control flow

```
tools/plot_corpus/generate.py   seeded data families + .truth.json
        │
        ▼
tools/plot_corpus/origin_build.py  (COM) book per family → graph per plot type
        │                            → save .opju + oracle.json (%Z datasets,
        │                              plot type, axis from/to/type, styles) + PNG
        ├──────────────► check 1: quantized import → score vs oracle.json
        └──────────────► check 2: quantized recipe (same data, same type)
                                  → score vs oracle.json + PNG side by side
passing specimens → test-data/origin/generated/<type>/<family>/
```

### Plot-type codes seen in the 2026-11-15 visual probe

Measured with `plotxy plot:=N` on 4 columns. `plotxy` reports success for ANY
code, so the PNG is the only proof.

| Code | Plot type |
|---|---|
| 200 | line |
| 201 | scatter |
| 202 | line+symbol |
| 203 | grouped column |
| 204 | area |
| 205 | high-low bars |
| 206 | box |
| 207 | floating column |
| 213 | stacked column |
| 214 | stacked area |
| 215 | horizontal bar |
| 216 | stacked bar |
| 219 | histogram |
| 120 / 123 | bubble |
| 122 | doughnut |
| 225 | 3D pie |
| 114 / 218 | vector |
| 108 | drop lines |
| 210 / 212 | 3D (out of scope) |

Codes that need XYZ, matrix or template input were blank: contour, heatmap,
ternary, polar, waterfall and violin. Codes 231+ were not reached.

### Dependency map

- Item 1 is first: the harness everything else uses.
- Items 2 and 3 need item 1. Items 2 and 3 are independent of each other.
- Item 4 needs 2 and 3.
- Items 5-8 are per plot-type family and parallelizable. Each one runs its
  import fixes (this session, COM) and books its creation gaps (cloud).
- Item 9 (round trip quantized → Origin) is a later batch and reuses item 1.

### Resolved decisions (owner, 2026-11-15)

- **Scope.** All 2D plot types in the first batch. 3D is out of scope.
- **Missing creation types.** A type that cannot be built from scratch in
  quantized (e.g. horizontal bar) is booked as a plan item for the cloud
  sessions. This local session does generation, COM checks and import
  fixes.
- **Comparison.** Automated field checks (data, plot type, axes, styles),
  plus Origin's PNG beside quantized's render for owner review. No pixel
  diff.
- **Round trip.** quantized → Origin export checked by Origin comes in a
  later batch.
- **Defaults.** Synthetic data only, licence-clean; large cases are kept
  small enough to keep `test-data` cheap to clone.

### Owner gates

- None open.

---

## Tier 1 — High Impact

1. **Plot-corpus harness** — the generator, the Origin builder and the oracle
   record
   - [ ] `tools/plot_corpus/generate.py`: seeded data families, each with a
         `.truth.json`. Families:
         - clean, noisy, gaps (NaN), masked rows;
         - descending X, non-monotonic X (loop), multi-X `X,Y,X,Y`;
         - log-range, negative, huge/tiny magnitudes;
         - text categories, dates;
         - 100k points, single point, duplicates;
         - Unicode names and units, error columns;
         - many sheets, a deleted sheet;
         - XYZ / matrix for contour, heatmap and ternary.
   - [ ] `tools/plot_corpus/origin_build.py` (COM): build each (family ×
         type), set known styles, save `.opju`, export PNG, and write
         `oracle.json`:
         - `%Z` datasets per layer;
         - plot type read back, not as requested;
         - axis from/to/type;
         - colour, symbol and line style per curve.
         Per-file timeout; exact-PID cleanup.
   - [ ] Probe the plot-type ids not yet identified (contour, heatmap,
         ternary, polar, waterfall, violin, step, strip, bubble/colour-mapped
         scatter; codes 231+) with the right input shapes and record them in
         this plan
   - [ ] Find a LabTalk/COM readback of a plot's actual type, since `plotxy`
         accepts any code

2. **Check 1 — Origin → quantized import scorer**
   - [ ] Score each specimen's import against `oracle.json`:
         - curves, bindings and values;
         - plot type mapped;
         - axes and styles.
         Report per (type × family): match / wrong / omitted-with-reason.

3. **Check 2 — quantized-from-scratch scorer**
   - [ ] Per (type × family) recipe building the same figure through
         quantized's own figure model.
   - [ ] Score it against the same `oracle.json`.
   - [ ] Put quantized's export PNG next to Origin's for review.
   - [ ] Unbuildable types → book as cloud items here.

4. **First scorecard** — every 2D type × family, both checks, with a review
   page of side-by-side PNGs for the owner

## Tier 2 — Medium Impact

5. **XY family import parity** — line, scatter, line+symbol, step, area,
   stacked area, double-Y, error bars/bands, log/reversed axes, multi-layer
6. **Category/statistics family import parity** — column, horizontal bar,
   stacked column/bar, floating column, histogram, box, violin, strip, and
   wiring `.opj`/`.opju` column/bar/histogram to the bar/stat renderers
7. **Specialised family import parity** — polar, contour, heatmap, ternary,
   waterfall, bubble/colour-mapped scatter, vector, inset, axis break,
   multi-panel
8. **Commit passing specimens** to `test-data/origin/generated/<type>/` with
   their `oracle.json`, PNG and `.truth.json`, plus the generator command that
   rebuilds them; add realdata tests that score them

## Tier 3 — Nice-to-Have

9. **Round trip quantized → Origin** — export each passing figure (`.opj`
   writer / `.ogs`), open it in Origin over COM, and score Origin's readback
   against the same truth

## Completed

- (none yet)
