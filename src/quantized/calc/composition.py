r"""Composition helpers (DiraCulator ``buildXrayNeutronTab`` Cards 5-6).

Ports ``+calc/+xrayNeutron/atomicToWeightPercent.m``,
``weightToAtomicPercent.m`` and ``coDepositionRatio.m``. Pure calc layer.
Atomic masses come from the golden :mod:`quantized.calc.element_data` table.

**Weight ↔ atomic percent.** The inputs need not sum to 100. They are
normalised first, as in MATLAB:

.. math::

    \text{wt\%}_i = \frac{\text{at\%}_i M_i}{\sum_j \text{at\%}_j M_j} \times 100,
    \qquad
    \text{at\%}_i = \frac{\text{wt\%}_i / M_i}{\sum_j \text{wt\%}_j / M_j} \times 100

**Co-deposition flux ratio.** A linear cation-matching model. Each source is
matched to the first of its non-oxygen elements that appears in the target.
The molar flux it must supply per target formula unit is
``needed_i = n_target(cation) / n_source(cation)``. The ratios are normalised
so the smallest is 1. Note the MATLAB docstring's La0.7Sr0.3MnO3 example
quotes Mn-normalised ratios ``[0.35, 0.30, 1.0]``; the MATLAB *code* (the
behavioural reference, ported here) normalises to the smallest flux, giving
``[1.1667, 1, 3.3333]``. Likewise its ``weightToAtomicPercent`` example quotes
``[46.58, 53.42]`` for Fe/O at 70/30 wt%; the code gives ``[40.07, 59.93]``.

Formulas are parsed with :func:`quantized.calc.formula.parse_formula`. For the
plain formulas MATLAB's ``parseFormula`` accepts (no parentheses), both give the
same counts in the same first-appearance order. The Python parser is stricter
on two inputs MATLAB silently misreads: it expands parenthesised groups
(MATLAB ignores the group multiplier), and it rejects stray characters (MATLAB
drops them).

Python-only extension: ``co_deposition_ratio`` also warns when a target cation
is matched to no source, or to more than one. MATLAB returns those ratios
without comment. The numbers themselves are unchanged.

MATLAB's ``latex`` result fields are GUI display strings and are not ported.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from quantized.calc.element_data import by_symbol
from quantized.calc.formula import parse_formula

__all__ = ["atomic_to_weight_percent", "co_deposition_ratio", "weight_to_atomic_percent"]


def _masses(elements: Sequence[str], values: Sequence[float], what: str) -> list[float]:
    """Validate a symbols/percentages pair and look up each element's mass."""
    if len(elements) == 0:
        raise ValueError("enter at least one element")
    if len(elements) != len(values):
        raise ValueError(f"elements and {what} must have the same number of entries")
    for v in values:
        if not (math.isfinite(v) and v > 0):
            raise ValueError(f"every {what} value must be positive and finite")
    return [float(by_symbol(sym)["mass"]) for sym in elements]


def atomic_to_weight_percent(
    elements: Sequence[str], atomic_pct: Sequence[float]
) -> dict[str, Any]:
    """Convert atomic percent to weight percent (``atomicToWeightPercent.m``).

    Returns ``weight_pct``, ``elements``, ``atomic_pct`` (normalised to 100) and
    ``masses`` (g/mol), each in input order.

    >>> [round(w, 2) for w in atomic_to_weight_percent(["Fe", "O"], [2, 3])["weight_pct"]]
    [69.94, 30.06]
    """
    masses = _masses(elements, atomic_pct, "atomic percent")
    total = sum(atomic_pct)
    at_norm = [v / total * 100 for v in atomic_pct]
    mass_prop = [p * m for p, m in zip(at_norm, masses, strict=True)]
    mass_total = sum(mass_prop)
    return {
        "weight_pct": [p / mass_total * 100 for p in mass_prop],
        "elements": list(elements),
        "atomic_pct": at_norm,
        "masses": masses,
    }


def weight_to_atomic_percent(
    elements: Sequence[str], weight_pct: Sequence[float]
) -> dict[str, Any]:
    """Convert weight percent to atomic percent (``weightToAtomicPercent.m``).

    Returns ``atomic_pct``, ``elements``, ``weight_pct`` (normalised to 100) and
    ``masses`` (g/mol), each in input order.

    >>> [round(a, 2) for a in weight_to_atomic_percent(["Fe", "O"], [70, 30])["atomic_pct"]]
    [40.07, 59.93]
    """
    masses = _masses(elements, weight_pct, "weight percent")
    total = sum(weight_pct)
    wt_norm = [v / total * 100 for v in weight_pct]
    molar_prop = [p / m for p, m in zip(wt_norm, masses, strict=True)]
    molar_total = sum(molar_prop)
    return {
        "atomic_pct": [p / molar_total * 100 for p in molar_prop],
        "elements": list(elements),
        "weight_pct": wt_norm,
        "masses": masses,
    }


def co_deposition_ratio(formula: str, sources: Sequence[str]) -> dict[str, Any]:
    """Relative source fluxes for co-depositing a target film (``coDepositionRatio.m``).

    ``sources`` are formula strings (e.g. ``["Sr", "TiO2"]``). Oxygen is treated
    as the anion and never matched. Raises if a source supplies no target
    cation. Returns ``ratios`` (smallest = 1), ``needed`` (molar flux per
    target formula unit), ``cations`` (the matched cation per source),
    ``sources``, ``formula``, and ``warnings`` (plain-language strings).

    >>> co_deposition_ratio("SrTiO3", ["Sr", "TiO2"])["ratios"]
    [1.0, 1.0]
    """
    if len(sources) == 0:
        raise ValueError("enter at least one source")
    target = parse_formula(formula)
    needed: list[float] = []
    cations: list[str] = []
    warnings: list[str] = []
    for source in sources:
        parsed = parse_formula(source)
        matches = [sym for sym in parsed if sym != "O" and sym in target]
        if not matches:
            raise ValueError(
                f"source '{source}' contains no cation found in target formula '{formula}'"
            )
        cation = matches[0]
        if target[cation] <= 0 or parsed[cation] <= 0:
            raise ValueError(f"{cation} must have a positive count in '{formula}' and '{source}'")
        if len(matches) > 1:
            warnings.append(
                f"source '{source}' matches multiple target cations; using first match ({cation})"
            )
        needed.append(target[cation] / parsed[cation])
        cations.append(cation)
    smallest = min(needed)
    # Python-only extension (see module docstring): coverage warnings.
    missing = [sym for sym in target if sym != "O" and sym not in cations]
    if missing:
        warnings.append(f"no source is matched to {', '.join(missing)} from '{formula}'")
    repeated = sorted({sym for sym in cations if cations.count(sym) > 1})
    if repeated:
        warnings.append(f"more than one source supplies {', '.join(repeated)}")
    return {
        "ratios": [n / smallest for n in needed],
        "needed": needed,
        "cations": cations,
        "sources": list(sources),
        "formula": formula,
        "warnings": warnings,
    }
