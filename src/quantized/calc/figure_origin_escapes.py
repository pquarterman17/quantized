"""Origin-style rich-text escapes in figure labels -> the mathtext subset.

Origin users type sub/superscripts, Greek and bold/italic runs with LabTalk
escapes, and the publication-figures audit (#17) asked that the same syntax
render on screen and in export. The rendering contract (documented for the
toolbar that inserts these, in ``docs/rich_text_labels.md``):

=============  ==============================  =========================
Escape         Meaning                         Rendered as
=============  ==============================  =========================
``\\+(text)``  superscript                     ``$^{\\mathrm{text}}$``
``\\-(text)``  subscript                       ``$_{\\mathrm{text}}$``
``\\g(text)``  Symbol-font Greek (q -> theta)  the Unicode Greek letters
``\\b(text)``  bold                            ``$\\mathbf{text}$``
``\\i(text)``  italic                          ``$\\mathit{text}$``
=============  ==============================  =========================

Runs nest (``\\b(\\g(m)\\+(2))``) and parentheses inside a run balance.
Conversion happens only OUTSIDE ``$...$`` regions -- an author who already
wrote mathtext keeps it. Inside a run, a space becomes ``\\ `` (mathtext drops
bare spaces) and the run's text keeps its upright/bold/italic style. A run
whose text uses a character the mathtext subset cannot carry (``$ % # & ~
^ _ { } \\``), an unterminated run, or an unknown control is left exactly as
typed -- it renders literally, never as something the author did not write.

The frontend mirrors this byte for byte (``frontend/src/lib/originEscapes.ts``)
so the canvas and the export parse the SAME resulting string; the shared
wire fixture ``tests/fixtures/wire/origin_escapes.json`` pins both halves.

Pure layer: str in -> str out. Distinct from ``io.origin_project.
origin_richtext``, which flattens a DECODED Origin project's labels to plain
Unicode for import; this module keeps the formatting for rendering.
"""

from __future__ import annotations

import re

__all__ = ["GREEK", "has_origin_escape", "origin_escapes_to_mathtext"]

# Origin's Symbol font: the Latin key -> the Greek glyph it displays (same
# table as io.origin_project.origin_richtext, the decode side).
GREEK: dict[str, str] = {
    "a": "α", "b": "β", "g": "γ", "d": "δ", "e": "ε", "z": "ζ", "h": "η",
    "q": "θ", "i": "ι", "k": "κ", "l": "λ", "m": "μ", "n": "ν", "x": "ξ",
    "o": "ο", "p": "π", "r": "ρ", "s": "σ", "t": "τ", "u": "υ", "f": "φ",
    "c": "χ", "y": "ψ", "w": "ω", "v": "ς", "j": "ϕ",
    "A": "Α", "B": "Β", "G": "Γ", "D": "Δ", "E": "Ε", "Z": "Ζ", "H": "Η",
    "Q": "Θ", "I": "Ι", "K": "Κ", "L": "Λ", "M": "Μ", "N": "Ν", "X": "Ξ",
    "O": "Ο", "P": "Π", "R": "Ρ", "S": "Σ", "T": "Τ", "U": "Υ", "F": "Φ",
    "C": "Χ", "Y": "Ψ", "W": "Ω",
}  # fmt: skip

_CONTROLS = "+-gbi"
_ESCAPE = re.compile(r"\\[+\-gbi]\(")
# Characters mathtext treats as syntax (or rejects): a run containing one
# stays literal rather than being half-converted.
_UNSAFE = set("$%#&~^_{}\\")
_UNESCAPED_DOLLAR = re.compile(r"(?<!\\)\$")


class _Literal(Exception):
    """This run cannot be converted; keep the source text."""


def has_origin_escape(label: str) -> bool:
    """Does ``label`` contain an Origin run escape (``\\+( \\-( \\g( \\b( \\i(``)?"""
    return _ESCAPE.search(label) is not None


def _close(s: str, open_at: int) -> int:
    """Index of the ``)`` matching the ``(`` at ``open_at`` (balanced)."""
    depth = 0
    for j in range(open_at, len(s)):
        if s[j] == "(":
            depth += 1
        elif s[j] == ")":
            depth -= 1
            if depth == 0:
                return j
    raise _Literal


def _math_text(text: str, style: str) -> str:
    """Plain run text as mathtext content in ``style`` (rm/bf/it)."""
    if any(c in _UNSAFE for c in text):
        raise _Literal
    body = text.replace(" ", r"\ ")
    return f"\\mathrm{{{body}}}" if style == "rm" else body


def _math(s: str, style: str) -> str:
    """The mathtext content for run body ``s`` (escapes nested) in ``style``."""
    out: list[str] = []
    plain: list[str] = []
    i = 0
    while i < len(s):
        if s[i] == "\\" and i + 2 < len(s) and s[i + 1] in _CONTROLS and s[i + 2] == "(":
            if plain:
                out.append(_math_text("".join(plain), style))
                plain = []
            end = _close(s, i + 2)
            out.append(_run(s[i + 1], s[i + 3 : end], style))
            i = end + 1
            continue
        plain.append(s[i])
        i += 1
    if plain:
        out.append(_math_text("".join(plain), style))
    return "".join(out)


def _run(control: str, body: str, style: str) -> str:
    if control == "g":
        return _math_text("".join(GREEK.get(c, c) for c in body), style)
    if control == "b":
        return f"\\mathbf{{{_math(body, 'bf')}}}"
    if control == "i":
        return f"\\mathit{{{_math(body, 'it')}}}"
    script = "^" if control == "+" else "_"
    return f"{script}{{{_math(body, style)}}}"


def _convert_plain(s: str) -> str:
    """Convert every run in a math-free segment; a run that cannot convert
    stays as typed."""
    out: list[str] = []
    i = 0
    while i < len(s):
        m = _ESCAPE.search(s, i)
        if m is None:
            out.append(s[i:])
            break
        out.append(s[i : m.start()])
        control = s[m.start() + 1]
        try:
            end = _close(s, m.end() - 1)
            body = s[m.end() : end]
            if control == "g":
                if any(c in _UNSAFE for c in body):
                    raise _Literal
                out.append("".join(GREEK.get(c, c) for c in body))
            else:
                out.append(f"${_run(control, body, 'rm')}$")
            i = end + 1
        except _Literal:
            out.append(s[m.start() : m.end()])
            i = m.end()
    return "".join(out)


def origin_escapes_to_mathtext(label: str) -> str:
    """``label`` with its Origin escapes rewritten in the mathtext subset
    (see the module doc); unchanged when it has none."""
    if not label or not has_origin_escape(label):
        return label
    parts = _UNESCAPED_DOLLAR.split(label)
    if len(parts) % 2 == 0:  # odd $ count: matplotlib renders it all literal
        return label
    return "$".join(p if k % 2 else _convert_plain(p) for k, p in enumerate(parts))
