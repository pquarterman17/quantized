#!/usr/bin/env python3
"""Build a self-contained Origin-vs-quantized comparison gallery (Artifact-ready).

Turns an ``_exports/<project>/`` directory (Origin COM oracle PNGs at the top
level + ``quantized/`` harness screenshots) into ONE self-contained HTML file:
every image is inlined as a ``data:`` URI, so the page renders under a strict CSP
with no external requests. Publishable as an Artifact or openable from disk.

EVERY gallery is stamped in the header with a build timestamp, the git commit the
quantized side was rendered at, and a human-readable version — so nobody ever
wonders whether they're looking at a stale image (renders get overwritten in
place; only the stamp tells you which build a snapshot froze).

Usage
-----
    QZ_TEST_DATA_ROOT=../test-data python tools/visual/build_compare_artifact.py Moke \
        --commit $(git -C . rev-parse --short HEAD) --version 0.9.0 --out moke.html

``--commit`` / ``--version`` default to the current git checkout; pass them
explicitly when the render was produced from a different worktree/commit than the
one you run this in (they should describe the RENDER, not this script's cwd).

Optional JSON side-cars (plain lists; omit either):
    stats.json     [{"n": "2368 pass", "k": "backend suite", "ok": true}, ...]
    findings.json  [{"kind": "pass|warn|info", "title": "...", "body": "..."}, ...]

Stdlib only. PNG dimensions read from the IHDR chunk (no imaging library).
"""

from __future__ import annotations

import argparse
import base64
import html
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def find_exports_root(explicit: str | None) -> Path:
    """Resolve the ``_exports`` root: --flag, then $QZ_TEST_DATA_ROOT, then walk up."""
    if explicit:
        return Path(explicit).resolve()
    env = os.environ.get("QZ_TEST_DATA_ROOT")
    if env:
        cand = Path(env) / "origin" / "_exports"
        if cand.is_dir():
            return cand
    here = Path(__file__).resolve()
    for anc in here.parents:
        for cand in (anc, anc.parent):
            hit = cand / "test-data" / "origin" / "_exports"
            if hit.is_dir():
                return hit
    raise SystemExit(
        "could not locate _exports; pass --exports-root or set QZ_TEST_DATA_ROOT"
    )


def git_output(*args: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", *args], capture_output=True, text=True, timeout=5,
            cwd=Path(__file__).resolve().parent,
        )
        return out.stdout.strip() or None if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def resolve_stamp(commit: str | None, version: str | None, built: str | None) -> str:
    """The provenance line: build time · render commit · human version."""
    ts = built or datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    sha = commit or git_output("rev-parse", "--short", "HEAD") or "unknown"
    ver = version or git_output("describe", "--tags", "--always", "--dirty") or "unversioned"
    return (
        f'<span class="s-item">built <b>{esc(ts)}</b></span>'
        f'<span class="s-item">quantized @ <b>{esc(sha)}</b></span>'
        f'<span class="s-item">version <b>{esc(ver)}</b></span>'
    )


def png_dims(p: Path) -> tuple[int, int]:
    b = p.read_bytes()
    return int.from_bytes(b[16:20], "big"), int.from_bytes(b[20:24], "big")


