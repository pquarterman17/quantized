"""The structural ``.opju`` reader against REAL third-party projects.

Local-only (``realdata``): the corpus is public GitHub projects with unclear
licences, so neither the files nor any value read from them is committed —
every expectation below is computed at test time from an INDEPENDENT oracle
that sits next to the specimen:

* the **paired ``.opj``** — the reader-test project ships each test project in
  both containers. The ``.opj`` stores every cell as fixed-width records (the
  layout the long-shipped ``.opj`` reader documents, re-implemented here in
  ~40 lines so this test does not depend on that reader), so decoding the
  ``.opju`` and comparing cell-for-cell is a controlled-specimen proof of the
  ``.opju`` record grammar;
* the **published expectations** in that project's own test source, parsed at
  run time for the matrix shape and coordinate ranges.

The corpus is found the way ``test_io_origin_ground_truth`` finds its own
(a ``test-data/origin`` sibling of the checkout), or through
``QZ_ORIGIN_PUBLIC_CORPUS``; everything skips when it is absent.
"""

from __future__ import annotations

import os
import re
from collections import Counter
from pathlib import Path

import numpy as np
import pytest

from quantized.io.origin_project import (
    OriginProjectError,
    read_origin_books,
    read_origin_project_all,
)
from quantized.io.origin_project.container import ORIGIN_MISSING
from quantized.io.origin_project.opju_blocks import find_headers, rle_expand
from quantized.io.origin_project.opju_matrix import matrix_geometry
from quantized.io.origin_project.opju_records import DatasetRecord, scan_records

pytestmark = pytest.mark.realdata

_PAIRED = Path("gh_Altaxo_LibOriginCSharp/LibOriginCSharpTests/Serialization/Origin")


def _public_corpus() -> Path | None:
    env = os.environ.get("QZ_ORIGIN_PUBLIC_CORPUS")
    if env:
        return Path(env) if Path(env).is_dir() else None
    for ancestor in Path(__file__).resolve().parents:
        candidate = ancestor / "test-data" / "origin" / "public"
        if candidate.is_dir():
            return candidate
    return None


_CORPUS = _public_corpus()
_PAIR_DIR = _CORPUS / _PAIRED / "TestFiles" if _CORPUS else None
_STEMS = (
    sorted(p.stem for p in _PAIR_DIR.glob("*.opju") if p.with_suffix(".opj").exists())
    if _PAIR_DIR and _PAIR_DIR.is_dir()
    else []
)


# ── a minimal, independent `.opj` cell reader (the oracle) ───────────────────


def _opj_blocks(b: bytes) -> list[bytes]:
    """Payloads of the ``<u32 size> 0a <payload> 0a`` block stream."""
    out: list[bytes] = []
    pos = b.find(b"\n") + 1
    while pos + 5 <= len(b) and b[pos + 4] == 0x0A:
        size = int.from_bytes(b[pos : pos + 4], "little")
        pos += 5
        if size == 0:
            out.append(b"")
            continue
        if pos + size >= len(b) or b[pos + size] != 0x0A:
            break
        out.append(b[pos : pos + size])
        pos += size + 1
    return out


