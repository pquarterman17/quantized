"""Desktop file-dialog bridge (MAIN_PLAN #31).

The dialog calls themselves need a real pywebview window, so they are exercised
through a fake window rather than mocked away entirely — the logic worth testing
is what the bridge does with what a dialog RETURNS (consent, normalization,
cancellation) and how it classifies a path's status.
"""

from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from quantized.desktop_bridge import DesktopApi
from quantized.desktop_consent import (
    clear_consent,
    dir_grant_count,
    is_consented,
    is_declared_source,
    is_dir_consented,
    is_write_consented,
)


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


def _workspace_json(marker: str = "x") -> str:
    """A minimal, structurally valid `.dwk` payload (P1.2 box 2) — matches the
    top-level shape frontend/src/lib/workspace.ts's `parseWorkspace` itself
    requires (`format`, a supported `version`, a `datasets` array). `marker`
    lands in a dataset id so two calls are distinguishable for a byte-compare."""
    return (
        '{"format": "quantized-workspace", "version": 4, '
        f'"datasets": [{{"id": "{marker}"}}]}}'
    )


def _workspace_json_declaring(*source_paths: str) -> str:
    """A `.dwk` payload whose datasets declare `source.path` = each of
    `source_paths` — for the P1.7 declared-source tests below (a real
    project-open is how `set_declared_sources` gets populated)."""
    import json as _json

    return _json.dumps(
        {
            "format": "quantized-workspace",
            "version": 4,
            "datasets": [
                {"id": f"d{i}", "source": {"kind": "path", "path": p}}
                for i, p in enumerate(source_paths)
            ],
        }
    )


def _open_project_declaring(tmp_path: Path, *source_paths: str) -> DesktopApi:
    """Open (via a real FakeWindow dialog, exactly like a genuine
    open_project_file) a `.dwk` that declares `source_paths` as dataset
    sources — the ONLY way `set_declared_sources` gets populated, per the
    P1-A fix. Returns the API instance with that project now "open"."""
    project = tmp_path / "workspace.dwk"
    project.write_text(_workspace_json_declaring(*source_paths), encoding="utf-8")
    api = DesktopApi()
    api.attach(FakeWindow([str(project)]))
    api.open_project_file()
    return api


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


# --- pick_relink_directory / revoke_relink_dir (C1) -------------------------
#
# Unlike `pick_directory` above, this dialog IS a consent gesture — the one
# folder picker in the app that grants anything. RED-FIRST: `pick_relink_directory`
# and `revoke_relink_dir` are NEW methods; before this slice `is_dir_consented`
# did not exist at all, so every assertion below fails on `main`.


def test_pick_relink_directory_grants_read_consent_for_the_chosen_folder(tmp_path: Path) -> None:
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "run1.csv").write_text("x", encoding="utf-8")
    api = DesktopApi()
    api.attach(FakeWindow([str(tmp_path)]))
    out = api.pick_relink_directory()
    assert out["path"] == os.path.realpath(str(tmp_path))
    assert is_dir_consented(str(sub / "run1.csv"))


def test_pick_relink_directory_cancel_grants_nothing() -> None:
    """Session cancellation: backing out of the dialog must not mint a
    grant for whatever `directory` happened to be passed as a hint."""
    api = DesktopApi()
    api.attach(FakeWindow(None))
    out = api.pick_relink_directory()
    assert out["path"] is None
    assert dir_grant_count() == 0


def test_pick_relink_directory_without_a_window_reports_rather_than_raises() -> None:
    assert DesktopApi().pick_relink_directory()["path"] is None


def test_pick_relink_directory_reports_a_dialog_failure(tmp_path: Path) -> None:
    api = DesktopApi()
    api.attach(FakeWindow(RuntimeError("dialog boom")))
    out = api.pick_relink_directory()
    assert out["path"] is None
    assert "boom" in out["error"]
    assert dir_grant_count() == 0


def test_pick_relink_directory_refuses_a_result_that_is_not_a_directory(tmp_path: Path) -> None:
    """A dialog implementation returning something bogus (not a real
    directory) must not silently grant it."""
    f = _csv(tmp_path)
    api = DesktopApi()
    api.attach(FakeWindow([str(f)]))
    out = api.pick_relink_directory()
    assert out["path"] is None
    assert dir_grant_count() == 0


def test_pick_relink_directory_never_widens_write_consent(tmp_path: Path) -> None:
    api = DesktopApi()
    api.attach(FakeWindow([str(tmp_path)]))
    api.pick_relink_directory()
    resolved = os.path.realpath(str(tmp_path / "whatever.dwk"))
    assert not is_write_consented(resolved)


def test_revoke_relink_dir_clears_the_grant(tmp_path: Path) -> None:
    api = DesktopApi()
    api.attach(FakeWindow([str(tmp_path)]))
    api.pick_relink_directory()
    f = tmp_path / "run1.csv"
    f.write_text("x", encoding="utf-8")
    assert is_dir_consented(str(f))
    out = api.revoke_relink_dir()
    assert out == {"ok": True}
    assert not is_dir_consented(str(f))
    assert dir_grant_count() == 0


def test_revoke_relink_dir_is_idempotent_with_nothing_granted() -> None:
    assert DesktopApi().revoke_relink_dir() == {"ok": True}


