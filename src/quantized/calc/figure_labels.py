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

Screen/export WYSIWYG (bug-hunt fix): the frontend's parser
(``frontend/src/lib/richtext.ts``) only accepts a STRICT SUBSET of
mathtext -- Greek letters, the symbol/relation/arrow commands in
``SUPPORTED_MATHTEXT_COMMANDS`` (``\\AA \\times \\leq \\approx \\infty
\\rightarrow`` ...), ``\\, \\mathrm \\mathit``, and literal Unicode -- and
rejects everything else (e.g. ``\\frac``, ``\\sqrt``, ``\\sum``) as invalid
markup, rendering it
literally on screen. Raw matplotlib accepts a much larger command set, so
without this gate a label like ``$\\frac{1}{2}$`` would render literal text
("Invalid markup") on screen but an actual fraction in the PDF/SVG export --
a WYSIWYG violation. `_uses_only_supported_commands` enumerates the SAME
command set the frontend parser accepts and rejects (falls back to literal)
any ``$...$`` region using a command outside it, BEFORE the matplotlib trial
parse below ever runs. Keep `SUPPORTED_MATHTEXT_COMMANDS` in sync with
richtext.ts's ``GREEK``/``SYMBOLS`` tables + ``mathrm``/``mathit`` handling.

Pure layer: string in -> string out. matplotlib is imported lazily (same
convention as the figure modules -- the heavy import is paid only on export).
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

__all__ = ["safe_mathtext_label", "SUPPORTED_MATHTEXT_COMMANDS"]

# A "$" not preceded by a backslash -- matplotlib's own math-region rule
# (matplotlib.cbook.is_math_text counts these; an odd count means the string
# is rendered as literal text, dollars visible, no mathtext at all).
_UNESCAPED_DOLLAR = re.compile(r"(?<!\\)\$")

# A backslash command name (`\foo`) inside a math region. `\,` (thin space)
# is handled separately by richtext.ts before its name-based dispatch and
# has no letters, so it never matches this and is implicitly always allowed.
_COMMAND = re.compile(r"\\([a-zA-Z]+)")

# Mirrors frontend/src/lib/richtext.ts's `GREEK` table: lowercase (+ \var*
# variants) render italic, uppercase upright -- irrelevant here, we only
# need the NAME set, not the styling.
_GREEK_COMMANDS = frozenset(
    {
        "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta",
        "eta", "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu",
        "xi", "pi", "rho", "sigma", "varsigma", "tau", "upsilon", "phi",
        "varphi", "chi", "psi", "omega",
        "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon",
        "Phi", "Psi", "Omega",
    }
)
# Mirrors richtext.ts's `SYMBOLS` table (non-Greek symbol commands): base
# symbols + relations, analysis/geometry glyphs, and arrows. Each is verified
# to parse in matplotlib mathtext (tools probe), so a label using them renders
# identically on screen (richtext.ts glyph) and in export (mathtext glyph).
_SYMBOL_COMMANDS = frozenset(
    {
        "AA", "circ", "times", "cdot", "pm", "mp", "div", "prime",
        # relations
        "leq", "geq", "neq", "approx", "equiv", "sim", "propto", "ll", "gg",
        # analysis / geometry
        "infty", "partial", "nabla", "perp", "parallel", "angle",
        "cdots", "ldots", "dots",
        # arrows
        "rightarrow", "to", "leftarrow", "leftrightarrow", "Rightarrow",
    }
)
# Mirrors richtext.ts's `\mathrm{...}` / `\mathit{...}` style-group handling.
_STYLE_COMMANDS = frozenset({"mathrm", "mathit"})

SUPPORTED_MATHTEXT_COMMANDS = _GREEK_COMMANDS | _SYMBOL_COMMANDS | _STYLE_COMMANDS


def _uses_only_supported_commands(label: str) -> bool:
    """True when every backslash command inside every ``$...$`` region of
    `label` is in `SUPPORTED_MATHTEXT_COMMANDS`. Text OUTSIDE `$...$` is
    never scanned -- a stray backslash there is the caller's problem, not
    this gate's (and richtext.ts itself only ever considers commands inside
    math regions). Assumes a balanced (even) unescaped-`$` count, as
    guaranteed by `safe_mathtext_label` calling this only after that check.
    """
    segments = _UNESCAPED_DOLLAR.split(label)
    for i, segment in enumerate(segments):
        if i % 2 == 0:
            continue  # literal text outside $...$
        for m in _COMMAND.finditer(segment):
            if m.group(1) not in SUPPORTED_MATHTEXT_COMMANDS:
                return False
    return True


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
    - Balanced ``$...$`` regions using only commands the frontend's
      richtext.ts subset also accepts (`SUPPORTED_MATHTEXT_COMMANDS`), AND
      that trial-parse successfully with matplotlib's mathtext parser ->
      unchanged (mathtext renders it at export, matching the screen).
      Otherwise (an out-of-subset command, e.g. ``\\frac``/``\\sqrt``/
      ``\\sum``, OR a parse failure even within the subset, e.g. unbalanced
      braces) -> every unescaped ``$`` is escaped to ``\\$`` so matplotlib
      renders the literal string (dollars visible) instead of raising at
      savefig time OR silently rendering richer math than the screen ever
      showed.
    """
    if not label or "$" not in label:
        return label
    n_math = len(_UNESCAPED_DOLLAR.findall(label))
    if n_math == 0 or n_math % 2 == 1:
        # Zero unescaped $ (all \$-escaped) or an odd count: matplotlib
        # already renders the whole string as literal text -- leave it be.
        return label
    if not _uses_only_supported_commands(label):
        return _UNESCAPED_DOLLAR.sub(r"\\$", label)
    try:
        _parser().parse(label)
    except Exception:  # ANY parse failure means "render literal", never raise
        return _UNESCAPED_DOLLAR.sub(r"\\$", label)
    return label
