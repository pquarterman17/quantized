"""Export every graph page of a real Origin project as a fixed-width PNG,
via live OriginPro COM automation -- the Origin-side half of decode-plan
item #39 (W7, ``plans/ORIGIN_FILE_DECODE_PLAN.md``): the side-by-side
Origin<->quantized figure comparison campaign.

For each `.opj`/`.opju` project this drives a REAL, running OriginPro
instance to:

* enumerate every graph window (``doc -e P``, filtering out per-column
  worksheet "sparkline" windows -- the proven pattern from
  ``tools/origin_trial/export_ground_truth.py``);
* record each graph's short name, long name (``page.longname$``), and its
  Project Explorer folder path (the ``pe_path`` X-Function, same recipe as
  ``tools/origin_trial/export_graph_extras.py``);
* export it as a PNG at a fixed target pixel width (default 1200px, same
  DPI applied to both axes so nothing is stretched);
* write ``manifest.json`` with one entry per graph, checkpointed to disk
  after EVERY graph so a killed/timed-out run loses at most the one graph
  that was in flight.

Usage::

    .venv/Scripts/python.exe tools/origin_compare/export_origin_graphs.py \\
        "C:\\Users\\patri\\OneDrive\\Coding\\git\\test-data\\origin\\PNR.opj"

Re-running the SAME project path is idempotent/resumable: graphs already
recorded with ``status == "ok"`` (and whose PNG still exists on disk) are
skipped. A soft ``--time-budget`` (default 20 minutes) makes the script
exit cleanly near that cap so a caller can loop invocations rather than
block on one multi-hour run; each invocation picks up where the last one
left off via the manifest.

Output lives OUTSIDE this repo (sample-derived images are never committed):
``<project's parent dir>/_exports/<project-stem>/`` by default (override
with ``--out``) -- for the two corpus files this campaign targets, that
resolves to ``test-data/origin/_exports/PNR/`` and
``test-data/origin/_exports/MnN_Diffusion_PNR/`` respectively, sibling to
``test-data/origin/specimens/ground_truth/`` where the rest of this
project's COM oracles live.

COM traps this script defends against
======================================
See ``tools/origin_compare/README.md`` and
``docs/origin_re/ORIGIN_CONVENTIONS.md`` section 8/11 for the full history;
the ones specific to THIS script (found live, 2026-07-09, while building it):

* **Headless-COM silent hang.** An invisible (``Visible = 0``) instance can
  wedge on a modal dialog with no visible symptom. This script always runs
  Origin VISIBLE (``app.Visible = 1``) and, more importantly, wraps every
  risky COM call with a heartbeat watchdog thread: if the main thread goes
  quiet for longer than the current timeout, the watchdog force-kills
  ``Origin64.exe`` and hard-exits this process (``os._exit``) rather than
  hanging forever. The caller (a human, or an orchestrating loop) simply
  re-invokes the script; the manifest checkpoint means it resumes instead
  of restarting.
* **The "confirm overwrite" dialog hangs even with ``@ASK=0``.** Calling
  ``expGraph`` a second time against a filename that already exists pops a
  blocking confirmation dialog -- confirmed LIVE to hang indefinitely (the
  watchdog had to kill it) even with ``@ASK=0`` set beforehand. There is no
  known LabTalk suppression for this specific dialog. The fix that DOES
  work (also confirmed live, 3 repeated re-exports, no hang): always
  ``unlink()`` the destination PNG immediately before calling ``expGraph``,
  so Origin never sees an existing file to ask about.
* **``expGraph``'s ``path:=`` must be a folder, never a full file path.**
  Passing a filename inside ``path:=`` makes the WHOLE call fail silently
  (``Execute`` returns ``False``, no exception). The exported file is
  always named after the ACTIVE window's own short name
  (``<ShortName>.png``) -- there is no working ``filename:=``/``fname:=``
  override, so short names must be unique per project (Origin enforces
  this itself; this script trusts it).
* **Unknown keyword arguments silently fail the whole call.** ``expGraph
  ... overwrite:=1`` was tried first (a very reasonable guess) and returns
  ``False`` for the ENTIRE call -- ``expGraph`` apparently has no
  ``overwrite`` option, and does not just ignore what it doesn't recognize.
  Never guess an option name without checking the return value; when in
  doubt, drop it and use the delete-first pattern above instead.
* **``page.resx``/``page.resy`` are INVERSELY proportional to output pixel
  size for a fixed ``page.width``.** Confirmed live by doubling resx
  (600->1200) and observing the exported pixel width HALVE, not double.
  The exact empirical relationship (linear fit, two clean data points):
  ``pixel_width = page.width * 300 / resx``. So to hit a target pixel
  width: ``resx_target = page.width * 300 / TARGET_WIDTH_PX`` (set
  ``page.resy`` to the SAME value so nothing stretches). This constant
  (300) was derived from live measurement, not vendor documentation --
  treat it as validated-by-this-corpus, not a guaranteed universal Origin
  constant, if a future Origin version changes behavior.
* **Only one live Origin instance at a time.** A dead/killed COM server
  faults every subsequent call in the SAME process -- this is exactly why
  a watchdog-triggered kill also hard-exits this whole script rather than
  trying to recover and continue; a fresh process gets a fresh
  ``EnsureDispatch``.
* **The COM collections (``WorksheetPages``/``GraphPages``) iterator
  throws.** Windows are enumerated via ``doc -e W {...}`` / ``doc -e P
  {...}`` LabTalk string accumulation instead (proven pattern, see
  ``export_ground_truth.py``).
* **Student/eval page-limit truncation.** Origin's page-limited license can
  silently enumerate FEWER graphs than a project actually contains (see
  ``ORIGIN_CONVENTIONS.md`` 8.4). This script's ``graph_count_enumerated``
  in the manifest is authoritative for the graphs it DID find, never a
  completeness guarantee.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

TARGET_WIDTH_PX = 1200
SUSPICIOUS_BYTES_FLOOR = 10_000  # a real graph render should exceed this
LOAD_WATCHDOG_S = 900.0  # app.Load() can be slow for a 100+ MB project
GRAPH_WATCHDOG_S = 90.0  # a single graph export should never take this long
DEFAULT_TIME_BUDGET_S = 20 * 60  # soft per-invocation cap; re-run to resume
MAX_GRAPH_ATTEMPTS = 2  # give up on a graph that hangs the watchdog this many times
_RESX_PIXEL_CONSTANT = 300.0  # pixel_width = page.width * 300 / resx (measured)


# ── watchdog: kill a hung Origin instance rather than hang forever ──────────


class Heartbeat:
    """Cooperative liveness signal the main thread updates; a background
    watchdog thread reads it to detect a stuck COM call."""

    def __init__(self) -> None:
        self._t = time.monotonic()
        self._lock = threading.Lock()

    def beat(self) -> None:
        with self._lock:
            self._t = time.monotonic()

    def idle_for(self) -> float:
        with self._lock:
            return time.monotonic() - self._t


class Watchdog:
    """One background thread for the whole run; ``set_timeout`` adjusts the
    threshold live (a large one during ``Load()``, a tight one per graph)
    without needing to juggle multiple thread/stop-event pairs."""

    def __init__(self, hb: Heartbeat, timeout_s: float) -> None:
        self.hb = hb
        self.timeout_s = timeout_s
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def set_timeout(self, timeout_s: float) -> None:
        self.timeout_s = timeout_s
        self.hb.beat()  # don't let the old timeout's elapsed time carry over

    def cancel(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            time.sleep(2)
            if self.hb.idle_for() > self.timeout_s:
                print(
                    f"[watchdog] no progress for >{self.timeout_s:.0f}s -- "
                    "killing Origin64.exe and hard-exiting (re-run to resume)",
                    flush=True,
                )
                subprocess.run(
                    ["taskkill", "/IM", "Origin64.exe", "/F"],
                    capture_output=True, check=False,
                )
                os._exit(3)  # hard exit; a checkpointed manifest survives this


def kill_stale_origin() -> bool:
    """Kill any orphaned Origin*.exe left by a previous watchdog-killed run.
    Returns True (and prints what it found) so the caller can report it --
    a dead COM server faults every subsequent call in a NEW process too."""
    out = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq Origin*"],
        capture_output=True, text=True, check=False,
    ).stdout
    found = ".exe" in out
    if found:
        print(f"[startup] orphaned Origin process found, killing:\n{out}", flush=True)
        subprocess.run(["taskkill", "/IM", "Origin64.exe", "/F"], capture_output=True, check=False)
        subprocess.run(["taskkill", "/IM", "Origin.exe", "/F"], capture_output=True, check=False)
        time.sleep(2)
    return found


# ── PNG dimension read without any imaging dependency ───────────────────────


def png_dims(path: Path) -> tuple[int, int] | None:
    if not path.exists():
        return None
    try:
        data = path.read_bytes()[:24]
    except OSError:
        return None
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


# ── manifest checkpoint helpers ──────────────────────────────────────────────


def load_manifest(path: Path, project: Path) -> dict[str, Any]:
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("project") == str(project):
            data.setdefault("graphs", {})
            return data
        print(
            f"[manifest] existing manifest is for a different project "
            f"({data.get('project')!r}) -- starting fresh",
            flush=True,
        )
    return {"project": str(project), "graphs": {}}


def write_manifest(path: Path, manifest: dict[str, Any]) -> None:
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=1, default=str), encoding="utf-8")
    tmp.replace(path)  # same-volume rename is atomic on Windows


# ── the export run ───────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", type=Path, help="path to an Origin .opj/.opju project file")
    ap.add_argument("--out", type=Path, default=None,
                     help="output dir (default: <project's parent>/_exports/<stem>)")
    ap.add_argument("--target-width", type=int, default=TARGET_WIDTH_PX,
                     help="target PNG width in pixels (default: %(default)s)")
    ap.add_argument("--time-budget", type=float, default=DEFAULT_TIME_BUDGET_S,
                     help="soft wall-clock budget in seconds; the script exits "
                          "cleanly near this cap so it can be re-run to resume "
                          "(default: %(default)s)")
    ap.add_argument("--skip", action="append", default=[], metavar="NAME",
                     help="graph short name to skip permanently (repeatable). "
                          "For graphs that reliably hang Origin's own export "
                          "(e.g. PNR.opj's Graph18) — recorded in the manifest "
                          "as status 'skipped' so downstream tooling sees an "
                          "honest gap instead of an eternal retry.")
    args = ap.parse_args()

    project = args.project.resolve()
    if not project.exists():
        print(f"ERROR: project file not found: {project}", file=sys.stderr)
        return 2

    outdir = (args.out or (project.parent / "_exports" / project.stem)).resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    manifest_path = outdir / "manifest.json"

    if kill_stale_origin():
        print(
            "[startup] WARNING: an orphaned Origin process was found and killed "
            "before this run started -- a previous invocation likely hit the "
            "watchdog. Continuing with a fresh instance.",
            flush=True,
        )

    manifest = load_manifest(manifest_path, project)
    manifest["target_width_px"] = args.target_width
    run_started = time.time()

    import win32com.client as wc  # lazy: Windows + pywin32 only, never at import time

    hb = Heartbeat()
    wd = Watchdog(hb, LOAD_WATCHDOG_S)

    hb.beat()
    app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
    app.Visible = 1  # NEVER headless here -- see module docstring

    def lt(cmd: str) -> bool:
        return bool(app.Execute(cmd))

    def lts(expr: str) -> str:
        lt('string __s$ = "";')
        lt(f"__s$ = {expr};")
        return str(app.LTStr("__s$"))

    _SENTINEL = -987654.0

    def ltn(expr: str) -> float:
        lt(f"double __d = {_SENTINEL};")
        lt(f"__d = {expr};")
        return float(app.LTVar("__d"))

    def windows(kind: str) -> list[str]:
        lt('string __acc$ = "";')
        lt(f'doc -e {kind} {{ __acc$ = "%(__acc$)%H|"; }}')
        return [w for w in str(app.LTStr("__acc$")).split("|") if w]

    def active_folder() -> str:
        lt('string __p$ = "";')
        lt("pe_path path:=__p$;")
        return str(app.LTStr("__p$"))

    try:
        lt("@ASK=0;")  # defensive; confirmed NOT sufficient on its own for the
                       # overwrite dialog (delete-before-export handles that),
                       # but harmless and may suppress other prompts.

        print(f"Loading {project} ({project.stat().st_size / 1e6:.1f} MB) ...", flush=True)
        hb.beat()
        t0 = time.time()
        ok = app.Load(str(project))
        hb.beat()
        load_s = time.time() - t0
        print(f"Load -> {ok} ({load_s:.1f}s)", flush=True)
        if not ok:
            manifest["load_error"] = "app.Load returned False"
            write_manifest(manifest_path, manifest)
            return 1
        manifest["load_seconds"] = load_s

        wd.set_timeout(GRAPH_WATCHDOG_S)  # loading is over; tighten the leash

        graphs = [g for g in windows("P") if "sparkline" not in g]
        all_windows = windows("W") + graphs
        print(f"found {len(graphs)} graph page(s), {len(all_windows)} window(s) total", flush=True)

        # Folder-path map: degrade to "unverified" (null per graph) if the
        # Project Explorer path never varies with window activation on this
        # Origin build -- same fallback discipline as export_graph_extras.py.
        folders: dict[str, str] = {}
        for w in all_windows:
            hb.beat()
            lt(f"win -a {w};")
            folders[w] = active_folder()
        folders_verified = len(set(folders.values())) > 1
        if not folders_verified:
            print(
                f"[warning] folder capture degenerate ({set(folders.values())!r}) -- "
                "Project Explorer path did not vary with window activation; "
                "folder paths will be recorded as null (unverified), not root",
                flush=True,
            )

        manifest["graph_count_enumerated"] = len(graphs)
        manifest["window_count_enumerated"] = len(all_windows)
        manifest["folders_verified"] = folders_verified
        write_manifest(manifest_path, manifest)

        deadline = time.monotonic() + args.time_budget
        n_ok = n_err = n_suspicious = n_skipped = n_processed = 0
        for i, g in enumerate(graphs, 1):
            hb.beat()
            if g in args.skip:
                entry = manifest["graphs"].get(g) or {"short_name": g}
                entry["status"] = "skipped"
                entry["error"] = "skipped via --skip (reliably hangs Origin's export)"
                manifest["graphs"][g] = entry
                write_manifest(manifest_path, manifest)
                n_skipped += 1
                continue
            existing = manifest["graphs"].get(g)
            if (
                existing
                and existing.get("status") == "ok"
                and existing.get("file")
                and (outdir / existing["file"]).exists()
            ):
                n_skipped += 1
                continue

            # A graph left "in_progress" means a PREVIOUS invocation's
            # watchdog killed Origin while stuck on this exact graph (the
            # manifest is only updated to a final status AFTER the risky
            # calls return -- an entry stuck at "in_progress" is direct
            # evidence of a hang, not a guess). Retry a bounded number of
            # times, then give up permanently so a genuinely-stuck window
            # can never wedge every future invocation forever.
            attempts = existing.get("attempts", 0) if existing else 0
            if existing and existing.get("status") == "in_progress":
                if attempts >= MAX_GRAPH_ATTEMPTS:
                    entry = dict(existing)
                    entry["status"] = "error"
                    entry["error"] = (
                        f"gave up after {attempts} watchdog-killed attempt(s) -- "
                        "this window appears to genuinely hang Origin's COM "
                        "export (not a transient fluke); needs manual "
                        "investigation, not further auto-retry"
                    )
                    manifest["graphs"][g] = entry
                    write_manifest(manifest_path, manifest)
                    n_err += 1
                    print(
                        f"[{i}/{len(graphs)}] {g}: giving up permanently after "
                        f"{attempts} hung attempt(s)",
                        flush=True,
                    )
                    continue

            if time.monotonic() > deadline:
                print(
                    f"[budget] time budget ({args.time_budget:.0f}s) reached after "
                    f"{n_processed} graph(s) this invocation -- exiting cleanly, "
                    "re-run the same command to resume",
                    flush=True,
                )
                break

            n_processed += 1
            attempts += 1
            # Checkpoint BEFORE the risky calls -- if the watchdog kills this
            # process mid-graph, the manifest still shows "in_progress" (with
            # the attempt count) instead of silently vanishing, which is what
            # lets the check above detect and eventually stop a real hang.
            manifest["graphs"][g] = {
                "short_name": g, "status": "in_progress", "attempts": attempts,
            }
            write_manifest(manifest_path, manifest)

            entry = {"short_name": g, "attempts": attempts}
            try:
                lt(f"win -a {g};")
                long_name = lts("page.longname$")
                folder = folders.get(g) if folders_verified else None
                pw = ltn("page.width")
                if not (pw == pw) or pw <= 0:  # NaN or non-positive
                    raise RuntimeError(f"degenerate page.width={pw!r}")
                resx_target = pw * _RESX_PIXEL_CONSTANT / args.target_width
                lt(f"page.resx = {resx_target};")
                lt(f"page.resy = {resx_target};")

                fname = f"{g}.png"
                dest = outdir / fname
                if dest.exists():
                    dest.unlink()  # REQUIRED -- see module docstring: the
                                   # overwrite-confirmation dialog otherwise
                                   # hangs Origin forever, even with @ASK=0

                hb.beat()
                ok_exp = lt(f'expGraph type:=PNG path:="{outdir}\\";')
                hb.beat()

                dims = png_dims(dest)
                size = dest.stat().st_size if dest.exists() else 0
                entry.update({
                    "long_name": long_name,
                    "folder": folder,
                    "file": fname,
                    "width": dims[0] if dims else None,
                    "height": dims[1] if dims else None,
                    "bytes": size,
                })
                if not ok_exp or not dest.exists():
                    entry["status"] = "error"
                    entry["error"] = "expGraph returned False or wrote no file"
                    n_err += 1
                elif size < SUSPICIOUS_BYTES_FLOOR:
                    entry["status"] = "suspicious"
                    entry["error"] = f"file is only {size} bytes (< {SUSPICIOUS_BYTES_FLOOR})"
                    n_suspicious += 1
                else:
                    entry["status"] = "ok"
                    entry["error"] = None
                    n_ok += 1
            except Exception as exc:  # noqa: BLE001 -- one bad graph must
                                       # never sink the whole run
                entry["status"] = "error"
                entry["error"] = str(exc)
                n_err += 1

            manifest["graphs"][g] = entry
            write_manifest(manifest_path, manifest)  # checkpoint every graph
            status = entry["status"]
            detail = (
                f"{entry.get('width')}x{entry.get('height')}, {entry.get('bytes')}B"
                if status != "error" else entry.get("error")
            )
            print(f"[{i}/{len(graphs)}] {g}: {status} ({detail})", flush=True)

        remaining = len(graphs) - n_ok - n_suspicious - n_err - n_skipped
        manifest["last_run_seconds"] = time.time() - run_started
        write_manifest(manifest_path, manifest)
        print(
            f"summary: {n_ok} ok, {n_suspicious} suspicious, {n_err} error, "
            f"{n_skipped} already-done, {remaining} remaining "
            f"(this invocation: {time.time() - run_started:.1f}s)",
            flush=True,
        )
        return 0 if remaining == 0 and n_err == 0 else (0 if remaining == 0 else 4)
    finally:
        wd.cancel()
        try:
            app.Exit()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
