"""``.opju`` curve binding: embedded report-graph page headers (plan item 69),
the X column a curve token stores for itself (item 70) and the record's
shown/hidden bit (offset 38, ``docs/origin_re/curve_visibility.md``).

Synthetic bytes only (invented names) for the shapes; the ``realdata`` anchors
check the decoded binding against what Origin 2026b COM reported plotted
(``%(i,@D)`` / ``%(iX,@D)``, 2026-11-15) and auto-skip without the corpus.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from quantized.io.origin_project.fidelity import assess_origin_figures
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_curve_token_x import (
    HIDDEN_IN_ORIGIN,
    X_FIELD,
    token_hidden,
    token_x,
    token_x_id,
)
from quantized.io.origin_project.opju_embedded_pages import is_embedded_page, span_pages
from quantized.io.origin_project.opju_figure_curves import column_id_table, opju_pages
from test_io_origin_figures_opju import _column_id_record, _layer_bytes, _opju_page_header

_MAGIC = b"CPYUA 4.3811 222\n"


def _page(name: str, serial: bytes = b"\x7b") -> bytes:
    nm = name.encode("latin1")
    return b"\x0a\x80" + serial + bytes([len(nm) + 2]) + b"\x00\x00" + nm + b"\x8c"


def _embedded(name: str) -> bytes:
    """An embedded report-graph header: serial ``01`` right after an ``fb``."""
    return b"\x2b\x2d\x67\x30\x19\xfb" + _page(name, b"\x01")


# ── item 69: embedded report-graph headers ────────────────────────────────────


def test_embedded_header_needs_both_gates() -> None:
    real = _MAGIC + _page("Book1")
    emb = _MAGIC + b"\x00" * 4 + _embedded("Residual1")
    type1_only = _MAGIC + b"\x00" + _page("Book2", b"\x01")
    fb_only = _MAGIC + b"\xfb" + _page("Book3")
    assert not is_embedded_page(real, len(_MAGIC))
    assert is_embedded_page(emb, emb.index(b"\x0a\x80\x01"))
    assert not is_embedded_page(type1_only, type1_only.index(b"\x0a\x80"))
    assert not is_embedded_page(fb_only, fb_only.index(b"\x0a\x80"))
    assert span_pages(emb, [(emb.index(b"\x0a\x80\x01"), "Residual1")]) == []


def test_embedded_header_does_not_steal_the_host_books_columns() -> None:
    """Column records after an embedded header still belong to the host book
    (they used to be attributed to ``Residual1``, a book nothing imports)."""
    blob = (
        _MAGIC
        + _page("Book1")
        + _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "Y", partner=1)
        + _embedded("Residual1")
        + _column_id_record(7, "C", "Y", partner=1)
        + _page("Graph1")
    )
    assert [n for _, n in opju_pages(blob)] == ["Book1", "Graph1"]
    table = column_id_table(blob, opju_pages(blob))
    assert table.ids[7] == ("Book1", "C")
    assert "Residual1" not in table.book_pages


# ── item 70: the token's own X ─────────────────────────────────────────────────


def _token(y: int, x: int | None, flag: int = 0xBA) -> bytes:
    """A sparse curve record: the ``80 03 <y> 09`` id chunk (offsets 4-6), then
    a zero skip to offset 35 and ``<x u16> 21 61`` (offsets 35-38)."""
    out = bytes([flag, 1, 1, 1, 0x80, 0x03]) + y.to_bytes(2, "little") + b"\x09"
    if x is not None:
        out += bytes([0x80 + (X_FIELD - 7 - 3), 0x04]) + x.to_bytes(2, "little") + b"\x21\x61"
    return out + b"\x00"


def test_token_x_id_reads_offset_35_and_requires_the_marker() -> None:
    tok = _token(3, 0x0943)
    assert token_x_id(tok, 4) == 0x0943
    assert token_x_id(_token(3, 0), 4) == 0  # no X column (row numbers)
    assert token_x_id(_token(3, None), 4) is None  # record ends early
    assert token_x_id(tok.replace(b"\x21\x61", b"\x21\x21"), 4) == 0x0943  # EIS form
    bad = tok.replace(b"\x21\x61", b"\x30\x61")
    assert token_x_id(bad, 4) is None  # Y-error pair: not decoded


def test_token_x_outcomes() -> None:
    ids = {1: ("B1", "A"), 2: ("B1", "B"), 3: ("B1", "C"), 9: ("B2", "A")}
    assert token_x(_token(3, 2), 4, "B1", 1, ids) == (2, "")
    assert token_x(_token(3, 1), 4, "B1", 1, ids) == (1, "")
    assert token_x(_token(3, None), 4, "B1", 1, ids) == (1, "")  # undecodable: unchanged
    assert token_x(_token(3, 0), 4, "B1", 1, ids)[1] == "x_not_a_column"
    assert token_x(_token(3, 44), 4, "B1", 1, ids)[1] == "x_column_unknown"
    assert token_x(_token(3, 9), 4, "B1", 1, ids)[1] == "x_other_book"


def _blob(*tokens: bytes) -> bytes:
    recs = (
        _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "X")
        + _column_id_record(3, "C", "Y", partner=1)
    )
    layer = _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
    return (
        _MAGIC
        + _opju_page_header("WBook")
        + recs
        + _opju_page_header("Graph1")
        + layer
        + b"".join(tokens)
    )


def test_curve_binds_the_tokens_x_not_the_designated_partner() -> None:
    figs = extract_figures_opju(_blob(_token(3, 2)))
    assert [(c["book"], c["x"], c["y"]) for c in figs[0]["curves"]] == [("WBook", "B", "C")]


def test_curve_with_no_x_column_is_omitted_not_drawn_against_a_column() -> None:
    figs = extract_figures_opju(_blob(_token(3, 0)))
    assert figs[0]["curves"] == []
    assert figs[0]["curve_sheet_omitted"][0]["reason"] == "x_not_a_column"


def test_curve_whose_x_column_is_unknown_is_omitted() -> None:
    figs = extract_figures_opju(_blob(_token(3, 77)))
    assert figs[0]["curves"] == []
    assert figs[0]["curve_sheet_omitted"][0]["reason"] == "x_column_unknown"


# ── offset 38 bit 0x40: the plot is shown ─────────────────────────────────────


def _hide(tok: bytes, pair: bytes = b"\x21\x21") -> bytes:
    """The same record with Origin's "hidden" form of the offset-37/38 pair."""
    return tok.replace(b"\x21\x61", pair)


