# Beautiful-defaults audit — GAP_TIER3_PLAN item 2 (gap #11 residual)

Written eyeball pass over un-tweaked first renders of `calc/figure.render_figure`
across every publication preset in `calc/figure_styles.py`, checking whether a
zero-override export is already journal-grade. This is the residual on closed
gap #11.

**Audited:** 2026-07-07
**Harness:** `tools/audit_defaults.py` (32 PNGs + `index.html` contact sheet,
gitignored — regenerate with `uv run python tools/audit_defaults.py`)
**Why a new harness:** `tools/visual/` screenshots the interactive uPlot/
Canvas2D surface in a real browser; it never touches the matplotlib export
path (`calc/figure.render_figure`). There was no automated eye on that
renderer's defaults before this.

## Method

Four representative physics figures, synthesized in-script (no external
files, fixed RNG seed for reproducibility), rendered through all 8 named
presets (`default`, `aps`, `nature`, `thesis`, `report`, `web`,
`presentation`, `poster` — the `aps_double` / `nature_double` wide variants
share the same typography and were not re-audited separately) with **zero
per-figure overrides**: default title/labels only, each preset's own figure
size and DPI.

- **M-H hysteresis loop** — two branches (decreasing/increasing field),
  tanh saturation + coercive offset, small linear background, noise.
- **XRD powder pattern** — exponential background + 8 Gaussian Bragg peaks
  spanning ~3 orders of magnitude, log-intensity y-axis.
- **R(Q) reflectivity** — total-external-reflection plateau, Q⁻⁴ Fresnel
  decay with Névot-Croce roughness damping, Kiessig thickness fringes,
  log-log.
- **R(T) transport comparison** — two linear-in-T resistivity traces
  (different residual resistivity/slope), exercising legend placement
  against two close curves.

Each of the 32 renders was inspected directly (not just described) for: tick
direction/density, font size vs. figure width (checked specifically at the
APS single-column width, 8.6 cm ≈ 3.386 in, matching APS's ~3.375 in spec),
legend collision with data, line weight vs. peak/feature width, log-axis
minor/decade ticks, and margin crowding. Two findings were additionally
**measured** (not just eyeballed) with a pixel/label-count probe, since
apparent size in a Read-tool preview does not track physical print size (a
600 dpi / 3.386 in APS figure is shown to me at roughly 6× linear
magnification vs. its physical size — "looks huge on screen" is not itself a
defect signal).

## Headline result: the preset *values* are fine

`figure_styles.py`'s own docstring marks `FIGURE_STYLES` as transcribed
verbatim from `quantized_matlab/+styles/template.m` and calibrated — "do not
'fix' them." The audit **confirms that discipline was warranted**: across
all 32 renders, no font size, line width, marker size, margin, or figure
dimension produced a clipped label, unreadable text, or overlapping
element. **Zero `figure_styles.py` values were changed.**

What the audit found instead were three fields **declared** in `FigureStyle`
but silently **ignored** by `render_figure` — the defaults were only as good
as the renderer's wiring, and the wiring had gaps. Those are fixed below
(per `GAP_TIER3_PLAN.md`'s own item-2 bullet, which permits a
`figure_styles.py` **or** `render_figure` default change).

## Findings

### FIX-IN-PRESET (objective — fixed)

1. **`dpi` was declared per-preset but never read.** `FigureStyle.dpi`
   carries each journal's calibrated raster resolution (`aps`/`nature` =
   600, `thesis`/`report` = 300, `presentation`/`poster`/`web` = 150,
   `default` = 200) but `render_figure`'s `dpi` parameter had a hardcoded
   `200` default and never consulted `st.dpi`. A caller rendering
   `style="aps"` PNG/TIFF without an explicit `dpi=` silently got a
   200 dpi raster — well under APS's requirement — while the preset table
   promised 600. **Fix:** `render_figure(..., dpi: int | None = None)`
   resolves to `figure_style(style).dpi` when not given explicitly; an
   explicit `dpi=` still overrides it (`src/quantized/calc/figure.py`).
   *Scope note:* `routes/export.py`'s `FigureRequest.dpi` always sends an
   explicit `int` (default 200) today, so this fix has no effect through
   the current API/frontend path — see Follow-ups.

2. **`legend_location` was declared but never read.** `FigureStyle.legend_location`
   (default `"best"` for every preset — no preset currently overrides it) was
   never passed to `ax.legend(...)`; the code had a comment asserting
   "All presets place the legend at 'best'" enforced by nothing. **Fix:**
   `ax.legend(..., loc=st.legend_location)`. Zero behavioural change today
   (every preset's value already equals matplotlib's implicit default), but
   the field now actually does what it claims, so a future preset (or a
   case-specific override) can set a real location.

3. **`marker_size` was declared but never read.** Per-series `marker_size`
   from `series_styles` correctly overrode it, but the *fallback* when a
   marker was requested without one was a hardcoded literal `5`, ignoring
   the preset's calibrated value (`aps`=4, `nature`=3, `poster`=10, …).
   **Fix:** `_plot_kwargs` takes the preset's `marker_size` as its fallback
   instead of the literal.

