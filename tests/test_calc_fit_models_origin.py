"""Origin built-in fit models: formulas, registry metadata and guess fallbacks.

Formula checks are hand-derived values at characteristic points (peak
heights, half-maxima, inflection midpoints, e-folding points) plus the
documented identities between the Origin forms (Gauss area <-> GaussAmp
height, Voigt -> Gauss/Lorentz limits, PsdVoigt1 mu = 0/1, ...).
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from numpy.testing import assert_allclose
from scipy.integrate import quad

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_guess_tools import MAX_GUESS_POINTS, prepare
from quantized.calc.fit_models import FIT_MODELS, evaluate


def _at(name: str, x: float, p: list[float]) -> float:
    return float(evaluate(name, np.array([x]), p)[0])


# ── registry ───────────────────────────────────────────────────────────────
ORIGIN_MODELS = {
    "Peak Functions": ["Gauss", "GaussAmp", "Lorentz", "Voigt", "PsdVoigt1", "PsdVoigt2",
                       "LogNormal", "Asym2Sig"],
    "Exponential": ["ExpDec1", "ExpDec2", "ExpDec3", "ExpDecay1", "ExpDecay2", "ExpDecay3",
                    "ExpGro1", "ExpGro2", "ExpGrow1", "ExpGrow2"],
    "Growth/Sigmoidal": ["Boltzmann", "DoseResp", "Hill", "Hill1", "MichaelisMenten",
                         "Logistic (Origin)", "Logistic5", "SLogistic1", "SGompertz",
                         "SWeibull1"],
    "Polynomial": ["Poly5", "Poly 6", "Poly 7", "Poly 8", "Poly", "Proportional"],
    "Power": ["Allometric1"],
    "Waveform": ["Sine", "SineDamp"],
}


@pytest.mark.parametrize("category", sorted(ORIGIN_MODELS))
def test_origin_models_registered_in_origin_categories(category: str) -> None:
    for name in ORIGIN_MODELS[category]:
        assert FIT_MODELS[name]["category"] == category, name


def test_origin_parameter_names_follow_origin() -> None:
    assert FIT_MODELS["Gauss"]["paramNames"] == ["y0", "xc", "w", "A"]
    assert FIT_MODELS["Voigt"]["paramNames"] == ["y0", "xc", "A", "wG", "wL"]
    assert FIT_MODELS["PsdVoigt2"]["paramNames"] == ["y0", "xc", "A", "wG", "wL", "mu"]
    assert FIT_MODELS["ExpDec3"]["paramNames"] == ["y0", "A1", "t1", "A2", "t2", "A3", "t3"]
    assert FIT_MODELS["ExpDecay1"]["paramNames"] == ["y0", "x0", "A1", "t1"]
    assert FIT_MODELS["Boltzmann"]["paramNames"] == ["A1", "A2", "x0", "dx"]
    assert FIT_MODELS["DoseResp"]["paramNames"] == ["A1", "A2", "LOGx0", "p"]
    assert FIT_MODELS["Hill1"]["paramNames"] == ["START", "END", "k", "n"]
    assert FIT_MODELS["Poly5"]["paramNames"] == [f"A{k}" for k in range(6)]
    assert FIT_MODELS["Poly"]["paramNames"] == [f"a{k}" for k in range(10)]
    assert FIT_MODELS["Sine"]["paramNames"] == ["xc", "w", "A", "y0"]
    assert FIT_MODELS["SineDamp"]["paramNames"] == ["y0", "xc", "w", "t0", "A"]
    assert FIT_MODELS["Logistic5"]["paramNames"] == ["Amin", "Amax", "x0", "h", "s"]
    assert FIT_MODELS["SWeibull1"]["paramNames"] == ["A", "xc", "d", "k"]
    assert FIT_MODELS["SGompertz"]["paramNames"] == ["a", "xc", "k"]


# Origin's documented default LOWER bounds (it sets no upper bounds); every
# parameter not listed is unbounded. Source: each function's Origin Help page.
ORIGIN_LOWER_BOUNDS: dict[str, dict[str, float]] = {
    "Gauss": {"w": 0}, "GaussAmp": {"w": 0}, "Lorentz": {"w": 0},
    "Voigt": {"wG": 0, "wL": 0}, "PsdVoigt1": {"w": 0}, "PsdVoigt2": {"wG": 0, "wL": 0},
    "LogNormal": {"xc": 0, "w": 0}, "Asym2Sig": {"w1": 0, "w2": 0, "w3": 0},
    "ExpGrow1": {"t1": 0},
    "Hill": {"Vmax": 0, "k": 0, "n": 0}, "Hill1": {"k": 0, "n": 0},
    "MichaelisMenten": {"Vmax": 0, "Km": 0}, "Logistic (Origin)": {"p": 0},
    "Logistic5": {"s": 0}, "SLogistic1": {"xc": 0}, "SGompertz": {"a": 0, "k": 0},
    "SWeibull1": {"A": 0, "k": 0}, "Sine": {"w": 0}, "SineDamp": {"w": 0, "t0": 0},
}


@pytest.mark.parametrize("name", [n for names in ORIGIN_MODELS.values() for n in names])
def test_origin_default_bounds_match_origin_docs(name: str) -> None:
    spec = FIT_MODELS[name]
    want = ORIGIN_LOWER_BOUNDS.get(name, {})
    got = {n: lo for n, lo in zip(spec["paramNames"], spec["lb"], strict=True) if lo != -math.inf}
    assert got == want
    assert all(hi == math.inf for hi in spec["ub"])


def test_matlab_parity_models_untouched() -> None:
    # The Origin "Logistic" must not shadow the MATLAB-parity one (golden-frozen).
    assert FIT_MODELS["Logistic"]["paramNames"] == ["A", "k", "x₀", "C"]
    assert FIT_MODELS["Logistic"]["category"] == "Sigmoid"
    assert FIT_MODELS["Gaussian"]["paramNames"] == ["A", "μ", "σ"]


def test_origin_metadata_consistent_and_p0_within_bounds() -> None:
    for names in ORIGIN_MODELS.values():
        for name in names:
            m = FIT_MODELS[name]
            assert len(m["p0"]) == len(m["lb"]) == len(m["ub"]) == m["nParams"], name
            assert all(lo <= v <= hi for v, lo, hi in zip(m["p0"], m["lb"], m["ub"], strict=True))


# ── peak functions ─────────────────────────────────────────────────────────
def test_gauss_peak_height_and_area() -> None:
    # y(xc) = y0 + A/(w*sqrt(pi/2)) = 0.5 + 3/(2*1.2533141) = 1.6968...
    assert _at("Gauss", 4.0, [0.5, 4.0, 2.0, 3.0]) == pytest.approx(0.5 + 3 / (2 * 1.2533141373155))
    # one w/2 = sigma from the centre: exp(-2*(1/2)^2) = exp(-0.5)
    assert _at("Gauss", 5.0, [0.0, 4.0, 2.0, 3.0]) == pytest.approx(
        3 / (2 * math.sqrt(math.pi / 2)) * math.exp(-0.5))
    area, _ = quad(lambda t: _at("Gauss", t, [0.0, 4.0, 2.0, 3.0]), -50, 50)
    assert area == pytest.approx(3.0, rel=1e-9)


def test_gaussamp_is_gauss_in_height_form() -> None:
    x = np.linspace(-5, 15, 41)
    sigma, height = 1.5, 2.0
    area = height * sigma * math.sqrt(2 * math.pi)
    assert_allclose(evaluate("GaussAmp", x, [0.1, 5, sigma, height]),
                    evaluate("Gauss", x, [0.1, 5, 2 * sigma, area]), rtol=1e-12)
    assert _at("GaussAmp", 5.0, [0.1, 5, sigma, height]) == pytest.approx(2.1)


def test_lorentz_height_halfwidth_and_area() -> None:
    p = [0.0, 1.0, 0.5, 2.0]  # y0, xc, w (FWHM), A (area)
    peak = 2 * 2.0 / (math.pi * 0.5)  # 2A/(pi*w) = 2.546479...
    assert _at("Lorentz", 1.0, p) == pytest.approx(peak)
    assert _at("Lorentz", 1.25, p) == pytest.approx(peak / 2)  # half max at xc +- w/2
    area, _ = quad(lambda t: _at("Lorentz", t, p), -np.inf, np.inf)
    assert area == pytest.approx(2.0, rel=1e-8)


def test_voigt_area_and_limits() -> None:
    p = [0.0, 2.0, 5.0, 1.0, 0.7]
    area, _ = quad(lambda t: _at("Voigt", t, p), -np.inf, np.inf, limit=200)
    assert area == pytest.approx(5.0, rel=1e-7)
    x = np.linspace(-2, 6, 33)
    # wL -> 0: area Gaussian of FWHM wG, i.e. Origin Gauss with w = wG/sqrt(2 ln 2).
    assert_allclose(evaluate("Voigt", x, [0.3, 2, 5, 1.0, 1e-9]),
                    evaluate("Gauss", x, [0.3, 2, 1.0 / math.sqrt(2 * math.log(2)), 5]),
                    rtol=1e-6, atol=1e-9)
    # wG -> 0: Lorentz of FWHM wL.
    assert_allclose(evaluate("Voigt", x, [0.3, 2, 5, 1e-9, 0.8]),
                    evaluate("Lorentz", x, [0.3, 2, 0.8, 5]), rtol=1e-6)


def test_psdvoigt_mixing_limits() -> None:
    x = np.linspace(-3, 7, 41)
    fw = 1.3
    assert_allclose(evaluate("PsdVoigt1", x, [0.2, 2, 4, fw, 1.0]),
                    evaluate("Lorentz", x, [0.2, 2, fw, 4]), rtol=1e-12)
    gauss_w = fw / math.sqrt(2 * math.log(2))  # Origin Gauss w = 2 sigma
    assert_allclose(evaluate("PsdVoigt1", x, [0.2, 2, 4, fw, 0.0]),
                    evaluate("Gauss", x, [0.2, 2, gauss_w, 4]), rtol=1e-12)
    assert_allclose(evaluate("PsdVoigt2", x, [0.2, 2, 4, fw, fw, 0.3]),
                    evaluate("PsdVoigt1", x, [0.2, 2, 4, fw, 0.3]), rtol=1e-12)
    area, _ = quad(lambda t: _at("PsdVoigt2", t, [0, 2, 4, 1.0, 2.0, 0.4]), -np.inf, np.inf)
    assert area == pytest.approx(4.0, rel=1e-8)


def test_lognormal_value_area_and_domain() -> None:
    # At x = xc: y = y0 + A/(sqrt(2 pi) w xc).
    assert _at("LogNormal", 2.0, [0.1, 2.0, 0.5, 3.0]) == pytest.approx(
        0.1 + 3.0 / (math.sqrt(2 * math.pi) * 0.5 * 2.0))
    area, _ = quad(lambda t: _at("LogNormal", t, [0, 2.0, 0.5, 3.0]), 0, np.inf)
    assert area == pytest.approx(3.0, rel=1e-8)
    assert math.isnan(_at("LogNormal", -1.0, [0, 2.0, 0.5, 3.0]))


def test_asym2sig_centre_value() -> None:
    # At x = xc with w1 = 0: both logistic factors are 1/2 -> y0 + A/4.
    assert _at("Asym2Sig", 3.0, [1.0, 3.0, 8.0, 0.0, 0.4, 0.9]) == pytest.approx(3.0)
    # Wide plateau: centre value -> y0 + A.
    assert _at("Asym2Sig", 0.0, [1.0, 0.0, 8.0, 50.0, 0.5, 0.5]) == pytest.approx(9.0, rel=1e-12)


# ── exponential ────────────────────────────────────────────────────────────
def test_expdec_family_values() -> None:
    assert _at("ExpDec1", 2.0, [0.5, 3.0, 2.0]) == pytest.approx(0.5 + 3 / math.e)
    assert _at("ExpDec2", 0.0, [0.5, 3.0, 2.0, 1.0, 9.0]) == pytest.approx(4.5)
    assert _at("ExpDec3", 1.0, [0, 1, 1, 1, 2, 1, 4]) == pytest.approx(
        math.exp(-1) + math.exp(-0.5) + math.exp(-0.25))
    # x0 variants: ExpDecay1 at x = x0 + t1 is y0 + A1/e.
    assert _at("ExpDecay1", 7.0, [0.5, 5.0, 3.0, 2.0]) == pytest.approx(0.5 + 3 / math.e)
    x = np.linspace(0, 5, 11)
    assert_allclose(evaluate("ExpDecay3", x, [0.2, 0.0, 1, 1, 2, 2, 3, 3]),
                    evaluate("ExpDec3", x, [0.2, 1, 1, 2, 2, 3, 3]), rtol=1e-14)


def test_expgro_family_values() -> None:
    assert _at("ExpGro1", 2.0, [0.5, 3.0, 2.0]) == pytest.approx(0.5 + 3 * math.e)
    assert _at("ExpGro2", 0.0, [0.5, 3.0, 2.0, 1.0, 9.0]) == pytest.approx(4.5)
    assert _at("ExpGrow1", 3.0, [0.0, 1.0, 2.0, 2.0]) == pytest.approx(2 * math.e)
    assert _at("ExpGrow2", 1.0, [1.0, 1.0, 2.0, 2.0, 3.0, 3.0]) == pytest.approx(6.0)


# ── growth / sigmoidal ─────────────────────────────────────────────────────
def test_sigmoid_midpoints() -> None:
    assert _at("Boltzmann", 1.5, [-1.0, 3.0, 1.5, 0.7]) == pytest.approx(1.0)
    assert _at("Boltzmann", -1e3, [-1.0, 3.0, 1.5, 0.7]) == pytest.approx(-1.0)  # A1 at left
    assert _at("DoseResp", 0.4, [-1.0, 3.0, 0.4, 1.3]) == pytest.approx(1.0)
    assert _at("DoseResp", 10.0, [-1.0, 3.0, 0.4, 1.3]) == pytest.approx(3.0)  # A2 at high dose
    assert _at("Hill", 2.5, [4.0, 2.5, 3.0]) == pytest.approx(2.0)
    assert _at("Hill1", 2.5, [1.0, 5.0, 2.5, 3.0]) == pytest.approx(3.0)
    assert _at("MichaelisMenten", 0.8, [6.0, 0.8]) == pytest.approx(3.0)
    assert _at("Logistic (Origin)", 4.0, [1.0, 5.0, 4.0, 2.0]) == pytest.approx(3.0)
    # Logistic5 at x0: Amin + (Amax-Amin)/2^s = 1 + 4/4.
    assert _at("Logistic5", 4.0, [1.0, 5.0, 4.0, 2.0, 2.0]) == pytest.approx(2.0)
    # h > 0 rises from Amin (x -> 0) to Amax (x -> inf): (x/x0)^(-h) = 4 at x = 2.
    assert _at("Logistic5", 2.0, [1.0, 5.0, 4.0, 2.0, 1.0]) == pytest.approx(1 + 4 / 5)
    assert _at("Logistic5", 1e6, [1.0, 5.0, 4.0, 2.0, 2.0]) == pytest.approx(5.0)
    assert _at("SLogistic1", 1.0, [6.0, 1.0, 3.0]) == pytest.approx(3.0)
    assert _at("SGompertz", 1.0, [6.0, 1.0, 3.0]) == pytest.approx(6 / math.e)


def test_logistic5_with_s_one_is_the_four_parameter_logistic() -> None:
    x = np.linspace(0.2, 30, 25)
    # Amin + (Amax-Amin)/(1+(x/x0)^-h) == A2 + (A1-A2)/(1+(x/x0)^p), A1=Amin, A2=Amax.
    assert_allclose(evaluate("Logistic5", x, [1.0, 5.0, 4.0, 2.5, 1.0]),
                    evaluate("Logistic (Origin)", x, [1.0, 5.0, 4.0, 2.5]), rtol=1e-12)


def test_sweibull1_values_and_onset_clamp() -> None:
    p = [5.0, 2.0, 2.0, 0.5]  # A, xc, d, k
    assert _at("SWeibull1", 4.0, p) == pytest.approx(5 * (1 - 1 / math.e))  # k(x-xc) = 1
    assert _at("SWeibull1", 2.0, p) == pytest.approx(0.0)
    assert _at("SWeibull1", -3.0, p) == pytest.approx(0.0)  # before onset: flat, not NaN


def test_logistic_origin_domain() -> None:
    assert math.isnan(_at("Logistic (Origin)", -1.0, [1.0, 5.0, 4.0, 2.5]))


# ── polynomial / power / waveform ─────────────────────────────────────────
@pytest.mark.parametrize(("order", "name"), [(5, "Poly5"), (6, "Poly 6"), (7, "Poly 7"),
                                             (8, "Poly 8"), (9, "Poly")])
def test_poly_matches_ascending_coefficients(order: int, name: str) -> None:
    coef = [0.5 * (k + 1) * (-1) ** k for k in range(order + 1)]
    assert _at(name, 1.0, coef) == pytest.approx(sum(coef))
    x = np.linspace(-2, 2, 9)
    assert_allclose(evaluate(name, x, coef),
                    np.polynomial.polynomial.polyval(x, coef), rtol=1e-12)


def test_proportional_allometric1() -> None:
    assert _at("Proportional", -2.0, [1.5]) == pytest.approx(-3.0)
    assert _at("Allometric1", 4.0, [3.0, 0.5]) == pytest.approx(6.0)
    assert math.isnan(_at("Allometric1", -4.0, [3.0, 0.5]))


def test_sine_and_sinedamp_values() -> None:
    p = [1.0, 2.0, 3.0, 0.5]  # xc, w, A, y0 (Origin's order); period 2w = 4
    assert _at("Sine", 1.0, p) == pytest.approx(0.5)
    assert _at("Sine", 2.0, p) == pytest.approx(3.5)  # quarter period after xc
    assert _at("Sine", 5.0, p) == pytest.approx(0.5, abs=1e-12)  # one full period later
    assert _at("SineDamp", 2.0, [0.5, 1.0, 2.0, 4.0, 3.0]) == pytest.approx(
        0.5 + 3 * math.exp(-0.5))


# ── auto-guess fallbacks ──────────────────────────────────────────────────
@pytest.mark.parametrize("name", [n for names in ORIGIN_MODELS.values() for n in names])
def test_origin_guess_never_raises_on_degenerate_data(name: str) -> None:
    p0 = FIT_MODELS[name]["p0"]
    for x, y in (([1.0, 2.0], [3.0, 4.0]),  # too few points
                 (np.zeros(20), np.arange(20.0)),  # no x span
                 (np.linspace(-5, 5, 30), np.full(30, 2.0)),  # flat y
                 (np.linspace(-5, 5, 30), np.where(np.arange(30) % 7, 1.0, np.nan))):  # NaNs
        g = auto_guess(name, x, y)
        assert len(g) == len(p0) and all(math.isfinite(v) for v in g), (name, g)


def test_lognormal_guess_falls_back_off_domain() -> None:
    x = np.linspace(-10, -1, 40)
    defaults = [float(v) for v in FIT_MODELS["LogNormal"]["p0"]]
    assert auto_guess("LogNormal", x, np.exp(-x)) == defaults


def test_guess_ignores_nonfinite_points_and_order() -> None:
    x = np.linspace(0, 20, 201)
    y = evaluate("Gauss", x, [0.2, 9.0, 2.0, 10.0])
    perm = np.random.default_rng(3).permutation(x.size)
    xs, ys = x[perm].copy(), y[perm].copy()
    ys[:5] = np.nan
    g = auto_guess("Gauss", xs, ys)
    assert_allclose(g, [0.2, 9.0, 2.0, 10.0], rtol=1e-6, atol=1e-6)


@pytest.mark.parametrize("name", [n for names in ORIGIN_MODELS.values() for n in names])
def test_origin_evaluators_never_raise_at_extreme_parameters(name: str) -> None:
    """Zero widths / overflowing powers give inf or NaN, never a Python exception.

    Regression: scalar math on Python floats raised OverflowError (Hill's k**n
    for a large k and n) and ZeroDivisionError (Gauss at w = 0, e.g. a fit with
    w held at 0), aborting the fit or a scan candidate where numpy returns
    inf/NaN and the optimizer simply rejects the point.
    """
    n = FIT_MODELS[name]["nParams"]
    x = np.array([-2.0, 0.0, 0.5, 3.0])
    with np.errstate(all="ignore"):
        for value in (0.0, 1e300, -1e300, 1e-300):
            out = evaluate(name, x, [value] * n)
            assert out.shape == x.shape, name


def test_exp_guess_orders_time_constants_ascending() -> None:
    x = np.linspace(0, 40, 801)
    # Truth deliberately listed slow-first; the guess reports t1 < t2 < t3.
    y = evaluate("ExpDec3", x, [0.1, 2.0, 8.0, 3.0, 1.0, 4.0, 0.2])
    g = auto_guess("ExpDec3", x, y)
    assert g[2] < g[4] < g[6]
    assert_allclose([g[2], g[4], g[6]], [0.2, 1.0, 8.0], rtol=1e-3)
    assert_allclose([g[1], g[3], g[5]], [4.0, 3.0, 2.0], rtol=1e-3)


def test_guess_subsamples_large_inputs() -> None:
    xs, ys = prepare(np.linspace(0, 1, 25_000), np.linspace(0, 1, 25_000))
    assert xs.size == MAX_GUESS_POINTS == 1000
    assert xs[0] == 0.0 and xs[-1] == 1.0


def test_guess_that_raises_falls_back_to_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    from quantized.calc import fit_autoguess

    def boom(x: np.ndarray, y: np.ndarray) -> list[float]:
        raise FloatingPointError("overflow")

    monkeypatch.setitem(fit_autoguess._ORIGIN_GUESSES, "Gauss", boom)
    x = np.linspace(0, 10, 50)
    assert auto_guess("Gauss", x, np.exp(-((x - 5) ** 2))) == [0.0, 0.0, 1.0, 1.0]


def test_psdvoigt_mu_is_unbounded_like_origin() -> None:
    # mu = 1.2 is a legal Origin parameter value: evaluates, not clipped.
    x = np.linspace(-3, 7, 11)
    want = 1.2 * evaluate("Lorentz", x, [0, 2, 1.3, 4]) - 0.2 * evaluate(
        "Gauss", x, [0, 2, 1.3 / math.sqrt(2 * math.log(2)), 4])
    assert_allclose(evaluate("PsdVoigt1", x, [0, 2, 4, 1.3, 1.2]), want, rtol=1e-12)
