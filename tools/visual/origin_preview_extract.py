"""Extract Origin's own saved graph-page previews from a local ``.opju`` corpus.

Step 1 of the preview-oracle visual check (README "Origin preview oracle").
``.opju`` pages embed a PNG that Origin itself rendered when it saved the
project; ``graph_preview.attach_opju_graph_previews`` attaches one to a figure
only when exactly one valid PNG belongs to that named graph page, so every
image written here is attributable to a single graph window. Unrecovered graph
pages (``origin_fidelity.unrecovered_graphs``) are written too: Origin drew a
graph there that we do not reproduce at all.

The import goes through the SAME route helper the app's upload path uses
(``routes.parsers._import_with_books``), so the decoded figures are what the
UI receives.

When ``--exports`` names a directory of graphs Origin exported itself
(``<exports>/<project stem>/manifest.json`` + PNGs, the COM campaign of the
README), that export is the oracle for its page instead of the thumbnail --
including for ``.opj`` projects, which carry no previews -- and the project is
flagged ``priority`` so the report ranks it first.

Writes ONLY under ``--out`` (a scratch directory; never the repo):

    <out>/origin/<pid>/<page>.png   the Origin-rendered oracle image
    <out>/pages.json                one row per graph page with an oracle
                                    (merged across runs by ``--tag``)

Usage::

    uv run python tools/visual/origin_preview_extract.py --out <scratch>/visual \
        [--corpus <test-data>/origin/public] [--files list.txt --root <dir>] \
        [--exports <test-data>/origin/_exports] [--tag p] [--jobs 8]
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

# Synthetic / generated specimens the owner examines separately -- never part
# of the third-party corpus run.
EXCLUDED_PARTS = (
    "CKPEIIKA_deopjufy/tests/fixtures/synthetic",
    "BertySnack_norigin",
    "origin/generated/",
)


def find_corpus() -> Path | None:
    env = os.environ.get("QZ_ORIGIN_PUBLIC_CORPUS")
    if env:
        return Path(env) if Path(env).is_dir() else None
    for ancestor in Path(__file__).resolve().parents:
        candidate = ancestor / "test-data" / "origin" / "public"
        if candidate.is_dir():
            return candidate
    return None


def list_projects(corpus: Path, files: Path | None, root: Path | None = None) -> list[Path]:
    if files is not None:
        base = root or corpus.parent
        rows = [ln.strip() for ln in files.read_text(encoding="utf-8").splitlines()]
        paths = [base / r if not Path(r).is_absolute() else Path(r) for r in rows if r]
    else:
        paths = sorted(corpus.rglob("*.opju"))
    # .opj carries no saved previews, but may have an Origin-export oracle.
    keep = [p for p in paths if p.suffix.lower() in (".opju", ".opj")]
    return [p for p in keep if not any(x in p.as_posix() for x in EXCLUDED_PARTS)]


def safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name) or "_"


def _layer_row(fig: dict[str, Any]) -> dict[str, Any]:
    curves = fig.get("curves") or []
    return {
        "layer": fig.get("layer"),
        "ncurves": len(curves),
        "n_curves_decl": fig.get("n_curves"),
        "map": bool(fig.get("map") or fig.get("ternary")),
        "legend_labels": list(fig.get("legend_labels") or []),
        "omitted": [
            str(n.get("reason", "")) if isinstance(n, dict) else str(n)
            for n in (fig.get("curve_sheet_omitted") or [])
        ],
        "colors": [c.get("color") for c in curves if isinstance(c, dict)],
        "x": [fig.get("x_from"), fig.get("x_to")],
        "y": [fig.get("y_from"), fig.get("y_to")],
        "source_hint": fig.get("source_hint"),
    }


def _export_oracle(exports: Path | None, stem: str) -> dict[str, dict[str, Any]]:
    """Graphs Origin exported itself (``_exports/<stem>/manifest.json``, a
    COM ``expGraph`` run), keyed by the graph window's short name. A better
    oracle than the ~200 px saved preview: full size, and it exists for
    ``.opj`` projects too."""
    if exports is None:
        return {}
    man = exports / stem / "manifest.json"
    if not man.is_file():
        return {}
    graphs = json.loads(man.read_text("utf-8")).get("graphs") or {}
    out: dict[str, dict[str, Any]] = {}
    for name, g in graphs.items():
        png = exports / stem / str(g.get("file") or "")
        if g.get("status") == "ok" and png.is_file():
            out[str(name)] = {"path": png, "w": g.get("width"), "h": g.get("height")}
    return out


def _page(
    out: Path, pid: str, name: str, preview: dict[str, Any] | None, export: dict[str, Any] | None
) -> dict[str, Any]:
    rel = f"origin/{pid}/{safe_name(name)}.png"
    (out / rel).parent.mkdir(parents=True, exist_ok=True)
    if export is not None:  # Origin's own export wins over the thumbnail
        (out / rel).write_bytes(Path(export["path"]).read_bytes())
        oracle = {"file": rel, "w": export["w"], "h": export["h"], "kind": "origin_export"}
    else:
        assert preview is not None
        (out / rel).write_bytes(base64.b64decode(preview["data"]))
        oracle = {
            "file": rel,
            "w": preview["width"],
            "h": preview["height"],
            "kind": "saved_preview",
        }
    return {"page": name, "unrecovered": False, "preview": oracle, "layers": []}


def extract_one(job: tuple[str, str, str, str]) -> dict[str, Any]:
    pid, path_s, out_s, exports_s = job
    from quantized.routes.parsers import _import_with_books

    path, out = Path(path_s), Path(out_s)
    exported = _export_oracle(Path(exports_s) if exports_s else None, path.stem)
    try:
        payload, _ = _import_with_books(path)
    except Exception as exc:  # corpus run: record and carry on
        return {"pid": pid, "project": path_s, "error": f"{type(exc).__name__}: {exc}"[:300]}
    pages: dict[str, dict[str, Any]] = {}
    for fig in payload.get("figures") or []:
        name = str(fig.get("name") or "")
        preview = fig.get("saved_preview")
        if not name or not (preview or name in exported):
            continue
        if name not in pages:
            pages[name] = _page(out, pid, name, preview, exported.get(name))
        pages[name]["layers"].append(_layer_row(fig))
    fid = payload.get("origin_fidelity") or {}
    for g in fid.get("unrecovered_graphs") or []:
        name = str(g.get("page_name") or "")
        preview = g.get("saved_preview")
        if name and (preview or name in exported) and name not in pages:
            pages[name] = {
                **_page(out, pid, name, preview, exported.get(name)),
                "unrecovered": True,
            }
    for name, export in exported.items():  # Origin exported it, we decoded no such graph
        if name not in pages:
            pages[name] = {**_page(out, pid, name, None, export), "unrecovered": True}
    for row in pages.values():
        row["ncurves"] = sum(int(layer["ncurves"]) for layer in row["layers"])
        row["resolved"] = any(layer["ncurves"] or layer["map"] for layer in row["layers"])
    return {
        "pid": pid,
        "project": path_s,
        "priority": bool(exported),
        "n_figures": len(payload.get("figures") or []),
        "pages": list(pages.values()),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--corpus", type=Path, default=None, help="default: the public corpus")
    ap.add_argument("--files", type=Path, default=None, help="list of paths relative to --root")
    ap.add_argument("--root", type=Path, default=None, help="default: the corpus's parent")
    ap.add_argument("--exports", type=Path, default=None, help="Origin COM-export oracle dir")
    ap.add_argument("--tag", default="p", help="pid prefix; rows of other tags are kept")
    ap.add_argument("--jobs", type=int, default=8)
    args = ap.parse_args(argv)
    corpus = args.corpus or find_corpus()
    if args.files is None and (corpus is None or not corpus.is_dir()):
        print("corpus not found (set --corpus or QZ_ORIGIN_PUBLIC_CORPUS)", file=sys.stderr)
        return 2
    args.out.mkdir(parents=True, exist_ok=True)
    projects = list_projects(corpus or Path("."), args.files, args.root)
    exports = str(args.exports) if args.exports else ""
    jobs = [(f"{args.tag}{i:04d}", str(p), str(args.out), exports) for i, p in enumerate(projects)]
    with ProcessPoolExecutor(args.jobs) as ex:
        rows = list(ex.map(extract_one, jobs))
    pages_json = args.out / "pages.json"
    kept = []
    if pages_json.exists():  # merge: one run per corpus, distinguished by --tag
        old = json.loads(pages_json.read_text("utf-8"))
        kept = [r for r in old if not str(r["pid"]).startswith(args.tag)]
    pages_json.write_text(json.dumps(kept + rows, indent=1, ensure_ascii=False), "utf-8")
    n_pages = sum(len(r.get("pages", [])) for r in rows)
    n_err = sum(1 for r in rows if "error" in r)
    print(f"{len(rows)} projects, {n_pages} oracle graph pages, {n_err} import errors")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
