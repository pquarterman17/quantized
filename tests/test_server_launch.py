"""Unit tests for the --dev / --desktop launch paths (all subprocess, uvicorn,
pywebview, and network effects are mocked — pywebview is not a CI dependency,
same discipline as the Origin COM extra)."""

from __future__ import annotations

import socket
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from quantized import server_launch

# ── probe helpers ────────────────────────────────────────────────────────────


def test_health_ok_false_when_nothing_listens() -> None:
    # Grab a port the OS considers free, close it, and probe it: connection
    # refused must read as "not healthy", not raise.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    assert server_launch._health_ok("127.0.0.1", port) is False


def test_bind_returns_socket_then_none_when_taken() -> None:
    first = server_launch._bind("127.0.0.1", 0)
    assert first is not None
    port = first.getsockname()[1]
    try:
        assert server_launch._bind("127.0.0.1", port) is None
    finally:
        first.close()


# ── port fallback (MAIN_PLAN #22 — the main app is often already on 8000) ──


def test_resolve_port_returns_free_port_unchanged() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    assert server_launch._resolve_port("127.0.0.1", port, explicit=False) == port


def test_resolve_port_falls_back_when_busy_and_not_explicit(
    capsys: pytest.CaptureFixture[str],
) -> None:
    occupied = server_launch._bind("127.0.0.1", 0)
    assert occupied is not None
    try:
        port = occupied.getsockname()[1]
        fallback = server_launch._resolve_port("127.0.0.1", port, explicit=False)
        assert fallback != port
        # The fallback must itself be bindable (it's a real free port, not
        # just a number that happened to differ).
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as check:
            check.bind(("127.0.0.1", fallback))
        assert f"port {port} is busy" in capsys.readouterr().out
    finally:
        occupied.close()


def test_resolve_port_explicit_busy_port_is_returned_unchanged() -> None:
    """An explicit --port that's busy must NOT fall back — the caller's own
    bind/uvicorn.run raises the usual 'address already in use' error, same
    as before this feature existed."""
    occupied = server_launch._bind("127.0.0.1", 0)
    assert occupied is not None
    try:
        port = occupied.getsockname()[1]
        assert server_launch._resolve_port("127.0.0.1", port, explicit=True) == port
    finally:
        occupied.close()


def test_resolve_port_explicit_skips_bind_probe(monkeypatch: pytest.MonkeyPatch) -> None:
    """explicit=True must not touch a socket at all (cheap, deterministic)."""

    def _boom(*a: object, **k: object) -> None:
        raise AssertionError("_bind should not be called when explicit=True")

    monkeypatch.setattr(server_launch, "_bind", _boom)
    assert server_launch._resolve_port("127.0.0.1", 12345, explicit=True) == 12345


def test_open_when_healthy_opens_once_server_answers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _SyncThread:
        """Run the poll loop inline so the assertion isn't racing a thread."""

        def __init__(self, target: Any = None, daemon: bool = False) -> None:
            self._target = target

        def start(self) -> None:
            self._target()

    monkeypatch.setattr(server_launch.threading, "Thread", _SyncThread)
    monkeypatch.setattr(server_launch, "_health_ok", lambda *a, **k: True)
    with patch("webbrowser.open") as wb:
        server_launch._open_when_healthy("http://x", "127.0.0.1", 8000)
    wb.assert_called_once_with("http://x")


# ── --dev ────────────────────────────────────────────────────────────────────


