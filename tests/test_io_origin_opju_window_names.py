"""``.opju`` page-header NAME grammar: run escapes and 23-24 char names.

A page header is ``0A [00] 80 <type> <namelen+2> 00 00 <name field>``. Three
name-field forms exist (surveyed over the 359-file corpus, confirmed against
Origin 2026b ``%H`` page names; see ``tree_opju``):

* SHORT   ``<namelen bytes> <hi-bit trail>``;
* ESCAPE  ``<namelen bytes> c0 <ch> [<n> <n chars>] <trail>`` -- ``c0 <ch>``
  is ``<ch>`` x3, so ``Graph c0 31`` is Graph111. Read as a plain trail it
  truncated the name; after a longer literal it hid the page, and the page's
  anchors surfaced as phantom layers of the page before it;
* LONG    23-24 char names: the length byte is no longer the name length and
  there is no trail; the name is the charset run, ended by ``00``.

Synthetic bytes (invented names) for the grammar; the ``realdata`` test compares
the enumerated windows to Origin's own page list for every oracle project.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_figure_curves import opju_pages
from test_io_origin_figures_opju import _column_id_record, _layer_bytes
from test_io_origin_opju_page_attribution import _AXIS_JSON, _header

_PRE = b"CPYUA 4.3811 222\n"
_PAD = b"\x00" * 8


def _blob(length_byte: int, field: bytes, type_bytes: bytes = b"\x7b") -> bytes:
    """``0A 80 <type> <len> 00 00 <name field>`` inside a minimal stream."""
    return _PRE + b"\x0a\x80" + type_bytes + bytes([length_byte]) + b"\x00\x00" + field + _PAD


def _names(blob: bytes) -> list[str]:
    return [n for _, n in opju_pages(blob)]


def _esc_blob(first: str, ch: str, lit: str, trail: int) -> bytes:
    """An escape-form header: literal ``first``, ``c0 <ch>``, optional ``lit``."""
    field = first.encode() + b"\xc0" + ch.encode()
    if lit:
        field += bytes([len(lit)]) + lit.encode()
    return _blob(len(first) + 2, field + bytes([trail]))


# ── run escape: positive controls (the byte forms found in the corpus) ───────


@pytest.mark.parametrize(
    ("first", "ch", "lit", "want"),
    [
        ("Graph", "1", "", "Graph111"),
        ("Graph", "2", "", "Graph222"),
        ("Graph1B", "A", "", "Graph1BAAA"),
        ("Graph2AB", "A", "", "Graph2ABAAA"),
        ("fig_", "C", "Verror", "fig_CCCVerror"),
        ("D", "A", "B", "DAAAB"),
        ("T0dbde", "9", "e9a5", "T0dbde999e9a5"),
        ("resultR02", "0", "t", "resultR02000t"),
    ],
)
def test_run_escape_expands_to_three_repeats(first: str, ch: str, lit: str, want: str) -> None:
    assert _names(_esc_blob(first, ch, lit, 0x8C)) == [want]


def test_run_escape_name_no_longer_truncated() -> None:
    """Negative control for the old reading: the page is ``Graph111``, never
    the escape-blind ``Graph``."""
    assert "Graph" not in _names(_esc_blob("Graph", "1", "", 0x8E))


def test_run_escape_page_owns_its_anchor() -> None:
    """The page enumerates, so its layer anchor lands in ITS span: two pages
    (one escape-named) give two one-layer figures, not a phantom 2nd layer of
    the page before."""
    recs = _column_id_record(1, "A", "X") + _column_id_record(2, "B", "Y", partner=1)
    one = _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
    other = _layer_bytes(0.0, 5.0, 0.0, 100.0, 20.0, 0x03, r"\l(1) %(1)")
    esc = b"\x0a\x80\x7c\x07\x00\x00Graph\xc0\x31\x8e"  # Graph111
    blob = _PRE + _header("WBook", b"\x7a") + recs + _header("Graph1", b"\x7b") + one + esc + other
    figs = extract_figures_opju(blob)
    assert [(f["name"], f["layer"]) for f in figs] == [("Graph1", 1), ("Graph111", 1)]
    assert (figs[1]["x_to"], figs[1]["y_to"]) == (5.0, 100.0)


# ── run escape: negative controls (fail closed) ──────────────────────────────


def test_escape_with_a_non_name_character_is_rejected() -> None:
    assert _names(_blob(7, b"Graph\xc0\x20\x8e")) == []
    assert _names(_blob(7, b"Graph\xc0\xff\x8e")) == []


def test_escape_must_end_in_a_trail() -> None:
    assert _names(_blob(7, b"Graph\xc01\x00\x00")) == []  # no trail byte
    assert _names(_blob(7, b"Graph\xc01\xc0")) == []  # trail is itself an escape


def test_second_escape_in_one_name_is_not_guessed() -> None:
    """Two escapes have no corpus evidence: omitted, not guessed."""
    assert _names(_blob(7, b"Graph\xc01\x02ab\xc02\x8e")) == []


def test_escape_literal_segment_must_be_name_characters_and_complete() -> None:
    assert _names(_blob(6, b"fig_\xc0C\x06Ver ror\x89")) == []
    assert _names(_blob(6, b"fig_\xc0C\x09Verror\x89")) == []  # claims 9, has 6


def test_plain_names_still_enumerate_unchanged() -> None:
    assert _names(_blob(8, b"Graph1\x90")) == ["Graph1"]
    assert _names(_blob(8, b"Graph1\xc1")) == ["Graph1"]  # a non-c0 hi byte is a trail
    assert _names(_blob(8, b"Graph1\x20")) == []  # trail < 0x80 still rejected


# ── 23-24 character names ────────────────────────────────────────────────────

_LONG23 = "TestingAccuracyonPudMed"
_LONG24 = "ModulationTCRGraph_TEMPL"


@pytest.mark.parametrize("length_byte", [0x27, 0x2A])
@pytest.mark.parametrize("name", [_LONG23, _LONG24])
def test_long_name_is_the_whole_run(name: str, length_byte: int) -> None:
    assert len(name) in (23, 24)
    assert _names(_blob(length_byte, name.encode() + b"\x00\x00\x4c\x01\x4c\x01")) == [name]


def test_long_form_needs_the_terminating_zero() -> None:
    assert _names(_blob(0x27, _LONG24.encode() + b"\x8e\x0c")) == []


def test_long_form_rejects_runs_outside_23_to_24_chars() -> None:
    """22 chars is the SHORT form's top end (trail 0x80); 25+ is not a
    possible Origin short name."""
    assert _names(_blob(0x27, b"A" * 22 + b"\x00\x00\x00")) == []
    assert _names(_blob(0x27, b"A" * 25 + b"\x00\x00\x00")) == []


def test_long_form_needs_a_length_byte_longer_than_the_run() -> None:
    """A length byte that does not exceed the run is the SHORT form -- whose
    trail check this run (followed by 00) fails."""
    assert _names(_blob(len(_LONG24) + 2, _LONG24.encode() + b"\x00\x00")) == []


def test_short_names_up_to_22_chars_still_use_the_trail() -> None:
    name = "a" * 22
    assert _names(_blob(len(name) + 2, name.encode() + b"\x80")) == [name]


# ── realdata: enumerated windows == Origin's page list (every oracle file) ──

# Origin lists the auto-generated ``FitLine``/``Residual``/``sparkline``
# child graphs as pages. They carry no ``0A``-framed page header anywhere in the
# stream (docs/origin_project_format.md: "no `00 00 <Name> 00` window header";
# FitLinear report graphs live in the analysis's own storage), so they cannot be
# enumerated by this reader (some ARE framed and enumerate). Strict: only names
# of THESE families may be absent.
_AUX_PAGE = re.compile(r"(FitLine|Residual|sparkline)\d*")


@pytest.mark.realdata
def test_realdata_enumerated_windows_equal_origins(corpus_dir: Path) -> None:
    oracle_path = corpus_dir / _AXIS_JSON
    if not oracle_path.is_file():
        pytest.skip(f"{_AXIS_JSON} not present")
    files = json.loads(oracle_path.read_text(encoding="utf-8"))["files"]
    missing: list[tuple[str, str]] = []
    extra: list[tuple[str, str]] = []
    checked = 0
    for rel, pages in files.items():
        project = corpus_dir / rel
        if not project.is_file():
            continue
        blob = project.read_bytes()
        enumerated = set(_names(blob))
        oracle = set(pages)
        checked += len(oracle)
        for name in sorted(oracle - enumerated):
            if not _AUX_PAGE.fullmatch(name):
                missing.append((rel, name))
        # a figure's page name must be one of Origin's graph pages (a truncated
        # or invented name is a phantom page)
        extra += [
            (rel, n) for n in sorted({f["name"] for f in extract_figures_opju(blob)} - oracle) if n
        ]
    assert checked > 2000  # the oracle really was exercised
    assert not missing, f"Origin pages the reader does not enumerate: {missing}"
    assert not extra, f"figure pages Origin does not list: {extra}"
