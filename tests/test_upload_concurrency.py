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

Each test builds its OWN app via ``create_app()`` and runs uvicorn with
``lifespan="off"``, rather than importing the process-global
``quantized.app.app`` and letting uvicorn run its lifespan: that lifespan's
shutdown hook (``quantized.app._app_lifespan``) calls
``quantized.jobs.jobs._pool.shutdown(...)`` -- and ``jobs`` is a **module-
level singleton** (``quantized/jobs.py``: ``jobs = JobStore()``), the SAME
object every route in every app instance shares and the SAME object
``tests/test_jobs.py`` submits work to directly. A fresh ``create_app()``
call alone would NOT avoid this (it still binds the same global ``jobs``);
only skipping the lifespan entirely does. Reproduced before this fix:
``uv run pytest tests/test_upload_concurrency.py tests/test_jobs.py`` failed
every ``global_jobs.submit(...)`` call in ``test_jobs.py`` with
``RuntimeError: cannot schedule new futures after shutdown`` once this
module's server had started and stopped -- in EITHER file order, since the
pollution outlives this module's own tests for the rest of the pytest
worker process. ``server.should_exit = True`` is likewise followed by
``thread.join(...)`` in every test here so the daemon thread is actually
gone (not just asked to stop) before the next test runs.

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
those are now chunked or bypassed (see the modules above). 120k rows keeps
the parse comfortably longer than one health-poll interval (50ms) on any
machine measured so far, without this test asserting a wall-clock floor on
it (see ``test_large_upload_does_not_starve_health_polling``'s docstring
for why that assertion was removed).

xdist-safe: binds an ephemeral port (``port=0``) and writes its fixture CSV
under ``tmp_path``, so parallel workers never collide.
"""

from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pytest
import uvicorn

from quantized.app import create_app

# Generous backstop only (CLAUDE.md test-determinism lesson: keep the clock
# as a loose backstop, never the primary assertion). The actual property
# under test -- "the parse ran off the event loop, and at least one health
# poll completed while the upload was still in flight" -- is load-invariant
# and asserted directly in test_large_upload_does_not_starve_health_polling;
# this bound only catches a gross regression (e.g. the offload silently
# stops happening) without being tunable to any particular machine's speed.
_HEALTH_LATENCY_BUDGET_S = 2.0


def _start_server() -> tuple[uvicorn.Server, int, threading.Thread]:
    """Run a FRESH app on a real ephemeral-port socket in a daemon thread,
    with the app's own lifespan turned off.

    A fresh ``create_app()`` (not the process-global ``quantized.app.app``)
    keeps this test's server from sharing any app-instance state with other
    tests. ``lifespan="off"`` additionally skips ``_app_lifespan``'s
    shutdown hook entirely -- necessary on top of the fresh app because that
    hook reaches into ``quantized.jobs.jobs``, a MODULE-LEVEL singleton every
    app instance shares (see this module's docstring for the incident a
    fresh app alone did not prevent).
    """
    config = uvicorn.Config(
        create_app(), host="127.0.0.1", port=0, log_level="warning", lifespan="off"
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10.0
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.05)
    assert server.started, "uvicorn did not start within 10s"
    port = server.servers[0].sockets[0].getsockname()[1]
    return server, port, thread


def _stop_server(server: uvicorn.Server, thread: threading.Thread) -> None:
    """Ask the server to exit and wait for its thread to actually finish --
    an un-joined daemon thread from a prior test can still be mid-request
    (or mid-lifespan) when the next test's server starts."""
    server.should_exit = True
    thread.join(timeout=10.0)


def _write_csv(path: Path, n_rows: int, n_cols: int = 6) -> None:
    rng = np.random.default_rng(0)
    data = rng.random((n_rows, n_cols))
    header = ",".join(f"c{i}" for i in range(n_cols))
    with path.open("w") as f:
        f.write(header + "\n")
        np.savetxt(f, data, delimiter=",", fmt="%.6f")


def _upload(
    base: str, csv_path: Path, result: dict[str, Any], in_flight: threading.Event
) -> None:
    """POST the upload, holding ``in_flight`` set for exactly the span of
    the HTTP call (set right before, cleared right after it returns) so a
    concurrent poller can tell whether its own request overlapped this one."""
    with csv_path.open("rb") as fh:
        in_flight.set()
        try:
            t0 = time.monotonic()
            resp = httpx.post(
                f"{base}/api/parsers/upload",
                files={"file": ("big.csv", fh, "text/csv")},
                timeout=120.0,
            )
            result["status_code"] = resp.status_code
            result["json"] = resp.json()
            result["elapsed"] = time.monotonic() - t0
        finally:
            in_flight.clear()


def _install_offloop_probe(
    monkeypatch: pytest.MonkeyPatch, loop_thread: threading.Thread
) -> dict[str, Any]:
    """Wrap ``routes.parsers._import_with_books`` so the test can assert it
    actually ran OFF the event loop: on a thread other than the one running
    uvicorn's loop (``loop_thread``, from ``_start_server``), AND with no
    asyncio event loop bound to that thread (``asyncio.get_running_loop()``
    raises outside one). This is the mechanism the fix relies on -- proving
    it directly is stronger than inferring it from timing alone.
    """
    import quantized.routes.parsers as parsers_mod

    original = parsers_mod._import_with_books
    probe: dict[str, Any] = {"called": False, "on_loop_thread": None, "loop_running": None}

    def wrapper(*args: Any, **kwargs: Any) -> Any:
        probe["called"] = True
        probe["on_loop_thread"] = threading.current_thread() is loop_thread
        try:
            asyncio.get_running_loop()
            probe["loop_running"] = True
        except RuntimeError:
            probe["loop_running"] = False
        return original(*args, **kwargs)

    monkeypatch.setattr(parsers_mod, "_import_with_books", wrapper)
    return probe


