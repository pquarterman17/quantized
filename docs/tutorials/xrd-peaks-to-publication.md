# Tutorial: XRD Scan → Peaks → Phase/(hkl) Labels → Counting-Statistics Error Bars → Publication Export

A short end-to-end pass over a powder XRD scan: load it, find peaks, read
off $d$-spacing, label peaks with the matched reference reflection's
`{phase}`/`{hkl}` (when a reference pattern is loaded), add √Y counting-
statistics error bars, and export a publication figure. See
[`docs/theory/xrd.md`](../theory/xrd.md) (Bragg's law) and
[`docs/theory/analysis.md`](../theory/analysis.md) (computed error bars,
secondary axes) for the underlying formulas — this tutorial is the
workflow, those docs are the reference.

**Research question:** "I have a two-phase powder pattern. Where are the
peaks, what $d$-spacings do they correspond to, and how do I get a
publication-ready figure with honest error bars?"

Every number below comes from actually running the Python shown, against
the repository's own synthetic baseline fixture
`tests/fixtures/baselines/xrd_two_phase_pattern.csv` (Cu anode, $2\theta\in
[10°,90°]$, two synthetic phases: 5 peaks from "phase-A", 4 from
"phase-B"). The peak-labeling and export steps are performed in the app UI
(they are frontend/worksheet features with no standalone `calc/`
function) — those steps are described rather than scripted, and say so.

---

## 1. Load the scan and find the peaks

```python
import numpy as np
from quantized.io.registry import import_auto
from quantized.calc.peaks import find_peaks_robust

ds = import_auto("tests/fixtures/baselines/xrd_two_phase_pattern.csv")
x = np.asarray(ds.time, dtype=float)
y = np.asarray(ds.values, dtype=float).reshape(-1)
print(ds.labels, ds.units, len(x))

peaks, bg = find_peaks_robust(x, y, sensitivity="medium", strict_prominence=True)
print(len(peaks), "peaks")
for p in peaks:
    print(f"2theta={p['center']:.4f}  height={p['height']:.2f}  fwhm={p['fwhm']:.4f}  "
          f"prominence={p['prominence']:.2f}")
```

```
('Intensity',) ('cps',) 4000
9 peaks
2theta=24.3036  height=502.66  fwhm=0.1824  prominence=514.61
2theta=28.6247  height=227.47  fwhm=0.1713  prominence=235.98
2theta=31.7054  height=933.45  fwhm=0.1458  prominence=945.44
2theta=38.8672  height=161.48  fwhm=0.1890  prominence=172.96
2theta=45.4289  height=253.71  fwhm=0.1978  prominence=264.98
2theta=52.9107  height=337.33  fwhm=0.1753  prominence=349.32
2theta=58.2121  height=303.56  fwhm=0.1734  prominence=314.81
2theta=66.1140  height=156.97  fwhm=0.2332  prominence=168.96
2theta=73.4759  height=114.25  fwhm=0.2311  prominence=125.69
```

`find_peaks_robust` (`calc/peaks.py`) found all 9 peaks the fixture's own
header promises (5 + 4) with `strict_prominence=True` — the stricter global
floor the XRD peak-find path uses to avoid dozens of locally-prominent false
peaks on a slowly varying diffraction background (see the module docstring).
`sensitivity="medium"` is the default SNR/prominence threshold; try
`"high"` if a weak peak you expect doesn't show up.

---

## 2. Convert 2θ to $d$-spacing

Bragg's law (`docs/theory/xrd.md`), applied via the same function the Axis
dialog's top-axis feature uses (`calc/axis_top.py::top_forward`, so this
is the identical transform a $d$-spacing top axis would draw on the plot):

```python
from quantized.calc.axis_top import top_forward

top = {"kind": "dspacing", "wavelength": 1.540598}  # Cu Kalpha1, Angstrom
for p in peaks:
    d = top_forward(top, p["center"])
    print(f"2theta={p['center']:.4f}  d={d:.4f} Angstrom")
```

```
2theta=24.3036  d=3.6593 Angstrom
2theta=28.6247  d=3.1160 Angstrom
2theta=31.7054  d=2.8199 Angstrom
2theta=38.8672  d=2.3152 Angstrom
2theta=45.4289  d=1.9949 Angstrom
2theta=52.9107  d=1.7291 Angstrom
2theta=58.2121  d=1.5836 Angstrom
2theta=66.1140  d=1.4122 Angstrom
2theta=73.4759  d=1.2878 Angstrom
```

In the app, turning on the Axis dialog's top axis (`kind="dspacing"`, same
wavelength) draws this exact conversion as a second axis along the top of
the plot — screen and export agree because both run `calc/axis_top.py` (see
`docs/theory/analysis.md`).

---

## 3. Label peaks with `{hkl}`/`{phase}` (UI step)

