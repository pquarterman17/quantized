# Row Range, Named Range, Mirror Column and Cell Note Contract

The design contract for items 31 (row-range views) and 34 (named ranges, mirror columns, cell notes) of
`ORIGIN_FEATURE_GAP_PLAN.md`, written before any code, as the owner asked on 2026-11-26. Four things that look alike
stay four things: a spatial region, a contiguous row range, an exclusion mask and a materialized subset. This
document says what each is, how a row range survives sort, filter, insert and delete, how named ranges, mirror
columns and cell notes join the existing single source of truth for row state and the recalculation graph, how each
is undone and saved, and how it is cut into pull requests. It changes no code.

**Status:** Draft (orchestrator review)
**Parent:** ORIGIN_FEATURE_GAP_PLAN.md
**Created:** 2026-11-26
**Updated:** 2026-11-26

Paths are under `frontend/src/` unless they start with `src/` (backend). Rows are 0-based in every stored field, as
`excludedRows` is, and shown 1-based (grid row numbers, and `A[1:10]` in formulas).

## Decisions at a glance

Every row marked "confirm" is for the orchestrator.

| # | Decision | Pick | Alternative | |
|---|---|---|---|---|
| D1 | What a row range is bound to | Positions (0-based, inclusive), remapped by insert and delete | Stable row identity at both ends | confirm |
| D2 | Range under sort and Move rows | Positions unchanged; the sort status line says how many ranges now cover different rows | Refuse the sort; follow identity | confirm |
| D3 | Range vs the exclusion mask | The range is not part of `droppedRows`; it narrows only where it is set | Fold into the dataset's dropped set | |
| D4 | Plot window | Rows outside the window are not drawn (x length unchanged), axes fit the drawn rows | Trim the payload | confirm |
| D5 | Subset link back | Child keeps source row identities (the fit-row `r1:` sidecar, generalised) | Positions plus a source fingerprint | confirm |
| D6 | Link cap | 100,000 rows linked per subset; above that the subset is unlinked at row level, and says so | No cap | confirm |
| D7 | Named range scope | Workbook or sheet; the block lives on one sheet; names unique in a workbook and its sheets | Project scope; shadowing | confirm |
| D8 | Named range store | One top-level `namedRanges` list in the `.dwk` and the store | A field on `Dataset` and on `WorkbookNode` | |
| D9 | Formula syntax | `rng("Name")`, `rng("Name", n)`; legal only as an aggregate argument | Bare names | confirm |
| D10 | Delete a named range or its sheet | Confirm listing dependants, then cut their links (they error), undoable | Refuse while used | confirm |
| D11 | Mirror column | A `sheet("Src", L)` formula column, recognised by shape; no new persisted field | A new column kind | confirm |
| D12 | Mirror and sort | Inherits the `sheet()` refusal on both sides | Mirror by row identity | confirm |
| D13 | Cell notes store | Row-indexed sidecar in `data.metadata`, sliced by `sliceRowSidecars` | A `Dataset` field remapped by hand | |
| D14 | Cell notes in older releases | Gated: a project holding notes is refused by older releases | Kept silently | confirm |
| D15 | Notes in export | `.dwk` and `.xlsx` (as cell comments); not CSV or TSV, and the dialog says so | | |
| D16 | Notes on paste | Plain paste leaves notes alone; an in-app copy carries them | | |
| D17 | Version rung | The first gated field of this contract adds the v9 rung (section 9.2) | Wait for the release | confirm |

## 1. What exists today

The contract extends these. It does not replace them.

