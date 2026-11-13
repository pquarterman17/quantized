"""The per-walk decoded-cell budget of the ``.opju`` readers (re-exported by
``opju_codec``; its own module so the codec stays under the line ceiling)."""

from __future__ import annotations

__all__ = ["DECODE_BUDGET_CELLS", "DecodeBudget"]

# Cells one walk over a file may materialize. A record header declares its row
# count, and a repeat run stores "k copies" in a few bytes, so a few hundred
# bytes can otherwise demand gigabytes. The largest project in the 274-file
# public corpus declares 2.6 M cells in total, so legitimate files sit far
# below this; a record that would cross it is refused (and reported by the
# caller), never truncated. Each walk (structural records, marker scan, tail
# walk) has its own budget.
DECODE_BUDGET_CELLS = 1 << 24


class DecodeBudget:
    """A per-walk allowance of decoded cells (see ``DECODE_BUDGET_CELLS``)."""

    def __init__(self, cells: int | None = None) -> None:
        self.left = DECODE_BUDGET_CELLS if cells is None else cells
        self.refused = 0  # records refused for want of budget

    def charge(self, cells: int) -> bool:
        """Spend ``cells``; False (nothing spent) when they do not fit."""
        if cells > self.left:
            self.refused += 1
            return False
        self.left -= cells
        return True

    def refund(self, cells: int) -> None:
        """Return ``cells`` charged for a record that was then rejected."""
        self.left += cells
