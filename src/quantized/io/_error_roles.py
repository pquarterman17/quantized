"""The error-column roles a DataStruct declares, for writers that designate
columns (Origin ASCII ``.ogs``, the consolidated CSV).

``metadata["error_roles"]`` is the explicit binding list a parser writes
(``io/ncnr.py``, ``io/orso.py``, ``io/qd_companions.py``) and the frontend
replaces with the user's live bindings before an export. Each entry is
``{"channel", "target", "axis": "x"|"y", "side"}``. When the key is present it
is AUTHORITATIVE -- an unlisted channel is not an error column -- and when it
is absent the writers keep their historical label-keyword fallback.

Pure ``io`` layer: no fastapi/pydantic imports.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

__all__ = ["error_axes"]


def error_axes(metadata: Mapping[str, Any], n_channels: int) -> dict[int, str] | None:
    """``{channel: "x" | "y"}`` for every declared error channel, or ``None``
    when the dataset declares no ``error_roles`` at all. Malformed entries are
    skipped, never guessed at."""
    roles = metadata.get("error_roles")
    if not isinstance(roles, (list, tuple)):
        return None
    out: dict[int, str] = {}
    for role in roles:
        if not isinstance(role, Mapping):
            continue
        channel, axis = role.get("channel"), role.get("axis")
        if isinstance(channel, bool) or not isinstance(channel, int):
            continue
        if 0 <= channel < n_channels and axis in ("x", "y"):
            out[channel] = str(axis)
    return out
