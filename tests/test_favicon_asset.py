"""The SPA ships ``/favicon.ico`` beside the declared ``/favicon.png``.

Chromium still asks for ``/favicon.ico`` on its own now and then (it is
browser-initiated, so no page network hook sees it). The live fitting check
caught it as a stray "404 (Not Found)" console error at startup. Vite copies
``frontend/public/`` verbatim into the served ``web/`` directory, so the icon
has to be a real ICO there.
"""

from __future__ import annotations

from pathlib import Path

PUBLIC = Path(__file__).resolve().parents[1] / "frontend" / "public"


def test_public_favicon_ico_is_a_real_icon() -> None:
    data = (PUBLIC / "favicon.ico").read_bytes()
    assert data[:4] == b"\x00\x00\x01\x00"  # ICONDIR: reserved 0, type 1 (icon)
    assert int.from_bytes(data[4:6], "little") >= 1
