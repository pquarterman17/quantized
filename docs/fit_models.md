# Curve-fit models

Every model below is offered by the Curve Fit workshop, the model scan, batch
and global fits, and `GET /api/fitting/models`. `POST /api/fitting/autoguess`
gives a starting guess for each one. The guess is computed from the data for
every Origin function and for most MATLAB-parity models. The Hysteresis
models start from fixed defaults. Plugins can add more models
(see [plugins.md](plugins.md)), and the equation builder covers anything else.

There are two families:

- **MATLAB-parity models.** These are ported from `quantized_matlab`'s
  `+fitting/models.m` and `hysteresisModels.m`. Their values and auto-guesses
  are golden-tested against the MATLAB toolbox.
- **Origin built-in functions.** These use OriginLab's names, parameter order,
  formulas and default bounds, so a parameter table fitted here reads the same
  as one from Origin. They are defined in
  `src/quantized/calc/fit_models_origin_*.py`. Each one was checked against
  its Origin Help page; the [verification table](#verification-against-origin-help)
  records the result per model.

## MATLAB-parity models

| Category | Models |
|---|---|
| Linear | Linear, Quadratic, Cubic, Poly 4 |
| Decay | Exponential Decay, Stretched Exponential, Bi-exponential Decay, VFT |
| Growth | Exponential Growth, Saturation Growth |
| Peak | Gaussian (A, μ, σ), Lorentzian (A, x₀, γ), Pseudo-Voigt |
| Power | Power Law, Allometric (A·\|x\|ⁿ) |
| Sigmoid | Logistic (A/(1+e^(−k(x−x₀)))+C), Tanh |
| Magnetic | Curie-Weiss, Bloch T^3/2, Langevin, Brillouin, Stoner-Wohlfarth |
| Thermal | Arrhenius, Langmuir, Debye, Einstein, Debye+Einstein |
| Hysteresis | Tanh Hysteresis, Two-Component (F+P), Linear Background, Approach to Saturation, Langevin + Background |
| Other | Logarithmic, Square Root |

## Origin built-in functions

Each model name links to its Origin Help page. In the area forms, `A` is the
area under the peak. In GaussAmp, `A` is the height above `y0`. The bounds
column gives Origin's default lower bounds, which the registry copies. Origin
sets no upper bounds on any of these functions.

### Peak Functions

| Model | Formula | Parameters, in order | Bounds |
|---|---|---|---|
| [Gauss](https://www.originlab.com/doc/Origin-Help/Gauss-FitFunc) | y0 + A/(w·√(π/2))·exp(−2((x−xc)/w)²) | y0, xc, w (= 2σ), A (area) | w > 0 |
| [GaussAmp](https://www.originlab.com/doc/Origin-Help/GaussAmp-FitFunc) | y0 + A·exp(−(x−xc)²/(2w²)) | y0, xc, w (= σ), A (height) | w > 0 |
| [Lorentz](https://www.originlab.com/doc/Origin-Help/Lorentz-FitFunc) | y0 + (2A/π)·w/(4(x−xc)²+w²) | y0, xc, w (FWHM), A (area) | w > 0 |
| [Voigt](https://www.originlab.com/doc/Origin-Help/Voigt-FitFunc) | y0 + A·V(x−xc; wG, wL), the exact convolution (Faddeeva function) | y0, xc, A (area), wG, wL (Gaussian and Lorentzian FWHM) | wG > 0, wL > 0 |
| [PsdVoigt1](https://www.originlab.com/doc/Origin-Help/PsdVoigt1-FitFunc) | y0 + A·[mu·L(w) + (1−mu)·G(w)], L and G unit-area with FWHM w | y0, xc, A, w, mu | w > 0 |
| [PsdVoigt2](https://www.originlab.com/doc/Origin-Help/PsdVoigt2-FitFunc) | y0 + A·[mu·L(wL) + (1−mu)·G(wG)] | y0, xc, A, wG, wL, mu | wG > 0, wL > 0 |
| [LogNormal](https://www.originlab.com/doc/Origin-Help/LogNormal-FitFunc) | y0 + A/(√(2π)·w·x)·exp(−ln²(x/xc)/(2w²)), for x > 0 | y0, xc, w, A (area) | xc > 0, w > 0 |
| [Asym2Sig](https://www.originlab.com/doc/Origin-Help/Asym2Sig-FitFunc) | y0 + A·σ((x−xc+w1/2)/w2)·(1−σ((x−xc−w1/2)/w3)), σ(z) = 1/(1+e^(−z)) | y0, xc, A, w1, w2, w3 | w1, w2, w3 > 0 |

Origin does not bound `mu`, so a PsdVoigt fit can return a value outside
0 to 1.

### Exponential

| Model | Formula | Parameters, in order | Bounds |
|---|---|---|---|
| [ExpDec1](https://www.originlab.com/doc/Origin-Help/ExpDec1-FitFunc) / [ExpDec2](https://www.originlab.com/doc/Origin-Help/ExpDec2-FitFunc) / [ExpDec3](https://www.originlab.com/doc/Origin-Help/ExpDec3-FitFunc) | y0 + Σ Ai·exp(−x/ti) | y0, A1, t1, (A2, t2, (A3, t3)) | none |
| [ExpDecay1](https://www.originlab.com/doc/Origin-Help/ExpDecay1-FitFunc) / [ExpDecay2](https://www.originlab.com/doc/Origin-Help/ExpDecay2-FitFunc) / [ExpDecay3](https://www.originlab.com/doc/Origin-Help/ExpDecay3-FitFunc) | y0 + Σ Ai·exp(−(x−x0)/ti) | y0, x0, A1, t1, … | none |
| [ExpGro1](https://www.originlab.com/doc/Origin-Help/ExpGro1-FitFunc) / [ExpGro2](https://www.originlab.com/doc/Origin-Help/ExpGro2-FitFunc) | y0 + Σ Ai·exp(x/ti) | y0, A1, t1, (A2, t2) | none |
| [ExpGrow1](https://www.originlab.com/doc/Origin-Help/ExpGrow1-FitFunc) / [ExpGrow2](https://www.originlab.com/doc/Origin-Help/ExpGrow2-FitFunc) | y0 + Σ Ai·exp((x−x0)/ti) | y0, x0, A1, t1, (A2, t2) | t1 > 0 for ExpGrow1 only |

In the `x0` variants, `x0` and the amplitudes are not independent. The data
can only determine `Ai·exp(x0/ti)`. Origin's help says to fix `x0`. The
auto-guess sets it to the smallest x. The guess orders the time constants
t1 < t2 < t3, as Origin's initial values do.

The ExpDec1 help page lists the parameters as "y0, A, t", but its own derived
quantities use `t1`. The registry uses y0, A1, t1, to match ExpDec2 and
ExpDec3.

### Growth/Sigmoidal

| Model | Formula | Parameters, in order | Bounds |
|---|---|---|---|
| [Boltzmann](https://www.originlab.com/doc/Origin-Help/Boltzmann-FitFunc) | A2 + (A1−A2)/(1+exp((x−x0)/dx)) | A1, A2, x0, dx | none |
| [DoseResp](https://www.originlab.com/doc/Origin-Help/DoseResp-FitFunc) | A1 + (A2−A1)/(1+10^((LOGx0−x)·p)) | A1, A2, LOGx0, p | none |
| [Hill](https://www.originlab.com/doc/Origin-Help/Hill-FitFunc) | Vmax·xⁿ/(kⁿ+xⁿ) | Vmax, k, n | Vmax, k, n > 0 |
| [Hill1](https://www.originlab.com/doc/Origin-Help/Hill1-FitFunc) | START + (END−START)·xⁿ/(kⁿ+xⁿ) | START, END, k, n | k, n > 0 |
| [MichaelisMenten](https://www.originlab.com/doc/Origin-Help/MichaelisMenten-FitFunc) | Vmax·x/(Km+x) | Vmax, Km | Vmax, Km > 0 |
| [Logistic (Origin)](https://www.originlab.com/doc/Origin-Help/Logistic-FitFunc) | A2 + (A1−A2)/(1+(x/x0)^p), for x > 0 | A1, A2, x0, p | p > 0 |
| [Logistic5](https://www.originlab.com/doc/Origin-Help/Logistic5-FitFunc) | Amin + (Amax−Amin)/(1+(x/x0)^(−h))^s, for x > 0 | Amin, Amax, x0, h, s | s > 0 |
| [SLogistic1](https://www.originlab.com/doc/Origin-Help/SLogistic1-FitFunc) | a/(1+exp(−k(x−xc))) | a, xc, k | xc > 0 |
| [SGompertz](https://www.originlab.com/doc/Origin-Help/SGompertz-FitFunc) | a·exp(−exp(−k(x−xc))) | a, xc, k | a > 0, k > 0 |
| [SWeibull1](https://www.originlab.com/doc/Origin-Help/SWeibull1-FitFunc) | A·(1−exp(−(k(x−xc))^d)) | A, xc, d, k | A > 0, k > 0 |

Origin's `Logistic` is listed as **Logistic (Origin)** because the name
`Logistic` belongs to the MATLAB-parity model. Origin leaves SWeibull1
undefined for x < xc. Here the curve stays flat at 0 before the onset.
SLogistic1's `xc > 0` bound is Origin's own default. Widen the lower bound
in the fit panel if your step is centred at a negative x.

### Polynomial, Power, Waveform

| Model | Formula | Parameters, in order | Bounds |
|---|---|---|---|
| [Poly5](https://www.originlab.com/doc/Origin-Help/Poly5-FitFunc) | A0 + A1·x + … + A5·x⁵ | A0 … A5 | none |
| [Poly](https://www.originlab.com/doc/Origin-Help/Poly-FitFunc) | a0 + a1·x + … + a9·x⁹ (Origin's 9th-order polynomial) | a0 … a9 | none |
| Poly 6, Poly 7, Poly 8 | A0 + A1·x + … + An·xⁿ | A0 … An | none |
| Proportional | A·x | A | none |
| [Allometric1](https://www.originlab.com/doc/Origin-Help/Allometric1-FitFunc) | a·x^b | a, b | none |
| [Sine](https://www.originlab.com/doc/Origin-Help/Sine-FitFunc) | y0 + A·sin(π(x−xc)/w), with period 2w | xc, w, A, y0 | w > 0 |
| [SineDamp](https://www.originlab.com/doc/Origin-Help/SineDamp-FitFunc) | y0 + A·exp(−x/t0)·sin(π(x−xc)/w) | y0, xc, w, t0, A | w > 0, t0 > 0 |

Poly 6, Poly 7, Poly 8 and Proportional are **not Origin fitting functions**.
Origin's fitting-function library has Poly4, Poly5 and the 9th-order Poly.
It reaches the other orders through its Polynomial Fit tool, and fits a line
through the origin by fixing the intercept of `Line` at 0. These four are
quantized additions that follow the same conventions.

Quadratic, Cubic and Poly 4 come from the MATLAB-parity set. Their
coefficients are in descending order (a, b, c, …), unlike Origin's Poly4.

`w` in Sine and SineDamp is half the period, as in Origin. Origin does not
bound `A`, so the same curve can be written with (A, xc) or (−A, xc + w).

**Polynomials on shifted x.** A raw-power polynomial is badly conditioned
when the x values sit far from zero compared with their spread, for example
x from 1000 to 1001. The powers of x become nearly proportional to each
other, so the coefficients are huge, cancel each other, and lose precision.
The fitted curve can then be wrong even though the model is linear. This
gets worse with the order. Before fitting Poly5 to Poly, subtract a constant
from x so the data is centred near zero, and rescale it if the range is very
large or very small. The same applies to ExpDec and ExpGro on shifted x; use
the `x0` variants there.

## Verification against Origin Help

www.originlab.com could not be opened directly from the development
environment, so each page was read through web search results for that page
(search snippets and summaries of the page content). "Text" in the formula
column means the equation was readable in those results. "Derived" means the
equation is an image on the page, and the formula was confirmed from the
page's description and its derived quantities (for example, Lorentz height
H = 2A/(πw)). The category column gives the registry's category. Where the
results did not show the page's category field, the row says so, and the
category is the one Origin's function list implies.

| Model | Names and order | Bounds | Formula | Category |
|---|---|---|---|---|
| Gauss | verified | verified | text | Peak Functions (not shown in the results) |
| GaussAmp | verified | verified | text | Peak Functions (also Statistics) |
| Lorentz | verified | verified | derived | Peak Functions |
| Voigt | verified | verified | derived | Peak Functions (not shown in the results) |
| PsdVoigt1 | verified | verified | text | Peak Functions (not shown in the results) |
| PsdVoigt2 | verified | verified | derived | Peak Functions (not shown in the results) |
| LogNormal | verified | verified | text | Peak Functions (also Statistics) |
| Asym2Sig | verified | verified | text | Peak Functions |
| ExpDec1 | verified, see the note above | verified | text | Exponential |
| ExpDec2, ExpDec3 | verified | verified | derived | Exponential (not shown in the results) |
| ExpDecay1, ExpDecay2, ExpDecay3 | verified | verified | text | Exponential (not shown in the results) |
| ExpGro1 | verified | verified | text | Exponential (not shown in the results) |
| ExpGro2 | verified | verified | derived | Exponential (not shown in the results) |
| ExpGrow1 | verified | verified | text | Exponential (not shown in the results) |
| ExpGrow2 | verified | verified | derived | Exponential (not shown in the results) |
| Boltzmann | verified | verified | text | Growth/Sigmoidal |
| DoseResp | verified | verified | text | Growth/Sigmoidal (not shown in the results) |
| Hill | verified | verified | text | Growth/Sigmoidal (not shown in the results) |
| Hill1 | verified | verified | text | Growth/Sigmoidal (not shown in the results) |
| MichaelisMenten | verified | verified | text | Growth/Sigmoidal (also Pharmacology) |
| Logistic (Origin) | verified | verified | text | Growth/Sigmoidal |
| Logistic5 | verified | verified | text | Growth/Sigmoidal (not shown in the results) |
| SLogistic1 | verified | verified | text | Growth/Sigmoidal |
| SGompertz | verified | verified | text | Growth/Sigmoidal |
| SWeibull1 | verified | verified | text | Growth/Sigmoidal |
| Poly5 | verified | verified | text | Polynomial (not shown in the results) |
| Poly | verified | verified | derived | Polynomial |
| Allometric1 | verified | verified | text | Power |
| Sine | verified | verified | derived | Waveform |
| SineDamp | verified | verified | text | Waveform |
| Poly 6, Poly 7, Poly 8 | not an Origin function | – | – | – |
| Proportional | not an Origin function | – | – | – |

Changes made after this check: Gompertz was renamed SGompertz and Weibull1
was replaced by SWeibull1 (Origin's names and forms). Logistic5 was corrected
to Origin's formula and parameter names. Sine now uses Origin's parameter
order. Poly 5 and Poly 9 became Poly5 and Poly. Every default bound now
matches Origin's.

## Which models the default scan fits

A model scan with no model list fits the MATLAB-parity models, any plugin
models, eight Origin functions (Gauss, Lorentz, Voigt, ExpDec1, Boltzmann,
Hill, SGompertz and Sine) and Proportional. The other models on this page are left
out of the default scan because they are slow to fit to data they do not
match, or they repeat a curve that is already in the scan. This covers the
polynomials of order 5 and above, the multi-exponentials, and the `x0`
variants. Name any of them in the scan's model list to include them.

In a default scan, each of those nine models gets at most 400
Nelder-Mead iterations per parameter. A matching model needs about 50. One
that has not converged by then is listed with the status
`skipped: too slow` instead of being ranked on an unfinished fit. Models you
name explicitly are always fitted in full. Fitting all 71 models took about
53 s on a 2000-point test curve. On the same curve the default scan now
costs about 9% more CPU time than the MATLAB-parity set alone (5.0 s
against 4.6 s).

## Starting guesses for the Origin functions

Most Origin functions are linear in some parameters once the others are
fixed. Offsets, areas and asymptotes are linear. Centres, widths and time
constants are not. The guess first scans a coarse grid of the nonlinear
parameters. At each grid point it solves for the linear parameters exactly
by least squares (variable projection). It then refines the best grid point
with a short Nelder-Mead search. For example, the Gauss grid covers the
centre and width, and least squares gives `y0` and `A`. The guess is then
clamped to the model's bounds.

The guess works on at most 1000 points. It falls back to the registry
defaults in these cases: the data has fewer than 3 points or no x span, the
data is outside the model's domain (for example LogNormal with x ≤ 0), or the
result is not finite.

The tests fit synthetic noisy data for every model, using several random true
parameter sets. The fit must recover each parameter within 6 standard errors.
quantized's fitter must also match scipy's `curve_fit` to 1e-6 of the data
range.
