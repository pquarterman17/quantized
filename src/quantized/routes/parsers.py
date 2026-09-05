"""Thin parser routes: import a file -> DataStruct JSON. No business logic.

Two ways in: ``/import`` reads a path the server can already see (desktop / CLI
use); ``/upload`` takes the file's bytes from the browser (the GUI file-picker
and drag-drop). Both auto-detect format via ``io.import_auto``.
"""

from __future__ import annotations

import os
import struct
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel

from quantized.datastruct import DataStruct
from quantized.desktop_consent import consented_path
from quantized.io import import_auto
from quantized.io.origin_project import (
    drop_empty_library_books,
    read_origin_project_all,
)
from quantized.io.origin_project.fidelity import (
    assess_origin_figures,
    origin_figure_decode_failure,
)
from quantized.io.origin_project.figures import extract_figures
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.graph_preview import (
    PreviewDiagnostic,
    attach_opju_graph_previews,
)
from quantized.io.origin_project.preview import decimate_datastruct
from quantized.routes._bookcache import cache_project_books
from quantized.routes._errors import CALC_ERRORS_IO
from quantized.routes._payload import datastruct_payload, dumps_payload, jsonify
from quantized.routes._uploadcache import stage_upload_stream
from quantized.routes._uploadstream import UploadTooLargeError, stream_to_path

router = APIRouter(prefix="/api/parsers", tags=["parsers"])

# Rows kept in a non-primary book's preview (Library sparkline resolution;
# see io/origin_project/preview.decimate_datastruct).
_PREVIEW_POINTS = 200


class ImportRequest(BaseModel):
    path: str
    # Escape hatch (ORIGIN_FILE_DECODE_PLAN #38): request the pre-#38 full-
    # inline "books": [payload, ...] shape instead of the lazy inventory. Used
    # by tooling that reads every book's data immediately after import (e.g.
    # tools/visual/origin_figures.mjs) and has no fetch-on-activate flow.
    full_books: bool = False


def _allowed_roots() -> tuple[str, ...]:
    """Real (symlink-resolved) absolute paths ``/import`` may read from: the
    user's home, the current working directory, and the system temp dir — widen
    with the ``QZ_DATA_ROOTS`` env var (os.pathsep-separated)."""
    raw = [Path.home(), Path.cwd(), Path(tempfile.gettempdir())]
    raw += [Path(p) for p in os.environ.get("QZ_DATA_ROOTS", "").split(os.pathsep) if p.strip()]
    roots: list[str] = []
    for r in raw:
        try:
            roots.append(os.path.realpath(r))
        except OSError:
            continue
    return tuple(roots)


def _allowed_prefixes() -> tuple[str, ...]:
    """``_allowed_roots`` as separator-terminated prefixes, so containment can
    be tested as ``resolved.startswith(_allowed_prefixes())``.

    Terminating each root with ``os.sep`` is what makes a prefix test a real
    containment test: bare ``startswith("/data")`` would also accept
    ``/data-other/secrets``, while ``startswith("/data/")`` accepts only true
    descendants. Roots are directories and every caller separately requires the
    resolved path to be a FILE, so ``resolved == root`` cannot arise and is
    deliberately not accepted.

    This computes the same containment ``os.path.commonpath`` did, in the form
    the static analyzer can actually verify: CodeQL's path-injection barrier
    (``Path::SafeAccessCheck``) models ``str.startswith`` and does not model
    ``commonpath``, so the old spelling left every downstream ``open`` reported
    as a reachable traversal sink. Being able to prove the guard is the point —
    a guard no tool can check is a guard nobody notices the loss of.
    """
    return tuple(root.rstrip(os.sep) + os.sep for root in _allowed_roots())


def _origin_book_id(ds: DataStruct) -> str:
    return str(ds.metadata.get("origin_book", ""))


def _slim_metadata(meta: Any) -> dict[str, Any]:
    """Wire-payload metadata, minus ``origin_books`` — the full per-project
    book inventory ``_build_book`` (io/origin_project/opj.py) embeds in
    EVERY book's metadata. Grepped: nothing in routes/calc or the frontend
    reads it back off the wire (``read_origin_books`` callers that DO use it
    go through the pure Python API, untouched by this trim) — it duplicates
    ~10-15 KB per book project-wide, which is material at PNR.opj's 122-book
    scale (~1.4 MB of dead weight). Trimmed only here, at the HTTP boundary."""
    return {k: v for k, v in dict(meta).items() if k != "origin_books"}


def _book_payload(ds: DataStruct) -> dict[str, Any]:
    """``datastruct_payload``, with ``_slim_metadata`` applied."""
    payload = datastruct_payload(ds)
    payload["metadata"] = _slim_metadata(payload["metadata"])
    return payload


