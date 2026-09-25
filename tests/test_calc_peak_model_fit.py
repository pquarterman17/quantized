"""fit_peak_model: mixed-shape peak fitting (calc/peak_model_fit.py, audit P2.4).

New capability beside the golden-parity global fit (peak_multifit stays the
MATLAB port), so it is verified by recovering the known truth of seeded
synthetic data and by invariants: ties, fixed and bounded parameters,
degeneracy detection, weighting labels, derived-area closed forms and their
delta-method errors (checked exactly against the covariance, and loosely
against a Monte-Carlo spread), the x-range/NaN handling and the deadline.
Tolerances were measured first (2026-09-25) and set with >=3x headroom.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest
from scipy.integrate import quad

from quantized.calc.peak_model import PeakModel, peak_area, peak_fwhm, shape_curve
from quantized.calc.peak_model_fit import fit_peak_model

_LN2 = math.log(2.0)


def P(name: str, value: float, lo: float | None = None, hi: float | None = None, *,
      vary: bool = True, tie: str | None = None) -> dict[str, Any]:
    p: dict[str, Any] = {"name": name, "value": value, "vary": vary, "tie": tie}
    if lo is not None:
        p["min"] = lo
    if hi is not None:
        p["max"] = hi
    return p


def by_name(out: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in out["parameters"]}


def synth(shapes: list[str], background: str, truth: dict[str, float], x: np.ndarray,
          noise: float, seed: int, x_ref: float = 0.0) -> np.ndarray:
    m = PeakModel(shapes, background, x_ref)
    v = np.array([truth[n] for n in m.names])
    return m.evaluate(x, v) + np.random.default_rng(seed).normal(0.0, noise, x.size)


def integral(f: Any, centre: float) -> float:
    """Integral over the real line, split at the peak so quad cannot miss it."""
    return float(quad(f, -np.inf, centre, limit=400)[0] + quad(f, centre, np.inf, limit=400)[0])


def cov_from(out: dict[str, Any]) -> tuple[list[str], np.ndarray]:
    """Rebuild the free-parameter covariance from reported stderr + correlation."""
    p = by_name(out)
    sd = np.array([p[n]["stderr"] for n in out["free"]], dtype=float)
    corr = np.array(out["correlation"], dtype=float)
    return out["free"], corr * np.outer(sd, sd)


# ── (a) three mixed, overlapping peaks on a linear background ───────────────

MIXED = ["gaussian", "lorentzian", "pseudo_voigt"]
MIXED_TRUTH = {
    "p0.center": 40.0, "p0.height": 100.0, "p0.fwhm": 0.30,
    "p1.center": 40.45, "p1.height": 60.0, "p1.fwhm": 0.25,
    "p2.center": 41.0, "p2.height": 80.0, "p2.fwhm": 0.35, "p2.eta": 0.4,
    "bg.c0": 10.0, "bg.c1": -3.0,
}
MIXED_START = {
    "p0.center": 39.95, "p0.height": 90, "p0.fwhm": 0.25, "p1.center": 40.5,
    "p1.height": 50, "p1.fwhm": 0.3, "p2.center": 41.05, "p2.height": 70,
    "p2.fwhm": 0.3, "p2.eta": 0.5, "bg.c0": 8, "bg.c1": 0,
}
X_MIXED = np.linspace(39.0, 42.0, 601)


def mixed_data(seed: int = 1) -> np.ndarray:
    return synth(MIXED, "linear", MIXED_TRUTH, X_MIXED, 1.0, seed, x_ref=40.5)


def test_recovers_three_mixed_overlapping_peaks_and_linear_background() -> None:
    out = fit_peak_model(X_MIXED, mixed_data(), MIXED,
                         [P(n, v) for n, v in MIXED_START.items()], background="linear",
                         bg_x_ref=40.5)
    assert out["success"] and out["warnings"] == []
    p = by_name(out)
    # Measured: every parameter within 1.9 stderr of the truth (seed 1).
    for name, truth in MIXED_TRUTH.items():
        assert p[name]["stderr"] is not None and p[name]["stderr"] > 0
        assert abs(p[name]["value"] - truth) < 4 * p[name]["stderr"], name
    assert [pk["shape"] for pk in out["peaks"]] == MIXED
    mt = out["metrics"]
    assert (mt["n_points"], mt["n_free"], mt["dof"]) == (601, 12, 589)
    assert mt["reduced_ssr"] == pytest.approx(1.0, abs=0.2)  # noise sigma 1
    assert mt["r_squared"] > 0.998 and mt["adj_r_squared"] < mt["r_squared"]
    assert mt["aic"] < mt["bic"]
    c = out["curves"]
    total = np.array(c["background"]) + np.sum(c["components"], axis=0)
    np.testing.assert_allclose(total, c["model"], rtol=1e-12, atol=1e-9)
    np.testing.assert_allclose(np.array(c["y"]) - c["model"], c["residual"], atol=1e-9)
    corr = np.array(out["correlation"], dtype=float)
    assert corr.shape == (12, 12)
    np.testing.assert_allclose(np.diag(corr), 1.0, atol=1e-9)


def test_parameters_can_be_given_in_any_order() -> None:
    specs = [P(n, v) for n, v in MIXED_START.items()]
    a = fit_peak_model(X_MIXED, mixed_data(), MIXED, specs, bg_x_ref=40.5)
    b = fit_peak_model(X_MIXED, mixed_data(), MIXED, specs[::-1], bg_x_ref=40.5)
    assert [q["value"] for q in a["parameters"]] == [q["value"] for q in b["parameters"]]


# ── (b) tied FWHM, (c) fixed centre ─────────────────────────────────────────

TWO_TRUTH = {"p0.center": -1.0, "p0.height": 50.0, "p0.fwhm": 1.2,
             "p1.center": 1.5, "p1.height": 30.0, "p1.fwhm": 1.2, "bg.c0": 2.0}
X_TWO = np.linspace(-6.0, 6.0, 481)


def two_specs(**over: dict[str, Any]) -> list[dict[str, Any]]:
    start = {"p0.center": -0.8, "p0.height": 40.0, "p0.fwhm": 1.0,
             "p1.center": 1.3, "p1.height": 25.0, "p1.fwhm": 1.0, "bg.c0": 0.0}
    specs = {n: P(n, v) for n, v in start.items()}
    for n, patch in over.items():
        specs[n.replace("_", ".", 1)].update(patch)
    return list(specs.values())


def test_tied_fwhm_is_shared_and_carries_its_targets_error() -> None:
    y = synth(["gaussian", "lorentzian"], "constant", TWO_TRUTH, X_TWO, 0.5, seed=3)
    out = fit_peak_model(X_TWO, y, ["gaussian", "lorentzian"],
                         two_specs(p1_fwhm={"tie": "p0.fwhm"}), background="constant")
    assert out["success"]
    p = by_name(out)
    assert "p1.fwhm" not in out["free"] and not p["p1.fwhm"]["vary"]
    assert p["p1.fwhm"]["tie"] == "p0.fwhm"
    assert p["p1.fwhm"]["value"] == p["p0.fwhm"]["value"]
    assert p["p1.fwhm"]["stderr"] == p["p0.fwhm"]["stderr"] is not None
    assert p["p0.fwhm"]["value"] == pytest.approx(1.2, abs=4 * p["p0.fwhm"]["stderr"])
    # p1's area depends on p0.fwhm through the tie: the delta method must see it.
    names, cov = cov_from(out)
    h1, w = p["p1.height"]["value"], p["p0.fwhm"]["value"]
    g = np.zeros(len(names))
    g[names.index("p1.height")] = w * math.pi / 2
    g[names.index("p0.fwhm")] = h1 * math.pi / 2
    assert out["peaks"][1]["area_stderr"] == pytest.approx(math.sqrt(g @ cov @ g), rel=1e-6)


def test_fixed_centre_is_held_and_has_no_error() -> None:
    y = synth(["gaussian", "gaussian"], "constant", TWO_TRUTH, X_TWO, 0.5, seed=4)
    out = fit_peak_model(X_TWO, y, ["gaussian", "gaussian"],
                         two_specs(p0_center={"value": -1.0, "vary": False}),
                         background="constant")
    p = by_name(out)
    assert p["p0.center"]["value"] == -1.0 and p["p0.center"]["stderr"] is None
    assert not p["p0.center"]["vary"] and "p0.center" not in out["free"]
    assert out["peaks"][0]["center_stderr"] is None
    assert out["peaks"][0]["area_stderr"] is not None  # height/fwhm still free
    assert p["p1.center"]["value"] == pytest.approx(1.5, abs=4 * p["p1.center"]["stderr"])
    assert out["metrics"]["n_free"] == 6


# ── (d) bounds, (e) degeneracy ──────────────────────────────────────────────

def test_bounds_are_respected_and_a_bound_hit_is_flagged() -> None:
    y = synth(["gaussian", "gaussian"], "constant", TWO_TRUTH, X_TWO, 0.5, seed=5)
    out = fit_peak_model(X_TWO, y, ["gaussian", "gaussian"],
                         two_specs(p0_fwhm={"min": 0.5, "max": 0.9, "value": 0.8}),
                         background="constant")
    p = by_name(out)
    assert 0.5 <= p["p0.fwhm"]["value"] <= 0.9
    assert p["p0.fwhm"]["value"] == pytest.approx(0.9, abs=1e-5)
    assert p["p0.fwhm"]["at_bound"] and p["p0.fwhm"]["stderr"] is None
    assert not p["p1.fwhm"]["at_bound"] and p["p1.fwhm"]["stderr"] is not None
    assert any("on a bound" in w and "p0.fwhm" in w for w in out["warnings"])
    # A derived quantity built on a bound parameter has no error either.
    assert out["peaks"][0]["fwhm_stderr"] is None and out["peaks"][0]["area_stderr"] is None
    assert out["peaks"][1]["area_stderr"] is not None


def test_identical_coincident_peaks_are_reported_undetermined() -> None:
    x = np.linspace(-5.0, 5.0, 401)
    y = 100 * np.exp(-4 * _LN2 * x**2) + 5 + np.random.default_rng(2).normal(0, 1, x.size)
    specs = [P("p0.center", 0.0, vary=False), P("p0.height", 40.0),
             P("p0.fwhm", 1.0, vary=False), P("p1.center", 0.0, vary=False),
             P("p1.height", 60.0), P("p1.fwhm", 1.0, vary=False), P("bg.c0", 0.0)]
    out = fit_peak_model(x, y, ["gaussian", "gaussian"], specs, background="constant")
    p = by_name(out)
    assert p["p0.height"]["stderr"] is None and p["p1.height"]["stderr"] is None
    assert p["bg.c0"]["stderr"] is not None  # the background is still determined
    assert out["peaks"][0]["area_stderr"] is None and out["peaks"][1]["area_stderr"] is None
    assert any("do not determine" in w and "p0.height, p1.height" in w
               for w in out["warnings"])
    assert any("overlap" in w for w in out["warnings"])
    # The SUM is still what the data say.
    assert p["p0.height"]["value"] + p["p1.height"]["value"] == pytest.approx(100, abs=1)


# ── (f) weighting labels ────────────────────────────────────────────────────

def test_weighting_labels_the_objective_honestly() -> None:
    y = mixed_data(seed=6)
    specs = [P(n, v) for n, v in MIXED_START.items()]
    plain = fit_peak_model(X_MIXED, y, MIXED, specs, bg_x_ref=40.5)
    w2 = fit_peak_model(X_MIXED, y, MIXED, specs, bg_x_ref=40.5,
                        y_err=np.full(X_MIXED.size, 2.0))
    mp, mw = plain["metrics"], w2["metrics"]
    assert not plain["weighted"] and mp["objective"] == "ssr"
    assert mp["chi2"] is None and mp["reduced_chi2"] is None
    assert plain["curves"]["normalized_residual"] is None
    assert w2["weighted"] and mw["objective"] == "chi2"
    assert mw["chi2"] == pytest.approx(mw["ssr"] / 4.0, rel=1e-9)
    assert mw["reduced_chi2"] == pytest.approx(mw["chi2"] / mw["dof"], rel=1e-12)
    # A uniform error rescales chi2 but not the fit, R^2 or the scaled errors.
    for a, b in zip(plain["parameters"], w2["parameters"], strict=True):
        assert b["value"] == pytest.approx(a["value"], rel=1e-6, abs=1e-8)
        assert b["stderr"] == pytest.approx(a["stderr"], rel=1e-4)
    assert mw["r_squared"] == pytest.approx(mp["r_squared"], rel=1e-9)


def test_non_uniform_weights_downweight_noisy_points() -> None:
    x = np.linspace(-4, 4, 321)
    err = np.where(x > 0, 5.0, 0.2)
    y = 20 * np.exp(-4 * _LN2 * x**2) + np.random.default_rng(7).normal(0, 1, x.size) * err
    specs = [P("p0.center", 0.2), P("p0.height", 15.0), P("p0.fwhm", 1.3), P("bg.c0", 0.0)]
    w = fit_peak_model(x, y, ["gaussian"], specs, background="constant", y_err=err)
    u = fit_peak_model(x, y, ["gaussian"], specs, background="constant")
    # Measured: height stderr 0.095 weighted vs 0.74 unweighted.
    for name in ("p0.height", "p0.fwhm", "p0.center"):
        assert by_name(w)[name]["stderr"] < 0.4 * by_name(u)[name]["stderr"], name
    assert w["metrics"]["reduced_chi2"] == pytest.approx(1.0, abs=0.25)  # measured 0.85


# ── (g) derived area and FWHM closed forms ──────────────────────────────────

@pytest.mark.parametrize(("shape", "p"), [
    ("gaussian", [0.3, 12.0, 0.8]),
    ("lorentzian", [0.3, 12.0, 0.8]),
    ("pseudo_voigt", [0.3, 12.0, 0.8, 0.35]),
    ("voigt", [0.3, 12.0, 0.6, 0.4]),
])
def test_area_and_fwhm_closed_forms_match_numerics(shape: str, p: list[float]) -> None:
    area = integral(lambda t: float(shape_curve(shape, np.array([t]), p)[0]), p[0])
    assert peak_area(shape, p) == pytest.approx(area, rel=1e-7)
    xs = np.linspace(p[0] - 3, p[0] + 3, 600_001)
    above = xs[shape_curve(shape, xs, p) >= 0.5 * p[1]]
    assert peak_fwhm(shape, p) == pytest.approx(above[-1] - above[0], rel=5e-4)
    assert float(shape_curve(shape, np.array([p[0]]), p)[0]) == pytest.approx(p[1], rel=1e-12)


def test_fitted_area_matches_integrating_the_component_curve() -> None:
    out = fit_peak_model(X_MIXED, mixed_data(), MIXED,
                         [P(n, v) for n, v in MIXED_START.items()], bg_x_ref=40.5)
    m = PeakModel(MIXED, "linear", 40.5)
    v = np.array([by_name(out)[n]["value"] for n in m.names])
    for k, pk in enumerate(out["peaks"]):
        area = integral(lambda t, k=k: float(m.component(k, np.array([t]), v)[0]),
                        pk["center"])
        assert pk["area"] == pytest.approx(area, rel=1e-7)


def test_voigt_peak_is_recovered() -> None:
    truth = {"p0.center": 0.2, "p0.height": 40.0, "p0.fwhm_g": 0.7, "p0.fwhm_l": 0.5,
             "bg.c0": 1.0}
    x = np.linspace(-6, 6, 801)
    y = synth(["voigt"], "constant", truth, x, 0.2, seed=8)
    start = {"p0.center": 0.0, "p0.height": 35.0, "p0.fwhm_g": 0.5, "p0.fwhm_l": 0.6,
             "bg.c0": 0.0}
    out = fit_peak_model(x, y, ["voigt"], [P(n, v) for n, v in start.items()],
                         background="constant")
    p = by_name(out)
    assert out["success"] and out["warnings"] == []
    for name, t in truth.items():
        assert abs(p[name]["value"] - t) < 4 * p[name]["stderr"], name
    assert out["peaks"][0]["fwhm_stderr"] is not None


# ── (h) delta-method area error: exact vs covariance, loose vs Monte Carlo ──

def _single(seed: int) -> dict[str, Any]:
    x = np.linspace(-3, 3, 121)
    y = synth(["gaussian"], "constant",
              {"p0.center": 0.2, "p0.height": 10.0, "p0.fwhm": 1.1, "bg.c0": 1.0},
              x, 0.5, seed)
    specs = [P("p0.center", 0.0), P("p0.height", 8.0), P("p0.fwhm", 1.0), P("bg.c0", 0.5)]
    return fit_peak_model(x, y, ["gaussian"], specs, background="constant")


def test_area_error_is_the_delta_method_on_the_covariance() -> None:
    out = _single(11)
    p = by_name(out)
    names, cov = cov_from(out)
    h, w = p["p0.height"]["value"], p["p0.fwhm"]["value"]
    k = math.sqrt(math.pi / _LN2) / 2
    g = np.zeros(len(names))
    g[names.index("p0.height")], g[names.index("p0.fwhm")] = w * k, h * k
    assert out["peaks"][0]["area_stderr"] == pytest.approx(math.sqrt(g @ cov @ g), rel=1e-6)
    # Height and FWHM are anti-correlated, so ignoring the covariance would be wrong.
    diag = math.sqrt((w * k * p["p0.height"]["stderr"]) ** 2
                     + (h * k * p["p0.fwhm"]["stderr"]) ** 2)
    # (measured: 0.222 with the covariance, 0.280 without)
    assert abs(out["peaks"][0]["area_stderr"] - diag) > 0.1 * diag


def test_area_error_agrees_with_monte_carlo_spread() -> None:
    # Measured 2026-09-25: ratio 0.89 over these 150 draws (0.93 over 400).
    fits = [_single(1000 + s)["peaks"][0] for s in range(150)]
    mc_sd = float(np.std([f["area"] for f in fits], ddof=1))
    delta = float(np.median([f["area_stderr"] for f in fits]))
    assert 0.7 < delta / mc_sd < 1.4


# ── (5) x-range and non-finite rows; centre outside range ───────────────────

def test_x_range_and_non_finite_rows() -> None:
    y = mixed_data().copy()
    x = X_MIXED.copy()
    y[[3, 10]] = np.nan
    x[20] = np.inf
    out = fit_peak_model(x, y, MIXED, [P(n, v) for n, v in MIXED_START.items()],
                         x_min=39.5, x_max=41.5, bg_x_ref=40.5)
    assert out["n_dropped"] == 3
    inside = (X_MIXED >= 39.5) & (X_MIXED <= 41.5)
    assert out["metrics"]["n_points"] == int(inside.sum())
    assert out["n_excluded"] == 601 - 3 - int(inside.sum())
    assert out["x_range"] == [pytest.approx(39.5), pytest.approx(41.5)]
    assert min(out["curves"]["x"]) >= 39.5 and max(out["curves"]["x"]) <= 41.5
    assert any("3 rows" in w for w in out["warnings"])


def test_centre_outside_the_fitted_range_is_flagged() -> None:
    x = np.linspace(0.0, 5.0, 251)
    y = synth(["gaussian"], "none", {"p0.center": -0.3, "p0.height": 20.0, "p0.fwhm": 1.0},
              x, 0.1, seed=9)
    out = fit_peak_model(x, y, ["gaussian"],
                         [P("p0.center", 0.1), P("p0.height", 15.0), P("p0.fwhm", 1.2)],
                         background="none")
    assert out["peaks"][0]["center"] < 0
    assert any("outside the fitted x-range" in w for w in out["warnings"])


def test_a_negative_peak_is_flagged_when_bounds_allow_it() -> None:
    x = np.linspace(-3, 3, 201)
    y = synth(["lorentzian"], "constant",
              {"p0.center": 0.0, "p0.height": -8.0, "p0.fwhm": 0.8, "bg.c0": 10.0}, x, 0.1, 10)
    out = fit_peak_model(x, y, ["lorentzian"],
                         [P("p0.center", 0.1), P("p0.height", -5.0), P("p0.fwhm", 1.0),
                          P("bg.c0", 9.0)], background="constant")
    assert out["peaks"][0]["area"] < 0
    assert any("negative height" in w for w in out["warnings"])


# ── (k) deadline, max_nfev ──────────────────────────────────────────────────

def test_deadline_stops_the_fit_and_reports_the_best_point() -> None:
    specs = [P(n, v) for n, v in MIXED_START.items()]
    out = fit_peak_model(X_MIXED, mixed_data(), MIXED, specs, bg_x_ref=40.5, deadline_s=0.0)
    assert not out["success"] and "time limit" in out["message"]
    assert any("time limit" in w for w in out["warnings"])
    p = by_name(out)
    assert all(p[n]["value"] == pytest.approx(v) for n, v in MIXED_START.items())
    assert all(q["stderr"] is None for q in out["parameters"])
    assert all(pk["area_stderr"] is None for pk in out["peaks"])
    assert out["correlation"] == []


def test_evaluation_budget_exhaustion_is_not_reported_as_success() -> None:
    specs = [P(n, v) for n, v in MIXED_START.items()]
    out = fit_peak_model(X_MIXED, mixed_data(), MIXED, specs, bg_x_ref=40.5, max_nfev=2)
    assert not out["success"]
    assert any("without converging" in w for w in out["warnings"])


def test_all_fixed_model_just_evaluates() -> None:
    specs = [P(n, v, vary=False) for n, v in MIXED_TRUTH.items()]
    out = fit_peak_model(X_MIXED, mixed_data(), MIXED, specs, bg_x_ref=40.5)
    assert out["success"] and out["free"] == [] and out["metrics"]["n_free"] == 0
    assert all(pk["area_stderr"] is None for pk in out["peaks"])


# ── (i) validation ──────────────────────────────────────────────────────────

def _fit_two(specs: list[dict[str, Any]], **kw: Any) -> dict[str, Any]:
    return fit_peak_model(X_TWO, np.ones(X_TWO.size), ["gaussian", "pseudo_voigt"], specs,
                          background="constant", **kw)


def _two_pv() -> list[dict[str, Any]]:
    return [P("p0.center", -1.0), P("p0.height", 5.0), P("p0.fwhm", 1.0),
            P("p1.center", 1.0), P("p1.height", 5.0), P("p1.fwhm", 1.0),
            P("p1.eta", 0.5), P("bg.c0", 0.0)]


def _patched(name: str, **patch: Any) -> list[dict[str, Any]]:
    specs = _two_pv()
    for s in specs:
        if s["name"] == name:
            s.update(patch)
    return specs


@pytest.mark.parametrize(("specs", "match"), [
    (_two_pv() + [P("p2.center", 0.0)], "unknown parameter p2.center"),
    (_two_pv()[:-1], "missing parameters: bg.c0"),
    (_two_pv() + [P("p0.center", 0.0)], "unique"),
    (_patched("p1.fwhm", tie="p9.fwhm"), "tied to unknown parameter p9.fwhm"),
    (_patched("p1.fwhm", tie="p1.fwhm"), "tied to itself"),
    (_patched("p0.fwhm", tie="p1.fwhm")[:2]
     + [P("p0.fwhm", 1.0, tie="p1.fwhm")] + _patched("p1.fwhm", tie="p0.fwhm")[3:],
     "cycle"),
    (_patched("p1.fwhm", tie="p0.fwhm")[:2] + [P("p0.fwhm", 1.0, vary=False)]
     + _patched("p1.fwhm", tie="p0.fwhm")[3:], "which is fixed"),
    (_patched("p1.fwhm", tie="p0.height"), "ties join parameters of one kind"),
    (_patched("p0.height", min=10.0, max=2.0), "min \\(10\\) is greater than max \\(2\\)"),
    (_patched("p0.height", min=10.0, max=20.0), "start value 5 is outside"),
    (_patched("p0.height", min=5.0, max=5.0), "min equals max"),
    (_patched("p0.fwhm", value=-1.0), "width must be positive"),
    (_patched("p0.fwhm", min=0.0), "min must be positive"),
    (_patched("p1.eta", value=1.5), "eta must lie in"),
    (_patched("p1.eta", max=2.0), "eta bounds"),
    (_patched("p0.center", value=math.nan), "must be finite"),
    (_patched("p0.center", min=-math.inf), "min must be finite"),
])
def test_invalid_models_are_refused(specs: list[dict[str, Any]], match: str) -> None:
    with pytest.raises(ValueError, match=match):
        _fit_two(specs)


def test_tie_chain_to_a_free_root_is_allowed() -> None:
    specs = [P("p0.center", -2.0), P("p0.height", 5.0), P("p0.fwhm", 1.0),
             P("p1.center", 0.0), P("p1.height", 5.0), P("p1.fwhm", 1.0, tie="p0.fwhm"),
             P("p2.center", 2.0), P("p2.height", 5.0), P("p2.fwhm", 1.0, tie="p1.fwhm"),
             P("bg.c0", 0.0)]
    x = np.linspace(-5, 5, 201)
    out = fit_peak_model(x, np.ones(x.size), ["gaussian"] * 3, specs, background="constant")
    p = by_name(out)
    assert p["p2.fwhm"]["value"] == p["p0.fwhm"]["value"]


@pytest.mark.parametrize(("kw", "match"), [
    ({"x": [0.0, 1.0, 2.0], "y": [1.0, 2.0]}, "same length"),
    ({"y_err": [1.0, 1.0]}, "y_err must have the same length"),
    ({"y_err": np.full(X_TWO.size, -1.0)}, "y_err must be positive"),
    ({"x_min": 2.0, "x_max": 1.0}, "x_min must be less than x_max"),
    ({"x_min": 5.9, "x_max": 5.91}, "at least 2 distinct"),
    ({"x_min": 5.85}, "7 usable points cannot constrain 8"),
    ({"shapes": ["gaussian", "cauchy"]}, "unknown shape"),
    ({"shapes": []}, "at least one peak"),
    ({"background": "cubic"}, "background must be one of"),
])
def test_invalid_data_or_options_are_refused(kw: dict[str, Any], match: str) -> None:
    args: dict[str, Any] = {"x": X_TWO, "y": np.ones(X_TWO.size),
                            "shapes": ["gaussian", "pseudo_voigt"],
                            "parameters": _two_pv(), "background": "constant"}
    args.update(kw)
    with pytest.raises(ValueError, match=match):
        fit_peak_model(args.pop("x"), args.pop("y"), args.pop("shapes"),
                       args.pop("parameters"), **args)
