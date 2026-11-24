"""Atomic layers, terminations and polarity of an (hkl) stack (plan P3 / G6).

Pure ``calc/``. Takes the full cell from :func:`cif_symmetry.expand_to_cell`
and an ``(hkl)``; atoms are binned by their coordinate along the plane normal,
``s = h x + k y + l z`` (period 1 in ``s`` for coprime ``hkl``; a common factor
is divided out and reported), so each distinct ``s`` mod 1 is one atomic layer.

Conventions (all provisional, owner to confirm):

* Layers closer than ``layer_tol`` angstrom along the normal are one layer
  (default 0.05 A; real surfaces rumple more, this is the ideal bulk cut).
* Composition is an **areal density** per angstrom^2 (sites x occupancy x
  d / V), so it is independent of the arbitrary in-plane cell. A missing
  occupancy counts as 1 (the CIF default). ``formula`` normalises it to the
  smallest nonzero entry, in first-appearance order of the CIF sites.
* A termination is "this layer is the topmost one, outward normal along
  +(hkl)". For a polar crystal -(hkl) can differ; ask for it explicitly.
* Polarity needs formal charges, supplied by the caller or read from the CIF
  (:func:`cif_charges`). Nothing is ever assumed: without charges the result
  is ``"unknown: no charges given"``. With charges, a Tasker classification:
  type 1 (every layer neutral), type 2 (charged layers but some repeat unit
  has zero dipole), type 3 (every repeat unit has a dipole). A termination's
  ``dipole`` is that of the one-period unit ending in it (e/A per area/A^2
  units: e/A); the unit must be neutral or the result is "unknown".
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from quantized.calc.cif_symmetry import ExpandedCell
from quantized.calc.crystallography import cell_volume, d_spacing

__all__ = [
    "Layer",
    "StackAnalysis",
    "Termination",
    "analyze_stack",
    "cif_charges",
]

_SUFFIX = re.compile(r"^[A-Za-z]{1,2}(\d*)([+-])$")
_NO_CHARGES = "unknown: no charges given"
_ZERO = 1e-6


@dataclass(frozen=True)
class Layer:
    index: int
    position: float  # angstrom along the normal, layer 0 = 0
    gap_to_next: float  # angstrom to the next layer (last wraps to layer 0)
    composition: dict[str, float]  # symbol -> atoms / A^2
    formula: str
    charge: float | None  # e / A^2, None when polarity is unknown


@dataclass(frozen=True)
class Termination:
    layer: int
    formula: str
    dipole: float | None  # e / A of the one-period unit ending here
    polar: bool | None


@dataclass(frozen=True)
class StackAnalysis:
    hkl: tuple[int, int, int]  # reduced
    given_hkl: tuple[int, int, int]
    d_hkl: float
    layers: tuple[Layer, ...]
    terminations: tuple[Termination, ...]
    polarity: str
    polar: bool | None


def _symbol_charge(symbol: str) -> float | None:
    m = _SUFFIX.match(symbol)
    if not m:
        return None
    return float(m.group(1) or 1) * (1.0 if m.group(2) == "+" else -1.0)


def cif_charges(parsed: dict[str, Any]) -> dict[str, float]:
    """Formal charges the CIF itself supplies (never inferred from the element).

    From an ``_atom_type_oxidation_number`` loop, plus charge suffixes written
    in a type symbol (``Sr2+``, ``O2-``). Empty when the CIF gives none.
    """
    out: dict[str, float] = {}
    for lp in parsed.get("loops", []):
        tags = lp["tags"]
        if "_atom_type_symbol" in tags and "_atom_type_oxidation_number" in tags:
            si, qi = tags.index("_atom_type_symbol"), tags.index("_atom_type_oxidation_number")
            for row in lp["data"]:
                try:
                    out[row[si]] = float(row[qi])
                except (ValueError, IndexError):
                    continue
    for site in parsed.get("atomSites", []):
        sym = site["symbol"]
        if sym not in out and (q := _symbol_charge(sym)) is not None:
            out[sym] = q
    return out


def _gcd3(h: int, k: int, ell: int) -> int:
    return math.gcd(math.gcd(abs(h), abs(k)), abs(ell))


def _clusters(ts: list[float], period: float, tol: float) -> list[list[int]]:
    """Group atom indices by position mod ``period``; wrap-around merged."""
    order = sorted(range(len(ts)), key=lambda i: ts[i])
    groups: list[list[int]] = []
    for i in order:
        if groups and ts[i] - ts[groups[-1][-1]] <= tol:
            groups[-1].append(i)
        else:
            groups.append([i])
    if len(groups) > 1 and ts[groups[0][0]] + period - ts[groups[-1][-1]] <= tol:
        groups[0] = groups.pop() + groups[0]
    return groups


def _formula(comp: Mapping[str, float], order: Sequence[str]) -> str:
    present = [(s, comp[s]) for s in order if comp.get(s, 0.0) > _ZERO]
    if not present:
        return ""
    base = min(v for _, v in present)
    parts = []
    for sym, v in present:
        r = v / base
        n = round(r)
        txt = "" if (abs(r - n) < 1e-3 and n == 1) else (
            str(n) if abs(r - n) < 1e-3 else f"{r:.3g}"
        )
        parts.append(sym + txt)
    return "".join(parts)


def analyze_stack(
    cell: ExpandedCell,
    cell_params: Mapping[str, float],
    hkl: tuple[int, int, int],
    charges: Mapping[str, float] | None = None,
    layer_tol: float = 0.05,
) -> StackAnalysis:
    """Layers, terminations and polarity of ``cell`` cut perpendicular to ``hkl``."""
    h0, k0, l0 = (int(v) for v in hkl)
    g = _gcd3(h0, k0, l0)
    if g == 0:
        raise ValueError("hkl must not be (0,0,0)")
    if not (math.isfinite(layer_tol) and layer_tol > 0):
        raise ValueError("layer_tol must be positive and finite")
    if not cell.sites:
        raise ValueError("the cell has no atoms")
    h, k, ell = h0 // g, k0 // g, l0 // g
    p = {key: float(cell_params[key]) for key in ("a", "b", "c", "alpha", "beta", "gamma")}
    d = d_spacing(
        "triclinic", p["a"], p["b"], p["c"], h, k, ell, p["alpha"], p["beta"], p["gamma"]
    )["d"]
    vol = cell_volume(p["a"], p["b"], p["c"], p["alpha"], p["beta"], p["gamma"])
    ts = [((h * s.x + k * s.y + ell * s.z) % 1.0) * d for s in cell.sites]
    groups = _clusters(ts, d, layer_tol)

    symbols: list[str] = []
    for s in cell.sites:
        if s.symbol not in symbols:
            symbols.append(s.symbol)
    raw: list[tuple[float, dict[str, float]]] = []
    for grp in groups:
        zs = [ts[i] - (d if ts[i] - ts[grp[0]] > d / 2 else 0.0) for i in grp]
        comp: dict[str, float] = {}
        for i in grp:
            s = cell.sites[i]
            occ = s.occupancy if math.isfinite(s.occupancy) else 1.0
            comp[s.symbol] = comp.get(s.symbol, 0.0) + occ * d / vol
        raw.append((sum(zs) / len(zs), comp))
    raw.sort(key=lambda r: r[0] % d)
    z0 = raw[0][0]
    pos = [(z - z0) % d for z, _ in raw]
    n = len(raw)
    gaps = [(pos[(i + 1) % n] - pos[i]) % d if n > 1 else d for i in range(n)]

    polarity, sigma = _layer_charges([c for _, c in raw], symbols, charges)
    layers = tuple(
        Layer(i, pos[i], gaps[i], raw[i][1], _formula(raw[i][1], symbols),
              None if sigma is None else sigma[i])
        for i in range(n)
    )
    terms, polarity, polar = _terminations(layers, sigma, pos, d, polarity)
    return StackAnalysis((h, k, ell), (h0, k0, l0), d, layers, terms, polarity, polar)


def _layer_charges(
    comps: list[dict[str, float]], symbols: list[str], charges: Mapping[str, float] | None
) -> tuple[str, list[float] | None]:
    if not charges:
        return _NO_CHARGES, None
    q: dict[str, float] = {}
    for sym in symbols:
        v = charges.get(sym, _symbol_charge(sym))
        if v is None:
            return f"unknown: no charge given for {sym}", None
        q[sym] = float(v)
    sigma = [sum(q[s] * v for s, v in c.items()) for c in comps]
    scale = sum(abs(x) for x in sigma) or 1.0
    if abs(sum(sigma)) > 1e-6 * scale + 1e-9:
        return "unknown: the given charges do not make the cell neutral", None
    return "", sigma


def _terminations(
    layers: tuple[Layer, ...], sigma: list[float] | None, pos: list[float], d: float, note: str
) -> tuple[tuple[Termination, ...], str, bool | None]:
    n = len(layers)
    if sigma is None:
        bare = tuple(Termination(i, ly.formula, None, None) for i, ly in enumerate(layers))
        return bare, note, None
    terms = []
    for top in range(n):
        mu = 0.0
        for j in range(n):
            idx = (top - j) % n
            z = pos[idx] - (d if idx > top else 0.0)
            mu += sigma[idx] * z
        terms.append(Termination(top, layers[top].formula, mu, abs(mu) > _ZERO))
    if all(abs(x) <= _ZERO for x in sigma):
        return tuple(terms), "non-polar (Tasker type 1: every layer neutral)", False
    if any(not t.polar for t in terms):
        return (
            tuple(terms),
            "charged layers, zero-dipole repeat unit exists (Tasker type 2); "
            "terminations with a dipole are polar",
            False,
        )
    return tuple(terms), "polar (Tasker type 3: every repeat unit has a dipole)", True
