"""``/api/parsers/import`` live mode (the source watch's re-read): one byte
snapshot, an unfinished last line held (decode-aware), a read during which the
file changed refused, and a baseline the relink/pack verdicts compare equal."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.desktop_source_probe import probe_source_path
from quantized.io.live_text import complete_lines
from quantized.io.registry import is_line_text

client = TestClient(app)

HEAD = b"T,M\n1,10\n2,20\n"


def _live(path: Path, hold: bool = True) -> tuple[int, dict[str, object], dict[str, str]]:
    resp = client.post(
        "/api/parsers/import", json={"path": str(path), "live": True, "hold_partial": hold}
    )
    body = (
        resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    )
    return resp.status_code, body, dict(resp.headers)


@pytest.mark.parametrize(
    ("raw", "kept", "held"),
    [
        (b"", b"", False),
        (b"a\n1\n", b"a\n1\n", False),
        (b"a\n1\n2.7", b"a\n1\n", True),  # LF, half a row
        (b"a\r\n1\r\n2.7", b"a\r\n1\r\n", True),  # CRLF
        (b"a\r\n1\r", b"a\r\n1\r", False),  # CR of a CRLF: the line's content is complete
        (b"a\r1\r2\r", b"a\r1\r2\r", False),  # CR-only line endings are terminated
        (b"a\r1\r2.7", b"a\r1\r", True),
        (b"no newline yet", b"", True),
        (b"\xef\xbb\xbfa\n1\n2", b"\xef\xbb\xbfa\n1\n", True),  # UTF-8 BOM
    ],
)
def test_complete_lines_ascii_compatible(raw: bytes, kept: bytes, held: bool) -> None:
    assert complete_lines(raw) == (kept, held)


@pytest.mark.parametrize("codec", ["utf-16-le", "utf-16-be"])
def test_complete_lines_utf16_is_cut_on_code_units(codec: str) -> None:
    bom = b"\xff\xfe" if codec.endswith("le") else b"\xfe\xff"
    whole = bom + "T,M\r\n1,上\n".encode(codec)  # 上 = U+4E0A: a 0x0A byte that is not a newline
    assert complete_lines(whole) == (whole, False)
    tail = "2,7".encode(codec)
    assert complete_lines(whole + tail) == (whole, True)
    assert complete_lines(whole + tail + b"\x00") == (whole, True)  # half a code unit
    assert complete_lines(whole + "上".encode(codec)) == (whole, True)
    cr_only = bom + "T\r1\r".encode(codec)
    assert complete_lines(cr_only + tail) == (cr_only, True)
    assert complete_lines(bom) == (bom, False)


def test_only_line_text_formats_are_held(tmp_path: Path) -> None:
    csv = tmp_path / "a.csv"
    csv.write_bytes(HEAD)
    dat = tmp_path / "b.dat"
    dat.write_bytes(b"\xff\xfe" + "T M\n1 2\n".encode("utf-16-le"))
    png = tmp_path / "c.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\n")
    assert is_line_text(csv) and is_line_text(dat)
    assert not is_line_text(png)
    assert not is_line_text(tmp_path / "d.xrdml")


def test_a_half_written_row_is_held_then_read_in_full(tmp_path: Path) -> None:
    f = tmp_path / "run.csv"
    f.write_bytes(HEAD + b"3,3")  # a buffered logger flushed "3,3" of "3,30"
    status, body, headers = _live(f)
    assert status == 200, body
    assert body["time"] == [1, 2] and headers["x-live-held"] == "1"
    status, body, headers = _live(f, hold=False)  # the file stopped changing: no starvation
    assert body["time"] == [1, 2, 3] and headers["x-live-held"] == "0"


@pytest.mark.parametrize(
    "data",
    [
        HEAD.replace(b"\n", b"\r\n") + b"3,3",  # CRLF
        HEAD.replace(b"\n", b"\r") + b"3,3",  # CR only
        b"\xff\xfe" + (HEAD.decode() + "3,3").encode("utf-16-le"),  # UTF-16 (NULs everywhere)
    ],
)
def test_partial_lines_are_held_in_every_line_ending_and_encoding(
    tmp_path: Path, data: bytes
) -> None:
    f = tmp_path / "run.txt"
    f.write_bytes(data)
    status, body, headers = _live(f)
    assert status == 200, body
    assert body["time"] == [1, 2] and headers["x-live-held"] == "1"


def test_a_file_with_no_complete_line_is_not_read_yet(tmp_path: Path) -> None:
    f = tmp_path / "new.csv"
    f.write_bytes(b"T,M")
    assert _live(f)[0] == 409


def test_a_binary_format_is_never_cut(tmp_path: Path) -> None:
    f = tmp_path / "img.png"
    f.write_bytes(b"\x89PNG\r\n\x1a\nnot really")
    status, _body, headers = _live(f)
    assert headers.get("x-live-held") in (None, "0")  # 422 (unparseable), never a held read
    assert status in (200, 422)


def test_the_baseline_matches_the_desktop_probe_exactly(tmp_path: Path) -> None:
    f = tmp_path / "run.csv"
    f.write_bytes(HEAD + b"3,30\n")
    _status, _body, headers = _live(f)
    probe = probe_source_path(str(f), compute_checksum=True)
    # Through JSON both ways, as the client stores it and the bridge returns it.
    assert json.loads(headers["x-source-mtime"]) == json.loads(json.dumps(probe["mtime"]))
    assert int(headers["x-source-size"]) == probe["size"]
    assert headers["x-source-checksum"] == probe["checksum"]


def test_the_temp_copy_never_leaks_into_the_metadata(tmp_path: Path) -> None:
    f = tmp_path / "run.csv"
    f.write_bytes(HEAD)
    _status, body, _headers = _live(f)
    meta = body["metadata"]
    assert isinstance(meta, dict) and meta.get("source") == str(f)


def test_a_read_during_which_the_file_changed_is_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    f = tmp_path / "run.csv"
    f.write_bytes(HEAD)
    real = Path.read_bytes

    def racing(self: Path) -> bytes:
        data = real(self)
        if self == f:
            with f.open("ab") as fh:  # the instrument appends during the read
                fh.write(b"3,30\n")
        return data

    monkeypatch.setattr(Path, "read_bytes", racing)
    assert _live(f)[0] == 409
    monkeypatch.setattr(Path, "read_bytes", real)
    status, body, _ = _live(f)
    assert status == 200 and body["time"] == [1, 2, 3]


def test_without_live_the_import_route_is_unchanged(tmp_path: Path) -> None:
    f = tmp_path / "run.csv"
    f.write_bytes(HEAD + b"3,3")
    resp = client.post("/api/parsers/import", json={"path": str(f)})
    assert resp.status_code == 200 and "x-live-held" not in resp.headers


def test_a_short_complete_first_line_is_not_mistaken_for_none(tmp_path: Path) -> None:
    f = tmp_path / "tiny.csv"
    f.write_bytes(b"1\n2.5")  # "1\n" is a complete line, two bytes long
    assert _live(f)[0] != 409


def test_a_file_no_parser_claims_is_a_422_not_a_500(tmp_path: Path) -> None:
    f = tmp_path / "blob.spc"  # .spc with neither format's marker: "no parser"
    f.write_bytes(b"\x00\x00not an spc file\n")
    status, body, _ = _live(f)
    assert status == 422, body
