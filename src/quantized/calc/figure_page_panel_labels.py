"""Journal-style panel label rendering for the figure page composer
(GOTO #4), split out of ``calc.figure_page`` (2026-08-07 headroom
restoration after F3.5): the auto-label generator and the on-axes label
placement have no dependency on ``PagePanel``/matplotlib figure
construction at all, so they were the cleanest self-contained unit to
extract. Never touched by F3.6 (export from PageDocument) -- that item
wires WHERE a panel's data comes from, not how its label is lettered or
drawn.

``panel_label`` computes the auto sequence ("(a)", "(b)", ... with
spreadsheet-style rollover past "z"); ``_place_label`` draws one resolved
label string onto its axes at nw/ne/outside. Names keep their original
leading-underscore convention (cross-module private helpers) matching
``figure_overrides.py``'s ``_validate_overrides``/``_apply_overrides``.
"""

from __future__ import annotations

from typing import Any

from quantized.calc.figure_styles import FigureStyle

__all__ = ["_LABEL_TEMPLATES", "_place_label", "panel_label"]

# Auto-label formats, keyed by the rendered form of the FIRST panel:
# (wrap template, uppercase letters?). "none" suppresses auto labels entirely.
_LABEL_TEMPLATES: dict[str, tuple[str, bool]] = {
    "(a)": ("({})", False),
    "a)": ("{})", False),
    "a.": ("{}.", False),
    "(A)": ("({})", True),
    "A)": ("{})", True),
    "A.": ("{}.", True),
}


def _letters(index: int) -> str:
    """0 -> "a", 25 -> "z", 26 -> "aa", ... (spreadsheet-style rollover)."""
    out = ""
    n = index
    while True:
        out = chr(ord("a") + n % 26) + out
        n = n // 26 - 1
        if n < 0:
            return out


def panel_label(index: int, label_format: str = "(a)") -> str:
    """The auto-generated label for the ``index``-th panel (0-based, row-major
    placement order): ``panel_label(1, "(a)") == "(b)"``. ``"none"`` returns
    an empty string (no labels). Raises ``ValueError`` on an unknown format
    or a negative index."""
    if index < 0:
        raise ValueError("panel index must be >= 0")
    if label_format == "none":
        return ""
    try:
        template, upper = _LABEL_TEMPLATES[label_format]
    except KeyError as exc:
        allowed = (*_LABEL_TEMPLATES, "none")
        raise ValueError(f"label_format must be one of {allowed}") from exc
    letters = _letters(index)
    return template.format(letters.upper() if upper else letters)


def _place_label(ax: Any, text: str, pos: str, st: FigureStyle) -> None:
    """Draw one panel label. ``nw``/``ne`` sit inside the axes at the top
    corner; ``outside`` uses matplotlib's LEFT title slot above the axes,
    which coexists with the panel's own (center) title -- the standard
    journal placement."""
    if not text:
        return
    size = float(st.title_font_size)
    if pos == "outside":
        ax.set_title(text, loc="left", fontweight="bold", fontsize=size)
    elif pos == "ne":
        ax.text(
            0.97, 0.96, text, transform=ax.transAxes,
            ha="right", va="top", fontweight="bold", fontsize=size,
        )
    else:  # "nw"
        ax.text(
            0.03, 0.96, text, transform=ax.transAxes,
            ha="left", va="top", fontweight="bold", fontsize=size,
        )
