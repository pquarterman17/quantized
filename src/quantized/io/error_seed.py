"""The error-column roles a freshly imported dataset gets -- the headless port
of the app's ``store/importErrorRoles.ts`` ``seedErrorRoles`` (gap audit 5,
item 6 review).

The app seeds these on EVERY import and sends them with every correction
(``store/correctionsRun.ts``: ``error_bindings: ds.errorRoles``), so a bound
error column is scaled with its values but never offset. A headless replay
that skipped them would silently offset the error column too. Precedence, most
authoritative first (the app's):

1. Origin's own column designations (:func:`origin_book_error_roles`);
2. a parser's declaration for its own format, ``metadata["error_roles"]``,
   validated as ``lib/errorRoles.ts`` ``sanitizeBindings`` validates it;
3. the label guesser (:func:`infer_error_bindings_from_labels`), minus any
   pairing whose units clearly mismatch (``lib/errorRoles.ts``
   ``inferErrorBindings``).

``None`` when nothing applies (the app stores no roles). An Origin book whose
designations name no error column yields ``[]`` -- "checked: none" -- exactly
as the app does. ``tests/test_error_seed.py`` replays a fixture written by the
app's own ``seedErrorRoles``. Roles a user edits by hand in the app are not
recorded in a pipeline, so a replay cannot follow them.

Pure ``io`` layer.
"""

from __future__ import annotations

from typing import Any

from quantized.datastruct import DataStruct
from quantized.io.error_inference import infer_error_bindings_from_labels
from quantized.io.error_unit_evidence import compare_units
from quantized.io.workspace_dwk import origin_book_error_roles
from quantized.x_units import x_unit_of

__all__ = ["sanitize_bindings", "seed_error_roles"]


def _int(v: Any) -> bool:
    if isinstance(v, bool):
        return False
    return isinstance(v, int) or (isinstance(v, float) and v.is_integer())


def sanitize_bindings(raw: Any, channel_count: int) -> list[dict[str, Any]] | None:
    """``lib/errorRoles.ts`` ``sanitizeBindings``: the valid bindings of
    ``raw`` (``None`` when it is not a list)."""
    if not isinstance(raw, list):
        return None
    out: list[dict[str, Any]] = []
    for b in raw:
        if not isinstance(b, dict):
            continue
        rc: Any = b.get("channel")
        rt: Any = b.get("target")
        if not (_int(rc) and _int(rt)):
            continue
        ch, tg = int(rc), int(rt)
        if not (0 <= ch < channel_count) or not (-1 <= tg < channel_count) or ch == tg:
            continue
        if b.get("axis") not in ("x", "y") or b.get("side") not in ("both", "+", "-"):
            continue
        out.append({"channel": ch, "target": tg, "axis": b["axis"], "side": b["side"]})
    return out


def seed_error_roles(data: DataStruct) -> list[dict[str, Any]] | None:
    """The roles the app gives ``data`` on import (the module doc)."""
    origin = origin_book_error_roles(data)
    if origin is not None:
        return origin
    parser = sanitize_bindings(data.metadata.get("error_roles"), len(data.labels))
    if parser:
        return parser
    units = list(data.units)
    x_unit = x_unit_of(data)
    guessed = [
        b.to_dict()
        for b in infer_error_bindings_from_labels(list(data.labels))
        if compare_units(
            units[b.channel] if b.channel < len(units) else None,
            x_unit if b.target < 0 else (units[b.target] if b.target < len(units) else None),
        )
        != "mismatch"
    ]
    return guessed or None
