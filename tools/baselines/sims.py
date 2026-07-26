"""SIMS depth-profile CSV (journey 5): 4 species, paired depth/concentration.

Mirrors the exact banner + 3-row header structure of the existing
``tests/fixtures/sims_barrier.csv`` fixture (banner lines, a species-name
row, a ``Depth,CONC.`` row, a units row, then paired data columns) so it
exercises the same ``io/sims.py`` layout-detection and paired-column-name
recovery path already proven against that corpus file.
"""

from __future__ import annotations

from math import erf
from pathlib import Path

import numpy as np
from common import fmt_fixed, fmt_sci, write_text

__all__ = ["write_sims_profile"]

# Together these span several decades and mix erf step interfaces with
# exponential tails/decays, per the P0.3 brief.
_SPECIES = ("B", "P", "As", "Sb")


def _erf_step(depth: np.ndarray, edge: float, width: float, lo: float, hi: float) -> np.ndarray:
    """Smooth transition from ``hi`` (small depth) to ``lo`` (large depth)."""
    s = np.array([0.5 * (1.0 - erf((d - edge) / width)) for d in depth])
    return lo + (hi - lo) * s


def _profile(name: str, depth: np.ndarray) -> np.ndarray:
    if name == "B":
        # Implant peak plateau near the surface, erf transition, exponential tail.
        step = _erf_step(depth, edge=20.0, width=6.0, lo=2.0e17, hi=3.0e20)
        tail = 1.0e16 * np.exp(-np.maximum(depth - 60.0, 0.0) / 40.0)
        return np.asarray(step + tail, dtype=float)
    if name == "P":
        # Bulk barrier layer, erf transition down to substrate background.
        return _erf_step(depth, edge=80.0, width=10.0, lo=8.0e15, hi=1.0e19)
    if name == "As":
        # Trace species with an interface pile-up spike (bump = two erf edges).
        rise = _erf_step(depth, edge=48.0, width=4.0, lo=5.0e16, hi=2.0e18)
        fall = _erf_step(depth, edge=54.0, width=4.0, lo=5.0e16, hi=2.0e18)
        return np.asarray(5.0e16 + (rise - 5.0e16) - (fall - 5.0e16), dtype=float)
    if name == "Sb":
        # Pure exponential decay from a high near-surface value.
        return np.asarray(5.0e20 * np.exp(-depth / 22.0) + 1.0e15, dtype=float)
    raise ValueError(f"unknown species {name!r}")  # pragma: no cover - fixed list above


def write_sims_profile(path: Path, *, seed: int, n_points: int = 300) -> None:
    rng = np.random.default_rng(seed)
    depth = np.linspace(0.0, 200.0, n_points)  # nm, shared axis across species

    conc_by_species = {name: _profile(name, depth) for name in _SPECIES}
    for name, conc in conc_by_species.items():
        noise = 1.0 + rng.normal(scale=0.02, size=n_points)
        conc_by_species[name] = np.maximum(conc * noise, 1.0e14)

    # Species-name row: "B,,P,,As,,Sb" (name, blank, name, blank, ..., last
    # name with no trailing blank) -- matches the real corpus file exactly.
    lines = [
        "SIMS Analysis Laboratory (synthetic P0.3 baseline fixture)",
        ":Sample QZ-BASELINE-04 (4-species implant/barrier profile)",
        "Drawn Curves,4",
        "Num of Cycles,64",
        "",
        ",,".join(_SPECIES),
        ",".join(["Depth", "CONC."] * len(_SPECIES)),
        ",".join(["(nm)", "(atoms/cc)"] * len(_SPECIES)),
        "",
    ]

    for i in range(n_points):
        cells: list[str] = []
        for name in _SPECIES:
            cells.append(fmt_fixed(depth[i]))
            cells.append(fmt_sci(conc_by_species[name][i]))
        lines.append(",".join(cells))

    write_text(path, "\n".join(lines) + "\n")
