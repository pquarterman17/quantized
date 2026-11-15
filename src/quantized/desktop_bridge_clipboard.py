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
  read no registered format at all (Paint, older apps). It carries the PNG's
  resolution (300 DPI = 11811 pels/m), so a target that sizes a DIB by its
  resolution pastes it at its physical size.

All or nothing: a failure part-way through empties the clipboard again and
reports the failure, so the user never pastes a half-written item after being
told the copy failed.

**No EMF.** Matplotlib has had no EMF backend since 2.x. The SVG-to-EMF
converters are Inkscape (GPL-2.0+, an external program), pyemf/pyemf3 (LGPL,
unmaintained) and LibreOffice (an external program). The repo forbids GPL
runtime dependencies and none of the others is a library we can ship, so
CF_ENHMETAFILE is not offered. Writing an EMF renderer of our own would need
verification on real Windows/Office, which CI cannot do. Office 2016 and
earlier therefore paste the PNG, and the frontend reports exactly which
formats were written, so it never claims vector when only pixels went.

## What the page may hand us

The bytes come from JS, so they are checked before the clipboard is opened:
base64 and size caps; a PNG signature and at most :data:`MAX_PIXELS` pixels,
read from the IHDR header BEFORE anything is decoded (a few-KB PNG can
declare gigapixels); and an SVG that parses as XML with an ``<svg>`` root and
no ``<script>``, ``<foreignObject>``, ``on*=`` handler, entity declaration, or
reference outside the document (``href``/``url()`` other than ``#fragment`` or
``data:image/``). matplotlib's text-as-paths output contains none of these, so
the check only ever refuses a page that did not use the server renderer.

## Clipboard owner

``OpenClipboard`` is given the pywebview window's HWND when the shell exposes
one (``window.native.Handle`` on the Windows WinForms/EdgeChromium backend).
Without one it is called with no owner, which MSDN says may make
``SetClipboardData`` fail; in practice that pattern works for immediate
(non-delayed) rendering, and any failure is reported, never silent.

## Gating (opt-in until smoke-tested)

OS-gated and optional, like :mod:`quantized.io.origin_com`: Windows only,
``QZ_WIN_CLIPBOARD=1`` set, and pywin32 importable (in the ``desktop`` extra
on Windows). It stays opt-in until a manual smoke test on real Windows +
Office passes (``docs/desktop.md``); then it becomes default-on with
``QZ_WIN_CLIPBOARD=0`` as the kill switch. Anywhere else
:meth:`clipboard_probe` says why, and the frontend uses the browser clipboard.
Tests are mock-only: a fake ``win32clipboard`` is injected through
``sys.modules`` (see ``tests/test_desktop_bridge_clipboard.py``).

Fails closed: every method returns a dict and never raises into JS; a failed
write reports ``{"ok": False, "error": ...}`` and the frontend shows it.
"""

from __future__ import annotations

import base64
import binascii
import io
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from typing import Any

from quantized.heavy_import import heavy_imports

__all__ = [
    "MAX_CLIPBOARD_BYTES",
    "MAX_PIXELS",
    "DesktopClipboardBridge",
    "check_svg",
    "clipboard_unavailable_reason",
    "png_dimensions",
    "png_to_dib",
    "write_figure_clipboard",
]

_FLAG_ENV = "QZ_WIN_CLIPBOARD"
SVG_FORMAT = "image/svg+xml"
PNG_FORMAT = "PNG"
#: Per-format cap on decoded bytes. A 300-DPI A4 render is a few MB; this only
#: stops a hostile page from making the process allocate without bound.
MAX_CLIPBOARD_BYTES = 64 * 1024 * 1024
#: Pixel cap, checked from the PNG header before decoding: the DIB conversion
#: holds several full copies, so bytes alone do not bound memory. A3 at
#: 300 DPI is about 17 MP; 50 MP leaves room for large posters.
MAX_PIXELS = 50_000_000
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_DEFAULT_DPI = 300.0
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
        return "pywin32 is not installed (pip install quantized-lab[desktop])"
    return None


def png_dimensions(png: bytes) -> tuple[int, int]:
    """Width and height from the IHDR chunk (always first), without decoding."""
    if len(png) < 24 or not png.startswith(_PNG_SIGNATURE) or png[12:16] != b"IHDR":
        raise ValueError("the PNG render is not a PNG")
    return int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")


_EXTERNAL_URL = re.compile(r"url\(\s*['\"]?\s*(?!#)", re.IGNORECASE)


def _local_name(name: str) -> str:
    return name.rsplit("}", 1)[-1].lower()


def check_svg(svg: bytes) -> None:
    """Refuse an SVG that could run script or fetch anything (see module doc)."""
    if b"<!ENTITY" in svg.upper():
        raise ValueError("the SVG declares XML entities")
    try:
        root = ET.fromstring(svg)
    except ET.ParseError as exc:
        raise ValueError("the SVG render is not an SVG") from exc
    if _local_name(root.tag) != "svg":
        raise ValueError("the SVG render is not an SVG")
    for el in root.iter():
        tag = _local_name(el.tag) if isinstance(el.tag, str) else ""
        if tag in ("script", "foreignobject"):
            raise ValueError(f"the SVG contains <{tag}>")
        if tag == "style" and el.text and ("@import" in el.text or _EXTERNAL_URL.search(el.text)):
            raise ValueError("the SVG style references an external resource")
        for key, value in el.attrib.items():
            attr = _local_name(key)
            if attr.startswith("on"):
                raise ValueError(f"the SVG has an event handler ({attr})")
            if attr == "href" and not (value.startswith("#") or value.startswith("data:image/")):
                raise ValueError("the SVG references an external resource")
            if _EXTERNAL_URL.search(value):
                raise ValueError("the SVG references an external resource")


def png_to_dib(png: bytes) -> bytes:
    """The CF_DIB payload for ``png``: a 24-bit BMP minus its file header.

    Flattened onto white, because GDI bitmaps have no reliable alpha and a
    transparent background would paste black in most targets. Keeps the PNG's
    resolution (default 300 DPI) in the header's pels-per-metre fields."""
    with heavy_imports("PIL", "PIL.Image"):
        from PIL import Image

    with Image.open(io.BytesIO(png)) as img:
        dpi = img.info.get("dpi", (_DEFAULT_DPI, _DEFAULT_DPI))
        rgba = img.convert("RGBA")
    flat = Image.new("RGB", rgba.size, (255, 255, 255))
    flat.paste(rgba, mask=rgba.getchannel("A"))
    out = io.BytesIO()
    flat.save(out, format="BMP", dpi=(float(dpi[0]), float(dpi[1])))
    return out.getvalue()[_BMP_FILE_HEADER:]


