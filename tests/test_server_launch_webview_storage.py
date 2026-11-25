"""pywebview keeps the desktop window's browser storage (PREFS_AUDIT P0-1).

pywebview is not a CI dependency: ``webview`` is a mock and the argument
selection is tested against stand-in ``start`` signatures (old and new)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from quantized import server_launch


def _start_new(func=None, *, private_mode=True, storage_path=None, debug=False):  # type: ignore[no-untyped-def]
    """The pywebview 4/5 shape: both storage keywords exist."""


def _start_old(func=None, debug=False):  # type: ignore[no-untyped-def]
    """A pywebview before 4: neither keyword exists."""


def _start_kwargs(**kwargs):  # type: ignore[no-untyped-def]
    """A wrapper that forwards **kwargs."""


def test_new_pywebview_gets_persistent_storage(tmp_path: Path) -> None:
    kw = server_launch._webview_start_kwargs(_start_new, tmp_path / "wv")
    assert kw == {"private_mode": False, "storage_path": str(tmp_path / "wv")}


def test_old_pywebview_gets_no_unknown_keywords(tmp_path: Path) -> None:
    assert server_launch._webview_start_kwargs(_start_old, tmp_path) == {}


def test_var_keyword_start_gets_both(tmp_path: Path) -> None:
    kw = server_launch._webview_start_kwargs(_start_kwargs, tmp_path)
    assert kw["private_mode"] is False
    assert kw["storage_path"] == str(tmp_path)


def test_uninspectable_start_gets_nothing(tmp_path: Path) -> None:
    class _Opaque:
        @property
        def __signature__(self):  # type: ignore[no-untyped-def]
            raise ValueError("no signature")

        def __call__(self) -> None: ...

    assert server_launch._webview_start_kwargs(_Opaque(), tmp_path) == {}


def test_run_desktop_passes_storage_under_config_dir(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    cfg = tmp_path / "cfg"
    monkeypatch.setenv("QZ_CONFIG_DIR", str(cfg))
    monkeypatch.setattr(server_launch, "_WEB_DIR", tmp_path)
    calls: list[dict[str, object]] = []

    def start(func=None, *, private_mode=True, storage_path=None, debug=False):  # type: ignore[no-untyped-def]
        calls.append({"private_mode": private_mode, "storage_path": storage_path})

    webview = MagicMock()
    webview.start = start
    monkeypatch.setitem(sys.modules, "webview", webview)
    monkeypatch.setattr(server_launch, "_bind", lambda *a: None)  # reuse-if-healthy path
    monkeypatch.setattr(server_launch, "_health_ok", lambda *a, **k: True)
    server_launch._run_desktop("127.0.0.1", 8000)
    assert calls == [
        {
            "private_mode": False,
            "storage_path": str(cfg / "webview"),
        }
    ]
    assert (cfg / "webview").is_dir()


def test_port_fallback_note_says_prefs_follow(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(server_launch, "_bind", lambda *a: None)  # default port busy
    port = server_launch._resolve_port("127.0.0.1", 8000, explicit=False)
    out = capsys.readouterr().out
    assert f"using {port} instead" in out
    assert "prefs file" in out
