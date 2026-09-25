"""fit_peak_model model validation (calc/peak_model.py, audit P2.4).

Split from test_calc_peak_model_fit.py: every malformed model, tie, bound or
data option is refused with a clear ValueError, and what the conventions
allow (a tied parameter's ignored placeholder, tie chains, a fixed zero Voigt
width) is accepted.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest

from quantized.calc.peak_model import PeakModel
from quantized.calc.peak_model_fit import fit_peak_model

X_TWO = np.linspace(-6.0, 6.0, 481)


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
          noise: float, seed: int) -> np.ndarray:
    m = PeakModel(shapes, background, 0.0)
    v = np.array([truth[n] for n in m.names])
    return m.evaluate(x, v) + np.random.default_rng(seed).normal(0.0, noise, x.size)


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
    (_patched("p0.fwhm", value=0.0, vary=False), "width must be positive"),
])
def test_invalid_models_are_refused(specs: list[dict[str, Any]], match: str) -> None:
    with pytest.raises(ValueError, match=match):
        _fit_two(specs)


def test_a_tied_parameters_own_value_and_bounds_are_not_validated() -> None:
    # The tie replaces p1.fwhm's value and bounds, so a placeholder 0 (and
    # nonsense bounds) must not be refused as a non-positive width.
    specs = _patched("p1.fwhm", value=0.0, min=5.0, max=1.0, tie="p0.fwhm")
    x = np.linspace(-5, 5, 201)
    y = synth(["gaussian", "pseudo_voigt"], "constant",
              {"p0.center": -1.0, "p0.height": 5.0, "p0.fwhm": 1.0, "p1.center": 1.0,
               "p1.height": 5.0, "p1.fwhm": 1.0, "p1.eta": 0.5, "bg.c0": 0.0}, x, 0.05, 12)
    out = fit_peak_model(x, y, ["gaussian", "pseudo_voigt"], specs, background="constant")
    p = by_name(out)
    assert p["p1.fwhm"]["value"] == p["p0.fwhm"]["value"] == pytest.approx(1.0, abs=0.02)


def test_tie_chain_to_a_free_root_is_allowed() -> None:
    specs = [P("p0.center", -2.0), P("p0.height", 5.0), P("p0.fwhm", 1.0),
             P("p1.center", 0.0), P("p1.height", 5.0), P("p1.fwhm", 1.0, tie="p0.fwhm"),
             P("p2.center", 2.0), P("p2.height", 5.0), P("p2.fwhm", 1.0, tie="p1.fwhm"),
             P("bg.c0", 0.0)]
    x = np.linspace(-5, 5, 201)
    out = fit_peak_model(x, np.ones(x.size), ["gaussian"] * 3, specs, background="constant")
    p = by_name(out)
    assert p["p2.fwhm"]["value"] == p["p0.fwhm"]["value"]


def _voigt(g: dict[str, Any], lw: dict[str, Any]) -> list[dict[str, Any]]:
    return [P("p0.center", 0.0), P("p0.height", 5.0), {"name": "p0.fwhm_g", **g},
            {"name": "p0.fwhm_l", **lw}, P("bg.c0", 0.0)]


@pytest.mark.parametrize(("specs", "match"), [
    (_voigt({"value": 0.0}, {"value": 0.0}), "not both 0"),
    (_voigt({"value": 0.0, "vary": True}, {"value": 1.0}), "width must be positive"),
    (_voigt({"value": 0.0}, {"value": 1.0, "vary": True, "min": 0.0}), "min must be positive"),
])
def test_voigt_zero_widths_are_refused_unless_one_is_fixed(
        specs: list[dict[str, Any]], match: str) -> None:
    with pytest.raises(ValueError, match=match):
        fit_peak_model(X_TWO, np.ones(X_TWO.size), ["voigt"], specs, background="constant")


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
