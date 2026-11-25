"""Descriptive statistics stay finite for tiny and huge magnitudes.

A column of ~1e-247 values made ``/api/stats/descriptive`` answer 422
"float division by zero": the raw squared deviations underflowed, std came
back 0 or its cube did, and the skewness divided by it. The moments are now
computed on power-of-two-scaled data; ordinary data must stay bit-identical.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.stats import descriptive_stats

_BASE = np.array([1.0, 2.0, 3.0, 5.0, 8.0])


def test_unit_scale_reference() -> None:
    s = descriptive_stats(_BASE)
    assert s["mean"] == 3.8 and s["var"] == pytest.approx(7.7, rel=1e-15)


@pytest.mark.parametrize("k", [1e-247, 1e-170, 1e-120, 1e150, 1e300])
def test_moments_scale_with_the_data(k: float) -> None:
    ref = descriptive_stats(_BASE)
    s = descriptive_stats(_BASE * k)
    for key in ("mean", "median", "std", "sem", "q1", "q3", "iqr"):
        assert s[key] == pytest.approx(ref[key] * k, rel=1e-12), key
    # scale-free shape statistics are identical, and never a ZeroDivision
    assert s["skewness"] == pytest.approx(ref["skewness"], rel=1e-12)
    assert s["kurtosis"] == pytest.approx(ref["kurtosis"], rel=1e-12)
    assert math.isfinite(s["std"]) and s["std"] > 0


def test_power_of_two_scaling_is_bit_identical_on_ordinary_data() -> None:
    rng = np.random.default_rng(7)
    x = rng.normal(3.0, 2.0, 200)
    s = descriptive_stats(x)
    assert s["mean"] == float(np.mean(x))
    assert s["std"] == float(np.std(x, ddof=1))
    assert s["var"] == float(np.var(x, ddof=1))
    assert s["median"] == float(np.median(x))


def test_route_answers_for_tiny_values() -> None:
    client = TestClient(app)
    r = client.post("/api/stats/descriptive", json={"x": [1e-247, 2e-247, 3e-247, 5e-247]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["std"] > 0 and body["skewness"] is not None


def test_values_at_the_top_of_the_float_range_do_not_overflow_the_scale() -> None:
    # Bug hunt (live): a peak >= 2**1023 made frexp's exponent 1024 and
    # ldexp(1.0, 1024) raised OverflowError ("math range error", a 422).
    x = np.array([1e300, -1e308, 1e-300, 5.0])
    s = descriptive_stats(x)
    assert s["N"] == 4
    assert s["min"] == -1e308 and s["max"] == 1e300
    assert s["mean"] == pytest.approx(float(np.mean(x / 2.0**1023)) * 2.0**1023, rel=1e-12)
    client = TestClient(app)
    r = client.post("/api/stats/descriptive", json={"x": [1e300, -1e308, 1e-300, 5.0]})
    assert r.status_code == 200, r.text
