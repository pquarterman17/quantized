# Preferences and settings audit

Date: 2026-11-25. Base: `origin/main` @ `1889a940`. Audit only, no code changed.
Method: code read (store, dialog, lib, backend), plus a live Chromium run of
`qz --no-browser` (Playwright, screenshots in the lane scratchpad
`prefs-audit/`). "Live" below means seen in the running app; "code" means
read from source only.

Scope facts that frame everything:

- All GUI prefs live in browser `localStorage` (per origin). There is no
  backend settings file and no sync. Backend config is env vars and CLI flags
  only.
- `store/prefs.ts` holds the `qz.prefs` blob (24 fields). Four more
  preference slots are store-independent because `useApp.ts` has zero
  size-ratchet headroom (`qz.fitPrefs`, `qz.interactionPrefs`,
  `qz.plotPerfPrefs`, `qz.toolbarPrefs`). New prefs must follow that pattern
  or extract first (architecture ratchet).
- The Preferences dialog has 7 tabs: Appearance, Plot, Interaction,
  Data & files, Fitting, Numbers, Keyboard (read-only). It opens from
  File ▸ Preferences…, Ctrl/Cmd+K "Preferences…", Ctrl/Cmd+, and the title-bar
  Appearance gear ▸ "All preferences…" (all four live-verified).

## 1. Live check summary

Every control in the dialog was changed, `qz.prefs` and the three side slots
were read back, the page was reloaded, and the dialog was reopened.

- All 24 `qz.prefs` fields, `qz.fitPrefs`, `qz.interactionPrefs` and
  `qz.plotPerfPrefs` persisted and restored (dialog controls showed the saved
  values after reload; `<html data-theme/accent/density/reduce-motion>` set).
- Effects confirmed live: theme, accent, density, default trace (Scatter and
  Line + markers), default line width (4 px visibly thicker), grid off,
  sig figs + notation in the Inspector.
- Not live-tested (no way to drive them without Origin files or a second
  window): Multi-panel fit, Origin book click, matrix export, copy-figure
  transparency, antialias, decimation, persistent tool, wheel zoom. These are
  code-verified readers (see table).
- Broken or confusing, seen live:
  1. Channel Statistics shows the point count as `N  2.01e+2` once
     Notation = Scientific, 3 sf (P0-2).
  2. Worksheet cells ignore Significant figures / Notation entirely
     (still `-5000.0000`), and so do plot axis ticks. The Numbers tab note
     says only "Inspector and readout values", but the tab title and slider
     imply app-wide.
  3. Series palette and "Vary dash & marker" are only in the title-bar
     Appearance gear, not in the Preferences dialog (the dialog's Plot tab
     has no colour control at all).
  4. No "Reset to defaults" button anywhere, no search box, dialog does not
     remember its last tab.
  5. "Grid lines: default for the plot" does not change the plot that is open
     (code, see P1-5).
  6. Hint copy: "Gray" in the dialog vs "grey" in code and the status-bar chip
     says "Gray excluded rows" (a toggle, not a label of state);
     "Excluded rows: filtered / excluded points on the plot" does not say
     what Hide vs Gray does to analysis.

## 2. Inventory

Legend. In GUI: Dlg = Preferences dialog, Gear = Appearance gear dropdown,
Other = elsewhere in the UI, No = not exposed. Persists: LS = localStorage,
none = session only, per-project = saved in the `.dwk`.

### 2a. `qz.prefs` (store/prefs.ts, written by `syncPrefs` on every change)

