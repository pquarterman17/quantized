"""Figure typography: per-element font sizes and the font-family resolution.

Two export-fidelity findings live here (publication-figures audit, 2026-11):

* **Per-element sizes.** A ``font_size`` override used to move the tick and
  axis labels but leave the title (and legend) at the preset's own size, so a
  12 pt figure came out with an 11 pt title -- smaller than its axis labels.
  :func:`effective_style` scales the preset's title and legend sizes by the
  same factor as the base size, and the ``title_size`` / ``label_size`` /
  ``tick_size`` / ``legend_size`` overrides set each element explicitly.
* **Font fallback.** matplotlib silently substitutes DejaVu for a family that
  is not installed, so "Arial" quietly rendered in DejaVu Sans on a host that
  has its metric-compatible twin Liberation Sans. :func:`resolve_font` maps
  the common proprietary families onto their installed metric-compatible
  substitutes (Arial/Helvetica -> Liberation Sans or Arimo, Times New Roman ->
  Liberation Serif or Tinos, Courier New -> Liberation Mono or Cousine,
  Calibri -> Carlito, Cambria -> Caladea) and notes a render warning when it
  has to substitute or fall back (``calc.figure_warnings``).

``style_rc`` (the rc-param dict a preset + overrides resolve to) moved here
from ``calc.figure`` with this change; ``calc.figure`` re-exports it.

Pure layer: matplotlib's ``font_manager`` only (no fastapi/pydantic).
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, replace
from functools import lru_cache
from typing import Any

from quantized.calc.figure_styles import FigureStyle
from quantized.calc.figure_warnings import note_figure_warning
from quantized.heavy_import import heavy_imports

__all__ = [
    "FONT_ALIASES",
    "FontResolution",
    "SIZE_KEYS",
    "effective_style",
    "font_family_rc",
    "installed_font_families",
    "resolve_font",
    "style_rc",
    "validate_typography",
]

# Metric-compatible substitutes, in preference order. Keys are lower-case.
FONT_ALIASES: Mapping[str, tuple[str, ...]] = {
    "arial": ("Liberation Sans", "Arimo"),
    "helvetica": ("Liberation Sans", "Arimo", "Nimbus Sans", "TeX Gyre Heros"),
    "helvetica neue": ("Liberation Sans", "Arimo", "Nimbus Sans"),
    "times new roman": ("Liberation Serif", "Tinos", "Nimbus Roman", "TeX Gyre Termes"),
    "times": ("Liberation Serif", "Tinos", "Nimbus Roman", "TeX Gyre Termes"),
    "courier new": ("Liberation Mono", "Cousine", "Nimbus Mono PS"),
    "courier": ("Liberation Mono", "Cousine", "Nimbus Mono PS"),
    "calibri": ("Carlito",),
    "cambria": ("Caladea",),
}

# The per-element size override keys (points), plus the base ``font_size``.
SIZE_KEYS = ("font_size", "title_size", "label_size", "tick_size", "legend_size")


@lru_cache(maxsize=1)
def installed_font_families() -> tuple[str, ...]:
    """Every font family matplotlib can render with on this host, sorted
    case-insensitively (the font picker's list)."""
    with heavy_imports("matplotlib.font_manager"):
        import matplotlib.font_manager as font_manager

    names = {f.name for f in font_manager.fontManager.ttflist}
    return tuple(sorted(names, key=str.casefold))


@dataclass(frozen=True, slots=True)
class FontResolution:
    """What a requested family renders as.

    ``status``: ``"installed"`` (the requested family itself),
    ``"substituted"`` (a metric-compatible alias stands in) or
    ``"fallback"`` (nothing usable -- matplotlib's bundled DejaVu)."""

    requested: str
    family: str
    status: str


def resolve_font(
    name: str, generic: str, available: Iterable[str] | None = None
) -> FontResolution:
    """Resolve ``name`` against the installed families (``available``,
    default :func:`installed_font_families`), case-insensitively; ``generic``
    (``"serif"``/``"sans-serif"``) picks the DejaVu fallback."""
    have = {f.casefold(): f for f in (available or installed_font_families())}
    key = name.strip().casefold()
    if key in have:
        return FontResolution(name, have[key], "installed")
    for alias in FONT_ALIASES.get(key, ()):
        if alias.casefold() in have:
            return FontResolution(name, have[alias.casefold()], "substituted")
    fallback = "DejaVu Serif" if generic == "serif" else "DejaVu Sans"
    return FontResolution(name, fallback, "fallback")


def validate_typography(ov: Mapping[str, Any]) -> None:
    """Raise ``ValueError`` on a non-positive / non-finite size override."""
    for key in SIZE_KEYS:
        v = ov.get(key)
        if v is None:
            continue
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v <= 0:
            raise ValueError(f"{key} must be a positive number of points")


def effective_style(st: FigureStyle, ov: Mapping[str, Any]) -> FigureStyle:
    """``st`` with the typography overrides folded in: the base size, the
    title and legend sizes (scaled with the base size unless set explicitly,
    so a larger base never leaves a smaller title) and the font name.
    Idempotent -- applying it twice with the same ``ov`` changes nothing."""
    font_size = float(ov.get("font_size", st.font_size))
    scale = font_size / st.font_size
    return replace(
        st,
        font_size=font_size,
        title_font_size=float(ov.get("title_size", st.title_font_size * scale)),
        legend_font_size=float(ov.get("legend_size", st.legend_font_size * scale)),
        font_name=str(ov.get("font_name", st.font_name)),
    )


def font_family_rc(st: FigureStyle, *, chosen: bool = False) -> dict[str, Any]:
    """The ``font.family`` rc pair for ``st``'s font: the family resolved
    through :func:`resolve_font` (an absent proprietary family becomes its
    installed metric-compatible twin) with a generic DejaVu fallback behind
    it. A fallback is always noted as a render warning; a substitution only
    when the user ``chosen`` the font (a preset's Helvetica -> Liberation Sans
    is the expected rendering, not news). Shared by EVERY figure renderer, so
    no export path silently falls back to DejaVu any more."""
    generic = st.font_generic
    fallback = "DejaVu Serif" if generic == "serif" else "DejaVu Sans"
    font = resolve_font(st.font_name, generic)
    if font.status == "fallback":
        note_figure_warning(
            f"Font '{font.requested}' is not installed and has no installed "
            f"substitute; text renders in {font.family}."
        )
    elif font.status == "substituted" and chosen:
        note_figure_warning(
            f"Font '{font.requested}' is not installed; using the "
            f"metric-compatible {font.family} instead."
        )
    return {"font.family": generic, f"font.{generic}": [font.family, fallback]}


def style_rc(st: FigureStyle, ov: Mapping[str, Any]) -> dict[str, Any]:
    """The rc-param dict a preset (+ optional font/tick overrides) resolves to.

    Scoped to one render via ``figure_render.render_scope`` by the callers (the
    single-figure renderer in ``calc.figure`` and the page composer in
    ``figure_page``). The named font is resolved through :func:`resolve_font`
    (an absent proprietary family becomes its installed metric-compatible
    twin) and keeps a generic DejaVu fallback behind it; a substitution the
    user asked for, or any fallback, is noted as a render warning.
    """
    eff = effective_style(st, ov)
    tick_dir = str(ov.get("ticks", {}).get("dir", st.tick_dir))
    tick_size = float(ov.get("tick_size", eff.font_size))
    rc: dict[str, Any] = {
        **font_family_rc(eff, chosen="font_name" in ov),
        "font.size": eff.font_size,
        "axes.labelsize": float(ov.get("label_size", eff.font_size)),
        "axes.titlesize": eff.title_font_size,
        "xtick.labelsize": tick_size,
        "ytick.labelsize": tick_size,
        "legend.fontsize": eff.legend_font_size,
        "xtick.direction": tick_dir,
        "ytick.direction": tick_dir,
        # Mirror ticks onto the top/right spines whenever the box is drawn
        # (the journal "closed box, inward ticks on all four sides" look) --
        # matplotlib's own default leaves top/right bare even with the full
        # rectangular border, which reads as an unfinished box.
        "xtick.top": st.box_on,
        "ytick.right": st.box_on,
    }
    tick_len = ov.get("ticks", {}).get("len")
    if tick_len is not None:
        rc["xtick.major.size"] = float(tick_len)
        rc["ytick.major.size"] = float(tick_len)
    return rc