If a reference pattern (e.g. a known phase's stick pattern) is loaded onto
the plot via the XRD reference-pattern workshop, the peak-labeling tool's
`{hkl}` and `{phase}` template tokens resolve against it:
`lib/peakPhaseMatch.ts::matchReflection` takes each detected peak's center
and the **nearest** reference stick within `0.2°` 2θ (the default
tolerance, about one lab-diffractometer peak width) — a peak with no stick
that close renders the tokens **blank** rather than guessing a far-away
reflection. With no reference pattern loaded, `{hkl}`/`{phase}` are always
blank; this fixture ships no reference pattern of its own, so matching is
illustrative here, not run against real indexed phases.

To label the 9 peaks found above in the app:

1. Open the Peaks workshop and run "Find peaks" (or import the 9 centers
   above) on this dataset.
2. If labeling against a known phase, load its reference pattern first
   (XRD reference-pattern workshop) so `{hkl}`/`{phase}` have sticks to
   match against.
3. Set the label template to e.g. `{phase} {hkl}\n{center}°` and apply —
   each peak within `0.2°` of a stick gets that stick's phase/(hkl); the
   rest show only `{center}`.

(`peakLabels.ts::renderLabelTemplate` also supports `{height}`, `{fwhm}`,
`{area}`, `{index}`; an unrecognized token passes through literally rather
than throwing, so a stale template degrades visibly.)

---

## 4. Add √Y counting-statistics error bars

Raw intensity in counts (or cps scaled back to counts — see
`docs/theory/xrd.md`'s "Uncertainty" section for the cps caveat) follows
Poisson statistics, so $\sigma=\sqrt{Y}$ is the physically right error bar.
In the Inspector's Error columns card, the "Computed" row's **√Y** choice
adds exactly this as a linked worksheet column and binds it as the series'
Y error (`store/computedErrorRun.ts::errorExpr`):

$$\sigma = \sqrt{\max(Y, 1)}$$

For this scan's own peak heights, that gives (clamp not engaged — every
height here is well above 1 count):

| 2θ | height ($Y$) | $\sigma=\sqrt Y$ |
|---|---|---|
| 31.71° | 933.45 | 30.55 |
| 24.30° | 502.66 | 22.42 |
| 73.48° | 114.25 | 10.69 |

Because the error column is a live formula bound to the Y column
(`deps` on the Y channel), editing a Y cell recomputes its error
automatically — there is nothing to re-run by hand after a baseline
correction or a manual point edit. See `docs/theory/analysis.md` for why the
`max(Y, 1)` clamp matters (a zero-count point getting $\sigma=0$ would
otherwise dominate a weighted fit) and how √Y error bars differ from the
percent/constant alternatives in the same dialog.

---

## 5. Export a publication figure

With peaks labeled and error bars bound, export the figure vector (the
default, per the project's "vector publication export" convention):
**File → Export → Figure**, pick PDF or SVG (or EPS, new alongside the Axis
dialog's other publication features), and the export renders
server-side via matplotlib with the exact same axis — including any
$d$-spacing top axis from Step 2 and the peak labels from Step 3 — as the
interactive canvas. A multi-peak, multi-panel report can instead use the
Axis dialog's multi-page PDF export, or apply one axis template (reverse Y,
top axis, grid/tick styling) across every open figure in bulk before
exporting them all.

---

## 6. Common pitfalls

- **Treating `cps` as raw counts for √Y.** This fixture already imports as
  `cps` (counts per second); a genuine $\sqrt Y$ Poisson error needs raw
  counts, not a rate — multiply by the counting time first if your file
  (unlike this synthetic one) carries one in `ds.metadata["counting_time"]`.
  See `docs/theory/xrd.md`'s "Uncertainty" section.
- **Expecting `{hkl}`/`{phase}` to identify phases on their own.** The
  matcher only matches against reference sticks you have already loaded on
  the plot (nearest within `0.2°`); it is not a phase-identification
  search over the built-in phase database (`calc/phase_database.py`) — see
  the parity-gap note in `peakPhaseMatch.ts`.
- **A zero- or near-zero-count point under √Y weighting.** Without the
  `max(Y, 1)` clamp a zero-count point would get $\sigma=0$ and dominate a
  weighted fit; the clamp is there specifically to prevent that, not an
  arbitrary floor.

---

## 7. Going further

| If you need to... | Use |
|---|---|
| Fit each peak (center/height/FWHM/area) rather than just detect it | [`calc/peak_fit.py`](../../src/quantized/calc/peak_fit.py), [`calc/peak_multifit.py`](../../src/quantized/calc/peak_multifit.py) |
| Average several repeat scans before peak-finding | [`calc/curve_average.py::average_curves`](../../src/quantized/calc/curve_average.py) — see `docs/theory/analysis.md` |
| Look up a known phase's cell/basis | [`calc/phase_database.py::get_phase`](../../src/quantized/calc/phase_database.py) |
| Draw/export a 1/T (Arrhenius) top axis instead | [`calc/axis_top.py`](../../src/quantized/calc/axis_top.py) (`kind="reciprocal"`) — `docs/theory/analysis.md` |
| Percent- or constant-error alternatives to √Y | `store/computedErrorRun.ts::errorExpr` — `docs/theory/analysis.md` |

## 8. References

- Cullity, B.D. & Stock, S.R., *Elements of X-Ray Diffraction*, 3rd ed.
  (Prentice Hall, 2001), Ch. 2 (Bragg's law).
- Bevington, P.R. & Robinson, D.K., *Data Reduction and Error Analysis for
  the Physical Sciences*, 3rd ed. (McGraw-Hill, 2003), Ch. 4 (Poisson
  counting statistics).

For derivations and the full formula set, see
[`docs/theory/xrd.md`](../theory/xrd.md) and
[`docs/theory/analysis.md`](../theory/analysis.md).
