"""A model that raises outside its domain must not turn a fit into a failure.

Pass-5 finding B1: Pseudo-Voigt (height form) fitted nothing real because the
routes handed ``curve_fit`` OPEN bounds, the optimiser stepped ``eta`` outside
[0, 1] and ``peakshapes.pseudo_voigt`` raised inside the objective (a 422
"eta must be in [0, 1]"). The class: every registry solver path honours the
model's domain bounds, and nothing a model raises reaches the user as a failed
fit.
"""

from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.api import fit_model
from quantized.app import create_app
from quantized.calc.batch_fit import batch_fit
from quantized.calc.fit_models import FIT_MODELS, evaluate, register_model, with_domain_bounds
from quantized.calc.fitting import curve_fit

client = TestClient(create_app())


def _pv_data(eta: float, seed: int = 3) -> tuple[np.ndarray, np.ndarray]:
    x = np.linspace(0.0, 10.0, 241)
    y = evaluate("Pseudo-Voigt", x, np.array([1000.0, 5.0, 0.3, eta]))
    return x, y + np.random.default_rng(seed).normal(0.0, 6.0, x.size)


@pytest.mark.parametrize("eta", [0.3, 0.98])
def test_pseudo_voigt_recovers_eta_within_its_error(eta: float) -> None:
    x, y = _pv_data(eta)
    r = fit_model("Pseudo-Voigt", x, y)
    assert r["exitFlag"] == 1 and not r["warnings"]
    got, err = float(r["params"][3]), float(r["errors"][3])
    assert 0.0 <= got <= 1.0
    assert abs(got - eta) <= max(2.0 * err, 1e-6)
    np.testing.assert_allclose(r["params"][:3], [1000.0, 5.0, 0.3], rtol=0.03)


@pytest.mark.parametrize("eta", [0.3, 0.98])
def test_fit_route_with_open_bounds_keeps_eta_inside(eta: float) -> None:
    x, y = _pv_data(eta)
    body = {"x": x.tolist(), "y": y.tolist(), "model": "Pseudo-Voigt"}
    for extra in ({}, {"lower": [None] * 4, "upper": [None] * 4}):
        res = client.post("/api/fitting/fit", json={**body, **extra})
        assert res.status_code == 200, res.text
        p, e = res.json()["params"], res.json()["errors"]
        assert 0.0 <= p[3] <= 1.0
        assert abs(p[3] - eta) <= max(2.0 * e[3], 1e-6)


def test_wider_user_bounds_are_clipped_to_the_domain() -> None:
    lo, hi = with_domain_bounds("Pseudo-Voigt", [None, None, None, -5.0], [None, None, None, 9.0])
    assert lo is not None and hi is not None
    assert lo[3] == 0.0 and hi[3] == 1.0
    # A tighter user bound survives, and a model without a domain is untouched.
    _, tight = with_domain_bounds("Pseudo-Voigt", None, [None, None, None, 0.5])
    assert tight is not None and tight[3] == 0.5
    assert with_domain_bounds("Gaussian", None, None) == (None, None)
    assert with_domain_bounds("Gaussian", [None, 1.0, 0.0], None)[0] == [-np.inf, 1.0, 0.0]


def test_robust_and_convolution_routes_honour_the_domain() -> None:
    x, y = _pv_data(0.98)
    body = {"x": x.tolist(), "y": y.tolist(), "model": "Pseudo-Voigt"}
    res = client.post("/api/fitting/robust-fit", json=body)
    assert res.status_code == 200, res.text
    assert 0.0 <= res.json()["params"][3] <= 1.0
    res = client.post("/api/fitting/convolution-fit", json={**body, "sigma": 0.05})
    assert res.status_code == 200, res.text
    assert 0.0 <= res.json()["params"][3] <= 1.0


def test_global_route_honours_the_domain() -> None:
    sets = [_pv_data(0.98, seed=s) for s in (3, 4)]
    res = client.post("/api/fitting/global", json={
        "model": "Pseudo-Voigt",
        "datasets": [{"x": x.tolist(), "y": y.tolist()} for x, y in sets],
        "constraints": [],
    })
    assert res.status_code == 200, res.text
    for row in np.atleast_2d(res.json()["params"]):
        assert 0.0 <= row[3] <= 1.0


def test_batch_fit_by_model_name_does_not_leave_nan_rows() -> None:
    sets = [_pv_data(0.98, seed=s) for s in (3, 4)]
    s = batch_fit(sets, lambda xx, p: evaluate("Pseudo-Voigt", xx, p),
                  [1000.0, 5.0, 0.3, 0.5], model_name="Pseudo-Voigt")
    assert np.all(np.isfinite(s["params"]))
    assert np.all((s["params"][:, 3] >= 0.0) & (s["params"][:, 3] <= 1.0))


