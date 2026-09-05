"""A large ``/api/parsers/upload`` (CPU-bound parse) must not starve other
concurrent requests on the event loop.

Regression test for the measured incident: a 1M-row CSV upload (16.8s parse)
blocked a concurrent GET /api/health for 15.5s of that because the sync,
CPU-bound parse (``_import_with_books``) ran inline inside the ``async def``
``upload_file``/``upload_template`` handlers instead of via
``run_in_threadpool``. Drives the REAL app under a real uvicorn socket (not
``TestClient``/ASGI-transport) because the bug is specifically about the
event loop being blocked across two independent in-flight requests --
something an in-process ASGI transport that serializes handler execution on
the loop cannot exercise faithfully the way two real concurrent connections
can.

Fixture size (120k rows): NOT arbitrary. Wrapping only the parse call in
``run_in_threadpool`` was not sufficient by itself -- profiling this exact
test (see ``routes/parsers.py``'s ``_import_response`` and
``routes/_payload.py``'s ``jsonify``/``dumps_payload`` docstrings) found
FastAPI's own default response encoding (``jsonable_encoder`` +
``json.dumps``, run unconditionally on the event loop for a returned
``dict``) and a few single-call, whole-array conversions
(``ndarray.tolist()``, a bulk ``zip(*rows)`` transpose in
``io/delimited.py``) are each ALSO one uninterruptible CPython C loop that
can hold the GIL -- and so stall a concurrent request -- for its own
multi-hundred-millisecond span regardless of which thread runs it. All of
those are now chunked or bypassed (see the modules above). 120k rows was the
smallest size, of several measured directly against this live server, whose
worst observed health latency stayed comfortably under this test's budget
across repeated runs while its parse safely clears the "big enough to be a
real test" floor -- not a value picked to make one lucky run pass.

xdist-safe: binds an ephemeral port (``port=0``) and writes its fixture CSV
under ``tmp_path``, so parallel workers never collide.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pytest
import uvicorn

from quantized.app import app

# Generous, load-invariant budget (CLAUDE.md test-determinism lesson): the
# property under test is "health stays fast while a big parse is running on
# a worker thread, not the loop", which holds regardless of machine speed.
# The 0.5s ceiling is ~30x a healthy same-machine health round trip and still
# ~30x smaller than the multi-second parse it must be measured against, so it
# has wide headroom in both directions without weakening the assertion.
_HEALTH_LATENCY_BUDGET_S = 0.5
_MIN_PARSE_S = 1.0


def _start_server() -> tuple[uvicorn.Server, int]:
    """Run the real app on a real ephemeral-port socket in a daemon thread."""
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10.0
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.05)
    assert server.started, "uvicorn did not start within 10s"
    port = server.servers[0].sockets[0].getsockname()[1]
    return server, port


def _write_csv(path: Path, n_rows: int, n_cols: int = 6) -> None:
    rng = np.random.default_rng(0)
    data = rng.random((n_rows, n_cols))
    header = ",".join(f"c{i}" for i in range(n_cols))
    with path.open("w") as f:
        f.write(header + "\n")
        np.savetxt(f, data, delimiter=",", fmt="%.6f")


def _upload(base: str, csv_path: Path, result: dict[str, Any]) -> None:
    with csv_path.open("rb") as fh:
        t0 = time.monotonic()
        resp = httpx.post(
            f"{base}/api/parsers/upload",
            files={"file": ("big.csv", fh, "text/csv")},
            timeout=120.0,
        )
        result["status_code"] = resp.status_code
        result["json"] = resp.json()
        result["elapsed"] = time.monotonic() - t0


def test_small_upload_still_works(tmp_path: Path) -> None:
    """Sanity: the threadpool wrap doesn't change behaviour for the common,
    fast case."""
    server, port = _start_server()
    base = f"http://127.0.0.1:{port}"
    try:
        csv_path = tmp_path / "small.csv"
        _write_csv(csv_path, n_rows=50)
        result: dict[str, Any] = {}
        _upload(base, csv_path, result)
        assert result["status_code"] == 200
        assert len(result["json"]["time"]) == 50
    finally:
        server.should_exit = True


def test_large_upload_does_not_starve_health_polling(tmp_path: Path) -> None:
    """A big CSV parse runs on a worker thread, so /api/health -- and by the
    same mechanism, job-queue polling and other windows' plot requests --
    stays responsive for the whole time the upload is being parsed."""
    server, port = _start_server()
    base = f"http://127.0.0.1:{port}"
    try:
        csv_path = tmp_path / "big.csv"
        n_rows = 120_000
        _write_csv(csv_path, n_rows=n_rows)

        upload_result: dict[str, Any] = {}
        upload_thread = threading.Thread(
            target=_upload, args=(base, csv_path, upload_result)
        )
        upload_thread.start()

        # Let the upload actually reach the parse before polling starts.
        time.sleep(0.2)

        health_latencies: list[float] = []
        deadline = time.monotonic() + 60.0
        while upload_thread.is_alive() and time.monotonic() < deadline:
            t0 = time.monotonic()
            r = httpx.get(f"{base}/api/health", timeout=5.0)
            health_latencies.append(time.monotonic() - t0)
            assert r.status_code == 200
            time.sleep(0.05)

        upload_thread.join(timeout=60.0)
        assert not upload_thread.is_alive(), "upload never completed"

        assert upload_result["status_code"] == 200
        assert len(upload_result["json"]["time"]) == n_rows

        # If the parse finished before we even measured 1s, this run's
        # upload wasn't actually CPU-heavy enough to exercise the bug -- grow
        # n_rows rather than trust a fast pass as evidence of the fix.
        assert upload_result["elapsed"] >= _MIN_PARSE_S, (
            f"fixture parse only took {upload_result['elapsed']:.2f}s -- "
            "too fast to exercise the starvation bug; increase n_rows"
        )
        assert health_latencies, "no health poll landed while the upload was in flight"
        assert max(health_latencies) < _HEALTH_LATENCY_BUDGET_S, (
            f"GET /api/health took up to {max(health_latencies):.2f}s while a "
            f"{upload_result['elapsed']:.2f}s upload parse was in flight -- "
            "the parse is blocking the event loop"
        )
    finally:
        server.should_exit = True


if __name__ == "__main__":  # pragma: no cover - manual timing runs
    raise SystemExit(pytest.main([__file__, "-v"]))
