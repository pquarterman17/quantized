"""``quantized.client`` — drive an already-running ``qz`` server from Python.

Slice 1 of the scripting/API design (see ``scripting-api-design.md`` in git
history for the full scoping session, 2026-08-05). This is the network
counterpart to :mod:`quantized.api`, and deliberately a DIFFERENT shape:

* :mod:`quantized.api` is in-process and headless — it calls ``calc``/``io``
  functions directly in the CALLING process, no server involved.
* :mod:`quantized.client` talks HTTP to a LIVE ``qz`` server process
  (possibly one a human already has open in a browser tab), over the exact
  same ``/api/*`` surface the SPA drives. No dataset state lives on the
  server between requests — every method is a self-contained round trip.

Requires the optional ``client`` extra (``pip install quantized[client]``);
core installs stay lean. Never imports fastapi/pydantic/starlette — this
module is a plain HTTP client, not part of the server.

Example — connect, import a file, apply a correction, fit it::

    from quantized.client import QuantizedClient

    client = QuantizedClient()  # QZ_URL env var, else http://127.0.0.1:8000
    ds = client.import_bytes("scan.csv")
    corrected = client.apply_corrections(ds, {"xOff": 0.5, "bgSlope": 0.0})
    fit = client.fit("Gaussian", list(corrected.time), list(corrected.column(0)))
    print(fit["r2"])

Mandatory identity check: the first request of any kind runs
``GET /api/health`` and refuses to continue unless it answers
``app == "quantized"`` — this is the same field ``app.py``'s own health
route comment names for exactly this purpose (a probe that checks
``status`` alone can adopt the sibling ``fermiviewer``, which serves the
same ``{"status": "ok"}`` shape on the same default port). Raises
:class:`QuantizedConnectionError`, never silently talks to the wrong app.

No automatic port discovery in slice 1 (the server can silently fall back to
an ephemeral port when 8000 is busy) — pass ``base_url`` explicitly, or set
``QZ_URL``, when the session isn't on the default port.
"""

from __future__ import annotations

import os
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError as exc:  # pragma: no cover - exercised only without the extra
    raise ImportError(
        "quantized.client requires the optional 'client' extra: "
        "pip install quantized[client] (or: uv sync --extra client)"
    ) from exc

from quantized.datastruct import DataStruct

__all__ = ["QuantizedClient", "QuantizedClientError", "QuantizedConnectionError"]

_DEFAULT_BASE_URL = "http://127.0.0.1:8000"
_TERMINAL_JOB_STATUSES = ("done", "error", "cancelled")


class QuantizedClientError(Exception):
    """Base error for a failed request: a non-2xx response or a bad job outcome."""


class QuantizedConnectionError(QuantizedClientError):
    """The server is unreachable, or fails the mandatory identity check."""


