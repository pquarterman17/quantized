"""Desktop file-dialog bridge (MAIN_PLAN #31).

The dialog calls themselves need a real pywebview window, so they are exercised
through a fake window rather than mocked away entirely — the logic worth testing
is what the bridge does with what a dialog RETURNS (consent, normalization,
cancellation) and how it classifies a path's status.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest

from quantized.desktop_bridge import DesktopApi
from quantized.desktop_consent import clear_consent, is_consented


class FakeWindow:
    """Stands in for a pywebview window. `result` is what the dialog returns."""

    def __init__(self, result: Any) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    def create_file_dialog(self, kind: Any, **kw: Any) -> Any:
        self.calls.append({"kind": kind, **kw})
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


@pytest.fixture(autouse=True)
def _clean() -> None:
    clear_consent()
    yield
    clear_consent()


def _csv(tmp_path: Path, name: str = "run.csv") -> Path:
    p = tmp_path / name
    p.write_text("T,M\n1,10\n", encoding="utf-8")
    return p


# --- probe -----------------------------------------------------------------


def test_probe_reports_no_capability_before_a_window_attaches() -> None:
    """The frontend must not assume a capability just because pywebview is
    present — the dialogs live on the window, which arrives later."""
    api = DesktopApi()
    assert api.probe()["canPickFiles"] is False


def test_probe_reports_capability_once_attached() -> None:
    api = DesktopApi()
    api.attach(FakeWindow([]))
    probe = api.probe()
    assert probe["canPickFiles"] is True
    assert probe["shell"] == "pywebview"


# --- pick_files ------------------------------------------------------------


def test_pick_files_consents_and_normalizes(tmp_path: Path) -> None:
    f = _csv(tmp_path)
    api = DesktopApi()
    api.attach(FakeWindow([str(f)]))
    out = api.pick_files()
    assert out["paths"] == [os.path.realpath(str(f))]
    assert is_consented(os.path.realpath(str(f)))


def test_pick_files_treats_cancel_as_an_empty_result_not_an_error() -> None:
    """Backing out of a dialog is a normal outcome; surfacing it as a failure
    would put an error toast in front of a user who did nothing wrong."""
    api = DesktopApi()
    api.attach(FakeWindow(None))
    out = api.pick_files()
    assert out["paths"] == []
    assert "error" not in out


def test_pick_files_without_a_window_reports_rather_than_raises() -> None:
    # Anything callable from the page must never raise into JS.
    assert DesktopApi().pick_files()["paths"] == []


def test_pick_files_reports_a_dialog_failure(tmp_path: Path) -> None:
    api = DesktopApi()
    api.attach(FakeWindow(RuntimeError("no display")))
    out = api.pick_files()
    assert out["paths"] == []
    assert "no display" in out["error"]


def test_pick_files_grants_nothing_for_a_path_that_is_not_a_file(tmp_path: Path) -> None:
    api = DesktopApi()
    api.attach(FakeWindow([str(tmp_path)]))  # a directory
    assert api.pick_files()["paths"] == []


# --- pick_directory --------------------------------------------------------


def test_pick_directory_returns_a_normalized_path(tmp_path: Path) -> None:
    api = DesktopApi()
    api.attach(FakeWindow([str(tmp_path)]))
    assert api.pick_directory()["path"] == os.path.realpath(str(tmp_path))


def test_pick_directory_grants_no_read_consent(tmp_path: Path) -> None:
    """Consent is per FILE. A folder choice must not hand over its contents."""
    f = _csv(tmp_path)
    api = DesktopApi()
    api.attach(FakeWindow([str(tmp_path)]))
    api.pick_directory()
    assert not is_consented(os.path.realpath(str(f)))


def test_pick_directory_cancel_returns_none() -> None:
    api = DesktopApi()
    api.attach(FakeWindow(None))
    assert api.pick_directory()["path"] is None


# --- path_status: the offline-vs-missing distinction -----------------------


def test_path_status_ok_for_an_existing_file(tmp_path: Path) -> None:
    assert DesktopApi().path_status(str(_csv(tmp_path)))["state"] == "ok"


def test_path_status_missing_when_the_root_is_reachable(tmp_path: Path) -> None:
    """The file is genuinely gone: its drive/root is right there."""
    assert DesktopApi().path_status(str(tmp_path / "nope.csv"))["state"] == "missing"


def test_path_status_offline_when_the_root_is_unreachable() -> None:
    """A vanished share must NOT be reported as a deleted file — that is how an
    app talks a user into discarding a source that is fine and will be back.

    The UNC prefix is assembled from ``chr(92)`` rather than written as a
    literal: this test was briefly WRONG because a quoting layer ate one
    backslash, leaving a single-backslash string. That is a rooted LOCAL path,
    whose anchor is a real drive, so the test asserted "offline" against a case
    that is legitimately "missing" and blamed the implementation for it.
    """
    b = chr(92)
    unc = b + b + "no-such-server" + b + "share" + b + "run.dat"
    unreachable = unc if os.name == "nt" else "/mnt/no-such-server/share/run.dat"
    assert DesktopApi().path_status(unreachable)["state"] == "offline"


def test_path_status_distinguishes_a_local_miss_from_an_offline_root(
    tmp_path: Path,
) -> None:
    """The two states must not collapse into one — that distinction IS the
    sub-item. A gone file on a live drive is 'missing'; an unreachable root is
    'offline', and only the first justifies suggesting the source is gone."""
    local_miss = DesktopApi().path_status(str(tmp_path / "gone.csv"))["state"]
    b = chr(92)
    unc = b + b + "no-such-server" + b + "share" + b + "run.dat"
    remote = unc if os.name == "nt" else "/mnt/no-such-server/share/run.dat"
    remote_state = DesktopApi().path_status(remote)["state"]
    assert local_miss == "missing"
    assert remote_state == "offline"
    assert local_miss != remote_state
