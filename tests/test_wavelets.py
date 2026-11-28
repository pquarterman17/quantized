"""Wavelets (Origin gap plan item 6): CWT scalogram / ridge, multilevel DWT,
reconstruction from chosen levels, wavelet smooth and denoise. Checked against
analytic answers and direct PyWavelets calls; the optional-dependency refusal,
the routes and recipe plumbing too."""

from __future__ import annotations

import sys

import numpy as np
import pytest
from fastapi.testclient import TestClient

pywt = pytest.importorskip("pywt")

from quantized.app import app  # noqa: E402
from quantized.calc import wavelets as wv  # noqa: E402
from quantized.calc.signal_ops import run_signal_op  # noqa: E402
from quantized.calc.wavelet_ops import WAVELET_METHODS  # noqa: E402
from quantized.datastruct import DataStruct  # noqa: E402
from quantized.recipe_params import sigop_params  # noqa: E402

client = TestClient(app, raise_server_exceptions=False)
RNG = np.random.default_rng(6)


def _ds(x, *cols, units=None, meta=None):
    vals = np.column_stack(cols)
    return DataStruct.create(
        x,
        vals,
        labels=[f"c{i}" for i in range(vals.shape[1])],
        units=units or ["V"] * vals.shape[1],
        metadata=meta or {"xUnit": "s", "x_column_name": "Time", "x_column_unit": "s"},
    )


def _rmse(a, b):
    return float(np.sqrt(np.mean((np.asarray(a) - np.asarray(b)) ** 2)))


def _blocks(n=1024):
    """A piecewise-smooth test signal wavelets are good at."""
    t = np.linspace(0, 1, n)
    y = np.where(t < 0.3, 1.0, np.where(t < 0.6, -0.5, 0.8)) + 0.5 * np.sin(2 * np.pi * 3 * t)
    return t, y


class TestDwt:
    @pytest.mark.parametrize("wavelet", ["haar", "db4", "sym8", "coif3", "bior3.5"])
    @pytest.mark.parametrize("mode", ["symmetric", "periodization", "zero"])
    def test_perfect_reconstruction(self, wavelet, mode):
        _, y = _blocks(1000)
        y = y + RNG.normal(size=y.size)
        every = set(wv.component_names(wv.wavedec(y, wavelet, 4, mode)[1]))
        np.testing.assert_allclose(wv.reconstruct(y, wavelet, 4, mode, every), y, atol=1e-10)

    def test_worksheet_columns_invert_to_the_input(self):
        t, y = _blocks(777)  # odd length: coefficient lengths are not N / 2**j
        r = run_signal_op(_ds(t, y), "dwt", [0], {"wavelet": "db4", "level": 4})
        meta = r.data.metadata["wavelet"]
        assert meta["components"] == ["A4", "D4", "D3", "D2", "D1"]
        cols = [r.data.values[:n, k] for k, n in enumerate(meta["lengths"])]
        assert not any(np.isnan(c).any() for c in cols)
        np.testing.assert_allclose(pywt.waverec(cols, "db4", mode="symmetric")[:777], y, atol=1e-10)
        assert r.data.values.shape == (max(meta["lengths"]), 5)
        assert r.data.labels[0] == "c0 · cA4" and r.data.labels[-1] == "c0 · cD1"
        # the shorter columns are padded blank, never zero
        short = int(np.argmin(meta["lengths"]))
        assert np.isnan(r.data.values[meta["lengths"][short] :, short]).all()

    def test_equals_direct_pywavelets(self):
        t, y = _blocks(512)
        r = run_signal_op(
            _ds(t, y), "dwt", [0], {"wavelet": "sym8", "level": 3, "mode": "periodization"}
        )
        direct = pywt.wavedec(y, "sym8", mode="periodization", level=3)
        for k, d in enumerate(direct):
            np.testing.assert_allclose(r.data.values[: d.size, k], d, rtol=0, atol=1e-12)

    def test_default_level_and_refusals(self):
        t, y = _blocks(256)
        r = run_signal_op(_ds(t, y), "dwt", [0], {})
        assert r.data.metadata["wavelet"]["level"] == 5
        assert r.data.metadata["wavelet"]["wavelet"] == "db4"
        for args, msg in [
            ({"level": 99}, "level must be"),
            ({"wavelet": "nope"}, "unknown discrete wavelet"),
            ({"mode": "wrap"}, "unknown extension mode"),
            ({"level": 2.5}, "whole number"),
        ]:
            with pytest.raises(ValueError, match=msg):
                run_signal_op(_ds(t, y), "dwt", [0], args)

    def test_blank_values_and_uneven_x_are_refused(self):
        t, y = _blocks(128)
        y2 = y.copy()
        y2[10] = np.nan
        with pytest.raises(ValueError, match="no blank"):
            run_signal_op(_ds(t, y2), "dwt", [0], {})
        t2 = t.copy()
        t2[50:] += 0.5
        with pytest.raises(ValueError, match="uniform"):
            run_signal_op(_ds(t2, y), "dwt", [0], {})

    def test_two_channels(self):
        t, y = _blocks(256)
        r = run_signal_op(_ds(t, y, 2 * y), "dwt", [0, 1], {"level": 3})
        assert r.data.values.shape[1] == 8 and r.data.labels[4] == "c1 · cA3"

    def test_modes_listed_are_pywt_modes(self):
        assert set(wv.DISCRETE_MODES) - {"origin-periodic"} <= set(pywt.Modes.modes)


