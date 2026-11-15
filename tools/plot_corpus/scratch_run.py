"""Plan item 3: build every corpus specimen FROM SCRATCH in quantized and score it.

For each ok specimen in an ``origin_build.py`` corpus:

1. write the graphed sheet as the CSV a user would open
   (``scratch_data``) and import it through the running app's own
   ``/api/parsers/upload``;
2. replay the type's recipe (``scratch_recipes``) in the vitest harness
   ``frontend/src/test/plotCorpus/`` against the real store, gallery and
   export builders, with the app's ``/api/...`` calls forwarded to this
   backend -- it returns the export request the app would post;
3. post that request to the export route the app would use, at PNG, and
   ask ``/api/export/figure-hitmap`` for an XY figure's drawn axis limits;
4. score the built figure against ``oracle.json`` (``scratch_score``) and
   write ``<out>/scorecard.json``, ``<out>/scorecard.md`` and the
   side-by-side review page ``<out>/index.html`` (``scratch_review``).

No Origin is needed. Output stays out of the repo.

    uv run python tools/plot_corpus/scratch_run.py \\
        --corpus <corpus> --gen <generated> --out <review> [--type T ...] [--rescore]
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

import httpx

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

from scratch_data import channel_map, graph_columns, prelude, sheet_csv  # noqa: E402
from scratch_recipes import RECIPES  # noqa: E402
from scratch_review import write_review  # noqa: E402
from scratch_score import score_specimen  # noqa: E402

# The export route each harness route posts to (the app's own paths).
ROUTES = {
    "figure": "/api/export/figure",
    "statplot": "/api/export/statplot-figure",
    "categorical": "/api/export/categorical-figure",
    "map": "/api/export/map-figure",
    "ternary": "/api/export/ternary-figure",
}


class Backend:
    """The real app on a free localhost port, in this process."""

    def __init__(self) -> None:
        import uvicorn

        from quantized.app import create_app

        self.token = secrets.token_hex(16)
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.url = f"http://127.0.0.1:{self.port}"
        config = uvicorn.Config(
            create_app(api_token=self.token), host="127.0.0.1", port=self.port, log_level="warning"
        )
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def __enter__(self) -> httpx.Client:
        self.thread.start()
        deadline = time.monotonic() + 60
        while not self.server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("backend did not start")
            time.sleep(0.1)
        self.client = httpx.Client(
            base_url=self.url, headers={"x-quantized-token": self.token}, timeout=300
        )
        return self.client

    def __exit__(self, *exc: object) -> None:
        self.client.close()
        self.server.should_exit = True
        self.thread.join(timeout=30)


def _specimens(corpus: Path, only: list[str] | None) -> list[tuple[str, str, Path]]:
    manifest = json.loads((corpus / "manifest.json").read_text(encoding="utf-8"))
    rows = []
    for key, row in sorted(manifest.items()):
        if row.get("status") != "ok":
            continue
        ptype, fam = key.split("/")
        if only and ptype not in only:
            continue
        rows.append((ptype, fam, corpus / ptype / fam))
    return rows


def prepare(
    client: httpx.Client, corpus: Path, gen: Path, out: Path, only: list[str] | None
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Import each specimen's data; returns (harness inputs, per-key context)."""
    inputs: list[dict[str, Any]] = []
    ctx: dict[str, dict[str, Any]] = {}
    imported: dict[str, dict[str, Any]] = {}
    for ptype, fam_name, d in _specimens(corpus, only):
        key = f"{ptype}/{fam_name}"
        fam = json.loads((gen / fam_name / "family.json").read_text(encoding="utf-8"))
        oracle = json.loads((d / "oracle.json").read_text(encoding="utf-8"))
        columns = graph_columns(fam)
        if fam_name not in imported:
            r = client.post(
                "/api/parsers/upload",
                files={"file": (f"{fam_name}.csv", sheet_csv(columns).encode(), "text/csv")},
            )
            r.raise_for_status()
            imported[fam_name] = r.json()
        ds = imported[fam_name]
        chan = channel_map(columns, ds)
        recipe = RECIPES[ptype]
        ctx[key] = {
            "type": ptype,
            "family": fam_name,
            "dir": d,
            "fam": fam,
            "oracle": oracle,
            "columns": columns,
            "chan": chan,
            "dataset": ds,
            "recipe": recipe,
        }
        if "steps" in recipe:
            inputs.append(
                {
                    "key": key,
                    "steps": recipe["steps"],
                    "dataset": ds,
                    "prelude": prelude(fam, columns, chan, oracle),
                }
            )
    return inputs, ctx