def _book_primary_marker(ds: DataStruct) -> dict[str, Any]:
    """The ``books[]`` entry for the book ALREADY returned in full at the
    payload's top level — carries no ``time``/``values``/preview of its own
    (nothing to duplicate): the frontend builds this book's Dataset from the
    top-level payload instead of this entry. ``primary: true`` is its
    discriminant (see ``_book_preview_payload``'s ``lazy: true`` sibling)."""
    return {
        "lazy": False,
        "primary": True,
        "id": _origin_book_id(ds),
        "labels": list(ds.labels),
        "units": list(ds.units),
        "metadata": _slim_metadata(ds.metadata),
        "rows": ds.n_points,
        "cols": ds.n_channels,
    }


def _book_preview_payload(ds: DataStruct) -> dict[str, Any]:
    """A non-primary book's lightweight inventory entry: real labels/units/
    metadata (so the Library folder tree, tags, and book name all resolve
    immediately) plus a downsampled preview time/values series (so a Library
    sparkline renders without the full column data) — never the full
    ``.time``/``.values``. ``lazy: true`` is the frontend's discriminant
    between this shape and a full/primary entry."""
    preview = decimate_datastruct(ds, target_points=_PREVIEW_POINTS)
    return {
        "lazy": True,
        "id": _origin_book_id(ds),
        "labels": list(ds.labels),
        "units": list(ds.units),
        "metadata": _slim_metadata(ds.metadata),
        "rows": ds.n_points,
        "cols": ds.n_channels,
        # Just time/values (not a full datastruct_payload): labels/units/
        # metadata above already describe this book, so nesting a second
        # copy of them under `preview` would double the very weight this
        # entry exists to avoid.
        "preview": {"time": jsonify(preview.time), "values": jsonify(preview.values)},
    }


def _book_source_ref(path: Path, upload_token: str | None) -> dict[str, str]:
    """A stable reference the frontend echoes back to ``/api/parsers/books/data``
    to fetch one lazy book's full data later: an upload token when this import
    came from ``/upload`` (its bytes are staged, not at a caller-visible path),
    else the resolved path ``/import`` already validated."""
    if upload_token is not None:
        return {"kind": "upload", "token": upload_token}
    return {"kind": "path", "path": str(path)}


def _import_with_books(
    path: Path, *, full_books: bool = False, upload_token: str | None = None
) -> dict[str, Any]:
    """Single-DataStruct payload; Origin projects also carry every workbook.

    A multi-book project adds ``"books": [...]`` so the Library still lists
    every workbook immediately (the locked import-all UX) — but, per
    ORIGIN_FILE_DECODE_PLAN #38, the PRIMARY book (the one this function also
    returns in full at the top level) gets a no-data MARKER entry
    (``_book_primary_marker`` — nothing to duplicate), and every OTHER entry
    is a lightweight inventory + downsampled preview (``_book_preview_payload``,
    never the full ``.time``/``.values``); ``"book_source"`` is the reference
    a later ``/api/parsers/books/data`` call uses to fetch one book's full
    data on its first activation in the UI. Importing PNR.opj (122 books,
    8.5M cells) this way shrinks the response from ~85 MB to ~2 MB (profiled
    2026-07-09 perf-quick-wins follow-up). Pass ``full_books=True`` (the
    pre-#38 behaviour, byte-for-byte: every book inline, no markers/preview)
    to get every book's data inline instead — used by tooling with no
    fetch-on-activate flow (see ``ImportRequest.full_books``'s docstring);
    other formats are untouched either way.

    Origin projects (``.opj``/``.opju``) are parsed ONCE via
    ``read_origin_project_all``: the primary dataset and the full book list
    used to come from two independent full-project parses (``import_auto`` ->
    ``read_origin_project``, then a separate ``read_origin_books``), each
    re-reading the file from disk and re-decoding every column; that
    redundant parse dominated the ~4s round-trip on a 121.56 MB / 8.5M-cell
    project (profiled 2026-07-09). The same already-read bytes are reused
    below for the figures scan too, instead of a third disk read. When lazy,
    the parsed book list is also handed to ``_bookcache`` so the common
    "activate a book right after import" path never re-parses.
    """
    suffix = path.suffix.lower()
    if suffix in (".opj", ".opju"):
        raw = path.read_bytes()
        ds, all_books = read_origin_project_all(path, raw=raw)
        books = drop_empty_library_books(all_books)
        if full_books:
            # Byte-for-byte the pre-#38 shape: every book inline, top level
            # unchanged (no metadata slimming — tooling built against the old
            # response, e.g. tools/visual/origin_figures.mjs, gets exactly
            # what it always got).
            payload = datastruct_payload(ds)
            if len(books) > 1:
                payload["books"] = [datastruct_payload(b) for b in books]
        else:
            payload = _book_payload(ds)
            if len(books) > 1:
                primary_id = _origin_book_id(ds)
                payload["books"] = [
                    _book_primary_marker(b)
                    if _origin_book_id(b) == primary_id
                    else _book_preview_payload(b)
                    for b in books
                ]
                payload["book_source"] = _book_source_ref(path, upload_token)
                cache_project_books(path, books)
        try:
            if suffix == ".opj":
                raw_figs = extract_figures(raw)
                preview_diagnostics: list[PreviewDiagnostic] = []
            else:
                raw_figs = extract_figures_opju(raw)
                raw_figs, preview_diagnostics = attach_opju_graph_previews(raw_figs, raw)
            source_names = {
                str(name)
                for book in books
                for name in (
                    book.metadata.get("origin_book", ""),
                    book.metadata.get("origin_book_long", ""),
                )
                if name
            }
            figs, fidelity = assess_origin_figures(
                raw_figs,
                container="opj" if suffix == ".opj" else "opju",
                source_names=source_names,
                preview_diagnostics=preview_diagnostics,
            )
        except (IndexError, ValueError, ArithmeticError, KeyError, struct.error):
            # Figures are an optional nicety; a decode hiccup on a malformed or
            # truncated project must degrade to "no figures", never fail the
            # whole import (the data books already succeeded above).
            figs = []
            fidelity = origin_figure_decode_failure(
                container="opj" if suffix == ".opj" else "opju"
            )
        if figs:
            payload["figures"] = figs
        payload["origin_fidelity"] = fidelity
        return payload

    ds = import_auto(path)
    return datastruct_payload(ds)


