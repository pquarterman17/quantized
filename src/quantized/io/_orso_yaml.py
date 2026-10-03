"""The YAML subset an ORSO ``.ort`` header uses (helper for :mod:`quantized.io.orso`).

PyYAML is not a direct dependency (only a transitive one of uvicorn's extras),
so the header is read by this small, lenient parser instead. It covers what
orsopy writes and the 0.1/1.0 examples use:

- block mappings (``key: value``, ``key:`` + an indented block), including a
  sequence written at the same indent as its key (``columns:`` / ``- {...}``);
- block sequences, with mapping items (``- file: x`` + continuation keys);
- flow mappings / sequences (``{name: Qz, unit: 1/angstrom}``, ``[]``), also
  when they wrap onto later lines;
- quoted scalars, ``null``/``true``/``false``/numbers, ``#`` comments;
- ``|`` / ``>`` block scalars and plain scalars that wrap onto later lines.

Anything else degrades to a string; the parser never raises. Timestamps stay
strings. Pure ``io`` layer.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

__all__ = ["load_header", "merge"]

_KEY_RE = re.compile(r"^([^\s'\"{\[#-][^#]*?|-[^\s][^#]*?)\s*:(?:\s+(.*))?$")
_INT_RE = re.compile(r"^[-+]?\d+$")
_FLOAT_RE = re.compile(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$")

_Line = tuple[int, str]


def _strip_comment(text: str) -> str:
    """``text`` without a trailing ``# comment`` (a ``#`` outside quotes that
    starts the line or follows whitespace)."""
    quote = ""
    for i, ch in enumerate(text):
        if quote:
            if ch == quote:
                quote = ""
        elif ch in "'\"":
            quote = ch
        elif ch == "#" and (i == 0 or text[i - 1] in " \t"):
            return text[:i].rstrip()
    return text.rstrip()


def _depth(text: str) -> int:
    """Open ``{``/``[`` minus closed, outside quotes."""
    depth, quote = 0, ""
    for ch in text:
        if quote:
            if ch == quote:
                quote = ""
        elif ch in "'\"":
            quote = ch
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
    return depth


def _logical_lines(raw: Sequence[str]) -> list[_Line]:
    """(indent, text) per non-blank line, comments stripped, a wrapped flow
    collection joined onto its first line."""
    out: list[_Line] = []
    pending: tuple[int, str] | None = None
    for line in raw:
        text = _strip_comment(line.expandtabs())
        if not text.strip():
            continue
        if pending is not None:
            joined = pending[1] + " " + text.strip()
            if _depth(joined) > 0:
                pending = (pending[0], joined)
            else:
                out.append((pending[0], joined))
                pending = None
            continue
        indent = len(text) - len(text.lstrip())
        if _depth(text) > 0:
            pending = (indent, text.strip())
        else:
            out.append((indent, text.strip()))
    if pending is not None:
        out.append(pending)
    return out


def _split_top(text: str) -> list[str]:
    """Split a flow collection's body at top-level commas."""
    parts: list[str] = []
    depth, quote, start = 0, "", 0
    for i, ch in enumerate(text):
        if quote:
            if ch == quote:
                quote = ""
        elif ch in "'\"":
            quote = ch
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(text[start:i])
            start = i + 1
    parts.append(text[start:])
    return [p.strip() for p in parts if p.strip()]


def scalar(text: str) -> Any:
    """One YAML scalar or flow collection."""
    s = text.strip()
    if s.startswith("{") and s.endswith("}"):
        out: dict[str, Any] = {}
        for part in _split_top(s[1:-1]):
            match = _KEY_RE.match(part)
            if match is None:
                out[part] = None
            else:
                out[_key(match.group(1))] = scalar(match.group(2) or "")
        return out
    if s.startswith("[") and s.endswith("]"):
        return [scalar(p) for p in _split_top(s[1:-1])]
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "'\"":
        body = s[1:-1]
        return body.replace("''", "'") if s[0] == "'" else body
    low = s.lower()
    if low in ("", "~", "null"):
        return None
    if low in ("true", "false"):
        return low == "true"
    if _INT_RE.match(s):
        return int(s)
    if _FLOAT_RE.match(s):
        return float(s)
    if low in (".inf", "-.inf", ".nan"):
        return float(low.replace(".", ""))
    return s


def _key(text: str) -> str:
    key = text.strip()
    if len(key) >= 2 and key[0] == key[-1] and key[0] in "'\"":
        return key[1:-1]
    return key


def _is_item(text: str) -> bool:
    return text == "-" or text.startswith("- ")


class _Parser:
    def __init__(self, lines: list[_Line]) -> None:
        self.lines = lines
        self.i = 0

    def _deeper(self, indent: int) -> int | None:
        """The indent of the next line when it is deeper than ``indent``."""
        if self.i < len(self.lines) and self.lines[self.i][0] > indent:
            return self.lines[self.i][0]
        return None

    def block(self, indent: int) -> Any:
        _, text = self.lines[self.i]
        if _is_item(text):
            return self.sequence(indent)
        if _KEY_RE.match(text) and not text.startswith(("{", "[")):
            return self.mapping(indent)
        return self.plain(indent - 1, "")

    def plain(self, parent: int, first: str) -> Any:
        """A scalar plus every following line indented past ``parent``."""
        parts = [first] if first else []
        while self.i < len(self.lines) and self.lines[self.i][0] > parent:
            parts.append(self.lines[self.i][1])
            self.i += 1
        return scalar(" ".join(parts)) if len(parts) == 1 else " ".join(parts)

    def literal(self, parent: int, style: str) -> str:
        texts: list[tuple[int, str]] = []
        while self.i < len(self.lines) and self.lines[self.i][0] > parent:
            texts.append(self.lines[self.i])
            self.i += 1
        if not texts:
            return ""
        base = min(ind for ind, _ in texts)
        rows = [" " * (ind - base) + t for ind, t in texts]
        return ("\n" if style == "|" else " ").join(rows)

    def value_after_key(self, indent: int, rest: str) -> Any:
        if rest == "":
            deeper = self._deeper(indent)
            if deeper is not None:
                return self.block(deeper)
            if self.i < len(self.lines) and self.lines[self.i][0] == indent:
                if _is_item(self.lines[self.i][1]):
                    return self.sequence(indent)
            return None
        if rest[0] in "|>" and rest.rstrip("+-0123456789") in ("|", ">"):
            return self.literal(indent, rest[0])
        return self.plain(indent, rest)

    def mapping(self, indent: int) -> dict[str, Any]:
        out: dict[str, Any] = {}
        while self.i < len(self.lines):
            ind, text = self.lines[self.i]
            if ind != indent or _is_item(text):
                break
            match = _KEY_RE.match(text)
            self.i += 1
            if match is None:
                continue  # an unparseable line: skip it, never fail the file
            out[_key(match.group(1))] = self.value_after_key(indent, (match.group(2) or "").strip())
        return out

    def sequence(self, indent: int) -> list[Any]:
        out: list[Any] = []
        while self.i < len(self.lines):
            ind, text = self.lines[self.i]
            if ind != indent or not _is_item(text):
                break
            rest = text[1:].lstrip()
            if rest == "":
                self.i += 1
                deeper = self._deeper(indent)
                out.append(self.block(deeper) if deeper is not None else None)
                continue
            item_indent = indent + len(text) - len(rest)
            if _is_item(rest) or (_KEY_RE.match(rest) and not rest.startswith(("{", "["))):
                self.lines[self.i] = (item_indent, rest)
                out.append(self.block(item_indent))
            else:
                self.i += 1
                out.append(self.plain(indent, rest))
        return out


def load_header(raw_lines: Sequence[str]) -> dict[str, Any]:
    """Parse header lines (the leading ``#`` already removed) into a dict.
    Text that is not a mapping at the top level yields ``{}``."""
    lines = _logical_lines(raw_lines)
    if not lines:
        return {}
    parser = _Parser(lines)
    out: dict[str, Any] = {}
    while parser.i < len(lines):  # every block consumes at least its first line
        doc = parser.block(lines[parser.i][0])
        if isinstance(doc, dict):
            out.update(doc)
    return out


def merge(base: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    """``base`` with ``update`` merged in recursively (orsopy's rule for the
    header of every data set after the first)."""
    out = dict(base)
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge(out[key], value)
        else:
            out[key] = value
    return out
