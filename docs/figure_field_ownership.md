# Figure field ownership

`PRIMARY_SOFTWARE_AUDIT_PLAN.md` (~line 9676): "Document one ownership path
per field before deleting adapters." This is that document. It is generated
from the field-classification census in `frontend/src/lib/figureContract.ts`
(the `FIGURE_FIELD_CONTRACTS` object) plus a grep of every module that writes
each field, not from memory — see `figureFieldOwnershipDoc.test.ts` for the
guard that keeps it from drifting.

## Scope

`figureContract.ts` classifies every field of five figure-authoring models.
Only fields classified `"canonical"` — the ones the file's own doc comment
says exist to "persist the editable value losslessly" — have an independent,
persisted storage location at all. Every other classification
(`recipe-only`, `derived`, `export-only`, `unsupported`) is, by definition,
*computed* from a canonical field rather than stored a second time, so it has
nothing to "own." The canonical set is exactly two contracts:

- `PLOT_VIEW_FIELD_CONTRACT` — all 51 fields of `PlotView` (checked by
  `figureContract.test.ts`'s "keeps PlotView as the canonical editable-state
  foundation" spec).
- `FIGURE_DOC_FIELD_CONTRACT` — 5 of `FigureDoc`'s 6 fields (`id`, `name`,
  `datasetId`, `live`, `dataSnapshot`; `config` is `derived`).

Those 56 fields are the "persisted figure/plot-view fields" this document
covers, one row each, below.

## The two representations

A figure has exactly one **durable** representation, `FigureDocument`
(`lib/figureDocument.ts`) — `bindings.*` for the channel/error bindings,
`plot.view.*` for everything else (`FigureViewState` is `PlotView` minus the
six binding fields), plus `id`/`name`/`data.*`/`output.*`/`publication.*` at
the top level. Everywhere else a field is edited live, it is edited through a
**facade**: the `PlotView`-shaped singleton fields on the Zustand `AppState`
(`store/useApp.ts`) for the focused MDI plot window, or a `FigureDocument`
"draft" clone for a Publication Preview / Figure Builder session
(`figurePublicationSession.draft`). Both facades are synced back to the
durable document through one of the two chokepoints below — nothing else may
write `window.document` or read it piecemeal (see `withPlotWindowDocument`'s
own doc comment in `windowDocuments.ts`).

Note: `figureContract.ts`'s `mapsTo` strings (e.g. `"axes.y.scale"`) describe
an **aspirational**, more finely-nested future document schema, not the
literal current one — today every `plot.view.*` field is a flat, same-named
passthrough of `PlotView`, not nested under `axes`/`legend`/`decor`/etc. The
table cites both: `mapsTo` (the contract's intent) and "Owner today" (the
real current path), so a future schema migration has one place that lists
every field it must move.

## Adapter legend

Every row below is written through one or more of these. **Bridge** applies
to all 56 fields and is not repeated per row.

| Tag | What it is |
|---|---|
| **Bridge** | `lib/figureDocument.ts` (`createFigureDocument`, `figureDocumentToPlotView`, `updateFigureDocumentFromPlotView`, `sanitizeFigureDocument`) + `store/windowDocuments.ts` (`syncPlotWindow`, `withPlotWindowDocument`, `createPlotWindowDocument`, `plotWindowView`). The one sanctioned document ↔ live-window-facade sync path. |
| **Setter** | The one single-field Stage/menu action that writes the live `AppState` singleton (named per row; lives in `store/plotViewSettings.ts` unless noted). |
| **Bulk** | A whole-view constructor that assigns many fields at once, then feeds the result through Bridge like any other edit: `store/viewAppliers.ts` (`applyOriginFigure` / `facetByColumn` / `breakAtGaps`) and/or `store/plotRecipeApply.ts` (`viewFromResolved`, applying a saved Plot Recipe). |
| **Reset** | `store/windowDefaults.ts`'s `datasetViewDefaults`, applied only on a genuine dataset switch (never a same-dataset reimport). |
| **Builder** | `store/figureLifecycle.ts`'s `patchFigurePublicationDraft`/`applyFigurePublicationEdit`, driven by `useFigureBuilder.ts`'s `setCanonicalView`/`setCanonicalOutput` — patches `draft.plot.view`/`draft.output` **directly**, bypassing Bridge, because a Publication Preview draft is a bare `FigureDocument` clone with no `PlotWindow`/live-singleton facade to sync from. `applyFigurePublicationEdit` is the one place the draft is later folded back onto the real document. |
| **Legacy-shape** | Only `errKeys`: a second, older *shape* for the same information (see below). |

