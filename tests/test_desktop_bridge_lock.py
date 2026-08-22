"""The PR I2 filesystem lock bridge on `DesktopApi` (P0-3 + P1-1) — thin
js_api adapters over :mod:`quantized.desktop_project_lock`, plus
`write_project_file`'s new `lock_token` binding. Split from
`test_desktop_bridge.py` for the same "cohesive, cheap to find" reason
`test_desktop_project_file.py`/`test_desktop_bridge_dialogs.py` already are.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import pytest

import quantized.desktop_project_lock as lockmod
from quantized.desktop_bridge import DesktopApi
from quantized.desktop_consent import clear_consent
from quantized.desktop_project_lock_write import LockVerified, write_holding_token


class FakeWindow:
    def __init__(self, result: Any) -> None:
        self.result = result

    def create_file_dialog(self, kind: Any, **kw: Any) -> Any:
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


@pytest.fixture(autouse=True)
def _clean() -> None:
    clear_consent()
    yield
    clear_consent()


def _workspace_json(marker: str = "x") -> str:
    return '{"format": "quantized-workspace", "version": 4, "datasets": [{"id": "' + marker + '"}]}'


def _write_consented(tmp_path: Path, name: str = "workspace.dwk") -> tuple[DesktopApi, str]:
    """A `DesktopApi` with `name` write-consented via a real save dialog —
    the same path every lock method requires (see this module's own
    docstring: locking gated behind the identical `consented_write_path`
    check as writing)."""
    dest = tmp_path / name
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    out = api.save_file_dialog(name)
    return api, out["path"]


# -- consent gate -------------------------------------------------------


def test_lock_acquire_refuses_an_unconsented_path(tmp_path: Path) -> None:
    api = DesktopApi()
    out = api.project_lock_acquire(str(tmp_path / "unconsented.dwk"))
    assert out["acquired"] is False
    assert "error" in out


def test_lock_refresh_refuses_an_unconsented_path(tmp_path: Path) -> None:
    api = DesktopApi()
    out = api.project_lock_refresh(str(tmp_path / "unconsented.dwk"), "tok")
    assert out["refreshed"] is False


def test_lock_release_refuses_an_unconsented_path(tmp_path: Path) -> None:
    api = DesktopApi()
    out = api.project_lock_release(str(tmp_path / "unconsented.dwk"), "tok")
    assert out["released"] is False


# -- acquire / exclusivity across instances ----------------------------


def test_acquire_succeeds_for_a_write_consented_path(tmp_path: Path) -> None:
    api, path = _write_consented(tmp_path)
    out = api.project_lock_acquire(path)
    assert out["acquired"] is True
    assert out["record"]["instanceId"] == api._instance_id  # noqa: SLF001


def test_two_desktop_api_instances_are_a_real_second_process_stand_in(tmp_path: Path) -> None:
    """Two SEPARATE `DesktopApi()` instances (each mints its own
    `_instance_id` — see `desktop_bridge.py`'s "PR I2" section) exercising
    the SAME lock path is the in-process stand-in for two separate
    `qz --desktop` processes; `test_desktop_project_lock.py`'s
    multiprocessing test is the real cross-process proof for the primitive
    underneath. Here we prove the BRIDGE wiring (consent gate, instance id
    minting, JSON shape) rejects a genuine second holder."""
    api_a, path = _write_consented(tmp_path)
    dest = Path(path)
    api_b = DesktopApi()
    api_b.attach(FakeWindow([str(dest)]))
    api_b.save_file_dialog(dest.name)  # grant write consent for api_b too

    out_a = api_a.project_lock_acquire(path)
    out_b = api_b.project_lock_acquire(path)

    assert out_a["acquired"] is True
    assert out_b["acquired"] is False
    assert out_b["record"]["instanceId"] == api_a._instance_id  # noqa: SLF001


def test_project_lock_read_reports_the_holder_with_no_side_effect(tmp_path: Path) -> None:
    api, path = _write_consented(tmp_path)
    api.project_lock_acquire(path)
    out = api.project_lock_read(path)
    assert out["acquired"] is None  # read has no outcome of its own
    assert out["record"]["instanceId"] == api._instance_id  # noqa: SLF001
    # A second read changes nothing.
    out2 = api.project_lock_read(path)
    assert out2["record"] == out["record"]


def test_project_lock_read_of_nothing_reports_no_record(tmp_path: Path) -> None:
    api, path = _write_consented(tmp_path)
    out = api.project_lock_read(path)
    assert out["record"] is None


# -- refresh / heartbeat -------------------------------------------------


def test_refresh_succeeds_for_the_holders_own_token(tmp_path: Path) -> None:
    api, path = _write_consented(tmp_path)
    acquired = api.project_lock_acquire(path)
    token = acquired["record"]["token"]
    out = api.project_lock_refresh(path, token)
    assert out["refreshed"] is True
    assert out["record"]["token"] == token


def test_refresh_fails_with_a_wrong_token(tmp_path: Path) -> None:
    api, path = _write_consented(tmp_path)
    api.project_lock_acquire(path)
    out = api.project_lock_refresh(path, "not-the-real-token")
    assert out["refreshed"] is False


# -- takeover -------------------------------------------------------------


def test_takeover_refuses_a_stale_token_mismatch(tmp_path: Path) -> None:
    api_a, path = _write_consented(tmp_path)
    api_a.project_lock_acquire(path)
    out = api_a.project_lock_takeover(path, "wrong-token")
    assert out["acquired"] is False


def test_takeover_succeeds_with_the_correct_current_token(tmp_path: Path) -> None:
    api_a, path = _write_consented(tmp_path)
    acquired = api_a.project_lock_acquire(path)
    token = acquired["record"]["token"]
    api_b = DesktopApi()
    api_b.attach(FakeWindow([path]))
    api_b.save_file_dialog(Path(path).name)
    out = api_b.project_lock_takeover(path, token)
    assert out["acquired"] is True
    assert out["record"]["instanceId"] == api_b._instance_id  # noqa: SLF001
    assert out["record"]["token"] != token  # takeover always mints a fresh token


# -- release --------------------------------------------------------------


def test_release_verifies_token(tmp_path: Path) -> None:
    api, path = _write_consented(tmp_path)
    acquired = api.project_lock_acquire(path)
    token = acquired["record"]["token"]
    bad = api.project_lock_release(path, "wrong-token")
    assert bad["released"] is False
    good = api.project_lock_release(path, token)
    assert good["released"] is True


# -- corrupt lock file -> unverifiable, never an exception ---------------


def test_acquire_against_a_corrupt_lock_file_reports_unverifiable(tmp_path: Path) -> None:
    api, path = _write_consented(tmp_path)
    Path(path + ".lock").write_text("not json at all", encoding="utf-8")
    out = api.project_lock_acquire(path)
    assert out["acquired"] is False
    assert out.get("unverifiable") is True


# -- write_project_file lock-token binding (closes the save TOCTOU) ------


def test_write_project_file_with_empty_token_is_unaffected_by_a_lock(tmp_path: Path) -> None:
    """The pre-I2 behavior — an empty token skips the check entirely, so a
    caller that never wired the lock (or the browser/in-memory-only path)
    writes exactly as before, even while a DIFFERENT instance holds the
    lock. (The frontend's own `runSaveWorkspace` is what actually gates
    this by always passing a token when it holds one — this is the
    backend's honest "no token supplied = no verification" contract.)"""
    api_a, path = _write_consented(tmp_path)
    api_a.project_lock_acquire(path)
    api_b = DesktopApi()
    api_b.attach(FakeWindow([path]))
    api_b.save_file_dialog(Path(path).name)
    out = api_b.write_project_file(path, _workspace_json("from-b"))
    assert out["ok"] is True


def test_write_project_file_refuses_when_the_lock_token_is_stale(tmp_path: Path) -> None:
    """RED-FIRST evidence for the save-TOCTOU fix: instance A acquires the
    lock, instance B takes it over (a legitimate stale takeover), and A's
    OLD token must now be refused at WRITE time with a distinct "lock lost"
    error — not a generic write failure, and the file on disk must stay
    byte-identical to what B most recently wrote (never silently
    overwritten by A's stale save)."""
    api_a, path = _write_consented(tmp_path)
    acquired_a = api_a.project_lock_acquire(path)
    token_a = acquired_a["record"]["token"]

    api_b = DesktopApi()
    api_b.attach(FakeWindow([path]))
    api_b.save_file_dialog(Path(path).name)
    api_b.project_lock_takeover(path, token_a)
    good_write = api_b.write_project_file(path, _workspace_json("from-b"))
    assert good_write["ok"] is True

    stale_write = api_a.write_project_file(
        path, _workspace_json("from-a-stale"), lock_token=token_a
    )
    assert stale_write["ok"] is False
    assert stale_write["error"] == "lock lost"
    assert Path(path).read_text(encoding="utf-8") == _workspace_json("from-b")


def test_write_project_file_succeeds_with_the_current_lock_token(tmp_path: Path) -> None:
    api, path = _write_consented(tmp_path)
    acquired = api.project_lock_acquire(path)
    token = acquired["record"]["token"]
    out = api.write_project_file(path, _workspace_json("ok"), lock_token=token)
    assert out["ok"] is True
    assert Path(path).read_text(encoding="utf-8") == _workspace_json("ok")


def test_write_project_file_with_a_non_empty_token_refuses_when_no_lock_file_exists(
    tmp_path: Path,
) -> None:
    """R1 fix (defect (b)): an ABSENT lock file with a NON-EMPTY supplied
    token is now refused, not waved through. The old contract ("nothing to
    check against, proceed") let a caller whose lock had been released or
    replaced elsewhere claim ownership was still verified when it was not
    verifiable at all. `write_project_file` must never touch the file in
    that case."""
    api, path = _write_consented(tmp_path)
    original = _workspace_json("pre-existing")
    Path(path).write_text(original, encoding="utf-8")
    out = api.write_project_file(path, _workspace_json("x"), lock_token="some-token-never-acquired")
    assert out["ok"] is False
    assert out["error"] == "lock lost"
    assert Path(path).read_text(encoding="utf-8") == original


def test_write_project_file_with_an_empty_token_still_writes_when_no_lock_file_exists(
    tmp_path: Path,
) -> None:
    """The legacy no-lock path (empty token) is UNCHANGED by the R1 fix —
    it never verifies anything, lock file present or not."""
    api, path = _write_consented(tmp_path)
    out = api.write_project_file(path, _workspace_json("x"))
    assert out["ok"] is True
    assert Path(path).read_text(encoding="utf-8") == _workspace_json("x")


# -- CONTENDED soft success (R1 code-review follow-up) -----------------------


def _hold_the_lock_in_a_thread(
    path: str, token: str, started: threading.Event, release: threading.Event
) -> threading.Thread:
    def _slow_write() -> None:
        started.set()
        release.wait(timeout=10.0)

    def _run() -> None:
        result = write_holding_token(path, token, _slow_write)
        assert isinstance(result, LockVerified)

    t = threading.Thread(target=_run)
    t.start()
    assert started.wait(timeout=2.0), "writer thread never acquired the lock"
    return t


def test_project_lock_refresh_maps_contended_to_a_non_demoting_soft_success(
    tmp_path: Path,
) -> None:
    """RED-FIRST, end-to-end: a REAL second thread holds the exclusive OS
    lock (via `write_holding_token`, the actual save path) for the whole
    duration of `project_lock_refresh`'s own bounded acquire retry. The
    bridge must report `refreshed: True` (never a demotion-worthy
    `False`) carrying the LAST record this same `DesktopApi` genuinely
    observed (from its own prior `project_lock_acquire`) — proving the
    frontend's `record.token` for its NEXT save is never nulled out by a
    merely-busy heartbeat tick (see `desktop_bridge.py`'s "CONTENDED soft
    success" doc section for why a null record there would silently
    defeat the R1 lock-held write for the very next save)."""
    api, path = _write_consented(tmp_path)
    acquired = api.project_lock_acquire(path)
    assert acquired["acquired"] is True
    token = acquired["record"]["token"]

    started = threading.Event()
    release = threading.Event()
    writer = _hold_the_lock_in_a_thread(path, token, started, release)
    try:
        out = api.project_lock_refresh(path, token)
    finally:
        release.set()
        writer.join(timeout=10.0)

    assert out["refreshed"] is True
    assert out.get("contended") is True
    assert "unverifiable" not in out
    assert out["record"] is not None
    assert out["record"]["token"] == token  # echoed from the cache, never null/fabricated


def test_project_lock_refresh_with_no_cached_record_falls_back_to_honest_refusal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Guardrail on the soft-success mapping: without a previously
    observed record to echo, the bridge must NOT fabricate a success —
    it falls through to the same conservative `unverifiable: true`
    refusal every other `Contended` case gets."""
    api, path = _write_consented(tmp_path)

    def _contended(*_a: object, **_kw: object) -> tuple[bool, lockmod.Contended]:
        return False, lockmod.Contended("simulated")

    monkeypatch.setattr(lockmod, "refresh", _contended)
    out = api.project_lock_refresh(path, "some-token")
    assert out["refreshed"] is False
    assert out.get("unverifiable") is True
    assert out["record"] is None


def test_project_lock_read_maps_contended_to_unverifiable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`project_lock_read` is one of the "every other unprotected read
    caller" sites the R1 follow-up ruling names — a busy lock is reported
    the same conservative way an unverifiable one already is (the
    frontend already treats that as "cannot verify — read-only")."""
    api, path = _write_consented(tmp_path)

    def _contended(_path: str) -> lockmod.Contended:
        return lockmod.Contended("simulated")

    monkeypatch.setattr(lockmod, "read", _contended)
    out = api.project_lock_read(path)
    assert out["record"] is None
    assert out.get("unverifiable") is True


def test_project_lock_acquire_maps_contended_to_unverifiable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A one-shot acquire attempt that finds the lock merely busy reports
    the same conservative `unverifiable: true` refusal — unlike `refresh`,
    a one-shot user action has no recurring-heartbeat demotion hazard to
    soften, so an honest "busy, try again" is correct here."""
    api, path = _write_consented(tmp_path)

    def _contended(*_a: object, **_kw: object) -> tuple[bool, lockmod.Contended]:
        return False, lockmod.Contended("simulated")

    monkeypatch.setattr(lockmod, "acquire", _contended)
    out = api.project_lock_acquire(path)
    assert out["acquired"] is False
    assert out.get("unverifiable") is True
