"""Label-only error-column pairing — Python port of the pairing half of
``frontend/src/lib/errorRoles.ts`` (``inferErrorBindingsFromLabels``), P16.

TWO RULES THIS ENCODES, both from the plan (plans/archive/
ERROR_LABEL_CLASSIFIER_PLAN.md) and MAIN_PLAN #33:

 1. Names are SUGGESTED, never silently forced. ``err``/``sigma``/``dR``
    and friends are strong hints, but a column called ``error`` next to
    three Y columns is genuinely ambiguous, and quietly binding it to the
    wrong one produces a plot that is confidently wrong. So inference only
    proposes where the pairing is unambiguous, and everything is
    overridable.
 2. An error column stays INDEPENDENT of the values it describes. A
    binding is a reference, never a rewrite.

Label-only (no ``.values``/DataStruct needed), so the SAME algorithm can
seed the Import Wizard's error-role suggestions against a preview's
resolved column names, before any ``DataStruct`` exists —
``error_binding_suggestions.suggest_error_bindings`` (raw-column-indexed,
two-tier-narrowed) is layered on top of this.

``channel`` here means "index into the ``labels`` sequence passed in" --
generic, NOT necessarily a raw file column or a DataStruct channel. Callers
that need a specific indexing scheme translate at their own boundary (see
``error_binding_suggestions.py`` for the raw-file-column translation).

Kept a faithful, line-by-line port of the TypeScript on purpose — see
``error_label_candidates.py``'s module docstring for why, and
``tests/fixtures/error_labels/parity_corpus.json`` for the shared pin.
THIS FILE MUST NOT DIVERGE FROM ``errorRoles.ts``'s
``inferErrorBindingsFromLabels`` without updating that TS file too.

Pure ``io`` layer — no fastapi/pydantic imports.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any, Literal

from quantized.io.error_label_candidates import ErrorSide, flat_norm
from quantized.io.error_label_classify import classify_error_label_in_labels

__all__ = ["ErrorBinding", "infer_error_bindings_from_labels"]


@dataclass(frozen=True)
class ErrorBinding:
    """One error column -> signal pairing, indexed by position in the
    ``labels`` sequence ``infer_error_bindings_from_labels`` was called
    with (mirrors ``errorRoles.ts``'s ``ErrorBinding`` -- note this is a
    DIFFERENT indexing convention from
    ``quantized.io.import_error_bindings.ErrorBinding``, which is always
    RAW FILE COLUMN indexed; see that module's docstring).

    ``target == -1`` means "the dataset's x axis" (same convention both
    ``ErrorBinding`` types share).
    """

    channel: int
    target: int
    axis: Literal["x", "y"]
    side: ErrorSide

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def infer_error_bindings_from_labels(labels: Sequence[str]) -> list[ErrorBinding]:
    """Infer bindings from column LABELS ALONE, pairing each error column
    with the value column it describes.

    PAIRING RULES, in order of confidence:
      1. Base-name match -- ``dR`` binds to ``R``, ``M_err`` to ``M``.
         Unambiguous.
      2. An explicit ``x`` prefix binds to the x axis.
      3. Nearest PRECEDING value column -- the instrument-file convention
         the Origin/reflectometry corpus already relies on.
    A column that matches none of these is left UNBOUND rather than
    guessed at: the plan's "never silently forced".
    """
    # The REAL, evidence-gated decision for every channel, computed once up
    # front (`classify_error_label_in_labels` only ever consults OTHER
    # labels' context-free `has_confirmed_candidate`, never another
    # label's `classified` result, so this has no circular dependency).
    # `is_error` -- used below to keep a channel that IS an error column
    # from also being treated as somebody else's target -- is the FINAL
    # result, not the context-free approximation: `dR` beside `R` is only
    # confirmed via sibling evidence, and still must not itself be
    # eligible as a third column's target.
    classified = [classify_error_label_in_labels(labels, i) for i in range(len(labels))]
    is_error = [c is not None for c in classified]
    bindings: list[ErrorBinding] = []

    for ch in range(len(labels)):
        info = classified[ch]
        if info is None:
            continue

        # 1. base-name match against a NON-error column
        target = -2
        if info.base:
            idx = next(
                (
                    i for i, lbl in enumerate(labels)
                    if not is_error[i] and flat_norm(lbl) == info.base
                ),
                -1,
            )
            if idx >= 0:
                target = idx
        # 2. explicit x prefix
        if target == -2 and info.axis == "x":
            target = -1
        # 3. nearest preceding value column
        if target == -2:
            for k in range(ch - 1, -1, -1):
                if not is_error[k]:
                    target = k
                    break
        if target == -2:
            continue  # nothing defensible to bind to — leave it out

        if info.axis is not None:
            axis: Literal["x", "y"] = info.axis
        else:
            axis = "x" if target == -1 else "y"
        bindings.append(ErrorBinding(channel=ch, target=target, axis=axis, side=info.side))

    return bindings
