r"""One material record: cell, system, centering, CTE, elastic data, citations.

THIN_FILM_STACK_PLANNING_PLAN G2 / OPEN_ITEMS row 28. A frozen, pure-Python
record (no pydantic: calc layer) that the substrate table and the
calculators share, so a material's numbers and *where each came from* travel
together instead of being scattered over per-module tuples.

Design (provisional, owner to confirm):

- Every optional physical value is a :class:`Cited` (value, unit, source).
  A value without a source is refused; a field with neither stays ``None``.
  Nothing here supplies a default: no CTE, Cij or Poisson ratio is ever filled
  in that a caller did not give with a citation.
- The cell is one :class:`Lattice` (Å, degrees) with one ``lattice_source``:
  a cell is measured, and cited, as a unit.
- ``centering`` (Bravais letter) and ``space_group`` (Hermann-Mauguin symbol)
  are optional and each carries its own source.
- :func:`MaterialRecord.__post_init__` refuses a record whose cell does not fit
  its crystal system (cubic needs a = b = c and 90°, ...), whose centering is
  not a Bravais lattice of that system, or whose space-group symbol starts with
  a different lattice letter than the centering. The refusal is a
  :class:`MaterialRecordError` (a ``ValueError``) naming the reason.

Systems and the cell each requires (tolerances :data:`LENGTH_RTOL`,
:data:`ANGLE_ATOL`):

=============  ==============================================================
cubic          a = b = c, α = β = γ = 90°
tetragonal     a = b, α = β = γ = 90°
orthorhombic   α = β = γ = 90°
hexagonal      a = b, α = β = 90°, γ = 120°
trigonal       hexagonal axes (as hexagonal) or rhombohedral axes (a = b = c,
               α = β = γ)
monoclinic     α = γ = 90° (b-unique setting)
triclinic      any cell
amorphous      no cell, no centering, no space group
=============  ==============================================================

``hexagonal`` with centering ``R`` is accepted: the phase table stores
rhombohedral phases (sapphire, hematite, ...) in hexagonal axes that way.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, fields
from typing import Any

__all__ = [
    "ANGLE_ATOL",
    "CENTERINGS",
    "LENGTH_RTOL",
    "SYSTEMS",
    "Cited",
    "ElasticConstants",
    "Lattice",
    "MaterialRecord",
    "MaterialRecordError",
    "record_from_phase",
]

#: Relative tolerance on equal cell lengths.
LENGTH_RTOL = 1e-6
#: Absolute tolerance (degrees) on fixed or equal cell angles.
ANGLE_ATOL = 1e-6

#: Bravais centerings allowed per crystal system.
CENTERINGS: dict[str, frozenset[str]] = {
    "cubic": frozenset("PIF"),
    "tetragonal": frozenset("PI"),
    "orthorhombic": frozenset("PABCIF"),
    "hexagonal": frozenset("PR"),
    "trigonal": frozenset("PR"),
    "monoclinic": frozenset("PABCI"),
    "triclinic": frozenset("P"),
    "amorphous": frozenset(),
}
SYSTEMS: tuple[str, ...] = tuple(CENTERINGS)

#: Units accepted for the elastic stiffnesses and Young's modulus.
_MODULUS_UNITS = frozenset({"GPa"})


class MaterialRecordError(ValueError):
    """A material record was refused; the message says why."""


def _require(ok: bool, reason: str) -> None:
    if not ok:
        raise MaterialRecordError(reason)


@dataclass(frozen=True)
class Cited:
    """One physical value with its unit and its source.

    ``unit`` is ``""`` for a dimensionless value. ``source`` must be a
    non-empty citation: an uncited value is refused, never stored.
    """

    value: float
    unit: str
    source: str

    def __post_init__(self) -> None:
        _require(
            isinstance(self.value, int | float)
            and not isinstance(self.value, bool)
            and math.isfinite(self.value),
            f"value {self.value!r} must be a finite number",
        )
        _require(isinstance(self.unit, str), "unit must be a string ('' = dimensionless)")
        _require(
            isinstance(self.source, str) and self.source.strip() != "",
            f"value {self.value!r} {self.unit} has no source: an uncited value is not stored",
        )

    def to_dict(self) -> dict[str, Any]:
        return {"value": float(self.value), "unit": self.unit, "source": self.source}


@dataclass(frozen=True)
class Lattice:
    """Conventional cell: lengths in Å, angles in degrees."""

    a: float
    b: float
    c: float
    alpha: float
    beta: float
    gamma: float

    def __post_init__(self) -> None:
        for name in ("a", "b", "c"):
            v = getattr(self, name)
            _require(math.isfinite(v) and v > 0, f"cell length {name} = {v!r} Å must be positive")
        for name in ("alpha", "beta", "gamma"):
            v = getattr(self, name)
            _require(
                math.isfinite(v) and 0 < v < 180,
                f"cell angle {name} = {v!r}° must lie strictly between 0 and 180",
            )

    def to_dict(self) -> dict[str, float]:
        return {f.name: float(getattr(self, f.name)) for f in fields(self)}


@dataclass(frozen=True)
class ElasticConstants:
    """Optional elastic data; each value separately cited (Voigt Cij in GPa).

    Only what was given is stored. Whether the given set is complete for the
    crystal system is the consumer's question (e.g. cubic needs C11, C12, C44).
    """

    c11: Cited | None = None
    c12: Cited | None = None
    c13: Cited | None = None
    c33: Cited | None = None
    c44: Cited | None = None
    c66: Cited | None = None
    youngs_modulus: Cited | None = None
    poisson_ratio: Cited | None = None

    def __post_init__(self) -> None:
        for f in fields(self):
            v = getattr(self, f.name)
            if v is None:
                continue
            _require(isinstance(v, Cited), f"{f.name} must be a Cited value")
            if f.name == "poisson_ratio":
                _require(v.unit == "", "poisson_ratio is dimensionless (unit '')")
                _require(-1.0 < v.value <= 0.5, f"poisson_ratio {v.value} outside (-1, 0.5]")
            else:
                _require(
                    v.unit in _MODULUS_UNITS,
                    f"{f.name} unit {v.unit!r} not accepted (one of {sorted(_MODULUS_UNITS)})",
                )
                if f.name != "c12" and f.name != "c13":  # off-diagonal Cij may be negative
                    _require(v.value > 0, f"{f.name} = {v.value} {v.unit} must be positive")

    def is_empty(self) -> bool:
        return all(getattr(self, f.name) is None for f in fields(self))

    def to_dict(self) -> dict[str, dict[str, Any] | None]:
        out: dict[str, dict[str, Any] | None] = {}
        for f in fields(self):
            v = getattr(self, f.name)
            out[f.name] = None if v is None else v.to_dict()
        return out


def _close_len(x: float, y: float) -> bool:
    return math.isclose(x, y, rel_tol=LENGTH_RTOL, abs_tol=0.0)


def _close_ang(x: float, y: float) -> bool:
    return abs(x - y) <= ANGLE_ATOL


def _cell_fits(system: str, cell: Lattice) -> str | None:
    """None when ``cell`` fits ``system``; else the reason it does not."""
    a, b, c, al, be, ga = cell.a, cell.b, cell.c, cell.alpha, cell.beta, cell.gamma
    right = all(_close_ang(x, 90.0) for x in (al, be, ga))
    hex_axes = (
        _close_len(a, b)
        and _close_ang(al, 90.0)
        and _close_ang(be, 90.0)
        and _close_ang(ga, 120.0)
    )
    if system == "cubic":
        ok = _close_len(a, b) and _close_len(b, c) and right
        need = "a = b = c and α = β = γ = 90°"
    elif system == "tetragonal":
        ok, need = _close_len(a, b) and right, "a = b and α = β = γ = 90°"
    elif system == "orthorhombic":
        ok, need = right, "α = β = γ = 90°"
    elif system == "hexagonal":
        ok, need = hex_axes, "a = b, α = β = 90° and γ = 120°"
    elif system == "trigonal":
        rhomb = _close_len(a, b) and _close_len(b, c) and _close_ang(al, be) and _close_ang(be, ga)
        ok = hex_axes or rhomb
        need = "hexagonal axes (a = b, γ = 120°) or rhombohedral axes (a = b = c, α = β = γ)"
    elif system == "monoclinic":
        ok, need = _close_ang(al, 90.0) and _close_ang(ga, 90.0), "α = γ = 90° (b-unique)"
    else:  # triclinic
        ok, need = True, ""
    if ok:
        return None
    return (
        f"cell a={a}, b={b}, c={c} Å, α={al}, β={be}, γ={ga}° is not {system}: "
        f"{system} needs {need}"
    )


def _optional_text(value: str | None, source: str | None, what: str) -> None:
    if value is None:
        _require(source is None, f"{what}_source given without a {what}")
        return
    _require(isinstance(value, str) and value.strip() != "", f"{what} must be a non-empty string")
    _require(
        isinstance(source, str) and source.strip() != "",
        f"{what} {value!r} has no source: an uncited value is not stored",
    )


@dataclass(frozen=True)
class MaterialRecord:
    """One material: identity, cell, symmetry and cited optional properties."""

    name: str
    formula: str
    system: str
    lattice: Lattice | None
    lattice_source: str | None = None
    centering: str | None = None
    centering_source: str | None = None
    space_group: str | None = None
    space_group_source: str | None = None
    cte: Cited | None = None
    density: Cited | None = None
    dielectric_constant: Cited | None = None
    elastic: ElasticConstants | None = None

    def __post_init__(self) -> None:
        _require(isinstance(self.name, str) and self.name.strip() != "", "name must be non-empty")
        _require(isinstance(self.formula, str), "formula must be a string")
        _require(
            self.system in CENTERINGS,
            f'unknown crystal system "{self.system}" (one of {", ".join(SYSTEMS)})',
        )
        if self.system == "amorphous":
            _require(self.lattice is None, f"{self.name}: an amorphous material has no cell")
            _require(self.centering is None, f"{self.name}: an amorphous material has no centering")
            _require(
                self.space_group is None, f"{self.name}: an amorphous material has no space group"
            )
        else:
            _require(
                self.lattice is not None, f"{self.name}: a {self.system} material needs a cell"
            )
            assert self.lattice is not None
            reason = _cell_fits(self.system, self.lattice)
            _require(reason is None, f"{self.name}: {reason}")
        if self.lattice is None:
            _require(self.lattice_source is None, "lattice_source given without a cell")
        else:
            _require(
                isinstance(self.lattice_source, str) and self.lattice_source.strip() != "",
                f"{self.name}: the cell has no source: an uncited cell is not stored",
            )
        _optional_text(self.centering, self.centering_source, "centering")
        if self.centering is not None:
            allowed = CENTERINGS[self.system]
            _require(
                self.centering in allowed,
                f'{self.name}: centering "{self.centering}" is not a {self.system} Bravais lattice '
                f"(one of {', '.join(sorted(allowed))})",
            )
        _optional_text(self.space_group, self.space_group_source, "space_group")
        if self.space_group is not None and self.centering is not None:
            _require(
                self.space_group.strip()[0] == self.centering,
                f'{self.name}: space group "{self.space_group}" does not start with the '
                f'centering letter "{self.centering}"',
            )
        for name in ("cte", "density", "dielectric_constant"):
            v = getattr(self, name)
            _require(v is None or isinstance(v, Cited), f"{name} must be a Cited value or None")
        if self.density is not None:
            _require(self.density.value > 0, f"{self.name}: density must be positive")
        _require(
            self.elastic is None or isinstance(self.elastic, ElasticConstants),
            "elastic must be ElasticConstants or None",
        )

    @property
    def poisson_ratio(self) -> Cited | None:
        """The cited Poisson ratio, or ``None`` (never a default)."""
        return None if self.elastic is None else self.elastic.poisson_ratio

    def to_dict(self) -> dict[str, Any]:
        """JSON-ready form; every absent field is ``None``."""

        def cited(v: Cited | None) -> dict[str, Any] | None:
            return None if v is None else v.to_dict()

        el = self.elastic
        return {
            "name": self.name,
            "formula": self.formula,
            "system": self.system,
            "lattice": None if self.lattice is None else self.lattice.to_dict(),
            "lattice_unit": None if self.lattice is None else {"length": "Å", "angle": "deg"},
            "lattice_source": self.lattice_source,
            "centering": self.centering,
            "centering_source": self.centering_source,
            "space_group": self.space_group,
            "space_group_source": self.space_group_source,
            "cte": cited(self.cte),
            "density": cited(self.density),
            "dielectric_constant": cited(self.dielectric_constant),
            "elastic": ElasticConstants().to_dict() if el is None else el.to_dict(),
        }


def record_from_phase(phase: dict[str, Any]) -> MaterialRecord:
    """A record from one ``calc.phase_database`` entry (cell, system, centering).

    The phase table carries no CTE, density or elastic data, so those stay
    ``None``. The source names the MATLAB table and the entry's ICSD number
    when it gives one (0 = not given).
    """
    icsd = int(phase.get("icsd") or 0)
    src = f'MATLAB calc.crystal.phaseDatabase entry "{phase["name"]}", ported verbatim'
    if icsd:
        src += f" (ICSD {icsd} as listed there)"
    return MaterialRecord(
        name=str(phase["name"]),
        formula=str(phase["formula"]),
        system=str(phase["system"]),
        lattice=Lattice(
            float(phase["a"]),
            float(phase["b"]),
            float(phase["c"]),
            float(phase["alpha"]),
            float(phase["beta"]),
            float(phase["gamma"]),
        ),
        lattice_source=src,
        centering=str(phase["centering"]),
        centering_source=src,
    )