def test_token_hidden_reads_offset_38() -> None:
    tok = _token(3, 2)
    assert not token_hidden(tok, 4)  # 21 61: shown
    assert token_hidden(_hide(tok), 4)  # 21 21: hidden
    assert token_hidden(_hide(tok, b"\x30\x21"), 4)  # a hidden Y-error plot
    assert token_x_id(_hide(tok), 4) == 2  # the X still decodes
    # fail closed: no X field, or any other byte, is not "hidden"
    assert not token_hidden(_token(3, None), 4)
    assert not token_hidden(_hide(tok, b"\x21\x60"), 4)
    assert not token_hidden(_hide(tok, b"\x21\x01"), 4)


def _omitted_all(fig: dict[str, Any]) -> list[tuple[str, str, str, str]]:
    return [(n["book"], n["x"], n["y"], n["reason"]) for n in fig.get("curve_sheet_omitted") or []]


def test_hidden_plot_is_left_out_and_diagnosed_not_dropped() -> None:
    """Graph3 shape: a shown and a hidden plot of one book in one layer."""
    recs = (
        _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "X")
        + _column_id_record(3, "C", "Y", partner=1)
        + _column_id_record(4, "D", "Y", partner=1)
    )
    layer = _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
    blob = (
        _MAGIC + _opju_page_header("WBook") + recs + _opju_page_header("Graph1") + layer
        + _hide(_token(3, 2)) + _token(4, 2)
    )
    fig = extract_figures_opju(blob)[0]
    assert [(c["book"], c["x"], c["y"]) for c in fig["curves"]] == [("WBook", "B", "D")]
    # the hidden one keeps its full binding, so it can still be shown on request
    assert _omitted_all(fig) == [("WBook", "B", "C", HIDDEN_IN_ORIGIN)]


