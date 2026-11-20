"""Origin error-bar plots drawn on the curve they decorate (``opju_error_bars``).

Synthetic tests lock the decoded rule (record offsets 23 / 35-38 / 76; the
evidence is ``docs/origin_re/error_bars.md``). The ``realdata`` tests check it
on the owner corpus against Origin's own COM plot lists and on the public
corpus against the columns' own long names; no corpus value is committed.
"""

from __future__ import annotations

import json
import os
import struct
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io.origin_project.figures import extract_figures
from quantized.io.origin_project.opj_curves import (
    book_column_designations,
    book_x_columns,
    column_id_map,
    extract_curves,
)
from quantized.io.origin_project.opju_error_bars import (
    ErrorLink,
    attach_error_bars,
    error_link,
    link_error_plots,
)
from test_io_origin_figures_opj_curves import (
    _block,
    _blocks_of,
    _column_block,
    _curve,
    _dataplot_block,
    _layer_block,
    _synthetic_opj,
    _window_header,
)

_Y_ERR, _X_ERR = 0xE7, 0xE9


def _record(
    kind: int = _Y_ERR,
    target: int = 7,
    flags: int = 3,
    pair: bytes = b"\x30\x61",
    cid: int = 8,
    band: int = 0,
) -> bytes:
    """A 519-byte plot record: Y column ``cid`` at 4, flags at 23, the fill
    (band) flag at 28, the X (= decorated) column id at 35 with its pair at
    37, plot type at 76."""
    r = bytearray(519)
    r[0:4] = b"\x01\x00\x00\x00"
    struct.pack_into("<H", r, 4, cid)
    r[23] = flags
    r[28] = band
    struct.pack_into("<H", r, 35, target)
    r[37:39] = pair
    r[76] = kind
    return bytes(r)


# ── error_link: what a record says ───────────────────────────────────────────


def test_a_y_error_plot_names_the_curve_it_decorates() -> None:
    assert error_link(_record()) == (7, 3, "y", False)
    assert error_link(_record(flags=1)) == (7, 1, "y", False)  # the plus half
    assert error_link(_record(flags=2)) == (7, 2, "y", False)  # the minus half
    # a non-Text & Numeric column writes 10 60 for the same pair
    assert error_link(_record(pair=b"\x10\x60")) == (7, 3, "y", False)


def test_offset_28_two_is_a_filled_band() -> None:
    assert error_link(_record(band=2)) == (7, 3, "y", True)


def test_bit_0x10_of_offset_23_is_an_x_error_plot() -> None:
    assert error_link(_record(kind=_X_ERR, flags=0x13)) == (7, 3, "x", False)
    # byte 76 0xe7 with the X bit: Origin reads plot 233 (X error), not 231
    assert error_link(_record(flags=0x11)) == (7, 1, "x", False)
    assert error_link(_record(kind=_X_ERR, flags=3)) is None  # never observed


@pytest.mark.parametrize(
    "record",
    [
        _record(pair=b"\x30\x21"),  # a hidden plot: Origin draws no bars
        _record(pair=b"\x21\x61"),  # a data curve's pair
        _record(pair=b"\x10\x40"),  # unproven pair
        _record(flags=0),  # no direction
        _record(flags=0x23),  # an unread flag bit
        _record(target=0),  # no column
        _record(band=1),  # a fill value no error plot carries
        _record(kind=0xC8),  # a line plot
        _record()[:60],  # too short to hold the plot type
        None,
    ],
)
def test_anything_else_is_not_linked(record: bytes | None) -> None:
    assert error_link(record) is None


# ── link_error_plots: which curve of the layer ───────────────────────────────


def _note(y: str, reason: str = "", recorded: str = "Book1") -> dict[str, str]:
    return {"book": "Book1", "x": "A", "y": y, "recorded": recorded, "reason": reason}


