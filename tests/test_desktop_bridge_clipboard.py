"""Tests for the native Windows "Copy figure" clipboard (gap-4 G14).

Mock-based ONLY: CI never touches a real Windows clipboard. A fake
``win32clipboard`` module is injected through ``sys.modules`` and the gate's
platform check is monkeypatched, the same way ``tests/test_origin_com.py``
fakes ``win32com``.
"""

from __future__ import annotations

import base64
import io
import struct
import sys
import types
import zlib
from typing import Any

import pytest

from quantized import desktop_bridge_clipboard as clip
from quantized.desktop_bridge import DesktopApi

_SVG = b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>'
_RED, _BLUE = (255, 0, 0, 255), (0, 0, 255, 255)


def _png(
    size: tuple[int, int] = (3, 2), alpha: int = 0, dpi: tuple[int, int] | None = None
) -> bytes:
    from PIL import Image

    out = io.BytesIO()
    kw: dict[str, Any] = {"dpi": dpi} if dpi else {}
    Image.new("RGBA", size, (255, 0, 0, alpha)).save(out, format="PNG", **kw)
    return out.getvalue()


def _two_row_png() -> bytes:
    """3x2: top row red, bottom row blue, 300 DPI -- distinguishes row order."""
    from PIL import Image

    img = Image.new("RGBA", (3, 2))
    for x in range(3):
        img.putpixel((x, 0), _RED)
        img.putpixel((x, 1), _BLUE)
    out = io.BytesIO()
    img.save(out, format="PNG", dpi=(300, 300))
    return out.getvalue()


def _bomb_header(width: int, height: int) -> bytes:
    """A tiny, undecodable PNG whose IHDR declares width x height pixels."""
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    chunk = struct.pack(">I", len(ihdr)) + b"IHDR" + ihdr
    return b"\x89PNG\r\n\x1a\n" + chunk + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr))


class _FakeClipboard(types.ModuleType):
    CF_DIB = 8

    def __init__(self) -> None:
        super().__init__("win32clipboard")
        self.calls: list[tuple[Any, ...]] = []
        self.data: dict[int, bytes] = {}
        self.registered: dict[str, int] = {}
        self.open_failures = 0
        self.fail_on: str | None = None

    def OpenClipboard(self, *args: Any) -> None:  # records the owner hWnd, if any
        self.calls.append(("open", *args))
        if self.open_failures:
            self.open_failures -= 1
            raise OSError("clipboard busy")

    def EmptyClipboard(self) -> None:
        self.calls.append(("empty",))
        self.data.clear()

    def RegisterClipboardFormat(self, name: str) -> int:
        return self.registered.setdefault(name, 0xC000 + len(self.registered))

    def SetClipboardData(self, fmt: int, data: bytes) -> None:
        name = next((k for k, v in self.registered.items() if v == fmt), fmt)
        if name == self.fail_on:
            raise OSError("SetClipboardData failed")
        self.calls.append(("set", name))
        self.data[fmt] = data

    def CloseClipboard(self) -> None:
        self.calls.append(("close",))

    def by_name(self, name: str) -> bytes:
        return self.data[self.registered[name]]


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> _FakeClipboard:
    wc = _FakeClipboard()
    monkeypatch.setitem(sys.modules, "win32clipboard", wc)
    monkeypatch.setattr(clip.sys, "platform", "win32")
    monkeypatch.setenv("QZ_WIN_CLIPBOARD", "1")
    monkeypatch.setattr(clip, "_OPEN_RETRY_S", 0.0)
    return wc


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


# -- gate -----------------------------------------------------------------


def test_gate_is_off_off_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(clip.sys, "platform", "linux")
    monkeypatch.setenv("QZ_WIN_CLIPBOARD", "1")
    assert "Windows-only" in (clip.clipboard_unavailable_reason() or "")
    probe = DesktopApi().clipboard_probe()
    assert probe == {"available": False, "reason": probe["reason"], "formats": []}


def test_gate_needs_the_flag(monkeypatch: pytest.MonkeyPatch, fake: _FakeClipboard) -> None:
    monkeypatch.delenv("QZ_WIN_CLIPBOARD")
    assert "QZ_WIN_CLIPBOARD=1" in (clip.clipboard_unavailable_reason() or "")
    result = DesktopApi().copy_figure_clipboard(_b64(_png()), _b64(_SVG))
    assert result["ok"] is False and result["unavailable"] is True
    assert fake.calls == []  # never touched the clipboard


