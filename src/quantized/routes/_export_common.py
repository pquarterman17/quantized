"""Shared export helpers (MIME types, filename sanitization, attachment headers)."""

from __future__ import annotations

import re

_FIGURE_MIME = {
    "pdf": "application/pdf",
    "svg": "image/svg+xml",
    "png": "image/png",
    "tiff": "image/tiff",
}
_DPI_MIN, _DPI_MAX = 50, 1200  # clamp: guards against absurd allocations


def _safe_name(name: str, ext: str) -> str:
    """Filename safe for a Content-Disposition header: keep only word chars,
    dot, dash; guarantee the extension. Prevents CRLF/quote injection +
    path traversal."""
    base = re.sub(r"[^A-Za-z0-9._-]", "_", name).strip("._") or "export"
    if not base.lower().endswith(ext):
        base += ext
    return base


def _attachment(name: str) -> dict[str, str]:
    return {"Content-Disposition": f'attachment; filename="{name}"'}
