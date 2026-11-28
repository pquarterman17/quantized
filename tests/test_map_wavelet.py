"""2-D wavelet denoise / smooth of a map (calc/map_wavelet, /api/map-ops/apply
op wavelet2d), checked against direct PyWavelets calls and by round trip."""

from __future__ import annotations

import sys

import numpy as np
import pytest
from fastapi.testclient import TestClient

pywt = pytest.importorskip("pywt")

from quantized.app import app  # noqa: E402
from quantized.calc import map_ops, map_wavelet  # noqa: E402
from quantized.datastruct import DataStruct  # noqa: E402
from quantized.io._array_books import grid_map_datastruct  # noqa: E402

client = TestClient(app, raise_server_exceptions=False)
RNG = np.random.default_rng(22)
NY, NX = 40, 52  # not powers of two: waverec2 pads, the result is trimmed back


def _clean() -> np.ndarray:
    yy, xx = np.mgrid[0:NY, 0:NX]
    return np.exp(-((xx - 26) ** 2 + (yy - 20) ** 2) / 90.0) + 0.3 * np.sin(xx / 6.0)


def _map(z: np.ndarray) -> DataStruct:
    return grid_map_datastruct(
        z, np.arange(z.shape[1]) * 0.5, np.arange(z.shape[0]) * 2.0,
        x_label="Q", x_unit="1/nm", y_label="Th", y_unit="deg", z_unit="cts", metadata={},
    )  # fmt: skip


def _grid(z: np.ndarray) -> map_ops.MapGrid:
    return map_ops.read_grid(_map(z))


@pytest.mark.parametrize("wavelet", ["haar", "db4", "sym4", "bior2.2"])
@pytest.mark.parametrize("mode", ["symmetric", "periodization", "zero"])
def test_no_thresholding_round_trips_to_1e12(wavelet: str, mode: str) -> None:
    z = _clean() + RNG.normal(0, 0.1, (NY, NX))
    out, info = map_wavelet.wavelet_map(_grid(z), "denoise", wavelet=wavelet, mode=mode, value=0.0)
    np.testing.assert_allclose(out.z, z, rtol=0, atol=1e-12)
    assert info["threshold_value"] == 0.0
    out, _ = map_wavelet.wavelet_map(_grid(z), "smooth", wavelet=wavelet, mode=mode, zero="1")
    assert not np.allclose(out.z, z)  # zeroing the finest level does something


def test_denoise_equals_direct_pywavelets() -> None:
    z = _clean() + RNG.normal(0, 0.1, (NY, NX))
    out, info = map_wavelet.wavelet_map(
        _grid(z), "denoise", wavelet="db4", level=2, threshold="soft"
    )
    c = pywt.wavedec2(z, "db4", mode="symmetric", level=2)
    sigma = np.median(np.abs(c[-1][2])) / 0.6745
    t = sigma * np.sqrt(2 * np.log(z.size))
    kept = [c[0]] + [tuple(pywt.threshold(b, t, mode="soft") for b in band) for band in c[1:]]
    ref = pywt.waverec2(kept, "db4", mode="symmetric")[:NY, :NX]
    np.testing.assert_allclose(out.z, ref, rtol=0, atol=1e-12)
    assert info["sigma"] == pytest.approx(sigma) and info["threshold_value"] == pytest.approx(t)
    # and it denoises: closer to the clean map than the noisy one is
    clean = _clean()
    assert np.sqrt(np.mean((out.z - clean) ** 2)) < np.sqrt(np.mean((z - clean) ** 2))
    # sigma estimate recovers the planted noise
    assert sigma == pytest.approx(0.1, rel=0.2)


def test_smooth_zeroes_the_chosen_levels_and_nothing_else() -> None:
    z = _clean() + RNG.normal(0, 0.1, (NY, NX))
    out, info = map_wavelet.wavelet_map(_grid(z), "smooth", wavelet="haar", level=3, zero="1,2")
    c = pywt.wavedec2(z, "haar", mode="symmetric", level=3)
    ref = [c[0], c[1], tuple(np.zeros_like(b) for b in c[2]), tuple(np.zeros_like(b) for b in c[3])]
    np.testing.assert_allclose(
        out.z, pywt.waverec2(ref, "haar", mode="symmetric")[:NY, :NX], atol=1e-12
    )
    assert info["zeroed"] == ["D1", "D2"]


def test_axes_units_and_provenance_survive() -> None:
    g = _grid(_clean())
    out, info = map_wavelet.wavelet_map(g, "denoise")
    res = map_ops.grid_result(out, info)
    assert res.metadata["map_op"]["op"] == "wavelet2d"
    back = map_ops.read_grid(res)
    np.testing.assert_allclose(back.x, g.x)
    np.testing.assert_allclose(back.y, g.y)
    assert (back.x_unit, back.y_unit, back.z_unit) == ("1/nm", "deg", "cts")


@pytest.mark.parametrize(
    ("kw", "msg"),
    [
        ({"action": "blur"}, "wavelet action"),
        ({"action": "denoise", "wavelet": "nope"}, "unknown discrete wavelet"),
        ({"action": "denoise", "level": 99}, "level must be"),
        ({"action": "denoise", "mode": "origin-periodic"}, "1-D"),
        ({"action": "denoise", "value": -1.0}, "threshold must be"),
        ({"action": "smooth", "zero": ""}, "at least one level"),
        ({"action": "smooth", "level": 2, "zero": "3"}, "outside"),
    ],
)
def test_refusals(kw: dict, msg: str) -> None:
    action = kw.pop("action")
    with pytest.raises(ValueError, match=msg):
        map_wavelet.wavelet_map(_grid(_clean()), action, **kw)


def test_blank_cells_are_refused() -> None:
    z = _clean()
    z[3, 4] = np.nan
    with pytest.raises(ValueError, match="non-finite"):
        map_wavelet.wavelet_map(_grid(z), "denoise")


def _post(**kw):
    body = {"dataset": _map(_clean() + RNG.normal(0, 0.1, (NY, NX))).to_dict(), "op": "wavelet2d"}
    return client.post("/api/map-ops/apply", json={**body, **kw})


def test_route_returns_a_linked_map() -> None:
    r = _post(wt_action="denoise", wt_wavelet="db4", wt_level=2)
    assert r.status_code == 200, r.text
    out = DataStruct.from_dict(r.json())
    assert out.metadata["map_op"]["action"] == "denoise" and out.metadata["is2D"] is True
    assert _post(wt_action="smooth", wt_zero="1").status_code == 200
    assert _post(wt_action="nope").status_code == 422


def test_missing_pywt_refuses_with_the_install_hint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "pywt", None)
    r = _post()
    assert r.status_code == 422 and "quantized-lab[wavelets]" in r.json()["detail"]
