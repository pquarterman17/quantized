"""POST /api/fitting/global and its job-queued sibling /api/fitting/global/job.

Thin adapters over ``calc.global_curve_fit`` (port of MATLAB
``fitting.globalCurveFit``): one model fit to several datasets at once, with
named parameters shared across a group of datasets. The golden test drives the
ROUTE with the frozen MATLAB cases (registry ``Gaussian`` / ``Exponential
Decay`` are the golden's model functions verbatim), so the wire adapter —
bounds null->inf, 0-based dataset indices, per-dataset starts — is checked
against MATLAB end to end, not only the calc underneath it.
"""

from __future__ import annotations

import math
import threading
import time
from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.testing import assert_allclose

from quantized.app import app
from quantized.calc.fit_models import evaluate as real_evaluate
from quantized.routes import fitting_global

client = TestClient(app)

GLOBAL = "/api/fitting/global"
GLOBAL_JOB = "/api/fitting/global/job"
_TERMINAL = ("done", "error", "cancelled")

_GOLDEN_MODEL = {
    "gauss_shared_sigma": "Gaussian",
    "gauss_no_constraint": "Gaussian",
    "gauss_subset": "Gaussian",
    "exp_shared_tau": "Exponential Decay",
}
# Same explicit bounds as tests/test_calc_global_curve_fit.py (Inf does not
# survive jsonencode); null = unbounded on the wire.
_GOLDEN_BOUNDS: dict[str, tuple[list[float | None], list[float | None]]] = {
    "gauss_shared_sigma": ([None, None, 0.1], [None, None, 10.0]),
    "gauss_no_constraint": ([None, None, 0.1], [None, None, 10.0]),
    "gauss_subset": ([None, None, 0.1], [None, None, 10.0]),
    "exp_shared_tau": ([None, 0.0, None], [None, None, None]),
}


def _poll_terminal(job_id: str, timeout: float = 120.0) -> list[dict[str, Any]]:
    snaps: list[dict[str, Any]] = []
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = client.get(f"/api/jobs/{job_id}")
        assert r.status_code == 200
        snaps.append(r.json())
        if snaps[-1]["status"] in _TERMINAL:
            return snaps
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} never reached a terminal state")


def _golden_request(g: dict[str, Any], case: str) -> dict[str, Any]:
    lower, upper = _GOLDEN_BOUNDS[case]
    return {
        "model": _GOLDEN_MODEL[case],
        "datasets": [{"x": g["x"], "y": yi} for yi in g["y"]],
        # MATLAB constraint dataset indices are 1-based; the wire is 0-based.
        "constraints": [
            {
                "param_name": c["paramName"],
                "datasets": [int(d) - 1 for d in np.atleast_1d(c["datasets"])],
            }
            for c in (g["constraints"] or [])
        ],
        "p0": g["initGuess"],
        "lower": lower,
        "upper": upper,
    }


def _check_against_golden(out: dict[str, Any], ref: dict[str, Any]) -> None:
    tol = {"rtol": 1e-6, "atol": 1e-8}
    assert_allclose(np.asarray(out["params"]), np.asarray(ref["params"], dtype=float), **tol)
    assert_allclose(np.asarray(out["errors"]), np.asarray(ref["errors"], dtype=float), **tol)
    assert_allclose(out["R2"], np.atleast_1d(np.asarray(ref["R2"], dtype=float)), **tol)
    assert out["chiSqRed"] == pytest.approx(ref["chiSqRed"], rel=1e-6)
    assert out["nFree"] == int(ref["nFree"])
    assert out["nTotal"] == int(ref["nTotal"])
    ref_shared = ref["shared"] if isinstance(ref["shared"], list) else [ref["shared"]]
    assert len(out["shared"]) == len(ref_shared)
    for got, exp in zip(out["shared"], ref_shared, strict=True):
        assert got["value"] == pytest.approx(exp["value"], rel=1e-6, abs=1e-8)
        assert got["error"] == pytest.approx(exp["error"], rel=1e-6, abs=1e-8)
        assert got["paramIdx"] == int(exp["paramIdx"]) - 1


