"""Native Windows clipboard write for "Copy figure" (gap-4 G14).

Origin's *Copy Page* pastes a scalable picture into Word and PowerPoint. A
browser cannot do that: ``navigator.clipboard`` only takes a sanctioned MIME
set, so most engines get a 300-DPI PNG (``frontend/src/lib/officeClipboard.ts``).
Inside the pywebview desktop shell this mixin writes the Windows clipboard
directly, in this process, through pywin32's ``win32clipboard``.

## What goes on the clipboard

The frontend renders the figure through the SAME server renderer as File >
Export (``renderFigureBlob`` -> ``calc.figure_render``), so the paste matches
an export, and hands the bytes here. One ``OpenClipboard`` session then sets:

- ``"image/svg+xml"`` (a registered clipboard format): the text-as-paths SVG.
  Microsoft 365 Word/PowerPoint read this format and paste an editable vector
  graphic; it is the format Inkscape and Chromium write for SVG.
- ``"PNG"`` (registered format): the 300-DPI render. Office prefers it over a
  DIB when no SVG is offered (older Office, or the SVG was skipped).
- ``CF_DIB``: the same pixels as a device-independent bitmap, for targets that
  read no registered format at all (Paint, older apps).

**No EMF.** Matplotlib has had no EMF backend since 2.x. The SVG-to-EMF
converters are Inkscape (GPL-2.0+, an external program), pyemf/pyemf3 (LGPL,
unmaintained) and LibreOffice (an external program). The repo forbids GPL
runtime dependencies and none of the others is a library we can ship, so
CF_ENHMETAFILE is not offered. Writing an EMF renderer of our own would need
verification on real Windows/Office, which CI cannot do. Office 2016 and
earlier therefore paste the PNG, and the frontend reports exactly which
formats were written, so it never claims vector when only pixels went.

## Gating (the Origin COM pattern)

OS-gated and optional, exactly like :mod:`quantized.io.origin_com`: Windows
only, ``QZ_WIN_CLIPBOARD=1`` set, and pywin32 importable (the ``origin-com``
extra). Anywhere else :meth:`clipboard_probe` says why, and the frontend
uses the browser clipboard path. Tests are mock-only: a fake
``win32clipboard`` is injected through ``sys.modules`` (see
``tests/test_desktop_bridge_clipboard.py``).

Fails closed: every method returns a dict and never raises into JS; a failed
write reports ``{"ok": False, "error": ...}`` and the frontend shows it.
"""

from __future__ import annotations

import base64
import binascii
import io
import os
import sys
import time
from typing import Any

from quantized.heavy_import import heavy_imports

__all__ = [
    "MAX_CLIPBOARD_BYTES",
    "DesktopClipboardBridge",
    "clipboard_unavailable_reason",
    "png_to_dib",
    "write_figure_clipboard",
]

_FLAG_ENV = "QZ_WIN_CLIPBOARD"
SVG_FORMAT = "image/svg+xml"
PNG_FORMAT = "PNG"
#: Per-format cap on decoded bytes. A 300-DPI A4 render is a few MB; this only
#: stops a hostile page from making the process allocate without bound.
MAX_CLIPBOARD_BYTES = 64 * 1024 * 1024
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
#: ``OpenClipboard`` fails while another process holds the clipboard (a
#: clipboard manager, an RDP session). Short retries ride that out.
_OPEN_ATTEMPTS = 5
_OPEN_RETRY_S = 0.05
_BMP_FILE_HEADER = 14  # CF_DIB is a BMP file without its 14-byte file header


def clipboard_unavailable_reason() -> str | None:
    """``None`` when the native path can run, otherwise why not. Never raises."""
    if sys.platform != "win32":
        return "the native clipboard path is Windows-only"
    if os.environ.get(_FLAG_ENV) != "1":
        return f"set {_FLAG_ENV}=1 to enable the native vector clipboard"
    try:
        with heavy_imports("win32clipboard"):
            import win32clipboard  # noqa: F401  (lazy: optional Windows-only dep)
    except ImportError:
        return "pywin32 is not installed (pip install quantized[origin-com])"
    return None


