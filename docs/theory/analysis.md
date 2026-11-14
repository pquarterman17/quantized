# Multi-curve averaging, computed error bars, and secondary axes

Covers `calc/curve_average.py::average_curves`, `calc/axis_top.py` (ported
line-for-line from `frontend/src/lib/axisTop.ts`), and the computed-error-bar
rule in `frontend/src/store/computedErrorRun.ts::errorExpr`. The last of
these has no `calc/` counterpart — it is a worksheet formula column (see
below) — so this entry cites the frontend module directly instead of a
Python one, same as any other formula-column feature.

## Averaging multiple curves onto a common grid

`average_curves(curves, grid="union"|"step", ...)` (Origin's "Average
Multiple Curves") linearly resamples every curve onto one shared x grid
through `calc/resample_align.py::align_resample`, then reduces row-wise:

$$\bar y_i=\frac{1}{N_i}\sum_{k=1}^{N_i} y_{k,i},\qquad
s_i=\sqrt{\frac{1}{N_i-1}\sum_{k=1}^{N_i}(y_{k,i}-\bar y_i)^2}\ \ (N_i\ge2),\qquad
\mathrm{SEM}_i=\frac{s_i}{\sqrt{N_i}}$$

at each grid point $i$, where $N_i\le N$ (the curve count) is however many of
the $N$ curves have finite data at that point — a point outside a curve's
own finite x-range is simply excluded from that row's mean (no
extrapolation), and $N_i$ is emitted as its own output column so a reader
can see where coverage drops. The sample SD uses $\mathrm{ddof}=1$ (Bessel's
correction, the right divisor for an SD *estimated from the curves
themselves* rather than computed against a known population mean) and is
blank (NaN) where $N_i<2$, since a single curve has no spread to report.

Two grid choices trade coverage for uniform $N$:

- **`"union"`** — every distinct finite x across all curves, over the whole
  span. Every point is used, but points near either end of the span may
  average fewer than $N$ curves.
- **`"step"`** — a fixed `lo:step:hi` grid over the *overlap* of all curves'
  ranges only (refused if the curves don't overlap at all), so every grid
  point averages all $N$ curves with no partial coverage anywhere.

**SD vs. SEM — which is the right error bar:** $s_i$ (SD) describes how much
the individual curves actually scatter at that point — the run-to-run
measurement variability you'd show to characterize *reproducibility* of a
single run. $\mathrm{SEM}_i$ describes how precisely the *mean* curve itself
is known, and shrinks as $1/\sqrt{N}$ with more curves averaged — it is the
right error bar when the averaged curve is going on to be fit, compared
against another mean, or otherwise treated as a point estimate of the true
underlying curve, because it answers "how far could this mean curve
plausibly be from the true curve," not "how much did the raw runs vary."
`average_curves` returns both, plus $N$, and leaves the choice to the
caller; the UI binds SEM as the mean's default error role (export and fit
weighting both read whichever column is bound).

Worked example — 4 synthetic noisy copies of $y=\sin x$ (11 points,
$x\in[0,10]$, Gaussian noise $\sigma=0.05$), `grid="union"`, full overlap so
$N_i=4$ everywhere:

| $x$ | mean | SD | SEM ($=\mathrm{SD}/\sqrt4$) | N |
|---|---|---|---|---|
| 0 | 0.0005 | 0.025 | 0.0125 | 4 |
| 1 | 0.8178 | 0.0626 | 0.0313 | 4 |
| 2 | 0.9303 | 0.0241 | 0.0120 | 4 |
| 4 | −0.7836 | 0.0143 | 0.0072 | 4 |