def _opj_cells(b: bytes) -> dict[str, tuple[bytes, np.ndarray | None, list[str] | None]]:
    """``name -> (147-byte header, numeric cells, text cells)`` over ALL
    allocated rows, each cell read at the fixed width its header declares."""
    out: dict[str, tuple[bytes, np.ndarray | None, list[str] | None]] = {}
    pending: bytes | None = None
    for payload in _opj_blocks(b):
        if len(payload) == 147 and 0x20 < payload[0x58] < 0x7F:
            pending = payload
            continue
        if pending is None or not payload:
            continue
        head, pending = pending, None
        name = head[0x58 : head.index(b"\x00", 0x58)].decode("latin1")
        kind, size, flags = head[0x17], head[0x3D], head[0x3F]
        num: np.ndarray | None = None
        text: list[str] | None = None
        if kind & 1 and size == 10:  # Text&Numeric: u16 0 = double, else inline text
            n = len(payload) // 10
            num = np.full(n, np.nan)
            text = [""] * n
            for i in range(n):
                cell = payload[10 * i : 10 * i + 10]
                if cell[:2] == b"\x00\x00":
                    num[i] = np.frombuffer(cell[2:], "<f8")[0]
                else:
                    text[i] = cell[2:].split(b"\x00")[0].decode("latin1")
        elif kind & 2 and size == 16:
            num = np.frombuffer(payload[: len(payload) // 16 * 16], "<f8")[::2].copy()
        elif kind & 8:
            dtype = f"<{'u' if flags & 8 else 'i'}{size}"
            num = np.frombuffer(payload[: len(payload) // size * size], dtype).astype(float)
        elif size == 8:
            num = np.frombuffer(payload[: len(payload) // 8 * 8], "<f8").copy()
        elif size == 4:
            num = np.frombuffer(payload[: len(payload) // 4 * 4], "<f4").astype(float)
        else:  # fixed-width Text
            n = len(payload) // size
            text = [
                payload[size * i : size * (i + 1)].split(b"\x00")[0].decode("latin1")
                for i in range(n)
            ]
        if num is not None:
            num[num == ORIGIN_MISSING] = np.nan
        out.setdefault(name, (head, num, text))
    return out


def _agrees(rec: DatasetRecord, num: np.ndarray | None, text: list[str] | None) -> bool:
    used = rec.header.used_rows
    if rec.values is not None and (
        num is None or not np.array_equal(num[:used], rec.values, equal_nan=True)
    ):
        return False
    oracle_text = (text or [])[:used]
    if rec.text is not None:
        return oracle_text == rec.text
    return not any(oracle_text)


# ── the paired-container proof ───────────────────────────────────────────────


@pytest.mark.skipif(not _STEMS, reason="paired .opj/.opju specimens not present")
def test_paired_specimens_are_present_in_number() -> None:
    assert len(_STEMS) >= 14


@pytest.mark.parametrize("stem", _STEMS)
def test_opju_header_expands_to_the_paired_opj_header(stem: str) -> None:
    """The run-length block codec, proven: each expanded ``.opju`` header is
    the paired ``.opj`` header, except in bytes neither reader uses."""
    assert _PAIR_DIR is not None
    opju = (_PAIR_DIR / f"{stem}.opju").read_bytes()
    oracle = _opj_cells((_PAIR_DIR / f"{stem}.opj").read_bytes())
    headers = find_headers(opju)
    assert {h.name for h in headers} == set(oracle)
    used_offsets = [0x17, *range(0x19, 0x1D), *range(0x21, 0x25), 0x3D, 0x3F, *range(0x58, 0x70)]
    for h in headers:
        raw = rle_expand(opju, h.start + 2, h.end - h.start - 2)
        assert raw is not None and len(raw) == 147
        head = oracle[h.name][0]
        assert all(raw[i] == head[i] for i in used_offsets), h.name
        # Whatever else differs is confined to container-specific bookkeeping.
        assert sum(raw[i] != head[i] for i in range(147)) <= 4, h.name


@pytest.mark.parametrize("stem", _STEMS)
def test_opju_cells_equal_the_paired_opj_cells(stem: str) -> None:
    """Every record of every storage class decodes, and every used cell —
    number, missing value or text — equals the ``.opj`` cell."""
    assert _PAIR_DIR is not None
    opju = (_PAIR_DIR / f"{stem}.opju").read_bytes()
    oracle = _opj_cells((_PAIR_DIR / f"{stem}.opj").read_bytes())
    records = scan_records(opju)
    assert records
    for rec in records:
        assert rec.decoded, f"{rec.header.name}: {rec.reason}"
        _, num, text = oracle[rec.header.name]
        assert _agrees(rec, num, text), rec.header.name


@pytest.mark.skipif(not _STEMS, reason="paired .opj/.opju specimens not present")
def test_paired_specimens_cover_every_storage_class_and_value_tag() -> None:
    """Positive-control census: the proof above is only as wide as the forms
    the specimens exercise, so pin that width."""
    assert _PAIR_DIR is not None
    forms: Counter[str] = Counter()
    confidence: Counter[str] = Counter()
    for stem in _STEMS:
        for rec in scan_records((_PAIR_DIR / f"{stem}.opju").read_bytes()):
            forms[rec.form] += 1
            confidence[rec.confidence] += 1
    assert set(forms) == {"text_numeric", "double", "complex", "float32", "integer", "text"}
    assert confidence["length_checked"] > 0 and confidence["grammar_only"] > 0


# ── matrix geometry against the published expectations ───────────────────────

_METHOD = re.compile(r"public void (Test\w+)\(\)(.*?)(?=\n    \[Fact\]|\Z)", re.DOTALL)
_FILE = re.compile(r'"(\w+)\.opj"')
_EXPECT = re.compile(r"Assert\.Equal\((-?\d+), sheet\.(ColumnCount|RowCount|X1|X2|Y1|Y2)\)")


def _published_matrix_expectations() -> dict[str, dict[str, float]]:
    """``stem -> {ColumnCount, RowCount, X1, …}`` read from the oracle
    project's own test source at run time (nothing is copied here)."""
    if _CORPUS is None:
        return {}
    candidates = [
        _CORPUS / _PAIRED / "OriginAnyParserTest.cs",
        _CORPUS / _PAIRED.parts[0] / "OriginAnyParserTest.cs",
    ]
    source = next((c for c in candidates if c.is_file()), None)
    if source is None:
        return {}
    out: dict[str, dict[str, float]] = {}
    for _, body in _METHOD.findall(source.read_text(encoding="utf-8-sig")):
        stem = _FILE.search(body)
        expect = {k: float(v) for v, k in _EXPECT.findall(body)}
        if stem and {"ColumnCount", "RowCount"} <= set(expect):
            out[stem.group(1)] = expect
    return out


_MATRIX_EXPECT = _published_matrix_expectations()


@pytest.mark.parametrize("stem", sorted(_MATRIX_EXPECT))
def test_matrix_geometry_matches_the_published_expectations(stem: str) -> None:
    assert _PAIR_DIR is not None
    expect = _MATRIX_EXPECT[stem]
    b = (_PAIR_DIR / f"{stem}.opju").read_bytes()
    records = [r for r in scan_records(b) if not r.header.is_column]
    assert records
    end = max(r.end for r in scan_records(b))
    for rec in records:
        geo = matrix_geometry(b, rec.header.name, rec.header.total_rows, start=end)
        assert geo is not None, rec.header.name
        assert (geo.cols, geo.rows) == (expect["ColumnCount"], expect["RowCount"])
        if "X1" in expect:
            assert geo.x_range == (expect["X1"], expect["X2"])
            assert geo.y_range == (expect["Y1"], expect["Y2"])


@pytest.mark.parametrize("stem", _STEMS)
def test_every_paired_opju_imports_through_the_public_reader(stem: str) -> None:
    """13 of these 14 raised "no worksheet columns" before the structural
    reader; all must import, with nothing left undecoded."""
    assert _PAIR_DIR is not None
    primary, books = read_origin_project_all(_PAIR_DIR / f"{stem}.opju")
    assert books
    fidelity = primary.metadata["origin_worksheet_fidelity"]
    assert fidelity["undecoded"] == []
    assert all(m["imported"] for m in fidelity["matrix_datasets"])


# ── whole-corpus distribution ────────────────────────────────────────────────


@pytest.mark.skipif(_CORPUS is None, reason="public Origin corpus not present")
def test_corpus_fails_closed_and_length_checks_dominate() -> None:
    """Across every small-to-medium ``.opju`` in the corpus: the reader either
    returns books or raises ``OriginProjectError`` (never anything else), and
    most of the records it decodes are proven by their own length
    field rather than accepted on grammar alone."""
    assert _CORPUS is not None
    files = sorted(p for p in _CORPUS.rglob("*.opju") if p.stat().st_size <= 400_000)
    assert files
    confidence: Counter[str] = Counter()
    imported = 0
    for path in files:
        try:
            primary, _ = read_origin_project_all(path)
        except OriginProjectError:
            continue
        imported += 1
        confidence.update(primary.metadata["origin_worksheet_fidelity"]["confidence"])
    assert imported >= 0.9 * len(files)
    assert confidence["length_checked"] >= 3 * confidence["grammar_only"]
    assert confidence["marker_unanchored"] == 0


@pytest.mark.parametrize("stem", [s for s in _STEMS if s.startswith(("Matrix", "OneWorksheetOne"))])
def test_opju_matrix_books_equal_the_paired_opj_matrix_books(stem: str) -> None:
    """Both containers' matrices import as the same X / Y / Z map, cell for
    cell — the `.opj` reader is the oracle for the `.opju` one."""
    assert _PAIR_DIR is not None

    def matrices(path: Path) -> dict[str, object]:
        return {
            str(b.metadata["origin_book"]): b
            for b in read_origin_books(path)
            if b.metadata.get("origin_matrix")
        }

    opj, opju = matrices(_PAIR_DIR / f"{stem}.opj"), matrices(_PAIR_DIR / f"{stem}.opju")
    assert opj and set(opj) == set(opju)
    for name, a in opj.items():
        b = opju[name]
        assert a.labels == b.labels, name  # type: ignore[attr-defined]
        assert np.array_equal(a.values, b.values, equal_nan=True), name  # type: ignore[attr-defined]
        assert b.metadata["is2D"] is True  # type: ignore[attr-defined]
