"""The 0x01-subtype ``.opju`` curve token — the second, all-columns curve
encoding for ordinary, single-curve *default-dialog* graphs (item 35, the
"third encoding" search — this closes it, 2026-07-04).

The shipped ``opju_curves.py`` decodes one curve-token family (subtype
``0x03``), reverse-engineered from custom-styled/multi-curve/Select-Data
graphs. A prior session searched specifically for how *ordinary* single-
curve default-dialog graphs (``RockingCurve`` ``Graph1``/``Graph2``, all of
``XAS``, all of ``UnpolPlots``, most of ``"Fixed Lambdas SI"``) encode their
Y column and came up empty — three hypotheses chased, none validated (see
``opju_curves.py``'s docstring, "The third encoding search — negative
result"). This module is the found fourth hypothesis, now validated end to
end against the real ``plots.json`` oracle on every one of those files.

**The token.** A whole-file scan for ``[[byte]] 01 01 01 80 01 [[byte]]``
(the discovery regex ``rb"[\\x00-\\xff]\\x01\\x01\\x01\\x80([\\x01\\x03])(.)"``
with the subtype fixed to ``0x01``) finds exactly the shape the earlier
session already isolated in ``RockingCurve``'s ``Graph1``/``Graph2`` objects
and confirmed *was* a real Origin field (the 4.3811 re-save of the same
project rewrites the identical slot into the canonical ``0x03`` shape while
preserving the same numeric value) — but could not decode, because it was
being read through the ``0x03`` family's ordinal map:

```
<flag:1> 01 01 01 80 01 <val:1>
```

Same family as the shipped token (``<flag> 01 01 01 80 03 <y_ord> 00``),
same fixed ``01 01`` "konst" pair, but subtype byte ``0x01`` instead of
``0x03``, and **no fixed ``0x00`` terminator** — confirmed by dumping every
hit's context across the full real corpus (below): the 7 bytes above are
followed by a short, subtype-specific tail (``83 01 <byte> 82 01 01 80 01``
for XAS; ``83 07 <2 bytes> 00 00 0b 00`` for RockingCurve; several other
shapes for UnpolPlots/"Fixed Lambdas SI") that never repeats the fixed
``0x00`` the ``0x03`` family always carries. No consistent terminator or
tail structure was found *across files* (each file's tail shape differs),
so none is folded into the matcher — the 7-byte prefix above is already
100% precise by itself (see "Validation" below), and adding an unproven
tail constraint would only risk *losing* matches, never gaining precision.
The ``<flag>`` byte was checked across every hit and, like the ``0x03``
family's own flag byte, shows no correlation with column choice — it
clusters loosely in ``0xae``-``0xc4`` (a per-curve creation-order/style
counter, consistent with the shipped family's documented flag semantics)
but is never used as a match constraint.

**The counting convention — the actual bug in every earlier refutation.**
`opju_curves.py`'s ``_global_column_map`` (the shipped ordinal map) counts
*only* columns ``opju_codec.scan_columns`` actually FPC-decoded, skipping
any book with zero decodable columns entirely (e.g. an unused default
"Book1"). Decoding the 0x01 token's ``<val>`` through that map is exactly
what the earlier session tried and rejected (``RockingCurve``'s ``Nb!B``
decoded to ``Nb!C`` — wrong). The real convention is different: ``<val>``
is a 1-based ordinal counted cumulatively across **every allocated column
of every workbook, including empty/undecoded books and empty/undecoded
columns**, in file book-appearance order. Re-decoding through this all-
columns map (below) resolves every hit exactly:

* ``XAS`` (``Book1``=2 cols, an EMPTY/undecoded default book, then ``Co``=3,
  ``bl11YIGPy032``=3, ``bl11YIGPy033``=3): ``<val>`` = 5, 8, 11 resolve to
  exactly ``Co!C``, ``bl11YIGPy032!C``, ``bl11YIGPy033!C`` — the file's
  full ``plots.json`` oracle, 3/3.
* ``RockingCurve`` (``NbAu``=7 cols incl. an undecoded ``G``, ``Nb``=5,
  ``NbAl``=3): ``<val>`` = 9, 14 (each found twice — the composite
  ``Graph3`` re-references) resolve to ``Nb!B``, ``NbAl!B`` — exactly the
  2 oracle pairs the shipped ``0x03`` path could not reach (it already
  recovers ``NbAu!D``/``NbAu!F`` from the multi-curve ``NbAuRocking``
  layer), bringing this file to 4/4.
* ``UnpolPlots`` (``Book1``=2, ``J315NdNiO3STO``=3, ``J315NdNiO3ST1``=9,
  ``PrNiO3STOprof``=3, ``PrNiO3STOrefl``=9): 16 hits collapse to the 8
  unique oracle pairs (each doubled by a composite-window re-reference),
  8/8.
* ``"Fixed Lambdas SI"`` (``Book1``=2, then 10 PNR books x 11 cols each):
  28 hits collapse to exactly the file's 14 unique oracle pairs (each
  doubled), 14/14.

No book in this corpus needed anything beyond the FPC-decoded-only map's
*complement* — the all-columns map — to resolve every hit; every value
that decodes lands on a real, contiguous, allocated column.

**Building the all-columns map without ground truth.** ``opju_codec._NAME``
(``rb"[A-Za-z][\\w ]{0,40}_[A-Za-z0-9]{1,4}(?:@\\d{1,2})?"``) matches a
length-prefixed dataset name for *every* allocated column — including
empty ones (``XAS``'s ``Book1_A``/``Book1_B``, never decoded by
``scan_columns`` because ``Book1`` carries no data) — but also binary
noise (arbitrary byte runs that happen to look like ``t_R``, ``G_L``,
``U_5``). :func:`_allocated_column_map` filters this down to a clean,
GT-matching book/column inventory with three checks, all confirmed
necessary and sufficient across the four real-corpus files (see
``test_realdata_allocated_column_map_matches_index`` for the exact
book/count comparison against each file's independently-exported
``index.json``):

1. Reuse ``scan_columns``'s own length-prefix anchor (``b[m.start()-1] ==
   len(match)``) — the same check that makes ``_NAME`` usable at all.
2. Keep only matches whose column suffix is **pure letters, 1-2 chars**
   (``[A-Z]{1,2}``) and drop any ``@N`` sheet-suffixed match entirely (this
   map does not track the extra-sheet pseudo-books the FPC-decoded map
   does — no multi-sheet book in this corpus needed one).
3. Group by book (everything before the last ``_``) and require the
   resulting column-letter *set* to be an exact contiguous run starting at
   ``A`` (``{A}``, ``{A,B}``, ``{A,B,C}``, …) — this is what rejects the
   noise matches, which never land on a clean contiguous run.

Book order is first-appearance order of a *surviving* book's name records
in the byte stream (matches every stem's ``index.json`` book order
exactly). Column letters use the standard spreadsheet base-26 scheme
(``A``=1..``Z``=26, ``AA``=27, … — length-then-lexicographic).

**No designation gate — a deliberate, checked difference from the ``0x03``
path.** The shipped path drops any resolved column unless
``windows_opju``'s independently-validated designation is exactly ``"Y"``
(never ``"X"``/``"Y-error"``), because that path's whole-file regex alone
is not curve-exclusive enough (the ``__BCO`` boilerplate false positive).
Applying the same gate here was checked against every one of the 27 unique
oracle-confirmed bindings this token resolves and would **wrongly reject
four of them**: ``UnpolPlots``' ``J315NdNiO3ST1!H``/``PrNiO3STOrefl!H``
("dR Fresnel") and ``"Fixed Lambdas SI"``'s ``PNRNbAl80nm!J``/
``PNRNbAu100nm!J`` ("dSA") are genuinely plotted curves per ``plots.json``
whose column is independently designated ``"Y-error"``, not ``"Y"`` — the
project plots an uncertainty column as its own curve, which is a legitimate
Origin usage the designation gate cannot distinguish from the ``__BCO``
artifact. Since this token's raw 7-byte match is *already* 100% precise
file-wide with zero designation cross-check (confirmed by scanning every
``.opju`` in the corpus, both real-corpus files and every specimen —
zero hits anywhere except the four files that need them, see
``tools/origin_trial/score_curve_bindings.py``), adding the ``0x03`` path's
designation gate here would only lose true positives for no precision
gain. The only safety check applied is structural: an ordinal that exceeds
the map's total column count for its file, or that the cumulative map
simply has no entry for, is dropped — never guessed.

**Attribution.** Reuses the same ``[anchor, next_anchor)`` per-figure
window scoping the ``0x03`` path uses (see ``figures_opju.py`` /
``opju_curves.extract_curves``). Every hit in this corpus falls inside
some figure's window (none needed to be dropped for falling outside every
window), though — like the shipped path's own documented attribution gap
— a composite/last window can absorb tokens that structurally belong to
an earlier, already-closed window (``"Fixed Lambdas SI"``'s last anchor's
span runs to EOF and physically contains all 28 hits for both of its
book families). This is a known, pre-existing class of imprecision
(*which* figure a curve is attributed to), not a soundness one (the
``(book, column)`` pair itself is never wrong) — see
``opju_curves.py``'s "Known gap — per-figure attribution".

**Validation.** ``tools/origin_trial/score_curve_bindings.py`` re-run
after wiring this module in: precision 100% (0 wrong) on every stem,
aggregate recall 36/36 (100%), up from 11/36 (30.6%) before this change —
see ``docs/origin_project_format.md`` §6.2.1 for the full updated table.
"""

