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
from quantized.io.error_label_classify import classify_error_label_in_labels
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
    ``target`` mean once the dataset lands.
    """
    numeric = [c for c in columns if c.get("role") in ("y", "error")]
    categorical = [c for c in columns if c.get("role") == "categorical"]
    ordered = numeric + categorical
    return [
        _ChannelInfo(channel=i, source_index=_column_index(c), label=_effective_label(c))
        for i, c in enumerate(ordered)
    ]


def _error_role_channels(columns: Sequence[Mapping[str, object]]) -> list[_ChannelInfo]:
    """The channels sourced from an ``error``-role column, in final-channel
    order -- the ONLY rows the error-role editor shows."""
    by_source = {_column_index(c): c for c in columns}
    return [
        ci for ci in _final_channel_order(columns)
        if by_source.get(ci.source_index, {}).get("role") == "error"
    ]


def _categorical_role_channels(columns: Sequence[Mapping[str, object]]) -> list[_ChannelInfo]:
    """The channels sourced from a ``categorical``-role column, in
    final-channel order -- mirrors ``_error_role_channels`` above, but for
    the OTHER role that is never a plausible error target."""
    by_source = {_column_index(c): c for c in columns}
    return [
        ci for ci in _final_channel_order(columns)
        if by_source.get(ci.source_index, {}).get("role") == "categorical"
    ]


def _is_name_driven_match(labels: Sequence[str], error_channel: int) -> bool:
    """True when ``labels[error_channel]`` matched via
    ``infer_error_bindings_from_labels``' RULE 1 (base-name match, e.g.
    ``dR`` -> ``R``) or RULE 2 (explicit ``x`` prefix) -- a real
    NAME-driven signal. False means the binding (if any) can only have
    come from RULE 3 (nearest preceding column, pure position).

    This re-derives WHICH rule fired without reaching into
    ``infer_error_bindings_from_labels``'s internals, so it MUST make the
    same three decisions the same way it does:

    1. The CLASSIFIER: uses the evidence-gated
       ``classify_error_label_in_labels`` (never the lax context-free
       ``classify_error_label``) to decide which OTHER columns are
       eligible to serve as a base -- a provisional-only label (e.g.
       "Serr": a glued "err" at the edge with no sibling "S") must not be
       wrongly struck off as a possible base.
    2. The NORMALIZER: ``flat_norm``, the SAME function
       ``error_inference.py`` compares with.
    """
    info = classify_error_label_in_labels(labels, error_channel)
    if info is None:
        return False
    if info.axis == "x":
        return True  # rule 2
    if not info.base:
        return False
    is_error_label = [
        classify_error_label_in_labels(labels, i) is not None for i in range(len(labels))
    ]
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
    indexed (mirrors TypeScript's ``suggestErrorBindings`` exactly). Runs
    the SAME name-based inference the rest of the app uses
    (``infer_error_bindings_from_labels``) against the final channel
    labels, THEN demotes a MULTI-CANDIDATE, POSITION-ONLY (rule 3) pairing
    back to "no suggestion" -- see this module's docstring.

    Whatever survives: a column whose pairing is genuinely ambiguous is
    simply ABSENT from the result (never guessed) -- "no guess can
    silently attach error to the wrong signal".
    """
    order = _final_channel_order(columns)
    labels = [ci.label for ci in order]
    raw = infer_error_bindings_from_labels(labels)
    error_channels = {ci.channel for ci in _error_role_channels(columns)}
    categorical_channels = {ci.channel for ci in _categorical_role_channels(columns)}
    return [
        b for b in raw
        if _is_name_driven_match(labels, b.channel)
        or not _has_following_candidate(order, b.channel, error_channels, categorical_channels)
    ]


def suggest_error_bindings(columns: Sequence[Mapping[str, object]]) -> list[ErrorBinding]:
    """``suggest_error_bindings_by_channel`` translated to RAW FILE COLUMN
    indices (``quantized.io.import_error_bindings.ErrorBinding`` -- the
    same shape ``ImportSettings.error_bindings`` uses), the reverse of
    ``import_preview.py``'s own ``raw_to_channel`` map. Only columns whose
    role is ``"error"`` can appear as a suggestion's ``column`` -- exactly
    the channels ``_error_role_channels`` enumerates.
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