class TestReconstructAndSmooth:
    def test_reconstruct_from_levels_equals_direct(self):
        t, y = _blocks(512)
        r = run_signal_op(
            _ds(t, y), "wavelet-reconstruct", [0], {"wavelet": "db4", "level": 4, "keep": "A,4,3"}
        )
        c = pywt.wavedec(y, "db4", mode="symmetric", level=4)
        c = [c[0], c[1], c[2], np.zeros_like(c[3]), np.zeros_like(c[4])]
        np.testing.assert_allclose(r.data.values[:, 0], pywt.waverec(c, "db4")[:512], atol=1e-12)
        np.testing.assert_array_equal(r.data.time, t)
        assert r.data.labels[0] == "c0 · wavelet A4+D4+D3"

    def test_keeping_everything_is_the_identity(self):
        t, y = _blocks(300)
        r = run_signal_op(_ds(t, y), "wavelet-reconstruct", [0], {"level": 3, "keep": "A,1,2,3"})
        np.testing.assert_allclose(r.data.values[:, 0], y, atol=1e-10)

    def test_smooth_zeroes_the_chosen_details_and_lowers_noise(self):
        t, clean = _blocks(1024)
        noisy = clean + RNG.normal(scale=0.3, size=clean.size)
        r = run_signal_op(
            _ds(t, noisy), "wavelet-smooth", [0], {"wavelet": "sym8", "level": 5, "zero": "1,2"}
        )
        c = pywt.wavedec(noisy, "sym8", mode="symmetric", level=5)
        c[-1], c[-2] = np.zeros_like(c[-1]), np.zeros_like(c[-2])
        np.testing.assert_allclose(r.data.values[:, 0], pywt.waverec(c, "sym8")[:1024], atol=1e-12)
        assert _rmse(r.data.values[:, 0], clean) < _rmse(noisy, clean)

    @pytest.mark.parametrize(
        ("method", "args", "msg"),
        [
            ("wavelet-smooth", {"level": 3, "zero": "A"}, "approximation is kept"),
            ("wavelet-smooth", {"level": 3, "zero": "4"}, "outside 1 to 3"),
            ("wavelet-smooth", {"level": 3, "zero": ""}, "at least one"),
            ("wavelet-reconstruct", {"level": 3, "keep": "x"}, "cannot read"),
            ("wavelet-reconstruct", {"level": 3}, "at least one"),
        ],
    )
    def test_level_lists_fail_closed(self, method, args, msg):
        t, y = _blocks(128)
        with pytest.raises(ValueError, match=msg):
            run_signal_op(_ds(t, y), method, [0], args)