def _open_clipboard(wc: Any, hwnd: int | None) -> None:
    for attempt in range(_OPEN_ATTEMPTS):
        try:
            if hwnd is None:
                wc.OpenClipboard()
            else:
                wc.OpenClipboard(hwnd)
            return
        except Exception:
            if attempt == _OPEN_ATTEMPTS - 1:
                raise
            time.sleep(_OPEN_RETRY_S)


def write_figure_clipboard(png: bytes, svg: bytes | None, hwnd: int | None = None) -> list[str]:
    """Replace the clipboard with the figure; returns the formats written.

    Raises on failure. The caller has already checked the gate and the
    payload. All or nothing: a failure after ``EmptyClipboard`` empties the
    clipboard again before re-raising, and it is closed on every path."""
    dib = png_to_dib(png)  # before opening: a decode error leaves the clipboard alone
    with heavy_imports("win32clipboard"):
        import win32clipboard as wc

    _open_clipboard(wc, hwnd)
    try:
        wc.EmptyClipboard()
        try:
            formats: list[str] = []
            if svg is not None:
                wc.SetClipboardData(wc.RegisterClipboardFormat(SVG_FORMAT), svg)
                formats.append("svg")
            wc.SetClipboardData(wc.RegisterClipboardFormat(PNG_FORMAT), png)
            formats.append("png")
            wc.SetClipboardData(wc.CF_DIB, dib)
            formats.append("dib")
        except Exception:
            wc.EmptyClipboard()  # never leave a partial item behind a "failed"
            raise
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


def _window_hwnd(window: Any) -> int | None:
    """The pywebview window's HWND, when the backend exposes one (WinForms:
    ``window.native.Handle``, a .NET ``IntPtr``). ``None`` otherwise."""
    handle = getattr(getattr(window, "native", None), "Handle", None)
    if handle is None:
        return None
    for conv in ("ToInt64", "ToInt32"):
        fn = getattr(handle, conv, None)
        if callable(fn):
            try:
                value = fn()
            except Exception:
                return None
            return int(value) if isinstance(value, int) and value else None
    return handle if isinstance(handle, int) and handle else None


class DesktopClipboardBridge:
    """Mixin on ``DesktopApi`` (``window.pywebview.api``); see the module doc."""

    _window: Any = None  # set by DesktopApi.attach

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
            width, height = png_dimensions(png)
            if width * height > MAX_PIXELS:
                raise ValueError(f"the PNG is too large for the clipboard ({width}x{height} px)")
            svg = _decode(svg_b64, "SVG") if svg_b64 else None
            if svg is not None:
                check_svg(svg)
        except ValueError as exc:
            return {"ok": False, "error": str(exc)}
        try:
            formats = write_figure_clipboard(png, svg, _window_hwnd(self._window))
        except Exception as exc:  # pywin32 raises pywintypes.error; report any failure
            return {"ok": False, "error": f"clipboard write failed: {exc}"}
        return {"ok": True, "formats": formats}
