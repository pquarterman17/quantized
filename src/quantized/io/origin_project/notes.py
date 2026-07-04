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

    93 <nl> <window-name> 00   0a <tl> <note-text> 00

— a ``0x93`` window-name record (``nl`` counts name+NUL) whose NUL butts
directly against a ``0x0a`` text record (``tl`` counts text+NUL). Validated
against a known-content specimen (``tools/origin_trial/generate_specimens2``
-> ``notes_probe.opju``, planted text ``QZNOTE line one/two``): the pattern
recovers the exact two lines AND matches **zero** records across the whole
real corpus (none of which carry a notes window), so it attaches nothing
speculatively — the false-positive bar the earlier log-only scan set. Notes
land in ``metadata['origin_notes']`` as ``{window_name: text}``. The scan is
byte-level so it also runs over ``.opj`` (CPYA), where it is likewise
false-positive-clean on the corpus but has no known-content oracle; Origin
2023+ cannot write ``.opj`` so no such specimen can be produced.
"""

from __future__ import annotations

import re

__all__ = ["notes_windows", "parse_results_log", "results_log"]

# One timestamped operation-record header, e.g. `[5/6/2019 15:16:34 "" (2458609)]`.
_RECORD = re.compile(rb"\[\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}:\d{2}[^\]\r\n]{0,80}\]")

# A printable text run long enough to hold at least one record.
_RUN = re.compile(rb"[\x20-\x7e\r\n\t]{40,}")

_MAX_LOG = 200_000  # metadata guard: never attach unbounded text

# Text containing any of these is an internal storage blob, not a user note.
_NOTE_JUNK = (b"\\", b"OriginStorage", b"ColumnInfo", b"ImportFile", b"<", b">", b"CDATA")
_MAX_NOTES = 64  # sane cap on notes windows per project
_MAX_NOTE_LEN = 250  # single-byte length prefix ceiling


def results_log(b: bytes) -> str:
    """The project's results-log text, or ``""`` when none is present.

    Only printable runs containing a timestamped record header qualify —
    OriginStorage XML, LabTalk scripts, and other internal text never match
    the record shape, so nothing is scraped speculatively.
    """
    parts: list[str] = []
    total = 0
    for m in _RUN.finditer(b):
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


def notes_windows(b: bytes) -> dict[str, str]:
    """Map notes-window name -> its free text (``\\r\\n`` normalized to ``\\n``).

    Recognizes only the exact contiguous ``93 <nl> <name> 00 0a <tl> <text>
    00`` framing (see module docstring). Every candidate must pass a
    printable-character + internal-junk-token filter, so OriginStorage XML
    and storage blobs never masquerade as user notes. Returns ``{}`` when no
    notes window is present.
    """
    out: dict[str, str] = {}
    n = len(b)
    for m in re.finditer(rb"\x93", b):
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
        tl = b[q + 1]
        if not (2 <= tl <= _MAX_NOTE_LEN) or q + 1 + tl >= n or b[q + 1 + tl] != 0:
            continue
        text = b[q + 2 : q + 1 + tl]  # tl-1 bytes + the NUL just checked
        if not _printable(text, allow_newlines=True):
            continue
        if any(j in text for j in _NOTE_JUNK):
            continue
        out[name.decode("latin1")] = text.decode("latin1").replace("\r\n", "\n")
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
