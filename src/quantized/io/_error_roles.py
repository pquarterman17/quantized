"""The error-column roles a DataStruct declares, for writers that designate
columns (Origin ASCII ``.ogs``, the consolidated CSV).

``metadata["error_roles"]`` is the explicit binding list a parser writes
(``io/ncnr.py``, ``io/orso.py``, ``io/qd_companions.py``) and the frontend
replaces with the user's live bindings before an export. Each entry is
``{"channel", "target", "axis": "x"|"y", "side"}``. When the key is present it
is AUTHORITATIVE -- an unlisted channel is not an error column -- and when it
is absent the writers keep their historical label-keyword fallback.

``metadata["user_column_designations"]`` is the user's worksheet "Set As"
map (``{channel: designation}``, the frontend's ``Dataset.columnDesignations``)
the frontend attaches the same way, so a column the user set as X, Z, Label
or Disregard is designated that way in the export too.

Pure ``io`` layer: no fastapi/pydantic imports.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

__all__ = ["USER_DESIGNATIONS", "error_axes", "user_designations"]

#: The designations "Set As" can give a column, as the exact strings the
#: Origin readers emit (``io/origin_project/windows.py``'s ``_DESIGNATION``).
USER_DESIGNATIONS = frozenset({"X", "Y", "Z", "Y-error", "X-error", "label", "disregard"})


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


def user_designations(metadata: Mapping[str, Any], n_channels: int) -> dict[int, str]:
    """``{channel: designation}`` from ``metadata["user_column_designations"]``.

    Keys may arrive as JSON strings (``"3"``). A non-integer or out-of-range
    key, or a designation outside `USER_DESIGNATIONS`, is skipped, never
    guessed at; an absent or malformed map gives ``{}``."""
    raw = metadata.get("user_column_designations")
    if not isinstance(raw, Mapping):
        return {}
    out: dict[int, str] = {}
    for key, value in raw.items():
        text = str(key).strip()
        if not (text.isascii() and text.isdigit()) or value not in USER_DESIGNATIONS:
            continue
        channel = int(text)
        if channel < n_channels:
            out[channel] = str(value)
    return out
