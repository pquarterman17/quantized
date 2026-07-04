"""COM "Send to Origin" — push DataStructs into a RUNNING OriginPro instance.

Plan item 25 (Windows-only, optional, feature-flagged; architecture guard
#10): COM ("Send to Origin") is never a hard dependency and never a CI
requirement. Everywhere else (macOS/Linux, Origin absent, the flag off, or a
failed dispatch) callers fall back to the existing Origin-ASCII / ``.ogs``
export (``io/origin.py``, routes ``/api/export/origin`` and
``/api/export/origin-project``).

Gated behind the ``QZ_ORIGIN_COM=1`` environment variable so a stray pywin32
install on a Windows dev/CI box never silently starts dispatching COM.
``win32com`` is imported LAZILY inside the two public functions, never at
module scope, so this module imports cleanly on macOS/Linux and keeps the
``io/`` pure-layer + no-hard-dependency guarantees (enforced by
``tests/test_repo_integrity.py``).

Reuses the LabTalk/COM surface proven in ``tools/origin_trial/
generate_specimens.py`` (the only prior code in this repo to drive Origin's
COM API): a single ``Origin.ApplicationSI`` instance, ``newbook`` + LabTalk
``option:=lsname``, ``PutWorksheet(rows)`` for bulk numeric data (row-major,
time column first, then one column per value channel), and a single
``range ...; ....lname$=...; ....unit$=...;`` LabTalk ``Execute`` call per
column for long names/units — direct COM property assignment on worksheet
ranges is flaky in practice; LabTalk string commands are the reliable path
(see that script's docstring for the hard-won gotchas: only one live
``ApplicationSI`` instance at a time — a dead/killed server faults every
subsequent call).

Scope note: this pushes data + long names/units only (matches the plan-item
ask); it does not set column designations (X/Y/Y-error types) the way the
``.ogs`` exporter does — a deliberate smaller surface for the first cut,
worth revisiting once item 25 is live-verified against real Origin.

This repo's own tests never dispatch real COM — see ``tests/test_origin_com.py``
(mock-based only, a fake ``win32com`` module injected via ``sys.modules``).
"""

from __future__ import annotations

import os
import re
import sys
from collections.abc import Sequence
from typing import Any

from quantized.datastruct import DataStruct

__all__ = ["com_available", "send_to_origin"]

_FLAG_ENV = "QZ_ORIGIN_COM"
_UNAVAILABLE_HINT = (
    "Use the Origin-ASCII / .ogs export instead "
    "(POST /api/export/origin or /api/export/origin-project)."
)


def com_available() -> bool:
    """True only on Windows, with ``QZ_ORIGIN_COM=1`` set, AND pywin32
    importable. Never raises — every check is a soft probe, so callers
    (routes, capability checks) can call this unconditionally on any platform.
    """
    if sys.platform != "win32":
        return False
    if os.environ.get(_FLAG_ENV) != "1":
        return False
    try:
        import win32com.client  # noqa: F401  (lazy: optional Windows-only dep)
    except ImportError:
        return False
    return True


def _escape_lt(text: str) -> str:
    """Escape double-quotes for a LabTalk string literal."""
    return text.replace('"', '\\"')


def _sanitize_book_name(name: str, index: int, used: set[str]) -> str:
    """A unique, LabTalk-legal workbook short name: non-word chars ->
    underscore, never digit-leading, falls back to ``Book<N>`` when empty,
    and de-duplicated against every name already handed out in this call."""
    cleaned = re.sub(r"\W", "_", name).strip("_") or f"Book{index + 1}"
    if cleaned[0].isdigit():
        cleaned = f"B{cleaned}"
    book, n = cleaned, 1
    while book in used:
        n += 1
        book = f"{cleaned}{n}"
    used.add(book)
    return book


def _label_column(app: Any, book: str, col: int, lname: str, unit: str) -> None:
    """One LabTalk ``Execute`` assigning a column's long name + unit via a
    ``range`` reference — mirrors ``tools/origin_trial/generate_specimens.py``
    (``range ra = [Book]1!col(1); ra.lname$="..."; ra.unit$="...";``)."""
    var = f"__c{col}"
    parts = [f"range {var} = [{book}]1!col({col});"]
    if lname:
        parts.append(f'{var}.lname$ = "{_escape_lt(lname)}";')
    if unit:
        parts.append(f'{var}.unit$ = "{_escape_lt(unit)}";')
    if len(parts) == 1:
        return  # nothing to label
    cmd = " ".join(parts)
    if not app.Execute(cmd):
        raise RuntimeError(f"Origin LabTalk command failed: {cmd}")


def send_to_origin(
    datasets: Sequence[DataStruct],
    *,
    book_names: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Push each ``DataStruct`` into a new workbook in a RUNNING Origin
    instance via COM, with long names/units set from ``.labels``/``.units``.

    ``book_names[i]`` (if given and non-empty) names workbook ``i``;
    otherwise falls back to ``metadata['origin_book']`` then ``Book<N>``.
    Returns ``{"books": [<created workbook names>], "rows": [<row count per
    book>]}``.

    Raises ``RuntimeError`` (never a raw COM exception) when COM is
    unavailable, Origin rejects a command, or dispatch fails — the caller
    (the export route) maps that to an HTTP 409 pointing at the ``.ogs``
    fallback.
    """
    if not datasets:
        raise ValueError("send_to_origin needs at least one dataset")
    if not com_available():
        raise RuntimeError(
            "Origin COM is unavailable on this machine (needs Windows, "
            f"pywin32, {_FLAG_ENV}=1, and a running OriginPro instance). "
            + _UNAVAILABLE_HINT
        )

    import win32com.client as win32  # lazy: optional Windows-only dep

    try:
        app = win32.gencache.EnsureDispatch("Origin.ApplicationSI")
    except Exception as exc:  # pragma: no cover - real COM only, never in CI
        raise RuntimeError(
            "Could not connect to a running Origin instance via COM. Start "
            "OriginPro first, then retry. " + _UNAVAILABLE_HINT
        ) from exc

    names = list(book_names) if book_names is not None else []
    used: set[str] = set()
    books: list[str] = []
    rows_created: list[int] = []
    try:
        for i, ds in enumerate(datasets):
            raw = names[i] if i < len(names) and names[i] else ""
            if not raw:
                raw = str(ds.metadata.get("origin_book", "")) or f"Book{i + 1}"
            book = _sanitize_book_name(raw, i, used)

            if not app.Execute(f"newbook name:={book} option:=lsname;"):
                raise RuntimeError(f"Origin rejected 'newbook' for workbook {book!r}.")

            cols = [ds.time.tolist()]
            cols.extend(ds.values[:, c].tolist() for c in range(ds.n_channels))
            rows = [list(r) for r in zip(*cols, strict=True)]
            app.PutWorksheet(f"[{book}]1", rows, 0, 0)

            x_name = str(
                ds.metadata.get("x_column_name") or ds.metadata.get("xColumnName") or "X"
            )
            x_unit = str(ds.metadata.get("x_column_unit") or ds.metadata.get("xColumnUnit") or "")
            _label_column(app, book, 1, x_name, x_unit)
            for k, (label, unit) in enumerate(zip(ds.labels, ds.units, strict=True)):
                _label_column(app, book, k + 2, label, unit)

            books.append(book)
            rows_created.append(ds.n_points)
    except RuntimeError:
        raise
    except Exception as exc:  # pragma: no cover - real COM only, never in CI
        raise RuntimeError(f"Origin COM call failed: {exc}") from exc

    return {"books": books, "rows": rows_created}