def test_typed_path_never_receives_a_directory_grant(tmp_path: Path) -> None:
    """The hard rule: nothing short of a REAL dialog return can mint a
    directory grant. There is no bridge method a typed path can reach that
    grants one — this asserts the negative directly against the module the
    grant would have to live in."""
    sub = tmp_path / "typed_root"
    sub.mkdir()
    # No dialog was ever involved — just the plain filesystem fact that this
    # directory exists. Nothing in this module's public surface can turn
    # that fact into a grant on its own.
    assert not is_dir_consented(str(sub))
    assert not is_dir_consented(str(sub / "candidate.csv"))


# --- path_status: the offline-vs-missing distinction -----------------------


def test_path_status_ok_for_an_existing_file(tmp_path: Path) -> None:
    assert DesktopApi().path_status(str(_csv(tmp_path)))["state"] == "ok"


def test_path_status_missing_when_the_root_is_reachable(tmp_path: Path) -> None:
    """The file is genuinely gone: its drive/root is right there."""
    assert DesktopApi().path_status(str(tmp_path / "nope.csv"))["state"] == "missing"


def _unmounted_volume_path() -> str:
    """A path on a volume that is definitely not mounted, per platform.

    The UNC prefix is assembled from ``chr(92)`` rather than written as a
    literal: this test was briefly WRONG because a quoting layer ate one
    backslash, leaving a single-backslash string. That is a rooted LOCAL path,
    whose anchor is a real drive, so the test asserted "offline" against a case
    that is legitimately "missing" and blamed the implementation for it.
    """
    if os.name == "nt":
        b = chr(92)
        return b + b + "no-such-server" + b + "share" + b + "run.dat"
    # POSIX mounts volumes under these prefixes, so an absent mount point IS
    # the statement "that volume is not attached".
    base = "/Volumes" if sys.platform == "darwin" else "/mnt"
    return f"{base}/qz-no-such-volume/run.dat"


def test_path_status_offline_when_the_volume_is_not_mounted() -> None:
    """A vanished share must NOT be reported as a deleted file — that is how an
    app talks a user into discarding a source that is fine and will be back."""
    assert DesktopApi().path_status(_unmounted_volume_path())["state"] == "offline"


def test_path_status_distinguishes_a_local_miss_from_an_unmounted_volume(
    tmp_path: Path,
) -> None:
    """The two states must not collapse — that distinction IS the sub-item. A
    gone file on a live volume is 'missing'; an unmounted volume is 'offline',
    and only the first justifies suggesting the source is gone."""
    local_miss = DesktopApi().path_status(str(tmp_path / "gone.csv"))["state"]
    remote_state = DesktopApi().path_status(_unmounted_volume_path())["state"]
    assert local_miss == "missing"
    assert remote_state == "offline"


@pytest.mark.skipif(os.name == "nt", reason="POSIX-only limitation")
def test_path_status_reports_missing_outside_a_recognizable_volume() -> None:
    """The documented POSIX limit, pinned so it stays deliberate.

    Outside a known mount prefix, POSIX cannot distinguish an unmounted share
    from a path that never existed. We report 'missing' there rather than guess
    'offline', because over-reporting offline would suppress a real "your file
    is gone" — the more useful of the two messages to get right.
    """
    assert DesktopApi().path_status("/qz-no-such-dir/run.dat")["state"] == "missing"


# --- probe_source / grant_source_paths (P1.7) -------------------------------


def test_probe_source_reports_ok_without_a_checksum_when_unconsented(tmp_path: Path) -> None:
    """RED-FIRST: this is a NEW method. A path nobody granted read consent
    for gets reachability + size/mtime but NEVER a checksum — the consent
    ruling this slice adds (desktop_bridge.py's own doc)."""
    f = _csv(tmp_path)
    out = DesktopApi().probe_source(str(f))
    assert out["state"] == "ok"
    assert out["size"] == f.stat().st_size
    assert "checksum" not in out


def test_probe_source_computes_a_checksum_once_read_consented(tmp_path: Path) -> None:
    f = _csv(tmp_path)
    resolved = os.path.realpath(str(f))
    api = DesktopApi()
    api.attach(FakeWindow([str(f)]))
    api.pick_files()  # grants read consent the ordinary way
    out = api.probe_source(resolved)
    assert out["state"] == "ok"
    assert out["checksum"].startswith("sha256:")


def test_probe_source_computes_a_checksum_for_a_candidate_under_a_relink_dir_grant(
    tmp_path: Path,
) -> None:
    """C1: the whole point of the directory grant kind. RED-FIRST — before
    this slice, a relink CANDIDATE path (never individually picked, never a
    declared source) could never get a checksum at all; `probe_source`
    consulted only `is_consented`."""
    sub = tmp_path / "new_location"
    sub.mkdir()
    candidate = sub / "run1.csv"
    candidate.write_text("T,M\n1,10\n", encoding="utf-8")
    api = DesktopApi()
    api.attach(FakeWindow([str(sub)]))
    api.pick_relink_directory()  # the ONLY thing that can grant this
    out = api.probe_source(str(candidate))
    assert out["state"] == "ok"
    assert out["checksum"].startswith("sha256:")