def test_hidden_wins_over_another_omission_reason() -> None:
    fig = extract_figures_opju(_blob(_hide(_token(3, 77))))[0]
    assert fig["curves"] == []
    assert _omitted_all(fig)[0][3] == HIDDEN_IN_ORIGIN  # not x_column_unknown


def test_an_id_another_token_shows_stays_drawn() -> None:
    """Fail closed: when the layer also holds a shown token of the same column
    (Origin plots a column twice, one copy hidden), the curve is still drawn."""
    fig = extract_figures_opju(_blob(_hide(_token(3, 2)), _token(3, 2)))[0]
    assert [(c["book"], c["x"], c["y"]) for c in fig["curves"]] == [("WBook", "B", "C")]
    assert _omitted_all(fig) == []


def test_fidelity_reports_hidden_plots_as_recovered_not_unresolved() -> None:
    hidden = {"book": "B1", "x": "A", "y": "C", "recorded": "B1", "reason": HIDDEN_IN_ORIGIN}
    other = {**hidden, "y": "D", "reason": "sheet_unknown"}
    curves = [{"book": "B1", "x": "A", "y": "E"}]
    figs, _ = assess_origin_figures(
        [{"name": "G1", "curves": curves, "curve_sheet_omitted": [hidden]}], container="opju"
    )
    assert "curve_visibility" in figs[0]["fidelity"]["recovered"]
    assert "curve_sheet_unresolved" not in figs[0]["fidelity"]["omissions"]
    figs, _ = assess_origin_figures(
        [{"name": "G1", "curves": curves, "curve_sheet_omitted": [hidden, other]}],
        container="opju",
    )
    assert "curve_sheet_unresolved" in figs[0]["fidelity"]["omissions"]


# ── realdata anchors (Origin 2026b COM, 2026-11-15) ───────────────────────────

_RISE = "origin/public/MeyerJackson_Minis-JGP-2024/Figure 3 and 4 amplitude - rise time data.opju"
_SOP = "origin/public/Techboyjohnny-98_SOP_measurement_SHAP/OriginPro file/SOP_meas.opju"
_RES = "origin/public/MoeidJZ_OriginPro-Py-codes/Sample_OriginPro_ResonatorData.opju"
_FIG4 = "origin/public/cropsinsilico_GRN_Model/Figure4.opju"


def _layer(corpus_dir: Path, rel: str, page: str, layer: int) -> dict[str, Any]:
    path = corpus_dir / rel
    if not path.is_file():
        pytest.skip(f"{rel} not present")
    got = [
        f
        for f in extract_figures_opju(path.read_bytes())
        if (f["name"], f["layer"]) == (page, layer)
    ]
    assert len(got) == 1
    return got[0]


def _omitted(fig: dict[str, Any]) -> list[tuple[str, str, str]]:
    return [(n["book"], n["y"], n["reason"]) for n in fig.get("curve_sheet_omitted") or []]


