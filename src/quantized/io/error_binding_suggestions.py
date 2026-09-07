"""The Import Wizard's TWO-TIER error-binding suggestion narrowing — Python
port of ``frontend/src/lib/importwizard.ts``'s ``suggestErrorBindings`` and
its helpers (P16, plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md P1.6 "TWO-TIER").

``error_inference.infer_error_bindings_from_labels`` (ported from
``errorRoles.ts``) always binds a rule-3 (nearest-preceding) pairing when
*something* precedes, even when an equally plausible column also FOLLOWS
the error column (e.g. ``T1, "T err", T2`` -- rule 3 alone has no forward
awareness and would bind "T err" to T1 unconditionally). The wizard needs a
stricter bar before PRE-FILLING a suggestion a user might not notice to
correct:

  - a NAME-driven match (rule 1 base-name, or rule 2 explicit x-prefix) is
    ALWAYS a real, pre-filled suggestion -- these are real name signals,
    not positional guesses, and are never demoted.
  - a POSITION-only match (rule 3, no name signal) is a real suggestion
    ONLY when single-candidate -- nothing plausible follows the error
    column. When another non-error, non-categorical column ALSO follows
    (genuinely ambiguous between the preceding and following candidate),
    it demotes to unassigned instead of binding to whichever happens to
    precede.

This demotion is SURGICAL to this wizard-seeding layer --
``infer_error_bindings_from_labels`` itself is untouched and every other
consumer keeps its existing, broader "any preceding column" bar.

CONTRACT (review round 2 -- this is NOT "suggestions are restricted to
``error``-role columns", despite an earlier draft of this docstring and of
``frontend/src/lib/importTypes.ts`` claiming exactly that):

  - A suggestion is a PROPOSAL to mark ``column`` with the ``error`` role
    AND bind it to ``target`` -- both halves, together. It is computed from
    LABEL SHAPE alone, so it can name a column that is not (yet) marked
    ``error`` -- that is the entire point: the wizard shows a suggestion
    to help the user assign roles in the first place, before any column
    has been marked ``error`` at all. ``guess_settings`` never assigns the
    ``error`` role on its own, so a suggestion source restricted to
    already-``error`` columns would be ALWAYS EMPTY on a fresh preview.
  - Applying a suggestion means setting BOTH the role and the binding. A
    suggestion fed straight into ``settings.error_bindings`` WITHOUT also
    setting ``column``'s role to ``error`` is dropped by
    ``valid_error_bindings`` with ``COLUMN_NOT_ERROR_ROLE``
    ("column_not_error_role") -- the wizard UI is responsible for setting
    both together.
  - A column already marked with a DIFFERENT role the user chose
    deliberately -- ``ignore`` or ``label`` (never a channel at all, so
    never even reaches this module's candidate pool) or ``categorical``
    (a channel, but never a plausible error SOURCE) -- is NEVER suggested,
    regardless of how error-shaped its name looks: the user has already
    said what that column is. Only a column currently ``y`` or ``error``
    (which includes every "unassigned" column, since ``guess_settings``
    defaults every non-``x`` column to ``y``) is eligible to be a
    suggestion's ``column``.
  - A suggestion's ``target`` must be a column that CAN validly become one
    -- role ``y`` (the only role ``valid_error_bindings`` accepts as a
    target), or ``-1`` (the x axis). ``infer_error_bindings_from_labels``
    itself has no notion of role and searches the combined
    numeric+categorical label list for rule 1's (base-name) match, so it
    can land on a ``categorical`` column's name (e.g. ``X, M, Cat,
    Cat_err`` matches ``Cat_err`` to ``Cat``) -- that binding is DEAD ON
    ARRIVAL (``valid_error_bindings`` always refuses it,
    ``TARGET_NOT_Y_ROLE``), so it is filtered out here rather than ever
    surfaced. (Rule 3, nearest-PRECEDING, can never reach a categorical
    target this way -- ``_final_channel_order`` always places every
    categorical channel after every numeric one, so nothing categorical
    ever precedes a numeric/error channel in the final order -- but the
    filter below is a blanket one regardless of which rule produced the
    target, cheap insurance against relying on that invariant forever.)
  - A base-name match against the ``x``-role column's own name IS a real
    NAME-driven signal too, even though ``x`` never becomes a channel and
    so is invisible to ``infer_error_bindings_from_labels`` (which only
    ever sees this module's channel-label list, never ``x``'s name) --
    e.g. ``H, M, H_err`` names "H" twice: once as the x axis, once as
    "H_err"'s extracted base. Without checking the x column's name
    separately, that base-name evidence is invisible, "H_err" falls
    through to rule 3 (position), and gets a false single-candidate
    suggestion binding it to ``M`` -- wrong, and silently so (see the
    ``suggest_error_bindings_by_channel`` docstring for the mechanism).
    This IS a deliberate divergence from ``importwizard.ts``'s
    ``suggestErrorBindings``, which has no equivalent x-name check and
    reproduces the ``M`` misbinding -- ``infer_error_bindings_from_labels``
    itself stays byte-for-byte parity-pinned (nothing above changes it),
    but this wizard-seeding layer is free to be strictly MORE careful
    about what it pre-fills than the raw label inference is required to
    be, and now is.

Unlike the TypeScript (which works in DataStruct CHANNEL indices over the
wizard's own ``finalChannelOrder``), the bindings this module hands back to
``preview_import`` are RAW FILE COLUMN indexed
(``quantized.io.import_error_bindings.ErrorBinding``, the same shape
``ImportSettings.error_bindings`` uses) -- so a suggestion can be assigned
straight into ``ImportSettings.error_bindings`` without any further
translation. ``suggest_error_bindings_by_channel`` below is the direct,
channel-indexed port of the TS function; ``suggest_error_bindings`` layers
the raw-column translation on top, mirroring the reverse of
``import_preview.py``'s own ``raw_to_channel`` map.

These are SUGGESTIONS only: never merged into ``settings.error_bindings``,
never applied automatically -- ``import_preview.preview_import`` returns
them alongside (not instead of) the settings' own confirmed bindings.

Pure ``io`` layer — no fastapi/pydantic imports.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from quantized.io.error_inference import ErrorBinding as LabelErrorBinding
from quantized.io.error_inference import infer_error_bindings_from_labels
from quantized.io.error_label_candidates import flat_norm
from quantized.io.error_label_classify import ClassifiedLabel, classify_error_label_in_labels
from quantized.io.import_error_bindings import ErrorBinding

__all__ = ["suggest_error_bindings", "suggest_error_bindings_by_channel"]


@dataclass(frozen=True)
class _ChannelInfo:
    """One column that WILL become a DataStruct channel, in the exact FINAL
    order ``io/import_preview.py::parse_import`` produces it -- mirrors
    TypeScript's ``WizardChannel``."""

    channel: int
    source_index: int
    label: str


