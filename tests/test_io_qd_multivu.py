"""Quantum Design MultiVu files from the non-VSM options (round-4 import audit).

PPMS Resistivity / ETO, Heat Capacity and ACMS write the same [Header]/[Data]
layout as the VSM, so ``is_qd_file`` routes them to ``import_qd_vsm`` -- which
then raised ``KeyError: cannot resolve y-axis 'moment'`` and the whole import
failed. ``import_ppms`` already degraded for the header-less shape; the
[Header] shape now degrades too: the measured columns become the curves and
the sweep columns stay available as companions. A file with no magnetic
channel is no longer tagged magnetometry.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from quantized.io.registry import import_auto

_ETO = (
    "[Header]\nTITLE,film\nBYAPP,Resistivity,1.0\n[Data]\n"
    "Comment,Time Stamp (sec),Temperature (K),Magnetic Field (Oe),"
    "Resistance Ch1 (Ohms),Resistance Ch2 (Ohms)\n"
    ",1,300,0,10.5,\n,2,290,0,10.2,\n,3,280,0,9.9,\n"
)

_HEAT_CAPACITY = (
    "[Header]\nBYAPP,HeatCapacity,1.0\n[Data]\n"
    "Comment,Time Stamp (sec),Sample Temp (Kelvin),Field (Oersted),Samp HC (µJ/K)\n"
    ",1,2.0,0,1.5\n,2,3.0,0,2.5\n,3,4.0,0,3.5\n"
)

_ACMS = (
    "[Header]\nBYAPP,ACMS,1.0\n[Data]\n"
    "Comment,Time Stamp (sec),Temperature (K),Magnetic Field (Oe),M' (emu),M'' (emu)\n"
    ",1,10,100,1e-3,1e-5\n,2,20,100,5e-4,2e-5\n,3,30,100,2e-4,3e-5\n"
)


def _write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "run.dat"
    path.write_text(text, encoding="utf-8")
    return path


def _default_curves(ds) -> list[str]:  # type: ignore[no-untyped-def]
    picks = ds.metadata.get("default_value_channels", range(len(ds.labels)))
    return [ds.labels[i] for i in picks]


def test_resistivity_file_imports_as_transport(tmp_path: Path) -> None:
    ds = import_auto(_write(tmp_path, _ETO))
    assert ds.metadata["parser_name"] == "import_qd_vsm"
    assert ds.metadata["technique"] == "transport"
    # Field is constant, so the x axis is the temperature sweep.
    assert ds.metadata["x_column_name"] == "Temperature"
    assert ds.time.tolist() == [300.0, 290.0, 280.0]
    assert _default_curves(ds) == ["Resistance Ch1"]
    assert ds.values[:, ds.labels.index("Resistance Ch1")].tolist() == [10.5, 10.2, 9.9]
    # The sweep columns are still there to pick as x.
    assert {"Magnetic Field", "Time Stamp"} <= set(ds.labels)


def test_heat_capacity_file_imports_and_is_not_magnetometry(tmp_path: Path) -> None:
    ds = import_auto(_write(tmp_path, _HEAT_CAPACITY))
    assert ds.metadata["x_column_name"] == "Sample Temp"
    assert _default_curves(ds) == ["Samp HC"]
    assert ds.units[ds.labels.index("Samp HC")] == "µJ/K"
    assert ds.metadata["technique"] == "generic"


def test_acms_file_keeps_its_magnetometry_tag(tmp_path: Path) -> None:
    ds = import_auto(_write(tmp_path, _ACMS))
    assert _default_curves(ds) == ["M'", "M''"]
    assert ds.metadata["technique"] == "magnetometry.mvst"


def test_an_explicit_missing_column_still_raises(tmp_path: Path) -> None:
    """Only the DEFAULT axes degrade; a caller naming a column gets the error."""
    from quantized.io.qd import import_qd_vsm

    with pytest.raises(KeyError):
        import_qd_vsm(_write(tmp_path, _ETO), y_axis="Hall Voltage")


def test_plain_logger_dat_is_not_magnetometry(tmp_path: Path) -> None:
    """The header-less PPMS sniffer takes any "temperature" CSV; with no
    magnetic channel the tag is generic, not magnetometry.mvst."""
    path = tmp_path / "log.dat"
    path.write_text("Time (s),Temperature (K),Pressure (mbar)\n1,300,1e-6\n2,301,2e-6\n")
    ds = import_auto(path)
    assert ds.metadata["parser_name"] == "import_ppms"
    assert ds.metadata["technique"] == "generic"