4. **No mirrored ticks on the top/right spines despite a full box.** Every
   preset has `box_on=True` (drawing all four spines), and `tick_dir="in"`
   — the intended "closed box, inward ticks on all sides" journal look
   (APS/Nature convention). But matplotlib's own defaults
   (`xtick.top=False`, `ytick.right=False`) leave the top/right spines
   bare even with the full rectangle drawn, which reads as an unfinished
   box in every one of the 32 renders (confirmed by inspection, e.g.
   `mh_hysteresis_aps.png` before the fix: tick dashes only on the bottom
   and left spines). This affected **all 8 presets identically** — not a
   per-preset value, a missing renderer default. **Fix:**
   `rc["xtick.top"] = rc["ytick.right"] = st.box_on` in `render_figure`'s
   rc context, so the mirrored ticks track the same flag that already
   controls spine visibility. Re-rendered and visually confirmed (all four
   spines now carry tick marks; no duplicate tick *labels* — `xtick.labeltop`
   stays off).

### TASTE / data-dependent (documented, not changed)

5. **`aps`'s log-decade labels thin out on wide-dynamic-range data.** The
   `R(Q)` reflectivity case (title + axis labels + ~8 decades of y-range)
   renders only 4 of 9 possible decade labels at the `aps` preset (9 pt
   font, 8.6×6.5 cm), while every other preset — including the *smaller*
   `nature` (7 pt, 8.9×6.0 cm) — shows all of them. Root cause (measured,
   not guessed): the title + x/y labels eat vertical space from a compact
   6.5 cm-tall axes; matplotlib's `LogLocator` auto-thins decade labels
   once the axes bbox gets short relative to the tick-label font (confirmed
   by a controlled repro: with `with_labels=False` the same geometry gives
   10 labels; with title+labels present it drops to 6, and the same
   geometry with `nature`'s smaller font keeps all of them). This is a
   *property of matplotlib's default tick-space heuristic meeting THIS
   demo's decade count*, not a fixed, context-independent preset defect —
   real reflectivity datasets vary from ~4 to ~8 decades depending on
   counting statistics, and a fix tuned to accommodate 8-9 decades (e.g.
   bumping `aps.fig_height_cm` from 6.5 to ~7.5, empirically the threshold)
   would be overfitting the preset to this one synthetic case rather than
   fixing a general defect (see the project's own "samples are not
   standards" discipline — don't tune shared defaults to one demo's shape).
   Every-other-decade labeling is also not unusual in real published
   reflectivity figures at compact single-column size. **Left as an owner
   call**: if wide-dynamic-range reflectivity in `aps` is a common
   real-world case, the lever is `aps.fig_height_cm` (verified: 7.5 cm
   restores full decade labeling; 6.8–7.2 cm does not, it's a threshold
   effect, not gradual).
6. **Legend placement is preset-global, not data-aware.** All 8 presets use
   `loc="best"`; in the two-series `R(T)` and `M-H` cases the legend never
   collided with data (both datasets happen to leave the upper-left/lower
   corners empty), but a preset-level location can't adapt to arbitrary
   data shape. This is inherent to a single "legend_location" preset field
   and not something a preset-value change can generally fix — the
   existing `"best"` default is the correct general-purpose choice.

## Follow-ups (out of scope for this item)

- **Frontend DPI does not track the selected preset.**
  `frontend/src/components/workshops/figurebuilder/useFigureBuilder.ts`
  initializes `dpi` to a hardcoded `300` and never re-syncs it when the
  user changes `style`; `routes/export.py`'s `FigureRequest.dpi` always
  sends an explicit value, so item 1's backend fix has no visible effect
  through the shipped export dialog today. Closing the loop needs a
  frontend change (sync/display the preset's dpi on style change) — out of
  scope for this backend-only item.
- **`calc/figure_map.py` and `calc/figure_statplots.py` have the same two
  gaps** (`dpi: int = 200` hardcoded, no `xtick.top`/`ytick.right` mirroring)
  as `calc/figure.py` had. Neither renderer is exercised by this audit's
  four line-plot cases (2-D maps / box-violin-QQ-histogram are a different
  case family per `GAP_TIER3_PLAN.md`'s dependency note — "audit the four
  core figure types now"); flagged here so a future map/statplot defaults
  pass reuses this fix rather than rediscovering it.

## Fixes applied

| File | Change | Why |
|---|---|---|
| `src/quantized/calc/figure.py` | `dpi` param resolves to `figure_style(style).dpi` when not given | Preset's calibrated raster resolution now actually applies by default |
| `src/quantized/calc/figure.py` | `ax.legend(..., loc=st.legend_location)` | Declared field now has effect (no behavioural change today, all presets are `"best"`) |
| `src/quantized/calc/figure.py` | `_plot_kwargs` marker-size fallback uses `st.marker_size` instead of literal `5` | Declared field now has effect for marker-mode series without a per-series size |
| `src/quantized/calc/figure.py` | rc `xtick.top`/`ytick.right` tied to `st.box_on` | Closes the box on all four sides with mirrored inward ticks, matching APS/Nature convention, for every preset |
| `src/quantized/calc/figure_styles.py` | **none** | Values audited and confirmed already journal-grade; the transcription-guard tests in `tests/test_calc_figure_styles.py` are untouched |

No existing test needed adjustment — `tests/test_calc_figure.py` and
`tests/test_calc_figure_styles.py` pass unchanged (76/76 in the figure-test
slice; 1733 passed / 3 skipped for the full suite).
