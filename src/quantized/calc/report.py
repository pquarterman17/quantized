"""Structured report sheets: the serializable substrate for exports & batch.

ORIGIN_GAP_PLAN #36 (W7 contract item). A :class:`ReportSheet` is plain,
diffable, JSON-round-trippable data (like ``DataStruct``) — never markup. Curve
fits, peak fits, W5 stats, the peak wizard, and batch runs all emit one (see
:mod:`quantized.calc.report_emit`); the #37/#38 exporters (docx / pptx / LaTeX /
HTML) and the future frontend viewer render the SAME schema with no
per-renderer special cases.

Structure — a report is a title + optional source references + an ordered list
of sections; each section is a title + an ordered list of typed blocks. Blocks
are a small closed set discriminated by ``"type"``::

    text    {"type": "text",   "text": str}
    table   {"type": "table",  "columns": [str], "rows": [[cell]], "caption"?}
    params  {"type": "params", "params": [{name, value, error?, unit?}], "caption"?}
    figure  {"type": "figure", "name": str, "image"?: {mime, data}, "caption"?}

A table cell is ``str | float | int | None``. Builders validate and normalize
on the way in (numpy scalars -> python scalars); :func:`validate_report`
re-checks a decoded dict so a round-tripped or hand-authored report is safe to
hand to any renderer.

Pure layer — no fastapi/pydantic imports (enforced by test_repo_integrity).
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "BLOCK_TYPES",
    "ReportSheet",
    "figure_block",
    "params_block",
    "section",
    "source_ref",
    "table_block",
    "text_block",
    "validate_report",
]

BLOCK_TYPES = ("text", "table", "params", "figure")


def _cell(value: Any) -> str | float | int | None:
    """Coerce a table cell to a JSON scalar (numpy scalars -> python)."""
    if value is None:
        return None
    if isinstance(value, bool):  # keep bool out of the int branch
        return str(value)
    if isinstance(value, (int, float)):
        v = float(value)
        return None if not math.isfinite(v) else value
    # numpy scalar or anything else -> try float, else str
    try:
        return float(value)
    except (TypeError, ValueError):
        return str(value)


# ── Block builders ────────────────────────────────────────────────────────
def text_block(text: str) -> dict[str, Any]:
    """A free-text note block."""
    return {"type": "text", "text": str(text)}


def table_block(
    columns: Sequence[str],
    rows: Iterable[Sequence[Any]],
    *,
    caption: str | None = None,
) -> dict[str, Any]:
    """A generic table: column headers + a grid of scalar cells.

    Covers ANOVA / post-hoc / descriptive-stats / peak tables — anything
    rectangular. Every row must match the column count.
    """
    cols = [str(c) for c in columns]
    out_rows: list[list[str | float | int | None]] = []
    for r in rows:
        r = list(r)
        if len(r) != len(cols):
            raise ValueError(f"row has {len(r)} cells, expected {len(cols)}")
        out_rows.append([_cell(v) for v in r])
    block: dict[str, Any] = {"type": "table", "columns": cols, "rows": out_rows}
    if caption:
        block["caption"] = str(caption)
    return block


def params_block(
    params: Iterable[Mapping[str, Any]],
    *,
    caption: str | None = None,
) -> dict[str, Any]:
    """A fitted-parameter block: ordered ``{name, value, error?, unit?}`` rows.

    Kept distinct from a plain table so renderers can format value ± error to
    the precision implied by the uncertainty (the LaTeX/booktabs path, #38).
    """
    out: list[dict[str, Any]] = []
    for p in params:
        entry: dict[str, Any] = {"name": str(p["name"]), "value": float(p["value"])}
        err = p.get("error")
        if err is not None and not (isinstance(err, float) and math.isnan(err)):
            entry["error"] = float(err)
        unit = p.get("unit")
        if unit:
            entry["unit"] = str(unit)
        out.append(entry)
    block: dict[str, Any] = {"type": "params", "params": out}
    if caption:
        block["caption"] = str(caption)
    return block


def figure_block(
    name: str,
    *,
    image: Mapping[str, str] | None = None,
    caption: str | None = None,
) -> dict[str, Any]:
    """A figure reference, optionally carrying an embedded image.

    ``image`` is ``{"mime": "image/png"|"image/svg+xml"|..., "data": <base64>}``
    so an exporter can embed the figure without re-rendering; without it the
    block is a pure reference (``name`` points at a FigureDoc, #12).
    """
    block: dict[str, Any] = {"type": "figure", "name": str(name)}
    if image is not None:
        if "mime" not in image or "data" not in image:
            raise ValueError("figure image needs 'mime' and 'data' keys")
        block["image"] = {"mime": str(image["mime"]), "data": str(image["data"])}
    if caption:
        block["caption"] = str(caption)
    return block


def section(title: str, blocks: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """A titled, ordered group of blocks."""
    return {"title": str(title), "blocks": [dict(b) for b in blocks]}


def source_ref(kind: str, ref_id: str, name: str | None = None) -> dict[str, Any]:
    """A pointer back to a source object (dataset / fit / figure id)."""
    ref: dict[str, Any] = {"kind": str(kind), "id": str(ref_id)}
    if name:
        ref["name"] = str(name)
    return ref


# ── Validation ──────────────────────────────────────────────────────────────
def _validate_block(block: Mapping[str, Any], where: str) -> None:
    btype = block.get("type")
    if btype not in BLOCK_TYPES:
        raise ValueError(f"{where}: unknown block type {btype!r}")
    if btype == "text":
        if not isinstance(block.get("text"), str):
            raise ValueError(f"{where}: text block needs a string 'text'")
    elif btype == "table":
        cols = block.get("columns")
        rows = block.get("rows")
        if not isinstance(cols, list) or not isinstance(rows, list):
            raise ValueError(f"{where}: table needs list 'columns' and 'rows'")
        for r in rows:
            if not isinstance(r, list) or len(r) != len(cols):
                raise ValueError(f"{where}: every table row must match the column count")
    elif btype == "params":
        ps = block.get("params")
        if not isinstance(ps, list):
            raise ValueError(f"{where}: params block needs a list 'params'")
        for p in ps:
            if "name" not in p or "value" not in p:
                raise ValueError(f"{where}: each param needs 'name' and 'value'")
    elif btype == "figure":  # noqa: SIM102
        if not isinstance(block.get("name"), str):
            raise ValueError(f"{where}: figure block needs a string 'name'")


def validate_report(payload: Mapping[str, Any]) -> None:
    """Raise ``ValueError`` if ``payload`` is not a well-formed report dict."""
    if not isinstance(payload.get("title"), str):
        raise ValueError("report needs a string 'title'")
    sections = payload.get("sections", [])
    if not isinstance(sections, list):
        raise ValueError("report 'sections' must be a list")
    for si, sec in enumerate(sections):
        if not isinstance(sec.get("title"), str):
            raise ValueError(f"section {si} needs a string 'title'")
        blocks = sec.get("blocks", [])
        if not isinstance(blocks, list):
            raise ValueError(f"section {si} 'blocks' must be a list")
        for bi, block in enumerate(blocks):
            _validate_block(block, f"section {si} block {bi}")


# ── The report sheet ──────────────────────────────────────────────────────
@dataclass(frozen=True, slots=True)
class ReportSheet:
    """An immutable, serializable report: title + source refs + sections."""

    title: str
    sections: tuple[dict[str, Any], ...] = ()
    source_refs: tuple[dict[str, Any], ...] = ()
    created: str | None = None  # ISO string, set by the caller (keeps calc pure/deterministic)
    meta: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "sections": [dict(s) for s in self.sections],
            "source_refs": [dict(r) for r in self.source_refs],
            "created": self.created,
            "meta": dict(self.meta),
        }

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> ReportSheet:
        validate_report(payload)
        return cls(
            title=str(payload["title"]),
            sections=tuple(dict(s) for s in payload.get("sections", [])),
            source_refs=tuple(dict(r) for r in payload.get("source_refs", [])),
            created=payload.get("created"),
            meta=dict(payload.get("meta", {})),
        )

    def to_json(self) -> str:
        return json.dumps(self.to_dict())

    @classmethod
    def from_json(cls, text: str) -> ReportSheet:
        return cls.from_dict(json.loads(text))

    def iter_blocks(self) -> Iterable[dict[str, Any]]:
        """Yield every block across all sections (renderer convenience)."""
        for sec in self.sections:
            yield from sec.get("blocks", [])
