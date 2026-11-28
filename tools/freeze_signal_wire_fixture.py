"""Freeze ``tests/fixtures/wire/formula_signal_headless.json``: the whole-column
signal functions (``savgol``, ``movmax``, ``movmin``, ``cummax``, ``cummin``,
``cumprod``) computed by scipy / numpy ALONE, never by the code under test.

Asserted by ``tests/test_column_formula_signal.py`` (calc/column_formula.py, the
exported script) and ``frontend/src/lib/formulaSignal.test.ts`` (the app).
Run: ``uv run python tools/freeze_signal_wire_fixture.py``.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy.signal import savgol_filter

OUT = (
    Path(__file__).resolve().parent.parent
    / "tests"
    / "fixtures"
    / "wire"
    / "formula_signal_headless.json"
)
N = 24
rng = np.random.default_rng(33)
X = np.linspace(-1.0, 1.0, N)
A = np.round(np.sin(3 * X) + 0.3 * rng.standard_normal(N), 6)
B = np.round(rng.uniform(0.5, 2.0, N), 6)
B[[3, 12]] = np.nan  # blank cells
C = np.round(rng.uniform(0.8, 1.2, N), 6)


def moving(y: np.ndarray, back: int, fwd: int, f: object) -> np.ndarray:
    out = np.full(N, np.nan)
    for r in range(N):
        if np.isfinite(y[r]):
            w = y[max(0, r - back) : r + fwd + 1]
            out[r] = f(w[np.isfinite(w)])  # type: ignore[operator]
    return out


def running(y: np.ndarray, f: object) -> np.ndarray:
    out = np.full(N, np.nan)
    good = np.isfinite(y)
    out[good] = f(y[good])  # type: ignore[operator]
    return out


COLS = {"A": A, "B": B, "C": C}
cases: list[tuple[str, np.ndarray]] = []
for col in "AC":
    for w, p in [(3, 0), (5, 2), (7, 3), (9, 2), (23, 4)]:
        cases.append((f"savgol({col}, {w}, {p})", savgol_filter(COLS[col], w, p, mode="nearest")))
for col in "AB":
    for back, fwd in [(0, 0), (1, 1), (3, 0), (0, 4), (60, 60)]:
        cases.append((f"movmax({col}, {back}, {fwd})", moving(COLS[col], back, fwd, np.max)))
        cases.append((f"movmin({col}, {back}, {fwd})", moving(COLS[col], back, fwd, np.min)))
for col in "ABC":
    cases.append((f"cummax({col})", running(COLS[col], np.maximum.accumulate)))
    cases.append((f"cummin({col})", running(COLS[col], np.minimum.accumulate)))
    cases.append((f"cumprod({col})", running(COLS[col], np.cumprod)))
cases.append(("A - savgol(A, 5, 2)", A - savgol_filter(A, 5, 2, mode="nearest")))
cases.append(
    (
        "2 * movmax(C, 1, 1) + cummin(C)",
        2 * moving(C, 1, 1, np.max) + running(C, np.minimum.accumulate),
    )
)
cases.append(("savgol(x, 5, 2)", savgol_filter(X, 5, 2, mode="nearest")))


def cell(v: float) -> float | str:
    return "NaN" if np.isnan(v) else float(v)


doc = {
    "columns": {
        "x": [float(v) for v in X],
        **{k: [cell(float(v)) for v in c] for k, c in COLS.items()},
    },
    "cases": [{"expr": e, "values": [cell(float(v)) for v in vals]} for e, vals in cases],
    "refused": [
        "savgol(A + B, 5, 2)",
        "savgol(A)",
        "savgol(A, 5)",
        "savgol(A, 5, 2, 1)",
        "savgol(A, B, 2)",
        "movmax(A, -1, 1)",
        "movmax(A, 1)",
        "movmax(A, 1, 1 + 1)",
        "cummax(A, 1)",
        "cummax()",
        "cumprod(A * 2)",
        'movmin(rng("W"), 1, 1)',
        "cummin(A[1:3])",
        "savgol(pi, 5, 2)",
    ],
}
OUT.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
print(f"{len(cases)} cases -> {OUT}")
