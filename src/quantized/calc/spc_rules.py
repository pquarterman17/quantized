"""Western Electric run rules 1-4 and Nelson-style rules 5-8 for control charts (GAP_AUDIT_9 J14).

Rules (Western Electric Company, *Statistical Quality Control Handbook*, 1956;
as tabulated in Montgomery, *Introduction
to Statistical Quality Control*, Ch. 6 "Sensitizing rules"). Zone = distance
from the center line in units of the plotted statistic's own sigma:

* ``we1``  one point beyond 3 sigma;
* ``we2``  two of three consecutive points beyond 2 sigma, same side;
* ``we3``  four of five consecutive points beyond 1 sigma, same side;
* ``we4``  ``run_length`` consecutive points on one side of the center line
  (default 8, the Western Electric run; Nelson's version uses 9. Provisional,
  owner to confirm which default to ship).

* ``nel5``  6 points in a row steadily increasing or steadily decreasing (trend);
* ``nel6``  14 points in a row alternating up and down;
* ``nel7``  15 points in a row within 1 sigma of the center line, either side
  (stratification);
* ``nel8``  8 points in a row more than 1 sigma from the center line, either
  side of it (mixture).

``nel5``-``nel8`` continue the list after ``we1``-``we4`` (Nelson, "The Shewhart
control chart - tests for special causes", *J. Quality Technology* 16(4),
237-239, 1984; Minitab's Test 3, 4, 7, 8). Their numbers 5-8 here are the
position in THIS list; in Nelson's own numbering they are tests 3, 4, 7 and 8.
Run lengths are Nelson's fixed values (not user options). Provisional, owner to
confirm. A rule flags the point that COMPLETES the pattern (Minitab's convention), so
a single drifting run does not paint every earlier point. Rules 2-4 assume the
plotted statistic is roughly normal: they are meaningful for X-bar, X and
(for large counts) P/NP/C/U charts but only rule 1 is applied to dispersion
charts (R, S, MR), whose distribution is skewed. Each rule is opt-in.
"""

from __future__ import annotations

from typing import Any

import numpy as np

RULES: dict[str, str] = {
    "we1": "1 point beyond 3 sigma",
    "we2": "2 of 3 points beyond 2 sigma (same side)",
    "we3": "4 of 5 points beyond 1 sigma (same side)",
    "we4": "points in a row on one side of the center line",
    "nel5": "6 points in a row steadily increasing or decreasing",
    "nel6": "14 points in a row alternating up and down",
    "nel7": "15 points in a row within 1 sigma of the center line",
    "nel8": "8 points in a row more than 1 sigma from the center line (both sides)",
}


def check_rules(
    values: np.ndarray,
    center: float,
    sigma: np.ndarray,
    rules: list[str],
    run_length: int = 8,
) -> list[dict[str, Any]]:
    """Return ``[{"rule", "label", "indices"}]`` for each requested rule.

    ``sigma`` is the per-point sigma of the plotted statistic (> 0).
    """
    unknown = [r for r in rules if r not in RULES]
    if unknown:
        raise ValueError(f"unknown rule(s) {unknown}; choose from {sorted(RULES)}")
    if run_length < 2:
        raise ValueError("run_length must be at least 2")
    x = np.asarray(values, dtype=float)
    sg = np.asarray(sigma, dtype=float)
    ok = np.isfinite(x) & np.isfinite(sg) & (sg > 0)
    z = np.where(ok, (x - center) / np.where(ok, sg, 1.0), np.nan)
    out: list[dict[str, Any]] = []
    for rule in dict.fromkeys(rules):  # preserve order, drop duplicates
        idx: list[int] = []
        if rule == "we1":
            idx = [i for i in range(len(z)) if abs(z[i]) > 3.0]
        elif rule == "we2":
            idx = _window(z, 3, 2, 2.0)
        elif rule == "we3":
            idx = _window(z, 5, 4, 1.0)
        elif rule == "we4":
            idx = _run(z, run_length)
        elif rule == "nel5":
            idx = _monotone(x, 6)
        elif rule == "nel6":
            idx = _alternating(x, 14)
        elif rule == "nel7":
            idx = _all_in_row(z, 15, lambda v: abs(v) < 1.0)
        else:
            idx = _all_in_row(z, 8, lambda v: abs(v) > 1.0)
        label = RULES[rule] if rule != "we4" else f"{run_length} {RULES[rule]}"
        out.append({"rule": rule, "label": label, "indices": idx})
    return out


def _window(z: np.ndarray, width: int, need: int, limit: float) -> list[int]:
    hits: list[int] = []
    for i in range(len(z)):
        if np.isnan(z[i]):
            continue
        for side in (1.0, -1.0):
            if side * z[i] <= limit:
                continue
            win = z[max(0, i - width + 1) : i + 1]
            if int(np.sum(side * win > limit)) >= need:
                hits.append(i)
                break
    return hits


def _run(z: np.ndarray, length: int) -> list[int]:
    hits: list[int] = []
    run, side = 0, 0
    for i, v in enumerate(z):
        s = 0 if np.isnan(v) or v == 0 else (1 if v > 0 else -1)
        run = run + 1 if s != 0 and s == side else (1 if s != 0 else 0)
        side = s
        if run >= length:
            hits.append(i)
    return hits


def _monotone(x: np.ndarray, length: int) -> list[int]:
    """Points that complete ``length`` in a row steadily up or steadily down."""
    hits: list[int] = []
    up = down = 1
    for i in range(1, len(x)):
        d = x[i] - x[i - 1]
        up = up + 1 if d > 0 else 1
        down = down + 1 if d < 0 else 1
        if np.isnan(d):
            up = down = 1
        if up >= length or down >= length:
            hits.append(i)
    return hits


def _alternating(x: np.ndarray, length: int) -> list[int]:
    """Points that complete ``length`` in a row alternating up, down, up, ..."""
    hits: list[int] = []
    run, last = 1, 0
    for i in range(1, len(x)):
        d = x[i] - x[i - 1]
        s = 0 if np.isnan(d) or d == 0 else (1 if d > 0 else -1)
        run = run + 1 if s != 0 and last != 0 and s == -last else (2 if s != 0 else 1)
        last = s
        if run >= length:
            hits.append(i)
    return hits


def _all_in_row(z: np.ndarray, length: int, pred: Any) -> list[int]:
    """Points that complete ``length`` consecutive points all satisfying ``pred``."""
    hits: list[int] = []
    run = 0
    for i, v in enumerate(z):
        run = run + 1 if not np.isnan(v) and pred(v) else 0
        if run >= length:
            hits.append(i)
    return hits
