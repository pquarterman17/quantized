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
