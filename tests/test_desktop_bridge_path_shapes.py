"""P1.1's still-open sub-item: "Long Unicode/network paths and canceled
dialogs work." Cancel semantics already have dedicated coverage in
``test_desktop_bridge.py``; this file is the non-packaged half of the
Unicode/long-path/UNC-classification/write-consent-bypass sub-item — every
piece of it that is real Python/TypeScript logic testable with
``FakeWindow``/``tmp_path`` and needs no packaged app or a real OS dialog.

What stays OUT of scope here (see the plan box's own text): a real OS
native-dialog round trip on an actual long/Unicode/UNC path. That needs a
packaged desktop build and a live OS, which this repo's CI cannot provide —
every test below instead exercises the bridge's OWN Python logic once a path
string (of whatever shape) already exists, exactly the way a real dialog's
return value would reach it.
"""

from __future__ import annotations

import json
import os
import tempfile
import unicodedata
from pathlib import Path
from typing import Any

import pytest

from quantized.desktop_bridge import DesktopApi
from quantized.desktop_consent import (
    clear_consent,
    consented_path,
    grant_write_path,
    is_consented,
    is_declared_source,
)
from quantized.desktop_project_file import payload_declares_source
from quantized.desktop_source_probe import probe_source_path, volume_present


class FakeWindow:
    """Local copy of test_desktop_bridge.py's fixture — see that file's
    module doc for why a fake window (not a full mock) is the right level:
    the logic worth testing is what the bridge does with whatever the
    dialog returns, and this file exercises that with deliberately unusual
    strings."""

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


def _workspace_json_declaring(*source_paths: str) -> str:
    return json.dumps(
        {
            "format": "quantized-workspace",
            "version": 4,
            "datasets": [
                {"id": f"d{i}", "source": {"kind": "path", "path": p}}
                for i, p in enumerate(source_paths)
            ],
        }
    )


def _grant_write(api: DesktopApi, dest: Path) -> str:
    api.attach(FakeWindow([str(dest)]))
    out = api.save_file_dialog(dest.name)
    assert out["path"] is not None, out
    return out["path"]


# === Unicode filenames ======================================================
#
# None of desktop_consent.py / desktop_source_probe.py / desktop_bridge.py
# decode, re-encode, or otherwise touch a path's bytes beyond
# `os.path.realpath` — so the only real question is whether that pipeline
# round-trips arbitrary Unicode content unchanged. It does, below, for
# CJK, combining-mark (NFD), and astral-plane (surrogate-pair-in-JS,
# single-codepoint-in-Python) filenames.

def _hardlinks_available() -> bool:
    """Can this filesystem actually make a hard link? Asked, not assumed.

    The three hardlink tests below used to disagree with each other: one was
    skipped on `os.name == "nt"` with "needs elevated privilege", and two called
    `os.link` unguarded. CI settled it -- the unguarded pair PASSED on
    windows-latest, so the platform guess was wrong and was needlessly skipping
    the BUG-002 reproduction on the very OS where `normcase` adds another
    respelling axis. Capability detection covers both: it runs wherever hard
    links work (NTFS included) and skips cleanly where they do not, without
    anyone predicting which is which.
    """
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / "src"
        src.write_text("x", encoding="utf-8")
        try:
            os.link(src, Path(d) / "dst")
        except (OSError, NotImplementedError, AttributeError):
            return False
        return True


requires_hardlinks = pytest.mark.skipif(
    not _hardlinks_available(),
    reason="this filesystem cannot create hard links (probed, not assumed)",
)


def _symlinks_available() -> bool:
    """Probe the current filesystem instead of guessing from the OS name."""
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / "src"
        src.write_text("x", encoding="utf-8")
        try:
            (Path(d) / "link").symlink_to(src)
        except (OSError, NotImplementedError, AttributeError):
            return False
        return True


requires_symlinks = pytest.mark.skipif(
    not _symlinks_available(),
    reason="this filesystem cannot create symbolic links (probed, not assumed)",
)


