"""The one place that resolves a `DataStruct`'s recorded x-axis unit (audit
P2.5 review finding #7). ``io.consolidated`` (for its Origin-designated
column header) and ``calc.resample_align`` (to refuse -- or report -- a
``match`` resample against a differently-unit'd grid) each grew their own
copy of "check these metadata keys, in this order"; the two disagreed on key
order, which is harmless today only because no real dataset carries more than
one of them with a genuinely different value. One shared, pure helper removes
the chance that they drift into disagreeing about what the unit IS.

Pure (only ``datastruct``): safe for both ``io/`` and ``calc/`` to import
without tripping the layering guard (``tests/test_repo_integrity.py``), same
as the ``cat_levels`` / ``row_sidecars`` precedent.
"""

from __future__ import annotations

from typing import Any

from .datastruct import DataStruct

__all__ = ["x_unit_of"]

#: The key order ``io.consolidated._resolve_x_unit`` already used -- existing
#: behaviour, kept as the one order both sides now share.
_X_UNIT_KEYS = ("xUnit", "x_column_unit", "xColumnUnit")


def x_unit_of(ds: DataStruct) -> str:
    """The x-axis unit recorded in ``ds.metadata`` (``""`` when unknown).

    Checks the top-level metadata first, then the nested ``parser_specific``
    / ``parserSpecific`` blob a handful of parsers stash extra fields under
    (mirrors ``io.consolidated._meta_get``'s reach) -- so a unit recorded
    either way is found the same way from both ``calc`` and ``io``.
    """
    meta: dict[str, Any] = dict(ds.metadata)
    sources: list[dict[str, Any]] = [meta]
    for nested in ("parser_specific", "parserSpecific"):
        sub = meta.get(nested)
        if isinstance(sub, dict):
            sources.append(sub)
    for src in sources:
        for key in _X_UNIT_KEYS:
            raw = src.get(key)
            if isinstance(raw, str) and raw.strip():
                return raw.strip()
    return ""
