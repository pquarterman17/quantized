"""Line cuts / projections (calc.linecut) — verified against the committed
xrdml_rsm_synthetic fixture (5 Omega frames x 10 2Theta pixels, known grid).

Oracle: a cut must equal the corresponding row/column of the reshaped
(map_shape) grid — an implementation-independent statement of what a
detector-line cut IS. MATLAB parity: width=0 reproduces extract2DLineCut's
nearest-line behaviour; projection(axis='pixels') reproduces importXRDML's
integrated 1-D fallback sum(intensityMap, 1).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.calc.linecut import cut_segment, line_cut, projection
from quantized.datastruct import DataStruct
from quantized.io.xrdml import import_xrdml


@pytest.fixture
def rsm(fixtures_dir: Path) -> DataStruct:
    return import_xrdml(fixtures_dir / "xrdml_rsm_synthetic.xrdml")


def _grids(ds: DataStruct) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    n, m = ds.metadata["map_shape"]
    return (
        ds.column("2Theta").reshape(n, m),
        ds.column("Omega").reshape(n, m),
        ds.column("Intensity").reshape(n, m),
    )


def test_h_cut_nearest_row_matches_grid(rsm: DataStruct) -> None:
    tt, om, iv = _grids(rsm)
    target = float(om[1, 0])  # exactly the 2nd frame's omega
    out = line_cut(rsm, direction="h", value=target)
    np.testing.assert_allclose(out.time, tt[1, :])
    np.testing.assert_allclose(out.values[:, 0], iv[1, :])
    assert out.metadata["n_lines"] == 1
    assert "H-cut" in out.metadata["cut_label"]


def test_h_cut_width_averages_rows(rsm: DataStruct) -> None:
    tt, om, iv = _grids(rsm)
    step = float(om[1, 0] - om[0, 0])
    # width of 2 steps centred on row 1 -> rows 0..2 averaged
    out = line_cut(rsm, direction="h", value=float(om[1, 0]), width=2.0 * step)
    np.testing.assert_allclose(out.values[:, 0], iv[0:3, :].mean(axis=0))
    assert out.metadata["n_lines"] == 3


def test_v_cut_nearest_col_matches_grid(rsm: DataStruct) -> None:
    tt, om, iv = _grids(rsm)
    target = float(tt[0, 4])
    out = line_cut(rsm, direction="v", value=target)
    np.testing.assert_allclose(out.time, om[:, 4])
    np.testing.assert_allclose(out.values[:, 0], iv[:, 4])


def test_q_space_cut_uses_q_axes(rsm: DataStruct) -> None:
    n, m = rsm.metadata["map_shape"]
    qz = rsm.column("Qz").reshape(n, m)
    target = float(np.mean(qz[2, :]))
    out = line_cut(rsm, direction="h", value=target, space="q")
    assert out.metadata["x_column_name"] == "Qx"
    assert out.metadata["x_column_unit"] == "Ang^-1"
    assert out.time.size == m


def test_projection_matches_matlab_integrated_fallback(rsm: DataStruct) -> None:
    tt, om, iv = _grids(rsm)
    out = projection(rsm, axis="pixels")
    np.testing.assert_allclose(out.values[:, 0], iv.sum(axis=0))  # sum(intensityMap, 1)
    np.testing.assert_allclose(out.time, tt.mean(axis=0))
    rock = projection(rsm, axis="frames")
    np.testing.assert_allclose(rock.values[:, 0], iv.sum(axis=1))


def test_segment_cut_along_a_row_reproduces_it(rsm: DataStruct) -> None:
    tt, om, iv = _grids(rsm)
    row = 2
    out = cut_segment(
        rsm,
        p0=(float(tt[row, 0]), float(om[row, 0])),
        p1=(float(tt[row, -1]), float(om[row, -1])),
        n=tt.shape[1],
    )
    # sample points coincide with grid nodes -> linear interp is exact there
    np.testing.assert_allclose(out.values[:, 0], iv[row, :], rtol=1e-9)
    assert out.metadata["x_column_name"] == "Distance"
    np.testing.assert_allclose(out.time[-1], tt[row, -1] - tt[row, 0])


def test_segment_cut_width_averages_perpendicular(rsm: DataStruct) -> None:
    tt, om, iv = _grids(rsm)
    row = 2
    step = float(om[1, 0] - om[0, 0])
    out = cut_segment(
        rsm,
        p0=(float(tt[row, 1]), float(om[row, 0])),
        p1=(float(tt[row, -2]), float(om[row, 0])),
        n=5,
        width=2.0 * step,  # spans rows 1..3
    )
    assert np.isfinite(out.values[:, 0]).all()


def test_errors(rsm: DataStruct) -> None:
    flat = DataStruct.create(
        np.arange(5.0), np.arange(5.0), labels=["I"], units=[""], metadata={}
    )
    with pytest.raises(ValueError, match="not a 2-D map"):
        line_cut(flat, direction="h", value=0.0)
    with pytest.raises(ValueError, match="direction"):
        line_cut(rsm, direction="x", value=0.0)
    with pytest.raises(ValueError, match="distinct"):
        cut_segment(rsm, p0=(1.0, 1.0), p1=(1.0, 1.0))
    with pytest.raises(ValueError, match="space"):
        projection(rsm, space="banana")
