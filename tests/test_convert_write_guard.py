"""``qz convert`` and ``save_table`` never rewrite a file they did not just
create, and never an input (P1.2 box 4, ``tests/test_write_sites.py``;
``io/write_guard.py``)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

import quantized.api as qz
from convert_fixtures import loops_opj
from quantized.cli_convert import convert_command
from quantized.datastruct import DataStruct
from quantized.io.write_guard import WriteRefused

_SENTINEL = "a user's own file\n"


def test_an_existing_output_is_not_overwritten(tmp_path: Path) -> None:
    src = loops_opj(tmp_path / "loops.opj")
    out = tmp_path / "out"
    out.mkdir()
    taken = out / "loops.opj__Scan2.csv"
    taken.write_text(_SENTINEL, encoding="utf-8")
    report = qz.convert_origin_project(src, out, "csv")
    by_book = {(b["book"], b["sheet"]): b for b in report["books"]}
    assert by_book[("Scan2", 1)]["status"] == "skipped"
    assert by_book[("Scan2", 1)]["problems"][-1].endswith("exists, not overwritten")
    assert by_book[("Loop1", 1)]["status"] == "written"
    assert report["status"] == "partial"
    assert taken.read_text(encoding="utf-8") == _SENTINEL


def test_overwrite_replaces_an_output_that_is_not_an_input(tmp_path: Path) -> None:
    src = loops_opj(tmp_path / "loops.opj")
    out = tmp_path / "out"
    args = [str(src), "--to", "csv", "--out", str(out)]
    assert convert_command(args) == 0
    (out / "loops.opj__Scan2.csv").write_text(_SENTINEL, encoding="utf-8")
    assert convert_command(args) == 2  # the report exists: refused before any work
    assert (out / "loops.opj__Scan2.csv").read_text(encoding="utf-8") == _SENTINEL
    assert convert_command([*args, "--overwrite"]) == 0
    assert (out / "loops.opj__Scan2.csv").read_text(encoding="utf-8").startswith("# quantized")
    report = json.loads((out / "convert-report.json").read_text(encoding="utf-8"))
    assert report["summary"]["ok"] == 1


def test_an_input_is_never_a_target_even_with_overwrite(tmp_path: Path) -> None:
    src = loops_opj(tmp_path / "loops.opj")
    out = tmp_path / "out"
    out.mkdir()
    victim = out / "loops.opj__Scan2.csv"  # a raw source that happens to share the name
    victim.write_text(_SENTINEL, encoding="utf-8")
    report = qz.convert_origin_project(src, out, "csv", overwrite=True, protect=[victim])
    scan = next(b for b in report["books"] if b["book"] == "Scan2")
    assert scan["status"] == "skipped" and "is an input" in scan["problems"][-1]
    assert victim.read_text(encoding="utf-8") == _SENTINEL


def test_the_report_is_never_written_over_an_input(tmp_path: Path) -> None:
    src = loops_opj(tmp_path / "loops.opj")
    before = src.read_bytes()
    code = convert_command(
        [str(src), "--to", "csv", "--out", str(tmp_path / "o"), "--report", str(src), "--overwrite"]
    )
    assert code == 2 and src.read_bytes() == before


def test_a_symlink_to_an_input_is_never_written_through(tmp_path: Path) -> None:
    src = loops_opj(tmp_path / "loops.opj")
    before = src.read_bytes()
    out = tmp_path / "out"
    out.mkdir()
    link = out / "loops.opj.dwk"
    try:
        os.symlink(src, link)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are not available here")
    report = qz.convert_origin_project(src, out, "dwk", overwrite=True)
    assert report["status"] == "failed" and report["outputs"] == []
    assert all("is an input" in b["problems"][-1] for b in report["books"])
    assert src.read_bytes() == before


def test_save_table_refuses_an_existing_path_by_default(tmp_path: Path) -> None:
    ds = DataStruct.create([1.0, 2.0], [[3.0], [4.0]], labels=["m"], units=[""])
    target = tmp_path / "t.csv"
    target.write_text(_SENTINEL, encoding="utf-8")
    with pytest.raises(WriteRefused, match="exists, not overwritten"):
        qz.save_table(ds, target)
    assert target.read_text(encoding="utf-8") == _SENTINEL
    qz.save_table(ds, target, overwrite=True)
    assert qz.load(target).values.tolist() == [[3.0], [4.0]]
    with pytest.raises(WriteRefused, match="is an input"):
        qz.save_table(ds, target, overwrite=True, protect=[target])
