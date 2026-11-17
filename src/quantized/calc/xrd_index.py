"""Built-in-phase XRD indexing: allowed reflections + peak → (hkl) matching.

Pure calc layer (lists/floats in, plain dicts out; no web framework).

PHASES come from :mod:`quantized.calc.phase_database` — the verbatim port of
MATLAB ``calc.crystal.phaseDatabase`` (52 phases: cell, Bravais centering,
system and, for 40, the full conventional-cell basis). No second lattice table:
Si is therefore a = 5.4309 Å (MATLAB's value), Pt 3.9231 Å, and so on.

ENUMERATION delegates to :func:`quantized.calc.plane_spacings.plane_spacings`
(golden-verified against MATLAB ``calc.crystal.planeSpacings``) with its
centering rule plus one extra per-(hkl) condition, applied before grouping so
multiplicities count only surviving planes. The condition is, in order:

1. **Structure factor** when the phase tabulates a basis:
   ``F(hkl) = Σ_j Z_j · exp(2πi(h x_j + k y_j + l z_j))`` with the atomic
   number as the scattering weight; a reflection is absent when
   ``|F| ≤ 1e-6 · Σ Z_j``. This is exactly the space-group absence set for a
   complete conventional-cell basis — diamond Si/Ge lose all-even (hkl) with
   ``h+k+l = 4n+2`` (the d-glide: (200), (222), (420)), wurtzite loses (001),
   rock-salt MgO KEEPS the weak all-odd (111) (F = 4(Z_Mg − Z_O) ≠ 0) and
   zinc-blende GaAs keeps its weak (200). Z-weighting is a stand-in for real
   form factors: it decides presence/absence, it is NOT an intensity model.
2. **R-3c / R3c (corundum, hematite, eskolaite, BiFeO₃)** — their basis is not
   tabulated, so the ITA No. 167/161 conditions on hexagonal axes, obverse
   setting: ``-h+k+l = 3n`` for every (hkl) plus the c-glide ``l = 2n`` on the
   three equivalent zones ``h0l``, ``0kl`` and ``h,-h,l``. Together these give
   ITA's special conditions (000l: l = 6n; h-h00: h = 3n), so sapphire shows
   (012), (104), (110), (006), (113), (202), (024), (116) and not (101), (003).
   (MATLAB's planeSpacings ``R`` rule is the REVERSE setting, h−k+l = 3n, which
   would label (012) as (102); it is left untouched for its own golden.)
3. **Lattice only** otherwise (no basis, e.g. Fe₃O₄, anatase, quartz, SiC 4H):
   the result says ``absences = "lattice"`` so callers can warn that glide/screw
   absences are not applied and some listed reflections may be absent.

d for hexagonal axes is the general reciprocal-metric form with γ = 120°,
``1/d² = 4/3·(h²+hk+k²)/a² + l²/c²``; cubic ``d = a/√(h²+k²+l²)``;
2θ = 2·asin(λ/2d).

NO MATLAB PARITY for the matcher: ``+calc/+crystal/matchPhases.m`` was not in
the checkout this was written in (PORT_CHECKLIST "Phase matching" stays open).
:func:`match_peaks` is the documented nearest-reflection rule, not a port of
its scoring.
"""

from __future__ import annotations

import cmath
import math
from collections.abc import Callable, Sequence
from typing import Any

from quantized.calc.element_data import by_symbol
from quantized.calc.phase_database import get_phase, phase_database
from quantized.calc.plane_spacings import plane_spacings

__all__ = [
    "CU_KA1_A",
    "DEFAULT_TOLERANCE_DEG",
    "cell_reflections",
    "index_peaks",
    "match_peaks",
    "phase_reflections",
    "xrd_phase_choices",
]

#: Cu Kα1 (Å) — the same literal every XRD route in this package defaults to
#: (routes/reductions.py, calc/pawley.py, calc/plane_spacings.py).
CU_KA1_A = 1.5406

#: Degrees 2θ; matches frontend/src/lib/peakPhaseMatch.ts DEFAULT_REFERENCE_TOLERANCE
#: (about one lab-diffractometer FWHM, so a match is a peak ON the reflection).
DEFAULT_TOLERANCE_DEG = 0.2

#: Index bound beyond which enumeration ((2n+1)³ planes) is refused.
MAX_HKL_LIMIT = 24

#: Phases whose space group is R-3c / R3c but whose basis MATLAB does not tabulate.
_R3C_PHASES = frozenset({"sapphire (al2o3)", "fe2o3 (hematite)", "cr2o3 (eskolaite)", "bifeo3"})

_Rule = Callable[[int, int, int], bool]


def _r3c(h: int, k: int, ll: int) -> bool:
    if (-h + k + ll) % 3 != 0:
        return False
    if h == 0 or k == 0 or h + k == 0:  # the three c-glide zones
        return ll % 2 == 0
    return True