def test_the_link_goes_to_the_one_kept_curve_with_that_id() -> None:
    notes = [_note("B"), _note("C", "error_bar_plot"), _note("D")]
    link_error_plots(notes, [7, 8, 9], [None, (7, 3, "y", True), None])
    assert notes[1] == {
        **_note("C", "error_bar_plot"),
        "decorates": "B",
        "direction": "3",
        "axis": "y",
        "band": "1",
    }


@pytest.mark.parametrize(
    ("notes", "cids", "links"),
    [
        # the decorated curve was left out itself
        (
            [_note("B", "hidden_in_origin"), _note("C", "error_bar_plot")],
            [7, 8],
            [None, (7, 3, "y", False)],
        ),
        # on another sheet
        (
            [_note("B", recorded="Book1@2"), _note("C", "error_bar_plot")],
            [7, 8],
            [None, (7, 3, "y", False)],
        ),
        # a hidden error plot keeps its own reason
        ([_note("B"), _note("C", "hidden_in_origin")], [7, 8], [None, (7, 3, "y", False)]),
    ],
)
def test_no_proven_curve_no_link(
    notes: list[dict[str, str]], cids: list[int], links: list[ErrorLink | None]
) -> None:
    link_error_plots(notes, cids, links)
    assert not any("decorates" in n for n in notes)
    assert [n["reason"] for n in notes][-1] != "error_bar_no_curve"


@pytest.mark.parametrize(
    ("notes", "cids", "links"),
    [
        # the layer does not plot that column
        ([_note("B"), _note("C", "error_bar_plot")], [6, 8], [None, (7, 3, "y", False)]),
        # the id names another error plot of the layer, not a curve
        (
            [_note("B"), _note("D", "error_bar_plot"), _note("C", "error_bar_plot")],
            [6, 7, 8],
            [None, (6, 3, "y", False), (7, 3, "y", False)],
        ),
    ],
)
def test_an_error_plot_naming_no_curve_draws_nothing(
    notes: list[dict[str, str]], cids: list[int], links: list[ErrorLink | None]
) -> None:
    link_error_plots(notes, cids, links)
    assert notes[-1] == _note(notes[-1]["y"], "error_bar_no_curve")


def test_a_plot_the_decoder_skipped_is_not_absent() -> None:
    """``layer_ids`` holds every plot id of the layer, decoded or not: a
    column the decoder could not bind may still be the decorated curve."""
    notes = [_note("B"), _note("C", "error_bar_plot")]
    link_error_plots(notes, [6, 8], [None, (7, 3, "y", False)], layer_ids={6, 7, 8})
    assert notes[1] == _note("C", "error_bar_plot")


# ── attach_error_bars: the bars, once the data is imported ───────────────────


def _book(cols: dict[str, list[float]], name: str = "Book1") -> DataStruct:
    names = list(cols)
    return DataStruct(
        time=np.arange(3.0),
        values=np.column_stack([cols[c] for c in names]),
        labels=tuple(names),
        units=("",) * len(names),
        metadata={"origin_book": name, "x_column_name": "A", "origin_column_names": names},
    )


def _linked(
    y: str, decorates: str, direction: str, axis: str = "y", band: str = ""
) -> dict[str, str]:
    return {
        **_note(y, "error_bar_plot"),
        "decorates": decorates,
        "direction": direction,
        "axis": axis,
        "band": band,
    }


def _fig(*notes: dict[str, str]) -> dict[str, Any]:
    return {"curves": [{"book": "Book1", "x": "A", "y": "B"}], "curve_sheet_omitted": list(notes)}


_DATA = _book({"B": [1, 2, 3], "C": [0.1, 0.2, 0.3], "D": [0.1, 0.2, 0.3], "E": [0.5, 0.5, 0.5]})


def test_a_both_ways_plot_draws_its_bars_on_the_curve() -> None:
    (out,) = attach_error_bars([_fig(_linked("C", "B", "3"))], [_DATA])
    assert out["curves"] == [{"book": "Book1", "x": "A", "y": "B", "yErr": "C"}]
    assert "curve_sheet_omitted" not in out