| Concept | Code | Behaviour |
|---|---|---|
| Exclusion mask | `lib/rowstate.ts:19` `excludedSet`; `Dataset.excludedRows` is a sorted `number[]` of positions | Stays visible in the worksheet, drops from every analysis. The header (`:1-11`) says no view may derive row selection or exclusion outside this model. |
| Data filter | `lib/datafilter.ts` `filteredOutRows` | Per-column predicates, AND across columns. Inert when the column's meaning changed (`applicableFilter`). |
| The dropped set | `lib/rowstate.ts:97` `droppedRows` = excluded union filtered-out | The one "what is out" set. The plot masks by it, `analysisData` prunes by it (`:122` `analysisView`, `:64` `pruneExcluded`). |
| Insert and delete remap | `lib/rowShift.ts:20,33`; used at `store/cellEditRun.ts:192,247` | Exclusions are REMAPPED, not cleared. The header (`:1-14`) records four earlier bugs of this class. |
| Sort remap | `store/sortRows.ts:124` `commitRowOrder`; marks at `:137` | Exclusion marks, text sidecars, fit row identities and row styles move with their rows. Positional formulas (`cumsum`, `A[i]`) are re-evaluated in the new order and the status line says so. |
| Row-count change from outside | `store/corrections.ts:101` `rowsChangedGuard`; `store/reimport.ts:217` | Clears `excludedRows` and the overlays with a status line. |
| Row sidecars | `lib/rowSidecars.ts:263` `sliceRowSidecars` | The one slicer for row-indexed metadata. The keys are enumerated, not inferred. |
| Stable fit-row identity | `lib/fitRowIdentity.ts:76` `bindFitRowIdentity`; sparse `__quantized_fit_row_ids` (`rowSidecars.ts:146`) | A fit's explicit subset (`FitSpec.rowIds`) is positions plus fingerprints, and replay refuses on drift (`lib/fitselection.ts:34,191`). Identities follow slicing. |
| Analysis inputs | `lib/analysisInputs.ts:50` `ROW_POLICY`, `:158` `resolveAnalysisInputs`, `:250` summary, `:275` rule sentence | The one resolver: analysis view, then `rowIds`, then X `range`. Prints "N of M rows". |
| Plot masking | `lib/plotdata.ts:288` `maskExcludedPayload` (header `:282-287`) | Blanks dropped rows without changing the x length, so overlays, error bars and waterfall stay aligned. A reduced payload carries `rowIds` (`lib/plotPointMask.ts:65`). |
| Plot server window | `src/quantized/routes/plot.py:96-118` | An X-value window, returning `rows` (the dataset row of each returned row). |
| Subset | `components/Stage/worksheet/extractRows.ts:39`, `extractRowsCommit.ts:14` | Extract writes a "(subset)" worksheet through the result contract. It keeps no row identity. |
| Cross-sheet formulas | `lib/sheetRefs.ts:77,101,154,176`; `lib/sheetBindings.ts:10`; `lib/formulaRefs.ts:298` | `sheet("Name", L)` binds by worksheet id, follows renames and column shifts, errors on delete (`id: null`), reads the same row and gives NaN past the end. Cycles refused at link time (`lib/recalc.ts:177`). Sort is refused on both sides (`store/sortRows.ts:106`). |
| Computed column edit | `components/Stage/worksheet/useGridCursor.ts:157`, `store/cellEditRun.ts:297` | Read-only, with a status-line reason only. |
| Source navigation | `store/worksheetOpen.ts:42`, `store/worksheetReveal.ts:14` | Open a worksheet with rows selected; reveal one row and column. |
| Undo | `store/historySnapshot.ts:41` | An inclusion allowlist. A new store field is outside undo until added there. |
| `.dwk` gates | `lib/workspaceForwardCompat.ts` | Typed classification maps; a gated field makes the file a higher version that older releases refuse. |

## 2. Four things, kept distinct

| | Spatial region | Row range | Exclusion mask | Materialized subset |
|---|---|---|---|---|
| What it is | A rectangle, lasso, ROI or X band in plot or map coordinates (`PlotPick`, `lib/plotPointMask.ts:36`) | Rows `from..to` of one worksheet, contiguous | A set of rows taken out of analysis | A new worksheet holding copied rows |
| Basis | Values | Positions | Positions (follow their rows through sort) | Row identity |
| Contiguous | No | Yes | No | No |
| Owner | Transient tool state | The plot view, an analysis input, or a named range | The dataset (`excludedRows`, `filter`) | Its own dataset, linked to the source |
| Effect on other rows | None | Not drawn or not read, only where the range is set | Dropped everywhere | None; the source is untouched |
| Persists as | Nothing | `PlotView.rowRange`; named range; the recorded input of a result | `Dataset.excludedRows` | A worksheet plus source row identities |

A region can select noncontiguous rows, so it never becomes a range. It becomes one of three explicit things: a
selection (`AnalysisSelectionItem.rowIds`), a mask (Exclude selected, or Keep only selected), or a subset (Extract).
"Use as row range" is offered only when the selected rows are one contiguous block. Otherwise it is disabled with the
reason "the selection has gaps (rows 3-9, 14): use Extract rows, or Exclude others".

How they combine for one analysis input, in this order:

1. The range (positions `from..to`).
2. The exclusion mask and the data filter (the analysis view).
3. The tool's selected rows.
4. The tool's X range.

The range is deliberately not added to `droppedRows`. Exclusion belongs to the dataset and applies to every consumer;
a range belongs to the place it is set. The #50 guard on `excludedRows` is unaffected, and the new logic lives in a
new `lib/rowRange.ts`.

## 3. Row ranges

### 3.1 Type

```ts
interface RowRange { from: number; to: number }              // 0-based, inclusive, from <= to
type RowRangeRef = RowRange | { named: string }              // named = a named-range id (section 5)
```

