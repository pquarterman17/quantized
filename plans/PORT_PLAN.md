# quantized — Port Plan

Ground-up port of the `quantized_matlab` toolbox to a Python/FastAPI
backend (feature parity) + React/TypeScript frontend (revamped GUI),
built on the clean architecture of the sibling `fermiviewer` project so
the codebase never accretes the god-scripts the MATLAB original did.

**Status:** Active
**Created:** 2026-06-21
**Updated:** 2026-07-10 (full W0–W9 reconciliation against
`PORT_CHECKLIST.md` + the code: every shipped item is now struck below
with a pointer to the checklist section that records it. Genuinely open
after this pass: #3 run-model residue (auto-shutdown / `--dev` /
`--desktop` — pywebview-vs-Tauri intent is an OWNER decision), #7
WebSocket job queue (unbuilt; client-side step-executor batch shipped
instead — decide if still wanted), #19 reductions (Williamson-Hall /
FFT thickness / spin asymmetry — unported), #12's polarized-asymmetry
consolidated-CSV path, W8 packaging closure (#46/#49; #47/#48 largely
shipped via ORIGIN_GAP #41), W9 #52/#53 nice-to-haves, and the
blocked-on-samples pair (Rigaku 2-D RSM `.raw`, `importOxford`). See
`BACKLOG.md` for the cross-plan dashboard.)
Previous: 2026-07-05 (W0 checkboxes reconciled against code — all shipped
except the frontend component-size test; W1–W9 not re-reconciled that pass)

---

## Context

### How the pieces fit together

Four layers, strictly separated (enforced by `tests/test_repo_integrity.py`):

```
                 ┌─────────────────────────────────────────────┐
 frontend/  ───► │ React 19 + TS + Vite + Zustand + uPlot       │  HTTP/WS
 (revamp)        │ Shell · Library · Stage · Inspector ·        │ ◄──────┐
                 │ workshops · store · lib (api client, theme)  │        │
                 └─────────────────────────────────────────────┘        │
                                                                         │
 src/quantized/  ┌──────────────┐  thin adapters: validate → call →     │
   routes/   ───►│ FastAPI app  │  serialize. One small file per domain. ┘
                 │ + jobs (WS)  │  (NO business logic here)
                 └──────┬───────┘
                        │ calls
            ┌───────────▼───────────────────────────────┐
   calc/    │ PURE libraries — ndarray / DataStruct in,  │
   io/      │ results out. No fastapi/pydantic imports.  │
 datastruct │ This is where parity with MATLAB lives.    │
            └───────────────────────────────────────────┘
```

- **`datastruct.py`** — the canonical frozen `DataStruct`
  (`.time`, `.values`, `.labels`, `.units`, `.metadata`). The data
  contract every parser returns and every consumer reads.
- **`io/`** — parsers + a single `registry.py` (extension map + content
  sniffers) + export writers + session I/O. Pure.
- **`calc/`** — corrections, fitting, calculators (DiraCulator), workspace
  formula engine, statistics, plotting math. Pure.
- **`routes/`** — one thin FastAPI router per domain (`parsers`,
  `corrections`, `fitting`, `calc_*`, `workspace`, `plot`, `export`,
  `session`, `jobs`, `dev`). No business logic.
- **`frontend/`** — React SPA; talks to the backend over HTTP + a
  WebSocket for long jobs. Interactive plots via uPlot (1D) + Canvas2D
  (2D maps; WebGL only if needed). Reuses `fermiviewer` theme tokens +
  Shell chrome.

### Data / control flow

```
file ─► io/registry (sniff) ─► io/parser ─► DataStruct
     ─► calc/corrections ─► corrected DataStruct
     ─► calc/plotting (series build) ─► routes/plot ─► uPlot (interactive)
                                     └► routes/export ─► matplotlib ─► PDF/SVG (publication)
batch fit / batch export ─► routes/jobs (WebSocket) ─► progress + cancel
```

Each stage is independent and pure; the pipeline is composed in `routes/`.

### Reuse strategy (decision — Q1)

**"Salvage domain logic, mirror fermiviewer's architecture, verify against
MATLAB."**

- **Mirror** `../fermiviewer` for structure, CLI, theme, frontend stack,
  and the three enforcement guards. It already solved the monolith
  problem — copy the discipline, not just the code.
- **Salvage** pure domain Python from `../thin_film_toolkit` (parsers,
  calc formulas, fitting math) as a *starting point only*: re-home each
  function into `io/`/`calc/` under the 500-line ceiling, strip EM scope,
  and **golden-verify against MATLAB before trusting it** (TFT is stale
  and was a one-shot dump).
- **Reference** `../quantized_matlab` as the authoritative behaviour. All
  golden values freeze from it.

### Milestones (orientation)

