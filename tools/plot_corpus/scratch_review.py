"""Plan item 3: the owner's review page and the per-type scorecard.

``write_review(rows, out)`` writes ``<out>/index.html`` (static, no scripts:
Origin's PNG beside quantized's for every specimen, grouped by type, with
each check's verdict) and ``<out>/scorecard.md`` (the per-type table).
"""

from __future__ import annotations

import html
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from scratch_score import CORE_CHECKS

__all__ = ["type_table", "write_review"]

_CHECKS = (*CORE_CHECKS, "axes", "styles")


def type_table(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One line per corpus type: specimens, built, match, and per-check wrongs."""
    by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_type[r["type"]].append(r)
    table = []
    for t, rs in by_type.items():
        wrong: Counter[str] = Counter()
        for r in rs:
            for k, ch in r.get("checks", {}).items():
                if ch["state"] == "wrong":
                    wrong[k] += 1
        table.append(
            {
                "type": t,
                "n": len(rs),
                "built": sum(r["built"] == "built" for r in rs),
                "match": sum(r["verdict"] == "match" for r in rs),
                "status": rs[0]["built"] if rs[0]["built"] == "unbuildable" else "",
                "wrong": dict(wrong),
                "recipe": rs[0].get("note") or "",
            }
        )
    return table


def _md(table: list[dict[str, Any]]) -> str:
    lines = [
        "| type | specimens | built | match | " + " | ".join(f"{c} wrong" for c in _CHECKS) + " |",
        "|---|---|---|---|" + "---|" * len(_CHECKS),
    ]
    for t in table:
        if t["status"] == "unbuildable":
            lines.append(f"| {t['type']} | {t['n']} | unbuildable | - |" + " - |" * len(_CHECKS))
            continue
        cells = " | ".join(str(t["wrong"].get(c, 0)) for c in _CHECKS)
        lines.append(f"| {t['type']} | {t['n']} | {t['built']} | {t['match']} | {cells} |")
    total = sum(t["n"] for t in table)
    built = sum(t["built"] for t in table)
    match = sum(t["match"] for t in table)
    lines.append(f"| **total** | {total} | {built} | {match} |" + " |" * len(_CHECKS))
    return "\n".join(lines) + "\n"


_CSS = """
:root { --bg:#fff; --fg:#1b1b1f; --muted:#666; --line:#ddd;
        --ok:#1a7f37; --bad:#c62828; --na:#888; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#16161a; --fg:#e8e8ec; --muted:#9a9aa5; --line:#33333a; } }
body { background:var(--bg); color:var(--fg); font:14px/1.45 system-ui,sans-serif;
       margin:0 16px 48px; }
h1 { font-size:20px; }
h2 { font-size:17px; margin-top:32px; border-bottom:1px solid var(--line); }
table { border-collapse:collapse; }
td,th { border:1px solid var(--line); padding:3px 7px; text-align:left; }
.spec { border:1px solid var(--line); border-radius:6px; padding:10px; margin:12px 0; }
.pair { display:flex; flex-wrap:wrap; gap:12px; }
.pair figure { margin:0; flex:1 1 320px; max-width:520px; }
.pair img { width:100%; height:auto; background:#fff; border:1px solid var(--line); }
figcaption { color:var(--muted); font-size:12px; }
.ok { color:var(--ok); } .wrong { color:var(--bad); font-weight:600; } .n\\/a { color:var(--na); }
.verdict-match { color:var(--ok); } .verdict-mismatch, .verdict-not { color:var(--bad); }
code { font-size:12px; }
"""


def _img(src: str | None, alt: str) -> str:
    if not src:
        return f"<p>(no {html.escape(alt)} image)</p>"
    return f'<img loading="lazy" src="{html.escape(src)}" alt="{html.escape(alt)}">'


def write_review(rows: list[dict[str, Any]], out: Path) -> None:
    table = type_table(rows)
    (out / "scorecard.md").write_text(_md(table), encoding="utf-8")
    parts = [
        f"<!doctype html><html lang=en><head><meta charset=utf-8>"
        f"<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>Plot corpus review</title><style>{_CSS}</style></head><body>",
        "<h1>Origin vs quantized, built from scratch</h1>",
        "<p>Plan item 3 of ORIGIN_PLOT_TYPE_PARITY_PLAN: each specimen's data imported "
        "as a CSV and built with quantized's own gallery / Series card / Stat Stage / Map "
        "recipe, rendered by its export route. Left: Origin's PNG. Right: quantized's.</p>",
        "<table><tr><th>type</th><th>specimens</th><th>built</th><th>match</th>"
        + "".join(f"<th>{c} wrong</th>" for c in _CHECKS)
        + "<th>recipe note</th></tr>",
    ]
    for t in table:
        if t["status"] == "unbuildable":
            parts.append(
                f"<tr><td><a href='#{t['type']}'>{t['type']}</a></td><td>{t['n']}</td>"
                f"<td class=wrong colspan={2 + len(_CHECKS)}>unbuildable</td><td></td></tr>"
            )
            continue
        parts.append(
            f"<tr><td><a href='#{t['type']}'>{t['type']}</a></td><td>{t['n']}</td>"
            f"<td>{t['built']}</td><td>{t['match']}</td>"
            + "".join(f"<td>{t['wrong'].get(c, 0) or ''}</td>" for c in _CHECKS)
            + f"<td>{html.escape(t['recipe'])}</td></tr>"
        )
    parts.append("</table>")
    current = None
    for r in sorted(rows, key=lambda r: (r["type"], r["family"])):
        if r["type"] != current:
            current = r["type"]
            parts.append(f"<h2 id='{current}'>{html.escape(current)}</h2>")
            if r.get("built") == "unbuildable":
                parts.append(
                    f"<p class=wrong>Not buildable from scratch: {html.escape(r['why'])}</p>"
                )
        verdict = str(r["verdict"])
        parts.append(
            f"<div class=spec><strong>{html.escape(r['key'])}</strong> "
            f"<span class='verdict-{verdict.split()[0]}'>{html.escape(verdict)}</span>"
        )
        if r.get("why"):
            parts.append(f"<div><code>{html.escape(r['why'])}</code></div>")
        checks = r.get("checks") or {}
        if checks:
            parts.append(
                "<div>"
                + " · ".join(
                    f"{k}: <span class='{v['state']}' "
                    f"title='{html.escape(v['why'])}'>{v['state']}</span>"
                    for k, v in checks.items()
                )
                + "</div>"
            )
        parts.append(
            "<div class=pair>"
            f"<figure>{_img(r.get('origin_png'), 'Origin')}<figcaption>Origin</figcaption></figure>"
            f"<figure>{_img(r.get('png'), 'quantized')}<figcaption>quantized"
            f"{' (' + html.escape(str(r.get('qz_type'))) + ')' if r.get('qz_type') else ''}"
            "</figcaption></figure></div></div>"
        )
    parts.append("</body></html>")
    (out / "index.html").write_text("\n".join(parts), encoding="utf-8")
