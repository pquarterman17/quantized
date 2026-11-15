"""The worksheet formula functions' numpy/scipy reference values (gap audit 4, G3).

``frontend/src/lib/formulaMath.test.ts`` checks erf/erfc/gamma/lgamma/round/
floor/ceil with digits, the seeded random draws and ``interp`` against the
values in ``frontend/src/lib/__fixtures__/formulaMath.json``. This test
recomputes that file from numpy/scipy and fails when it differs, so the
frontend's expectations are provably numpy's and scipy's own answers. After a
deliberate change, rewrite it with ``write_fixture()``.

Non-finite numbers are stored as the strings "inf", "-inf" and "nan" (JSON has
no spelling for them).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import scipy.special as sp

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "frontend"
    / "src"
    / "lib"
    / "__fixtures__"
    / "formulaMath.json"
)

ERF_X = [
    -30.0,
    -6.0,
    -3.2,
    -2.5,
    -1.0,
    -0.3,
    -1e-9,
    0.0,
    1e-12,
    0.1,
    0.5,
    0.9,
    1.4,
    2.0,
    2.49,
    2.5,
    3.0,
    4.2,
    5.5,
    8.0,
    26.0,
    27.5,
]
GAMMA_X = [
    -4.5,
    -1.5,
    -0.5,
    -1e-3,
    1e-8,
    0.1,
    0.5,
    1.0,
    1.5,
    2.0,
    3.0,
    4.75,
    7.3,
    10.0,
    14.9,
    15.2,
    25.5,
    60.1,
    100.0,
    140.25,
    170.5,
    171.0,
    171.5,
    172.0,
]
GAMMA_POLES = [0.0, -1.0, -2.0, -17.0]
# Review L1: next to a negative pole, next to lgamma's zeros at 1 and 2, the
# overflow edge, and a dense sweep (no whole numbers) across the real line.
GAMMA_HARD = [
    -100.000001,
    -50.5,
    -20.0000001,
    -0.9999999,
    0.7,
    0.9,
    0.95,
    1.0 + 1e-9,
    1.15,
    1.2,
    1.21,
    1.79,
    1.8,
    1.85,
    2.0 - 1e-10,
    2.15,
    2.2,
    171.6,
    171.62,
    171.6243769,
]
GAMMA_SWEEP = [round(float(v), 6) for v in np.linspace(-30.37, 171.55, 401)]
ROUND_CASES = [
    [0.5, 0],
    [1.5, 0],
    [2.5, 0],
    [-0.5, 0],
    [-1.5, 0],
    [-2.5, 0],
    [1.005, 2],
    [0.125, 2],
    [0.375, 2],
    [2.675, 2],
    [1234.5, -1],
    [1250.0, -2],
    [1350.0, -2],
    [-1234.5678, 3],
    [3.14159, 4],
    [1e20, 2],
    [7.0, 5],
]
FLOOR_CASES = [[1.237, 2], [-1.231, 2], [0.29, 2], [1234.5, -2], [-1234.5, -2], [5.0, 0], [2.5, 1]]
SEEDS = [0, 1, 42, 4294967295]
N_DRAWS = 1300  # past one 624-word twist of the generator, twice
DRAW_AT = [*range(10), *range(620, 630), *range(1290, N_DRAWS)]  # the ones stored
INTERP_X = [0.0, 1.0, 2.5, 4.0, 7.0]
INTERP_Y = [1.0, 3.0, -2.0, 0.5, 10.0]
INTERP_AT = [-1.0, 0.0, 0.5, 1.0, 2.0, 2.5, 3.9, 4.0, 6.999, 7.0, 7.5]


def _num(v: float) -> float | str:
    if math.isnan(v):
        return "nan"
    if math.isinf(v):
        return "inf" if v > 0 else "-inf"
    return float(v)


def _nums(vs: Any) -> list[float | str]:
    return [_num(float(v)) for v in np.asarray(vs, dtype=float).ravel()]


def _scaled(op: Any, v: float, n: int) -> float:
    """``op`` at ``n`` decimal digits, scaled the way ``numpy.round`` scales."""
    return float(op(v * 10.0**n) / 10.0**n if n >= 0 else op(v / 10.0**-n) * 10.0**-n)


def build_fixture() -> dict[str, Any]:
    with np.errstate(all="ignore"):
        gamma_all = GAMMA_X + GAMMA_POLES + GAMMA_HARD + GAMMA_SWEEP
        return {
            "erf": {"x": ERF_X, "erf": _nums(sp.erf(ERF_X)), "erfc": _nums(sp.erfc(ERF_X))},
            "gamma": {
                "x": gamma_all,
                "gamma": _nums(sp.gamma(gamma_all)),
                "gammaln": _nums(sp.gammaln(gamma_all)),
            },
            "round": [[v, n, _num(float(np.round(v, n)))] for v, n in ROUND_CASES],
            "floor": [[v, n, _num(_scaled(np.floor, v, n))] for v, n in FLOOR_CASES],
            "ceil": [[v, n, _num(_scaled(np.ceil, v, n))] for v, n in FLOOR_CASES],
            "random": {
                "n": N_DRAWS,
                "at": DRAW_AT,
                **{
                    str(s): {
                        "uniform": _nums(np.random.RandomState(s).random_sample(N_DRAWS)[DRAW_AT]),
                        "normal": _nums(np.random.RandomState(s).standard_normal(N_DRAWS)[DRAW_AT]),
                    }
                    for s in SEEDS
                },
            },
            "interp": {
                "x": INTERP_X,
                "y": INTERP_Y,
                "at": INTERP_AT,
                "out": _nums(np.interp(INTERP_AT, INTERP_X, INTERP_Y, left=np.nan, right=np.nan)),
            },
        }


def write_fixture() -> None:
    FIXTURE.write_text(json.dumps(build_fixture(), indent=1) + "\n", encoding="utf-8")


#: numpy/scipy round differently per platform libm (measured in CI: ``np.interp``
#: on macOS gives 0.3333333333333335 where Linux gives ...333; scipy's ``gamma``
#: on Windows differs from Linux by up to ~1e-13 relative near x = 170), so
#: floats are compared to a tolerance; structure, strings and non-finite markers
#: must match exactly. The gamma family gets 1e-12, everything else a few ulp.
REL_TOL = 1e-14
GAMMA_REL_TOL = 1e-12


def _mismatches(a: Any, b: Any, path: str = "$", tol: float = REL_TOL) -> list[str]:
    if isinstance(a, dict) and isinstance(b, dict):
        if a.keys() != b.keys():
            return [f"{path}: keys {sorted(a)} != {sorted(b)}"]
        return [
            m
            for k in a
            for m in _mismatches(
                a[k], b[k], f"{path}.{k}", GAMMA_REL_TOL if path == "$" and k == "gamma" else tol
            )
        ]
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return [f"{path}: length {len(a)} != {len(b)}"]
        return [
            m
            for i, (x, y) in enumerate(zip(a, b, strict=True))
            for m in _mismatches(x, y, f"{path}[{i}]", tol)
        ]
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        ok = math.isclose(float(a), float(b), rel_tol=tol, abs_tol=0.0)
        return [] if ok else [f"{path}: {a!r} != {b!r}"]
    return [] if a == b else [f"{path}: {a!r} != {b!r}"]


def test_formula_math_fixture_is_numpy_and_scipy() -> None:
    committed = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert _mismatches(committed, json.loads(json.dumps(build_fixture()))) == []


def test_fixture_comparison_still_catches_real_differences() -> None:
    base = {"a": [1.0, "nan", 2.0]}
    assert _mismatches(base, {"a": [1.0 + 1e-16, "nan", 2.0]}) == []
    assert _mismatches(base, {"a": [1.0 + 1e-12, "nan", 2.0]}) != []
    assert _mismatches(base, {"a": [1.0, 0.0, 2.0]}) != []
    assert _mismatches(base, {"a": [1.0, "nan"]}) != []
    gam = {"gamma": {"gamma": [5.786155468978127e254]}}
    assert _mismatches(gam, {"gamma": {"gamma": [5.786155468978367e254]}}) == []
    assert _mismatches(gam, {"gamma": {"gamma": [5.7861554689e254]}}) != []
    assert _mismatches({"erf": [5.786155468978127e254]}, {"erf": [5.786155468978367e254]}) != []