- **M1 — Vertical slice:** load a QD/XRD file → corrected → plotted in the
  new React UI. Proves the full stack + clean layering + golden harness.
  (W0 #1–#6 + W1 #8–#9 + W6 #33–#34 + W7 #37–#40.) *Does not need the job
  queue.*
- **M2 — Daily-driver parity:** all parsers, corrections, interactive +
  vector export, peak/curve fitting, the WebSocket job queue for batch
  work. (Adds W0 #7, W1 rest, W2, W3, W6 rest.)
- **M3 — Full parity:** DiraCulator calculators + DataWorkspace + macro
  recorder. (W4, W5, remaining W7.)
- **M4 — Distributable:** Tauri packaging, installers, CI green on the
  golden parity sweep. (W8, W9.)

### Dependency map

- **W0** blocks everything (scaffold + enforcement + golden harness). The
  job queue (#7) is W0 infra but only gates M2 batch work, not M1.
- **W1** (DataStruct + parsers) underpins W2–W6.
- **W7 #37–#38** (frontend scaffold + theme) can start in parallel right
  after W0 — only needs API contracts, not implementations.
- **W6** needs W1; **W3/W4/W5** need W1; mostly independent of each other.
  Batch items (W3 #23, W6/export) depend on the job queue (W0 #7).
- **W8** is last (needs a working app). **W9** runs continuously — write
  the golden test for each feature as it lands, not at the end.

---

## Cross-cutting priorities (start here)

| # | Item | Workstream | Why first |
|---|------|------------|-----------|
| 1 | Repo scaffold + package layout | W0 | Nothing exists yet |
| 2 | Enforcement tests (license/500-line/pure-layer) | W0 | Cheaper than retrofitting; defines the rules from commit 1 |
| 4 | Golden-test harness + MATLAB freeze script | W0 | Parity is unverifiable without it |
| 6 | `DataStruct` | W0/W1 | The contract everything depends on |
| 8 | Parser registry + base + sniffers | W1 | First real data path |
| 9 | Quantum Design parsers | W1 | Most-used format; drives M1 |
| 33 | Plot state model | W6 | Needed to render anything |
| 37 | Frontend scaffold + Zustand stores | W7 | Parallelizable; unblocks UI |
| 38 | Theme system (reuse fermiviewer) | W7 | Set the visual language early |

**First milestone (M1)** is exactly these items end-to-end.

---

## W0 — Foundation & enforcement

### Tier 1 — High Impact
1. **Repo scaffold** — `src/quantized/{datastruct.py,io,calc,routes,assets}`,
   `frontend/`, `tests/`, `tools/`, `pyproject.toml` (package `quantized`,
   CLI `qz`), `uv` env, Apache-2.0 LICENSE/NOTICE.
   - [x] Python package skeleton + `pyproject.toml` (deps, scripts, ruff/mypy config)
   - [x] `frontend/` Vite+React+TS skeleton (mirror fermiviewer `package.json`)
   - [x] `tools/matlab/` for the freeze script
2. **Enforcement tests** — port `fermiviewer/tests/test_repo_integrity.py`:
   no-GPL-runtime-deps, 500-line god-module ceiling, pure-layer import guard.
   - [x] Backend `test_repo_integrity.py`
   - [x] Frontend component-size test (~400-line `.tsx` ceiling) — built
     2026-07-08 in `architecture.test.ts` ("component-ceiling ratchet (#7)"): a
     global 400 ceiling + 3 grandfathered pins (App/PlotStage/ThinFilmTab),
     ratchet-down only. (Same item as PROJECT_ORGANIZATION_PLAN #7; CLAUDE.md's
     claim is now correct.)
~~3. **CLI + run model**~~ ✅ completed 2026-07-10 (see Completed) —
   full run model shipped: auto-shutdown armed by default browser mode,
   `--dev`, `--desktop` (pywebview; Tauri stays the W8 packaging path).
~~4. **Golden-test harness**~~ ✅ shipped (M1 PR4, `fb3efe2`) — harness +
   manifest + markers live; every checklist "golden" tag runs through it.
5. **CI workflow** — pytest + ruff + mypy + frontend vitest + build +
   integrity gates. Self-hosted runner for golden tests that need MATLAB.
   - [x] Backend CI — `.github/workflows/ci.yml` (ubuntu, uv sync, ruff +
     mypy + pytest). Goldens/fixtures committed → no MATLAB needed; the
     repo-integrity guard (pure-layer + 500-line) runs in pytest.
   - [x] Frontend vitest + build — CI `frontend` job runs `npm test` + `npm run build`
~~6. **`DataStruct`**~~ ✅ shipped (M1 PR3, `10f4e7f`) — frozen dataclass +
   validation + JSON boundary (`datastruct.py`).
~~7. **WebSocket job-queue infrastructure**~~ — closed 2026-07-10 as
   superseded (owner decision; see Completed).

---

## W1 — Data I/O & parsers

### Tier 1 — High Impact
~~8. **Parser registry**~~ ✅ shipped & golden — `io/registry.py` +
   `io/base.py`; see PORT_CHECKLIST W1.
~~9. **Quantum Design**~~ ✅ shipped & golden (QD VSM / PPMS / MPMS +
   column shorthands); see PORT_CHECKLIST W1.
10. **XRD** — Rigaku, XRDML (incl. **2D area-detector** map extension:
    `is2D`, `map2D.intensity/axis/Qx/Qz`), PANalytical. (Bruker → fermiviewer:
    its .brml/.raw are 2D-detector/RSM image data, not line data.)
    **PARTIAL:** XRDML/PANalytical 1-D + all three 2-D mesh kinds + pole
    figures shipped & golden; Rigaku 1-D binary golden. **Rigaku 2-D RSM
    `.raw` BLOCKED** — no ω field in the reverse-engineered header and no
    multi-range RSM sample in the corpus (see PORT_CHECKLIST W1).
~~11. **Other lab data**~~ ✅ shipped & golden (Lake Shore, NCNR PNR/refl/
    `.dat`, refl1d `.dat`, SIMS, CSV/Excel + auto-detect); see
    PORT_CHECKLIST W1.

### Tier 2 — Medium Impact
12. **Export writers** — Standard CSV + **Origin-ASCII** + **`.ogs` LabTalk
    import script** (cross-platform Origin path), multi-row headers, HDF5,
    reflectivity/neutron consolidated CSV (role-based columns, not R/dR
    assumptions).
    **PARTIAL:** everything shipped & golden except the consolidated
    CSV's **polarized-asymmetry path** (shared-Q interp + ++/−− spin
    asymmetry) — needs ++/−− polarization metadata (see PORT_CHECKLIST
    W1 export writers; ties into #19's spin-asymmetry reduction).
~~13. **Session I/O**~~ ✅ shipped — the `.dwk` workspace (v1→v3
    migrations) + localStorage autosave; see PORT_CHECKLIST W5.

### Tier 3 — Nice-to-Have
~~14. **Live Send-to-Origin (COM)**~~ ✅ shipped as designed —
    `io/origin_com.py` + 16 mock tests; no golden possible BY DESIGN
    (the mock model is the agreed acceptance); see PORT_CHECKLIST W1.
15. **Paused parsers** — ~~`importOpus`, `importSPC`~~ ported 2026-07-08 as
    independent implementations against each format's published spec (no
    MATLAB source exists for either — see `PORT_CHECKLIST.md`); no golden
    freeze is possible (nothing to freeze from). `importOxford` remains
    fully blocked — no spec exists at all (MATLAB roadmap: "format varies
    by software version... needs example file"), so nothing was attempted.

---

## W2 — Corrections & processing

### Tier 1 — High Impact
~~16. **Corrections pipeline**~~ ✅ shipped & golden — `calc/corrections.py`
    8-step pipeline + magnetometry units/background; see PORT_CHECKLIST W2.
    (`applyParserAnalysisConfig` was GUI relabeling only — not ported,
    documented there.)
17. ~~**BG-from-file** subtraction + fit-BG-from-region~~ — shipped (see Completed).

### Tier 2 — Medium Impact
~~18. **Processing utilities**~~ ✅ shipped & golden — smoothing / FFT /
    normalize / resample / units / algebra / merge / baselines; see
    PORT_CHECKLIST W2.
19. **Reductions** — neutron spin asymmetry; reflectivity FFT / FFT
    thickness; Williamson-Hall.
    **OPEN — unported (2026-07-10 audit):** no `calc/` module exists for
    any of the three; only a TODO note in `io/consolidated.py`. The last
    genuinely unstarted backend-parity item.

---

## W3 — Fitting

### Tier 1 — High Impact
~~20. **Curve-fitting engine**~~ ✅ shipped & golden ("W3 fitting fully
    ported" 2026-06-30); see PORT_CHECKLIST W3.
~~21. **Model library**~~ ✅ shipped & golden — all 29 models @1e-9; see
    PORT_CHECKLIST W3.
~~22. **Peak fitting**~~ ✅ shipped & golden — incl. multi-peak
    simultaneous fit + linked widths + tracking + workshop UI; see
    PORT_CHECKLIST W3.

### Tier 2 — Medium Impact
~~23. **Advanced & batch fitting**~~ ✅ shipped & golden — batch/global/
    ODR/diagnostics/bands/MCMC/reflectivity/RSM all in PORT_CHECKLIST W3;
    the "via W0 #7 job queue" framing was superseded (batch runs
    synchronously / client-side — see #7's note).

---

## W4 — Calculators (DiraCulator parity)

### Tier 1 — High Impact
~~24. **Calc framework**~~ ✅ shipped — calculators workshop tabs +
    cross-panel hand-off hooks + headless `calc/registry.py` (89 ops);
    see PORT_CHECKLIST W4.
~~25. **X-ray & neutron**~~ ✅ shipped — d-spacing / Q↔2θ / SLD-from-
    formula / reflectivity builder; see PORT_CHECKLIST W4.
~~26. **Crystal/CIF, optics, superconductor.**~~ ✅ shipped — see
    PORT_CHECKLIST W4. (Two by-design deferrals recorded there: crystal
    *bond angles* need CIF atomic coordinates; the stateful *crystal
    cache* awaits a session-layer need.)

### Tier 2 — Medium Impact
~~27. **Semiconductor, electrical/transport, magnetic, thermal/diffusion.**~~
    ✅ shipped — see PORT_CHECKLIST W4.
~~28. **Vacuum, electrochemistry, periodic table, substrates, favorites,
    history.**~~ ✅ shipped — incl. the History/Favorites/Home meta panels;
    see PORT_CHECKLIST W4.

---

## W5 — DataWorkspace

### Tier 1 — High Impact
~~29. **WorkspaceModel**~~ ✅ shipped — the store is the model; column
    roles live on `Dataset` and round-trip `.dwk`. (By-design residual
    recorded in PORT_CHECKLIST W5: promote more per-dataset view config
    — x-key/styles/limits — only if users ask.)
~~30. **Formula engine**~~ ✅ shipped — `lib/formula` recursive-descent
    evaluator (no eval) + live computed columns; see PORT_CHECKLIST W5.

### Tier 2 — Medium Impact
~~31. **Sort / filter / descriptive stats / masking.**~~ ✅ shipped — see
    PORT_CHECKLIST W5.
~~32. **Workspace file format + autosave.**~~ ✅ shipped — `.dwk` +
    localStorage autosave; see PORT_CHECKLIST W5.

---

## W6 — Plotting & render

### Tier 1 — High Impact
~~34. **Interactive render contract**~~ ✅ shipped — 1-D uPlot + 2-D
    Canvas2D map viewer, axis ticks, Inspector gridding controls, and the
    XRDML 2-D area-detector parser (all three mesh kinds + pole figures)
    all landed; see PORT_CHECKLIST W6. The only remainder is the
    **Rigaku `.raw` 2-D RSM parser — BLOCKED** on a sample file (tracked
    at #10; the old "Remaining: axis ticks / gridding / 2-D parser" note
    here was stale).

### Tier 2 — Medium Impact
~~36. **Plot features**~~ ✅ shipped — insets, polar, multi-panel, AND the
    figure builder all landed (the "remaining" note here had gone stale;
    PORT_CHECKLIST W6 marks every sub-feature ✓, waterfall/overlays/
    ref-lines/annotations were already in Completed).

> Items 33 and 35 shipped — see `## Completed`. Per-feature detail (with
> source mapping + golden status) lives in `PORT_CHECKLIST.md`'s W6 section.

---

## W7 — Frontend shell & UI revamp

### Tier 1 — High Impact
~~37. **App scaffold**~~ ✅ shipped (M1 PR7) — see PORT_CHECKLIST W7.
~~38. **Theme system**~~ ✅ shipped (M1 PR7) — see PORT_CHECKLIST W7.
~~39. **Library panel**~~ ✅ shipped — incl. tags, groups, duplicate,
    reorder, and (later) the PROJECT_ORGANIZATION folder tree; see
    PORT_CHECKLIST W7.
~~40. **Stage**~~ ✅ shipped (M1 PR9 + map viewer) — see PORT_CHECKLIST W7.
~~41. **Inspector**~~ ✅ shipped — all cards; see PORT_CHECKLIST W7.

### Tier 2 — Medium Impact
~~42. **Workshops**~~ ✅ shipped — curve fit / peak / hysteresis /
    reflectivity / RSM / graph digitizer; see PORT_CHECKLIST W7.
~~43. **DataWorkspace UI**~~ ✅ shipped — worksheet + formula bar +
    editable grid (and the 2026-07-09 WORKSHEET_PLAN full-window rebuild
    on top); see PORT_CHECKLIST W7.
~~44. **DiraCulator UI**~~ ✅ shipped — calculators workshop, all tabs;
    see PORT_CHECKLIST W4/W7.

### Tier 3 — Nice-to-Have
~~45. **Macro record/export**~~ ✅ shipped — store macro slice +
    `lib/macro.ts` + Inspector MacroCard (`446cad7`); see PORT_CHECKLIST W7.

---

## W8 — Packaging & distribution

### Tier 2 — Medium Impact
46. **Desktop packaging** — Tauri shell + Python sidecar (the polished
    distribution path; pywebview already covers dev/daily use from W0 #3).
    **STARTED (2026-07-10 audit):** `src-tauri/` is committed and
    populated (Tauri v2 config at v0.6.0, updater plugin, NSIS install
    hooks) — this plan previously understated W8 as untouched. Remaining:
    declare the shell done or list what's missing (sidecar lifecycle,
    menus, signing) — reconcile with the session that built it.
47. **Installers** — Windows / macOS; signing considerations.
    **LARGELY SHIPPED** via ORIGIN_GAP #41 / GAP_ECOSYSTEM #3
    (standalone installers built + attached by the tag-triggered release
    workflow). Open: code signing.
48. **Distribution** — `uv tool install` path / PyPI; versioning.
    **LARGELY SHIPPED** via ORIGIN_GAP #41 (PyPI publish workflow, SPA
    bundled in the wheel, versioned releases — v0.6.0 tagged
    2026-07-10). Open: the OWNER one-time PyPI Trusted Publisher
    registration + first tagged publish, and the fresh-machine
    acceptance run (both tracked at ORIGIN_GAP #41).

### Tier 3 — Nice-to-Have
49. **Auto-update / release workflow.**
    **STARTED:** release workflow exists (RELEASE.md, tagged releases
    through v0.6.0); the Tauri updater endpoint is configured in
    `src-tauri/`. Open: end-to-end auto-update verification once #46
    closes.

---

## W9 — Parity verification & CI

### Tier 1 — High Impact
50. **Golden parity sweep** — freeze MATLAB outputs across parsers / calc /
    fitting; assert in CI. (Write the golden test as each feature lands.)
    **CONTINUOUS by design** — broadly populated; never "closes".
~~51. **`PORT_CHECKLIST.md`**~~ ✅ created with W1 and maintained since —
    it is the live per-feature tracker this plan now defers to.

### Tier 3 — Nice-to-Have
52. **Parameterized parser tests** — every parser × every corpus file.
53. **Performance baselines** — load / render time regression guards.

---

## Resolved decisions

- **Origin integration** → COM "Send to Origin" ported as a **Windows-only
  OS-gated optional** (W1 #14); cross-platform path is **Origin-ASCII +
  `.ogs`** export (W1 #12). COM is untestable in CI → mock-based tests
  only; goldens cover the file path.
- **Long-running jobs** → ~~WebSocket job queue (W0 #7)~~ **closed as
  superseded (2026-07-10)**: every feature it was meant to gate shipped
  without it — template batch runs client-side through the shared step
  executor, `calc/batch_fit`/`global_fit` are pure + synchronous. Reopen
  only if long fits/exports on big corpora actually block the UI.
- **Delivery** → **pywebview desktop now** (W0 #3) + **Tauri packaging
  later** (W8 #46). Reaffirmed 2026-07-10: ship BOTH like fermiviewer —
  pywebview for dev/daily, Tauri for packaged distribution.
- **2D map rendering** → **Canvas2D first** (W6 #34); add WebGL only if
  XRD reciprocal-space maps demand it.
- **`plans/` tracking** → **tracked** (founding doc). Revisit the sibling
  convention (gitignore `plans/`, track `BACKLOG.md`) if it starts to churn.

### Still to decide (later, scoped)
- CI golden-test host: self-hosted MATLAB runner vs committing a broad
  frozen-value set so CI needs no MATLAB. (W0 #5 / W9 #50.)
- Apache-2.0 copyright holder line for LICENSE/NOTICE. (W0 #1.)

---

## Out of scope

- **EM tooling** (Fermi viewer, EELS/EDS, imaging, diffraction) — lives in
  `fermi-viewer` (MATLAB) / `fermiviewer` (Python), mirroring the upstream
  split.
- **Bruker `.brml`/`.raw`** and **AFM `.spm`** — image data (Bruker
  area-detector files; AFM topography images) → belong with the imaging
  tooling in `fermiviewer`, not quantized. (XRDML + Rigaku 2D RSM stay in
  quantized — reciprocal-space maps feed RSM analysis, not microscopy.)
- **Watch-file auto-reload** — deferred (niche live-acquisition feature).
- **In-app bug reporting** — dropped; a GitHub issue template covers it for
  an open-source app.

---

## Completed

> Note: W1–W3 backend parity (parsers, corrections, baselines, processing,
> stats, fitting engine/models/diagnostics, reflectivity) is largely landed and
> golden-verified — see `PORT_CHECKLIST.md` for the authoritative per-item state.
> This log is being backfilled starting with the W6 plotting work.

- ~~**#3 CLI + run model**~~ (2026-07-10) — run-model residue shipped,
  closing the item: default `qz` now arms `QZ_AUTO_SHUTDOWN=1` (app-like
  exit on last-tab-close, refresh-safe; `setdefault` so an explicit `=0`
  wins; `--no-browser` never arms) and opens the browser via an
  `/api/health` poll instead of a fixed timer; new `server_launch.py`
  (fermiviewer `server_launch.py`+`netprobe.py` adapted, 500-line ceiling
  respected) adds `--dev` (Vite HMR + reloading uvicorn, vite terminated
  on exit) and `--desktop` (pywebview via new `desktop` optional-dep
  group, bind-up-front port handling, reuses a healthy sibling instance).
  E2E-verified on live processes: self-exit rc=0, refresh survives grace,
  `--no-browser` persists, no orphans after `--dev` teardown. Serve/
  browser/`--port` half shipped earlier as M1 PR6.
- ~~**#7 WebSocket job-queue infrastructure**~~ (2026-07-10) — closed as
  superseded, owner decision: no queue built, none needed. The batch
  features it was meant to gate all shipped without it (client-side step
  executor per ORIGIN_GAP #3; `calc/batch_fit`/`global_fit` pure +
  synchronous). The 2026-07-10 code audit also corrected the reference:
  fermiviewer `jobs_api` is a polled ThreadPool store, not a WebSocket —
  so if ever reopened, mirror the poll model (~2 small files at package
  root, threading barred from calc/io by the pure-layer guard).

- ~~**#33 Plot state model**~~ (2026-06-25) — axes/limits/scales (lin/log),
  dual-Y, tick formats (Auto/Fixed/Sci), and per-series styling (color/width/
  line/markers) all shipped. `store` (xLim/yLim/xFmt/yFmt/seriesStyles) +
  `calc/plotting.PlotState` + `uplotOpts`. Per-dataset state via the dataset list.
- ~~**#35 Publication export**~~ (2026-06-25) — server-side matplotlib → vector
  PDF/SVG (default) + raster PNG/TIFF at selectable DPI (50–1200); style presets
  (`aps`/`report`/`web`/… from `+styles/template.m` → `calc/figure_styles.py`);
  figure title + axis-label overrides; **WYSIWYG** per-series color/width/line/
  marker carried into the figure (OKLCH→hex via canvas readout). `calc/figure.py`
  + `routes/export.py` + "Export figure…" dialog.
- ~~**#36 Plot features (partial)**~~ (2026-06-25) — waterfall, overlays +
  unified legend (fit/peak/baseline), reference lines, and text annotations
  shipped (uPlot plugins + Inspector cards), plus grid/legend show-hide toggles.
  **Remaining (#36 open):** insets, polar, multi-panel / figure builder.

### Session 2026-06-26 (golden backfill + region pick)

> Backend golden parity is now essentially complete. The remaining backlog is
> either out-of-scope (DiraCulator W4, MCMC/Pawley, Origin COM), blocked on real
> binary sample files (importOxford/Opus/SPC, Rigaku 2D, polarized CSV), or a
> larger frontend feature (a corrections workshop with a BG-from-file dataset
> picker — backend + API are ready). **Pick-up pointer for next session below.**

- ~~**BG-from-file dataset subtraction — golden**~~ (2026-06-26) — `applyCorrections`
  step 4 (`calc/corrections.apply_corrections` `bg_dataset`/`bg_interp`) was
  ported + routed but ungolden; froze `calc_bgfromfile.json` (linear/pchip/spline
  + 0-fill extrapolation, 2-channel) → matches MATLAB ~1e-14. Commit `4f645d7`.
- ~~**RSM Q-space — golden**~~ (2026-06-26) — `calc/qspace.compute_qspace` vs
  `parser.computeQSpace` on a 5×7 omega×2θ grid (N≠M catches an axis swap);
  **bit-exact**. Commit `a18c75a`. (The 2-D `_build_2d`/`map2D` matrix golden vs
  `importXRDML` itself is still open — structure-mismatched scattered-vs-matrix.)
- ~~**Rubber-band region pick (#36-adjacent)**~~ (2026-06-26) — baseline "Fit from
  region" gains a "⬚ Pick range on plot" drag: a `region` `PlotTool` → uPlot
  `setSelect`/`posToVal` → pure `lib/regionSelect.normalizeRange` (tested) →
  `store.regionPicked` → `useBaseline` fills the x-min/x-max box edges. x-only
  (2-D y-box is a future extension). Also fixed a latent RTL `afterEach(cleanup)`
  gap in the test setup. Commit `f531808`. Visual drag unverified (jsdom).

### Session 2026-06-27 (BG-from-file UI — closes #17)

- ~~**#17 BG-from-file picker (frontend UI)**~~ (2026-06-27) — the golden
  reference-background subtraction (`apply_corrections` step 4) was reachable only
  from the API; wired it into the UI. **Design choice (user-confirmed): extend the
  Inspector `CorrectionsCard`, not a separate workshop** — bg-subtraction composes
  into the *same single Apply* as the other params, matching how MATLAB
  `applyCorrections` runs step 4 inline (a separate "subtract → new dataset"
  workshop would have been a divergent second pass). `store.applyCorrections` now
  takes an optional `bg {datasetId, interp}`, forwards the picked dataset's current
  `data` as `bg_dataset`/`bg_interp`, and persists the choice as `Dataset.bgRef`
  (cleared on reset). Card gains a "Background" picker (other loaded datasets) + an
  "Interp" select. Store + card tests added; full frontend gate green (198 tests +
  build). Commit `66e4021`. The fit-BG-from-region half of #17 shipped earlier
  (`f531808`/`7d809a0`), so **#17 is now fully complete**.
- **W5 worksheet — per-column descriptive statistics** (2026-06-27) — the Stage
  `Worksheet` gained a "Σ Stats" toggle: fetches golden `descriptive_stats`
  (`/api/stats/descriptive`) for x + every channel in parallel and renders a
  column-aligned footer (mean/std/min/max/median/N). Computed over the FULL arrays
  (not the 500-row display cap / sort order) and via the backend so the numbers
  match the Inspector `StatsCard` (which only summarized channel 0). Commit
  `e8834aa`; gate green (202 tests). **Advances W5 #209 "descriptive stats"**.
- **W5 worksheet — non-destructive row filter** (2026-06-27) — structured filter
  (column + operator `> ≥ < ≤ = ≠ between` + value(s)) hides non-matching rows; the
  stats footer narrows to the filtered subset and "Extract →" materializes the kept
  rows as a new dataset. Empty value → NaN (no-op; dodges the `Number("")===0`
  trap). Filter-bar JSX extracted to `WorksheetFilterBar.tsx` to hold Worksheet
  under the ~400-line budget (385→323). Commit `b412725`; gate green (207 tests).
  **Advances W5 #209 "filter"** — sort + stats + filter now done; only **masking**
  (Origin click-to-mask individual rows, kept visible but excluded from analysis)
  remains on that bundled line, and is largely subsumed by filtering for most uses.
- **W5 worksheet — row masking** (2026-06-27) — click a row number to mask it: it
  stays visible (greyed/struck) but drops from the analysis set. Stats + Extract
  both consume one derived `analysisRows = filtered − masked`; "Unmask (N)" clears;
  mask keyed by original index, reset per dataset. Extract now writes
  `<name> (subset)`. Commit `61e479e`; gate green (211 tests). **Completes W5 #209**
  (sort / filter / descriptive stats / masking all done — checklist ticked).
- **W4 X-ray/Neutron calculator — d-spacing + Q↔2θ** (2026-06-27) — first W4
  calculator domain surfaced (Boson Plotter being done unblocks W4). New pure
  `calc/xray.py` (Bragg `d↔2θ` order n, `Q↔2θ`, no-eval mode dispatch, arcsin-domain
  guards), thin `/api/xray/calc` (registered in `app.py`), and an "X-ray" tab in the
  calculators workshop (mode select + Cu/Mo/Co/Cr Kα λ presets + live result).
  Reference-value tested (Cu Kα/Si(111) → 2θ≈28.44°, Q≈2.004; `Q=2πn/d` identity;
  round-trips) — **not** MATLAB-golden (universal formulas); theory in the module
  docstring (repo has no `docs/` tree). Commit `ad72c6c`; full gate green (backend
  17 + frontend 214 + ruff/mypy). **Partially addresses checklist #179** —
  SLD-from-formula still TODO (`calc/sld.py` is reflectivity-profile only).
- **W4 Crystal calculator — d-spacing** (2026-06-27) — second W4 domain. New pure
  `calc/crystallography.py` (1/d² quadratic forms for cubic/tetragonal/orthorhombic/
  hexagonal, no-eval dispatch, validation), thin `/api/crystallography/dspacing`
  (registered), "Crystal" tab in the calculators workshop (system select + per-system
  lattice inputs + hkl). Composes with the X-ray tab (lattice→d→2θ). Reference-value
  tested (Si(111)→3.1356, (h00)→a/h identity). Miller `l` needed a narrow ruff E741
  per-file-ignore in `pyproject.toml` (h,k,l is the unavoidable convention). Commit
  `e23d90b`; gates green (backend 26 + frontend 217 + ruff/mypy). **Partial #174**
  (cell volume / density / low-symmetry systems remain). The calculators workshop now
  has Units / X-ray / Crystal / Constants tabs — at ~224 lines, `CalculatorsPanel.tsx`
  is a future extraction candidate (per-tab sub-components) if more tabs land.
- **W4 Periodic-Table/Elements tab + panel decomposition** (2026-06-27, `9ea8cee`) —
  added an "Elements" tab over the golden `element_data` (`/api/reference/elements`):
  search symbol/name/Z + per-element details (mass/category/group/period/config/
  density/electronegativity/melting/boiling/neutron b_coh). Self-contained
  `ElementsTab.tsx` (owns its fetch+search). **Decomposed `CalculatorsPanel.tsx`
  224→39 lines** into per-tab sub-components (Units/X-ray/Crystal/Constants take the
  shared `CalculatorsState`; Elements standalone) — the decomposition flagged last
  session. Gates green (frontend 221 + build). **Ticks checklist #178.**
- **Dataset Math workshop** (2026-06-27, `14006ff`) — diversified off calculators.
  Surfaced the golden-but-unrouted `calc.aggregate.dataset_algebra`: new thin
  `/api/aggregate/algebra` route + a "Dataset Math" workshop (pick A; op A±B / A×B /
  A/B / (A−B)/(A+B) asymmetry; B; interp pchip/linear/spline → new dataset; B is
  resampled onto A's x-grid). Store `datasetMathOpen` flag + App command/mount. Route
  + hook tested; gates green (backend 6 + frontend 226). Annotates the W2 dataset-
  algebra checklist line (calc was already golden; the UI is the new part).
- **Workspace save/load (`.dwk`)** (2026-06-27, `97bd483`) — diversified off
  calculators (W5 #210, partial). Datasets lived only in memory, so a reload lost
  the whole library. New pure `lib/workspace.ts`: `serializeWorkspace`/
  `parseWorkspace` (JSON = format tag + version + datasets; defensive DataStruct
  validation at the untrusted file boundary). Store `loadWorkspace` hard-replaces
  the library and resets per-dataset view state (channels/styles/limits) + drops
  overlays/markers tied to the old datasets. Command-palette "Save/Open workspace
  (.dwk)…" via `saveBlob`/`openFilePicker`. Round-trip + validation unit-tested
  (frontend 238 + build green). Autosave deferred (future session/prefs layer).
- **Two-point plot measurement ruler** (2026-06-27, `d5c3244`) — W6 plotting
  (Boson-Plotter-only scope, user-reaffirmed; calculator alternation dropped).
  New `measure` PlotTool (∡ button): drag A→B over the plot → live Δx/Δy/slope
  readout chip. Pure `lib/measure.ts` `computeMeasurement`/`formatMeasurement`
  (vertical → null slope), unit-tested; `uplotPlugins.measurePlugin` (drag
  handlers mirroring panPlugin + a draw hook) keeps the endpoints in DATA coords
  so the dashed segment stays pinned across zoom/pan. Wired through `uplotOpts`
  (tool + `onMeasure`) and `PlotStage` (button, chip, cleared on tool/dataset
  change). Gates green (frontend 246 + build).
- **X-axis channel picker** (2026-06-27, `ad6b460`) — W5 column roles (X-role
  slice). Surfaced the already-routed `PlotState.x_key`: a "X axis" select in the
  Inspector ChannelsCard lets any value channel be the plot x-axis (M-vs-H, not
  M-vs-time). New `lib/plotdata.effectiveChannels` (y selection minus the x
  channel — single source of truth) drives both `PlotStage` and `MultiPanelStage`;
  store `xKey` resets with the dataset (addDataset/setActive/loadWorkspace);
  `buildColumns`/`fetchPlot` extended for the offline path. Backend already honored
  x_key — added `/api/plot/series` x_key route tests. Gates green (frontend 253 +
  build; backend plot 13 + ruff).
- **Error-bar role** (2026-06-27, `7da9a21`) — W5 column roles (Y-error slice).
  Per-row "± <channel>" picker in ChannelsCard pairs a plotted y-channel with the
  channel holding its uncertainty → vertical y±e whiskers. Frontend-only (the
  error is just a column of the same dataset, read client-side): pure
  `lib/errorbars.buildErrorColumns` (magnitudes keyed by uPlot data column) +
  `uplotPlugins.errorBarsPlugin` (draw hook, per-series y scale, clipped; reads
  the displayed y so waterfall offsets cancel). Store `errKeys` map resets with the
  dataset. Gates green (frontend 259 + build).
- **Copy plotted data to clipboard (TSV)** (2026-06-27, `c3780c0`) — W6 plotting.
  ⧉ tool-dock button serializes the display payload (x + plotted series, honoring
  x-channel / waterfall / overlays) to TSV and writes the clipboard for paste into
  Origin / Excel / a notebook. Pure `lib/clipboard.payloadToTSV` (header + rows,
  null → empty) unit-tested; capability-guarded `copyText` (false on insecure
  context / denial → "clipboard unavailable" status). Gates green (frontend 264 +
  build).
- **Interactive legend** (2026-06-27, `8ac41f3`) — W6 plotting. Click a legend
  entry on the plot to show/hide that series. Hidden series stays in the payload
  (uPlot `show:false`) so its color is stable and the legend entry remains (greyed
  + struck-through) to toggle back; hidden series drop out of autoscale. Store
  `hiddenChannels[]` + `toggleHidden` (reset with the dataset); `uplotOpts.hidden`
  arg; PlotStage maps legend index → plotted channel (overlays not clickable),
  refuses to hide the last visible series. Gates green (frontend 266 + build).
- **Duplicate dataset (Library)** (2026-06-27, `adc7ec4`) — W5/W7, diversified off
  the plot. ⧉ button on each Library row deep-copies a dataset (incl. raw /
  corrections / bgRef) as an independent "(copy)" inserted after the source and
  activated — for trying different corrections / formulas / dataset-math while
  keeping the original. Pure `lib/dataset.cloneDataStruct` (deep copy, no shared
  column arrays — non-aliasing asserted in tests); store `duplicateDataset(id)`.
  Gates green (frontend 272 + build).
- **Inspector Metadata card** (2026-06-27, `4b4108f`) — W7, Inspector surface. The
  parser-captured `.metadata` (sample / temperature / header fields) was held on
  every DataStruct but shown nowhere; new read-only card lists the key/values +
  copy-as-TSV. Pure `lib/metadata.ts` (`formatMetaValue` / `metadataRows` [sorted,
  hides internal `x_column_*` plot-wiring keys] / `metadataToTSV`) unit-tested;
  `Inspector/MetadataCard.tsx` (hidden when empty). Gates green (frontend 279 +
  build).
- **Worksheet "Copy rows" → clipboard TSV** (2026-06-27, `1ad6152`) — W5, worksheet
  surface. ⧉ Copy button copies the visible rows (filtered + sorted, masked
  excluded) as TSV — the full table (every channel) at full numeric precision —
  complementing "Extract →" (makes a dataset) and the plot's copy-data (plotted
  series only). Pure `lib/clipboard.tableToTSV` (row-oriented header+rows, null →
  empty) unit-tested; `copyRows` uses raw values (not the rounded display) so the
  export keeps full precision. Gates green (frontend 283 + build).
- **Library reorder (▲▼)** (2026-06-27, `3eb8586`) — W7, Library surface. Up/down
  buttons on each row reorder the dataset list (drives list + consolidated-export
  column order); active selection unaffected. Store `moveDataset(id, dir)` swaps a
  dataset with its neighbor (no-op at ends/unknown), unit-tested; buttons disabled
  at the ends and hidden while a search filter is active (reorder is a full-list
  op — swapping with a hidden neighbor would be confusing). Gates green (frontend
  286 + build). Committed staging explicit paths only (parallel W8 session).
- **Five-feature batch** (2026-06-27) — user "do all of those": shipped all the
  next-pickup plot/worksheet/inspector candidates in one sitting, each its own
  branch+commit+merge, gates green per feature (frontend 290→295→301→305→310 + build):
  - **Multi-series cursor readout** (`be38edf`, W6) — the cursor chip lists *every*
    visible series' y at the shared nearest-x index (was first series only); skips
    hidden + null gaps. Added the previously-untested `readoutPlugin` to the suite.
  - **Legend entry rename** (`00cab7d`, W6) — double-click a floating-legend entry
    to rename a series; the override flows into the uPlot series label → legend,
    cursor readout, solo-axis label all show it. Blank reverts. Store `seriesLabels`
    (channel-keyed, reset per dataset); legend extracted to `Stage/PlotLegend.tsx`
    (PlotStage 357→334).
  - **Draggable reference lines** (`400e0b9`, W6) — grab a ref line on the plot
    (zoom/cursor tool) and drag it; resize cursor near a line. Live value held
    plugin-locally + `u.redraw()` (no React rebuild per move), committed once on
    release via store `updateRefLine`. Pure `pickRefLine` hit-test, tested. Disabled
    in pan/measure/region (they own the drag gesture).
  - **Label/ignore column roles** (`de2a3db`, W5) — per-channel role (Data/Label/
    Ignore) in the Channels card. A roled channel is excluded from the plot
    (`effectiveChannels` filters label+ignore); `ignore` also drops from worksheet
    Σ Stats (label stays — a tabulated descriptor). Worksheet header tags roled
    columns. Guard keeps ≥1 plottable data channel. Store `channelRoles` (reset per
    dataset). `types.ChannelRole`.
  - **Per-dataset notes card** (`12cc961`, W7) — free-text notes about the active
    dataset in a new Inspector card; local draft committed on blur (no per-keystroke
    plot refetch); lives on the `Dataset` so it round-trips through `.dwk` and is
    carried by duplicate. Store `setDatasetNotes`.
- **Legend series reorder (▲▼)** (2026-06-27, `34b58ae`) — W6, plot surface. Per-entry
  up/down buttons in the floating legend reorder the plotted-series draw order (▲ under,
  ▼ over); applies to the overlaid plot + multi-panel. Store `seriesOrder` (a permutation
  of the plotted channels, reset per dataset); `effectiveChannels` reorders by it — stale
  entries ignored, newly-plotted channels append in natural order; the style/label/error/
  hidden mappings (all keyed by `plotted[i]`) follow for free. Gates green (frontend 315 +
  build).

### Session 2026-06-30 (W3 fitting workstream closed)

- ~~**#23 MCMC sampling + Pawley refinement**~~ (2026-06-30) — the last two open
  W3 fitting items. **MCMC** (`fitting.mcmcSample` → `calc/mcmc.py`): single-chain
  random-walk Metropolis (Gaussian proposal, burn-in/thin, FFT-autocorrelation ESS);
  RNG-based → invariant-tested (mean recovery, accept-rate band, seeded
  reproducibility), mirroring the MATLAB scaffold's own test design. **Pawley**
  (`fitting.pawleyRefine` → `calc/pawley.py`): adaptive grid-search cell refinement +
  per-trial pseudo-Voigt/linear-bg least-squares + Rwp; invariant-tested (perturbed Si
  cell recovers <0.02 Å). Its dependency **`plane_spacings`** (`calc.crystal.planeSpacings`
  → `calc/crystallography.plane_spacings`: hkl enumeration + centering absences + system
  inference) was ported and **golden-verified** vs MATLAB (`calc_planespacings.json`,
  4 cells — hkl/multiplicity exact, d/2θ ~1e-12; `psFreeze`). Gate green (ruff + mypy +
  967 pytest). **W3 fitting is now fully ported** (only cross-panel/headless follow-ups
  remain in W4).
- ~~**#24 Calculator cross-panel hooks**~~ (2026-06-30) — "send to" affordances between
  the shared-state calculator tabs. **Crystal d → X-ray** (`sendDToXray`, d→2θ→Q),
  **SLD formula → Crystal** cell-volume/density (`sendFormulaToCrystal`, molar-mass→cell-vol),
  **Crystal formula+density → SLD** (`sendCellToSld`) — all pure in `useCalculators`.
  **SLD → Reflectivity** crosses ToolWindows via a one-shot store bridge
  (`useApp.reflectivitySeed` + `seedReflectivityLayer`); `useReflectivity` consumes it
  as a manual-SLD layer above the substrate. Frontend-only; gate green (602 tests + build).
  Advances #24's "cross-panel data hand-off contract".
- ~~**#24 Headless calculator API**~~ (2026-06-30) — the scripting analogue of MATLAB
  `api = DiraCulator()`. `calc/registry.py` (pure): a curated name→pure-function catalog
  (89 ops / 16 domains) with `list_calculators`/`describe_calculator`/`call_calculator`;
  thin `routes/calc.py` (`/api/calc/catalog|describe|call`, numpy-safe). Tests +
  gate green (985 pytest). **Closes W4 #24** (calc framework: pure fns + registry +
  cross-panel hand-off + headless API all done); only the calculator meta-panel
  cross-panel *frontend* niceties remain optional.

**Next pick-up (highest value first):**
1. **Boson Plotter features ONLY** — user reaffirmed 2026-06-27 ("I only want to
   focus on bosonplotter features for now"); the calculator/non-calculator
   alternation is **dropped — no W4/DiraCulator/SLD-from-formula work**. Pick from
   plotting + W5 DataWorkspace: **plot interactions** (measurement ruler `d5c3244`,
   copy-data `c3780c0`, interactive legend `8ac41f3`, **multi-series cursor readout
   `be38edf`, legend rename `00cab7d`, draggable ref lines `400e0b9`, legend reorder
   `34b58ae` shipped**; remaining — crosshair/marquee stats), **W5 column roles**
   (X-role `ad6b460`, Y-error bars `7da9a21`, **label/ignore roles `de2a3db` shipped**
   — roles complete), the **computed-column formula engine** (snapshot model done —
   `Stage/Worksheet.tsx`; "recompute on source change" needs provenance links the
   architecture lacks → low priority), **Library** features (duplicate `adc7ec4` +
   reorder `3eb8586` done; remaining — groups/tags), **Inspector** (metadata card
   `4b4108f`, **notes card `12cc961` shipped**), or **workspace autosave**.
   Non-Boson-Plotter parity items (XRDML `map2D` golden, blocked parsers) stay paused
   unless the user reopens scope.
2. **Optional bounded extras** — 2-D y-box for the region pick; XRDML `map2D`
   golden vs `importXRDML` (needs a reshape across scattered↔matrix shapes).
3. **Blocked until sample files land** — `importOxford` (no spec exists at
   all; `importOpus`/`importSPC` ported 2026-07-08 without MATLAB source —
   see item 15), Rigaku `.raw` 2-D RSM, polarized-asymmetry consolidated CSV.
4. **Standing verification gap (partly closed 2026-06-30)** — the **2-D map
   Canvas2D render is now pixel-verified**: `mapRender.buildHeatmapImage` (extracted
   pure — colormap mapping, NaN→transparent gaps, vertical flip, log floor) has
   exact-RGBA tests, and a **real-raster `draw()` test** runs the full pipeline
   against an actual canvas (node-canvas backing jsdom) asserting a data-filled grid
   paints the interior while an all-null grid stays transparent. `canvas` is an
   **optional** dev dep + the raster test skips where it's absent, so CI stays green
   without the native lib. **Still open:** the *uPlot interactive* surfaces
   (1-D plot plugins/overlays, multi-panel, inset, polar, drag interactions) draw via
   uPlot's own layout, which needs a real browser (Playwright) to verify — node-canvas
   alone can't (jsdom has no layout so uPlot sizes to 0). That's the remaining
   browser-automation task.
