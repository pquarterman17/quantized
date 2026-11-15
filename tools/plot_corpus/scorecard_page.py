"""Owner review page for the combined scorecard (``scorecard.py``).

One card per (plot type x family) specimen: Origin's own PNG | quantized's
import render | quantized's from-scratch PNG, with the verdicts beside them.

The import render column is always a placeholder: ``score_import.py`` scores
the decoded figure and the curves the frontend WOULD draw (``frontend_view``),
but nothing in the harness rasterises that view, so there is no image to show.
Images are downscaled to ``MAX_W`` px JPEGs so the whole folder stays small.
"""

from __future__ import annotations

import html
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

__all__ = ["MAX_W", "write_page"]

MAX_W = 600
_ABBR = {"match": "M", "wrong": "W", "phantom": "P", "omitted": "O", "n/a": "-"}


def _shrink(src: Path, dst: Path) -> bool:
    from PIL import Image

    if not src.is_file():
        return False
    with Image.open(src) as im:
        im = im.convert("RGB")
        if im.width > MAX_W:
            im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.save(dst, "JPEG", quality=70, optimize=True)
    return True


def _img(rel: str | None, ok: bool, label: str) -> str:
    if rel and ok:
        return f'<figure><img loading="lazy" src="{rel}" alt="{html.escape(label)}">' \
               f"<figcaption>{html.escape(label)}</figcaption></figure>"
    return f'<figure class="none"><div>{html.escape(label)}: none</div></figure>'


def _card(r: Mapping[str, Any], imgs: Sequence[str]) -> str:
    one, two = r["import"], r["scratch"]
    if one["status"] == "scored":
        dims = "".join(
            f'<span class="v {d["verdict"]}" title="{html.escape(str(d["counts"]))}">'
            f"{html.escape(n)} {_ABBR[d['verdict']]}</span>"
            for n, d in one["dims"].items())
    else:
        dims = f'<span class="v omitted">{html.escape(str(one["status"]))}</span>'
    why = two.get("why") or ""
    own = sorted({o for v in r["owners"].values() for o in v})
    return (
        f'<section id="{html.escape(r["key"])}" class="{two["verdict"].replace(" ", "-")}">'
        f"<h3>{html.escape(r['key'])}</h3><div class=row>{''.join(imgs)}</div>"
        f"<p><b>Check 1 (import)</b> {dims}</p>"
        f'<p><b>Check 2 (from scratch)</b> <span class="v {two["verdict"]}">'
        f"{html.escape(two['built'])} / {html.escape(two['verdict'])}</span> "
        f"{html.escape(why)}</p><p><b>Owner</b> {html.escape(', '.join(own) or '-')}</p></section>"
    )


_CSS = """
body{font:14px system-ui;margin:16px;background:#fafafa;color:#222}
.row{display:flex;gap:8px}figure{margin:0;flex:1;min-width:0}img{width:100%;border:1px solid #ccc}
.none div{border:1px dashed #aaa;padding:40px 4px;text-align:center;color:#888}
figcaption{font-size:12px;color:#555}section{background:#fff;border:1px solid #ddd;
margin:12px 0;padding:8px 12px}h3{margin:0 0 6px}.v{display:inline-block;margin:0 4px 2px 0;
padding:0 6px;border-radius:3px;background:#e6e6e6}
.v.wrong,.v.mismatch,.v.unbuildable{background:#f5b7b1}
.v.phantom{background:#f8c471}.v.match{background:#abebc6}
"""


def write_page(
    rows: Sequence[Mapping[str, Any]], corpus: Path, scratch_review: Path, out: Path
) -> int:
    """Write ``index.html`` + ``img/``; returns the number of images written."""
    n = 0
    cards = []
    for r in rows:
        key = r["key"].replace("/", "__")
        t, f = r["type"], r["family"]
        origin_ok = _shrink(corpus / t / f / "specimen.png", out / "img" / f"{key}.origin.jpg")
        s = r["scratch"]
        scratch_ok = bool(s.get("png")) and _shrink(
            scratch_review / s["png"], out / "img" / f"{key}.scratch.jpg")
        n += origin_ok + scratch_ok
        cards.append(_card(r, [
            _img(f"img/{key}.origin.jpg", origin_ok, "Origin"),
            _img(None, False, "quantized import (no render: scorer does not rasterise)"),
            _img(f"img/{key}.scratch.jpg", scratch_ok,
                 "quantized from scratch" if scratch_ok else "quantized from scratch "
                 f"({s.get('built')})"),
        ]))
    page = ("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>"
            f"<title>Plot corpus scorecard</title><style>{_CSS}</style>"
            f"<h1>Plot corpus scorecard</h1><p>{len(rows)} specimens. Import dimensions: "
            "M match, W wrong, P phantom, O omitted (worst cell).</p>" + "".join(cards))
    (out / "index.html").write_text(page, encoding="utf-8")
    return n