def data_uri(p: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode("ascii")


def natural_key(name: str) -> tuple[object, ...]:
    return tuple(int(x) if x.isdigit() else x.lower() for x in re.split(r"(\d+)", name))


def discover_pairs(
    proj_dir: Path, only: list[str] | None, cap: int
) -> list[tuple[str, Path, Path]]:
    qz_dir = proj_dir / "quantized"
    if not qz_dir.is_dir():
        raise SystemExit(f"no quantized/ screenshots under {proj_dir}")
    pairs: list[tuple[str, Path, Path]] = []
    for qz in sorted(qz_dir.glob("*.png"), key=lambda p: natural_key(p.stem)):
        oracle = proj_dir / qz.name
        if not oracle.is_file():
            continue
        if only and qz.stem not in only:
            continue
        pairs.append((qz.stem, oracle, qz))
    if cap and len(pairs) > cap:
        print(f"note: {len(pairs)} pairs; embedding first {cap} "
              f"(--max 0 for all, or --only to pick)", file=sys.stderr)
        pairs = pairs[:cap]
    return pairs


def esc(s: object) -> str:
    return html.escape(str(s), quote=True)


CSS = """
:root{--ink:#0e1114;--panel:#161a1f;--panel2:#1d222a;--line:#2a313b;--text:#e7ebf0;
--muted:#96a0ae;--accent:#33c9b7;--accent-dim:#1d6f66;--good:#5cd28c;--warn:#f2b23c;
--sans:-apple-system,"Segoe UI",system-ui,Roboto,sans-serif;
--mono:ui-monospace,"Cascadia Code","JetBrains Mono",Consolas,monospace;}
@media (prefers-color-scheme:light){:root{--ink:#f5f7f9;--panel:#fff;--panel2:#eef1f5;
--line:#dde3ea;--text:#161b22;--muted:#5b6572;--accent:#12968a;--accent-dim:#9fded7;
--good:#1f9d57;--warn:#b9791a;}}
:root[data-theme="dark"]{--ink:#0e1114;--panel:#161a1f;--panel2:#1d222a;--line:#2a313b;
--text:#e7ebf0;--muted:#96a0ae;--accent:#33c9b7;--accent-dim:#1d6f66;--good:#5cd28c;--warn:#f2b23c;}
:root[data-theme="light"]{--ink:#f5f7f9;--panel:#fff;--panel2:#eef1f5;--line:#dde3ea;
--text:#161b22;--muted:#5b6572;--accent:#12968a;--accent-dim:#9fded7;--good:#1f9d57;--warn:#b9791a;}
*{box-sizing:border-box;}
body{margin:0;background:var(--ink);color:var(--text);font-family:var(--sans);
line-height:1.55;-webkit-font-smoothing:antialiased;}
.wrap{max-width:1120px;margin:0 auto;padding:48px 24px 72px;}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.16em;text-transform:uppercase;
color:var(--accent);margin:0 0 14px;}
h1{font-size:clamp(28px,4vw,42px);line-height:1.08;margin:0 0 16px;text-wrap:balance;letter-spacing:-.01em;}
.stamp{display:flex;flex-wrap:wrap;gap:8px 18px;margin:0 0 18px;padding:11px 15px;
background:var(--panel2);border:1px solid var(--line);border-radius:10px;
font-family:var(--mono);font-size:12.5px;color:var(--muted);}
.stamp b{color:var(--text);font-weight:600;}
.lede{color:var(--muted);font-size:17px;max-width:66ch;margin:0;}
.lede code,.find code{font-family:var(--mono);font-size:.9em;color:var(--text);}
section{margin-top:52px;}
h2{font-size:13px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.14em;
color:var(--muted);margin:0 0 20px;padding-bottom:12px;border-bottom:1px solid var(--line);}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;}
.stat .n{font-family:var(--mono);font-size:22px;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.stat .n.ok{color:var(--good);}
.stat .k{font-size:12.5px;color:var(--muted);margin-top:6px;}
.gallery{display:flex;flex-direction:column;gap:32px;}
.pair{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;}
.pair-head{display:flex;align-items:baseline;gap:14px;margin-bottom:14px;}
.pair-name{font-family:var(--mono);font-weight:600;font-size:16px;}
.pair-mode{font-size:12.5px;color:var(--muted);font-family:var(--mono);}
.pair-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.shot{display:flex;flex-direction:column;gap:8px;min-width:0;}
.shot-label{font-family:var(--mono);font-size:12px;color:var(--muted);display:flex;align-items:center;gap:8px;}
.shot-dim{margin-left:auto;opacity:.7;}
.dot{width:8px;height:8px;border-radius:50%;flex:none;}
.dot-truth{background:var(--muted);} .dot-qz{background:var(--accent);}
.shot img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:8px;background:#fff;}
.findings{display:flex;flex-direction:column;gap:2px;}
.find{display:grid;grid-template-columns:26px 1fr;gap:14px;padding:16px 4px;border-bottom:1px solid var(--line);align-items:start;}
.find:last-child{border-bottom:0;}
.find .mk{font-family:var(--mono);font-weight:700;font-size:15px;text-align:center;}
.mk.pass{color:var(--good);} .mk.warn{color:var(--warn);} .mk.info{color:var(--muted);}
.find h3{margin:0 0 4px;font-size:15.5px;font-weight:600;}
.find p{margin:0;color:var(--muted);font-size:14px;max-width:82ch;}
.prov{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px;
font-size:13px;color:var(--muted);}
@media (max-width:720px){.pair-grid{grid-template-columns:1fr;}}
"""


def build_html(
    title: str, subtitle: str, eyebrow: str, stamp: str,
    pairs: list[tuple[str, Path, Path]],
    modes: dict[str, str], stats: list[dict], findings: list[dict], provenance: str,
) -> str:
    stat_html = "".join(
        f'<div class="stat"><div class="n{" ok" if s.get("ok") else ""}">{esc(s.get("n",""))}</div>'
        f'<div class="k">{esc(s.get("k",""))}</div></div>' for s in stats
    )
    stats_section = (
        f'<section><h2>Test results</h2><div class="stats">{stat_html}</div></section>'
        if stats else ""
    )
    pair_html = []
    for name, oracle, qz in pairs:
        ow, oh = png_dims(oracle)
        qw, qh = png_dims(qz)
        pair_html.append(f"""
      <figure class="pair">
        <div class="pair-head"><span class="pair-name">{esc(name)}</span>
          <span class="pair-mode">{esc(modes.get(name, ""))}</span></div>
        <div class="pair-grid">
          <div class="shot"><div class="shot-label"><span class="dot dot-truth"></span>OriginPro (ground truth)
            <span class="shot-dim">{ow}×{oh}</span></div>
            <img loading="lazy" alt="Origin export of {esc(name)}" src="{data_uri(oracle)}"></div>
          <div class="shot"><div class="shot-label"><span class="dot dot-qz"></span>quantized
            <span class="shot-dim">{qw}×{qh}</span></div>
            <img loading="lazy" alt="quantized render of {esc(name)}" src="{data_uri(qz)}"></div>
        </div>
      </figure>""")
    kinds = {"pass": "&check;", "warn": "&#9651;", "info": "i"}
    find_html = "".join(
        f'<div class="find"><div class="mk {esc(f.get("kind","info"))}">{kinds.get(f.get("kind","info"),"i")}</div>'
        f'<div><h3>{esc(f.get("title",""))}</h3><p>{f.get("body","")}</p></div></div>' for f in findings
    )
    find_section = (
        f'<section><h2>What matches, what differs</h2><div class="findings">{find_html}</div></section>'
        if findings else ""
    )
    prov_section = (
        f'<section><h2>Provenance</h2><div class="prov">{provenance}</div></section>' if provenance else ""
    )
    return f"""<title>{esc(title)}</title>
<style>{CSS}</style>
<div class="wrap">
  <header>
    <p class="eyebrow">{esc(eyebrow)}</p>
    <h1>{esc(title)}</h1>
    <div class="stamp">{stamp}</div>
    <p class="lede">{subtitle}</p>
  </header>
  {stats_section}
  <section><h2>Side by side &mdash; OriginPro vs quantized</h2>
    <div class="gallery">{"".join(pair_html)}</div></section>
  {find_section}
  {prov_section}
</div>
"""


def load_modes(proj_dir: Path) -> dict[str, str]:
    rep = proj_dir / "structural_report.json"
    if not rep.is_file():
        return {}
    try:
        data = json.loads(rep.read_text())
        figs = data if isinstance(data, list) else data.get("figures", [])
        return {str(f.get("name")): str(f.get("mode", "")) for f in figs if f.get("name")}
    except (ValueError, OSError):
        return {}


def load_json_list(path: str | None) -> list[dict]:
    if not path:
        return []
    data = json.loads(Path(path).read_text())
    return data if isinstance(data, list) else []


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("project", help="project stem, e.g. Moke (matches _exports/<project>/)")
    ap.add_argument("--exports-root", help="override the _exports dir")
    ap.add_argument("--out", help="output .html (default: <project>/compare_artifact.html)")
    ap.add_argument("--only", help="comma-separated graph short-names to include")
    ap.add_argument("--max", type=int, default=12, help="cap embedded pairs (0 = all; default 12)")
    ap.add_argument("--title")
    ap.add_argument("--subtitle", help="HTML allowed (lede paragraph)")
    ap.add_argument("--eyebrow", default="Visual verification")
    ap.add_argument("--commit", help="git short-sha the render reflects (default: current HEAD)")
    ap.add_argument("--version", help="human-readable version/release (default: git describe)")
    ap.add_argument("--built", help="override build timestamp string")
    ap.add_argument("--stats-json")
    ap.add_argument("--findings-json")
    ap.add_argument("--provenance", default="")
    args = ap.parse_args()

    root = find_exports_root(args.exports_root)
    proj_dir = root / args.project
    if not proj_dir.is_dir():
        raise SystemExit(f"no such project export: {proj_dir}")
    only = [s.strip() for s in args.only.split(",")] if args.only else None
    pairs = discover_pairs(proj_dir, only, args.max)
    if not pairs:
        raise SystemExit("no oracle/quantized pairs found to compare")

    title = args.title or f"Origin → quantized: {args.project}"
    subtitle = args.subtitle or (
        f"Every graph of <code>{esc(args.project)}</code> rendered two ways — exported from "
        f"<b>OriginPro</b> and imported + drawn by <b>quantized</b> — paired by graph name."
    )
    stamp = resolve_stamp(args.commit, args.version, args.built)
    out = Path(args.out) if args.out else proj_dir / "compare_artifact.html"
    doc = build_html(
        title, subtitle, args.eyebrow, stamp, pairs, load_modes(proj_dir),
        load_json_list(args.stats_json), load_json_list(args.findings_json), args.provenance,
    )
    out.write_text(doc, encoding="utf-8")
    print(f"wrote {out}  ({out.stat().st_size / 1024:.0f} KB, {len(pairs)} pairs)")


if __name__ == "__main__":
    main()
