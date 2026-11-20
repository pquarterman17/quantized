"""Before/after Origin corpus regression check.

Structural tests missed phantom hidden curves, a flipped ``.opj`` X binding,
44 bogus figures and dropped curves. This fingerprints how every local Origin
project imports (books, figures, curve bindings, omissions, axes, ...) and
diffs two code versions, so every corpus change must be explained.

Local-only and value-free: it reads ``test-data/origin`` (public corpus plus
the owner corpus; ``generated/``, the synthetic set and ``BertySnack_norigin``
are never touched), records structure only, and refuses to write anywhere
inside the repository.

    uv run python tools/origin_regress.py snapshot [--out PATH]
    uv run python tools/origin_regress.py diff BASE.json HEAD.json [--allow-file F]
    uv run python tools/origin_regress.py check [--base origin/main] [--allow-file F]

Corpora: ``--corpus [LABEL=]PATH`` (repeatable) or ``QZ_ORIGIN_PUBLIC_CORPUS`` /
``QZ_ORIGIN_OWNER_CORPUS``, else the ``test-data/origin`` sibling. Baselines go
to ``$QZ_ORIGIN_BASELINE`` (a ``.json`` file or a directory), else
``test-data/origin/_baselines/<sha>.json``, else the user cache.

Allow-file (JSON): ``{"<project or glob>": [{"kind": "curve_lost" | "*",
"contains": "<optional detail substring>", "reason": "why this is correct"}]}``.
Exit 0 = no unexplained change; 1 = unexplained change; 2 = usage/no corpus.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from origin_regress_lib import diff as dfl  # noqa: E402
from origin_regress_lib import runner as rn  # noqa: E402

REPO = rn.REPO


def _git(*args: str, cwd: Path = REPO) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    ).stdout.strip()


def _take(args: argparse.Namespace, src: Path, sha: str) -> dict[str, Any]:
    corpora = rn.discover_corpora(args.corpus)
    files = rn.collect_files(corpora)
    if not files:
        raise SystemExit("origin_regress: no Origin corpus found (use --corpus / env)")
    meta = {"sha": sha, "corpora": sorted(corpora), "corpus_id": rn.corpus_id(files)}
    return rn.snapshot(files, src, jobs=args.jobs, timeout=args.timeout, meta=meta)


def _write(path: Path, snap: dict[str, Any]) -> None:
    rn.refuse_in_repo(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snap, indent=1, ensure_ascii=False, sort_keys=True), "utf-8")


def _report(base: dict[str, Any], head: dict[str, Any], args: argparse.Namespace) -> int:
    changes = dfl.diff_snapshots(base, head)
    explained: list[tuple[dfl.Change, str]] = []
    stale: list[dict[str, str]] = []
    if args.allow_file:
        try:
            rules = dfl.load_allow(Path(args.allow_file))
        except (OSError, ValueError) as e:
            print(f"origin_regress: bad allow-file: {e}", file=sys.stderr)
            return 2
        changes, explained, stale = dfl.apply_allow(changes, rules)
    sys.stdout.write(dfl.format_changes(changes, limit=args.limit))
    if explained:
        print(f"{len(explained)} change(s) explained by the allow-file")
    for r in stale:
        print(f"warning: allow entry matched nothing (stale?): {r['project']} {r['kind']}")
    print(
        f"base {base['meta'].get('sha', '?')[:10]} vs head {head['meta'].get('sha', '?')[:10]}: "
        f"{len(changes)} unexplained change(s)"
    )
    return 1 if changes else 0


def cmd_snapshot(args: argparse.Namespace) -> int:
    sha = _git("rev-parse", "--short", "HEAD")
    out = Path(args.out) if args.out else rn.default_out(sha)
    rn.refuse_in_repo(out)
    snap = _take(args, REPO / "src", sha)
    _write(out, snap)
    print(f"wrote {out} ({snap['meta']['files']} files, {snap['meta']['seconds']}s)")
    return 0


def cmd_diff(args: argparse.Namespace) -> int:
    base = json.loads(Path(args.base).read_text("utf-8"))
    head = json.loads(Path(args.head).read_text("utf-8"))
    return _report(base, head, args)


def _base_snapshot(args: argparse.Namespace, sha: str, corpus_id: str) -> dict[str, Any]:
    cache = rn.baseline_dir() / f"base-{sha}-{corpus_id}.json"
    if cache.is_file() and not args.no_cache:
        print(f"base snapshot cached: {cache}")
        return dict(json.loads(cache.read_text("utf-8")))
    tmp = Path(tempfile.mkdtemp(prefix="qz-regress-"))
    wt = tmp / "base"
    try:
        _git("worktree", "add", "--detach", str(wt), sha)
        print(f"building base {sha[:10]} in temporary worktree {wt}")
        snap = _take(args, wt / "src", sha)
    finally:
        subprocess.run(["git", "worktree", "remove", "--force", str(wt)], cwd=REPO, check=False)
        shutil.rmtree(tmp, ignore_errors=True)
    _write(cache, snap)
    return snap


def cmd_check(args: argparse.Namespace) -> int:
    t0 = time.monotonic()
    if args.fetch and "/" in args.base:
        remote, _, ref = args.base.partition("/")
        subprocess.run(["git", "fetch", "-q", remote, ref], cwd=REPO, check=False)
    sha = _git("rev-parse", args.base)
    corpora = rn.discover_corpora(args.corpus)
    files = rn.collect_files(corpora)
    if not files:
        print("origin_regress: no Origin corpus found; nothing to check", file=sys.stderr)
        return 2
    base = _base_snapshot(args, sha, rn.corpus_id(files))
    head = _take(args, REPO / "src", _git("rev-parse", "HEAD"))
    if args.out:
        _write(Path(args.out), head)
    rc = _report(base, head, args)
    print(f"origin_regress check: {time.monotonic() - t0:.0f}s total")
    return rc


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--corpus", action="append", default=[], metavar="[LABEL=]PATH")
        p.add_argument("--jobs", type=int, default=8)
        p.add_argument("--timeout", type=float, default=300.0, help="seconds per file")

    def reporting(p: argparse.ArgumentParser) -> None:
        p.add_argument("--allow-file", help="JSON of explained changes (each with a reason)")
        p.add_argument("--limit", type=int, default=0, help="max lines per kind per project")

    s = sub.add_parser("snapshot", help="write a baseline JSON for the current tree")
    common(s)
    s.add_argument("--out")
    s.set_defaults(fn=cmd_snapshot)
    d = sub.add_parser("diff", help="diff two snapshots")
    d.add_argument("base")
    d.add_argument("head")
    reporting(d)
    d.set_defaults(fn=cmd_diff)
    c = sub.add_parser("check", help="snapshot HEAD and diff against a freshly built base")
    common(c)
    reporting(c)
    c.add_argument("--base", default="origin/main")
    c.add_argument("--fetch", action="store_true", help="git fetch the base remote first")
    c.add_argument("--no-cache", action="store_true", help="rebuild the cached base snapshot")
    c.add_argument("--out", help="also save the head snapshot here")
    c.set_defaults(fn=cmd_check)
    args = ap.parse_args(argv)
    return int(args.fn(args))


if __name__ == "__main__":
    raise SystemExit(main())
