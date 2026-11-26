"""Freeze the special/engineering-function parity grid
(``frontend/src/lib/__fixtures__/formulaWave2.json``).

Usage: ``uv run python tools/freeze_extra_fixture.py``. Each case is a formula
over the columns ``A, B, C, D`` of a table whose rows are the Cartesian product
of the listed argument values; the expected column is what the Python mirror
(``calc/column_formula_extra.py``, scipy.special / numpy) returns through
``evaluate_formula``. ``tests/test_column_formula_extra.py`` replays the grid
against the mirror; ``lib/formulaWave2.test.ts`` replays it against the
TypeScript numerics. Re-run only when the grid changes.
"""

from __future__ import annotations

import itertools
import json
import math
from pathlib import Path

import numpy as np

from quantized.calc.column_formula import evaluate_formula
from quantized.datastruct import DataStruct

OUT = Path(__file__).resolve().parents[1] / "frontend/src/lib/__fixtures__/formulaWave2.json"
NAN = math.nan
INF = math.inf
LETTERS = "ABCD"

CASES: dict[str, list[list[float]]] = {
    "erf": [[-6, -2, -0.5, 0, 1e-3, 0.3, 1, 1.2, 3, 10, 26, NAN, INF, -INF]],
    "erfc": [[-6, -2, -0.5, 0, 1e-3, 0.3, 1, 1.2, 3, 10, 26, 27.5, NAN, INF, -INF]],
    "gamma": [[-3.5, -1, -0.3, 0, 0.1, 0.5, 1, 2.5, 5, 10, 50, 100, 150, 171, 172, NAN]],
    "lgamma": [[0.1, 0.5, 1, 2, 10, 100, 1e5, -0.5, -2.5, 0, -1, NAN]],
    "erfinv": [
        [-1, -0.999999, -0.9, -0.5, -1e-10, 0, 1e-10, 0.1, 0.5, 0.7, 0.99, 1 - 1e-12, 1, 1.5, NAN]
    ],
    "erfcinv": [
        [0, 1e-300, 1e-100, 1e-10, 0.01, 0.3, 0.99, 1, 1.5, 1.99, 2 - 1e-10, 2, 2.5, NAN, -0.1]
    ],
    "beta": [[0.1, 0.5, 1, 2.5, 10, 50, -1, 0], [0.1, 1, 3, 20, 0]],
    "lbeta": [[0.1, 0.5, 1, 2.5, 10, 50, 200, -1, 0], [0.1, 1, 3, 20, 200, 0]],
    "digamma": [
        [
            -5.5,
            -2.1,
            -0.5,
            -1e-5,
            0,
            1e-5,
            0.1,
            0.5,
            1,
            1.4616321449683623,
            2,
            5.5,
            10,
            100,
            1e6,
            -1,
            -2,
            NAN,
            INF,
        ]
    ],
    "besselj": [
        [0, 1, 2, 3, 5, 10, -1, -2, 0.5, 501],
        [-30, -5, -0.1, 0, 1e-6, 0.5, 1, 2.4048255576957727, 5, 10, 25, 50, 100, 1000, 6000, NAN],
    ],
    "bessely": [
        [0, 1, 2, 3, 10, -1, -2, 0.5],
        [-1, 0, 1e-6, 0.1, 0.5, 1, 2, 5, 10, 24.9, 25, 30, 100, 1000, 6000, NAN],
    ],
    "sinc": [[-3.5, -1, -0.5, 0, 1e-9, 0.25, 1, 2.5, 100.5, NAN, INF]],
    "clamp": [[-5, 0, 3, 10, NAN], [0, 1, -2], [2, 5, -3]],
    "heaviside": [[-1, 0, 1, NAN], [0, 0.5, 1]],
    "todb": [[0.001, 1, 10, 0, -1, NAN, 1e-300]],
    "fromdb": [[-60, -3, 0, 20, 100, NAN]],
    "degrees": [[-720, -1, 0, 0.5, 90, 360, NAN]],
    "radians": [[-720, -1, 0, 0.5, 90, 360, NAN]],
    "mod": [[-7, -5.5, 0, 3, 7, 10.25], [3, -3, 2.5, 0, INF, -INF]],
    "trunc": [[-2.7, -0.2, 0, 3.9, NAN, INF]],
    "fact": [[0, 1, 5, 10, 20, 100, 170, 171, -1, 2.5, NAN]],
    "combin": [[0, 1, 5, 10, 52, 100, 200], [0, 1, 3, 5, 10, 50, 100, -1, 2.5]],
    "permut": [[0, 1, 5, 10, 30, 100], [0, 1, 3, 5, 10, 50]],
    "gcd": [[0, 12, 17, 100, 1e10, -4, 2.5], [0, 18, 5, 75]],
    "lcm": [[0, 12, 17, 100, 1e5, -4, 2.5], [0, 18, 5, 75]],
    "isnan": [[0, NAN, INF, -1]],
    "ifnan": [[1, NAN], [7, NAN]],
    "between": [[0, 1, 2, NAN], [0, 1.5], [1, 2]],
    "wrap": [[-370, -180, 0, 180, 190, 720.5], [-180, 0], [180, 360, -5]],
    "choose": [[0, 1, 2, 3, 4, 2.9, NAN], [10], [20], [30]],
    "cbrt": [[-27, -1, 0, 2, 1e300, NAN]],
    "expm1": [[-1, -1e-10, 0, 1e-10, 1, 10, 800]],
    "log1p": [[-1, -0.5, -1e-10, 0, 1e-10, 1, 1e10, -2]],
}


def _enc(v: float) -> float | str:
    if math.isnan(v):
        return "NaN"
    if math.isinf(v):
        return "Infinity" if v > 0 else "-Infinity"
    return v


def main() -> None:
    cases: list[dict[str, object]] = []
    for name, lists in CASES.items():
        rows = list(itertools.product(*lists))
        nargs = len(lists)
        cols = [[float(r[i]) for r in rows] for i in range(nargs)]
        data = DataStruct.create(
            np.zeros(len(rows)),
            np.column_stack(cols),
            labels=list(LETTERS[:nargs]),
            units=[""] * nargs,
        )
        expr = f"{name}({', '.join(LETTERS[:nargs])})"
        out = evaluate_formula(data, expr)
        cases.append(
            {
                "expr": expr,
                "args": [[_enc(v) for v in c] for c in cols],
                "expected": [_enc(float(v)) for v in out],
            }
        )
    OUT.write_text(json.dumps({"cases": cases}, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(cases)} cases, {sum(len(c['expected']) for c in cases)} values -> {OUT}")  # type: ignore[arg-type]


if __name__ == "__main__":
    main()