def _structure_factor_rule(basis: Sequence[Sequence[Any]]) -> _Rule:
    atoms = [
        (float(by_symbol(str(b[0]))["Z"]), float(b[1]), float(b[2]), float(b[3])) for b in basis
    ]
    floor = 1e-6 * sum(z for z, *_ in atoms)

    def allowed(h: int, k: int, ll: int) -> bool:
        f = sum(z * cmath.exp(2j * math.pi * (h * x + k * y + ll * w)) for z, x, y, w in atoms)
        return abs(f) > floor

    return allowed


def _label(hkl: Sequence[int]) -> str:
    """'(111)' for single-digit indices, '(1 0 10)' when any needs two characters."""
    parts = [str(i) for i in hkl]
    return f"({''.join(parts)})" if all(len(s) == 1 for s in parts) else f"({' '.join(parts)})"


def _conventional_hkl(hkl: Sequence[int], system: str, rule: _Rule | None) -> list[int]:
    """The textbook index for a reflection group, not plane_spacings' MATLAB
    tie-break representative (which prints Si (220) as (022)).

    Cubic: every permutation/sign is equivalent, so |indices| sorted descending
    — (022) → (220), (113) → (311). Hexagonal: the non-negative (h, k) with the
    same h²+hk+k² that passes the reflection condition, largest h first, with
    l = |l| — corundum (030) → (300), while (012) stays (012) because (102)
    violates -h+k+l = 3n. Other systems keep plane_spacings' representative.
    """
    h, k, ll = (int(v) for v in hkl)
    if system == "cubic":
        return sorted((abs(h), abs(k), abs(ll)), reverse=True)
    if system != "hexagonal":
        return [h, k, ll]
    n = h * h + h * k + k * k
    lz = abs(ll)
    best: list[int] | None = None
    for hh in range(math.isqrt(n) + 1, -1, -1):
        for kk in range(math.isqrt(n) + 1, -1, -1):
            if hh * hh + hh * kk + kk * kk == n and (rule is None or rule(hh, kk, lz)):
                if best is None or [hh, kk, lz] > best:
                    best = [hh, kk, lz]
    return best if best is not None else [h, k, ll]


def _check_range(wavelength: float, two_theta_min: float, two_theta_max: float) -> None:
    if not (math.isfinite(wavelength) and wavelength > 0):
        raise ValueError("wavelength must be positive and finite (Angstrom)")
    if not (math.isfinite(two_theta_min) and math.isfinite(two_theta_max)):
        raise ValueError("2theta range must be finite")
    if not (0 <= two_theta_min < two_theta_max <= 180):
        raise ValueError("2theta range must satisfy 0 <= min < max <= 180 deg")


def _absence_kind(p: dict[str, Any]) -> str:
    if p["basis"]:
        return "structure factor"
    return "space group" if str(p["name"]).lower() in _R3C_PHASES else "lattice"


def xrd_phase_choices() -> list[dict[str, Any]]:
    """Every phase-database phase this module can index (cubic or hexagonal),
    in table order: name, formula, category, system, a, c, absences."""
    return [
        {
            **{k: p[k] for k in ("name", "formula", "category", "system", "a", "c")},
            "absences": _absence_kind(p),
        }
        for p in phase_database()
        if p["system"] in ("cubic", "hexagonal")
    ]


def cell_reflections(
    a: float,
    *,
    c: float | None = None,
    system: str = "cubic",
    centering: str = "P",
    rule: _Rule | None = None,
    wavelength: float = CU_KA1_A,
    two_theta_min: float = 10.0,
    two_theta_max: float = 90.0,
) -> list[dict[str, Any]]:
    """Allowed reflections of a cubic or hexagonal cell with 2θ in [min, max].

    Rows ``{"hkl", "label", "d", "two_theta", "multiplicity"}``, ascending 2θ.

    >>> [r["label"] for r in cell_reflections(5.431, centering="F", two_theta_max=50)]
    ['(111)', '(200)', '(220)']
    """
    _check_range(wavelength, two_theta_min, two_theta_max)
    if system not in ("cubic", "hexagonal"):
        raise ValueError(f"indexing supports cubic and hexagonal cells, not {system}")
    cc = a if c is None else c
    d_min = wavelength / (2.0 * math.sin(math.radians(two_theta_max / 2.0)))
    max_hkl = max(1, math.ceil(max(a, cc) / d_min))  # |h| <= a/d_min bounds every index
    if max_hkl > MAX_HKL_LIMIT:
        raise ValueError(
            f"this range needs Miller indices up to {max_hkl} (limit {MAX_HKL_LIMIT}); "
            "narrow the 2theta range or use a longer wavelength"
        )
    out = plane_spacings(
        a,
        c=cc,
        gamma=120.0 if system == "hexagonal" else 90.0,
        max_hkl=max_hkl,
        lambda_=wavelength,
        centering=centering,
        min_d=d_min * (1 - 1e-12),
        allowed=rule,
    )
    rows: list[dict[str, Any]] = []
    for hkl, d, tt, mult in zip(
        out["hkl"], out["d"], out["two_theta"], out["multiplicity"], strict=True
    ):
        if math.isnan(tt) or not (two_theta_min <= tt <= two_theta_max):
            continue
        conv = _conventional_hkl(hkl, system, rule)
        rows.append(
            {"hkl": conv, "label": _label(conv), "d": d, "two_theta": tt, "multiplicity": mult}
        )
    rows.sort(key=lambda r: float(r["two_theta"]))
    return rows


