"""Step 3 of the preview-oracle visual check: score + gallery.

Pairs every Origin-saved preview (``origin_preview_extract.py``) with our
render (``origin_preview_shots.mjs``), computes the coarse signals of
``origin_preview_signals`` on both, ranks the pages by how suspicious the
pair looks, and writes (under ``--out``, a scratch directory):

    <out>/signals.json   one scored row per page
    <out>/gallery.html   Origin image | ours | project/page/curve facts,
                         most suspicious first; unrecovered and unrendered
                         pages in their own sections

The score is a triage order for a human review, not a verdict: a high score
says "look here first". Weights live in ``score``.

Usage::

    uv run python tools/visual/origin_preview_report.py --out <scratch>/visual [--top 400]
"""

from __future__ import annotations

import argparse
import html
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from origin_preview_signals import (  # noqa: E402
    bbox_iou,
    find_frame,
    grid_overlap,
    ink_signals,
    union_box,
)


def _rgb(path: Path) -> np.ndarray[Any, np.dtype[np.uint8]]:
    with Image.open(path) as im:
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        return np.asarray(Image.alpha_composite(bg, im.convert("RGBA")).convert("RGB"))


def score(row: dict[str, Any]) -> tuple[float, list[str]]:
    """Suspicion score and the human-readable reasons behind it."""
    o, q = row["origin"], row["ours"]
    why: list[str] = []
    s = 0.0
    # `visible_samples` reads the active dataset only (a cross-book overlay
    # or a multi-panel apply can draw from others), so it is not a verdict.
    if o["ink_fraction"] > 0.002 and row["series"] == 0:
        s += 5
        why.append("Origin draws data, ours plots nothing")
    elif o["ink_fraction"] > 0.002 and q["ink_fraction"] < 0.0005:
        s += 4
        why.append("ours has (almost) no ink in the plot area")
    ov = row["grid_overlap"]
    if ov is not None:
        s += 3 * (1 - ov)
        if ov < 0.5:
            why.append(f"ink layout differs (overlap {ov:.2f})")
    iou = row["bbox_iou"]
    if iou is not None:
        s += 2 * (1 - iou)
        if iou < 0.5:
            why.append(f"ink extent differs (bbox IoU {iou:.2f})")
    dh = abs(o["hue_clusters"] - q["hue_clusters"])
    if dh:
        s += min(3, dh)
        why.append(f"coloured series {o['hue_clusters']} (Origin) vs {q['hue_clusters']} (ours)")
    legend_n = row["legend_n"]
    if legend_n and row["series"] and legend_n != row["series"]:
        s += 0.5
        why.append(f"{legend_n} decoded legend entries vs {row['series']} plotted series")
    if row["errors"]:
        s += 2
        why.append("browser error while applying")
    return round(s, 3), why


def analyse(out: Path) -> list[dict[str, Any]]:
    projects = json.loads((out / "pages.json").read_text("utf-8"))
    rows: list[dict[str, Any]] = []
    for proj in projects:
        shots_file = out / "ours" / proj["pid"] / "shots.json"
        shots = json.loads(shots_file.read_text("utf-8")) if shots_file.exists() else None
        for page in proj.get("pages", []):
            base = {
                "pid": proj["pid"],
                "priority": bool(proj.get("priority")),
                "oracle": page["preview"].get("kind", "saved_preview"),
                "project": proj["project"],
                "page": page["page"],
                "origin_file": page["preview"]["file"],
                "ncurves": page["ncurves"],
                "layers": len(page["layers"]),
                "legend_n": sum(len(layer["legend_labels"]) for layer in page["layers"]),
                "omitted": sorted({r for layer in page["layers"] for r in layer["omitted"]}),
            }
            orgb = _rgb(out / page["preview"]["file"])
            origin = ink_signals(orgb, find_frame(orgb)).as_dict()
            shot = (shots or {}).get("pages", {}).get(page["page"]) if shots else None
            if page["unrecovered"] or not shot or not shot.get("file"):
                if page["unrecovered"]:
                    state = "unrecovered"
                elif shots is None:
                    state = "not_shot"
                elif shots.get("error"):
                    state = f"shot_error: {shots['error'][:120]}"
                elif shot and shot.get("unresolved"):
                    state = "unresolved"
                else:
                    state = "no_render"
                rows.append({**base, "state": state, "origin": origin})
                continue
            qrgb = _rgb(out / shot["file"])
            box = union_box(shot.get("overs") or [], qrgb.shape[1], qrgb.shape[0])
            ours = ink_signals(qrgb, box or find_frame(qrgb)).as_dict()
            row = {
                **base,
                "state": "paired",
                "ours_file": shot["file"],
                "series": shot.get("series", 0),
                "visible_samples": shot.get("visible_samples", 0),
                "errors": shot.get("errors") or [],
                "origin": origin,
                "ours": ours,
                "grid_overlap": grid_overlap(origin["grid"], ours["grid"]),
                "bbox_iou": bbox_iou(origin["ink_bbox"], ours["ink_bbox"]),
            }
            row["score"], row["why"] = score(row)
            rows.append(row)
    return rows


