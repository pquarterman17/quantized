"""Median / despike / LOWESS / convolution / deconvolution / Hilbert / inverse FFT
and Reduce XY (gap audit 4, G6 + G7). Every operation is checked against a
numpy/scipy/statsmodels reference or a hand-computed value; the row-order
guarantees (no silent sorting) are tests of their own."""

from __future__ import annotations

import numpy as np
import pytest
from scipy.ndimage import median_filter as nd_median
from scipy.signal import hilbert

from quantized.calc.reduce_xy import average_duplicates, bin_average, keep_every_nth
from quantized.calc.signal_filters import (
    convolve_kernel,
    deconvolve_wiener,
    despike,
    hilbert_envelope,
    kernel_samples,
    lowess,
    median_filter,
    require_uniform,
)
from quantized.calc.signal_ifft import inverse_fft_mag_phase
from quantized.calc.signal_ops import run_signal_op
from quantized.calc.spectral import fft_spectral
from quantized.datastruct import DataStruct

RNG = np.random.default_rng(7)


def _ds(x, *cols, labels=None, metadata=None):
    vals = np.column_stack(cols)
    return DataStruct.create(
        x,
        vals,
        labels=labels or [f"c{i}" for i in range(vals.shape[1])],
        units=[""] * vals.shape[1],
        metadata=metadata or {},
    )


class TestMedian:
    def test_matches_scipy_ndimage_in_interior_and_replicates_edges(self):
        y = RNG.normal(size=40)
        got = median_filter(y, 5)
        ref = nd_median(y, size=5, mode="nearest")
        np.testing.assert_allclose(got, ref, atol=1e-15)

    def test_hand_computed(self):
        got = median_filter(np.array([1.0, 9.0, 2.0, 3.0, 8.0]), 3)
        np.testing.assert_array_equal(got, [1.0, 2.0, 3.0, 3.0, 8.0])

    def test_nan_stays_nan_and_is_ignored_by_neighbours(self):
        got = median_filter(np.array([1.0, np.nan, 3.0, 5.0, 7.0]), 3)
        assert np.isnan(got[1])
        assert (
            got[2] == 4.0
        )  # median of (nan ignored) 3, 5 -> wait: window 1,3,5 -> index 2 uses [nan,3,5]
        # window for row 2 is [nan, 3, 5] -> finite median of 3 and 5 = 4

    @pytest.mark.parametrize("w", [4, 0, 2.5])
    def test_even_or_bad_window_refused(self, w):
        with pytest.raises(ValueError):
            median_filter(np.arange(10.0), w)


class TestDespike:
    def test_removes_planted_spike_and_flags_exactly_it(self):
        x = np.linspace(0, 10, 101)
        y = np.sin(x) + np.random.default_rng(3).normal(scale=0.05, size=x.size)
        y[40] += 25.0
        cleaned, mask = despike(y, 7, 5.0, x)
        assert list(np.flatnonzero(mask)) == [40]
        assert cleaned[40] == pytest.approx((y[39] + y[41]) / 2)  # hand interpolation
        np.testing.assert_array_equal(
            np.delete(cleaned, 40), np.delete(y, 40)
        )  # nothing else touched

    def test_interpolates_on_x_when_uneven(self):
        x = np.array([0.0, 1.0, 2.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0])
        y = 2 * x
        y[3] = 500.0
        cleaned, mask = despike(y, 5, 5.0, x)
        assert mask[3] and cleaned[3] == pytest.approx(8.0)

    def test_non_monotonic_x_not_sorted_uses_row_order(self):
        # a loop: X goes up then back down; rows must stay in acquisition order
        x = np.concatenate([np.linspace(0, 5, 21), np.linspace(5, 0, 21)])
        y = np.concatenate([np.linspace(0, 1, 21), np.linspace(1, 0, 21)])
        y[10] = 40.0
        cleaned, mask = despike(y, 5, 5.0, x)
        assert mask[10] and cleaned[10] == pytest.approx((y[9] + y[11]) / 2)

    def test_clean_signal_flags_nothing(self):
        y = np.sin(np.linspace(0, 6, 80)) + np.random.default_rng(4).normal(scale=0.05, size=80)
        _, mask = despike(y, 7, 6.0)
        assert not mask.any()

    def test_spike_in_constant_signal(self):
        y = np.ones(30)
        y[12] = 3.0
        cleaned, mask = despike(y, 5, 5.0)
        assert list(np.flatnonzero(mask)) == [12] and cleaned[12] == 1.0


