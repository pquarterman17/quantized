"""Unit tests for the ``qz`` launcher (uvicorn + browser are mocked)."""

from __future__ import annotations

import os
from collections.abc import Iterator
from unittest.mock import patch

import pytest

from quantized import cli


@pytest.fixture(autouse=True)
def _isolate_auto_shutdown() -> Iterator[None]:
    """The default browser mode arms QZ_AUTO_SHUTDOWN in os.environ — start
    each test with the var absent and never leak it to other tests (app.py
    reads it at import time; a leak would auto-kill unrelated test servers)."""
    prior = os.environ.pop("QZ_AUTO_SHUTDOWN", None)
    yield
    os.environ.pop("QZ_AUTO_SHUTDOWN", None)
    if prior is not None:
        os.environ["QZ_AUTO_SHUTDOWN"] = prior


@pytest.fixture(autouse=True)
def _stub_resolve_port() -> Iterator[None]:
    """Pass the requested port through unchanged, as if it were always free.

    Keeps every test in this file deterministic regardless of what's
    actually listening on the machine (the real qz server is often running
    on 8000 locally — see MAIN_PLAN #22). The dedicated port-fallback wiring
    test below re-patches ``cli._resolve_port`` to exercise the fallback
    path explicitly; the real bind-probe behavior itself is covered in
    test_server_launch.py."""
    with patch("quantized.cli._resolve_port", side_effect=lambda host, port, *, explicit: port):
        yield


def test_passes_host_port_to_uvicorn() -> None:
    with (
        patch("quantized.cli.uvicorn.run") as run,
        patch("quantized.cli._open_when_healthy"),
    ):
        cli.main(["--port", "9001", "--host", "0.0.0.0"])
    run.assert_called_once()
    kwargs = run.call_args.kwargs
    assert kwargs["host"] == "0.0.0.0"
    assert kwargs["port"] == 9001


def test_no_browser_skips_open_and_never_arms_shutdown() -> None:
    with (
        patch("quantized.cli.uvicorn.run"),
        patch("quantized.cli._open_when_healthy") as opener,
    ):
        cli.main(["--no-browser"])
    opener.assert_not_called()
    assert "QZ_AUTO_SHUTDOWN" not in os.environ


def test_default_opens_when_healthy_and_arms_shutdown() -> None:
    with (
        patch("quantized.cli.uvicorn.run"),
        patch("quantized.cli._open_when_healthy") as opener,
    ):
        cli.main([])
    opener.assert_called_once_with("http://127.0.0.1:8000", "127.0.0.1", 8000)
    assert os.environ.get("QZ_AUTO_SHUTDOWN") == "1"


def test_explicit_shutdown_opt_out_wins() -> None:
    os.environ["QZ_AUTO_SHUTDOWN"] = "0"
    with (
        patch("quantized.cli.uvicorn.run"),
        patch("quantized.cli._open_when_healthy"),
    ):
        cli.main([])
    assert os.environ["QZ_AUTO_SHUTDOWN"] == "0"


def test_dev_dispatches_to_run_dev() -> None:
    with (
        patch("quantized.cli._run_dev") as run_dev,
        patch("quantized.cli.uvicorn.run") as run,
    ):
        cli.main(["--dev", "--port", "9001"])
    run_dev.assert_called_once_with("127.0.0.1", 9001)
    run.assert_not_called()
    assert "QZ_AUTO_SHUTDOWN" not in os.environ


def test_desktop_dispatches_to_run_desktop() -> None:
    with (
        patch("quantized.cli._run_desktop") as run_desktop,
        patch("quantized.cli.uvicorn.run") as run,
    ):
        cli.main(["--desktop"])
    run_desktop.assert_called_once_with("127.0.0.1", 8000)
    run.assert_not_called()
    assert "QZ_AUTO_SHUTDOWN" not in os.environ


def test_dev_and_desktop_are_mutually_exclusive() -> None:
    with pytest.raises(SystemExit) as exc:
        cli.main(["--dev", "--desktop"])
    assert exc.value.code == 2


# ── --calc (standalone DiraCulator launcher, MAIN_PLAN #22) ─────────────────


def test_calc_opens_view_calc_url() -> None:
    with (
        patch("quantized.cli.uvicorn.run"),
        patch("quantized.cli._open_when_healthy") as opener,
    ):
        cli.main(["--calc"])
    opener.assert_called_once_with("http://127.0.0.1:8000/?view=calc", "127.0.0.1", 8000)


def test_calc_composes_with_desktop() -> None:
    with (
        patch("quantized.cli._run_desktop") as run_desktop,
        patch("quantized.cli.uvicorn.run") as run,
    ):
        cli.main(["--calc", "--desktop"])
    run_desktop.assert_called_once_with(
        "127.0.0.1", 8000, title="DiraCulator", width=520, height=680, path="/?view=calc"
    )
    run.assert_not_called()


def test_plain_desktop_keeps_default_title_and_geometry() -> None:
    with (
        patch("quantized.cli._run_desktop") as run_desktop,
        patch("quantized.cli.uvicorn.run"),
    ):
        cli.main(["--desktop"])
    # No --calc: the plain desktop call keeps its existing 2-positional-arg
    # signature (default title/geometry/path) — no DiraCulator kwargs leak in.
    run_desktop.assert_called_once_with("127.0.0.1", 8000)


def test_main_calc_injects_calc_flag() -> None:
    with patch("quantized.cli.main") as main:
        cli.main_calc(["--desktop"])
    main.assert_called_once_with(["--calc", "--desktop"])


def test_main_calc_defaults_to_serving() -> None:
    with (
        patch("quantized.cli.uvicorn.run"),
        patch("quantized.cli._open_when_healthy") as opener,
    ):
        cli.main_calc([])
    opener.assert_called_once_with("http://127.0.0.1:8000/?view=calc", "127.0.0.1", 8000)


# ── port fallback (MAIN_PLAN #22) ────────────────────────────────────────────


def test_default_port_falls_back_when_busy() -> None:
    """No --port given + the requested (default) port is busy: qz picks a
    free ephemeral port instead of erroring, per _resolve_port's contract.
    This test overrides the file's autouse identity stub to exercise the
    fallback branch through cli.main's wiring (not the real bind probe —
    that's covered directly in test_server_launch.py)."""
    with (
        patch("quantized.cli._resolve_port", return_value=9999) as resolve,
        patch("quantized.cli.uvicorn.run") as run,
        patch("quantized.cli._open_when_healthy"),
    ):
        cli.main([])
    resolve.assert_called_once_with("127.0.0.1", 8000, explicit=False)
    assert run.call_args.kwargs["port"] == 9999


def test_explicit_port_marks_resolve_as_explicit() -> None:
    with (
        patch("quantized.cli._resolve_port", return_value=9001) as resolve,
        patch("quantized.cli.uvicorn.run"),
        patch("quantized.cli._open_when_healthy"),
    ):
        cli.main(["--port", "9001"])
    resolve.assert_called_once_with("127.0.0.1", 9001, explicit=True)
