"""Our own XRD export (``io/xrd_csv.py``) re-imports as XRD (plot audit r2).

Before: the exported ``.csv`` went through the generic delimited parser, so a
re-import lost the technique tag (and with it the log-intensity default), the
x title's unit, and the counting time the cps/counts columns depend on."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io import import_auto
from quantized.io.xrd_csv import format_xrd_csv


def _scan(unit: str = "counts") -> DataStruct:
    return DataStruct.create(
        np.array([20.0, 20.02, 20.04, 20.06]),
        np.array([[100.0], [250.0], [9000.0], [120.0]]),
        labels=["Intensity"],
        units=[unit],
        metadata={
            "source": "/data/run 1.xrdml",
            "parser_name": "import_xrdml",
            "x_column_name": "2-Theta",
            "x_column_unit": "deg",
            "sample_name": "film A",
            "wavelength_a": 1.5406,
            "start_angle": 20.0,
            "end_angle": 20.06,
            "counting_time": 0.5,
        },
    )


def _write(tmp_path: Path, text: str, name: str = "export.csv") -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8", newline="")
    return path


@pytest.mark.parametrize("fmt", ["standard", "origin"])
def test_export_reimports_as_xrd(tmp_path: Path, fmt: str) -> None:
    ds = import_auto(_write(tmp_path, format_xrd_csv(_scan(), fmt=fmt)))
    assert ds.metadata["parser_name"] == "import_xrd_export"
    assert ds.metadata["technique"] == "xrd.powder"
    assert ds.metadata["x_column_name"] == "2-Theta"
    assert ds.metadata["x_column_unit"] == "deg"
    assert ds.metadata["counting_time"] == pytest.approx(0.5)
    assert ds.metadata["wavelength_a"] == pytest.approx(1.5406)
    assert ds.metadata["sample_name"] == "film A"
    assert ds.metadata["exported_from"] == "/data/run 1.xrdml"
    assert ds.labels == ("Intensity", "Counts") and ds.units == ("cps", "counts")
    np.testing.assert_allclose(ds.time, [20.0, 20.02, 20.04, 20.06])
    np.testing.assert_allclose(ds.values[:, 1], [100.0, 250.0, 9000.0, 120.0])
    np.testing.assert_allclose(ds.values[:, 0], [200.0, 500.0, 18000.0, 240.0])


@pytest.mark.parametrize("fmt", ["standard", "origin"])
@pytest.mark.parametrize("intensity", ["both", "counts", "cps"])
def test_reexport_is_stable(tmp_path: Path, fmt: str, intensity: str) -> None:
    first = format_xrd_csv(_scan(), fmt=fmt, intensity=intensity, include_metadata=False)
    full = format_xrd_csv(_scan(), fmt=fmt, intensity=intensity)
    again = import_auto(_write(tmp_path, full))
    assert format_xrd_csv(again, fmt=fmt, intensity=intensity, include_metadata=False) == first


def test_a_single_column_export_keeps_its_unit(tmp_path: Path) -> None:
    text = format_xrd_csv(_scan(), intensity="counts")
    ds = import_auto(_write(tmp_path, text))
    assert ds.labels == ("Intensity",) and ds.units == ("counts",)


def test_an_export_without_its_header_block_stays_generic(tmp_path: Path) -> None:
    """The marker line is the proof; a bare two-column CSV is never guessed."""
    text = format_xrd_csv(_scan(), include_metadata=False)
    ds = import_auto(_write(tmp_path, text))
    assert ds.metadata["parser_name"] == "import_csv"


def test_a_generic_csv_is_untouched(tmp_path: Path) -> None:
    ds = import_auto(_write(tmp_path, "# a note\nt,y\n1,2\n3,4\n"))
    assert ds.metadata["parser_name"] == "import_csv"
