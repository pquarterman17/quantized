"""Unit tests for ``routes._uploadstream`` -- the bounded, chunked upload
writer (ROBUSTNESS_PLAN #3). Exercised directly with a fake async reader
instead of a real ``UploadFile``/TestClient round trip; the module has no
fastapi/starlette import, so this needs neither. HTTP-boundary behaviour
(413 mapping) is covered separately in ``test_api_parsers.py`` and
``test_api_import_template.py``.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from quantized.routes import _uploadstream
from quantized.routes._uploadstream import UploadTooLargeError, stream_to_path


class _FakeReader:
    """A minimal ``AsyncChunkReader``: yields pre-chopped chunks in order,
    ignoring the requested ``size`` (real streaming granularity is exercised
    end to end by the integration tests instead)."""

    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = list(chunks)

    async def read(self, size: int = -1) -> bytes:
        if not self._chunks:
            return b""
        return self._chunks.pop(0)


def test_stream_to_path_writes_all_bytes_under_cap(tmp_path: Path) -> None:
    dest = tmp_path / "out.dat"
    reader = _FakeReader([b"abc", b"def", b"ghi"])
    total = asyncio.run(stream_to_path(reader, dest, filename="out.dat", max_bytes=100))
    assert total == 9
    assert dest.read_bytes() == b"abcdefghi"


def test_stream_to_path_never_holds_more_than_one_chunk(tmp_path: Path) -> None:
    """A read of many small chunks accumulates correctly on disk -- this is
    the shape that matters (the memory-bound claim is that only one chunk
    is ever in a Python variable at once, not tested directly here, but the
    accumulation logic is the part that could get that wrong)."""
    dest = tmp_path / "many.dat"
    chunks = [bytes([i % 256]) for i in range(500)]
    reader = _FakeReader(chunks)
    total = asyncio.run(stream_to_path(reader, dest, filename="many.dat", max_bytes=10_000))
    assert total == 500
    assert dest.read_bytes() == b"".join(chunks)


def test_stream_to_path_raises_and_cleans_up_over_cap(tmp_path: Path) -> None:
    dest = tmp_path / "big.dat"
    reader = _FakeReader([b"0123456789", b"0123456789", b"0123456789"])  # 30 bytes total
    with pytest.raises(UploadTooLargeError) as excinfo:
        asyncio.run(stream_to_path(reader, dest, filename="big.dat", max_bytes=15))
    assert excinfo.value.filename == "big.dat"
    assert excinfo.value.limit == 15
    assert not dest.exists(), "partial file must be removed on overflow"


def test_stream_to_path_default_uses_module_constant(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With no ``max_bytes`` override, the cap is read from the module
    global AT CALL TIME (not baked into a default-parameter value), so a
    test (or a future admin knob) can monkeypatch it and have it apply."""
    monkeypatch.setattr(_uploadstream, "MAX_UPLOAD_BYTES", 5)
    dest = tmp_path / "small.dat"
    reader = _FakeReader([b"0123456789"])  # 10 bytes > monkeypatched 5-byte cap
    with pytest.raises(UploadTooLargeError):
        asyncio.run(stream_to_path(reader, dest, filename="small.dat"))


def test_stream_to_path_exactly_at_cap_succeeds(tmp_path: Path) -> None:
    dest = tmp_path / "exact.dat"
    reader = _FakeReader([b"12345"])
    total = asyncio.run(stream_to_path(reader, dest, filename="exact.dat", max_bytes=5))
    assert total == 5
    assert dest.read_bytes() == b"12345"


def test_upload_too_large_error_message_names_file_and_mb_limit() -> None:
    exc = UploadTooLargeError("mystery.opj", 512 * 1024 * 1024)
    assert "mystery.opj" in str(exc)
    assert "512 MB" in str(exc)
