"""Lossless saved-graph preview extraction for Origin projects (#51).

CPYUA (``.opju``) stores standalone PNG thumbnails inside page spans.  A
preview is attached only when a named graph page (not a workbook page) owns
exactly one structurally and CRC-valid PNG.  Original bytes are base64-wrapped,
never decoded/re-encoded.  Anything else stays diagnostic-only.

The CPYA (``.opj``) corpus has no PNG signatures.  Its observed 108-byte EMF
and 8x8 DIB records are icon/storage assets, not graph previews, so this module
does not guess an attribution for them.
"""

from __future__ import annotations

import base64
import hashlib
import struct
import zlib
from typing import Any, Literal, TypedDict

from quantized.io.origin_project.opju_figure_curves import column_id_table, opju_pages

__all__ = ["PreviewDiagnostic", "SavedGraphPreview", "attach_opju_graph_previews"]

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_MAX_PNG_BYTES = 10 * 1024 * 1024
_MAX_DIMENSION = 16_384


class SavedGraphPreview(TypedDict):
    format: Literal["png"]
    mime: Literal["image/png"]
    width: int
    height: int
    sha256: str
    data: str
    confidence: Literal["exact_page", "ambiguous_page"]
    page_name: str


class PreviewDiagnostic(TypedDict, total=False):
    page_name: str
    status: Literal["no_preview", "ambiguous", "workbook_thumbnail"]
    asset_count: int
    assets: list[SavedGraphPreview]


def _png_at(b: bytes, start: int, limit: int, page_name: str) -> SavedGraphPreview | None:
    """Validate and return one complete PNG beginning at ``start``."""
    if b[start : start + 8] != _PNG_SIGNATURE:
        return None
    p = start + 8
    width = height = 0
    saw_ihdr = False
    while p + 12 <= limit and p - start <= _MAX_PNG_BYTES:
        length = struct.unpack_from(">I", b, p)[0]
        chunk_end = p + 12 + length
        if chunk_end > limit or chunk_end - start > _MAX_PNG_BYTES:
            return None
        kind = b[p + 4 : p + 8]
        data = b[p + 8 : p + 8 + length]
        expected_crc = struct.unpack_from(">I", b, p + 8 + length)[0]
        if zlib.crc32(kind + data) & 0xFFFFFFFF != expected_crc:
            return None
        if not saw_ihdr:
            if kind != b"IHDR" or length != 13:
                return None
            width, height = struct.unpack_from(">II", data)
            if not (1 <= width <= _MAX_DIMENSION and 1 <= height <= _MAX_DIMENSION):
                return None
            saw_ihdr = True
        if kind == b"IEND":
            if length != 0 or not saw_ihdr:
                return None
            raw = b[start:chunk_end]
            return {
                "format": "png",
                "mime": "image/png",
                "width": width,
                "height": height,
                "sha256": hashlib.sha256(raw).hexdigest(),
                "data": base64.b64encode(raw).decode("ascii"),
                "confidence": "exact_page",
                "page_name": page_name,
            }
        p = chunk_end
    return None


def _pngs_in(b: bytes, start: int, end: int, page_name: str) -> list[SavedGraphPreview]:
    out: list[SavedGraphPreview] = []
    p = b.find(_PNG_SIGNATURE, start, end)
    while p >= 0:
        preview = _png_at(b, p, end, page_name)
        if preview is not None:
            out.append(preview)
        p = b.find(_PNG_SIGNATURE, p + len(_PNG_SIGNATURE), end)
    return out


def attach_opju_graph_previews(
    figures: list[dict[str, Any]], b: bytes
) -> tuple[list[dict[str, Any]], list[PreviewDiagnostic]]:
    """Copy ``figures`` and attach exact page previews by graph-window name.

    Page classification reuses the independently validated global column-id
    table: a page that owns columns is a workbook/report page.  Only a
    non-workbook page with exactly one valid PNG is attributable.  All layers
    of the same graph page receive the same immutable saved reference.
    """
    pages = opju_pages(b)
    if not pages:
        return [dict(fig) for fig in figures], []
    table = column_id_table(b, pages)
    graph_names = {str(fig.get("name")) for fig in figures if fig.get("name")}
    exact: dict[str, SavedGraphPreview] = {}
    diagnostics: list[PreviewDiagnostic] = []
    bounds = [*pages, (len(b), "")]
    for (start, page_name), (end, _next_name) in zip(bounds, bounds[1:], strict=False):
        assets = _pngs_in(b, start, end, page_name)
        if page_name in table.book_pages:
            if assets:
                diagnostics.append(
                    {
                        "page_name": page_name,
                        "status": "workbook_thumbnail",
                        "asset_count": len(assets),
                    }
                )
            continue
        # Folder/note/attachment pages own neither columns nor decoded graph
        # layers. They are outside #51 and cannot be called graph pages merely
        # because the id table does not classify them as workbooks.
        if page_name not in graph_names:
            continue
        if len(assets) == 1:
            exact[page_name] = assets[0]
        elif len(assets) == 0:
            diagnostics.append({"page_name": page_name, "status": "no_preview", "asset_count": 0})
        else:
            ambiguous: list[SavedGraphPreview] = []
            for asset in assets:
                ambiguous.append({**asset, "confidence": "ambiguous_page"})
            diagnostics.append(
                {
                    "page_name": page_name,
                    "status": "ambiguous",
                    "asset_count": len(ambiguous),
                    "assets": ambiguous,
                }
            )
    attached: list[dict[str, Any]] = []
    for fig in figures:
        preview = exact.get(str(fig.get("name")))
        attached.append({**fig, **({"saved_preview": preview} if preview else {})})
    return attached, diagnostics