def test_a_plus_and_minus_pair_draws_asymmetric_bars() -> None:
    # equal halves: one symmetric column, whichever half is which
    (same,) = attach_error_bars([_fig(_linked("C", "B", "1"), _linked("D", "B", "2"))], [_DATA])
    assert same["curves"][0]["yErr"] == "C"
    # unequal halves: direction 1 is the plus half, 2 the minus half
    (diff,) = attach_error_bars([_fig(_linked("E", "B", "2"), _linked("C", "B", "1"))], [_DATA])
    assert diff["curves"] == [
        {"book": "Book1", "x": "A", "y": "B", "yErrPlus": "C", "yErrMinus": "E"}
    ]
    assert "curve_sheet_omitted" not in diff


def test_two_equal_both_ways_plots_draw_the_same_bars() -> None:
    (out,) = attach_error_bars([_fig(_linked("C", "B", "3"), _linked("D", "B", "3"))], [_DATA])
    assert out["curves"][0]["yErr"] == "C"


def test_x_error_plots_draw_horizontal_bars() -> None:
    (sym,) = attach_error_bars([_fig(_linked("C", "B", "3", axis="x"))], [_DATA])
    assert sym["curves"][0] == {"book": "Book1", "x": "A", "y": "B", "xErr": "C"}
    pair = [_linked("C", "B", "1", axis="x"), _linked("E", "B", "2", axis="x")]
    (asym,) = attach_error_bars([_fig(*pair)], [_DATA])
    assert (asym["curves"][0]["xErrPlus"], asym["curves"][0]["xErrMinus"]) == ("C", "E")
    # X and Y bars on one curve (MnN Graph10)
    (both,) = attach_error_bars(
        [_fig(_linked("C", "B", "3", axis="x"), _linked("E", "B", "3"))], [_DATA]
    )
    assert (both["curves"][0]["xErr"], both["curves"][0]["yErr"]) == ("C", "E")


def test_a_filled_error_plot_draws_a_band() -> None:
    (out,) = attach_error_bars([_fig(_linked("C", "B", "3", band="1"))], [_DATA])
    assert out["curves"][0] == {"book": "Book1", "x": "A", "y": "B", "yErr": "C", "errBand": True}
    pair = [_linked("C", "B", "1", band="1"), _linked("E", "B", "2", band="1")]
    (asym,) = attach_error_bars([_fig(*pair)], [_DATA])
    assert asym["curves"][0]["errBand"] is True


@pytest.mark.parametrize(
    "notes",
    [
        [_linked("C", "B", "3"), _linked("E", "B", "3")],  # two different both-ways plots
        [_linked("C", "B", "1")],  # half a pair
        [_linked("C", "B", "1"), _linked("C", "B", "1")],  # two plus halves
        [_linked("Z", "B", "3")],  # a column the import does not hold
        [_linked("C", "Q", "3")],  # a curve the layer does not draw
        [_linked("C", "B", "1", band="1"), _linked("E", "B", "2")],  # band on one half
        [_linked("C", "B", "3", axis="x", band="1")],  # an X band: never observed
    ],
)
def test_anything_unproven_stays_left_out(notes: list[dict[str, str]]) -> None:
    (out,) = attach_error_bars([_fig(*notes)], [_DATA])
    assert out["curves"] == [{"book": "Book1", "x": "A", "y": "B"}]
    assert out["curve_sheet_omitted"] == [_note(n["y"], "error_bar_plot") for n in notes]


def test_a_figure_without_links_is_untouched() -> None:
    fig = _fig(_note("C", "error_bar_plot"))
    assert attach_error_bars([fig], [_DATA]) == [fig]