| pref | storage key | default | in GUI? | read by | persists? | issue |
|---|---|---|---|---|---|---|
| themeMode | `qz.prefs` | system | Dlg + Gear + title-bar button | `prefs.ts:204` resolveTheme, `syncPrefs` | LS (live) | none |
| theme (effective) | `qz.prefs` | derived | derived | `<html data-theme>` | LS | redundant stored field, always re-derived from themeMode (`prefs.ts:204`, `251`); written only for old builds |
| accent | `qz.prefs` | violet | Dlg + Gear | `<html data-accent>` | LS (live) | none |
| density | `qz.prefs` | regular | Dlg + Gear | `<html data-density>` | LS (live) | none |
| palette | `qz.prefs` | default | Gear only | `applyPalette` (`lib/palettes.ts:69`) | LS | not in the dialog; hidden from the place users look for it |
| autoSeriesStyles | `qz.prefs` | false | Gear only | `useStageSeriesCycle.ts:80`, `MultiPanelStage.tsx:125` | LS | same: Gear only |
| reduceMotion | `qz.prefs` | false | Dlg | `styles/index.css:50` | LS | ignores OS `prefers-reduced-motion` by design (comment `index.css:27`); no "follow system" option |
| wheelZoom | `qz.prefs` | true | Dlg | `PlotStage.tsx:80,302` | LS | none (overlay windows hardcode `wheelZoom={false}`: `BackgroundPlotWindow.tsx:310`, `PanelCell.tsx:189`; undocumented) |
| defaultTrace | `qz.prefs` | Line | Dlg | `PlotStage.tsx:78`, `MultiPanelStage.tsx:116`, 10+ windows | LS (live) | none; live-verified |
| defaultLineWidth | `qz.prefs` | 1.5 | Dlg (0.5 to 4, step 0.5) | `canvasLineWidth` (`lib/plotTemplates.ts:36`) | LS (live) | only honoured under the "screen" template (`plotTemplates.ts:38`); under any other template the slider silently does nothing |
| defaultGrid | `qz.prefs` | true | Dlg | `useApp.ts:318` (seeds `showGrid` once), `defaultGraphTemplate.ts:188` | LS | seeds only at store creation; changing it mid-session does not touch the open plot; `defaultPlotView()` hardcodes `showGrid: true` (`lib/plotview.ts:224`) |
| antialias | `qz.prefs` | true | Dlg | `MapStage.tsx:82` | LS | 2-D maps only; label does not say "maps" in the control name beyond "Antialias 2-D map" (fine) |
| sigFigs | `qz.prefs` | 6 | Dlg (2 to 8) | `setFormatOpts` (`lib/format.ts:15`), `fmtNum` in 365 call sites | LS (live) | slider 2 to 8 (`PreferencesDialog.tsx:300-301`) vs store clamp 1 to 12 (`prefs.ts:220`); worksheet and axis ticks ignore it |
| notation | `qz.prefs` | auto | Dlg | `fmtNum` (`format.ts:22-28`) | LS (live) | breaks integer counts (P0-2); auto threshold 1e-3 / 1e5 hardcoded (`format.ts:27`) |
| confirmRemove | `qz.prefs` | false | Dlg | `lib/datasetRemoval.ts:44` | LS | only covers dataset removal; other destructive actions have no pref |
| excludedDisplay (+ `excludedDisplayV2`) | `qz.prefs` | grey | Dlg | `PanelCell.tsx:81`, `BackgroundPlotWindow.tsx:208`, `ExcludedRowsToggle.tsx` | LS | legacy `excludedDisplay` key is still written but never read (`prefs.ts:270,300`): dead write, kept for older builds |
| originBookClickOpens | `qz.prefs` | worksheet | Dlg | `store/datasetSelection.ts:188` | LS | Origin-specific, fine |
| defaultPanelFit | `qz.prefs` | frames | Dlg | `store/originApplyPanels.ts:102` | LS | Origin-specific; applies to fresh applies only |
| libraryPanelWidth | `qz.prefs` | 210 to 264 by viewport | drag handle (no Dlg) | `--lw` in `syncPrefs` | LS | no numeric control, no reset |
| inspectorPanelWidth | `qz.prefs` | 296 | drag handle (no Dlg) | `--rw` | LS | same |
| copyFigureTransparent | `qz.prefs` | false | Dlg | `lib/copyFigureCommand.ts:80` | LS | only "Copy figure"; file export has no equivalent pref |
| opjWriteMatrices | `qz.prefs` | false | Dlg | `commands/originProjectExport.ts:61` | LS | label says "not yet verified in Origin"; fine |
| layoutMode | `qz.prefs` | classic | Dlg ("Window layout (preview)") | `store/windowLayout.ts` | LS | written via setLayoutMode only; fine |
| layoutTileBelow | `qz.prefs` | 0 (off) | Dlg (when windows on) | `useNarrowTile.ts:39` | LS | fine |

### 2b. Other frontend slots

| pref | storage key | default | in GUI? | read by | persists? | issue |
|---|---|---|---|---|---|---|
| bootstrapCap | `qz.fitPrefs` | 10,000 | Dlg Fitting | `lib/api/curvefitBootstrap.ts:17` | LS (live) | the Fitting tab holds only this one setting; invalid input is rejected with a message (good) |
| persistentTool | `qz.interactionPrefs` | false | Dlg | `useGlobalShortcuts.ts` Esc handler | LS | dialog copies it into local state on mount (`PreferencesDialog.tsx:63`), so it goes stale if changed elsewhere |
| decimateDensePlots | `qz.plotPerfPrefs` | true | Dlg | `PlotViewport.tsx` | LS | same local-state copy (`:65`) |
| showGroupLabels | `qz.toolbarPrefs` | true | plot toolbar "..." flyout only | `PlotToolbar` | LS | not in the dialog |
| defaultGraphTemplate | `qz.defaultGraphTemplate` | none | Dlg Plot + Plot menu | `lib/defaultGraphTemplate.ts` | LS | none (the only existing "default plot style" mechanism; templates live in `qz.graphTemplates`) |
| recent files | `qz.recent` | max 12 | Other (File ▸ Recent) | `lib/recentFiles.ts:22` | LS | cap hardcoded; no clear-list pref |
| recent projects | `qz.recentProjects` | max 12 | Other | `lib/recentProjects.ts:27` | LS | cap hardcoded |
| working paths | `qz.workingPaths` | 8 unpinned + pins | Other (Home screen) | `store/workingPaths.ts:24` | LS | cap hardcoded; no "default data folder" |
| toolDock | `qz.toolDock` | all docked | implicit (float/dock action) | `store/toolDock.ts` | LS | no default-behaviour pref |
| windowLayout | `qz.windowLayout` | none | implicit | `lib/windowLayout/template.ts` | LS | fine |
| libraryViewPrefs / libraryTreePreviewIds | `qz.libraryViewPrefs`, `qz.libraryTreePreviewIds` | tree | Library header | `lib/libraryViewPrefs.ts` | LS | fine |
| inspectorCards | `qz.inspectorCards.v1` | collapsed | implicit | `store/inspectorCards.ts` | LS | fine |
| interaction hints seen | `qz.interactionHints.seen` | unset (card shows) | "Got it" and Help menu | `InteractionHints.tsx:12,24` | LS | no pref to disable the first-run card |
| autosave | `qz.autosave`, `.stash`, `.pendingRecovery` | on | status bar only | `useWorkspaceAutosave.ts` | LS | no controls at all |
| analysis / calc / fit libs | `qz.analysis-center.v1`, `qz.calcHistory` (100, `calcHistory.ts:23`), `qz.customFitModels`, `qz.fitModels.recent`, `qz.peakRecipes`, `qz.plotRecipes`, `qz.analysisTemplates`, `qz.graphTemplates`, `qz.recipeIndex`, `qz.paletteUsage` | n/a | content, not prefs | various | LS | user content in the same store as prefs; "reset prefs" must not touch these |
| session | `qz.session.active` | n/a | no | `lib/sessionMarker.ts` | LS | internal |

