"""Dataset-level spectral workbench contract."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.spectral_workbench import spectral_workbench
from quantized.datastruct import DataStruct


def _dataset(*, irregular: bool = False) -> DataStruct:
    x = np.linspace(0.0, 2.55, 256)
    if irregular:
        x = x + 0.001 * np.sin(np.linspace(0.0, 12.0, x.size))
    values = np.column_stack(
        [
            np.sin(2 * np.pi * 5 * x) + 0.2 * np.sin(2 * np.pi * 30 * x),
            np.sin(2 * np.pi * 5 * (x - 0.03)),
        ]
    )
    return DataStruct.create(
        x,
        values,
        labels=["signal", "reference"],
        units=["V", "V"],
        metadata={"xLabel": "Time", "xUnit": "s"},
    )


def test_fft_returns_an_ordinary_plottable_dataset_with_units() -> None:
    out = spectral_workbench(
        _dataset(),
        operation="fft",
        channels=[0, 1],
        output_type="psd",
        window="hanning",
    )
    assert out.n_channels == 2
    assert out.n_points == out.values.shape[0]
    assert out.labels == ("signal · PSD", "reference · PSD")
    assert out.units == ("V²·s", "V²·s")
    assert out.metadata["xLabel"] == "Frequency"
    assert out.metadata["xUnit"] == "1/s"
    assert out.metadata["spectralAnalysis"]["sourceLabels"] == ["signal", "reference"]


def test_importer_axis_metadata_is_resolved_and_replaced_for_spectrum() -> None:
    source = _dataset()
    source = DataStruct.create(
        source.time,
        source.values,
        labels=source.labels,
        units=source.units,
        metadata={"x_column_name": "2-Theta", "x_column_unit": "deg"},
    )
    out = spectral_workbench(source, operation="fft", channels=[0])
    assert out.metadata["x_column_name"] == "Frequency"
    assert out.metadata["x_column_unit"] == "1/deg"
    assert out.metadata["xUnit"] == "1/deg"


def test_reciprocal_source_axis_gets_a_readable_frequency_unit() -> None:
    source = _dataset()
    source = DataStruct.create(
        source.time,
        source.values,
        labels=source.labels,
        units=source.units,
        metadata={"x_column_unit": "Å⁻¹"},
    )
    out = spectral_workbench(source, operation="fft", channels=[0])
    assert out.metadata["x_column_unit"] == "Å"


def test_output_drops_stale_row_and_channel_metadata() -> None:
    source = _dataset()
    source = DataStruct.create(
        source.time,
        source.values,
        labels=source.labels,
        units=source.units,
        metadata={
            "x_column_name": "Time",
            "text_columns": {"sample": ["a"] * source.n_points},
            "all_column_names": ["Time", "signal", "reference"],
            "default_value_channels": [1],
            "error_channels": {0: 1},
            "error_roles": [{"channel": 1, "target": 0, "axis": "y", "side": "both"}],
        },
    )
    out = spectral_workbench(source, operation="fft", channels=[0])
    for key in (
        "text_columns",
        "all_column_names",
        "default_value_channels",
        "error_channels",
        "error_roles",
    ):
        assert key not in out.metadata


def test_filter_preserves_x_and_attenuates_the_high_frequency_component() -> None:
    source = _dataset()
    out = spectral_workbench(
        source,
        operation="filter",
        channels=[0],
        filter_type="lowpass",
        cutoff=[10.0],
        detrend="none",
    )
    assert np.array_equal(out.time, source.time)
    assert out.labels == ("signal · Filtered",)
    assert out.units == ("V",)
    assert np.var(out.values[:, 0]) < np.var(source.values[:, 0])
    assert out.metadata["spectralAnalysis"]["parameters"]["window"] == "none"


def test_filter_honors_mean_and_linear_detrend_as_distinct_modes() -> None:
    source = _dataset()
    mean = spectral_workbench(
        source, operation="filter", channels=[0], filter_type="lowpass", cutoff=[10], detrend="mean"
    )
    linear = spectral_workbench(
        source,
        operation="filter",
        channels=[0],
        filter_type="lowpass",
        cutoff=[10],
        detrend="linear",
    )
    assert not np.allclose(mean.values, linear.values)
    assert float(np.mean(mean.values[:, 0])) == pytest.approx(float(np.mean(source.values[:, 0])))


def test_filter_diagnostics_are_preview_only_and_json_safe() -> None:
    plain = spectral_workbench(
        _dataset(), operation="filter", channels=[0], filter_type="lowpass", cutoff=[10]
    )
    preview = spectral_workbench(
        _dataset(),
        operation="filter",
        channels=[0],
        filter_type="lowpass",
        cutoff=[10],
        include_diagnostics=True,
    )
    assert "filterDiagnostics" not in plain.metadata
    diagnostics = preview.metadata["filterDiagnostics"]
    assert isinstance(diagnostics["frequency"], list)
    assert isinstance(diagnostics["transfer"], list)
    assert len(diagnostics["frequency"]) == len(diagnostics["transfer"])


def test_filter_diagnostics_are_bounded_for_large_inputs() -> None:
    x = np.linspace(0.0, 20.0, 20_001)
    source = DataStruct.create(
        x,
        np.sin(2 * np.pi * x)[:, None],
        labels=["signal"],
        units=["V"],
    )
    preview = spectral_workbench(
        source,
        operation="filter",
        channels=[0],
        filter_type="lowpass",
        cutoff=[2],
        include_diagnostics=True,
    )
    diagnostics = preview.metadata["filterDiagnostics"]
    assert len(diagnostics["frequency"]) <= 512
    assert diagnostics["frequency"][0] == 0
    assert diagnostics["frequency"][-1] > 499.0


def test_notch_default_bandwidth_is_validated_and_recorded_as_executed() -> None:
    out = spectral_workbench(
        _dataset(), operation="filter", channels=[0], filter_type="notch", cutoff=[10]
    )
    assert out.metadata["spectralAnalysis"]["parameters"]["bandwidth"] == pytest.approx(1.0)


def test_cross_correlation_reports_lag_in_x_units() -> None:
    out = spectral_workbench(_dataset(), operation="correlation", channels=[0, 1])
    assert out.labels == ("Correlation · signal vs reference",)
    assert out.metadata["xLabel"] == "Lag"
    assert out.metadata["xUnit"] == "s"
    assert abs(float(out.metadata["peakLag"])) < 0.1
    assert float(out.metadata["peakCorrelation"]) > 0.9


def test_cross_correlation_refuses_a_zero_energy_signal() -> None:
    source = _dataset()
    constant = DataStruct.create(
        source.time,
        np.column_stack([np.ones(source.n_points), source.values[:, 1]]),
        labels=source.labels,
        units=source.units,
    )
    with pytest.raises(ValueError, match="non-zero energy"):
        spectral_workbench(constant, operation="correlation", channels=[0, 1])


def test_irregular_x_fails_closed_until_resampling_is_explicit() -> None:
    with pytest.raises(ValueError, match="enable resampling explicitly"):
        spectral_workbench(_dataset(irregular=True), operation="fft", channels=[0])
    out = spectral_workbench(
        _dataset(irregular=True), operation="fft", channels=[0], resample=True
    )
    assert out.metadata["spectralAnalysis"]["resampled"] is True


def test_nonmonotonic_x_is_refused_even_when_resampling_is_requested() -> None:
    source = _dataset()
    x = np.concatenate([source.time[:128], source.time[:128][::-1]])
    values = np.concatenate([source.values[:128], source.values[:128][::-1]], axis=0)
    loop = DataStruct.create(x, values, labels=source.labels, units=source.units)
    with pytest.raises(ValueError, match="strictly monotonic"):
        spectral_workbench(loop, operation="fft", channels=[0], resample=True)


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"operation": "correlation", "channels": [0]}, "exactly two"),
        (
            {"operation": "filter", "channels": [0], "filter_type": "bandpass", "cutoff": [20, 10]},
            "lower cutoff",
        ),
        (
            {"operation": "fft", "channels": [0], "output_type": "magnitude", "segment_len": 64},
            "only for PSD",
        ),
        (
            {"operation": "fft", "channels": [0], "output_type": "psd", "segment_len": 512},
            "cannot exceed",
        ),
        ({"operation": "fft", "channels": [0], "x_min": float("nan")}, "must be finite"),
        ({"operation": "unknown", "channels": [0]}, "unsupported spectral operation"),
    ],
)
def test_invalid_scientific_settings_fail_closed(kwargs: dict[str, object], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        spectral_workbench(_dataset(), **kwargs)  # type: ignore[arg-type]