## PlotView canonical fields (51)

| Field | `mapsTo` (contract intent) | Owner today (code) | Writer(s) | Removable? |
|---|---|---|---|---|
| `yScale` | `axes.y.scale` | `plot.view.yScale` | Setter `setYScale`; Bulk | no |
| `xScale` | `axes.x.scale` | `plot.view.xScale` | Setter `setXScale`; Bulk | no |
| `showGrid` | `axes.grid.visible` | `plot.view.showGrid` | Setter `setShowGrid`; Bulk (Origin's fixed `ORIGIN_FIGURE_AXIS`) | no |
| `showLegend` | `legend.visible` | `plot.view.showLegend` | Setter `setShowLegend`; Bulk | no |
| `legendPos` | `legend.presetPosition` | `plot.view.legendPos` | Setter `setLegendPos`; Bulk | no |
| `legendXY` | `legend.plotPosition` | `plot.view.legendXY` | Setter `setLegendXY` (`store/pointerTool.ts`); Bulk (Origin via `originLegendState`) | no |
| `legendFrameXY` | `legend.framePosition` | `plot.view.legendFrameXY` | No direct setter — cleared as a side effect of `setLegendXY`; Bulk (Origin via `originLegendState`) only writer of a non-null value | no |
| `legendStatic` | `legend.static` | `plot.view.legendStatic` | Setter `setLegendStatic`; Bulk (Recipe, Origin's `ORIGIN_FIGURE_AXIS`) | no |
| `legendTitle` | `legend.title` | `plot.view.legendTitle` | No direct Stage setter; Bulk (Recipe, Origin via `originLegendState`) is the only writer | no |
| `axisLabelOffsets` | `axes.labelOffsets` | `plot.view.axisLabelOffsets` | Setter `setAxisLabelOffset` (`store/pointerTool.ts`, drag-commit) | no |
| `axisLabelStyles` | `axes.labelStyles` | `plot.view.axisLabelStyles` | Setter `setAxisLabelStyle` (`store/pointerTool.ts`) | no |
| `plotTemplate` | `style.templateId` | `plot.view.plotTemplate` | Setter `setPlotTemplate`; Bulk (Recipe) | no |
| `showAxisBox` | `axes.box.visible` | `plot.view.showAxisBox` | Setter `setShowAxisBox`; Bulk (Origin's `ORIGIN_FIGURE_AXIS`) | no |
| `stackMode` | `plot.stack.enabled` | `plot.view.stackMode` | Setter `setStackMode` (also clears `facetKey`/`composition`); Bulk (Recipe, Origin, `facetByColumn` sets it true) | no |
| `insetMode` | `plot.inset.enabled` | `plot.view.insetMode` | Setter `setInsetMode` | no |
| `polarMode` | `plot.coordinateSystem` | `plot.view.polarMode` | Setter `setPolarMode` | no |
| `statMode` | `plot.statMode` | `plot.view.statMode` | Setter `setStatMode` | no |
| `statHideEmptyLevels` | `plot.stat.hideEmptyLevels` | `plot.view.statHideEmptyLevels` | Setter `setStatHideEmptyLevels` (`store/statLevelOptions.ts`) | no |
| `statShowGroupN` | `plot.stat.showGroupN` | `plot.view.statShowGroupN` | Setter `setStatShowGroupN` (`store/statLevelOptions.ts`) | no |
| `statMarks` | `plot.stat.marks` | `plot.view.statMarks` | Setter `setStatMarks` (`store/statLevelOptions.ts`, per-mode merge) | no |
| `xLim` | `axes.x.limits` | `plot.view.xLim` | Setter `setXLim` (clears `xStep`); Bulk | no |
| `yLim` | `axes.y.limits` | `plot.view.yLim` | Setter `setYLim` (clears `yStep`); Bulk | no |
| `xStep` | `axes.x.step` | `plot.view.xStep` | No direct setter, cleared by `setXLim`; Bulk (Recipe, Origin tick-spacing decode) only writer | no |
| `yStep` | `axes.y.step` | `plot.view.yStep` | No direct setter, cleared by `setYLim`; Bulk (Recipe, Origin decode) only writer | no |
| `xFmt` | `axes.x.format` | `plot.view.xFmt` | Setter `setXFmt`; Bulk (Recipe) | no |
| `yFmt` | `axes.y.format` | `plot.view.yFmt` | Setter `setYFmt`; Bulk (Recipe) | no |
| `y2Fmt` | `axes.y2.format` | `plot.view.y2Fmt` | Setter `setY2Fmt`; Bulk (Recipe) | no |
| `plotTitle` | `title.text` | `plot.view.plotTitle` | Setter `setPlotTitle` | no |
| `xAxisLabel` | `axes.x.label` | `plot.view.xAxisLabel` | Setter `setXAxisLabel`; Bulk (Origin) | no |
| `yAxisLabel` | `axes.y.label` | `plot.view.yAxisLabel` | Setter `setYAxisLabel`; Bulk (Origin) | no |
| `xKey` | `bindings.x.channel` | **`bindings.xKey`** | Setter `setXKey`; Reset; Bulk (Recipe, Origin) | no — facade mirror is intentional (P1.5), see note |
| `yKeys` | `bindings.y.channels` | **`bindings.yKeys`** | Setter `setYKeys`; Reset; Bulk (Recipe, Origin) | no — facade mirror is intentional, see note |
| `groupKey` | `bindings.group.channel` | **`bindings.groupKey`** | Setter `setGroupKey`; Reset; Bulk (Recipe) | no — facade mirror is intentional (P1.5), see note |
| `facetKey` | `bindings.facet.channel` | **`bindings.facetKey`** | No direct setter — written only by `facetByColumn`; cleared by `setStackMode`/`breakAtGaps`/a background-window rebind; Reset; Bulk (Recipe, Origin) | no — facade mirror is intentional (F4.4), see note |
| `y2Keys` | `bindings.y2.channels` | **`bindings.y2Keys`** | Setter `setY2Keys` (also clears `y2Lim`/`y2Scale`/`y2Step`/`y2AxisLabel` when emptied); Reset; Bulk (Recipe, Origin) | no — facade mirror is intentional, see note |
| `y2Lim` | `axes.y2.limits` | `plot.view.y2Lim` | Setter `setY2Lim` (clears `y2Step`); Bulk (Recipe, Origin) | no |
| `y2Scale` | `axes.y2.scale` | `plot.view.y2Scale` | Setter `setY2Scale`; Bulk (Recipe, Origin) | no |
| `y2Step` | `axes.y2.step` | `plot.view.y2Step` | No direct setter, cleared by `setY2Lim`/`setY2Keys`; Bulk (Recipe, Origin decode) only writer | no |
| `y2AxisLabel` | `axes.y2.label` | `plot.view.y2AxisLabel` | Setter `setY2AxisLabel`, cleared by `setY2Keys(empty)`; Bulk (Origin) | no |
| `refLines` | `decor.referenceLines` | `plot.view.refLines` | Setter `addRefLine`/`removeRefLine`/`updateRefLine`; Bulk (Recipe re-mints ids via the same `nextRefLineId()` counter) | no |
| `annotations` | `decor.annotations` | `plot.view.annotations` | Setter `addAnnotation`/`removeAnnotation` + `updateAnnotation` (`store/pointerTool.ts`); Bulk (Recipe, Origin) | no |
| `regionShades` | `decor.regionShades` | `plot.view.regionShades` | Setter `addRegionShade`/`updateRegionShade`/`removeRegionShade` (`store/regionShades.ts`); Bulk (Recipe, Origin) | no |
| `shapes` | `decor.shapes` | `plot.view.shapes` | Setter `addShape`/`updateShape`/`removeShape`/`clearShapes` (`store/shapes.ts`); Bulk (Recipe) | no |
| `seriesStyles` | `series.styles` | `plot.view.seriesStyles` | Setter `setSeriesStyle`/`resetSeriesStyle`; Reset; Bulk (Recipe, Origin) | no (see `FIGURE_SPEC_FIELD_CONTRACT.series_styles`/`log_offsets` — those are one-way *readers*, not a second writer) |
| `seriesLabels` | `series.labels` | `plot.view.seriesLabels` | Setter `setSeriesLabel`; Reset; Bulk (Recipe, Origin) | no — but see BUG-014 note below (a known rendering divergence, not an extra adapter) |
| `errKeys` | `bindings.errors` | **`bindings.errors`** (rich); legacy `errKeys` Record is a synced facade | Setter `setErrKey` (writes the legacy Record shape); Reset (`defaultErrKeys`); Bulk (Recipe); **Legacy-shape** translation `legacyErrorBindings`/`errKeysFromBindings` (`lib/figureDocument.ts`/`lib/errorRoles.ts`) | **partial — see "Removable candidates" below** |
| `seriesOrder` | `series.order` | `plot.view.seriesOrder` | Setter `setSeriesOrder`; Bulk (Recipe) | no |
| `hiddenChannels` | `series.hiddenChannels` | `plot.view.hiddenChannels` | Setter `toggleHidden`/`soloChannel`; Reset (`originHiddenChannels`); Bulk (Recipe) | no |
| `waterfall` | `plot.waterfall.verticalOffset` | `plot.view.waterfall` | Setter `setWaterfall`; Bulk (Recipe) | no — but see BUG-013 note below (export has no wire field; not this doc's fix) |
| `panelFit` | `page.panelFit` | `plot.view.panelFit` | Setter `setPanelFit`/`cyclePanelFit`; Bulk (Origin spatial-layout apply) | no |
| `pageSetup` | `page.setup` | `plot.view.pageSetup` | Setter `setPageSetup`; Bulk (Origin's `pageSetupFromDecoded`) | no |

**Binding-field note** (`xKey`/`yKeys`/`groupKey`/`facetKey`/`y2Keys`): the
`PlotView`/`AppState` copy of these is not a redundant adapter to delete. It
is the render pipeline's own input (`usePlotPayload`, `MultiPanelStage.tsx`) —
removing it would silently stop a saved grouping/facet/channel binding from
reaching the screen after reopen, exactly the class of bug P1.5 and F4.4 (see
`figureContract.ts`'s comments on `groupKey`/`facetKey`) fixed by adding the
projection in the first place. `figureDocumentToPlotView` /
`updateFigureDocumentFromPlotView` are that projection's only two directions;
nothing else may write it.

## FigureDoc canonical fields (5)

| Field | `mapsTo` | Owner today (code) | Writer(s) | Removable? |
|---|---|---|---|---|
| `id` | `id` | `FigureDocument.id` | `createFigureDocument` (construction); `windowDocuments.ts`'s `figureIdForWindow`/`createPlotWindowDocument` (window identity); `figureLifecycle.ts`'s `duplicateEditableFigure`/`beginDetachedFigurePublicationEdit` (mint a fresh id via `nextFigureId`) | no |
| `name` | `name` | `FigureDocument.name` | `createFigureDocument`; `updateFigureDocumentFromPlotView`'s `input.name`; `figureLifecycle.ts`'s `renameEditableFigure`/`saveFigureAs` | no |
| `datasetId` | `bindings.datasetId` | `FigureDocument.bindings.datasetId` | `createFigureDocument`; `syncPlotWindow`'s `options.datasetId` (rebind); `windowDocuments.ts`'s `pruneWindowDatasetRefs` (dataset deletion) | no |
| `live` | `data.mode` | `FigureDocument.data.mode` | `createFigureDocument`'s `input.data`; `lib/figureDocumentPublication.ts` (legacy `FigureDoc` → `FigureDocument` migration, live vs. frozen) | no |
| `dataSnapshot` | `data.snapshot` | `FigureDocument.data.snapshot` | `createFigureDocument`'s `input.data.snapshot`; `lib/figureDocumentPublication.ts` (migration) | no |

## The other three contracts, briefly

`PLOT_SPEC_FIELD_CONTRACT` (`PlotSpec`), `FIGURE_CONFIG_FIELD_CONTRACT`
(`FigureConfig`), and `FIGURE_SPEC_FIELD_CONTRACT` (`FigureSpec`) have **no**
`"canonical"` fields at all — every field is `recipe-only`, `derived`,
`export-only`, or `unsupported`. By the contract's own definition that means
each is computed on demand from the canonical fields above, by exactly one
deriving function, so there is nothing to "own" a second time:

- `PlotSpec` blocks are committed into a `FigureDocument` by
  `useGraphBuilder`'s `markSeriesStyle`/commit path (Graph Builder), never
  read back out as a second source of truth.
- `FigureConfig` is a legacy publication projection generated from a document
  by `lib/figureCompatibility.ts`.
- `FigureSpec` is the one-way backend export request, built by
  `lib/figureSpec.ts`'s `buildFigureSpecFromDocument`.

Two divergences already tracked elsewhere (P4.2's regression matrix,
BUG-013/BUG-014/BUG-016) are about these *derived* projections disagreeing
with the canonical `plot.view` state at render/export time — they are bugs in
the one-way deriving function, not a second adapter to delete, and are out of
scope for this document.

## Removable candidates

- **`errKeys` legacy shape.** `PlotView.errKeys` (`Record<channel,
  errChannel>`, symmetric-Y only) duplicates `FigureDocument.bindings.errors`
  (`ErrorBinding[]`, which can also express X-axis and asymmetric roles).
  `legacyErrorBindings`/`errKeysFromBindings` (`lib/figureDocument.ts` /
  `lib/errorRoles.ts`) keep the two in sync in both directions on every
  Bridge round-trip. Some consumers already read `bindings.errors` directly
  and no longer need the legacy shape (`components/windows/BackgroundPlotWindow.tsx`,
  `components/Stage/PlotStage.tsx`). The one remaining *writer* of the legacy
  shape as primary data is `setErrKey` (`store/plotViewSettings.ts`).
  Removable once `setErrKey` is rewritten to construct an `ErrorBinding` and
  write `bindings.errors` directly — not done here, since that changes the
  Stage's error-picker call site, out of scope for a documentation-only item.
- **Builder's direct document patch.** `setCanonicalView`/`setCanonicalOutput`
  (`useFigureBuilder.ts`, via `figureLifecycle.ts`'s
  `patchFigurePublicationDraft`) duplicate, in spirit, what
  `updateFigureDocumentFromPlotView` already does for a live window — both
  end up merging a partial view/output patch onto a `FigureDocument`. They
  cannot be unified today because a Publication Preview draft is a bare
  document with no `PlotWindow`/`AppState` singleton to run Bridge's
  `syncPlotWindow` against. Flagged as a future consolidation opportunity
  (give the draft session its own throwaway `PlotWindow`), not acted on here.

No other duplicate adapter was found for any of the 56 canonical fields: each
has exactly one Bridge sync path, and its Setter/Bulk/Reset writers are
alternative *sources* of a new value (a menu edit vs. an Origin import vs. a
recipe apply vs. a dataset switch), not competing *destinations* — writing
the same `AppState`/document field once each, never two representations of
the same field at rest.