def _column_index(col: Mapping[str, object]) -> int:
    index = col.get("index")
    return index if isinstance(index, int) else 0


def _effective_label(col: Mapping[str, object]) -> str:
    effective = col.get("effective_name")
    if isinstance(effective, str) and effective:
        return effective
    name = col.get("name")
    return name if isinstance(name, str) else ""


def _final_channel_order(columns: Sequence[Mapping[str, object]]) -> list[_ChannelInfo]:
    """One column per eventual DataStruct channel, in FINAL order:
    ``y``/``error`` columns first (their original column order), then
    ``categorical`` columns appended after (P1.4's rule) -- ``x``/
    ``label``/``ignore`` never become channels. ``channel`` is that final
    0-based index -- the SAME number ``Dataset.errorRoles``' ``channel``/
    ``target`` mean once the dataset lands. Exactly ``parse_import``'s own
    ``chan_cols + cat_cols`` (each list built the same way, over the same
    ``columns``, in the same order) -- so a channel index computed here
    always means the same DataStruct channel ``parse_import`` will actually
    emit.
    """
    numeric = [c for c in columns if c.get("role") in ("y", "error")]
    categorical = [c for c in columns if c.get("role") == "categorical"]
    ordered = numeric + categorical
    return [
        _ChannelInfo(channel=i, source_index=_column_index(c), label=_effective_label(c))
        for i, c in enumerate(ordered)
    ]


