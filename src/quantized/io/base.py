"""Shared, pure parsing primitives used across io/ parsers.

Ports of the MATLAB helpers parseColHeader + resolveColumnShorthand.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence

__all__ = ["NO_COLUMN", "parse_col_header", "resolve_column"]

NO_COLUMN = -1

_HEADER_UNIT_RE = re.compile(r"^(.+?)\s*\(([^)]+)\)\s*$")


def parse_col_header(raw: str) -> tuple[str, str]:
    """Split ``'Magnetic Field (Oe)'`` -> ``('Magnetic Field', 'Oe')``.

    No parenthesised unit -> ``(trimmed name, '')``. Mirrors parseColHeader.
    """
    name = raw.strip()
    if not name:
        return "", ""
    match = _HEADER_UNIT_RE.match(name)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    return name, ""


def _match_column(needle: str, col_names: Sequence[str]) -> int | None:
    """Exact (case-insensitive) match, else partial; shortest matching name wins."""
    lowered = needle.lower()
    for i, name in enumerate(col_names):
        if name.lower() == lowered:
            return i
    matches = [i for i, name in enumerate(col_names) if lowered in name.lower()]
    if not matches:
        return None
    return min(matches, key=lambda i: len(col_names[i]))


def resolve_column(
    spec: int | str,
    col_names: Sequence[str],
    shorthand_map: Mapping[str, str] | None = None,
    label: str = "column",
) -> int:
    """Resolve a column spec to a 0-based index (mirrors resolveColumnShorthand).

    Order: int index -> empty (``NO_COLUMN``) -> [shorthand target, then the
    literal spec], each tried exact (ci) then partial (ci, shortest name wins)
    -> ``KeyError``. The literal-spec fallback lets ``"field"`` resolve a column
    named literally ``Field`` (MPMS-classic naming) when the shorthand target
    ``"Magnetic Field"`` is absent.
    """
    if isinstance(spec, int):
        if 0 <= spec < len(col_names):
            return spec
        raise IndexError(f"{label} index {spec} out of range (0-{len(col_names) - 1})")

    needle = spec.strip()
    if not needle:
        return NO_COLUMN

    # Try the shorthand target first (keeps current behaviour), then the literal
    # spec as a fallback so non-canonical column names still resolve.
    candidates: list[str] = []
    if shorthand_map:
        for short, target in shorthand_map.items():
            if needle.lower() == short.lower():
                candidates.append(target)
                break
    candidates.append(needle)

    for cand in candidates:
        hit = _match_column(cand, col_names)
        if hit is not None:
            return hit

    raise KeyError(f"cannot resolve {label} '{spec}'. Available: {list(col_names)}")