def test_out_of_domain_evaluation_is_nan_not_an_exception() -> None:
    x = np.linspace(0, 1, 5)
    assert np.all(np.isnan(evaluate("Pseudo-Voigt", x, np.array([1.0, 0.5, 0.1, 1.5]))))
    assert np.all(np.isnan(evaluate("Pseudo-Voigt", x, np.array([1.0, 0.5, -0.1, 0.5]))))
    assert np.all(np.isfinite(evaluate("Pseudo-Voigt", x, np.array([1.0, 0.5, 0.1, 1.0]))))


def test_raising_model_is_a_wall_for_curve_fit() -> None:
    """A plugin model with NO bounds that raises for p[1] < 0 still fits."""
    def picky(xx: np.ndarray, p: np.ndarray) -> np.ndarray:
        if p[1] < 0:
            raise ValueError("p1 must be >= 0")
        return np.asarray(p[0] * np.exp(-p[1] * xx), dtype=float)

    x = np.linspace(0, 5, 60)
    y = 3.0 * np.exp(-0.05 * x)  # optimum sits next to the wall
    r = curve_fit(x, y, picky, [1.0, 0.5])
    np.testing.assert_allclose(r["params"], [3.0, 0.05], atol=2e-3)


def _rand_params(rng: np.random.Generator, p0: np.ndarray, t: int) -> np.ndarray:
    if t % 2:
        return p0 * np.exp(rng.normal(0, 3, p0.size)) * rng.choice([-1.0, 1.0], p0.size)
    return p0 + rng.normal(0, 5, p0.size)


def test_no_registered_model_raises_inside_its_bounds_and_hard_ones_are_marked() -> None:
    """Audit of every registered model (closed forms, Origin library, peak
    shapes): probing random parameters, a ValueError may only come from OUTSIDE
    the registered bounds, and then the parameter must be flagged ``hard``."""
    x = np.linspace(-5, 20, 40)
    problems: list[str] = []
    for name, spec in FIT_MODELS.items():
        p0 = np.array(spec["p0"], float)
        lb, ub = np.array(spec["lb"], float), np.array(spec["ub"], float)
        rng = np.random.default_rng(0)
        for t in range(120):
            p = _rand_params(rng, p0, t)
            inside = bool(np.all((p >= lb) & (p <= ub)))
            for xx in (x, np.abs(x) + 1e-3):
                try:
                    with warnings.catch_warnings(), np.errstate(all="ignore"):
                        warnings.simplefilter("ignore")
                        spec["fcn"](xx, p)
                except (ValueError, ArithmeticError) as exc:
                    out = np.flatnonzero((p < lb) | (p > ub))
                    if inside or not spec["hard"] or not set(out) & set(spec["hard"]):
                        problems.append(f"{name}: {exc} at {p}")
    assert not problems, problems[:5]


def test_registering_a_hard_model_roundtrips() -> None:
    register_model("tmp-hard", "Other", lambda x, p: p[0] * x, ["a"], [1.0], [0.0], [2.0],
                   hard=(0,))
    try:
        assert with_domain_bounds("tmp-hard", None, None) == ([0.0], [2.0])
    finally:
        FIT_MODELS.pop("tmp-hard")


@pytest.mark.realdata
def test_yig_peak_fits_with_pseudo_voigt(corpus_dir: Path) -> None:
    """The pass-5 B1 repro: the Rigaku YIG peak at 69.17 deg (362 rows)."""
    from quantized.io.registry import import_auto

    ds = import_auto(str(corpus_dir / "rigaku/xrd/YIG_Py_S3.raw"))
    x, y = np.asarray(ds.time, float), np.asarray(ds.values, float)[:, 0]
    keep = (x >= 68.238) & (x <= 70.119)
    xs, ys = x[keep], y[keep]
    assert xs.size == 362
    for scale in (1.0, 1.0 / ys.max()):
        r = fit_model("Pseudo-Voigt", xs, ys * scale)
        assert 0.0 <= r["params"][3] <= 1.0
        assert abs(r["params"][1] - 69.1658) < 0.02
    res = client.post("/api/fitting/fit", json={"x": xs.tolist(), "y": ys.tolist(),
                                                 "model": "Pseudo-Voigt"})
    assert res.status_code == 200, res.text
    assert abs(res.json()["params"][1] - 69.1658) < 0.02
    # No worse a description of the peak than the Gaussian that always worked.
    g = fit_model("Gaussian", xs, ys)
    assert fit_model("Pseudo-Voigt", xs, ys)["R2"] >= g["R2"] - 1e-3
