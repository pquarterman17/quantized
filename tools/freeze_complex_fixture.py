# ruff: noqa: E501
"""Freeze the complex-number formula oracle
(``frontend/src/lib/__fixtures__/formulaComplex.json``).

Usage: ``uv run python tools/freeze_complex_fixture.py``. Each case is a
formula over the columns ``x, A, B, C`` (the table below) whose value is a
complex number; the expected real and imaginary parts per row are computed
here with Python's ``cmath`` (numpy cross-checks most of them), independently
of the TypeScript evaluator. ``lib/formulaComplex.test.ts`` evaluates
``re(expr)`` and ``im(expr)`` through the app's computed-column path and
compares within a relative 1e-12 and an absolute 1e-15
(plans/COMPLEX_FORMULA_CONTRACT.md C10). Re-run only when the case list changes.
"""

from __future__ import annotations

import cmath
import json
import math
from collections.abc import Callable
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parents[1] / "frontend/src/lib/__fixtures__/formulaComplex.json"

COLUMNS = {
    "x": [0.5, 1.0, 2.0, -1.5],
    "A": [1.0, -2.0, 0.5, 3.0],
    "B": [2.0, 0.5, -1.0, -4.0],
    "C": [-1.0, 1.5, 3.0, 0.25],
}

Row = dict[str, float]
Num = complex | float


def z(r: Row) -> complex:
    return complex(r["A"], r["B"])


def w(r: Row) -> complex:
    return complex(r["C"], r["x"])


def zero_base(_: Row) -> complex:
    # 0^w is 0 for Re(w) > 0 (Python raises on a zero base: stated by hand)
    return 0j