UNICODE_NAMES = [
    "運行データ.csv",  # CJK
    "Ω-résumé.csv",  # Greek + Latin-1 supplement
    unicodedata.normalize("NFD", "café-run.csv"),  # decomposed combining accent
    "🔬-lab-run.csv",  # astral-plane emoji (surrogate pair in UTF-16/JS)
]


@pytest.mark.parametrize("name", UNICODE_NAMES)
def test_pick_files_grants_and_reads_back_a_unicode_filename(tmp_path: Path, name: str) -> None:
    f = tmp_path / name
    f.write_text("T,M\n1,10\n", encoding="utf-8")
    api = DesktopApi()
    api.attach(FakeWindow([str(f)]))
    out = api.pick_files()
    assert out["paths"] == [str(f)]
    assert is_consented(str(f))
    assert consented_path(str(f)) == str(f)


@pytest.mark.parametrize("name", UNICODE_NAMES)
def test_write_project_file_round_trips_a_unicode_destination(tmp_path: Path, name: str) -> None:
    dest = tmp_path / name
    api = DesktopApi()
    path = _grant_write(api, dest)
    content = _workspace_json_declaring()
    out = api.write_project_file(path, content)
    assert out["ok"] is True, out
    assert dest.read_text(encoding="utf-8") == content


@pytest.mark.parametrize("name", UNICODE_NAMES)
def test_path_status_and_probe_source_handle_unicode_paths(tmp_path: Path, name: str) -> None:
    f = tmp_path / name
    f.write_text("data", encoding="utf-8")
    api = DesktopApi()
    assert api.path_status(str(f))["state"] == "ok"
    out = probe_source_path(os.path.realpath(str(f)), compute_checksum=True)
    assert out["state"] == "ok"
    assert out["checksum"].startswith("sha256:")


def test_declared_source_uses_filesystem_identity_for_unicode_spellings(tmp_path: Path) -> None:
    """NFC/NFD aliases match only when this filesystem says they are one file.

    APFS/HFS+ commonly resolve the two spellings to one file; ext4 commonly
    permits two distinct files.  The guard follows that observable identity,
    not an OS-name guess and not Unicode text equality by itself.
    """
    composed = unicodedata.normalize("NFC", "café.csv")
    decomposed = unicodedata.normalize("NFD", "café.csv")
    assert composed != decomposed  # they are different byte strings in Python, too
    f_nfc = tmp_path / composed
    f_nfc.write_text("nfc", encoding="utf-8")
    api = DesktopApi()
    project = tmp_path / "workspace.dwk"
    project.write_text(_workspace_json_declaring(str(f_nfc)), encoding="utf-8")
    api.attach(FakeWindow([str(project)]))
    api.open_project_file()
    assert is_declared_source(os.path.realpath(str(f_nfc)))

    resolved_nfd = os.path.realpath(str(tmp_path / decomposed))
    if os.path.exists(resolved_nfd) and os.path.samefile(f_nfc, resolved_nfd):
        assert is_declared_source(resolved_nfd)
        assert payload_declares_source(
            {"datasets": [{"source": {"kind": "path", "path": str(f_nfc)}}]},
            resolved_nfd,
        )
        return

    # On a normalization-sensitive filesystem this is a genuinely different
    # file and must not become a false positive merely because NFC keys match.
    f_nfd = tmp_path / decomposed
    f_nfd.write_text("nfd", encoding="utf-8")
    assert not is_declared_source(os.path.realpath(str(f_nfd)))


def test_nfc_nfd_alias_is_guarded_on_a_normalization_insensitive_filesystem(
    tmp_path: Path,
) -> None:
    """Positive macOS sibling case, capability-skipped on sensitive volumes."""
    composed = unicodedata.normalize("NFC", "café-alias.csv")
    decomposed = unicodedata.normalize("NFD", "café-alias.csv")
    raw = tmp_path / composed
    raw.write_text("data", encoding="utf-8")
    alias = tmp_path / decomposed
    try:
        aliases_same_file = os.path.samefile(raw, alias)
    except FileNotFoundError:
        aliases_same_file = False
    if not aliases_same_file:
        pytest.skip("this filesystem treats NFC and NFD names as distinct")

    project = tmp_path / "workspace.dwk"
    project.write_text(_workspace_json_declaring(str(raw)), encoding="utf-8")
    api = DesktopApi()
    api.attach(FakeWindow([str(project)]))
    api.open_project_file()
    resolved_alias = os.path.realpath(str(alias))

    assert is_declared_source(resolved_alias)
    assert payload_declares_source(
        {"datasets": [{"source": {"kind": "path", "path": str(raw)}}]},
        resolved_alias,
    )


