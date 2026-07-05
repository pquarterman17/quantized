"""Origin export (CSV + .ogs LabTalk script): golden parity vs MATLAB.

Port of ``+utilities/exportOriginScript.m``. The golden freezes the writer's
output (line arrays) on the XRDML fixture with explicit book/sheet names. The
``.ogs`` ``// Date:`` line is a wall-clock timestamp and is exempted; every
other line — and the whole CSV — must match byte-for-byte.
Regenerate via ``tools/matlab/freeze_export_extra.m``.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from quantized.io.origin import GraphSpec, format_origin_script
from quantized.io.xrdml import import_xrdml


@pytest.mark.golden
def test_origin_export_matches_matlab(
    fixtures_dir: Path,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    ref = load_golden("origin_export.json")
    ds = import_xrdml(fixtures_dir / "xrdml_la2nio4.xrdml")

    csv_text, ogs_text = format_origin_script(
        ds,
        csv_name=ref["csv_name"],
        book_name=ref["book"],
        sheet_name=ref["sheet"],
        make_graph=True,
        created="",
    )

    assert csv_text.splitlines() == ref["csv"]

    actual = ogs_text.splitlines()
    expected = ref["ogs"]
    assert len(actual) == len(expected)
    for a, e in zip(actual, expected, strict=True):
        if e.startswith("// Date:"):
            continue  # non-deterministic timestamp
        assert a == e


def test_origin_yerr_designation() -> None:
    # A label that looks like an error column gets LabTalk type 3 (yErr).
    from quantized.datastruct import DataStruct

    ds = DataStruct.create(
        [1.0, 2.0],
        [[10.0, 0.1], [20.0, 0.2]],
        labels=["R", "dR"],
        units=["", ""],
        metadata={"x_column_name": "Q", "x_column_unit": "1/A"},
    )
    _, ogs = format_origin_script(ds, make_graph=False)
    assert "wks.col2.type = 1;  // Y" in ogs  # R -> Y
    assert "wks.col3.type = 3;  // yErr" in ogs  # dR -> yErr


def _three_channel_ds() -> Any:
    """3-channel dataset (X + Y1/Y2/Y3 -> worksheet cols 1,2,3,4) for the
    item 26 plot-state GRAPH block tests."""
    from quantized.datastruct import DataStruct

    return DataStruct.create(
        [1.0, 2.0, 3.0],
        [[10.0, 100.0, 1.0], [20.0, 200.0, 2.0], [30.0, 300.0, 3.0]],
        labels=["Y1", "Y2", "Y3"],
        units=["A", "B", "C"],
        metadata={"x_column_name": "Time", "x_column_unit": "s"},
    )


def test_origin_graph_default_view() -> None:
    # graph=GraphSpec() with y_keys=None -> all channels, one grouped plotxy.
    ds = _three_channel_ds()
    _, ogs = format_origin_script(ds, make_graph=True, graph=GraphSpec())
    assert "plotxy iy:=(1,2):(1,3):(1,4) plot:=201 ogl:=[<new>];" in ogs
    assert 'xb.text$ = "Time (s)";' in ogs
    # 3 primary channels -> no single-series yl.text$ label is emitted.
    assert "yl.text$" not in ogs


def test_origin_graph_single_channel_labels_y_axis() -> None:
    ds = _three_channel_ds()
    _, ogs = format_origin_script(ds, make_graph=True, graph=GraphSpec(y_keys=(1,)))
    assert "plotxy iy:=(1,3) plot:=201 ogl:=[<new>];" in ogs
    assert 'yl.text$ = "Y2 (B)";' in ogs


def test_origin_graph_log_axes() -> None:
    ds = _three_channel_ds()
    _, ogs = format_origin_script(
        ds, make_graph=True, graph=GraphSpec(y_keys=(0,), x_log=True, y_log=True)
    )
    assert "layer.x.type = 1;  // Log X" in ogs
    assert "layer.y.type = 1;  // Log Y" in ogs


def test_origin_graph_custom_lims() -> None:
    ds = _three_channel_ds()
    _, ogs = format_origin_script(
        ds,
        make_graph=True,
        graph=GraphSpec(y_keys=(0,), x_lim=(0.5, 12.0), y_lim=(-3.0, 250.0)),
    )
    assert "layer.x.from = 0.5;" in ogs
    assert "layer.x.to = 12;" in ogs
    assert "layer.y.from = -3;" in ogs
    assert "layer.y.to = 250;" in ogs


def test_origin_graph_x_key_uses_value_channel() -> None:
    # x_key=1 -> X comes from worksheet col 3 (Y2), not col 1 (time).
    ds = _three_channel_ds()
    _, ogs = format_origin_script(
        ds, make_graph=True, graph=GraphSpec(y_keys=(0,), x_key=1)
    )
    assert "plotxy iy:=(3,2) plot:=201 ogl:=[<new>];" in ogs
    assert 'xb.text$ = "Y2 (B)";' in ogs


def test_origin_graph_y2_split() -> None:
    # y_keys=(0,1,2), y2_keys=(2,) -> primary (0,1) on the left, channel 2 on
    # a secondary right-Y layer via "layer -nr" + a second plotxy into it.
    # The secondary plotxy references the worksheet explicitly via qzbk$ (the
    # book's post-impASC short name) because the GRAPH is the active window by
    # then -- verified live in OriginPro (a bare (1,4) range fails to resolve).
    ds = _three_channel_ds()
    _, ogs = format_origin_script(
        ds,
        make_graph=True,
        graph=GraphSpec(y_keys=(0, 1, 2), y2_keys=(2,)),
    )
    assert "string qzbk$ = page.name$;" in ogs  # captured after impASC
    assert "plotxy iy:=(1,2):(1,3) plot:=201 ogl:=[<new>];" in ogs
    assert "layer -nr;  // new right-Y layer, linked X" in ogs
    assert "plotxy iy:=[%(qzbk$)]data!(1,4) plot:=201 ogl:=2!;" in ogs
    assert "page.active = 2;  // operate on the new right-Y layer below" in ogs
    # A "layer -nr" layer has no title object -> label -yr, not yr.text$.
    assert 'label -yr "Y3 (C)";' in ogs


def test_origin_graph_y2_all_channels_falls_back_to_single_axis() -> None:
    # No primary channels to anchor a right-axis split against -> everything
    # renders on the single default axis instead (no "layer -nr").
    ds = _three_channel_ds()
    _, ogs = format_origin_script(
        ds,
        make_graph=True,
        graph=GraphSpec(y_keys=(0, 1), y2_keys=(0, 1)),
    )
    assert "layer -nr" not in ogs
    assert "plotxy iy:=(1,2):(1,3) plot:=201 ogl:=[<new>];" in ogs


def test_origin_graph_rejects_out_of_range_index() -> None:
    # An out-of-range or negative channel index would emit a plotxy referencing
    # a worksheet column that was never declared -> raise instead of a broken
    # .ogs (the route turns this into a 422).
    ds = _three_channel_ds()  # 3 value channels -> valid indices 0..2
    bad_specs = [
        GraphSpec(y_keys=(0, 7)),  # out of range
        GraphSpec(y_keys=(0, -2)),  # negative
        GraphSpec(x_key=9, y_keys=(0,)),  # bad x_key
        GraphSpec(y_keys=(0,), y2_keys=(5,)),  # bad y2 index
    ]
    for bad in bad_specs:
        with pytest.raises(ValueError, match="out of range"):
            format_origin_script(ds, make_graph=True, graph=bad)


def test_origin_graph_skips_non_finite_limits() -> None:
    # NaN/Inf axis bounds must not format as invalid LabTalk literals -- the
    # limit line is simply omitted (Origin auto-scales that axis).
    ds = _three_channel_ds()
    _, ogs = format_origin_script(
        ds,
        make_graph=True,
        graph=GraphSpec(y_keys=(0,), x_lim=(float("nan"), 5.0), y_lim=(0.0, float("inf"))),
    )
    assert "nan" not in ogs and "inf" not in ogs
    assert "layer.x.from" not in ogs  # x_lim had a NaN -> whole pair skipped
    assert "layer.y.from" not in ogs  # y_lim had an Inf -> whole pair skipped


def test_origin_graph_respects_make_graph_false() -> None:
    # make_graph=False suppresses the graph block even when a spec is given.
    ds = _three_channel_ds()
    _, ogs = format_origin_script(ds, make_graph=False, graph=GraphSpec())
    assert "plotxy" not in ogs
    assert "layer -nr" not in ogs


def test_origin_graph_quoting_safety() -> None:
    # A label containing a double-quote is escaped in the axis title, same
    # guard as the existing wks.col*.lname$ quoting.
    from quantized.datastruct import DataStruct

    ds = DataStruct.create(
        [1.0, 2.0],
        [[1.0], [2.0]],
        labels=['Weird "Y"'],
        units=[""],
        metadata={"x_column_name": "X"},
    )
    _, ogs = format_origin_script(ds, make_graph=True, graph=GraphSpec())
    assert 'yl.text$ = "Weird \\"Y\\"";' in ogs
