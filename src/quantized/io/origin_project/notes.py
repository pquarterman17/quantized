"""Results-log + notes-window recovery from Origin project files (plan item 6).

Origin's *results log* — the running record of every analysis operation
(fits, subtractions, smoothing) with its parameters and outputs — is stored
as plain text in the windows section of both containers, as timestamped
records shaped like::

    [5/6/2019 15:16:34 "" (2458609)]
    subtract_line(subtract_line)
      Input
        iy(Input) = [Book4]Sheet1!(C"H",M)
        ...

Because the records are plain text in both ``.opj`` (CPYA) and ``.opju``
(CPYUA), one byte-level scan serves both: collect printable runs that
contain at least one timestamp record header. This is fit *provenance*
worth surfacing, not data — it lands in ``metadata['origin_results_log']``.

That raw text is further parsed into structured per-operation records by
``parse_results_log`` (plan item 22): each record is
``{"timestamp": "M/D/YYYY H:MM:SS", "operation": str, "params": {...}}``
where ``params`` nests by the log's ``Input``/``Output``/etc. section
headers, e.g. ``params["Input"]["iy"] == '[Book4]Sheet1!(C"H",M)'``.
Parameter lines that precede any section header land under the empty-
string section ``params[""]``. Lines inside a record that don't parse as
a timestamp header, an operation line, a section header, or a
``key(display) = value`` parameter are never dropped silently — they
collect in that record's ``"extra"`` list (omitted when empty). A record
with no operation line still yields its timestamp, with
``operation == ""``. This lands in
``metadata['origin_results_log_records']`` alongside the raw text.

*Notes windows* (free-form user text pages) sit in the ``.opju`` (CPYUA)
windows section as a tight, contiguous pair of length-prefixed records::

    93 <nl> <window-name> 00   0a <tl-varint> <note-text> 00

— a ``0x93`` window-name record (``nl`` counts name+NUL) whose NUL butts
directly against a ``0x0a`` text record. ``tl`` is a **LEB128 varint**
counting text+NUL (a 718-byte note stores ``ce 05``): the original
single-byte read silently dropped every note past ~127 chars, fixed
2026-07-06 against ``notes_real.opju`` (a real 717-char note loaded via
``open -n``, holding Windows paths and inequalities). Text decodes
UTF-8-first (latin-1 fallback), and the internal-junk filter keys on named
OriginStorage/CDATA tokens only — NOT bare ``\``/``<``/``>``, which real
notes legitimately carry. It still matches **zero** records across the whole
real corpus (none carry a notes window), so it attaches nothing
speculatively — the false-positive bar the earlier log-only scan set. Notes
land in ``metadata['origin_notes']`` as ``{window_name: text}``. The scan is
byte-level so it also runs over ``.opj`` (CPYA), where it is likewise
false-positive-clean on the corpus but has no known-content oracle; Origin
2023+ cannot write ``.opj`` so no such specimen can be produced.
"""

from __future__ import annotations

import re

from quantized.io.origin_project.tree import _find_tail_start, _TailParseError

__all__ = ["notes_windows", "parse_results_log", "results_log"]

# One timestamped operation-record header, e.g. `[5/6/2019 15:16:34 "" (2458609)]`.
_RECORD = re.compile(rb"\[\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}:\d{2}[^\]\r\n]{0,80}\]")

# A printable text run long enough to hold at least one record.
_RUN = re.compile(rb"[\x20-\x7e\r\n\t]{40,}")

_MAX_LOG = 200_000  # metadata guard: never attach unbounded text

# Text containing any of these is an internal storage blob, not a user note.
# Bare `\`, `<`, `>` were REMOVED 2026-07-06: real notes legitimately hold
# Windows paths ("C:\lab\data") and inequalities ("T < 4 K", "H > 2 T"); the
# named storage tokens below still reject every OriginStorage/CDATA XML blob
# (corpus stays false-positive-clean). `</` catches XML close-tags without
# hitting a lone inequality.
_NOTE_JUNK = (b"OriginStorage", b"ColumnInfo", b"ImportFile", b"CDATA", b"</", b"<NEWBOOK")
_MAX_NOTES = 64  # sane cap on notes windows per project
_MAX_NOTE_LEN = 100_000  # a note is free-form prose; bounded, not a 250-byte cap

_WINDOW_MARK = re.compile(rb"\x93")

