"""Optional X range (``xMin`` / ``xMax``, inclusive) on the signal filters
(A1: the filter operations share the workbench's X-range control). Absent =
exactly the old behaviour; the range trims BEFORE filtering; an empty or
malformed range is refused, never silently ignored."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.signal_ops import FILTER_METHODS, run_signal_op
from quantized.datastruct import DataStruct

X = np.linspace(0.0, 10.0, 101)
Y = np.sin(X) + 0.1 * np.cos(7 * X)
ARGS = {
    "median": {"window": 5},
    "despike": {"window": 7, "threshold": 5.0},
    "lowess": {"fraction": 0.3, "iterations": 2},
    "convolve": {"kernel": "gaussian", "fwhm": 0.3},
    "deconvolve": {"kernel": "gaussian", "fwhm": 0.3, "regularisation": 0.001},
    "hilbert": {"output": "envelope", "removeMean": True},
}


def _ds(metadata=None) -> DataStruct:
    return DataStruct.create(
        X, Y.reshape(-1, 1), labels=["Y"], units=["u"], metadata=metadata or {}
    )


@pytest.mark.parametrize("method", FILTER_METHODS)
def test_range_applied_before_filtering(method):
    ranged = run_signal_op(_ds(), method, [0], {**ARGS[method], "xMin": 2.0, "xMax": 6.0})
    keep = (X >= 2.0) & (X <= 6.0)  # inclusive at both ends
    np.testing.assert_array_equal(ranged.data.time, X[keep])
    # Equals the filter run on the trimmed rows alone: nothing outside leaks in.
    ref = run_signal_op(
        DataStruct.create(X[keep], Y[keep].reshape(-1, 1), labels=["Y"], units=["u"]),
        method,
        [0],
        ARGS[method],
    )
    np.testing.assert_allclose(ranged.data.values, ref.data.values, atol=1e-12)
    assert ranged.data.metadata["signalOp"]["args"]["xMin"] == 2.0


@pytest.mark.parametrize("method", FILTER_METHODS)
def test_no_range_is_unchanged(method):
    plain = run_signal_op(_ds(), method, [0], ARGS[method])
    nones = run_signal_op(_ds(), method, [0], {**ARGS[method], "xMin": None, "xMax": None})
    assert plain.data.time.size == X.size
    np.testing.assert_array_equal(plain.data.values, nones.data.values)
    assert "xMin" not in plain.data.metadata["signalOp"]["args"]


def test_one_sided_range():
    out = run_signal_op(_ds(), "median", [0], {"window": 3, "xMin": 8.0})
    assert out.data.time[0] == pytest.approx(8.0) and out.data.time[-1] == pytest.approx(10.0)


def test_despike_flags_are_source_row_numbers():
    y = Y.copy()
    y[40] = 60.0
    data = DataStruct.create(X, y.reshape(-1, 1), labels=["Y"], units=["u"])
    out = run_signal_op(
        data, "despike", [0], {"window": 7, "threshold": 5.0, "xMin": 3.0, "xMax": 7.0}
    )
    assert out.flagged[0] == [40]  # not 40 minus the first kept row


def test_row_sidecars_follow_the_kept_rows():
    meta = {"text_columns": {"note": [f"r{i}" for i in range(X.size)]}}
    out = run_signal_op(_ds(meta), "median", [0], {"window": 3, "xMin": 1.0, "xMax": 2.0})
    cells = out.data.metadata["text_columns"]["note"]
    assert cells[0] == "r10" and len(cells) == out.data.time.size


@pytest.mark.parametrize(
    "rng, message",
    [
        ({"xMin": 20.0, "xMax": 30.0}, "no rows fall inside"),
        ({"xMin": 5.0, "xMax": 5.0}, "less than"),
        ({"xMin": 6.0, "xMax": 2.0}, "less than"),
        ({"xMin": float("nan"), "xMax": 4.0}, "finite"),
        ({"xMin": "2", "xMax": 4.0}, "finite"),
        ({"xMin": True, "xMax": 4.0}, "finite"),
    ],
)
def test_bad_or_empty_range_refused(rng, message):
    with pytest.raises(ValueError, match=message):
        run_signal_op(_ds(), "median", [0], {"window": 3, **rng})


@pytest.mark.parametrize("method", ["reduce-bin", "reduce-nth", "reduce-duplicates"])
def test_range_refused_for_non_filter_operations(method):
    with pytest.raises(ValueError, match="filter operations only"):
        run_signal_op(_ds(), method, [0], {"n": 2, "nBins": 5, "xMin": 1.0, "xMax": 2.0})


def test_route_applies_range_and_refuses_empty_with_422():
    from fastapi.testclient import TestClient

    from quantized.app import create_app

    client = TestClient(create_app())
    body = {
        "time": X.tolist(),
        "values": [[v] for v in Y],
        "labels": ["Y"],
        "units": ["u"],
        "metadata": {},
    }
    ok = client.post(
        "/api/transform/sigop",
        json={
            "dataset": body,
            "method": "median",
            "channels": [0],
            "args": {"window": 3, "xMin": 2, "xMax": 4},
        },
    )
    assert ok.status_code == 200
    assert ok.json()["rows_in"] == X.size and ok.json()["rows_out"] == 21
    bad = client.post(
        "/api/transform/sigop",
        json={
            "dataset": body,
            "method": "median",
            "channels": [0],
            "args": {"window": 3, "xMin": 50, "xMax": 60},
        },
    )
    assert bad.status_code == 422


def _loop_ds() -> DataStruct:
    # -5 -> +5 -> -5: two branches through the same X values.
    x = np.concatenate([np.linspace(-5, 5, 41), np.linspace(5, -5, 41)[1:]])
    return DataStruct.create(x, np.sin(x).reshape(-1, 1), labels=["Y"], units=["u"])


def test_range_on_a_looped_x_is_refused():
    with pytest.raises(ValueError, match="2 separate stretches of rows; pick a range inside one"):
        run_signal_op(_loop_ds(), "median", [0], {"window": 3, "xMin": -2.0, "xMax": 2.0})


def test_range_inside_one_sweep_of_a_loop_is_accepted():
    # A range that only the first branch reaches is one stretch.
    out = run_signal_op(_loop_ds(), "median", [0], {"window": 3, "xMin": 4.0, "xMax": 5.0})
    assert out.data.time.size > 0


def test_blank_x_rows_are_not_a_break():
    x = X.copy()
    x[50] = np.nan
    ds = DataStruct.create(x, Y.reshape(-1, 1), labels=["Y"], units=["u"])
    out = run_signal_op(ds, "median", [0], {"window": 3, "xMin": 2.0, "xMax": 8.0})
    assert out.data.time.size > 0


def test_loop_range_is_422_through_the_route():
    from fastapi.testclient import TestClient

    from quantized.app import create_app

    ds = _loop_ds()
    r = TestClient(create_app()).post(
        "/api/transform/sigop",
        json={
            "dataset": {
                "time": ds.time.tolist(),
                "values": ds.values.tolist(),
                "labels": ["Y"],
                "units": ["u"],
                "metadata": {},
            },
            "method": "median",
            "channels": [0],
            "args": {"window": 3, "xMin": -2, "xMax": 2},
        },
    )
    assert r.status_code == 422
    assert "separate stretches" in r.text


@pytest.mark.parametrize("method", ["reduce-bin", "reduce-nth"])
def test_explicit_none_range_is_open_on_every_path(method):
    out = run_signal_op(_ds(), method, [0], {"n": 2, "nBins": 5, "xMin": None, "xMax": None})
    assert out.data.time.size > 0


class TestSpectrogramRange:
    """The spectrogram already took ``x_min`` / ``x_max``; the workbench now sends
    them. Pinned here: applied inclusively, an empty range refused, absent = all rows."""

    @staticmethod
    def _data() -> DataStruct:
        x = np.arange(0.0, 512.0)
        y = np.sin(2 * np.pi * x / 16).reshape(-1, 1)
        return DataStruct.create(x, y, labels=["Y"], units=["u"])

    def test_range_applied(self):
        from quantized.calc.spectrogram import spectrogram_dataset

        full = spectrogram_dataset(self._data(), channel=0, segment_len=32)
        part = spectrogram_dataset(
            self._data(), channel=0, segment_len=32, x_min=128.0, x_max=255.0
        )
        params = part.metadata["spectralAnalysis"]["parameters"]
        assert params["xMin"] == 128.0 and params["xMax"] == 255.0
        assert params["segments"] < full.metadata["spectralAnalysis"]["parameters"]["segments"]
        assert part.time.min() >= 128.0 and part.time.max() <= 255.0

    def test_absent_range_is_all_rows(self):
        from quantized.calc.spectrogram import spectrogram_dataset

        a = spectrogram_dataset(self._data(), channel=0, segment_len=32)
        b = spectrogram_dataset(self._data(), channel=0, segment_len=32, x_min=None, x_max=None)
        np.testing.assert_array_equal(a.values, b.values)

    def test_empty_range_refused(self):
        from quantized.calc.spectrogram import spectrogram_dataset

        with pytest.raises(ValueError, match="at least 4 finite rows"):
            spectrogram_dataset(self._data(), channel=0, segment_len=32, x_min=1000.0, x_max=2000.0)

    def test_looped_x_is_refused_with_or_without_a_range(self):
        from quantized.calc.spectrogram import spectrogram_dataset

        x = np.concatenate([np.arange(0.0, 256.0), np.arange(255.0, -1.0, -1.0)])
        ds = DataStruct.create(x, np.sin(x).reshape(-1, 1), labels=["Y"], units=["u"])
        for lo, hi in ((None, None), (50.0, 200.0)):
            with pytest.raises(ValueError, match="strictly monotonic"):
                spectrogram_dataset(ds, channel=0, segment_len=32, x_min=lo, x_max=hi)
