"""STFT spectrogram: peak location, scaling, long-form layout, and refusals."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.spectrogram import MAX_CELLS, spectrogram_dataset
from quantized.datastruct import DataStruct

FS = 100.0


def _ds(
    freq: float = 12.5, n: int = 1024, amp: float = 2.0, x: np.ndarray | None = None
) -> DataStruct:
    t = np.arange(n) / FS if x is None else x
    return DataStruct.create(
        t,
        (amp * np.sin(2 * np.pi * freq * t))[:, None],
        labels=["V"],
        units=["mV"],
        metadata={"xLabel": "Time", "xUnit": "s"},
    )


def test_long_form_layout_and_peak_frequency() -> None:
    out = spectrogram_dataset(_ds(), channel=0, segment_len=128, overlap=0.5)
    assert tuple(out.labels) == ("Frequency", "V · Spectrogram")
    assert out.units[0] == "1/s"
    n_f = 128 // 2 + 1
    assert out.time.size % n_f == 0
    z = out.values[:, 1].reshape(-1, n_f)
    freqs = out.values[:, 0].reshape(-1, n_f)[0]
    assert freqs[0] == 0 and freqs[-1] == pytest.approx(FS / 2)
    assert np.allclose(freqs[z.argmax(axis=1)], 12.5)  # bin-centred: 16 * FS / 128
    centres = out.time.reshape(-1, n_f)[:, 0]
    assert np.all(np.diff(centres) > 0)
    assert np.all(out.time.reshape(-1, n_f) == centres[:, None])


def test_segment_centres_are_the_middle_of_each_segment_rows() -> None:
    # 1024 rows at 0.01: the first 128-row segment covers x = 0 .. 1.27, centre 0.635.
    out = spectrogram_dataset(_ds(), channel=0, segment_len=128, overlap=0.5)
    n_f = 128 // 2 + 1
    centres = out.time.reshape(-1, n_f)[:, 0]
    assert centres[0] == pytest.approx(0.635)
    assert centres[1] - centres[0] == pytest.approx(0.64)  # hop of 64 rows


def test_overlap_percent_is_not_lost_to_float_rounding() -> None:
    # 0.29 * 100 == 28.999999999999996: still 29 shared rows -> hop 71.
    out = spectrogram_dataset(_ds(n=1000), channel=0, segment_len=100, overlap=0.29)
    assert out.metadata["spectralAnalysis"]["parameters"]["segments"] == (1000 - 29) // 71


def test_amplitude_scaling_recovers_sinusoid_amplitude() -> None:
    out = spectrogram_dataset(_ds(amp=2.0), channel=0, segment_len=128, scaling="amplitude")
    assert out.units[1] == "mV"
    assert out.values[:, 1].max() == pytest.approx(2.0, rel=1e-6)


def test_power_and_psd_units_and_relation() -> None:
    power = spectrogram_dataset(_ds(), channel=0, segment_len=128, scaling="power")
    psd = spectrogram_dataset(_ds(), channel=0, segment_len=128, scaling="psd")
    assert power.units[1] == "mV²" and psd.units[1] == "mV²·s"
    assert power.values[:, 1].max() == pytest.approx(2.0, rel=1e-6)  # A^2 / 2
    assert psd.values[:, 1].max() > 0


def test_window_changes_leakage() -> None:
    off_bin = _ds(freq=13.3)
    a = spectrogram_dataset(off_bin, channel=0, segment_len=128, window="none", scaling="power")
    b = spectrogram_dataset(off_bin, channel=0, segment_len=128, window="hann", scaling="power")
    assert not np.allclose(a.values[:, 1], b.values[:, 1])


def test_nonuniform_x_refused_unless_resample() -> None:
    x = np.cumsum(0.01 + 0.004 * np.sin(np.arange(600)))
    with pytest.raises(ValueError, match="not uniform"):
        spectrogram_dataset(_ds(x=x, n=600), channel=0, segment_len=64)
    out = spectrogram_dataset(_ds(x=x, n=600), channel=0, segment_len=64, resample=True)
    assert out.metadata["spectralAnalysis"]["resampled"] is True


@pytest.mark.parametrize(
    "kwargs, message",
    [
        ({"segment_len": 4}, "at least 8"),
        ({"segment_len": 4096}, "cannot exceed"),
        ({"segment_len": 64, "overlap": 1.0}, "overlap"),
        ({"segment_len": 64, "window": "kaiser"}, "unsupported window"),
        ({"segment_len": 64, "scaling": "db"}, "unsupported scaling"),
        ({"segment_len": 64, "detrend": "cubic"}, "detrend"),
        ({"segment_len": 64, "x_min": 5.0, "x_max": 1.0}, "X minimum"),
        ({"segment_len": 64, "channel": 3}, "out of range"),
    ],
)
def test_refusals(kwargs: dict[str, object], message: str) -> None:
    merged: dict[str, object] = {"channel": 0, **kwargs}
    with pytest.raises(ValueError, match=message):
        spectrogram_dataset(_ds(), **merged)  # type: ignore[arg-type]


def test_too_many_cells_refused() -> None:
    with pytest.raises(ValueError, match="cells"):
        spectrogram_dataset(_ds(n=200_000), channel=0, segment_len=4096, overlap=0.99)
    assert MAX_CELLS == 2_000_000


def test_route_ok_and_refusal() -> None:
    client = TestClient(app)
    body = {"dataset": _ds(n=512).to_dict(), "channel": 0, "segment_len": 64}
    ok = client.post("/api/spectral/spectrogram", json=body)
    assert ok.status_code == 200
    assert ok.json()["labels"] == ["Frequency", "V · Spectrogram"]
    url = "/api/spectral/spectrogram"
    assert client.post(url, json={**body, "scaling": "db"}).status_code == 422
    assert client.post(url, json={**body, "overlap": 1.5}).status_code == 422
