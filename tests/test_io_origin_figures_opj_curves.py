"""``.opj`` (CPYA) curve->column binding (item 11, solved 2026-07-04).

Mirrors ``test_io_origin_figures_opju.py``'s two-layer structure:

* **synthetic** CPYA-shaped records built in-test (no private data) that
  exercise the id-lookup decoder in CI;
* **realdata**-marked checks against Origin's own ground-truth export for
  both required oracle files (``Moke.opj``, ``XRD.opj``), asserting strict
  precision (zero wrong) plus the achieved recall floor -- see
  ``opj_curves.py``'s module docstring for the full byte-level trail and
  validation counts.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import pytest

from quantized.io.origin_project.figures import extract_figures
from quantized.io.origin_project.opj_curves import book_x_columns, column_id_map, extract_curves

# ── synthetic CPYA figure + curve-anchor builder ──────────────────────────────


def _block(payload: bytes) -> bytes:
    """One CPY block: <uint32 size LE><0x0A><payload><0x0A>."""
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


def _zero() -> bytes:
    return struct.pack("<I", 0) + b"\n"


def _window_header(name: str) -> bytes:
    """A window-header block: ``00 00 <Name> 00 …``, >=150 B (shared by
    graph and worksheet windows -- ``windows._is_window_header``)."""
    payload = b"\x00\x00" + name.encode("latin1") + b"\x00"
    payload += b"\x00" * (165 - len(payload))
    return _block(payload)


def _layer_block(
    x_from: float, x_to: float, y_from: float, y_to: float, *, head: int = 0x1F
) -> bytes:
    """The layer-continuation block read immediately after a graph header:
    head ``00 00 <head> 00``, axis doubles at 15/23 (X) and 58/66 (Y) --
    ``figures.py``'s ``_axis``/``_y_scale_flag`` layout. ``head`` defaults to
    the ordinary 0x1f marker (a window's first layer, or a subsequent
    OVERLAID layer, e.g. double-Y); pass 0x17 for a subsequent STACKED/
    TILED-PANEL layer (see ``figures.py``'s ``_LAYER_HEAD_BYTES``)."""
    payload = bytearray(240)
    payload[0:4] = bytes([0, 0, head, 0])
    struct.pack_into("<d", payload, 15, x_from)
    struct.pack_into("<d", payload, 23, x_to)
    struct.pack_into("<d", payload, 58, y_from)
    struct.pack_into("<d", payload, 66, y_to)
    return _block(bytes(payload))


def _column_block(short: str, cid: int, designation: int = 0) -> bytes:
    """A workbook column-storage block: global id (u16 LE) at offset 4,
    designation at 0x11, short name at 0x12 -- see ``opj_curves.py``'s
    ``_column_short_name``/``column_id_map``."""
    p = bytearray(519)
    struct.pack_into("<H", p, 4, cid)
    p[0x11] = designation
    p[0x12 : 0x12 + len(short) + 1] = short.encode("latin1") + b"\x00"
    return _block(bytes(p))


def _curve_anchor(cid: int) -> bytes:
    """The 4-byte-marker + global-id "curve anchor" record (see
    ``opj_curves.py``'s module docstring)."""
    p = bytearray(519)
    p[0:4] = b"\x01\x00\x00\x00"
    struct.pack_into("<H", p, 4, cid)
    return _block(bytes(p))


def _dataplot_block() -> bytes:
    """A block opening with the DataPlot magic (``docs/origin_project_format
    .md`` sec 6.1) -- required immediately after a curve anchor for it to
    count as a real curve."""
    p = bytearray(852)
    p[0:8] = b"\x58\x00\x00\x00\x98\x03\x40\xb3"
    return _block(bytes(p))


def _curve(cid: int) -> bytes:
    """One full curve: anchor + its DataPlot style/body pair."""
    return _curve_anchor(cid) + _dataplot_block()


def _blocks_of(data: bytes) -> list[tuple[int, bytes]]:
    from quantized.io.origin_project.container import walk_blocks

    return [(size, payload) for size, payload in walk_blocks(data) if size]


def _synthetic_opj(*parts: bytes) -> bytes:
    return b"CPYA 4.3380 188 W64 #\n" + b"".join(parts)


# ── synthetic tests: column_id_map / book_x_columns / extract_curves ─────────


def test_column_id_map_resolves_book_and_column() -> None:
    blob = _synthetic_opj(
        _window_header("Book1"),
        _column_block("A", cid=10, designation=3),
        _column_block("B", cid=11, designation=0),
    )
    id_map = column_id_map(_blocks_of(blob))
    assert id_map == {10: ("Book1", "A"), 11: ("Book1", "B")}


def test_book_x_columns_picks_the_designated_x_column() -> None:
    blob = _synthetic_opj(
        _window_header("Book1"),
        _column_block("A", cid=10, designation=3),  # X
        _column_block("B", cid=11, designation=0),  # Y
    )
    assert book_x_columns(_blocks_of(blob)) == {"Book1": "A"}


def test_book_x_columns_falls_back_to_first_column_when_none_marked_x() -> None:
    blob = _synthetic_opj(
        _window_header("Book1"),
        _column_block("A", cid=10, designation=0),
        _column_block("B", cid=11, designation=0),
    )
    assert book_x_columns(_blocks_of(blob)) == {"Book1": "A"}


def test_book_x_columns_stops_at_second_sheet_restart() -> None:
    """The primary-sheet guard: a repeated short name (sheet 2 restarting at
    A) must not let a later, differently-designated sheet-2 column overwrite
    the primary sheet's real X pick."""
    blob = _synthetic_opj(
        _window_header("Book1"),
        _column_block("A", cid=10, designation=3),  # primary sheet: A is X
        _column_block("B", cid=11, designation=0),
        _column_block("A", cid=12, designation=0),  # sheet 2 restarts -> ignored
        _column_block("C", cid=13, designation=3),  # would wrongly become X if not closed
    )
    assert book_x_columns(_blocks_of(blob)) == {"Book1": "A"}
    # and the id map still resolves the (unused-for-X) sheet-2 columns too
    assert column_id_map(_blocks_of(blob))[12] == ("Book1", "A")


def test_extract_curves_resolves_single_curve() -> None:
    blob = _synthetic_opj(
        _window_header("Book1"),
        _column_block("A", cid=10, designation=3),
        _column_block("B", cid=11, designation=0),
        _window_header("Graph1"),
        _layer_block(0.0, 10.0, 0.0, 100.0),
        _curve(cid=11),
    )
    blocks = _blocks_of(blob)
    id_map = column_id_map(blocks)
    x_columns = book_x_columns(blocks)
    curves = extract_curves(blocks, 0, len(blocks), id_map, x_columns)
    assert curves == [{"book": "Book1", "x": "A", "y": "B"}]


def test_extract_curves_multiple_curves_one_layer() -> None:
    blob = _synthetic_opj(
        _window_header("Book1"),
        _column_block("A", cid=1, designation=3),
        _column_block("B", cid=2, designation=0),
        _column_block("C", cid=3, designation=0),
        _window_header("Graph1"),
        _layer_block(0.0, 10.0, 0.0, 100.0),
        _curve(cid=2),
        _curve(cid=3),
    )
    blocks = _blocks_of(blob)
    id_map = column_id_map(blocks)
    x_columns = book_x_columns(blocks)
    curves = extract_curves(blocks, 0, len(blocks), id_map, x_columns)
    assert curves == [
        {"book": "Book1", "x": "A", "y": "B"},
        {"book": "Book1", "x": "A", "y": "C"},
    ]


def test_extract_curves_cross_book() -> None:
    """Two curves in one graph, from two different books -- book AND column
    resolved by the same single id per curve, no separate book selector."""
    blob = _synthetic_opj(
        _window_header("BookOne"),
        _column_block("A", cid=1, designation=3),
        _column_block("B", cid=2, designation=0),
        _window_header("BookTwo"),
        _column_block("A", cid=20, designation=3),
        _column_block("C", cid=22, designation=0),
        _window_header("Graph1"),
        _layer_block(0.0, 10.0, 0.0, 100.0),
        _curve(cid=2),
        _curve(cid=22),
    )
    blocks = _blocks_of(blob)
    id_map = column_id_map(blocks)
    x_columns = book_x_columns(blocks)
    curves = extract_curves(blocks, 0, len(blocks), id_map, x_columns)
    assert curves == [
        {"book": "BookOne", "x": "A", "y": "B"},
        {"book": "BookTwo", "x": "A", "y": "C"},
    ]


def test_extract_curves_unresolvable_id_dropped_not_guessed() -> None:
    blob = _synthetic_opj(
        _window_header("Book1"),
        _column_block("A", cid=1, designation=3),
        _column_block("B", cid=2, designation=0),
        _window_header("Graph1"),
        _layer_block(0.0, 10.0, 0.0, 100.0),
        _curve(cid=999),  # no column carries this id
    )
    blocks = _blocks_of(blob)
    id_map = column_id_map(blocks)
    x_columns = book_x_columns(blocks)
    assert extract_curves(blocks, 0, len(blocks), id_map, x_columns) == []


def test_extract_curves_requires_dataplot_magic_immediately_after() -> None:
    """A block that merely starts with the curve-anchor's ``01 00 00 00``
    marker but is NOT followed by the DataPlot magic is not a real curve --
    the co-occurrence is what makes the detector precise (see module
    docstring)."""
    not_a_dataplot = bytearray(852)
    not_a_dataplot[0:4] = b"\x00\x00\x00\x00"
    blob = _synthetic_opj(
        _window_header("Book1"),
        _column_block("A", cid=1, designation=3),
        _column_block("B", cid=2, designation=0),
        _window_header("Graph1"),
        _layer_block(0.0, 10.0, 0.0, 100.0),
        _curve_anchor(cid=2) + _block(bytes(not_a_dataplot)),
    )
    blocks = _blocks_of(blob)
    id_map = column_id_map(blocks)
    x_columns = book_x_columns(blocks)
    assert extract_curves(blocks, 0, len(blocks), id_map, x_columns) == []


def test_extract_curves_unknown_book_dropped() -> None:
    """An id that resolves to a book ``book_x_columns`` never saw any columns
    for (so no X can be inferred) is dropped, not guessed."""
    # Manually craft an id_map entry pointing at a book with no scanned columns.
    id_map = {5: ("GhostBook", "Q")}
    x_columns: dict[str, str] = {}
    curve_blocks = _blocks_of(_curve(cid=5))
    assert extract_curves(curve_blocks, 0, len(curve_blocks), id_map, x_columns) == []


# ── synthetic integration test through figures.py ─────────────────────────────


def test_figures_scopes_curves_per_layer_not_merged_across_the_window() -> None:
    """Item 36: a two-layer graph (double-Y-style) now yields ONE figure dict
    PER LAYER, each carrying only ITS OWN layer's curves -- not one dict
    merging both layers' curves together (the pre-item-36 behavior). Curve
    attribution is positional: a curve anchor belongs to the layer whose
    layer-continuation record precedes it (see ``figures.py``'s
    ``_build_layer``)."""
    blob = _synthetic_opj(
        _window_header("BookOne"),
        _column_block("A", cid=1, designation=3),
        _column_block("B", cid=2, designation=0),
        _window_header("BookTwo"),
        _column_block("A", cid=20, designation=3),
        _column_block("C", cid=22, designation=0),
        _window_header("Graph1"),
        _layer_block(0.0, 10.0, 0.0, 100.0),
        _curve(cid=2),
        _layer_block(0.0, 10.0, -50.0, 50.0),
        _curve(cid=22),
    )
    figs = extract_figures(blob)
    assert len(figs) == 2
    assert [f["layer"] for f in figs] == [1, 2]
    assert [f["name"] for f in figs] == ["Graph1", "Graph1"]
    assert figs[0]["curves"] == [{"book": "BookOne", "x": "A", "y": "B"}]
    assert figs[1]["curves"] == [{"book": "BookTwo", "x": "A", "y": "C"}]
    assert (figs[0]["y_from"], figs[0]["y_to"]) == (0.0, 100.0)
    assert (figs[1]["y_from"], figs[1]["y_to"]) == (-50.0, 50.0)


def test_figures_stacked_panel_layer_curves_attributed_correctly() -> None:
    """The rarer 0x17 "stacked/tiled panel" layer-head byte (mirroring
    Moke's real Graph4) is attributed the same way as an ordinary 0x1f
    layer: its curves are the anchors between IT and the window's end (or
    the next layer)."""
    blob = _synthetic_opj(
        _window_header("Book3"),
        _column_block("A", cid=1, designation=3),
        _column_block("B", cid=2, designation=0),
        _column_block("C", cid=3, designation=0),
        _column_block("D", cid=4, designation=0),
        _column_block("E", cid=5, designation=0),
        _window_header("Graph4"),
        _layer_block(0.9, 3.1, -50.0, 3000.0),
        _curve(cid=2),
        _curve(cid=3),
        _layer_block(0.9, 3.1, 400.0, 1500.0, head=0x17),
        _curve(cid=4),
        _curve(cid=5),
    )
    figs = extract_figures(blob)
    assert len(figs) == 2
    assert [f["layer"] for f in figs] == [1, 2]
    assert figs[0]["curves"] == [
        {"book": "Book3", "x": "A", "y": "B"},
        {"book": "Book3", "x": "A", "y": "C"},
    ]
    assert figs[1]["curves"] == [
        {"book": "Book3", "x": "A", "y": "D"},
        {"book": "Book3", "x": "A", "y": "E"},
    ]


def test_figures_curves_empty_list_when_no_curve_anchor_present() -> None:
    blob = _synthetic_opj(
        _window_header("Book1"),
        _column_block("A", cid=1, designation=3),
        _column_block("B", cid=2, designation=0),
        _window_header("Graph1"),
        _layer_block(0.0, 10.0, 0.0, 100.0),
    )
    figs = extract_figures(blob)
    assert len(figs) == 1
    assert figs[0]["curves"] == []


def test_figures_curves_scoped_to_own_window_not_the_next_graph() -> None:
    """Two independent graphs in one project -- each figure's curves must
    only include its own window's curve anchors."""
    blob = _synthetic_opj(
        _window_header("BookOne"),
        _column_block("A", cid=1, designation=3),
        _column_block("B", cid=2, designation=0),
        _window_header("BookTwo"),
        _column_block("A", cid=20, designation=3),
        _column_block("C", cid=22, designation=0),
        _window_header("Graph1"),
        _layer_block(0.0, 10.0, 0.0, 100.0),
        _curve(cid=2),
        _zero(),
        _window_header("Graph2"),
        _layer_block(-1.0, 1.0, -1.0, 1.0),
        _curve(cid=22),
    )
    figs = extract_figures(blob)
    assert [f["name"] for f in figs] == ["Graph1", "Graph2"]
    assert figs[0]["curves"] == [{"book": "BookOne", "x": "A", "y": "B"}]
    assert figs[1]["curves"] == [{"book": "BookTwo", "x": "A", "y": "C"}]


# ── realdata: Origin ground-truth oracle (Moke.opj + XRD.opj) ────────────────


def _resolve_corpus_dir() -> Path:
    """The local-only ``../test-data/origin`` corpus (see
    ``test_io_origin_project.py``'s ``_resolve_corpus_dir`` for why the
    ancestor-walk fallback is needed from a worktree agent's nesting depth)."""
    candidate = Path(__file__).resolve().parents[1] / ".." / "test-data" / "origin"
    if candidate.exists():
        return candidate
    for ancestor in Path(__file__).resolve().parents:
        walked = ancestor / "test-data" / "origin"
        if walked.exists():
            return walked
    return candidate


_CORPUS = _resolve_corpus_dir()
_GT = _CORPUS / "specimens" / "ground_truth"


def _oracle_plots_by_graph(index_path: Path) -> dict[str, list[tuple[str, str]]]:
    """graph name -> [(book, column), ...] across all its layers, flattened in
    file order (matches ``figures.py``'s own per-window, cross-layer
    aggregation of ``curves``/``n_curves``)."""
    index = json.loads(index_path.read_text(encoding="utf-8"))
    out: dict[str, list[tuple[str, str]]] = {}
    for g in index["graphs"]:
        pairs: list[tuple[str, str]] = []
        for layer in g["layers"]:
            for plotref in layer["plots"]:
                book = plotref.split("]")[0][1:]
                rest = plotref.split("]", 1)[1]
                sheetcol = rest.split("!", 1)[1] if "!" in rest else rest
                col = sheetcol.split('"')[0]
                pairs.append((book, col))
        out[g["graph"]] = pairs
    return out


@pytest.mark.realdata
@pytest.mark.parametrize(
    ("stem", "n_expected_reachable"),
    [("Moke", 39), ("XRD", 6)],
)
def test_realdata_curve_bindings_precision_and_recall_floor(
    stem: str, n_expected_reachable: int
) -> None:
    """Strict precision (every decoded curve must match the oracle exactly,
    per graph) plus a recall floor against the achieved 2026-07-04 counts
    (39/46 Moke -- ``FitLine``/``Residual`` have no locatable window header
    at all; 6/24 XRD -- only ``Graph1`` is a real graph window, the other 18
    refs are per-column sparklines with no curve-anchor record anywhere in
    the file). See ``opj_curves.py``'s module docstring for the full
    byte-level trail."""
    src = _CORPUS / f"{stem}.opj"
    index_path = _GT / stem / "index.json"
    if not src.exists() or not index_path.exists():
        pytest.skip(f"corpus file/ground-truth for '{stem}' not present on this machine")
    oracle = _oracle_plots_by_graph(index_path)
    total_oracle = sum(len(v) for v in oracle.values())

    figs = extract_figures(src.read_bytes())
    # item 36: a multi-layer window now yields several dicts sharing the same
    # "name" (one per layer) -- merge their curves back together, in layer
    # order, to compare against the oracle's own cross-layer flattening
    # (`_oracle_plots_by_graph`).
    by_name: dict[str, list[dict[str, str]]] = {}
    for f in sorted(figs, key=lambda f: f["layer"]):
        by_name.setdefault(f["name"], []).extend(f["curves"])

    correct = 0
    wrong: list[tuple[str, tuple[str, str]]] = []
    for gname, expected in oracle.items():
        curves = by_name.get(gname)
        if curves is None:
            continue  # unreachable window (FitLine/Residual/sparklines) -- not a wrong answer
        decoded = [(c["book"], c["y"]) for c in curves]
        remaining = list(expected)
        for d in decoded:
            if d in remaining:
                remaining.remove(d)
                correct += 1
            else:
                wrong.append((gname, d))

    assert not wrong, f"{stem}: decoded curve(s) contradict the oracle: {wrong}"
    assert correct == n_expected_reachable, (
        f"{stem}: expected exactly {n_expected_reachable} correct curves "
        f"(out of {total_oracle} oracle refs), got {correct}"
    )


@pytest.mark.realdata
def test_realdata_moke_multi_layer_windows_split_per_layer() -> None:
    """Item 36: Moke's three multi-layer windows, checked layer-by-layer (not
    flattened) -- both the axis ranges AND the exact per-layer ``(book,
    column)`` curve sets must match ``ground_truth/Moke/index.json`` one
    layer at a time. ``Graph10`` is the structurally interesting case: its 4
    layers are the literal union of ``Graph7``'s 2 + ``Graph4``'s 2, so this
    also confirms curve attribution doesn't bleed across a composite
    window's layer boundaries."""
    src = _CORPUS / "Moke.opj"
    index_path = _GT / "Moke" / "index.json"
    if not src.exists() or not index_path.exists():
        pytest.skip("corpus file/ground-truth for 'Moke' not present on this machine")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    oracle_layers = {g["graph"]: g["layers"] for g in index["graphs"]}

    figs = extract_figures(src.read_bytes())
    by_name: dict[str, list[dict[str, object]]] = {}
    for f in figs:
        by_name.setdefault(f["name"], []).append(f)
    for entries in by_name.values():
        entries.sort(key=lambda f: f["layer"])  # type: ignore[arg-type, return-value]

    for gname in ("Graph4", "Graph7", "Graph10"):
        expected_layers = oracle_layers[gname]
        got_layers = by_name[gname]
        assert len(got_layers) == len(expected_layers), (
            f"{gname}: expected {len(expected_layers)} layers, got {len(got_layers)}"
        )
        pairs = zip(expected_layers, got_layers, strict=True)
        for layer_no, (expected, got) in enumerate(pairs, start=1):
            assert got["layer"] == layer_no
            assert (got["x_from"], got["x_to"]) == tuple(expected["x"][:2])
            assert (got["y_from"], got["y_to"]) == tuple(expected["y"][:2])
            expected_pairs = []
            for plotref in expected["plots"]:
                book = plotref.split("]")[0][1:]
                rest = plotref.split("]", 1)[1]
                sheetcol = rest.split("!", 1)[1] if "!" in rest else rest
                col = sheetcol.split('"')[0]
                expected_pairs.append((book, col))
            got_pairs = [(c["book"], c["y"]) for c in got["curves"]]
            assert got_pairs == expected_pairs, (
                f"{gname} layer {layer_no}: expected {expected_pairs}, got {got_pairs}"
            )
