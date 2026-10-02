"""CSV formula-injection guard for exported text cells (OWASP rule).

Exported CSVs carry labels, units, and names read from imported files, which
are untrusted. A spreadsheet treats a cell that starts with ``=``, ``+``,
``-``, or ``@`` (or tab / CR, which some apps strip first) as a formula, so a
label like ``=HYPERLINK("http://evil","x")`` would turn live on open. The
OWASP fix: prefix such a TEXT cell with a single quote ``'``.

Numeric cells are never passed through here, and a numeric literal that does
reach :func:`neutralize_formula` (a header like ``-1.5``) is left alone, so
negative numbers stay numbers.

Pure library (stdlib only), shared by ``io/`` and ``calc/`` writers.
"""

from __future__ import annotations

import re

__all__ = ["csv_text_cell", "neutralize_formula", "safe_comment_line"]

_TRIGGERS = ("=", "+", "-", "@", "\t", "\r")
_NUMBER = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")


def neutralize_formula(text: str) -> str:
    """``text`` with a leading ``'`` when it would start a spreadsheet formula.

    A plain decimal literal (``-1.5``, ``+2``, ``-3e-4``) is returned
    unchanged: it is a number, not a formula."""
    if text.startswith(_TRIGGERS) and _NUMBER.fullmatch(text) is None:
        return "'" + text
    return text


def csv_text_cell(text: str, sep: str = ",") -> str:
    """One TEXT cell for a ``sep``-delimited file: neutralized, then quoted
    (RFC 4180, ``"`` doubled) when it holds ``sep``, a quote, or a newline."""
    cell = neutralize_formula(text)
    if sep in cell or any(ch in cell for ch in '"\n\r'):
        return '"' + cell.replace('"', '""') + '"'
    return cell


def safe_comment_line(line: str, sep: str = ",") -> str:
    """A free-text line (``# Sample: …``) that embeds file-derived text.

    A spreadsheet splits it on ``sep`` and on newlines, so embedded text could
    open a new cell or row that starts a formula. Newlines become spaces, and
    every ``sep``-split segment that would start a formula (or a quoted field,
    which a spreadsheet unwraps first) gets the ``'`` prefix. A line without
    those hazards is returned unchanged."""
    flat = line.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    parts = flat.split(sep)
    safe = [neutralize_formula(parts[0])]
    for part in parts[1:]:
        safe.append("'" + part if part.startswith('"') else neutralize_formula(part))
    return sep.join(safe)
