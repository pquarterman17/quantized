"""Dataset-cache maintenance routes: derive a cached dataset from another.

``POST /api/datasets/patch`` is the cell-edit shortcut for the handle cache
(``_datasetcache.py``). A worksheet edit produces a new DataStruct that differs
from one the server already holds in a few cells; instead of re-sending the
whole dataset (1M x 7 rows is ~156 MB of JSON), the client sends the parent's
handle and the changed cells. The response carries the child's handle, which
the client then uses like any other.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing_extensions import TypedDict

from quantized.routes._datasetcache import DatasetHandleMiss, patch_cached
from quantized.routes._errors import CALC_ERRORS

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


class CellPatch(TypedDict):
    """One cell. ``col`` -1 is the time column; ``value`` null is NaN.

    A TypedDict, not a model: pydantic validates a list of these ~8x faster
    (measured 0.18 s vs 1.4 s for 350k patches), and validation runs on the
    event loop.
    """

    row: Annotated[int, Field(ge=0)]
    col: Annotated[int, Field(ge=-1)]
    value: float | None


class DatasetPatchRequest(BaseModel):
    dataset_handle: str
    patches: list[CellPatch]


class DatasetHandleResponse(BaseModel):
    """``dataset_handle`` is null when the patched dataset is too large to
    stay cached; the client then sends the full dataset instead."""

    dataset_handle: str | None


@router.post("/patch", response_model=DatasetHandleResponse)
def patch_dataset(req: DatasetPatchRequest) -> DatasetHandleResponse:
    """Clone a cached dataset, overwrite the given cells, and cache the result."""
    try:
        handle = patch_cached(
            req.dataset_handle,
            [p["row"] for p in req.patches],
            [p["col"] for p in req.patches],
            [p["value"] for p in req.patches],
        )
    except DatasetHandleMiss as exc:
        raise HTTPException(status_code=409, detail="unknown_dataset_handle") from exc
    except CALC_ERRORS as exc:  # a cell outside the grid
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DatasetHandleResponse(dataset_handle=handle)
