"""P1.7 "Pack Project" PR 4 — the pywebview bridge (``DesktopPackBridge``)
orchestrating PR 1-3's pure pipeline. Same FakeWindow pattern as
``test_desktop_bridge.py``: the dialog itself is faked, everything it does
with what the dialog returns (consent, staging, publish, revocation) is
exercised for real against real tmp files.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

import pytest

import quantized.desktop_bridge_pack as pack_bridge_module
from quantized.desktop_bridge import DesktopApi
from quantized.desktop_consent import (
    clear_consent,
    consent_count,
    is_consented,
    set_declared_sources,
    write_dir_grant_count,
)
from quantized.portable.copy_stream import StageProgress
from quantized.portable.pack import PackResult
from quantized.portable.publish import validate_bundle


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
    p.write_text("T,M\n1,10\n2,20\n", encoding="utf-8")
    return p


def _workspace_json(*source_paths: str) -> str:
    return json.dumps(
        {
            "format": "quantized-workspace",
            "version": 4,
            "datasets": [
                {"id": f"d{i}", "name": f"d{i}", "source": {"kind": "path", "path": p}}
                for i, p in enumerate(source_paths)
            ],
        }
    )


def _declare_and_content(tmp_path: Path, *names: str) -> tuple[str, list[Path]]:
    """Create `names` as real csv files, declare them as this "project"'s
    own sources (the eligibility a real project-open would provide — see
    `desktop_bridge_pack.py`'s `_eligible`), and return the workspace JSON
    content plus the created file paths."""
    files = [_csv(tmp_path, n) for n in names]
    set_declared_sources([str(f) for f in files])
    return _workspace_json(*[str(f) for f in files]), files


def _dest(api: DesktopApi, tmp_path: Path) -> str:
    dest_root = tmp_path / "dest"
    dest_root.mkdir()
    api.attach(FakeWindow([str(dest_root)]))
    out = api.pick_pack_destination()
    assert out["path"] is not None
    return str(out["path"])


def _wait_for_terminal(api: DesktopApi, timeout: float = 5.0) -> dict[str, Any]:
    deadline = time.time() + timeout
    status = api.pack_status()
    while status["phase"] in ("packing", "cancelling") and time.time() < deadline:
        time.sleep(0.01)
        status = api.pack_status()
    return status


# -- pick_pack_destination ----------------------------------------------


def test_pick_pack_destination_mints_a_write_dir_grant(tmp_path: Path) -> None:
    api = DesktopApi()
    dest = tmp_path / "dest"
    dest.mkdir()
    api.attach(FakeWindow([str(dest)]))
    out = api.pick_pack_destination()
    assert out["path"] == os.path.realpath(str(dest))
    assert write_dir_grant_count() == 1


def test_pick_pack_destination_cancel_returns_none(tmp_path: Path) -> None:
    api = DesktopApi()
    api.attach(FakeWindow(None))
    out = api.pick_pack_destination()
    assert out["path"] is None
    assert "error" not in out
    assert write_dir_grant_count() == 0


def test_pick_pack_destination_clears_a_prior_grant_never_accumulates(tmp_path: Path) -> None:
    api = DesktopApi()
    first = tmp_path / "first"
    first.mkdir()
    api.attach(FakeWindow([str(first)]))
    api.pick_pack_destination()
    second = tmp_path / "second"
    second.mkdir()
    api.attach(FakeWindow([str(second)]))
    api.pick_pack_destination()
    assert write_dir_grant_count() == 1


def test_pick_pack_destination_refuses_a_file(tmp_path: Path) -> None:
    api = DesktopApi()
    f = _csv(tmp_path)
    api.attach(FakeWindow([str(f)]))
    out = api.pick_pack_destination()
    assert out["path"] is None
    assert "error" in out
    assert write_dir_grant_count() == 0


# -- pack_preview ----------------------------------------------------------


def test_pack_preview_without_the_destination_grant_is_refused(tmp_path: Path) -> None:
    api = DesktopApi()
    content, _ = _declare_and_content(tmp_path, "a.csv")
    out = api.pack_preview(content, "myproj", str(tmp_path / "dest"))
    assert out["ok"] is False
    assert out["error"]["code"] == "destination_not_consented"


def test_pack_preview_rejects_unparseable_content(tmp_path: Path) -> None:
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    out = api.pack_preview("not json", "myproj", destination_parent)
    assert out["ok"] is False
    assert out["error"]["code"] == "invalid_project"


def test_pack_preview_stores_a_token_and_reports_packable_sources(tmp_path: Path) -> None:
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    content, files = _declare_and_content(tmp_path, "a.csv")
    out = api.pack_preview(content, "myproj", destination_parent)
    assert out["ok"] is True
    assert isinstance(out["token"], str) and len(out["token"]) == 32
    assert out["manifest"]["summary"]["packable"] == 1
    assert out["blockers"] == []
    assert out["destination"]["bundle_dir"] == os.path.join(destination_parent, "myproj")
    assert out["destination"]["exists"] is False


def test_pack_preview_reports_blockers_for_undeclared_sources(tmp_path: Path) -> None:
    """A source this "project" never declared (not consented, not dir-
    granted, not declared) must be reported as blocked, never packed."""
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    stray = _csv(tmp_path, "stray.csv")
    content = _workspace_json(str(stray))
    out = api.pack_preview(content, "myproj", destination_parent)
    assert out["ok"] is True
    assert out["manifest"]["summary"]["packable"] == 0
    assert len(out["blockers"]) == 1
    assert out["blockers"][0]["status"] == "not_consented"


def test_pack_preview_invalid_project_name(tmp_path: Path) -> None:
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    content, _ = _declare_and_content(tmp_path, "a.csv")
    out = api.pack_preview(content, "../evil", destination_parent)
    assert out["ok"] is False
    assert out["error"]["code"] == "invalid_project_name"


# -- pack_start: synchronous rejections ------------------------------------


def test_pack_start_rejects_a_wrong_token(tmp_path: Path) -> None:
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    content, _ = _declare_and_content(tmp_path, "a.csv")
    api.pack_preview(content, "myproj", destination_parent)
    out = api.pack_start("not-the-real-token", content)
    assert out["ok"] is False
    assert out["error"]["code"] == "stale_preview"


def test_pack_start_rejects_changed_content(tmp_path: Path) -> None:
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    content, _ = _declare_and_content(tmp_path, "a.csv")
    preview = api.pack_preview(content, "myproj", destination_parent)
    changed = _workspace_json()  # a different (empty-dataset) payload
    out = api.pack_start(preview["token"], changed)
    assert out["ok"] is False
    assert out["error"]["code"] == "stale_preview"


def test_pack_start_rejects_an_existing_destination(tmp_path: Path) -> None:
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    content, _ = _declare_and_content(tmp_path, "a.csv")
    preview = api.pack_preview(content, "myproj", destination_parent)
    os.makedirs(os.path.join(destination_parent, "myproj"))
    out = api.pack_start(preview["token"], content)
    assert out["ok"] is False
    assert out["error"]["code"] == "destination_exists"


def test_pack_start_with_no_preview_is_stale(tmp_path: Path) -> None:
    api = DesktopApi()
    content, _ = _declare_and_content(tmp_path, "a.csv")
    out = api.pack_start("anything", content)
    assert out["ok"] is False
    assert out["error"]["code"] == "stale_preview"


def test_two_starts_report_already_running(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    content, _ = _declare_and_content(tmp_path, "a.csv")
    preview = api.pack_preview(content, "myproj", destination_parent)

    release = threading.Event()

    def _slow_pack_project(*_args: Any, should_cancel: Any = None, **_kw: Any) -> PackResult:
        release.wait(timeout=5.0)
        return PackResult(True, False, None, {"sources": []}, [], None, False)

    monkeypatch.setattr(pack_bridge_module, "pack_project", _slow_pack_project)
    try:
        first = api.pack_start(preview["token"], content)
        assert first["ok"] is True
        second = api.pack_start(preview["token"], content)
        assert second["ok"] is False
        assert second["error"]["code"] == "already_running"
    finally:
        release.set()
        _wait_for_terminal(api)


# -- a real pack, end to end -------------------------------------------------


def test_real_pack_completes_and_revokes_its_own_grants(tmp_path: Path) -> None:
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    content, files = _declare_and_content(tmp_path, "a.csv", "b.csv")
    baseline_consent = consent_count()
    preview = api.pack_preview(content, "myproj", destination_parent)
    assert preview["manifest"]["summary"]["packable"] == 2

    resolved = [os.path.realpath(str(f)) for f in files]
    assert not any(is_consented(r) for r in resolved)  # declared, not yet granted

    out = api.pack_start(preview["token"], content)
    assert out["ok"] is True

    status = _wait_for_terminal(api)
    assert status["phase"] == "completed"
    assert status["result"] is not None
    bundle_dir = status["result"]["bundle_dir"]
    assert bundle_dir == os.path.join(destination_parent, "myproj")

    check = validate_bundle(bundle_dir, verify_checksums=True)
    assert check.complete, check.problems

    # The operation's own minted read grants -- and the write-dir grant --
    # are gone once it ends; nothing this test didn't itself set up remains.
    assert not any(is_consented(r) for r in resolved)
    assert consent_count() == baseline_consent
    assert write_dir_grant_count() == 0
    assert status["progress"]["stage"] is None
    assert status["progress"]["completed_files"] == status["progress"]["total_files"]
    assert status["cleanup_ok"] is None
    assert status["originals_modified"] is False


def test_real_pack_with_nothing_packable_still_completes(tmp_path: Path) -> None:
    """An all-blocked project (nothing eligible) still produces a valid,
    empty bundle -- `pack_project` itself has no "nothing to do" special
    case, and neither should this bridge."""
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    content = _workspace_json()  # no datasets at all
    preview = api.pack_preview(content, "myproj", destination_parent)
    out = api.pack_start(preview["token"], content)
    assert out["ok"] is True
    status = _wait_for_terminal(api)
    assert status["phase"] == "completed"


# -- cancellation -------------------------------------------------------


def test_cancel_mid_copy_reaches_cancelled_with_cleanup_ok(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    content, _ = _declare_and_content(tmp_path, "a.csv")
    preview = api.pack_preview(content, "myproj", destination_parent)

    started = threading.Event()

    def _cancellable_pack_project(*_args: Any, should_cancel: Any, **_kw: Any) -> PackResult:
        started.set()
        while not should_cancel():
            time.sleep(0.01)
        return PackResult(False, True, None, {"sources": []}, [], True, False)

    monkeypatch.setattr(pack_bridge_module, "pack_project", _cancellable_pack_project)
    out = api.pack_start(preview["token"], content)
    assert out["ok"] is True
    assert started.wait(timeout=5.0)

    cancel_out = api.pack_cancel()
    assert cancel_out["ok"] is True
    assert cancel_out["phase"] == "cancelling"

    status = _wait_for_terminal(api)
    assert status["phase"] == "cancelled"
    assert status["cleanup_ok"] is True


def test_pack_cancel_is_idempotent_before_during_after(tmp_path: Path) -> None:
    api = DesktopApi()
    # Before any operation: a no-op returning "idle".
    out = api.pack_cancel()
    assert out == {"ok": True, "phase": "idle"}
    # Calling it again changes nothing.
    assert api.pack_cancel() == {"ok": True, "phase": "idle"}


def test_pack_cancel_after_completion_is_a_no_op(tmp_path: Path) -> None:
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    content = _workspace_json()
    preview = api.pack_preview(content, "myproj", destination_parent)
    api.pack_start(preview["token"], content)
    status = _wait_for_terminal(api)
    assert status["phase"] == "completed"
    out = api.pack_cancel()
    assert out == {"ok": True, "phase": "completed"}


# -- thrown exception inside the worker thread -----------------------------


def test_a_thrown_exception_is_reported_as_failed_without_a_raw_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    content, _ = _declare_and_content(tmp_path, "a.csv")
    preview = api.pack_preview(content, "myproj", destination_parent)

    secret_path = str(tmp_path / "a.csv")

    def _boom(*_args: Any, **_kw: Any) -> PackResult:
        raise RuntimeError(f"boom at {secret_path}")

    monkeypatch.setattr(pack_bridge_module, "pack_project", _boom)
    out = api.pack_start(preview["token"], content)
    assert out["ok"] is True

    status = _wait_for_terminal(api)
    assert status["phase"] == "failed"
    assert len(status["errors"]) == 1
    error = status["errors"][0]
    assert secret_path not in error["message"]
    assert error["originals_modified"] is False
    assert "No original files or project were modified." == error["note"]


# -- pack_status progress -------------------------------------------------


def test_pack_status_progress_is_monotonic_across_synthetic_ticks(tmp_path: Path) -> None:
    api = DesktopApi()
    tick1 = StageProgress(
        phase="copying",
        source_id="s001",
        bundle_path="sources/a.csv",
        file_index=1,
        file_count=2,
        file_bytes_done=10,
        file_bytes_total=100,
        bytes_done=10,
        bytes_total=200,
    )
    with api._pack_lock:
        api._apply_progress_tick(tick1)
    first = api.pack_status()["progress"]

    tick2 = StageProgress(
        phase="verifying",
        source_id="s001",
        bundle_path="sources/a.csv",
        file_index=1,
        file_count=2,
        file_bytes_done=100,
        file_bytes_total=100,
        bytes_done=100,
        bytes_total=200,
    )
    with api._pack_lock:
        api._apply_progress_tick(tick2)
    second = api.pack_status()["progress"]

    assert second["bytes_copied"] >= first["bytes_copied"]
    assert second["completed_files"] >= first["completed_files"]


def test_pack_status_infers_publishing_on_the_last_files_verifying_tick(tmp_path: Path) -> None:
    api = DesktopApi()
    tick = StageProgress(
        phase="verifying",
        source_id="s002",
        bundle_path="sources/b.csv",
        file_index=2,
        file_count=2,
        file_bytes_done=50,
        file_bytes_total=50,
        bytes_done=150,
        bytes_total=150,
    )
    with api._pack_lock:
        api._apply_progress_tick(tick)
    progress = api.pack_status()["progress"]
    assert progress["stage"] == "publishing"
    assert progress["completed_files"] == 2
    assert progress["current_file"] is None


# -- pack_reset -------------------------------------------------------------


def test_pack_reset_rejected_while_packing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    content, _ = _declare_and_content(tmp_path, "a.csv")
    preview = api.pack_preview(content, "myproj", destination_parent)

    release = threading.Event()

    def _slow_pack_project(*_args: Any, **_kw: Any) -> PackResult:
        release.wait(timeout=5.0)
        return PackResult(True, False, None, {"sources": []}, [], None, False)

    monkeypatch.setattr(pack_bridge_module, "pack_project", _slow_pack_project)
    try:
        api.pack_start(preview["token"], content)
        out = api.pack_reset()
        assert out["ok"] is False
        assert out["error"]["code"] == "already_running"
    finally:
        release.set()
        _wait_for_terminal(api)


def test_pack_reset_allowed_after_completion(tmp_path: Path) -> None:
    api = DesktopApi()
    destination_parent = _dest(api, tmp_path)
    content = _workspace_json()
    preview = api.pack_preview(content, "myproj", destination_parent)
    api.pack_start(preview["token"], content)
    _wait_for_terminal(api)
    out = api.pack_reset()
    assert out == {"ok": True}
    status = api.pack_status()
    assert status["phase"] == "idle"
    assert status["result"] is None
    assert status["errors"] == []
