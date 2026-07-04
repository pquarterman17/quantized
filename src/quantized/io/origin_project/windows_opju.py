"""Extract per-column long-names/units from the ``.opju`` (CPYUA) windows section.

The CPYUA container's worksheet windows section is not `.opj`'s CPY block
stream (see ``docs/origin_re/opj_windows_section.md``) — it uses its own
tag/length framing that this module does not fully parse. What IS pinned,
validated against Origin's own exported ground truth across five real
corpus files (XAS, RockingCurve, UnpolPlots, "Fixed Lambdas SI", plus the
``rosetta_*`` specimens — 145/145 names, units, and comments matched):

* Every worksheet column carries a 2-byte **plot-designation marker**:
  ``21 51`` for X, ``21 61`` for Y, ``30 61`` for Y-error — the same
  marker-byte + display-code convention `.opj` uses at property-block
  offsets 0x25/0x26 (see ``opj_windows_section.md`` sec 4.1), reused inside
  CPYUA's own framing.
* A fixed-shape run (default column-format doubles) follows every marker,
  then an OPTIONAL length-prefixed embedded blob (``<len><tag=0x01><bytes>
  <NUL>``) carrying that column's ``ColumnInfo``/``ImportFile`` storage
  (only present for imported-file columns — a long file path, possibly
  using Origin's internal string back-reference shorthand which this
  module never tries to decode), then the REAL label record in the SAME
  ``<len:u8><tag:u8><text><NUL>`` shape (``len`` counts tag+text+NUL).
  ``text`` splits on ``\\r\\n`` into long_name/unit/comment (0-3 rows); a
  zero-length text (tag ``0x01``, no ``\\r\\n``) means "no label" (e.g. an
  unlabeled Y column) and some columns carry only a bare long name with no
  ``\\r\\n`` at all (single-row form).
* Every column emits its own marker (+ optional label) record, in true
  sheet column order (A, B, C, ...) — INCLUDING columns that never decode
  as data (e.g. a blank/text column between two decoded numeric ones).
  That is why association is by ORDINAL POSITION within one book's
  contiguous marker run, mapped through the standard A/B/C/... lettering,
  rather than by parsing an internal short-name field — no such field was
  pinned for CPYUA (unlike `.opj`'s offset-0x12 short name).
* Each book's own marker run is anchored via ONE OF: (a) the embedded
  ``ColumnInfo``/``ImportFile`` path's filename, alnum-stripped and matched
  against the book's known short name (handles Origin's habit of dropping
  underscores when deriving a book short name from an imported filename,
  e.g. ``bl11_YIGPy_032.dat`` -> book ``bl11YIGPy032``); or (b) a
  ``<len=namelen+2> 00 00 <name>`` window/book-header reference that
  appears even for books never imported from a file (manually-typed
  sheets, e.g. the ``rosetta_*`` specimens).

Positional guessing is NOT used to *detect* a label: every accepted record
matches the exact ``<len><tag><text><NUL>`` byte count PLUS a character-
class + known-internal-token filter (rejects embedded blob fragments like
a truncated ``ResultsLog``/``OriginStorage`` token, which the length-prefix
match alone can accidentally land inside). Association across a book's
columns IS positional, but only after that book's boundary is independently
confirmed by anchor (a) or (b) above — never by scanning the whole file for
ASCII runs. When no anchor is found, or the marker run doesn't cover every
column ``opju_codec.scan_columns`` actually decoded for that book, the book
is left out of the result entirely (A/B/C fallback stays in force) rather
than guessed at.

See ``docs/origin_re/opju_container.md`` for the full byte-level trail.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence

from quantized.io.origin_project.opju_codec import tail_start
from quantized.io.origin_project.windows import BookMeta, ColumnMeta

__all__ = ["opju_window_metadata"]

_X_MARK = b"\x21\x51"
_Y_MARK = b"\x21\x61"
_YERR_MARK = b"\x30\x61"
_DESIGNATION = {"X": "X", "Y": "Y", "Y-error": "Y-error"}

# A backslash-delimited filename token, as embedded in a column's ImportFile path.
_FILENAME_RE = re.compile(rb"\\([\w \-]{1,60}?\.[A-Za-z0-9]{2,5})(?=[^\w.]|$)")
# A plausible bare long-name (no unit/comment row): starts alnum, short, no path/markup chars.
_SINGLE_ROW_RE = re.compile(rb"^[A-Za-z][A-Za-z0-9 ./+-]{0,39}$")
# Text containing any of these is inside an embedded storage blob, not a real label.
_JUNK_MARKERS = (b"\\", b"OriginStorage", b"ColumnInfo", b"ImportFile", b"<", b">")
# Single-row candidates that are themselves a fragment of one of these internal
# tokens (e.g. a length-prefix match landing mid-string, "esultsLog") are noise.
_KNOWN_TOKENS = (
    b"ResultsLog",
    b"OriginStorage",
    b"ColumnInfo",
    b"ImportFile",
    b"TREE",
    b"Organizer",
    b"IMGEXP",
    b"AXISTYPE",
    b"Script",
    b"History",
    b"PConst",
)
_MAX_GAP = 600  # max byte spacing between one column-property record and the next
_MAX_RUN = 30  # sane upper bound on columns scanned per book in one contiguous run


def _strip_alnum(s: bytes) -> bytes:
    return re.sub(rb"[^A-Za-z0-9]", b"", s)


def _filename_anchors(b: bytes, start: int) -> list[tuple[int, bytes, bytes]]:
    """``(position, alnum-stripped-basename, raw-filename)`` per backslash token."""
    out: list[tuple[int, bytes, bytes]] = []
    for m in _FILENAME_RE.finditer(b):
        if m.start() < start:
            continue
        raw = m.group(1)
        base = raw.rsplit(b".", 1)[0]
        out.append((m.start(), _strip_alnum(base), raw))
    return out


def _book_anchor(
    b: bytes, short: str, search_from: int, filename_hits: list[tuple[int, bytes, bytes]]
) -> tuple[int, bytes | None] | None:
    """First ``(position, raw_filename_or_None)`` identifying this book's window section."""
    short_b = short.encode("latin1")
    for pos, stripped, raw in filename_hits:
        if pos >= search_from and stripped == short_b:
            return pos, raw
    header_len = len(short_b) + 2
    if header_len < 256:
        idx = b.find(bytes([header_len]) + b"\x00\x00" + short_b, search_from)
        if idx >= 0:
            return idx, None
    if len(short) >= 4:  # storage-tail reference; too ambiguous for short names alone
        storage_len = len(short_b) + 1
        if storage_len < 256:
            idx = b.find(bytes([storage_len]) + short_b + b"\x00", search_from)
            if idx >= 0:
                return idx, None
    return None


