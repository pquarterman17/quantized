"""Integration tests for /api/fitting/equation (GOTO #1 custom fit models).

Validate surfaces syntax / unknown-symbol errors as ok:false (live UI shape);
fit runs the parsed equation through the SAME curve_fit engine as registry
models and returns the same result shape. Injection attempts must be rejected
by the parser (422) — the RPN interpreter is the only evaluation path, nothing
is ever eval'd.
"""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

VALIDATE = "/api/fitting/equation/validate"
FIT = "/api/fitting/equation/fit"


# ── validate ────────────────────────────────────────────────────────────────


def test_validate_happy_path_params_in_appearance_order() -> None:
    resp = client.post(VALIDATE, json={"equation": "y = a*exp(-x/t) + c"})
    assert resp.status_code == 200
    out = resp.json()
    assert out["ok"] is True
    assert out["params"] == ["a", "t", "c"]
    assert "error" not in out


def test_validate_no_parameter_equation_is_ok_with_empty_params() -> None:
    resp = client.post(VALIDATE, json={"equation": "2*x + 1"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "params": []}


def test_validate_syntax_error_mismatched_paren() -> None:
    resp = client.post(VALIDATE, json={"equation": "a*(x"})
    assert resp.status_code == 200
    out = resp.json()
    assert out["ok"] is False
    assert out["params"] == []
    assert "parenthes" in out["error"].lower()


def test_validate_dangling_operator() -> None:
    resp = client.post(VALIDATE, json={"equation": "a*x +"})
    assert resp.status_code == 200
    out = resp.json()
    assert out["ok"] is False
    assert "operand" in out["error"]


def test_validate_unknown_function_symbol() -> None:
    resp = client.post(VALIDATE, json={"equation": "a*foo(x) + b"})
    assert resp.status_code == 200
    out = resp.json()
    assert out["ok"] is False
    assert 'Unknown function "foo"' in out["error"]


def test_validate_unexpected_character() -> None:
    resp = client.post(VALIDATE, json={"equation": "a*x; b"})
    assert resp.status_code == 200
    out = resp.json()
    assert out["ok"] is False
    assert "Unexpected character" in out["error"]


# ── fit ─────────────────────────────────────────────────────────────────────


def _decay_data() -> tuple[list[float], list[float]]:
    x = np.linspace(0.0, 8.0, 120)
    y = 2.5 * np.exp(-x / 1.7) + 0.6
    return list(x), list(y)


def test_fit_recovers_known_params_on_synthetic_decay() -> None:
    x, y = _decay_data()
    resp = client.post(
        FIT,
        json={"equation": "y = a*exp(-x/t) + c", "x": x, "y": y, "guesses": [1.0, 1.0, 1.0]},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["paramNames"] == ["a", "t", "c"]
    a, t, c = out["params"]
    assert abs(a - 2.5) < 2.5 * 1e-5
    assert abs(t - 1.7) < 1.7 * 1e-5
    assert abs(c - 0.6) < 0.6 * 1e-4
    # Same result shape as the registry-model /fit (frontend stats display).
    for key in ("params", "errors", "residuals", "yFit", "R2", "chiSqRed", "RMSE", "AIC"):
        assert key in out
    assert out["R2"] > 0.999999
    assert len(out["yFit"]) == len(x)
    assert len(out["errors"]) == 3


def test_fit_defaults_guesses_to_ones_when_omitted() -> None:
    x = list(np.linspace(0.0, 10.0, 60))
    y = [2.0 * v + 1.0 for v in x]
    resp = client.post(FIT, json={"equation": "m*x + b", "x": x, "y": y})
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["params"][0] - 2.0) < 1e-6
    assert abs(out["params"][1] - 1.0) < 1e-6


def test_fit_honors_bounds() -> None:
    x = list(np.linspace(0.0, 10.0, 60))
    y = [2.0 * v + 1.0 for v in x]
    resp = client.post(
        FIT,
        json={
            "equation": "m*x + b",
            "x": x,
            "y": y,
            "guesses": [1.5, 0.5],
            "lower": [0.0, 0.0],
            "upper": [1.5, 10.0],
        },
    )
    assert resp.status_code == 200
    m = resp.json()["params"][0]
    assert m <= 1.5 + 1e-9  # true slope 2.0 clamped at the upper bound


def test_fit_bounds_accept_null_for_unbounded_side() -> None:
    # NOTE guess m=1.5, not 1.0: the (golden-locked) engine maps a lower-
    # bounded param to log(p0 - lo + eps), and p0 - lo == 1 lands at ~2e-16
    # where fminsearch/Nelder-Mead's 5%-scaled initial simplex is degenerate
    # in that direction (a faithful-port wart shared with MATLAB, not an
    # equation-route bug).
    x = list(np.linspace(0.0, 10.0, 60))
    y = [2.0 * v + 1.0 for v in x]
    resp = client.post(
        FIT,
        json={
            "equation": "m*x + b",
            "x": x,
            "y": y,
            "guesses": [1.5, 0.5],
            "lower": [0.0, None],
            "upper": [None, None],
        },
    )
    assert resp.status_code == 200
    assert abs(resp.json()["params"][0] - 2.0) < 1e-6


def test_fit_syntax_error_is_422() -> None:
    x, y = _decay_data()
    resp = client.post(FIT, json={"equation": "a*(x", "x": x, "y": y})
    assert resp.status_code == 422


def test_fit_equation_without_parameters_is_422() -> None:
    x, y = _decay_data()
    resp = client.post(FIT, json={"equation": "2*x + 1", "x": x, "y": y})
    assert resp.status_code == 422
    assert "no free parameters" in resp.json()["detail"]


def test_fit_guess_count_mismatch_is_422() -> None:
    x, y = _decay_data()
    resp = client.post(
        FIT, json={"equation": "a*exp(-x/t) + c", "x": x, "y": y, "guesses": [1.0]}
    )
    assert resp.status_code == 422
    assert "expected 3 guesses" in resp.json()["detail"]


# ── injection attempts: rejected by the parser, never executed ──────────────


def test_injection_dunder_call_is_422() -> None:
    resp = client.post(
        FIT,
        json={"equation": "__import__('os').system('echo pwned')", "x": [0, 1], "y": [0, 1]},
    )
    assert resp.status_code == 422


def test_injection_bare_dunder_param_is_422() -> None:
    # A bare dunder would otherwise just be a parameter NAME (never executed),
    # but the fit-model bridge rejects underscore-leading names outright.
    resp = client.post(FIT, json={"equation": "__import__ + x", "x": [0, 1], "y": [0, 1]})
    assert resp.status_code == 422
    assert "invalid parameter name" in resp.json()["detail"]


def test_injection_attribute_access_is_422() -> None:
    resp = client.post(FIT, json={"equation": "a.__class__ + x", "x": [0, 1], "y": [0, 1]})
    assert resp.status_code == 422


def test_injection_attempts_fail_validation_too() -> None:
    for eqn in (
        "__import__('os')",
        "a.__class__",
        "open('x')",
        "exec('1')",
        "x; import os",
    ):
        out = client.post(VALIDATE, json={"equation": eqn}).json()
        assert out["ok"] is False, eqn