### 2c. Backend and CLI

| setting | where | default | in GUI? | read by | issue |
|---|---|---|---|---|---|
| `--host`, `--port`, `--allow-remote`, `--no-browser`, `--calc`, `--dev`, `--desktop`, `--version` | `cli.py:108-140` | 127.0.0.1 / 8000 | no (CLI) | `cli.py`, `server_launch.py` | default port busy falls back to a random port (`server_launch.py:125-151`), which changes the browser origin, so every `localStorage` pref (and autosave) appears reset (P0-1) |
| `QZ_AUTO_SHUTDOWN` | `app.py:142` | off (on for desktop/convert) | no | `app.py` | env only |
| `QZ_DATA_ROOTS` | `data_roots.py:23`, `routes/import_template.py:42` | home + cwd + tmp | no | path allowlist | the only "default data folder" control, and it is a security allowlist, not a convenience |
| `QZ_UPLOAD_CACHE_DIR` | `routes/_uploadcache.py:73` | per-user cache | Clear button only | cache | location not visible in GUI |
| `QZ_CONFIG_DIR` | `io/import_filters.py:39` | per-user dir | no | import filters | env only |
| `QZ_TRANSFER_DIR` | `io/workbook_transfer_store.py:164` | per-user dir | no | transfer store | env only |
| `QZ_ORIGIN_COM`, `QZ_WIN_CLIPBOARD` | `io/origin_com.py:53`, `desktop_bridge_clipboard.py:97` | off | no | feature flags | env only, by design |
| `QZ_API_TOKEN`, `QZ_URL` | `client.py:83,124` | generated | no | client | fine |
| `QZ_NO_NUMBA`, `QZ_CONVERT_PREFILL`, `QZ_BACKEND_PORT`, dev-origin env | `calc/_snip_numba.py:113`, `convert_gui_launch.py`, `server_launch.py:323`, `security.py:137` | off / unset | no | internal | fine |
| pywebview window storage | `server_launch.py:285` `webview.start()` | no `private_mode` / `storage_path` passed | n/a | desktop | pywebview 5 documents `private_mode=True` and no persistent `storage_path` by default; if so, desktop-mode localStorage (all prefs and autosave) is discarded at every exit. Not verifiable here (pywebview not installed, no display): needs a check on a desktop build |
| Telemetry, update checks | none found (grep of `src/` and `frontend/src/`) | n/a | n/a | n/a | nothing to expose; adding either needs an owner decision |

## 3. Gap classification of the existing prefs

- (a) Dead: legacy `excludedDisplay` key written but never read
  (`prefs.ts:270,300`); `theme` stored but re-derived on load
  (`prefs.ts:204`); `defaultLineWidth` dead under any non-screen template
  (`plotTemplates.ts:38`). Nothing else stored-and-shown is unread (each
  `qz.prefs` field has a reader, see table).
- (b) Hidden: autosave debounce and generations, recents caps, undo depth,
  sci-notation threshold, default marker size, default tick style, default
  column width, export defaults, import delimiter/encoding defaults
  (sections 4 and findings).
- (c) Not persisted / not live: `defaultGrid` is persisted but applies only at
  startup; panel widths have a drag handle but no dialog control; Origin
  `opjWriteMatrices` is persisted but unverified in Origin. Desktop-mode
  persistence is unverified (P0-1).
- (d) Missing reset: every pref. No per-pref, per-tab or global reset.
  Only `layoutTileBelow` and `defaultGraphTemplate` ("None") have an off
  state; panel widths reset only by dragging.

## 4. Missing options (checked against code)

Each row: exists? then the hardcoded value that could become a pref.
All proposed defaults equal today's behaviour and are **provisional, owner to
confirm**.

General (any plot / any dataset) first:

