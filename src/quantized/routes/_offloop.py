"""Parse large JSON request bodies in the threadpool, not on the event loop.

FastAPI decodes a JSON body with ``await request.json()`` before a route runs,
and ``json.loads`` runs right there on the event loop -- even for a sync
``def`` route. A dataset POST is big (1M x 7 rows is ~146 MB of JSON, measured
3.3-4.6 s in ``json.loads`` on a loaded machine), and for that whole span the
server answers nothing else: ``/api/health``, the job poller, a second
window's plot. ``OffloopJSONRoute`` swaps the request for one whose ``json()``
decodes in the threadpool with a decoder that yields the GIL (see ``_loads``),
the same move PR #295 made for the upload parser (``routes/parsers.py``'s
``run_in_threadpool`` plus ``_payload.py``'s chunked encoding).

Set it as a router's ``route_class``. It changes only WHERE the body is
decoded: the result, the error for malformed JSON (``json.JSONDecodeError``,
which FastAPI still turns into its usual 422) and the OpenAPI schema are all
unchanged. Pydantic validation still runs on the loop, which is cheap for the
routes that use this: their dataset field is ``dict[str, Any]``, so the
nested arrays are not walked (measured 0.1 ms for the 1M x 7 body above).
"""

from __future__ import annotations

import json
from collections.abc import Callable, Coroutine
from typing import Any

from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import Response

__all__ = ["OffloopJSONRoute"]


def _float(numeral: str) -> float:
    return float(numeral)


def _int(numeral: str) -> int:
    return int(numeral)


def _loads(body: bytes | str) -> Any:
    """``json.loads`` that lets other threads -- the event loop -- run while it
    decodes. A worker thread alone is not enough: ``json.loads`` is one C call
    that never releases the GIL, so the loop stayed frozen for the whole decode
    (health max 4.4 s during a 1M x 7 POST, unchanged from on-loop). The
    Python-level number hooks give the interpreter a point to hand the GIL over
    every few milliseconds (``sys.getswitchinterval``). The C scanner passes
    them the exact numeral text and its default path is ``float``/``int`` of
    that same text, so results are identical. Cost: the decode is 10-24% slower
    (A/B on the 146 MB body, loaded machine); health max during that POST fell
    from 4.2-4.8 s to 0.4-0.7 s. What remains is ``DataStruct.create``'s
    ``np.asarray`` over the nested lists, another single C call."""
    return json.loads(body, parse_float=_float, parse_int=_int)


class _OffloopJSONRequest(Request):
    async def json(self) -> Any:
        if not hasattr(self, "_json"):
            body = await self.body()
            self._json = await run_in_threadpool(_loads, body)
        return self._json


class OffloopJSONRoute(APIRoute):
    """An ``APIRoute`` whose JSON body is decoded in the threadpool."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def offloop_handler(request: Request) -> Response:
            return await handler(_OffloopJSONRequest(request.scope, request.receive))

        return offloop_handler