@pytest.mark.realdata
def test_realdata_rise_time_report_pages_are_not_books(corpus_dir: Path) -> None:
    """Origin plots ``Book56_*`` / ``Book31_B@15`` here, never a ``Residual*``."""
    path = corpus_dir / _RISE
    if not path.is_file():
        pytest.skip(f"{_RISE} not present")
    figs = extract_figures_opju(path.read_bytes())
    books = {c["book"] for f in figs for c in f["curves"]}
    books |= {n["book"] for f in figs for n in f.get("curve_sheet_omitted") or []}
    assert not any(str(b).startswith("Residual") for b in books)
    g66 = _layer(corpus_dir, _RISE, "Graph66", 1)
    # Origin plots Book56_B@3, C, D, E and B@5 here. B@5 is placed by the
    # second sheet signal (opju_sheet_signals); D and B@3 are written with
    # 2-byte id chunks (opju_curve_token), all three COM-identical; C's id
    # has no column record. E is a Y-error-bar plot (COM GetPlotType 231;
    # C is the 233 X-error bar), not a curve (opju_plot_gates).
    got = [(c["book"], c["y"]) for c in g66["curves"]]
    assert got == [("Book56", "D"), ("Book56@3", "B"), ("Book56@5", "B")]
    assert _omitted(g66) == [("Book56", "E", "error_bar_plot")]


@pytest.mark.realdata
def test_realdata_resonator_rawandfit_plots_against_k_and_l(corpus_dir: Path) -> None:
    fig = _layer(corpus_dir, _RES, "RawAndFit", 2)
    got = {(c["y"], c["x"]) for c in fig["curves"]}
    assert {("N", "K"), ("P", "L")} <= got  # Origin: S2136_K / S2136_L


@pytest.mark.realdata
def test_realdata_row_number_plot_is_omitted(corpus_dir: Path) -> None:
    fig = _layer(corpus_dir, _SOP, "Graph72", 1)  # Origin: X = Row Numbers
    assert fig["curves"] == []
    assert {r for _b, _y, r in _omitted(fig)} == {"x_not_a_column"}
    g73 = _layer(corpus_dir, _SOP, "Graph73", 1)  # token X = A@5, as Origin
    assert {c["x"] for c in g73["curves"]} == {"A"}


@pytest.mark.realdata
def test_realdata_numeric_x_column_now_binds(corpus_dir: Path) -> None:
    """Origin: Graph1 plots Book1_C/E/F/H against Book1_B. ``B`` is a Numeric-
    format column, so its id record had no field-walk form and the curves were
    omitted (``x_column_unknown``); ``opju_column_fixed`` reads it (2026-11-15),
    and every curve binds Origin's own X."""
    fig = _layer(corpus_dir, _FIG4, "Graph1", 1)
    assert {(c["y"], c["x"]) for c in fig["curves"]} == {
        ("C", "B"), ("E", "B"), ("F", "B"), ("H", "B")
    }
    assert _omitted(fig) == []


_HC2 = "origin/Hc2 data.opju"


@pytest.mark.realdata
def test_realdata_hc2_hidden_raw_lockin_plots_are_left_out(corpus_dir: Path) -> None:
    """Origin's own page preview of Graph3 draws the normalized ``AR/AT/AV``
    only; the raw ``E/G/I`` plots are hidden there (offset 38 ``21``) and were
    shown, byte-identical but for that byte, in the earlier ``hc2convert``
    save (``docs/origin_re/curve_visibility.md``)."""
    g3 = _layer(corpus_dir, _HC2, "Graph3", 1)
    assert [(c["x"], c["y"]) for c in g3["curves"]] == [("AQ", "AR"), ("AS", "AT"), ("AU", "AV")]
    assert [(b, y, r) for b, _x, y, r in _omitted_all(g3)] == [
        ("A6221LockinD2", y, HIDDEN_IN_ORIGIN) for y in ("E", "G", "I")
    ]
    assert g3["legend_labels"] == ["Nb", "Nb/Al", "Nb/Au"]  # Origin's legend
    g1 = _layer(corpus_dir, _HC2, "Graph1", 1)  # COM-identical: every plot shown
    assert [c["y"] for c in g1["curves"]] == ["E", "G", "I"]
    assert _omitted_all(g1) == []
