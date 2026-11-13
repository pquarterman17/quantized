"""Per-column Origin roles a DataStruct declares, for the writers that
designate worksheet columns (the LabTalk ``.ogs`` export and the native
``.opj`` writer).

Two dataset fields carry them:

* ``metadata["column_designations"]`` -- ``{short name: designation}`` with
  the exact strings ``origin_project/windows.py``'s ``_DESIGNATION`` enum
  emits (``X``, ``Y``, ``Y-error``, ``X-error``, ``label``, ``disregard``,
  ``Z``). Keys are Origin short column names: a value channel's short name is
  ``metadata["origin_column_names"][channel]`` when the dataset carries that
  list (every Origin import does), else the writers' own positional lettering
  (``A`` is the X/time column, channel 0 is ``B``, …).
* ``metadata["error_roles"]`` (``_error_roles.py``) -- the user's LIVE error
  bindings. When present they are authoritative for which channels are error
  columns: a channel they list is ``Y-error``/``X-error``, and a channel that
  ``column_designations`` calls an error column but the live bindings do not
  list is a plain ``Y`` (the user unbound it).
* ``metadata["user_column_designations"]`` (``_error_roles.user_designations``)
  -- the worksheet's "Set As" map, keyed by value channel. It overrides
  ``column_designations`` for that channel; the live ``error_roles`` still
  decide error status.

``column_comments`` uses the same short-name keys.

Pure ``io`` layer: no fastapi/pydantic imports.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, TypeGuard

from quantized.io._error_roles import error_axes, user_designations

__all__ = [
    "LABTALK_COLUMN_TYPE",
    "ORIGIN_DESIGNATIONS",
    "channel_comments",
    "channel_designations",
    "channel_short_names",
    "column_letter",
    "error_targets",
    "is_error_label",
    "x_column_comment",
]

ORIGIN_DESIGNATIONS = ("X", "Y", "Y-error", "X-error", "label", "disregard", "Z")

# LabTalk ``wks.col.type`` codes (OriginLab LabTalk reference, "wks.col.type",
# docs.originlab.com/labtalk/ref/wkscoltype): 1 = Y, 2 = Disregard,
# 3 = Y Error, 4 = X, 5 = Label, 6 = Z, 7 = X Error. These are the binary
# file's 0-based designation enum (windows.py ``_DESIGNATION``) plus one --
# Origin C / PyOrigin ``Column::SetType`` use the 0-based form, LabTalk the
# 1-based one; never mix them.
LABTALK_COLUMN_TYPE = {
    "Y": 1,
    "disregard": 2,
    "Y-error": 3,
    "X": 4,
    "label": 5,
    "Z": 6,
    "X-error": 7,
}

# Whole-token error keywords for the LAST-RESORT label guess (a dataset that
# declares neither designations nor error roles). Token, not substring:
# "Kerr", "Hydrogen", "Standard" and "Drift" are data columns.
_ERR_TOKENS = frozenset({"err", "error", "errors", "dr", "std", "stdev", "sigma", "σ", "uncert"})
_TOKEN_SPLIT = re.compile(r"[^0-9A-Za-zσ]+")


def column_letter(i: int) -> str:
    """0-based worksheet column index -> Origin short name, bijective base-26
    (A..Z, AA, AB, …) -- the lettering Origin and the readers use."""
    out = ""
    i += 1
    while i:
        i, rem = divmod(i - 1, 26)
        out = chr(ord("A") + rem) + out
    return out


def is_error_label(label: str) -> bool:
    """True when ``label`` names an error column by a whole token
    (``"Kerr err"``, ``"dR"``, ``"R_std"``, ``"σ"``), never by a substring."""
    return any(tok.lower() in _ERR_TOKENS for tok in _TOKEN_SPLIT.split(label) if tok)


def channel_short_names(metadata: Mapping[str, Any], n_channels: int) -> list[str | None]:
    """The Origin short name of each value channel, or ``None`` for a channel
    the dataset's ``origin_column_names`` does not cover (a computed column
    appended after an Origin import). Without that list the positional
    lettering applies (channel ``j`` is column ``j + 1``; ``A`` is X)."""
    names = metadata.get("origin_column_names")
    if isinstance(names, (list, tuple)):
        return [
            str(names[j]) if j < len(names) and isinstance(names[j], str) else None
            for j in range(n_channels)
        ]
    return [column_letter(j + 1) for j in range(n_channels)]


def _str_map(metadata: Mapping[str, Any], key: str) -> dict[str, str]:
    raw = metadata.get(key)
    if not isinstance(raw, Mapping):
        return {}
    return {str(k): str(v) for k, v in raw.items() if isinstance(v, str)}


def channel_designations(
    metadata: Mapping[str, Any],
    labels: list[str] | tuple[str, ...],
    *,
    keyword_fallback: bool = False,
) -> list[str]:
    """One Origin designation per value channel (``ORIGIN_DESIGNATIONS``).

    Precedence: live ``error_roles`` decide error status when declared; then
    the worksheet's "Set As" (``user_column_designations``); then
    ``column_designations``; then -- only with ``keyword_fallback`` and only
    when the dataset declares none of those fields -- the whole-token label
    guess (``is_error_label`` -> ``Y-error``); otherwise ``Y``."""
    n = len(labels)
    shorts = channel_short_names(metadata, n)
    declared = _str_map(metadata, "column_designations")
    user = user_designations(metadata, n)
    err = error_axes(metadata, n)
    out: list[str] = []
    for j in range(n):
        short = shorts[j]
        desig = declared.get(short, "") if short is not None else ""
        if desig not in ORIGIN_DESIGNATIONS:
            desig = ""
        desig = user.get(j, desig)
        if err is not None:
            axis = err.get(j)
            if axis is not None:
                desig = "Y-error" if axis == "y" else "X-error"
            elif desig in ("Y-error", "X-error"):
                desig = "Y"  # the live bindings unbound it
        elif not desig and keyword_fallback and not declared and not user and is_error_label(labels[j]):
            desig = "Y-error"
        out.append(desig or "Y")
    return out


def _is_index(v: object) -> TypeGuard[int]:
    return isinstance(v, int) and not isinstance(v, bool)


def error_targets(metadata: Mapping[str, Any], n_channels: int) -> dict[int, int]:
    """``{y_error_channel: target_channel}`` from the live ``error_roles``
    (y-axis entries whose target is a valid value channel)."""
    roles = metadata.get("error_roles")
    out: dict[int, int] = {}
    if not isinstance(roles, (list, tuple)):
        return out
    for role in roles:
        if not isinstance(role, Mapping) or role.get("axis") != "y":
            continue
        ch, tgt = role.get("channel"), role.get("target")
        if not (_is_index(ch) and _is_index(tgt)):
            continue
        if 0 <= ch < n_channels and 0 <= tgt < n_channels:
            out[ch] = tgt
    return out


def channel_comments(metadata: Mapping[str, Any], n_channels: int) -> list[str]:
    """Each value channel's Origin column comment (``""`` when none)."""
    comments = _str_map(metadata, "column_comments")
    return [
        comments.get(s, "") if s is not None else ""
        for s in channel_short_names(metadata, n_channels)
    ]


def x_column_comment(metadata: Mapping[str, Any]) -> str:
    """The X (time) column's comment: keyed by its Origin short name
    (``x_column_name`` on an Origin import) or the positional ``A``."""
    comments = _str_map(metadata, "column_comments")
    if isinstance(metadata.get("origin_column_names"), (list, tuple)):
        return comments.get(str(metadata.get("x_column_name", "") or ""), "")
    return comments.get("A", "")