def test_probe_source_still_no_checksum_for_a_typed_unconsented_candidate(
    tmp_path: Path,
) -> None:
    """The negative half of the test above: a candidate path under a folder
    that was only TYPED (no `pick_relink_directory` call at all) still gets
    no checksum — the fix is scoped exactly to a real dialog grant."""
    sub = tmp_path / "typed_new_location"
    sub.mkdir()
    candidate = sub / "run1.csv"
    candidate.write_text("T,M\n1,10\n", encoding="utf-8")
    out = DesktopApi().probe_source(str(candidate))
    assert out["state"] == "ok"
    assert "checksum" not in out


def test_probe_source_missing_and_offline_states(tmp_path: Path) -> None:
    api = DesktopApi()
    assert api.probe_source(str(tmp_path / "nope.csv"))["state"] == "missing"
    assert api.probe_source(_unmounted_volume_path())["state"] == "offline"


def test_probe_source_invalid_path_never_raises() -> None:
    # A null byte cannot be resolved by realpath — must report, not raise.
    # CI FOUND (2026-08-18): this is exactly the case that was Windows-red —
    # `os.path.realpath` swallows the null on Linux/macOS (degrading through
    # `OSError`, already caught below), but succeeds SILENTLY on Windows,
    # deferring the actual `ValueError: embedded null character in path` to
    # a later syscall this method's own `os.stat`/checksum step must catch
    # too (see `desktop_source_probe.py`'s matching, deterministic pin).
    out = DesktopApi().probe_source("bad\x00path")
    assert out["state"] == "invalid"


