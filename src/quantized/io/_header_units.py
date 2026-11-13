"""Column-header unit parsing: ``'Temp (C)'`` -> ``('C', 'Temp')``.

Moved out of :mod:`quantized.io.delimited` unchanged (that module was at the
500-line ceiling). Used by it and by :mod:`excel`, :mod:`xrd_export_read` and
:mod:`import_parse`.
"""

from __future__ import annotations

__all__ = ["_extract_units"]


def _split_trailing_bracket(header: str, opener: str, closer: str) -> tuple[str, str] | None:
    """``('Temp (C)', '(', ')')`` -> ``('C', 'Temp')``; ``None`` if no match.

    A hand-rolled scan, not a regex. The regexes this replaces --
    ``(.+?)\\s*\\(([^)]+)\\)\\s*$`` and its ``[...]`` twin -- were quadratic
    (CodeQL ``py/polynomial-redos``): ``.`` also matches a space, so ``.+?``
    and ``\\s*`` can split the same run of blanks in as many ways as it is
    long, and every one of them is retried before a header with no bracket is
    rejected. Column headers come straight out of an untrusted instrument file,
    so a row of long blank-padded headers was enough to stall a parse. This
    scan is linear and allocation-free apart from the two returned slices.

    Behaviour is preserved exactly, including the awkward corners:

    * the closer must be the LAST character (bar trailing whitespace), and the
      unit may not itself contain one -- so ``'a (b) c (d)'`` yields ``'d'``;
    * the unit must be non-empty and something must precede the opener, so
      ``'Temp ()'`` and ``'(C)'`` both fail and leave the header alone;
    * the opener is the FIRST one that can still satisfy the above, which is
      why ``'a ((b)'`` yields the unit ``'(b'`` rather than ``'b'``;
    * ``.`` never matched a newline, so a label spanning lines still fails.
    """
    body = header.rstrip()
    if not body.endswith(closer):
        return None
    before_closer = body[:-1]
    newline = body.find("\n")
    # The unit may not contain a closer, so the opener must sit after the last
    # one; and something must precede it, so index 0 is never a candidate.
    start = max(1, before_closer.rfind(closer) + 1)
    limit = len(before_closer) - 1  # the opener must leave a non-empty unit
    while start < limit:
        start = before_closer.find(opener, start)
        if start < 0 or start >= limit:
            return None
        if newline < 0 or newline >= _label_length(body, start):
            return before_closer[start + 1 :].strip(), body[:start].strip()
        # A newline inside the label itself is fatal (``.`` never matched one),
        # but one in the run of blanks before the opener is not -- so keep
        # looking rather than giving up on the header.
        start += 1
    return None


def _label_length(body: str, start: int) -> int:
    """Length of the shortest ``(.+?)`` that can precede the opener at ``start``.

    ``.+?`` is non-greedy and ``\\s*`` mops up the rest, so the label proper
    ends at the last non-blank before the opener -- but it must be at least one
    character even when everything before the opener is blank.
    """
    end = start
    while end > 1 and body[end - 1].isspace():
        end -= 1
    return end


def _extract_units(header: str) -> tuple[str, str]:
    """``'Temp (C)'`` -> ``('C', 'Temp')`` (also ``[...]``). Returns (unit, label)."""
    for opener, closer in (("(", ")"), ("[", "]")):
        found = _split_trailing_bracket(header, opener, closer)
        if found is not None:
            return found
    return "", header
