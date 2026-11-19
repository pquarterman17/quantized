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
    for _ in range(100):  # blocked stats finish and free their slots
        if not source_watch._inflight:
            return
        threading.Event().wait(0.05)


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


def _hang_on(monkeypatch: pytest.MonkeyPatch, needle: str) -> tuple[threading.Event, list[str]]:
    """``_stat_one`` blocks for paths containing ``needle`` until released."""
    release = threading.Event()
    calls: list[str] = []
    real = source_watch._stat_one

    def maybe_hang(path: str) -> SourceStat:
        calls.append(path)
        if needle in path:
            release.wait(10)
        return real(path)

    monkeypatch.setattr(source_watch, "_stat_one", maybe_hang)
    monkeypatch.setattr(source_watch, "ANSWER_TIMEOUT_S", 0.3)
    return release, calls


def test_a_hung_stat_is_pending_and_shared_never_a_second_thread(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    f = tmp_path / "hang.dat"
    f.write_text("x", encoding="utf-8")
    release, calls = _hang_on(monkeypatch, "hang")
    try:
        assert _stat(str(f))[0]["state"] == "pending"  # no answer YET, not "unreachable"
        assert _stat(str(f))[0]["state"] == "pending"
        assert calls == [str(f)]  # the second request waited on the first thread
    finally:
        release.set()
    _drain()
    assert _stat(str(f))[0]["state"] == "ok"


def test_two_windows_on_one_slow_file_both_get_the_real_answer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    f = tmp_path / "slow.dat"
    f.write_text("x", encoding="utf-8")
    release, calls = _hang_on(monkeypatch, "slow")
    monkeypatch.setattr(source_watch, "ANSWER_TIMEOUT_S", 5.0)
    results: list[object] = []

    def window() -> None:
        results.append(_stat(str(f))[0]["state"])

    threads = [threading.Thread(target=window) for _ in range(2)]
    for t in threads:
        t.start()
    threading.Event().wait(0.3)
    release.set()  # a slow share answers after both windows asked
    for t in threads:
        t.join(10)
    assert results == ["ok", "ok"]
    assert len(calls) == 1


def test_a_hung_share_never_starves_a_healthy_volume(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    hung = [f"/mnt/hung/f{i}.dat" for i in range(source_watch.PER_VOLUME_INFLIGHT + 4)]
    monkeypatch.setattr(source_watch, "_mount_points", lambda: ("/mnt/hung", "/"))
    release, _calls = _hang_on(monkeypatch, "/mnt/hung/")
    # The healthy files pass the per-volume cap in several retry rounds; 0.3 s
    # was too tight for that on a loaded CI runner (macOS: the healthy volume
    # still "pending"). The deadline only bounds how long the HUNG ones wait, so
    # a roomier one keeps the property under test and costs ~2 s once.
    monkeypatch.setattr(source_watch, "ANSWER_TIMEOUT_S", 2.0)
    healthy = []
    for i in range(20):  # more healthy files than any per-volume cap
        p = tmp_path / f"ok{i}.dat"
        p.write_text("1", encoding="utf-8")
        healthy.append(str(p))
    try:
        first = _stat(*hung, *healthy)
        assert {e["state"] for e in first[: len(hung)]} == {"pending"}
        assert {e["state"] for e in first[len(hung) :]} == {"ok"}
        # The hung volume is at its cap; the healthy one still proceeds, every time.
        assert {e["state"] for e in _stat(*healthy)} == {"ok"}
        assert sum(1 for t in threading.enumerate() if t.name == "qz-source-watch") <= (
            source_watch.PER_VOLUME_INFLIGHT
        )
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
