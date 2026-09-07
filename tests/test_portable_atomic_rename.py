"""Unit tests for ``quantized.portable.atomic_rename`` (P1.7 "Pack Project"
PR 5 audit follow-up): the actual no-replace rename primitive that closes
the TOCTOU window the prior ``os.mkdir`` reservation in ``publish.py`` did
not (see that module's own docstring for the full history).

Two kinds of coverage here:

* **Real-primitive tests** — exercise ``rename_noreplace`` against the
  actual platform syscall. Skipped, with a precise reason, when
  ``no_replace_available()`` is ``False`` (this platform/kernel/filesystem
  has no such syscall to test).
* **Seam tests** — monkeypatch the one module-level primitive
  (``_platform_rename_noreplace``) to a fake, so the "unsupported" and
  "true no-replace semantics" branches are exercised deterministically
  regardless of what this CI runner's kernel actually supports.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from quantized.portable.atomic_rename import (
    NoReplaceUnsupported,
    no_replace_available,
    rename_noreplace,
)

_SKIP_REASON = (
    "this platform/kernel/filesystem has no atomic no-replace rename "
    "syscall available (no_replace_available() is False) -- nothing real "
    "to exercise here"
)

# Only the REAL-primitive tests below need this -- the seam tests further
# down monkeypatch the primitive and must run unconditionally on every
# platform, so this is applied per-test, never as a module-wide `pytestmark`.
_requires_real_primitive = pytest.mark.skipif(not no_replace_available(), reason=_SKIP_REASON)


# ── real-primitive tests ─────────────────────────────────────────────────


@_requires_real_primitive
def test_rename_noreplace_onto_an_absent_path_succeeds(tmp_path: Path) -> None:
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    src.write_text("hello")

    rename_noreplace(str(src), str(dst))

    assert not src.exists()
    assert dst.read_text() == "hello"


@_requires_real_primitive
def test_rename_noreplace_onto_an_existing_empty_directory_refuses(tmp_path: Path) -> None:
    src = tmp_path / "src"
    src.write_text("hello")
    dst = tmp_path / "dst"
    dst.mkdir()

    with pytest.raises(FileExistsError):
        rename_noreplace(str(src), str(dst))

    # both sides untouched -- no silent absorption of the empty directory
    assert src.read_text() == "hello"
    assert dst.is_dir()
    assert os.listdir(dst) == []


@_requires_real_primitive
def test_rename_noreplace_onto_an_existing_file_refuses(tmp_path: Path) -> None:
    src = tmp_path / "src"
    src.write_text("hello")
    dst = tmp_path / "dst"
    dst.write_text("already here")

    with pytest.raises(FileExistsError):
        rename_noreplace(str(src), str(dst))

    assert src.read_text() == "hello"
    assert dst.read_text() == "already here"


# ── the seam: fakes standing in for the platform primitive ──────────────


def _fake_true_no_replace(src: str, dst: str) -> None:
    """Models genuine no-replace semantics in pure Python, for a
    deterministic seam test that does not depend on this runner's actual
    kernel/filesystem support."""
    if os.path.lexists(dst):
        raise FileExistsError(f"[Errno 17] File exists: {dst!r}")
    os.rename(src, dst)


def _fake_unsupported(src: str, dst: str) -> None:
    raise NoReplaceUnsupported("fake: no atomic no-replace rename here")


def test_seam_fake_true_primitive_refuses_an_existing_destination(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Sanity check on the seam itself, unconditional (no skip): the fake
    behaves like a real no-replace primitive would, regardless of what
    this test runner's kernel supports."""
    monkeypatch.setattr(
        "quantized.portable.atomic_rename._platform_rename_noreplace", _fake_true_no_replace
    )
    src = tmp_path / "src"
    src.write_text("hello")
    dst = tmp_path / "dst"
    dst.mkdir()

    with pytest.raises(FileExistsError):
        rename_noreplace(str(src), str(dst))
    assert os.listdir(dst) == []


def test_seam_fake_unsupported_primitive_raises_no_replace_unsupported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "quantized.portable.atomic_rename._platform_rename_noreplace", _fake_unsupported
    )
    with pytest.raises(NoReplaceUnsupported):
        rename_noreplace("/does/not/matter/src", "/does/not/matter/dst")


@pytest.mark.skipif(
    os.name == "nt",
    reason="Windows's no_replace_available() is unconditionally True (plain "
    "os.rename IS the primitive there) -- nothing to probe",
)
def test_no_replace_available_reflects_the_current_primitive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``no_replace_available`` is cached -- clear the cache so this test
    can observe a monkeypatched primitive change the reported answer."""
    from quantized.portable import atomic_rename

    atomic_rename._no_replace_available_cached.cache_clear()
    monkeypatch.setattr(atomic_rename, "_platform_rename_noreplace", _fake_unsupported)
    try:
        assert atomic_rename.no_replace_available() is False
    finally:
        atomic_rename._no_replace_available_cached.cache_clear()