| area | exists today? | hardcoded value to lift | file:line |
|---|---|---|---|
| Default font size | only via per-preset template (screen 12, aps 9 ...) | `fontSize` per preset; `?? 12` fallback | `lib/plotTemplates.ts:18-24`; `lib/uplotOpts.ts:719` |
| Default font family | no (JetBrains Mono fixed for numbers, design token) | font stack | `lib/uplotOpts.ts:719` (comment), styles tokens |
| Default marker size | no | `DEFAULT_MARKER_PX = 5`, `MIN_MARKER_PX = 2` | `lib/markers.ts:97,104,139`; `lib/quickFigureSetup.ts:47` |
| Colour cycle | yes (palette, Gear only) | n/a | `AppearancePanel.tsx:33-104` |
| Tick direction / length | no | `ticks: { stroke, width: 1 }` | `lib/uplotOpts.ts:806` |
| Frame (box) default | no (template/graph-level only) | n/a | `lib/plotview.ts` view defaults |
| Legend default position | no | `LegendPos` default `auto` | `lib/plotview.ts:95` |
| Grid default | yes (Dlg), live-apply broken | `showGrid: true` | `lib/plotview.ts:224` |
| Default export format | no | `useState("pdf")` in the builder; each aux panel repeats it | `figurebuilder/useFigureBuilder.ts:70`; `ternary/useTernary.ts:49`; `pie/usePie.ts:59`; `polarmap/usePolarMap.ts:37`; `plots2/usePlots2.ts:27` |
| Export DPI | no (per style preset table) | `FIGURE_STYLE_DPI` (default 200, aps 600 ...) | `figurebuilder/figureOutputConstants.ts:24-35`; `useFigureBuilder.ts:72` |
| Export size | no (per preset) | `FIGURE_STYLE_SIZE_CM` | `lib/figurePresets.ts` |
| Font embedding / text as paths | request field exists, no pref | `svg_text_as_paths` (default false; hardcoded `true` for clipboard) | `routes/export_figures_schema.py:167`; `lib/copyFigureCommand.ts:126,174` |
| Export background transparency | Copy figure only | `transparent` request field, no pref for file export | `routes/export_figures_render.py:44` |
| Significant figures, notation | yes (Dlg) | n/a | see inventory |
| Scientific threshold | no | `1e-3` / `1e5` | `lib/format.ts:27` |
| Decimal separator / locale | no | `"en-US"` literals (10), bare `toLocaleString()` (59) | `components/Shell/StatusBar.tsx:21`; grep `toLocale` in `frontend/src` |
| Date / time format | no, and inconsistent | `hour12: false` in one place, browser locale elsewhere | `StatusBar.tsx:21`; `RecipeRow.tsx:260`; `lib/libraryDetails.ts:121` |
| Import: delimiter, header rows, encoding | per-import in the wizard only; not remembered | wizard default `"auto"` | `importwizard/ImportWizardPanel.tsx:160-164` |
| Recent files / projects count | no | `MAX = 12` (both) | `lib/recentFiles.ts:22`; `lib/recentProjects.ts:27` |
| Recent-folders count | no | `MAX_UNPINNED = 8` | `store/workingPaths.ts:24` |
| Default working / data folder | no (recent+pinned list only) | n/a; backend allowlist `QZ_DATA_ROOTS` | `store/workingPaths.ts`; `data_roots.py:23` |
| Autosave interval | no | debounce 800 ms | `useWorkspaceAutosave.ts:355` |
| Autosave backup count / age | no | `MAX_GENERATIONS = 3`, 30 days | `lib/autosaveGenerationRules.ts:14,21` |
| Undo depth | no | `HISTORY_DEPTH = 50` (undo menu lists 20) | `store/history.ts:61`; `lib/undoHistory.ts:22` |
| Theme / accent / density | yes, verified | n/a | n/a |
| UI scale / font size | no (density only) | n/a | `styles/*` tokens |
| Keyboard shortcut customization | no, explicitly "fixed" | n/a | `PreferencesDialog.tsx:326`; `lib/shortcuts.ts` |
| Confirmation dialogs | partial: dataset removal only (41 files use `askConfirm`/`ConfirmDialogBody`, none gated by a pref) | `confirmRemove` | `lib/datasetRemoval.ts:44` |
| Unsaved-close warning | none (autosave only); no `beforeunload` | n/a | `lib/browserLockProvider.ts:71,214`; `lib/sessionMarker.ts:62` |
| Startup: reopen last project | autosave restore is automatic/prompted, no pref | n/a | `autosaveStartupRestore.ts` |
| Startup: welcome card | one-time "Got it" only | `SEEN_KEY` | `overlays/InteractionHints.tsx:12,24`; `Library/HomeScreen.tsx` |
| Stats alpha / confidence level | no global; per-tool 0.05 and 0.95 | `alpha: float = 0.05` (4 request models); level `0.95`; `RUNS_ALPHA = 0.01` | `routes/stats.py:64,82,88,133`; `curvefit/FitOutputSection.tsx:45`; `workshops/timeseries/timeSeriesRun.ts:35,39`; `curvefit/curveFitStatus.ts:69` |
| Fit max iterations / tolerance / weighting | not reachable from the API or GUI | `max_iter = 5000*n_free`, `tol_fun 1e-12`, `tol_x 1e-10`; weighting is per-fit (`dy`/`weights` request) | `calc/fitting.py:125-127,193` (no field in `routes/fitting.py`) |
| Telemetry / update check | none exist | n/a | n/a |
| Dock behaviour | per-tool float/dock remembered, no default | n/a | `store/toolDock.ts` |
| Default worksheet column width | no (per-column resize is per workspace) | `DEFAULT_COL_WIDTH = 120`, date X 168 | `lib/gridwindow.ts:207`; `Stage/worksheet/GridViewport.tsx:50` |