def test_gate_needs_pywin32(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(clip.sys, "platform", "win32")
    monkeypatch.setenv("QZ_WIN_CLIPBOARD", "1")
    monkeypatch.setitem(sys.modules, "win32clipboard", None)  # import raises ImportError
    assert "quantized-lab[desktop]" in (clip.clipboard_unavailable_reason() or "")


def test_desktop_extra_carries_pywin32_on_windows_only() -> None:
    import tomllib
    from pathlib import Path

    project = tomllib.loads((Path(__file__).parents[1] / "pyproject.toml").read_text("utf-8"))
    desktop = project["project"]["optional-dependencies"]["desktop"]
    assert "pywin32; sys_platform == 'win32'" in desktop


def test_probe_when_available(fake: _FakeClipboard) -> None:
    assert DesktopApi().clipboard_probe() == {
        "available": True,
        "reason": None,
        "formats": ["svg", "png", "dib"],
    }


# -- the write ------------------------------------------------------------


def test_writes_svg_png_and_dib_in_one_session(fake: _FakeClipboard) -> None:
    png = _png()
    result = DesktopApi().copy_figure_clipboard(_b64(png), _b64(_SVG))
    assert result == {"ok": True, "formats": ["svg", "png", "dib"]}
    assert fake.calls == [
        ("open",),  # no window attached: no owner hWnd (documented fallback)
        ("empty",),
        ("set", "image/svg+xml"),
        ("set", "PNG"),
        ("set", 8),
        ("close",),
    ]
    assert fake.by_name("image/svg+xml") == _SVG
    assert fake.by_name("PNG") == png


def test_dib_layout_row_order_stride_and_dpi() -> None:
    dib = clip.png_to_dib(_two_row_png())
    size, width, height, planes, bpp, compression = struct.unpack("<IiiHHI", dib[:20])
    x_ppm, y_ppm = struct.unpack("<ii", dib[24:32])
    assert (size, width, height, planes, bpp, compression) == (40, 3, 2, 1, 24, 0)
    assert height > 0  # bottom-up
    assert (x_ppm, y_ppm) == (11811, 11811)  # 300 DPI, not the 96-DPI default
    stride = 12  # 3 px * 3 bytes = 9, padded to a multiple of 4
    pixels = dib[40:]
    assert len(pixels) == stride * 2
    bottom, top = pixels[:stride], pixels[stride:]
    assert bottom == b"\xff\x00\x00" * 3 + b"\x00" * 3  # blue, as BGR, first
    assert top == b"\x00\x00\xff" * 3 + b"\x00" * 3  # red


def test_dib_flattens_transparency_onto_white_and_defaults_to_300_dpi() -> None:
    dib = clip.png_to_dib(_png(alpha=0))  # no pHYs chunk
    assert dib[40:43] == b"\xff\xff\xff"
    assert struct.unpack("<ii", dib[24:32]) == (11811, 11811)


def test_png_only_never_claims_svg(fake: _FakeClipboard) -> None:
    result = DesktopApi().copy_figure_clipboard(_b64(_png()), "")
    assert result == {"ok": True, "formats": ["png", "dib"]}
    assert "image/svg+xml" not in fake.registered


def test_retries_a_busy_clipboard(fake: _FakeClipboard) -> None:
    fake.open_failures = 2
    assert DesktopApi().copy_figure_clipboard(_b64(_png()), "")["ok"] is True
    assert [c for c in fake.calls if c[0] == "open"] == [("open",)] * 3


def test_busy_clipboard_fails_closed(fake: _FakeClipboard) -> None:
    fake.open_failures = 99
    result = DesktopApi().copy_figure_clipboard(_b64(_png()), "")
    assert result["ok"] is False and "clipboard write failed" in result["error"]
    assert ("empty",) not in fake.calls


def test_failure_part_way_leaves_nothing_on_the_clipboard(fake: _FakeClipboard) -> None:
    fake.fail_on = "PNG"  # the SVG was already set when this fails
    result = DesktopApi().copy_figure_clipboard(_b64(_png()), _b64(_SVG))
    assert result["ok"] is False and "SetClipboardData failed" in result["error"]
    assert fake.data == {}  # no SVG-only item left behind a "failed" toast
    assert fake.calls[-2:] == [("empty",), ("close",)]


# -- clipboard owner (L2) -------------------------------------------------


class _IntPtr:
    def __init__(self, value: int) -> None:
        self._value = value

    def ToInt64(self) -> int:
        return self._value


def test_opens_the_clipboard_with_the_window_hwnd(fake: _FakeClipboard) -> None:
    api = DesktopApi()
    api.attach(types.SimpleNamespace(native=types.SimpleNamespace(Handle=_IntPtr(0x1234))))
    assert api.copy_figure_clipboard(_b64(_png()), "")["ok"] is True
    assert fake.calls[0] == ("open", 0x1234)


@pytest.mark.parametrize(
    "window",
    [
        None,
        types.SimpleNamespace(),
        types.SimpleNamespace(native=types.SimpleNamespace(Handle=_IntPtr(0))),
    ],
)
def test_no_hwnd_opens_without_owner(fake: _FakeClipboard, window: Any) -> None:
    api = DesktopApi()
    api.attach(window)
    assert api.copy_figure_clipboard(_b64(_png()), "")["ok"] is True
    assert fake.calls[0] == ("open",)


# -- payload validation ---------------------------------------------------


@pytest.mark.parametrize(
    ("png", "svg", "message"),
    [
        ("not base64!!", "", "not valid base64"),
        (_b64(b"GIF89a....................."), "", "not a PNG"),
        (_b64(_png()), _b64(b"<html></html>"), "not an SVG"),
        (_b64(_png()), _b64(b"not xml at all"), "not an SVG"),
    ],
)
def test_bad_payload_is_refused_before_the_clipboard(
    fake: _FakeClipboard, png: str, svg: str, message: str
) -> None:
    result = DesktopApi().copy_figure_clipboard(png, svg)
    assert result["ok"] is False and message in result["error"]
    assert fake.calls == []


def test_oversized_payload_is_refused(
    monkeypatch: pytest.MonkeyPatch, fake: _FakeClipboard
) -> None:
    monkeypatch.setattr(clip, "MAX_CLIPBOARD_BYTES", 16)
    result = DesktopApi().copy_figure_clipboard(_b64(_png()), "")
    assert result["ok"] is False and "too large" in result["error"]
    assert fake.calls == []


def test_pixel_bomb_is_refused_from_the_header(
    monkeypatch: pytest.MonkeyPatch, fake: _FakeClipboard
) -> None:
    def no_decode(png: bytes) -> bytes:
        raise AssertionError("decoded a PNG that should have been refused from its header")

    monkeypatch.setattr(clip, "png_to_dib", no_decode)
    bomb = _bomb_header(10_000, 10_000)  # 100 MP declared in 33 bytes
    assert len(bomb) < 100
    result = DesktopApi().copy_figure_clipboard(_b64(bomb), "")
    assert result["ok"] is False and "10000x10000" in result["error"]
    assert fake.calls == []


def test_pixel_cap_boundary() -> None:
    assert clip.png_dimensions(_bomb_header(7000, 7000)) == (7000, 7000)
    assert 7000 * 7000 <= clip.MAX_PIXELS < 7072 * 7072


# -- SVG sanitizing (L3) --------------------------------------------------

_NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'


@pytest.mark.parametrize(
    ("body", "message"),
    [
        (f"<svg {_NS}><script>alert(1)</script></svg>", "<script>"),
        (f"<svg {_NS}><foreignObject><div/></foreignObject></svg>", "<foreignobject>"),
        (f'<svg {_NS} onload="alert(1)"><path d="M0 0"/></svg>', "event handler"),
        (f'<svg {_NS}><path d="M0 0" onclick="x()"/></svg>', "event handler"),
        (f'<svg {_NS}><image xlink:href="http://evil.example/x.png"/></svg>', "external"),
        (f'<svg {_NS}><use href="file:///etc/passwd"/></svg>', "external"),
        (f'<svg {_NS}><path style="fill:url(http://x/y)" d="M0 0"/></svg>', "external"),
        (f"<svg {_NS}><style>@import url(http://x/y.css);</style></svg>", "external"),
        (
            '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]>'
            f"<svg {_NS}><text>&a;</text></svg>",
            "entities",
        ),
    ],
)
def test_unsafe_svg_is_refused(fake: _FakeClipboard, body: str, message: str) -> None:
    result = DesktopApi().copy_figure_clipboard(_b64(_png()), _b64(body.encode()))
    assert result["ok"] is False and message in result["error"]
    assert fake.calls == []


def test_matplotlib_text_as_paths_svg_passes() -> None:
    """The server renderer's own output (fragment refs, clip-path url(#..),
    an embedded data: image, a <style> block) must never be refused."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots()
    ax.plot([0, 1, 2], [0, 1, 4], label="M (emu)")
    ax.imshow([[0, 1], [1, 0]], extent=(0, 1, 0, 1))
    ax.set_title("Hysteresis")
    ax.legend()
    out = io.BytesIO()
    with matplotlib.rc_context({"svg.fonttype": "path", "svg.image_inline": True}):
        fig.savefig(out, format="svg")
    plt.close(fig)
    svg = out.getvalue()
    assert b'xlink:href="#' in svg and b"data:image/png" in svg
    clip.check_svg(svg)  # does not raise