def test_probe_source_degrades_when_realpath_itself_raises_valueerror(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """RED-FIRST, deterministic on every host (unlike the fixture above,
    which only reproduces the bug on Windows): force `os.path.realpath` to
    raise the EXACT Windows failure class and confirm the resolve step at
    `probe_source`'s own entry point degrades to `invalid` rather than
    propagating — pinning the realpath step, not just the stat step."""

    def _boom(_path: str) -> str:
        raise ValueError("embedded null character in path")

    monkeypatch.setattr("quantized.desktop_bridge.os.path.realpath", _boom)
    out = DesktopApi().probe_source("bad\x00path")
    assert out["state"] == "invalid"


def test_grant_source_paths_degrades_when_realpath_itself_raises_valueerror(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Same deterministic pin as above, for `grant_source_paths`'s own
    realpath loop — a malformed candidate must be silently dropped
    (never granted, never raised), not blow up the whole batch."""

    def _boom(_path: str) -> str:
        raise ValueError("embedded null character in path")

    monkeypatch.setattr("quantized.desktop_bridge.os.path.realpath", _boom)
    out = DesktopApi().grant_source_paths(["bad\x00path"])
    assert out["paths"] == []


def test_grant_source_paths_wraps_grant_paths_exactly(tmp_path: Path) -> None:
    """A NEW method. Once a path is DECLARED (a real project naming it as a
    dataset source was opened via a real dialog — the P1-A enforcement),
    it extends READ consent (checked via the SAME `is_consented` store
    `pick_files` uses) for exactly the files it was given, silently
    dropping anything that isn't a real file — mirroring `grant_paths`'s
    own directory-skip rule (a hostile/stale entry must not be able to
    widen consent to a directory)."""
    f = _csv(tmp_path)
    api = _open_project_declaring(tmp_path, str(f), str(tmp_path))  # second is a directory
    out = api.grant_source_paths([str(f), str(tmp_path)])
    resolved = os.path.realpath(str(f))
    assert out["paths"] == [resolved]
    assert is_consented(resolved)


def test_grant_source_paths_then_probe_source_yields_a_checksum(tmp_path: Path) -> None:
    """The end-to-end P1.7 relink path: open a project that declares a
    source, grant consent for it (no second dialog), THEN probe with a
    real checksum — this is what lets a relink-folder dry-run diff many
    files without a dialog per file."""
    f = _csv(tmp_path)
    resolved = os.path.realpath(str(f))
    api = _open_project_declaring(tmp_path, str(f))
    api.grant_source_paths([str(f)])
    out = api.probe_source(resolved)
    assert out["checksum"].startswith("sha256:")


# --- P1-A (adversarial review, SECURITY): grant_source_paths must not trust
# its own argument list — it is a REQUEST against the backend-tracked
# declared-source set of the CURRENTLY OPEN project, never an authority on
# its own. The exploit this closes: a bare passthrough to `grant_paths` made
# `grant_source_paths` an unconditional arbitrary-file-read-consent oracle
# — any JS in the window (no dialog, no project even open) could self-grant
# read consent for any path (e.g. a user's SSH key) via the ordinary
# `/api/parsers/import` route, which already honors `consented_path()`.


def test_grant_source_paths_rejects_a_path_no_project_has_declared(tmp_path: Path) -> None:
    """RED-FIRST (load-bearing security test): with NO project open at all,
    nothing is declared — a path must not be grantable just because a
    caller asks for it."""
    victim = tmp_path / "id_rsa"
    victim.write_text("-----BEGIN OPENSSH PRIVATE KEY-----", encoding="utf-8")
    resolved = os.path.realpath(str(victim))
    api = DesktopApi()

    out = api.grant_source_paths([str(victim)])

    assert out["paths"] == []
    assert not is_consented(resolved)
    assert not is_declared_source(resolved)


def test_grant_source_paths_accepts_a_path_the_opened_project_actually_declared(
    tmp_path: Path,
) -> None:
    """RED-FIRST (the other half of the same test): a path the CURRENTLY
    open project's own payload names as a source must still work — the fix
    narrows eligibility, it does not break the legitimate relink flow."""
    declared = _csv(tmp_path, "run1.csv")
    resolved = os.path.realpath(str(declared))
    api = _open_project_declaring(tmp_path, str(declared))

    out = api.grant_source_paths([str(declared)])

    assert out["paths"] == [resolved]
    assert is_consented(resolved)


def test_grant_source_paths_compositional_pin_poisoned_path_from_loaded_dwk(
    tmp_path: Path,
) -> None:
    """Compositional pin: `store/relink.ts`'s argument list is computed from
    the frontend's own in-memory `datasets` array, which could diverge from
    what the ACTUALLY-opened project declared (e.g. a dataset injected by
    some other path). Even mixed into the SAME request as a legitimate
    declared source, a path the opened project never named is dropped —
    the enforcement is per-path, not "trust the whole batch once one path
    checks out"."""
    legit = _csv(tmp_path, "legit.csv")
    victim = tmp_path / "id_rsa"
    victim.write_text("secret key material", encoding="utf-8")
    api = _open_project_declaring(tmp_path, str(legit))  # victim NOT declared

    out = api.grant_source_paths([str(legit), str(victim)])

    assert out["paths"] == [os.path.realpath(str(legit))]
    assert not is_consented(os.path.realpath(str(victim)))


def test_grant_source_paths_declared_set_replaces_wholesale_on_reopen(tmp_path: Path) -> None:
    """Opening project B must not leave project A's declared sources still
    eligible — a stale grant from a previous project is exactly the kind of
    residual trust this fix must not leave lying around."""
    a_source = _csv(tmp_path, "a.csv")
    b_source = _csv(tmp_path, "b.csv")
    _open_project_declaring(tmp_path, str(a_source))
    api_b = _open_project_declaring(tmp_path, str(b_source))

    out = api_b.grant_source_paths([str(a_source), str(b_source)])

    assert out["paths"] == [os.path.realpath(str(b_source))]
    assert not is_consented(os.path.realpath(str(a_source)))


def test_opening_a_project_revokes_a_prior_relink_directory_grant(tmp_path: Path) -> None:
    """C1: project-change revocation. A relink "Browse..." grant from
    project A's session must not silently keep covering project B's
    candidate paths after A closes and B opens — the same "wholesale
    replace, not accumulate" moment `set_declared_sources` already uses
    for declared sources (`_read_granted`)."""
    a_dir = tmp_path / "a_new_location"
    a_dir.mkdir()
    api = DesktopApi()
    api.attach(FakeWindow([str(a_dir)]))
    api.pick_relink_directory()
    assert is_dir_consented(str(a_dir / "whatever.csv"))

    _open_project_declaring(tmp_path)  # project B opens in a fresh api below,
    # but the revocation is process-global (dir grants aren't per-DesktopApi
    # instance), so opening through ANY api instance must revoke it.
    assert not is_dir_consented(str(a_dir / "whatever.csv"))


def test_declared_sources_only_recorded_on_a_successful_project_read(tmp_path: Path) -> None:
    """A cancelled/failed project open must not leave a stale declared set
    from whatever WAS previously open — but must also not itself declare
    anything (there is no content to have read)."""
    declared = _csv(tmp_path, "run1.csv")
    api = _open_project_declaring(tmp_path, str(declared))
    assert is_declared_source(os.path.realpath(str(declared)))

    # A cancelled second open (FakeWindow returns None) must not clear OR
    # extend what's already declared — it never reached _read_granted at all.
    api.attach(FakeWindow(None))
    api.open_project_file()
    assert is_declared_source(os.path.realpath(str(declared)))


def test_probe_source_permission_denied_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    f = _csv(tmp_path)
    resolved = os.path.realpath(str(f))

    real_stat = os.stat

    def _boom(path: str, *a: Any, **kw: Any) -> Any:
        if path == resolved:
            raise PermissionError("Permission denied")
        return real_stat(path, *a, **kw)

    monkeypatch.setattr("quantized.desktop_source_probe.os.stat", _boom)
    out = DesktopApi().probe_source(resolved)
    assert out["state"] == "permission_denied"


# --- save_file_dialog / write_project_file (P1.1 C2) ------------------------
#
# The FakeWindow pattern above stands in for the dialog; the interesting
# behaviour is what the bridge does with a chosen SAVE path — grant write
# consent for it (and ONLY it), and refuse to write anywhere that consent was
# never granted for. That refusal is the new security rule this slice adds
# (previously nothing in this module could write at all), so it is exercised
# red-first: the test existed and failed against a stub before
# `write_project_file` enforced the check.


def test_save_file_dialog_grants_write_consent_but_not_read_consent(tmp_path: Path) -> None:
    dest = tmp_path / "new_workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    out = api.save_file_dialog("new_workspace.dwk")
    resolved = os.path.realpath(str(dest))
    assert out["path"] == resolved
    assert is_write_consented(resolved)
    # Picking a SAVE destination must not also grant READ access to it (or to
    # anything else) — the two consent kinds are deliberately independent.
    assert not is_consented(resolved)


def test_save_file_dialog_cancel_returns_none_and_grants_nothing() -> None:
    api = DesktopApi()
    api.attach(FakeWindow(None))
    out = api.save_file_dialog("workspace.dwk")
    assert out["path"] is None
    assert "error" not in out


def test_save_file_dialog_without_a_window_reports_rather_than_raises() -> None:
    out = DesktopApi().save_file_dialog("workspace.dwk")
    assert out["path"] is None
    assert "error" in out


def test_save_file_dialog_reports_a_dialog_failure() -> None:
    api = DesktopApi()
    api.attach(FakeWindow(RuntimeError("no display")))
    out = api.save_file_dialog("workspace.dwk")
    assert out["path"] is None
    assert "no display" in out["error"]


def test_write_project_file_lands_content_at_a_granted_path(tmp_path: Path) -> None:
    dest = tmp_path / "workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    save_out = api.save_file_dialog("workspace.dwk")
    content = _workspace_json("1")
    write_out = api.write_project_file(save_out["path"], content)
    assert write_out["ok"] is True
    assert write_out["path"] == save_out["path"]
    assert dest.read_text(encoding="utf-8") == content


def test_write_project_file_refuses_a_path_that_was_never_granted(tmp_path: Path) -> None:
    """RED-FIRST: the new security rule. Nothing granted this path write
    consent (no save dialog ever returned it), so the write must be refused
    — and must not touch the filesystem at all."""
    dest = tmp_path / "unconsented.dwk"
    out = DesktopApi().write_project_file(str(dest), "should not land")
    assert out["ok"] is False
    assert "error" in out
    assert not dest.exists()


def test_write_project_file_refuses_a_path_only_granted_for_reading(tmp_path: Path) -> None:
    """Read consent (from opening/picking a file) must not double as write
    consent — the two grant kinds stay independent even for the same path."""
    f = _csv(tmp_path, "existing.dwk")
    api = DesktopApi()
    api.attach(FakeWindow([str(f)]))
    picked = api.pick_files()  # grants READ consent only
    out = api.write_project_file(picked["paths"][0], "overwrite attempt")
    assert out["ok"] is False
    assert f.read_text(encoding="utf-8") != "overwrite attempt"


def test_write_project_file_overwrite_leaves_no_stray_temp_file(tmp_path: Path) -> None:
    """Atomic-ish shape: temp file + os.replace, never a leftover partial
    write sitting next to the target (P1.2 owns full crash-recovery; this
    slice only guarantees the write itself isn't torn)."""
    dest = tmp_path / "workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    save_out = api.save_file_dialog("workspace.dwk")
    second = _workspace_json("second")
    api.write_project_file(save_out["path"], _workspace_json("first"))
    api.write_project_file(save_out["path"], second)
    assert dest.read_text(encoding="utf-8") == second
    leftovers = [p for p in tmp_path.iterdir() if p.name != dest.name]
    assert leftovers == []


def test_write_project_file_reports_an_os_error_rather_than_raising(tmp_path: Path) -> None:
    # A directory can never be replaced by a file write — a realistic OSError
    # source that must come back as a reported error, not an exception into JS.
    directory = tmp_path / "a_directory.dwk"
    directory.mkdir()
    api = DesktopApi()
    api.attach(FakeWindow([str(directory)]))
    save_out = api.save_file_dialog("a_directory.dwk")
    out = api.write_project_file(save_out["path"], _workspace_json())
    assert out["ok"] is False
    assert "error" in out


# --- open_project_file / read_project_file (P1.1 C3's "minimal read path") --


def test_open_project_file_reads_content_and_grants_read_consent(tmp_path: Path) -> None:
    f = _csv(tmp_path, "workspace.dwk")
    f.write_text('{"v": 1}', encoding="utf-8")
    api = DesktopApi()
    api.attach(FakeWindow([str(f)]))
    out = api.open_project_file()
    resolved = os.path.realpath(str(f))
    assert out["path"] == resolved
    assert out["content"] == '{"v": 1}'
    assert is_consented(resolved)


def test_open_project_file_cancel_returns_none_without_reading() -> None:
    api = DesktopApi()
    api.attach(FakeWindow(None))
    out = api.open_project_file()
    assert out["path"] is None
    assert "content" not in out


def test_open_project_file_without_a_window_reports_rather_than_raises() -> None:
    out = DesktopApi().open_project_file()
    assert out["path"] is None
    assert "error" in out


def test_open_project_file_rejects_a_directory(tmp_path: Path) -> None:
    api = DesktopApi()
    api.attach(FakeWindow([str(tmp_path)]))  # a directory, not a project file
    out = api.open_project_file()
    assert out["path"] is None
    assert "error" in out


def test_read_project_file_reuses_an_open_grant_without_a_new_dialog(tmp_path: Path) -> None:
    f = _csv(tmp_path, "workspace.dwk")
    f.write_text('{"v": 2}', encoding="utf-8")
    api = DesktopApi()
    api.attach(FakeWindow([str(f)]))
    api.open_project_file()  # grants read consent
    out = api.read_project_file(str(f))
    assert out["content"] == '{"v": 2}'


def test_read_project_file_reuses_a_write_grant_from_a_prior_save(tmp_path: Path) -> None:
    """Reopening a project saved earlier THIS session (e.g. a Recent Projects
    click) must not require a fresh dialog when only a write grant exists."""
    dest = tmp_path / "workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    save_out = api.save_file_dialog("workspace.dwk")
    content = _workspace_json("3")
    api.write_project_file(save_out["path"], content)
    out = api.read_project_file(save_out["path"])
    assert out["content"] == content


def test_read_project_file_refuses_an_unconsented_path(tmp_path: Path) -> None:
    """RED-FIRST alongside the write refusal above: a path nothing ever
    granted must not be readable through this call either."""
    f = _csv(tmp_path, "never_picked.dwk")
    out = DesktopApi().read_project_file(str(f))
    assert out["path"] is None
    assert "content" not in out
    assert "error" in out


# --- write_project_file validation-before-replace (P1.2 box 2/3) -----------
#
# RED-FIRST: none of these passed before `write_project_file` gained a
# structural check ahead of the temp-file+`os.replace`. The point is that a
# bad payload — or a real OS failure mid-write — must never land ANY bytes at
# the real path: the file that was there before stays byte-identical.


def test_write_project_file_refuses_invalid_json_and_leaves_prior_file_untouched(
    tmp_path: Path,
) -> None:
    dest = tmp_path / "workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    save_out = api.save_file_dialog("workspace.dwk")
    good = _workspace_json("good")
    assert api.write_project_file(save_out["path"], good)["ok"] is True

    out = api.write_project_file(save_out["path"], "not json at all")
    assert out["ok"] is False
    assert "error" in out
    assert dest.read_text(encoding="utf-8") == good
    leftovers = [p for p in tmp_path.iterdir() if p.name != dest.name]
    assert leftovers == []


def test_write_project_file_refuses_a_payload_missing_the_workspace_shape(
    tmp_path: Path,
) -> None:
    """Well-formed JSON that simply isn't a workspace (wrong `format`, no
    `datasets` array) must be refused the same way — valid JSON alone is not
    "structurally sound"."""
    dest = tmp_path / "workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    save_out = api.save_file_dialog("workspace.dwk")
    good = _workspace_json("good")
    api.write_project_file(save_out["path"], good)

    for bad in (
        '{"format": "quantized-workspace", "version": 4}',  # no datasets
        '{"format": "not-a-workspace", "version": 4, "datasets": []}',
        '{"format": "quantized-workspace", "version": 99, "datasets": []}',
        "[1, 2, 3]",  # valid JSON, not even an object
    ):
        out = api.write_project_file(save_out["path"], bad)
        assert out["ok"] is False, bad
        assert dest.read_text(encoding="utf-8") == good


def test_write_project_file_validation_never_touches_disk_on_a_first_write(
    tmp_path: Path,
) -> None:
    """No prior file exists at all — a validation failure must still leave
    nothing behind (not even an empty file), matching the "abort before the
    replace" contract for the from-scratch case."""
    dest = tmp_path / "new_workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    save_out = api.save_file_dialog("new_workspace.dwk")
    out = api.write_project_file(save_out["path"], "garbage")
    assert out["ok"] is False
    assert not dest.exists()
    assert list(tmp_path.iterdir()) == []


def test_write_project_file_preserves_the_prior_file_when_os_replace_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mocked OS failure mode #1: `os.replace` itself fails (a realistic stand-
    in for a permission error or a hostile filesystem event mid-write). The
    previous good generation must survive byte-for-byte and no temp file may
    be left behind."""
    dest = tmp_path / "workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    save_out = api.save_file_dialog("workspace.dwk")
    good = _workspace_json("good")
    api.write_project_file(save_out["path"], good)

    def _boom(_src: str, _dst: str) -> None:
        raise OSError("Permission denied")

    monkeypatch.setattr("quantized.desktop_bridge.os.replace", _boom)
    out = api.write_project_file(save_out["path"], _workspace_json("new"))
    assert out["ok"] is False
    assert "Permission denied" in out["error"]
    assert dest.read_text(encoding="utf-8") == good
    leftovers = [p for p in tmp_path.iterdir() if p.name != dest.name]
    assert leftovers == []


def test_write_project_file_preserves_the_prior_file_when_the_disk_is_full(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mocked OS failure mode #2: the write itself fails partway through
    (`ENOSPC` — disk full). Same preservation guarantee as the `os.replace`
    failure above, exercised on the earlier failure point."""
    dest = tmp_path / "workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    save_out = api.save_file_dialog("workspace.dwk")
    good = _workspace_json("good")
    api.write_project_file(save_out["path"], good)

    real_fdopen = os.fdopen

    def _fdopen_then_fail_on_write(*args: Any, **kw: Any) -> Any:
        handle = real_fdopen(*args, **kw)

        def _write(_data: str) -> int:
            raise OSError("No space left on device")

        handle.write = _write  # close() on __exit__ still works normally
        return handle

    monkeypatch.setattr("quantized.desktop_bridge.os.fdopen", _fdopen_then_fail_on_write)
    out = api.write_project_file(save_out["path"], _workspace_json("new"))
    assert out["ok"] is False
    assert "No space left on device" in out["error"]
    assert dest.read_text(encoding="utf-8") == good
    leftovers = [p for p in tmp_path.iterdir() if p.name != dest.name]
    assert leftovers == []


# --- P1.2 box 3: fsync durability (kill-process / power-loss half) ---------
#
# Prior to this, `_replace` did `os.fdopen -> f.write -> os.replace` with NO
# `flush`+`fsync` on the temp file before the rename -- on a delayed-
# allocation filesystem a crash or power loss right after `os.replace`
# returns can leave a zero-length/partial `.dwk` AT THE REAL PATH, exactly
# the "half-written file" the module's docstring claimed could not happen.


def test_write_project_file_fsyncs_the_temp_file_before_os_replace(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """RED-FIRST: `os.fsync` must be called (on the temp file's fd) BEFORE
    `os.replace` runs the atomic rename -- order recorded via two wrapped
    real calls, not merely "both happened somewhere". A best-effort
    directory `fsync` runs too (see the sibling tests below), so this only
    asserts the FIRST `fsync` precedes the rename -- that first one is the
    temp file's, since the directory can only be fsynced after the replace
    it is meant to make durable has already happened."""
    dest = tmp_path / "workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    save_out = api.save_file_dialog("workspace.dwk")

    calls: list[str] = []
    real_fsync = os.fsync
    real_replace = os.replace

    def _fsync(fd: int) -> None:
        calls.append("fsync")
        real_fsync(fd)

    def _replace(src: str, dst: str) -> None:
        calls.append("replace")
        real_replace(src, dst)

    monkeypatch.setattr("quantized.desktop_bridge.os.fsync", _fsync)
    monkeypatch.setattr("quantized.desktop_bridge.os.replace", _replace)

    out = api.write_project_file(save_out["path"], _workspace_json("good"))

    assert out["ok"] is True
    assert "fsync" in calls and "replace" in calls
    assert calls.index("fsync") < calls.index("replace"), calls


def test_write_project_file_preserves_the_prior_file_when_fsync_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mocked OS failure mode #3: the temp file's `fsync` itself fails
    (`EIO` -- a realistic stand-in for a failing disk). Same preservation
    guarantee as the `os.replace`/disk-full failures above: the prior good
    generation survives byte-for-byte, `ok` is False with the error text
    reported, and no `.qz-write-*` stray is left behind (the failure is
    inside the `with os.fdopen(...)` block, before `os.replace`, so the
    `finally` cleanup still runs)."""
    dest = tmp_path / "workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    save_out = api.save_file_dialog("workspace.dwk")
    good = _workspace_json("good")
    api.write_project_file(save_out["path"], good)

    def _boom(_fd: int) -> None:
        raise OSError("Input/output error")

    monkeypatch.setattr("quantized.desktop_bridge.os.fsync", _boom)
    out = api.write_project_file(save_out["path"], _workspace_json("new"))

    assert out["ok"] is False
    assert "Input/output error" in out["error"]
    assert dest.read_text(encoding="utf-8") == good
    leftovers = [p for p in tmp_path.iterdir() if p.name != dest.name]
    assert leftovers == []


def test_write_project_file_directory_fsync_failure_does_not_fail_the_save(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The best-effort directory `fsync` (POSIX-only, `_fsync_directory_
    best_effort`) is opened read-only -- the ONLY `os.open` call this module
    makes with `O_RDONLY` (the temp file goes through `tempfile.mkstemp`,
    not a bare `os.open`). Forcing exactly that call to fail (as Windows'
    "no directory fd" AttributeError, or a filesystem that rejects it,
    would in practice) must NOT turn an otherwise-successful save into a
    reported failure -- the file fsync before the replace is what is
    load-bearing; the directory fsync only narrows a smaller window
    further."""
    dest = tmp_path / "workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    save_out = api.save_file_dialog("workspace.dwk")

    real_open = os.open

    def _open_raising_for_readonly(path: str, flags: int, *a: Any, **kw: Any) -> int:
        if flags == os.O_RDONLY:
            raise OSError("directory fsync not supported here")
        return real_open(path, flags, *a, **kw)

    monkeypatch.setattr("quantized.desktop_bridge.os.open", _open_raising_for_readonly)

    good = _workspace_json("good")
    out = api.write_project_file(save_out["path"], good)

    assert out["ok"] is True
    assert dest.read_text(encoding="utf-8") == good


# --- stray .qz-write-* cleanup (P2-2, adversarial review) -------------------
#
# A crash between the successful temp write and `os.replace` (killed process,
# OS crash, power loss — the window is real: both are separate syscalls)
# strands an anonymous `.qz-write-*` file next to the target. Nothing swept
# it up before this — the P1.1 docstring on `write_project_file` explicitly
# punted "detecting and offering to restore a stray temp file" to P1.2, and
# P1.2 never actually did it. RED-FIRST: this test plants a stray file with
# the module's own prefix and proves the NEXT successful save removes it.


def test_write_project_file_removes_a_stray_qz_write_temp_before_the_next_save(
    tmp_path: Path,
) -> None:
    dest = tmp_path / "workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    save_out = api.save_file_dialog("workspace.dwk")
    good = _workspace_json("good")
    api.write_project_file(save_out["path"], good)

    # Simulate a crash between a PRIOR write's temp-file creation and its
    # `os.replace` — exactly the module's own naming convention, so this is
    # unambiguously ours to clean up (never someone else's dotfile). Backdated
    # past `cleanup_stray_write_temps`'s age floor (R1 round-3, F3): a
    # genuinely stale crash leftover is old by the time cleanup runs again,
    # unlike a DIFFERENT save's temp file that is only ever seconds old —
    # see the sibling test below for that distinction being load-bearing.
    stray = tmp_path / ".qz-write-deadbeef"
    stray.write_text("half-written garbage from a crashed save", encoding="utf-8")
    old = time.time() - 3600.0
    os.utime(stray, (old, old))

    second = _workspace_json("second")
    out = api.write_project_file(save_out["path"], second)

    assert out["ok"] is True
    assert dest.read_text(encoding="utf-8") == second
    # The stray file is gone, and the save itself is otherwise unaffected —
    # no OTHER leftovers (a fresh crash-mid-write of THIS save would still be
    # cleaned by the existing finally-block, covered by the sibling test above).
    remaining = [p for p in tmp_path.iterdir() if p.name != dest.name]
    assert remaining == [], f"stray temp file(s) survived a successful save: {remaining}"


def test_write_project_file_stray_cleanup_is_best_effort_and_never_blocks_the_save(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A stray file that fails to unlink (permissions, a race with another
    process) must not turn a perfectly good save into a reported failure —
    cleanup is opportunistic, not load-bearing."""
    dest = tmp_path / "workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    save_out = api.save_file_dialog("workspace.dwk")
    api.write_project_file(save_out["path"], _workspace_json("good"))

    stray = tmp_path / ".qz-write-cannotremove"
    stray.write_text("x", encoding="utf-8")
    old = time.time() - 3600.0
    os.utime(stray, (old, old))  # past the age floor (R1 round-3, F3) — eligible for cleanup

    real_remove = os.remove

    def _remove_raises_for_the_stray(path: str, *a: Any, **kw: Any) -> None:
        if os.path.basename(path) == stray.name:
            raise OSError("permission denied")
        real_remove(path, *a, **kw)

    monkeypatch.setattr("quantized.desktop_bridge.os.remove", _remove_raises_for_the_stray)

    second = _workspace_json("second")
    out = api.write_project_file(save_out["path"], second)

    assert out["ok"] is True
    assert dest.read_text(encoding="utf-8") == second
    # The stray survives (cleanup failed, as forced above) but the save
    # itself must have succeeded regardless.
    assert stray.exists()


def test_write_project_file_a_concurrent_save_never_deletes_the_others_in_flight_temp(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """F3 (R1 round-3 review): `cleanup_stray_write_temps` used to run
    UNPROTECTED right before every write's own temp-file creation and
    swept up ANY `.qz-write-*` file regardless of age — including a
    DIFFERENT, still in-flight save's own temp file. A second, ALSO
    unlocked (no `lock_token`) save to the same directory could delete the
    first save's temp file out from under it between its `os.fdopen` and
    its `os.replace`, failing that `os.replace` outright.

    Forced here (not sampled): save 1's `os.replace` is paused mid-call, on
    a real thread, via an `Event` — so its temp file is GUARANTEED to
    still be on disk while save 2 runs its own cleanup pass on the exact
    same directory. Proves save 1's temp survives that pass, and save 1
    itself still completes successfully once released."""
    dest = tmp_path / "workspace.dwk"
    api = DesktopApi()
    api.attach(FakeWindow([str(dest)]))
    save_out = api.save_file_dialog("workspace.dwk")
    path = save_out["path"]

    real_replace = os.replace
    paused_once = threading.Event()
    release_replace = threading.Event()
    call_count = {"n": 0}

    def _pausing_replace(src: str, dst: str) -> None:
        call_count["n"] += 1
        if call_count["n"] == 1:
            paused_once.set()
            assert release_replace.wait(timeout=10.0), "test never released the paused replace"
        real_replace(src, dst)

    monkeypatch.setattr("quantized.desktop_bridge.os.replace", _pausing_replace)

    outcome: dict[str, Any] = {}

    def _save_one() -> None:
        outcome["one"] = api.write_project_file(path, _workspace_json("from-save-one"))

    t = threading.Thread(target=_save_one)
    t.start()
    try:
        assert paused_once.wait(timeout=5.0), "save 1 never reached its paused os.replace"

        # Save 1's temp file must still be on disk RIGHT NOW — its
        # `os.replace` is blocked above, so nothing has renamed it away yet.
        in_flight_before = sorted(p.name for p in tmp_path.glob(".qz-write-*"))
        assert len(in_flight_before) == 1, in_flight_before

        # Save 2: a completely separate, ALSO-unlocked save to the SAME
        # directory. Its own `_replace` runs `cleanup_stray_write_temps`
        # FIRST — the exact call that, pre-fix, deleted save 1's temp file.
        out_two = api.write_project_file(path, _workspace_json("from-save-two"))
        assert out_two["ok"] is True

        # Save 1's temp file must have SURVIVED save 2's cleanup pass.
        in_flight_after = sorted(p.name for p in tmp_path.glob(".qz-write-*"))
        assert in_flight_after == in_flight_before, (
            f"save 2's cleanup deleted save 1's in-flight temp file: "
            f"before={in_flight_before} after={in_flight_after}"
        )
    finally:
        release_replace.set()
        t.join(timeout=10.0)

    assert not t.is_alive(), "save 1's thread hung"
    one = outcome["one"]
    assert isinstance(one, dict)
    assert one["ok"] is True, one
    # Save 1 replaced LAST (it was paused, then released) — its content wins.
    assert dest.read_text(encoding="utf-8") == _workspace_json("from-save-one")
