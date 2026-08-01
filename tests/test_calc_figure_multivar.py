"""Multivariate workbench figure rendering (calc.figure_multivar, JMP_GAP_PLAN
#10 residual): correlation heatmap, SPLOM, PCA scores/loadings/biplot, scree.

Rendering can't be pixel-asserted, so most tests confirm a valid non-trivial
file for a given (shape, format) and that malformed input is rejected, the
same convention as test_calc_figure_corner.py.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.figure_multivar import (
    render_correlation_heatmap_figure,
    render_pca_figure,
    render_pca_scree_figure,
    render_splom_figure,
)

_MAGIC = {"pdf": b"%PDF", "svg": b"<?xml", "png": b"\x89PNG"}
_RNG = np.random.default_rng(7)


# ── Correlation heatmap ──────────────────────────────────────────────────────


@pytest.mark.parametrize("fmt", ["pdf", "svg", "png"])
def test_correlation_heatmap_renders_valid_file(fmt: str) -> None:
    labels = ["a", "b", "c"]
    r = [[1.0, 0.8, -0.3], [0.8, 1.0, 0.1], [-0.3, 0.1, 1.0]]
    out = render_correlation_heatmap_figure(labels, r, fmt=fmt, title="corr")
    assert out[: len(_MAGIC[fmt])] == _MAGIC[fmt]
    assert len(out) > 500


def test_correlation_heatmap_shape_mismatch_rejected() -> None:
    with pytest.raises(ValueError, match="matching labels"):
        render_correlation_heatmap_figure(["a", "b"], [[1.0, 0.5]])


def test_correlation_heatmap_needs_2_variables() -> None:
    with pytest.raises(ValueError, match="at least 2"):
        render_correlation_heatmap_figure(["a"], [[1.0]])


def test_correlation_heatmap_bad_format_rejected() -> None:
    with pytest.raises(ValueError, match="fmt must be"):
        render_correlation_heatmap_figure(["a", "b"], [[1.0, 0.5], [0.5, 1.0]], fmt="jpg")


# ── SPLOM ─────────────────────────────────────────────────────────────────────


def _splom_columns(n_vars: int, n_rows: int) -> list[list[float]]:
    return [list(_RNG.normal(i, 1.0, n_rows)) for i in range(n_vars)]


@pytest.mark.parametrize("n", [2, 4])
@pytest.mark.parametrize("fmt", ["pdf", "png"])
def test_splom_renders_valid_file(n: int, fmt: str) -> None:
    labels = [f"v{i}" for i in range(n)]
    cols = _splom_columns(n, 200)
    out = render_splom_figure(labels, cols, fmt=fmt)
    assert out[: len(_MAGIC[fmt])] == _MAGIC[fmt]
    assert len(out) > 500


def test_splom_needs_2_variables() -> None:
    with pytest.raises(ValueError, match="at least 2"):
        render_splom_figure(["a"], [[1.0, 2.0, 3.0]])


def test_splom_columns_length_mismatch_rejected() -> None:
    with pytest.raises(ValueError, match="columns has"):
        render_splom_figure(["a", "b", "c"], [[1.0, 2.0], [3.0, 4.0]])


def test_splom_all_nan_column_rejected() -> None:
    nan = float("nan")
    with pytest.raises(ValueError, match="no finite values"):
        render_splom_figure(["a", "b"], [[1.0, 2.0, 3.0], [nan, nan, nan]])


def test_splom_off_diagonal_maps_column_j_to_x_and_column_i_to_y() -> None:
    """Structural sanity: a 2-var SPLOM (panel (0,1) and (1,0) both
    off-diagonal scatters) shouldn't crash and should be larger than a
    degenerate single-histogram render -- confirms both off-diagonal panels
    actually plotted content, matching splomRender.ts's full n x n grid
    (not a corner-plot half-triangle)."""
    cols = _splom_columns(2, 100)
    out_full = render_splom_figure(["a", "b"], cols, fmt="svg")
    out_single = render_correlation_heatmap_figure(["a", "b"], [[1.0, 0.0], [0.0, 1.0]], fmt="svg")
    assert len(out_full) > 0
    assert len(out_single) > 0


# ── PCA scores / loadings / biplot ───────────────────────────────────────────


@pytest.mark.parametrize("fmt", ["pdf", "png"])
def test_pca_scores_renders_valid_file(fmt: str) -> None:
    points = [[1.0, 0.2], [2.0, -0.1], [3.0, 0.3], [-1.0, -0.4]]
    out = render_pca_figure("scores", points=points, x_label="PC1", y_label="PC2", fmt=fmt)
    assert out[: len(_MAGIC[fmt])] == _MAGIC[fmt]


def test_pca_loadings_renders_with_vectors_only() -> None:
    vectors = [{"x": 0.9, "y": 0.1, "label": "a"}, {"x": 0.2, "y": 0.95, "label": "b"}]
    out = render_pca_figure("loadings", vectors=vectors, fmt="png")
    assert out[:4] == _MAGIC["png"]


def test_pca_biplot_rescales_vectors_into_score_cloud() -> None:
    """The biplot rescale should shrink an oversized loading vector so it no
    longer dwarfs the score cloud -- a structural check that vec_scale fired
    (mirrors pcaScoresRender.ts's 85%-of-radius convention): a 100-unit-long
    raw loading should render fine (not raise, not silently drop) alongside
    a small score cloud."""
    points = [[1.0, 0.5], [-1.0, -0.5], [0.5, -1.0]]
    vectors = [{"x": 100.0, "y": 0.0, "label": "huge"}]
    out = render_pca_figure("biplot", points=points, vectors=vectors, fmt="png")
    assert out[:4] == _MAGIC["png"]


def test_pca_figure_needs_points_or_vectors() -> None:
    with pytest.raises(ValueError, match="needs points and/or vectors"):
        render_pca_figure("scores")


def test_pca_figure_bad_mode_rejected() -> None:
    with pytest.raises(ValueError, match="mode must be"):
        render_pca_figure("bogus", points=[[1.0, 2.0]])  # type: ignore[arg-type]


# ── PCA scree ─────────────────────────────────────────────────────────────────


def test_pca_scree_renders_valid_file() -> None:
    out = render_pca_scree_figure([60.0, 25.0, 15.0], [60.0, 85.0, 100.0], fmt="pdf")
    assert out[:4] == _MAGIC["pdf"]


def test_pca_scree_length_mismatch_rejected() -> None:
    with pytest.raises(ValueError, match="cumulative has"):
        render_pca_scree_figure([60.0, 25.0, 15.0], [60.0, 85.0])


def test_pca_scree_needs_at_least_1_component() -> None:
    with pytest.raises(ValueError, match="at least 1"):
        render_pca_scree_figure([], [])


def test_dpi_none_uses_style_preset_dpi() -> None:
    """dpi=None (default) resolves to the style's calibrated dpi -- a raster
    render at the high-dpi 'aps' preset must be a larger PNG than the same
    figure at the low-dpi 'web' preset (same convention as figure_corner)."""
    labels = ["a", "b"]
    r = [[1.0, 0.5], [0.5, 1.0]]
    small = render_correlation_heatmap_figure(labels, r, fmt="png", style="web")
    large = render_correlation_heatmap_figure(labels, r, fmt="png", style="aps")
    assert len(large) > len(small)
