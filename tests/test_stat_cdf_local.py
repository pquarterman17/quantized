"""Plan item 20 -- the CDF computed in the browser when the server is unreachable.

``frontend/src/lib/statCdfLocal.ts`` is the offline twin of :func:`quantized.calc.statplots_cdf.cdf_series`.
``tests/fixtures/wire/stat_cdf_local.json`` holds numpy's answer for a few awkward samples (ties, a
constant column, a NaN, a count scale, a band, two columns of different length); this test keeps the
fixture equal to what the backend computes now (``QZ_WRITE_FIXTURES=1`` rewrites it), and the vitest
``statCdfLocal.test.ts`` holds the browser code to it. The ECDF is also checked here against
``np.sort`` / ``np.arange`` directly.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from quantized.calc.statplots_cdf import cdf_series

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "stat_cdf_local.json"

CASES: list[dict[str, Any]] = [
    {"name": "ties make one taller step", "columns": [[3.0, 1.0, 2.0, 2.0, 2.0, 5.0]], "y": "proportion", "band": False},
    {"name": "a NaN is dropped, the band is DKW alpha 0.05", "columns": [[0.5, math.nan, -1.25, 4.0, 4.0, 7.5, 0.25]], "y": "proportion", "band": True},
    {"name": "count scale over two columns of different length", "columns": [[1.0, 2.0, 3.0], [10.0, 20.0, 20.0, 30.0, 40.0]], "y": "count", "band": True},
    {"name": "a constant column pads the domain by half a unit", "columns": [[4.0, 4.0, 4.0]], "y": "proportion", "band": True},
]


def _json_safe(v: Any) -> Any:
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if isinstance(v, list):
        return [_json_safe(a) for a in v]
    if isinstance(v, dict):
        return {k: _json_safe(a) for k, a in v.items()}
    return v


def _fresh() -> dict[str, Any]:
    return {
        "cases": [
            {**c, "columns": _json_safe(c["columns"]),
             "expected": cdf_series(c["columns"], y=c["y"], band=c["band"])}
            for c in CASES
        ]
    }


def test_the_fixture_is_what_the_backend_computes() -> None:
    fresh = _fresh()
    if os.environ.get("QZ_WRITE_FIXTURES") == "1":
        FIXTURE.write_text(json.dumps(fresh, indent=2) + "\n", encoding="utf-8")
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == json.loads(json.dumps(fresh))


def test_a_sample_without_ties_is_np_sort_over_arange() -> None:
    rng = np.random.default_rng(7)
    v = rng.normal(size=40)
    out = cdf_series([v])["series"][0]
    np.testing.assert_allclose(out["x"], np.sort(v), rtol=0, atol=0)
    np.testing.assert_allclose(out["y"], np.arange(1, 41) / 40, rtol=1e-15)


@pytest.mark.parametrize("n", [1, 5, 40])
def test_the_band_half_width_is_dkw(n: int) -> None:
    eps = cdf_series([np.arange(n, dtype=float)], band=True)["series"][0]["band"]["eps"]
    assert eps == pytest.approx(np.sqrt(np.log(2 / 0.05) / (2 * n)), rel=1e-15)
