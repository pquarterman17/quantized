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

Fixture size is now small (a few thousand rows) and load-bearing for
nothing: the in-flight window used to be produced by the fixture parsing
slowly enough for a fixed pre-poll sleep to land inside it, which is
exactly the wall-clock sizing CLAUDE.md's test-determinism section forbids.
It failed for real on ``backend (macos-latest, 3.13)`` once the CSV fast
path (#298) landed -- the 120k-row fixture started parsing faster than the
test's 0.2s pre-poll sleep on a fast runner, so the sleep elapsed, the
in-flight window closed, and no poll ever landed inside it, independent of
whether the offload fix was still in place. The window is now FORCED
instead of timed: ``_install_offloop_probe``'s wrapper sets a
``parse_started`` ``Event`` the instant the parse begins and then blocks on
a ``release`` ``Event`` (bounded by a generous timeout so a broken test
fails instead of hanging CI) before calling the real
``_import_with_books``. The test waits on ``parse_started``, issues exactly
one ``GET /api/health`` while the parse is deliberately held open, and only
then sets ``release``. This is load-invariant: the health request either
completes (the parse is off the loop) or times out (it isn't), regardless
of fixture size or machine speed.

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

# How long the probe blocks the parse for before giving up and proceeding
# anyway (so a genuinely broken test/handler times out instead of hanging
# CI forever), and the timeout on the health GET issued while the parse is
# held. Both are generous backstops, never sized to any fixture or machine.
_PARSE_RELEASE_TIMEOUT_S = 30.0
_HEALTH_REQUEST_TIMEOUT_S = 5.0


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


def _upload(base: str, csv_path: Path, result: dict[str, Any]) -> None:
    """POST the upload and record its outcome. The in-flight window itself
    is no longer tracked here -- ``_install_offloop_probe``'s
    ``parse_started``/``release`` events force and bound it directly."""
    with csv_path.open("rb") as fh:
        resp = httpx.post(
            f"{base}/api/parsers/upload",
            files={"file": ("small.csv", fh, "text/csv")},
            timeout=120.0,
        )
        result["status_code"] = resp.status_code
        result["json"] = resp.json()


def _install_offloop_probe(
    monkeypatch: pytest.MonkeyPatch, loop_thread: threading.Thread
) -> dict[str, Any]:
    """Wrap ``routes.parsers._import_with_books`` so the test can (1) assert
    it actually ran OFF the event loop and (2) FORCE the in-flight window
    instead of relying on the parse simply taking a while.

    On a thread other than the one running uvicorn's loop (``loop_thread``,
    from ``_start_server``), AND with no asyncio event loop bound to that
    thread (``asyncio.get_running_loop()`` raises outside one) -- this is
    the mechanism the fix relies on, and proving it directly is stronger
    than inferring it from timing alone.

    The wrapper sets ``parse_started`` the instant it is entered, then
    blocks on ``release`` (bounded by ``_PARSE_RELEASE_TIMEOUT_S`` so a
    broken test times out instead of hanging CI) before calling the real
    ``_import_with_books``. This holds the parse open on demand, so the
    test can deterministically land a request inside the in-flight window
    regardless of fixture size or machine speed -- no sleep, no polling
    loop, no dependency on how fast the parse itself runs.
    """
    import quantized.routes.parsers as parsers_mod

    original = parsers_mod._import_with_books
    probe: dict[str, Any] = {
        "called": False,
        "on_loop_thread": None,
        "loop_running": None,
        "parse_started": threading.Event(),
        "release": threading.Event(),
    }

    def wrapper(*args: Any, **kwargs: Any) -> Any:
        probe["called"] = True
        probe["on_loop_thread"] = threading.current_thread() is loop_thread
        try:
            asyncio.get_running_loop()
            probe["loop_running"] = True
        except RuntimeError:
            probe["loop_running"] = False
        probe["parse_started"].set()
        probe["release"].wait(timeout=_PARSE_RELEASE_TIMEOUT_S)
        return original(*args, **kwargs)

    monkeypatch.setattr(parsers_mod, "_import_with_books", wrapper)
    return probe


def test_large_upload_does_not_starve_health_polling(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A CSV parse runs on a worker thread, so /api/health -- and by the
    same mechanism, job-queue polling and other windows' plot requests --
    stays responsive for the whole time the upload is being parsed.

    Asserts the LOAD-INVARIANT property (CLAUDE.md test-determinism lesson)
    by FORCING the in-flight window rather than sizing it with a fixture
    row count and a pre-poll sleep. The previous version relied on a
    120k-row fixture taking "long enough" to parse for a fixed 0.2s sleep
    to land inside the window; once the CSV fast path (#298) made that
    parse fast, the sleep elapsed before any poll could run and the window
    closed with nothing ever landing in it -- a failure with no bearing on
    whether the offload fix itself was intact. Fixture size no longer
    matters (kept small: a few thousand rows) because the parse is now held
    open on demand by ``_install_offloop_probe``'s ``release`` ``Event``
    instead of by however long real parsing happens to take:

    1. Start the upload; wait for ``parse_started`` to confirm the parse
       has actually begun (bounded wait, so a hang fails loudly rather than
       hanging CI).
    2. While the parse is deliberately held inside the threadpool, issue
       exactly ONE ``GET /api/health`` and assert 200. This is the crux: if
       ``_import_with_books`` ran on the event loop instead of a worker
       thread, this request would time out (bounded by
       ``_HEALTH_REQUEST_TIMEOUT_S``) because the loop would still be
       blocked inside the held call -- there is no way to pass this by
       accident of timing.
    3. Release the parse, join the upload, and assert it completed with the
       expected row count.
    4. The parse (``_import_with_books``) actually ran off the event loop:
       on a different thread than uvicorn's, with no running asyncio loop
       bound to that thread (instrumented directly, not inferred).
    """
    server, port, thread = _start_server()
    probe = _install_offloop_probe(monkeypatch, thread)
    base = f"http://127.0.0.1:{port}"
    try:
        csv_path = tmp_path / "small.csv"
        n_rows = 3_000
        _write_csv(csv_path, n_rows=n_rows)

        upload_result: dict[str, Any] = {}
        upload_thread = threading.Thread(target=_upload, args=(base, csv_path, upload_result))
        upload_thread.start()

        assert probe["parse_started"].wait(timeout=_PARSE_RELEASE_TIMEOUT_S), (
            "the parse never started -- upload request did not reach "
            "_import_with_books"
        )

        # The parse is now deliberately blocked inside the threadpool (or,
        # if the offload has regressed, inline on the event loop). Exactly
        # one health request, issued while it is held, is the whole test.
        r = httpx.get(f"{base}/api/health", timeout=_HEALTH_REQUEST_TIMEOUT_S)
        assert r.status_code == 200

        probe["release"].set()
        upload_thread.join(timeout=60.0)
        assert not upload_thread.is_alive(), "upload never completed"

        assert upload_result["status_code"] == 200
        assert len(upload_result["json"]["time"]) == n_rows

        assert probe["called"], "the parse hook never fired -- test is broken"
        assert probe["on_loop_thread"] is False, (
            "_import_with_books ran ON the uvicorn event-loop thread, not "
            "a threadpool worker -- the offload regressed"
        )
        assert probe["loop_running"] is False, (
            "_import_with_books ran with a running asyncio event loop bound "
            "to its own thread -- it is not actually off the loop"
        )
    finally:
        _stop_server(server, thread)


if __name__ == "__main__":  # pragma: no cover - manual timing runs
    raise SystemExit(pytest.main([__file__, "-v"]))
