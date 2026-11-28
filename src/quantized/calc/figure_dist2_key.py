"""The corner key of a marginal plot (``calc.figure_dist2``): the cell above the right
strip, which the 3 x 3 grid leaves empty, names what the encodings mean.

Group names (a coloured dot each, the first ``KEY_GROUPS``, then ``+ n more``), the
colour column's range as a gradient bar, and the size column's min / middle / max marks.
What it says is ``calc.statplots_marginal.marginal_geometry(...)["key"]``, which the
canvas key (``Stage/statRenderMarginalKey.ts``) draws from too; the wire fixture
``tests/fixtures/wire/stat_marginal_encoded.json`` pins those entries. Pure layer.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np

from quantized.calc.figure_colorscatter import GRADIENT_STOPS
from quantized.heavy_import import heavy_imports

__all__ = ["draw_corner_key"]

_FONT = 7


def draw_corner_key(
    ax: Any,
    key: dict[str, Any],
    group_colors: Sequence[str],
    *,
    marker_color: str,
) -> None:
    """Fill the (axis-less) corner axes ``ax``: groups top, colour bar middle, sizes bottom."""
    with heavy_imports("matplotlib.colors", "matplotlib.lines"):
        from matplotlib.colors import LinearSegmentedColormap
        from matplotlib.lines import Line2D

    ax.set_axis_off()
    ax.set_gid("marginal-key")
    groups = key.get("groups")
    if groups:
        handles = [
            Line2D([], [], linestyle="none", marker="o", markersize=5, color=group_colors[g])
            for g in groups["ids"]
        ]
        labels = list(groups["labels"])
        if groups["more"]:
            handles.append(Line2D([], [], linestyle="none"))
            labels.append(f"+ {groups['more']} more")
        ax.add_artist(ax.legend(
            handles, labels, loc="upper left", frameon=False, fontsize=_FONT,
            handletextpad=0.2, borderaxespad=0.0, labelspacing=0.2,
        ))
    c = key.get("color")
    if c:
        cax = ax.inset_axes((0.05, 0.6, 0.9, 0.1), gid="marginal-key-colorbar")
        hi = c["hi"] if c["hi"] > c["lo"] else c["lo"] + 1.0
        cax.imshow(
            np.linspace(0.0, 1.0, 64)[None, :], aspect="auto", extent=(c["lo"], hi, 0.0, 1.0),
            cmap=LinearSegmentedColormap.from_list("qz_gradient", list(GRADIENT_STOPS)),
        )
        cax.set_yticks([])
        cax.set_xticks([c["lo"], hi])
        cax.set_xticklabels([f"{c['lo']:.3g}", f"{c['hi']:.3g}"], fontsize=_FONT)
        cax.tick_params(length=2, pad=1)
        if c["label"]:
            cax.set_title(c["label"], fontsize=_FONT, pad=2)
    s = key.get("size")
    if s:
        marks = s["marks"]
        handles = [
            Line2D([], [], linestyle="none", marker="o", markersize=d, color=marker_color)
            for _, d in marks
        ]
        leg = ax.legend(
            handles, [f"{v:.3g}" for v, _ in marks], loc="lower left", frameon=False,
            fontsize=_FONT, ncol=len(marks), title=s["label"] or None, title_fontsize=_FONT,
            handletextpad=0.0, columnspacing=0.3, borderaxespad=0.0, borderpad=0.0,
        )
        ax.add_artist(leg)
