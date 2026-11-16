"""``.opju`` heatmap / contour / ternary bindings (``opju_map_plots``;
plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md item 7)."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from quantized.io.origin_project.fidelity import assess_origin_figures
from quantized.io.origin_project.opju_map_plots import (
    MAP_NOT_DECODED,
    MAP_SCALE_NOT_DECODED,
    bind_map_books,
    layer_map,
    map_ids,
)
from quantized.io.origin_project.opju_plot_gates import PLOT_TYPE_OFF
from quantized.io.origin_project.opju_plot_kinds import stat_x_reason

# -- synthetic CPYUA bytes ---------------------------------------------------


def _literals(data: bytes) -> bytes:
    """``data`` as sparse-grammar literal chunks (``<len < 0x80> <bytes>``)."""
    out = b""
    for i in range(0, len(data), 127):
        part = data[i : i + 127]
        out += bytes([len(part)]) + part
    return out


def _column(cid: int, code: int, name: str, assoc: int = 0, f37: int = 1, f38: int = 0x60) -> bytes:
    """A column id record (form A ``01 10 80 03 <id u16> <pb>``) whose
    expanded fixed fields (``opju_column_fixed``) hold the given values."""
    rec = bytearray(39)
    rec[17] = code
    rec[18 : 18 + len(name)] = name.encode()
    rec[35:37] = assoc.to_bytes(2, "little")
    rec[37], rec[38] = f37, f38
    return b"\x01\x10\x80\x03" + cid.to_bytes(2, "little") + b"\x03" + _literals(bytes(rec[7:]))


def _token(cid: int, plot_type: int) -> bytes:
    """A curve token + its 519-byte record (``opju_style_record``) of ``plot_type``."""
    rec = bytearray(519)
    rec[PLOT_TYPE_OFF] = plot_type
    head = b"\x00\x01\x01\x01\x80\x03" + cid.to_bytes(2, "little") + b"\x03"
    return head + _literals(bytes(rec[7:]))


def _page(name: str, template: str = "Line") -> bytes:
    """A page name followed by a header record naming its template at 61."""
    rec = bytearray(70)
    rec[61 : 61 + len(template)] = template.encode()
    return name.encode() + _literals(bytes(rec))


def _project(book: bytes, graph: bytes) -> tuple[bytes, list[tuple[int, str]]]:
    b = b"\x00" * 8 + book + b"\x00" * 8 + graph
    return b, [(0, "Book"), (8 + len(book) + 8, "Graph1")]


MATRIX = _column(7, 0, "", f37=0x01, f38=0x60)
XYZ = (
    _column(1, 3, "A", f38=0x50) + _column(2, 0, "B", assoc=1) + _column(3, 5, "C", assoc=2, f37=0)
)


def _layer(book: bytes, *tokens: bytes, template: str = "Line") -> dict[str, object]:
    graph = _page("Graph1", template) + b"".join(tokens)
    b, pages = _project(book, graph)
    start = pages[1][0]
    return layer_map(b, start, len(b), map_ids(b, pages), {}, pages[1])


# -- the bindings ---------------------------------------------------------------


@pytest.mark.parametrize(("code", "kind"), [(105, "heatmap"), (226, "contour"), (220, "image")])
def test_a_matrix_plot_binds_its_one_matrix_book(code: int, kind: str) -> None:
    got = _layer(MATRIX, _token(7, code))
    assert got == {"map": {"book": "Book", "kind": kind}, MAP_SCALE_NOT_DECODED: True}


def test_an_xyz_contour_binds_z_its_y_and_that_ys_x() -> None:
    got = _layer(XYZ, _token(3, 243))
    assert got["map"] == {"book": "Book", "kind": "contour", "x": "A", "y": "B", "z": "C"}


def test_a_ternary_template_scatter_on_a_z_column_binds_a_b_c() -> None:
    got = _layer(XYZ, _token(3, 201), template="Ternary")
    assert got["ternary"] == {"book": "Book", "a": "A", "b": "B", "c": "C"}
    # the same scatter on any other page is no ternary (and no map)
    assert _layer(XYZ, _token(3, 201)) == {}


def test_fails_closed() -> None:
    # a map plot with an XY curve beside it, or two maps: not one map
    assert _layer(MATRIX + XYZ, _token(7, 105), _token(2, 201)) == {MAP_NOT_DECODED: True}
    assert _layer(MATRIX, _token(7, 105), _token(7, 226)) == {MAP_NOT_DECODED: True}
    # a book page with two matrix objects names neither
    two = MATRIX + _column(8, 0, "", f37=0x01, f38=0x60)
    assert _layer(two, _token(7, 105)) == {MAP_NOT_DECODED: True}
    # a heatmap whose dataset is a worksheet column (a virtual matrix)
    assert _layer(XYZ, _token(2, 105)) == {MAP_NOT_DECODED: True}
    # an XYZ contour whose Z names no Y
    broken = _column(1, 3, "A", f38=0x50) + _column(3, 5, "C", assoc=9, f37=0)
    assert _layer(broken, _token(3, 243)) == {MAP_NOT_DECODED: True}
    # no map plot at all: nothing
    assert _layer(XYZ, _token(2, 201)) == {}


def test_a_map_plot_type_is_never_an_xy_curve() -> None:
    rec = bytearray(519)
    for code in (105, 220, 226, 243):
        rec[PLOT_TYPE_OFF] = code
        assert stat_x_reason(None, bytes(rec)) == "map_plot_not_decoded"
    rec[PLOT_TYPE_OFF] = 201
    assert stat_x_reason(None, bytes(rec)) == ""


def _book(name: str, matrix: bool) -> SimpleNamespace:
    meta: dict[str, object] = {"origin_book": name}
    if matrix:
        meta["origin_matrix"] = {"rows": 2, "cols": 2}
    return SimpleNamespace(metadata=meta)


def test_bind_map_books_keeps_only_an_imported_book_of_the_right_kind() -> None:
    fig = {"name": "Graph1", "map": {"book": "M", "kind": "heatmap"}, MAP_SCALE_NOT_DECODED: True}
    assert bind_map_books([fig], [_book("M", True)]) == [fig]
    for books in ([], [_book("M", False)]):
        (out,) = bind_map_books([fig], books)
        assert "map" not in out and out[MAP_NOT_DECODED] is True
    xyz = {"name": "Graph1", "map": {"book": "W", "kind": "contour", "x": "A", "y": "B", "z": "C"}}
    assert bind_map_books([xyz], [_book("W", False)]) == [xyz]
    assert "map" not in bind_map_books([xyz], [_book("W", True)])[0]


def test_a_map_figure_is_actionable_and_says_its_scale_is_not_decoded() -> None:
    fig = {
        "name": "Graph1", "layer": 1, "curves": [], "source_hint": "",
        "map": {"book": "M", "kind": "heatmap"}, MAP_SCALE_NOT_DECODED: True,
    }
    figs, manifest = assess_origin_figures([fig], container="opju")
    assert len(figs) == 1 and manifest["graph_records_filtered"] == 0
    assert "map_scale_not_decoded" in figs[0]["fidelity"]["omissions"]
    assert "map_binding" in figs[0]["fidelity"]["recovered"]
    assert "exact_curve_bindings" not in figs[0]["fidelity"]["omissions"]


# -- real corpus anchors (Origin 2026b COM: GetPlotType / GetRangeString) -----

@pytest.mark.realdata
@pytest.mark.parametrize(
    ("rel", "want"),
    [
        (
            "TJCSGAO_origin-publication-figures/assets/opju/fig05_heatmap_flights.opju",
            {("Graph1", 1): ("MBook1", "contour", 0.5, 12.5)},
        ),
        (
            "stunnerx_CTDHNN-data-code/code/fig3/plot/Fig3_c_模式连接矩阵.opju",
            {
                ("Graph2", 1): ("MBook2", "heatmap", 0.5, 30.5),
                ("Graph3", 1): ("MBook1", "heatmap", 0.5, 30.5),
                ("Graph4", 1): ("MBook1", "heatmap", 0.5, 30.5),
                ("Graph5", 1): ("MBook1", "heatmap", 0.5, 30.5),
            },
        ),
    ],
)
def test_real_matrix_maps_equal_origins(
    corpus_dir: Path, rel: str, want: dict[tuple[str, int], tuple[str, str, float, float]]
) -> None:
    from quantized.io.origin_project import drop_empty_library_books, read_origin_project_all
    from quantized.io.origin_project.import_manifest import origin_figures_and_fidelity

    path = corpus_dir / "origin" / "public" / rel
    if not path.is_file():
        pytest.skip("test-data corpus not present")
    raw = path.read_bytes()
    primary, books = read_origin_project_all(path, raw=raw)
    books = drop_empty_library_books(books)
    figs, _ = origin_figures_and_fidelity(raw, ".opju", books, primary=primary)
    got = {
        (f["name"], f["layer"]): (f["map"]["book"], f["map"]["kind"], f["x_from"], f["x_to"])
        for f in figs
        if f.get("map")
    }
    assert got == want
    for f in figs:
        if f.get("map"):  # Origin: a linear colour scale, axes 0.5 .. n + 0.5 both ways
            got_y = (f["y_from"], f["y_to"], f["x_log"], f["y_log"])
            assert got_y == (f["x_from"], f["x_to"], False, False)