One helper, `rowRangeLabel`, converts to the 1-based text ("rows 21-44"). Nothing else converts.

### 3.2 What a range means under row operations (D1, D2)

Positions are the identity. The alternative, binding both ends to stable row identity, was rejected because a
sorted sheet breaks contiguity (the rows between two identities are no longer a window) and a window can then be
3 rows or 3,000 after a sort. Positions give a window whose size never changes under sort, and they reuse
`shiftForInsert` and `shiftForDelete` exactly as exclusions do. A saved FIT already snapshots its resolved rows with
identity (`bindFitRowIdentity`), so a recorded result does not depend on the live range.

| Operation | Effect on `{from, to}` |
|---|---|
| Insert `c` rows at `p` | `p <= from`: both ends `+c` (rows inserted above, as `shiftForInsert` defines it). `from < p <= to`: `to += c` (the range grows). `p > to`: unchanged, so appending never extends a range. |
| Delete set `D` | The surviving rows of `from..to` stay contiguous after the shift. `from` becomes the first survivor `>= from`, `to` the last survivor `<= to`, each less the number of deleted rows above it. No survivor: the range is gone (below). |
| Sort, Move rows | Unchanged. `commitRowOrder`'s status line gains "N row ranges are by position and now cover different rows". |
| Data filter edited, exclusion toggled | Unchanged. The range is positions on the raw sheet; the count in the summary changes. |
| Re-import, correction trim or derived recompute that changes the row count | Same guard as `excludedRows` (`rowsChangedGuard`): a plot range is cleared with a status line. A named range's rows are marked `rowsStale` (section 5.4). |
| Re-import with the same shape | Unchanged. |
| Lazy preview (`pending`) | Refused with the resolver's existing "pending" refusal (`analysisInputs.ts`). |
| Range beyond the sheet (hand-edited file) | Refused when resolved. Never clamped, as formula ranges are never clamped (`lib/formulaRefs.ts` header). |

A range whose every row was deleted is empty. A plot view clears it with a status line (the view is a display
preference, and one undo restores it). An analysis input refuses with "rows 21-44 no longer exist". Neither falls
back to "all rows" silently. A named range is kept and flagged broken, because others depend on it by id.

### 3.3 Who consumes a range

Analysis tools and fits. `AnalysisSelectionItem` (`lib/analysisSelection.ts`) gains `rowRange: RowRangeRef | null`.
`AnalysisRowPolicy` gains `rowRange: "narrow" | "ignore"`: `narrow` for `selection` and `analysisView`, `ignore` for
`fullWorksheet` (Signal Processing keeps its own range fields). A range only exists when a user sets one, so the
statistics tools do not change behaviour for anyone who has not. The resolver applies it first, to the base rows.
It reports `rangeRows` (rows in the window) and `excludedInRange`, so the summary can say:

- `Fit input · rows 21-44 · 21 of 24 rows (3 excluded)`.
- The rule sentence (`inputRuleSentence`) gains a fourth clause, "Limited to rows 21-44."

For fits, `resolveFitInputs`'s `explicit` flag (`lib/fitselection.ts`) becomes true when a range is set. Then
`sourceRows` is present and `fitSpecFrom` records `FitSpec.rowIds` plus the existing fingerprints
(`fitselectionActions.ts:87`). A range adds no `FitSpec` field. The result's recorded input (`recordedInputs`)
names the range, including a named range's name, for provenance. Replaying a fit uses the recorded rows, never the
live range.

A plot. `PlotView.rowRange?: RowRangeRef`. On screen (D4):

- `maskExcludedPayload` gains a second, always-hidden set for rows outside the window, drawn nowhere and never greyed
  (a grey ghost defeats the purpose). Its x length is unchanged, so overlays, error bars and waterfall stay aligned
  (the invariant in the `plotdata.ts:282` header). Trimming the payload was rejected for exactly that reason.
- The outside set is two intervals, never a per-row `Set` (a 100-row window on a 1M-row sheet must not allocate 1M
  entries).
- Rows are matched by dataset row, through `payload.rowIds` when the payload is reduced (decimated or windowed), so
  Select rows, the lasso and point picking (`plotPointMask.ts`) still map to the right rows.
- The X and Y axes autoscale over the drawn rows only. Today x extents come from the whole x column.

In export, `figureSpec` removes the rows outside the window with the same `lib/rowRange.ts` resolver, after
`pruneToLiveDataset`. A range lives in the view and the figure document's view, not in `Dataset`. A frozen figure
document already holds its snapshot, so the range is resolved when it is frozen. Plot recipes do not capture a
range: positions are data-specific. Screen and export agree through one wire fixture,
`tests/fixtures/wire/row_range_figure.json`, asserted by a vitest (`figureSpec`) and a Python export test.