# === Long paths ==============================================================
#
# Windows' legacy ~260-char MAX_PATH is an OS-level limit this code cannot
# lift and does not attempt to (no packaged Windows build to exercise it
# against — that is the item's own still-open packaged-E2E half). What IS
# testable on every platform is that THIS code adds no truncation or
# re-parsing of its own on a long path: `write_project_file`'s temp file
# (tempfile.mkstemp with a short fixed prefix, see desktop_project_file.py's
# WRITE_TEMP_PREFIX) never incorporates the destination's own filename, so a
# long destination name cannot push the temp file over a filesystem's
# per-component limit.


def test_write_project_file_handles_a_path_deeper_than_windows_max_path(tmp_path: Path) -> None:
    """Total path length > 260 chars (Windows' legacy MAX_PATH) via nested
    directories, each component well under the 255-byte per-component limit
    -- exercises this repo's own code with no OS-level length ceiling in the
    way. Windows' actual 260-char enforcement is an OS boundary this test
    cannot reach without a packaged Windows build; see this module's header."""
    deep = tmp_path
    for i in range(12):
        deep = deep / f"segment-{i:02d}-with-some-length"
    deep.mkdir(parents=True)
    dest = deep / "run.dwk"
    assert len(str(dest)) > 260
    api = DesktopApi()
    path = _grant_write(api, dest)
    content = _workspace_json_declaring()
    out = api.write_project_file(path, content)
    assert out["ok"] is True, out
    assert dest.read_text(encoding="utf-8") == content


def test_write_project_file_handles_a_near_max_length_filename_component(tmp_path: Path) -> None:
    """A single component near Linux's 255-byte NAME_MAX. The write's temp
    file must not fail or collide -- it lives in the SAME directory but
    under `WRITE_TEMP_PREFIX` plus `mkstemp`'s own short random suffix,
    never the destination's basename."""
    name = ("x" * 248) + ".dwk"  # 252 bytes, under 255
    dest = tmp_path / name
    api = DesktopApi()
    path = _grant_write(api, dest)
    content = _workspace_json_declaring()
    out = api.write_project_file(path, content)
    assert out["ok"] is True, out
    assert dest.read_text(encoding="utf-8") == content
    # Exactly one file in the directory afterward -- no stray temp survived,
    # proving the temp name (short prefix + short random suffix) never
    # collided with or truncated into the long destination name.
    assert [p.name for p in tmp_path.iterdir()] == [name]


# === Special characters legal in a filename ================================


SPECIAL_NAMES = [
    "run#1.csv",
    "50%-anneal.csv",
    "what?.csv",
    " leading-space.csv",
    "trailing-space.csv ",
    "embedded\nnewline.csv",  # legal on POSIX (illegal on Windows -- see skip below)
]


@pytest.mark.skipif(
    os.name == "nt",
    reason="a literal newline/'?' in a filename is illegal on Windows' own "
    "filesystem API (CreateFile rejects it outright) -- this class only "
    "exists to exercise on POSIX, where it is a legal byte in a filename.",
)
@pytest.mark.parametrize("name", SPECIAL_NAMES)
def test_write_project_file_round_trips_specially_charactered_names(
    tmp_path: Path, name: str
) -> None:
    dest = tmp_path / name
    api = DesktopApi()
    path = _grant_write(api, dest)
    content = _workspace_json_declaring()
    out = api.write_project_file(path, content)
    assert out["ok"] is True, out
    assert dest.read_text(encoding="utf-8") == content


