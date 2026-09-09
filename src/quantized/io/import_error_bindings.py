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
    "AXIS_CONTRADICTS_TARGET",
    "NO_X_COLUMN",
    "DUPLICATE_TARGET",
    "DroppedErrorBinding",
    "ErrorBinding",
    "valid_error_bindings",
    "malformed_problems",
    "MALFORMED_ENTRY",
    "binding_metadata",
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
MALFORMED_ENTRY = "malformed_entry"
AXIS_CONTRADICTS_TARGET = "axis_contradicts_target"
NO_X_COLUMN = "no_x_column"
DUPLICATE_TARGET = "duplicate_target"
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


def _target_label(names: Sequence[str], target: int) -> str:
    """How a binding's target reads in a problem message: the x axis by name,
    or the target column's own name."""
    return "the x axis" if target == -1 else repr(_name_of(names, target))


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
    - ``target == -1`` (the x axis) with an ``axis`` that isn't ``"x"`` --
      self-contradictory;
    - ``target == -1`` when NO column holds the ``"x"`` role, so the axis
      would be a synthesized 1..N sample index;
    - ``column`` already claimed by an earlier binding in this same list;
    - the same ``(target, axis, side)`` already supplied by an earlier
      binding -- two columns describing one signal collapse downstream, so
      the later one is reported rather than silently displacing the first.
      Opposite SIDES of one target are not duplicates: that is exactly what
      an asymmetric pair is.

    Entries that could not be parsed into an ``ErrorBinding`` at all never
    reach here; :func:`malformed_problems` reports those.
    """
    n_cols = len(roles)
    kept: list[ErrorBinding] = []
    dropped: list[DroppedErrorBinding] = []
    claimed: set[int] = set()
    claimed_signals: set[tuple[int, str, str]] = set()

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
        # `target == -1` names the X AXIS specifically, so a `y` axis on it is
        # self-contradictory -- it would store a binding nothing can render
        # and give the user neither error bars nor a diagnostic.
        if b.target == -1 and b.axis != "x":
            dropped.append(DroppedErrorBinding(
                b.column, b.target, b.axis, b.side, AXIS_CONTRADICTS_TARGET,
                f"column {_name_of(names, b.column)!r} targets the x axis, "
                f"so its axis must be 'x' (got {b.axis!r})",
            ))
            continue
        # ... and only when the file HAS an x column. With no x role,
        # `parse_import` synthesizes a 1..N sample index, and error bars on a
        # row counter are meaningless -- the same staleness we already drop on
        # a y target that lost its role (review round 1).
        if b.target == -1 and "x" not in roles:
            dropped.append(DroppedErrorBinding(
                b.column, b.target, b.axis, b.side, NO_X_COLUMN,
                f"column {_name_of(names, b.column)!r} describes the x axis, "
                "but no column is marked with the x role",
            ))
            continue
        if b.column in claimed:
            dropped.append(DroppedErrorBinding(
                b.column, b.target, b.axis, b.side, DUPLICATE_COLUMN,
                f"column {_name_of(names, b.column)!r} is already bound "
                "by another error binding",
            ))
            continue
        # Two error columns describing the SAME target/axis/side collapse
        # downstream (the frontend keys error channels by target), so the
        # later one would vanish with no diagnostic. Drop it here, with one.
        signal = (b.target, b.axis, b.side)
        if signal in claimed_signals:
            dropped.append(DroppedErrorBinding(
                b.column, b.target, b.axis, b.side, DUPLICATE_TARGET,
                f"column {_name_of(names, b.column)!r} duplicates an error "
                f"binding another column already provides for "
                f"{_target_label(names, b.target)} ({b.axis} {b.side})",
            ))
            continue
        claimed.add(b.column)
        claimed_signals.add(signal)
        kept.append(b)

    return kept, dropped


def binding_metadata(
    kept: Sequence[ErrorBinding],
    dropped: Sequence[DroppedErrorBinding],
    channel_order: Sequence[int],
) -> dict[str, Any]:
    """The `DataStruct.metadata` entries a parsed import contributes for its
    error bindings: `error_roles` for what survived, `import_problems` for what
    did not. Either key is OMITTED when its list is empty -- no empty-list
    noise in the metadata of the many datasets that have no bindings at all.

    `channel_order` is the RAW column index of each emitted channel, in channel
    order (`parse_import` builds it as its numeric columns followed by its
    categorical ones), and is what turns this module's raw-column indices into
    the channel indices `Dataset.errorRoles` uses. A binding targeting the x
    axis keeps `target: -1` -- the x axis is not a channel.

    `import_problems` exists because NOT every caller saw a preview:
    `io/registry.py`'s saved-filter path parses a glob-matched file with no
    wizard in sight, and a filter reused across files is exactly where a
    binding goes stale. Dropping it with no record anywhere would leave
    nothing anywhere to explain why the error bars are missing.

    `error_roles` IS read now: `store/importErrorRoles.ts`'s `parserErrorRoles`
    maps it onto `Dataset.errorRoles` at import, validating every entry
    (indices in range, a channel never its own target, known axis/side) since
    it arrives from a parsed file. It outranks the label guesser and is
    outranked by Origin's own column designations. Added for BUG-001, where
    `io/ncnr.py` needed a way to say that a reductus `.refl`'s uncertainty and
    Q resolution are uncertainties rather than curves.

    `error_binding_problems` remains BACKEND CONTRACT ONLY: no frontend code
    reads it from a preview yet, so a binding this module drops still explains
    itself nowhere -- said plainly here so the next reader does not mistake
    "recorded" for "surfaced".
    """
    raw_to_channel = {raw: chan for chan, raw in enumerate(channel_order)}
    out: dict[str, Any] = {}
    if kept:
        out["error_roles"] = [
            {
                "channel": raw_to_channel[b.column],
                "target": -1 if b.target == -1 else raw_to_channel[b.target],
                "axis": b.axis,
                "side": b.side,
            }
            for b in kept
        ]
    if dropped:
        out["import_problems"] = [d.to_dict() for d in dropped]
    return out


def malformed_problems(entries: Sequence[dict[str, Any]]) -> list[DroppedErrorBinding]:
    """Report entries `ImportSettings.from_dict` could not parse AT ALL, in the
    same shape as a binding that failed semantic validation.

    These never reach :func:`valid_error_bindings` -- they are not
    `ErrorBinding`s -- so without this they would vanish between reading a
    saved filter off disk and previewing it, which is the one outcome this
    contract exists to rule out. The offending values are echoed back as
    given (a `-1`/`""` placeholder where a field was absent or unusable) so
    the message can quote what was actually in the file."""
    out: list[DroppedErrorBinding] = []
    for entry in entries:
        column = entry.get("column")
        target = entry.get("target")
        axis = entry.get("axis")
        side = entry.get("side")
        out.append(DroppedErrorBinding(
            column if isinstance(column, int) else -1,
            target if isinstance(target, int) else -1,
            str(axis) if axis is not None else "",
            str(side) if side is not None else "",
            MALFORMED_ENTRY,
            "saved error binding could not be read "
            f"(axis={axis!r}, side={side!r}, column={column!r}, target={target!r})",
        ))
    return out
