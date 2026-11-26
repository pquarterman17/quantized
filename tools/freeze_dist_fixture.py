"""Freeze the distribution-function parity grid
(``frontend/src/lib/__fixtures__/formulaDist.json``).

Usage: ``uv run python tools/freeze_dist_fixture.py``. Every case is a formula
over the columns ``A, B, C, D`` of a small table whose rows are the Cartesian
product of the listed argument values; the expected column is what the Python
mirror (``calc/column_formula_dist.py``, scipy.stats) returns through
``evaluate_formula``. ``tests/test_column_formula_dist.py`` replays the grid
against the mirror; ``lib/formulaDist.test.ts`` replays it against the
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

OUT = Path(__file__).resolve().parents[1] / "frontend/src/lib/__fixtures__/formulaDist.json"
NAN = math.nan
INF = math.inf

X = [-4.0, -1.5, -0.2, 0.0, 0.3, 1.0, 2.5, 7.0]
POS = [0.0, 0.01, 0.3, 1.0, 2.5, 9.0, 40.0]
P = [0.0, 1e-10, 0.001, 0.05, 0.3, 0.5, 0.7, 0.975, 1 - 1e-9, 1.0]
SH = [0.5, 1.0, 2.0, 7.5, 30.0]  # shapes / df
TAILS = [1.0, 2.0]

# name -> (argument value lists; tail values for the optional last argument)
CASES: dict[str, tuple[list[list[float]], list[float] | None]] = {
    "normpdf": ([X, [-1.0, 0.0, 2.0], [0.5, 1.0, 3.0]], None),
    "normcdf": ([[*X, -9.0, 9.0, -30.0, 30.0]], TAILS),
    "norminv": ([P + [-0.1, 1.5, NAN]], None),
    "tpdf": ([X, SH + [1e3]], None),
    "tcdf": ([[*X, -50.0, 50.0], SH + [1e3]], TAILS),
    "tinv": ([P, SH + [1e3]], None),
    "chi2pdf": ([POS, SH], None),
    "chi2cdf": ([POS + [200.0], SH], TAILS),
    "chi2inv": ([P, SH], None),
    "fpdf": ([POS, SH, [1.0, 4.0, 25.0]], None),
    "fcdf": ([POS + [200.0], SH, [1.0, 4.0, 25.0]], TAILS),
    "finv": ([P, SH, [1.0, 4.0, 25.0]], None),
    "gampdf": ([POS, SH, [0.5, 1.0, 3.0]], None),
    "gamcdf": ([POS + [200.0], SH, [0.5, 1.0, 3.0]], TAILS),
    "gaminv": ([P, SH, [0.5, 1.0, 3.0]], None),
    "betapdf": ([[0.0, 0.01, 0.2, 0.5, 0.9, 1.0], SH, [0.5, 1.0, 3.0, 12.0]], None),
    "betacdf": ([[0.0, 0.01, 0.2, 0.5, 0.9, 1.0], SH, [0.5, 1.0, 3.0, 12.0]], TAILS),
    "betainv": ([P, SH, [0.5, 1.0, 3.0, 12.0]], None),
    "lognpdf": ([[-1.0, 0.0, 0.2, 1.0, 3.0, 40.0], [-1.0, 0.0, 1.5], [0.4, 1.0, 2.0]], None),
    "logncdf": ([[-1.0, 0.0, 0.2, 1.0, 3.0, 40.0], [-1.0, 0.0, 1.5], [0.4, 1.0, 2.0]], TAILS),
    "logninv": ([P, [-1.0, 0.0, 1.5], [0.4, 1.0, 2.0]], None),
    "wblpdf": ([POS, [0.5, 2.0, 10.0], [0.7, 1.0, 2.0, 5.0]], None),
    "wblcdf": ([POS, [0.5, 2.0, 10.0], [0.7, 1.0, 2.0, 5.0]], TAILS),
    "wblinv": ([[p for p in P if p < 1.0], [0.5, 2.0, 10.0], [0.7, 1.0, 2.0, 5.0]], None),
    "exppdf": ([[-1.0, *POS], [0.1, 1.0, 4.0]], None),
    "expcdf": ([[-1.0, *POS], [0.1, 1.0, 4.0]], TAILS),
    "expinv": ([P, [0.1, 1.0, 4.0]], None),
    "poisspdf": ([[-1.0, 0.0, 1.0, 2.5, 3.0, 10.0, 40.0], [0.0, 0.5, 3.0, 25.0]], None),
    "poisscdf": ([[-1.0, 0.0, 1.0, 2.5, 3.0, 10.0, 40.0, INF], [0.0, 0.5, 3.0, 25.0]], None),
    "binopdf": (
        [
            [-1.0, 0.0, 1.0, 2.5, 3.0, 10.0, 20.0, 21.0],
            [0.0, 1.0, 20.0, 150.0],
            [0.0, 0.01, 0.4, 0.9, 1.0],
        ],
        None,
    ),
    "binocdf": (
        [
            [-1.0, 0.0, 1.0, 2.5, 3.0, 10.0, 20.0, 21.0],
            [0.0, 1.0, 20.0, 150.0],
            [0.0, 0.01, 0.4, 0.9, 1.0],
        ],
        None,
    ),
}

# Rows outside the domain or with a blank argument, per function, appended as
# explicit argument tuples: (name, [args...]).
EXTRA: dict[str, list[list[float]]] = {
    "normpdf": [[0.0, 0.0, 0.0], [0.0, 0.0, -1.0], [NAN, 0.0, 1.0], [0.0, NAN, 1.0]],
    "tcdf": [
        [1.0, 0.0],
        [1.0, -2.0],
        [NAN, 3.0],
        [0.5, 3.0, 0.0],
        [0.5, 3.0, 3.0],
        [0.5, 3.0, NAN],
    ],
    "gamcdf": [[1.0, 0.0, 1.0], [1.0, 2.0, 0.0], [NAN, 2.0, 1.0]],
    "binopdf": [[1.0, 2.5, 0.3], [1.0, -1.0, 0.3], [1.0, 5.0, 1.5], [NAN, 5.0, 0.3]],
    "chi2inv": [[0.5, 0.0], [1.5, 3.0]],
    "betacdf": [[0.5, 0.0, 1.0], [0.5, 1.0, -1.0]],
}

# The optional-tail forms are evaluated with and without it.
LETTERS = "ABCD"


def _enc(v: float) -> float | str:
    if math.isnan(v):
        return "NaN"
    if math.isinf(v):
        return "Infinity" if v > 0 else "-Infinity"
    return v


def _case(name: str, rows: list[tuple[float, ...]], nargs: int) -> dict[str, object]:
    cols = [[r[i] for r in rows] for i in range(nargs)]
    data = DataStruct.create(
        np.zeros(len(rows)),
        np.column_stack(cols),
        labels=list(LETTERS[:nargs]),
        units=[""] * nargs,
    )
    expr = f"{name}({', '.join(LETTERS[:nargs])})"
    out = evaluate_formula(data, expr)
    return {
        "expr": expr,
        "args": [[_enc(v) for v in c] for c in cols],
        "expected": [_enc(float(v)) for v in out],
    }


def main() -> None:
    cases: list[dict[str, object]] = []
    for name, (lists, tails) in CASES.items():
        rows = [tuple(r) for r in itertools.product(*lists)]
        for extra in EXTRA.get(name, []):
            if len(extra) == len(lists):
                rows.append(tuple(extra))
        cases.append(_case(name, rows, len(lists)))
        if tails is not None:
            tailed = [(*r, t) for r in itertools.product(*lists) for t in tails]
            tailed += [tuple(e) for e in EXTRA.get(name, []) if len(e) == len(lists) + 1]
            cases.append(_case(name, tailed, len(lists) + 1))
    OUT.write_text(json.dumps({"cases": cases}, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(cases)} cases, {sum(len(c['expected']) for c in cases)} values -> {OUT}")  # type: ignore[arg-type]


if __name__ == "__main__":
    main()
