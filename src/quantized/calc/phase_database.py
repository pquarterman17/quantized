"""Built-in reference phase database. Port of ``calc.crystal.phaseDatabase``.

The table lives in ``phase_database.json``: 52 common thin-film and substrate
phases (substrates, metals, simple oxides, perovskites, semiconductors,
other), each with its conventional cell (Å, degrees), Bravais ``centering``,
crystal ``system``, ``category``, ``icsd`` number (0 = not given) and, for 40
of them, the conventional-cell ``basis`` as ``[symbol, x, y, z]`` fractional
rows (empty when MATLAB tabulates none). The JSON was transcribed verbatim
from ``phaseDatabase.m``, its structure-type helpers (fcc, diamond,
perovskite, wurtzite, rutile, ...) expanded row by row. This module only loads
and looks it up. Pure calc layer.

Values are ported **verbatim** -- do not "fix" them here. Known issues in the
MATLAB source, kept as-is pending a decision (THIN_FILM_STACK_PLANNING_PLAN
G2): anatase TiO2 carries rutile's ICSD number (44882); La0.7Sr0.3MnO3 has the
formula ``"LSMO"`` (not a parseable formula) and a basis with no Sr; Si is
listed at a = 5.4309 Å.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

__all__ = ["CATEGORIES", "get_phase", "list_phases", "phase_database"]

_DATA_PATH = Path(__file__).parent / "phase_database.json"
_PHASES: list[dict[str, Any]] | None = None

#: Categories in table order.
CATEGORIES: tuple[str, ...] = (
    "substrate", "metal", "oxide", "perovskite", "semiconductor", "other",
)


def _load() -> list[dict[str, Any]]:
    global _PHASES
    if _PHASES is None:
        _PHASES = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    return _PHASES


def phase_database() -> list[dict[str, Any]]:
    """The full table, in MATLAB order (a deep copy: callers may mutate it)."""
    return copy.deepcopy(_load())


def list_phases(category: str | None = None) -> list[dict[str, Any]]:
    """All phases, or those in one ``category`` (see :data:`CATEGORIES`)."""
    if category is not None and category not in CATEGORIES:
        raise ValueError(f'unknown phase category "{category}" (one of {", ".join(CATEGORIES)})')
    return [p for p in phase_database() if category is None or p["category"] == category]


def get_phase(name: str) -> dict[str, Any]:
    """One phase by its exact name (case-insensitive), e.g. ``"SrTiO3"``."""
    for p in _load():
        if p["name"].lower() == name.strip().lower():
            return copy.deepcopy(p)
    raise ValueError(f'unknown phase "{name}"')
