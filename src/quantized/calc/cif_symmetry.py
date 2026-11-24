"""Expand a CIF asymmetric unit to the full conventional cell (plan P3 / G6).

Pure ``calc/`` layer: takes the dict ``io.cif.import_cif`` returns, applies the
CIF symmetry operators (``'-x+1/2, y+1/2, -z'`` strings, International Tables
form; centering is applied only when the CIF lists it as operators, which a
conforming CIF does), wraps every image into ``[0, 1)`` and merges duplicates.

Rules (fail closed, never guess):

* An operator that is not exactly three comma-separated components, each a sum
  of signed ``x``/``y``/``z`` terms and numeric translations (``1/2``, ``0.25``,
  ``2/3``), raises :class:`SymmetryError` naming the operator. Coefficients such
  as ``2x`` and zero denominators are refused.
* A CIF with no operator list raises (P1 is NOT assumed from the absence of a
  list), as does a site with a non-finite coordinate.
* Duplicates are merged only between images of the **same** ``(label, symbol)``
  site whose fractional coordinates agree within ``tol`` (per axis, periodic;
  default :data:`DEFAULT_TOL`, provisional, owner to confirm). Different sites
  at one position (mixed occupancy) are kept. Occupancy, label and symbol are
  carried unchanged from the asymmetric-unit site.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from fractions import Fraction
from typing import Any

__all__ = [
    "DEFAULT_TOL",
    "AtomPosition",
    "ExpandedCell",
    "SymmetryError",
    "expand_to_cell",
    "parse_operator",
    "symmetry_operators",
]

# Fractional-coordinate merge tolerance (per axis). 1e-3 absorbs 4-digit CIF
# rounding (0.3333 vs 1/3) yet is far below any real inter-site distance.
DEFAULT_TOL = 1e-3

_OP_TAGS = ("_space_group_symop_operation_xyz", "_symmetry_equiv_pos_as_xyz")
_NUM = r"(?:\d+/\d+|\d+\.\d*|\.\d+|\d+)"
_TERM = rf"(?:[xyz]|{_NUM})"
_COMPONENT = re.compile(rf"[+-]?{_TERM}(?:[+-]{_TERM})*")
_TOKEN = re.compile(rf"([+-]?)([xyz]|{_NUM})")

Operator = tuple[tuple[tuple[int, int, int], ...], tuple[Fraction, Fraction, Fraction]]


class SymmetryError(ValueError):
    """The CIF symmetry data cannot be applied (the message says why)."""


@dataclass(frozen=True)
class AtomPosition:
    label: str
    symbol: str
    x: float
    y: float
    z: float
    occupancy: float


@dataclass(frozen=True)
class ExpandedCell:
    sites: tuple[AtomPosition, ...]
    n_operators: int
    tol: float


def _component(text: str, op: str) -> tuple[tuple[int, int, int], Fraction]:
    if not _COMPONENT.fullmatch(text):
        raise SymmetryError(f"unparseable symmetry operator {op!r}: bad component {text!r}")
    coef = [0, 0, 0]
    shift = Fraction(0)
    for m in _TOKEN.finditer(text):
        sign = -1 if m.group(1) == "-" else 1
        body = m.group(2)
        if body in "xyz":
            coef["xyz".index(body)] += sign
        else:
            try:
                shift += sign * Fraction(body)
            except ZeroDivisionError:
                msg = f"unparseable symmetry operator {op!r}: zero denominator"
                raise SymmetryError(msg) from None
    return (coef[0], coef[1], coef[2]), shift


def parse_operator(op: str) -> Operator:
    """Parse ``'-x+1/2, y, z+1/4'`` to ``(3x3 integer rotation, translation)``."""
    cleaned = re.sub(r"\s+", "", op.strip().strip("'\"").lower())
    parts = cleaned.split(",")
    if len(parts) != 3:
        raise SymmetryError(f"unparseable symmetry operator {op!r}: need 3 comma-separated parts")
    rows = [_component(p, op) for p in parts]
    rot = tuple(r[0] for r in rows)
    trans = (rows[0][1], rows[1][1], rows[2][1])
    return rot, trans


def symmetry_operators(parsed: dict[str, Any]) -> list[str]:
    """The operator strings the CIF lists (first matching loop), or raise."""
    for tag in _OP_TAGS:
        for lp in parsed.get("loops", []):
            tags = lp["tags"]
            if tag in tags:
                col = tags.index(tag)
                return [row[col] for row in lp["data"] if col < len(row)]
        value = parsed.get("tags", {}).get(tag)
        if value:  # a single-operator CIF writes it as a plain tag
            return [value]
    raise SymmetryError(
        "the CIF lists no symmetry operators (_space_group_symop_operation_xyz / "
        "_symmetry_equiv_pos_as_xyz); not assuming P1"
    )


def _wrap(v: float, tol: float) -> float:
    w = v - math.floor(v)
    return 0.0 if w > 1.0 - tol * 1e-3 else w  # 0.9999999999 -> 0


def _same(a: tuple[float, float, float], b: tuple[float, float, float], tol: float) -> bool:
    for u, v in zip(a, b, strict=True):
        d = abs(u - v)
        if min(d, 1.0 - d) > tol:
            return False
    return True


def expand_to_cell(parsed: dict[str, Any], tol: float = DEFAULT_TOL) -> ExpandedCell:
    """Apply every CIF operator to every site; wrap and merge duplicates."""
    if not (math.isfinite(tol) and 0.0 < tol < 0.1):
        raise SymmetryError("tol must be a fractional-coordinate tolerance in (0, 0.1)")
    ops = [parse_operator(s) for s in symmetry_operators(parsed)]
    if not ops:
        raise SymmetryError("the CIF symmetry operator list is empty")
    sites = parsed.get("atomSites", [])
    if not sites:
        raise SymmetryError("the CIF has no atom sites")
    out: list[AtomPosition] = []
    seen: dict[tuple[str, str], list[tuple[float, float, float]]] = {}
    for s in sites:
        xyz = (s["x"], s["y"], s["z"])
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in xyz):
            raise SymmetryError(f"atom site {s['label']!r} has a non-finite coordinate")
        occ = s.get("occupancy", float("nan"))
        key = (s["label"], s["symbol"])
        bucket = seen.setdefault(key, [])
        for rot, trans in ops:
            pos = tuple(
                _wrap(sum(rot[i][j] * xyz[j] for j in range(3)) + float(trans[i]), tol)
                for i in range(3)
            )
            p = (pos[0], pos[1], pos[2])
            if any(_same(p, q, tol) for q in bucket):
                continue
            bucket.append(p)
            out.append(AtomPosition(s["label"], s["symbol"], p[0], p[1], p[2], float(occ)))
    return ExpandedCell(tuple(out), len(ops), tol)