def _role_channels(columns: Sequence[Mapping[str, object]], role: str) -> set[int]:
    """The FINAL-channel-order channel numbers sourced from a column
    currently marked ``role`` -- e.g. ``_role_channels(columns, "error")``
    is exactly the rows the error-role editor shows."""
    by_source = {_column_index(c): c for c in columns}
    return {
        ci.channel for ci in _final_channel_order(columns)
        if by_source.get(ci.source_index, {}).get("role") == role
    }


def _x_label(columns: Sequence[Mapping[str, object]]) -> str | None:
    """The effective label of the file's ``x``-role column, or ``None`` if
    none is marked -- ``x`` never becomes a channel, so it is absent from
    ``_final_channel_order`` entirely and invisible to
    ``infer_error_bindings_from_labels``'s own base-name matching. Without
    this, an error column whose true target IS the x axis by name (e.g.
    ``H_err`` beside an x column named ``H``) has no name evidence to match
    against and silently falls through to position-only rule 3 instead --
    see this module's docstring. (Multiple ``x`` columns is an invalid
    intermediate wizard state, P1-5 DEFECT 1 -- take the first rather than
    refuse to suggest anything; ``parse_import`` itself still rejects the
    ambiguous multi-x state at Import time.)
    """
    for c in columns:
        if c.get("role") == "x":
            return _effective_label(c)
    return None


def _is_name_driven_match(
    classified: Sequence[ClassifiedLabel | None],
    is_error_label: Sequence[bool],
    labels: Sequence[str],
    error_channel: int,
) -> bool:
    """True when ``labels[error_channel]`` matched via
    ``infer_error_bindings_from_labels``' RULE 1 (base-name match, e.g.
    ``dR`` -> ``R``) or RULE 2 (explicit ``x`` prefix) -- a real
    NAME-driven signal. False means the binding (if any) can only have
    come from RULE 3 (nearest preceding column, pure position).

    This re-derives WHICH rule fired without reaching into
    ``infer_error_bindings_from_labels``'s internals, so it MUST make the
    same decisions the same way it does -- but takes ``classified``
    (``classify_error_label_in_labels(labels, i)`` for every ``i``) and
    ``is_error_label`` (``classified[i] is not None``) as ALREADY COMPUTED
    by the caller, once, rather than re-deriving them per call: this
    function used to re-run the evidence-gated classifier over every OTHER
    label on every call, on top of ``infer_error_bindings_from_labels``
    already doing the same O(n) classification once internally -- since
    this runs once per candidate binding (up to O(n) of them), that made
    ``suggest_error_bindings_by_channel`` cubic in column count
    (~1ms at 41 columns, ~97s at 401 -- ``preview_import`` runs on every
    wizard keystroke). Reusing one shared classification pass keeps the
    whole function at the classifier's own O(n^2), no worse.
    """
    info = classified[error_channel]
    if info is None:
        return False
    if info.axis == "x":
        return True  # rule 2
    if not info.base:
        return False
    return any(
        not is_error_label[i] and flat_norm(lbl) == info.base for i, lbl in enumerate(labels)
    )  # rule 1


def _has_following_candidate(
    order: Sequence[_ChannelInfo],
    channel: int,
    error_channels: set[int],
    categorical_channels: set[int],
) -> bool:
    """True when some OTHER, non-error, non-categorical channel sits AFTER
    ``channel`` in ``order`` -- the wizard's own (stricter) bar for "is a
    pure position-only pairing actually unambiguous", on top of
    ``infer_error_bindings_from_labels``'s own bar (which only asks "is
    there anything valid preceding"). A following ERROR-role channel
    doesn't count -- it isn't itself a plausible target. Neither does a
    following CATEGORICAL (text) channel: a categorical column can only
    ever be a text label a plot legend uses, never something error bars
    could sensibly attach to.
    """
    return any(
        ci.channel > channel
        and ci.channel not in error_channels
        and ci.channel not in categorical_channels
        for ci in order
    )


