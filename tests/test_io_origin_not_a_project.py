"""Files that are not Origin projects at all get an accurate import error.

A repository that tracks ``.opju`` files with Git LFS, cloned without
``git lfs pull``, leaves a short text "pointer" stub in place of each project;
a test fixture may be a text placeholder. The generic "bad header ... open it in
Origin Viewer" advice is wrong for both (no viewer opens a pointer), so the
readers say what the file IS. All content here is synthetic.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from quantized.io.origin_project import read_origin_project
from quantized.io.origin_project.container import OriginProjectError, bad_header

_LFS = b"version https://git-lfs.github.com/spec/v1\noid sha256:" + b"0" * 64 + b"\nsize 123456\n"


@pytest.mark.parametrize("suffix", [".opju", ".opj"])
def test_git_lfs_pointer_says_fetch_with_git_lfs(tmp_path: Path, suffix: str) -> None:
    p = tmp_path / f"stub{suffix}"
    p.write_bytes(_LFS)
    with pytest.raises(OriginProjectError) as exc:
        read_origin_project(p)
    msg = str(exc.value)
    assert "Git LFS pointer" in msg
    assert "git lfs pull" in msg
    assert "123,456 bytes" in msg
    assert "Origin Viewer" not in msg and "bad header" not in msg


def test_lfs_pointer_without_size_line_still_recognized() -> None:
    err = bad_header(Path("x.opju"), b"version https://git-lfs.github.com/spec/v1\n", "CPYUA .opju")
    assert "Git LFS pointer" in str(err) and "bytes)" not in str(err)


@pytest.mark.parametrize("suffix", [".opju", ".opj"])
def test_plain_text_placeholder_is_called_a_text_file(tmp_path: Path, suffix: str) -> None:
    p = tmp_path / f"placeholder{suffix}"
    p.write_text("Placeholder for a dry run.\nNot a real project.\n", encoding="utf-8")
    with pytest.raises(OriginProjectError) as exc:
        read_origin_project(p)
    msg = str(exc.value)
    assert "plain-text file, not an Origin project" in msg
    assert "Origin Viewer" not in msg


def test_utf8_text_is_text_even_when_cut_mid_character() -> None:
    body = ("é" * 3000).encode("utf-8")  # 6000 bytes: byte 4096 splits a character
    assert "plain-text file" in str(bad_header(Path("t.opju"), body, "CPYUA .opju"))


def test_empty_file(tmp_path: Path) -> None:
    p = tmp_path / "empty.opju"
    p.write_bytes(b"")
    with pytest.raises(OriginProjectError, match=r"is empty \(0 bytes\)"):
        read_origin_project(p)


def test_other_origin_container_under_wrong_extension() -> None:
    opju_bytes = b"CPYUA 4.3811 999\n\x00\x01\x02"
    msg = str(bad_header(Path("a.opj"), opju_bytes, "CPYA .opj"))
    assert "CPYUA .opju project saved under the wrong extension" in msg
    assert "rename it to .opju" in msg
    opj_bytes = b"CPYA 4.2673 552#\n\x00\x01"
    msg = str(bad_header(Path("a.opju"), opj_bytes, "CPYUA .opju"))
    assert "rename it to .opj" in msg


def test_unknown_binary_keeps_the_generic_bad_header_advice() -> None:
    msg = str(bad_header(Path("b.opju"), b"\x00\x01\x02garbage\xff\xfe", "CPYUA .opju"))
    assert "does not look like a CPYUA .opju (bad header)" in msg
    assert "Origin Viewer" in msg
