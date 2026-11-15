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
        np.testing.assert_allclose(got[2:-2], ref[2:-2], atol=1e-15)  # interior
        # ends: the window keeps its full length and shifts inward
        assert got[0] == np.median(y[:5]) and got[-1] == np.median(y[-5:])

    def test_hand_computed(self):
        got = median_filter(np.array([1.0, 9.0, 2.0, 3.0, 8.0]), 3)
        np.testing.assert_array_equal(got, [2.0, 2.0, 3.0, 3.0, 3.0])

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
        y = np.full(30, 1.5)
        y[12] = 9.5
        cleaned, mask = despike(y, 5, 5.0)
        assert list(np.flatnonzero(mask)) == [12] and cleaned[12] == 1.5


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
        x = np.array([8.0, 7.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.0])  # descending is fine
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
        mu = blurred.mean()
        ext = np.pad(blurred - mu, pad, mode="reflect")
        import scipy.fft as sf

        n = sf.next_fast_len(ext.size + k.size)
        kern = np.roll(np.concatenate([k, np.zeros(n - k.size)]), -half)
        h = np.fft.rfft(kern)
        ref = (
            np.fft.irfft(np.fft.rfft(ext, n) * np.conj(h) / (np.abs(h) ** 2 + lam), n)[
                pad : pad + 64
            ]
            + mu
        )
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
            metadata={
                "spectralAnalysis": {
                    "parameters": {"outputType": "magnitude+phase", "window": "hanning"}
                }
            },
        )
        with pytest.raises(ValueError, match="window"):
            run_signal_op(spec, "ifft", [], {"magnitudeChannel": 0, "phaseChannel": 1})

    def test_missing_or_joined_provenance_fails_closed(self):
        # A join nests the source metadata, so spectralAnalysis is not at the top.
        # It used to default to window=none / one-sided and invert garbage.
        joined = _ds(
            np.arange(5.0),
            np.ones(5),
            np.zeros(5),
            metadata={"worksheet_transform": "join", "left_metadata": {"spectralAnalysis": {}}},
        )
        with pytest.raises(ValueError, match="Magnitude \+ phase"):
            run_signal_op(joined, "ifft", [], {"magnitudeChannel": 0, "phaseChannel": 1})
        old = _ds(  # a pre-nfft FFT record: incomplete, not guessed
            np.arange(5.0),
            np.ones(5),
            np.zeros(5),
            metadata={
                "spectralAnalysis": {
                    "parameters": {
                        "outputType": "magnitude+phase",
                        "window": "none",
                        "sided": "one",
                    }
                }
            },
        )
        with pytest.raises(ValueError, match="incomplete"):
            run_signal_op(old, "ifft", [], {"magnitudeChannel": 0, "phaseChannel": 1})

    @staticmethod
    def _fft_sheet(y, dt, **kw):
        from quantized.calc.spectral_workbench import spectral_workbench

        src = _ds(np.arange(len(y)) * dt, y, labels=["Y"], metadata={"xUnit": "s"})
        return spectral_workbench(
            src,
            operation="fft",
            channels=[0],
            window="none",
            detrend="none",
            output_type="magnitude+phase",
            **kw,
        )

    def test_magnitude_plus_phase_output_round_trips_with_one_provenance_block(self):
        y = RNG.normal(size=50)  # 50 rows, padded to 64: needs recordLength
        sheet = self._fft_sheet(y, 0.02)
        assert list(sheet.labels) == ["Y \u00b7 Magnitude", "Y \u00b7 Phase"]
        p = sheet.metadata["spectralAnalysis"]["parameters"]
        assert p["outputType"] == "magnitude+phase" and p["recordLength"] == 50 and p["nfft"] == 64
        res = run_signal_op(sheet, "ifft", [], {"magnitudeChannel": 0, "phaseChannel": 1})
        np.testing.assert_allclose(res.data.values[:, 0], y, atol=1e-12)
        np.testing.assert_allclose(res.data.time, np.arange(50) * 0.02, atol=1e-12)

    def test_odd_transform_length_inverts_exactly(self):
        y = RNG.normal(size=101)
        sheet = self._fft_sheet(y, 0.01, zero_pad=101)
        assert sheet.metadata["spectralAnalysis"]["parameters"]["nfft"] == 101
        res = run_signal_op(sheet, "ifft", [], {"magnitudeChannel": 0, "phaseChannel": 1})
        np.testing.assert_allclose(res.data.values[:, 0], y, atol=1e-12)
        np.testing.assert_allclose(res.data.time[1], 0.01)  # dt exact, not 0.0101

    def test_two_sided_round_trip_and_time_axis_unit_label(self):
        y = RNG.normal(size=64)
        sheet = self._fft_sheet(y, 0.01, sided="two")
        assert sheet.metadata["xUnit"] == "1/s"
        res = run_signal_op(sheet, "ifft", [], {"magnitudeChannel": 0, "phaseChannel": 1})
        np.testing.assert_allclose(res.data.values[:, 0], y, atol=1e-12)
        assert res.data.metadata["xUnit"] == "s"  # was "1/1/s"
        assert res.data.metadata["xLabel"] == "Time"

    def test_filtered_magnitude_column_still_inverts(self):
        y = np.sin(2 * np.pi * 6 / 0.64 * np.arange(64) * 0.01) + np.sin(
            2 * np.pi * 20 / 0.64 * np.arange(64) * 0.01
        )
        sheet = self._fft_sheet(y, 0.01)
        mag = sheet.values[:, 0].copy()
        mag[sheet.time > 12.0] = 0.0
        edited = DataStruct.create(
            sheet.time,
            np.column_stack([mag, sheet.values[:, 1]]),
            labels=sheet.labels,
            units=sheet.units,
            metadata=sheet.metadata,
        )
        res = run_signal_op(edited, "ifft", [], {"magnitudeChannel": 0, "phaseChannel": 1})
        np.testing.assert_allclose(
            res.data.values[:, 0], np.sin(2 * np.pi * 6 / 0.64 * np.arange(64) * 0.01), atol=1e-9
        )

    def test_argument_validation(self):
        sheet = self._fft_sheet(RNG.normal(size=64), 0.01)
        for args in (
            {"magnitudeChannel": -1, "phaseChannel": 1},
            {"magnitudeChannel": 1, "phaseChannel": 1},
            {"magnitudeChannel": 0, "phaseChannel": 7},
        ):
            with pytest.raises(ValueError, match="different, existing"):
                run_signal_op(sheet, "ifft", [], args)
        with pytest.raises(ValueError, match="true or false"):
            run_signal_op(
                _ds(np.arange(9.0), np.arange(9.0)), "hilbert", [0], {"removeMean": "false"}
            )


