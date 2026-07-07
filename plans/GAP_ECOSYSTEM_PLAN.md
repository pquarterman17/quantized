# Gap Ecosystem Plan — import filters, plugin API, packaging, Origin-interop leftovers

Implementation plan for the ecosystem/distribution batch: the
import-filter persistence + wizard UI (ORIGIN_GAP_PLAN #40 remaining),
the Python plugin API (#8) and its conveniences (#10), the packaging
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

1. **Import-filter persistence + wizard UI (gap #40 remaining)** —
   name-and-save the wizard's `ImportSettings` against a glob, have
   the registry consult saved filters, and give the preview engine its
   missing frontend.
   *Model: sonnet.* *Agent: code-implementer (persistence + registry
   hook), ux-frontend-expert (wizard workshop).*
   - [ ] New pure `src/quantized/io/import_filters.py`: an
         ImportFilter record (name, glob pattern, the
         `ImportSettings` dict from `io/import_preview.py`), JSON
         load/save in a new user config dir (introduce `platformdirs`
         (MIT) — the repo's first config-dir concept; `QZ_CONFIG_DIR`
         env override for tests), and a pure glob-match function;
         under 500 lines, no fastapi imports
   - [ ] Registry hook: `resolve_parser` in
         `src/quantized/io/registry.py` consults matching saved
         filters BEFORE `_SNIFFERS` (a matched filter parses via
         `parse_import` with its stored settings); single-registration
         rule preserved — one chokepoint, no second dispatch path
   - [ ] Thin CRUD routes on
         `src/quantized/routes/import_wizard.py`:
         list/save/delete `/api/import/filters`
   - [ ] Wizard UI: new
         `frontend/src/components/workshops/importwizard/`
         (state hook + panel, workshop pattern): live preview grid
         over `/api/import/{guess,preview}`, controls for delimiter /
         header line / units line / data start / column names / roles
         (the `ImportSettings` fields), "Save as filter…" with name +
         glob; offered from the command palette AND as the fallback
         when a normal import fails with no parser
   - [ ] Tests: filter store round-trip + registry-consult precedence
         (backend), wizard flow (vitest); the gap item's
         messy-3-comment-line ASCII case imports one-click via its
         saved filter, including through headless `import_auto`
   - Acceptance: save a filter for a messy instrument ASCII once;
     the next file matching its glob imports correctly with zero
     dialogs, through both the GUI and `quantized.api` headless.

2. **Python plugin API v1 (gap #8)** — drop-in `.py` modules and
   entry-point packages contributing parsers, pipeline steps, and fit
   models through a stable, documented, pure contract.
   *Model: opus (contract + discovery/versioning design), sonnet
   (wiring, template repo).* *Agent: general-purpose (contract
   design), code-implementer (wiring).*
   - [ ] Contract v1 in a new pure `src/quantized/plugins/` package
         (bound by the pure-layer guard): three contribution types —
         parser (path → DataStruct), step (DataStruct + params →
         DataStruct), fit model (delegates to the existing public
         `register_model` in `calc/fit_models.py`); plugin metadata
         (name, version, `api_version`) with a compatibility check;
         plugins can never reach routes
   - [ ] Discovery: the config-dir plugins folder (reuses item 1's
         platformdirs seam) + `importlib.metadata` entry points
         (group name versioned); a broken plugin logs and skips —
         startup never crashes; trust model per open question 4,
         documented bluntly
   - [ ] Parser registration: add the registry's first public
         register function to `src/quantized/io/registry.py`
         (extension or sniffer + parser), used by BOTH plugins and
         item 1's filter hook — single registration preserved
   - [ ] Plugin steps: thin `src/quantized/routes/plugins.py` (list
         plugins, run a step on posted data); frontend `plugin` step
         kind added to `frontend/src/lib/pipeline.ts` + dispatch in
         `frontend/src/components/workshops/pipeline/executeSteps.ts`
         so plugin steps appear in the pipeline palette and replay in
         templates/batches
   - [ ] `quantized-plugin-template` repo: one worked example per
         contribution type + CI pinned against a quantized version;
         `docs/plugins.md` documents the contract and the trust model
   - Acceptance: a demo plugin dropped into the plugins dir
     contributes a parser (imports via `import_auto`), a fit model
     (listed by `/api/fitting/models`), and a step (appears in the
     pipeline palette and replays in a batch); a deliberately broken
     plugin logs + skips without breaking startup.

3. **Packaging residuals: PyPI + first-run (gap #41 remaining)** —
   the installer half of #41 already shipped (release.yml: Tauri
   installers + PyInstaller sidecar + update manifest; the gap plan's
   ⬜ is stale — reconcile it when closing). What remains is the
   pip/uv path and the first-run experience.
   *Model: sonnet.* *Agent: code-implementer.*
   - [ ] PyPI publish job on the v* tag flow (extend
         `.github/workflows/release.yml` or a sibling publish
         workflow): build SPA → `src/quantized/web` → build wheel
         (hatchling already packages the web dir when present) →
         trusted publishing; TestPyPI dry-run path
   - [ ] Wheel-completeness gate in CI: install the built wheel into
         a clean venv, `qz --no-browser`, assert the SPA and
         `/api/health`-equivalent respond (guards the "web dir
         missing" warning path in `src/quantized/cli.py`)
   - [ ] First-run experience: on an empty library, offer the demo
         dataset (the `frontend/src/lib/demo.ts` seam exists) + a
         "try this" pointer; README install matrix (pipx / uv tool /
         installer downloads)
   - [ ] Acceptance run, documented: fresh machine, no dev tools →
         `pipx install quantized` → `qz` → import a CSV within 2
         minutes
   - Acceptance: `pipx install quantized` yields a working `qz` (SPA
     included) from PyPI; a first-run user reaches a plotted demo
     dataset in one click.

---

## Tier 2 — Medium Impact

4. **Multi-panel spatial apply (decode-plan #36)** — render a
   multi-layer Origin page's panels in their true spatial arrangement
   from the already-decoded `frame`/`page` geometry.
   *Model: sonnet.* *Agent: ux-frontend-expert.*
   - [ ] Surface the wire data: add optional frame quad + page size
         fields to `OriginFigure` in `frontend/src/lib/types.ts`
         (backend `io/origin_project/figures.py` /
         `figures_opju.py` already attach them — no backend change)
   - [ ] Pure layout math in `frontend/src/lib/originFigures.ts`: a
         panel-group helper (same window's layer entries) + frame →
         normalized grid/stack arrangement (order by frame position;
         v1 = vertical/horizontal stacks, arbitrary grids only if the
         corpus demands)
   - [ ] Multi-layer apply path in `applyOriginFigure`
         (`frontend/src/store/useApp.ts`): >2 same-window layers (the
         2-layer Y/Y2 case stays on `doubleYPartner`) arrange via the
         stack machinery (`MultiPanelStage.tsx` + `lib/multipanel.ts`)
         with per-panel axis ranges
   - [ ] Visual-harness check on "Fixed Lambdas SI"!Graph6 (2 stacked
         layers; realdata corpus, local only) per the decode plan's
         own sub-task
   - Acceptance: applying a multi-layer Origin figure reproduces the
     page's panel arrangement (stacked layers stack in the right
     order with their own ranges) instead of applying one layer alone.

---

## Tier 3 — Nice-to-Have

5. **`.otp`/`.otpu` templates → style presets (decode-plan #21)** —
   import Origin graph templates as quantized graph templates.
   *Model: sonnet.* *Agent: general-purpose (format recon), then
   code-implementer.*
   - [ ] Recon first: the 5 corpus templates
         (`../test-data/origin/`, local only, never pushed) through
         the existing container walker — `.otp` is CPYA-family /
         `.otpu` CPYUA-family without data; determine which
         axis/style records the shipped `figures.py` / `figures_opju.py`
         decoders already read (per the samples-not-standards
         directive: general grammar, synthetic fixtures, document
         what doesn't decode — never guess)
   - [ ] Map decoded template properties → a GraphTemplate
         (`frontend/src/lib/figuredoc.ts`: preset + overrides +
         series styles), honestly partial — undecoded properties stay
         absent
   - [ ] Import surface: a dedicated thin route (template files are
         NOT DataStruct parsers — keep them out of `_EXT_MAP`; the
         single-registry rule is about data parsers) + a frontend
         open-file branch landing the result in the saved graph
         templates store
   - Acceptance: importing a corpus `.otp` yields a saved graph
     template whose decoded properties (axis scales, series styles)
     apply to a plotted dataset; undecodable properties are absent,
     never guessed.

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

(empty — nothing shipped against this plan yet)
