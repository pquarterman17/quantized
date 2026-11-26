"""Signal extras (Origin gap plan item 7): coherence, phase unwrap, anti-alias
decimation, extrema envelope, percentile / binomial smoothing, Zoom FFT. Each is
checked against an analytic result; the dispatch and recipe plumbing too."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.signal_extras import binomial_kernel, binomial_smooth, percentile_smooth
from quantized.calc.signal_ops import run_signal_op
from quantized.datastruct import DataStruct
from quantized.recipe_params import sigop_params

RNG = np.random.default_rng(11)


def _ds(x, *cols, labels=None, units=None, meta=None):
    vals = np.column_stack(cols)
    return DataStruct.create(
        x,
        vals,
        labels=labels or [f"c{i}" for i in range(vals.shape[1])],
        units=units or [""] * vals.shape[1],
        metadata=meta or {"xUnit": "s"},
    )


class TestCoherence:
    def test_self_is_one_and_independent_noise_is_near_zero(self):
        t = np.arange(2**14) / 1000.0
        a, b = RNG.normal(size=t.size), RNG.normal(size=t.size)
        r = run_signal_op(_ds(t, a, a, b), "coherence", [0, 1], {"segmentLen": 256})
        np.testing.assert_allclose(r.data.values[:, 0], 1.0, atol=1e-12)
        r = run_signal_op(_ds(t, a, b), "coherence", [0, 1], {"segmentLen": 256})
        assert r.data.values[:, 0].mean() < 0.05
        assert r.data.metadata["xUnit"] == "1/s" and r.data.metadata["xLabel"] == "Frequency"
        assert r.data.time[-1] == pytest.approx(500.0)

    def test_shared_tone_is_coherent_at_its_frequency(self):
        t = np.arange(2**14) / 1000.0
        tone = np.sin(2 * np.pi * 125.0 * t)
        r = run_signal_op(
            _ds(t, tone + RNG.normal(size=t.size), tone + RNG.normal(size=t.size)),
            "coherence",
            [0, 1],
            {"segmentLen": 256, "window": "hamming"},
        )
        k = int(np.argmin(np.abs(r.data.time - 125.0)))
        assert r.data.values[k, 0] > 0.8

    def test_refuses_wrong_channel_count_and_warns_on_one_segment(self):
        t = np.arange(64) / 10.0
        a = RNG.normal(size=64)
        with pytest.raises(ValueError, match="two"):
            run_signal_op(_ds(t, a, a), "coherence", [0], {})
        r = run_signal_op(_ds(t, a, a[::-1].copy()), "coherence", [0, 1], {"segmentLen": 64})
        assert any("trivially" in w for w in r.warnings)


class TestUnwrap:
    @pytest.mark.parametrize(("unit", "period"), [("radians", 2 * np.pi), ("degrees", 360.0)])
    def test_recovers_a_known_ramp(self, unit, period):
        t = np.linspace(0, 1, 200)
        ramp = 8 * period * t
        wrapped = (ramp + period / 2) % period - period / 2
        r = run_signal_op(_ds(t, wrapped), "unwrap", [0], {"unit": unit})
        np.testing.assert_allclose(r.data.values[:, 0], ramp, atol=1e-9)
        assert r.data.time.size == 200

    def test_blank_row_stays_blank_and_phase_continues(self):
        t = np.arange(6.0)
        wrapped = np.array([0.0, 3.0, np.nan, -2.5, -0.5, 1.0])
        out = run_signal_op(_ds(t, wrapped), "unwrap", [0], {}).data.values[:, 0]
        assert np.isnan(out[2]) and np.isfinite(out[[0, 1, 3, 4, 5]]).all()
        assert np.all(np.diff(out[[0, 1, 3, 4, 5]]) > -np.pi)


class TestDecimate:
    @pytest.mark.parametrize("ftype", ["iir", "fir"])
    def test_keeps_inband_amplitude_and_removes_aliasing_tone(self, ftype):
        fs, n, q = 1000.0, 4000, 4
        t = np.arange(n) / fs
        y = np.sin(2 * np.pi * 20.0 * t) + np.sin(2 * np.pi * 220.0 * t)
        r = run_signal_op(_ds(t, y), "decimate-aa", [0], {"factor": q, "filter": ftype})
        out, xo = r.data.values[:, 0], r.data.time
        assert out.size == n // q and xo[1] - xo[0] == pytest.approx(q / fs)
        mid = slice(200, -200)
        # 220 Hz would alias to 30 Hz at fs/q = 250 Hz; it must be gone
        ref = np.sin(2 * np.pi * 20.0 * xo)
        np.testing.assert_allclose(out[mid], ref[mid], atol=0.05)
        assert np.abs(y[::q][mid] - ref[mid]).max() > 0.5  # plain row-keeping aliases it

    def test_refuses_blanks_nonuniform_x_and_big_iir_factor(self):
        t = np.arange(400) / 100.0
        y = RNG.normal(size=400)
        bad = y.copy()
        bad[5] = np.nan
        with pytest.raises(ValueError, match="finite"):
            run_signal_op(_ds(t, bad), "decimate-aa", [0], {"factor": 2})
        with pytest.raises(ValueError, match="uniform"):
            run_signal_op(
                _ds(np.cumsum(RNG.uniform(1, 2, 400)), y), "decimate-aa", [0], {"factor": 2}
            )
        with pytest.raises(ValueError, match="13"):
            run_signal_op(_ds(t, y), "decimate-aa", [0], {"factor": 14})
        with pytest.raises(ValueError, match="X range"):
            run_signal_op(_ds(t, y), "decimate-aa", [0], {"factor": 2, "xMin": 0.0})
        run_signal_op(_ds(t, y), "decimate-aa", [0], {"factor": 14, "filter": "fir"})


class TestExtremaEnvelope:
    def test_recovers_am_modulation(self):
        t = np.linspace(0, 2, 8000)
        mod = 1.0 + 0.5 * np.cos(2 * np.pi * 2.0 * t)
        y = mod * np.cos(2 * np.pi * 100.0 * t)
        for interp in ("spline", "linear"):
            r = run_signal_op(
                _ds(t, y), "envelope-extrema", [0], {"side": "both", "interpolation": interp}
            )
            up, lo = r.data.values[:, 0], r.data.values[:, 1]
            mid = slice(300, -300)
            assert np.abs(up[mid] - mod[mid]).max() < 0.02, interp
            assert np.abs(lo[mid] + mod[mid]).max() < 0.02, interp
        assert [lab.split(" · ")[1] for lab in r.data.labels] == [
            "upper envelope",
            "lower envelope",
        ]

    def test_needs_increasing_x(self):
        with pytest.raises(ValueError, match="increasing"):
            run_signal_op(
                _ds(np.array([0.0, 2.0, 1.0, 3.0]), np.arange(4.0)), "envelope-extrema", [0], {}
            )


class TestSmoothing:
    def test_percentile_on_a_step_shifts_the_edge_by_half_a_window(self):
        y = np.r_[np.zeros(10), np.ones(10)]
        t = np.arange(20.0)

        def run(p):
            return run_signal_op(
                _ds(t, y), "percentile", [0], {"window": 5, "percentile": p}
            ).data.values[:, 0]

        np.testing.assert_array_equal(run(0), np.r_[np.zeros(12), np.ones(8)])  # running minimum
        np.testing.assert_array_equal(run(100), np.r_[np.zeros(8), np.ones(12)])  # running maximum
        np.testing.assert_array_equal(run(50), y)  # a median keeps a clean step

    def test_percentile_removes_a_spike_and_rejects_bad_input(self):
        y = np.zeros(15)
        y[7] = 100.0
        np.testing.assert_array_equal(percentile_smooth(y, 5, 50), np.zeros(15))
        with pytest.raises(ValueError, match="odd"):
            percentile_smooth(y, 4, 50)
        with pytest.raises(ValueError, match="between 0 and 100"):
            percentile_smooth(y, 5, 120)

    def test_binomial_kernel_and_properties(self):
        np.testing.assert_allclose(binomial_kernel(3), [0.25, 0.5, 0.25])
        np.testing.assert_allclose(binomial_kernel(5), np.array([1, 4, 6, 4, 1]) / 16)
        imp = np.zeros(21)
        imp[10] = 1.0
        np.testing.assert_allclose(binomial_smooth(imp, 5)[8:13], binomial_kernel(5))
        np.testing.assert_allclose(binomial_smooth(np.full(30, 3.0), 7), 3.0)
        noisy = RNG.normal(size=500)
        assert binomial_smooth(noisy, 9).std() < 0.5 * noisy.std()

    def test_dispatch_labels_and_x_range(self):
        t = np.arange(20.0)
        args = {"window": 5, "xMin": 5.0, "xMax": 14.0}
        r = run_signal_op(_ds(t, RNG.normal(size=20)), "binomial", [0], args)
        assert r.data.time.size == 10 and r.data.labels[0].endswith("binomial(5)")


class TestZoomFft:
    def test_resolves_two_tones_a_plain_fft_of_the_same_length_merges(self):
        fs, n = 1000.0, 1000
        t = np.arange(n) / fs
        y = np.sin(2 * np.pi * 100.0 * t) + np.sin(2 * np.pi * 101.4 * t)

        def peaks(v, f):
            i = [
                k
                for k in range(1, v.size - 1)
                if v[k] > v[k - 1] and v[k] > v[k + 1] and v[k] > 0.3 * v.max()
            ]
            return f[i]

        plain = np.abs(np.fft.rfft(y))
        assert peaks(plain[90:112], np.fft.rfftfreq(n, 1 / fs)[90:112]).size == 1
        r = run_signal_op(
            _ds(t, y),
            "zoom-fft",
            [0],
            {"fMin": 98.0, "fMax": 104.0, "nPoints": 601, "window": "none"},
        )
        found = peaks(r.data.values[:, 0], r.data.time)
        assert found.size == 2
        np.testing.assert_allclose(found, [100.0, 101.4], atol=0.05)
        assert r.data.time[0] == 98.0 and r.data.time[-1] == pytest.approx(104.0)

    def test_amplitude_scale_matches_the_tone(self):
        fs, n = 1000.0, 2000
        t = np.arange(n) / fs
        y = 3.0 * np.sin(2 * np.pi * 123.0 * t) + 5.0
        r = run_signal_op(
            _ds(t, y), "zoom-fft", [0], {"fMin": 120.0, "fMax": 126.0, "window": "hanning"}
        )
        assert r.data.values[:, 0].max() == pytest.approx(3.0, rel=0.02)

    def test_band_must_fit_below_nyquist(self):
        t = np.arange(100) / 10.0
        y = RNG.normal(size=100)
        with pytest.raises(ValueError, match="Nyquist"):
            run_signal_op(_ds(t, y), "zoom-fft", [0], {"fMin": 1.0, "fMax": 9.0})
        with pytest.raises(ValueError, match="band"):
            run_signal_op(_ds(t, y), "zoom-fft", [0], {})


def test_new_methods_are_accepted_by_recipe_replay_validation():
    for m in (
        "unwrap",
        "percentile",
        "binomial",
        "envelope-extrema",
        "coherence",
        "decimate-aa",
        "zoom-fft",
    ):
        assert sigop_params({"method": m, "channels": [0], "args": {}})[0] == m


class TestExistingPsd:
    """Item 7 check: the FFT workbench already offers PSD by Welch and by single
    periodogram (density scaling). Pinned here so the claim stays true."""

    def test_white_noise_psd_is_flat_at_two_sigma_squared_over_fs(self):
        from scipy.signal import welch

        from quantized.calc.spectral import fft_spectral

        fs, sigma, n = 1000.0, 2.0, 2**16
        t = np.arange(n) / fs
        y = RNG.normal(scale=sigma, size=n)
        expected = 2 * sigma**2 / fs  # one-sided density
        w = fft_spectral(t, y, window="hanning", output_type="psd", segment_len=1024, overlap=0.5)
        psd = w["psd"][2:-2]
        assert psd.mean() == pytest.approx(expected, rel=0.03)
        assert psd.std() / psd.mean() < 0.15  # flat: Welch averaging tames the scatter
        ref = welch(y, fs=fs, window="hann", nperseg=1024, noverlap=512, detrend="constant")[1]
        assert ref[2:-2].mean() == pytest.approx(psd.mean(), rel=0.01)
        p = fft_spectral(t, y, window="hanning", output_type="psd")["psd"][2:-2]
        assert p.mean() == pytest.approx(expected, rel=0.05)
