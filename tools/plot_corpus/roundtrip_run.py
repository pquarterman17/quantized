"""Plan item 9, step 1: export every check-2 match through every path that targets Origin.

For each ok specimen this re-runs check 2 (``scratch_run``: import the CSV,
replay the recipe on the real store, render, score). The harness also runs
the app's own Origin export commands on that screen
(``frontend/src/test/plotCorpus/originExports.ts``) and returns their request
bodies; for every specimen whose check-2 verdict is ``match`` those bodies are
posted to the backend's own export routes and the files written under
``<out>/exports/<id>/``:

=========  ===============================  ======================================
path       user entry                       route
=========  ===============================  ======================================
ogs        File > Export Origin (.ogs)...   ``POST /api/export/origin`` (zip)
opj        File > Export Origin project     ``POST /api/export/opj``
project    API only (no menu calls it)      ``POST /api/export/origin-project`` (zip)
com        File > Send to Origin (COM)...   ``POST /api/export/origin-com`` -- the body
                                            is saved; ``roundtrip_origin.py`` runs
                                            ``send_to_origin`` against its own Origin
=========  ===============================  ======================================

``project`` takes the same ``OpjRequest`` body the .opj command builds. Not
round-tripped: ``/api/export/xrd-csv`` ``fmt=origin`` (the menu always sends
``standard``; XRD data only) and ``qz convert`` (Origin -> CSV/XLSX, never
to Origin). Identical bodies share one export (``id`` = content hash).

Writes ``<out>/exports/index.json`` (key -> path -> export id, plus the check-2
row) for ``roundtrip_origin.py`` (COM) and ``score_roundtrip.py``. No Origin
is needed here.

    uv run python tools/plot_corpus/roundtrip_run.py --corpus <corpus> --gen <gen> --out <dir>
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import sys
import zipfile
from pathlib import Path
from typing import Any

import httpx

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from scratch_run import Backend, prepare, render, run_harness  # noqa: E402
from scratch_score import score_specimen  # noqa: E402

PATHS = ("ogs", "opj", "project", "com")
ROUTES = {
    "ogs": "/api/export/origin",
    "opj": "/api/export/opj",
    "project": "/api/export/origin-project",
}


def _body_id(path: str, body: Any) -> str:
    blob = json.dumps(body, sort_keys=True, default=str).encode()
    return f"{path}_{hashlib.sha1(blob).hexdigest()[:12]}"


def bodies(origin: dict[str, Any]) -> dict[str, Any]:
    """The request body per export path, from the harness's captured bodies."""
    out: dict[str, Any] = {}
    if origin.get("ogs") is not None:
        out["ogs"] = origin["ogs"]
    if origin.get("opj") is not None:
        out["opj"] = origin["opj"]
        out["project"] = origin["opj"]  # same OpjRequest shape
    if origin.get("com") is not None:
        out["com"] = origin["com"]
    return out


def write_export(client: httpx.Client, path: str, body: Any, dest: Path) -> dict[str, Any]:
    """Post ``body`` to the path's route and unpack the result into ``dest``."""
    dest.mkdir(parents=True, exist_ok=True)
    if path == "com":
        (dest / "com_body.json").write_text(json.dumps(body), encoding="utf-8")
        return {"status": 200, "files": ["com_body.json"]}
    r = client.post(ROUTES[path], json=body)
    if r.status_code != 200:
        return {"status": r.status_code, "detail": r.text[:400]}
    if path == "opj":
        (dest / "export.opj").write_bytes(r.content)
        return {
            "status": 200,
            "files": ["export.opj"],
            "matrix_fallback": r.headers.get("X-Opj-Matrix-Fallback"),
        }
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        names = zf.namelist()
        for n in names:
            if "/" in n or "\\" in n or n.startswith("."):
                raise ValueError(f"unexpected member {n!r} in the {path} zip")
            (dest / n).write_bytes(zf.read(n))
    return {"status": 200, "files": names}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--corpus", type=Path, required=True)
    ap.add_argument("--gen", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--type", action="append")
    args = ap.parse_args(argv)
    out: Path = args.out
    exports = out / "exports"
    shutil.rmtree(exports, ignore_errors=True)
    (out / "png").mkdir(parents=True, exist_ok=True)
    backend = Backend()
    index: dict[str, Any] = {}
    done: dict[str, dict[str, Any]] = {}
    with backend as client:
        inputs, ctx = prepare(client, args.corpus, args.gen, out, args.type)
        for inp in inputs:
            inp["origin"] = True
        built = {b["key"]: b for b in run_harness(backend.url, backend.token, inputs, out)}
        (out / "harness_notes.json").write_text(
            json.dumps(
                {k: (b.get("origin") or {}).get("notes") for k, b in built.items()}, indent=1
            ),
            encoding="utf-8",
        )
        for key, c in ctx.items():
            b = built.get(key)
            png = out / "png" / (key.replace("/", "__") + ".png")
            rinfo: dict[str, Any] = {}
            if b and b.get("spec") is not None:
                rinfo = render(client, b, png)
                png.unlink(missing_ok=True)  # disk: the review PNGs are check 2's job
            row = score_specimen(c, b, rinfo)
            entry: dict[str, Any] = {"check2": row.get("verdict"), "paths": {}}
            if row.get("verdict") == "match" and b and b.get("origin"):
                for path, body in bodies(b["origin"]).items():
                    eid = _body_id(path, body)
                    if eid not in done:
                        done[eid] = write_export(client, path, body, exports / eid)
                    entry["paths"][path] = {"id": eid, **done[eid]}
            index[key] = entry
    (out / "harness_in.json").unlink(missing_ok=True)
    (out / "harness_out.json").unlink(missing_ok=True)
    exports.mkdir(parents=True, exist_ok=True)
    (exports / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    n_match = sum(1 for e in index.values() if e["check2"] == "match")
    print(f"{len(index)} specimens, {n_match} check-2 matches, {len(done)} distinct exports")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
