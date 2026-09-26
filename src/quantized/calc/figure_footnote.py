"""One wrapped footnote line under a publication figure (P2.6).

Pure layer, shared by ``figure_statplots`` and ``figure_categorical``: the
unbalanced-groups notice the Stat Stage shows in its diagnostics area rides
into the export as a footnote, so the caveat mark on a count label is
explained in the figure itself. A single ``fig.text`` line is not enough -- the
notice is ~130 characters and ran off the right edge of every style preset
(measured: ending at x=662-672 px on 339-600 px figures, since ``savefig`` does
not use a tight bbox). It is therefore wrapped to the figure width and the
axes are laid out above it.
"""

from __future__ import annotations

import textwrap
from typing import Any

from matplotlib.font_manager import FontProperties

from quantized.calc.figure_labels import safe_mathtext_label

__all__ = ["place_footnote"]

# Average DejaVu Sans advance is ~0.55 em; 0.62 leaves margin for wide glyphs.
_EM_PER_CHAR = 0.62


def place_footnote(fig: Any, text: str | None) -> tuple[float, float, float, float] | None:
    """Draw ``text`` wrapped along the figure's bottom edge (x-small, grey) and
    return the ``tight_layout`` rect that keeps the axes clear of it, or
    ``None`` (nothing drawn) when there is no footnote. Call inside the
    figure's ``rc_context`` so "x-small" resolves against the style preset."""
    if not text:
        return None
    width_in, height_in = fig.get_size_inches()
    size = float(FontProperties(size="x-small").get_size_in_points())
    chars = max(20, int(width_in * 72 / (size * _EM_PER_CHAR)) - 2)
    lines = textwrap.wrap(safe_mathtext_label(text), width=chars) or [""]
    fig.text(0.01, 0.01, "\n".join(lines), ha="left", va="bottom", fontsize=size, color="0.3")
    bottom = min(0.45, (len(lines) * size * 1.3 + 8) / (height_in * 72))
    return (0.0, bottom, 1.0, 1.0)
