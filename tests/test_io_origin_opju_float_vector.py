"""Floating-column (207) and vector (218) plots drawn as data marks (ledger F-115, F-116).

Synthetic tests lock the rules (``opju_float_vector``); the ``realdata`` test
recomputes its expectations from the imported books at run time.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest

from quantized.io.origin_project.opju_bar_kinds import PLOT_TYPE_NOT_DRAWN, apply_bar_kinds
from quantized.io.origin_project.opju_float_vector import (
    DATA_MARKS,
    apply_mark_modifiers,
    resolve_marks,
)
from quantized.io.origin_project.opju_plot_gates import PLOT_TYPE_OFF


def _book(name: str, x: list[float], cols: dict[str, list[float]], x_name: str = "A") -> Any:
    meta = {"origin_book": name, "origin_column_names": list(cols), "x_column_name": x_name}
    values = np.array(list(cols.values()), dtype=float).T
    return SimpleNamespace(metadata=meta, time=np.array(x, dtype=float), values=values)


_BOOK = _book(
    "Bk",
    [1, 2, 3],
    {"B": [1, 2, 3], "C": [0.9, 1.7, float("nan")], "D": [1.1, 2.3, 3.2], "E": [0.4, 0.6, 0.8]},
)


def _record(code: int) -> bytes:
    rec = bytearray(PLOT_TYPE_OFF + 300)
    rec[PLOT_TYPE_OFF] = code
    return bytes(rec)


def _float_curves(n: int = 2, width: str | None = "E") -> list[dict[str, Any]]:
    out = []
    for i in range(n):
        c: dict[str, Any] = {
            "book": "Bk",
            "x": "A",
            "y": "CD"[i % 2],
            "plotType": "floating",
            "plotGroup": "member" if i else "head",
        }
        if width:
            c["floatWidth"] = width
        out.append(c)
    return out


def _fig(curves: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {"name": "Graph1", "layer": 1, "curves": curves, "legend_labels": [], **extra}


def test_modifiers_are_read_only_in_the_proven_shapes() -> None:
    c: dict[str, Any] = {"book": "Bk"}
    apply_mark_modifiers(c, [(39, "Bk_E")], _record(207))
    assert c["floatWidth"] == "E"
    for mods in ([(32, "Bk_E")], [(39, "Other_E")], [(39, "Bk_E"), (9, "Bk_C")]):
        d: dict[str, Any] = {"book": "Bk"}
        apply_mark_modifiers(d, mods, _record(207))
        assert "floatWidth" not in d
    v: dict[str, Any] = {"book": "Bk@3"}
    apply_mark_modifiers(v, [(14, "Bk_D@3"), (13, "Bk_C@3")], _record(218))
    assert (v["vectorX2"], v["vectorY2"]) == ("C", "D")
    w: dict[str, Any] = {"book": "Bk"}
    apply_mark_modifiers(w, [(13, "Bk_C")], _record(218))  # one end only
    assert "vectorX2" not in w
    apply_mark_modifiers(w, [(13, "Bk_C"), (14, "Bk_D")], _record(207))  # wrong kind
    assert "vectorX2" not in w


def test_a_floating_pair_is_one_rectangle_per_row_with_the_width_column() -> None:
    marks, drawn, gone = resolve_marks(_float_curves(), 1, [_BOOK])
    assert drawn == [0, 1] and gone == []
    # row 3 has no bottom: skipped, never guessed
    assert marks == [
        {"kind": "rect", "x1": 0.8, "y1": 0.9, "x2": 1.2, "y2": 1.1},
        {"kind": "rect", "x1": 1.7, "y1": 1.7, "x2": 2.3, "y2": 2.3},
    ]


@pytest.mark.parametrize(
    "case",
    ["three", "one", "no_width", "two_pages", "no_group", "other_width", "bad_column"],
)
def test_floating_fails_closed(case: str) -> None:
    curves = _float_curves(3 if case == "three" else 1 if case == "one" else 2)
    layers = 2 if case == "two_pages" else 1
    if case == "no_width":
        curves = _float_curves(2, width=None)
    elif case == "no_group":
        curves[1]["plotGroup"] = "standalone"
    elif case == "other_width":
        curves[1]["floatWidth"] = "B"
    elif case == "bad_column":
        curves[0]["y"] = "Z"
    marks, drawn, gone = resolve_marks(curves, layers, [_BOOK])
    assert marks == [] and drawn == [] and gone == list(range(len(curves)))


def test_a_vector_is_one_arrow_per_row_from_the_start_to_the_end_columns() -> None:
    curve = {
        "book": "Bk",
        "x": "A",
        "y": "B",
        "plotType": "vector",
        "vectorX2": "D",
        "vectorY2": "E",
        "color": "#112233",
        "lineWidth": 0.2,
    }
    marks, drawn, gone = resolve_marks([curve], 1, [_BOOK])
    assert drawn == [0] and gone == []
    assert marks[0] == {
        "kind": "arrow",
        "x1": 1.0,
        "y1": 1.0,
        "x2": 1.1,
        "y2": 0.4,
        "stroke": "#112233",
        "width": 0.5,
    }
    assert len(marks) == 3
    bare = {k: v for k, v in curve.items() if k != "vectorY2"}
    assert resolve_marks([bare], 1, [_BOOK]) == ([], [], [0])
    two = resolve_marks([curve, dict(curve)], 1, [_BOOK])
    assert two[0] == [] and two[2] == [0, 1]


def test_the_layer_pass_draws_marks_and_leaves_the_rest_out() -> None:
    plain = {"book": "Bk", "x": "A", "y": "B"}
    fig = _fig([plain, *_float_curves()])
    fig["legend_labels"] = ["one", "two", "three"]
    (out,) = apply_bar_kinds([fig], b"", [_BOOK])
    assert [c["y"] for c in out["curves"]] == ["B"] and len(out[DATA_MARKS]) == 2
    assert out["data_marks_not_decoded"] and out["legend_labels"] == ["one"]
    assert not out.get("curve_sheet_omitted")
    assert all("floatWidth" not in c and "plotGroup" not in c for c in out["curves"])
    # no width column: left out, as before
    (gone,) = apply_bar_kinds([_fig(_float_curves(2, width=None))], b"", [_BOOK])
    assert gone["curves"] == [] and DATA_MARKS not in gone
    assert [o["reason"] for o in gone["curve_sheet_omitted"]] == [PLOT_TYPE_NOT_DRAWN] * 2
    # an exchanged-axes layer leaves them out whatever they prove
    (turned,) = apply_bar_kinds([_fig(_float_curves(), axes_exchanged=True)], b"", [_BOOK])
    assert turned["curves"] == [] and DATA_MARKS not in turned


def test_a_colour_field_layer_without_curves_does_not_count_as_a_panel() -> None:
    vec = {
        "book": "Bk",
        "x": "A",
        "y": "B",
        "plotType": "vector",
        "vectorX2": "D",
        "vectorY2": "E",
    }
    field = {"name": "Graph1", "layer": 1, "curves": [], "legend_labels": []}
    layer2 = {**_fig([vec]), "layer": 2}
    out = apply_bar_kinds([field, layer2], b"", [_BOOK])
    assert DATA_MARKS in out[1]
    other = {**_fig([{"book": "Bk", "x": "A", "y": "C"}]), "layer": 1}
    out2 = apply_bar_kinds([other, layer2], b"", [_BOOK])  # a drawn sibling layer: a panel page
    assert DATA_MARKS not in out2[1] and out2[1]["curves"] == []


@pytest.mark.realdata
def test_realdata_error_blocks_and_vector_fields(corpus_dir: Path) -> None:
    """``Degree of impact`` Graph511 / 512 (error blocks) and ``30流场`` /
    ``50流场`` (XYXY vectors) draw as marks computed from the imported books;
    Graph26 (three floating plots) stays left out."""
    from test_io_origin_opju_pie import _figures_and_books, _one, _public

    root = _public(corpus_dir)
    figs, books = _figures_and_books(_one(root, "Degree of impact*.opju"))
    by = {f["name"]: f for f in figs}
    for name, wide in (("Graph511", "E"), ("Graph512", "H")):
        fig = by[name]
        (bk,) = [b for b in books if b.metadata["origin_book"] == name.replace("Graph", "Book")]
        names = list(bk.metadata["origin_column_names"])
        w = np.asarray(bk.values, dtype=float)[:, names.index(wide)]
        assert len(fig[DATA_MARKS]) == int(np.isfinite(w).sum()) > 1
        for m in fig[DATA_MARKS]:
            assert m["kind"] == "rect" and m["x2"] > m["x1"] and m["y2"] >= m["y1"]
        widths = sorted(round(m["x2"] - m["x1"], 9) for m in fig[DATA_MARKS])
        assert widths == sorted(round(float(v), 9) for v in w if np.isfinite(v))
    assert DATA_MARKS not in by["Graph26"] and by["Graph26"]["curves"] == []
    reasons = [o["reason"] for o in by["Graph26"]["curve_sheet_omitted"]]
    assert reasons == [PLOT_TYPE_NOT_DRAWN] * 3
    for stem in ("30流场.opju", "50流场.opju"):
        vf, vb = _figures_and_books(_one(root, stem))
        (fig,) = vf
        (bk,) = [b for b in vb if b.metadata["origin_book"].startswith("Book1")]
        names = list(bk.metadata["origin_column_names"])
        cols = [np.asarray(bk.values, dtype=float)[:, names.index(n)] for n in ("B", "C", "D")]
        finite = np.isfinite(bk.time) & np.logical_and.reduce([np.isfinite(c) for c in cols])
        assert len(fig[DATA_MARKS]) == int(finite.sum()) > 1 and fig["curves"]
        assert all(m["kind"] == "arrow" for m in fig[DATA_MARKS])
        # every arrow of this project is horizontal (end Y = start Y): the profile's shape
        assert all(m["y1"] == m["y2"] for m in fig[DATA_MARKS])