class TestDespikeEdges:
    def test_end_points_are_not_flagged_by_a_collapsed_edge_window(self):
        # Replicating the end value into the window collapsed the MAD and flagged
        # row 398 of this spectrum (found in the live check); windows now shrink.
        x = np.arange(400) * 0.5
        y = 100 * np.exp(-(((x - 100) / 6) ** 2)) + 5 + 0.3 * np.sin(x * 7)
        y[[60, 170, 300]] += 400
        _, mask = despike(y, 5, 5.0, x)
        assert list(np.flatnonzero(mask)) == [60, 170, 300]


class TestLowess:
    def test_matches_statsmodels(self):
        sm = pytest.importorskip("statsmodels.nonparametric.smoothers_lowess")
        x = np.sort(RNG.uniform(0, 10, 120))
        y = np.sin(x) + RNG.normal(scale=0.2, size=x.size)
        for it in (0, 3):
            ref = sm.lowess(y, x, frac=0.3, it=it, delta=0.0, return_sorted=False)
            np.testing.assert_allclose(lowess(x, y, 0.3, it), ref, atol=1e-6)

    def test_exact_on_a_line(self):
        x = np.linspace(0, 5, 30)
        np.testing.assert_allclose(lowess(x, 3 * x + 1, 0.4), 3 * x + 1, atol=1e-9)

    def test_keeps_row_order_and_nan_rows(self):
        x = np.array([3.0, 1.0, 2.0, 5.0, 4.0, 6.0, 7.0, 8.0])
        y = 2 * x
        y[2] = np.nan
        out = lowess(x, y, 0.8, 0)
        assert np.isnan(out[2])
        np.testing.assert_allclose(np.delete(out, 2), np.delete(2 * x, 2), atol=1e-9)

    def test_size_limit(self):
        with pytest.raises(ValueError, match="limited"):
            lowess(np.arange(20001.0), np.zeros(20001))


