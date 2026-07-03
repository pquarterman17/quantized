"""NetCDF parser (io.netcdf): ANDI/AIA chromatography + generic.

scipy and h5py are quantized deps, so CI builds real NetCDF-3 (.cdf) and
NetCDF-4 (HDF5 .nc) files in tmp_path and round-trips them — the ANDI TIC and
single-channel conventions, the generic monotonic-coordinate heuristic, the
magic-byte sniffer, and rejection of non-NetCDF input.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.netcdf import import_netcdf, is_netcdf


def _andi_ms(path: Path, t: np.ndarray, tic: np.ndarray) -> Path:
    from scipy.io import netcdf_file

    f = netcdf_file(str(path), "w")
    f.aia_template_revision = "1.0.1"
    f.createDimension("scan_number", t.size)
    sat = f.createVariable("scan_acquisition_time", "d", ("scan_number",))
    sat[:] = t
    sat.units = "seconds"
    ti = f.createVariable("total_intensity", "d", ("scan_number",))
    ti[:] = tic
    ti.units = "counts"
    f.close()
    return path


def _andi_fid(path: Path, sig: np.ndarray, *, interval: float, delay: float) -> Path:
    from scipy.io import netcdf_file

    f = netcdf_file(str(path), "w")
    f.actual_sampling_interval = np.float64(interval)
    f.actual_delay_time = np.float64(delay)
    f.createDimension("point_number", sig.size)
    ov = f.createVariable("ordinate_values", "d", ("point_number",))
    ov[:] = sig
    ov.units = "Volts"
    f.close()
    return path


def _generic_h5(path: Path, x: np.ndarray, y: np.ndarray) -> Path:
    import h5py

    with h5py.File(path, "w") as h:
        h.create_dataset("wavelength", data=x).attrs["units"] = "nm"
        h.create_dataset("absorbance", data=y).attrs["units"] = "AU"
    return path


def test_andi_ms_tic(tmp_path: Path) -> None:
    t = np.linspace(0.0, 100.0, 50)
    tic = 100.0 + 5.0 * t
    ds = import_netcdf(_andi_ms(tmp_path / "ms.cdf", t, tic))
    assert_allclose(ds.time, t)
    assert_allclose(ds.values[:, 0], tic)
    assert ds.labels == ("Total Intensity",) and ds.units == ("counts",)
    assert ds.metadata["netcdf_kind"] == "ANDI"
    assert ds.metadata["x_column_name"] == "Retention Time"


def test_andi_fid_reconstructs_time(tmp_path: Path) -> None:
    sig = np.linspace(1.0, 10.0, 100)
    ds = import_netcdf(_andi_fid(tmp_path / "fid.cdf", sig, interval=0.5, delay=2.0))
    assert_allclose(ds.time, 2.0 + np.arange(100) * 0.5)  # delay + i*interval
    assert_allclose(ds.values[:, 0], sig)
    assert ds.labels == ("Signal",) and ds.units == ("Volts",)


def test_generic_netcdf4_picks_monotonic_x(tmp_path: Path) -> None:
    wl = np.linspace(400.0, 800.0, 32)
    absb = np.array([0.1, 0.5, 0.2] + [0.3] * 29)  # non-monotonic -> not chosen as x
    ds = import_netcdf(_generic_h5(tmp_path / "g.nc", wl, absb))
    assert_allclose(ds.time, wl)  # wavelength is the monotonic coordinate
    assert ds.labels == ("Absorbance",) and ds.units == ("AU",)
    assert ds.metadata["netcdf_kind"] == "generic"


def test_routing_and_sniffer(tmp_path: Path) -> None:
    p = _andi_ms(tmp_path / "r.cdf", np.linspace(0, 1, 10), np.ones(10))
    assert is_netcdf(p)
    assert import_auto(str(p)).metadata["parser_name"] == "import_netcdf"
    g = _generic_h5(tmp_path / "r.nc", np.linspace(0, 1, 10), np.arange(10.0))
    assert is_netcdf(g)


def test_rejects_non_netcdf(tmp_path: Path) -> None:
    p = tmp_path / "bad.nc"
    p.write_bytes(b"not netcdf at all")
    assert not is_netcdf(p)
    with pytest.raises(ValueError, match="not a NetCDF"):
        import_netcdf(p)


def test_single_variable_indexed(tmp_path: Path) -> None:
    import h5py

    p = tmp_path / "one.nc"
    with h5py.File(p, "w") as h:
        h.create_dataset("signal", data=np.arange(5.0))
    ds = import_netcdf(p)
    assert ds.values.shape[0] == 5  # a lone variable imports against an index x
    assert ds.labels == ("Signal",) and ds.metadata["x_column_name"] == "Index"


@pytest.mark.realdata
@pytest.mark.parametrize(
    ("name", "kind", "n"),
    [
        ("andi_ms_tic.cdf", "ANDI", 500),
        ("andi_fid.cdf", "ANDI", 2000),
        ("generic_spectrum.nc", "generic", 256),
    ],
)
def test_corpus_fixtures(corpus_dir: Path, name: str, kind: str, n: int) -> None:
    path = corpus_dir / "synthetic" / "netcdf" / name
    if not path.exists():
        pytest.skip(f"corpus file missing: {name}")
    ds = import_auto(str(path))
    assert ds.metadata["netcdf_kind"] == kind
    assert len(ds.time) == n
    assert np.all(np.isfinite(ds.values))
