"""Tests for the native Windows "Copy figure" clipboard (gap-4 G14).

Mock-based ONLY: CI never touches a real Windows clipboard. A fake
``win32clipboard`` module is injected through ``sys.modules`` and the gate's
platform check is monkeypatched, the same way ``tests/test_origin_com.py``
fakes ``win32com``.
"""

from __future__ import annotations

import base64
import io
import sys
import types
from typing import Any

import pytest

from quantized import desktop_bridge_clipboard as clip
from quantized.desktop_bridge import DesktopApi

_SVG = b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>'


def _png(size: tuple[int, int] = (3, 2), alpha: int = 0) -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGBA", size, (255, 0, 0, alpha)).save(out, format="PNG")
    return out.getvalue()


class _FakeClipboard(types.ModuleType):
    CF_DIB = 8

    def __init__(self, open_failures: int = 0, fail_on: str | None = None) -> None:
        super().__init__("win32clipboard")
        self.calls: list[tuple[Any, ...]] = []
        self.data: dict[int, bytes] = {}
        self.registered: dict[str, int] = {}
        self._open_failures = open_failures
        self._fail_on = fail_on

    def OpenClipboard(self) -> None:
        self.calls.append(("open",))
        if self._open_failures:
            self._open_failures -= 1
            raise OSError("clipboard busy")

    def EmptyClipboard(self) -> None:
        self.calls.append(("empty",))
        self.data.clear()

    def RegisterClipboardFormat(self, name: str) -> int:
        return self.registered.setdefault(name, 0xC000 + len(self.registered))

    def SetClipboardData(self, fmt: int, data: bytes) -> None:
        name = next((k for k, v in self.registered.items() if v == fmt), fmt)
        if name == self._fail_on:
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
    assert "pywin32" in (clip.clipboard_unavailable_reason() or "")


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
        ("open",),
        ("empty",),
        ("set", "image/svg+xml"),
        ("set", "PNG"),
        ("set", 8),
        ("close",),
    ]
    assert fake.by_name("image/svg+xml") == _SVG
    assert fake.by_name("PNG") == png
    dib = fake.data[8]
    assert int.from_bytes(dib[0:4], "little") == 40  # BITMAPINFOHEADER, no file header
    assert int.from_bytes(dib[4:8], "little", signed=True) == 3  # width
    assert int.from_bytes(dib[14:16], "little") == 24  # flattened, no alpha
    # Transparent red over white -> white: the first pixel (BGR) is 255,255,255.
    assert dib[40:43] == b"\xff\xff\xff"


def test_png_only_never_claims_svg(fake: _FakeClipboard) -> None:
    result = DesktopApi().copy_figure_clipboard(_b64(_png()), "")
    assert result == {"ok": True, "formats": ["png", "dib"]}
    assert "image/svg+xml" not in fake.registered


def test_retries_a_busy_clipboard(monkeypatch: pytest.MonkeyPatch, fake: _FakeClipboard) -> None:
    fake._open_failures = 2
    assert DesktopApi().copy_figure_clipboard(_b64(_png()), "")["ok"] is True
    assert [c for c in fake.calls if c == ("open",)] == [("open",)] * 3


def test_busy_clipboard_fails_closed(fake: _FakeClipboard) -> None:
    fake._open_failures = 99
    result = DesktopApi().copy_figure_clipboard(_b64(_png()), "")
    assert result["ok"] is False and "clipboard write failed" in result["error"]
    assert ("empty",) not in fake.calls


def test_failed_set_still_closes_and_reports(fake: _FakeClipboard) -> None:
    fake._fail_on = "PNG"
    result = DesktopApi().copy_figure_clipboard(_b64(_png()), _b64(_SVG))
    assert result["ok"] is False and "SetClipboardData failed" in result["error"]
    assert fake.calls[-1] == ("close",)


@pytest.mark.parametrize(
    ("png", "svg", "message"),
    [
        ("not base64!!", "", "not valid base64"),
        (_b64(b"GIF89a....."), "", "not a PNG"),
        (_b64(_png()), _b64(b"<html></html>"), "not an SVG"),
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
