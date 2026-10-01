"""Shared, pure parsing primitives used across io/ parsers.

Ports of the MATLAB helpers parseColHeader + resolveColumnShorthand.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from pathlib import Path

__all__ = [
    "NO_COLUMN",
    "decode_text",
    "parse_col_header",
    "read_head",
    "read_text",
    "resolve_column",
]

NO_COLUMN = -1

_HEADER_UNIT_RE = re.compile(r"^(.+?)\s*\(([^)]+)\)\s*$")

_UTF8_BOM = b"\xef\xbb\xbf"
_UTF16_BOMS = (b"\xff\xfe", b"\xfe\xff")


def decode_text(raw: bytes) -> str:
    """Decode an instrument text file's bytes, BOM-aware.

    A UTF-8 / UTF-16 byte-order mark selects that codec and is dropped (left
    in place it glued ``"ï»¿"`` onto the first cell, which turned a headerless
    file's first number into text and dropped that row). Otherwise strict
    UTF-8 is tried first -- a UTF-8 ``"µemu"`` decoded as latin-1 is the
    mojibake ``"Âµemu"`` -- and anything that is not valid UTF-8 falls back to
    latin-1, which maps every byte, so the legacy 8-bit exports these parsers
    were written for decode exactly as before. Pure ASCII is identical under
    all three.
    """
    if raw.startswith(_UTF8_BOM):
        return raw[len(_UTF8_BOM) :].decode("utf-8", errors="replace")
    if raw.startswith(_UTF16_BOMS):
        return raw.decode("utf-16", errors="replace")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def read_text(path: str | Path) -> str:
    """Read a whole text file through :func:`decode_text`."""
    return decode_text(Path(path).read_bytes())


def read_head(path: str | Path, nbytes: int = 65536, *, encoding: str = "latin-1") -> str:
    """Read and decode at most ``nbytes`` bytes from the start of ``path``.

    Shared by every content sniffer that only needs to inspect a small
    header/preamble region. Replaces the ``Path(path).read_text(...)[:N]``
    pattern, which pulls the WHOLE file into memory just to inspect its
    first few KB -- P0.4 measured ~140 MB of throwaway reads sniffing a
    70 MB CSV before import even begins (``is_sims_file``/``is_lakeshore_file``
    each ``read_text()``-ing the full file twice more on top of the parse
    itself). The default cap (64 KB) comfortably covers every existing sniff
    region (the largest today is 4 KB), so swapping in this reader changes
    nothing observable.

    latin-1 maps every byte to a code point 1:1, so truncating at an
    arbitrary byte boundary can never split a multi-byte character; other
    encodings use ``errors="replace"`` for the same reason a truncated read
    would otherwise risk.

    A leading UTF-8 byte-order mark is dropped, so a sniffer anchored on the
    first line (``line.startswith("#")``) sees the same text the parser will.
    """
    with Path(path).open("rb") as fh:
        raw = fh.read(nbytes)
    if raw.startswith(_UTF8_BOM):
        raw = raw[len(_UTF8_BOM) :]
    return raw.decode(encoding, errors="replace")


def parse_col_header(raw: str) -> tuple[str, str]:
    """Split ``'Magnetic Field (Oe)'`` -> ``('Magnetic Field', 'Oe')``.

    No parenthesised unit -> ``(trimmed name, '')``. Mirrors parseColHeader.
    """
    name = raw.strip()
    if not name:
        return "", ""
    match = _HEADER_UNIT_RE.match(name)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    return name, ""


def _match_column(needle: str, col_names: Sequence[str]) -> int | None:
    """Exact (case-insensitive) match, else partial; shortest matching name wins."""
    lowered = needle.lower()
    for i, name in enumerate(col_names):
        if name.lower() == lowered:
            return i
    matches = [i for i, name in enumerate(col_names) if lowered in name.lower()]
    if not matches:
        return None
    return min(matches, key=lambda i: len(col_names[i]))


def resolve_column(
    spec: int | str,
    col_names: Sequence[str],
    shorthand_map: Mapping[str, str] | None = None,
    label: str = "column",
) -> int:
    """Resolve a column spec to a 0-based index (mirrors resolveColumnShorthand).

    Order: int index -> empty (``NO_COLUMN``) -> [shorthand target, then the
    literal spec], each tried exact (ci) then partial (ci, shortest name wins)
    -> ``KeyError``. The literal-spec fallback lets ``"field"`` resolve a column
    named literally ``Field`` (MPMS-classic naming) when the shorthand target
    ``"Magnetic Field"`` is absent.
    """
    if isinstance(spec, int):
        if 0 <= spec < len(col_names):
            return spec
        raise IndexError(f"{label} index {spec} out of range (0-{len(col_names) - 1})")

    needle = spec.strip()
    if not needle:
        return NO_COLUMN

    # Try the shorthand target first (keeps current behaviour), then the literal
    # spec as a fallback so non-canonical column names still resolve.
    candidates: list[str] = []
    if shorthand_map:
        for short, target in shorthand_map.items():
            if needle.lower() == short.lower():
                candidates.append(target)
                break
    candidates.append(needle)

    for cand in candidates:
        hit = _match_column(cand, col_names)
        if hit is not None:
            return hit

    raise KeyError(f"cannot resolve {label} '{spec}'. Available: {list(col_names)}")
