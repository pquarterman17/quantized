"""FastAPI application factory for quantized.

Thin transport layer only — business logic lives in ``calc/`` and ``io/``.
Composes the per-domain routers; each router is a thin adapter.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Collection
from contextlib import aclosing, asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.requests import ClientDisconnect, HTTPConnection

from quantized import __version__
from quantized.io.workbook_transfer_store import cleanup_transfer_dir
from quantized.jobs import jobs
from quantized.plugins import load_plugins
from quantized.routes import (
    _datasetcache,
    aggregate,
    baseline,
    books,
    calc,
    corrections,
    crystallography,
    database,
    diffusion,
    electrical,
    electrochemistry,
    export,
    export_figures,
    export_figures_aux,
    export_multivar,
    export_page,
    export_statplots,
    fitting,
    fitting_bumps,
    import_template,
    import_wizard,
    jobs_api,
    magnetic,
    magnetometry,
    optics,
    parsers,
    peaks,
    peaks_batch,
    plot,
    reductions,
    reference,
    reflectivity,
    report_export,
    rsm,
    samples,
    semiconductor,
    sims,
    sld,
    spectral,
    statplots,
    stats,
    stats_design,
    stats_outliers,
    stats_varcomp,
    substrates,
    superconductor,
    thermal,
    thin_film,
    transform,
    vacuum,
    workbook_transfer,
    xray,
)
from quantized.routes._errors import validation_error_handler
from quantized.security import dev_origins_from_env, host_allowed, origin_allowed

__all__ = ["create_app", "app"]

# Built SPA (vite build → src/quantized/web/). A build artifact, gitignored;
# present in packaged/installed runs, absent in a bare dev checkout.
#
# One resolution serves both cases: Path(__file__).parent always points at
# wherever the ``quantized`` package itself lives, so a PyPI/pipx install
# (the built wheel bundles ``web/`` alongside app.py — see
# [tool.hatch.build.targets.wheel] artifacts in pyproject.toml and the
# "build frontend first" step in README.md) and a dev checkout that has run
# ``npm run build`` resolve to the same relative path with no branching.
_WEB_DIR = Path(__file__).parent / "web"

# ── Desktop-style lifecycle (client presence over /api/ws) ──────────────────
# The SPA holds a WebSocket open; the status bar's connected dot reflects it.
# Auto-shutdown on last-tab-close is opt-in (env QZ_AUTO_SHUTDOWN=1, for the
# future `qz --desktop` run model) so dev/tests are never killed.
_clients = 0
_ever_connected = False
_AUTO_SHUTDOWN = os.environ.get("QZ_AUTO_SHUTDOWN") == "1"
_SHUTDOWN_GRACE_S = 1.5  # tab refresh disconnects + reconnects within ~1 s


async def _lifecycle_ws(ws: WebSocket) -> None:
    """Client-presence socket: count live tabs; (optionally) shut down when the
    last one drops past a refresh-safe grace window. Module-level to keep
    create_app simple."""
    global _clients, _ever_connected
    # The HTTP middleware doesn't run on the WS upgrade — enforce the same
    # Host + Origin checks here (closing before accept()).
    if not host_allowed(ws.headers.get("host")):
        await ws.close(code=1008)  # policy violation
        return
    if not _origin_ok(ws):
        await ws.close(code=1008)  # policy violation
        return
    await ws.accept()
    _clients += 1
    _ever_connected = True
    try:
        while True:
            await ws.receive_text()  # idles until disconnect
    except WebSocketDisconnect:
        pass
    finally:
        _clients -= 1
        if _AUTO_SHUTDOWN and _clients == 0:
            asyncio.get_running_loop().create_task(_grace_check())


async def _grace_check() -> None:
    """Exit unless a client reconnected within the grace window."""
    await asyncio.sleep(_SHUTDOWN_GRACE_S)
    if _AUTO_SHUTDOWN and _ever_connected and _clients == 0:
        os._exit(0)

def _origin_ok(conn: HTTPConnection) -> bool:
    """The CSRF check shared by the HTTP guard and the WS upgrade.

    No Origin header passes (same-origin navigations, curl, the desktop
    shells -- ``host_allowed`` covers those). A present Origin must be this
    server's own origin for the request's scheme + Host port (BUG-030), the
    Tauri shell, or -- under ``qz --dev`` only -- the Vite dev origin."""
    origin = conn.headers.get("origin")
    if not origin:
        return True
    return origin_allowed(
        origin,
        host_header=conn.headers.get("host"),
        scheme=conn.url.scheme,
        extra_origins=getattr(conn.app.state, "dev_origins", frozenset()),
    )


# A refused request's body is read and discarded (never kept) up to this many
# bytes before the 403 goes out; see ``_refuse``.
_REFUSED_BODY_DRAIN_CAP = 64 * 1024


async def _refuse(request: Request, detail: str) -> JSONResponse:
    """The guard's 403, sent only once the request body has been drained.

    Answering from the headers alone left the body unread (or still in
    flight) when uvicorn closed the connection -- which it does straight after
    the response when the client sent ``Connection: close``, as urllib does.
    The kernel answers such a close with a TCP RST instead of a FIN, and on
    Windows an RST discards data the client has received but not yet read, so
    the refusal could surface as ``ConnectionResetError`` [WinError 10054]
    instead of the 403 already sent.

    Bounded: reading stops once more than ``_REFUSED_BODY_DRAIN_CAP`` bytes
    have arrived, and nothing is read for ``Expect: 100-continue`` (reading
    would make the server invite the very body being refused). When the body
    was not fully read, the 403 carries ``Connection: close`` so the server
    closes rather than keep reading it -- an attacker's body is never read
    without limit. (A client that stalls mid-body stalls this wait exactly as
    it would stall any route that reads a body; uvicorn times neither out.)"""
    drained = await _drain_body(request)
    headers = None if drained else {"Connection": "close"}
    return JSONResponse({"detail": detail}, status_code=403, headers=headers)


async def _drain_body(request: Request) -> bool:
    """Read and discard the body up to the cap; True only if all of it was read."""
    if request.headers.get("expect", "").lower() == "100-continue":
        return False
    seen = 0
    try:
        async with aclosing(request.stream()) as chunks:
            async for chunk in chunks:
                seen += len(chunk)
                if seen > _REFUSED_BODY_DRAIN_CAP:
                    return False
    except ClientDisconnect:
        return False
    return True


@asynccontextmanager
async def _app_lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    """App lifespan: clean up the executor pool + dataset cache on shutdown."""
    # Startup: sweep expired large-workbook transfer packages (Group F) from
    # an EXISTING transfer dir -- never creates it, never fails startup.
    try:
        cleanup_transfer_dir()
    except OSError:
        logging.getLogger(__name__).warning("transfer-package cleanup failed", exc_info=True)
    yield
    # Shutdown: terminate the job executor with pending cancellation
    jobs._pool.shutdown(wait=False, cancel_futures=True)
    # RSM_CUTS_PLAN item 18: drop every cached dataset (local-server-
    # hardening -- lifespan hook, never atexit).
    _datasetcache.clear_cache()


def create_app(*, dev_origins: Collection[str] | None = None) -> FastAPI:
    """Build the FastAPI app and wire the domain routers.

    ``dev_origins`` are the only cross-origin pages (besides the Tauri shell)
    allowed to call /api. None reads them from the environment, where
    ``qz --dev`` exports the Vite port (``security.dev_origins_from_env``);
    every other run mode leaves it unset, so the set is empty there."""
    allowed_dev = frozenset(dev_origins_from_env() if dev_origins is None else dev_origins)
    application = FastAPI(title="quantized", version=__version__, lifespan=_app_lifespan)
    application.state.dev_origins = allowed_dev
    application.add_exception_handler(RequestValidationError, validation_error_handler)
    # CORS read access for the Vite dev origin in --dev only (empty otherwise:
    # the served SPA and the desktop shells are same-origin and need none).
    application.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(allowed_dev),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.middleware("http")
    async def _security_guard(request: Request, call_next):  # type: ignore[no-untyped-def]
        """Host check (all paths, defeats DNS rebinding) then Origin check
        (/api/* only, the CSRF guard) — see ``quantized.security`` for what
        each one does and doesn't cover. CORSMiddleware alone is NOT this:
        it never inspects Host and doesn't block simple cross-site POSTs."""
        if not host_allowed(request.headers.get("host")):
            return await _refuse(request, "unrecognized Host header")
        if request.url.path.startswith("/api") and not _origin_ok(request):
            return await _refuse(request, "cross-origin API request blocked")
        return await call_next(request)

    @application.get("/api/health")
    def health() -> dict[str, str]:
        # "app" is the identity field the launchers key on: the sibling
        # fermiviewer serves the same {"status": "ok"} shape on the same
        # default port (8000), and a probe that checks status alone adopts
        # it — rendering the wrong app's UI in a Quantized window.
        return {"status": "ok", "app": "quantized", "version": __version__}

    application.include_router(parsers.router)
    application.include_router(books.router)
    application.include_router(samples.router)
    application.include_router(import_wizard.router)
    application.include_router(import_template.router)
    application.include_router(plot.router)
    application.include_router(corrections.router)
    application.include_router(database.router)
    application.include_router(fitting.router)
    application.include_router(fitting_bumps.router)
    application.include_router(jobs_api.router)
    application.include_router(baseline.router)
    application.include_router(stats.router)
    application.include_router(stats_design.router)
    application.include_router(stats_outliers.router)
    application.include_router(stats_varcomp.router)
    application.include_router(statplots.router)
    application.include_router(reference.router)
    application.include_router(export.router)
    application.include_router(export_figures.router)
    application.include_router(export_figures_aux.router)
    application.include_router(export_statplots.router)
    application.include_router(export_multivar.router)
    application.include_router(export_page.router)
    application.include_router(report_export.router)
    application.include_router(magnetometry.router)
    application.include_router(peaks.router)
    application.include_router(peaks_batch.router)
    application.include_router(reductions.router)
    application.include_router(reflectivity.router)
    application.include_router(rsm.router)
    application.include_router(xray.router)
    application.include_router(sld.router)
    application.include_router(spectral.router)
    application.include_router(crystallography.router)
    application.include_router(electrical.router)
    application.include_router(optics.router)
    application.include_router(vacuum.router)
    application.include_router(thermal.router)
    application.include_router(diffusion.router)
    application.include_router(electrochemistry.router)
    application.include_router(substrates.router)
    application.include_router(semiconductor.router)
    application.include_router(thin_film.router)
    application.include_router(superconductor.router)
    application.include_router(magnetic.router)
    application.include_router(aggregate.router)
    application.include_router(transform.router)
    application.include_router(sims.router)
    application.include_router(calc.router)
    application.include_router(workbook_transfer.router)

    # Client-presence WebSocket (registered before the SPA mount so the
    # catch-all StaticFiles route never shadows it).
    application.websocket("/api/ws")(_lifecycle_ws)

    # Load user/third-party plugins once (gap #8). Registration is isolated
    # per-plugin and logged; a broken plugin never crashes startup. Cheap when
    # none are installed (an empty dir scan + entry-point lookup). Fit-model /
    # parser routes read the shared registries at request time, so plugin
    # contributions are visible regardless of this call's position.
    try:
        load_plugins()
    except Exception:  # pragma: no cover - load_plugins already isolates per-plugin
        logging.getLogger("quantized.plugins").exception("plugin loading failed")

    # Serve the built SPA at / when present (production / packaged runs). In a
    # bare dev checkout the dir is absent and the Vite dev server serves the UI.
    if _WEB_DIR.is_dir():
        application.mount("/", StaticFiles(directory=_WEB_DIR, html=True), name="web")
    return application


app = create_app()
