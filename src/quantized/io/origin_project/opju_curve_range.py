"""The row range an ``.opju`` curve plots, from its own curve record.

A plot in Origin can draw a sub-range of its column ("Plot Details > data
range"; LabTalk ``set <ds> -b/-e`` on the plot). The 519-byte curve-anchor
record a curve token reconstructs (``curve_style_color.opju_style_record``)
stores it: offsets 7-10 the first plotted row (u32, 0-based) and 11-14 the
row the range ends at (u32, exclusive). It is also why the token's id chunk
is sometimes longer than 3 bytes (``opju_curve_token``): a non-zero first
row is a literal byte right after the id and flag.

Origin 2026b COM evidence (2026-11-15, per-plot ``sum()`` / paired-row
counts with the graph layer active): ``Figure_20.opju`` Graph3 records
``(15, 901)`` and Origin plots 886 of the 901 rows (from row 16);
``SOP_meas.opju`` ``old`` layers 3-4 record ``(0, 2154)`` for
``estimationVal_D@2`` / ``_C`` and Origin plots 2154 of 13143 / 14403 rows,
while the sibling ``_B`` plots record ``(0, 14403)`` = the full column.

quantized's curve binding has no row range, so drawing such a curve would
draw rows Origin does not plot. It is omitted (``plot_row_range``) instead.
Only a range that leaves out a row holding a value omits the curve (a
range ending at the last filled row draws the same points). A record that
does not reconstruct, or a column with no header, keeps the binding shipped
before (nothing to compare against). ``Analiza-Spektroskopowa`` Graph6
records ``(10, 6)`` for ``Book1_D@42`` -- an empty range -- and Origin plots
no point of it (main drew 6).
"""

from __future__ import annotations

import numpy as np

from quantized.io.origin_project.opju_blocks import DatasetHeader, find_headers
from quantized.io.origin_project.opju_records import decode_record

__all__ = ["plot_row_range", "range_reason"]

_FIRST, _END = 7, 11
_CACHE: dict[int, tuple[bytes, dict[str, DatasetHeader]]] = {}


def plot_row_range(record: bytes | None) -> tuple[int, int] | None:
    """``(first row, end row)`` the curve record stores, or None."""
    if record is None or len(record) < _END + 4:
        return None
    first = int.from_bytes(record[_FIRST : _FIRST + 4], "little")
    end = int.from_bytes(record[_END : _END + 4], "little")
    return first, end


def _headers(b: bytes) -> dict[str, DatasetHeader]:
    """Dataset name -> its header; one header scan per byte stream."""
    hit = _CACHE.get(id(b))
    if hit is not None and hit[0] is b:
        return hit[1]
    rows = {h.name: h for h in find_headers(b)}
    _CACHE.clear()  # one project at a time; holding b keeps id(b) unique
    _CACHE[id(b)] = (b, rows)
    return rows


def range_reason(b: bytes, record: bytes | None, sheet: str, y_col: str) -> str:
    """``"plot_row_range"`` when the curve on ``sheet`` (``Book`` or
    ``Book@N``) plotting ``y_col`` draws only part of its column, else ``""``."""
    rng = plot_row_range(record)
    if rng is None:
        return ""
    base, _, n = sheet.partition("@")
    h = _headers(b).get(f"{base}_{y_col}" + (f"@{n}" if n else ""))
    if h is None:
        return ""
    first, end = rng
    if first == 0 and end >= h.used_rows:
        return ""
    values = decode_record(b, h).values
    if values is None:
        return "plot_row_range"  # cannot show the range drops nothing
    outside = np.isfinite(values)
    outside[first : max(first, end)] = False
    return "plot_row_range" if outside.any() else ""
