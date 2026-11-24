"""Shewhart control-chart constants (GAP_AUDIT_9 J14).

Source (published tables, NOT invented; marked "unverified - owner to check"
until the owner confirms them against the owner's textbook):

* ``d2``, ``d3``, ``c4`` for n = 2..25 are copied from the York University
  "Factors useful in the Construction of Control Charts" table
  (https://www.york.ac.uk/depts/maths/histstat/tables/controlfactors.pdf),
  which agrees with Montgomery, *Introduction to Statistical Quality Control*,
  Appendix VI, and the NIST/SEMATECH e-Handbook of Statistical Methods
  section 6.3.2.1 (https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc321.htm)
  for the columns NIST prints (A2, D3, D4 for n = 2..10) and d2 = 1.128 (6.3.2.2).
* ``A2``, ``A3``, ``B3``, ``B4``, ``D3``, ``D4`` are the textbook formulas of
  those three (see ``a2`` ... ``d4`` below); ``tests/test_calc_spc.py`` checks
  every one against the published table (York, all n; NIST A2/D3/D4, n<=10) to
  the table's own rounding (the d2/d3/c4 inputs carry 3-4 decimals, so a
  derived constant can differ from a printed one in the last digit).

The tabulated (rounded) values are used on purpose so that numbers reproduce
the textbook and NIST worked examples digit for digit (NIST 6.3.2.2 uses
d2 = 1.128). Subgroup size is limited to the published range 2..25; beyond
it the caller is refused (nothing is extrapolated).
"""

from __future__ import annotations

import math

# n: (d2, d3, c4)
_TABLE: dict[int, tuple[float, float, float]] = {
    2: (1.128, 0.852, 0.7979),
    3: (1.693, 0.888, 0.8862),
    4: (2.059, 0.879, 0.9213),
    5: (2.326, 0.864, 0.9400),
    6: (2.534, 0.848, 0.9515),
    7: (2.704, 0.833, 0.9594),
    8: (2.847, 0.819, 0.9650),
    9: (2.970, 0.807, 0.9693),
    10: (3.078, 0.797, 0.9727),
    11: (3.173, 0.787, 0.9754),
    12: (3.258, 0.778, 0.9776),
    13: (3.336, 0.770, 0.9794),
    14: (3.407, 0.763, 0.9810),
    15: (3.472, 0.756, 0.9823),
    16: (3.532, 0.750, 0.9835),
    17: (3.588, 0.744, 0.9845),
    18: (3.640, 0.738, 0.9854),
    19: (3.689, 0.733, 0.9862),
    20: (3.735, 0.728, 0.9869),
    21: (3.778, 0.724, 0.9876),
    22: (3.819, 0.719, 0.9882),
    23: (3.858, 0.715, 0.9887),
    24: (3.895, 0.712, 0.9892),
    25: (3.931, 0.708, 0.9896),
}

N_MIN = 2
N_MAX = 25


def _row(n: int) -> tuple[float, float, float]:
    if n not in _TABLE:
        raise ValueError(
            f"subgroup size {n} is outside the published constants table "
            f"({N_MIN}..{N_MAX}); split or aggregate the subgroups"
        )
    return _TABLE[n]


def d2(n: int) -> float:
    return _row(n)[0]


def d3(n: int) -> float:
    return _row(n)[1]


def c4(n: int) -> float:
    return _row(n)[2]


def a2(n: int) -> float:
    """3 / (d2 sqrt(n)): X-bar limits from R-bar."""
    return 3.0 / (d2(n) * math.sqrt(n))


def a3(n: int) -> float:
    """3 / (c4 sqrt(n)): X-bar limits from s-bar."""
    return 3.0 / (c4(n) * math.sqrt(n))


def b3(n: int) -> float:
    c = c4(n)
    return max(0.0, 1.0 - 3.0 * math.sqrt(1.0 - c * c) / c)


def b4(n: int) -> float:
    c = c4(n)
    return 1.0 + 3.0 * math.sqrt(1.0 - c * c) / c


def d3_lower(n: int) -> float:
    """Table constant ``D3`` (R chart lower limit factor): max(0, 1 - 3 d3/d2)."""
    return max(0.0, 1.0 - 3.0 * d3(n) / d2(n))


def d4_upper(n: int) -> float:
    """Table constant ``D4`` (R chart upper limit factor): 1 + 3 d3/d2."""
    return 1.0 + 3.0 * d3(n) / d2(n)


def published_constants(n: int) -> dict[str, float]:
    """Every constant for subgroup size ``n`` (used in results for provenance)."""
    return {
        "n": float(n),
        "d2": d2(n),
        "d3": d3(n),
        "c4": c4(n),
        "A2": a2(n),
        "A3": a3(n),
        "B3": b3(n),
        "B4": b4(n),
        "D3": d3_lower(n),
        "D4": d4_upper(n),
    }
