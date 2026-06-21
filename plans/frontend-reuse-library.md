# Frontend reuse library — port from fermiviewer

A flagged inventory of fermiviewer frontend code reusable by the `quantized`
frontend, organized as a build plan. The two apps are **separate git repos** that
intentionally share a visual language (theme tokens, `qzk-*`/`qz-*` conventions),
so the shared infrastructure is **copy-vendored** (ported file-by-file with an
origin header), not a shared npm package. This plan defines the "platform
library" subtree quantized adopts and how to keep it traceable to its source.

**Status:** Active
**Created:** 2026-06-21
**Updated:** 2026-06-21

---

## Context

### How the pieces fit together
- **Source:** `../fermiviewer/frontend/src/` — a 2-D EM image viewer (React 19 +
  TS + Zustand + uPlot). Mature; ~26k LOC. Its **overlays, lib utilities, and
  store patterns** are domain-agnostic platform code; its **WebGL raster engine,
  colormaps, and EM workshops** are not reusable.
- **Target:** `frontend/src/` in this repo — already has the shell
  (TitleBar/MenuBar/StatusBar), Library, Stage (uPlot PlotStage + tool-dock),
  Inspector, the full `qz-*` primitive set, a Zustand store (`store/useApp.ts`),
  and `lib/{api,uplotOpts,uplotPlugins,plotdata,demo}.ts`. So we do **not**
  re-port shell/primitives — we port the *higher-value infrastructure*
  fermiviewer already solved (floating windows, command palette, parameter
  dialogs, tooltips, results windows, lifecycle, error logging, prefs, export).

### Reuse model (copy-vendor, traceable)
Each ported file gets a one-line origin header so future syncs are mechanical:
```ts
// Ported from fermiviewer frontend/src/components/overlays/ToolWindow.tsx
// (shared platform code — keep structurally in sync; adapt store bindings only).
```
The ported set forms a conceptual **platform layer** inside the normal tree
(`components/overlays/`, `lib/`, `store/`). Adaptation is almost entirely
*store binding* — fermiviewer reads `useViewer`; quantized reads `useApp` — plus
trimming EM-specific fields. Keep the component structure identical so a future
`diff` against fermiviewer stays small.

### Dependency map (within the port set)
- `CommandPalette` → needs `lib/fuzzy.ts` + `store/commands.ts` (+ MenuBar wiring).
- `ParamDialog` → needs `lib/params.ts` + `components/overlays/ParamFields.tsx`.
- `ResultsWindow` → needs a small CSV/JSON download helper (verify on port; the
  fermiviewer one references a `resultsExport` helper — port or inline it).
- `ExportDialog` → needs `lib/export.ts` + a backend export route (not built yet).
- `PrefsWindow` → needs `lib/prefs.ts`; binds to `useApp` theme/accent/density.
- `ToolWindow`, `TooltipLayer`, `lifecycle`, `errlog` → standalone (store
  binding only). `lifecycle`/`errlog` assume FastAPI+WS endpoints that the
  quantized backend mirrors.

All paths below are verified present with the listed line counts (2026-06-21).

---

## Tier 1 — High Impact (port near-verbatim; unblock workshops + palette)

1. **ToolWindow** — draggable/resizable floating frame (the workshops chassis)
   - [ ] `overlays/ToolWindow.tsx` (72) — port verbatim; bind z-order/focus to `useApp`
   - Unblocks: Curve-Fit / Hysteresis / Reflectivity workshops, DiraCulator panels

2. **Command palette stack** — ⌘K fuzzy command runner
   - [ ] `lib/fuzzy.ts` (42) — copy verbatim (pure, no deps)
   - [ ] `store/commands.ts` (36) — copy verbatim (Action registry + `mergeCommands`)
   - [ ] `overlays/CommandPalette.tsx` (133) — port; bind to `useApp` + `useCommands`
   - [ ] wire MenuBar to publish its actions into the command registry

3. **Parameter dialog stack** — promise-based param collection (fit configs, options)
   - [ ] `lib/params.ts` (39) — copy verbatim (`ParamField` schema + `coerceParams`)
   - [ ] `overlays/ParamFields.tsx` (65) — port verbatim (field-row renderer)
   - [ ] `overlays/ParamDialog.tsx` (105) — port verbatim

4. **TooltipLayer** — delegated `[data-tip]` hover tooltips
   - [ ] `overlays/TooltipLayer.tsx` (81) — copy verbatim (portal-based, no deps);
     immediately useful for icon-only plot/inspector buttons