class TestDenoise:
    @pytest.mark.parametrize("rule", ["universal", "sure"])
    @pytest.mark.parametrize("threshold", ["soft", "hard"])
    @pytest.mark.parametrize("scope", ["global", "per-level"])
    def test_lowers_rmse(self, rule, threshold, scope):
        t, clean = _blocks(2048)
        noisy = clean + RNG.normal(scale=0.25, size=clean.size)
        r = run_signal_op(
            _ds(t, noisy),
            "wavelet-denoise",
            [0],
            {"wavelet": "sym8", "level": 6, "rule": rule, "threshold": threshold, "scope": scope},
        )
        assert _rmse(r.data.values[:, 0], clean) < 0.7 * _rmse(noisy, clean)
        assert any("noise" in w for w in r.warnings)

    def test_noise_estimate_recovers_sigma(self):
        d = RNG.normal(scale=0.4, size=20000)
        assert wv.noise_sigma(d) == pytest.approx(0.4, rel=0.03)

    def test_universal_is_visushrink_and_matches_pywt_shrinkage(self):
        t, clean = _blocks(1024)
        noisy = clean + RNG.normal(scale=0.2, size=clean.size)
        r = run_signal_op(_ds(t, noisy), "wavelet-denoise", [0], {"wavelet": "db4", "level": 4})
        c = pywt.wavedec(noisy, "db4", mode="symmetric", level=4)
        sigma = np.median(np.abs(c[-1])) / 0.6745
        thr = sigma * np.sqrt(2 * np.log(noisy.size))
        c = [c[0]] + [pywt.threshold(d, thr, mode="soft") for d in c[1:]]
        np.testing.assert_allclose(r.data.values[:, 0], pywt.waverec(c, "db4")[:1024], atol=1e-12)
        assert r.data.metadata["wavelet"]["channels"]["c0"]["threshold"]["D1"] == pytest.approx(thr)

    def test_sure_threshold_minimises_stein_risk(self):
        x = np.concatenate([RNG.normal(size=400), RNG.normal(loc=6, size=20)])

        def risk(th):
            return (len(x) - 2 * np.sum(np.abs(x) <= th) + np.sum(np.minimum(x**2, th**2))) / len(x)

        best = wv.sure_threshold(x)
        grid = np.linspace(0, np.abs(x).max(), 4000)
        assert risk(best) <= min(risk(g) for g in grid) + 1e-9

    def test_noise_free_signal_is_left_alone_with_a_warning(self):
        t = np.linspace(0, 1, 256)
        r = run_signal_op(_ds(t, t * 0 + 1.0), "wavelet-denoise", [0], {"level": 3})
        np.testing.assert_allclose(r.data.values[:, 0], 1.0, atol=1e-12)
        assert any("no noise" in w for w in r.warnings)

    def test_bad_options(self):
        t, y = _blocks(128)
        for args in ({"rule": "x"}, {"threshold": "x"}, {"scope": "x"}):
            with pytest.raises(ValueError, match="one of the listed options"):
                run_signal_op(_ds(t, y), "wavelet-denoise", [0], args)


