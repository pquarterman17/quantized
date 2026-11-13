"""A graph curve whose column the file records on another sheet than the one
its binding uses is reported, never re-bound (``opj_curve_sheets``).

Synthetic fixture (layouts as in ``origin_opj_fixtures`` and
``test_io_origin_figures_opj_curves``): workbook ``Book1`` has two sheets,
each with columns A (X) and B. Property-block object ids: sheet 1 A=1, B=2;
sheet 2 A=11, B=12. The datasets ``Book1_B`` / ``Book1_B@2`` name their X
by id (1 / 11), which binds sheet id 2 to the second sheet. Graph1 plots two
curves: column id 12 (B on sheet 2) and the decoy id 2 (B on sheet 1). Both
come out as ``{book: Book1, y: B}``: the binding names the workbook only.
"""

from __future__ import annotations

import struct

from origin_opj_fixtures import (
    DOUBLE,
    block,
    dataset,
    dataset_header,
    label_block,
    project,
    prop_block,
    sheet_header,
    window_header,
)
from quantized.io.origin_project.fidelity import assess_origin_figures
from quantized.io.origin_project.figures import extract_figures


def _doubles(values: list[float]) -> bytes:
    return b"".join(struct.pack("<d", v) for v in values)


def _xy(sheet: str, x_id: int) -> list[bytes]:
    return [
        dataset(dataset_header(f"Book1_A{sheet}", DOUBLE, total=2, used=2), _doubles([1, 2])),
        dataset(
            dataset_header(f"Book1_B{sheet}", DOUBLE, total=2, used=2, x_ref=x_id),
            _doubles([3, 4]),
        ),
    ]


def _sheet(name: str, first_id: int) -> bytes:
    return (
        sheet_header(name, cols=2, rows=2)
        + prop_block("A", 3, DOUBLE, value_format=0, object_id=first_id)
        + label_block("x", "")
        + prop_block("B", 0, DOUBLE, value_format=0, object_id=first_id + 1)
        + label_block("y", "")
    )


def _layer() -> bytes:
    p = bytearray(240)
    p[0:4] = bytes([0, 0, 0x1F, 0])
    struct.pack_into("<dddd", p, 15, 0.0, 1.0, 0.0, 0.0)
    struct.pack_into("<dd", p, 58, 0.0, 1.0)
    return block(bytes(p))


def _curve(cid: int) -> bytes:
    anchor = bytearray(519)
    anchor[0:4] = b"\x01\x00\x00\x00"
    struct.pack_into("<H", anchor, 4, cid)
    dataplot = bytearray(852)
    dataplot[0:8] = b"\x58\x00\x00\x00\x98\x03\x40\xb3"
    return block(bytes(anchor)) + block(bytes(dataplot))


def _project(*curve_ids: int, second_sheet: bool = True) -> bytes:
    datasets = _xy("", 1) + (_xy("@2", 11) if second_sheet else [])
    windows = window_header("Book1") + _sheet("Sheet1", 1)
    if second_sheet:
        windows += _sheet("Sheet2", 11)
    windows += window_header("Graph1") + _layer() + b"".join(_curve(c) for c in curve_ids)
    return project(datasets, windows)


def test_curve_recorded_on_another_sheet_is_noted_and_keeps_its_binding() -> None:
    (fig,) = extract_figures(_project(12, 2))
    # The binding is unchanged: both curves read Book1 / B.
    assert [(c["book"], c["y"]) for c in fig["curves"]] == [("Book1", "B"), ("Book1", "B")]
    assert fig["curve_sheet_notes"] == [
        {"book": "Book1", "x": "A", "y": "B", "recorded": "Book1@2"}
    ]
    (assessed,), manifest = assess_origin_figures([fig], container="opj")
    # The wording is the frontend's (it knows which books were imported).
    assert "curve_sheet_mismatch" in assessed["fidelity"]["omissions"]
    assert "curve_sheet_mismatch" in manifest["omissions"]
    assert "notes" not in assessed["fidelity"]


def test_curves_on_the_sheet_their_binding_uses_carry_no_note() -> None:
    # Decoy: id 2 is B on sheet 1, the sheet the binding uses.
    (fig,) = extract_figures(_project(2))
    assert "curve_sheet_notes" not in fig
    (assessed,), manifest = assess_origin_figures([fig], container="opj")
    assert "curve_sheet_mismatch" not in assessed["fidelity"]["omissions"]
    assert "curve_sheet_mismatch" not in manifest["omissions"]
    # A single-sheet book: nothing to compare.
    (single,) = extract_figures(_project(2, second_sheet=False))
    assert "curve_sheet_notes" not in single
