"""``routes/_columns.py``: the framed binary column transport round-trips.

Pure encoder/decoder tests (no server) plus the freshness guard for the
frontend decoder's fixture: ``frontend/src/lib/api/__fixtures__/
plotSeriesColumns.json`` holds the server's actual bytes for one request
and the JSON payload for the same request, and the frontend parity test
decodes the former and deep-equals the latter. This test re-derives both
from the live app so the committed fixture can never drift from what the
server really sends.
"""

from __future__ import annotations

import base64
import json
import struct
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.routes._columns import (
    COLUMNS_MEDIA_TYPE,
    decode_columns,
    encode_columns,
    wants_columns,
)

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "frontend" / "src" / "lib" / "api" / "__fixtures__" / "plotSeriesColumns.json"

# NaN, +Inf, -Inf, -0.0 and a two-row gap -- every value the JSON path treats
# specially (non-finite -> null) or that a naive float round trip could lose.
FIXTURE_DATASET: dict[str, Any] = {
    "time": [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
    "values": [
        [1.0, -0.0, 10.0],
        [None, 2.0, 20.0],
        [3.0, None, 30.0],
        [4.0, 4.5, None],
        [None, None, None],
        [None, None, None],
        [1e-300, 1e300, -1e300],
        [0.1, -2.5, 3.25],
    ],
    "labels": ["a", "b", "c"],
    "units": ["u", "", "V"],
    "metadata": {},
}
FIXTURE_REQUEST: dict[str, Any] = {"dataset": FIXTURE_DATASET, "y2_keys": [2]}
FIXTURE_BODY_TEXT = json.dumps(FIXTURE_REQUEST, separators=(",", ":"))

REGEN_HINT = (
    "frontend/src/lib/api/__fixtures__/plotSeriesColumns.json is stale relative to the "
    "live /api/plot/series column transport. Regenerate: "
    "`uv run python -c \"import tests.test_routes_columns as t; t.write_fixture()\"`"
)


def _cols(*cols: list[float]) -> list[np.ndarray]:
    return [np.asarray(c, dtype=float) for c in cols]


def test_round_trip_preserves_header_and_finite_values() -> None:
    series = [{"label": "m", "unit": "emu", "axis": 0}]
    header = {"series": series, "decimated": False, "window": None}
    x = [0.0, 1.0, 2.0, 3.0]
    y = [1.5, -0.0, 1e300, 1e-300]
    body = encode_columns(header, _cols(x, y))
    got_header, got = decode_columns(body)
    assert got_header == header
    assert [c.tolist() for c in got] == [x, y]
    assert np.signbit(got[1][1])  # -0.0 survives (JSON also keeps it)


def test_non_finite_values_become_nan_gaps() -> None:
    body = encode_columns({}, _cols([0.0, 1.0, 2.0], [np.nan, np.inf, -np.inf]))
    _, got = decode_columns(body)
    assert np.isnan(got[1]).all()  # +/-Inf are gaps too, matching the JSON path's null


def test_frame_layout_is_magic_length_padded_header_then_le_float64() -> None:
    body = encode_columns({"k": 1}, _cols([1.0], [2.0]))
    magic, header_len = struct.unpack_from("<4sI", body, 0)
    assert magic == b"QZC1"
    assert (8 + header_len) % 8 == 0  # columns start 8-byte aligned
    header_text = body[8 : 8 + header_len].decode("utf-8")
    assert json.loads(header_text) == {"k": 1, "n_columns": 2, "n_rows": 1}
    assert header_text.rstrip(" ") == header_text.rstrip()  # only space padding
    assert body[8 + header_len :] == struct.pack("<2d", 1.0, 2.0)


def test_empty_columns_and_no_columns() -> None:
    header, got = decode_columns(encode_columns({"a": []}, _cols([], [])))
    assert header == {"a": []}
    assert [c.tolist() for c in got] == [[], []]
    header, got = decode_columns(encode_columns({}, []))
    assert header == {} and got == []


@pytest.mark.parametrize(
    "bad",
    [
        {"data": [[1.0]]},
        {"n_columns": 1},
        {"n_rows": 1},
    ],
)
def test_reserved_header_keys_are_rejected(bad: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        encode_columns(bad, _cols([1.0]))


def test_ragged_or_2d_columns_are_rejected() -> None:
    with pytest.raises(ValueError, match="same length"):
        encode_columns({}, _cols([1.0, 2.0], [1.0]))
    with pytest.raises(ValueError, match="1-D"):
        encode_columns({}, [np.zeros((2, 2))])


def test_decode_rejects_a_foreign_or_truncated_body() -> None:
    good = encode_columns({}, _cols([1.0, 2.0]))
    with pytest.raises(ValueError):
        decode_columns(b"{}")
    with pytest.raises(ValueError):
        decode_columns(b"NOPE" + good[4:])
    with pytest.raises(ValueError):
        decode_columns(good[:-8])
    with pytest.raises(ValueError):
        decode_columns(good + b"\0" * 8)


def test_wants_columns_parses_the_accept_header() -> None:
    assert wants_columns(COLUMNS_MEDIA_TYPE)
    assert wants_columns(f"{COLUMNS_MEDIA_TYPE}, application/json;q=0.9")
    assert wants_columns(f"application/json, {COLUMNS_MEDIA_TYPE.upper()} ;q=0.5")
    assert not wants_columns(None)
    assert not wants_columns("")
    assert not wants_columns("*/*")
    assert not wants_columns("application/json")
    assert not wants_columns("application/x-quantized-columns-v9")


# --- frontend fixture freshness ---------------------------------------------


def _live_fixture() -> dict[str, Any]:
    # Loopback host: `write_fixture()` also runs outside pytest, where conftest's
    # `testserver` Host allowance is absent (security.host_allowed).
    client = TestClient(app, base_url="http://127.0.0.1")
    headers = {"content-type": "application/json"}
    as_json = client.post("/api/plot/series", content=FIXTURE_BODY_TEXT, headers=headers)
    as_columns = client.post(
        "/api/plot/series",
        content=FIXTURE_BODY_TEXT,
        headers={**headers, "accept": COLUMNS_MEDIA_TYPE},
    )
    assert as_json.status_code == 200 and as_columns.status_code == 200
    assert as_columns.headers["content-type"] == COLUMNS_MEDIA_TYPE
    return {
        "request": FIXTURE_REQUEST,
        "json": as_json.json(),
        "columns_base64": base64.b64encode(as_columns.content).decode("ascii"),
    }


def write_fixture() -> None:
    """Regenerate the committed frontend fixture from the live server."""
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    # One top-level key per line: readable in `git diff`, without the
    # one-number-per-line sprawl `indent=2` gives the nested arrays.
    live = _live_fixture()
    lines = [f"  {json.dumps(k)}: {json.dumps(v, separators=(',', ':'))}" for k, v in live.items()]
    FIXTURE.write_text("{\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8")


def test_frontend_fixture_matches_live_server_bytes() -> None:
    assert FIXTURE.exists(), REGEN_HINT
    committed = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert committed == _live_fixture(), REGEN_HINT


def test_frontend_fixture_exercises_every_special_value() -> None:
    """The fixture is only worth its bytes if it carries the cases the decoder
    must get right: NaN/Inf gaps, -0.0, an all-gap row pair, and a secondary axis."""
    committed = json.loads(FIXTURE.read_text(encoding="utf-8"))
    header, cols = decode_columns(base64.b64decode(committed["columns_base64"]))
    assert header["series"][2]["axis"] == 1
    assert len(cols) == 4
    assert np.isnan(cols[1][1]) and np.isnan(cols[2][2]) and np.isnan(cols[3][3])
    assert np.isnan(cols[1][4:6]).all() and np.isnan(cols[2][4:6]).all()
    assert cols[2][0] == 0.0 and np.signbit(cols[2][0])
