"""XRD CSV / Origin-ASCII exporter: golden parity vs MATLAB + behaviour.

Port of MATLAB ``+utilities/writeXRDcsv.m``. Golden cases freeze the writer
output with ``IncludeMetadata=False`` (fully deterministic, parser-independent)
from ``parser.importXRDML`` on the La2NiO4 fixture. The Python writer fed the
quantized ``import_xrdml`` DataStruct must reproduce the text byte-for-byte
(both parsers yield identical 2theta/intensity arrays and countingTime=23.97).
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from quantized.datastruct import DataStruct
from quantized.io.xrd_csv import format_xrd_csv, write_xrd_csv
from quantized.io.xrdml import import_xrdml

_GOLDEN_CASES = [
    ("xrdcsv_standard_both.json", "standard", "both"),
    ("xrdcsv_standard_counts.json", "standard", "counts"),
    ("xrdcsv_standard_cps.json", "standard", "cps"),
    ("xrdcsv_origin_both.json", "origin", "both"),
]


@pytest.mark.golden
@pytest.mark.parametrize(("golden_name", "fmt", "intensity"), _GOLDEN_CASES)
def test_writer_matches_matlab(
    fixtures_dir: Path,
    load_golden: Callable[[str], dict[str, Any]],
    golden_name: str,
    fmt: str,
    intensity: str,
) -> None:
    """Writer output matches frozen MATLAB ``writeXRDcsv`` line-for-line."""
    ref = load_golden(golden_name)
    expected_lines: list[str] = ref["lines"]

    ds = import_xrdml(fixtures_dir / "xrdml_la2nio4.xrdml")  # default cps
    text = format_xrd_csv(ds, fmt=fmt, intensity=intensity, include_metadata=False)
    actual_lines = text.split("\n")

    assert len(actual_lines) == len(expected_lines), (
        f"line count {len(actual_lines)} != {len(expected_lines)}"
    )
    for i, (got, want) in enumerate(zip(actual_lines, expected_lines, strict=True)):
        assert got == want, f"line {i}: {got!r} != {want!r}"


# ── Behaviour / edge cases (no golden needed) ───────────────────────────────


def _ds(unit: str = "cps", counting_time: float | None = 2.0) -> DataStruct:
    meta: dict[str, Any] = {"x_column_name": "2-Theta", "x_column_unit": "deg"}
    if counting_time is not None:
        meta["counting_time"] = counting_time
    return DataStruct.create(
        [10.0, 20.0, 30.0],
        [[100.0], [200.0], [300.0]],
        labels=["Intensity"],
        units=[unit],
        metadata=meta,
    )


def test_standard_header_and_delimiter() -> None:
    text = format_xrd_csv(_ds(), include_metadata=False)
    lines = text.split("\n")
    assert lines[0] == "2-Theta (deg),Intensity (cps),Intensity (counts)"
    assert "," in lines[1] and "\t" not in lines[1]
    assert text.endswith("\n")


def test_origin_has_three_header_rows() -> None:
    text = format_xrd_csv(_ds(), fmt="origin", include_metadata=False)
    lines = text.split("\n")
    assert lines[0] == "2-Theta (deg)\tIntensity (cps)\tIntensity (counts)"
    assert lines[1] == "deg\tcps\tcounts"
    assert lines[2] == "X\tY\tY"


def test_both_converts_cps_to_counts() -> None:
    text = format_xrd_csv(_ds(unit="cps", counting_time=2.0), include_metadata=False)
    rows = [ln for ln in text.split("\n") if ln and not ln.startswith("#")][1:]
    # first data row: 10.000000, 100 cps, 100*2 = 200 counts
    assert rows[0] == "10.000000,100,200"


def test_both_converts_counts_to_cps_column_order() -> None:
    # Original is counts -> output columns are [cps, counts] (cps first).
    text = format_xrd_csv(
        _ds(unit="counts", counting_time=4.0), include_metadata=False
    )
    lines = text.split("\n")
    assert lines[0] == "2-Theta (deg),Intensity (cps),Intensity (counts)"
    # 100 counts / 4 s = 25 cps
    assert lines[1] == "10.000000,25,100"


def test_both_without_counting_time_writes_single_column() -> None:
    text = format_xrd_csv(
        _ds(unit="cps", counting_time=None), include_metadata=False
    )
    assert text.split("\n")[0] == "2-Theta (deg),Intensity (cps)"


def test_counts_without_counting_time_warns_and_keeps_cps() -> None:
    with pytest.warns(UserWarning, match="Cannot convert cps to counts"):
        text = format_xrd_csv(
            _ds(unit="cps", counting_time=None),
            intensity="counts",
            include_metadata=False,
        )
    # label is forced to counts even though values are the unconverted cps
    assert text.split("\n")[0] == "2-Theta (deg),Intensity (counts)"


def test_cps_without_counting_time_warns_and_keeps_counts() -> None:
    with pytest.warns(UserWarning, match="Cannot convert counts to cps"):
        format_xrd_csv(
            _ds(unit="counts", counting_time=None),
            intensity="cps",
            include_metadata=False,
        )


def test_format_is_case_insensitive() -> None:
    a = format_xrd_csv(_ds(), fmt="STANDARD", intensity="Both", include_metadata=False)
    b = format_xrd_csv(_ds(), fmt="standard", intensity="both", include_metadata=False)
    assert a == b


def test_invalid_format_raises() -> None:
    with pytest.raises(ValueError, match="Format"):
        format_xrd_csv(_ds(), fmt="json")


def test_invalid_intensity_raises() -> None:
    with pytest.raises(ValueError, match="Intensity"):
        format_xrd_csv(_ds(), intensity="raw")


def test_missing_x_metadata_defaults_to_x_axis() -> None:
    ds = DataStruct.create([1.0, 2.0], [[5.0], [6.0]], labels=["I"], units=["cps"])
    text = format_xrd_csv(ds, intensity="cps", include_metadata=False)
    assert text.split("\n")[0] == "X Axis,Intensity (cps)"


def test_metadata_block_present_and_has_export_date() -> None:
    text = format_xrd_csv(_ds(), include_metadata=True)
    lines = text.split("\n")
    assert lines[0] == "# XRD Batch Export"
    assert any(ln.startswith("# Export date:") for ln in lines)
    assert any(ln.startswith("# Counting time:") for ln in lines)


def test_write_to_disk_roundtrips(tmp_path: Path) -> None:
    out = tmp_path / "scan.csv"
    write_xrd_csv(_ds(), out, include_metadata=False)
    text = out.read_text(encoding="utf-8")
    assert text == format_xrd_csv(_ds(), include_metadata=False)


def test_write_missing_directory_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="directory does not exist"):
        write_xrd_csv(_ds(), tmp_path / "nope" / "scan.csv")
