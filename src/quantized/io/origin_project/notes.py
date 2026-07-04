"""Results-log recovery from Origin project files (plan item 6, log half).

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

Notes *windows* (free-form user text pages) are NOT recovered here: no
corpus file offered a known-content specimen to validate against, and an
unvalidated scraper would risk attaching arbitrary internal strings to user
data. When a specimen exists the same run-scan can be extended honestly.
"""

from __future__ import annotations

import re

__all__ = ["results_log"]

# One timestamped operation-record header, e.g. `[5/6/2019 15:16:34 "" (2458609)]`.
_RECORD = re.compile(rb"\[\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}:\d{2}[^\]\r\n]{0,80}\]")

# A printable text run long enough to hold at least one record.
_RUN = re.compile(rb"[\x20-\x7e\r\n\t]{40,}")

_MAX_LOG = 200_000  # metadata guard: never attach unbounded text


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