_CSS = """body{font:13px system-ui,sans-serif;margin:16px;background:#f4f4f6;color:#222}
.card{display:grid;grid-template-columns:320px 420px 1fr;gap:12px;background:#fff;
border:1px solid #ddd;border-radius:6px;padding:10px;margin:8px 0}
.card img{max-width:100%;border:1px solid #eee;image-rendering:auto}
.o img{width:320px}.meta{font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap}
h2{margin-top:28px}.why{color:#a33}a{color:#246}"""


def _card(r: dict[str, Any], rank: int | None) -> str:
    o_img = f'<div class="o"><img loading="lazy" src="{html.escape(r["origin_file"])}"></div>'
    q_img = (
        f'<div><img loading="lazy" src="{html.escape(r["ours_file"])}"></div>'
        if r.get("ours_file")
        else f"<div><b>{html.escape(r['state'])}</b></div>"
    )
    facts = {
        k: r.get(k)
        for k in ("score", "series", "visible_samples", "ncurves", "layers", "legend_n")
        if r.get(k) is not None
    }
    facts["oracle"] = r["oracle"]
    facts["origin hues/ink"] = (r["origin"]["hue_clusters"], r["origin"]["ink_fraction"])
    if "ours" in r:
        facts["ours hues/ink"] = (r["ours"]["hue_clusters"], r["ours"]["ink_fraction"])
        facts["grid overlap / bbox IoU"] = (r["grid_overlap"], r["bbox_iou"])
    if r["omitted"]:
        facts["omitted"] = r["omitted"]
    head = f"#{rank} " if rank is not None else ""
    lines = "\n".join(f"{k}: {v}" for k, v in facts.items())
    why = "<br>".join(html.escape(w) for w in r.get("why", []))
    return (
        f'<div class="card" id="{r["pid"]}-{html.escape(r["page"])}">{o_img}{q_img}'
        f'<div class="meta"><b>{head}{html.escape(r["page"])}</b>  [{r["pid"]}]\n'
        f"{html.escape(Path(r['project']).name)}\n<span title='{html.escape(r['project'])}'>"
        f"{html.escape(str(Path(r['project']).parent.name))}</span>\n\n{html.escape(lines)}"
        f'\n<span class="why">{why}</span></div></div>'
    )


def gallery(rows: list[dict[str, Any]], top: int) -> str:
    def ranked(rs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted(rs, key=lambda r: (-r["score"], r["pid"]))

    paired = [r for r in rows if r["state"] == "paired"]
    prio = ranked([r for r in paired if r["priority"]])
    rest = ranked([r for r in paired if not r["priority"]])
    other = [r for r in rows if r["state"] != "paired"]
    parts = [
        "<!doctype html><meta charset=utf-8><title>Origin preview oracle</title>",
        f"<style>{_CSS}</style>",
        "<h1>Origin-rendered oracle | quantized render</h1>",
        f"<p>{len(paired)} paired pages, {len(other)} without a render. Ranked by suspicion "
        "score (triage order, not a verdict). Priority projects (graphs Origin exported "
        "itself) come first.</p>",
    ]
    if prio:
        parts.append(f"<h2>Priority: Origin-exported graphs ({len(prio)})</h2>")
        parts += [_card(r, i + 1) for i, r in enumerate(prio)]
    parts.append(f"<h2>Saved-preview pages (top {min(top, len(rest))} of {len(rest)})</h2>")
    parts += [_card(r, i + 1) for i, r in enumerate(rest[:top])]
    for state in sorted({r["state"] for r in other}):
        group = sorted(
            (r for r in other if r["state"] == state), key=lambda r: (not r["priority"], r["pid"])
        )
        parts.append(f"<h2>{html.escape(state)} ({len(group)})</h2>")
        parts += [_card(r, None) for r in group]
    return "\n".join(parts)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--top", type=int, default=400)
    args = ap.parse_args(argv)
    rows = analyse(args.out)
    for r in rows:  # grids are bulky and only needed for scoring
        for side in ("origin", "ours"):
            if side in r:
                r[side].pop("grid", None)
    (args.out / "signals.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), "utf-8")
    (args.out / "gallery.html").write_text(gallery(rows, args.top), "utf-8")
    paired = [r for r in rows if r["state"] == "paired"]
    mean = sum(r["score"] for r in paired) / len(paired) if paired else math.nan
    print(f"{len(rows)} pages, {len(paired)} paired, mean score {mean:.2f}")
    print(f"gallery: {args.out / 'gallery.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