def phase_reflections(
    phase: str,
    *,
    wavelength: float = CU_KA1_A,
    two_theta_min: float = 10.0,
    two_theta_max: float = 90.0,
) -> dict[str, Any]:
    """Allowed reflections of a phase-database phase (by name) in the 2θ range.

    Returns ``{"phase": {name, formula, system, centering, a, c},
    "absences": "structure factor" | "space group" | "lattice",
    "wavelength", "reflections": [...]}``.

    >>> r = phase_reflections("Silicon", two_theta_min=20, two_theta_max=80)
    >>> [x["label"] for x in r["reflections"]]
    ['(111)', '(220)', '(311)', '(400)', '(331)']
    """
    p = get_phase(phase)
    absences = _absence_kind(p)
    rule: _Rule | None = None
    centering = str(p["centering"])
    if absences == "structure factor":
        rule = _structure_factor_rule(p["basis"])
    elif absences == "space group":
        rule, centering = _r3c, "P"  # obverse R centering lives inside _r3c
    rows = cell_reflections(
        float(p["a"]),
        c=float(p["c"]),
        system=str(p["system"]),
        centering=centering,
        rule=rule,
        wavelength=wavelength,
        two_theta_min=two_theta_min,
        two_theta_max=two_theta_max,
    )
    summary = {k: p[k] for k in ("name", "formula", "system", "centering", "a", "c")}
    return {"phase": summary, "absences": absences, "wavelength": wavelength, "reflections": rows}


def match_peaks(
    peak_two_theta: Sequence[float],
    reflections: Sequence[dict[str, Any]],
    *,
    tolerance: float = DEFAULT_TOLERANCE_DEG,
    wavelength: float = CU_KA1_A,
) -> list[dict[str, Any]]:
    """Assign each measured peak to its NEAREST reflection within ``tolerance``.

    Rule: ``|2θ_peak − 2θ_ref| ≤ tolerance`` (inclusive); ties go to the
    lower-2θ (earlier) reflection; a reflection may index more than one peak
    (each peak is judged on its own, so a split/doublet peak is not silently
    dropped). No reflection within tolerance → ``hkl``/``label``/``delta`` None.
    ``delta = 2θ_peak − 2θ_ref`` (degrees); ``d_obs`` is the peak's own Bragg d
    at ``wavelength`` (None when the peak's 2θ is outside (0, 180)).
    """
    if not (math.isfinite(tolerance) and tolerance >= 0):
        raise ValueError("tolerance must be a non-negative number of degrees")
    if not (math.isfinite(wavelength) and wavelength > 0):
        raise ValueError("wavelength must be positive and finite (Angstrom)")
    out: list[dict[str, Any]] = []
    for tt_raw in peak_two_theta:
        tt = float(tt_raw)
        best: dict[str, Any] | None = None
        best_gap = math.inf
        if math.isfinite(tt):
            for ref in reflections:
                gap = abs(tt - float(ref["two_theta"]))
                if gap <= tolerance and gap < best_gap:
                    best, best_gap = ref, gap
        ok = math.isfinite(tt) and 0 < tt < 180
        out.append(
            {
                "peak_two_theta": tt if math.isfinite(tt) else None,
                "d_obs": wavelength / (2.0 * math.sin(math.radians(tt / 2.0))) if ok else None,
                "hkl": None if best is None else list(best["hkl"]),
                "label": None if best is None else best["label"],
                "d_ref": None if best is None else best["d"],
                "two_theta_ref": None if best is None else best["two_theta"],
                "delta": None if best is None else tt - float(best["two_theta"]),
            }
        )
    return out


def index_peaks(
    peak_two_theta: Sequence[float],
    phase: str,
    *,
    wavelength: float = CU_KA1_A,
    tolerance: float = DEFAULT_TOLERANCE_DEG,
    two_theta_min: float = 10.0,
    two_theta_max: float = 90.0,
) -> dict[str, Any]:
    """Reflections of ``phase`` in the range + every peak matched against them."""
    refl = phase_reflections(
        phase, wavelength=wavelength, two_theta_min=two_theta_min, two_theta_max=two_theta_max
    )
    matches = match_peaks(
        peak_two_theta, refl["reflections"], tolerance=tolerance, wavelength=wavelength
    )
    return {
        **refl,
        "tolerance": tolerance,
        "matches": matches,
        "n_matched": sum(1 for m in matches if m["hkl"] is not None),
    }