def run_harness(
    backend_url: str, token: str, inputs: list[dict[str, Any]], work: Path
) -> list[dict[str, Any]]:
    src, dst = work / "harness_in.json", work / "harness_out.json"
    src.write_text(json.dumps(inputs), encoding="utf-8")
    dst.unlink(missing_ok=True)
    env = {
        **os.environ,
        "QZ_PLOT_CORPUS_IN": str(src),
        "QZ_PLOT_CORPUS_OUT": str(dst),
        "QZ_PLOT_CORPUS_API": backend_url,
        "QZ_PLOT_CORPUS_TOKEN": token,
    }
    npx = shutil.which("npx") or "npx"
    proc = subprocess.run(
        [npx, "vitest", "run", "src/test/plotCorpus/plotCorpus.harness.test.tsx"],
        cwd=ROOT / "frontend",
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    (work / "harness.log").write_text(proc.stdout + proc.stderr, encoding="utf-8")
    if not dst.exists():
        raise RuntimeError(
            f"harness wrote nothing (exit {proc.returncode}); see {work / 'harness.log'}"
        )
    return list(json.loads(dst.read_text(encoding="utf-8")))


def render(client: httpx.Client, built: dict[str, Any], png: Path) -> dict[str, Any]:
    """Post the built request to its route at PNG; an XY figure's axes come
    back from the hitmap (the drawn data limits)."""
    spec = {**built["spec"], "fmt": "png"}
    spec.pop("filename", None)
    r = client.post(ROUTES[built["route"]], json=spec)
    info: dict[str, Any] = {"status": r.status_code}
    if r.status_code == 200:
        png.write_bytes(r.content)
    else:
        info["detail"] = r.text[:400]
    if built["route"] == "figure" and r.status_code == 200:
        h = client.post("/api/export/figure-hitmap", json=spec)
        if h.status_code == 200:
            body = h.json()
            info["axes"] = body.get("axes")
    return info


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--corpus", type=Path, required=True, help="origin_build.py --out dir")
    ap.add_argument("--gen", type=Path, required=True, help="generate.py --out dir")
    ap.add_argument("--out", type=Path, required=True, help="review directory")
    ap.add_argument("--type", action="append")
    ap.add_argument(
        "--rescore",
        action="store_true",
        help="re-score the previous run's harness_out.json/render.json (no harness, no render)",
    )
    args = ap.parse_args(argv)
    out: Path = args.out
    (out / "png").mkdir(parents=True, exist_ok=True)
    backend = Backend()
    with backend as client:
        inputs, ctx = prepare(client, args.corpus, args.gen, out, args.type)
        if args.rescore:
            built = {
                b["key"]: b
                for b in json.loads((out / "harness_out.json").read_text(encoding="utf-8"))
            }
            renders = json.loads((out / "render.json").read_text(encoding="utf-8"))
        else:
            built = {b["key"]: b for b in run_harness(backend.url, backend.token, inputs, out)}
            renders = {}
        rows = []
        for key, c in ctx.items():
            b = built.get(key)
            png_name = key.replace("/", "__") + ".png"
            rinfo: dict[str, Any] = renders.get(key, {})
            if not args.rescore and b and "spec" in b and b["spec"] is not None:
                rinfo = renders[key] = render(client, b, out / "png" / png_name)
            origin_png = out / "png" / (key.replace("/", "__") + ".origin.png")
            if (c["dir"] / "specimen.png").exists():
                shutil.copy(c["dir"] / "specimen.png", origin_png)
            row = score_specimen(c, b, rinfo)
            row["png"] = f"png/{png_name}" if (out / "png" / png_name).exists() else None
            row["origin_png"] = f"png/{origin_png.name}" if origin_png.exists() else None
            rows.append(row)
    (out / "render.json").write_text(json.dumps(renders, indent=1), encoding="utf-8")
    (out / "scorecard.json").write_text(
        json.dumps(rows, indent=1, ensure_ascii=False, default=str), encoding="utf-8"
    )
    write_review(rows, out)
    print(f"{len(rows)} specimens -> {out / 'index.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
