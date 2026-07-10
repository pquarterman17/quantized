# `tools/origin_compare` — Origin-side figure export oracle

The Origin-side half of decode-plan item #39 (`plans/ORIGIN_FILE_DECODE_PLAN.md`,
W7 "Testing hardening"): the side-by-side Origin↔quantized figure comparison
campaign. `export_origin_graphs.py` drives a REAL, running OriginPro instance
via COM to export every graph page of a `.opj`/`.opju` project as a
fixed-width PNG, plus a `manifest.json` recording each graph's short/long
name, Project Explorer folder path, export filename, pixel dimensions, and
any per-graph error.

The other half of item #39 (an HTML gallery pairing these PNGs against
`tools/visual`'s screenshots of the quantized-rendered figure) is a separate
piece of work — this script only produces the Origin-side oracle images.

## Requirements

- Windows, with OriginPro installed and licensed (COM automation needs a
  real, launchable `Origin.ApplicationSI`).
- `pywin32` importable from whichever Python runs the script. This repo's
  own `.venv` has it as an optional extra (`uv pip install pywin32` if
  missing) — but see "pywin32 gotcha" below, this venv's install has been
  seen corrupted by OneDrive sync.
- No other dependency. Deliberately dependency-free (stdlib only, plus
  `pywin32`) — PNG width/height are read directly from the IHDR chunk
  rather than pulling in an imaging library, to keep this Apache-2.0-clean
  tooling as small as possible.

## Usage

```bash
.venv/Scripts/python.exe tools/origin_compare/export_origin_graphs.py \
    "C:\Users\patri\OneDrive\Coding\git\test-data\origin\PNR.opj"
```

Options:

- `--out <dir>` — override the output directory (default:
  `<project's parent>/_exports/<project-stem>/`).
- `--target-width <px>` — target PNG width (default 1200).
- `--time-budget <seconds>` — soft wall-clock cap per invocation (default
  1200s = 20 min). The script exits cleanly near this cap rather than
  blocking on one giant run; **re-run the identical command to resume** —
  progress is checkpointed to `manifest.json` after every single graph, so
  nothing already exported (`status: "ok"`, file present on disk) gets
  redone.

Output (**never committed, never pushed** — this is sample-derived,
possibly-private research data) lands in
`<test-data>/origin/_exports/<project-stem>/`, sibling to
`test-data/origin/specimens/ground_truth/` where this project's other COM
oracles already live:

```
_exports/PNR/
    Graph1.png
    Graph2.png
    ...
    manifest.json
```

## Resumability & the watchdog

Every risky COM call is guarded by a background watchdog thread reading a
heartbeat the main thread updates. If the main thread goes quiet longer
than the current timeout (900s while `app.Load()` is running for a large
project, 90s per graph afterward), the watchdog force-kills `Origin64.exe`
and hard-exits the whole process (`os._exit`) — deliberately, rather than
trying to recover in-process, because **a dead/killed COM server faults
every subsequent call in the same process** (this repo's oracle scripts
have hit that before). The fix is always to re-invoke the script: a fresh
process gets a fresh `EnsureDispatch`, and the manifest means it resumes
instead of restarting from graph 1.

At startup the script also checks for (and kills) any orphaned
`Origin*.exe` left behind by a previous watchdog-killed run, and reports
if it had to.

## COM traps found live while building this (2026-07-09)

These cost real time to isolate — recorded here (and in the module
docstring) so nobody re-derives them:

1. **The "confirm overwrite" dialog hangs Origin forever — even with
   `@ASK=0` set.** Calling `expGraph` against a filename that already
   exists pops a blocking confirmation dialog. `@ASK=0` (LabTalk's usual
   "suppress prompts" switch) does **not** suppress this one — confirmed
   live: the watchdog had to kill a run stuck on exactly this. The fix
   that works: always `Path.unlink()` the destination PNG immediately
   before calling `expGraph`, so Origin never has anything to ask about.
2. **`expGraph`'s `path:=` must be a folder, never a full file path.**
   Passing a filename inside `path:=` makes the *entire* call fail
   silently (`Execute` returns `False`, no exception, no error text). The
   exported file is always named after the currently active window's own
   short name (`<ShortName>.png`) — there is no working `filename:=` /
   `fname:=` override that was found to change this.
3. **Unrecognized keyword arguments silently fail the whole call.**
   `expGraph type:=png path:="..." overwrite:=1` returns `False` for the
   entire statement — `expGraph` has no `overwrite` option, and does not
   ignore what it doesn't recognize the way one might hope. Any option
   name must be verified against the actual return value + resulting file,
   never assumed from memory of "how X-Functions usually work."
4. **`page.resx`/`page.resy` are *inversely* proportional to the exported
   pixel size for a fixed `page.width`.** The intuitive guess (higher DPI
   → more pixels for the same physical size) is backwards here. Doubling
   `page.resx` (600 → 1200) *halved* the observed PNG width live. The
   measured, exactly-fitting relationship across multiple graphs/pages:

   ```
   pixel_width = page.width * 300 / page.resx
   ```

   So to hit a target pixel width: `resx_target = page.width * 300 /
   TARGET_WIDTH_PX`, and set `page.resy` to the **same** value (not a
   `page.height`-derived one) so nothing stretches — this keeps the
   DPI-like value isotropic and the aspect ratio exactly matching
   `page.width`/`page.height`. The constant `300` is an empirical fit from
   this Origin build/version, not vendor-documented — flag it if a future
   Origin version's export sizes look wrong.
5. **The `win32com.client` package can go missing its own source files.**
   This repo's `.venv` is inside a OneDrive-synced folder; at least once,
   `win32com/client/*.py` were simply absent on disk (only a stale
   `__pycache__` remained) while `win32com/gen_py` etc. looked fine —
   `import win32com.client` succeeded (namespace package) but
   `wc.gencache` raised `AttributeError`. Fix: `uv pip install --reinstall
   pywin32` (with `UV_LINK_MODE=copy` set, per this repo's usual OneDrive
   hardlink gotcha). Always sanity-check
   `python -c "import win32com.client; win32com.client.gencache"` once
   before trusting a COM script's failure is a *logic* bug and not a
   corrupted venv.
6. Traps already known from this project's earlier COM oracle work (see
   `docs/origin_re/ORIGIN_CONVENTIONS.md` §8/§11) still apply and are
   defended against here too: the `WorksheetPages`/`GraphPages` COM
   collection iterators throw (enumerate via `doc -e W`/`doc -e P` LabTalk
   accumulation instead); only one live Origin instance at a time (a
   killed/dead server faults every subsequent call); the Project Explorer
   folder-path capture can degrade to one identical path for every window
   if PE doesn't follow window activation on a given build — this script
   detects that degenerate case and records `folder: null` (unverified)
   rather than a false "root"; and the student/eval license's page-limit
   truncation means the enumerated graph count is authoritative only for
   the graphs it *did* find, never a completeness guarantee.

## Verified end-to-end before the real corpus run

Before running against the large real projects, the full script (load →
enumerate → folder capture → per-graph export → manifest checkpoint →
resume-skip) was verified against the small `RockingCurve.opju` specimen
(4 graphs, 7 windows): first run exported all 4 at exactly 1200px width
(918/333px tall depending on aspect ratio), second run skipped all 4 as
already-done. That is what pinned down traps 1–4 above.