def test_an_attached_plot_is_recovered_not_lost() -> None:
    from quantized.io.origin_project.fidelity import assess_origin_figures

    (attached,) = attach_error_bars([{**_fig(_linked("C", "B", "3")), "name": "Graph1"}], [_DATA])
    (left,) = attach_error_bars([{**_fig(_linked("C", "B", "1")), "name": "Graph2"}], [_DATA])
    (asym,) = attach_error_bars(
        [{**_fig(_linked("C", "B", "1"), _linked("E", "B", "2")), "name": "Graph3"}], [_DATA]
    )
    orphan = {**_fig(_note("C", "error_bar_no_curve")), "name": "Graph4"}
    figures, _ = assess_origin_figures([attached, left, asym, orphan], container="opju")
    assert "error_bars" in figures[0]["fidelity"]["recovered"]
    assert "error_bar_plots" not in figures[0]["fidelity"]["omissions"]
    assert "error_bars" not in figures[1]["fidelity"]["recovered"]
    assert "error_bar_plots" in figures[1]["fidelity"]["omissions"]
    assert "error_bars" in figures[2]["fidelity"]["recovered"]
    # Origin draws nothing for an error plot naming no curve: not a loss
    assert not {"error_bar_plots", "curves_left_out"} & set(figures[3]["fidelity"]["omissions"])


# ── .opj: the anchor record is the same record ──────────────────────────────


def _error_curve(cid: int, target: int, flags: int = 3) -> bytes:
    return _block(_record(target=target, flags=flags, cid=cid)) + _dataplot_block()


def _opj_layer(*curves: bytes) -> bytes:
    return _synthetic_opj(
        _window_header("Book1"),
        _column_block("A", 6, designation=3),
        _column_block("B", 7),
        _column_block("C", 8),
        _column_block("D", 9),
        _window_header("Graph1"),
        _layer_block(0.0, 10.0, 0.0, 100.0),
        *curves,
    )


def test_opj_error_plot_is_left_out_and_linked() -> None:
    blocks = _blocks_of(_opj_layer(_curve(7), _error_curve(8, target=7), _curve(9)))
    omitted: list[tuple[int, dict[str, str]]] = []
    curves = extract_curves(
        blocks,
        0,
        len(blocks),
        column_id_map(blocks),
        book_x_columns(blocks),
        book_column_designations(blocks),
        omitted,
    )
    assert [c["y"] for c in curves] == ["B", "D"]
    assert omitted == [
        (
            1,
            {
                **_note("C", "error_bar_plot"),
                "decorates": "B",
                "direction": "3",
                "axis": "y",
                "band": "",
            },
        )
    ]


def test_opj_figure_drops_the_error_plot_caption_and_renumbers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from quantized.io.origin_project import figure_layers

    # the layer's legend as Origin numbers it: one entry per plot, bars included
    monkeypatch.setattr(figure_layers, "_parse_legend_labels", lambda _t: ["%(1)", "", "%(3)"])
    figs = extract_figures(_opj_layer(_curve(7), _error_curve(8, target=7), _curve(9)))
    assert len(figs) == 1
    fig = figs[0]
    assert [c["y"] for c in fig["curves"]] == ["B", "D"]
    assert [n["y"] for n in fig["curve_sheet_omitted"]] == ["C"]
    assert "_omitted_at" not in fig
    assert fig["legend_labels"] == ["%(1)", "%(2)"]
    (out,) = attach_error_bars(figs, [_DATA])
    assert out["curves"][0]["yErr"] == "C"


# ── realdata ─────────────────────────────────────────────────────────────────


def _owner_root(corpus_dir: Path) -> Path:
    root = corpus_dir / "origin"
    if not (root / "specimens" / "ground_truth").is_dir():
        pytest.skip("owner Origin corpus not present")
    return root


def _import(path: Path) -> dict[str, Any]:
    from quantized.routes.parsers import _import_with_books

    if not path.is_file():
        pytest.skip(f"{path.name} not present")
    payload, _ = _import_with_books(path)
    return payload


def _com_plots(root: Path, stem: str) -> dict[str, str]:
    """Graph page -> every plot Origin's COM lists on it (all layers)."""
    gt = root / "specimens" / "ground_truth" / stem
    if (gt / "plots.json").is_file():  # page -> {layer: [plot, ...]}
        pages = json.loads((gt / "plots.json").read_text())
        return {k: " ".join(p for ps in v.values() for p in ps) for k, v in pages.items()}
    pages = json.loads((gt / "graphs.json").read_text())  # page -> [{plots}]
    return {k: " ".join(p for layer in v for p in layer.get("plots", [])) for k, v in pages.items()}