# (expression, expected per row, numpy cross-check or None)
CASES: list[tuple[str, Callable[[Row], Num], Callable[[Row], Num] | None]] = [
    # the three sources
    ("complex(A, B)", z, lambda r: np.complex128(r["A"] + 1j * r["B"])),
    ("polar(A, B)", lambda r: cmath.rect(r["A"], r["B"]), lambda r: r["A"] * np.exp(1j * r["B"])),
    ("polar(2, pi / 2)", lambda r: cmath.rect(2, math.pi / 2), None),
    ("2i", lambda r: 2j, None),
    ("0.5j", lambda r: 0.5j, None),
    ("1e3i", lambda r: 1000j, None),
    (".25i + A", lambda r: 0.25j + r["A"], None),
    ("A + B*1i", lambda r: r["A"] + r["B"] * 1j, None),
    ("2i * 2i", lambda r: -4 + 0j, None),
    # arithmetic
    ("complex(A, B) + complex(C, x)", lambda r: z(r) + w(r), None),
    ("complex(A, B) - complex(C, x)", lambda r: z(r) - w(r), None),
    ("complex(A, B) * complex(C, x)", lambda r: z(r) * w(r), lambda r: np.complex128(z(r)) * np.complex128(w(r))),
    ("complex(A, B) / complex(C, x)", lambda r: z(r) / w(r), lambda r: np.complex128(z(r)) / np.complex128(w(r))),
    ("-complex(A, B)", lambda r: -z(r), None),
    ("complex(A, B) * 3", lambda r: z(r) * 3, None),
    ("3 / complex(A, B)", lambda r: 3 / z(r), None),
    ("A + complex(0, B)", lambda r: r["A"] + 1j * r["B"], None),
    ("1 / (1 + 2i * pi * x * 1e-3)", lambda r: 1 / (1 + 2j * math.pi * r["x"] * 1e-3), None),
    # powers: exact small integers, principal value otherwise
    ("complex(A, B) ^ 2", lambda r: z(r) ** 2, None),
    ("complex(A, B) ** 3", lambda r: z(r) ** 3, None),
    ("complex(A, B) ^ -2", lambda r: z(r) ** -2, None),
    ("(1 + 2i) ^ 2", lambda r: (1 + 2j) ** 2, None),
    ("-complex(A, B) ** 2", lambda r: -(z(r) ** 2), None),
    ("complex(A, B) ^ 0.5", lambda r: z(r) ** 0.5, None),
    ("complex(A, B) ^ complex(0.5, 0.25)", lambda r: z(r) ** complex(0.5, 0.25), None),
    ("2 ^ complex(A, B)", lambda r: 2 ** z(r), None),
    ("(-2) ^ complex(0.5, 0.25)", lambda r: (-2) ** complex(0.5, 0.25), None),
    ("complex(-8, 0) ^ (1 / 3)", lambda r: complex(-8, 0) ** (1 / 3), None),
    ("complex(A, B) ^ complex(C, x)", lambda r: z(r) ** w(r), None),
    ("complex(A, B) ^ 0", lambda r: 1 + 0j, None),
    ("complex(0, 0) ^ 0", lambda r: 1 + 0j, None),
    ("complex(0, 0) ^ complex(1, 1)", zero_base, None),
    # functions, principal branch
    ("exp(complex(A, B))", lambda r: cmath.exp(z(r)), lambda r: np.exp(z(r))),
    ("log(complex(A, B))", lambda r: cmath.log(z(r)), lambda r: np.log(z(r))),
    ("ln(complex(A, B))", lambda r: cmath.log(z(r)), None),
    ("log10(complex(A, B))", lambda r: cmath.log10(z(r)), lambda r: np.log10(z(r))),
    ("sqrt(complex(A, B))", lambda r: cmath.sqrt(z(r)), lambda r: np.sqrt(z(r))),
    ("sin(complex(A, B))", lambda r: cmath.sin(z(r)), lambda r: np.sin(z(r))),
    ("cos(complex(A, B))", lambda r: cmath.cos(z(r)), lambda r: np.cos(z(r))),
    ("tan(complex(A, B))", lambda r: cmath.tan(z(r)), lambda r: np.tan(z(r))),
    ("sinh(complex(A, B))", lambda r: cmath.sinh(z(r)), lambda r: np.sinh(z(r))),
    ("cosh(complex(A, B))", lambda r: cmath.cosh(z(r)), lambda r: np.cosh(z(r))),
    ("tanh(complex(A, B))", lambda r: cmath.tanh(z(r)), lambda r: np.tanh(z(r))),
    ("abs(complex(A, B))", lambda r: abs(z(r)), lambda r: np.abs(z(r))),
    ("arg(complex(A, B))", lambda r: cmath.phase(z(r)), lambda r: np.angle(z(r))),
    ("angle(complex(A, B))", lambda r: cmath.phase(z(r)), None),
    ("conj(complex(A, B))", lambda r: z(r).conjugate(), lambda r: np.conj(z(r))),
    ("re(complex(A, B))", lambda r: r["A"], None),
    ("real(complex(A, B))", lambda r: r["A"], None),
    ("im(complex(A, B))", lambda r: r["B"], None),
    ("imag(complex(A, B))", lambda r: r["B"], None),
    ("np.real(complex(A, B)) + np.imag(complex(A, B))", lambda r: r["A"] + r["B"], None),
    ("np.angle(complex(A, B)) + np.conj(1)", lambda r: cmath.phase(z(r)) + 1, None),
    ("exp(1i * pi)", lambda r: cmath.exp(1j * math.pi), None),
    ("exp(complex(0, x))", lambda r: cmath.exp(1j * r["x"]), None),
    ("sqrt(complex(A, B) * complex(A, B))", lambda r: cmath.sqrt(z(r) * z(r)), None),
    # branch cuts (the principal value is the contract)
    ("sqrt(complex(-1, 0))", lambda r: 1j, None),
    ("sqrt(complex(-4, 0))", lambda r: 2j, None),
    ("log(complex(-1, 0))", lambda r: cmath.log(-1 + 0j), None),
    ("log(complex(-2.5, 0))", lambda r: cmath.log(-2.5 + 0j), None),
    ("arg(complex(-1, 0))", lambda r: math.pi, None),
    ("arg(-1)", lambda r: math.pi, None),
    ("arg(2)", lambda r: 0.0, None),
    ("arg(complex(0, -1))", lambda r: -math.pi / 2, None),
    # a complex value inside a real-valued reduction
    ("abs(complex(B, C))", lambda r: abs(complex(r["B"], r["C"])), None),
    ("degrees(arg(complex(B, C)))", lambda r: math.degrees(cmath.phase(complex(r["B"], r["C"]))), None),
    ("abs(1 / (1 + 2i * pi * x * 1e-3))", lambda r: abs(1 / (1 + 2j * math.pi * r["x"] * 1e-3)), None),
    ("hypot(re(complex(A, B)), im(complex(A, B)))", lambda r: math.hypot(r["A"], r["B"]), None),
    # comparison
    ("complex(A, B) == complex(A, B)", lambda r: 1.0, None),
    ("complex(A, B) != complex(A, B)", lambda r: 0.0, None),
    ("complex(A, B) == complex(A, 0)", lambda r: 0.0, None),
    ("complex(1, 0) == 1", lambda r: 1.0, None),
    ("complex(A, 0) < B", lambda r: float(r["A"] < r["B"]), None),
    ("complex(A, 0) >= complex(C, 0)", lambda r: float(r["A"] >= r["C"]), None),
    # conditionals carry a complex branch; the condition is real
    ("if(A > 0, complex(A, B), conj(complex(A, B)))", lambda r: z(r) if r["A"] > 0 else z(r).conjugate(), None),
    ("A > 0 ? complex(A, B) : complex(B, A)", lambda r: z(r) if r["A"] > 0 else complex(r["B"], r["A"]), None),
    ("where(B > 0, 2i, 3)", lambda r: 2j if r["B"] > 0 else 3 + 0j, None),
    ("if(A > 0 and B > 0, 1i, 0)", lambda r: 1j if r["A"] > 0 and r["B"] > 0 else 0j, None),
]

# Formulas whose complex result has imaginary part exactly 0 write the real part (C6).
REAL_RESULT: list[tuple[str, Callable[[Row], float]]] = [
    ("complex(A, 0)", lambda r: r["A"]),
    ("complex(A, B) * conj(complex(A, B))", lambda r: abs(z(r)) ** 2),
    ("complex(A, 0) * complex(B, 0)", lambda r: r["A"] * r["B"]),
]


def cell(v: float) -> float | str:
    return "NaN" if math.isnan(v) else v


def build() -> dict[str, object]:
    rows: list[Row] = [{k: v[i] for k, v in COLUMNS.items()} for i in range(4)]
    cases = []
    for expr, fn, check in CASES:
        got = [complex(fn(r)) for r in rows]
        if check is not None:
            want = np.asarray([complex(check(r)) for r in rows])
            np.testing.assert_allclose(np.asarray(got), want, rtol=1e-13, atol=1e-15, err_msg=expr)
        cases.append({"expr": expr, "re": [cell(g.real) for g in got], "im": [cell(g.imag) for g in got]})
    real = [{"expr": e, "value": [cell(float(f(r))) for r in rows]} for e, f in REAL_RESULT]
    return {"columns": COLUMNS, "cases": cases, "realResult": real}


def main() -> None:
    doc = build()
    OUT.write_text(json.dumps(doc, indent=1) + chr(10), encoding="utf-8")
    print(f"wrote {len(doc['cases'])} complex cases to {OUT}")  # type: ignore[arg-type]


if __name__ == "__main__":
    main()