@pytest.mark.parametrize(
    "name",
    [
        "run#1.csv",
        "50%-anneal.csv",
        pytest.param(
            "what?.csv",
            marks=pytest.mark.skipif(
                os.name == "nt",
                reason="'?' is a RESERVED character in a Windows filename (with "
                '< > : " | * and \\), so the file cannot be created at all -- '
                "Windows fails the write with OSError EINVAL before any bridge "
                "code runs. Verified by CI: this case, and only this case, went "
                "red on windows-latest.",
            ),
        ),
    ],
)
def test_pick_files_consents_a_specially_charactered_name_on_every_platform(
    tmp_path: Path, name: str
) -> None:
    """`#` and `%` are legal filename characters on every platform this project
    supports, so those run unconditionally.

    `?` is NOT -- this docstring used to claim it was, and CI proved otherwise.
    It is kept as a POSIX-only case rather than deleted, because `?` reaching a
    consent check is a real scenario on macOS and Linux."""
    f = tmp_path / name
    f.write_text("data", encoding="utf-8")
    api = DesktopApi()
    api.attach(FakeWindow([str(f)]))
    out = api.pick_files()
    assert out["paths"] == [str(f)]
    assert is_consented(str(f))


# === UNC / network-path classification (mocked; no real share) =============
#
# This repo already has `_unmounted_volume_path()` fixtures that build a
# UNC-*shaped* string, but on POSIX (where this whole gate runs)
# `os.path.splitdrive` never treats a leading double-backslash as a drive at
# all, so the Windows-only branch of `volume_present` is otherwise never
# actually exercised outside a Windows CI runner. The tests below mock
# `os.path.splitdrive`/`os.path.isdir` to model exactly what Windows itself
# would report for a UNC root, so the CLASSIFICATION LOGIC (reachable share
# -> "missing" for an absent file; unreachable share -> "offline") is
# covered on every host. What this does NOT cover: an actual SMB/CIFS
# connection, real Windows `_getfinalpathname` behavior, or an extended-
# length `\\?\` prefix's own special-cased parsing -- that needs a real
# Windows box with a real (or deliberately downed) share, which is exactly
# the packaged-E2E gap this plan item's other half still names.


def _unc_path(reachable_share: bool) -> tuple[str, str, str]:
    """Returns (share_root, file_path, host_note) for a synthetic
    ``\\\\server\\share`` UNC root -- built from `chr(92)` for the same
    reason `test_desktop_bridge.py`'s own `_unmounted_volume_path` does: a
    quoting layer eating one backslash silently turns this into a rooted
    local path instead of a UNC one, which would make the test assert the
    wrong thing without failing loudly."""
    b = chr(92)
    share = f"{b}{b}qz-test-server{b}share"
    return share, f"{share}{b}run.dwk", ("reachable" if reachable_share else "unreachable")


def _patch_unc_classification(
    monkeypatch: pytest.MonkeyPatch, share_root: str, *, mounted: bool
) -> None:
    """Model what NTFS/ntpath itself would do for a UNC-rooted string, since
    POSIX's `os.path` treats every one of these three calls differently for
    a leading-double-backslash string than Windows' own `os.path` (== ntpath)
    would:

    - `splitdrive`/`isdir`: as before, faked for the exact fake share root.
    - `realpath`: ntpath treats a UNC path as already absolute and (with no
      symlinks in a synthetic path) returns it unchanged. POSIX's realpath
      does NOT recognize a leading `\\\\` as absolute, so on an unpatched
      POSIX host it silently rewrites the fake path onto the CWD, and every
      caller that calls `os.path.realpath` before classifying (`path_status`,
      `probe_source`, both in desktop_bridge_dialogs.py) would then classify
      a mangled, no-longer-UNC-shaped string -- caught red-handed by
      `test_path_status_offline_on_an_unreachable_unc_share` below, which
      failed with `missing` instead of `offline` before this fix. Patched to
      the real ntpath.realpath's OWN observable behavior (identity, for an
      already-absolute string with no symlink components) for exactly the
      fake root, so the classification the caller sees is what a real
      Windows host would actually hand `probe_source_path`.
    """
    real_splitdrive = os.path.splitdrive
    real_isdir = os.path.isdir
    real_realpath = os.path.realpath

    def fake_splitdrive(p: str) -> tuple[str, str]:
        if p == share_root:
            return (share_root, "")
        if p.startswith(share_root + chr(92)):
            return (share_root, p[len(share_root) :])
        return real_splitdrive(p)

    def fake_isdir(p: str) -> bool:
        if p in (share_root, share_root + os.sep):
            return mounted
        return real_isdir(p)

    def fake_realpath(p: str, *a: object, **kw: object) -> str:
        if p == share_root or p.startswith(share_root + chr(92)):
            return p  # ntpath.realpath: already absolute, no symlinks -> unchanged
        return real_realpath(p, *a, **kw)  # type: ignore[arg-type]

    monkeypatch.setattr(os.path, "splitdrive", fake_splitdrive)
    monkeypatch.setattr(os.path, "isdir", fake_isdir)
    monkeypatch.setattr(os.path, "realpath", fake_realpath)


