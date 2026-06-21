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


def resolve_column(
    spec: int | str,
    col_names: Sequence[str],
    shorthand_map: Mapping[str, str] | None = None,
    label: str = "column",
) -> int:
    """Resolve a column spec to a 0-based index (mirrors resolveColumnShorthand).

    Order: int index -> empty (``NO_COLUMN``) -> shorthand -> exact (ci) ->
    partial (ci, shortest name wins) -> ``KeyError``.
    """
    if isinstance(spec, int):
        if 0 <= spec < len(col_names):
            return spec
        raise IndexError(f"{label} index {spec} out of range (0-{len(col_names) - 1})")

    needle = spec.strip()
    if not needle:
        return NO_COLUMN

    if shorthand_map:
        for short, target in shorthand_map.items():
            if needle.lower() == short.lower():
                needle = target
                break

    lowered = needle.lower()
    for i, name in enumerate(col_names):
        if name.lower() == lowered:
            return i

    matches = [i for i, name in enumerate(col_names) if lowered in name.lower()]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        return min(matches, key=lambda i: len(col_names[i]))

    raise KeyError(f"cannot resolve {label} '{spec}'. Available: {list(col_names)}")