5. **ResultsWindow** — floating `{columns, rows}` table + CSV/JSON download
   - [ ] `overlays/ResultsWindow.tsx` (130) — port; adapt result shape
   - [ ] verify/port its download helper (`resultsExport`) — inline if small
   - Unblocks: Curve-Fit results, Peak Analysis tables

6. **Lifecycle + error logging** — backend presence WS + client error ring buffer
   - [ ] `lib/lifecycle.ts` (31) — port verbatim (WS reconnect/backoff → store);
     quantized backend mirrors the FastAPI/WS pattern
   - [ ] `lib/errlog.ts` (63) — port verbatim (200-entry ring + `downloadBugReport`);
     adapt the server endpoint path

---

## Tier 2 — Medium Impact (port with light adaptation)

7. **PrefsWindow** — sectioned settings panel (live-apply + localStorage)
   - [ ] `lib/prefs.ts` (145) — adapt schema (drop colormap/measurement; add plot prefs)
   - [ ] `overlays/PrefsWindow.tsx` (497) — keep frame; sections become
     Appearance / Plot style / Workspace / Export; bind toggles to `useApp`

8. **ExportDialog + export lib** — format/resolution/preview export (plots + CSV)
   - [ ] `lib/export.ts` (175) — reuse the state-assembly + debounced-preview
     pattern; drop image-overlay/tilt logic; add plot (PNG/PDF/SVG) + worksheet CSV
   - [ ] `overlays/ExportDialog.tsx` (457) — adapt fields; **blocked on** a backend
     export route (server-side matplotlib vector export, plan W6/UI Tier 3 #20)

9. **ShortcutsOverlay** — "?" keyboard-map overlay
   - [ ] `overlays/ShortcutsOverlay.tsx` (75) — keep layout; swap content for
     quantized keys (fit-plot, fit-data, toggle-inspector, tool modes)

10. **Dataset-info + batch dialogs** — adapt fermiviewer's metadata/batch dialogs
    - [ ] `overlays/MetadataDialog.tsx` (107) → "Dataset info" (columns/units/source)
    - [ ] `overlays/BatchDialog.tsx` (208) → "Batch fit" (shared-param fit over a selection)

---

## Tier 3 — Nice-to-Have / pattern reference (don't port code)

11. **RadialMenu** — `overlays/RadialMenu.tsx` (97): right-click radial context
    menu. Port only if a heavy-tool context needs it; standard dropdowns suffice first.

12. **FolderOpenDialog** — `overlays/FolderOpenDialog.tsx` (134): path/recent
    browser. Port only if quantized adds "load folder of CSVs" / recent projects.

13. **Workshop pattern (reference)** — `components/workshops/ColorOverlayWorkshop.tsx`
    is the canonical shape: a per-workshop Zustand slice + a view builder +
    `ToolWindow` frame, driving computation on state change. Quantized's
    Curve-Fit/Hysteresis/Reflectivity workshops follow this; the EM workshops
    themselves are not reusable.

14. **Store architecture (reference)** — `store/viewer.ts` (1,525): how to
    section a large store (entities / display / ui-overlays / prefs), action
    naming (`set*`/`toggle*`/`ingest`), backend-seeded init, and undo via history
    snapshots. `useApp` stays far smaller but should mirror the conventions.

15. **Theme token sync** — `theme.css`: already aligned (quantized vendored the
    same oklch tokens via the design kit). One-time confirm parity of accent
    schemes + density scales; then each repo evolves its own copy.

---

## Out of scope (not reusable — EM/2-D only)

- `gl/render.ts` (WebGL raster + LUT shaders), `lib/colormaps.ts` (image LUTs),
  `lib/{geometry,measureTools,transformTools,surface3d}.ts` (2-D measurement /
  tilt / 3-D), the EM workshops (EDS/EELS/Diffraction/Structure/Pixel/Atom/
  Surface), and the image Stage/overlay capture code. Quantized is 1-D
  uPlot + Canvas2D; none of this applies.

---

## Effort summary
- **Tier 1:** ~700 lines copied; mostly store-binding wire-up. The leverage
  unlock — `ToolWindow` + `CommandPalette` + `ParamDialog` are prerequisites for
  every workshop and most dialogs in the UI plan.
- **Tier 2:** ~1,400 lines adapted (PrefsWindow + ExportDialog dominate);
  ExportDialog gated on a backend export route.
- **Tier 3:** reference-only; code grows organically.

This plan feeds **W7** in `plans/PORT_PLAN.md` and the workshop tiers of
`plans/ui-implementation-plan.md` (Tier 2 #13 Curve-Fit workshop depends on
Tier-1 items 1, 3, 5 here).

---

## Completed

_(none yet)_
