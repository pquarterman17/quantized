"""SIMS depth calibration: sputter time -> depth (audit P2.3, box 1).

Pure calc layer (ndarray in -> ndarray + provenance out). There is no MATLAB
reference for this step: ``quantized_matlab``'s ``parser.importSIMS`` only
reads profiles that are already on a depth axis, so the formula here is the
textbook constant-sputter-rate calibration, tested against hand-computed
values rather than a golden freeze:

    depth = R * t

with the sputter rate ``R`` either entered directly (``method="rate"``) or
derived from a profilometer crater depth ``D`` measured after a total sputter
time ``T`` (``method="crater"``): ``R = D / T``. ``T`` defaults to the last
finite time point -- i.e. it assumes sputtering stopped at the last recorded
cycle -- and that assumption is always reported, because a profile whose
acquisition ended before the beam did would otherwise be silently stretched.

An already depth-like instrument coordinate can instead use ``method="scale"``:
``depth = scale_factor * x + offset``. This is deliberately explicit rather
than pretending the input is sputter time; it covers unit divisors/multipliers
and a non-zero surface origin while preserving both numbers in provenance.

Deliberate rules:

- **Time is measured from the start of sputtering (t = 0)**, not from the
  first recorded cycle: a first cycle at t = 1.2 s is 1.2 s of sputtering.
- **A constant rate** through the whole profile. A multilayer whose layers
  sputter at different rates is NOT corrected -- the provenance says
  ``"assumes": "constant sputter rate"`` so the result cannot pass for more.
- **For rate/crater calibration the x unit must be a time unit.** A blank or
  length unit is refused, by name, unless the caller states the time unit
  explicitly (``time_unit``), which is then recorded (and reported, when it
  overrides a recorded unit). Direct scaling intentionally accepts any unit.

Units are a small explicit table (not ``calc.unit_convert``, whose ``A`` is
the ampere -- SIMS files write Angstrom as ``A``).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from ..time_units import TIME_UNITS
from ._warn import warn as _warn

__all__ = [
    "LENGTH_UNITS",
    "TIME_UNITS",
    "calibrate_depth",
    "is_length_unit",
    "length_factor",
    "length_ratio",
    "rate_factor",
    "time_factor",
]

#: Length unit -> metres. Keys are matched case-sensitively after trimming,
#: then case-insensitively for the word forms. ``A`` is Angstrom here.
LENGTH_UNITS: dict[str, float] = {
    "m": 1.0,
    "cm": 1e-2,
    "mm": 1e-3,
    "um": 1e-6,
    "µm": 1e-6,
    "μm": 1e-6,
    "micron": 1e-6,
    "nm": 1e-9,
    "A": 1e-10,
    "Å": 1e-10,
    "ang": 1e-10,
    "angstrom": 1e-10,
}

#: The canonical spelling written back into metadata for each length unit.
_LENGTH_CANON = {"µm": "um", "μm": "um", "micron": "um", "Å": "A", "ang": "A", "angstrom": "A"}


def _lookup(table: dict[str, float], unit: str) -> float | None:
    u = unit.strip()
    if u in table:
        return table[u]
    low = u.lower()
    return next((v for k, v in table.items() if k.lower() == low and k != "A"), None)


def length_factor(unit: str) -> float:
    """Metres per ``unit``; raises ``ValueError`` naming an unknown unit."""
    f = _lookup(LENGTH_UNITS, unit)
    if f is None:
        raise ValueError(f"unknown length unit {unit!r} (use nm, um, A, cm, mm or m)")
    return f


def is_length_unit(unit: str) -> bool:
    """Whether ``unit`` is one of `LENGTH_UNITS`' spellings -- never ``""``/
    blank, which is "no unit", not "unitless length". Shared by
    ``calc.sims_compare`` (x-unit compatibility across profiles) and
    ``calc.sims_region`` (whether an integral over x can be an areal dose)."""
    if not unit.strip():
        return False
    try:
        length_factor(unit)
    except ValueError:
        return False
    return True


def time_factor(unit: str) -> float:
    """Seconds per ``unit``; raises ``ValueError`` naming an unknown unit."""
    f = _lookup(TIME_UNITS, unit)
    if f is None:
        raise ValueError(f"unknown time unit {unit!r} (use s, min or h)")
    return f


def rate_factor(unit: str) -> float:
    """(m/s) per one ``unit`` of sputter rate, e.g. ``"nm/s"`` -> 1e-9."""
    parts = unit.split("/")
    if len(parts) != 2:
        raise ValueError(f"sputter-rate unit must be length/time (e.g. nm/s), got {unit!r}")
    return length_factor(parts[0]) / time_factor(parts[1])


def length_ratio(a: str, b: str) -> float:
    """``a`` per ``b`` as an exact power of ten (every length unit here is one),
    so a same-unit ratio is exactly 1.0 and nm -> um is exactly 1e-3."""
    exp_a = round(math.log10(length_factor(a)))
    exp_b = round(math.log10(length_factor(b)))
    return float(10.0 ** (exp_a - exp_b))


def canonical_length(unit: str) -> str:
    """The spelling recorded for a length unit (``µm`` -> ``um``, ``Å`` -> ``A``)."""
    u = unit.strip()
    return _LENGTH_CANON.get(u, _LENGTH_CANON.get(u.lower(), u))


def _g(v: float) -> str:
    return f"{v:.6g}"


def _resolve_time_unit(recorded: str, stated: str | None) -> tuple[str, list[dict[str, Any]]]:
    """The time unit x is in, plus the report of how it was decided.

    ``recorded`` and ``stated`` are compared by TIME FACTOR, not spelling:
    ``"sec"`` recorded against a stated ``"s"`` is the same unit and must not
    warn (a literal string compare would report a spurious override for
    every merely differently-spelled but equal unit)."""
    if stated:
        stated_factor = time_factor(stated)  # validate
        recorded_factor = _lookup(TIME_UNITS, recorded) if recorded else None
        if recorded and recorded_factor != stated_factor:
            text = (
                f"x is recorded in {recorded!r} but was calibrated as time in {stated!r}, "
                "as you stated"
            )
            return stated, [_warn("unit-override", text, confirm=True)]
        return stated, []
    if not recorded:
        raise ValueError(
            "the x axis has no recorded unit; state the time unit it is in (s, min or h)"
        )
    if _lookup(TIME_UNITS, recorded) is None:
        what = "a length" if _lookup(LENGTH_UNITS, recorded) is not None else "not a time"
        raise ValueError(
            f"the x axis is in {recorded!r}, which is {what} unit -- time-to-depth "
            "calibration needs sputter time; state the time unit if x really is time"
        )
    return recorded, []


def calibrate_depth(
    x: NDArray[np.float64],
    *,
    x_unit: str,
    method: str,
    time_unit: str | None = None,
    sputter_rate: float | None = None,
    rate_unit: str = "nm/s",
    crater_depth: float | None = None,
    crater_unit: str = "nm",
    total_time: float | None = None,
    depth_unit: str = "nm",
    scale_factor: float | None = None,
    offset: float = 0.0,
) -> tuple[NDArray[np.float64], dict[str, Any], list[dict[str, Any]]]:
    """Convert a sputter-time or instrument x axis to depth.

    Returns (depth, provenance, warnings).

    ``total_time`` (crater method) is in the same unit as ``x``.
    """
    if method not in ("rate", "crater", "scale"):
        raise ValueError(f"calibration method must be 'rate', 'crater' or 'scale', got {method!r}")
    # A whitespace-only `time_unit` is not a stated override -- stripped to
    # "" here ONCE, so both the resolution below and `time_unit_source`
    # agree on whether anything was actually stated (a bare `if time_unit`
    # on the unstripped value would call "   " a stated override).
    stated_unit = time_unit.strip() if time_unit else None
    unit = ""
    warnings: list[dict[str, Any]] = []
    if method != "scale":
        unit, warnings = _resolve_time_unit(x_unit.strip(), stated_unit or None)
    # Arithmetic stays in x's OWN time unit and the output length unit, with
    # exact power-of-ten length ratios, so a 500 nm crater over 50 s is exactly
    # 10 nm/s and t = 40 s is exactly 400 nm -- not 400.00000000000006, which
    # would drop that point from a background region typed as "400 to 500".
    tx = np.asarray(x, dtype=float)
    finite = tx[np.isfinite(tx)]
    if finite.size == 0:
        raise ValueError("the x axis has no finite values to calibrate")
    length_factor(depth_unit)  # validate

    prov: dict[str, Any] = {
        "stage": "calibration",
        "method": method,
        "depth_unit": canonical_length(depth_unit),
    }
    if method == "scale":
        if scale_factor is None or not math.isfinite(scale_factor) or scale_factor <= 0:
            raise ValueError("the x scale factor must be a positive number")
        if not math.isfinite(offset):
            raise ValueError("the depth offset must be a finite number")
        with np.errstate(over="ignore", invalid="ignore"):
            depth = np.asarray(tx * scale_factor + offset, dtype=float)
        prov.update(
            {
                "input_unit": x_unit.strip(),
                "scale_factor": scale_factor,
                "offset": offset,
                "formula": "depth = scale_factor * x + offset",
            }
        )
    elif method == "rate":
        prov.update(
            {
                "time_unit": unit,
                "time_unit_source": "stated" if stated_unit else "recorded",
                "assumes": "constant sputter rate; depth measured from t = 0",
            }
        )
        if sputter_rate is None or not math.isfinite(sputter_rate) or sputter_rate <= 0:
            raise ValueError("the sputter rate must be a positive number")
        rate_factor(rate_unit)  # validate the length/time form
        rate_len, rate_time = rate_unit.split("/")
        # depth units per x time unit
        rate_x = (
            sputter_rate
            * length_ratio(rate_len, depth_unit)
            * (time_factor(unit) / time_factor(rate_time))
        )
        prov.update({"sputter_rate": sputter_rate, "rate_unit": rate_unit})
    else:
        prov.update(
            {
                "time_unit": unit,
                "time_unit_source": "stated" if stated_unit else "recorded",
                "assumes": "constant sputter rate; depth measured from t = 0",
            }
        )
        if crater_depth is None or not math.isfinite(crater_depth) or crater_depth <= 0:
            raise ValueError("the crater depth must be a positive number")
        if total_time is None:
            t_total = float(finite.max())
            warnings.append(
                _warn(
                    "assumed-total-time",
                    "total sputter time taken as the last time point "
                    f"({_g(t_total)} {unit}); "
                    "enter it if the beam ran on after the last cycle",
                    info=True,
                )
            )
        else:
            if not math.isfinite(total_time) or total_time <= 0:
                raise ValueError("the total sputter time must be a positive number")
            t_total = float(total_time)
        if t_total <= 0:
            raise ValueError(
                "the total sputter time must be positive (the last time point is <= 0)"
            )
        rate_x = crater_depth * length_ratio(crater_unit, depth_unit) / t_total
        prov.update(
            {
                "crater_depth": crater_depth,
                "crater_unit": crater_unit,
                "total_time": t_total,
                "total_time_assumed": total_time is None,
            }
        )
        beyond = int(np.count_nonzero(finite > t_total * (1 + 1e-12)))
        if beyond:
            warnings.append(
                _warn(
                    "beyond-crater",
                    f"{beyond} point{'s' if beyond != 1 else ''} lie after the total sputter time, "
                    "so deeper than the measured crater",
                    count=beyond,
                )
            )
    if method != "scale":
        prov["sputter_rate_nm_per_s"] = rate_x * length_ratio(depth_unit, "nm") / time_factor(unit)
        with np.errstate(over="ignore", invalid="ignore"):
            depth = np.asarray(tx * rate_x, dtype=float)

    # NaN/inf already present in x is preserved, but a finite x must never
    # become non-finite because the chosen rate/scale overflowed. That would
    # silently erase usable points from every downstream calculation.
    overflowed = np.isfinite(tx) & ~np.isfinite(depth)
    if bool(np.any(overflowed)):
        raise ValueError("the depth calibration overflowed the supported numeric range")

    finite_depth = depth[np.isfinite(depth)]
    negative = int(np.count_nonzero(finite_depth < 0))
    if negative:
        if method == "scale":
            text = f"{negative} depth value{'s are' if negative != 1 else ' is'} negative"
        else:
            text = (
                f"{negative} time value{'s are' if negative != 1 else ' is'} negative, "
                "giving negative depth"
            )
        warnings.append(
            _warn(
                "negative-depth" if method == "scale" else "negative-time",
                text,
                count=negative,
            )
        )
    if finite_depth.size > 1 and not bool(np.all(np.diff(finite_depth) > 0)):
        warnings.append(
            _warn("reordered", "depth does not increase monotonically; row order is preserved")
        )
    return depth, prov, warnings