@pytest.mark.realdata
@pytest.mark.parametrize(
    "name",
    ["Fixed Lambdas SI.opju", "UnpolPlots.opju", "MnN_Diffusion_PNR.opj", "SuperlatticeFits.opj"],
)
def test_realdata_bars_attach_where_origin_plots_them(corpus_dir: Path, name: str) -> None:
    """Every attached error column is plotted on that graph by Origin (its
    COM plot list), next to the curve it decorates, and Origin labels it as
    an uncertainty (``d...``). No attached error column is still drawn as a
    curve of its layer (the ``.opj`` phantom line)."""
    root = _owner_root(corpus_dir)
    oracle = _com_plots(root, Path(name).stem)
    figs = _import(root / name)["figures"]
    attached = [(f, c) for f in figs for c in f["curves"] if c.get("yErr")]
    assert attached, "no bars attached"
    for fig, c in attached:
        plots = oracle[fig["name"]]
        book, y, err = c["book"], c["y"], c["yErr"]
        assert f"[{book}]" in plots and f"!{y}" in plots and f'!{err}"d' in plots, (book, y, err)
        assert (book, err) not in {(d["book"], d["y"]) for d in fig["curves"]}


_GT = Path("Bariumoxid_MIMOTechniques/Report/Graph_Template.opju")


@pytest.mark.realdata
def test_realdata_direction_halves_match_the_bound_columns_long_names() -> None:
    """Offset 23 = 2 is the MINUS half, 1 the PLUS half, for Y and X error
    (bit 0x10) alike: in this project the two error columns of each pair are
    named ``Lower_Bound`` / ``LB_*`` / ``XerrMinus*`` and ``Upper_Bound`` /
    ``UB_*`` / ``XerrPlus*`` by their author."""
    from quantized.io.origin_project import figures_opju as fo
    from quantized.io.origin_project import opju_figure_curves as ofc
    from quantized.io.origin_project.curve_style_color import opju_style_record
    from quantized.io.origin_project.opju_curve_token import CURVE_TOKEN, token_id

    env = os.environ.get("QZ_ORIGIN_PUBLIC_CORPUS")
    base = (
        Path(env)
        if env
        else next(
            (
                a / "test-data" / "origin" / "public"
                for a in Path(__file__).resolve().parents
                if (a / "test-data" / "origin" / "public").is_dir()
            ),
            Path("/nonexistent"),
        )
    )
    path = base / _GT
    payload = _import(path)
    longs = {}
    for b in payload["books"]:
        md = b["metadata"]
        longs.update(
            {
                (md.get("origin_book"), n): lab
                for n, lab in zip(md["origin_column_names"], b["labels"], strict=False)
            }
        )
    halves: list[tuple[int, str]] = []
    orig = ofc.extract_curves_by_id

    def spy(b: bytes, start: int, end: int, table: Any, *rest: Any) -> Any:
        for m in CURVE_TOKEN.finditer(b, start, end):
            link = error_link(opju_style_record(b, m.start() + 3))
            info = table.ids.get(token_id(b, m))
            if link is not None and info is not None and link[1] != 3:
                halves.append((link[1], str(longs.get(info, ""))))
        return orig(b, start, end, table, *rest)

    try:
        fo.extract_curves_by_id = spy
        fo.extract_figures_opju(path.read_bytes())
    finally:
        fo.extract_curves_by_id = orig
    assert halves
    for direction, name in halves:
        low = name.lower()
        lower = low.startswith(("lower", "lb")) or "minus" in low
        upper = low.startswith(("upper", "ub")) or "plus" in low
        assert (direction, lower, upper) in ((2, True, False), (1, False, True)), (direction, name)
