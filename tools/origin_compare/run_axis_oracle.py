"""Run ``export_axis_ranges.py`` over many projects, one Origin at a time.

A Student-edition page-limit modal hangs COM with no error, so each file
runs in its own subprocess with a hard timeout. On expiry, only the ONE
Origin instance that subprocess recorded starting (its ``.pid`` sidecar) is
killed, and only if that PID is still an Origin process. If no exact PID was
recorded, nothing is killed and the run STOPS, rather than stacking another
instance on a hung one. A window the owner opened, before or during the run,
is never touched. Files run strictly one after another: never run two Origin
oracles in parallel.

``list.json`` holds corpus-relative paths. The corpus root is
``$QZ_TEST_DATA_ROOT``, else the sibling ``../test-data`` checkout.

Usage (Windows, Origin installed)::

    uv run --with pywin32 python -I tools/origin_compare/run_axis_oracle.py \
        <list.json> <outdir> [timeout_s]

``<outdir>/status.json`` maps each path to its ``NNN.json`` (or TIMEOUT).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # ``-I`` omits the script dir

from origin_proc import origin_pids, pid_file  # noqa: E402

ROOT = Path(os.environ.get("QZ_TEST_DATA_ROOT") or (HERE.parents[2] / "test-data"))


def _write_status(outdir: Path, status: dict[str, dict[str, object]]) -> None:
    """Atomically rewrite ``status.json`` so a crash keeps every finished file."""
    tmp = outdir / "status.json.tmp"
    tmp.write_text(json.dumps(status, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, outdir / "status.json")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # corpus paths are not all ASCII
    files: list[str] = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    outdir = Path(sys.argv[2])
    timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 150
    outdir.mkdir(parents=True, exist_ok=True)
    status: dict[str, dict[str, object]] = {}
    _write_status(outdir, status)
    for i, rel in enumerate(files):
        dst = outdir / f"{i:03d}.json"
        sidecar = pid_file(dst)  # written by export_axis_ranges
        sidecar.unlink(missing_ok=True)
        cmd = [sys.executable, "-I", str(HERE / "export_axis_ranges.py"), str(ROOT / rel), str(dst)]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
            status[rel] = {"out": dst.name, "rc": r.returncode, "err": r.stderr[-400:]}
        except subprocess.TimeoutExpired:
            ours: list[int] = []
            if sidecar.exists():
                ours = json.loads(sidecar.read_text(encoding="utf-8"))
            target = [p for p in ours if p in origin_pids()]
            if len(target) == 1:
                kill = ["taskkill", "/F", "/PID", str(target[0])]
                subprocess.run(kill, capture_output=True, check=False)
                status[rel] = {"out": None, "rc": "TIMEOUT", "killed": target[0]}
            else:
                status[rel] = {"out": None, "rc": "TIMEOUT", "killed": None}
                print(i, "TIMEOUT: no exact Origin PID recorded; killed nothing, stopping", rel)
                _write_status(outdir, status)
                break
        _write_status(outdir, status)
        print(i, status[rel]["rc"], rel, flush=True)


if __name__ == "__main__":
    main()
