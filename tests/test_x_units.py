"""Shared x-unit lookup (audit P2.5 review finding #7): one helper,
``quantized.x_units.x_unit_of``, used by both ``calc.resample_align`` and
``io.consolidated`` so the two agree on what a dataset's x unit IS -- they
used to each carry their own copy, with a different key order.
"""

from __future__ import annotations

from quantized.calc.resample_align import x_unit_of as calc_x_unit_of
from quantized.datastruct import DataStruct
from quantized.io.consolidated import _resolve_x_unit
from quantized.x_units import x_unit_of


def _ds(metadata: dict[str, object]) -> DataStruct:
    return DataStruct.create([0.0, 1.0], [0.0, 1.0], metadata=metadata)


def test_checks_xunit_first_then_x_column_unit_then_xcolumnunit() -> None:
    assert x_unit_of(_ds({"xUnit": "K"})) == "K"
    assert x_unit_of(_ds({"x_column_unit": "Oe"})) == "Oe"
    assert x_unit_of(_ds({"xColumnUnit": "1/A"})) == "1/A"
    # When more than one is set, xUnit wins -- io.consolidated's existing order.
    assert x_unit_of(_ds({"xUnit": "K", "x_column_unit": "Oe"})) == "K"


def test_blank_and_missing_are_unknown() -> None:
    assert x_unit_of(_ds({})) == ""
    assert x_unit_of(_ds({"xUnit": "   "})) == ""


def test_checks_the_nested_parser_specific_blob_too() -> None:
    assert x_unit_of(_ds({"parser_specific": {"xUnit": "Oe"}})) == "Oe"
    assert x_unit_of(_ds({"parserSpecific": {"x_column_unit": "K"}})) == "K"


def test_key_order_prefers_xunit_over_x_column_unit_when_both_set() -> None:
    """The two copies this replaced disagreed on key order (calc checked
    ``x_column_unit`` first, io checked ``xUnit`` first) -- pick a metadata
    dict where that would have produced two different answers, and confirm
    every caller now gets the same one."""
    ds = _ds({"x_column_unit": "Oe", "xUnit": "K"})
    assert x_unit_of(ds) == "K"
    assert calc_x_unit_of(ds) == "K"
    assert _resolve_x_unit(ds) == "K"


def test_calc_and_io_both_resolve_through_the_same_helper() -> None:
    """calc.resample_align.x_unit_of and io.consolidated._resolve_x_unit must
    never disagree about a dataset's x unit -- that was the whole bug."""
    ds = _ds({"xUnit": "K", "xColumnUnit": "1/A"})
    assert calc_x_unit_of(ds) == x_unit_of(ds) == _resolve_x_unit(ds) == "K"