class TestReduceBin:
    def test_hand_computed_mean_sd_count(self):
        x = np.array([0.0, 0.2, 0.9, 1.1, 1.5, 2.5, 3.0])
        y = np.array([1.0, 3.0, 5.0, 10.0, 20.0, 7.0, 9.0])
        out = bin_average(_ds(x, y, labels=["Y"]), bin_width=1.0, with_sd=True, with_count=True)
        # bins [0,1): .0,.2,.9 | [1,2): 1.1,1.5 | [2,3): 2.5 | [3,4]: 3.0
        # span 3 / width 1 = 3 bins, the last closed on the right: x = 3.0 joins 2.5
        np.testing.assert_allclose(out.time, [np.mean([0, 0.2, 0.9]), 1.3, 2.75])
        np.testing.assert_allclose(out.values[:, 0], [3.0, 15.0, 8.0])
        np.testing.assert_allclose(
            out.values[:, 1],
            [np.std([1, 3, 5], ddof=1), np.std([10, 20], ddof=1), np.std([7, 9], ddof=1)],
        )
        np.testing.assert_allclose(out.values[:, 2], [3, 2, 2])
        assert list(out.labels) == ["Y", "Y SD", "Y N"]

    def test_median_and_bin_count_and_centre_x(self):
        x = np.arange(10.0)
        y = np.array([1, 2, 100, 4, 5, 6, 7, 8, 9, 10.0])
        out = bin_average(_ds(x, y), n_bins=2, stat="median", x_mode="center")
        np.testing.assert_allclose(out.time, [2.25, 6.75])
        np.testing.assert_allclose(out.values[:, 0], [np.median(y[:5]), np.median(y[5:])])

    def test_empty_bins_emit_no_row_and_descending_x_keeps_order(self):
        x = np.array([10.0, 9.8, 9.7, 5.2, 5.0])
        out = bin_average(_ds(x, x * 2), bin_width=1.0)
        assert out.time.size == 2 and np.all(np.diff(out.time) < 0)  # order kept

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


