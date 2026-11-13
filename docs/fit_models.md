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
- **Origin built-in functions.** These use OriginLab's names, parameter order
  and formulas, so a parameter table fitted here reads the same as one from
  Origin. They are defined in `src/quantized/calc/fit_models_origin_*.py`.

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

In the area forms, `A` is the area under the peak. In GaussAmp, `A` is the
height above `y0`. Widths are full widths at half maximum (FWHM) unless the
table says otherwise.

### Peak Functions

| Model | Formula | Parameters |
|---|---|---|
| Gauss | y0 + A/(w·√(π/2))·exp(−2((x−xc)/w)²) | y0, xc, w (= 2σ), A (area) |
| GaussAmp | y0 + A·exp(−(x−xc)²/(2w²)) | y0, xc, w (= σ), A (height) |
| Lorentz | y0 + (2A/π)·w/(4(x−xc)²+w²) | y0, xc, w (FWHM), A (area) |
| Voigt | y0 + A·V(x−xc; wG, wL), the exact convolution (Faddeeva function) | y0, xc, A (area), wG, wL (Gaussian and Lorentzian FWHM) |
| PsdVoigt1 | y0 + A·[μ·L(w) + (1−μ)·G(w)], area-normalized | y0, xc, A, w, mu |
| PsdVoigt2 | y0 + A·[μ·L(wL) + (1−μ)·G(wG)] | y0, xc, A, wG, wL, mu |
| LogNormal | y0 + A/(√(2π)·w·x)·exp(−ln²(x/xc)/(2w²)), for x > 0 | y0, xc, w, A (area) |
| Asym2Sig | y0 + A·σ((x−xc+w1/2)/w2)·(1−σ((x−xc−w1/2)/w3)) | y0, xc, A, w1, w2, w3 |

### Exponential

| Model | Formula |
|---|---|
| ExpDec1 / ExpDec2 / ExpDec3 | y0 + Σ Ai·exp(−x/ti) |
| ExpDecay1 / ExpDecay2 / ExpDecay3 | y0 + Σ Ai·exp(−(x−x0)/ti) |
| ExpGro1 / ExpGro2 | y0 + Σ Ai·exp(x/ti) |
| ExpGrow1 / ExpGrow2 | y0 + Σ Ai·exp((x−x0)/ti) |

In the `x0` variants, `x0` and the amplitudes are not independent. The data
can only determine `Ai·exp(x0/ti)`. As in Origin, fix `x0`. The auto-guess
sets it to the smallest x. The guess orders the time constants
t1 < t2 < t3.

### Growth/Sigmoidal

| Model | Formula | Parameters |
|---|---|---|
| Boltzmann | A2 + (A1−A2)/(1+exp((x−x0)/dx)) | A1, A2, x0, dx |
| DoseResp | A1 + (A2−A1)/(1+10^((LOGx0−x)·p)) | A1, A2, LOGx0, p |
| Hill | Vmax·xⁿ/(kⁿ+xⁿ) | Vmax, k, n |
| Hill1 | START + (END−START)·xⁿ/(kⁿ+xⁿ) | START, END, k, n |
| MichaelisMenten | Vmax·x/(Km+x), which is Hill with n = 1 | Vmax, Km |
| Logistic (Origin) | A2 + (A1−A2)/(1+(x/x0)^p), for x > 0 | A1, A2, x0, p |
| Logistic5 | A2 + (A1−A2)/(1+(x/x0)^h)^s, for x > 0 | A1, A2, x0, h, s |
| SLogistic1 | a/(1+exp(−k(x−xc))) | a, xc, k |
| Gompertz | a·exp(−exp(−k(x−xc))) | a, xc, k |
| Weibull1 | A − (A−y0)·exp(−(k(x−xc))^d) | A, y0, xc, d, k |

Origin's `Logistic` is listed as **Logistic (Origin)** because the name
`Logistic` belongs to the MATLAB-parity model. Origin leaves Weibull1
undefined for x < xc. Here the curve stays flat at `y0` before the onset.

### Polynomial, Power, Waveform

| Model | Formula | Parameters |
|---|---|---|
| Poly 5 … Poly 9 | A0 + A1·x + … + An·xⁿ (Origin allows up to order 9) | A0 … An, in ascending order |
| Proportional | A·x | A |
| Allometric1 | a·x^b | a, b |
| Sine | y0 + A·sin(π(x−xc)/w), with period 2w | y0, xc, w, A ≥ 0 |
| SineDamp | y0 + A·exp(−x/t0)·sin(π(x−xc)/w) | y0, xc, w, t0 > 0, A ≥ 0 |

Quadratic, Cubic and Poly 4 come from the MATLAB-parity set. Their
coefficients are in descending order (a, b, c, …).

## Starting guesses for the Origin functions

Most Origin functions are linear in some parameters once the others are
fixed. Offsets, areas and asymptotes are linear. Centres, widths and time
constants are not. The guess first scans a coarse grid of the nonlinear
parameters. At each grid point it solves for the linear parameters exactly
by least squares (variable projection). It then refines the best grid point
with a short Nelder-Mead search. For example, the Gauss grid covers the
centre and width, and least squares gives `y0` and `A`.

The guess works on at most 1000 points. It falls back to the registry
defaults in these cases: the data has fewer than 3 points or no x span, the
data is outside the model's domain (for example LogNormal with x ≤ 0), or the
result is not finite.

The tests fit synthetic noisy data for every model, using several random true
parameter sets. The fit must recover each parameter within 6 standard errors.
quantized's fitter must also match scipy's `curve_fit` to 1e-6 of the data
range.