Specialized last:

| area | exists today? | hardcoded value to lift | file:line |
|---|---|---|---|
| Field unit default (Oe vs T) | no; falls back to Oe | `"Oe"` fallbacks | `workshops/magtools/useMagTools.ts:70,77`; `useMagNormalization.ts:169`; `curieWeissBatchItems.ts:62`; `useCurieWeiss.ts:283` |
| Moment unit (emu vs A·m²) | no default pref; conversion only in the Units calc | n/a (no fallback constant found) | `workshops/calculators/useUnitsCalc.ts:25` |

## 5. Prioritized findings

P0 = wrong or lost user data/settings; P1 = clear user-visible gap or
misleading control; P2 = polish, hidden constants, nice-to-have.

### P0 (2)

- **P0-1. Prefs can silently vanish because they live in origin-scoped
  `localStorage`.** (a) `qz` default port busy falls back to a random port
  (`server_launch.py:125-151`), a new origin, so theme, palette, sig figs,
  autosave and recents all look reset. (b) Desktop: `webview.start()` is called
  with no `private_mode=False` / `storage_path`
  (`server_launch.py:285`); pywebview 5 defaults to a non-persistent profile
  (documented default, unverified here). Action: verify on a desktop build; if
  confirmed, pass a per-user `storage_path` and `private_mode=False`; consider a
  backend-stored prefs file (owner decision, section 7).
- **P0-2. DONE 2026-11-25 (`fmtCount`/`fmtStat`, Inspector, grid footer, Tabulate, ROI batch). Notation pref corrupts integer counts.** `fmtNum` formats every
  number (`lib/format.ts:21-28`), including counts: with Scientific and 3 sf
  the Inspector shows `N 2.01e+2` for 201 points (live, screenshot
  `22-stats-3sf-sci.png`); Fixed shows `201.000`. Fix: an integer formatter
  (`fmtInt`) for N / counts at the call sites
  (`Inspector/StatsCard.tsx:59` and the other callers listed by
  `grep fmtNum`), leaving `fmtNum` for measurements.

### P1 (8)

- **P1-3. No reset to defaults.** Add per-tab and global "Reset" in the dialog
  footer (`PreferencesDialog.tsx:344-349`) driven by `PREF_DEFAULTS`
  (`prefs.ts:158-184`) and the side slots' defaults; must not clear
  content slots (`qz.plotRecipes`, `qz.graphTemplates`, `qz.customFitModels`; see 2b).
- **P1-4. No default-export prefs.** Format, DPI, style, transparency and
  text-as-paths reset to hardcoded values every time a builder opens
  (`useFigureBuilder.ts:70-72`, aux panels `useTernary.ts:49` etc.). One
  `qz.exportPrefs` slot read by those initialisers. Vector stays default.
- **P1-5. "Grid lines" default is not live and not honoured by new
  windows.** It seeds `showGrid` once (`useApp.ts:318`) and
  `defaultPlotView()` hardcodes `true` (`lib/plotview.ts:224`). Make new
  windows read the pref and say in the hint when it applies (code-read; not
  live-tested mid-session).
- **P1-6. Palette and "Vary dash & marker" are not in Preferences.** Only in
  the Gear dropdown (`AppearancePanel.tsx:33-104`). Add both to the Plot tab
  (they must stay in the Gear too). Plus the missing plot-style defaults:
  marker size (`markers.ts:97`), font size (`plotTemplates.ts:18`), tick
  direction (`uplotOpts.ts:806`), legend position (`plotview.ts:95`).
- **P1-7. Numbers pref scope is narrower than it looks.** Worksheet cells
  (`Stage/worksheet/cellFormat.ts:19-26`, fixed 4 dp) and axis ticks ignore
  sig figs / notation; locale is fixed (en-US literals, 59 bare
  `toLocaleString()`); scientific threshold hardcoded (`format.ts:27`). Either
  scope the labels precisely or add "apply to worksheet", decimal separator
  and sci-threshold options.
- **P1-8. Safety and workflow constants are hidden:** autosave debounce
  (`useWorkspaceAutosave.ts:355`), generations and age
  (`autosaveGenerationRules.ts:14,21`), undo depth
  (`store/history.ts:61`), recents caps (`recentFiles.ts:22`,
  `recentProjects.ts:27`, `workingPaths.ts:24`). Surface as a "General" tab.
- **P1-9. Confirmations are all-or-nothing in one place.** Only dataset
  removal has a pref (`datasetRemoval.ts:44`); no pref covers replace
  workspace, close with unsaved changes, delete figures/columns; no
  `beforeunload` guard. Needs an owner decision on defaults.
- **P1-10. Import defaults are not remembered.** Delimiter, header rows and
  encoding reset to "auto" per import (`ImportWizardPanel.tsx:160-164`);
  Data & files tab has no import section. Add "remember last wizard
  settings" (opt-in) plus default encoding.

### P2 (12)

- **P2-11.** `defaultLineWidth` is dead under non-screen templates
  (`plotTemplates.ts:38`); say so in the hint or disable the slider.