from __future__ import annotations

import re
from collections import OrderedDict
from collections.abc import Mapping

from quantized.io.origin_project.opju_codec import _NAME, curve_plot_style

__all__ = ["extract_curves_allcols"]

# <flag:1> 01 01 01 80 01 <val:1> -- see module docstring. Unlike the shipped
# 0x03 family, no fixed terminator byte was found, so none is required here.
_CURVE_RE = re.compile(rb"[\x00-\xff]\x01\x01\x01\x80\x01(.)")

# A column suffix eligible for the all-columns map: pure letters, any width,
# no sheet suffix (that case is dropped by the caller before this check runs).
# No length cap: the old {1,2} silently discarded AAA+ columns of a >702-col
# book while the survivors still formed a contiguous A..ZZ run, shifting every
# later book's cumulative ordinal base (2026-07-06 genericity audit) —
# ``_letter_index`` already handles arbitrary-width bijective base-26.
_PURE_COLUMN = re.compile(r"[A-Z]+")


def _letter_index(letters: str) -> int:
    """Standard spreadsheet column lettering: A=1, .., Z=26, AA=27, .."""
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return idx


def _index_to_letters(n: int) -> str:
    """Inverse of :func:`_letter_index`."""
    out = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        out = chr(ord("A") + rem) + out
    return out


