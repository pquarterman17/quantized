"""Freeze the complex-formula WIRE fixture
(``tests/fixtures/wire/formula_complex_headless.json``).

The app's evaluator (``frontend/src/lib/formulaComplex.ts``) and the headless
one an exported script runs (``calc/column_formula_complex.py``) must give the
same column. Both are asserted against this one file: the vitest
``lib/formulaComplexHeadless.test.ts`` and ``tests/test_column_formula_complex.py``,
each within a float tolerance (a 1-ULP libm difference is not a failure).

The expected values are NOT taken from either evaluator. The complex cases come
from ``frontend/src/lib/__fixtures__/formulaComplex.json`` (frozen from Python's
``cmath`` by ``tools/freeze_complex_fixture.py``), wrapped as ``re(...)`` /
``im(...)`` because a worksheet cell is real (contract C1, C6); the rest are
stated by hand below with numpy. Expressions the headless subset does not
evaluate (comparisons, ``if``, ``?:``) are listed under ``refused``.

Usage: ``uv run python tools/freeze_complex_wire_fixture.py``.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend/src/lib/__fixtures__/formulaComplex.json"
OUT = ROOT / "tests/fixtures/wire/formula_complex_headless.json"
NAN = float("nan")
APP_ONLY = re.compile(r"[<>=!?]|\bif\(|\bwhere\(")


def cell(v: float | str) -> float | str:
    if isinstance(v, str):
        return v
    return "NaN" if math.isnan(v) else v


def col(a: np.ndarray) -> list[float | str]:
    return [cell(float(v)) for v in a]


def main() -> None:
    src = json.loads(SRC.read_text(encoding="utf-8"))
    cols = src["columns"]
    x, a, b = (np.asarray(cols[k], float) for k in ("x", "A", "B"))
    nan4 = ["NaN"] * 4
    cases: list[dict[str, object]] = []
    refused: list[str] = []
    for c in src["cases"]:
        if APP_ONLY.search(c["expr"]):
            refused.append(f"re({c['expr']})")
            continue
        cases.append({"expr": f"re({c['expr']})", "values": c["re"]})
        cases.append({"expr": f"im({c['expr']})", "values": c["im"]})
    for r in src["realResult"]:  # C6: an imaginary part of exactly 0 writes the real part
        cases.append({"expr": r["expr"], "values": r["value"]})
    odd = np.floor(x - 1)  # [-1, 0, 1, -3]: zero on row 1 only
    with np.errstate(all="ignore"):
        extra: list[tuple[str, list[float | str]]] = [
            # C3: a real formula is untouched, sqrt(-1) and friends stay blank
            ("sqrt(-1)", nan4),
            ("log(-1)", nan4),
            ("(-8)^(1/3)", nan4),
            ("acos(2)", nan4),
            ("sqrt(A) + 1", col(np.sqrt(a) + 1)),
            # the part functions of a real value
            ("re(A)", col(a)),
            ("im(A)", [0.0] * 4),
            ("conj(A)", col(a)),
            ("arg(-1)", [math.pi] * 4),
            # item 33: the same parts of a real COLUMN (no complex source), as the app gives them
            ("real(A) + imag(B)", col(a)),
            ("abs(A)", col(np.abs(a))),
            ("abs(B)", col(np.abs(b))),
            ("arg(A)", col(np.where(a < 0, np.pi, 0.0))),
            ("angle(B)", col(np.where(b < 0, np.pi, 0.0))),
            ("conj(B)", col(b)),
            ("re(A) * im(A) + conj(A)", col(a)),
            ("arg(A * 0)", col(np.arctan2(0.0, a * 0))),  # -0 is negative: pi
            # C6: a complex result blanks the column, a part of it does not
            ("complex(A, B)", nan4),
            ("2i", nan4),
            ("sqrt(complex(-1, 0))", nan4),
            # real-only operators and functions refuse a complex operand
            ("complex(A, B) // 2", nan4),
            ("complex(A, B) % 2", nan4),
            ("atan(complex(A, B))", nan4),
            ("max(complex(A, B), 1)", nan4),
            ("atan(complex(A, 0))", col(np.arctan(a))),
            # the app throws per row and blanks that cell only (row 1 has im = 0)
            ("atan(complex(A, floor(x - 1)))", col(np.where(odd == 0, np.arctan(a), np.nan))),
            # ...but a complex RESULT on any row blanks the whole column
            ("complex(A, floor(x - 1))", nan4),
            ("re(1 / 0i)", nan4),
        ]
    for expr, values in extra:
        cases.append({"expr": expr, "values": values})
    doc = {"columns": cols, "cases": cases, "refused": refused, "pairs": pair_cases(cols)}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(cases)} cases and {len(refused)} refused to {OUT}")


def pair_cases(cols: dict[str, list[float]]) -> list[dict[str, object]]:
    """Whole-expression pair cases (re/im columns), from numpy."""
    z = np.asarray(cols["A"], float) + 1j * np.asarray(cols["B"], float)
    x = np.asarray(cols["x"], float)
    w = np.asarray(cols["C"], float) + 1j * x
    with np.errstate(all="ignore"):
        rows = [
            ("complex(A, B) * complex(C, x)", z * w),
            ("1 / (1 + 2i * pi * x * 1e-3)", 1 / (1 + 2j * np.pi * x * 1e-3)),
            ("exp(complex(0, x))", np.exp(1j * x)),
            ("sqrt(complex(A, B))", np.sqrt(z)),
        ]
    return [{"expr": e, "re": col(np.real(v)), "im": col(np.imag(v))} for e, v in rows]


if __name__ == "__main__":
    main()