- **P2-12.** sig-figs slider 2 to 8 (`PreferencesDialog.tsx:300-301`) vs store
  clamp 1 to 12 (`prefs.ts:220`, `format.ts:16`). Align or document.
- **P2-13.** Legacy `excludedDisplay` still written, never read
  (`prefs.ts:270,300`); and `theme` stored redundantly (`prefs.ts:251`). Plan
  removal once old builds are gone (needs owner say-so because older builds
  share storage).
- **P2-14.** Dialog copies standalone slots into local state on mount
  (`PreferencesDialog.tsx:63-67`): stale if changed elsewhere. Read via a
  tiny subscribe hook.
- **P2-15.** Dialog UX: remember last tab, add a search field, fix copy
  (Gray/grey, "Excluded rows" hint, "default for the plot", footer sentence
  at `PreferencesDialog.tsx:345` is two ideas long).
- **P2-16.** Plot toolbar `showGroupLabels` exists only in the toolbar flyout
  (`qz.toolbarPrefs`); mirror in Preferences.
- **P2-17.** First-run hints card has no "never show" pref
  (`InteractionHints.tsx:12-24`); welcome/reopen-last-project not
  configurable.
- **P2-18.** Date/time formats inconsistent (`StatusBar.tsx:21` 24 h vs
  locale elsewhere); no pref.
- **P2-19.** Stats alpha / confidence level: one global default instead of
  0.05 and 0.95 scattered (`routes/stats.py:64,82,88,133`,
  `FitOutputSection.tsx:45`, `timeSeriesRun.ts:35,39`).
- **P2-20.** Fit iteration/tolerance not exposed by the API
  (`calc/fitting.py:125-127`, `routes/fitting.py`); golden-parity risk, owner
  decision.
- **P2-21.** UI scale / font size, keyboard remapping, worksheet default
  column width (`gridwindow.ts:207`), reduce-motion "follow OS": absent.
- **P2-22.** Magnetometry unit defaults (Oe/T, emu/A·m²) are fallbacks, not
  prefs (`useMagTools.ts:70,77` etc.). Technique-specific, do last.

Counts: P0 = 2, P1 = 8, P2 = 12 (22 findings).

## 6. Proposed fix lanes

Lanes touch disjoint files. General before specialized: lane 1 (dialog
plumbing every other lane builds on), then 2 (any plot), 3 (numbers/stats,
specialized units last), 4 (workflow/startup). Lanes 2 to 4 each add one new
store-independent slot (no `useApp.ts` growth) and one new dialog pane file
(`PreferencesDialog.tsx` is 353 of 400 lines: panes must be separate files,
and lane 1 owns the only edits to the dialog shell: tab list and wiring).
Every new pref defaults to today's behaviour and persists under a key
registered in `lib/storageKeys.ts` (lane 1 pre-registers the keys named below
to avoid conflicts).

**Lane 1: prefs core (P0-1, P1-3, P2-12 to P2-16).** Files:
`store/prefs.ts`, `components/overlays/PreferencesDialog.tsx`, `PrefRow.tsx`,
new `PrefsResetBar.tsx` and a `lib/prefsRegistry.ts` (defaults and reset for
all slots), `lib/storageKeys.ts`, `server_launch.py` (storage path,
`private_mode=False`), `components/Shell/AppearancePanel.tsx` (link only).
Delivers: reset (tab / all), tab memory, search, hint copy, subscribe hook for
side slots, desktop persistence, port-fallback notice, and the empty
"General" and "Export" tab shells that lanes 2 and 4 fill.

**Lane 1 status: shipped (branch `claude/prefs-core`).** Delivered P0-1
(server prefs file + pywebview storage, see "Owner decision 2026-11-25"
below), P1-3 (reset per tab and all), P2-12 (slider 1 to 12), P2-14 (side
slots read through `slot.use()`, never a stale local copy), P2-15 (last tab,
search, hint copy), P2-16 (toolbar group labels mirrored in Plot), and the
port-fallback note (the `qz` console line now says prefs follow and autosave /
recents do not). Not done here: P2-13 (needs the owner's say-so, older builds
share storage); the empty "General" / "Export" tabs (not shipped empty: a
lane adds its tab with one registry entry, below). Copy kept US "Gray"/"gray":
the whole app uses it (status chip, palette, recipe text); "grey" is only the
stored value.

