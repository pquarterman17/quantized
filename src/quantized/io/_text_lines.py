"""Line-level text handling shared by the delimited readers.

Pure layer: strings in, strings out. Four small, independent rules that sit
BEFORE tokenisation, so the delimiter vote and the data block see the same
lines:

* ``logical_lines`` -- a quoted field may hold a line break (RFC 4180); the
  physical lines of such a record are one logical line, not two rows.
* ``strip_inline_comment`` -- ``1,2  # note`` keeps only the numbers.
* ``is_markdown_rule`` / ``normalize_pipe_line`` -- a Markdown/ASCII pipe table
  (``| a | b |`` over ``|---|---|``).
"""

from __future__ import annotations

import re

from quantized.io._fortran_float import parse_float

__all__ = ["is_markdown_rule", "logical_lines", "normalize_pipe_line", "strip_inline_comment"]

#: A quoted record spanning more physical lines than this is not joined: an
#: unterminated quote must not swallow the rest of the file (the old behaviour
#: for it -- one bad row -- is kept).
_MAX_QUOTE_LINES = 100
_OPENERS = ",;\t|"


def _scan_quotes(line: str, in_quote: bool) -> bool:
    """Whether ``line`` ends inside a quoted field. A quote OPENS a field only
    at the start of a cell (line start, or after ``, ; | TAB`` and blanks), so
    an inch mark (``5" pipe``) never does; ``""`` inside a field is a literal."""
    i, n = 0, len(line)
    while i < n:
        if line[i] != '"':
            i += 1
            continue
        if in_quote:
            if i + 1 < n and line[i + 1] == '"':
                i += 2
                continue
            in_quote = False
        else:
            j = i - 1
            while j >= 0 and line[j] == " ":
                j -= 1
            if j < 0 or line[j] in _OPENERS:
                in_quote = True
        i += 1
    return in_quote


def logical_lines(text: str) -> list[str]:
    """``text.splitlines()`` with the physical lines of a quoted record that
    contains a line break joined by ``"\\n"`` into one logical line. A record
    whose quote never closes within `_MAX_QUOTE_LINES` stays as it was."""
    lines = text.splitlines()
    if '"' not in text:
        return lines
    out: list[str] = []
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        # An even quote count is balanced in every realistic file (and skips
        # the char loop for the common all-quoted export).
        if line.count('"') % 2 and _scan_quotes(line, False):
            joined = _join_record(lines, i)
            if joined is not None:
                out.append("\n".join(lines[i:joined]))
                i = joined
                continue
        out.append(line)
        i += 1
    return out


def _join_record(lines: list[str], start: int) -> int | None:
    """End index (exclusive) of the quoted record opened on ``lines[start]``,
    or None when its quote does not close within `_MAX_QUOTE_LINES`."""
    for j in range(start + 1, min(len(lines), start + 1 + _MAX_QUOTE_LINES)):
        if not _scan_quotes(lines[j], True):
            return j + 1
    return None


_INLINE_MARK = re.compile(r"[ \t][#%]")
_FIELD_SPLIT = re.compile(r"[,;\t| ]+")


def _all_numeric(head: str) -> bool:
    tokens = [t for t in _FIELD_SPLIT.split(head) if t]
    if not tokens:
        return False
    try:
        for tok in tokens:
            parse_float(tok)
    except ValueError:
        return False
    return True


def strip_inline_comment(line: str) -> str:
    """Drop a trailing ``# note`` / ``% note`` from a numeric data line.

    Only when the marker follows whitespace, sits outside any quoted field, and
    EVERYTHING before it is numeric -- so a text cell ("50 % Co"), a header, or
    a quoted cell is never cut. A ``%`` must also carry a comment (``5 %`` is a
    unit)."""
    if "#" not in line and "%" not in line:
        return line
    for m in _INLINE_MARK.finditer(line):
        pos = m.start()
        if line.count('"', 0, pos) % 2:
            continue
        rest = line[pos + 2 :]
        if line[pos + 1] == "%" and (not rest.strip() or rest.lstrip()[0] in _OPENERS):
            return line
        head = line[:pos].rstrip()
        return head if _all_numeric(head) else line
    return line


_RULE_RE = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def is_markdown_rule(line: str) -> bool:
    """A Markdown table's ``|---|:---:|`` separator row (it has a pipe)."""
    return "|" in line and bool(_RULE_RE.match(line))


def normalize_pipe_line(line: str) -> str:
    """One pipe-table row as ``a|b|c``: outer pipes dropped, cells trimmed."""
    body = line.strip()
    body = body.removeprefix("|").removesuffix("|")
    return "|".join(cell.strip() for cell in body.split("|"))
