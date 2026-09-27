"""Block-walking helpers shared by every report renderer (io.report_export,
io.report_office): number / ``value ± error`` formatting, params/table row
extraction, and raster-image decoding.

Split out of ``io.report_export`` (PRIMARY_SOFTWARE_AUDIT_PLAN P3.6) so the
Word/PowerPoint writers could move to their own module without an import
cycle; ``format_value_error`` is still re-exported from ``io.report_export``.
Pure ``io`` layer -- no web-stack imports.
"""

from __future__ import annotations

import base64 as _base64
import binascii as _binascii
import math
from collections.abc import Mapping
from typing import Any

__all__ = [
    "EMBEDDABLE_IMAGE_MIMES",
    "decode_raster",
    "fmt_num",
    "format_value_error",
    "params_rows",
    "table_rows",
]

# Raster image MIME types Office can embed as-is. Anything else (an SVG) needs
# the block's figure spec re-rendered server-side -- see io.report_figures.
EMBEDDABLE_IMAGE_MIMES = ("image/png", "image/jpeg", "image/jpg", "image/gif", "image/bmp")


def decode_raster(image: Mapping[str, str] | None) -> bytes | None:
    """Return decoded image bytes iff it's an Office-embeddable raster type."""
    if not image or image.get("mime") not in EMBEDDABLE_IMAGE_MIMES:
        return None
    try:
        return _base64.b64decode(image["data"], validate=True)
    except (_binascii.Error, ValueError, KeyError):
        return None


# ── number formatting ─────────────────────────────────────────────────────
def fmt_num(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return ""
        return f"{value:.6g}"
    return str(value)


def format_value_error(value: Any, error: Any = None, *, sig: int = 2) -> str:
    """Format ``value ± error`` with the value rounded to the error's precision.

    With no (finite, non-zero) error, falls back to a plain 6-significant-figure
    number. ``sig`` is the number of significant figures kept on the error.
    """
    if value is None:
        return ""
    v = float(value)
    if error is None or not math.isfinite(float(error)) or float(error) == 0.0:
        return fmt_num(value)
    e = abs(float(error))  # uncertainty is magnitude-only, sign is meaningless
    exp = math.floor(math.log10(e))
    ndp = sig - 1 - exp  # decimal places (may be negative for large errors)
    v_r, e_r = round(v, ndp), round(e, ndp)
    dp = max(0, ndp)
    return f"{v_r:.{dp}f} ± {e_r:.{dp}f}"


# ── block-walking helpers (shared by every renderer) ──────────────────────
def params_rows(block: Mapping[str, Any]) -> tuple[list[str], list[list[str]]]:
    """(header, rows) for a params block, with value ± error merged."""
    has_unit = any(p.get("unit") for p in block["params"])
    header = ["Parameter", "Value", *(["Unit"] if has_unit else [])]
    rows = []
    for p in block["params"]:
        cells = [str(p["name"]), format_value_error(p.get("value"), p.get("error"))]
        if has_unit:
            cells.append(str(p.get("unit", "")))
        rows.append(cells)
    return header, rows


def table_rows(block: Mapping[str, Any]) -> tuple[list[str], list[list[str]]]:
    header = [str(c) for c in block["columns"]]
    rows = [[fmt_num(c) for c in row] for row in block["rows"]]
    return header, rows