def png_to_dib(png: bytes) -> bytes:
    """The CF_DIB payload for ``png``: a 24-bit BMP minus its file header.

    Flattened onto white, because GDI bitmaps have no reliable alpha and a
    transparent background would paste black in most targets."""
    with heavy_imports("PIL", "PIL.Image"):
        from PIL import Image

    with Image.open(io.BytesIO(png)) as img:
        rgba = img.convert("RGBA")
    flat = Image.new("RGB", rgba.size, (255, 255, 255))
    flat.paste(rgba, mask=rgba.getchannel("A"))
    out = io.BytesIO()
    flat.save(out, format="BMP")
    return out.getvalue()[_BMP_FILE_HEADER:]


def _open_clipboard(wc: Any) -> None:
    for attempt in range(_OPEN_ATTEMPTS):
        try:
            wc.OpenClipboard()
            return
        except Exception:
            if attempt == _OPEN_ATTEMPTS - 1:
                raise
            time.sleep(_OPEN_RETRY_S)


def write_figure_clipboard(png: bytes, svg: bytes | None) -> list[str]:
    """Replace the clipboard with the figure; returns the formats written.

    Raises on failure. The caller has already checked the gate. The clipboard
    is closed on every path, including a failure part-way through."""
    dib = png_to_dib(png)  # before opening: a decode error leaves the clipboard alone
    with heavy_imports("win32clipboard"):
        import win32clipboard as wc

    _open_clipboard(wc)
    try:
        wc.EmptyClipboard()
        formats: list[str] = []
        if svg is not None:
            wc.SetClipboardData(wc.RegisterClipboardFormat(SVG_FORMAT), svg)
            formats.append("svg")
        wc.SetClipboardData(wc.RegisterClipboardFormat(PNG_FORMAT), png)
        formats.append("png")
        wc.SetClipboardData(wc.CF_DIB, dib)
        formats.append("dib")
        return formats
    finally:
        wc.CloseClipboard()


def _decode(b64: str, what: str) -> bytes:
    if not isinstance(b64, str):
        raise ValueError(f"{what} must be a base64 string")
    if len(b64) > MAX_CLIPBOARD_BYTES * 4 // 3 + 4:
        raise ValueError(f"{what} is too large for the clipboard")
    try:
        return base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"{what} is not valid base64") from exc


class DesktopClipboardBridge:
    """Mixin on ``DesktopApi`` (``window.pywebview.api``); see the module doc."""

    def clipboard_probe(self) -> dict[str, Any]:
        """Can :meth:`copy_figure_clipboard` run here, and with which formats?"""
        reason = clipboard_unavailable_reason()
        if reason is not None:
            return {"available": False, "reason": reason, "formats": []}
        return {"available": True, "reason": None, "formats": ["svg", "png", "dib"]}

    def copy_figure_clipboard(self, png_b64: str, svg_b64: str = "") -> dict[str, Any]:
        """Write the rendered figure to the Windows clipboard.

        ``png_b64`` is required (every target can paste it); ``svg_b64`` is
        optional (empty = not rendered). Returns ``{"ok": True, "formats":
        [...]}`` listing what was actually written, or ``{"ok": False,
        "error": ...}``. Never raises."""
        reason = clipboard_unavailable_reason()
        if reason is not None:
            return {"ok": False, "error": reason, "unavailable": True}
        try:
            png = _decode(png_b64, "PNG")
            if not png.startswith(_PNG_SIGNATURE):
                raise ValueError("the PNG render is not a PNG")
            svg = _decode(svg_b64, "SVG") if svg_b64 else None
            if svg is not None and b"<svg" not in svg[:4096]:
                raise ValueError("the SVG render is not an SVG")
        except ValueError as exc:
            return {"ok": False, "error": str(exc)}
        try:
            formats = write_figure_clipboard(png, svg)
        except Exception as exc:  # pywin32 raises pywintypes.error; report any failure
            return {"ok": False, "error": f"clipboard write failed: {exc}"}
        return {"ok": True, "formats": formats}