def test_run_dev_requires_source_checkout(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(server_launch, "_frontend_dir", lambda: tmp_path / "absent")
    with pytest.raises(SystemExit) as exc:
        server_launch._run_dev("127.0.0.1", 8000)
    assert exc.value.code == 2


def test_run_dev_spawns_vite_and_reloading_uvicorn(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(server_launch, "_frontend_dir", lambda: tmp_path)
    vite = MagicMock()
    vite.pid = 4242
    with (
        patch("subprocess.Popen", return_value=vite) as popen,
        patch("subprocess.run") as sprun,
        patch("uvicorn.run") as run,
        patch.object(server_launch, "_open_browser_later"),
    ):
        server_launch._run_dev("127.0.0.1", 9001)
    argv = popen.call_args.args[0]
    assert argv[0].startswith("npm") and argv[1:] == ["run", "dev"]
    assert popen.call_args.kwargs["cwd"] == tmp_path
    # The Vite proxy must learn the backend port (review 2026-07-11).
    assert popen.call_args.kwargs["env"]["QZ_BACKEND_PORT"] == "9001"
    kwargs = run.call_args.kwargs
    assert kwargs == {"host": "127.0.0.1", "port": 9001, "reload": True}
    # Cleanup must reach the PROCESS TREE: on Windows terminate() orphans the
    # node child, so the code taskkills /T; POSIX keeps plain terminate().
    import os as _os

    if _os.name == "nt":
        assert sprun.call_args.args[0][:3] == ["taskkill", "/T", "/F"]
        assert str(vite.pid) in sprun.call_args.args[0]
    else:
        vite.terminate.assert_called_once()
    vite.wait.assert_called_once()


def test_run_dev_stops_vite_when_uvicorn_dies(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(server_launch, "_frontend_dir", lambda: tmp_path)
    vite = MagicMock()
    vite.pid = 4242
    with (
        patch("subprocess.Popen", return_value=vite),
        patch("subprocess.run") as sprun,
        patch("uvicorn.run", side_effect=KeyboardInterrupt),
        patch.object(server_launch, "_open_browser_later"),
        pytest.raises(KeyboardInterrupt),
    ):
        server_launch._run_dev("127.0.0.1", 8000)
    import os as _os

    if _os.name == "nt":
        assert sprun.called  # tree kill still runs on the interrupt path
    else:
        vite.terminate.assert_called_once()
    vite.wait.assert_called_once()


# ── --desktop ────────────────────────────────────────────────────────────────


def test_run_desktop_requires_built_ui(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(server_launch, "_WEB_DIR", tmp_path / "absent")
    server_launch._run_desktop("127.0.0.1", 8000)
    assert "npm run build" in capsys.readouterr().out


def test_run_desktop_hints_when_pywebview_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(server_launch, "_WEB_DIR", tmp_path)  # "built" UI
    # A None entry in sys.modules makes `import webview` raise ImportError —
    # the guard must print the install hint and return without touching the
    # network or starting a server.
    monkeypatch.setitem(sys.modules, "webview", None)
    server_launch._run_desktop("127.0.0.1", 8000)
    assert "quantized[desktop]" in capsys.readouterr().out


def test_run_desktop_refuses_foreign_app_on_port(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(server_launch, "_WEB_DIR", tmp_path)
    monkeypatch.setitem(sys.modules, "webview", MagicMock())
    monkeypatch.setattr(server_launch, "_bind", lambda *a: None)  # port taken
    monkeypatch.setattr(server_launch, "_health_ok", lambda *a, **k: False)  # not ours
    server_launch._run_desktop("127.0.0.1", 8000)
    assert "in use by another app" in capsys.readouterr().out


def test_run_desktop_default_title_and_geometry_unchanged(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Plain `qz --desktop` (no title/width/height/path args) keeps the exact
    window it always has — the DiraCulator kwargs below must not perturb it."""
    monkeypatch.setattr(server_launch, "_WEB_DIR", tmp_path)
    webview = MagicMock()
    monkeypatch.setitem(sys.modules, "webview", webview)
    monkeypatch.setattr(server_launch, "_bind", lambda *a: None)  # reuse-if-healthy path
    monkeypatch.setattr(server_launch, "_health_ok", lambda *a, **k: True)  # our own instance
    server_launch._run_desktop("127.0.0.1", 8000)
    webview.create_window.assert_called_once_with(
        "Quantized",
        "http://127.0.0.1:8000",
        width=1440,
        height=920,
        background_color="#121116",
    )
    webview.start.assert_called_once()


def test_run_desktop_calc_combo_uses_diraculator_title_and_geometry(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """`qz --calc --desktop` (MAIN_PLAN #22): a small window titled
    "DiraCulator" pointed at /?view=calc, not the default 1440x920 window."""
    monkeypatch.setattr(server_launch, "_WEB_DIR", tmp_path)
    webview = MagicMock()
    monkeypatch.setitem(sys.modules, "webview", webview)
    monkeypatch.setattr(server_launch, "_bind", lambda *a: None)  # reuse-if-healthy path
    monkeypatch.setattr(server_launch, "_health_ok", lambda *a, **k: True)  # our own instance
    server_launch._run_desktop(
        "127.0.0.1", 8000, title="DiraCulator", width=520, height=680, path="/?view=calc"
    )
    webview.create_window.assert_called_once_with(
        "DiraCulator",
        "http://127.0.0.1:8000/?view=calc",
        width=520,
        height=680,
        background_color="#121116",
    )
    webview.start.assert_called_once()
