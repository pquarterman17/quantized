"""``POST /api/source-watch/stat`` (gap audit 5 lane J, item 10): stat-only,
confined like ``/api/parsers/import``; hung shares are contained per volume."""

from __future__ import annotations

import errno
import os
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quantized import desktop_consent
from quantized.app import app
from quantized.routes import source_watch
from quantized.routes.source_watch import SourceStat

client = TestClient(app)


def _stat(*paths: str) -> list[dict[str, object]]:
    resp = client.post("/api/source-watch/stat", json={"paths": list(paths)})
    assert resp.status_code == 200, resp.text
    entries: list[dict[str, object]] = resp.json()["entries"]
    return entries


def _drain() -> None:
    """Wait (on state, not a fixed sleep) until every stat thread has finished
    AND released its per-volume slot, then assert it."""
    for _ in range(400):  # blocked stats finish and free their slots
        with source_watch._lock:
            if not source_watch._inflight and not source_watch._per_volume:
                return
        threading.Event().wait(0.05)
    raise AssertionError(
        f"stat state never drained: {source_watch._inflight!r} {source_watch._per_volume!r}"
    )


@pytest.fixture(autouse=True)
def _clean_route_state() -> object:
    """Module state (``_inflight``, ``_per_volume``) must be empty on entry and
    exit, so a stat left held by one test cannot reach the next one in the same
    xdist worker."""
    _drain()
    yield
    _drain()


def test_the_stamp_changes_on_append_and_on_a_same_size_replacement(tmp_path: Path) -> None:
    f = tmp_path / "run.dat"
    f.write_bytes(b"a,b\n1,2\n")  # bytes: text mode writes CRLF on Windows
    (first,) = _stat(str(f))
    assert first["state"] == "ok"
    st = f.stat()
    assert first["stamp"] == f"{st.st_mtime_ns}:8:{st.st_ino}:{st.st_ctime_ns}"
    with f.open("ab") as fh:
        fh.write(b"3,4\n")
    assert _stat(str(f))[0]["stamp"] != first["stamp"]
    g = tmp_path / "y.dat"
    g.write_bytes(b"a,b\n9,9\n7,7\n")
    before = _stat(str(f))[0]["stamp"]
    os.replace(g, f)  # same size, new inode
    assert _stat(str(f))[0]["stamp"] != before


def test_a_deleted_file_is_missing_and_a_path_under_a_file_too(tmp_path: Path) -> None:
    f = tmp_path / "gone.dat"
    assert _stat(str(f))[0] == {"path": str(f), "state": "missing", "stamp": None}
    f.write_text("x", encoding="utf-8")
    assert _stat(str(f / "child.dat"))[0]["state"] == "missing"  # not "offline"
    assert _stat(str(tmp_path / ("n" * 400)))[0]["state"] in ("invalid", "missing")


def test_a_directory_is_not_a_file(tmp_path: Path) -> None:
    assert _stat(str(tmp_path))[0]["state"] == "not_file"


def test_a_path_outside_the_allowed_roots_reveals_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)  # cwd is an allowed root; keep it from covering /etc
    assert _stat("/etc/hostname")[0] == {"path": "/etc/hostname", "state": "outside", "stamp": None}


def test_a_natively_picked_path_outside_the_roots_is_allowed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    f = tmp_path / "picked.dat"
    f.write_text("xyz", encoding="utf-8")
    monkeypatch.setattr("quantized.routes.source_watch.allowed_data_prefixes", lambda: ())
    assert _stat(str(f))[0]["state"] == "outside"
    desktop_consent.grant_paths([str(f)])
    try:
        entry = _stat(str(f))[0]
    finally:
        desktop_consent.revoke_paths([str(f)])
    assert entry["state"] == "ok"


def test_invalid_paths_the_list_cap_and_order(tmp_path: Path) -> None:
    assert _stat("bad\0path")[0]["state"] == "invalid"
    assert client.post("/api/source-watch/stat", json={"paths": ["x" * 5000]}).status_code == 422
    resp = client.post("/api/source-watch/stat", json={"paths": [str(tmp_path)] * 65})
    assert resp.status_code == 422
    a = tmp_path / "a.dat"
    a.write_text("1", encoding="utf-8")
    assert [e["state"] for e in _stat(str(tmp_path / "b.dat"), str(a))] == ["missing", "ok"]