**How lanes 2 to 4 add prefs (lane 1's API).**

- A pref slot: `export const xPrefs = definePrefSlot("qz.xPrefs", defaults,
  parse?)` in `lib/prefSlots.ts` terms. `load()` / `save(v)` / `reset()` /
  `use()` (hook). Synced to the server file and reset by "Reset all" without
  further wiring; `{ sync: false }` keeps one browser-local. The default
  `parse` keeps each field whose type matches its default; pass your own for
  ranges. Keys pre-registered in `lib/storageKeys.ts`: `qz.plotStylePrefs`,
  `qz.exportPrefs` (lane 2), `qz.numberPrefs` (lane 3), `qz.workflowPrefs`
  (lane 4).
- A tab: append one `PrefsTabDef` to `PREFS_TABS` in
  `components/overlays/prefsTabs.tsx` (`id`, `Pane`, `keywords` naming every
  row label, `reset: { prefs?, slots?, extra? }`). Rows in an existing tab go
  in its pane file (`PrefsPlotPane.tsx`, `PrefsNumbersPane.tsx`, ...). Never
  edit `PreferencesDialog.tsx`; `PreferencesDialog.prefs.test.tsx` fails when
  a row label is missing from its tab's keywords.
- Server: nothing to do. `/api/prefs` accepts any `qz.<name>` slot holding a
  JSON object, within the 256 KiB / 64-slot caps.

**Lane 2: plot and export defaults (P1-4, P1-5, P1-6, P2-11).** Files:
new `lib/plotStylePrefs.ts` (`qz.plotStylePrefs`) and `lib/exportPrefs.ts`
(`qz.exportPrefs`), `lib/markers.ts`, `lib/plotTemplates.ts`,
`lib/uplotOpts.ts`, `lib/plotview.ts`, `figurebuilder/useFigureBuilder.ts`,
`ternary/useTernary.ts`, `pie/usePie.ts`, `polarmap/usePolarMap.ts`,
`plots2/usePlots2.ts`, `lib/copyFigureCommand.ts`, new
`overlays/PrefsPlotPane.tsx` / `PrefsExportPane.tsx`. Prefs: marker size, font
size (screen template only), tick direction, legend position, palette and
vary-dash mirrored, default export format / DPI / transparent / text-as-paths.
Vector stays default.

**Lane 3: numbers, locale, stats (P0-2, P1-7, P2-18, P2-19, then P2-22).**
Files: `lib/format.ts`, `Inspector/StatsCard.tsx` and the other `fmtNum`
count sites, `Stage/worksheet/cellFormat.ts`, `StatusBar.tsx`,
`libraryDetails.ts`, `RecipeRow.tsx`, new `lib/localePrefs.ts`
(`qz.numberPrefs`), `FitOutputSection.tsx`, `timeSeriesRun.ts`,
`routes/stats.py` (default alpha stays a request default; frontend sends the
pref), new `overlays/PrefsNumbersPane.tsx`. Specialized and last within the
lane: magnetometry field/moment unit defaults (`useMagTools.ts` etc.).

**Lane 4: workflow, safety, startup (P1-8, P1-9, P1-10, P2-17).** Files:
new `lib/workflowPrefs.ts` (`qz.workflowPrefs`), `useWorkspaceAutosave.ts`,
`lib/autosaveGenerationRules.ts`, `store/history.ts`, `lib/recentFiles.ts`,
`lib/recentProjects.ts`, `store/workingPaths.ts`,
`lib/datasetRemoval.ts` and the confirm call sites, `InteractionHints.tsx`,
`importwizard/ImportWizardPanel.tsx`, new `overlays/PrefsGeneralPane.tsx`.
Note `store/history.ts` is imported by `useApp.ts`: the depth must be read from
the new slot at call time, not stored in `useApp`.

Ordering: merge lane 1 first; lanes 2 to 4 rebase on it and are mutually
independent.

## Owner decision 2026-11-25: preferences storage (P0-1)

A backend prefs file, with browser `localStorage` kept as the fast cache.

- **Server:** `io/prefs_store.py` (pure) writes `prefs.json` in the existing
  per-user config dir (`io/import_filters.config_dir`, `QZ_CONFIG_DIR`
  overrides it), shape `{"version": 1, "slots": {"qz.prefs": {...}, ...}}`.
  Atomic write (temp file, fsync, `os.replace`). A corrupt file is moved to
  `prefs.json.corrupt-<UTC stamp>` and loading continues empty; `GET` reports
  it once in `notice`. `routes/prefs.py`: `GET /api/prefs` ->
  `{slots, notice}`; `PUT /api/prefs` with `{"slots": {name: object | null}}`
  merges (`null` deletes). Refused with 422: non-object body or slots, a name
  not matching `qz.<letter><[A-Za-z0-9_.-]{0,63}>`, a non-object slot, more
  than 64 slots, a body or a resulting file over 256 KiB. The usual API token
  and Origin checks apply.
- **Frontend:** `lib/prefSlots.ts` (eager, small) is the one write path for
  every pref slot; `lib/prefsServerSync.ts` (lazy, started from `main.tsx`,
  not under `?harness`) hydrates: the server's slots win (re-applied to the
  store and `<html>`), unless the user changed that slot while the request
  was in flight; an unreachable server leaves `localStorage` as the source;
  an empty server file receives this browser's prefs (first-run migration).
  Later writes are PUT with a 600 ms debounce, flushed on `pagehide`.
  Synced slots: `qz.prefs`, `qz.fitPrefs`, `qz.interactionPrefs`,
  `qz.plotPerfPrefs`, `qz.toolbarPrefs`, plus any `definePrefSlot` slot.
  Not synced (content or per-browser state): templates, recipes, recents,
  autosave, `qz.defaultGraphTemplate` (names a template in
  `qz.graphTemplates`, content), `qz.prefsDialog` (last tab).
- **Desktop:** `webview.start(private_mode=False, storage_path=<config
  dir>/webview)`, passing only the keywords the installed pywebview accepts
  (unit-tested against old and new signatures; not run on a real desktop
  here, pywebview is not installed).
- Provisional, owner to confirm: the 256 KiB / 64-slot caps, the 600 ms
  debounce, no retry after an offline start (a later reload syncs).

