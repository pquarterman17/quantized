"""P1.6 error-column bindings: the raw-column-indexed pairing between an
``error``-role Import Wizard column and the signal (x axis or a ``y`` column)
it describes.

Split out of :mod:`quantized.io.import_preview` to stay under the 500-line
god-module ceiling; :class:`ErrorBinding` is also re-exported from there so
``from quantized.io.import_preview import ErrorBinding`` keeps working for
existing callers.

RAW COLUMN INDICES, deliberately -- see :class:`ErrorBinding`'s docstring.

Pure ``io`` layer -- no fastapi/pydantic imports.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any, Literal

__all__ = [
    "COLUMN_NOT_ERROR_ROLE",
    "COLUMN_OUT_OF_RANGE",
    "DUPLICATE_COLUMN",
    "INVALID_AXIS",
    "INVALID_SIDE",
    "TARGET_EQUALS_COLUMN",
    "TARGET_NOT_Y_ROLE",
    "TARGET_OUT_OF_RANGE",
    "DroppedErrorBinding",
    "ErrorBinding",
    "valid_error_bindings",
]

ErrorAxis = Literal["x", "y"]
#: ONE spelling of `side`, everywhere: the same `"both" | "+" | "-"` the
#: frontend already uses (`frontend/src/lib/errorLabelCandidates.ts`) and
#: already PERSISTS in a `.dwk`'s `Dataset.errorRoles` (its reader,
#: `errorRoles.sanitizeBindings`, accepts exactly these three). A descriptive
#: `lower`/`upper` would read better in a hand-edited filter file taken on its
#: own, but it would put TWO spellings of one field in two user-facing JSON
#: files the same person opens (`import_filters.json` beside a `.dwk`), plus a
#: translation table between them for a later change to drift through. `"+"`
#: is the upper half and `"-"` the lower (the wizard's own picker reads
#: "+ upper" / "− lower"), so a binding now round-trips import filter ->
#: DataStruct metadata -> `.dwk` byte-identically, with nothing to translate.
ErrorSide = Literal["both", "+", "-"]

_AXES: tuple[ErrorAxis, ...] = ("x", "y")
_SIDES: tuple[ErrorSide, ...] = ("both", "+", "-")

# ── validation drop codes ────────────────────────────────────────────────
INVALID_AXIS = "invalid_axis"
INVALID_SIDE = "invalid_side"
COLUMN_OUT_OF_RANGE = "column_out_of_range"
COLUMN_NOT_ERROR_ROLE = "column_not_error_role"
TARGET_OUT_OF_RANGE = "target_out_of_range"
TARGET_EQUALS_COLUMN = "target_equals_column"
TARGET_NOT_Y_ROLE = "target_not_y_role"
DUPLICATE_COLUMN = "duplicate_column"


@dataclass(frozen=True)
class ErrorBinding:
    """One error column -> signal pairing, indexed by RAW FILE COLUMN, not
    DataStruct channel.

    ``column``/``target`` deliberately use the same RAW COLUMN numbering as
    ``ImportSettings.roles``/``column_names`` (position in the delimited
    file, before roles are resolved into channels) rather than the eventual
    DataStruct channel index, for two reasons:

    1. ``roles``/``column_names`` on the settings object this lives on are
       already raw-column-aligned -- a second, differently-indexed field on
       the same object would be a standing footgun.
    2. A *saved* filter (``io.import_filters``) must survive being reapplied
       to a different file whose channel numbering differs because a role
       changed (e.g. one more column got marked ``ignore``) -- the raw file
       layout (delimiter, column count/order) is far more stable across a
       given instrument's exports than the derived channel numbering, so
       binding to file position is what actually round-trips.

    ``target == -1`` means "the dataset's x axis" (mirrors the frontend
    ``ErrorBinding.target`` convention in ``frontend/src/lib/errorRoles.ts``)
    rather than a specific y column.
    """

    column: int
    target: int
    axis: ErrorAxis
    side: ErrorSide

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: Any) -> ErrorBinding | None:
        """Reconstruct one binding from a (possibly untrusted, disk-sourced)
        JSON entry -- returns ``None`` rather than raising for anything
        malformed: wrong shape, wrong types, or an axis/side outside the
        allowed literals. Never trust data that came off a user-editable
        settings file."""
        if not isinstance(payload, dict):
            return None
        column = payload.get("column")
        target = payload.get("target")
        axis = payload.get("axis")
        side = payload.get("side")
        # bool is an int subclass -- exclude it explicitly so `True`/`False`
        # (plausible JSON typos for 0/1) aren't silently accepted as indices.
        if not isinstance(column, int) or isinstance(column, bool):
            return None
        if not isinstance(target, int) or isinstance(target, bool):
            return None
        if axis not in _AXES or side not in _SIDES:
            return None
        return cls(column=column, target=target, axis=axis, side=side)


@dataclass(frozen=True)
class DroppedErrorBinding:
    """One binding :func:`valid_error_bindings` refused to keep, echoing the
    original (possibly invalid) fields back alongside why."""

    column: int
    target: int
    axis: str
    side: str
    code: str
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _name_of(names: Sequence[str], index: int) -> str:
    return names[index] if 0 <= index < len(names) else f"column {index}"


def valid_error_bindings(
    bindings: Sequence[ErrorBinding] | None,
    roles: Sequence[str],
    names: Sequence[str],
) -> tuple[list[ErrorBinding], list[DroppedErrorBinding]]:
    """Validate raw-column-indexed ``bindings`` against a file's RESOLVED
    per-column ``roles``/``names`` -- same length, same raw-column alignment
    as ``_Parsed.roles``/``_Parsed.names`` (post default-resolution, so a
    short/blank ``roles`` entry has already become ``"y"`` the same way the
    rest of the parse treats it).

    Never raises. Each binding is either kept, or DROPPED and reported (never
    silently) in the second return value with a ``code`` and a human-
    readable ``reason`` naming the column by NAME (falling back to a
    ``"column {index}"`` label only when the index itself is out of range,
    so there is no name to look up). Kept bindings preserve their relative
    order; when two bindings claim the same raw ``column``, the first one
    (in ``bindings`` order) is kept and every later one for that column is
    dropped as a duplicate.

    Drop conditions, checked in order:

    - ``axis``/``side`` outside the allowed literals (defense-in-depth --
      normally unreachable once a binding has passed
      :meth:`ErrorBinding.from_dict`, but a caller can still construct one
      directly with the wrong value since dataclasses don't enforce
      ``Literal`` at runtime);
    - ``column`` out of range;
    - ``column``'s role isn't ``"error"`` (e.g. the user re-roled it to
      ``"ignore"`` after the binding was made);
    - ``target`` isn't ``-1`` and is out of range;
    - ``target == column`` (a column can't describe itself);
    - ``target`` isn't ``-1`` and its role isn't ``"y"`` -- deliberately
      narrower than "produces a channel": an ``"error"`` column can't itself
      be a target (that would let two error columns describe each other),
      and a ``"categorical"`` channel has no numeric magnitude for an error
      bar to sit around;
    - ``column`` already claimed by an earlier binding in this same list.
    """
    n_cols = len(roles)
    kept: list[ErrorBinding] = []
    dropped: list[DroppedErrorBinding] = []
    claimed: set[int] = set()

    for b in bindings or ():
        if b.axis not in _AXES:
            dropped.append(DroppedErrorBinding(
                b.column, b.target, b.axis, b.side, INVALID_AXIS,
                f"axis must be 'x' or 'y' (got {b.axis!r})",
            ))
            continue
        if b.side not in _SIDES:
            dropped.append(DroppedErrorBinding(
                b.column, b.target, b.axis, b.side, INVALID_SIDE,
                f"side must be 'both', '+' (upper), or '-' (lower) (got {b.side!r})",
            ))
            continue
        if not (0 <= b.column < n_cols):
            dropped.append(DroppedErrorBinding(
                b.column, b.target, b.axis, b.side, COLUMN_OUT_OF_RANGE,
                f"error column index {b.column} is out of range "
                f"(file has {n_cols} column{'s' if n_cols != 1 else ''})",
            ))
            continue
        if roles[b.column] != "error":
            dropped.append(DroppedErrorBinding(
                b.column, b.target, b.axis, b.side, COLUMN_NOT_ERROR_ROLE,
                f"column {_name_of(names, b.column)!r} is not marked with the error role",
            ))
            continue
        if b.target != -1 and not (0 <= b.target < n_cols):
            dropped.append(DroppedErrorBinding(
                b.column, b.target, b.axis, b.side, TARGET_OUT_OF_RANGE,
                f"target column index {b.target} is out of range "
                f"(file has {n_cols} column{'s' if n_cols != 1 else ''})",
            ))
            continue
        if b.target == b.column:
            dropped.append(DroppedErrorBinding(
                b.column, b.target, b.axis, b.side, TARGET_EQUALS_COLUMN,
                f"column {_name_of(names, b.column)!r} cannot be its own error target",
            ))
            continue
        if b.target != -1 and roles[b.target] != "y":
            dropped.append(DroppedErrorBinding(
                b.column, b.target, b.axis, b.side, TARGET_NOT_Y_ROLE,
                f"target column {_name_of(names, b.target)!r} is not a y column",
            ))
            continue
        if b.column in claimed:
            dropped.append(DroppedErrorBinding(
                b.column, b.target, b.axis, b.side, DUPLICATE_COLUMN,
                f"column {_name_of(names, b.column)!r} is already bound "
                "by another error binding",
            ))
            continue
        claimed.add(b.column)
        kept.append(b)

    return kept, dropped