class QuantizedClient:
    """Sync HTTP client for a running ``qz`` server (slice 1).

    ``base_url`` resolves explicit arg -> ``QZ_URL`` env var ->
    ``http://127.0.0.1:8000``. The identity handshake (``GET /api/health``,
    ``app == "quantized"``) runs lazily on the first request, not in
    ``__init__`` — building a client object never requires a live server.

    ``_client`` is an injection seam for tests: pass a pre-built
    ``httpx.Client`` (e.g. one wrapping ``httpx.ASGITransport(app=...)``) to
    drive the app in-process with no real socket. Production code should
    never need it.
    """

    def __init__(
        self,
        base_url: str | None = None,
        timeout: float = 30.0,
        *,
        _client: httpx.Client | None = None,
    ) -> None:
        self._identity_ok = False
        if _client is not None:
            self._http = _client
            self._base_url = str(_client.base_url).rstrip("/")
        else:
            self._base_url = (
                base_url or os.environ.get("QZ_URL") or _DEFAULT_BASE_URL
            ).rstrip("/")
            self._http = httpx.Client(base_url=self._base_url, timeout=timeout)

    def __enter__(self) -> QuantizedClient:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def close(self) -> None:
        """Release the underlying connection pool."""
        self._http.close()

    # ── Transport internals ─────────────────────────────────────────────

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            return self._http.request(method, path, **kwargs)
        except httpx.TransportError as exc:
            raise QuantizedConnectionError(
                f"cannot reach {self._base_url}{path}: {exc}"
            ) from exc

    def _unwrap(self, resp: httpx.Response) -> Any:
        if resp.status_code >= 400:
            detail = f"{resp.status_code} {resp.reason_phrase}"
            try:
                body = resp.json()
                if isinstance(body, dict) and "detail" in body:
                    detail = str(body["detail"])
            except ValueError:
                pass  # non-JSON error body - keep the status line
            raise QuantizedClientError(f"HTTP {resp.status_code}: {detail}")
        if not resp.content:
            return None
        return resp.json()

    def _ensure_identity(self) -> None:
        if not self._identity_ok:
            self.health()

    def _get(self, path: str, **kwargs: Any) -> Any:
        self._ensure_identity()
        return self._unwrap(self._request("GET", path, **kwargs))

    def _post(self, path: str, **kwargs: Any) -> Any:
        self._ensure_identity()
        return self._unwrap(self._request("POST", path, **kwargs))

    # ── Identity ───────────────────────────────────────────────────────

    def health(self) -> dict[str, Any]:
        """``GET /api/health`` — also runs the mandatory identity check.

        Raises :class:`QuantizedConnectionError` if the server is
        unreachable, answers with a non-200, or does not identify as
        ``app == "quantized"``.
        """
        resp = self._request("GET", "/api/health")
        if resp.status_code != 200:
            raise QuantizedConnectionError(
                f"health check failed: HTTP {resp.status_code} from {self._base_url}"
            )
        body: dict[str, Any] = resp.json()
        app_name = body.get("app")
        if app_name != "quantized":
            raise QuantizedConnectionError(
                f"{self._base_url} identifies as {app_name!r}, not 'quantized' - "
                "refusing to proceed. This guards against silently driving an "
                "unrelated local server (e.g. the sibling fermiviewer, which "
                "listens on the same default port 8000)."
            )
        self._identity_ok = True
        return body

    # ── Import ─────────────────────────────────────────────────────────

    def import_bytes(self, path: str | Path, filename: str | None = None) -> DataStruct:
        """Upload a local file's bytes (``POST /api/parsers/upload``).

        No server-side path is ever sent — this is the recommended import
        path for scripts (it inherits none of ``import_path``'s allowlist
        edge cases). ``filename`` overrides the basename used on the wire
        when it differs from ``path``'s own name.
        """
        p = Path(path)
        data = p.read_bytes()
        name = filename or p.name
        payload = self._post(
            "/api/parsers/upload",
            files={"file": (name, data, "application/octet-stream")},
        )
        return DataStruct.from_dict(payload)

    def import_path(self, path: str | Path) -> DataStruct:
        """Import a path the SERVER can already see (``POST /api/parsers/import``).

        Same-machine-script alternative to :meth:`import_bytes`: the server
        applies its existing allowlist (home/cwd/temp, widen via
        ``QZ_DATA_ROOTS``) unchanged. Prefer :meth:`import_bytes` unless the
        server and the script share a filesystem and the file is already in
        an allowed root.
        """
        payload = self._post("/api/parsers/import", json={"path": str(path)})
        return DataStruct.from_dict(payload)

    # ── Corrections ────────────────────────────────────────────────────

    def apply_corrections(
        self,
        data: DataStruct,
        params: dict[str, Any],
        background: DataStruct | dict[str, Any] | None = None,
        *,
        bg_interp: str = "linear",
    ) -> DataStruct:
        """Run the correction pipeline (``POST /api/corrections/apply``).

        ``params`` mirrors the wire ``CorrectionParams`` camelCase keys
        (``xOff``, ``bgSlope``, ``smoothWindow``, ...). ``background``
        accepts either a :class:`DataStruct` or an already-dict-shaped
        background dataset for background-subtraction correction modes.
        """
        bg_payload = background.to_dict() if isinstance(background, DataStruct) else background
        body = {
            "dataset": data.to_dict(),
            "params": params,
            "bg_dataset": bg_payload,
            "bg_interp": bg_interp,
        }
        payload = self._post("/api/corrections/apply", json=body)
        return DataStruct.from_dict(payload)

    # ── Fitting ────────────────────────────────────────────────────────

    def fit(
        self,
        model: str,
        x: Sequence[float],
        y: Sequence[float],
        dy: Sequence[float] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Bounded NLLS fit of a registry model (``POST /api/fitting/fit``).

        The default, synchronous, MATLAB-parity engine — the same one the
        SPA's fit workshop uses. ``**kwargs`` passes through the remaining
        ``FitRequest`` fields (``p0``, ``lower``, ``upper``, ``fixed``,
        ``calc_errors``) unchanged.
        """
        body: dict[str, Any] = {"model": model, "x": list(x), "y": list(y), **kwargs}
        if dy is not None:
            body["dy"] = list(dy)
        result: dict[str, Any] = self._post("/api/fitting/fit", json=body)
        return result

    def fit_dream(
        self,
        model: str,
        x: Sequence[float],
        y: Sequence[float],
        dy: Sequence[float] | None = None,
        *,
        poll_interval: float = 1.0,
        timeout: float = 300.0,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Bayesian (DREAM) fit via the job queue (``POST /api/fitting/bumps``).

        Submits with ``engine="dream"``, then polls ``GET /api/jobs/{id}``
        at ``poll_interval`` seconds until the job reaches a terminal
        status, and fetches ``GET /api/jobs/{id}/result``. ``**kwargs``
        passes through the remaining ``BumpsFitRequest`` fields (``p0``,
        ``lower``, ``upper``, ``samples``, ``burn``, ``pop``,
        ``return_samples``). Raises :class:`QuantizedClientError` on a
        failed/cancelled job or if ``timeout`` seconds elapse first.
        """
        body: dict[str, Any] = {
            "model": model,
            "x": list(x),
            "y": list(y),
            "engine": "dream",
            **kwargs,
        }
        if dy is not None:
            body["dy"] = list(dy)
        submitted: dict[str, Any] = self._post("/api/fitting/bumps", json=body)
        job_id: str = submitted["job_id"]

        deadline = time.monotonic() + timeout
        status = self.job_status(job_id)
        while status["status"] not in _TERMINAL_JOB_STATUSES:
            if time.monotonic() > deadline:
                raise QuantizedClientError(
                    f"fit_dream job {job_id} did not finish within {timeout}s "
                    f"(last status: {status['status']})"
                )
            time.sleep(poll_interval)
            status = self.job_status(job_id)

        if status["status"] == "error":
            raise QuantizedClientError(
                f"DREAM fit job {job_id} failed: {status.get('error', '')}"
            )
        if status["status"] == "cancelled":
            raise QuantizedClientError(f"DREAM fit job {job_id} was cancelled")

        result: dict[str, Any] = self._get(f"/api/jobs/{job_id}/result")
        return result["result"]  # type: ignore[no-any-return]

    # ── Jobs (poll / cancel any job, not just fit_dream's own) ──────────

    def job_status(self, job_id: str) -> dict[str, Any]:
        """Poll one job: status / progress / message (``GET /api/jobs/{id}``)."""
        result: dict[str, Any] = self._get(f"/api/jobs/{job_id}")
        return result

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        """Request cooperative cancellation (``POST /api/jobs/{id}/cancel``)."""
        result: dict[str, Any] = self._post(f"/api/jobs/{job_id}/cancel")
        return result
