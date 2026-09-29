"""calc.fit_model_compare: fit several models to one selection, compare them.

The metrics themselves are ``calc.fit_stats.fit_compare`` (golden-verified in
test_calc_fit_stats.py); these tests pin the orchestration: every candidate is
fit to the same (x, y), deltas are taken against the best candidate, and the
nested F-test runs against the reference (fewest free parameters by default).
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.fit_model_compare import compare_models
from quantized.calc.fit_stats import fit_compare


def _quadratic_data() -> tuple[np.ndarray, np.ndarray]:
    x = np.linspace(-3.0, 3.0, 61)
    y = 0.8 * x**2 - 0.5 * x + 1.0 + 0.05 * np.sin(11.0 * x)
    return x, y


def test_quadratic_beats_linear_and_f_test_is_significant() -> None:
    x, y = _quadratic_data()
    out = compare_models(x, y, models=["Linear", "Quadratic"])
    assert out["n"] == 61
    assert out["reference"] == "Linear"
    lin, quad = out["results"]
    assert (lin["name"], quad["name"]) == ("Linear", "Quadratic")
    assert (lin["k"], quad["k"]) == (2, 3)
    assert quad["dAIC"] == 0.0 and lin["dAIC"] > 10.0
    assert quad["dBIC"] == 0.0 and quad["dAICc"] == 0.0
    # The reference model carries no F-test against itself.
    assert math.isnan(lin["fStat"]) and math.isnan(lin["fPvalue"])
    assert quad["fStat"] > 100.0
    assert quad["fPvalue"] < 1e-6


def test_metrics_are_fit_compare_on_each_fits_residuals() -> None:
    x, y = _quadratic_data()
    out = compare_models(x, y, models=["Linear", "Quadratic"])
    lin, quad = out["results"]
    y_lin = np.polyval(np.polyfit(x, y, 1), x)
    y_quad = np.polyval(np.polyfit(x, y, 2), x)
    expect = fit_compare(y, y - y_quad, 3, resid_ref=y - y_lin, n_params_ref=2)
    for key in ("R2", "adjR2", "aic", "aicc", "bic", "rmse", "fStat", "fPvalue"):
        assert quad[key] == pytest.approx(expect[key], rel=1e-6), key
    assert lin["R2"] == pytest.approx(fit_compare(y, y - y_lin, 2)["R2"], rel=1e-9)


def test_explicit_reference_and_equation_candidate() -> None:
    x, y = _quadratic_data()
    out = compare_models(
        x,
        y,
        models=["Quadratic"],
        equations=[{"name": "line", "equation": "a*x + b", "guesses": [1.0, 0.0]}],
        reference="line",
    )
    assert out["reference"] == "line"
    quad, line = out["results"]
    assert line["kind"] == "equation" and line["paramNames"] == ["a", "b"]
    assert quad["fPvalue"] < 1e-6


def test_failed_candidate_is_an_entry_not_an_abort() -> None:
    x, y = _quadratic_data()
    out = compare_models(x, y, models=["Linear", "No Such Model"])
    good, bad = out["results"]
    assert good["error"] is None
    assert "unknown model" in bad["error"]
    assert bad["aic"] is None and bad["dAIC"] is None


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"models": ["Linear"]}, "at least 2"),
        ({"models": ["Linear", "Quadratic"], "reference": "Cubic"}, "reference"),
    ],
)
def test_invalid_input_raises(kwargs: dict[str, object], match: str) -> None:
    x, y = _quadratic_data()
    with pytest.raises(ValueError, match=match):
        compare_models(x, y, **kwargs)  # type: ignore[arg-type]


def test_length_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="same length"):
        compare_models([0.0, 1.0, 2.0], [0.0, 1.0], models=["Linear", "Quadratic"])
