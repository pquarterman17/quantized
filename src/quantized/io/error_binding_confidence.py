"""Evidence-weighted CONFIDENCE for inferred error-column pairings
(plans/LIBRARY_WORKBOOK_UX_PLAN.md, "Required column-role inference":
"Header, unit, parser metadata, and adjacency evidence contribute to a
confidence result; adjacency alone is insufficient").

``error_inference.infer_error_bindings_from_labels`` stays exactly as it is
-- a line-by-line, parity-pinned port of ``errorRoles.ts`` -- and still
decides WHICH value column each error column pairs with, in its own rule
order (base-name, explicit x prefix, nearest preceding). This module never
re-targets a pairing; it only grades each one the label rules produced:

- HEADER evidence (``"name"``): the error column's header names its target
  -- rule 1 (``dR`` -> ``R``) or rule 2 (``xerr`` -> the x axis).
  ADJACENCY evidence (``"position"``): only rule 3 fired -- the error column
  merely sits after its target.
- UNIT evidence (``error_unit_evidence.compare_units``): ``"match"``,
  ``"mismatch"``, or ``"unknown"`` (neutral).

========  ==============  ===================
header    unit match      unit unknown
========  ==============  ===================
name      ``high``        ``medium``
position  ``medium``      ``low``
========  ==============  ===================

and a unit ``"mismatch"`` is ``blocked`` whatever the header says: FAIL
CLOSED, the pair is never bound (an error bar is drawn in its target's units
with no conversion, so a mismatched pair is a confidently wrong plot). A
blocked pairing is not re-targeted to some other column either -- that would
be a fresh guess no rule made.

``sufficient`` is ``high``/``medium``: at least one real signal beyond
position. ``low`` is adjacency alone, which the plan says is INSUFFICIENT --
a consumer must ask before applying it.

Parser metadata is the fourth kind of evidence and is not graded here: a
parser's explicit ``error_roles`` (``import_error_bindings.binding_metadata``)
and Origin's own column designations OUTRANK every inferred pairing, so they
never reach this module (``frontend/src/store/importErrorRoles.ts`` applies
that precedence).

Pure ``io`` layer -- no fastapi/pydantic imports.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any, Literal

from quantized.datastruct import DataStruct
from quantized.io.error_inference import ErrorBinding, infer_error_bindings_from_labels
from quantized.io.error_label_candidates import ErrorSide, flat_norm
from quantized.io.error_label_classify import ClassifiedLabel, classify_error_label_in_labels
from quantized.io.error_unit_evidence import UnitEvidence, compare_units
from quantized.x_units import x_unit_of

__all__ = [
    "Confidence",
    "HeaderEvidence",
    "ScoredErrorBinding",
    "binding_confidence",
    "infer_error_bindings_with_units",
    "is_name_driven_match",
    "score_dataset_error_bindings",
    "score_error_bindings",
]

HeaderEvidence = Literal["name", "position"]
Confidence = Literal["high", "medium", "low", "blocked"]

_GRADES: dict[tuple[HeaderEvidence, UnitEvidence], Confidence] = {
    ("name", "match"): "high",
    ("name", "unknown"): "medium",
    ("position", "match"): "medium",
    ("position", "unknown"): "low",
}


def binding_confidence(header: HeaderEvidence, unit: UnitEvidence) -> Confidence:
    """Grade one pairing from its header and unit evidence -- see the module
    docstring's table. A unit mismatch is ``"blocked"`` regardless of header."""
    if unit == "mismatch":
        return "blocked"
    return _GRADES[(header, unit)]


def is_name_driven_match(
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
    ``error_binding_suggestions.suggest_error_bindings_by_channel`` cubic in
    column count (~1ms at 41 columns, ~97s at 401 -- ``preview_import`` runs
    on every wizard keystroke). Reusing one shared classification pass
    keeps each caller at the classifier's own O(n^2), no worse.
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


@dataclass(frozen=True)
class ScoredErrorBinding:
    """One label-rule pairing plus the evidence behind it. ``channel``/
    ``target``/``axis``/``side`` mean exactly what they mean on
    ``error_inference.ErrorBinding`` (indices into the labels passed in;
    ``target == -1`` is the x axis)."""

    channel: int
    target: int
    axis: Literal["x", "y"]
    side: ErrorSide
    header: HeaderEvidence
    unit: UnitEvidence
    confidence: Confidence

    @property
    def blocked(self) -> bool:
        return self.confidence == "blocked"

    @property
    def sufficient(self) -> bool:
        """Enough evidence to apply without asking: more than adjacency."""
        return self.confidence in ("high", "medium")

    def binding(self) -> ErrorBinding:
        return ErrorBinding(channel=self.channel, target=self.target, axis=self.axis,
                            side=self.side)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def score_error_bindings(
    labels: Sequence[str],
    units: Sequence[str],
    *,
    x_unit: str | None = None,
) -> list[ScoredErrorBinding]:
    """Every pairing ``infer_error_bindings_from_labels(labels)`` makes, in
    its order, graded with header and unit evidence -- BLOCKED ones
    included (``.blocked``), so a caller can explain a refusal rather than
    have a pairing silently vanish.

    ``units[i]`` is ``labels[i]``'s unit (``""`` when unknown); ``x_unit``
    is the x axis's unit, compared against any error column that targets
    the x axis (``target == -1``). ``None``/blank on either side of a pair
    is neutral evidence, so all-blank units reproduce the label-only
    pairings exactly, each graded ``medium`` (name) or ``low`` (position).
    """
    if len(units) != len(labels):
        raise ValueError(
            f"units must align with labels: got {len(units)} unit(s) "
            f"for {len(labels)} label(s)"
        )
    classified = [classify_error_label_in_labels(labels, i) for i in range(len(labels))]
    is_error_label = [c is not None for c in classified]
    out: list[ScoredErrorBinding] = []
    for b in infer_error_bindings_from_labels(labels):
        header: HeaderEvidence = (
            "name" if is_name_driven_match(classified, is_error_label, labels, b.channel)
            else "position"
        )
        value_unit = x_unit if b.target == -1 else units[b.target]
        unit = compare_units(units[b.channel], value_unit)
        out.append(ScoredErrorBinding(
            channel=b.channel, target=b.target, axis=b.axis, side=b.side,
            header=header, unit=unit, confidence=binding_confidence(header, unit),
        ))
    return out


def infer_error_bindings_with_units(
    labels: Sequence[str],
    units: Sequence[str],
    *,
    x_unit: str | None = None,
) -> list[ErrorBinding]:
    """``infer_error_bindings_from_labels`` with the unit gate applied: the
    same pairings, minus every one whose units contradict (fail closed)."""
    return [
        s.binding() for s in score_error_bindings(labels, units, x_unit=x_unit)
        if not s.blocked
    ]


def score_dataset_error_bindings(ds: DataStruct) -> list[ScoredErrorBinding]:
    """``score_error_bindings`` over a parsed dataset's channel labels and
    units, with its recorded x-axis unit (``x_units.x_unit_of``)."""
    return score_error_bindings(ds.labels, ds.units, x_unit=x_unit_of(ds))
