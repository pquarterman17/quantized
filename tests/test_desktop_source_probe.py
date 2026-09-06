"""Pure source-probe logic (P1.7 box 4), split from desktop_bridge.py so it's
testable with no pywebview window at all — see desktop_source_probe.py's
module doc.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from quantized.desktop_source_probe import probe_source_path, volume_present


def _file(tmp_path: Path, name: str = "run.csv", content: str = "T,M\n1,10\n") -> Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


def _unmounted_volume_path() -> str:
    if os.name == "nt":
        b = chr(92)
        return b + b + "no-such-server" + b + "share" + b + "run.dat"
    base = "/Volumes" if sys.platform == "darwin" else "/mnt"
    return f"{base}/qz-no-such-volume/run.dat"


# --- state classification ----------------------------------------------


def test_probe_ok_for_an_existing_file_without_checksum(tmp_path: Path) -> None:
    f = _file(tmp_path)
    out = probe_source_path(str(f), compute_checksum=False)
    assert out["state"] == "ok"
    assert out["size"] == f.stat().st_size
    assert "checksum" not in out


def test_probe_ok_reports_dev_and_ino(tmp_path: Path) -> None:
    """RED-FIRST: the new filesystem-identity fields a caller (the portable
    manifest builder) uses to prove two path spellings name one physical
    file -- never populated before this slice."""
    f = _file(tmp_path)
    st = f.stat()
    out = probe_source_path(str(f), compute_checksum=False)
    assert out["dev"] == st.st_dev
    assert out["ino"] == st.st_ino
    assert isinstance(out["dev"], int)
    assert isinstance(out["ino"], int)


def test_probe_dev_ino_identical_for_two_spellings_of_one_file(tmp_path: Path) -> None:
    """The whole point of dev/ino: two DIFFERENT path strings that resolve
    to the SAME file report the SAME identity pair."""
    f = _file(tmp_path)
    spelling_a = str(f)
    spelling_b = str(tmp_path / ".." / tmp_path.name / f.name)
    out_a = probe_source_path(spelling_a, compute_checksum=False)
    out_b = probe_source_path(spelling_b, compute_checksum=False)
    assert (out_a["dev"], out_a["ino"]) == (out_b["dev"], out_b["ino"])


def test_probe_dev_ino_differ_for_two_different_files(tmp_path: Path) -> None:
    a = _file(tmp_path, "a.csv", "aaa")
    b = _file(tmp_path, "b.csv", "bbb")
    out_a = probe_source_path(str(a), compute_checksum=False)
    out_b = probe_source_path(str(b), compute_checksum=False)
    assert (out_a["dev"], out_a["ino"]) != (out_b["dev"], out_b["ino"])


def test_probe_missing_when_the_volume_is_reachable(tmp_path: Path) -> None:
    out = probe_source_path(str(tmp_path / "nope.csv"), compute_checksum=False)
    assert out["state"] == "missing"


def test_probe_offline_when_the_volume_is_not_mounted() -> None:
    out = probe_source_path(_unmounted_volume_path(), compute_checksum=False)
    assert out["state"] == "offline"


def test_probe_invalid_for_a_directory(tmp_path: Path) -> None:
    out = probe_source_path(str(tmp_path), compute_checksum=False)
    assert out["state"] == "invalid"


def test_probe_permission_denied_when_stat_itself_is_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """RED-FIRST: this is the NEW state — path_status has no such branch.
    A stat() that raises PermissionError must report permission_denied, not
    collapse into missing/offline/invalid."""
    f = _file(tmp_path)

    def _boom(path: str, *a: object, **kw: object) -> None:
        if path == str(f):
            raise PermissionError("Permission denied")
        return real_stat(path, *a, **kw)  # type: ignore[return-value]

    real_stat = os.stat
    monkeypatch.setattr("quantized.desktop_source_probe.os.stat", _boom)
    out = probe_source_path(str(f), compute_checksum=False)
    assert out["state"] == "permission_denied"


def test_probe_stale_mount_oserror_is_offline_not_invalid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """P1.1 self-review: a stale/unreachable share raises ESTALE/EIO/
    ETIMEDOUT from stat — NOT ENOENT — and must still read as offline
    (the volume is gone), never as a malformed path, or every downstream
    consumer offers Locate/cleanup for a project that is fine."""
    target = _unmounted_volume_path()
    real_stat = os.stat

    def _stale(path: str, *a: object, **kw: object) -> object:
        if path == target:
            raise OSError(116, "Stale file handle", path)
        return real_stat(path, *a, **kw)

    monkeypatch.setattr("quantized.desktop_source_probe.os.stat", _stale)
    assert probe_source_path(target, compute_checksum=False)["state"] == "offline"


def test_probe_generic_oserror_on_a_live_volume_is_invalid(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The counterpart: the same OSError where the volume IS reachable is
    a bad path, exactly as before."""
    target = str(tmp_path / "weird")
    real_stat = os.stat

    def _boom(path: str, *a: object, **kw: object) -> object:
        if path == target:
            raise OSError(22, "Invalid argument", path)
        return real_stat(path, *a, **kw)

    monkeypatch.setattr("quantized.desktop_source_probe.os.stat", _boom)
    assert probe_source_path(target, compute_checksum=False)["state"] == "invalid"