## Lane 4 status: shipped (branch `claude/prefs-workflow`)

Delivered P1-8, P1-9, P1-10, P2-17 and P2-20. One slot, `qz.workflowPrefs`
(`lib/workflowPrefs.ts`, `definePrefSlot`), a **General** tab
(`PrefsGeneralPane.tsx`, one registry entry) and rows in Data & files and
Fitting. `PreferencesDialog.tsx` is untouched. Every default except the two
confirmations is the value that was hardcoded; every range is **provisional,
owner to confirm**; stored out-of-range numbers are clamped on load, and the
dialog refuses an out-of-range entry with the allowed range.

| pref | default (was) | range | read at |
|---|---|---|---|
| Autosave delay | 0.8 s (`useWorkspaceAutosave.ts:355`) | 0.4 to 10 s | each edit |
| Recovery copies kept | 3 (`autosaveGenerationRules.ts:14`) | 1 to 10 | each save (`autosaveCore.ts`) |
| Recovery copy retention | 30 days (`autosaveGenerationRules.ts:21`) | 1 to 365 days | each save |
| Undo steps | 50 (`store/history.ts:61`) | 10 to 200 | each push |
| Recent files / projects / folders kept | 12 / 12 / 8 | 1 to 50 | each add |
| Show first-run hints | on | n/a | app start |
| Remember import wizard settings | off | n/a | wizard pick / import |
| Fit max iterations per parameter | 5000 | 100 to 1,000,000 | each /fit, /equation/fit |
| Fit function / parameter tolerance | 1e-12 / 1e-10 | 1e-15 to 1e-3 | same |

Notes. A lowered undo depth or recents cap trims on the next push, not at
once. The import wizard remembers delimiter and header / units lines only
(opt-in); **encoding is not remembered because the wizard has no encoding
setting** (it reads UTF-8, `File.text()`), so that part of P1-10 is deferred
until a decode option exists. A remembered header below the new file's data
start is ignored (fail closed). The fit limits ride `qz.fitPrefs`, are sent
only when they differ from the defaults, and `curve_fit` gained
`max_iter_per_param` (the golden path never sends it). They apply to `/fit`
and `/equation/fit` (single, batch, replay, recalc), not to the global fit,
scan, bootstrap or robust routes.

## Owner decision 2026-11-25: confirmations and fit limits

- **Both confirmations are ON by default, each a preference.**
  1. *Unsaved-changes warning* (Preferences ▸ General "Warn before closing
     with unsaved changes"): a `beforeunload` listener that exists only while
     the pref is on and there is unsaved work, by the title bar's rule (a named
     project is unsaved while `projectDirty`; an unnamed workspace while it
     holds data). A clean workspace has no listener. It is installed lazily
     (`lib/unsavedGuard.ts`) and **not under `?harness`**, the existing e2e /
     visual harness seam, so a scripted reload never meets a native dialog;
     the live e2e spec drives a non-harness session to prove it.
  2. *Replace the current workspace?* (Preferences ▸ General "Confirm before
     replacing the workspace"): the existing confirm, now behind
     `needsReplaceConfirm` (non-empty workspace AND the pref) at all four
     replace paths: Open, Open without layout, Recent projects, and the
     crash-recovery Replace. An empty workspace never prompts. No recipe
     open replaces the workspace (recipes apply to a plot), so none is gated.
- **Fit max iterations / tolerance** are in Preferences ▸ Fitting; defaults
  unchanged (`5000 * n_free`, `1e-12`, `1e-10`), so every golden is untouched
  (a test pins that an omitted and an explicit-default request return the
  same bytes).

## 7. Owner decisions needed

1. ~~Desktop and port persistence~~ Decided 2026-11-25 (section above). Desktop and port persistence: is a backend-stored prefs file (portable
   across ports and browsers, e.g. under the existing per-user config dir
   `QZ_CONFIG_DIR`) wanted, or only fixing pywebview storage? Where must the
   `storage_path` live?
2. Default export format / DPI pref: confirm "pdf, preset DPI" stays the
   default and whether the pref overrides a style preset's calibrated DPI.
3. Locale: decimal-comma display must never reach CSV/Origin export or the
   API; confirm display-only scope.
4. ~~Confirmations~~ Decided 2026-11-25, both ON (section above): defaults for replace-workspace and unsaved-close prompts
   (fail-closed says off, safety says on); `beforeunload` guard yes or no.
5. Undo depth and autosave generation caps: memory trade-off, and the
   allowed ranges (provisional: undo 10 to 200, default 50; generations 1
   to 10, default 3; debounce 0.4 to 10 s, default 0.8 s).
6. ~~Fit max iterations / tolerance~~ Decided 2026-11-25, exposed (section above): exposing them touches the golden-tested
   fit path; confirm defaults stay `5000*n_free`, `1e-12`, `1e-10`.
7. Telemetry and update checks: none exist; confirm none should be added.
8. Keyboard remapping and UI scale: large features; confirm whether to
   schedule at all.
9. Removing the legacy `excludedDisplay` and `theme` writes: older builds
   share storage.
10. Magnetometry unit defaults: technique-specific, last per the standing
    order; confirm the Oe / emu defaults stay as they are.