class TestReviewFixes:
    """One regression per gap-4 lane C review finding (each failed before its fix)."""

    def test_h1_lowess_refuses_a_hysteresis_loop(self):
        h = np.concatenate([np.linspace(-2, 2, 100), np.linspace(2, -2, 100)])
        m = np.tanh(2 * (h - np.r_[np.full(100, 1.0), np.full(100, -1.0)]))
        with pytest.raises(ValueError, match="reverses direction"):
            lowess(h, m, 0.1, 0)
        with pytest.raises(ValueError, match="reverses direction"):
            run_signal_op(_ds(h, m), "lowess", [0], {"fraction": 0.1, "iterations": 0})

    def test_m4_sparse_counts_are_not_destroyed(self):
        rng = np.random.default_rng(11)
        y = rng.poisson(0.2, 500).astype(float)
        cleaned, mask = despike(y, 7, 5.0)
        assert not mask.any()  # was: 82 of 91 non-zero counts flagged
        np.testing.assert_array_equal(cleaned, y)
        y[250] = 60.0
        _, mask = despike(y, 7, 5.0)
        assert list(np.flatnonzero(mask)) == [250]

    def test_m4_constant_float_signal_flags_nothing(self):
        _, mask = despike(np.full(20, 2.5), 5, 5.0)
        assert not mask.any()

    def test_m6_reduce_is_linear_time(self):
        import time

        n = 40000
        d = _ds(np.arange(n, dtype=float), RNG.normal(size=n), RNG.normal(size=n))
        t0 = time.perf_counter()
        out = average_duplicates(d)
        assert out.time.size == n
        assert time.perf_counter() - t0 < 3.0  # was 10.6 s

    def test_m6_median_stat_matches_a_loop_reference(self):
        x = np.array([1.0, 1, 1, 2, 2, 3])
        y = np.array([1.0, 9, 2, 4, 6, 5])
        out = average_duplicates(_ds(x, y), stat="median", with_sd=True)
        np.testing.assert_allclose(out.values[:, 0], [2.0, 5.0, 5.0])
        np.testing.assert_allclose(out.values[1, 1], np.std([4, 6], ddof=1))

    def test_m7_window_memory_is_bounded_and_work_capped(self):
        import tracemalloc

        y = RNG.normal(size=20000)
        tracemalloc.start()
        median_filter(y, 1001)
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        assert peak < 120e6  # unchunked this was an n x w matrix: 160 MB+
        with pytest.raises(ValueError, match="too much work"):
            median_filter(np.zeros(200_000), 20001)

    def test_m7_lowess_iterations_capped(self):
        with pytest.raises(ValueError, match="0 to 10"):
            lowess(np.arange(10.0), np.arange(10.0), 0.5, 1000)

    def test_l1_two_adjacent_end_spikes_are_removed(self):
        y = np.sin(np.linspace(0, 3, 100)) * 0.1 + 0.001 * np.arange(100) % 0.01
        truth = y.copy()
        y[-2:] += 50.0
        cleaned, mask = despike(y, 7, 3.0)
        assert mask[-2:].all()
        assert np.abs(cleaned[-2:] - truth[-2:]).max() < 1.0

    def test_l2_median_removes_a_spike_at_either_end(self):
        y = np.zeros(20)
        y[0] = y[-1] = 10.0
        out = median_filter(y, 5)
        assert out[0] == 0.0 and out[-1] == 0.0

    def test_l3_exact_multiple_span_has_no_lone_last_bin(self):
        x = np.arange(11.0)
        out = bin_average(_ds(x, x), bin_width=2.0, with_count=True)
        assert out.time.size == 5
        assert out.values[-1, 1] == 3  # 8, 9, 10 -- not a singleton at 10

    def test_l4_tolerance_does_not_chain_a_slow_sweep(self):
        x = np.array([0.0, 0.4, 0.8, 1.2, 1.6])
        out = average_duplicates(_ds(x, x), tolerance=0.5)
        assert out.time.size == 3  # {0, 0.4} {0.8, 1.2} {1.6}; chaining gave 1

    def test_l5_count_is_per_channel_finite_samples(self):
        x = np.array([1.0, 1.0, 1.0])
        a = np.array([1.0, 2.0, 3.0])
        b = np.array([5.0, np.nan, np.nan])
        out = average_duplicates(_ds(x, a, b, labels=["A", "B"]), with_count=True)
        assert list(out.labels) == ["A", "B", "A N", "B N"]
        assert list(out.values[0, 2:]) == [3.0, 1.0]

    def test_l6_text_sidecars_follow_the_kept_rows(self):
        meta = {"text_columns": {"Sample": ["a", "b", "c", "d", "e"]}}
        d = _ds(np.arange(5.0), np.arange(5.0), metadata=meta)
        nth = keep_every_nth(d, n=2)
        assert nth.metadata["text_columns"]["Sample"] == ["a", "c", "e"]
        med = run_signal_op(d, "median", [0], {"window": 3}).data
        assert med.metadata["text_columns"]["Sample"] == ["a", "b", "c", "d", "e"]

    def test_l9_wiener_does_not_shrink_a_baseline(self):
        x = np.linspace(0, 50, 1001)
        y = 1000.0 + np.exp(-(((x - 25) / 0.5) ** 2))
        blurred = convolve_kernel(x, y, "gaussian", 1.0)
        est = deconvolve_wiener(x, blurred, "gaussian", 1.0, 1e-3)
        assert abs(est[100] - 1000.0) < 1e-3  # was -1.0 (gain 1/(1+lambda))
