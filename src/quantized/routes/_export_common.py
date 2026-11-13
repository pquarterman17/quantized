"""Shared export helpers (MIME types, filename sanitization, attachment headers)."""

from __future__ import annotations

import re
from urllib.parse import quote

from quantized.io._origin_names import ascii_fold

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
    # Accents fold first ("Ångström run" -> "Angstrom_run", not "ngstr_m_run").
    base = re.sub(r"[^A-Za-z0-9._-]", "_", ascii_fold(name)).strip("._") or "export"
    if not base.lower().endswith(ext):
        base += ext
    return base


def _attachment(name: str) -> dict[str, str]:
    return {"Content-Disposition": f'attachment; filename="{name}"'}


_UNSAFE_FILE_CHARS = re.compile(r'[\x00-\x1f\x7f-\x9f<>:"/\\|?*\u2028\u2029]')


def _attachment_named(raw_stem: str, ext: str) -> dict[str, str]:
    """``Content-Disposition`` for a user-named download: the ASCII
    ``filename=`` fallback (``_safe_name``) plus, when the name has
    characters that fallback collapses, RFC 5987/6266 ``filename*=UTF-8''…``
    carrying the real name (percent-encoded UTF-8, so no CR/LF/quote can
    reach the header; path separators and other filesystem-reserved
    characters become ``_``)."""
    fallback = _safe_name(raw_stem, ext)
    stem = _UNSAFE_FILE_CHARS.sub("_", raw_stem).strip(" .") or "export"
    full = stem if stem.lower().endswith(ext) else stem + ext
    header = f'attachment; filename="{fallback}"'
    if full != fallback:
        header += f"; filename*=UTF-8''{quote(full, safe='')}"
    return {"Content-Disposition": header}
