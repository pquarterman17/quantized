"""Origin-safe names shared by the ``.opj`` writer, the LabTalk ``.ogs``
export and the export routes' download names.

Origin short (window) names are ASCII letters and digits only, starting with
a letter -- no spaces, underscores or punctuation -- and are compared ignoring
case. Accented letters fold to their ASCII base first (``Ångström`` ->
``Angstrom``), so a name keeps its readable stem instead of losing letters.

Pure ``io`` layer: no fastapi/pydantic imports.
"""

from __future__ import annotations

import re
import unicodedata

__all__ = ["SHORT_MAX", "ascii_fold", "origin_short_name"]

#: Cap so the ``<book>_<column>`` dataset name fits the .opj column header's
#: 23-byte field even for a 3-letter column (AAA): 16 + 1 + 3 + NUL < 23.
SHORT_MAX = 16
_NOT_ALNUM = re.compile(r"[^A-Za-z0-9]")


def ascii_fold(text: str) -> str:
    """Each character as its ASCII base when it has one (``Å`` -> ``A``,
    ``é`` -> ``e``); a character with no ASCII decomposition is kept as is,
    for the caller's own replacement rule to deal with."""
    return "".join(
        unicodedata.normalize("NFKD", c).encode("ascii", "ignore").decode("ascii") or c
        for c in text
    )


def origin_short_name(raw: str, fallback: str, used: set[str] | None = None) -> str:
    """``raw`` as a valid Origin short name: folded to ASCII, letters and
    digits only, a leading letter (``B`` prefixed to a leading digit),
    capped at `SHORT_MAX`, ``fallback`` when nothing is left, and -- with
    ``used`` (lower-cased names already taken, updated in place) -- made
    unique ignoring case by a numeric suffix."""
    short = _NOT_ALNUM.sub("", ascii_fold(raw))
    if short and not short[0].isalpha():
        short = "B" + short
    short = (short or fallback)[:SHORT_MAX]
    if used is None:
        return short
    base, n = short, 1
    while short.lower() in used:
        n += 1
        short = f"{base[: SHORT_MAX - len(str(n))]}{n}"
    used.add(short.lower())
    return short
