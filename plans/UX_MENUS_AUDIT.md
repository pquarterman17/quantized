# UX menus audit (2026-11-24)

Audit of every menu surface in the built app (menu bar and flyouts, plot / axis / legend / worksheet / header / row / Library / folder / window / result menus, selects, the command palette, toolbar overflow menus), driven live in Chromium against `qz` at `origin/main` 7e5c9f03 (PR #982). Nothing was fixed. Every item marked **provisional, owner to confirm** is a grouping or naming choice, not a defect.

## Method and scope

- Server: `uv run qz --no-browser --port 8791`; Playwright (node) with `/opt/pw-browsers/chromium-1254`, `deviceScaleFactor` 1, viewports 1440x900 and 1280x720 (plus 1280x600, 1280x480 and 1024x640 for flyout fit).
- Data: `frontend/e2e/fixtures/six-channel.csv` (6-channel XY), `lot-wafer-thickness.csv` (categorical), `grid-map-xyz.csv`, `two-peaks.csv`; `tests/fixtures/xrdml_rsm_synthetic.xrdml` (a 2-D map, shows the Map tab), `mpms_mvst.dat`, `xrdml_la2nio4.xrdml`.
- Every top menu and every flyout was walked recursively in three states: empty workspace, a 1-D dataset, and a 2-D map. The full text trees (labels, shortcuts, disabled reasons) are in `<shots>/dump-*.txt`; context-menu trees in `<shots>/ctx-*.txt`.
- Screenshots: `/tmp/claude-0/-home-user-quantized/26fdd960-ce78-5d7d-b7e8-e38c841ca77c/scratchpad/ux-menus/` (referred to below as `<shots>/`). Not in the repo.
- Not covered: the Tauri / pywebview desktop shell (native menus, Ctrl+N and friends really do get intercepted by the browser only in a tab), Origin-imported projects, Windows COM items. Keyboard behaviour was tested with synthetic key events; a real browser reserves Ctrl+N, Ctrl+T, Ctrl+W.
- Server PIDs started by this audit: 9122 (`uv run`) and 9127 (`qz`); only these were killed.

### Already decided, not re-reported

Read before writing: `plans/OPEN_ITEMS.md` (UX audit 10 lanes B and C, "2026-11-24 overnight: provisional owner decisions", gap-audit-9 sections for Fit Model, Profiler, DOE, map operations) and the UX11 / UX12 commit messages (994b3e62, 19d463c6). `plans/UX_VERIFY_10.md` and any `UX_AUDIT_*` file do not exist in the tree; those audits live only in `OPEN_ITEMS.md` and git history. Not re-reported: the Tools menu, View before Window, Library row submenus (at most 16 rows), Export PDF/SVG/PNG under File > Export, Log / Linear under Plot > Axes, Normalize flyout, sentence-case ratchet, American spelling decision, "Browse" hidden outside Tiles, palette aliases, "Window layout (preview)" staying a preview.

## Summary

No P0 (nothing loses data or blocks a workflow). 10 P1 and 18 P2.

| ID | Pri | Area | One line |
|---|---|---|---|
| M1 | P1 | New plot types | With a Pareto / hexbin / KDE / parallel / Bland-Altman / polar-map view open, File > Export PDF/SVG/PNG, the Plot menu axis/legend items and Insert tools stay enabled and act on a hidden XY plot |
| M2 | P1 | New plot types | The five new chart types sit in "Plot > Build & export"; polar map / pole figure has no menu or palette entry at all |
| M3 | P1 | Statistics | SPC and life tests exist only inside a flat, unsorted 33-option select; no menu or palette entry reaches them |
| M4 | P1 | Maps | The map view has no context menu (native browser menu appears); map tools are spread over five menus |
| M5 | P1 | Windows | Right-click inside a floating tool window (Fit Model, DOE, ...) opens the plot's menu underneath |
| M6 | P1 | Plot ctx | Right-click on X-axis tick labels adds the curve block; Y axis does not; axis menus omit the axis dialog |
| M7 | P1 | Plot ctx | The curve menu is ~35 rows; at 720 px height its rows shrink to ~13 px |
| M8 | P1 | Library | Destructive verbs are inconsistent: Delete / Remove / Remove N selected / Delete permanently / Delete folder + 1 dataset(s) |
| M9 | P1 | Shortcuts | Ctrl+N is shown on New workbook but a browser tab cannot receive it |
| M10 | P1 | Results | Result tables have no context menu; "Open as worksheet" / "Send to report" stay disabled until Save result |
| N1 | P2 | Enablement | Disabled items with no reason (11 sites) |
| N2 | P2 | Enablement | Three different reasons for the same condition; keyboard users never reach them |
| N3 | P2 | Plot menu | Toggles and cycle commands show no state |
| N4 | P2 | Plot menu | Plot > Axes is a 15-row interleaved list; Plot > Display mixes six template items with view toggles |
| N5 | P2 | Analyze | Duplicates, mis-grouped items, 110-character labels truncated in flyouts |
| N6 | P2 | Labels | Title Case, ellipsis position, three vocabularies for the same action |
| N7 | P2 | Data / header | Transpose under "Combine & split"; Sort worksheet and column add/insert/delete only in the header menu; the header menu has 33 rows |
| N8 | P2 | Worksheet | Corner and row-header menus incomplete; the "⋯" overflow holds only an info note |
| N9 | P2 | Library | No menu on empty area or stage tabs; "Quick Plot unrecognized data" on an ordinary CSV |
| N10 | P2 | Aux figures | Image stages give the browser's "Save image as" menu; PDF/SVG/PNG-only formats; "pdf" vs "PDF" |
| N11 | P2 | Selects | Pareto defaults to a numeric category; Fit Model lists Sample Index; lowercase raw ids; "(provisional)" in an option |
| N12 | P2 | Copy | Owner-process text and British spelling inside the DOE window and plot-type palette descriptions |
| N13 | P2 | A11y | Unnamed menus, `aria-hidden` shortcuts, unfocusable disabled items, tabs without `role=tab`, no Alt/F10 access |
| N14 | P2 | Dark theme | Disabled rows are about 2:1 contrast on translucent glass |
| N15 | P2 | Palette | Ranking misses (pole figure, levelling); disabled rows lose their description; nine palette-only signal commands |
| N16 | P2 | Overflow | Overflow menus carry glyphs; window titles print the dataset name twice |
| N17 | P2 | Naming | "DiraCulator" (menu) vs "Calculators" (title bar and window) |
| N18 | P2 | Shortcuts | No Ctrl+Y redo, no Ctrl+F for Find in project; single-letter shortcuts (F, Y, P, A) undiscoverable beyond the menu |

---

## P1

### M1. Aux-figure views leave XY-plot commands enabled (and Export PDF/SVG/PNG export the wrong figure)

- **Where:** File > Export > Export PDF… / Export SVG… / Export PNG…; Plot > Axes, Display, Curves & legend, Layout items; Insert > Arrow, Line, Rectangle, Ellipse, Text box; Edit > Copy figure.
- **Repro:** import `six-channel.csv`; Plot > Build & export > Pareto chart… (also true for hexbin, KDE, parallel, Bland-Altman, and Plot type > Polar map). Open File > Export > Export PDF…: the XY "Export figure" dialog for the hidden XY plot opens (the Pareto sits behind it). Plot > Axes > Log Y scale and Plot > Toggle legend: no visible change, status line unchanged. Insert > Arrow: status "drag to draw an arrow — Esc cancels" over a server-rendered image. Edit > Copy figure: red toast "copy failed: This plot has its own Export..." (shown twice). Every one of these was `[on]` in the dumped menus.
- **Screenshots:** `<shots>/72-pareto-Export-PDF-.png`, `72-pareto-Arrow.png`, `72-pareto-Copy-figure.png`, `71-pareto-plotmenu.png`.
- **Why it matters:** a scientist exporting "the figure on screen" gets a different figure. Commit f106b709 already refuses "Export figure…" (message in `lib/figureSpecStage.ts:77`) but the three format shortcuts take another path.
- **Fix:** while a Plots2 / polar-map view is the stage, disable the XY-only commands with the reason "This view has its own Export (the button above the preview)". Make Export PDF / SVG / PNG either refuse the same way or drive that view's Export with the chosen format. Add the rule to `menuAvailability.ts` next to the existing `NEEDS_ACTIVE` table.
- **Files:** `frontend/src/commands/menuAvailability.ts`, `frontend/src/commands/discoveryCommands.ts` (`exportAs`, line ~105), `frontend/src/lib/figureSpecStage.ts`, `frontend/src/lib/plots2Mode.ts`, `frontend/src/lib/polarMapMode.ts`.

### M2. The new chart types have no proper menu home; polar map / pole figure has no command

- **Where:** Plot > Build & export (Multi-panel export, Graph Builder, Ternary, Parallel coordinates, Hexbin density, 2-D density (KDE), Pareto chart, Bland-Altman, Vector field, Send figure to report); Plot > Create (Contour from scattered XYZ, Function plot, Panel x4, Overlay); Plot > Display > Plot type… (the only route to "Polar map / pole figure").
- **Repro:** open Plot > Build & export: chart types are mixed with export and report actions, while the other creation commands sit in Create. Palette: "pole figure", "stereographic", "pole" return nothing relevant; "polar" returns "Plot type…" first. The Plot type popover is a flat 30-tile grid with no group headings and its last row (Bland-Altman) is cut off at the bottom of the popover at 1440x900; Pareto's glyph (╲) is the same as Line's.
- **Screenshots:** `<shots>/m-six-chan-1440-Plot__Build-export.png`, `m-six-chan-1440-Plot__Create.png`, `70-plot-type-dialog.png`, `71-hexbin.png`, `90-polarmap.png`.
- **Compare:** Origin groups plot types by family (Line/Symbol, Column/Bar, Multi-curve, Contour/Heat map, Specialized) under Plot; JMP's Graph menu lists Graph Builder, Scatterplot Matrix, Parallel Plot, Ternary, Bubble, Contour in one place.
- **Fix (provisional, owner to confirm):** rename "Build & export" to "Charts" (or move the five chart types and ternary / vector field into Create > "Statistical and specialty charts"), keep Multi-panel export and Send figure to report under File > Export; add palette commands "Polar map / pole figure…" (synonyms: pole figure, texture, stereographic, Schmidt, equal-area) and one per new chart type that open the figure directly; give the Plot type gallery group headings and a visible scroll cue.
- **Files:** `frontend/src/components/Shell/appMenuPlacement.ts`, `frontend/src/commands/analysisCommands.ts` (line ~49, the chart-type table), `frontend/src/commands/commandDocs.ts`, `frontend/src/lib/plotTypes.ts`, `frontend/src/components/overlays/figuredialogs/PlotTypeGallery.tsx`, `frontend/src/lib/figureDialogActions.ts`.

### M3. SPC and life tests are reachable only through one flat 33-item select

- **Where:** Analyze > Statistics > "Statistical tests (normality · paired · Dunnett · regression · power · control charts · capability · life data)…" and its "Test" select.
- **Repro:** open it: the select has 33 options, zero `<optgroup>`s, and is in the order tests were added, not by family ("Regression" at positions 9, 10 and 14; "Compare groups" at 5-8 and again at 21-22; "Planning" at 20). Control chart, Process capability, Life distribution and Fit Life by X are the last four. Palette "control chart", "capability", "weibull", "kaplan" each return only the generic "Statistical tests" row. Compare the Curve fit "Model" select, which does have optgroups (Polynomial, Exponential, Peak Functions...).
- **Screenshots:** `<shots>/82-cat-Statistical-tests-norm.png`, `83-stats-tests-select.png`, `m-six-chan-1280-Analyze__Statistics.png` (label clipped to "...pow…").
- **Compare:** JMP puts these under Analyze > Quality and Process (Control Chart Builder, Process Capability) and Analyze > Reliability and Survival (Life Distribution, Fit Life by X); Origin groups them under Statistics > Survival Analysis.
- **Fix:** render the select with `<optgroup>` per family, families in a fixed order (Normality, Compare, Regression, Categorical, Survival, Quality (SPC), Reliability, Planning ...). Add direct commands that open the tool pre-selected: "Control chart…", "Process capability…", "Life distribution…" (palette and, provisionally, an Analyze > "Quality & reliability" flyout, owner to confirm). Shorten the menu label to "Statistical tests…" and put the list in the command's description.
- **Files:** `frontend/src/lib/statsTests.ts`, `statsTestsSpc.ts`, `statsTestsLife.ts` (family order), `frontend/src/components/workshops/statstests/StatsTestsInputs.tsx` and `StatsTestsPanel.tsx`, `frontend/src/commands/analysisCommands.ts`, `frontend/src/components/Shell/appMenuPlacement.ts`.

### M4. Map view has no context menu; map tools are scattered

- **Where:** the Map stage (map canvas, X and Y axes, colorbar); Library row of a map dataset; Analyze flyouts.
- **Repro:** import `xrdml_rsm_synthetic.xrdml`, open the Map tab, right-click the map, an axis, the colorbar: no app menu opens and `contextmenu` is not default-prevented, so the browser's own menu (Back / Reload / Inspect, Save image) appears. The map toolbar is two rows of icon-only buttons (`log`, `∿`, `3D`, `—`, `|`, `/` ...) with no overflow or labels. Map-related commands live in: Analyze > Transform & signal (Map operations), Analyze > XRD & reflectivity (RSM analysis, ROI cuts), Analyze > Fit (Surface fit), Plot > Create (Contour from scattered XYZ), Plot > Display > Plot type (Polar map), Window > Create & open (Open map in window). The Library right-click of a map row is identical to a 1-D row (Quick Plot disabled with a reason, but no "Open map", "Map operations…", "ROI cuts…").
- **Screenshots:** `<shots>/60-map-stage.png`, `c-1440-lib-map.png`, `60-map-analyze-transform.png`. (The native menu is not captured by headless screenshots; the event log is in the audit transcript.)
- **Compare:** Origin's matrix / contour right-click offers Properties, Colormap, Add/Remove contour lines, Copy/Export; JMP's contour plot menu offers the same family of choices.
- **Fix:** add a map context menu (Map operations…, Color map ▸, Log scale, Contour lines, Reset range, ROI cuts…, Copy figure, Export figure…) and an axis/colorbar variant; add Library row entries "Open map" and "Map operations…" for a map dataset; provisionally add an Analyze > "Maps" flyout (Map operations, Surface fit, ROI cuts, RSM analysis, Polar map) or at least cross-list Map operations next to ROI cuts (owner to confirm).
- **Files:** `frontend/src/components/Stage/MapStage.tsx`, `MapToolbar.tsx`, `useStageContextMenu.ts` (pattern), `frontend/src/lib/datasetContextActions.ts`, `frontend/src/components/Shell/appMenuPlacement.ts`.

### M5. Right-click in a floating tool window opens the plot's menu

- **Where:** any `ToolWindow` (Fit Model, Design of experiments, Statistical tests, Map operations, Find in project ...).
- **Repro:** Analyze > Statistics > Fit model…; right-click the window title bar, or the Columns list: the plot menu opens ("X axis ▸ / Y axis ▸ / Add text here… / Layer contents…" or a curve header such as "Wafer" with Hide series / Rename…). Right-click on some body text does nothing custom, so the behaviour is also intermittent. Cause: the window is a DOM and React child of the stage element, so `contextmenu` bubbles to `PlotStage`'s `onContextMenu`.
- **Screenshots:** `<shots>/c-1440-toolwin-titlebar-right.png`, `81-toolwin-bodyctx.png`.
- **Fix:** stop `contextmenu` propagation in the tool-window frame (let editable fields keep the native menu); add a window-title menu (Float / Dock / Close / Help) since the title bar has "?" and "▾" buttons but no right-click.
- **Files:** `frontend/src/components/overlays/ToolWindowFrame.tsx`, `ToolWindowTitleButtons.tsx`; the symptom is in `frontend/src/components/Stage/useStageContextMenu.ts`.

### M6. Plot context menu: inconsistent axis hit-testing and a missing axis dialog

- **Where:** plot window right-click on X-axis tick labels vs Y-axis tick labels vs empty plot area.
- **Repro:** `six-channel.csv`, 1440x900: right-click at the X tick labels (700, 800): the menu opens with the header "Zeta", the whole curve block (Color, Line style, Width, Marker, Hide series, Rename…, Move to right Y axis, Plot Details…), then "X axis", then the common block. The same on the Y tick labels (312, 500): "Y axis" only, no curve block. Below the axis the nearest-curve tolerance is about 24 px, so the unrelated curve "Zeta" is the target. The axis menus (X scale, Autoscale X, Set X limits…) do not offer "Axis settings…", tick format, grid-per-axis or link axes, although Plot > Axes has "Axis…" and "Y axis settings…".
- **Screenshots:** `<shots>/c-1440-axis-x-full.png`, `c-1440-axis-y-full.png`, `c-1440-plot-empty.png`.
- **Compare:** Origin right-click on an axis goes straight to "Properties..." (Axis dialog); double-click does the same.
- **Fix:** narrow the curve hit radius to the drawn line plus a few px and never apply it outside the plot rectangle; add "Axis settings…" (and Tick format ▸) to the X and Y axis menus; title the axis menu section the same way on both axes.
- **Files:** `frontend/src/lib/plotMenu.ts`, `frontend/src/components/Stage/PlotContextMenu.tsx`, `useStageContextMenu.ts`, `lib/curveContextActions.ts`.

### M7. The curve menu is too long and shrinks to unusable row heights

- **Where:** right-click a curve in a plot window.
- **Repro:** the menu has about 35 rows (swatch row + Color ▸ + Line style ▸ + Width ▸ + Marker ▸ + 6 curve actions + Mask this point + Add text here + X axis ▸ + Y axis ▸ + 12 common rows). At 1440x900 it fits (24 px rows). At 1280x720 the menu squeezes to 443 px with ~13 px rows, text 11 px, hit targets far below 24 px. The swatch row repeats the Color ▸ submenu. Colors in the submenu show no check on the current color.
- **Screenshots:** `<shots>/c-1280-plot-curve-series-720.png` vs `c-1440-plot-curve-full.png`.
- **Fix:** group the curve block under one "Curve "Alpha" ▸" submenu, or split by object (curve menu vs plot-area menu); drop the duplicate swatch row or the Color ▸ item; keep a minimum row height and scroll instead of compressing; mark the current color/line/width/marker.
- **Files:** `frontend/src/lib/plotMenu.ts`, `frontend/src/components/overlays/ContextMenu.tsx` and `ContextMenuBoxes.tsx` (fit-by-shrinking), `frontend/src/styles/shell.css` (menu pop CSS), `components/overlays/ContextMenu.fit.test.tsx` (the fit contract).

### M8. Destructive verbs differ between menus

- **Where:** Edit menu, Library row, Library multi-select, folder, Library "N selected" submenu.
- **Repro:** Edit root: "Delete 1 dataset" (red). Library single row: "Delete". Library with two rows selected: "Remove", "Remove 2 selected" and "Delete permanently…" together. Folder: "Delete folder" and "Delete folder + 1 dataset(s)" (literal "(s)"). File root: "Remove all…". Trash (File > Project) says "restore deleted datasets", so "Delete" is reversible while "Delete permanently…" is not, but the single-row menu has no "Delete permanently…".
- **Screenshots:** `<shots>/c-1440-lib-dataset.png`, `c-1440-lib-multi.png`, `c-1440-lib-folder.png`, `m-six-chan-1440-Edit.png`.
- **Fix:** one vocabulary: "Move to trash" (reversible) vs "Delete permanently…" (not), same in all menus, with count in the label ("Move 2 datasets to trash"); folder: "Delete folder (keep datasets)" / "Delete folder and 3 datasets…" (real plural). Owner confirm the verbs (provisional).
- **Files:** `frontend/src/lib/datasetContextActions.ts`, `workbookContextActions.ts`, `frontend/src/components/Library/rowMenuGroups.ts`, `FolderRow.tsx`, `frontend/src/components/Shell/appMenuModel.ts` (Edit delete label).

### M9. Ctrl+N is displayed but cannot work in a browser tab

- **Where:** File > New workbook (Ctrl+N); palette.
- **Repro:** the menu shows "Ctrl+N" with no note, while Window > New graph window correctly shows "Ctrl+Shift+N (desktop app)". `BROWSER_RESERVED` (appMenuPlacement.ts:97) lists only the four window ids. `useGlobalShortcuts.ts` itself comments "Ctrl+N / Ctrl+Q are reserved by some browsers". In Chrome, Firefox and Safari Ctrl+N opens a new browser window and the page never sees the keydown.
- **Fix:** add `new-workbook` to `BROWSER_RESERVED`, or give it a non-reserved chord (provisional, owner to confirm; Ctrl+Alt+N). Related, already decided and not changed: "A, Ctrl+R" (Ctrl+R overrides reload).
- **Files:** `frontend/src/components/Shell/appMenuPlacement.ts`, `frontend/src/useGlobalShortcuts.ts`, `frontend/src/lib/shortcuts.ts`.

### M10. Result tables have no context menu; save-first friction

- **Where:** Fit Model result book (and every `resultbook` table: Statistical tests, Fit Y by X ...).
- **Repro:** run Fit model (lot-wafer-thickness: Wafer effect). Right-click a table cell, heading or section header: the browser menu (the plot menu when over the window title, see M5). Table actions exist only as header buttons: "Copy table" (enabled), "Send to report" and "Open as worksheet" (disabled before "Save result", tooltip "Save the result first; this table is then sent from the saved result."). "Add" and "Remove" in the effects panel are disabled with an empty tooltip (N1).
- **Screenshots:** `<shots>/95-fitmodel-result.png`.
- **Compare:** JMP's report right-click on a table: Make into Data Table, Make into Matrix, Table Style, Copy, Export; Origin's result sheet offers the standard worksheet menu.
- **Fix:** add a table menu (Copy table, Copy with column headers, Copy as TSV/LaTeX, Open as worksheet, Send to report, Export CSV…); for tables, let "Open as worksheet" run without a prior save (or say so in the button's visible label "Save, then open as worksheet").
- **Files:** `frontend/src/components/workshops/resultbook/*`, `workshops/fitmodel/FitModelPanel.tsx`.

---

## P2

### N1. Disabled with no reason

Location (reason is the empty string in `title`): Library row "Move up" / "Move down" and "Plot (make active)" on the active row; worksheet cell and row menus "Unmask all rows"; plot curve menu "Move earlier (draw under)" / "Move later (draw over)"; axis-title menu "Reset position" / "Reset format"; plot-window "Rebind to" item for the current dataset; Fit Model "Add" / "Remove". Screenshots: `<shots>/c-1440-axis-x-title.png`, `c-1440-ws-cell.png`, `c-1440-lib-dataset.png`. Fix: every disabled item gets a reason ("First item", "No masked rows", "Already at its default"), enforced by a unit test that walks the builders. Files: `lib/datasetContextActions.ts`, `lib/plotMenu.ts`, `components/Stage/worksheet/WorksheetMenus.tsx`, `lib/curveContextActions.ts`, `workshops/fitmodel/*`.

### N2. Reason wording and reachability

Same state ("no active worksheet") is worded three ways: "Import or select a dataset first" (File, Data, Plot, Insert, Window), "Needs an active worksheet" (every Analyze item, `<shots>/m-empty-1440-Analyze.png`), "No datasets yet: import one first" (Export consolidated CSV, Recalculate now). Disabled rows use the native `disabled` attribute, so arrow keys skip them and the reason (in `title`) is never reachable by keyboard or screen reader. Fix: one phrase table in `menuAvailability.ts`; use `aria-disabled` with `aria-describedby` and keep items focusable (ARIA authoring practice for menus); show the reason in a status line on focus. Files: `commands/menuAvailability.ts`, `commands/analysisCommands.ts`, `components/overlays/ContextMenu.tsx`, `lib/menuKeyboardNav.ts`.

### N3. No state on toggles and cycles

Plot > "Toggle grid lines", "Toggle legend", "Toggle stacked layout", "Toggle statistics view", "Multi-panel fit (letterbox / fill)", "Cycle X/Y axis scale", "Cycle X/Y tick format", "Cycle density", "Cycle accent color", "Recalc mode (cycle auto → manual → none)", Window > "Window background (theme / light / dark)" and "Link window group (1 / 2 / 3 / off)" show no current value, while the plot context menu shows "Grid lines ✓" and "Legend ✓" for the same state. `commands/plotCommands.ts:204-218` registers grid and legend without `checked`. Fix: `checked` for the toggles; for cycles either a flyout of radio items (Linear / Log / Reciprocal) or the current value in the label ("Y scale: log"). Files: `commands/plotCommands.ts`, `plotLayoutCommands.ts`, `plotStyleCommands.ts`, `commands/dataCommands.ts`, `components/windows/useWindowCommands.ts`.

### N4. Plot > Axes and Plot > Display grouping

Axes has 15 rows in this order: Cycle Y scale, Cycle Y tick format, Back to previous view, Forward to next view, Cycle X scale, Cycle X tick format, Exchange X–Y axes, Link X axis with…, Link Y axis with…, Axis…, Y axis settings…, Log Y, Linear Y, Log X, Linear X. X and Y are interleaved, view history (Back/Forward, Alt+←/→) is not an axis setting, the four Log/Linear rows duplicate the cycles, and "Axis…" does not say which axis. Display mixes Plot type…, Toggle statistics view, Magnifier inset with six template rows (Save graph template…, Apply graph template…, Set as default for new graphs…, Apply graph template to graphs…) and the format painter (Copy format, Paste format, Paste format to graphs…). Screenshots: `<shots>/m-six-chan-1440-Plot__Axes.png`, `m-six-chan-1440-Plot__Display.png`. Fix (provisional, owner to confirm): Axes = X scale ▸ (Linear/Log/Reciprocal), Y scale ▸, X ticks ▸, Y ticks ▸, Link…, Exchange, Axis settings… (X), (Y); History to Plot root or View; Display = view toggles; new "Templates & format" flyout. Files: `components/Shell/appMenuPlacement.ts`, `commands/plotCommands.ts`, `plotLayoutCommands.ts`.

### N5. Analyze grouping and label length

- "Curve fit…" (F) and "Peak analyzer…" appear both at Analyze root and inside Fit and Peaks & baseline.
- "Optical gap (Tauc plot)…" is under Fit; "SIMS depth profile…", "Film thickness (FFT)…" and "Reflectivity FFT…" are under "Transform & signal"; "Magnetometry" is a flyout of two items.
- Map tools split (M4). DOE and Profiler sit in Statistics (JMP gives DOE its own top-level menu; Origin has none): provisional, owner to confirm.
- Two statistics labels exceed the flyout width and truncate with an ellipsis that looks like the label's own: "Statistical tests (normality · paired · Dunnett · regression · pow…" and "Design of experiments (factorial · screening · response surfac…" at 1280x720 (`<shots>/m-six-chan-1280-Analyze__Statistics.png`).
- Fix: remove the root duplicates or the flyout copies; keep detail text in the description; labels ≤ 40 characters; move spectroscopy / reflectometry / SIMS items to their domain flyouts.
- Files: `components/Shell/appMenuPlacement.ts`, `commands/analysisCommands.ts`, `commands/commandDocs.ts`.

### N6. Label hygiene

- Title Case in a sentence-case product: context item "Plot Details…", window title "Fit Model" (DOE and Curve fit are sentence case), "Graph Builder", "Static (Origin) legend".
- Parenthesis after the ellipsis: "Export worksheet… (CSV, TSV, Excel)", "Export page… (spatial, true page coords)".
- Same action, different words: PNG export is "Export PNG…" (File), "Save as PNG" (plot menu), "Save PNG" (toolbar overflow), plus "Export figure…" and "Export figure (quick dialog)…"; "Draw Arrow" (toolbar overflow) vs "Arrow" (Insert); "Hide series" (curve menu) vs "Hide" (legend entry menu); "Legend…" (Plot > Curves & legend) vs "Legend formatting…" (context); "Polar plot" (toolbar) vs "Polar" (plot type).
- Context menu root "Tools ▸" (Integrate, Peak / FWHM, Gadget, Measure) shares its name with the top-level Tools menu (calculators, digitizer).
- Fix: sweep to sentence case, ellipsis last, one phrase per action; extend `menuModel.ux10.test.tsx`'s ratchet to context-menu builders.
- Files: `lib/plotMenu.ts`, `lib/curveContextActions.ts`, `commands/fileCommands.ts`, `commands/discoveryCommands.ts`, `components/overlays/ToolWindowFrame.tsx` (title), `workshops/fitmodel/FitModelPanel.tsx`.

### N7. Data menu and column header menu

- "Transpose worksheet…" is under "Combine & split". "Merge selected datasets", "Combine…", "Join datasets by key…" and "Dataset math (combine two datasets)…" are four words for related operations.
- "Sort worksheet…", "Insert column", "Add new column", "Delete column", "Fill column with ▸", "Number format…", Conditional format, Modeling type exist only in the column header menu; none is in the Data menu, and "Sort worksheet" is not in the palette either (palette "sort" lists Pareto first).
- The header menu has 33 rows with three sort entries (Sort ascending, Sort descending, "View sorted ascending (data unchanged)", then "Sort worksheet…"), two hides ("Hide from plot", "Hide column"), "Insert column" vs "Add new column".
- Missing against Origin: Copy / Cut / Paste column, Duplicate column, Set As ▸ is present; Origin's right-click also has "Plot ▸" (type). "Plot selection" has no plot-type choice.
- Screenshot: `<shots>/c-1440-ws-colheader.png`. Fix: group the header menu (Sort ▸, Hide & freeze ▸, Format ▸, Fill ▸), de-duplicate Insert/Add, add Data > "Sort worksheet…", "Add column…". Files: `components/Stage/worksheet/WorksheetMenus.tsx`, `commands/dataCommands.ts`, `components/Shell/appMenuPlacement.ts`.

### N8. Worksheet corner, row header and toolbar overflow

- The corner "#" cell has no menu (native menu); the row-header and "new row" (italic 11) menus omit Cut / Copy / Paste and Select row, and the row menu's "Delete row" (destructive) is adjacent to "Insert row above" with no separator. `<shots>/c-1440-ws-corner.png`, `c-1440-ws-rowheader.png`.
- The worksheet toolbar's "⋯" (aria "Toolbar options", tooltip "More worksheet actions that don't fit this window") opens a popover that only says "⧟ Linked to plot / vars: x · A · B · C · D · E · F". It contains no actions: it is an info chip behind an overflow icon. `<shots>/c-1440-ws-overflow.png`. Fix: show the link chip inline and hide "⋯" until something overflows, or put real overflow actions in it.
- "Columns ▾" menu items ("Hide column [select a column first]") duplicate the header menu with different disabled wording.
- Files: `components/Stage/worksheet/WorksheetMenus.tsx`, `WorksheetToolbar.tsx` (line ~332).

### N9. Library menus

- Right-click on empty Library space and on the Plot / Map / Worksheet / Workflow stage tabs: native menu. Origin and JMP offer New folder / Import there, and Rename / Close / Duplicate on window tabs.
- "Quick Plot" is disabled with "unrecognized data — choose Configure Quick Plot…" for an ordinary multi-column CSV. The wording blames the user's data; say "Needs a recognized technique; Configure Quick Plot… assigns columns".
- Row submenu "Derive and combine ▸ Create derived worksheet" does not say what is derived.
- Possible bug seen in passing (not menu related): after "Move ▸ New folder with this…" the dataset still lists at top level while the folder badge reads "1" (`<shots>/40-folder-expanded.png`). Verify before filing.
- Files: `components/Library/LibraryWorkspace.tsx`, `lib/datasetContextActions.ts`, the stage tab strip (find the `qzk-tab` owner with grep).

### N10. Aux-figure stages (hexbin, KDE, Pareto, parallel, Bland-Altman, polar map)

- Right-click the rendered image: browser menu ("Save image as…" yields the screen PNG, bypassing the PDF/SVG default). A Library-style menu with Export, Copy figure, Send to report is missing.
- Their Format select offers PDF | SVG | PNG while File > Export figure offers PDF, SVG, PNG, TIFF, EPS; the value reads "PDF" here and "pdf" in the Export figure dialog (`<shots>/72-pareto-Export-PDF-.png`).
- The plot toolbar is replaced by one or two unlabeled floating icon buttons (view switcher); no menu names them (`<shots>/90-polar-toggle-icons.png`).
- Files: `components/workshops/plots2/Plots2Stage.tsx`, `Plots2Controls.tsx`, `workshops/polarmap/PolarMapStage.tsx`, `components/Stage/PolarStage.tsx`.

### N11. Selects: defaults and options

- Pareto: "Category column" defaults to the first column (Time, numeric) so the bars are labelled 9, 8, 7 ... (`<shots>/72-pareto-Export-PDF-.png`); default to the first text/categorical column, else say "Needs a category column".
- Fit Model, Statistical tests: "Response (Y)" and the Column list offer "Sample Index" (the synthetic 1..N row index) and text columns as responses (`<shots>/80-Fit-model-least-squares-.png`); filter by role and type.
- Colormap select in all aux figures has 4 options with raw lowercase ids (viridis, magma, gray, rdbu); the map toolbar has its own list; unify names and add a swatch.
- KDE bandwidth option text reads "Scott's rule (provisional)": process language in the option label.
- Polar map defaults Tilt = second column and Azimuth = first (reverse of column order) (`<shots>/90-polarmap.png`); provisional, owner to confirm the convention.
- Appearance popover (title-bar gear): Theme "system", Accent "violet", Density "regular" in lowercase native selects, no swatch for accent, popover has no role or Esc focus return check (`<shots>/91-appearance.png`).
- Worksheet column type chip: `auto·C | Cont | Ord | Nom` is cryptic; JMP shows icons with full names.
- Files: `workshops/plots2/Plots2Controls.tsx`, `usePlots2.ts`, `workshops/polarmap/*`, `workshops/fitmodel/*`, `workshops/statstests/*`, `components/Shell/AppearancePanel.tsx`, `components/Stage/worksheet/ColumnTypeSelect.tsx`.

### N12. Process text and spelling in user-facing copy

- DOE window shows "Centre-point and randomisation defaults are provisional (owner to confirm): the published counts for response-surface designs (NIST e-Handbook Table 3.28) ..." to end users, and in British spelling (`<shots>/82-empty-Design-of-experiments-.png`). The owner confirmation belongs in `OPEN_ITEMS.md`; the window should say what the default is and why.
- UX12 made user text American, yet aux-figure controls and command descriptions still read "Colour by", "optionally coloured by a column", "log colour scale" (`workshops/plots2/Plots2Controls.tsx:74`, `commands/analysisCommands.ts`, palette descriptions for Parallel coordinates, Hexbin, Ternary). British forms must stay only as palette synonyms.
- Files: `workshops/doe/DoeSetup.tsx` (line 109), `workshops/plots2/Plots2Controls.tsx`, `commands/analysisCommands.ts`, `lib/plotTypes.ts`.

### N13. Accessibility

- `role="menu"` containers have no accessible name (no `aria-label` / `aria-labelledby`); the shortcut spans are `aria-hidden` and the buttons carry no `aria-keyshortcuts`.
- Disabled items are unfocusable (N2). Submenu parents correctly expose `aria-haspopup`/`aria-expanded`; checkable items use `menuitemcheckbox`.
- The Analysis Center strip (Recommended / Recent / Favorites / All tools / Statistics workspace / Existing results) is made of buttons without `role="tab"` (`getByRole("tab")` finds none).
- No Alt-letter or F10 access to the menu bar (Alt+F, F10: no effect); desktop users on Windows expect it (provisional, owner to confirm).
- Works: ArrowDown opens, Home/End, type-ahead, Left/Right between menus, Esc returns focus to the trigger, Shift+F10 / ContextMenu key work on the Library, worksheet and plot; focus returns to the menu-bar trigger after a dialog opened from a menu closes.
- Files: `components/overlays/ContextMenu.tsx`, `ContextMenuBoxes.tsx`, `components/Shell/MenuBar.tsx`, `workshops/analysiscenter/*`.

### N14. Dark theme contrast

Disabled menu rows use opacity 0.4 over a 0.78-alpha glass background: effective contrast about 2:1, below WCAG AA even though these are the rows that carry the explanatory reason; the translucent popup lets the plot toolbar show through (`<shots>/d-1440-edit.png`, `d-1440-plot-ctx.png`). Light theme is acceptable. Fix: raise the disabled color token instead of reducing opacity; make the popup 0.94+ opaque. Files: `frontend/src/styles/shell.css:93` (`.qzk-menu-item:disabled { opacity: 0.4 }`) and the `.qzk-menu-pop` rule.

### N15. Command palette

- No result for "pole figure", "stereographic", "Schmidt"; "levelling" returns "Take over editing" (British spelling no longer a synonym for Map operations); "capability" and "weibull" only find the monolithic Statistical tests row (M3).
- A disabled command shows its reason in place of its description (for example "Map operations…" shows "Needs a 2-D map (x, y, intensity)"), so a user who cannot enable it cannot learn what it does; show both.
- Palette-only commands without a menu home: Derivative ×3, Integrate, Smooth…, Detrend…, FFT, Filter (frequency domain), Cross-correlation…, Despike, Median filter… (all duplicated by "Signal processing…", but reachable directly only here), plus "Error bars…" and "Configure Quick Plot…". Decision for the owner (provisional): keep as palette shortcuts and say so in "Signal processing…", or add a "Quick operations ▸" flyout.
- Files: `commands/legacyLabels.ts`, `commands/commandDocs.ts`, `components/overlays/CommandPalette.tsx`, `lib/paletteSynonyms.ts`, `lib/paletteRank.ts`.

### N16. Overflow menus and window chrome

- Plot toolbar overflow (Export, Group labels) and the narrow plot-window overflow (Analyze / Annotate / View / Export, 19 rows) show glyph icons; the menu bar and context menus do not (`<shots>/20-toolbar-overflow.png`, `c-1440-win-overflow-narrow.png`). Pick one style.
- Plot window title bar prints the dataset name twice ("two-pe…" truncated, then "two-peaks.csv"); seven unlabeled icon buttons (rebind, save editable figure, link group, pin, background, maximize, close) rely on tooltips (`<shots>/93-new-window.png`).
- The title-bar right-click menu is good and complete; mirror its Duplicate / Pin / Rebind entries in Window > Active window.
- Files: `components/windows/WindowTitleButtons.tsx`, `WindowTitleMenu.tsx`, `components/Stage/PlotStageMenus.tsx`.

### N17. "DiraCulator" vs "Calculators"

Menu and Analysis Center: "DiraCulator — materials calculators…"; title-bar button and window title: "Calculators". Pick one name (provisional, owner to confirm). Files: `commands/analysisCommands.ts`, the calculators window title (`grep -rn "Calculators" frontend/src/components`).

### N18. Shortcuts

- Redo is Ctrl+Shift+Z only; Ctrl+Y (Windows, Origin) is not bound. Edit > Find in project… has no chord (Ctrl+F is the habit; the browser's own find would still need a decision, provisional, owner to confirm).
- F, Y, P, A are bare-letter shortcuts for Curve fit, Hysteresis, Find peaks, Autoscale: displayed in the menu, but only the Keyboard shortcuts sheet explains they work only outside fields.
- No duplicate chords were found across the 29 commands that declare one.
- Files: `useGlobalShortcuts.ts`, `lib/shortcuts.ts`, `commands/editClipboardCommands.ts`.

---

## Positive checks (nothing to fix)

- No flyout clips off-screen at 1440x900, 1280x720, 1280x600, 1024x640 and 1280x480 (File > Export, 24 rows, compresses rows below ~545 px of height instead of clipping); all flyouts flip or shift correctly.
- Menu-bar keyboard behaviour, focus return and dialog focus return pass (N13 lists the gaps).
- Disabled map items give a reason ("Needs a 2-D map (x, y, intensity)", "Needs a 2θ X axis"); DOE and Profiler correctly stay enabled with no data.
- Curve fit's Model select uses optgroups and is the pattern to copy for M3.

## Proposed fix lanes (disjoint files)

Each lane owns the files named; cross-lane items are marked.

### Lane A: menu bar model, placement, commands and palette

Findings: M1 (availability rule, export routing), M2 (menu homes, palette entries), M3 (commands and menu entries only), M9, N2 (phrase table), N3, N4, N5, N6 (command labels), N7 (Data menu), N15, N17, N18 (command side).
Files: `frontend/src/components/Shell/appMenuPlacement.ts`, `appMenuModel.ts`, `frontend/src/commands/{menuAvailability,analysisCommands,plotCommands,plotLayoutCommands,plotStyleCommands,dataCommands,fileCommands,discoveryCommands,commandDocs,legacyLabels,editClipboardCommands}.ts`, `frontend/src/lib/{figureSpecStage,shortcuts}.ts`, `frontend/src/components/windows/useWindowCommands.ts`, `frontend/src/components/overlays/CommandPalette.tsx`, the calculators title (N17).
Needs the owner first (provisional): Charts flyout rename, Quality & reliability flyout, Maps flyout, DOE's home, chord for New workbook.

### Lane B: context-menu producers, results, maps and windows

Findings: M4 (map menu and Library map entries), M5, M6, M7 (menu content), M8, M10, N1, N7 (header menu), N8, N9, N10 (image-stage menu), N16 (window menu).
Files: `frontend/src/lib/{plotMenu,curveContextActions,contextActions,datasetContextActions,workbookContextActions}.ts`, `frontend/src/components/Stage/{PlotContextMenu,PlotStageMenus,useStageContextMenu,MapStage,MapToolbar}.tsx`, `frontend/src/components/Stage/worksheet/{WorksheetMenus,WorksheetToolbar}.tsx`, `frontend/src/components/Library/*` (row and folder menus), `frontend/src/components/windows/{WindowTitleButtons,WindowTitleMenu}.tsx`, `frontend/src/components/overlays/ToolWindowFrame.tsx`, `ToolWindowTitleButtons.tsx`, `frontend/src/components/workshops/resultbook/*`, `workshops/plots2/Plots2Stage.tsx`, `workshops/polarmap/PolarMapStage.tsx`.

### Lane C: selects, dialogs and workshop copy

Findings: M2 (gallery grouping), M3 (select optgroups), N6 (window titles), N10 (format select), N11, N12, N13 (Analysis Center tab roles).
Files: `frontend/src/components/overlays/figuredialogs/PlotTypeGallery.tsx`, `frontend/src/lib/{plotTypes,figureDialogActions,statsTests,statsTestsSpc,statsTestsLife,statsTestsMore}.ts`, `frontend/src/components/workshops/{statstests,plots2,polarmap,fitmodel,doe,profiler,analysiscenter}/*` (except the two stage files in lane B), `frontend/src/components/Shell/AppearancePanel.tsx`, `frontend/src/components/Stage/worksheet/ColumnTypeSelect.tsx`.

### Lane D: menu primitives, accessibility and theme

Findings: M7 (row compression and scroll), N2 (focusable disabled items), N13 (menu names, `aria-keyshortcuts`, Alt / F10), N14, N16 (glyph style), N18 (Ctrl+Y binding).
Files: `frontend/src/components/overlays/{ContextMenu,ContextMenuBoxes,ContextMenuLazy,contextMenuTypes,contextMenuHelp}.ts(x)`, `frontend/src/lib/menuKeyboardNav.ts`, `frontend/src/components/Shell/MenuBar.tsx`, `frontend/src/useGlobalShortcuts.ts`, menu CSS in `frontend/src/styles/shell.css`.
Lane D must land first or share the `disabled`/`aria-disabled` item contract with lane A and lane B (the item type lives in `contextMenuTypes.ts`).

Lanes A, B and C touch disjoint files; D overlaps nothing but defines the item contract that A and B consume (N2).

## Owner decisions raised (provisional, owner to confirm)

1. Rename "Build & export" to "Charts" and where the chart types live (M2).
2. A "Quality & reliability" Analyze flyout for SPC and life tests (M3), and DOE as its own menu (N5).
3. An Analyze "Maps" flyout (M4).
4. Trash vocabulary for Library deletes (M8).
5. Chord for New workbook; Ctrl+Y; Alt / F10 menu access (M9, N13, N18).
6. Whether palette-only signal commands get a menu home (N15).
7. One name for the calculators (N17).
8. Polar-map default column order (N11).
