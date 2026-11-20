"""Value-free per-project fingerprint of an Origin import.

Everything recorded here is structure (names, bindings, counts, ranges the
reader decoded, colours, reasons) - never cell data. ``fingerprint_payload``
is pure so tests can build payloads synthetically; ``fingerprint_file`` is the
only function that touches the importer.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

SCHEMA = 1
_AXIS_KEYS = ("x_from", "x_to", "x_log", "y_from", "y_to", "y_log")
# Curve fields kept verbatim; any field whose name suggests an error role
# (yErr / plus / minus / xErr / band) is kept too, so new roles are seen.
_CURVE_KEYS = (
    "book", "sheet", "x", "y", "xRecorded", "plotType", "style", "symbol",
    "color", "hidden",
)  # fmt: skip
_ROLE_HINTS = ("err", "plus", "minus", "band")
_OMIT_LISTS = ("curve_sheet_omitted", "omitted_curves", "curve_omissions")


def _scalar(v: Any) -> Any:
    """JSON-stable, bounded form of one field (floats rounded; big -> hash)."""
    if isinstance(v, float):
        return round(v, 9)
    if v is None or isinstance(v, (bool, int, str)):
        return v
    text = repr(v)
    return "h:" + hashlib.sha1(text.encode("utf-8", "replace")).hexdigest()[:12]


def curve_fp(c: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in c.items():
        if k in _CURVE_KEYS or any(h in k.lower() for h in _ROLE_HINTS):
            out[k] = _scalar(v)
    return out


def figure_fp(f: dict[str, Any]) -> dict[str, Any]:
    omitted = []
    for key in _OMIT_LISTS:
        for o in f.get(key) or []:
            omitted.append(
                {k: _scalar(o.get(k)) for k in ("book", "sheet", "x", "y", "reason") if k in o}
            )
    return {
        "name": f.get("name"),
        "layer": f.get("layer"),
        "axes": {k: _scalar(f.get(k)) for k in _AXIS_KEYS},
        "curves": [curve_fp(c) for c in f.get("curves") or []],
        "omitted": omitted,
        "fid": sorted((f.get("fidelity") or {}).get("omissions", [])),
    }


def book_fp(b: dict[str, Any]) -> dict[str, Any]:
    labels = repr(list(b.get("labels") or []))
    return {
        "id": b.get("id"),
        "rows": b.get("rows"),
        "cols": b.get("cols"),
        "labels": hashlib.sha1(labels.encode("utf-8", "replace")).hexdigest()[:12],
    }


def fingerprint_payload(p: dict[str, Any]) -> dict[str, Any]:
    m = p.get("origin_fidelity") or {}
    return {
        "status": m.get("status"),
        "omissions": sorted(m.get("omissions", [])),
        "total": m.get("graph_records_total"),
        "actionable": len(p.get("figures") or []),
        "filtered": sorted(
            f"{f.get('name', '')}|{f.get('reason', '')}" for f in m.get("filtered_figures", [])
        ),
        "unrecovered": m.get("unrecovered_graph_count", 0),
        "embedded": m.get("embedded_graph_count", 0),
        "books": [book_fp(b) for b in p.get("books") or []],
        "figures": [figure_fp(f) for f in p.get("figures") or []],
    }


def fingerprint_file(path: Path) -> dict[str, Any]:
    """Import one project and fingerprint it; failures are fingerprints too."""
    from quantized.io.origin_project import OriginProjectError
    from quantized.routes.parsers import _import_with_books

    try:
        payload, _ = _import_with_books(path)
    except OriginProjectError as e:
        return {"error": f"OriginProjectError: {str(e)[:160]}"}
    except Exception as e:  # noqa: BLE001 - a crash is a regression datum
        return {"error": f"crash {type(e).__name__}: {str(e)[:160]}"}
    if "origin_fidelity" not in payload:
        return {"error": "not_a_project"}
    return fingerprint_payload(payload)
