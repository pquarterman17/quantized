"""Font picker route: the families the figure export can actually render.

``GET /api/export/fonts`` lists every family matplotlib finds on this host
plus how each common proprietary family resolves here (Arial -> Liberation
Sans, ...), so the publication font picker offers real choices instead of a
free-text field that silently fell back to DejaVu (publication-figures audit
#7). Thin adapter over ``calc.figure_fonts``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from quantized.calc.figure_fonts import installed_font_families, resolve_font

router = APIRouter(prefix="/api/export", tags=["export"])

# The proprietary names the picker offers even when absent (each is a key of
# calc.figure_fonts.FONT_ALIASES), with the generic family each belongs to.
_PROPRIETARY = (
    ("Arial", "sans-serif"),
    ("Helvetica", "sans-serif"),
    ("Times New Roman", "serif"),
    ("Courier New", "sans-serif"),
    ("Calibri", "sans-serif"),
    ("Cambria", "serif"),
)


@router.get("/fonts")
def list_fonts() -> dict[str, Any]:
    """``families``: installed family names; ``aliases``: each proprietary
    name -> ``{"family", "status"}`` as an export would render it
    (``installed`` / ``substituted`` / ``fallback``)."""
    families = list(installed_font_families())
    aliases = {}
    for name, generic in _PROPRIETARY:
        res = resolve_font(name, generic, families)
        aliases[name] = {"family": res.family, "status": res.status}
    return {"families": families, "aliases": aliases}