@pytest.mark.golden
@pytest.mark.parametrize("case", list(_GOLDEN_MODEL))
def test_global_route_matches_matlab(
    case: str, load_golden: Callable[[str], dict[str, Any]]
) -> None:
    g = load_golden("calc_globalcurvefit.json")[case]
    r = client.post(GLOBAL, json=_golden_request(g, case))
    assert r.status_code == 200, r.text
    out = r.json()
    _check_against_golden(out, g["result"])
    assert out["paramNames"] == g["paramNames"]
    # one fitted curve per dataset, aligned to that dataset's x
    assert [len(yf) for yf in out["yFit"]] == [len(g["x"])] * len(g["y"])


@pytest.mark.golden
def test_global_job_matches_matlab(load_golden: Callable[[str], dict[str, Any]]) -> None:
    g = load_golden("calc_globalcurvefit.json")["gauss_shared_sigma"]
    r = client.post(GLOBAL_JOB, json=_golden_request(g, "gauss_shared_sigma"))
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    snaps = _poll_terminal(job_id)
    assert snaps[-1]["status"] == "done", snaps[-1]
    res = client.get(f"/api/jobs/{job_id}/result")
    assert res.status_code == 200
    _check_against_golden(res.json()["result"], g["result"])


def _two_decays() -> list[dict[str, list[float]]]:
    x = np.linspace(0.0, 10.0, 60)
    return [
        {"x": x.tolist(), "y": (a * np.exp(-x / 2.5) + 0.5).tolist()} for a in (5.0, 3.0)
    ]


def test_omitted_starts_are_auto_guessed_per_dataset() -> None:
    r = client.post(GLOBAL, json={
        "model": "Exponential Decay",
        "datasets": _two_decays(),
        "constraints": [{"param_name": "tau", "datasets": [0, 1]}],
        "lower": [None, 0.0, None],
    })
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["shared"][0]["paramIdx"] == 1  # ASCII "tau" resolves to τ
    assert out["shared"][0]["value"] == pytest.approx(2.5, rel=1e-3)
    assert [p[0] for p in out["params"]] == pytest.approx([5.0, 3.0], rel=1e-3)


def test_single_start_vector_broadcasts() -> None:
    r = client.post(GLOBAL, json={
        "model": "Exponential Decay",
        "datasets": _two_decays(),
        "constraints": [{"param_name": "τ", "datasets": [0, 1]}],
        "p0": [4.0, 2.0, 0.0],
    })
    assert r.status_code == 200, r.text
    assert r.json()["shared"][0]["value"] == pytest.approx(2.5, rel=1e-3)


def test_equation_model_fits_and_reports_its_param_names() -> None:
    r = client.post(GLOBAL, json={
        "equation": "y = a*exp(-x/t) + c",
        "datasets": _two_decays(),
        "constraints": [
            {"param_name": "t", "datasets": [0, 1]},
            {"param_name": "c", "datasets": [0, 1]},
        ],
        "p0": [4.0, 2.0, 0.1],
    })
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["paramNames"] == ["a", "t", "c"]
    assert out["nFree"] == 4  # 2 shared + 2 per-dataset amplitudes


def test_nonfinite_errors_serialize_as_null() -> None:
    # A single point per dataset leaves no degrees of freedom: errors are NaN.
    r = client.post(GLOBAL, json={
        "model": "Linear",
        "datasets": [{"x": [1.0], "y": [2.0]}, {"x": [2.0], "y": [3.0]}],
        "p0": [1.0, 1.0],
    })
    assert r.status_code == 200, r.text
    assert all(e is None for row in r.json()["errors"] for e in row)


