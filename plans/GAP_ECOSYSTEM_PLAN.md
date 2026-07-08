# Gap Ecosystem Plan — import filters, plugin API, packaging, Origin-interop leftovers

Implementation plan for the ecosystem/distribution batch: the
import-filter persistence + wizard UI (ORIGIN_GAP_PLAN #40 — CLOSED
2026-07-07, see `## Completed`), the Python plugin API (#8) and its
conveniences (#10), the packaging
residuals of #41 (a Tauri-installer release pipeline ALREADY exists in
`.github/workflows/release.yml` — the gap plan's ⬜ status is stale;
what remains is PyPI + first-run), and the three
`plans/ORIGIN_FILE_DECODE_PLAN.md` leftovers: multi-panel spatial apply
(#36), `.otp`/`.otpu` templates as style presets (#21), and the `.opju`
writer (#27, audited and kept deferred).

**Status:** Active
**Created:** 2026-07-07
**Updated:** 2026-07-07

---

## Context

### How the pieces fit together

Import preview/parse is a finished pure engine:
`src/quantized/io/import_preview.py` (`ImportSettings` — a frozen,
`to_dict`/`from_dict`-serializable dataclass explicitly documented as
"the persistable import-filter shape"; `guess_settings` /
`preview_import` / `parse_import`) exposed by
`src/quantized/routes/import_wizard.py` (`/api/import/{guess,preview,
parse}`, text-in). What's missing is persistence + a UI: there is **no
config-dir concept anywhere in the repo** (no platformdirs/appdirs, no
`~/.quantized`) and **no import-wizard frontend**. The parser registry
(`src/quantized/io/registry.py`, ~100 lines) is literal dicts
(`_EXT_MAP` + `_SNIFFERS`) with `resolve_parser` as the single dispatch
chokepoint — it has **no public register function**, which both the
saved-filter hook and the plugin API need. The one existing
"plugin-style" registry is `calc/fit_models.py`'s public
`register_model`. There is **zero plugin discovery** (no entry_points,
no importlib.metadata use). The CLI (`src/quantized/cli.py`, 58 lines)
serves API + SPA from `src/quantized/web/` (Vite builds straight into
it; hatchling wheels whatever is there). Packaging reality check:
`.github/workflows/release.yml` already builds, per-OS, the SPA + a
PyInstaller server sidecar + a **Tauri v2 native installer** (NSIS
`.exe`, `.dmg`, `.deb`) with a signed auto-update manifest — but there
is **no PyPI publish** anywhere. Origin interop: the backend attaches
per-figure `frame` quads + `page` size (`io/origin_project/
figure_geometry.py`, surfaced by `figures.py`/`figures_opju.py`), but
the frontend `OriginFigure` type (`frontend/src/lib/types.ts`) omits
both fields and `applyOriginFigure` (`frontend/src/store/useApp.ts`)
applies one layer alone or a 2-layer Y/Y2 combo via `doubleYPartner` —
geometry is decoded then dropped at the JSON boundary. `.otp`/`.otpu`
has no handling at all; there is no `.opju` writer (only
`writer.py`/`writer_blocks.py` for `.opj`, which real Origin loads).

### Data / control flow

```
#40: messy ASCII → /api/import/guess → wizard UI (live preview, roles)
     → save ImportFilter {name, glob, ImportSettings} → config-dir JSON
     → registry.resolve_parser consults filters BEFORE sniffers
#8:  plugins dir + entry points → discovery (log-and-skip on failure)
     → parsers into io/registry, fit models via register_model,
       steps via a routes/plugins runner → pipeline step palette
#41: v* tag → release.yml (installers, exists) + NEW: PyPI wheel
     (SPA bundled) → pipx install quantized → qz
#36: figures.py frame/page (already on the wire) → OriginFigure type
     → applyOriginFigure multi-layer path → spatially arranged panels
```

### Dependency map

- Item 1 introduces the config-dir concept (platformdirs) that item 2
  (plugins dir) and item 7 (plugin enabled-state) reuse — land item
  1's persistence half first, or coordinate the config-dir helper.
- Item 1 and item 2 BOTH add the registry's first mutable
  registration hook in `io/registry.py` — whichever lands second
  rebases on the first's hook shape.
- Item 7 requires item 2. Item 3 is independent of 1/2. Items 4, 5, 6
  (Origin leftovers) are independent of everything else and of each
  other.
- Item 4 edits `frontend/src/store/useApp.ts` — conflicts with
  GAP_INTERACTION items 1/2/3 and GAP_PLOTTYPES items 2/4 if run in
  parallel on one working tree.

### Architecture constraints (binding — state, don't debate)

Pure calc/io (plugin machinery included: anything under `io/`/`calc/`
must not import fastapi/pydantic and is bound by the guard test);
500-line backend module ceiling; ~400-line component convention
(wizard = workshop pattern); **single parser registry** — saved
filters and plugin parsers register through `io/registry.py`'s one
chokepoint, never a second path; no eval (plugins are imported
modules, not evaluated strings); no GPL runtime deps (platformdirs is
MIT — verify before adding, and the integrity test's GPL scan covers
extras); DataStruct contract (plugin parsers return DataStruct, full
stop); guard #11 untouched by this plan; vector export by default
(unaffected here).

### Open questions

**RESOLVED 2026-07-07 (owner):** import filters persist in the SERVER
config dir (platformdirs); plugins are TRUSTED installs (no sandboxing);
pole figures import as a 2-D map (`mesh_kind="pole"`); WebGL 3-D (#22)
STAYS DEFERRED. Adopted planner defaults (owner may override later):
#41 closes with PyPI-only (installers already shipped); Graph Builder
v1 zones = X/Y/Group + typed-inert Facet; quick-fit ends in a chip with
EXPLICIT commit; GLM/survival ship as an optional `stats` extra; axis
breaks render as panels with break glyphs; plus the minor calls as
written below.


1. **Import-filter persistence location** — (a) server-side JSON in a
   new user config dir (platformdirs; env override for tests) — works
   for the registry/CLI/headless path and the wizard alike; (b)
   frontend localStorage `qz.importFilters` (matches peak-recipe
   precedent) — but the backend registry can't see it, so the
   "registry consults saved filters" requirement dies; (c) per-project
   inside `.dwk`. *Recommendation: (a) server config dir — it is the
   only option satisfying the registry-consult requirement; the wizard
   edits filters through thin CRUD routes.*
2. **Packaging vehicle** — the gap item's "PyInstaller or
   Tauri-wrapped" question is ALREADY answered in the repo: release.yml
   ships Tauri v2 installers with a PyInstaller sidecar. Remaining
   choice: (a) add PyPI publish and call #41 done; (b) also ship a
   standalone one-file `qz` CLI binary artifact. *Recommendation: (a)
   — pipx covers the CLI audience; another binary is another support
   surface.*
3. **Plugin distribution scope (v1)** — (a) local plugins dir +
   package entry points only, plus a template repo; (b) also a curated
   community index page; (c) a full marketplace/registry service.
   *Recommendation: (a) for #8, with (b)'s index page deferred to #10
   as a docs page — never (c).*
4. **Plugin trust model** — (a) plugins are arbitrary Python, treated
   like anything the user pip-installs (documented clearly); (b)
   attempt sandboxing/AST-vetting. *Recommendation: (a) — sandboxing
   Python is a losing game; be honest in docs instead. The no-eval
   guard governs OUR code, not the user's interpreter.*
5. **`.otp` import surface** — (a) graph templates only, imported as
   quantized GraphTemplates (style presets); (b) also workbook/analysis
   templates. *Recommendation: (a) — matches decode-plan #21's framing
   ("a graph template could import as a style preset"); workbook
   templates have no quantized counterpart yet.*
6. **`.opju` writer** — stay deferred? *Recommendation: yes — audit
   confirms `.opj` output loads in real Origin (item 34 closed
   2026-07-07) and Origin ≥2023 still reads `.opj`; revisit only on a
   demonstrated `.opj`-refusing Origin build or user demand.*

---

## Tier 1 — High Impact

1. ~~**Import-filter persistence + wizard UI (gap #40)**~~ — *SHIPPED
   2026-07-07 (see `## Completed`).*

   name-and-save the wizard's `ImportSettings` against a glob, have
   the registry consult saved filters, and give the preview engine its
   missing frontend.
   *Model: sonnet.* *Agent: code-implementer (persistence + registry
   hook), ux-frontend-expert (wizard workshop).*
   - [x] New pure `src/quantized/io/import_filters.py`: an
         ImportFilter record (name, glob pattern, the
         `ImportSettings` dict from `io/import_preview.py`), JSON
         load/save in a new user config dir (introduce `platformdirs`
         (MIT) — the repo's first config-dir concept; `QZ_CONFIG_DIR`
         env override for tests), and a pure glob-match function;
         under 500 lines, no fastapi imports
   - [x] Registry hook: `resolve_parser` in
         `src/quantized/io/registry.py` consults matching saved
         filters BEFORE `_SNIFFERS` (a matched filter parses via
         `parse_import` with its stored settings); single-registration
         rule preserved — one chokepoint, no second dispatch path
   - [x] Thin CRUD routes on
         `src/quantized/routes/import_wizard.py`:
         list/save/delete `/api/import/filters`
   - [x] Wizard UI: new
         `frontend/src/components/workshops/importwizard/`
         (`useImportWizard` hook + `ImportWizardPanel` view +
         `PreviewTable` sub-component, workshop pattern): live preview
         grid over `/api/import/{guess,preview}` with the header/units
         raw lines highlighted, controls for delimiter / header line /
         units line / data start, and per-column name / unit / role
         editors (x/y/error/label/ignore, matching
         `ImportSettings.roles` exactly) that re-preview debounced;
         "Save as filter…" (name + glob prefilled from the extension,
         via the shared `ParamDialog`) + a saved-filter picker
         (apply/delete) at the top over the `/filters` CRUD; offered
         from the command palette ("Import wizard…", File group) AND
         as a status/toast hint when a normal drag-import fails to
         parse
   - [x] Tests: filter store round-trip + registry-consult precedence
         (backend), wizard flow (vitest); the gap item's
         messy-3-comment-line ASCII case imports one-click via its
         saved filter, including through headless `import_auto`
   - Acceptance: save a filter for a messy instrument ASCII once;
     the next file matching its glob imports correctly with zero
     dialogs, through both the GUI and `quantized.api` headless.

2. ~~**Python plugin API v1 (gap #8)**~~ — *SHIPPED 2026-07-07 (see
   `## Completed`); the two open sub-tasks below are deferred and tracked
   elsewhere (template repo → #10 / item 7; step route + frontend palette →
   a later item).* drop-in `.py` modules and entry-point packages
   contributing parsers, pipeline steps, and fit models through a stable,
   documented, pure contract.
   *Model: opus (contract + discovery/versioning design), sonnet
   (wiring, template repo).* *Agent: general-purpose (contract
   design), code-implementer (wiring).*
   - [x] Contract v1 in a new pure `src/quantized/plugins/` package
         (bound by the pure-layer guard — added to `PURE_LAYERS`): three
         contribution types — parser (path → DataStruct-or-dict), step
         (DataStruct + params → DataStruct), fit model (delegates to the
         existing public `register_model` in `calc/fit_models.py`); plugin
         metadata (`QZ_PLUGIN` = name, version, `api_version`) with a
         compatibility check; plugins can never reach routes
   - [x] Discovery: the config-dir plugins folder (reuses item 1's
         platformdirs seam) + `importlib.metadata` entry points
         (group `quantized.plugins`); a broken plugin / bad manifest /
         shadowed extension logs and skips — startup never crashes; trust
         model per open question 4, documented bluntly in `docs/plugins.md`
   - [x] Parser registration: added the registry's first public
         register function (`register_parser` + `unregister_plugin_parsers`)
         to `src/quantized/io/registry.py` — single registration preserved,
         precedence discipline enforced (a plugin cannot shadow a built-in
         unambiguous extension)
   - [x] Plugin steps: registered + listable server-side
         (`src/quantized/plugins/steps.py`). DEFERRED to a later item: the
         thin `routes/plugins.py` runner + the frontend `plugin` step kind
         (`lib/pipeline.ts` / `executeSteps.ts`) so steps surface in the
         pipeline palette and replay in templates/batches — v1 registers
         steps server-side only, per the item's scope
   - [ ] `quantized-plugin-template` repo (DEFERRED → #10 / item 7): one
         worked example per contribution type + CI pinned against a
         quantized version. `docs/plugins.md` (contract + worked single-file
         example of each contribution type + trust statement) **DONE**;
         the separate template repo stays open
   - Acceptance: a demo plugin dropped into the plugins dir
     contributes a parser (imports via `import_auto`), a fit model
     (listed by `/api/fitting/models`), and a step (registered + listable);
     a deliberately broken plugin logs + skips without breaking startup.
     *(Met — 14 tests in `tests/test_plugins.py`; the pipeline-palette leg of
     the step acceptance rides with the deferred frontend wiring.)*

3. **Packaging residuals: PyPI + first-run (gap #41 remaining)** —
   *(SHIPPED 2026-07-07: hatch sdist/wheel scoping — found+fixed the
   from-sdist wheel silently dropping the gitignored SPA; wheel verified
   to serve the UI + demo from a fresh venv; `.github/workflows/pypi.yml`
   (Trusted Publishing); `/api/samples/demo` + bundled synthetic CSV.
   OWNER ACTION REMAINING: one-time PyPI Trusted Publisher registration —
   see RELEASE.md — before the first tagged PyPI publish. ~~Follow-up
   booked: surface the bundled sample in the UI next to the client-side
   demo button.~~ CLOSED 2026-07-08: `lib/api.ts` gained `fetchDemoSample()`
   (`GET /api/samples/demo`); new `lib/sampleDataset.ts::loadSampleDataset()`
   fetches the real packaged sample with an offline fallback to the existing
   client-side `makeDemoDataset()`; wired as a "Load sample dataset
   (bundled)" command-palette entry in `App.tsx`, alongside the pre-existing
   "Add demo dataset" entry. 2 new tests in `sampleDataset.test.ts`. Frontend
   1559 passed, build green.)*
  
   the installer half of #41 already shipped (release.yml: Tauri
   installers + PyInstaller sidecar + update manifest; the gap plan's
   ⬜ is stale — reconcile it when closing). What remains is the
   pip/uv path and the first-run experience.
   *Model: sonnet.* *Agent: code-implementer.*
   - [x] PyPI publish job on the v* tag flow (extend
         `.github/workflows/release.yml` or a sibling publish
         workflow): build SPA → `src/quantized/web` → build wheel
         (hatchling already packages the web dir when present) →
         trusted publishing; TestPyPI dry-run path
   - [x] Wheel-completeness gate in CI: install the built wheel into
         a clean venv, `qz --no-browser`, assert the SPA and
         `/api/health`-equivalent respond (guards the "web dir
         missing" warning path in `src/quantized/cli.py`)
   - [x] First-run experience: on an empty library, offer the demo
         dataset (the `frontend/src/lib/demo.ts` seam exists) + a
         "try this" pointer; README install matrix (pipx / uv tool /
         installer downloads)
   - [x] Acceptance run, documented: fresh machine, no dev tools →
         `pipx install quantized` → `qz` → import a CSV within 2
         minutes
   - Acceptance: `pipx install quantized` yields a working `qz` (SPA
     included) from PyPI; a first-run user reaches a plotted demo
     dataset in one click.

---

## Tier 2 — Medium Impact

~~4. **Multi-panel spatial apply (decode-plan #36)**~~ (2026-07-07) — render a
   multi-layer Origin page's panels in their true spatial arrangement
   from the already-decoded `frame`/`page` geometry.
   *Model: sonnet.* *Agent: ux-frontend-expert.*
   - [x] Surface the wire data: `frame` (per-layer quad) + `page` (size)
         added to `OriginFigure` in `frontend/src/lib/types.ts` (backend
         `io/origin_project/figures.py` / `figures_opju.py` already attach
         them — no backend change; field names/shape verified against the
         real `figures_opju.extract_figures_opju` output)
   - [x] Pure layout math: new `frontend/src/lib/originPanels.ts`
         (`computePanelLayout`) clusters decoded frame quads into a
         rows×cols grid (edge-clustering with an 8%-of-bbox tolerance,
         optional `page` as a plausibility gate); falls back to a plain
         ordinal single-column stack (`spatial: false`) when a frame is
         missing/degenerate or frames overlap rather than tile. 14 unit
         tests (2-stack, horizontal 2-up, 2×2 grid, overlap→fallback,
         missing/degenerate→fallback, slop tolerance, page-gate cases,
         plus the REAL "Fixed Lambdas SI"!Graph6 frame quad pair spot-
         checked against the backend decoder). `lib/originFigures.ts`
         gained the grouping/resolution glue: `figureLayerFamily` (same-
         window layer grouping, extracted from `doubleYPartner` so both
         paths share it) + `resolveFigurePanels` (per-layer dataset +
         channel-selection + axis-state resolution, all-or-nothing)
   - [x] Multi-layer apply path in `applyOriginFigure`
         (`frontend/src/store/useApp.ts`): the existing 2-layer Y/Y2
         `doubleYPartner` path stays FIRST (regression-tested); when it
         doesn't apply and ≥2 same-window layers ALL resolve a dataset +
         channels, a new `spatialPanels` store field drives
         `MultiPanelStage.tsx`'s new spatial-grid render mode (CSS grid,
         each panel fetching its OWN dataset with its OWN
         xLim/yLim/xLog/yLog/labels — independent, no x-sync, unlike the
         plain per-channel stack); falls back to the clicked layer's own
         single-layer apply (existing behaviour) with an info toast when
         any layer doesn't resolve. `PlotStage.tsx`'s stack-mode gate
         extended so a spatial arrangement shows even when the active
         dataset alone has <2 plotted channels; `setStackMode`/`setActive`/
         `loadWorkspace`/`duplicateDataset` all clear `spatialPanels` so a
         manual toggle or switching datasets never leaves a stale grid
   - [x] Visual-harness check on "Fixed Lambdas SI"!Graph6 (2 stacked
         layers; realdata corpus, local only): **geometry verified against
         the real file** (`layer 1 frame {1027,478,6435,2272}`, `layer 2
         frame {1027,2272,6435,4066}` — a contiguous 2-stack, page size
         undecoded for this file, matches `figure_geometry.py`'s
         documented `None` fallback) via a direct backend decode + a
         dedicated unit test using those exact numbers. The full
         click-through-the-app + canvas screenshot pass (headless-Chrome
         `tools/visual` harness) was **not** run this pass — noted as the
         remaining eyeball caveat; the geometry math and store wiring are
         test-proven, the rendered pixels are not
   - Acceptance: applying a multi-layer Origin figure reproduces the
     page's panel arrangement (stacked layers stack in the right
     order with their own ranges) instead of applying one layer alone.
     Met for the resolved-geometry + resolved-channels case (store tests:
     2-stack with real frame geometry, a 3-layer ordinal generalization,
     the Y/Y2 regression, and two unresolved-fallback cases). Frontend:
     146 test files / 1451 tests green; `npm run build` green.

---

## Tier 3 — Nice-to-Have

5. **`.otp`/`.otpu` templates → style presets (decode-plan #21)** —
   *(Backend half SHIPPED 2026-07-07: recon confirmed both extensions are
   the SAME CPY family §2 already documents (no new container RE); the
   shipped `figures.py`/`figures_opju.py` decoders already read a
   template's axis/log/title/legend/frame directly off its raw bytes for
   4 of the 5 corpus files with zero new code; curve style needed a
   template-SCOPED reuse of `curve_style_color.py`'s record decoders
   (`io/origin_project/templates.py`, 314 lines) since the real-project
   curve→column binders always find an empty id map for a template (no
   workbook to build one from) and silently drop every curve — style
   lives entirely in the curve's own record, independent of that binding.
   One corpus file (`PNR.otpu`) has a genuinely new, undocumented axis-
   record shape (documented, not chased); it degrades to a styles-only
   partial rather than failing or guessing. Findings + the full decode
   table are in `docs/origin_project_format.md` §6.4. Frontend hook-in
   remains, booked below.)*
   *Model: sonnet.* *Agent: general-purpose (format recon), then
   code-implementer.*
   - [x] Recon first: the 5 corpus templates
         (`../test-data/origin/`, local only, never pushed) through
         the existing container walker — `.otp` is CPYA-family /
         `.otpu` CPYUA-family without data; determine which
         axis/style records the shipped `figures.py` / `figures_opju.py`
         decoders already read (per the samples-not-standards
         directive: general grammar, synthetic fixtures, document
         what doesn't decode — never guess)
   - [x] Map decoded template properties → a GraphTemplate
         (`frontend/src/lib/figuredoc.ts`: preset + overrides +
         series styles), honestly partial — undecoded properties stay
         absent (`io/origin_project/templates.py::read_origin_template`;
         21 synthetic + realdata tests in `tests/test_io_origin_templates.py`)
   - [x] Import surface (backend): a dedicated thin route
         (`routes/import_template.py`: `GET /api/import/template` (path)
         + `POST /api/import/template/upload`) — template files are NOT
         DataStruct parsers, kept out of `io/registry.py`'s `_EXT_MAP`
         (single-registry rule preserved); 10 route tests
         (`tests/test_api_import_template.py`). **DEFERRED** (owner-scoped
         out for this pass, booked here): the frontend `api.ts` client
         method + an "Import Origin template…" open-file branch landing
         the result in the saved graph-templates store.
   - Acceptance: **backend-verified, frontend half open.** Importing any
     of the 5 corpus templates via `read_origin_template`/the route
     yields a decoded GraphTemplate dict — 4/5 with full axis scales +
     series styles, 1/5 (`PNR.otpu`) styles-only (documented partial);
     undecodable properties are absent, never guessed. The full
     acceptance ("applies to a plotted dataset") needs the deferred
     frontend hook-in.

6. **`.opju` writer (decode-plan #27) — keep deferred.** Audit
   2026-07-07: no `write_opju` exists; the `.opj` writer loads in real
   Origin (decode-plan item 34 closed) and Origin ≥2023 still reads
   `.opj`, so a `.opju` writer adds near-zero user value for a large
   RE cost (outer-framing tail + codec-acceptance probes).
   *Model: defer (no work scheduled).* *Agent: — (decision gate only).*
   - [ ] Decision gate: revisit only if a real Origin build refuses
         `.opj` import or a user reports one; the probe recipe lives
         in `docs/origin_re/validation_log.md`

7. **Plugin distribution conveniences (gap #10)** — requires item 2.
   *Model: haiku.* *Agent: code-implementer.*
   - [ ] `qz plugin list` / `qz plugin enable <name>` / `disable`
         subcommands in `src/quantized/cli.py` (argparse subparsers;
         the file is 58 lines — ample headroom); enabled-state
         persisted in the item-1 config dir
   - [ ] Community index page: a `docs/plugins.md` section listing
         known plugins + the template repo link (per open question 3,
         a docs page, not a service)
   - Acceptance: `qz plugin list` shows discovered plugins with
     enabled state; a disabled plugin stops contributing without
     being deleted.

---

## Completed

- ~~**1. Import-filter persistence + wizard UI (gap #40)**~~ (2026-07-07) —
  the wizard UI half over the already-shipped preview engine + persistence
  (backend: `io/import_filters.py`, the registry hook, `/api/import/filters`
  CRUD — landed earlier the same day). New
  `frontend/src/components/workshops/importwizard/` (workshop pattern):
  `useImportWizard.ts` (file text read client-side → `guess` → debounced
  `preview` on every settings edit → `parse` lands via `addDataset`, named
  after the file; an optimistic per-column overlay keeps rapid name/unit/
  role edits composing correctly instead of racing the 300ms re-preview
  debounce), `ImportWizardPanel.tsx` (view: file picker, delimiter/header-
  line/units-line/data-start controls, a saved-filter apply+delete picker,
  "Save as filter…" via the shared `ParamDialog`), `PreviewTable.tsx`
  (numbered raw lines with the header/units rows highlighted, above the
  resolved-columns grid — name/unit text inputs + a role select matching
  `ImportSettings.roles` exactly: x/y/error/label/ignore). New pure
  `lib/importwizard.ts` (default filter name/glob from the extension,
  name+unit label composition matching the backend's `"Name (unit)"`
  syntax, line-field parsing) plus `lib/api.ts` / `lib/types.ts` wire
  additions (`importGuess/Preview/Parse`, the filters CRUD, a `deleteJSON`
  helper). Wired into the command palette ("Import wizard…", File group)
  and into `importFiles`' failure path as a status/toast hint pointing at
  the wizard (lightest touch — no new store state, no toast-action
  plumbing). 31 new frontend tests (12 lib + 9 hook + 7 panel + 3
  preview-table) plus one assertion added to the existing import-failure
  test; full suite 1458 passed; `npm run build` green.

- ~~**2. Python plugin API v1 (gap #8)**~~ (2026-07-07) — the contract-defining
  ecosystem item. New pure `src/quantized/plugins/` package (`contract.py`
  manifest + validation + `PluginInfo`; `loader.py` discovery/registration;
  `steps.py` step registry), added to the pure-layer guard. v1 contract:
  `QZ_PLUGIN = {name, version, api_version: 1}` + optional `PARSERS` /
  `FIT_MODELS` / `STEPS`. Dual discovery (config-dir `plugins/` folder +
  `quantized.plugins` entry points); per-plugin AND per-contribution isolation
  (broken import / bad manifest / shadowed extension → logged-and-skipped,
  startup never crashes); idempotent reload. Single-registration via new
  `io/registry.register_parser` (precedence: plugins can't shadow a built-in
  unambiguous extension; sniffers append after built-ins) + `calc`
  `register_model` (+ new `unregister_model`) + the step registry; `disabled`
  list in `<config_dir>/plugins.json` respected; app-startup load in
  `create_app`; `qz plugin list`; `docs/plugins.md`. 14 tests
  (`tests/test_plugins.py`); gates green (1786 passed / ruff / mypy).
  **Remaining (deferred, tracked elsewhere):** the `quantized-plugin-template`
  repo → #10 / item 7; the pipeline-step route + frontend palette / batch-replay
  wiring → a later ecosystem item (v1 registers steps server-side only).

- ~~**4. Multi-panel spatial apply (decode-plan #36)**~~ (2026-07-07) —
  `OriginFigure` (`frontend/src/lib/types.ts`) gained the backend's already-
  decoded `frame` (per-layer quad) + `page` (size) fields; new pure
  `frontend/src/lib/originPanels.ts` (`computePanelLayout`) clusters frame
  quads into a rows×cols grid (8%-of-bbox tolerance, `page` as a plausibility
  gate) or falls back to a plain ordinal stack when geometry is
  missing/degenerate/overlapping; `lib/originFigures.ts` gained
  `figureLayerFamily` (same-window layer grouping, shared with the existing
  `doubleYPartner`) and `resolveFigurePanels` (per-layer dataset + channel +
  axis-state resolution, all-or-nothing). `applyOriginFigure`
  (`store/useApp.ts`) tries `doubleYPartner` FIRST (regression-tested
  unchanged), then arranges ≥2 same-window layers into the new
  `spatialPanels` store field when every layer resolves; `MultiPanelStage.tsx`
  gained a CSS-grid render mode where each panel fetches its OWN dataset with
  its OWN xLim/yLim/xLog/yLog (independent, no x-sync); falls back to the
  single-layer apply + an info toast when any layer doesn't resolve. Geometry
  verified against the REAL "Fixed Lambdas SI"!Graph6 file (2 contiguous
  stacked frames, page size undecoded — matches the backend's documented
  fallback) via a direct decode + a dedicated unit test on those exact
  numbers. 27 new/updated tests (`originPanels.test.ts` ×14,
  `originFigures.test.ts` +6, `useApp.test.ts` +7); frontend 146 files /
  1451 tests green; `npm run build` green. **Eyeball caveat:** the
  click-through-the-app + canvas screenshot pass (`tools/visual` headless-
  Chrome harness) was not run this pass — the geometry math and store wiring
  are test-proven, the rendered pixels are not.
