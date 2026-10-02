"""SIMS import: the x-axis unit/name and a two-row (names + units) header.

Synthetic fixtures shaped like vendor exports (a banner whose "Num of Cycles"
line contains the letters "um"; a raw-counts export with species names on one
row and "counts/sec" on the row below).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from quantized.io.sims import import_sims


def _write(tmp_path: Path, name: str, text: str) -> Path:
    p = tmp_path / name
    p.write_text(text, encoding="utf-8")
    return p


def test_paired_fixture_depth_unit_is_the_column_unit(fixtures_dir: Path) -> None:
    # Its units row says (nm); the banner's "Num of Cycles" must not read as "um".
    ds = import_sims(fixtures_dir / "sims_barrier.csv")
    assert ds.metadata["x_column_unit"] == "nm"


@pytest.mark.parametrize(
    ("banner", "depth_header", "unit"),
    [
        ("Num of Cycles,160", "Depth (nm)", "nm"),
        ("Sputtered area: 250x250 um", "Depth (nm)", "nm"),
        ("Num of Cycles,160", "Depth (um)", "um"),
        ("Num of Cycles,160", "Depth (microns)", "um"),
        ("Num of Cycles,160", "Depth", "nm"),
        ("Depth in um", "Depth", "um"),
    ],
)
def test_depth_unit_matches_whole_words_column_first(
    tmp_path: Path, banner: str, depth_header: str, unit: str
) -> None:
    header = f"{depth_header},H (atoms/cc),O (atoms/cc)"
    text = f"SIMS Lab\n{banner}\n{header}\n0,1e21,2e22\n1,2e21,3e22\n"
    ds = import_sims(_write(tmp_path, "p.csv", text))
    assert ds.metadata["x_column_unit"] == unit


def test_two_row_header_keeps_species_names_and_units(tmp_path: Path) -> None:
    text = (
        "SIMS Test Lab\nDrawn Curves,2\nNum of Cycles,3\n"
        "Cycle,30Si,27Al\n"
        ",counts/sec,counts/sec\n"
        "1,10,20\n2,11,21\n3,12,22\n"
    )
    ds = import_sims(_write(tmp_path, "raw.csv", text))
    assert ds.labels == ("Si", "Al")
    assert ds.units == ("counts/sec", "counts/sec")
    assert ds.metadata["x_column_name"] == "Cycle"
    assert ds.metadata["x_column_unit"] == ""
    assert ds.time.tolist() == [1.0, 2.0, 3.0]


def test_two_row_header_with_bare_parenthesised_units(tmp_path: Path) -> None:
    text = "SIMS\nDepth,H,O\n(nm),(atoms/cc),(atoms/cc)\n0,1e21,2e22\n1,2e21,3e22\n"
    ds = import_sims(_write(tmp_path, "u.csv", text))
    assert ds.labels == ("H", "O")
    assert ds.units == ("atoms/cc", "atoms/cc")
    assert ds.metadata["x_column_name"] == "Depth"
    assert ds.metadata["x_column_unit"] == "nm"
