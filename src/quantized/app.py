"""FastAPI application factory for quantized (skeleton).

Thin transport layer only — business logic lives in ``calc/`` and ``io/``.
Domain routers are added in M1 #5 (parsers, plot, corrections, ...).
"""

from __future__ import annotations

from fastapi import FastAPI

from quantized import __version__

__all__ = ["create_app", "app"]


def create_app() -> FastAPI:
    """Build the FastAPI app. Routers get wired here as they land."""
    application = FastAPI(title="quantized", version=__version__)

    @application.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return application


app = create_app()