class TestCwt:
    def _tone(self, f=8.0, n=1024, dt=0.01):
        t = np.arange(n) * dt
        return t, np.sin(2 * np.pi * f * t)

    @pytest.mark.parametrize("family", ["morlet", "mexican-hat", "gaussian"])
    def test_tone_peaks_at_its_frequency(self, family):
        t, y = self._tone(8.0)
        r = run_signal_op(
            _ds(t, y),
            "cwt",
            [0],
            {"wavelet": family, "order": 2, "axisMin": 2.0, "axisMax": 30.0, "count": 120},
        )
        d = r.data
        ny, nx = d.metadata["map_shape"]
        z = d.values[:, 2].reshape(ny, nx)
        f = d.values[:, 1].reshape(ny, nx)[:, 0]
        # Broad real wavelets bias the ridge off the true tone (gaus2 peaks near 6 for 8);
        # the complex Morlet is accurate. Hence the per-family tolerance.
        tol = {"morlet": 0.1, "mexican-hat": 0.1, "gaussian": 0.3}[family]
        assert f[np.argmax(z[:, nx // 2])] == pytest.approx(8.0, rel=tol)
        assert list(d.labels) == ["Time", "Frequency", "Intensity"]
        assert list(d.units[:2]) == ["s", "1/s"]
        assert d.metadata["map_grid"] == "native" and d.metadata["is2D"] is True
        assert np.all(np.diff(f) > 0)

    def test_scale_axis_peaks_at_the_matching_scale(self):
        t, y = self._tone(8.0, dt=0.01)
        r = run_signal_op(
            _ds(t, y), "cwt", [0], {"axis": "scale", "axisMin": 4, "axisMax": 64, "count": 100}
        )
        ny, nx = r.data.metadata["map_shape"]
        z = r.data.values[:, 2].reshape(ny, nx)
        s = r.data.values[:, 1].reshape(ny, nx)[:, 0]
        # cmor1.5-1.0: frequency = 1 / (scale * dt), so scale = 1 / (8 * 0.01) = 12.5
        assert s[np.argmax(z[:, nx // 2])] == pytest.approx(12.5, rel=0.1)
        assert r.data.labels[1] == "Scale" and r.data.units[1] == "samples"

    def test_equals_direct_pywavelets(self):
        t, y = self._tone(5.0, n=512)
        a = {
            "wavelet": "morlet",
            "bandwidth": 2.0,
            "centerFrequency": 0.8,
            "axisMin": 1.0,
            "axisMax": 20.0,
            "count": 40,
            "spacing": "linear",
        }
        r = run_signal_op(_ds(t, y), "cwt", [0], a)
        freqs = np.linspace(1.0, 20.0, 40)
        w = pywt.ContinuousWavelet("cmor2.0-0.8")
        scales = pywt.central_frequency(w) / (freqs * 0.01)
        coefs, f_direct = pywt.cwt(y, scales, w, sampling_period=0.01, method="fft")
        z = r.data.values[:, 2].reshape(40, 512)
        np.testing.assert_allclose(z, np.abs(coefs), rtol=1e-12, atol=1e-12)
        np.testing.assert_allclose(r.data.values[::512, 1], f_direct, rtol=1e-12)

    def test_scalogram_opens_in_the_existing_map_view_cell_for_cell(self):
        from quantized.calc.map import map_from_datastruct

        t, y = self._tone(8.0, n=300)
        r = run_signal_op(_ds(t, y), "cwt", [0], {"axisMin": 2, "axisMax": 30, "count": 25})
        m = map_from_datastruct(r.data, 0, 1, 2)
        assert m.z_grid.shape == (25, 300) and m.metadata["interpolated"] is False
        np.testing.assert_allclose(m.x_axis, t)
        np.testing.assert_allclose(m.y_axis, np.geomspace(2, 30, 25))
        assert (m.x_label, m.y_label, m.y_unit) == ("Time", "Frequency", "1/s")

    def test_ridge_follows_a_chirp(self):
        t = np.arange(2048) * 0.005
        y = np.sin(2 * np.pi * (4.0 * t + 3.0 * t**2))  # instantaneous f = 4 + 6 t
        r = run_signal_op(
            _ds(t, y), "cwt", [0], {"output": "ridge", "axisMin": 3, "axisMax": 60, "count": 200}
        )
        mid = slice(400, 1600)
        expect = 4.0 + 6.0 * t[mid]
        assert np.median(np.abs(r.data.values[mid, 0] - expect) / expect) < 0.08
        assert r.data.labels[0].endswith("ridge frequency") and r.data.units[0] == "1/s"

    def test_refusals(self):
        t, y = self._tone()
        for args, msg in [
            ({"axisMax": 1000.0}, "Nyquist"),
            ({"axisMin": 0.0, "axisMax": 10.0}, "0 < min < max"),
            ({"count": 1000}, "count must be"),
            ({"axis": "x"}, "one of the listed options"),
            ({"wavelet": "haar"}, "one of the listed options"),
            ({"wavelet": "gaussian", "order": 9}, "order"),
        ]:
            with pytest.raises(ValueError, match=msg):
                run_signal_op(_ds(t, y), "cwt", [0], args)
        with pytest.raises(ValueError, match="exactly one"):
            run_signal_op(_ds(t, y, y), "cwt", [0, 1], {})
        with pytest.raises(ValueError, match="increase"):
            run_signal_op(_ds(t[::-1].copy(), y), "cwt", [0], {})

    def test_scale_axis_warns_above_nyquist(self):
        t, y = self._tone()
        r = run_signal_op(_ds(t, y), "cwt", [0], {"axis": "scale", "axisMin": 0.5, "axisMax": 40})
        assert any("Nyquist" in w for w in r.warnings)


def _body(method, dataset=None, args=None):
    t, y = _blocks(256)
    good = {
        "time": t.tolist(),
        "values": [[v] for v in y],
        "labels": ["a"],
        "units": ["V"],
        "metadata": {"xUnit": "s"},
    }
    return {"dataset": dataset or good, "method": method, "channels": [0], "args": args or {}}


class TestOptionalDependency:
    @pytest.mark.parametrize("method", WAVELET_METHODS)
    def test_missing_pywt_refuses_with_the_install_hint(self, method, monkeypatch):
        monkeypatch.setitem(sys.modules, "pywt", None)
        t, y = _blocks(64)
        with pytest.raises(ValueError, match=r"quantized-lab\[wavelets\]"):
            run_signal_op(_ds(t, y), method, [0], {})

    def test_status_route(self, monkeypatch):
        body = client.get("/api/transform/wavelets/status").json()
        assert body == {"available": True, "reason": ""}
        monkeypatch.setitem(sys.modules, "pywt", None)
        body = client.get("/api/transform/wavelets/status").json()
        assert body["available"] is False and "quantized-lab[wavelets]" in body["reason"]

    def test_missing_pywt_is_a_422_on_the_route(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "pywt", None)
        r = client.post("/api/transform/sigop", json=_body("dwt"))
        assert r.status_code == 422 and "quantized-lab[wavelets]" in r.json()["detail"]


class TestRoutesAndRecipes:
    @pytest.mark.parametrize("method", WAVELET_METHODS)
    def test_malformed_dataset_is_422_and_a_good_one_is_not(self, method):
        bad = {
            "time": {"not": "an array"},
            "values": [[1.0], [2.0]],
            "labels": ["a"],
            "units": [""],
            "metadata": {},
        }
        assert client.post("/api/transform/sigop", json=_body(method, bad)).status_code == 422
        args = {"keep": "A,1"} if method == "wavelet-reconstruct" else {}
        r = client.post("/api/transform/sigop", json=_body(method, args=args))
        assert r.status_code == 200, r.text

    @pytest.mark.parametrize("method", WAVELET_METHODS)
    def test_recipe_params_accept_the_methods(self, method):
        assert sigop_params({"method": method, "channels": [0], "args": {"level": 3}})[0] == method

    def test_x_range_is_refused(self):
        r = client.post("/api/transform/sigop", json=_body("dwt", args={"xMin": 0.1, "xMax": 0.5}))
        assert r.status_code == 422 and "X range" in r.json()["detail"]

    def test_replayed_args_reproduce_the_result(self):
        t, y = _blocks(256)
        args = {"wavelet": "sym4", "level": 4, "rule": "sure", "threshold": "hard"}
        a = run_signal_op(_ds(t, y), "wavelet-denoise", [0], args)
        _, chans, back = sigop_params({"method": "wavelet-denoise", "channels": [0], "args": args})
        b = run_signal_op(_ds(t, y), "wavelet-denoise", chans, back)
        np.testing.assert_array_equal(a.data.values, b.data.values)
