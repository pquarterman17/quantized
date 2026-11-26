"""Capture the matrices a case created (Origin writes gridding output there).

``run.py`` records worksheets through ``read_books``; matrix books are a
separate window class, so this module reads them. Each captured matrix keeps
its values as ``z[row][col]`` (Origin's own orientation: rows run along Y,
columns along X) together with the X and Y coordinates of its columns and rows,
recovered with Origin's own ``m2w`` XYZ conversion into a scratch book that is
closed again.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np


def _windows(s: Any, kind: str) -> list[str]:
    s.lt('string __acc$ = "";')
    s.lt(f'doc -e {kind} {{ __acc$ = "%(__acc$)%H|"; }}')
    return [w for w in str(s.app.LTStr("__acc$")).split("|") if w]


def matrix_windows(s: Any) -> list[str]:
    """Short names of every open matrix book, in creation order."""
    return _windows(s, "M")


def _cell(v: Any) -> float | None:
    return None if not isinstance(v, (int, float)) or not math.isfinite(v) else float(v)


def _axes(s: Any, name: str) -> tuple[list[float], list[float]]:
    """Column X values and row Y values of matrix ``name`` via ``m2w`` XYZ."""
    before = set(_windows(s, "W"))
    s.lt(f"win -a {name};")
    if not s.lt(f"m2w im:=[{name}]1! method:=xyz ow:=<new>;"):
        raise RuntimeError(f"m2w failed for matrix {name}")
    scratch = sorted(set(_windows(s, "W")) - before)
    try:
        raw = [list(r) for r in s.app.GetWorksheet(f"[{scratch[0]}]1")]
    finally:
        for w in scratch:
            s.lt(f"win -cd {w};")
    xs = list(dict.fromkeys(float(r[0]) for r in raw if _cell(r[0]) is not None))
    ys = list(dict.fromkeys(float(r[1]) for r in raw if _cell(r[1]) is not None))
    return xs, ys


def capture_matrices(s: Any, before: set[str]) -> list[dict[str, Any]]:
    """Read and close every matrix book that is not in ``before``."""
    out: list[dict[str, Any]] = []
    for name in matrix_windows(s):
        if name in before:
            continue
        z = np.array(s.app.GetMatrix(f"[{name}]1!1"), dtype=object)
        xs, ys = _axes(s, name)
        rows, cols = z.shape
        out.append(
            {
                "book": name,
                "rows": rows,
                "cols": cols,
                "x": xs,
                "y": ys,
                "z": [[_cell(v) for v in row] for row in z.tolist()],
            }
        )
        s.lt(f"win -cd {name};")
    return out