def _import_response(
    path: Path, *, full_books: bool = False, upload_token: str | None = None
) -> Response:
    """``_import_with_books`` plus its OWN JSON encoding, so both run off the
    event loop together.

    FastAPI's default response path for a plain ``dict`` return (no
    ``response_model`` -> ``fastapi.routing.serialize_response``'s
    ``jsonable_encoder`` branch, then ``JSONResponse.render``'s
    ``json.dumps``) runs on the EVENT LOOP regardless of which thread built
    the dict -- measured on the 300k-row CSV fixture in
    ``tests/test_upload_concurrency.py``: ``jsonable_encoder`` ~3.0s and
    ``json.dumps`` ~1.7s, versus ~3.3s for the parse itself. Wrapping only
    ``_import_with_books`` in ``run_in_threadpool`` (``upload_file``'s first
    revision) left this larger, un-offloaded-by-that-fix half of the
    blocking in place -- concurrent ``GET /api/health`` still stalled well
    past this module's latency budget. Building the ``Response`` HERE,
    inside the same ``run_in_threadpool`` call as the parse, makes FastAPI
    skip ``serialize_response`` entirely: it only runs when the returned
    value is not already a ``Response`` (``fastapi.routing``'s
    ``isinstance(raw_response, Response)`` check short-circuits it), so the
    whole path from bytes-on-disk to response-bytes-in-hand happens on the
    worker thread.

    ``dumps_payload`` (not a plain ``json.dumps`` call) for the encoding
    itself: a single ``json.dumps``/``.tolist()`` over the whole "time"/
    "values" arrays is ALSO one uninterruptible C call, so it can hold the
    GIL -- and so still stall a concurrent request -- for its own multi-
    hundred-millisecond-plus duration regardless of which thread runs it.
    ``dumps_payload``/``jsonify`` (``routes/_payload.py``) chunk exactly
    those two calls; see their docstrings for the profiled numbers. Their
    combined output is byte-for-byte what
    ``json.dumps(datastruct_payload(ds), ensure_ascii=False,
    allow_nan=False, separators=(",", ":"))`` (``starlette.responses.
    JSONResponse.render``'s exact kwargs) would produce.
    """
    payload = _import_with_books(path, full_books=full_books, upload_token=upload_token)
    return Response(content=dumps_payload(payload), media_type="application/json")