### 3.4 Where a range is set and shown

- Worksheet: select a contiguous block of rows, then "Use as row range" (analysis input) or "Plot only these rows".
  A "Rows from / to" pair of fields (1-based) sits in the shared analysis-input block.
- The plot shows a chip, "rows 21-44 of 200", with a clear button. The worksheet puts a gutter bar beside the
  range's rows, and the status line says it when a range is active.
- Named: pick "from named range..." in either place.

### 3.5 Undo

A plot range is a view edit and goes through the path every other `PlotView` edit uses, so one Ctrl+Z restores it.
An analysis input range is transient selection state, like the rest of `AnalysisSelection`, and is not undoable. The
shifts on insert and delete happen inside the existing "insert rows" and "delete rows" history entries, which already
snapshot the datasets. A view holds the range, so those two operations must snapshot the window views too: pinned by
a test (section 10, R2).

## 4. Materialized subsets

A subset is a copy. It is the answer to "I want these exact rows as their own data", and it is the only one of the
four that can hold noncontiguous rows.

- Created by Extract rows (worksheet selection) and by "Create subset from region" on a plot (a rectangle, lasso or X
  band). The plot flow asks for the source series (a checklist of the plotted channels), and the destination
  (the source's workbook by default, or a new workbook), and adds the worksheet beside the source with `quiet: true` so the graph keeps
  focus (`store/commitComputedOutput.ts` takes `patch` for the book or folder and `quiet`). The status line carries an
  "Open" button that calls `openWorksheet`.
- Identity (D5). Extract installs `r1:` identities on the source for the extracted rows
  (`ensured` in `lib/fitRowIdentity.ts`, generalised from "fit row identities" to "row identities"; identities do
  not enter `dataFingerprint`, so installing them does not make results stale). The child records
  `__quantized_source_rows`: the source id and one identity per child row. It is a row-indexed sidecar sliced by
  `sliceRowSidecars` like its siblings.
- Go to Source rows: resolves the child's identities to the source's current positions and calls
  `openWorksheet({datasetId, rowIds})`. Rows deleted in the source are counted and said: "3 of 40 rows no longer
  exist in the source".
- Cap (D6): above 100,000 rows the subset is unlinked at row level (the existing result link to the source stays) and
  the status says "row link not kept: more than 100,000 rows".
- Editing the child never writes to the source, and a source edit marks the child out of date through the existing
  result freshness (`analysisDataFingerprint`).

## 5. Named ranges

### 5.1 Model (D7, D8)

```ts
interface NamedRange {
  id: string;                                   // "nr1:<base36>", never reused
  name: string;                                 // 1-64 chars, no quotes or control characters, unique case-insensitively
  scope: { kind: "sheet"; datasetId: string } | { kind: "workbook"; workbookId: string };
  target: { datasetId: string; cols: number[]; rows: RowRange | null };   // rows null = every row
  rowsStale?: true;                             // section 5.4
}
```

- Scope says where the NAME is visible. The block always lives on one sheet (`target.datasetId`), because column
  indices are per sheet. A workbook-scoped name is usable in any sheet of that workbook.
- A name is unique across a workbook and all its sheets: no shadowing, which fails closed.
- `cols` uses channel indices (-1 is X) and follows every column insert, delete and move through `remapDatasetChannels`
  (`lib/channelRemap.ts:252`), extended to take `namedRanges`. A range that loses all its columns is broken.
- Rows follow the table in 3.2.
- Stored in one top-level `namedRanges` array in the store and the `.dwk`. A `Dataset` or `WorkbookNode` field was
  rejected: `lib/types.ts` sits at its pin (`architecture.test.ts:941`), `WorkbookNode` has no classification map, and
  one list gives workbook scope and sheet scope one code path.

### 5.2 Use

- Formulas (D9): `rng("Name")` for a one-column range and `rng("Name", n)` for the n-th column of a wider one (1-based).
  It is legal only inside an aggregate (`mean`, `sum`, `sd`, `min`, `max`, `median`, `count`), where `A[i:j]` is already
  the only legal range (`formulaRefs.ts` header). Anywhere else it is an error saying so. A wider range given
  without `n` is an error naming the choices.
- Binding is by id, exactly as `sheet()` binds (`lib/sheetRefs.ts`): `ComputedColumn.ranges?: {name, id}[]`. Rename
  rewrites the formula text (`renameSheetRefs` pattern). A bare name was rejected: it would shadow column
  letters.
- Dependency graph: `sheetIdsRead` (`lib/sheetBindings.ts:10`, the small eager half) also returns the sheet a bound
  range targets, so `ds:target -> ds:reader` exists with no new node kind. For the same sheet, the range's columns
  become `col:` edges into the reading column, so a column that reads a range containing itself is refused by
  `wouldCreateCycle` at bind time. A cross-sheet cycle is refused through the existing `ds:` edge. As today, the check
  is per sheet for cross-sheet reads, so a harmless pair can be refused: it fails closed.
- Plots: `PlotView.rowRange = { named: id }`. Fits and analysis tools: the "from named range" choice on the row-range
  fields. Both resolve live. A committed result records the resolved rows, the range's name and `target`, and
  goes out of date when the resolved rows change (its row fingerprint already catches that).

### 5.3 Rename, delete, dependants (D10)

- Rename: the id is stable, formula text is rewritten, nothing breaks.
- Delete a range: a dialog lists dependants (formula columns, plot views, saved analysis inputs) and then cuts their
  links. A cut formula errors ("named range removed") and never re-binds to a later range with the same name, as
  `cutSheetRefs` does for sheets. One undo step restores the range and every link.
- Delete the target worksheet: its ranges go with it and dependants are cut, in the same confirmation the worksheet
  delete already shows.
- Delete the workbook: its workbook-scoped ranges go the same way.
- Append project: ranges remap through the append id table, and one whose target did not come along is dropped, with
  the count in the append status line (the `remapSheetRefIds` pattern, `store/appendWorkspaceRun.ts:38`).

### 5.4 Stale rows

After a row-count change that is not an explicit insert or delete, a range's row positions have lost their meaning.
Widening to "every row" silently was rejected. The range is marked `rowsStale`, dependants refuse with "named range
Baseline: its worksheet's rows were replaced; open Named Ranges to keep rows 21-44 or remove the row limit".

### 5.5 Where it is edited

A Name box in the worksheet toolbar defines a range from the current rectangular selection (refused with a reason
if the selected rows are not contiguous). A lazy Named Ranges manager lists name, scope, target
("Run 2 B:C rows 21-44") and "used by N", and holds rename, retarget and delete.

## 6. Mirror columns

### 6.1 Model (D11)

A mirror is the column Origin calls a linked column, and the code already has everything but the user-facing
behaviour. A formula column whose entire expression is one `sheet("Src", L)` call, with exactly one resolved binding,
IS a mirror. No new persisted field and no new column kind:

```ts
isMirror(f: ComputedColumn) = f.sheets?.length === 1 && /^\s*sheet\(\s*(".*?"|'.*?')\s*,\s*\w+\s*\)\s*$/.test(f.expr)
```

Typing that formula by hand gives the same column. Create it with "Mirror column..." (pick a sheet and a column), which
calls `addFormula` and copies the source's long name and unit at creation. They do not follow later; the header's
Go to Source is the route to a change. Only numeric columns can be mirrored: a text sidecar column is refused with
"text columns cannot be mirrored". Because nothing new is persisted, an older release opens the file and still has a
working, read-only `sheet()` column. It loses only the badge, the reason text and Go to Source.

### 6.2 Recalculation

Unchanged, which is the point. `sheetIdsRead` already draws `ds:source -> ds:mirror`
(`lib/recalc.ts:62`, `buildEdges`), `recomputeStaleDatasets` re-evaluates the mirror's sheet (`store/recalcDatasets.ts`,
the `readsSheets` branch), and `linkSheets` refuses a cycle (A mirrors B while B mirrors A) at link time with the
path. A mirror of a mirror is allowed; the graph is acyclic by construction.

