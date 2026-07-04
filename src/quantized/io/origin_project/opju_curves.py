"""Per-curve dataset/column binding for ``.opju`` (CPYUA) graph figures (item 35).

Every curve (``DataPlot``) object carries its own copy of the generic CPYUA
"graph object" header (the same ``58 80 09 98 03 40 B3 <u32 bodyLen>`` shape
axis/legend/config objects also use — this header is NOT curve-exclusive, so
it cannot be located by the magic bytes alone). Immediately inside a curve's
own body, at a position anchored right after the object's name token
(auto-named ``_NNN``, mirroring ``.opj``'s convention — see ``figures.py``),
sits a small fixed-shape token that was diffed out of a purpose-built
oracle, ``fig_pairs.opju`` (one project, 4 graphs: A-B scatter, A-B scatter
log-Y, **A-C scatter** — the deliberate diff — and A-B line; see
``tools/origin_trial/generate_specimens.py``'s ``fig_pairs`` section, whose
LabTalk ``plotxy iy:=`` calls are the ground truth since Origin's own GT
exporter did not capture this — see "Missing oracle" below):

```
<flag:1> 01 <konst:1> 01 80 03 <y_ord:1> 00
```

Byte-for-byte diffing all 4 fig_pairs curves against each other (2 pairs
share columns A,B; one pair differs only in log-Y; one differs only in plot
type line-vs-scatter; one — the deliberate diff — plots A,C instead of A,B)
isolated exactly 2 differing bytes total: ``flag`` (a per-curve
creation-order/style counter — increments monotonically across curves
regardless of column choice, confirmed unrelated) and ``y_ord`` (changes
from ``0x02`` to ``0x03`` in lockstep with the B->C column swap, and only
then). ``y_ord`` is a **1-based ordinal counted cumulatively across every
column of every workbook the project's FPC codec (``opju_codec.scan_columns``)
actually decoded, in book-appearance order** (a book with zero decodable
columns — e.g. an unused default "Book1" — does not participate in the
count; confirmed by reproducing the corpus's own book/column layout and
finding the decoded ordinal always lands exactly on the expected column).

**Validation.**

* ``fig_pairs`` (self-authored, by-construction ground truth — Origin's own
  exporter has no oracle for this, see below): the byte pattern's regex
  ``.\\x01.\\x01\\x80\\x03.\\x00`` finds *exactly* the 4 expected curve
  tokens in the whole file (no false positives), and every ``y_ord`` decodes
  to the exact column the generation script plotted (A,B / A,B / **A,C** /
  A,B) — all 4 survive the designation gate below unchanged.
  ``test_realdata_fig_pairs_curve_bindings`` asserts this exactly.
* Real corpus (RockingCurve, XAS, UnpolPlots, "Fixed Lambdas SI" — no GT
  oracle available either, see below): a whole-file scan finds ~40 curve
  tokens; scoped per decoded figure's window and passed through the
  designation gate, 2-4 survive per file (12 total across the 4 files) —
  every single one lands on a column ``windows_opju.py`` independently
  designates ``"Y"`` (never ``"X"``/``"Y-error"``) with a physically-sensible
  dependent-variable long-name (``Intensity``, ``Absorption``, ``R``,
  "Theory SA"), never an independent-variable one (``Theta``, ``Energy``,
  ``Q``, ``Z``). RockingCurve's ``NbAuRocking`` figure's surviving curve
  count also matches the independent legend-derived ``n_curves`` signal
  exactly (2 == 2). ``test_realdata_real_corpus_curves_are_plausible``
  asserts the designation/long-name check for all four files.

**Missing oracle.** ``tools/origin_trial/export_ground_truth.py`` was meant
to dump Origin's own per-plot dataset references (``layer.nplots`` +
``range __rp = {pi}; ... __rp.name$``) into each ``index.json``'s
``graphs[].layers[].plots`` list. In every project exported in this corpus
that list comes back **empty** (a LabTalk/COM issue in that trial-window
script — the ``range __rp = {pi}`` assignment does not behave as
documented — not something fixable here: this module is pure byte-level RE,
no Origin). So no direct "Origin says the answer is X" string match was
possible for curve bindings, for either the specimens or the real corpus;
validation instead rests on the by-construction specimen (still a real
ground truth — the script wrote the ``iy:=`` argument, we did not invent
it) plus the designation gate and independent-signal cross-checks above.

**Known gap — per-figure attribution (significant recall loss).** Deciding
*which* of a graph's curve tokens belongs to *which* decoded axis-anchor
window is a best-effort byte-range heuristic: a curve counts toward a figure
only when its token falls inside ``[anchor, next_anchor)`` AND survives the
designation gate. This drops the *majority* of curve tokens for composite/
derived real-corpus graphs — confirmed: "Fixed Lambdas SI"'s ten cleanest
tokens (each landing exactly on a different PNR book's reflectivity column,
one per book) sit entirely *outside* all four of that file's decoded
figures' windows, so none of them ship; what each figure gets instead is
whatever handful of tokens happen to sit inside its own narrow window (often
just 1, and not necessarily the "main" curve a user would expect). XAS's
``Co`` self-curve and two of UnpolPlots's curves are similarly never
attributed to any figure. This is an honest, *significant* recall gap, not a
soundness one: every curve that IS reported is independently confirmed
(designation + long-name), never fabricated or mis-typed. Closing it needs
either a real oracle (the missing ``plots`` export) or a further RE pass to
locate the object boundary that actually scopes a curve to its owning
layer (not yet found).

**Multi-curve-per-layer and multi-book layout — confirmed against two new
controlled specimens (item 35 recall push, 2026-07-04).** ``curves_multi.opju``
(one graph, one layer, three curves — MBook B/C/D vs A) and
``curves_2books.opju`` (one graph, curves from two different books —
``BookOne!B`` and ``BookTwo!C``) were purpose-built to answer two open
questions: how do *multiple* curve tokens sit in one layer, and does the
cumulative-ordinal base really carry over correctly across a book boundary?
Both answers turn out to be exactly what this module already implements,
with **zero code change required** — these specimens are validating
regression tests, not bug reports:

* *Multi-curve layout*: each curve is a fully self-contained, back-to-back
  copy of the same ~750-900-byte "graph object" (the generic
  ``58 80 09 98 03 40 B3`` header + its own style/pen sub-records + its own
  copy of the 8-byte token). ``curves_multi``'s three curves' tokens sit at
  offsets 789 bytes apart, each with a strictly increasing ``y_ord``
  (``0x02``, ``0x03``, ``0x04`` — MBook's B, C, D) and no shared/wrapper
  record binding them together. There is no "run" or "count" prefix to
  decode; the whole-file regex scan already finds all three independently,
  and every one survives the designation gate and resolves correctly.
* *Cross-book base*: ``curves_2books`` plots ``BookOne!B`` (``y_ord=2``,
  since BookOne contributes columns 1-2) and ``BookTwo!C`` (``y_ord=5``,
  since BookOne's 2 columns are counted before BookTwo's 3 start at ordinal
  3) — exactly what ``_global_column_map``'s cumulative, book-appearance-order
  counting already produces. No change needed.

Both specimens decode with 100% precision *and* 100% recall via the
existing pipeline (regex → designation gate → BCO gate), confirmed by
``test_realdata_curves_multi_bindings`` and
``test_realdata_curves_2books_bindings``. This raises the aggregate
oracle-covered recall from 6/31 (19.4%) to 11/36 (30.6%) — see
``docs/origin_project_format.md`` §6.2.1 for the updated per-stem table.

**A second near-miss shape, found and confirmed excluded — the per-book
"column candidate list."** Investigating why real-corpus recall stays far
below what these clean specimens suggest turned up a second decoy shape,
structurally distinct from ``__BCO`` but with the same danger profile: a
run of 7-byte records, one per column of a referenced book, in column
order —

```
<flag:1> 01 <marker:1> 80 03 <ord:1> 00
```

— found near *every* book reference in *every* file checked, both new
specimens included (e.g. ``curves_multi`` shows MBook's A/B/C/D enumerated
this way *in addition to* the three real per-curve tokens). It is one byte
*shorter* than the real curve token — a single ``0x01`` (position 1) then
straight to ``0x80 0x03``, never the real token's ``01 .. 01 80 03`` double
``0x01`` — so it can **never** satisfy ``_CURVE_RE`` (which requires two
literal ``0x01`` bytes at positions 1 and 3); confirmed by direct
byte-window inspection, not just by construction. Whether this list's
entries carry *any* independently-decodable "this one is selected" marker
was checked directly (tail bytes compared item-by-item across several
real-corpus runs, e.g. "Fixed Lambdas SI"'s ``PNRNbAu100nm`` A-K run) — they
do not; the items are byte-identical in shape apart from the running
ordinal. In every run checked, the columns that happen to be *actually*
plotted are the run's *last* one to three entries, but that is a corpus
*convention* (derived "SA"/"dSA"/"Theory SA" analysis columns are
habitually appended last), not a decodable structural signal — using
"trust the tail of the list" would be exactly the kind of guess this
module's design forbids, and was rejected.
``test_synthetic_column_enum_list_not_mistaken_for_curve_token`` is a
regression guard: a future regex relaxation must not start accepting this
shape.

**Remaining gap, sharpened by the above.** RockingCurve's ``Graph1``
(``Nb!B``) and ``Graph2`` (``NbAl!B``), and essentially all of XAS's and
UnpolPlots's oracle-required curves, have **neither** a real 8-byte token
**nor** a column-candidate-list tail match anywhere in the file — an
exhaustive whole-file regex scan (both shapes) confirms zero candidates
exist for these pairs at all. These are ordinary, single-curve, default-
dialog graphs (unlike ``NbAuRocking``'s custom-styled multi-curve layer,
or "Fixed Lambdas SI"'s "Theory SA" reference-overlay curves, both of which
DO carry the real token) — Origin evidently encodes their column choice a
third way, not yet located. This — not the multi-curve/multi-book layout,
which is solved — is why real-corpus recall stays low; closing it needs a
further RE pass specifically on simple/default single-curve graphs.

**X is not decoded.** ``konst`` (the position a naive by-symmetry read would
expect an X-column ordinal to occupy) was observed as exactly ``0x01`` in
*every one* of ~44 samples across the specimen and the full real corpus —
zero variation, including cases whose Y column belongs to a *different*
workbook than the layer's other curves. That is equally consistent with
"X is always column A" and with "this byte is an unrelated constant,
unconfirmed to be a column selector at all" — no specimen ever varied X, so
neither reading can be confirmed and it is not reported as a decoded value.
Instead, ``"x"`` in this module's output is a **structural inference**: the
Y column's own workbook's first column — Origin's near-universal per-sheet
X designation, independently confirmed via ``windows_opju.py``'s validated
designation markers for every corpus book checked here. This may be wrong
for a workbook whose designated X column is not the first one; no such case
was observed in this corpus.

**Designation gate (precision over recall).** The whole-file regex scan is
not curve-exclusive enough on its own: one real-corpus file ("Fixed Lambdas
SI") produced a ``y_ord`` landing on a ``Y-error`` column (``dQ``, a PNR
uncertainty column) inside a decoded figure's window — clearly not a real
plotted curve. Rather than report it, every resolved ``y`` column is
cross-checked against ``windows_opju.opju_window_metadata``'s independently
validated per-column designation and **dropped unless it is exactly
``"Y"``** (never ``"X"``, ``"Y-error"``, or unresolved). This trades recall
for precision, matching the "never guess" rule: some real curves are lost
when a book's window-section metadata doesn't resolve (windows_opju.py's own
documented limitation), but nothing reported here is a mis-typed column.

**False positive found and fixed — the ``__BCO`` boilerplate (item 35
rework, 2026-07-04).** Once a real per-plot oracle existed (``plots.json``,
via ``tools/origin_trial/export_plot_refs.py``'s ``range -w`` LabTalk recipe
— the earlier ``layer.nplots``/``range __rp`` approach used by
``export_ground_truth.py`` never worked, see below), it exposed 2 false
positives: ``UnpolPlots`` decoded ``(PrNiO3STOprof, C)`` and
``(PrNiO3STOrefl, C)``, but the oracle plots neither book's column C at all
(the real bindings are ``B`` and ``G``/``H``/``I`` respectively). Root
cause: the whole-file regex also matches the *tail* of a completely
unrelated, fixed ~365-byte-long per-book boilerplate record that begins at a
length-prefixed ``__BCO2`` (occasionally ``__BCO3`` etc.) string — one per
book, byte-for-byte identical across every book in every file checked
(``XAS``, ``UnpolPlots``, ``"Fixed Lambdas SI"``) aside from a handful of
small varying counter/row-count fields. This record's last 8 bytes always
happen to fit the curve-token shape and always resolve to **local column 3
(index 2, i.e. always "C")** of its own book — not because it references
any column at all, but because that offset in the fixed template always
holds the literal value 3. It is *not* curve-exclusive: it exists whether or
not that book is plotted anywhere, and for a 3-column book whose real Y
column *happens* to be column C (every XAS book: ``Co``/``bl11YIGPy032``/
``bl11YIGPy033``, all plotting ``Intensity`` at C) the artifact is
coincidentally "correct" — which is how it went undetected before the
plots.json oracle existed. ``UnpolPlots``' books use column C for a
*different* quantity than what's plotted (``Absorption``/``R``, not the
real ``Nuclear``/``R-Rsub`` curves), exposing the coincidence as a false
positive.

Fix: :func:`_is_bco_boilerplate` requires **both** confirmed structural
signals before excluding a match — (1) the match sits 340-380 bytes past a
preceding ``__BCO`` marker (the exact span measured across every confirmed
instance: 357-360 bytes) **and** (2) the resolved column is local index 2.
Neither signal alone is safe to use: distance alone is untested against
unseen templates; "local column 3" alone would wrongly exclude a real curve
that legitimately plots that position (``fig_pairs``' A-C diff curve also
resolves to local column 3, but at a completely different, ~1288-byte
distance from any ``__BCO`` marker, and is correctly kept). Applying this
filter removes exactly the ``UnpolPlots`` false positives and, incidentally,
the previously "correct-by-coincidence" ``XAS`` pair (``Co``/
``bl11YIGPy032``/``bl11YIGPy033``, all local-column-3) — these were never
soundly decoded, only luckily right, and reporting them would contradict the
"replicate the method, not just the answer" porting principle. See
``tests/test_io_origin_figures_opju.py``'s realdata precision/recall suite
and ``docs/origin_project_format.md`` §6.2.1 for the corrected validation
counts.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence

from quantized.io.origin_project.opj import _group
from quantized.io.origin_project.opju_codec import scan_columns
from quantized.io.origin_project.windows import BookMeta
from quantized.io.origin_project.windows_opju import opju_window_metadata

__all__ = ["book_columns_from_bytes", "book_metadata_from_bytes", "extract_curves"]

# <flag:1> 01 <konst:1> 01 80 03 <y_ord:1> 00 -- see module docstring.
_CURVE_RE = re.compile(rb".\x01.\x01\x80\x03.\x00")

# The "__BCO" boilerplate false positive -- see the module docstring's
# "False positive found and fixed" section. The span from the marker to the
# start of the coincidentally-matching tail token measures 357-360 bytes
# across every confirmed instance; the range below gives margin either side.
_BCO_MARKER = b"__BCO"
_BCO_ARTIFACT_LO = 340
_BCO_ARTIFACT_HI = 380


def _is_bco_boilerplate(b: bytes, match_start: int, local_index: int) -> bool:
    """True when a curve-token match is the tail of the fixed per-book
    ``__BCO<n>`` worksheet-window record, not a real curve/DataPlot object.

    Requires both confirmed signals at once (see module docstring): the
    resolved column is local index 2 (always "C" in the boilerplate) AND a
    ``__BCO`` marker sits 340-380 bytes before the match. Neither condition
    alone is used -- a real curve can legitimately plot local column 3
    (``fig_pairs``' A-C diff), and an unrelated ``__BCO`` marker could in
    principle precede a real token at some other distance.
    """
    if local_index != 2:
        return False
    lo = max(0, match_start - _BCO_ARTIFACT_HI)
    hi = max(0, match_start - _BCO_ARTIFACT_LO)
    return b.find(_BCO_MARKER, lo, hi) >= 0


def book_columns_from_bytes(b: bytes) -> dict[str, list[str]]:
    """``{book: [column letter, ...]}`` in book-appearance / sheet-column order,
    restricted to columns the FPC codec (``opju_codec.scan_columns``) actually
    decoded — the same universe ``y_ord`` below counts over."""
    columns = scan_columns(b)
    books = _group(columns)
    return {book: [c for c, _ in cols] for book, cols in books.items()}


def book_metadata_from_bytes(
    b: bytes, book_columns: Mapping[str, Sequence[str]]
) -> dict[str, BookMeta]:
    """Per-book column designation/label metadata (see the "Designation gate"
    section of the module docstring) — a thin wrapper so ``figures_opju.py``
    computes it once and threads it through, rather than every call re-scanning."""
    return opju_window_metadata(b, book_columns)


def _global_column_map(
    book_columns: Mapping[str, Sequence[str]],
) -> dict[int, tuple[str, str]]:
    """1-based cumulative ordinal -> ``(book, column letter)``, book-appearance order."""
    out: dict[int, tuple[str, str]] = {}
    cum = 0
    for book, cols in book_columns.items():
        for col in cols:
            cum += 1
            out[cum] = (book, col)
    return out


def extract_curves(
    b: bytes,
    start: int,
    end: int,
    book_columns: Mapping[str, Sequence[str]],
    books_meta: Mapping[str, BookMeta],
) -> list[dict[str, str]]:
    """Every curve's ``{book, x, y}`` column binding found in ``b[start:end)``.

    ``y`` is decoded from the curve token (see module docstring) and gated on
    the "Designation gate" (must independently confirm as ``"Y"``); ``x`` is
    inferred as ``y``'s own book's first column (not decoded from the byte
    record — see the module docstring's "X is not decoded"). A token whose
    ``y_ord`` doesn't resolve to a known, ``Y``-designated column is silently
    dropped — never guessed.
    """
    gmap = _global_column_map(book_columns)
    out: list[dict[str, str]] = []
    for m in _CURVE_RE.finditer(b, start, end):
        y_ord = m.group()[6]
        info = gmap.get(y_ord)
        if info is None:
            continue
        book, y_col = info
        cols = book_columns.get(book)
        if not cols:
            continue
        if _is_bco_boilerplate(b, m.start(), cols.index(y_col)):
            continue  # the __BCO boilerplate, not a real curve -- see module docstring
        bm = books_meta.get(book)
        if bm is None:
            continue  # can't independently confirm the column type: drop, never guess
        cm = bm.columns.get(y_col)
        if cm is None or cm.designation != "Y":
            continue
        out.append({"book": book, "x": cols[0], "y": y_col})
    return out