def test_volume_present_true_for_a_reachable_unc_share(monkeypatch: pytest.MonkeyPatch) -> None:
    share, file_path, _ = _unc_path(reachable_share=True)
    _patch_unc_classification(monkeypatch, share, mounted=True)
    assert volume_present(file_path) is True


def test_volume_present_false_for_an_unreachable_unc_share(monkeypatch: pytest.MonkeyPatch) -> None:
    share, file_path, _ = _unc_path(reachable_share=False)
    _patch_unc_classification(monkeypatch, share, mounted=False)
    assert volume_present(file_path) is False


def test_probe_source_missing_on_a_reachable_unc_share_for_an_absent_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A UNC file that does not exist, but whose SHARE root is mounted, is
    `missing` (the file is genuinely gone) -- not `offline` (the volume is
    fine)."""
    share, file_path, _ = _unc_path(reachable_share=True)
    _patch_unc_classification(monkeypatch, share, mounted=True)
    assert probe_source_path(file_path, compute_checksum=False)["state"] == "missing"


def test_probe_source_offline_on_an_unreachable_unc_share(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The counterpart: the SAME absent-file stat failure, but the share
    root itself is not mounted -- `offline`, not `missing`, so nothing
    downstream offers to clean up a source that is fine and will be back."""
    share, file_path, _ = _unc_path(reachable_share=False)
    _patch_unc_classification(monkeypatch, share, mounted=False)
    assert probe_source_path(file_path, compute_checksum=False)["state"] == "offline"


def test_path_status_offline_on_an_unreachable_unc_share(monkeypatch: pytest.MonkeyPatch) -> None:
    """Same classification, through the js_api method a real dialog result
    would actually reach (`DesktopApi.path_status`), not just the pure
    helper."""
    share, file_path, _ = _unc_path(reachable_share=False)
    _patch_unc_classification(monkeypatch, share, mounted=False)
    api = DesktopApi()
    assert api.path_status(file_path)["state"] == "offline"


# === Quick-save must never write through an absent mount point =============


def test_write_project_file_refuses_cleanly_when_the_directory_vanishes_after_consent(
    tmp_path: Path,
) -> None:
    """Models a network share going offline BETWEEN granting write consent
    (an earlier save, or a Save As while the share was up) and a later
    quick-save attempt: the destination's directory is removed before the
    write. `write_project_file` must fail cleanly (a caught `OSError`, `ok:
    False`) -- never silently create the directory, never write anywhere
    else, and never raise into the js_api boundary."""
    sub = tmp_path / "share_mount" / "project"
    sub.mkdir(parents=True)
    dest = sub / "workspace.dwk"
    api = DesktopApi()
    path = _grant_write(api, dest)
    # The "share" (share_mount) is removed entirely -- exactly what an
    # unmounted network volume looks like from this process's perspective:
    # every path under it now fails at the OS level, not just the file.
    (tmp_path / "share_mount" / "project").rmdir()
    (tmp_path / "share_mount").rmdir()
    out = api.write_project_file(path, _workspace_json_declaring())
    assert out["ok"] is False
    assert "error" in out
    # Nothing was recreated, and nothing landed in the parent directory either.
    assert not (tmp_path / "share_mount").exists()
    assert list(tmp_path.iterdir()) == []


