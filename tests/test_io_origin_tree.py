"""Origin Project Explorer folder tree decode (``tree.py``).

Two layers, same convention as ``test_io_origin_project.py``:
  * **synthetic** ``.opj`` tail fixtures built in-test (no private data) that
    exercise structural shapes the real corpus may not hit hard enough on its
    own: deep nesting, empty folders, root-level windows, many
    folders/books, duplicate folder names at different parents, and
    unusual folder-name charsets (unicode/punctuation/very long/empty). This
    is the generality proof the corpus checks alone can't provide.
  * a **realdata**-marked pin of the exact Project Explorer tree the task
    ground truth records for ``Moke.opj`` (live Origin COM, OriginPro 2026b),
    plus an explicit check that ``.opju`` honestly reports the documented
    gap (every book defaults to ``[]``) rather than guessing.

Format background: ``tree.py``'s module docstring; corpus fidelity is
recorded in ``docs/origin_project_format.md``.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io.origin_project import _with_folder_path, read_origin_books
from quantized.io.origin_project.tree import opj_folder_paths, opju_folder_paths

# ── synthetic CPY .opj tail builder ───────────────────────────────────────────

_HEADER_LINE = b"CPYA 4.3380 188 W64 #\n"


def _block(payload: bytes) -> bytes:
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


_NULL_BLOCK = struct.pack("<I", 0) + b"\n"


def _window_header_block(name: str) -> bytes:
    """A minimal window-header block: ``00 00 <name> 00`` padded to >=150 B."""
    payload = b"\x00\x00" + name.encode("latin1") + b"\x00"
    payload += b"\x00" * max(0, 150 - len(payload))
    return _block(payload)


def _folder(name: str, ordinals: list[int], subfolders: list[bytes] | None = None) -> bytes:
    """One ``folder`` record (see ``tree.py``'s module docstring grammar)."""
    subfolders = subfolders or []
    out = bytearray()
    out += _block(b"\x00" * 32)  # hdr32
    out += _NULL_BLOCK
    # latin1, matching the reader's own decode (`_read_cstring_block`) and
    # every other name decode in this codebase (`windows.py::_cstring`) --
    # a byte-preserving 1:1 codec, so any single-byte value round-trips
    # exactly. Genuine multi-byte Unicode (CJK, emoji) folder names are a
    # known, inherited limitation (not special-cased here or anywhere else
    # in the `.opj` reader) -- see the "unicode" parametrize case below.
    out += _block(name.encode("latin1") + b"\x00")
    out += struct.pack("<I", 2) + b"\n"  # bare u32(2) marker, no payload
    out += _block(b"\x00" * 4)  # attrs (arbitrary size -- never asserted)
    out += _block(b"\x00" * 8)  # storage (arbitrary size -- never asserted)
    out += _block(struct.pack("<I", len(ordinals)))
    for ordinal in ordinals:
        out += _NULL_BLOCK
        out += _block(struct.pack("<II", 0, ordinal))
        out += _NULL_BLOCK
    out += _block(struct.pack("<I", len(subfolders)))
    for sub in subfolders:
        out += sub
    return bytes(out)


def _synthetic_opj(
    window_names: list[str],
    root_name: str,
    root_ordinals: list[int],
    subfolders: list[bytes] | None = None,
    n_notes: int = 0,
) -> bytes:
    """A full, minimal, parseable ``.opj`` byte stream: header line, one
    window-header block per name in ``window_names`` (in stream order, so
    ``window_names[k]`` is ordinal ``k``), an empty params section, an
    opaque project record, ``n_notes`` empty notes, and the folder tree."""
    subfolders = subfolders or []
    out = bytearray(_HEADER_LINE)
    for name in window_names:
        out += _window_header_block(name)
    out += b"\x00\n"  # params terminator (zero params)
    out += _NULL_BLOCK
    out += _block(b"\x00" * 8)  # opaque project record
    for i in range(n_notes):
        out += _block(f"Note{i}".encode() + b"\x00")
        out += _block(b"some note content")
    out += _NULL_BLOCK  # notes-list terminator
    out += _block(struct.pack("<I", 0))  # leading scalar (unused)
    out += _block(b"\x00" * 16)  # id blob (unused)
    out += _folder(root_name, root_ordinals, subfolders)
    return bytes(out)


# ── structural generality: cases the real corpus doesn't exercise hard ───────


def test_deep_nesting_four_levels() -> None:
    """A/B/C/D, one window at the bottom -- arbitrary recursion, not a fixed depth."""
    d = _folder("D", [0])
    c = _folder("C", [], [d])
    b = _folder("B", [], [c])
    a = _folder("A", [], [b])
    data = _synthetic_opj(["Deepest"], "Root", [], [a])
    paths = opj_folder_paths(data)
    assert paths == {"Deepest": ["A", "B", "C", "D"]}


def test_empty_folder_with_only_a_subfolder_holding_a_graph_only_folder() -> None:
    """A folder with zero windows of its own but a subfolder full of graphs."""
    plots = _folder("Plots", [0, 1])
    empty_parent = _folder("Data", [], [plots])
    data = _synthetic_opj(["Graph1", "Graph2"], "Root", [], [empty_parent])
    paths = opj_folder_paths(data)
    assert paths == {"Graph1": ["Data", "Plots"], "Graph2": ["Data", "Plots"]}


def test_root_level_window_has_empty_path() -> None:
    """A window sitting directly in the project root, no folder at all."""
    data = _synthetic_opj(["Standalone"], "Root", [0])
    assert opj_folder_paths(data) == {"Standalone": []}


def test_project_with_no_folders_at_all() -> None:
    """The common case: a user who never created a single folder."""
    data = _synthetic_opj(["Book1", "Book2", "Graph1"], "Root", [0, 1, 2])
    paths = opj_folder_paths(data)
    assert paths == {"Book1": [], "Book2": [], "Graph1": []}


def test_many_sibling_folders_with_0_1_and_n_books() -> None:
    empty_f = _folder("Empty", [])
    one_f = _folder("One", [1])
    many_f = _folder("Many", [2, 3, 4, 5, 6])
    data = _synthetic_opj(
        ["Root0", "Solo", "M0", "M1", "M2", "M3", "M4"],
        "Root",
        [0],
        [empty_f, one_f, many_f],
    )
    paths = opj_folder_paths(data)
    assert paths["Root0"] == []  # root-level window unaffected by sibling folders
    assert paths["Solo"] == ["One"]
    assert all(paths[f"M{i}"] == ["Many"] for i in range(5))
    assert ["Empty"] not in paths.values()  # no window claims the empty folder


def test_duplicate_folder_names_at_different_parents_never_collide() -> None:
    """Two folders both named "Data", nested under different parents."""
    data_under_a = _folder("Data", [0])
    a = _folder("A", [], [data_under_a])
    data_under_b = _folder("Data", [1])
    b = _folder("B", [], [data_under_b])
    project = _synthetic_opj(["X0", "X1"], "Root", [], [a, b])
    paths = opj_folder_paths(project)
    assert paths == {"X0": ["A", "Data"], "X1": ["B", "Data"]}


@pytest.mark.parametrize(
    "folder_name",
    [
        "Café España Data",  # accented Latin-1 (é, ñ) + space -- round-trips exactly
        "weird!@#$%^&*()name",  # heavy punctuation
        "x" * 300,  # very long
        "",  # empty
    ],
    ids=["latin1-accented", "punctuation", "very-long", "empty"],
)
def test_arbitrary_folder_name_charsets_never_crash(folder_name: str) -> None:
    sub = _folder(folder_name, [0])
    project = _synthetic_opj(["W1"], "Root", [], [sub])
    paths = opj_folder_paths(project)
    assert paths == {"W1": [folder_name]}


def test_book_with_many_windows_in_one_folder() -> None:
    names = [f"Book{i}" for i in range(20)]
    folder = _folder("Big", list(range(20)))
    project = _synthetic_opj(names, "Root", [], [folder])
    paths = opj_folder_paths(project)
    assert all(paths[n] == ["Big"] for n in names)


def test_malformed_tail_returns_empty_mapping_not_a_crash() -> None:
    """A truncated/corrupted tail must degrade to ``{}``, never raise."""
    good = _synthetic_opj(["A"], "Root", [0])
    truncated = good[: len(good) - 40]
    assert opj_folder_paths(truncated) == {}


def test_no_windows_at_all_returns_empty_mapping() -> None:
    project = _synthetic_opj([], "Root", [])
    assert opj_folder_paths(project) == {}


def test_ordinal_out_of_range_is_dropped_not_guessed() -> None:
    """A folder referencing an ordinal beyond the enumerated window list
    (can't happen in a well-formed file, but must never crash or fabricate
    a name) is silently skipped."""
    folder = _folder("F", [0, 99])
    project = _synthetic_opj(["OnlyOne"], "Root", [], [folder])
    paths = opj_folder_paths(project)
    assert paths == {"OnlyOne": ["F"]}


def test_window_name_enumeration_skips_non_identifier_shaped_blocks() -> None:
    """A block that doesn't look like a real window name (space + punctuation)
    is invisible to ordinal numbering -- later ordinals still resolve to the
    *next real* window, not an off-by-one wrong one."""
    project = _synthetic_opj(["Good1", "not a window!", "Good2"], "Root", [0, 1])
    paths = opj_folder_paths(project)
    assert paths == {"Good1": [], "Good2": []}


def test_digit_led_window_name_is_recognized() -> None:
    project = _synthetic_opj(["30nmADPNR"], "Root", [0])
    assert opj_folder_paths(project) == {"30nmADPNR": []}


def test_notes_section_of_any_length_is_skipped_generically() -> None:
    for n_notes in (0, 1, 3):
        project = _synthetic_opj(["W1"], "Root", [0], n_notes=n_notes)
        assert opj_folder_paths(project) == {"W1": []}


# ── synthetic CPYUA .opju 4.3811 folder-tree builder ─────────────────────────
#
# Emits the exact 4.3811 grammar the decoder was validated against (byte-exact
# vs live COM on 11 controlled projects). These tests then stress structural
# shapes those 11 specimens don't all cover -- deep nesting, empty folders,
# duplicate/unicode/spaced names, graphs interleaved with books -- proving the
# parser is a real recursive grammar, not tuned to the sample byte layouts.

_OPJU_HEADER = b"CPYUA 4.3811 222\n" + b"\x00" * 8
_OPJU_UB = b"\x0a\x02\x75\x62\x0a"
_OPJU_SEP = b"\x80\x12\x8d\x10"
# attrs block between a folder name and its window count; the trailing bytes
# up to and including the "ub" marker are what the parser anchors on.
_OPJU_ATTRS = b"\x04\x07\x01\x47\xc0\x11\x01\x01\x9c\x0a\x00\x04\xa1\x01\x64\x84" + _OPJU_UB


def _opju_win_header(name: str) -> bytes:
    """A worksheet/graph window header: ``0A 00 80 75 04 00 00 <name> 94 0C``."""
    return b"\x0a\x00\x80\x75\x04\x00\x00" + name.encode("latin1") + b"\x94\x0c"


def _opju_name_block(name: str) -> bytes:
    raw = name.encode("latin1") + b"\x00"
    return struct.pack("<I", len(raw)) + b"\x0a" + raw + b"\x0a"


def _opju_entry(ordinal: int) -> bytes:
    if ordinal == 0:
        return b"\x80\x01\x85\x00"  # ordinal 0 short form
    assert 1 <= ordinal <= 255, "builder only emits the 1-byte ordinal form"
    return b"\x80\x04\x81\x01" + bytes([ordinal]) + b"\x80\x00"


def _opju_folder(
    name: str,
    ordinals: list[int],
    children: list[tuple] | None = None,
    *,
    is_last_child: bool = True,
) -> bytes:
    children = children or []
    out = bytearray(_opju_name_block(name))
    out += _OPJU_ATTRS
    out += bytes([2 * len(ordinals)])  # 2*nwin
    out += b"\x00"  # separator before the first entry
    for k, o in enumerate(ordinals):
        out += _opju_entry(o)
        if k < len(ordinals) - 1:
            out += b"\x00"  # inter-entry separator
    if children:
        out += bytes([2 * len(children)])  # 2*nsub
        for j, child in enumerate(children):
            out += _OPJU_SEP + b"\x00" * 16  # separator + 16 date bytes
            out += _opju_folder(*child, is_last_child=(j == len(children) - 1))
    elif is_last_child:
        out += b"\x00"  # leaf terminator (only when no sibling's SEP follows)
    return bytes(out)


def _synthetic_opju(
    window_names: list[str],
    root_name: str,
    root_ordinals: list[int],
    children: list[tuple] | None = None,
) -> bytes:
    """A minimal parseable ``.opju`` stream: header, one window header per
    name (in stream order, so ``window_names[k]`` is ordinal ``k``), then the
    folder tree rooted at ``root_name``."""
    out = bytearray(_OPJU_HEADER)
    for name in window_names:
        out += _opju_win_header(name)
    out += b"\x00" * 8  # gap between the window stream and the tree
    out += _opju_folder(root_name, root_ordinals, children, is_last_child=True)
    out += b"\x00\x00\x00\xde"  # epilogue (must not start with SEP)
    return bytes(out)


# ── .opju 4.3811 structural generality (shapes the 11 COM specimens miss) ─────


def test_opju_deep_nesting_four_levels() -> None:
    d = ("D", [0], [])
    c = ("C", [], [d])
    b = ("B", [], [c])
    a = ("A", [], [b])
    data = _synthetic_opju(["Deepest"], "Proj", [], [a])
    assert opju_folder_paths(data) == {"Deepest": ["A", "B", "C", "D"]}


def test_opju_empty_folder_claims_no_window() -> None:
    one = ("One", [0], [])
    empty = ("Empty", [], [])
    data = _synthetic_opju(["Solo"], "Proj", [], [one, empty])
    paths = opju_folder_paths(data)
    assert paths == {"Solo": ["One"]}
    assert ["Empty"] not in paths.values()


def test_opju_root_level_window_has_empty_path() -> None:
    data = _synthetic_opju(["Standalone"], "Proj", [0])
    assert opju_folder_paths(data) == {"Standalone": []}


def test_opju_graph_interleaved_with_books_keeps_ordinals_aligned() -> None:
    """A graph between books in ordinal order must not shift a book's folder
    (the real ``real2`` COM specimen: [book, graph, book])."""
    folder = ("F1", [0, 1], [])  # book + graph
    data = _synthetic_opju(["BookA", "Graph1", "BookB"], "Proj", [2], [folder])
    paths = opju_folder_paths(data)
    assert paths["BookA"] == ["F1"]
    assert paths["Graph1"] == ["F1"]
    assert paths["BookB"] == []  # ordinal 2 = the root-level book, not shifted


def test_opju_duplicate_folder_names_at_different_parents_never_collide() -> None:
    data_a = ("Data", [0], [])
    a = ("A", [], [data_a])
    data_b = ("Data", [1], [])
    b = ("B", [], [data_b])
    data = _synthetic_opju(["X0", "X1"], "Proj", [], [a, b])
    assert opju_folder_paths(data) == {"X0": ["A", "Data"], "X1": ["B", "Data"]}


def test_opju_skipped_ordinals_resolve_by_value_not_position() -> None:
    """A folder holding non-consecutive ordinals (0 and 2, skipping 1) — the
    ``ac_in_f1`` COM specimen — resolves each entry by its true ordinal."""
    folder = ("F1", [0, 2], [])
    data = _synthetic_opju(["Wa", "Wb", "Wc"], "Proj", [1], [folder])
    paths = opju_folder_paths(data)
    assert paths == {"Wa": ["F1"], "Wc": ["F1"], "Wb": []}


@pytest.mark.parametrize(
    "folder_name",
    ["Café España", "weird!@#$%name", "x" * 60, "Raw normalized"],
    ids=["latin1-accented", "punctuation", "long", "spaced"],
)
def test_opju_arbitrary_folder_names(folder_name: str) -> None:
    sub = (folder_name, [0], [])
    data = _synthetic_opju(["W1"], "Proj", [], [sub])
    assert opju_folder_paths(data) == {"W1": [folder_name]}


def test_opju_many_sibling_folders_with_0_1_and_n_books() -> None:
    empty_f = ("Empty", [], [])
    one_f = ("One", [1], [])
    many_f = ("Many", [2, 3, 4, 5], [])
    data = _synthetic_opju(
        ["R0", "Solo", "M0", "M1", "M2", "M3"], "Proj", [0], [empty_f, one_f, many_f]
    )
    paths = opju_folder_paths(data)
    assert paths["R0"] == []
    assert paths["Solo"] == ["One"]
    assert all(paths[f"M{i}"] == ["Many"] for i in range(4))


def test_opju_no_folders_at_all_maps_every_book_to_root() -> None:
    data = _synthetic_opju(["B1", "B2", "G1"], "Proj", [0, 1, 2])
    assert opju_folder_paths(data) == {"B1": [], "B2": [], "G1": []}


def test_opju_inconsistent_child_count_fails_closed() -> None:
    """A root byte-claiming more children than the stream provides must
    degrade to ``{}`` (fail-closed), never a partial/guessed tree."""
    # root header says 2*nsub = 4 (two children) but only one folder follows
    root = bytearray(_opju_name_block("Proj"))
    root += _OPJU_ATTRS + b"\x00\x00" + b"\x04" + _OPJU_SEP + b"\x00" * 16
    root += _opju_folder("F1", [0], [], is_last_child=True)
    stream = (
        _OPJU_HEADER + _opju_win_header("W1") + b"\x00" * 8 + bytes(root) + b"\x00\x00\x00\xde"
    )
    assert opju_folder_paths(stream) == {}


def test_opju_ordinal_beyond_window_count_fails_closed() -> None:
    """If the tree references an ordinal past the enumerated window list, the
    enumeration is incomplete, so the whole mapping is withheld (stricter than
    the .opj side, which drops just the stray ordinal)."""
    folder = ("F1", [0, 99], [])
    data = _synthetic_opju(["OnlyOne"], "Proj", [], [folder])
    assert opju_folder_paths(data) == {}


def test_opju_older_container_and_junk_degrade_to_empty() -> None:
    """Fail-closed for everything that isn't a 4.3811 tree: empty input,
    ``.opj``-shaped bytes, and random noise all map to ``{}`` (older CPYUA
    containers store membership elsewhere and degrade to a flat import)."""
    assert opju_folder_paths(b"") == {}
    assert opju_folder_paths(_synthetic_opj(["W1"], "Root", [0])) == {}
    assert opju_folder_paths(b"CPYUA 4.3380 188\n" + b"\x00" * 500) == {}


# ── the __init__ wiring: sheet pseudo-books inherit the base book's path ─────


def test_with_folder_path_resolves_sheet_pseudo_books_through_base_book() -> None:
    base = DataStruct(time=np.empty(0), values=np.empty((0, 0)), metadata={"origin_book": "Book4"})
    sheet2 = DataStruct(
        time=np.empty(0), values=np.empty((0, 0)), metadata={"origin_book": "Book4@2"}
    )
    stray = DataStruct(
        time=np.empty(0), values=np.empty((0, 0)), metadata={"origin_book": "Table1"}
    )
    folder_paths = {"Book4": ["Sub subtraction"]}

    out_base = _with_folder_path(base, folder_paths)
    out_sheet = _with_folder_path(sheet2, folder_paths)
    out_stray = _with_folder_path(stray, folder_paths)

    assert out_base.metadata["origin_folder_path"] == ["Sub subtraction"]
    assert out_sheet.metadata["origin_folder_path"] == ["Sub subtraction"]
    assert out_stray.metadata["origin_folder_path"] == []
    # the rest of the DataStruct/metadata is untouched
    assert out_base.metadata["origin_book"] == "Book4"


# ── realdata (skips in CI / where the corpus is absent) ───────────────────────


def _resolve_corpus_dir() -> Path:
    """The local-only ``../test-data/origin`` corpus (see
    ``test_io_origin_project.py``'s ``_resolve_corpus_dir`` for why the
    worktree-relative lookup needs the ``__file__``-walk fallback)."""
    candidate = Path(__file__).resolve().parents[1] / ".." / "test-data" / "origin"
    if candidate.exists():
        return candidate
    for ancestor in Path(__file__).resolve().parents:
        walked = ancestor / "test-data" / "origin"
        if walked.exists():
            return walked
    return candidate


_CORPUS = _resolve_corpus_dir()


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_moke_folder_tree_matches_com_ground_truth() -> None:
    """Pinned against live Origin COM (OriginPro 2026b) Project Explorer:
    ``Raw normalized`` holds Book1/2/3 (+graphs), ``Sub subtraction`` holds
    Book4/5 (+graphs); ``Table1`` is a real stray window in no folder."""
    raw = (_CORPUS / "Moke.opj").read_bytes()
    paths = opj_folder_paths(raw)
    for book in ("Book1", "Book2", "Book3"):
        assert paths[book] == ["Raw normalized"]
    for book in ("Book4", "Book5"):
        assert paths[book] == ["Sub subtraction"]
    assert paths.get("Table1", []) == []  # stray: present-as-[] or absent, both fine


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_moke_books_carry_origin_folder_path() -> None:
    books = read_origin_books(_CORPUS / "Moke.opj")
    by_book = {str(b.metadata["origin_book"]): b for b in books}
    assert by_book["Book1"].metadata["origin_folder_path"] == ["Raw normalized"]
    assert by_book["Book2"].metadata["origin_folder_path"] == ["Raw normalized"]
    assert by_book["Book4"].metadata["origin_folder_path"] == ["Sub subtraction"]
    # a Book4 sheet pseudo-book inherits the base book's folder
    sheet_books = [b for k, b in by_book.items() if k.startswith("Book4@")]
    assert sheet_books and all(
        b.metadata["origin_folder_path"] == ["Sub subtraction"] for b in sheet_books
    )


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_xrd_single_folder1() -> None:
    raw = (_CORPUS / "XRD.opj").read_bytes()
    paths = opj_folder_paths(raw)
    for book in ("Book1", "Book2", "Book3", "Book4", "Book5", "Book6"):
        assert paths[book] == ["Folder1"]


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_older_opju_container_degrades_to_empty_path() -> None:
    """The 4.3380 CPYUA corpus stores folder membership outside the binary
    folder record (not yet decoded), so its books degrade to ``[]`` — a
    clean flat import, never a mis-parse."""
    for stem in ("RockingCurve.opju", "XAS.opju"):
        path = _CORPUS / stem
        if not path.exists():
            continue
        books = read_origin_books(path)
        assert books and all(b.metadata["origin_folder_path"] == [] for b in books)


_OPJU_SPECIMENS = _CORPUS / "specimens" / "_folder_probe"


@pytest.mark.realdata
@pytest.mark.skipif(
    not _OPJU_SPECIMENS.exists(), reason="local .opju 4.3811 folder specimens not present"
)
@pytest.mark.parametrize(
    ("stem", "expected"),
    [
        ("real1", {"Ba": ["F1"], "Bb": ["F1"], "Bc": []}),
        ("real2", {"Ba": ["F1"], "Bb": []}),
        ("deep3", {"Ba": ["F1"], "Bb": ["F1", "F2"], "Bc": ["F1", "F2", "F3"]}),
        ("emptyf", {"Ba": ["F1"], "Bb": []}),
        ("split", {"Wa": ["F1"], "Wb": ["F2"], "Wc": []}),
        ("nested", {"Wb": ["F1"], "Wa": ["F1", "F2"], "Wc": []}),
    ],
)
def test_realdata_opju_4_3811_folder_tree_matches_com(stem: str, expected: dict) -> None:
    """Pinned against live Origin COM (OriginPro 2026b, CPYUA 4.3811): the
    decoded book→folder path matches the Project Explorer tree exactly across
    flat/sibling/nested/deep/empty/graph shapes."""
    path = _OPJU_SPECIMENS / f"{stem}.opju"
    if not path.exists():
        pytest.skip(f"{stem}.opju specimen absent")
    paths = opju_folder_paths(path.read_bytes())
    books = {k: v for k, v in paths.items() if not k.lower().startswith("graph")}
    for book, folder in expected.items():
        assert books.get(book) == folder
