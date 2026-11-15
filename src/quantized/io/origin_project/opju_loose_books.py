"""Loose datasets: ``.opju`` column datasets that no worksheet window owns.

A worksheet column's dataset is named ``<Book>_<Col>[@<sheet id>]`` after the
workbook window it lives in, and the reader groups datasets into books by
that prefix (``opj_books._group_named``). Origin also keeps datasets that
belong to NO window -- "loose" datasets. Its own book list (COM
``WorksheetPages`` / ``doc -e W``) does not hold them, so importing them as
Library books invents workbooks the user never had. Two sources were seen:

* **Stacked plots' helper.** A stacked area / column / bar plot writes the
  cumulative sums it draws into ``CS_1`` .. ``CS_n``; the graph itself plots
  the user's own columns (``%Z`` / ``layer.plotN`` refs name the source
  sheet, never ``CS``).
* **Deleted sheets.** A sheet deleted from a book leaves its datasets behind
  renamed into a new, windowless book name: sheet ``Gone`` (id 2) of ``Del``
  survives as ``DelA_A@2`` / ``DelA_B@2``; the live sheets keep
  ``Del_A`` / ``Del_A@3``.

The test is structural: a book whose name is not the name of any window
header in the file (``tree_opju.iter_opju_windows``, the enumeration
validated byte-exact against COM window names) is loose. Names compare
case-insensitively, as Origin's do: a book renamed only in case keeps its
datasets' old spelling (window ``CuSCH3vac`` owns ``Cusch3vac_B@2``, and
its graphs plot them). Fail closed --
nothing is dropped when:

* the file has no window headers at all (nothing to test against), or
* every decoded book is loose (a graph-only project whose data are all loose
  datasets, e.g. graphs kept after their books were deleted: the loose data
  is everything there is to show).

Evidence (Origin 2026b Student COM, 2026-11-15; plan item 6 / item 5 of
``ORIGIN_PLOT_TYPE_PARITY_PLAN``): on the plot corpus every ``CS`` book (26
stacked specimens) and every ``DelA@2`` (5 ``deleted_sheet`` specimens) is a
dataset with no ``WorksheetPages`` entry; on the 359-file real corpus every
book this drops is absent from Origin's ``WorksheetPages`` and every
``WorksheetPages`` book that was imported before is still imported.
"""

from __future__ import annotations

from collections.abc import Iterable

from quantized.io.origin_project.tree_opju import iter_opju_windows

__all__ = ["loose_books"]


def loose_books(b: bytes, books: Iterable[str]) -> list[str]:
    """The decoded book keys (``Book`` / ``Book@N``) that no window owns, in
    the given order; ``[]`` when the test cannot be applied (module
    docstring)."""
    keys = list(books)
    windows = {name.casefold() for _, name in iter_opju_windows(b)}
    if not windows:
        return []
    loose = [k for k in keys if k.partition("@")[0].casefold() not in windows]
    return [] if len(loose) == len(keys) else loose