### 6.3 Link status

Derived on every read, never persisted. Shown as a header badge and in the column tooltip:

| Status | Condition | Cells |
|---|---|---|
| Linked | binding id present, source column exists, no formula error | source values |
| Source loading | source is a lazy book not yet loaded (`pending`) | blank, never the preview rows |
| Source missing | `sheets[0].id === null` (the worksheet was deleted) | blank, error shown |
| Source column removed | expression holds the placeholder `__removed__` | blank, error shown |
| Broken | any other formula error | blank, error shown |

Whether a mirror whose source is a pending book shows blanks or preview rows today is not verified; the mirror
slice pins it with a test before the badge ships.

### 6.4 Go to Source, edits, detach

- Go to Source: `openWorksheet({datasetId: source})` then a reveal request (`store/worksheetReveal.ts`, the `column`
  field) on the source column, from the header menu and from a cell's context menu (which also reveals the same row).
- Edit refused with a reason. Origin ignores a reverse edit silently; here a cell edit on a mirror says, in the status
  line and as a toast, "Temp (mirror) follows Run 2 > C: edit it there (Go to Source), or Detach to make it ordinary
  values". Today's generic computed-column message (`useGridCursor.ts:157`) is replaced for mirrors only.
- Rows: the mirror reads the same row as `sheet()` does and shows blank past the source's last row. When lengths
  differ the header says "source has 120 rows, this sheet 100: rows 101-120 are not mirrored".