# === Declared-source aliases: same path, symlink, and hard link =============
#
# Canonical path comparison covers the first two; filesystem identity is
# required for the third because a hard link has no preferred/canonical name.


def test_payload_source_guard_matches_same_path_but_not_an_independent_file(
    tmp_path: Path,
) -> None:
    raw = tmp_path / "raw.csv"
    raw.write_text("same bytes", encoding="utf-8")
    independent = tmp_path / "independent.csv"
    independent.write_text("same bytes", encoding="utf-8")
    payload = {"datasets": [{"source": {"kind": "path", "path": str(raw)}}]}

    assert payload_declares_source(payload, os.path.realpath(str(raw)))
    assert not payload_declares_source(payload, os.path.realpath(str(independent)))


@requires_symlinks
def test_payload_source_guard_matches_a_symlink_alias(tmp_path: Path) -> None:
    raw = tmp_path / "raw.csv"
    raw.write_text("data", encoding="utf-8")
    link = tmp_path / "raw-link.csv"
    link.symlink_to(raw)
    payload = {"datasets": [{"source": {"kind": "path", "path": str(raw)}}]}

    assert payload_declares_source(payload, os.path.realpath(str(link)))


@requires_hardlinks
def test_save_dialog_refuses_a_hardlinked_alias_of_the_open_projects_source(
    tmp_path: Path,
) -> None:
    raw = tmp_path / "raw.csv"
    raw.write_text("T,M\n1,10\n", encoding="utf-8")
    alias = tmp_path / "raw-alias.csv"
    os.link(raw, alias)  # SAME inode, a second directory entry
    assert os.stat(raw).st_ino == os.stat(alias).st_ino

    project = tmp_path / "workspace.dwk"
    project.write_text(_workspace_json_declaring(str(raw)), encoding="utf-8")
    api = DesktopApi()
    api.attach(FakeWindow([str(project)]))
    api.open_project_file()
    assert is_declared_source(os.path.realpath(str(raw)))
    assert is_declared_source(os.path.realpath(str(alias)))

    api.attach(FakeWindow([str(alias)]))
    out = api.save_file_dialog(alias.name)
    assert out["path"] is None
    assert "data source of the open project" in out["error"]


@requires_hardlinks
def test_write_refuses_a_hardlinked_alias_declared_only_by_the_payload(tmp_path: Path) -> None:
    """The authoritative payload guard works without a native project open."""
    raw = tmp_path / "raw.csv"
    raw.write_text("T,M\n1,10\n", encoding="utf-8")
    alias = tmp_path / "raw-alias.csv"
    os.link(raw, alias)
    granted = grant_write_path(str(alias))
    assert granted is not None

    out = DesktopApi().write_project_file(granted, _workspace_json_declaring(str(raw)))
    assert out["ok"] is False
    assert "data source of this workspace" in out["error"]
    assert raw.read_text(encoding="utf-8") == "T,M\n1,10\n"


@requires_hardlinks
def test_hardlink_bypass_does_not_actually_corrupt_the_shared_inodes_bytes(
    tmp_path: Path,
) -> None:
    """The mitigating half of the finding above, LOCKED IN (not xfail): even
    though the consent check above is fooled, `atomic_replace_file`'s
    temp-file-plus-`os.replace` means the ALIAS's directory entry is
    reassigned to a brand-new inode -- the ORIGINAL file's bytes, reachable
    by its own name, are never touched. This is what keeps the bug from
    being a data-loss bug: the raw instrument file survives byte-for-byte
    even when the write-target check above is bypassed."""
    raw = tmp_path / "raw.csv"
    original = "T,M\n1,10\n"
    raw.write_text(original, encoding="utf-8")
    alias = tmp_path / "raw-alias.csv"
    os.link(raw, alias)
    api = DesktopApi()
    path = _grant_write(api, alias)
    out = api.write_project_file(path, _workspace_json_declaring())
    assert out["ok"] is True, out  # nothing declared this time -- an ordinary write
    assert alias.read_text(encoding="utf-8") != original  # the alias now holds the new content
    assert raw.read_text(encoding="utf-8") == original  # but raw.csv is untouched
    assert os.stat(raw).st_ino != os.stat(alias).st_ino  # the hard link was severed, not mutated


