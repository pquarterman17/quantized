"""``/api/convert/*``: the quick-convert window's routes (thin adapters).

* ``GET  /config``  -- the formats, the files ``qz convert --gui`` was given,
  and the folder the chooser starts in;
* ``POST /preview`` -- per file the guessed type, format, columns and units
  (``io/convert_guess``) and the output names, writing nothing;
* ``POST /run``     -- queue the conversion on the job queue
  (``io/convert_session.run_conversion``); poll ``/api/jobs/{id}``, read the
  per-file results from ``/api/jobs/{id}/result``;
* ``POST /stage``   -- a browser-picked or dropped file has no path, so its
  bytes are staged in a temp folder (an output folder is then required);
* ``GET  /browse``  -- one folder level for the in-page chooser.

Every path is confined to the allowed data roots (``data_roots``; home / cwd /
temp, widened by ``QZ_DATA_ROOTS``) like ``/api/parsers/import``: reads for
inputs, and the same for the output folder, so the API cannot be turned into
an arbitrary-file writer. Overwriting is opt-in and an input is never written.
"""

from __future__ import annotations

import contextlib
import os
import shutil
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel, Field

from quantized.data_roots import is_inside_data_roots
from quantized.desktop_consent import consented_path
from quantized.io.convert_guess import guess_inputs
from quantized.io.convert_plan import ALL_FORMATS, CONTAINER_FORMATS
from quantized.io.convert_session import (
    existing_outputs,
    list_directory,
    out_dir_status,
    prefill_from_env,
    run_conversion,
)
from quantized.jobs import AbortFn, JobCancelled, JobQueueFullError, ProgressFn, jobs
from quantized.routes import _uploadstream
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/convert", tags=["convert"])

MAX_FILES = 500
FORMAT_LABELS = {
    "csv": "CSV (.csv)",
    "xlsx": "Excel (.xlsx)",
    "xy": "Text columns (.xy)",
    "h5": "HDF5 (.h5)",
    "nxs": "NeXus (.nxs)",
    "mat": "MATLAB (.mat)",
    "json": "JSON (.json)",
    "npz": "NumPy (.npz)",
}
_STAGE_NAME = "qz-convert-stage"


def _stage_root() -> Path:
    return Path(os.path.realpath(tempfile.gettempdir())) / _STAGE_NAME


class ConvertFormatInfo(BaseModel):
    id: str
    label: str
    container: bool  # one file for all datasets (else one file per dataset)


class ConvertConfig(BaseModel):
    formats: list[ConvertFormatInfo]
    prefill: list[str]
    home: str


class ConvertPreviewRequest(BaseModel):
    paths: list[str] = Field(min_length=1, max_length=MAX_FILES)
    out_dir: str | None = None
    format: str = "auto"


class ConvertColumnGuess(BaseModel):
    name: str
    unit: str


class ConvertDatasetGuessOut(BaseModel):
    name: str
    rows: int
    columns: list[ConvertColumnGuess]
    is_map: bool


class ConvertFilePreview(BaseModel):
    path: str
    name: str
    staged: bool
    kind: str
    kind_label: str
    technique: str
    format: str
    format_source: str
    datasets: list[ConvertDatasetGuessOut]
    outputs: list[str]
    existing: list[str]  # planned outputs that already exist (refused unless overwrite)
    notes: list[str]
    error: str | None


class ConvertPreviewResponse(BaseModel):
    out_dir_status: str  # same | exists | will_be_created | not_a_folder
    files: list[ConvertFilePreview]


class ConvertRunRequest(BaseModel):
    paths: list[str] = Field(min_length=1, max_length=MAX_FILES)
    out_dir: str | None = None
    format: str = "auto"
    overwrite: bool = False
    metadata: bool = True
    allow_partial: bool = False
    report: bool = True  # also save a timestamped convert-report-*.json


class ConvertRunResponse(BaseModel):
    job_id: str


class ConvertStageResponse(BaseModel):
    path: str
    name: str


class ConvertBrowseEntry(BaseModel):
    name: str
    path: str
    is_dir: bool
    size: int


class ConvertBrowseResponse(BaseModel):
    path: str
    parent: str | None
    entries: list[ConvertBrowseEntry]


def _confine(raw: str, what: str) -> Path:
    """``raw`` resolved (``~``, ``..`` and symlinks) and inside an allowed root
    (or chosen in a native dialog); else 403."""
    try:
        resolved = os.path.realpath(os.path.expanduser(raw))
    except (OSError, ValueError, ArithmeticError) as exc:
        raise HTTPException(status_code=400, detail=f"invalid {what}: {raw!r}") from exc
    if is_inside_data_roots(resolved):
        return Path(resolved)
    if what != "output folder" and (granted := consented_path(resolved)) is not None:
        return Path(granted)
    raise HTTPException(
        status_code=403,
        detail=f"{what} {raw!r} is outside the allowed folders "
        "(your home, the working folder and the temp folder; set QZ_DATA_ROOTS to widen)",
    )