- Detach: converts the column to values. Computed columns are always the last columns, so detaching one that is
  not last is a column move from its place to the end of the data columns, handled with the existing `ColumnMove`
  shift and `remapDatasetChannels` / `remapSurvivingFormulas`. One undo step. This is the riskiest part of the
  mirror slice and has the most tests.
- Sort and Move rows (D12): the `sheet()` refusal applies to both the mirror's sheet and the source's
  (`rowOrderRefusal`, `store/sortRows.ts:106`). Pairing by position is what a mirror is, and sorting either side
  would pair it with different rows. The refusal text names Detach. A mirror by row identity would lift this and is
  out of scope.
- Rename and reorder of the source: the link holds and the formula text follows (existing `sheet()` behaviour).
- Reopen: ids are persisted, so a reopened project is Linked. Deleting the source before saving persists
  `id: null`, so it reopens as Source missing and does not re-attach to a same-named sheet.
- Append project: a mirror whose source did not come along is cut (existing), and the status counts it.

## 7. Cell notes

### 7.1 Model (D13)

A note is text on one cell. Stored as a row-indexed sidecar: `data.metadata.__quantized_cell_notes`, shaped
`{ [col]: { [row]: string } }`, sparse, `col` a channel index (-1 is X). Limits: 2,000 characters per note,
2,000 notes per sheet, and a refusal with a reason beyond either.

Rows are handled by the one slicer. `sliceRowSidecars` (`lib/rowSidecars.ts:263`) gets a branch for this key beside
the `__quantized_fit_row_ids` one, so sort, insert, delete, Extract, split, facet and the exclusion prune carry notes
with their rows without any new call site. This is the reason for a sidecar: a `Dataset` field would need a hand
remap in every row operation, and that is the bug class BUG-006 and `rowShift.ts` describe. Columns are handled by
extending `remapDatasetChannels` (`lib/channelRemap.ts:252`), the one place channel-indexed state follows a column
insert, delete or move. The key joins `HIDDEN_METADATA_KEYS` (`lib/metadata.ts:36`) so the metadata card does not list it.

A row-count change that is not an explicit row operation (re-import, trim, derived recompute) keeps notes only when
the shape is unchanged. Otherwise they are dropped with a status line saying how many, and the operation's undo
restores them.

### 7.2 Behaviour

- Add, edit and delete from the cell context menu and from a Shift+F2 note editor. A noted cell shows a corner mark.
  The note shows in a tooltip and, for a screen reader, as part of the cell's accessible description.
- Copy and paste (D16). A plain copy writes values only (TSV) as it does today. An in-app copy also records a
  session-only list of the notes in the copied block, validated against the clipboard text, so a stale record cannot
  attach notes to unrelated text. Paste of that block into the app replaces the notes of the pasted cells, cell for cell, and an
  empty source cell clears the destination's note. A paste from any other source leaves every existing note alone.
- Export (D15). The `.dwk` carries notes. `.xlsx` (`src/quantized/io/table_export.py:206` `format_xlsx`) writes them as
  cell comments, offset by the header rows it writes above the data. CSV and TSV cannot carry them, and the export
  dialog states how many notes will not be written. The private key must not appear in any export preamble: the
  backend's `flatten_metadata` (`src/quantized/io/convert_meta.py:77`) has no skip for it, and the test must prove no
  export path reaches it, adding the skip if one does.
- A lazy (`pending`) book refuses a note edit until it loads, as every cell edit does (`resolvePendingEdit`).
  A re-derived sheet refuses it, as it refuses cell edits.

## 8. Undo

| Change | How it is undone |
|---|---|
| Plot row range set or cleared | One step, the existing `PlotView` edit path |
| Analysis input range | Not undoable (transient selection) |
| Named range create, rename, retarget, delete (with cut links) | One step. `namedRanges` is added to `HistorySnapshot` and its snapshot function, and is not on the excluded list. `store/undoCoverage.test.ts` pins this. |
| Mirror create, Detach | One step each (`addFormula`, and a new Detach action, both record history first) |
| Go to Source | None (navigation) |
| Cell note edit | One step, inside `datasets`, so automatic. Consecutive edits of one note coalesce. |
| Row operations shifting ranges and notes | Inside the existing row-operation step |
| Extract and subset | The result contract's single step |

## 9. Persistence and older releases

### 9.1 Classification

Every new persisted field, classified in `lib/workspaceForwardCompat.ts`. "Measure" means the slice runs the
`git archive` procedure in `__fixtures__/workspace/README.md` and writes the measured class, not the expected one.

