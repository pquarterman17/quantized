"""Periodic-table data for all 118 elements. Port of calc.elementData.

The element table itself lives in ``element_data.json`` (dumped verbatim from
MATLAB ``calc.elementData()`` for exact data parity); this module just loads it
and exposes the lookup API. Pure calc layer.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["by_symbol", "by_z", "element_data", "get_property"]

_DATA_PATH = Path(__file__).parent / "element_data.json"
_ELEMENTS: list[dict[str, Any]] | None = None


def _load() -> list[dict[str, Any]]:
    global _ELEMENTS
    if _ELEMENTS is None:
        _ELEMENTS = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    return _ELEMENTS


def element_data() -> list[dict[str, Any]]:
    """Return the full 118-element table (list of element dicts)."""
    return _load()


def by_symbol(symbol: str) -> dict[str, Any]:
    """Look up a single element by symbol (e.g. 'Fe'). Raises if not found."""
    for el in _load():
        if el["symbol"] == symbol:
            return el
    raise ValueError(f"element symbol '{symbol}' not found")


def by_z(z: int) -> dict[str, Any]:
    """Look up a single element by atomic number Z (1-118)."""
    if z < 1 or z > 118:
        raise ValueError("Z must be between 1 and 118")
    return _load()[z - 1]


def get_property(name: str) -> NDArray[np.float64] | list[Any]:
    """Return a property across all 118 elements.

    Numeric properties return a float array (MATLAB NaN -> null -> nan);
    non-numeric properties (e.g. 'symbol', 'category') return a list.
    """
    vals = [el[name] for el in _load()]
    if all(v is None or (isinstance(v, int | float) and not isinstance(v, bool)) for v in vals):
        return np.array(vals, dtype=float)
    return vals