def _format(fmt: str) -> str:
    if fmt != "auto" and fmt not in ALL_FORMATS:
        raise HTTPException(
            status_code=422,
            detail=f"unknown format {fmt!r}; choose auto or one of {', '.join(ALL_FORMATS)}",
        )
    return fmt


def _inputs(raw: list[str], out_dir: str | None, *, writes: bool) -> tuple[list[Path], Path | None]:
    """The confined inputs and output folder. When ``writes``, staged (dropped)
    files -- which have no folder of their own -- need an explicit output
    folder (fail closed); a preview writes nothing, so it does not."""
    paths = [_confine(p, "input file") for p in raw]
    out = _confine(out_dir, "output folder") if out_dir and out_dir.strip() else None
    stage = str(_stage_root()) + os.sep
    if writes and out is None and any(str(p).startswith(stage) for p in paths):
        raise HTTPException(
            status_code=422,
            detail="files added by drag-and-drop or the file picker have no folder of "
            "their own: choose an output folder",
        )
    return paths, out


@router.get("/config", response_model=ConvertConfig)
def convert_config() -> ConvertConfig:
    """Formats, the launcher's prefilled files, and the chooser's start folder."""
    return ConvertConfig(
        formats=[
            ConvertFormatInfo(id=f, label=FORMAT_LABELS[f], container=f in CONTAINER_FORMATS)
            for f in ALL_FORMATS
        ],
        prefill=prefill_from_env(),
        home=str(Path.home()),
    )


@router.post("/preview", response_model=ConvertPreviewResponse)
def convert_preview(req: ConvertPreviewRequest) -> ConvertPreviewResponse:
    """Guess type / format / columns / names for each input; write nothing."""
    fmt = _format(req.format)
    paths, out = _inputs(req.paths, req.out_dir, writes=False)
    stage = str(_stage_root()) + os.sep
    # No out_dir here: names are exactly what a run writes (a run never renames),
    # and `existing` says which of them it would refuse.
    guesses = guess_inputs(paths, fmt=None if fmt == "auto" else fmt)
    return ConvertPreviewResponse(
        out_dir_status=out_dir_status(out),
        files=[
            ConvertFilePreview(
                path=g.path,
                name=Path(g.path).name,
                staged=g.path.startswith(stage),
                kind=g.kind,
                kind_label=g.kind_label,
                technique=g.technique,
                format=g.format,
                format_source=g.format_source,
                datasets=[
                    ConvertDatasetGuessOut(
                        name=d.name,
                        rows=d.rows,
                        columns=[ConvertColumnGuess(name=n, unit=u) for n, u in d.columns],
                        is_map=d.is_map,
                    )
                    for d in g.datasets
                ],
                outputs=list(g.outputs),
                existing=existing_outputs(Path(g.path), g.outputs, out),
                notes=list(g.notes),
                error=g.error,
            )
            for g in guesses
        ],
    )


@router.post("/run", response_model=ConvertRunResponse)
def convert_run(req: ConvertRunRequest) -> ConvertRunResponse:
    """Queue the conversion; the result (per-file entries, report path) is
    read from ``/api/jobs/{job_id}/result``."""
    fmt = _format(req.format)
    paths, out = _inputs(req.paths, req.out_dir, writes=True)

    def run_job(progress: ProgressFn, abort: AbortFn) -> object:
        def report(fraction: float, message: str) -> None:
            # A cancel is honoured between files (abort()), never by raising out of
            # a progress call: the files already written must still be reported.
            with contextlib.suppress(JobCancelled):
                progress(fraction, message)

        return to_jsonable(
            run_conversion(
                paths,
                out,
                fmt,
                overwrite=req.overwrite,
                metadata=req.metadata,
                allow_partial=req.allow_partial,
                write_report=req.report,
                progress=progress,
                abort=abort,
            )  # fmt: skip
        )

    try:
        return ConvertRunResponse(job_id=jobs.submit(run_job, interactive=True))
    except JobQueueFullError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/stage", response_model=ConvertStageResponse)
async def convert_stage(file: UploadFile) -> ConvertStageResponse:
    """Stage a browser-picked / dropped file (bytes only) in a temp folder."""
    name = Path(file.filename or "upload.dat").name or "upload.dat"
    folder = _stage_root() / uuid.uuid4().hex[:12]
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / name
    try:
        await _uploadstream.stream_to_path(file, dest, filename=name)
    except _uploadstream.UploadTooLargeError as exc:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except OSError as exc:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"could not stage {name}: {exc}") from exc
    return ConvertStageResponse(path=str(dest), name=name)


@router.get("/browse", response_model=ConvertBrowseResponse)
def convert_browse(path: str = "") -> ConvertBrowseResponse:
    """List one folder (default: home) for the in-page chooser."""
    folder = _confine(path or str(Path.home()), "folder")
    try:
        listing = list_directory(folder)
    except OSError as exc:
        raise HTTPException(status_code=422, detail=f"cannot open {path or folder}: {exc}") from exc
    parent = listing["parent"]
    if parent is not None and not is_inside_data_roots(parent):
        listing["parent"] = None  # never offer a way out of the allowed folders
    return ConvertBrowseResponse(**listing)