| Field | Lives in | Class | Why |
|---|---|---|---|
| `PlotView.rowRange` | window `view`, figure document view | gated (`PLOT_VIEW`) | An older sanitizer picks known keys and would draw every row; measure |
| top-level `namedRanges` | `.dwk` | gated (`WORKSPACE_TOP`; tsc forces it) | Top-level keys are read by name |
| `ComputedColumn.ranges` | inside `Dataset.formulas` | rides with the `namedRanges` gate | A formula using `rng()` always comes with a named range; the kitchen-sink test carries one |
| `__quantized_cell_notes` | dataset `data.metadata` | gated through a new metadata-key check | An older release would carry the notes but not slice them on a row operation, so notes would attach to the wrong rows |
| `__quantized_source_rows` | child dataset `data.metadata` | gated, same check | Same defect: a Go to Source that silently points at wrong rows. D14 asks whether to accept that cost for files that hold an Extract |
| recorded `rowRange` in a result's input snapshot | `analysisResults[].parameters` | kept-by-034 (expected; measure) | Provenance only. The rows actually used are also written as `rowRuns` (`analysisSelectionSnapshot`, `lib/analysisSelection.ts:106`), so a release that ignores the range still holds the exact rows |
| Mirror | nothing | none | Derived from `formulas` and `sheets`; an older release sees an ordinary `sheet()` column |
| `FitSpec` | nothing new | none | Ranges resolve into the existing `rowIds` and fingerprints |

The metadata-key check is a small extension of `featuresV034WouldDrop` (`:418`): a `GATED_METADATA_KEYS` list tested
against each dataset's `data.metadata` keys. The walker today never reads dataset cells or metadata, so this is new
code with its own `FEATURES` cases in `workspaceForwardCompat.test.ts`.

### 9.2 The version rung (D17)

The ladder tops out at v8 (`WORKSPACE_VERSION_POST_041`, `lib/workspace.ts:93`), and v0.45.0 reads v8
(`git show v0.45.0:frontend/src/lib/workspace.ts`). Every field gated since v0.45.0 is currently written as v8, so
v0.45.0 opens such a file and drops the field. `git diff v0.45.0 -- frontend/src/lib/workspaceForwardCompat.ts` lists
them (the ternary figures, the measure shapes, the rug styles among them). This contract's gated fields would join
that group. The fix is the established pattern: a v9 rung (`WORKSPACE_VERSION_POST_045`, a `NEW_SINCE_V045` set,
`featuresV045WouldDrop`), with the post-0.45 entries moved into it after measuring against `git archive v0.45.0`.
It should land once, before any lane's gated field, not once per lane. Orchestrator to confirm who owns it
(slice R0).

## 10. PR slicing

Ordering: R1 and R5 need no persisted state and can go first; R0 gates R2, R3, R4 and R6. All new UI is lazy (`lazy()`,
`analysisExtras`, `runLazy`). The only eager touches are `sheetIdsRead` and `HIDDEN_METADATA_KEYS`, a few dozen bytes,
and the slice reports the delta against the 500 B lane budget.

| Slice | Content | Files (new in bold) | Tier |
|---|---|---|---|
| R0 | v9 rung, `featuresV045WouldDrop`, `GATED_METADATA_KEYS` and its walker | `lib/workspaceForwardCompat.ts`, `lib/workspace.ts`, `lib/workspaceSerialize.ts`, `workspaceForwardCompat.test.ts`, `workspace.workbooks.test.ts` (the "rejects a version 9" case moves to 10) | Sonnet |
| R1 | `RowRange` type and remap; `rowRange` on `AnalysisSelectionItem`, `ROW_POLICY`, resolver, summary and rule sentence; fits through `explicit`; worksheet "Use as row range" and the from/to fields | **`lib/rowRange.ts`**, `lib/analysisInputs.ts`, `lib/analysisSelection.ts`, `lib/fitselection.ts`, `store/analysisSelection.ts`, worksheet context action | Sonnet |
| R5 | Mirror column: `isMirror`, create command, badge and status, Go to Source, reason, Detach, tests | **`lib/mirrorColumn.ts`**, **`store/mirrorColumn.ts`**, `useGridCursor.ts`, header menu, `store/cellEditRun.ts` (message) | Sonnet |
| R6 | Cell notes: sidecar and its two remap hooks, UI, clipboard, history coalescing | **`lib/cellNotes.ts`**, `lib/rowSidecars.ts`, `lib/channelRemap.ts`, `lib/metadata.ts`, worksheet grid and menu | Sonnet |
| R6x | Notes in `.xlsx` and the export dialog line; backend skip for the private key | `src/quantized/io/table_export.py`, `src/quantized/io/convert_meta.py`, `commands/worksheetExport.ts` | Haiku |
| R2 | Plot row range: `PlotView.rowRange`, the hidden set in `maskExcludedPayload`, autoscale over drawn rows, export prune, wire fixture, chip | `lib/plotview.ts`, `lib/plotdata.ts`, `lib/figureSpec.ts`, `tests/fixtures/wire/row_range_figure.json`, Python export test | Sonnet |
| R3 | Subset identity and link: generalised identities, `__quantized_source_rows`, Go to Source rows, "Create subset from region" | `lib/fitRowIdentity.ts`, `lib/rowSidecars.ts`, `extractRows*.ts`, plot context menu | Sonnet |
| R4a | Named range model, store field, history, id table, column and row remap, Append project, delete cascade | **`lib/namedRanges.ts`**, **`store/namedRanges.ts`**, `store/historySnapshot.ts`, `lib/channelRemap.ts` | Sonnet |
| R4b | `rng()` in the formula chunk, binding, rename, cut, graph edges, cycle check | `lib/formulaRefs.ts` (or a new sibling), `lib/sheetBindings.ts`, `lib/recalc.ts` | Sonnet |
| R4c | Name box, Named Ranges manager, plot and analysis "from named range" | **`components/workshops/namedranges/`** | Sonnet |

