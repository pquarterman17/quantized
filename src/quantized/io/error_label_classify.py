"""Ranking + selection over ``error_label_candidates.py``'s generated
candidates — Python port of ``frontend/src/lib/errorLabelClassify.ts``
(P16, plans/archive/ERROR_LABEL_CLASSIFIER_PLAN.md).

This is the ONLY place dataset context (sibling column names) enters.
Nothing here mutates a candidate; selection either returns one unchanged or
returns none.

The invariant this buys: adding a token to ``ERROR_TOKENS`` changes only
generation. Ranking and selection below never look at the token list, so a
new spelling cannot perturb an existing spelling's result.

Kept a faithful, line-by-line port of the TypeScript on purpose — see
``error_label_candidates.py``'s module docstring for why, and
``tests/fixtures/error_labels/parity_corpus.json`` for the shared pin.

Pure ``io`` layer — no fastapi/pydantic imports.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from quantized.io.error_label_candidates import (
    ERROR_TOKENS,
    Candidate,
    ErrorSide,
    flat_norm,
    generate_candidates,
    has_confirmed_candidate,
)

__all__ = [
    "ClassifiedLabel",
    "classify_error_label",
    "classify_error_label_in_labels",
    "has_confirmed_candidate",
    "rank_candidates",
    "select_candidate",
]


@dataclass(frozen=True)
class ClassifiedLabel:
    axis: Literal["x", "y"] | None
    side: ErrorSide
    base: str


def _rank_key(c: Candidate) -> tuple[int, int, int, str, str, str]:
    # Mirrors errorLabelClassify.ts's `rankCandidates` comparator EXACTLY,
    # field by field (never concatenated into one sort key — see that
    # file's comment on why):
    #   1. confirmed before provisional
    #   2. longer matched token first ("stderr" beats "err")
    #   3. longer remaining base first
    #   4. lexical on (base, token, side), to make the order total --
    #      `base` alone is not total, since two candidates can share a base
    #      with different tokens.
    return (0 if c.confirmed else 1, -len(c.token), -len(c.base), c.base, c.token, c.side)


def rank_candidates(candidates: Sequence[Candidate]) -> list[Candidate]:
    """Total order over candidates for one label — see ``_rank_key``.

    Python's ``sorted`` is stable (like the V8 engine's ``Array.sort`` this
    ports), so candidates that tie on every field above keep their original
    generation order, exactly as the TypeScript does.
    """
    return sorted(candidates, key=_rank_key)


def _to_result(c: Candidate) -> ClassifiedLabel:
    return ClassifiedLabel(axis=c.axis, side=c.side, base=c.base)


def select_candidate(
    candidates: Sequence[Candidate],
    labels: Sequence[str],
    self_index: int,
    tokens: Sequence[str] = ERROR_TOKENS,
) -> Candidate | None:
    """SELECT, stated precisely (the plan's own wording):

    1. Scan EVERY candidate, in ranked order, for sibling evidence -- a
       sibling label (not itself independently error-like) whose
       normalized form equals the candidate's base. This is not "check the
       top-ranked candidate, then fall back": ``MStdErr`` beside ``M``
       ranks confirmed(stderr,"m") ABOVE confirmed(err,"mstd") by
       longer-token, so the first candidate scanned already has the
       sibling; but a case where the top-ranked candidate's base has no
       sibling must still continue down the ranked list rather than give
       up.
    2. Otherwise, the first CONFIRMED candidate -- a confirmed reading can
       never be destroyed by a provisional one, which is what makes the
       old failure class ("Phase_err" losing its error bars to a later
       phase) impossible here: there IS no later phase, only a ranked
       list.
    3. Otherwise, not an error column.

    Sibling eligibility uses ``has_confirmed_candidate`` (context-free, no
    evidence) rather than the full recursive classification, so this never
    has to resolve a cycle between two labels each trying to use the other
    as evidence -- and so a label whose only reading of ITSELF is
    provisional (a glued substring match, not a real segment boundary)
    still counts as ordinary data and stays eligible as somebody else's
    sibling.
    """
    if not candidates:
        return None
    ranked = rank_candidates(candidates)

    for c in ranked:
        if not c.base:
            continue
        for i, label in enumerate(labels):
            if i == self_index:
                continue
            if has_confirmed_candidate(label, tokens):
                continue
            if flat_norm(label) == c.base:
                return c

    return next((c for c in ranked if c.confirmed), None)


def classify_error_label_in_labels(
    labels: Sequence[str],
    index: int,
    tokens: Sequence[str] = ERROR_TOKENS,
) -> ClassifiedLabel | None:
    """The context-aware primary: does ``labels[index]`` read as an
    uncertainty column, given the OTHER labels as potential sibling
    evidence? This is what ``error_inference.infer_error_bindings_from_labels``
    calls per channel -- the decision of whether a column IS an error
    column now lives here, not split between a context-free single-string
    classifier and a separate pairing pass.
    """
    label = labels[index]
    if not label or not label.strip():
        return None
    candidates = generate_candidates(label, tokens)
    selected = select_candidate(candidates, labels, index, tokens)
    return _to_result(selected) if selected is not None else None


def classify_error_label(
    label: str, tokens: Sequence[str] = ERROR_TOKENS
) -> ClassifiedLabel | None:
    """Context-free convenience wrapper kept for parity with the TS
    single-string signature (and this module's own unit tests): "if this
    were the only column on the sheet, what would we call it". With no
    siblings to offer evidence, this returns the TOP-RANKED candidate
    overall (confirmed, or provisional if nothing confirmed exists) rather
    than running the strict evidence-gated SELECT above --
    ``classify_error_label("Rerr")`` must still read as ``base="r"`` even
    though ``Rerr``'s only candidate (a glued "err" at the edge, since
    "rerr" is one whole segment, not "err") is provisional and there is no
    sibling "R" in a one-element label list. This laxer fallback is
    deliberately NOT used for pairing-target-exclusion decisions -- those
    always go through the strict, evidence-gated
    ``classify_error_label_in_labels`` instead, or a bare
    "Depth"/"Density"/"Delay" (all zero-candidate, so unaffected either
    way) or a genuinely provisional-only column would round-trip back into
    being misclassified via this wrapper's own top-ranked-regardless
    fallback.
    """
    if not label or not label.strip():
        return None
    candidates = generate_candidates(label, tokens)
    if not candidates:
        return None
    ranked = rank_candidates(candidates)
    return _to_result(ranked[0])
