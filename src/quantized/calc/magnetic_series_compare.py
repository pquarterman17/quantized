"""Unit plan for overlaying several M(T) or M(H) series on one scale.

The overlay itself is a worksheet assembled by the caller (one X,Y pair per
series, no resampling, so a non-monotonic loop keeps its acquisition order).
This module owns the one thing that must not be guessed: the factors that put
every series' X and Y in the same unit, and the refusal when they cannot be.

* Field axes convert through :func:`magnetometry_units.field_factor`
  (Oe, T, mT, A/m); temperature axes must already be kelvin.
* Moment / magnetization units convert only within one family (total moment,
  per mass, per volume, per area) using the factors of
  :mod:`magnetometry_normalization` (``OUTPUT_PER_EMU``). A different family
  needs a sample quantity this module is never given, so it is refused: the
  caller normalizes first (Units tab).
* A blank unit is refused. Identical non-blank unit strings that this module
  does not know (for example ``cm³/mol``) pass through with factor 1: nothing
  is converted, so nothing can be mis-converted.
"""

from __future__ import annotations

from typing import Any

from .magnetometry_normalization import BASIS_OUTPUT_UNITS, OUTPUT_PER_EMU
from .magnetometry_units import field_factor

__all__ = ["series_unit_plan"]

_ALIASES = {"emu/cm3": "emu/cm³", "emu/cm2": "emu/cm²", "A m^2": "A·m²", "Am2": "A·m²"}
_FAMILY = {unit: basis for basis, units in BASIS_OUTPUT_UNITS.items() for unit in units}
_FAMILY_NAME = {
    "none": "total moment", "mass": "per mass", "volume": "per volume", "area": "per area",
}


def _canon(unit: str) -> str:
    u = unit.strip()
    return _ALIASES.get(u, u)


def _x_plan(axis: str, units: list[str], target: str | None) -> tuple[str, list[float]]:
    if any(not u for u in units):
        raise ValueError("every series needs a declared X unit; none may be blank")
    if axis == "temperature":
        bad = [u for u in units if u != "K"]
        if bad:
            raise ValueError(
                f'temperature axes must be in K (found "{bad[0]}"); convert them first, '
                "no offset conversion is guessed here"
            )
        if target not in (None, "K"):
            raise ValueError("the temperature target unit must be K")
        return "K", [1.0] * len(units)
    to = target or units[0]
    factors: list[float] = []
    for u in units:
        factor, ok, reason = field_factor(u, to)
        if not ok:
            raise ValueError(reason)
        factors.append(factor)
    return to, factors


def _y_plan(units: list[str], target: str | None) -> tuple[str, list[float]]:
    if any(not u for u in units):
        raise ValueError("every series needs a declared Y unit; none may be blank")
    canon = [_canon(u) for u in units]
    to = _canon(target) if target else canon[0]
    if all(u == to for u in canon):
        return to, [1.0] * len(units)
    unknown = sorted({u for u in [*canon, to] if u not in OUTPUT_PER_EMU})
    if unknown:
        raise ValueError(
            f'the Y unit "{unknown[0]}" differs between series and is not a known moment '
            "or magnetization unit, so it cannot be converted"
        )
    families = {_FAMILY[u] for u in [*canon, to]}
    if len(families) > 1:
        names = ", ".join(sorted(_FAMILY_NAME[f] for f in families))
        raise ValueError(
            f"the series are not on one basis ({names}); a conversion between bases needs "
            "a sample mass or volume, so normalize each worksheet first (Units tab)"
        )
    return to, [OUTPUT_PER_EMU[to] / OUTPUT_PER_EMU[u] for u in canon]


def series_unit_plan(
    series: list[dict[str, Any]],
    *,
    axis: str,
    x_unit: str | None = None,
    y_unit: str | None = None,
) -> dict[str, Any]:
    """Return ``{x_unit, y_unit, series: [{label, x_factor, y_factor}]}``.

    ``series`` items carry ``label``, ``x_unit`` and ``y_unit`` (declared
    strings). ``axis`` is ``"field"`` or ``"temperature"``. Targets default to
    the first series' units. Raises ``ValueError`` (fail closed) on fewer than
    two series, a blank or unknown unit, kelvin-less temperature, or mixed bases.
    """
    if axis not in ("field", "temperature"):
        raise ValueError('axis must be "field" or "temperature"')
    if len(series) < 2:
        raise ValueError("comparison needs at least two series")
    to_x, x_factors = _x_plan(axis, [str(s["x_unit"]).strip() for s in series], x_unit)
    to_y, y_factors = _y_plan([str(s["y_unit"]) for s in series], y_unit)
    return {
        "axis": axis,
        "x_unit": to_x,
        "y_unit": to_y,
        "series": [
            {"label": str(s.get("label", "")), "x_factor": xf, "y_factor": yf}
            for s, xf, yf in zip(series, x_factors, y_factors, strict=True)
        ],
    }