class TestConvolution:
    def test_kernel_is_unit_area_with_correct_fwhm(self):
        k = kernel_samples("gaussian", 2.0, 0.1)
        assert k.sum() == pytest.approx(1.0)
        centre = k.size // 2
        # half maximum at +/- FWHM/2 = 1.0 -> 10 samples
        assert k[centre + 10] / k[centre] == pytest.approx(0.5, abs=1e-12)
        lz = kernel_samples("lorentzian", 2.0, 0.1)
        assert lz[lz.size // 2 + 10] / lz[lz.size // 2] == pytest.approx(0.5, abs=1e-12)

    def test_interior_matches_numpy_convolve(self):
        x = np.linspace(0, 20, 401)
        y = RNG.normal(size=x.size)
        k = kernel_samples("gaussian", 0.6, x[1] - x[0])
        got = convolve_kernel(x, y, "gaussian", 0.6)
        ref = np.convolve(y, k, mode="same")
        h = k.size // 2
        np.testing.assert_allclose(got[h:-h], ref[h:-h], atol=1e-12)

    def test_preserves_area_of_a_peak(self):
        x = np.linspace(-10, 10, 801)
        y = np.exp(-(x**2))
        out = convolve_kernel(x, y, "lorentzian", 0.5)
        assert np.trapezoid(out, x) == pytest.approx(np.trapezoid(y, x), rel=2e-3)

    def test_non_uniform_or_non_monotonic_x_refused(self):
        y = np.ones(6)
        with pytest.raises(ValueError, match="uniform"):
            convolve_kernel(np.array([0, 1, 2, 4, 5, 6.0]), y, "gaussian", 1.0)
        with pytest.raises(ValueError, match="uniform"):
            convolve_kernel(np.array([0, 1, 2, 1, 0, -1.0]), y, "gaussian", 1.0)

    def test_blank_values_refused_not_invented(self):
        x = np.arange(10.0)
        y = np.ones(10)
        y[3] = np.nan
        with pytest.raises(ValueError, match="finite"):
            convolve_kernel(x, y, "gaussian", 1.5)


class TestWienerDeconvolution:
    def test_formula_matches_hand_computed_circular_case(self):
        # No padding path: build the estimate by hand from the same definition.
        x = np.arange(64.0)
        truth = np.zeros(64)
        truth[[20, 40]] = [1.0, 0.6]
        k = kernel_samples("gaussian", 3.0, 1.0)
        blurred = convolve_kernel(x, truth, "gaussian", 3.0)
        lam = 1e-6
        est = deconvolve_wiener(x, blurred, "gaussian", 3.0, lam)
        # explicit definition on the reflect-padded record
        half = k.size // 2
        pad = min(2 * half, blurred.size - 1)
        ext = np.pad(blurred, pad, mode="reflect")
        import scipy.fft as sf

        n = sf.next_fast_len(ext.size + k.size)
        kern = np.roll(np.concatenate([k, np.zeros(n - k.size)]), -half)
        h = np.fft.rfft(kern)
        ref = np.fft.irfft(np.fft.rfft(ext, n) * np.conj(h) / (np.abs(h) ** 2 + lam), n)[
            pad : pad + 64
        ]
        np.testing.assert_allclose(est, ref, atol=1e-12)

    def test_recovers_peak_positions_and_sharpens(self):
        x = np.linspace(0, 50, 1001)
        truth = np.exp(-(((x - 20) / 0.4) ** 2)) + 0.6 * np.exp(-(((x - 30) / 0.4) ** 2))
        blurred = convolve_kernel(x, truth, "gaussian", 2.0)
        est = deconvolve_wiener(x, blurred, "gaussian", 2.0, 1e-6)
        assert abs(x[np.argmax(est)] - 20) < 0.1
        assert np.max(est) > 1.5 * np.max(blurred)  # sharper
        assert np.sqrt(np.mean((est - truth) ** 2)) < 0.5 * np.sqrt(np.mean((blurred - truth) ** 2))

    def test_regularisation_must_be_positive(self):
        with pytest.raises(ValueError, match="regularisation"):
            deconvolve_wiener(np.arange(10.0), np.ones(10), "gaussian", 1.0, 0.0)


class TestHilbert:
    def test_matches_scipy_analytic_signal(self):
        x = np.linspace(0, 1, 1000, endpoint=False)
        y = (1 + 0.5 * np.sin(2 * np.pi * 3 * x)) * np.sin(2 * np.pi * 80 * x)
        env = hilbert_envelope(x, y, remove_mean=False)
        np.testing.assert_allclose(env, np.abs(hilbert(y)), atol=1e-12)
        mid = slice(100, 900)  # away from edge effects: the envelope is 1 + 0.5 sin
        np.testing.assert_allclose(env[mid], (1 + 0.5 * np.sin(2 * np.pi * 3 * x))[mid], atol=0.02)

    def test_removes_mean_by_default(self):
        x = np.linspace(0, 1, 500, endpoint=False)
        y = 10 + np.sin(2 * np.pi * 20 * x)
        env = hilbert_envelope(x, y)
        assert np.median(env) == pytest.approx(1.0, abs=0.02)

    def test_uniform_check(self):
        assert require_uniform(np.linspace(0, 1, 11), "x") == pytest.approx(0.1)


class TestInverseFFT:
    @pytest.mark.parametrize("sided", ["one", "two"])
    def test_round_trip_of_the_workbench_fft_is_exact(self, sided):
        n = 64
        x = np.arange(n) * 0.01
        y = (
            np.sin(2 * np.pi * 7 * x)
            + 0.3 * np.cos(2 * np.pi * 19 * x)
            + RNG.normal(scale=0.05, size=n)
        )
        kw = {"window": "none", "detrend": "none", "sided": sided}
        mag = fft_spectral(x, y, output_type="magnitude", **kw)
        ph = fft_spectral(x, y, output_type="phase", **kw)
        t, back = inverse_fft_mag_phase(mag["freq"], mag["magnitude"], ph["phase"], sided=sided)
        np.testing.assert_allclose(back, y, atol=1e-12)
        np.testing.assert_allclose(t, x, atol=1e-12)

    def test_zero_padded_record_cropped_by_record_length(self):
        n = 50
        x = np.arange(n) * 0.02
        y = np.cos(2 * np.pi * 3 * x) + 0.1 * x
        kw = {"window": "none", "detrend": "none", "sided": "one"}
        mag = fft_spectral(x, y, output_type="magnitude", **kw)
        ph = fft_spectral(x, y, output_type="phase", **kw)
        assert mag["nfft"] == 64
        t, back = inverse_fft_mag_phase(mag["freq"], mag["magnitude"], ph["phase"], record_length=n)
        np.testing.assert_allclose(back, y, atol=1e-12)

    def test_filtered_spectrum_equals_direct_lowpass(self):
        n = 128
        x = np.arange(n) * 0.01
        f_lo, f_hi = 6 / (n * 0.01), 38 / (n * 0.01)  # bin-centred: no leakage
        y = np.sin(2 * np.pi * f_lo * x) + np.sin(2 * np.pi * f_hi * x)
        kw = {"window": "none", "detrend": "none", "sided": "one"}
        mag = fft_spectral(x, y, output_type="magnitude", **kw)
        ph = fft_spectral(x, y, output_type="phase", **kw)
        keep = mag["freq"] <= 12.0
        _, back = inverse_fft_mag_phase(
            mag["freq"], np.where(keep, mag["magnitude"], 0.0), ph["phase"]
        )
        np.testing.assert_allclose(back, np.sin(2 * np.pi * f_lo * x), atol=1e-9)

    def test_bad_axis_and_blank_bins_refused(self):
        f = np.array([0.0, 1.0, 3.0, 4.0])
        with pytest.raises(ValueError, match="uniform"):
            inverse_fft_mag_phase(f, np.ones(4), np.zeros(4))
        with pytest.raises(ValueError, match="non-finite"):
            inverse_fft_mag_phase(np.arange(4.0), np.array([1, np.nan, 1, 1.0]), np.zeros(4))

    def test_dispatcher_refuses_a_windowed_spectrum(self):
        spec = _ds(
            np.arange(5.0),
            np.ones(5),
            np.zeros(5),
            metadata={"spectralAnalysis": {"parameters": {"window": "hanning", "sided": "one"}}},
        )
        with pytest.raises(ValueError, match="window"):
            run_signal_op(spec, "ifft", [], {"magnitudeChannel": 0, "phaseChannel": 1})

    def test_dispatcher_uses_recorded_record_length(self):
        n = 50
        x = np.arange(n) * 0.02
        y = np.cos(2 * np.pi * 3 * x)
        from quantized.calc.spectral_workbench import spectral_workbench

        src = _ds(x, y, labels=["Y"], metadata={"xUnit": "s"})
        mag = spectral_workbench(
            src,
            operation="fft",
            channels=[0],
            window="none",
            detrend="none",
            output_type="magnitude",
        )
        ph = spectral_workbench(
            src, operation="fft", channels=[0], window="none", detrend="none", output_type="phase"
        )
        both = DataStruct.create(
            mag.time,
            np.column_stack([mag.values[:, 0], ph.values[:, 0]]),
            labels=["Y · Magnitude", "Y · Phase"],
            units=["", "deg"],
            metadata=mag.metadata,
        )
        res = run_signal_op(both, "ifft", [], {"magnitudeChannel": 0, "phaseChannel": 1})
        np.testing.assert_allclose(res.data.values[:, 0], y, atol=1e-12)
        assert res.data.time.size == n


class TestReduceBin:
    def test_hand_computed_mean_sd_count(self):
        x = np.array([0.0, 0.2, 0.9, 1.1, 1.5, 2.5, 3.0])
        y = np.array([1.0, 3.0, 5.0, 10.0, 20.0, 7.0, 9.0])
        out = bin_average(_ds(x, y, labels=["Y"]), bin_width=1.0, with_sd=True, with_count=True)
        # bins [0,1): .0,.2,.9 | [1,2): 1.1,1.5 | [2,3): 2.5 | [3,4]: 3.0
        np.testing.assert_allclose(out.time, [np.mean([0, 0.2, 0.9]), 1.3, 2.5, 3.0])
        np.testing.assert_allclose(out.values[:, 0], [3.0, 15.0, 7.0, 9.0])
        np.testing.assert_allclose(
            out.values[:, 1], [np.std([1, 3, 5], ddof=1), np.std([10, 20], ddof=1), np.nan, np.nan]
        )
        np.testing.assert_allclose(out.values[:, 2], [3, 2, 1, 1])
        assert list(out.labels) == ["Y", "Y SD", "N points"]

    def test_median_and_bin_count_and_centre_x(self):
        x = np.arange(10.0)
        y = np.array([1, 2, 100, 4, 5, 6, 7, 8, 9, 10.0])
        out = bin_average(_ds(x, y), n_bins=2, stat="median", x_mode="center")
        np.testing.assert_allclose(out.time, [2.25, 6.75])
        np.testing.assert_allclose(out.values[:, 0], [np.median(y[:5]), np.median(y[5:])])

    def test_empty_bins_emit_no_row_and_descending_x_keeps_order(self):
        x = np.array([10.0, 9.8, 9.7, 5.2, 5.0])
        out = bin_average(_ds(x, x * 2), bin_width=1.0)
        assert out.time.size == 3 and np.all(
            np.diff(out.time) < 0
        )  # 10.0 opens the closed last bin; order kept

    def test_loop_is_refused(self):
        x = np.concatenate([np.linspace(0, 5, 11), np.linspace(5, 0, 11)])
        with pytest.raises(ValueError, match="reverses direction"):
            bin_average(_ds(x, x), bin_width=1.0)
        with pytest.raises(ValueError, match="reverses direction"):
            average_duplicates(_ds(x, x))

    def test_exactly_one_of_width_or_count_and_channels_selected(self):
        d = _ds(np.arange(5.0), np.arange(5.0), np.arange(5.0) * 2, labels=["a", "b"])
        with pytest.raises(ValueError, match="exactly one"):
            bin_average(d)
        out = bin_average(d, n_bins=1, channels=[1])
        assert list(out.labels) == ["b"] and out.values[0, 0] == pytest.approx(4.0)

    def test_blank_x_rows_dropped_and_reported(self):
        d = _ds(np.array([0.0, np.nan, 1.0, 2.0]), np.array([1.0, 99.0, 3.0, 5.0]))
        res = run_signal_op(d, "reduce-bin", [0], {"binWidth": 1.0})
        assert res.data.metadata["reduceXY"]["droppedNonFiniteX"] == 1 and res.warnings


class TestReduceDuplicatesAndNth:
    def test_duplicate_x_averaged_in_place_order(self):
        x = np.array([1.0, 1.0, 2.0, 3.0, 3.0, 3.0])
        y = np.array([2.0, 4.0, 5.0, 1.0, 2.0, 6.0])
        out = average_duplicates(_ds(x, y), with_count=True)
        np.testing.assert_allclose(out.time, [1, 2, 3])
        np.testing.assert_allclose(out.values[:, 0], [3.0, 5.0, 3.0])
        np.testing.assert_allclose(out.values[:, 1], [2, 1, 3])

    def test_duplicates_median(self):
        out = average_duplicates(
            _ds(np.array([1.0, 1.0, 1.0]), np.array([1.0, 2.0, 90.0])), stat="median"
        )
        assert out.values[0, 0] == 2.0

    def test_every_nth_with_offset_keeps_all_columns_and_loop_order(self):
        x = np.concatenate([np.linspace(0, 4, 5), np.linspace(4, 0, 5)])
        d = _ds(x, np.arange(10.0), np.arange(10.0) * 3)
        out = keep_every_nth(d, n=3, offset=1)
        np.testing.assert_array_equal(out.values[:, 0], [1, 4, 7])
        np.testing.assert_array_equal(out.time, x[[1, 4, 7]])
        assert out.values.shape[1] == 2

    def test_every_nth_bad_args(self):
        with pytest.raises(ValueError):
            keep_every_nth(_ds(np.arange(4.0), np.arange(4.0)), n=0)


class TestDispatcher:
    def test_filters_return_selected_channels_on_the_same_rows(self):
        x = np.arange(20.0)
        d = _ds(x, x * 1.0, x * 2.0, labels=["a", "b"])
        res = run_signal_op(d, "median", [1], {"window": 3})
        assert list(res.data.labels) == ["b · median(3)"]
        np.testing.assert_array_equal(res.data.time, x)

    def test_despike_reports_flagged_rows(self):
        x = np.linspace(0, 10, 60)
        y = np.sin(x) + np.random.default_rng(5).normal(scale=0.05, size=x.size)
        y[20] = 50
        res = run_signal_op(_ds(x, y), "despike", [0], {"window": 7, "threshold": 5})
        assert res.flagged == {0: [20]}

    def test_unknown_method_and_missing_channel(self):
        d = _ds(np.arange(5.0), np.arange(5.0))
        with pytest.raises(ValueError, match="unknown"):
            run_signal_op(d, "bogus", [0], {})
        with pytest.raises(ValueError, match="at least one"):
            run_signal_op(d, "median", [], {})


class TestSigopRoute:
    URL = "/api/transform/sigop"

    @staticmethod
    def _client():
        from fastapi.testclient import TestClient

        from quantized.app import create_app

        return TestClient(create_app())

    @staticmethod
    def _payload(x, y):
        return {
            "time": list(x),
            "values": [[v] for v in y],
            "labels": ["Y"],
            "units": ["u"],
            "metadata": {},
        }

    def test_despike_round_trip_reports_flagged_rows(self):
        x = np.linspace(0, 10, 60)
        y = np.sin(x) + np.random.default_rng(5).normal(scale=0.05, size=60)
        y[20] = 50
        r = self._client().post(
            self.URL,
            json={
                "dataset": self._payload(x, y),
                "method": "despike",
                "channels": [0],
                "args": {"window": 7, "threshold": 5},
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["flagged"] == {"0": [20]}
        assert body["rows_in"] == body["rows_out"] == 60
        assert abs(body["dataset"]["values"][20][0]) < 2

    def test_refusals_are_422(self):
        x = [0.0, 1.0, 2.0, 1.0, 0.0]
        r = self._client().post(
            self.URL,
            json={
                "dataset": self._payload(x, x),
                "method": "reduce-bin",
                "channels": [0],
                "args": {"binWidth": 1},
            },
        )
        assert r.status_code == 422
        assert "reverses direction" in r.json()["detail"]

    def test_reduce_nth_row_counts(self):
        r = self._client().post(
            self.URL,
            json={
                "dataset": self._payload(range(10), range(10)),
                "method": "reduce-nth",
                "args": {"n": 3},
            },
        )
        assert r.json()["rows_out"] == 4
