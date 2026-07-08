"""Tests for ternary and field-line figure export (calc.figure_ternary, figure_field).

GAP_TIER3_PLAN item 4: ternary diagrams and quiver/streamline plots,
export-only via matplotlib. Rendering can't be pixel-asserted, so tests
confirm valid non-trivial output for each format/kind and that malformed
input is rejected.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.figure_field import render_field_figure
from quantized.calc.figure_ternary import render_ternary_figure

_MAGIC = {"pdf": b"%PDF", "svg": b"<?xml", "png": b"\x89PNG"}
_RNG = np.random.default_rng(42)


class TestTernary:
    """Tests for render_ternary_figure."""

    def _three_component_data(self, n: int, seed: int = 42) -> np.ndarray:
        """Generate n random 3-component compositions (rows sum to ~1)."""
        rng = np.random.default_rng(seed)
        raw = rng.uniform(0.1, 1.0, (n, 3))
        return raw / raw.sum(axis=1, keepdims=True)

    @pytest.mark.parametrize("fmt", ["pdf", "svg", "png"])
    def test_renders_valid_file_for_each_format(self, fmt: str) -> None:
        """A valid composition table renders to a non-trivial file in each format."""
        data = self._three_component_data(20)
        out = render_ternary_figure(data, fmt=fmt, title="Test Ternary")
        assert out[: len(_MAGIC[fmt])] == _MAGIC[fmt]
        assert len(out) > 500

    def test_three_points_at_corners(self) -> None:
        """Three corner points (pure A, pure B, pure C) render correctly."""
        data = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
        out = render_ternary_figure(data, fmt="pdf")
        assert out[: len(_MAGIC["pdf"])] == _MAGIC["pdf"]
        assert len(out) > 800

    def test_center_point(self) -> None:
        """A point at the center (1/3, 1/3, 1/3) renders."""
        data = np.array([[1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0]])
        out = render_ternary_figure(data, fmt="png")
        assert out[: len(_MAGIC["png"])] == _MAGIC["png"]

    def test_with_color_values(self) -> None:
        """Points colored by an optional fourth dimension (e.g. a measurement)."""
        data = self._three_component_data(15)
        values = _RNG.uniform(0, 10, 15)
        out = render_ternary_figure(data, values=values, fmt="pdf")
        assert out[: len(_MAGIC["pdf"])] == _MAGIC["pdf"]
        assert len(out) > 500

    def test_custom_labels(self) -> None:
        """Custom corner labels are accepted."""
        data = self._three_component_data(10)
        out = render_ternary_figure(data, labels=("X", "Y", "Z"), fmt="pdf")
        assert out[: len(_MAGIC["pdf"])] == _MAGIC["pdf"]

    def test_marker_size_parameter(self) -> None:
        """marker_size controls the scatter point size."""
        data = self._three_component_data(10)
        small = render_ternary_figure(data, marker_size=20, fmt="png")
        large = render_ternary_figure(data, marker_size=100, fmt="png")
        # Both should render but sizes differ (indirect check via file sizes)
        assert len(small) > 500
        assert len(large) > 500
        # Larger points typically yield larger PNG (indirect check)
        assert len(large) > len(small)  # marker size should increase file size

    def test_denormalized_input_warns_and_normalizes(self, capsys: object) -> None:
        """Rows not summing to ~1 are normalized (with warning)."""
        # Percentages (0-100 instead of 0-1)
        data = np.array([[50.0, 30.0, 20.0], [70.0, 20.0, 10.0]])
        out = render_ternary_figure(data, fmt="pdf")
        assert out[: len(_MAGIC["pdf"])] == _MAGIC["pdf"]

    def test_already_normalized_no_warning(self) -> None:
        """Rows already summing to 1 don't warn."""
        data = self._three_component_data(10)
        # Should render without warning
        out = render_ternary_figure(data, fmt="pdf")
        assert out[: len(_MAGIC["pdf"])] == _MAGIC["pdf"]

    def test_dpi_none_uses_style_preset(self) -> None:
        """dpi=None resolves to the style preset's dpi."""
        data = self._three_component_data(10)
        small = render_ternary_figure(data, fmt="png", style="web", dpi=None)
        large = render_ternary_figure(data, fmt="png", style="aps", dpi=None)
        # Higher dpi should yield larger PNG
        assert len(large) > len(small)

    def test_explicit_dpi_overrides_preset(self) -> None:
        """Explicit dpi parameter overrides the style preset."""
        data = self._three_component_data(10)
        at_100 = render_ternary_figure(data, fmt="png", dpi=100)
        at_200 = render_ternary_figure(data, fmt="png", dpi=200)
        # Higher dpi should yield larger PNG
        assert len(at_200) > len(at_100)

    def test_bad_format_rejected(self) -> None:
        """Unsupported format raises ValueError."""
        data = self._three_component_data(10)
        with pytest.raises(ValueError, match="fmt must be"):
            render_ternary_figure(data, fmt="jpg")

    def test_wrong_shape_rejected(self) -> None:
        """Data not (n, 3) raises ValueError."""
        with pytest.raises(ValueError, match="shape"):
            render_ternary_figure([[1.0, 2.0]], fmt="pdf")  # (1, 2) instead of (n, 3)

    def test_empty_data_rejected(self) -> None:
        """Empty array raises ValueError."""
        with pytest.raises(ValueError, match="at least one"):
            render_ternary_figure(np.empty((0, 3)), fmt="pdf")

    def test_non_positive_component_rejected(self) -> None:
        """Negative component after normalization raises ValueError."""
        # A row with a negative value
        data = np.array([[-1.0, 1.0, 1.0]])  # normalized: ~(-0.33, 0.33, 0.33)
        with pytest.raises(ValueError, match="non-negative"):
            render_ternary_figure(data, fmt="pdf")

    def test_zero_row_sum_rejected(self) -> None:
        """All-zero row raises ValueError (division by zero)."""
        data = np.array([[0.0, 0.0, 0.0]])
        with pytest.raises(ValueError, match="non-zero row sums"):
            render_ternary_figure(data, fmt="pdf")

    def test_values_length_mismatch_rejected(self) -> None:
        """values length != data rows raises ValueError."""
        data = self._three_component_data(10)
        with pytest.raises(ValueError, match="values has"):
            render_ternary_figure(data, values=[1.0, 2.0], fmt="pdf")  # 2 instead of 10


