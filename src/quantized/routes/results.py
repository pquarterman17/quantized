"""Fetch a kept analysis result by id (P4 phase 4, plans/LARGE_PAYLOAD_PLAN.md).

A lean ``/baseline/estimate`` / ``/modpoly`` / ``/peaks/find`` / ``/transform/
sigop`` response names its full result with a ``resultId`` (routes/
_arrayresults.py); these routes return it exactly as the full response would
have carried it. 409 ``unknown_result`` when evicted: the client re-sends its
inputs and asks for the full response.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel

from quantized.routes._arrayresults import resolve_result_or_409
from quantized.routes._offloop import OffloopJSONRoute
from quantized.routes._payload import DataStructResponse, datastruct_payload, jsonify

router = APIRouter(prefix="/api/results", tags=["results"], route_class=OffloopJSONRoute)


class ResultRequest(BaseModel):
    result_id: str


class ArrayRequest(ResultRequest):
    kind: Literal["baseline", "background"]


@router.post("/array")
def array(req: ArrayRequest) -> dict[str, Any]:
    """The kept 1-D array (``baseline`` or ``background``), non-finite as null."""
    entry = resolve_result_or_409(req.result_id, req.kind)
    (values,) = entry.arrays.values()
    return {"values": jsonify(values)}


@router.post("/dataset", response_class=DataStructResponse)
def dataset(req: ResultRequest) -> Response:
    """The kept signal-op result dataset, as ``/transform/sigop`` returns it."""
    entry = resolve_result_or_409(req.result_id, "sigop")
    assert entry.data is not None
    return DataStructResponse({"dataset": datastruct_payload(entry.data)})
