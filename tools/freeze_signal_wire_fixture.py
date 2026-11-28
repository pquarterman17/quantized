"""Freeze ``tests/fixtures/wire/formula_signal_headless.json``: the whole-column
signal functions (``savgol``, ``movmax``, ``movmin``, ``cummax``, ``cummin``,
``cumprod``), ``savgol``'s boundary modes and the ``movavg`` family
(``movavg``, ``movmedian``, ``movrms``, ``movsum``, ``movsd``, ``movslope``,
``emovavg``) computed by scipy / numpy ALONE, never by the code under test.

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
for col in "AC":
    for mode in ("mirror", "nearest", "constant", "wrap", "interp"):
        for w, p in [(3, 0), (5, 2), (7, 3), (9, 2), (23, 4)]:
            want = savgol_filter(COLS[col], w, p, mode=mode)
            cases.append((f"savgol({col}, {w}, {p}, {mode})", want))
for mode in ("mirror", "constant", "wrap", "interp"):
    cases.append((f"savgol(x, 5, 2, {mode})", savgol_filter(X, 5, 2, mode=mode)))


def slope_window(y: np.ndarray, back: int, fwd: int) -> np.ndarray:
    out = np.full(N, np.nan)
    for r in range(N):
        lo, hi = max(0, r - back), r + fwd + 1
        wx, wy = X[lo:hi], y[lo:hi]
        ok = np.isfinite(wx) & np.isfinite(wy)
        if np.isfinite(y[r]) and ok.sum() >= 2:
            out[r] = np.polyfit(wx[ok], wy[ok], 1)[0]  # least squares, not the code's sums
    return out


def ema(y: np.ndarray, n: int) -> np.ndarray:
    alpha = 2.0 / (n + 1)
    out = np.full(N, np.nan)
    good = np.flatnonzero(np.isfinite(y))
    state = y[good[0]]
    for r in good:
        state = y[r] if r == good[0] else alpha * y[r] + (1 - alpha) * state
        out[r] = state
    return out


STATS = {
    "movavg": np.mean,
    "movmedian": np.median,
    "movrms": lambda w: np.sqrt(np.mean(w**2)),
    "movsum": np.sum,
    "movsd": lambda w: np.std(w, ddof=1) if len(w) > 1 else np.nan,
}
for col in "AB":
    for back, fwd in [(0, 0), (1, 1), (3, 0), (0, 4), (60, 60)]:
        for name, f in STATS.items():
            cases.append((f"{name}({col}, {back}, {fwd})", moving(COLS[col], back, fwd, f)))
        cases.append((f"movslope({col}, {back}, {fwd})", slope_window(COLS[col], back, fwd)))
for col in "AB":
    for n in (1, 3, 10):
        cases.append((f"emovavg({col}, {n})", ema(COLS[col], n)))
cases.append(("A - movavg(A, 2, 2)", A - moving(A, 2, 2, np.mean)))
cases.append(("A - savgol(A, 5, 2)", A - savgol_filter(A, 5, 2, mode="nearest")))
cases.append(
    (
        "savgol(A, 5, 2, mirror) - savgol(A, 5, 2)",
        savgol_filter(A, 5, 2, mode="mirror") - savgol_filter(A, 5, 2, mode="nearest"),
    )
)
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
        "savgol(A, 5, 2, bogus)",
        "savgol(A, 5, 2, 1)",
        "savgol(A, 5, 2, B)",
        "savgol(A, 5, 2, mirror, wrap)",
        "savgol(A, 5, 2, Mirror)",
        "movavg(A, 1)",
        "movavg(A + B, 1, 1)",
        "movavg(A, -1, 1)",
        "movavg(A, B, 1)",
        "movmedian(A, 1, C)",
        "emovavg(A)",
        "emovavg(A, 3, 4)",
        "emovslope(A, 1, 1)",
    ],
    # the app computes these (the arguments may be expressions or columns); a script cannot
    "app_only": [
        "movavg(A, 1, 1 + 1)",
        "emovavg(A, 2 + 1)",
        "movslope(A, abs(-1), 1)",
    ],
}
OUT.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
print(f"{len(cases)} cases -> {OUT}")
