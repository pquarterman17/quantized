"""FastAPI application factory for quantized.

Thin transport layer only — business logic lives in ``calc/`` and ``io/``.
Composes the per-domain routers; each router is a thin adapter.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from quantized import __version__
from quantized.routes import parsers, plot

__all__ = ["create_app", "app"]

# Built SPA (vite build → src/quantized/web/). A build artifact, gitignored;
# present in packaged/installed runs, absent in a bare dev checkout.
_WEB_DIR = Path(__file__).parent / "web"

# Vite dev server origins (the SPA in --dev mode). Same-origin in production.
_DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


def create_app() -> FastAPI:
    """Build the FastAPI app and wire the domain routers."""
    application = FastAPI(title="quantized", version=__version__)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=_DEV_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    application.include_router(parsers.router)
    application.include_router(plot.router)

    # Serve the built SPA at / when present (production / packaged runs). In a
    # bare dev checkout the dir is absent and the Vite dev server serves the UI.
    if _WEB_DIR.is_dir():
        application.mount("/", StaticFiles(directory=_WEB_DIR, html=True), name="web")
    return application


app = create_app()