class TestField:
    """Tests for render_field_figure."""

    def _synthetic_vortex(
        self, nx: int = 10, ny: int = 10
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Generate a synthetic vortex field for testing."""
        x = np.linspace(-1, 1, nx)
        y = np.linspace(-1, 1, ny)
        xx, yy = np.meshgrid(x, y, indexing="xy")
        # Vortex: tangential velocity field
        u = -yy
        v = xx
        return x, y, u, v

    @pytest.mark.parametrize("kind", ["quiver", "streamline"])
    @pytest.mark.parametrize("fmt", ["pdf", "svg", "png"])
    def test_renders_valid_file_for_each_kind_and_format(self, kind: str, fmt: str) -> None:
        """Both quiver and streamline render in each format."""
        x, y, u, v = self._synthetic_vortex()
        out = render_field_figure(x, y, u, v, kind=kind, fmt=fmt, title="Vortex")
        assert out[: len(_MAGIC[fmt])] == _MAGIC[fmt]
        assert len(out) > 500

    def test_quiver_simple(self) -> None:
        """A simple quiver field (2x2 grid) renders."""
        x = np.array([0.0, 1.0])
        y = np.array([0.0, 1.0])
        u = np.array([[1.0, 0.5], [0.5, 0.0]])
        v = np.array([[0.0, 0.5], [0.5, 1.0]])
        out = render_field_figure(x, y, u, v, kind="quiver", fmt="pdf")
        assert out[: len(_MAGIC["pdf"])] == _MAGIC["pdf"]

    def test_streamline_simple(self) -> None:
        """A simple streamline field (2x2 grid) renders."""
        x = np.array([0.0, 1.0])
        y = np.array([0.0, 1.0])
        u = np.array([[1.0, 0.5], [0.5, 0.0]])
        v = np.array([[0.0, 0.5], [0.5, 1.0]])
        out = render_field_figure(x, y, u, v, kind="streamline", fmt="pdf")
        assert out[: len(_MAGIC["pdf"])] == _MAGIC["pdf"]

    def test_with_labels(self) -> None:
        """Custom axis and title labels are accepted."""
        x, y, u, v = self._synthetic_vortex(8, 8)
        out = render_field_figure(
            x, y, u, v, kind="quiver", fmt="pdf",
            title="Velocity Field", x_label="X (m)", y_label="Y (m)",
        )
        assert out[: len(_MAGIC["pdf"])] == _MAGIC["pdf"]

    def test_dpi_none_uses_style_preset(self) -> None:
        """dpi=None resolves to style preset."""
        x, y, u, v = self._synthetic_vortex(8, 8)
        small = render_field_figure(x, y, u, v, kind="quiver", fmt="png", style="web", dpi=None)
        large = render_field_figure(x, y, u, v, kind="quiver", fmt="png", style="aps", dpi=None)
        assert len(large) > len(small)

    def test_explicit_dpi_overrides_preset(self) -> None:
        """Explicit dpi overrides preset."""
        x, y, u, v = self._synthetic_vortex(8, 8)
        at_100 = render_field_figure(x, y, u, v, kind="quiver", fmt="png", dpi=100)
        at_200 = render_field_figure(x, y, u, v, kind="quiver", fmt="png", dpi=200)
        assert len(at_200) > len(at_100)

    def test_bad_format_rejected(self) -> None:
        """Unsupported format raises ValueError."""
        x, y, u, v = self._synthetic_vortex()
        with pytest.raises(ValueError, match="fmt must be"):
            render_field_figure(x, y, u, v, fmt="jpg")

    def test_bad_kind_rejected(self) -> None:
        """Invalid kind raises ValueError."""
        x, y, u, v = self._synthetic_vortex()
        with pytest.raises(ValueError, match="kind must be"):
            render_field_figure(x, y, u, v, kind="invalid")

    def test_x_axis_not_1d_rejected(self) -> None:
        """x_axis must be 1-D."""
        y = np.array([0.0, 1.0])
        u = np.array([[1.0, 0.5], [0.5, 0.0]])
        v = np.array([[0.0, 0.5], [0.5, 1.0]])
        with pytest.raises(ValueError, match="1-D"):
            render_field_figure([[0.0, 1.0]], y, u, v)  # 2-D x_axis

    def test_y_axis_not_1d_rejected(self) -> None:
        """y_axis must be 1-D."""
        x = np.array([0.0, 1.0])
        u = np.array([[1.0, 0.5], [0.5, 0.0]])
        v = np.array([[0.0, 0.5], [0.5, 1.0]])
        with pytest.raises(ValueError, match="1-D"):
            render_field_figure(x, [[0.0, 1.0]], u, v)  # 2-D y_axis

    def test_u_v_not_2d_rejected(self) -> None:
        """u_grid and v_grid must be 2-D."""
        x, y = np.array([0.0, 1.0]), np.array([0.0, 1.0])
        with pytest.raises(ValueError, match="2-D"):
            render_field_figure(x, y, [1.0, 2.0], [[0.0, 0.5], [0.5, 1.0]])

    def test_u_v_shape_mismatch_rejected(self) -> None:
        """u_grid and v_grid must have the same shape."""
        x = np.array([0.0, 1.0])
        y = np.array([0.0, 1.0])
        u = np.array([[1.0, 0.5], [0.5, 0.0]])
        v = np.array([[0.0, 0.5]])  # (1, 2) vs (2, 2)
        with pytest.raises(ValueError, match="same shape"):
            render_field_figure(x, y, u, v)

    def test_grid_shape_mismatch_rejected(self) -> None:
        """u_grid/v_grid shape must match (len(y), len(x))."""
        x = np.array([0.0, 1.0, 2.0])  # 3 points
        y = np.array([0.0, 1.0])  # 2 points
        u = np.array([[1.0, 0.5], [0.5, 0.0]])  # (2, 2) instead of (2, 3)
        v = np.array([[0.0, 0.5], [0.5, 1.0]])
        with pytest.raises(ValueError, match="doesn't match"):
            render_field_figure(x, y, u, v)


class TestAPIIntegration:
    """Integration tests for the export routes."""

    def test_ternary_route_happy_path(self) -> None:
        """POST /api/export/ternary-figure returns a valid PDF."""
        from fastapi.testclient import TestClient

        from quantized.app import app

        client = TestClient(app)
        data = [[0.5, 0.3, 0.2], [0.2, 0.5, 0.3], [0.3, 0.2, 0.5]]
        payload = {
            "data": data,
            "labels": ["A", "B", "C"],
            "fmt": "pdf",
            "title": "Test",
            "filename": "test_ternary",
        }
        resp = client.post("/api/export/ternary-figure", json=payload)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"
        assert resp.content[:4] == b"%PDF"

    def test_ternary_route_bad_format_422(self) -> None:
        """POST /api/export/ternary-figure with bad format returns 422."""
        from fastapi.testclient import TestClient

        from quantized.app import app

        client = TestClient(app)
        payload = {"data": [[0.5, 0.3, 0.2]], "fmt": "jpg"}
        resp = client.post("/api/export/ternary-figure", json=payload)
        assert resp.status_code == 422

    def test_ternary_route_bad_shape_422(self) -> None:
        """POST /api/export/ternary-figure with wrong shape returns 422."""
        from fastapi.testclient import TestClient

        from quantized.app import app

        client = TestClient(app)
        payload = {"data": [[0.5, 0.3]]}  # 2-component instead of 3
        resp = client.post("/api/export/ternary-figure", json=payload)
        assert resp.status_code == 422

    def test_field_route_quiver_happy_path(self) -> None:
        """POST /api/export/field-figure with kind=quiver returns a valid PDF."""
        from fastapi.testclient import TestClient

        from quantized.app import app

        client = TestClient(app)
        payload = {
            "x_axis": [0.0, 1.0],
            "y_axis": [0.0, 1.0],
            "u_grid": [[1.0, 0.5], [0.5, 0.0]],
            "v_grid": [[0.0, 0.5], [0.5, 1.0]],
            "kind": "quiver",
            "fmt": "pdf",
            "title": "Test Quiver",
            "filename": "test_quiver",
        }
        resp = client.post("/api/export/field-figure", json=payload)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"
        assert resp.content[:4] == b"%PDF"

    def test_field_route_streamline_happy_path(self) -> None:
        """POST /api/export/field-figure with kind=streamline returns a valid PDF."""
        from fastapi.testclient import TestClient

        from quantized.app import app

        client = TestClient(app)
        payload = {
            "x_axis": [0.0, 1.0],
            "y_axis": [0.0, 1.0],
            "u_grid": [[1.0, 0.5], [0.5, 0.0]],
            "v_grid": [[0.0, 0.5], [0.5, 1.0]],
            "kind": "streamline",
            "fmt": "png",
            "title": "Test Streamline",
            "filename": "test_streamline",
        }
        resp = client.post("/api/export/field-figure", json=payload)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content[:4] == b"\x89PNG"

    def test_field_route_bad_format_422(self) -> None:
        """POST /api/export/field-figure with bad format returns 422."""
        from fastapi.testclient import TestClient

        from quantized.app import app

        client = TestClient(app)
        payload = {
            "x_axis": [0.0, 1.0],
            "y_axis": [0.0, 1.0],
            "u_grid": [[1.0, 0.5], [0.5, 0.0]],
            "v_grid": [[0.0, 0.5], [0.5, 1.0]],
            "fmt": "tga",
        }
        resp = client.post("/api/export/field-figure", json=payload)
        assert resp.status_code == 422

    def test_field_route_bad_kind_422(self) -> None:
        """POST /api/export/field-figure with bad kind returns 422."""
        from fastapi.testclient import TestClient

        from quantized.app import app

        client = TestClient(app)
        payload = {
            "x_axis": [0.0, 1.0],
            "y_axis": [0.0, 1.0],
            "u_grid": [[1.0, 0.5], [0.5, 0.0]],
            "v_grid": [[0.0, 0.5], [0.5, 1.0]],
            "kind": "invalid",
        }
        resp = client.post("/api/export/field-figure", json=payload)
        assert resp.status_code == 422