def test_small_upload_still_works(tmp_path: Path) -> None:
    """Sanity: the threadpool wrap doesn't change behaviour for the common,
    fast case."""
    server, port, thread = _start_server()
    base = f"http://127.0.0.1:{port}"
    try:
        csv_path = tmp_path / "small.csv"
        _write_csv(csv_path, n_rows=50)
        result: dict[str, Any] = {}
        _upload(base, csv_path, result, threading.Event())
        assert result["status_code"] == 200
        assert len(result["json"]["time"]) == 50
    finally:
        _stop_server(server, thread)


def test_large_upload_does_not_starve_health_polling(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A big CSV parse runs on a worker thread, so /api/health -- and by the
    same mechanism, job-queue polling and other windows' plot requests --
    stays responsive for the whole time the upload is being parsed.

    Asserts the LOAD-INVARIANT property (CLAUDE.md test-determinism lesson)
    rather than a two-sided wall-clock window: a fixed "parse >= 1.0s"
    lower bound was too slow on some machines/loads and too fast on others
    (a fast runner finishes the fixture parse before any GET even lands; a
    loaded/slow one blows past a fixed health-latency ceiling regardless of
    whether the fix works) -- either way the previous version could fail a
    correctly-fixed server or pass a broken one depending only on machine
    speed. What actually holds regardless of speed:

    1. At least one ``GET /api/health`` completes while the upload request
       is still in flight (an ``Event`` set for the exact span of the
       upload call, checked before AND after each poll).
    2. The parse (``_import_with_books``) actually ran off the event loop:
       on a different thread than uvicorn's, with no running asyncio loop
       bound to that thread (instrumented directly, not inferred).

    The 0.5s-style latency ceiling is kept ONLY as a generous backstop
    (``_HEALTH_LATENCY_BUDGET_S``, widened to 2.0s) to catch a gross
    regression, never as the primary assertion; the fixture size is chosen
    to be comfortably longer than one poll interval (see module docstring)
    but its wall-clock duration is otherwise never asserted on.
    """
    server, port, thread = _start_server()
    probe = _install_offloop_probe(monkeypatch, thread)
    base = f"http://127.0.0.1:{port}"
    try:
        csv_path = tmp_path / "big.csv"
        n_rows = 120_000
        _write_csv(csv_path, n_rows=n_rows)

        upload_result: dict[str, Any] = {}
        in_flight = threading.Event()
        upload_thread = threading.Thread(
            target=_upload, args=(base, csv_path, upload_result, in_flight)
        )
        upload_thread.start()

        # Let the upload actually reach the parse before polling starts.
        time.sleep(0.2)

        health_latencies: list[float] = []
        polled_while_in_flight = False
        deadline = time.monotonic() + 60.0
        while upload_thread.is_alive() and time.monotonic() < deadline:
            was_in_flight_before = in_flight.is_set()
            t0 = time.monotonic()
            r = httpx.get(f"{base}/api/health", timeout=5.0)
            health_latencies.append(time.monotonic() - t0)
            assert r.status_code == 200
            # Require the flag set on BOTH sides of the request so a poll
            # that merely started (or merely finished) during the upload's
            # in-flight window doesn't count as having "arrived" during it.
            if was_in_flight_before and in_flight.is_set():
                polled_while_in_flight = True
            time.sleep(0.05)

        upload_thread.join(timeout=60.0)
        assert not upload_thread.is_alive(), "upload never completed"

        assert upload_result["status_code"] == 200
        assert len(upload_result["json"]["time"]) == n_rows

        assert polled_while_in_flight, (
            "no GET /api/health completed while the upload was still in "
            "flight -- either the fixture finished too fast to exercise "
            "the starvation window (grow n_rows) or the server never "
            "answered health while parsing"
        )
        assert probe["called"], "the parse hook never fired -- test is broken"
        assert probe["on_loop_thread"] is False, (
            "_import_with_books ran ON the uvicorn event-loop thread, not "
            "a threadpool worker -- the offload regressed"
        )
        assert probe["loop_running"] is False, (
            "_import_with_books ran with a running asyncio event loop bound "
            "to its own thread -- it is not actually off the loop"
        )

        assert health_latencies, "no health poll landed while the upload was in flight"
        assert max(health_latencies) < _HEALTH_LATENCY_BUDGET_S, (
            f"GET /api/health took up to {max(health_latencies):.2f}s while a "
            f"{upload_result['elapsed']:.2f}s upload parse was in flight -- "
            "the parse is blocking the event loop"
        )
    finally:
        _stop_server(server, thread)


if __name__ == "__main__":  # pragma: no cover - manual timing runs
    raise SystemExit(pytest.main([__file__, "-v"]))
