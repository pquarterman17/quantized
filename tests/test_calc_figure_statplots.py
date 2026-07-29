"""Statistical-plot publication rendering (calc.figure_statplots).

Rendering can't be pixel-asserted, so the tests confirm each kind/format
produces a valid non-trivial file and that malformed input is rejected. The
statistics themselves are golden in test_calc_statplots (matplotlib's boxplot/
violinplot use the same algorithms).
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.figure_statplots import STATPLOT_KINDS, render_statplot_figure

_MAGIC = {"pdf": b"%PDF", "svg": b"<?xml", "png": b"\x89PNG"}
_RNG = np.random.default_rng(7)
_GROUPS = [list(_RNG.normal(m, 1.0, 40)) for m in (0.0, 1.0, 2.0)]
_SAMPLE = list(_RNG.normal(5.0, 2.0, 200))


@pytest.mark.parametrize("kind", STATPLOT_KINDS)
@pytest.mark.parametrize("fmt", ["png", "pdf", "svg"])
def test_every_kind_and_format_renders(kind: str, fmt: str) -> None:
    data = _GROUPS if kind in ("box", "violin", "strip") else _SAMPLE
    kw = {"fit": "norm"} if kind == "histogram" else {}
    out = render_statplot_figure(kind, data, fmt=fmt, labels=["A", "B", "C"],
                                 title=kind, y_label="value", **kw)
    assert out[: len(_MAGIC[fmt])] == _MAGIC[fmt]
    assert len(out) > 800


def test_histogram_without_fit() -> None:
    out = render_statplot_figure("histogram", _SAMPLE, bins="sturges", fmt="png")
    assert out[:4] == _MAGIC["png"]


def test_bad_kind_and_format() -> None:
    with pytest.raises(ValueError, match="kind must be"):
        render_statplot_figure("swarm", _SAMPLE)
    with pytest.raises(ValueError, match="fmt must be"):
        render_statplot_figure("histogram", _SAMPLE, fmt="jpg")


def test_grouped_requires_list_of_groups() -> None:
    with pytest.raises(ValueError, match="non-empty list of groups"):
        render_statplot_figure("box", [])


def test_group_with_no_finite_values_rejected() -> None:
    with pytest.raises(ValueError, match="finite value"):
        render_statplot_figure("violin", [[1.0, 2.0], [np.nan, np.inf]])


# ── dpi preset resolution + mirrored box ticks (GAP_TIER3 item 2 follow-up) ─


def test_dpi_none_uses_style_preset_dpi() -> None:
    # dpi=None (the default) resolves to the style's calibrated dpi -- a
    # raster render at the high-dpi 'aps' preset must be a larger PNG than
    # the same plot at the low-dpi 'web' preset (mirrors test_calc_figure.py's
    # dpi-scales-raster-output pattern and the corner/ternary/field siblings).
    small = render_statplot_figure("histogram", _SAMPLE, fmt="png", style="web", dpi=None)
    large = render_statplot_figure("histogram", _SAMPLE, fmt="png", style="aps", dpi=None)
    assert len(large) > len(small)


def test_dpi_explicit_overrides_preset() -> None:
    at_100 = render_statplot_figure("histogram", _SAMPLE, fmt="png", dpi=100)
    at_300 = render_statplot_figure("histogram", _SAMPLE, fmt="png", dpi=300)
    assert len(at_300) > len(at_100)


# ── JMP_GAP J5: box/strip mark completion (points + mean+-CI) ──────────────

_ROW_INDICES = [list(range(len(g))) for g in _GROUPS]


def test_box_with_points_and_mean_ci_renders() -> None:
    out = render_statplot_figure(
        "box", _GROUPS, fmt="png", labels=["A", "B", "C"],
        show_points=True, point_row_indices=_ROW_INDICES, show_mean_ci=True,
    )
    assert out[:4] == _MAGIC["png"]
    assert len(out) > 800


def test_strip_mode_renders_points_only() -> None:
    out = render_statplot_figure(
        "strip", _GROUPS, fmt="svg", labels=["A", "B", "C"],
        show_points=True, point_row_indices=_ROW_INDICES,
    )
    assert out[: len(_MAGIC["svg"])] == _MAGIC["svg"]


def test_strip_with_mean_ci_renders() -> None:
    out = render_statplot_figure(
        "strip", _GROUPS, fmt="png", labels=["A", "B", "C"], show_mean_ci=True,
    )
    assert out[:4] == _MAGIC["png"]


def test_show_points_without_row_indices_falls_back_sequentially() -> None:
    # No point_row_indices at all -- degrades to a plain 0..n-1 sequence per
    # group rather than crashing (the "best-effort jitter identity" contract).
    out = render_statplot_figure("box", _GROUPS, fmt="png", show_points=True)
    assert out[:4] == _MAGIC["png"]


def test_show_points_with_mismatched_row_indices_falls_back_sequentially() -> None:
    bad = [[0, 1], [0], [0, 1, 2, 3]]  # wrong lengths for _GROUPS
    out = render_statplot_figure(
        "box", _GROUPS, fmt="png", show_points=True, point_row_indices=bad,
    )
    assert out[:4] == _MAGIC["png"]


def test_point_row_indices_align_after_dropping_non_finite_values() -> None:
    data = [[1.0, np.nan, 3.0, 4.0], [5.0, 6.0]]
    row_idx = [[10, 11, 12, 13], [20, 21]]
    # Must not raise, and must not silently misalign the surviving indices
    # with the finite values (deterministic_jitter would otherwise scatter
    # against the WRONG row -- see calc.statplots.deterministic_jitter).
    out = render_statplot_figure(
        "box", data, fmt="png", show_points=True, point_row_indices=row_idx,
    )
    assert out[:4] == _MAGIC["png"]
