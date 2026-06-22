"""Unit tests for the ``qz`` launcher (uvicorn + browser are mocked)."""

from __future__ import annotations

from unittest.mock import patch

from quantized import cli


def test_passes_host_port_to_uvicorn() -> None:
    with (
        patch("quantized.cli.uvicorn.run") as run,
        patch("quantized.cli.threading.Timer"),
    ):
        cli.main(["--port", "9001", "--host", "0.0.0.0"])
    run.assert_called_once()
    kwargs = run.call_args.kwargs
    assert kwargs["host"] == "0.0.0.0"
    assert kwargs["port"] == 9001


def test_no_browser_skips_timer() -> None:
    with (
        patch("quantized.cli.uvicorn.run"),
        patch("quantized.cli.threading.Timer") as timer,
    ):
        cli.main(["--no-browser"])
    timer.assert_not_called()


def test_default_schedules_browser_open() -> None:
    with (
        patch("quantized.cli.uvicorn.run"),
        patch("quantized.cli.webbrowser.open") as wb,
        patch("quantized.cli.threading.Timer") as timer,
    ):
        cli.main([])
        # The timer is scheduled; invoke its callback to confirm it opens a tab.
        timer.assert_called_once()
        callback = timer.call_args.args[1]
        callback()
    wb.assert_called_once_with("http://127.0.0.1:8000")