SEM is exactly SD$/\sqrt4$ = SD$/2$ at every row, as the formula requires;
with more curves averaged the SEM column would keep shrinking while the SD
column (the curves' actual scatter) would settle to a stable value — the
concrete sense in which they answer different questions.

**Reference:** Bevington, P.R. & Robinson, D.K., *Data Reduction and Error
Analysis for the Physical Sciences*, 3rd ed. (McGraw-Hill, 2003), Ch. 4
(standard deviation of the mean vs. standard deviation of the data).

## Computed error bars: counting statistics, percent, and constant

`errorExpr` (`frontend/src/store/computedErrorRun.ts`) builds a worksheet
formula column from a rule and binds it as a series' symmetric Y error, so
it is an ordinary computed column that happens to be registered in the
error role — it draws as error bars, re-weights a curve fit's "Y errors"
option, and exports exactly like any bound error column, and it
**recomputes automatically whenever the Y cell it depends on changes**
(it's a live formula, not a one-time snapshot). For a series' column letter
`Y` and a user parameter `p`:

$$\sigma_{\sqrt Y}=\sqrt{\max(Y,1)},\qquad
\sigma_{\%}=\frac{p}{100}\,\lvert Y\rvert,\qquad
\sigma_{\rm const}=p$$

**$\sqrt{\max(Y,1)}$ — why the clamp.** For Y in raw counts, Poisson
counting statistics give $\sigma=\sqrt Y$ (the same statistics that justify
$\sigma=\sqrt{\sum I}$ for a summed intensity profile — see
[`xrd.md`](xrd.md)'s "Uncertainty in binned RSM profiles" section). Clamping
the *radicand* to at least 1 before taking the root means a zero-count (or a
background-subtracted, slightly negative) point gets $\sigma=1$ count rather
than $\sigma=0$. This matters for more than cosmetics: a weighted
least-squares fit weights each point by $1/\sigma^2$, so $\sigma=0$ is not
"very certain," it's **infinitely** certain — one zero-count point would
mathematically dominate the fit and drive every other point's residual to
irrelevance. $\sigma=1$ keeps that point's weight finite and comparable to
its low-count neighbors instead.

**Percent and constant are not physical counting models** — they are
user-supplied error *specifications* for cases where the uncertainty is
dominated by something other than counting (a calibration/linearity
specification quoted as a percent of reading, or a flat instrumental noise
floor/read noise quoted as one number in the data's own units). `percent`
uses $\lvert Y\rvert$ so the bar is never negative regardless of the sign of
Y; `constant` is literally `p + 0*Y` — a flat value that nonetheless goes
blank wherever Y itself is blank, by construction of the formula (there is
no error bar on a point with no data).

**How each shapes a weighted fit.** A least-squares fit with Y-error
weighting minimizes $\sum (y_i-f(x_i))^2/\sigma_i^2$. The three rules give
qualitatively different *relative* error $\sigma_i/\lvert y_i\rvert$ as a
function of signal size, and therefore different relative weight profiles:

| Rule | $\sigma$ | relative error $\sigma/\lvert Y\rvert$ (large $Y$) | fit behaviour |
|---|---|---|---|
| $\sqrt{\max(Y,1)}$ | grows as $\sqrt Y$ | falls as $1/\sqrt Y$ | low-count points get a smaller *absolute* weight floor (never zero, per the clamp) but the largest *relative* uncertainty — correct counting-statistics behaviour: peaks dominate less than their absolute height alone would suggest, baselines aren't over-trusted |
| percent | grows linearly with $\lvert Y\rvert$ | constant | every point contributes comparably *in relative terms* regardless of signal size — appropriate when the dominant error source really does scale with the reading (e.g. a detector linearity spec) |
| constant | flat | falls as $1/\lvert Y\rvert$ | small-signal points are weighted down relative to large-signal ones — appropriate when the noise floor is instrumental and signal-independent (e.g. electronic read noise), so a point near the floor is genuinely less informative |

**Reference:** Bevington, P.R. & Robinson, D.K., *op. cit.*, Ch. 4 (Poisson
counting statistics) and Ch. 7 (weighted least squares).

## Secondary (top) axes: reciprocal and $d$-spacing

`calc/axis_top.py` draws a second X axis along the plot's top whose tick
*values* are a transform of the bottom axis' values, ticked and labelled
independently (`nice_ticks`) so the two axes need not share a grid. Three
kinds, selected per-figure in the Axis dialog:

$$\texttt{linear}:\ t=\mathrm{factor}\cdot x+\mathrm{shift}\qquad
\texttt{reciprocal}:\ t=\frac{\mathrm{factor}}{x}\qquad
\texttt{dspacing}:\ t=\frac{\lambda}{2\sin(x/2\ {\rm in\ deg})}$$

**`reciprocal` — Arrhenius-type plots.** With the bottom axis in temperature
$T$ (K), `factor=1` draws a top axis in $1/T$ (K$^{-1}$); `factor=1000` draws
the more commonly tabulated $1000/T$, whose tick spacing lands on round
numbers for typical lab temperature ranges. The transform is undefined
exactly at $x=0$ (returns NaN there and the axis is hidden entirely if the
visible range straddles or sits at $x\le0$, per `top_span`'s guard) — not a
restriction in practice for a temperature axis, since $T>0$ always. This
display transform is independent of how an Arrhenius model is actually
*fit*: `calc/fit_models.py`'s `Arrhenius` model fits
$y=A\exp(-E_a/(k_BT))$ against $T$ directly (the fit parameter is
$E_a/k_B$, in kelvin), so plotting with a $1/T$ (or $1000/T$) top axis is
purely a reading convenience — the classic linearized Arrhenius-plot
intuition ($\ln y$ vs. $1/T$ is a straight line of slope $-E_a/k_B$) — not a
different fit.

**`dspacing` — Bragg's law off the 2θ axis.** With the bottom axis in $2\theta$
(degrees), the top axis shows the $d$-spacing an operator would read off a
powder pattern via Bragg's law at $n=1$ (see
[`xrd.md`](xrd.md)'s Bragg's-law section for the general $n$-order form):

$$d=\frac{\lambda}{2\sin\theta}=\frac{\lambda}{2\sin(2\theta/2)}$$

Valid strictly for $0<2\theta<180°$ (`sin` of a half-angle outside that
range is non-positive or $>1$, giving no real $d$); the code clamps the
usable upper end to $179.99°$ (`_DSPACING_MAX`) to avoid the exact
$\sin(90°)$ singularity landing on a drawn tick, and starts the drawn part a
small fraction (`TOP_SPAN_FLOOR`, 1%) above zero when the visible range
would otherwise run into the undefined $2\theta=0$ end — the same guard
`reciprocal` uses at $x=0$.

**Why one shared implementation matters:** `calc/axis_top.py` is a
deliberate line-for-line port of `frontend/src/lib/axisTop.ts` — the same
tick-generation and domain-clamping logic runs in the browser (interactive
canvas) and in the matplotlib export path, so a figure's top axis shows
**identical** tick positions and labels on screen and in the exported
PDF/SVG (`tests/test_axis_top.py` and `axisTop.test.ts` share one
cross-checked table).

Worked example — Cu Kα1 ($\lambda=1.540598$ Å), `dspacing` top axis:
$2\theta=31.71°\to d=2.820$ Å; $2\theta=45.43°\to d=1.995$ Å; $2\theta=73.48°
\to d=1.288$ Å (the same conversion as Bragg's law in
[`xrd.md`](xrd.md), just drawn as a second axis rather than computed by
hand).

**Reference:** Cullity, B.D. & Stock, S.R., *Elements of X-Ray Diffraction*,
3rd ed. (Prentice Hall, 2001), Ch. 2 (Bragg's law); Atkins, P. & de Paula,
J., *Physical Chemistry*, 11th ed. (Oxford, 2018), §20.3 (the Arrhenius
equation and the linearized $\ln k$ vs. $1/T$ plot).
