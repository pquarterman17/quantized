"""Quick-converter guessing, per-file outcomes, never-overwrite and no partial outputs.

Priority inputs: PANalytical .xrdml, Rigaku / Bruker .raw, QD magnetometry
.dat, Origin .opj (committed fixtures or built here; the public Origin corpus
only read-only, in the realdata test).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import h5py
import pytest

import quantized.io.convert_containers as containers
from convert_fixtures import loops_opj
from quantized.cli_convert import convert_command
from quantized.io.convert_data import classify_outcome, convert_data_file
from quantized.io.convert_defaults import PROVISIONAL, default_format
from quantized.io.convert_guess import guess_inputs
from quantized.io.origin_convert import convert_origin_project
from test_io_bruker_raw import _make_raw

FIX = Path(__file__).parent / "fixtures"


def _stage(tmp: Path, *names: str) -> list[Path]:
    d = tmp / "in"
    d.mkdir(exist_ok=True)
    out = []
    for n in names:
        (d / n).write_bytes((FIX / n).read_bytes())
        out.append(d / n)
    return out


# ── guessing ────────────────────────────────────────────────────────────────


def test_guess_types_formats_names_and_columns(tmp_path: Path) -> None:
    rsm, scan, raw, qd = _stage(
        tmp_path,
        "xrdml_rsm_synthetic.xrdml", "xrdml_la2nio4.xrdml", "rigaku_yig.raw", "qd_edp124.dat",
    )  # fmt: skip
    bruker = tmp_path / "in" / "b.raw"
    bruker.write_bytes(_make_raw([5.0, 6.0, 7.0, 8.0]))
    g = {Path(x.path).name: x for x in guess_inputs([rsm, scan, raw, bruker, qd])}
    assert g["xrdml_rsm_synthetic.xrdml"].technique == "xrd.rsm"
    assert g["xrdml_rsm_synthetic.xrdml"].format == "h5"
    assert g["xrdml_rsm_synthetic.xrdml"].datasets[0].is_map
    assert [c[0] for c in g["xrdml_rsm_synthetic.xrdml"].datasets[0].columns] == [
        "2Theta", "Omega", "Intensity", "Qx", "Qz",
    ]  # fmt: skip
    s = g["xrdml_la2nio4.xrdml"]
    assert (s.kind, s.technique, s.format) == ("import_xrdml", "xrd.powder", "xy")
    assert s.kind_label.startswith("PANalytical")
    assert s.datasets[0].columns == (("2-Theta", "deg"), ("Intensity", "cps"))
    assert s.outputs == ("xrdml_la2nio4.xrdml.xy",) and PROVISIONAL in s.format_source
    assert g["rigaku_yig.raw"].kind_label.startswith("Rigaku")
    assert g["rigaku_yig.raw"].format == "xy"
    assert g["b.raw"].kind_label.startswith("Bruker") and g["b.raw"].format == "xy"
    q = g["qd_edp124.dat"]
    assert q.technique == "magnetometry.mvsh" and q.format == "csv"
    assert q.datasets[0].columns[:2] == (("Magnetic Field", "Oe"), ("Moment", "emu"))


def test_guess_can_be_overridden_and_never_suggests_an_existing_name(tmp_path: Path) -> None:
    (scan,) = _stage(tmp_path, "xrdml_la2nio4.xrdml")
    out = tmp_path / "out"
    out.mkdir()
    (out / "xrdml_la2nio4.xrdml.mat").write_bytes(b"x")
    (g,) = guess_inputs([scan], fmt="mat", out_dir=out)
    assert g.format == "mat" and g.format_source == "requested"
    assert g.outputs == ("xrdml_la2nio4.xrdml~2.mat",)
    assert guess_inputs([scan], fmt="mat")[0].outputs == ("xrdml_la2nio4.xrdml.mat",)
    with pytest.raises(ValueError, match="unknown format"):
        guess_inputs([scan], fmt="docx")


def test_guess_names_are_unique_across_inputs_and_errors_are_plain(tmp_path: Path) -> None:
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir()
    b.mkdir()
    for d in (a, b):
        (d / "s.dat").write_bytes((FIX / "qd_edp124.dat").read_bytes())
    ga, gb, gn = guess_inputs([a / "s.dat", b / "s.dat", tmp_path / "nope.dat"])
    assert ga.outputs == ("s.dat.csv",) and gb.outputs == ("s.dat~2.csv",)
    assert gn.error == "file not found"
    bad = tmp_path / "x.unknownext"
    bad.write_text("hi")
    (g,) = guess_inputs([bad])
    assert g.error and "no parser" in g.error and g.outputs == ()
    assert guess_inputs([tmp_path / "nope.dat"])[0].error == "file not found"
    assert guess_inputs([ga.path], deep=False)[0].kind == "import_qd_vsm"


def test_default_format_table_and_multi_dataset_rule() -> None:
    assert default_format("xrd.powder", 1) == "xy"
    assert default_format("generic", 1, has_map=True) == "h5"
    assert default_format("magnetometry.mvsh", 1) == "csv"
    assert default_format("xrd.powder", 3) == "xlsx"  # keep many datasets in one file
    assert default_format("anything", 1, origin=True) == "xlsx"


def test_guess_an_origin_project(tmp_path: Path) -> None:
    src = loops_opj(tmp_path / "loops.opj")
    (g,) = guess_inputs([src])
    assert g.kind == "origin_project" and g.format == "xlsx"
    assert g.outputs == ("loops.opj__Loop1.xlsx", "loops.opj__Scan2.xlsx")
    assert [d.name for d in g.datasets] == ["Loop1", "Loop1__sheet2", "Scan2"]
    assert guess_inputs([src], fmt="h5")[0].outputs == ("loops.opj.h5",)


# ── CLI: auto, --guess, outcomes ────────────────────────────────────────────


def test_cli_auto_converts_next_to_each_input_with_the_guessed_format(tmp_path: Path) -> None:
    scan, qd = _stage(tmp_path, "xrdml_la2nio4.xrdml", "qd_edp124.dat")
    assert convert_command([str(scan), str(qd)]) == 0
    assert (scan.parent / "xrdml_la2nio4.xrdml.xy").is_file()
    assert (qd.parent / "qd_edp124.dat.csv").is_file()
    report = json.loads((scan.parent / "convert-report.json").read_text(encoding="utf-8"))
    assert [f["format"] for f in report["files"]] == ["xy", "csv"]
    assert report["files"][0]["detected"]["technique"] == "xrd.powder"
    assert report["files"][0]["format_source"].startswith("auto")
    assert report["outcomes"] == {"done": 2, "partial": 0, "skipped-exists": 0, "failed": 0}


def test_cli_guess_prints_json_and_writes_nothing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    (scan,) = _stage(tmp_path, "xrdml_la2nio4.xrdml")
    assert convert_command([str(scan), "--guess"]) == 0
    doc = json.loads(capsys.readouterr().out)
    assert doc[0]["format"] == "xy" and doc[0]["outputs"] == ["xrdml_la2nio4.xrdml.xy"]
    assert sorted(p.name for p in scan.parent.iterdir()) == ["xrdml_la2nio4.xrdml"]


def test_cli_auto_on_an_origin_project_is_xlsx(tmp_path: Path) -> None:
    src = loops_opj(tmp_path / "loops.opj")
    assert convert_command([str(src), "--out", str(tmp_path / "o")]) == 0
    assert sorted(p.name for p in (tmp_path / "o").glob("*.xlsx")) == [
        "loops.opj__Loop1.xlsx", "loops.opj__Scan2.xlsx",
    ]  # fmt: skip


@pytest.mark.parametrize("fmt", ["xy", "h5", "nxs", "mat", "json", "npz"])
def test_origin_project_to_the_new_formats(fmt: str, tmp_path: Path) -> None:
    src = loops_opj(tmp_path / "loops.opj")
    report = convert_origin_project(src, tmp_path / "o", fmt)
    assert report["status"] == "ok", report
    files = sorted(p.name for p in (tmp_path / "o").iterdir())
    if fmt == "xy":
        assert files == [
            "loops.opj__Loop1.xy", "loops.opj__Loop1__sheet2.xy", "loops.opj__Scan2.xy",
        ]  # fmt: skip
    else:  # one container per project, a group per sheet
        assert files == [f"loops.opj.{fmt}"]
    if fmt in ("h5", "nxs"):
        with h5py.File(tmp_path / "o" / files[0]) as f:
            assert sorted(f) == ["Loop1", "Loop1__sheet2", "Scan2"]


@pytest.mark.realdata
def test_public_origin_corpus_project_converts_read_only(
    tmp_path: Path, corpus_dir: Path
) -> None:
    corpus = corpus_dir / "origin" / "public"
    # the third-party minimal project the Origin tests also use: read, never copied
    src = corpus / "BertySnack_norigin" / "src" / "norigin" / "minimal.opj"
    if not src.is_file():
        pytest.skip("public Origin corpus not present")
    before = src.read_bytes()
    code = convert_command([str(src), "--out", str(tmp_path / "o")])
    assert code in (0, 1)
    assert src.read_bytes() == before
    report = json.loads((tmp_path / "o" / "convert-report.json").read_text(encoding="utf-8"))
    assert report["files"][0]["outcome"] in ("done", "partial", "failed")
    assert report["files"][0]["format"] == "xlsx"


# ── never overwrite, no partial outputs ─────────────────────────────────────


def test_second_run_skips_existing_outputs_and_leaves_them_untouched(tmp_path: Path) -> None:
    (scan,) = _stage(tmp_path, "xrdml_la2nio4.xrdml")
    out = tmp_path / "o"
    first = convert_data_file(scan, out, "h5")
    assert first["status"] == "ok"
    target = out / first["outputs"][0]
    stamp = target.read_bytes()
    target.write_bytes(stamp + b"user edit")
    second = convert_data_file(scan, out, "h5")
    classify_outcome(second)
    assert second["status"] == "failed" and second["outputs"] == []
    assert second["outcome"] == "skipped-exists" and "already exists" in second["reason"]
    assert second["books"][0]["status"] == "skipped"
    assert target.read_bytes() == stamp + b"user edit"
    assert sorted(p.name for p in out.iterdir()) == [target.name]  # no stray temp files
    third = convert_data_file(scan, out, "h5", overwrite=True)
    assert third["status"] == "ok" and target.read_bytes() != stamp + b"user edit"


@pytest.mark.parametrize("fmt", ["csv", "xy", "xlsx", "h5", "mat", "json", "npz"])
def test_an_output_is_never_written_over_its_input(fmt: str, tmp_path: Path) -> None:
    (scan,) = _stage(tmp_path, "xrdml_la2nio4.xrdml")
    link = scan.parent / f"xrdml_la2nio4.xrdml.{fmt}"
    link.symlink_to(scan)  # an output path that resolves to the input
    before = scan.read_bytes()
    report = convert_data_file(scan, scan.parent, fmt, overwrite=True, protected=[scan])
    assert report["status"] == "failed" and scan.read_bytes() == before


def test_a_failure_part_way_leaves_no_partial_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (scan,) = _stage(tmp_path, "xrdml_la2nio4.xrdml")
    out = tmp_path / "o"

    def half_written(path: Path, datasets: object) -> None:
        path.write_bytes(b"HALF A FILE")  # a crash after the file was started
        raise OSError("disk full")

    monkeypatch.setattr(containers, "write_h5", half_written)
    report = convert_data_file(scan, out, "h5")
    assert report["status"] == "failed" and report["outputs"] == []
    assert "disk full" in report["books"][0]["problems"][0]
    assert list(out.iterdir()) == []  # neither the target nor a .part temp


def test_one_failing_dataset_does_not_stop_the_others(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from openpyxl import Workbook

    import quantized.io.convert_flat as flat

    wb = Workbook()
    ws = wb.active
    ws.title = "A"
    ws2 = wb.create_sheet("B")
    for sheet, head in ((ws, "v"), (ws2, "w")):
        sheet.append(["t", head])
        sheet.append([1.0, 2.0])
        sheet.append([2.0, 3.0])
    src = tmp_path / "ab.xlsx"
    wb.save(src)
    real = flat.format_xy

    def fail_on_a(ds: object, name: str, *, metadata: bool = True) -> bytes:
        if name == "A":
            raise ValueError("cannot be written as .xy")
        return real(ds, name, metadata=metadata)  # type: ignore[arg-type]

    monkeypatch.setattr(flat, "format_xy", fail_on_a)
    report = convert_data_file(src, tmp_path / "o", "xy")
    assert report["status"] == "partial" and report["outputs"] == ["ab.xlsx__B.xy"]
    a, b = report["books"]
    assert a["status"] == "skipped" and "cannot be written as .xy" in a["problems"][0]
    assert b["status"] == "written"
    assert sorted(p.name for p in (tmp_path / "o").iterdir()) == ["ab.xlsx__B.xy"]


def test_no_temp_file_survives_a_successful_run_and_perms_follow_umask(tmp_path: Path) -> None:
    (scan,) = _stage(tmp_path, "xrdml_la2nio4.xrdml")
    out = tmp_path / "o"
    convert_data_file(scan, out, "npz")
    names = [p.name for p in out.iterdir()]
    assert names == ["xrdml_la2nio4.xrdml.npz"]
    mode = (out / names[0]).stat().st_mode & 0o777
    if os.name == "posix":
        assert mode != 0o600  # not mkstemp's private mode