# Safety cushion (bytes) subtracted from the structurally-derived tail
# boundary (`tree._find_tail_start`) before scanning a `.opj` for a results
# log / notes window (see `_tail_scan_start`). Never a hardcoded byte offset
# or file-size percentage -- always relative to THIS file's own computed
# block-stream-end position. Sized against the real corpus
# (`../test-data/origin`): every project there with a results log has its
# first match within ~550 bytes of that boundary (XMCD.opj, the largest hit,
# is 521 bytes past it), so 2 MiB leaves a wide cushion while still skipping
# the ~90%+ of a large project (PNR.opj: 127 MB file, 116.5 MB boundary)
# that is bulk float data and structurally cannot contain a match.
_TAIL_SAFETY_MARGIN = 2 * 1024 * 1024


def _tail_scan_start(b: bytes, suffix: str) -> int:
    """Where `results_log`/`notes_windows` should start scanning ``b``.

    Restricted to ``.opj`` (CPYA): its block-stream framing lets
    `tree._find_tail_start` locate exactly where the free-text tail begins
    (results-log records and notes windows both live there -- see the
    module docstring's ``_skip_notes`` reference), and the real corpus
    confirms every match sits within a few hundred bytes of that boundary.

    ``.opju`` (CPYUA) uses a different, FPC-compressed column codec with no
    equivalent boundary function, and the corpus has no full-size `.opju`
    results-log specimen to verify a tail-only property against (its two
    notes-window specimens are ~4 KB, too small for a restriction to matter)
    -- so it (and any other/unknown suffix) keeps the full-buffer scan.
    ``suffix=""`` (the default on both public functions) always full-scans,
    so direct callers that don't know/care about the container type --
    including every synthetic-bytes test in ``test_io_origin_project.py`` --
    are unaffected.

    Never raises: a tail that fails to parse (older/corrupt/unexpected
    containers) degrades to a full scan, same "degrade, never guess"
    convention as `tree.opj_project_dates`/`tree.opj_folder_paths`.
    """
    if suffix != ".opj":
        return 0
    try:
        tail = _find_tail_start(b)
    except _TailParseError:
        return 0
    return max(0, tail - _TAIL_SAFETY_MARGIN)


def results_log(b: bytes, *, suffix: str = "") -> str:
    """The project's results-log text, or ``""`` when none is present.

    Only printable runs containing a timestamped record header qualify —
    OriginStorage XML, LabTalk scripts, and other internal text never match
    the record shape, so nothing is scraped speculatively. ``suffix`` (e.g.
    ``".opj"``) restricts the scan to the structurally-derived tail where a
    match can actually occur (see `_tail_scan_start`); omit it (or pass
    ``""``) to scan the whole buffer.
    """
    start = _tail_scan_start(b, suffix)
    parts: list[str] = []
    total = 0
    for m in _RUN.finditer(b, start):
        run = m.group(0)
        if not _RECORD.search(run):
            continue
        text = run.decode("latin1").strip()
        parts.append(text)
        total += len(text)
        if total >= _MAX_LOG:
            break
    return "\n\n".join(parts)[:_MAX_LOG]


def _printable(data: bytes, *, allow_newlines: bool = False) -> bool:
    lo = 0x09 if allow_newlines else 0x20
    return bool(data) and all(lo <= c <= 0x0D or 0x20 <= c <= 0x7E for c in data)


def _read_varint(b: bytes, p: int) -> tuple[int | None, int]:
    """LEB128 length varint at ``p`` -> ``(value, next_pos)``.

    Returns ``(None, p)`` if it isn't a well-formed varint within 3 bytes. The
    ``.opju`` text record's length prefix GROWS with the note (a 718-byte note
    stores ``ce 05``), so a single-byte read silently dropped every note past
    ~127 chars -- the same varint-width class as the big-column fix (audit
    #16), here confirmed by ``notes_real.opju`` (2026-07-06)."""
    val = shift = 0
    for k in range(3):
        if p + k >= len(b):
            return None, p
        c = b[p + k]
        val |= (c & 0x7F) << shift
        if not c & 0x80:
            return val, p + k + 1
        shift += 7
    return None, p


def _decode_note(raw: bytes) -> str | None:
    """UTF-8-first (latin-1 fallback) note text, ``\\r\\n`` normalized, or
    ``None`` if it isn't printable text. The ``.opju`` container is UTF-8, so a
    note with a degree sign / Greek survives."""
    for enc in ("utf-8", "latin1"):
        try:
            s = raw.decode(enc)
        except UnicodeDecodeError:
            continue
        if any(ord(c) < 0x20 and c not in "\t\r\n" for c in s):
            return None
        return s.replace("\r\n", "\n")
    return None