# === payload_declares_source: the pure-function half of the same finding ===


@requires_hardlinks
def test_payload_declares_source_matches_a_hardlinked_alias(tmp_path: Path) -> None:
    """The pure-function half uses the same filesystem-identity rule."""
    raw = tmp_path / "raw.csv"
    raw.write_text("data", encoding="utf-8")
    alias = tmp_path / "raw-alias.csv"
    os.link(raw, alias)
    payload = {
        "datasets": [{"source": {"kind": "path", "path": str(raw)}}],
    }
    resolved_alias = os.path.realpath(str(alias))
    assert os.stat(str(raw)).st_ino == os.stat(resolved_alias).st_ino
    assert payload_declares_source(payload, resolved_alias) is True
    # Control: the identical spelling IS caught, same function.
    resolved_raw = os.path.realpath(str(raw))
    assert payload_declares_source(payload, resolved_raw) is True


@requires_hardlinks
def test_unrelated_hardlinked_destination_remains_a_valid_project_save(tmp_path: Path) -> None:
    """Link count alone is not a refusal; identity must match a source."""
    raw = tmp_path / "raw.csv"
    raw.write_text("source", encoding="utf-8")
    unrelated = tmp_path / "unrelated.bin"
    unrelated.write_text("unrelated", encoding="utf-8")
    dest = tmp_path / "workspace.dwk"
    os.link(unrelated, dest)
    assert os.stat(unrelated).st_ino == os.stat(dest).st_ino

    api = DesktopApi()
    path = _grant_write(api, dest)
    content = _workspace_json_declaring(str(raw))
    out = api.write_project_file(path, content)

    assert out["ok"] is True, out
    assert dest.read_text(encoding="utf-8") == content
    assert unrelated.read_text(encoding="utf-8") == "unrelated"


def test_unreachable_source_resolution_does_not_block_an_ordinary_destination(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Offline-source errors keep the normal save path's skip-on-error rule."""
    source = tmp_path / "offline.csv"
    dest = tmp_path / "workspace.dwk"
    dest.write_text("old project", encoding="utf-8")
    resolved_dest = os.path.realpath(str(dest))
    payload = {"datasets": [{"source": {"kind": "path", "path": str(source)}}]}
    real_realpath = os.path.realpath

    def unavailable_realpath(path: os.PathLike[str] | str, *args: Any, **kwargs: Any) -> str:
        if os.path.normcase(os.fspath(path)) == os.path.normcase(str(source)):
            raise OSError("source volume unavailable")
        return real_realpath(path, *args, **kwargs)

    monkeypatch.setattr("quantized.desktop_source_identity.os.path.realpath", unavailable_realpath)
    assert not payload_declares_source(payload, resolved_dest)


@requires_hardlinks
def test_missing_source_is_skipped_but_an_unexpected_identity_error_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    unrelated = tmp_path / "unrelated.bin"
    unrelated.write_text("unrelated", encoding="utf-8")
    dest = tmp_path / "workspace.dwk"
    os.link(unrelated, dest)
    missing = tmp_path / "offline.csv"
    payload = {"datasets": [{"source": {"kind": "path", "path": str(missing)}}]}

    # A definitely absent source cannot share the destination's identity.
    assert not payload_declares_source(payload, os.path.realpath(str(dest)))

    real_stat = os.stat

    def unavailable_stat(path: os.PathLike[str] | str, *args: Any, **kwargs: Any) -> os.stat_result:
        if os.path.normcase(os.fspath(path)) == os.path.normcase(str(missing)):
            raise OSError("source volume unavailable")
        return real_stat(path, *args, **kwargs)

    monkeypatch.setattr("quantized.desktop_source_identity.os.stat", unavailable_stat)
    assert payload_declares_source(payload, os.path.realpath(str(dest)))
