"""Shared column-resolution primitives (quantized.io.base)."""

from __future__ import annotations

from pathlib import Path

import pytest

from quantized.io.base import NO_COLUMN, parse_col_header, read_head, resolve_column
from quantized.io.lakeshore import is_lakeshore_file

_SHORTHAND = {"field": "Magnetic Field", "moment": "Moment", "temp": "Temperature"}


def test_parse_col_header_splits_unit() -> None:
    assert parse_col_header("Magnetic Field (Oe)") == ("Magnetic Field", "Oe")
    assert parse_col_header("Temperature") == ("Temperature", "")


def test_resolve_int_and_empty() -> None:
    cols = ["A", "B", "C"]
    assert resolve_column(1, cols) == 1
    assert resolve_column("", cols) == NO_COLUMN
    with pytest.raises(IndexError):
        resolve_column(9, cols)


def test_resolve_shorthand_target_wins_when_present() -> None:
    cols = ["Time", "Magnetic Field", "Moment"]
    # shorthand "field" -> canonical "Magnetic Field"
    assert resolve_column("field", cols, _SHORTHAND, "x-axis") == 1


def test_resolve_falls_back_to_literal_spec() -> None:
    # MPMS-classic naming: the column is literally "Field", and the shorthand
    # target "Magnetic Field" is absent -> resolve must fall back to the literal.
    cols = ["Time", "Field", "Temperature", "Long Moment"]
    assert resolve_column("field", cols, _SHORTHAND, "x-axis") == 1
    # "moment" -> "Moment" absent -> partial match on the literal needle.
    assert resolve_column("moment", cols, _SHORTHAND, "y-axis") == 3


def test_resolve_partial_shortest_name_wins() -> None:
    cols = ["Long Moment", "Trans Moment"]
    # both contain "moment"; the shorter canonical name wins.
    assert resolve_column("moment", cols, _SHORTHAND) == 0


def test_resolve_unknown_raises() -> None:
    with pytest.raises(KeyError):
        resolve_column("pressure", ["A", "B"], _SHORTHAND)


# --- P0.4: bounded sniffer reads (the class fix, not just the two named sniffers) --


def test_read_head_never_reads_past_the_cap(tmp_path: Path) -> None:
    """The whole point of ``read_head``: it must not pull bytes past ``nbytes``
    into memory, however large the file is. A marker placed far beyond the cap
    must never show up in the returned text."""
    head = "A" * 100
    tail_marker = "MARKER"
    path = tmp_path / "big.bin"
    path.write_bytes((head + "B" * 200_000 + tail_marker).encode("latin-1"))
    got = read_head(path, 100)
    assert got == head
    assert tail_marker not in got


def test_read_head_handles_a_file_shorter_than_the_cap(tmp_path: Path) -> None:
    path = tmp_path / "short.txt"
    path.write_text("hello", encoding="latin-1")
    assert read_head(path, 4096) == "hello"


def test_lakeshore_sniff_ignores_content_beyond_the_head_cap(tmp_path: Path) -> None:
    """Regression for the P0.4 bounded-sniffer-read fix: a content sniffer must
    only ever see the first ~2 KB of a file, not the whole thing.

    Constructed so a whole-file read would give the WRONG answer: the
    "Lake Shore" vendor marker sits on line 1 (inside the 2 KB sniff window),
    but the column-name marker that would confirm it as VSM data sits ~80 KB
    in -- past the window. A sniffer that (re-)reads the entire file would see
    "Temperature" anyway and misclassify this huge, unrelated file as Lake
    Shore VSM data; a properly bounded sniffer must not, so this must be
    False. This is deterministic (byte layout), not a timing check.
    """
    filler = "x," * 40_000  # ~80 KB, well past the 2048-byte sniff cap
    content = f"Lake Shore 7400 VSM\n{filler}\nTemperature,Moment\n1,2\n"
    path = tmp_path / "huge.csv"
    path.write_text(content, encoding="latin-1")
    assert is_lakeshore_file(path) is False
