"""Error-label candidate generation — Python port of
``frontend/src/lib/errorLabelCandidates.ts`` (P16, plans/archive/
ERROR_LABEL_CLASSIFIER_PLAN.md).

Seven review rounds on the TypeScript classifier this ports each fixed one
bug and introduced another in the same family, because that classifier
MUTATED one interpretation across sequential phases and could not undo a
wrong commitment (``Phase_err`` -> confirmed base "phase" -> a later phase
re-peels "phase" itself and overwrites the correct answer with "pha").

The fix, ported verbatim here: this module only GENERATES candidates. It
never decides which one wins — nothing here mutates, nothing here commits.
Ranking (``error_label_classify.rank_candidates``) and selection
(``select_candidate`` / ``classify_error_label_in_labels``) are separate and
pure over the candidate list, so a new spelling added here cannot perturb
any existing spelling's result — the interaction surface that produced the
regressions is gone.

Kept a faithful, line-by-line port (not a "cleaner" reimplementation) on
purpose: the TypeScript and Python must classify every label identically —
see ``tests/fixtures/error_labels/parity_corpus.json`` and
``tests/test_error_inference_parity_fixture.py``, which pin the two
together. THIS FILE MUST NOT DIVERGE FROM ``errorLabelCandidates.ts``
without updating that TS file too.

Pure ``io`` layer — no fastapi/pydantic imports.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

__all__ = [
    "CONFIRMED_QUANTITY_PREFIXES",
    "ERROR_TOKENS",
    "Candidate",
    "ErrorSide",
    "flat_norm",
    "generate_candidates",
    "has_confirmed_candidate",
    "segments_of",
]

#: Which side of an asymmetric pair a column supplies.
ErrorSide = Literal["both", "+", "-"]


@dataclass(frozen=True)
class Candidate:
    """One plausible error-column reading of a label.

    ``token``: which token matched.
    ``base``: normalized remainder (lowercase, separators stripped); ``""``
        only where the whole label IS the token, or where a rule defines it
        that way (the x/y axis-prefix rule).
    ``confirmed``: True = the token sat on real segment boundaries (whole
        segment(s), or an axis/quantity prefix). False = the token was found
        glued inside an edge segment — plausible, but needs sibling evidence
        to confirm.
    """

    token: str
    base: str
    side: ErrorSide
    axis: Literal["x", "y"] | None
    confirmed: bool


# Suffixes that mark an asymmetric half, checked before token matching so
# "err+" is not first read with "+" as part of the base.
_PLUS = ["+", "up", "hi", "high", "upper"]
_MINUS = ["-", "dn", "down", "lo", "low", "lower"]

# The token table. New spellings are added HERE ONLY -- ranking and
# selection (error_label_classify.py) are independent of this list, so
# adding a token cannot perturb an existing token's result.
ERROR_TOKENS: tuple[str, ...] = (
    "stderr", "sigma", "error", "err", "unc", "sdev", "std", "sd", "se",
)

# A single-letter quantity prefix allowed to glue directly onto a token and
# still count as CONFIRMED ("Ierr" -> base "i").
#
# There is no label-intrinsic signal separating "Ierr" from "Kerr": both are
# one segment, single-letter base, glued "err". This is a deliberate DOMAIN
# special case (XRD intensity-error columns), not a general rule -- "k"/
# "Kerr" is the named, deliberate exclusion. "Kerr" binds only when a
# literal sibling "K" column exists (the ordinary evidence rule), exactly
# like "Ierr" does when no "I" sibling exists but positional pairing takes
# over instead. Do not extend this list casually; every entry is a standing
# exception to "no label-intrinsic signal decides this".
CONFIRMED_QUANTITY_PREFIXES: tuple[str, ...] = ("i",)

_CAMEL_SPLIT_RE = re.compile(r"(?=[A-Z])")
_DIGIT_SPLIT_RE = re.compile(r"(?<=[a-zA-Z])(?=[0-9])")
_WORD_SPLIT_RE = re.compile(r"[\s_]+")


def _norm_seg(s: str) -> str:
    return s.strip().lower()


def segments_of(label: str) -> list[str]:
    """Split a label into ordered, lowercase segments. Concatenating every
    segment reproduces the fully-normalized (lowercase, whitespace/
    underscore stripped) flat label exactly -- segmentation only inserts
    cut points, it never drops or reorders characters. Splits on
    whitespace/underscore first (``M_std_err`` -> ``M``, ``std``, ``err``),
    then on camelCase boundaries within each resulting word (``MStdErr`` ->
    ``M``, ``Std``, ``Err``), then on a letter-to-digit boundary
    (``err1`` -> ``err``, ``1``; a trailing instrument channel index must
    not hide "err" sitting on an otherwise-whole segment boundary) -- but
    never a digit-to-letter boundary, so ``2theta`` stays one piece. So
    both spellings of the same intent segment identically.
    """
    words = [w for w in _WORD_SPLIT_RE.split(label.strip()) if w]
    out: list[str] = []
    for word in words:
        camel = [p for p in _CAMEL_SPLIT_RE.split(word) if p]
        for piece in camel:
            digit_split = [p for p in _DIGIT_SPLIT_RE.split(piece) if p]
            for sub in digit_split:
                out.append(_norm_seg(sub))
    return out


def _flatten(segments: Sequence[str]) -> str:
    return "".join(segments)


@dataclass
class _SideStrip:
    segments: list[str]
    flat: str
    side: ErrorSide


def _peel_side(segments: Sequence[str], flat: str) -> _SideStrip:
    """Peel an asymmetric-side suffix, if present. Tries a whole trailing
    segment first (``err_upper`` -> segments ``err``, ``upper``), then a
    glued suffix on the flat string (``errlow`` -> "low", ``err+`` -> "+")
    -- the glued fallback can't preserve segmentation, so its remainder
    becomes a single re-synthesized segment for the rules below.
    """
    if len(segments) > 1:
        last = segments[-1]
        if last in _PLUS:
            rest = list(segments[:-1])
            return _SideStrip(rest, _flatten(rest), "+")
        if last in _MINUS:
            rest = list(segments[:-1])
            return _SideStrip(rest, _flatten(rest), "-")
    for suf in _PLUS:
        if flat.endswith(suf) and len(flat) > len(suf):
            glued_rest = flat[: -len(suf)]
            return _SideStrip([glued_rest], glued_rest, "+")
    for suf in _MINUS:
        if flat.endswith(suf) and len(flat) > len(suf):
            glued_rest = flat[: -len(suf)]
            return _SideStrip([glued_rest], glued_rest, "-")
    return _SideStrip(list(segments), flat, "both")


def generate_candidates(
    label: str, tokens: Sequence[str] = ERROR_TOKENS
) -> list[Candidate]:
    """Generate every plausible error-column reading of ``label``, unranked
    and uncommitted. ``tokens`` is injectable (defaults to the real table)
    purely so tests can prove the ranking/selection layer is independent of
    the token list -- production callers should never pass it. Recomputed
    on every call (never cached at import time): the derived "may glue" set
    below depends on ``tokens``, and caching it against the DEFAULT table
    would make an injected token silently skip the 2-character restriction.
    """
    raw_segments = segments_of(label)
    if not raw_segments:
        return []
    raw_flat = _flatten(raw_segments)

    strip = _peel_side(raw_segments, raw_flat)
    segments, flat, side = strip.segments, strip.flat, strip.side
    if not flat:
        return []

    # Tokens allowed to match GLUED (substring at an edge, not aligned to a
    # segment boundary) -- 2-character tokens ("sd", "se") may only match a
    # WHOLE segment, never glued, or "Set" yields a glued base "t" and binds
    # against a single-letter column.
    glueable = [t for t in tokens if len(t) >= 3]

    candidates: list[Candidate] = []
    n = len(segments)

    # Rule: a run of one or more consecutive WHOLE segments, trailing or
    # leading, joins to a token. k===1 is "a whole segment equals a token";
    # k>1 is the multi-segment run ("M_std_err"'s "std"+"err" -> "stderr").
    # Every matching run length gets its own candidate -- ranking, not
    # generation, picks between them.
    for k in range(1, n + 1):
        trailing_joined = _flatten(segments[n - k :])
        if trailing_joined in tokens:
            candidates.append(
                Candidate(
                    token=trailing_joined,
                    base=_flatten(segments[: n - k]),
                    side=side,
                    axis=None,
                    confirmed=True,
                )
            )
        if k < n:
            leading_joined = _flatten(segments[:k])
            if leading_joined in tokens:
                candidates.append(
                    Candidate(
                        token=leading_joined,
                        base=_flatten(segments[k:]),
                        side=side,
                        axis=None,
                        confirmed=True,
                    )
                )

    # Rule: a token glued inside an edge segment (provisional -- needs
    # sibling evidence to confirm). A candidate with an empty base is valid
    # ONLY where the whole label IS the token (covered by the run rule
    # above with k===n), so glued matches require a non-empty remainder.
    for t in glueable:
        if len(flat) <= len(t):
            continue
        if flat.endswith(t):
            candidates.append(
                Candidate(token=t, base=flat[: -len(t)], side=side, axis=None, confirmed=False)
            )
        if flat.startswith(t):
            candidates.append(
                Candidate(token=t, base=flat[len(t) :], side=side, axis=None, confirmed=False)
            )

    # Rule: a confirmed peel composed with a glued peel of what remains
    # (provisional) -- "MStdErr"'s "err" peels confirmed to base "mstd",
    # and "mstd" itself ends with the token "std", so a further glued peel
    # to base "m" is a SEPARATE candidate, not a mutation of the first.
    for c in list(candidates):
        if not c.confirmed or not c.base:
            continue
        for t in glueable:
            if len(c.base) <= len(t):
                continue
            if c.base.endswith(t):
                candidates.append(
                    Candidate(
                        token=t, base=c.base[: -len(t)], side=side, axis=None, confirmed=False
                    )
                )
            if c.base.startswith(t):
                candidates.append(
                    Candidate(
                        token=t, base=c.base[len(t) :], side=side, axis=None, confirmed=False
                    )
                )

    # Rule: the bare leading "d" delta convention (dR, dQ, dSA, dR2) --
    # CONFIRMED, but ONLY when "d" is its own genuine leading SEGMENT (a
    # capital letter, digit, space, or underscore immediately follows it in
    # the ORIGINAL label, forcing a real segment boundary there). This is
    # what tells "dR" apart from "Depth"/"Dose"/"Density"/"Delay": all five
    # are "d" + more letters, but only "dR" has a genuine boundary right
    # after the "d" -- "Depth" never splits into a "d" segment at all
    # (segments_of("Depth") is one whole segment, "depth"), so the rule
    # never fires for it. A false positive here would silently turn a real
    # measurement into whiskers, which is exactly what over-matching bare
    # "Depth"/"Dose" as this convention used to do.
    if len(segments) > 1 and segments[0] == "d":
        candidates.append(
            Candidate(token="d", base=_flatten(segments[1:]), side=side, axis=None, confirmed=True)
        )

    # Rule: an explicit x/y axis prefix (confirmed) -- "xerr"/"yerr" say
    # which axis outright; the base is empty by definition of this rule.
    if len(flat) > 1 and flat[0] in ("x", "y"):
        rest = flat[1:]
        if rest in tokens:
            axis: Literal["x", "y"] = "x" if flat[0] == "x" else "y"
            candidates.append(
                Candidate(token=rest, base="", side=side, axis=axis, confirmed=True)
            )

    # Rule: a single-letter quantity prefix from CONFIRMED_QUANTITY_PREFIXES,
    # glued to a token (confirmed, base KEPT -- this is what makes "Ierr"
    # reach positional pairing without inventing a fake "I" sibling match).
    if len(flat) > 1:
        prefix = flat[0]
        if prefix in CONFIRMED_QUANTITY_PREFIXES:
            rest = flat[1:]
            if rest in tokens:
                candidates.append(
                    Candidate(token=rest, base=prefix, side=side, axis=None, confirmed=True)
                )

    return candidates


def has_confirmed_candidate(label: str, tokens: Sequence[str] = ERROR_TOKENS) -> bool:
    """Context-free: does ``label`` look even slightly like an error column
    on its own, with no sibling evidence? Used only to decide whether a
    LABEL is eligible to serve as somebody else's sibling-evidence target --
    a label with its own CONFIRMED reading is disqualified from being
    "ordinary data" for that purpose. Deliberately narrower than "has any
    candidate at all": a label whose only reading is PROVISIONAL (a glued
    substring match, not aligned to a real segment boundary) still counts
    as ordinary data and stays eligible -- only a confirmed self-reading is
    strong enough evidence to disqualify a column from being someone else's
    target.
    """
    return any(c.confirmed for c in generate_candidates(label, tokens))


def flat_norm(label: str) -> str:
    """The fully-normalized (lowercase, whitespace/underscore stripped)
    flat form of a label -- what a candidate's ``base`` is compared against
    when looking for a sibling column by name.
    """
    return _flatten(segments_of(label))
