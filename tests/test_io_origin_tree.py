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


def test_opju_gap_always_returns_empty_mapping() -> None:
    """Documented gap: the .opju tail's per-window encoding isn't pinned, so
    this must never guess -- any input, even the .opj-shaped bytes above,
    maps to {}."""
    assert opju_folder_paths(b"") == {}
    assert opju_folder_paths(_synthetic_opj(["W1"], "Root", [0])) == {}


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
def test_realdata_opju_books_default_to_empty_path() -> None:
    """Honest documented gap: .opju books always get ``[]`` for now."""
    for stem in ("RockingCurve.opju", "XAS.opju"):
        path = _CORPUS / stem
        if not path.exists():
            continue
        books = read_origin_books(path)
        assert books and all(b.metadata["origin_folder_path"] == [] for b in books)
