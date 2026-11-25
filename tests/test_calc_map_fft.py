"""2-D FFT, 2-D FFT filter and image filters on maps (calc/map_fft, calc/map_imgfilt,
/api/map-ops). Oracles: numpy.fft / scipy.ndimage called directly, an analytic
plane wave, Parseval's theorem, constant-preserving low-pass."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy import ndimage

from quantized.app import create_app
from quantized.calc import map_fft, map_imgfilt, map_ops
from quantized.datastruct import DataStruct
from quantized.io._array_books import grid_map_datastruct

NX, NY = 64, 48
DX, DY = 0.5, 0.25  # nm


def _ds(
    z: np.ndarray, x: np.ndarray | None = None, y: np.ndarray | None = None, **kw: str
) -> DataStruct:
    xs = np.arange(z.shape[1]) * DX if x is None else x
    ys = np.arange(z.shape[0]) * DY if y is None else y
    return grid_map_datastruct(
        z,
        xs,
        ys,
        x_label="X",
        x_unit=kw.get("xu", "nm"),
        y_label="Y",
        y_unit=kw.get("yu", "nm"),
        z_unit="V",
    )


def _wave(kx0: float, ky0: float, amp: float = 2.0) -> np.ndarray:
    xx, yy = np.meshgrid(np.arange(NX) * DX, np.arange(NY) * DY)
    return amp * np.cos(2 * np.pi * (kx0 * xx + ky0 * yy))


def _g(z: np.ndarray, **kw: str) -> map_ops.MapGrid:
    return map_ops.read_grid(_ds(z, **kw))


def test_fft_matches_numpy_and_axes() -> None:
    z = np.random.default_rng(0).normal(size=(NY, NX))
    out, _ = map_fft.fft2d(_g(z))
    np.testing.assert_allclose(out.z, np.abs(np.fft.fftshift(np.fft.fft2(z))) / z.size)
    np.testing.assert_allclose(out.x, np.fft.fftshift(np.fft.fftfreq(NX, DX)))
    np.testing.assert_allclose(out.y, np.fft.fftshift(np.fft.fftfreq(NY, DY)))
    assert (out.x_label, out.x_unit, out.y_unit) == ("k(X)", "1/nm", "1/nm")
    assert np.all(np.diff(out.x) > 0)


def test_cosine_peak_at_wavevector() -> None:
    kx0, ky0 = 5 / (NX * DX), -3 / (NY * DY)  # on-grid frequencies
    out, _ = map_fft.fft2d(_g(_wave(kx0, ky0)))
    j, i = np.unravel_index(np.argmax(out.z), out.z.shape)
    peak = (out.x[i], out.y[j])
    assert peak == pytest.approx((kx0, ky0)) or peak == pytest.approx((-kx0, -ky0))
    assert out.z.max() == pytest.approx(1.0)  # amplitude 2 -> A/2 at each of +-k


def test_parseval() -> None:
    z = np.random.default_rng(1).normal(size=(NY, NX))
    out, _ = map_fft.fft2d(_g(z), output="power")
    # sum|z|^2 = (1/N) sum|F|^2 with F = N * amp
    assert np.sum(z**2) == pytest.approx(np.sum(out.z) * z.size)


def test_phase_log_window_mean() -> None:
    z = _wave(4 / (NX * DX), 0.0) + 1.5
    ph, _ = map_fft.fft2d(_g(z), output="phase")
    assert ph.z_unit == "rad" and np.all(np.abs(ph.z) <= np.pi + 1e-12)
    lg, _ = map_fft.fft2d(_g(z), output="log_magnitude")
    amp, _ = map_fft.fft2d(_g(z))
    ok = amp.z > 0
    np.testing.assert_allclose(lg.z[ok], np.log10(amp.z[ok]))
    nm, _ = map_fft.fft2d(_g(z), remove_mean=True)
    assert nm.z[NY // 2, NX // 2] == pytest.approx(0.0, abs=1e-12)
    from scipy.signal import windows

    w = np.outer(windows.hann(NY, sym=False), windows.hann(NX, sym=False))
    hw, _ = map_fft.fft2d(_g(z), window="hann")
    np.testing.assert_allclose(hw.z, np.abs(np.fft.fftshift(np.fft.fft2(z * w))) / z.size)
    tw, _ = map_fft.fft2d(_g(z), window="tukey")
    assert tw.z.shape == z.shape


def test_fft_refusals() -> None:
    z = np.ones((NY, NX))
    x = np.arange(NX) * DX
    x[10:] += 0.2  # uneven
    with pytest.raises(ValueError, match="evenly spaced|regular grid"):
        map_fft.fft2d(
            map_ops.MapGrid(
                x=x,
                y=np.arange(NY) * DY,
                z=z,
                x_label="X",
                x_unit="nm",
                y_label="Y",
                y_unit="nm",
                z_unit="",
                metadata={},
            )
        )
    bad = z.copy()
    bad[3, 3] = np.nan
    with pytest.raises(ValueError, match="non-finite"):
        map_fft.fft2d(_g(bad))
    with pytest.raises(ValueError, match="output"):
        map_fft.fft2d(_g(z), output="bogus")
    with pytest.raises(ValueError, match="window"):
        map_fft.fft2d(_g(z), window="bogus")


def test_filter_constant_unchanged_and_lowpass_keeps_low_wave() -> None:
    c = np.full((NY, NX), 3.25)
    out, _ = map_fft.fft_filter(_g(c), "lowpass", cutoff_high=0.5)
    np.testing.assert_allclose(out.z, c, atol=1e-12)
    soft, _ = map_fft.fft_filter(_g(c), "lowpass", cutoff_high=0.5, edge_sigma=0.05)
    np.testing.assert_allclose(soft.z, c, rtol=1e-6)
    lo, hi = _wave(2 / (NX * DX), 0.0), _wave(20 / (NX * DX), 0.0, 1.0)
    low, _ = map_fft.fft_filter(_g(lo + hi), "lowpass", cutoff_high=10 / (NX * DX))
    np.testing.assert_allclose(low.z, lo, atol=1e-10)
    high, _ = map_fft.fft_filter(_g(lo + hi + 4.0), "highpass", cutoff_low=10 / (NX * DX))
    np.testing.assert_allclose(high.z, hi, atol=1e-10)
    band, _ = map_fft.fft_filter(
        _g(lo + hi), "bandpass", cutoff_low=10 / (NX * DX), cutoff_high=30 / (NX * DX)
    )
    np.testing.assert_allclose(band.z, hi, atol=1e-10)
    stop, _ = map_fft.fft_filter(
        _g(lo + hi), "bandstop", cutoff_low=10 / (NX * DX), cutoff_high=30 / (NX * DX)
    )
    np.testing.assert_allclose(stop.z, lo, atol=1e-10)


def test_filter_gaussian_edge_matches_erfc_mask() -> None:
    from scipy.special import erfc

    z = np.random.default_rng(2).normal(size=(NY, NX))
    out, _ = map_fft.fft_filter(_g(z), "lowpass", cutoff_high=1.0, edge_sigma=0.3)
    r = np.hypot(np.fft.fftfreq(NX, DX)[None, :], np.fft.fftfreq(NY, DY)[:, None])
    expect = np.fft.ifft2(np.fft.fft2(z) * 0.5 * erfc((r - 1.0) / (np.sqrt(2) * 0.3))).real
    np.testing.assert_allclose(out.z, expect, atol=1e-12)


def test_filter_refusals() -> None:
    z = np.ones((NY, NX))
    with pytest.raises(ValueError, match="differ"):
        map_fft.fft_filter(_g(z, yu="um"), "lowpass", cutoff_high=1.0)
    with pytest.raises(ValueError, match="positive cutoff high"):
        map_fft.fft_filter(_g(z), "lowpass")
    with pytest.raises(ValueError, match="low < high"):
        map_fft.fft_filter(_g(z), "bandpass", cutoff_low=2.0, cutoff_high=1.0)
    with pytest.raises(ValueError, match="mode"):
        map_fft.fft_filter(_g(z), "nope", cutoff_high=1.0)
    with pytest.raises(ValueError, match="sigma"):
        map_fft.fft_filter(_g(z), "lowpass", cutoff_high=1.0, edge_sigma=-1)


@pytest.mark.parametrize("mode", ["reflect", "nearest", "mirror", "wrap", "constant"])
def test_image_filters_match_scipy(mode: str) -> None:
    z = np.random.default_rng(3).normal(size=(NY, NX))
    g = _g(z)
    kw = {"mode": mode, "cval": 0.7}
    ik = {"edge_mode": mode, "cval": 0.7}
    np.testing.assert_allclose(
        map_imgfilt.image_filter(g, "gaussian", sigma=1.5, **ik)[0].z,
        ndimage.gaussian_filter(z, 1.5, **kw),
    )
    np.testing.assert_allclose(
        map_imgfilt.image_filter(g, "median", size=5, **ik)[0].z, ndimage.median_filter(z, 5, **kw)
    )
    np.testing.assert_allclose(
        map_imgfilt.image_filter(g, "uniform", size=4, **ik)[0].z,
        ndimage.uniform_filter(z, 4, **kw),
    )
    gx, gy = ndimage.sobel(z, axis=1, **kw), ndimage.sobel(z, axis=0, **kw)
    np.testing.assert_allclose(map_imgfilt.image_filter(g, "sobel", **ik)[0].z, np.hypot(gx, gy))
    np.testing.assert_allclose(map_imgfilt.image_filter(g, "sobel", gradient="x", **ik)[0].z, gx)
    np.testing.assert_allclose(map_imgfilt.image_filter(g, "sobel", gradient="y", **ik)[0].z, gy)
    np.testing.assert_allclose(
        map_imgfilt.image_filter(g, "laplacian", **ik)[0].z, ndimage.laplace(z, **kw)
    )


def test_image_filter_axes_units_and_refusals() -> None:
    z = np.random.default_rng(4).normal(size=(NY, NX))
    g = _g(z)
    out, _ = map_imgfilt.image_filter(g, "sobel")
    np.testing.assert_array_equal(out.x, g.x)
    assert out.z_unit == "V/px"
    assert map_imgfilt.image_filter(g, "gaussian")[0].z_unit == "V"
    for kind, kw in [
        ("median", {"size": 4}),
        ("gaussian", {"sigma": 0}),
        ("bogus", {}),
        ("uniform", {"size": 0}),
        ("gaussian", {"edge_mode": "x"}),
        ("sobel", {"gradient": "z"}),
    ]:
        with pytest.raises(ValueError):
            map_imgfilt.image_filter(g, kind, **kw)  # type: ignore[arg-type]
    bad = z.copy()
    bad[0, 0] = np.nan
    with pytest.raises(ValueError, match="non-finite"):
        map_imgfilt.image_filter(_g(bad), "gaussian")


def test_route_fft_and_filters() -> None:
    client = TestClient(create_app())
    kx0 = 5 / (NX * DX)
    payload = _ds(_wave(kx0, 0.0)).to_dict()
    r = client.post("/api/map-ops/apply", json={"dataset": payload, "op": "fft2d"})
    assert r.status_code == 200, r.text
    out = DataStruct.from_dict(r.json())
    assert out.metadata["map_op"]["op"] == "fft2d"
    assert out.metadata["map_shape"] == [NY, NX]
    r = client.post(
        "/api/map-ops/apply",
        json={"dataset": payload, "op": "fft_filter", "filter_mode": "highpass", "cutoff_low": 1.0},
    )
    assert r.status_code == 200 and r.json()["metadata"]["map_op"]["mode"] == "highpass"
    r = client.post(
        "/api/map-ops/apply",
        json={
            "dataset": payload,
            "op": "image_filter",
            "filter_kind": "median",
            "size": 3,
            "edge_mode": "nearest",
        },
    )
    assert r.status_code == 200
    r = client.post(
        "/api/map-ops/apply",
        json={"dataset": payload, "op": "fft_filter", "filter_mode": "lowpass"},
    )
    assert r.status_code == 422 and "cutoff" in r.json()["detail"]