@router.post("/import")
def import_file(req: ImportRequest) -> dict[str, Any]:
    """Auto-detect format and import a local file path into a DataStruct.

    ``/import`` reads a path the server can already see (local desktop / CLI
    use). The path is ``os.path.realpath``-normalized (collapsing ``..`` and
    symlinks) and confined to an allowed root (home / cwd / temp, widen via
    ``QZ_DATA_ROOTS``) before any filesystem access, so the localhost API
    cannot be used to read system files (e.g. ``/etc/passwd``) through path
    traversal.
    """
    try:
        resolved = os.path.realpath(req.path)
    except (OSError, ValueError, ArithmeticError) as exc:
        raise HTTPException(status_code=400, detail="invalid path") from exc
    # Inline containment guard (kept in this function so the static analyzer can
    # see the path-traversal barrier sits between the taint and the sink).
    if resolved.startswith(_allowed_prefixes()):
        safe_path = resolved
    else:
        # MAIN_PLAN #31: a path the user physically picked in a NATIVE OS dialog
        # is explicitly consented, exactly as a browser file-picker upload is, so
        # it passes even from outside the roots. This is what makes a network
        # share or a second drive importable at all — the plan's headline pain
        # point. The containment check above still runs first and is unchanged;
        # consent is a narrow, additive second gate, never a replacement. Consent
        # is per EXACT resolved path, is only ever granted by the in-process
        # desktop bridge after a modal dialog returns, and has no HTTP route — a
        # page pointed at this server cannot self-authorize. See
        # quantized/desktop_consent.py.
        #
        # `consented_path`, not `is_consented`: the value opened below is the one
        # desktop_consent recorded when the dialog returned, so the request's own
        # string never reaches the filesystem on this branch.
        granted = consented_path(resolved)
        if granted is None:
            raise HTTPException(
                status_code=403,
                detail="path is outside the allowed roots (set QZ_DATA_ROOTS to widen)",
            )
        safe_path = granted
    if not os.path.isfile(safe_path):
        raise HTTPException(status_code=404, detail=f"file not found: {req.path}")
    try:
        return _import_with_books(Path(safe_path), full_books=req.full_books)
    except CALC_ERRORS_IO as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/upload", response_model=dict[str, Any])
async def upload_file(file: UploadFile, full_books: bool = False) -> Response:
    """Import an uploaded data file (browser file-picker / drag-drop).

    ``response_model=dict[str, Any]`` is DOCUMENTATION ONLY here: the actual
    return value is a pre-serialized ``Response`` (see below), which FastAPI
    passes straight through with no validation against this model at
    runtime -- it exists purely so the OpenAPI schema (and the frontend's
    generated types, ``frontend/api/openapi.json`` / ``schema.d.ts``) still
    describes this endpoint's real body shape (the same import payload
    ``import_file``/``/import`` returns) instead of the empty schema a bare
    ``Response`` return type would otherwise produce.

    The bytes are streamed to disk in bounded chunks (``_uploadstream``,
    ROBUSTNESS_PLAN #3) rather than read whole into memory, under the
    original *basename* (so the extension still drives format dispatch, and
    ``..`` path parts can't escape). An Origin project (``.opj``/``.opju``)
    is staged PERSISTENTLY (bounded LRU, see ``_uploadcache``) instead of in
    an ephemeral temp dir, because a lazy multi-book import (#38, the
    default — pass ``?full_books=true`` for the old inline-everything
    behaviour) needs the bytes to still be around when the browser later
    activates a non-primary book and fetches its full data
    (``/api/parsers/books/data``). Every other upload keeps the ephemeral
    temp dir: it's deleted before this handler returns, since nothing needs
    it afterwards. An upload past ``_uploadstream.MAX_UPLOAD_BYTES`` is
    rejected with HTTP 413 before it fully lands on disk.

    The parse (``_import_with_books``) AND its JSON encoding (see
    ``_import_response``) are both synchronous, CPU-bound work over a plain
    path -- neither touches any event-loop-only state -- so both run via a
    single ``run_in_threadpool`` call rather than inline on the event loop.
    A plain ``def`` route (e.g. ``import_file`` above) already gets its OWN
    body run this way for free from Starlette's own dispatch (every sync
    path function is itself run through ``run_in_threadpool``), but its
    response is still encoded on the loop afterwards -- not this handler's
    concern, since the fix here only targets the two ``async def`` upload
    handlers where the encoding step was newly discovered to matter (see
    ``_import_response``'s docstring for the profiled numbers). This handler
    must stay ``async def`` for the streaming ``await``s above, so the
    threadpool call is made explicit. Skipping either half of it -- the
    parse OR the encoding -- leaves a large upload (measured: 16.8s parse
    for a 1M-row CSV, 15.5s of that spent blocking a concurrent GET
    /api/health) starving every other request on the event loop, including
    job-queue polling and other windows' plot requests, for effectively the
    whole upload. The temp directory's cleanup (the ephemeral ``with``
    block's ``__exit__``) is ordered strictly after the threadpool call
    finishes because that call is awaited before the ``with`` block exits,
    so the file is never unlinked out from under a parse still reading it in
    the worker thread.
    """
    name = Path(file.filename or "upload.dat").name or "upload.dat"
    suffix = Path(name).suffix.lower()
    try:
        if suffix in (".opj", ".opju"):
            dest, token = await stage_upload_stream(name, file)
            return await run_in_threadpool(
                _import_response, dest, full_books=full_books, upload_token=token
            )
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / name
            await stream_to_path(file, dest, filename=name)
            return await run_in_threadpool(_import_response, dest, full_books=full_books)
    except UploadTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except CALC_ERRORS_IO as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