def _allocated_column_map(b: bytes) -> OrderedDict[str, int]:
    """``{book: total allocated column count}``, book-appearance order.

    Counts EVERY allocated column of every workbook (including empty/
    undecoded books and columns) -- the universe the 0x01 token's ``val``
    counts over, unlike ``opju_curves._global_column_map``'s FPC-decoded-
    only universe. See the module docstring's "Building the all-columns
    map" section for the filter rule and its validation.
    """
    names = [
        m.group(0).decode("latin1")
        for m in _NAME.finditer(b)
        if m.start() > 0 and b[m.start() - 1] == len(m.group(0))
    ]
    seen: OrderedDict[str, set[str]] = OrderedDict()
    for name in names:
        base, _, sheet = name.partition("@")
        if sheet:
            continue  # drop sheet-suffixed matches -- see module docstring
        book, _, col = base.rpartition("_")
        if not book or not _PURE_COLUMN.fullmatch(col):
            continue
        seen.setdefault(book, set()).add(col)
    out: OrderedDict[str, int] = OrderedDict()
    for book, cols in seen.items():
        n = len(cols)
        if cols == {_index_to_letters(i) for i in range(1, n + 1)}:
            out[book] = n
    return out


def _cumulative_ordinals(book_counts: Mapping[str, int]) -> dict[int, tuple[str, str]]:
    """1-based cumulative ordinal -> ``(book, column letter)`` over EVERY
    allocated column of EVERY book (contrast ``opju_curves._global_column_map``,
    which only counts FPC-decoded columns) -- see module docstring."""
    out: dict[int, tuple[str, str]] = {}
    cum = 0
    for book, n in book_counts.items():
        for i in range(1, n + 1):
            cum += 1
            out[cum] = (book, _index_to_letters(i))
    return out


def extract_curves_allcols(
    b: bytes, start: int, end: int, book_counts: Mapping[str, int]
) -> list[dict[str, str]]:
    """Every curve's ``{book, x, y}`` binding found via the 0x01-subtype
    token in ``b[start:end)``.

    No designation gate is applied (see module docstring — it would reject
    genuine Y-error-plotted-as-curve bindings this token legitimately
    finds); the only safety check is structural: a ``val`` with no entry in
    the cumulative map (out of range, or the book/column doesn't exist) is
    dropped, never guessed. ``x`` is the resolved book's first column
    ("A") -- always present by construction, since :func:`_allocated_column_map`
    only keeps books whose columns form a contiguous run starting at A.
    """
    ordmap = _cumulative_ordinals(book_counts)
    out: list[dict[str, str]] = []
    for m in _CURVE_RE.finditer(b, start, end):
        info = ordmap.get(m.group(1)[0])
        if info is None:
            continue
        book, y_col = info
        style = curve_plot_style(b, m.start())
        out.append({"book": book, "x": "A", "y": y_col, **({"style": style} if style else {})})
    return out
