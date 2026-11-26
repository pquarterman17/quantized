"""A map's values from a formula of ``x``, ``y`` and the existing value ``z``.

Origin's "Set Values" for a matrix, on the shared map grid. It reuses the
worksheet formula machinery of ``calc/column_formula`` (the same recursive-
descent parser over closures: no ``eval``, no ``exec``), so the grammar,
precedence and JavaScript-style IEEE results are the app's: ``+ - * / // % ^
**``, parentheses, ``pi``/``e``/``nan`` and the element-wise function table
(``sin``, ``exp``, ``log10``, ``sqrt``, ``abs``, ``atan2``, ``hypot``, ``min``,
``max`` ...), with ``np.`` / ``math.`` prefixes dropped.

Names: ``x`` and ``y`` are each cell's axis coordinates, ``z`` its current
value. ``column_formula`` knows columns by letter, so the names are mapped
(``y`` -> column A, ``z`` -> column B) AFTER the user's text is checked: a
bare ``A``, ``B`` or any other name is refused, as are comparisons,
conditionals, row indexing and the aggregates, exactly as in the headless
subset (``column_formula`` module doc). Every refusal is a ``ValueError``.

The result is a NEW map on the same axes (``map_op`` records the expression);
the input is never modified. Blank (NaN) cells stay blank unless the formula
defines them (``nan`` propagates). A result with no finite cell is refused.
Its unit is ``unit`` if given, else blank: the formula can change dimensions
(``z*x``) and nothing here can know how.
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np

from quantized.calc.column_formula import MAX_LEN, _evaluate
from quantized.calc.map_ops import MapGrid, replace_grid

__all__ = ["map_formula"]

_IDENT = re.compile(r"(?<![\w.])([A-Za-z_][A-Za-z0-9_]*)(\s*\()?", re.ASCII)
_PREFIX = {"np", "numpy", "math"}
_VARS = {"x": "x", "y": "A", "z": "B"}
_CONSTS = {"pi", "e", "nan"}


def _translate(expr: str) -> str:
    """``expr`` with ``y``/``z`` renamed to the column letters, after refusing
    every name other than ``x``, ``y``, ``z``, a constant or a called function."""
    if len(expr) > MAX_LEN:
        raise ValueError(f"the formula is longer than {MAX_LEN} characters")
    for m in _IDENT.finditer(expr):
        name, call = m.group(1), m.group(2)
        if call or name in _CONSTS or name in _VARS:
            continue
        if name in _PREFIX and expr[m.end(1) : m.end(1) + 1] == ".":
            continue
        raise ValueError(
            f'"{name}" is not a map variable: use x, y (the cell coordinates) and z (its value)'
        )

    def swap(m: re.Match[str]) -> str:
        name, call = m.group(1), m.group(2)
        return m.group(0) if call or name not in _VARS else _VARS[name]

    return _IDENT.sub(swap, expr)


def map_formula(
    g: MapGrid, expr: str, *, unit: str | None = None
) -> tuple[MapGrid, dict[str, Any]]:
    """The map with each cell set to ``expr(x, y, z)`` (see the module doc)."""
    if not expr.strip():
        raise ValueError("enter a formula, for example z * 2 + x")
    translated = _translate(expr)
    xx, yy = np.meshgrid(g.x, g.y)
    env = {
        "x": xx.ravel().astype(float),
        "A": yy.ravel().astype(float),
        "B": np.asarray(g.z, dtype=float).ravel(),
    }
    with np.errstate(all="ignore"):
        out = _evaluate(env, g.z.size, 2, translated)
    zz = out.reshape(g.z.shape)
    if not bool(np.isfinite(zz).any()):
        raise ValueError("the formula gives no finite value in any cell; nothing was created")
    info: dict[str, Any] = {
        "op": "formula",
        "expr": expr,
        "n_finite": int(np.isfinite(zz).sum()),
        "n_cells": int(zz.size),
    }
    return replace_grid(g, z=zz, z_unit=unit or ""), info