### Acceptance tests each slice must add

All through the real store and the real component, not a helper alone. Each follows `rules/stateful-workflow-invariants`:
intent, exact provenance, production path, shape accounting.

- R0: a v9 file is refused by the v8 reader fixture; a metadata-key case per gated key; the kitchen-sink save fails
  `tsc` and the test until a new field is classified.
- R1: the resolver gives the same rows for a range, an exclusion inside it, a selection and an X range (the four-way
  order in section 2) and prints `rows 21-44 · 21 of 24 rows (3 excluded)`; insert above, inside and after the range;
  delete the first row, a middle row, all rows (empty is refused, never "all rows"); sort leaves positions and
  the status line says so; a fit on a range records `rowIds` and replays, and sorting afterwards makes the replay refuse
  (`FIT_SUBSET_MISMATCH`); a range past the end refuses; a pending book refuses; every test that iterates `ROW_POLICY`
  passes.
- R5: create, edit a mirror cell (reason in status and toast), edit the source (the mirror recalculates and a stale
  `staleDatasets` entry clears), delete the source (Source missing, no re-attach to a new sheet of the same name),
  save then reopen both sheets (Linked) and with the source deleted (Missing), a source with fewer and more rows than the
  mirror, a mirror cycle refused, sort refused on both sides, Detach on a column with later formulas (every letter,
  hidden, error role and fit spec follows), one undo each, Go to Source selects the column.
- R6: a note survives sort, insert, delete, Extract and a column move on the right cell; a plain paste leaves notes, an
  in-app paste replaces them, a stale clipboard record attaches nothing; `.xlsx` holds the comment at the right cell
  (read back with openpyxl); no export contains the private key; a project with a note is refused by the v8
  reader fixture.
- R2: window rows 21-44 of 200 draws 24 points and the x axis spans them; with a fit overlay, an error bar and a
  waterfall the overlay stays aligned; a decimated payload (`rowIds`) masks the right rows; Select rows and the lasso
  hit the right dataset rows; export contains exactly the drawn rows (the wire fixture, both languages); Ctrl+Z
  restores the view; insert and delete above the window move it and one undo restores both; a recipe does not capture it.
- R3: Extract a noncontiguous selection, sort the source, Go to Source selects the original rows; delete two source
  rows and the count is stated; above the cap the subset is unlinked and says so; the plot flow keeps graph focus and
  offers the source series choice.
- R4a/b/c: define from a selection (noncontiguous refused); `mean(rng("Baseline"))` evaluates and recalculates when
  the source changes; rename follows and rewrites the formula; delete with dependants lists them, cuts them, and one
  undo restores them; deleting the target worksheet and the workbook; a column insert before the range moves it;
  a self-referencing range is refused; Append project drops a range whose target is missing and says how many;
  `namedRanges` is restored by undo (`undoCoverage`); a plot and a fit through a named range, and a result recorded
  with the name goes out of date when the range moves.

## 11. Open risks

- The plot window changes axis autoscale, the part of R2 most likely to hide a defect that every unit test passes.
  The slice includes a browser pass through Playwright on the built app.
- D12 means a sheet with mirrors cannot be sorted. Origin allows it. If that proves painful, mirror by row identity
  is the next step, and R3's identities are the foundation for it.
- D6's 100,000 cap is a guess about `.dwk` size (one `r1:` token is roughly 25 bytes in the source and again in the
  child). Measure on the largest corpus sheet before fixing it.

## Completed

Nothing is built. This is the contract.