def suggest_error_bindings_by_channel(
    columns: Sequence[Mapping[str, object]],
) -> list[LabelErrorBinding]:
    """Suggested error-role bindings for the CURRENT preview, CHANNEL
    indexed. Runs the SAME name-based inference the rest of the app uses
    (``infer_error_bindings_from_labels``) against the final channel
    labels, THEN:

    1. restricts candidate SOURCE columns to ones a suggestion is actually
       allowed to name -- currently ``y`` or ``error`` (never
       ``categorical``, which never reaches this function's caller as a
       plausible error column at all -- see the module docstring);
    2. checks the ``x``-role column's own name for a base-name match
       ``infer_error_bindings_from_labels`` cannot see (it never receives
       ``x``'s label at all), so a genuine name-driven x-axis pairing
       (e.g. ``H_err`` beside x column ``H``) is recognized instead of
       silently falling through to a position-only guess against the
       wrong column;
    3. demotes a MULTI-CANDIDATE, POSITION-ONLY (rule 3) pairing back to
       "no suggestion" -- see this module's docstring;
    4. drops any surviving suggestion whose TARGET could never validly
       become one (not role ``y``, not ``-1``) -- ``infer_error_bindings_
       from_labels`` has no notion of role and its rule-1 base-name match
       can land on a ``categorical`` column's name, which
       ``valid_error_bindings`` always refuses.

    Whatever survives: a column whose pairing is genuinely ambiguous, or
    whose only candidate pairing could never validate, is simply ABSENT
    from the result (never guessed) -- "no guess can silently attach error
    to the wrong signal".
    """
    order = _final_channel_order(columns)
    labels = [ci.label for ci in order]
    raw_by_channel = {b.channel: b for b in infer_error_bindings_from_labels(labels)}
    # One shared classification pass -- see `_is_name_driven_match`'s
    # docstring for why this (not a re-classify-per-binding) is what keeps
    # this function from going cubic.
    classified = [classify_error_label_in_labels(labels, i) for i in range(len(labels))]
    is_error_label = [c is not None for c in classified]

    error_channels = _role_channels(columns, "error")
    categorical_channels = _role_channels(columns, "categorical")
    y_channels = _role_channels(columns, "y")
    source_channels = error_channels | y_channels  # categorical/ignore/label excluded

    x_label = _x_label(columns)
    x_base = flat_norm(x_label) if x_label else None

    out: list[LabelErrorBinding] = []
    for ci in order:
        if ci.channel not in source_channels:
            continue
        info = classified[ci.channel]
        if info is None:
            continue
        if _is_name_driven_match(classified, is_error_label, labels, ci.channel):
            b = raw_by_channel.get(ci.channel)
            if b is not None:
                out.append(b)
            continue
        if info.base and x_base and info.base == x_base:
            out.append(LabelErrorBinding(channel=ci.channel, target=-1, axis="x", side=info.side))
            continue
        b = raw_by_channel.get(ci.channel)
        if b is not None and not _has_following_candidate(
            order, ci.channel, error_channels, categorical_channels
        ):
            out.append(b)

    # A suggestion's target must be able to become a real `y` channel, or
    # `-1` (the x axis) -- see the module docstring's `TARGET_NOT_Y_ROLE`
    # paragraph for why `infer_error_bindings_from_labels`'s rule 1 can
    # land a `target` on a `categorical` column despite that.
    return [b for b in out if b.target == -1 or b.target in y_channels]


def suggest_error_bindings(columns: Sequence[Mapping[str, object]]) -> list[ErrorBinding]:
    """``suggest_error_bindings_by_channel`` translated to RAW FILE COLUMN
    indices (``quantized.io.import_error_bindings.ErrorBinding`` -- the
    same shape ``ImportSettings.error_bindings`` uses), the reverse of
    ``import_preview.py``'s own ``raw_to_channel`` map. See the module
    docstring for exactly which columns can appear as a suggestion's
    ``column``/``target`` -- NOT restricted to already-``error``-role
    columns (a common misreading this docstring used to encode).
    """
    order = _final_channel_order(columns)
    channel_to_raw = {ci.channel: ci.source_index for ci in order}
    suggestions = suggest_error_bindings_by_channel(columns)
    return [
        ErrorBinding(
            column=channel_to_raw[b.channel],
            target=-1 if b.target == -1 else channel_to_raw[b.target],
            axis=b.axis,
            side=b.side,
        )
        for b in suggestions
    ]