@pytest.mark.parametrize(
    ("body", "fragment"),
    [
        ({"datasets": []}, "exactly one of model or equation"),
        ({"model": "Nope", "datasets": [{"x": [1, 2], "y": [1, 2]}]}, "unknown model"),
        ({"model": "Linear", "equation": "y = a*x", "datasets": [{"x": [1], "y": [1]}]},
         "exactly one of model or equation"),
        ({"model": "Linear", "datasets": []}, "at least one dataset"),
        ({"model": "Linear", "datasets": [{"x": [1, 2], "y": [1]}]}, "same length"),
        ({"model": "Linear", "datasets": [{"x": [], "y": []}]}, "no points"),
        ({"model": "Linear", "datasets": [{"x": [1, 2], "y": [1, 2]}], "p0": [1.0]}, "2 values"),
        ({"model": "Linear", "datasets": [{"x": [1, 2], "y": [1, 2]}], "lower": [0.0]}, "2 values"),
        ({"model": "Linear", "datasets": [{"x": [1, 2], "y": [1, 2]}] * 2,
          "p0": [[1.0, 0.0]]}, "one start vector per dataset"),
        ({"model": "Linear", "datasets": [{"x": [1, 2], "y": [1, 2]}] * 2,
          "constraints": [{"param_name": "zz", "datasets": [0, 1]}]}, "not found"),
        ({"model": "Linear", "datasets": [{"x": [1, 2], "y": [1, 2]}] * 2,
          "constraints": [{"param_name": "m", "datasets": [0, 5]}]}, "dataset indices"),
        ({"model": "Linear", "datasets": [{"x": [1, 2], "y": [1, 2], "dy": [1.0]}]}, "dy"),
        ({"equation": "y = (", "datasets": [{"x": [1, 2], "y": [1, 2]}]}, ""),
    ],
)
def test_invalid_input_is_422_on_both_routes(body: dict[str, Any], fragment: str) -> None:
    for url in (GLOBAL, GLOBAL_JOB):
        r = client.post(url, json=body)
        assert r.status_code == 422, (url, r.text)
        assert fragment in str(r.json()["detail"])


def test_job_cancel_mid_fit_ends_cancelled_with_no_result(monkeypatch: pytest.MonkeyPatch) -> None:
    # Force the race: the model's first evaluation inside the job blocks until
    # the cancel has been POSTed, so the cancel always lands mid-fit.
    started = threading.Event()
    cancel_sent = threading.Event()
    after_cancel = {"n": 0}

    def gated_evaluate(name: str, x: Any, p: Any) -> Any:
        if not started.is_set():
            started.set()
            cancel_sent.wait(10.0)
        elif cancel_sent.is_set():
            after_cancel["n"] += 1
        return real_evaluate(name, x, p)

    monkeypatch.setattr(fitting_global, "evaluate", gated_evaluate)
    r = client.post(GLOBAL_JOB, json={"model": "Exponential Decay", "datasets": _two_decays(),
                                      "p0": [4.0, 2.0, 0.0]})
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    assert started.wait(10.0), "the job never started evaluating the model"
    assert client.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    cancel_sent.set()

    snaps = _poll_terminal(job_id)
    assert snaps[-1]["status"] == "cancelled"
    assert client.get(f"/api/jobs/{job_id}/result").status_code == 409
    # The fit STOPPED at the next cost evaluation: only the gated evaluation's
    # sibling dataset ran after the cancel, not the rest of the optimization.
    assert after_cancel["n"] <= 1


def test_job_completes_with_the_fit_result() -> None:
    r = client.post(GLOBAL_JOB, json={"model": "Exponential Decay", "datasets": _two_decays(),
                                      "p0": [4.0, 2.0, 0.0]})
    job_id = r.json()["job_id"]
    snaps = _poll_terminal(job_id)
    assert snaps[-1]["status"] == "done"
    res = client.get(f"/api/jobs/{job_id}/result").json()["result"]
    assert res["exitFlag"] == 1
    assert math.isfinite(res["chiSqRed"])