def notes_windows(b: bytes, *, suffix: str = "") -> dict[str, str]:
    """Map notes-window name -> its free text (``\\r\\n`` normalized to ``\\n``).

    Recognizes only the exact contiguous ``93 <nl> <name> 00 0a <tl> <text>
    00`` framing (see module docstring). Every candidate must pass a
    printable-character + internal-junk-token filter, so OriginStorage XML
    and storage blobs never masquerade as user notes. Returns ``{}`` when no
    notes window is present. ``suffix`` restricts the scan the same way
    `results_log` does -- see `_tail_scan_start`.
    """
    out: dict[str, str] = {}
    n = len(b)
    start = _tail_scan_start(b, suffix)
    for m in _WINDOW_MARK.finditer(b, start):
        p = m.start()
        if p + 2 >= n:
            continue
        nl = b[p + 1]
        if not (2 <= nl <= 64) or p + 1 + nl >= n or b[p + 1 + nl] != 0:
            continue
        name = b[p + 2 : p + 1 + nl]  # nl-1 bytes + the NUL just checked
        if not _printable(name):
            continue
        q = p + 2 + nl  # first byte after the name's NUL
        if q + 1 >= n or b[q] != 0x0A:
            continue
        tl, text_start = _read_varint(b, q + 1)  # tl counts text + trailing NUL
        if tl is None or not (2 <= tl <= _MAX_NOTE_LEN):
            continue
        text_end = text_start + tl - 1  # index of the trailing NUL
        if text_end >= n or b[text_end] != 0:
            continue
        text = b[text_start:text_end]
        if any(j in text for j in _NOTE_JUNK):
            continue
        decoded = _decode_note(text)
        if decoded is None:
            continue
        out[name.decode("latin1")] = decoded
        if len(out) >= _MAX_NOTES:
            break
    return out


# ── structured results-log parsing (plan item 22) ────────────────────────────

# A results-log record header, on ``results_log()``'s decoded str text (see
# ``_RECORD`` above for the byte-level equivalent used to find the raw runs).
_LOG_HEADER = re.compile(r"\[(\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}:\d{2})[^\[\]\r\n]{0,80}\]")

# A bare operation line, e.g. `subtract_line(subtract_line)`: no `=`, so it
# never collides with a `key(display) = value` parameter line.
_OPERATION_LINE = re.compile(r"^([A-Za-z_]\w*)\([^)]*\)\s*$")

# A `key(display) = value` (or plain `key = value`) parameter line.
_PARAM_LINE = re.compile(r"^([A-Za-z_]\w*)(?:\([^)]*\))?\s*=\s*(.*)$")

# A section header, e.g. `Input` / `Output`: a short word/phrase, no `=`.
_SECTION_LINE = re.compile(r"^[A-Za-z][A-Za-z0-9_ ]{0,40}$")


def parse_results_log(text: str) -> list[dict[str, object]]:
    """Parse ``results_log()``'s raw text into structured per-operation records.

    Each record is ``{"timestamp": str, "operation": str, "params": dict}``,
    optionally with an ``"extra"`` list of lines inside the record that didn't
    match any recognized shape (never dropped silently). ``params`` nests by
    the log's section headers (``Input``/``Output``/etc.); parameter lines
    that appear before any section header land under ``params[""]``. A
    record with no operation line still yields its timestamp, with
    ``operation == ""``. Returns ``[]`` when ``text`` holds no timestamp
    headers at all (e.g. ``""``).
    """
    records: list[dict[str, object]] = []
    headers = list(_LOG_HEADER.finditer(text))
    for i, m in enumerate(headers):
        body_end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
        operation = ""
        params: dict[str, dict[str, str]] = {}
        extra: list[str] = []
        section = ""
        is_first_line = True
        for line in text[m.end() : body_end].splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            if is_first_line:
                is_first_line = False
                op_m = _OPERATION_LINE.match(stripped)
                if op_m:
                    operation = op_m.group(1)
                    continue
                # no operation line present -- fall through, reprocess below
            param_m = _PARAM_LINE.match(stripped)
            if param_m:
                params.setdefault(section, {})[param_m.group(1)] = param_m.group(2).strip()
            elif _SECTION_LINE.match(stripped):
                section = stripped
                params.setdefault(section, {})
            else:
                extra.append(stripped)
        record: dict[str, object] = {
            "timestamp": m.group(1),
            "operation": operation,
            "params": params,
        }
        if extra:
            record["extra"] = extra
        records.append(record)
    return records
