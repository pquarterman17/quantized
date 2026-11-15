"""Expression ties of the mixed-shape peak model (gap audit 4 G5).

``tie_op`` offset / ratio / area_ratio (calc/peak_model.py header): refused
when malformed (fail closed), honoured exactly by the fitted parameters of a
synthetic spin-orbit doublet, with a fitted coefficient recovered and its
error propagated through the tie (checked against the covariance).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from quantized.calc.peak_model import PeakModel, PeakParams
from quantized.calc.peak_model_fit import fit_peak_model

X = np.linspace(-4.0, 12.0, 1201)


def P(name: str, value: float, *, vary: bool = True, **kw: Any) -> dict[str, Any]:
    return {"name": name, "value": value, "vary": vary, **kw}


def by_name(out: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in out["parameters"]}


# Truth: an XPS-like 2p doublet, splitting 5.0, area ratio 0.5, shared width.
TRUTH = {"p0.center": 2.0, "p0.height": 80.0, "p0.fwhm": 1.1,
         "p1.center": 7.0, "p1.height": 40.0, "p1.fwhm": 1.1, "bg.c0": 5.0}


def doublet(shapes: list[str], truth: dict[str, float], seed: int = 7) -> np.ndarray:
    m = PeakModel(shapes, "constant", 0.0)
    y = m.evaluate(X, np.array([truth[n] for n in m.names]))
    return np.asarray(y + np.random.default_rng(seed).normal(0.0, 0.5, X.size))


def doublet_specs(**p1: dict[str, Any]) -> list[dict[str, Any]]:
    specs = [P("p0.center", 2.2), P("p0.height", 70.0), P("p0.fwhm", 1.0),
             P("p1.center", 0.0, tie="p0.center", tie_op="offset", tie_coef=5.0),
             P("p1.height", 0.0, tie="p0.height", tie_op="area_ratio", tie_coef=0.5),
             P("p1.fwhm", 0.0, tie="p0.fwhm"), P("bg.c0", 4.0)]
    for s in specs:
        s.update(p1.get(s["name"], {}))
    return specs


def test_fixed_offset_area_ratio_and_shared_width_are_honoured_exactly() -> None:
    y = doublet(["gaussian", "gaussian"], TRUTH)
    out = fit_peak_model(X, y, ["gaussian", "gaussian"], doublet_specs(), background="constant")
    assert out["success"]
    p, (a, b) = by_name(out), out["peaks"]
    assert p["p1.center"]["value"] - p["p0.center"]["value"] == pytest.approx(5.0, abs=1e-12)
    assert b["area"] / a["area"] == pytest.approx(0.5, rel=1e-13)
    assert p["p1.fwhm"]["value"] == p["p0.fwhm"]["value"]
    assert out["free"] == ["p0.center", "p0.height", "p0.fwhm", "bg.c0"]
    # Recovered truth, and the tie metadata is echoed.
    for n in ("p0.center", "p0.height", "p0.fwhm"):
        assert abs(p[n]["value"] - TRUTH[n]) < 4 * p[n]["stderr"]
    assert p["p1.center"]["tie_op"] == "offset" and p["p1.center"]["tie_coef"] == 5.0
    assert p["p1.center"]["tie_coef_stderr"] is None and not p["p1.center"]["tie_coef_vary"]
    # Errors through the ties: a fixed offset carries the target's error, a
    # fixed 0.5 area ratio halves the area error (equal shapes and widths).
    assert p["p1.center"]["stderr"] == p["p0.center"]["stderr"]
    assert b["area_stderr"] == pytest.approx(0.5 * a["area_stderr"], rel=1e-6)
    assert p["p1.height"]["stderr"] == pytest.approx(0.5 * p["p0.height"]["stderr"], rel=1e-6)


def test_fitted_offset_and_area_ratio_are_recovered_with_errors() -> None:
    truth = {**TRUTH, "p1.center": 7.3, "p1.height": 80.0 / 3.0}  # splitting 5.3, ratio 1/3
    y = doublet(["gaussian", "gaussian"], truth)
    specs = doublet_specs(**{"p1.center": {"tie_coef_vary": True},
                             "p1.height": {"tie_coef_vary": True}})
    out = fit_peak_model(X, y, ["gaussian", "gaussian"], specs, background="constant")
    assert out["success"]
    p = by_name(out)
    assert out["free"][-2:] == ["p1.center:coef", "p1.height:coef"]
    d, r = p["p1.center"], p["p1.height"]
    assert d["tie_coef_vary"] and d["tie_coef_stderr"] is not None
    assert abs(d["tie_coef"] - 5.3) < 4 * d["tie_coef_stderr"]
    assert abs(r["tie_coef"] - 1 / 3) < 4 * r["tie_coef_stderr"]
    assert p["p1.center"]["value"] - p["p0.center"]["value"] == pytest.approx(d["tie_coef"],
                                                                               abs=1e-12)
    a, b = out["peaks"]
    assert b["area"] / a["area"] == pytest.approx(r["tie_coef"], rel=1e-13)
    # var(c1) = var(c0) + var(D) + 2 cov(c0, D), from the reported correlation.
    free = out["free"]
    sd = np.array([p[n.split(":")[0]]["tie_coef_stderr"] if ":" in n else p[n]["stderr"]
                   for n in free])
    cov = np.array(out["correlation"], dtype=float) * np.outer(sd, sd)
    i, j = free.index("p0.center"), free.index("p1.center:coef")
    expect = np.sqrt(cov[i, i] + cov[j, j] + 2 * cov[i, j])
    assert p["p1.center"]["stderr"] == pytest.approx(expect, rel=1e-9)


def test_offset_tie_may_follow_a_fixed_target_with_a_fitted_offset() -> None:
    y = doublet(["gaussian", "gaussian"], TRUTH)
    specs = doublet_specs(**{"p0.center": {"value": 2.0, "vary": False},
                             "p1.center": {"tie_coef": 4.8, "tie_coef_vary": True}})
    out = fit_peak_model(X, y, ["gaussian", "gaussian"], specs, background="constant")
    p = by_name(out)
    assert out["success"] and abs(p["p1.center"]["tie_coef"] - 5.0) < 0.05
    assert p["p1.center"]["stderr"] == p["p1.center"]["tie_coef_stderr"]


def test_height_ratio_tie_on_a_doniach_sunjic_doublet() -> None:
    truth = {**TRUTH, "p0.alpha": 0.1, "p1.alpha": 0.1}
    shapes = ["doniach_sunjic", "doniach_sunjic"]
    y = doublet(shapes, truth)
    specs = [P("p0.center", 2.1), P("p0.height", 70.0), P("p0.fwhm", 1.0), P("p0.alpha", 0.05),
             P("p1.center", 0.0, tie="p0.center", tie_op="offset", tie_coef=5.0),
             P("p1.height", 0.0, tie="p0.height", tie_op="ratio", tie_coef=0.5),
             P("p1.fwhm", 0.0, tie="p0.fwhm"), P("p1.alpha", 0.0, tie="p0.alpha"),
             P("bg.c0", 4.0)]
    out = fit_peak_model(X, y, shapes, specs, background="constant")
    p = by_name(out)
    assert out["success"]
    assert p["p1.height"]["value"] == pytest.approx(0.5 * p["p0.height"]["value"], rel=1e-15)
    assert abs(p["p0.alpha"]["value"] - 0.1) < 4 * p["p0.alpha"]["stderr"]


def test_width_ratio_tie() -> None:
    truth = {**TRUTH, "p1.fwhm": 1.65}
    y = doublet(["gaussian", "gaussian"], truth)
    specs = doublet_specs(**{"p1.fwhm": {"tie_op": "ratio", "tie_coef": 1.5}})
    out = fit_peak_model(X, y, ["gaussian", "gaussian"], specs, background="constant")
    p = by_name(out)
    assert p["p1.fwhm"]["value"] == pytest.approx(1.5 * p["p0.fwhm"]["value"], rel=1e-15)


# ── validation: fail closed ─────────────────────────────────────────────────

SHAPES2 = ["gaussian", "gaussian"]
NAMES2 = PeakModel(SHAPES2, "constant", 0.0).names


def params(specs: list[dict[str, Any]], shapes: list[str] = SHAPES2) -> PeakParams:
    names = PeakModel(shapes, "constant", 0.0).names
    return PeakParams(specs, names, 10.0, 100.0, shapes)


@pytest.mark.parametrize(("patch", "match"), [
    ({"p1.center": {"tie_op": "sum"}}, "unknown tie_op 'sum'"),
    ({"p1.center": {"tie": None}}, "tie_op / tie_coef need a tie target"),
    ({"p1.center": {"tie": "p0.height"}}, "ties join parameters of one kind"),
    ({"p1.center": {"tie": "p9.center"}}, "tied to unknown parameter p9.center"),
    ({"p1.fwhm": {"tie_op": "offset", "tie_coef": 0.1}}, "offset tie applies only to center"),
    ({"p1.fwhm": {"tie_coef": 2.0}}, "an equal tie takes no tie_coef"),
    ({"p1.height": {"tie_coef": 0.0}}, "tie_coef must be positive"),
    ({"p1.height": {"tie_coef": float("nan")}}, "tie_coef must be finite"),
    ({"p1.fwhm": {"tie_op": "area_ratio"}}, "area_ratio tie applies only to height"),
    ({"p1.height": {"tie": "p0.fwhm"}}, "ties join parameters of one kind"),
    ({"p0.center": {"tie": "p1.center", "tie_op": "offset", "tie_coef": -5.0}}, "cycle"),
    ({"p0.height": {"tie": "p1.height", "tie_op": "area_ratio", "tie_coef": 2.0}}, "cycle"),
    ({"p0.fwhm": {"tie": "p1.fwhm"}}, "cycle"),
])
def test_malformed_ties_are_refused(patch: dict[str, dict[str, Any]], match: str) -> None:
    with pytest.raises(ValueError, match=match):
        params(doublet_specs(**patch))


def test_area_ratio_needs_shapes_with_an_area() -> None:
    shapes = ["gaussian", "fano"]
    specs = [P("p0.center", 2.0), P("p0.height", 70.0), P("p0.fwhm", 1.0),
             P("p1.center", 7.0), P("p1.height", 0.0, tie="p0.height", tie_op="area_ratio"),
             P("p1.fwhm", 1.0), P("p1.inv_q", 0.0), P("bg.c0", 4.0)]
    with pytest.raises(ValueError, match="a fano peak \\(p1\\) has none"):
        params(specs, shapes)


def test_coefficient_without_a_tie_is_refused_even_if_only_vary() -> None:
    specs = doublet_specs(**{"p0.center": {"tie_coef_vary": True}})
    with pytest.raises(ValueError, match="need a tie target"):
        params(specs)


def test_a_fitted_ratio_coefficient_is_bounded_positive() -> None:
    pp = params(doublet_specs(**{"p1.height": {"tie_coef_vary": True}}))
    k = pp.free.index(pp.ext_names.index("p1.height:coef"))
    assert pp.lo[k] == 0.0 and pp.hi[k] == np.inf
