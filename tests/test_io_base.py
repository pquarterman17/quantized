"""Shared column-resolution primitives (quantized.io.base)."""

from __future__ import annotations

import pytest

from quantized.io.base import NO_COLUMN, parse_col_header, resolve_column

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
