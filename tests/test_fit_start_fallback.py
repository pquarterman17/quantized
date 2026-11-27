"""calc.fit_start_fallback: when a poor auto-guess fit is retried, and who wins."""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.calc.fit_start_fallback import fit_is_poor, fit_with_start_fallback

X = np.linspace(0, 1, 40)
Y = 2 * X + np.sin(40 * X) * 0.0  # smooth: noise floor ~0


def _res(chi: float, *, exit_flag: int = 1, params: Any = (1.0, 2.0)) -> dict[str, Any]:
    return {"exitFlag": exit_flag, "params": list(params), "chiSq": chi, "warnings": []}


def test_poor_when_not_converged_or_runaway_or_nonfinite() -> None:
    cat = [1.0, 1.0]
    assert fit_is_poor(_res(0.0, exit_flag=0), cat, X, Y)
    assert fit_is_poor(_res(0.0, params=(np.nan, 1.0)), cat, X, Y)
    assert fit_is_poor(_res(0.0, params=(1e9, 1.0)), cat, X, Y)
    assert not fit_is_poor(_res(0.0), cat, X, Y)


def test_poor_when_residual_far_above_the_noise_floor() -> None:
    rng = np.random.default_rng(0)
    x = np.linspace(0, 10, 200)
    y = x + rng.normal(0, 0.1, x.size)  # sigma 0.1 -> floor ~ 200 * 0.01 = 2
    assert not fit_is_poor(_res(2.0), [1.0, 1.0], x, y)
    assert fit_is_poor(_res(20.0), [1.0, 1.0], x, y)
    # weighted fits are judged by convergence only
    assert not fit_is_poor(_res(20.0), [1.0, 1.0], x, y, weighted=True)


def test_good_auto_fit_is_returned_untouched_and_run_once() -> None:
    calls: list[list[float]] = []

    def run(p: Any) -> dict[str, Any]:
        calls.append(list(p))
        return _res(0.0)

    out = fit_with_start_fallback(run, [1.0, 2.0], [3.0, 4.0], X, Y)
    assert calls == [[1.0, 2.0]] and out["start"] == "auto" and out["warnings"] == []


def test_poor_auto_fit_loses_to_a_lower_catalogue_fit_and_says_so() -> None:
    def run(p: Any) -> dict[str, Any]:
        return _res(5.0, exit_flag=0) if p[0] == 1.0 else _res(1.0)

    out = fit_with_start_fallback(run, [1.0, 2.0], [3.0, 4.0], X, Y)
    assert out["start"] == "catalogue" and out["chiSq"] == 1.0
    assert "catalogue start" in out["warnings"][-1] and out["exitFlag"] == 1


def test_a_worse_or_failing_catalogue_fit_never_replaces_the_auto_fit() -> None:
    def worse(p: Any) -> dict[str, Any]:
        return _res(5.0, exit_flag=0) if p[0] == 1.0 else _res(9.0)

    assert fit_with_start_fallback(worse, [1.0, 2.0], [3.0, 4.0], X, Y)["start"] == "auto"

    def boom(p: Any) -> dict[str, Any]:
        if p[0] != 1.0:
            raise ValueError("bad start")
        return _res(5.0, exit_flag=0)

    assert fit_with_start_fallback(boom, [1.0, 2.0], [3.0, 4.0], X, Y)["start"] == "auto"


def test_fit_route_reports_the_start_and_replaces_a_stalled_auto_fit(client: TestClient) -> None:
    from quantized.calc.fit_models import evaluate

    x = np.linspace(1.5, 12, 251)
    y = evaluate("SRichards1", x, np.array([5.0, 2.0, 0.5, 0.8]))
    y = y + np.random.default_rng(0).normal(0, 0.003, x.size)
    body = {"x": x.tolist(), "y": y.tolist(), "model": "SRichards1"}
    auto = client.post("/api/fitting/fit", json=body).json()
    assert auto["start"] in ("auto", "catalogue") and auto["R2"] > 0.999
    given = client.post("/api/fitting/fit", json={**body, "p0": [5.0, 2.0, 0.5, 0.8]}).json()
    assert "start" not in given  # the caller's own start is never second-guessed