def test_probe_degrades_to_invalid_when_stat_raises_valueerror_not_oserror(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """RED-FIRST (CI-found, Windows-only class): a malformed path (the
    concrete case is an embedded null byte) makes `os.path.realpath`
    succeed SILENTLY on Windows — it does no OS-level validation for a
    not-yet-resolved path — while the actual `os.stat` syscall DOES
    validate and raises `ValueError`, never any `OSError` subtype. This is
    invisible on Linux/macOS (where the same input degrades through
    `OSError` instead, so a plain `bad\\x00path` fixture never reproduces
    it there) — monkeypatching `os.stat` to raise the EXACT Windows error
    class reproduces the bug deterministically on every host."""
    f = _file(tmp_path)

    def _boom(path: str, *a: object, **kw: object) -> None:
        if path == str(f):
            raise ValueError("embedded null character in path")
        return real_stat(path, *a, **kw)  # type: ignore[return-value]

    real_stat = os.stat
    monkeypatch.setattr("quantized.desktop_source_probe.os.stat", _boom)
    out = probe_source_path(str(f), compute_checksum=False)
    assert out["state"] == "invalid"


def test_checksum_degrades_when_the_read_raises_valueerror_not_oserror(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Same Windows asymmetry, at the checksum's `open(..., "rb")` syscall
    instead of `os.stat` — stat already succeeded (state is `ok`), but the
    read itself raises `ValueError` rather than `OSError`."""
    f = _file(tmp_path)

    real_open = open

    def _boom(path: object, mode: str = "r", *a: object, **kw: object) -> object:
        if mode == "rb":
            raise ValueError("embedded null character in path")
        return real_open(path, mode, *a, **kw)  # type: ignore[arg-type]

    monkeypatch.setattr("builtins.open", _boom)
    out = probe_source_path(str(f), compute_checksum=True)
    assert out["state"] == "ok"  # stat already succeeded — only the checksum degrades
    assert "checksum" not in out
    assert "embedded null" in out["checksum_error"]


# --- checksum gating (the consent ruling) -------------------------------


def test_checksum_omitted_when_not_requested(tmp_path: Path) -> None:
    f = _file(tmp_path)
    out = probe_source_path(str(f), compute_checksum=False)
    assert "checksum" not in out


def test_checksum_computed_when_requested(tmp_path: Path) -> None:
    f = _file(tmp_path, content="same bytes")
    out = probe_source_path(str(f), compute_checksum=True)
    assert out["checksum"].startswith("sha256:")
    assert len(out["checksum"]) == len("sha256:") + 64


def test_checksum_is_stable_and_content_sensitive(tmp_path: Path) -> None:
    a = _file(tmp_path, "a.csv", "same content\n")
    b = _file(tmp_path, "b.csv", "same content\n")
    c = _file(tmp_path, "c.csv", "different content\n")
    ca = probe_source_path(str(a), compute_checksum=True)["checksum"]
    cb = probe_source_path(str(b), compute_checksum=True)["checksum"]
    cc = probe_source_path(str(c), compute_checksum=True)["checksum"]
    assert ca == cb
    assert ca != cc


def test_checksum_read_failure_degrades_to_permission_denied_without_raising(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """RED-FIRST: stat succeeds (state would be ok) but the actual read is
    refused — a real gap between "can see metadata" and "can read content"
    that path_status never had to handle. Must degrade, never raise."""
    f = _file(tmp_path)

    real_open = open

    def _boom(path: object, mode: str = "r", *a: object, **kw: object) -> object:
        if mode == "rb":
            raise PermissionError("Permission denied")
        return real_open(path, mode, *a, **kw)  # type: ignore[arg-type]

    monkeypatch.setattr("builtins.open", _boom)
    out = probe_source_path(str(f), compute_checksum=True)
    assert out["state"] == "permission_denied"


def test_probe_never_raises_on_a_vanishing_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A file that disappears between the stat and isfile-recheck (a real
    TOCTOU race, not hypothetical on a network share) must still report a
    state, never propagate an exception into the js_api boundary."""
    f = _file(tmp_path)
    resolved = os.path.realpath(str(f))
    f.unlink()
    out = probe_source_path(resolved, compute_checksum=False)
    assert out["state"] in ("missing", "offline")


# --- volume_present (moved verbatim; pin the same behavior) -------------


def test_volume_present_true_for_a_normal_reachable_path(tmp_path: Path) -> None:
    assert volume_present(str(tmp_path)) is True


def test_volume_present_false_for_an_unmounted_volume() -> None:
    assert volume_present(_unmounted_volume_path()) is False