def test_volume_keys_never_touch_the_filesystem(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(source_watch, "_mount_points", lambda: ("/mnt/nas", "/"))
    assert source_watch._volume_key("/mnt/nas/run/a.dat") == "/mnt/nas"
    assert source_watch._volume_key("/mnt/nasty/a.dat") == "/"
    monkeypatch.setattr(source_watch, "_mount_points", lambda: ())
    assert source_watch._volume_key("/Volumes/Lab/run/a.dat") == "/Volumes/Lab"


def _hang_on(
    monkeypatch: pytest.MonkeyPatch, needle: str, answer_s: float = 30.0
) -> tuple[threading.Event, list[str]]:
    """``_stat_one`` blocks for paths containing ``needle`` until released.

    ``answer_s`` is the route's answer deadline. The default is a loose backstop:
    a short one (0.3 s) made a test whose stats never hang report "pending" when
    its stat thread was merely slow to start under load. Only a test that WANTS
    the deadline to expire on a hung stat passes a short one."""
    release = threading.Event()
    calls: list[str] = []
    real = source_watch._stat_one

    def maybe_hang(path: str) -> SourceStat:
        calls.append(path)
        if needle in path:
            release.wait(10)
        return real(path)

    monkeypatch.setattr(source_watch, "_stat_one", maybe_hang)
    monkeypatch.setattr(source_watch, "ANSWER_TIMEOUT_S", answer_s)
    return release, calls


def test_a_hung_stat_is_pending_and_shared_never_a_second_thread(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    f = tmp_path / "hang.dat"
    f.write_text("x", encoding="utf-8")
    release, calls = _hang_on(monkeypatch, "hang", answer_s=0.3)
    try:
        assert _stat(str(f))[0]["state"] == "pending"  # no answer YET, not "unreachable"
        assert _stat(str(f))[0]["state"] == "pending"
        assert calls == [str(f)]  # the second request waited on the first thread
    finally:
        release.set()
    _drain()
    monkeypatch.setattr(source_watch, "ANSWER_TIMEOUT_S", 30.0)  # nothing hangs now
    assert _stat(str(f))[0]["state"] == "ok"


def test_two_windows_on_one_slow_file_both_get_the_real_answer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    f = tmp_path / "slow.dat"
    f.write_text("x", encoding="utf-8")
    # The default 30 s deadline only bounds how long a request waits for a stat
    # that is never released (a failure), not the passing path.
    release, calls = _hang_on(monkeypatch, "slow")
    # The two windows share one thread only if the SECOND request asks while the
    # first stat is still in flight. A fixed sleep before release() assumed both
    # requests got that far in 0.3 s; on a starved box the second one had not
    # asked yet, the stat finished, and it (correctly) started a fresh one --
    # "2 reads". Gate the release on both requests having asked instead.
    asked = threading.Semaphore(0)
    real_submit = source_watch._submit

    def counting_submit(path: str) -> object:
        fut = real_submit(path)  # joins or starts the in-flight stat
        asked.release()  # once per request: a pending future is never re-submitted
        return fut

    monkeypatch.setattr(source_watch, "_submit", counting_submit)
    results: list[object] = []

    def window() -> None:
        results.append(_stat(str(f))[0]["state"])

    threads = [threading.Thread(target=window) for _ in range(2)]
    for t in threads:
        t.start()
    try:
        for _ in range(2):
            assert asked.acquire(timeout=30), "a window never reached the route"
    finally:
        release.set()  # a slow share answers after both windows asked
    for t in threads:
        t.join(30)
    assert results == ["ok", "ok"]
    assert len(calls) == 1


def test_a_request_after_the_stat_finished_stats_again(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Sharing is for IN-FLIGHT stats only: the control for the test above. A
    second window that asks after the first stat finished gets a fresh read
    (stale answers would hide a changed file), which is why that test must hold
    the stat open until both windows have asked."""
    f = tmp_path / "once.dat"
    f.write_text("x", encoding="utf-8")
    release, calls = _hang_on(monkeypatch, "once")
    release.set()  # nothing hangs
    assert _stat(str(f))[0]["state"] == "ok"
    _drain()
    assert _stat(str(f))[0]["state"] == "ok"
    assert calls == [str(f), str(f)]


def test_a_hung_share_never_starves_a_healthy_volume(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    hung = [f"/mnt/hung/f{i}.dat" for i in range(source_watch.PER_VOLUME_INFLIGHT + 4)]
    monkeypatch.setattr(source_watch, "_mount_points", lambda: ("/mnt/hung", "/"))
    release, _calls = _hang_on(monkeypatch, "/mnt/hung/", answer_s=0.3)
    healthy = []
    for i in range(20):  # more healthy files than any per-volume cap
        p = tmp_path / f"ok{i}.dat"
        p.write_text("1", encoding="utf-8")
        healthy.append(str(p))
    try:
        # Step 1: fill the hung volume to its cap. A short deadline is fine here:
        # it only bounds how long the HUNG stats are waited on (they never finish).
        monkeypatch.setattr(source_watch, "ANSWER_TIMEOUT_S", 0.3)
        assert {e["state"] for e in _stat(*hung)} == {"pending"}
        # Key it the way the route does (on Windows "/mnt/hung" is a path on the
        # current drive, so its volume key is that drive, e.g. "d:").
        hung_volume = source_watch._volume_key(os.path.abspath(hung[0]))
        assert source_watch._per_volume.get(hung_volume) == source_watch.PER_VOLUME_INFLIGHT
        # Step 2: the healthy volume proceeds, in several retry rounds past its
        # own cap. Its deadline is a pure backstop: the request returns as soon
        # as every healthy stat is done, so it can be huge. (A 2 s deadline shared
        # with the hung stats still read "pending" when the process was starved
        # for a few seconds -- the property is "never starved", not "fast".)
        monkeypatch.setattr(source_watch, "ANSWER_TIMEOUT_S", 60.0)
        for _ in range(2):  # and every time
            assert {e["state"] for e in _stat(*healthy)} == {"ok"}
        # Finished healthy threads exit just after publishing their answer: wait
        # for those, so only the hung stats (which cannot finish) are counted.
        for _ in range(400):
            live = sum(1 for t in threading.enumerate() if t.name == "qz-source-watch")
            if live <= source_watch.PER_VOLUME_INFLIGHT:
                break
            threading.Event().wait(0.05)
        assert live <= source_watch.PER_VOLUME_INFLIGHT
    finally:
        release.set()
    _drain()


def test_volume_keys_split_on_either_separator(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(source_watch, "_mount_points", lambda: ())
    assert source_watch._volume_key("\\Volumes\\Lab\\run\\a.dat") == "\\Volumes\\Lab"


@pytest.mark.parametrize("err", [OSError(errno.EINVAL, "bad"), OSError(errno.EIO, "bad")])
def test_a_bad_name_is_invalid_and_an_io_error_offline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, err: OSError
) -> None:
    f = tmp_path / "x.dat"
    f.write_bytes(b"1\n")

    def boom(*_a: object, **_k: object) -> os.stat_result:
        raise err

    monkeypatch.setattr(source_watch.os, "stat", boom)
    want = "invalid" if err.errno == errno.EINVAL else "offline"
    assert _stat(str(f))[0]["state"] == want


def test_a_windows_bad_name_error_is_invalid_not_offline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    f = tmp_path / "x.dat"
    f.write_bytes(b"1\n")
    err = OSError(errno.EIO, "name too long")
    err.winerror = 206  # type: ignore[attr-defined]

    def boom(*_a: object, **_k: object) -> os.stat_result:
        raise err

    monkeypatch.setattr(source_watch.os, "stat", boom)
    assert _stat(str(f))[0]["state"] == "invalid"
