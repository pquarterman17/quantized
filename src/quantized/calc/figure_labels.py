"""Mathtext label guard for figure export (GOTO #5 rich-text labels).

Labels flow from the UI as plain text with optional ``$...$`` mathtext
regions (the frontend's ``lib/richtext`` micro-syntax is a strict subset of
matplotlib mathtext, so passthrough is the rendering mechanism). matplotlib
parses math regions at DRAW time, which means an invalid label would raise
inside ``fig.savefig`` and turn an export into a 500. This module is the
shared chokepoint every ``calc.figure*`` renderer routes its user-supplied
strings through: it pre-validates with matplotlib's own mathtext parser and,
on failure, escapes the dollar signs so the label renders as literal text
(matplotlib renders ``\\$`` as a plain ``$``) -- an invalid label must NEVER
error an export.

Pure layer: string in -> string out. matplotlib is imported lazily (same
convention as the figure modules -- the heavy import is paid only on export).
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

__all__ = ["safe_mathtext_label"]

# A "$" not preceded by a backslash -- matplotlib's own math-region rule
# (matplotlib.cbook.is_math_text counts these; an odd count means the string
# is rendered as literal text, dollars visible, no mathtext at all).
_UNESCAPED_DOLLAR = re.compile(r"(?<!\\)\$")


@lru_cache(maxsize=1)
def _parser() -> Any:
    """The mathtext trial parser (cached -- construction is not free)."""
    from matplotlib.mathtext import MathTextParser

    return MathTextParser("agg")


def safe_mathtext_label(label: str) -> str:
    """Return ``label`` unchanged when it renders safely; else de-math it.

    - No ``$`` at all: fast path, returned as-is (byte-identical to today).
    - Odd count of unescaped ``$``: matplotlib already treats the whole
      string as literal text -- returned as-is.
    - Balanced ``$...$`` regions: trial-parsed with matplotlib's mathtext
      parser. Valid -> unchanged (mathtext renders it at export). Invalid ->
      every unescaped ``$`` is escaped to ``\\$`` so matplotlib renders the
      literal string (dollars visible) instead of raising at savefig time.
    """
    if not label or "$" not in label:
        return label
    n_math = len(_UNESCAPED_DOLLAR.findall(label))
    if n_math == 0 or n_math % 2 == 1:
        # Zero unescaped $ (all \$-escaped) or an odd count: matplotlib
        # already renders the whole string as literal text -- leave it be.
        return label
    try:
        _parser().parse(label)
    except Exception:  # ANY parse failure means "render literal", never raise
        return _UNESCAPED_DOLLAR.sub(r"\\$", label)
    return label