def _find_label(b: bytes, start: int, end: int) -> str | None:
    """First label-shaped record in ``[start, end)``.

    Prefers a ``\\r\\n``-split multi-row label (long_name/unit/comment); falls
    back to a single-row (long-name-only) record when no multi-row match
    exists in range.
    """
    multi = single = None
    limit = min(end, len(b) - 2)
    for p in range(start, limit):
        length = b[p]
        if length < 2 or length > 120 or p + 1 + length > len(b):
            continue
        payload = b[p + 1 : p + 1 + length]
        if payload[-1] != 0:
            continue
        text = payload[1:-1]
        if not text:
            continue
        if not all(0x09 <= c <= 0x0D or 0x20 <= c <= 0x7E or 0xA0 <= c <= 0xFF for c in text):
            continue
        if any(marker in text for marker in _JUNK_MARKERS):
            continue
        try:
            decoded = text.decode("latin1")
        except UnicodeDecodeError:
            continue
        if b"\r\n" in text:
            multi = decoded
            break
        if single is None and _SINGLE_ROW_RE.match(text):
            if len(text) >= 4 and any(text in token for token in _KNOWN_TOKENS):
                continue
            single = decoded
    return multi if multi is not None else single


def opju_window_metadata(
    b: bytes, book_columns: Mapping[str, Sequence[str]]
) -> dict[str, BookMeta]:
    """Map book short name -> :class:`~quantized.io.origin_project.windows.BookMeta`.

    ``book_columns`` is the already-decoded ``{book: [col_letter, ...]}``
    ordering (see ``opj._group``) — this function never invents a column
    that ``opju_codec.scan_columns`` didn't independently decode; it only
    attaches a label to it when the book's marker run can be confirmed.
    """
    start = tail_start(b)
    markers = sorted(
        [(m.start(), "X") for m in re.finditer(_X_MARK, b) if m.start() >= start]
        + [(m.start(), "Y") for m in re.finditer(_Y_MARK, b) if m.start() >= start]
        + [(m.start(), "Y-error") for m in re.finditer(_YERR_MARK, b) if m.start() >= start]
    )
    filename_hits = _filename_anchors(b, start)
    books: dict[str, BookMeta] = {}
    cursor = start
    for book, cols in book_columns.items():
        if not cols:
            continue
        anchored = _book_anchor(b, book, cursor, filename_hits)
        if anchored is None:
            continue
        anchor, raw_filename = anchored
        candidates = [t for t in markers if t[0] > anchor]
        x_positions = [i for i, t in enumerate(candidates) if t[1] == "X"]
        letter_map: dict[str, tuple[int, str]] | None = None
        run: list[tuple[int, str]] = []
        for xi in x_positions:
            attempt = [candidates[xi]]
            j = xi + 1
            while (
                j < len(candidates)
                and candidates[j][0] - attempt[-1][0] <= _MAX_GAP
                and len(attempt) < _MAX_RUN
            ):
                attempt.append(candidates[j])
                j += 1
            if len(attempt) < len(cols):
                continue
            candidate_map = {chr(ord("A") + i): attempt[i] for i in range(min(len(attempt), 26))}
            if all(c in candidate_map for c in cols):
                letter_map, run = candidate_map, attempt
                break
        if letter_map is None:
            continue
        long_name = raw_filename.decode("latin1", errors="replace") if raw_filename else book
        columns: dict[str, ColumnMeta] = {}
        for col in cols:
            pos, desig = letter_map[col]
            ordinal = run.index(letter_map[col])
            next_pos = run[ordinal + 1][0] if ordinal + 1 < len(run) else pos + 3000
            label = _find_label(b, pos + 2, min(next_pos, pos + 3000))
            rows = (label.split("\r\n") if label else []) + ["", "", ""]
            columns[col] = ColumnMeta(col, _DESIGNATION.get(desig, "Y"), rows[0], rows[1], rows[2])
        books[book] = BookMeta(book, long_name, columns)
        cursor = run[-1][0] + 1
    return books
