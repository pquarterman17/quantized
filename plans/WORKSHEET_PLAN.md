# Worksheet Viewing & Replot — Full Grid, Book Tabs, Selection→Plot

Full worksheet viewing for imported Origin projects (and everything else):
kill the 500-row display cap with a hand-rolled virtualized grid that handles
tall AND wide sheets, surface the Origin column designations and comments the
importer already decodes, give Origin book families a sheet tab strip inside
the Worksheet stage tab, and add Origin's "highlight columns → plot" gesture
feeding the existing plot store actions. Staged so each tier ships working
value without creating a second god-component or a second plotting pathway.

**Status:** Active
**Created:** 2026-07-09
**Updated:** 2026-07-09 (Tier 2, items 6-11, closed same day)

---

## Context

### How the pieces fit together

- `frontend/src/components/Stage/Worksheet.tsx` (395 lines — 5 under the
  400 ceiling) — container for the ACTIVE dataset only: filter/sort/stats
  state, context-menu builders, extract/copy actions. Delegates to
  `WorksheetTable.tsx` (273 — plain `<table>`, renders EVERY column and the
  first `MAX_ROWS = 500` rows of `order`), `WorksheetToolbar.tsx` (118 —
  formula bar, bulk exclude/keep), `WorksheetFilterBar.tsx` (116 — local
  view filter + Extract). Features that must survive the rewrite: cell
  editing → `setCellValue`, computed formula columns (`Dataset.formulas`,
  header × remove), display-only sort, local view filter + Extract, global
  filter greying (#53 via `filteredOutSet`), row masking/selection (#50 via
  `excludedSet` — `lib/rowstate` is the only sanctioned read), per-column
  stats footer (`/api/stats/descriptive`, opt-in), TSV copy, column context
  menu (Set as X / Plot as Y / Hide / New column from formula).
  `Worksheet.test.tsx` (341 lines) covers menus, stats, filter, masking —
  it keeps passing (extended consciously, never gutted).
- **Sheet = one flat `Dataset`.** The backend pre-flattens Origin books
  (`metadata.origin_book` = `Book@N`, human note in `origin_book_long`).
  Book families and sheet groups are reconstructed at render time by
  `frontend/src/lib/grouping.ts` (`originBookFamilies` groups by name stem,
  `originSheetGroups` by `origin_book` parent, `originSheetNumber`). The
  sheet tab strip composes over THESE — no data-model change.
- **Designations are decoded but displayed nowhere in the worksheet.**
  `Dataset.data.metadata.column_designations` ({shortName → "X"|"Y"|
  "Y-error"|"X-error"|"Label"|"Disregard"}), `column_comments`,
  `origin_column_names` (short names aligned to `.values` columns). They
  already drive error-bar pairing + hidden channels via `lib/errorbars.ts`
  (`originErrKeys`, `originHiddenChannels`) — the header display reuses the
  same alignment logic, factored into one shared helper.
- **Replot affordances today:** column context menu (column-level),
  Inspector Channels card (`xKey`/`yKeys`/`y2Keys`/`errKeys`), GraphBuilder
  workshop (`lib/plotspec` grammar + `sendToStage` through
  `setXKey`/`setYKeys`), ColumnSwitcher. There is NO grid-selection→plot;
  Stage C adds only a selection model + a mapping onto the EXISTING store
  actions — no new plotting pathway.
- **Guards:** `frontend/src/architecture.test.ts` enforces the 400-line
  `.tsx` ceiling (no new pins) and the #50 row-state chokepoint (worksheet
  reads rows via `lib/rowstate` only — the new subtree keeps that, no
  allowlist change expected). Design tokens only; JetBrains Mono
  (`--font-mono`, already on `.qzk-sheet table`) for every number.
- **Concurrent work:** (1) a perf branch is downsampling Library
  `Sparkline.tsx` — different surface, no file overlap, same "big Origin
  project" scale goal; (2) `plans/MULTI_PLOT_PLAN.md` is queued — its item
  17 (worksheet/map window kinds) is the eventual consumer of this plan's
  Stage D readiness (item 11 here books ONLY the mountability work; the
  window-kind promotion itself stays owned by MULTI_PLOT item 17). Note
  `setActive` semantics change under that plan (rebind the focused window)
  — the sheet strip calls `setActive` and inherits whatever those
  semantics are, by design.
- **Verified edge:** `nextStageTab` returns `current` when the stage tab is
  "worksheet", so sheet switching via `setActive` cannot yank the user to
  the Plot/Map tab. Switching sheets DOES reset the singleton plot view
  block — identical to a Library click today; acceptable and consistent.

### Data / control flow

```
Dataset (flat, per sheet)
  ├ data: DataStruct (.time/.values/.labels/.units/.metadata)
  │    metadata: origin_book, column_designations, column_comments,
  │              origin_column_names, origin_text_columns, origin_report_sheets
  ├ formulas / channelRoles / excludedRows / filter   (persisted, .dwk)
  └ read path: lib/rowstate (excludedSet · filteredOutSet · analysisData)

Worksheet stage tab
  WorksheetPane(datasetId)                       ← container (thin)
    ├ useWorksheetView(ds)                       ← filter/sort/stats/selection state
    ├ WorksheetToolbar · WorksheetFilterBar      (existing, relocated)
    ├ SheetTabs  ── originSheetGroups/BookFamilies(grouping.ts) ── setActive(id)
    └ GridViewport ── lib/gridwindow (scroll → row/col window, pure math)
        ├ GridHeader (designations/comments via lib/columnmeta, sort, ƒx, menus)
        ├ windowed rows/cells (edit → setCellValue; mask/filter/select styling)
        └ GridStatsFooter (sticky; /api/stats/descriptive over analysisRows)

Selection→plot (Stage C):
  column selection (useWorksheetView, transient)
    → designation-aware mapping (lib/columnmeta): X-designated wins X,
      Y-error pairs to preceding selected Y, Label/Disregard skipped
    → existing store actions: setXKey / setYKeys / errKeys action
```

### Dependency map

- Item 1 (pure math + columnmeta) blocks 2 and 4.
- Item 2 (virtualized grid) requires 1; item 3 (container split) requires 2
  (they touch the same files — sequence 1 → 2 → 3).
- Item 4 (designations/comments) requires 1 + 2; item 5 (sheet tabs)
  requires 3. **Tier 1 = items 1–5, alone shippable**: any sheet fully
  viewable at any size, with Origin metadata visible and book families
  navigable in place.
- Item 6 (selection model) requires 2 + 3; item 7 (selection→plot) requires
  4 + 6; item 8 (text sheets) requires 2; item 9 (book switcher) requires 5;
  item 10 (perf validation) requires 2.
- Item 11 (Stage D readiness) requires 3 + 5 — cross-references
  MULTI_PLOT_PLAN item 17, which owns the actual window-kind work.
- Items 12–14 are independent polish on top of Tier 1/2.

### Key decisions (made here, kept out of the tiers)

1. **Hand-rolled virtualization, div-based grid.** Fixed row height (a CSS
   token, read once per mount) + uniform column width in v1 → windowing is
   pure arithmetic (`lib/gridwindow.ts`, unit-tested without DOM). The
   `<table>` is replaced by a scroll container + a full-size spacer + one
   translated window layer, with sticky header / row-number gutter /
   stats footer (the current sticky-`th` pattern generalized). ARIA grid
   roles (`grid`/`row`/`columnheader`/`gridcell`) keep `Worksheet.test.tsx`
   queries working. Alternative considered: TanStack Virtual (MIT) —
   rejected for now per the no-new-runtime-dependency constraint; if
   hand-rolling proves gnarly mid-implementation, adopting it is an
   explicit owner decision, not a silent swap.
2. **jsdom fallback window.** jsdom measures a 0-height viewport; the
   window math falls back to a fixed default row/column count when the
   measured viewport is degenerate, so existing tests render real rows and
   new tests can assert windowing via the pure math directly.
3. **One shared column-metadata reader.** `lib/columnmeta.ts` aligns
   `column_designations`/`column_comments`/`origin_column_names` to
   `.values` column indices ONCE; `lib/errorbars.ts` is refactored to read
   through it (same alignment, currently private to errorbars). Header
   display, selection→plot mapping, and error-bar pairing can never drift
   apart.
4. **Sheet tabs compose over `grouping.ts` + `setActive` — nothing else.**
   A tab strip at the bottom of the worksheet (Origin convention) listing
   the active dataset's `originSheetGroups` siblings; clicking calls
   `setActive`. No book container object, no store slice, no persistence
   (the active sheet IS `activeId`, already in `.dwk`). Hidden entirely for
   non-Origin / single-sheet datasets — zero cost to the common case.
5. **Selection→plot feeds existing actions only.** The mapping produces
   arguments for `setXKey`/`setYKeys` and the errKeys store action —
   exactly what the column context menu and GraphBuilder already call — so
   macro recording, facet carry-over, and MULTI_PLOT's future
   focused-window scoping all come for free.
6. **Worksheet view state stays session-transient.** Display sort, local
   filter, column selection, and scroll position are not persisted —
   matching today's behaviour (formulas/roles/masks persist via the
   Dataset; the active sheet persists as `activeId`). Revisit only if the
   owner asks (item 14 is the deliberate re-opening point).

### Risks / open decision items (owner input wanted)

- **D1 — header-click gesture (item 6).** **RESOLVED 2026-07-09** as the
  recommendation: header click selects (ctrl/cmd-click adds, shift-click
  ranges); sorting moved OFF the click gesture entirely and lives in the
  column context menu (already there) plus the existing `sortMark` glyph
  (▲/▼) as the passive indicator of current sort direction. Implemented in
  `GridHeader.tsx`/`GridViewport.tsx` (item 6); `Worksheet.test.tsx` gained
  an explicit regression test for the behaviour change.
- **D2 — designation editing.** v1 displays designations read-only; the
  store-level equivalents (Set as X, Plot as Y, error pairing, channel
  roles) remain the mutation surface. Making `column_designations` itself
  editable would mean writing into imported metadata — deferred unless
  requested. (Unchanged by Tier 2.)
- **D3 — text/report sheets.** **RESOLVED 2026-07-09** per the
  recommendation (item 8): `origin_text_columns` render as read-only string
  columns appended after numeric/computed columns (unvirtualized — a
  text-only book's numeric row count is 0, so the effective row count is the
  max over its text columns, and they ARE the whole grid); `origin_report_sheets`
  stay Inspector-only (`OriginProvenanceCard`), with a one-line worksheet
  hint pointing there when a sheet carries them.
- **Stats fan-out at scale:** **MEASURED 2026-07-09 (item 10).** The opt-in
  stats footer posts one `/api/stats/descriptive` call per column — 201
  requests at 200 columns, confirmed. `Promise.all` already parallelizes
  every call client-side: with a mocked 5ms per-call latency, 201 calls
  resolved in ~108-114ms wall time (vs. a ~1005ms floor if they were
  serialized) — see `GridViewport.perf.test.tsx`. No batched endpoint
  warranted at this time; the residual risk is browser per-origin
  connection-count limits under real network latency, not JS-side
  serialization — revisit only if a real deployment measures it slow.
- **`originSheetGroups` keying collision:** two different imported projects
  can both contain a "Book1" — the sheet groups would merge across
  projects. **RESOLVED** (see Completed #5) — the bucket key is now scoped
  by import stem, with a regression test in `grouping.test`.

---

## Tier 1 — High Impact

(all shipped — see `## Completed`)

## Tier 2 — Medium Impact

(all shipped 2026-07-09 — see `## Completed`)

## Tier 3 — Nice-to-Have

12. **Per-column widths + drag resize** — (M) `lib/gridwindow` gains a
    prefix-sum column-offset mode; drag handle on header edges; widths
    session-transient (D6/item 14 govern persistence).

13. **Selection → GraphBuilder handoff** — (S) "Open in Graph Builder"
    from the selection context menu, prefilling a `lib/plotspec` spec
    (X/Y/error wells) instead of plotting directly.

14. **Worksheet view-state persistence decision** — (S) deliberately
    revisit key decision 6: should display sort / column widths / active
    selection persist per-dataset (in `.dwk`, additive-optional like
    `smartFolders`)? Default answer is no; this item exists so the
    question is asked once, with usage evidence, not re-litigated ad hoc.

## Completed

- ~~**#1 Pure windowing math + column-metadata helpers**~~ (2026-07-09) —
  `lib/gridwindow.ts` (visible-plus-overscan window per axis, degenerate-
  viewport fallback, unit-tested boundaries) + `lib/columnmeta.ts` (shared
  designation/comment/short-name alignment); `lib/errorbars.ts` refactored to
  read through it — `errorbars.test.ts` unchanged and green.
- ~~**#2 Virtualized grid subtree — kill `MAX_ROWS`**~~ (2026-07-09) —
  `WorksheetTable.tsx` replaced by `components/Stage/worksheet/`
  (GridViewport/GridHeader/GridRow/GridStatsFooter/useCellEdit), div-based
  ARIA grid, fixed row height (`--row-h` token) + uniform column width,
  double leading/trailing spacer (no absolute positioning needed). All 28
  existing `Worksheet.test.tsx` cases pass with zero changes; added
  `GridViewport.test.tsx` (windowed rendering, scroll-driven windowing,
  edit-in-window against a real measured viewport).
- ~~**#3 Container split**~~ (2026-07-09) — `useWorksheetView.ts` (state) +
  `worksheetMenus.ts` (menu builders) + `WorksheetPane(datasetId)` (thin,
  no `useActiveDataset` reads in the subtree); `Worksheet.tsx` is now a
  ~15-line stage-tab wrapper. `WorksheetToolbar`/`WorksheetFilterBar`
  relocated via `git mv` (history kept). Landed in the same commit as #2 —
  the split IS how the new grid wires into the app.
- ~~**#4 Origin designation + comment display in headers**~~ (2026-07-09) —
  `GridHeader` shows a designation badge (X/Y/yEr/xEr/Label/Disregard) in
  place of the bare channel letter when `columnmeta` decodes one, plus a
  truncated comment line (full text in the tooltip); `channelRoles` still
  wins display priority; non-Origin datasets unchanged (no badge noise).
  Read-only per owner decision D2.
- ~~**#5 Sheet tab strip**~~ (2026-07-09) — `SheetTabs.tsx`: bottom strip
  over `originSheetGroups` siblings, click → `setActive`, hidden for
  non-Origin/single-sheet datasets. Also hardened `grouping.ts`'s sheet-group
  bucket key (scoped by import stem via a new `importStem` helper) so two
  unrelated imports sharing Origin's default "Book1" name can't merge into
  one group — regression test added.
- ~~**#6 Column selection model in the grid**~~ (2026-07-09) — resolves D1.
  `useWorksheetView.ts` gained a transient `selectedCols: Set<number>`
  (-1..labels.length-1, same numbering as `toggleSort`) + `toggleColSelected`/
  `setColSelection`/`clearColSelection`, reset on a dataset switch and on Esc
  (window keydown listener, active only while non-empty — mirrors
  `useGadgetChip`'s pattern). `GridHeader.tsx`'s header `onClick` now selects
  (plain replaces, ctrl/cmd toggles, shift ranges from a `colAnchor` kept
  in `GridViewport` — mirrors the existing row-number click handler exactly)
  instead of sorting; selection highlight is `var(--accent-soft)` +
  `var(--accent)` border on the header, and the same background threaded
  through `GridRow`'s cells for a continuous column highlight. **Sort moved
  to the column context menu only** (already there) — the ONE sanctioned
  behaviour change; `Worksheet.test.tsx` gained an explicit regression test
  ("a header click no longer sorts the rows") plus a test that context-menu
  sort still works and shows the ▲/▼ glyph. `.qzk-grid-headcell` cursor
  flipped from `default` to `pointer` (footer/corner cells stay `default`).
- ~~**#7 Selection → plot**~~ (2026-07-09) — new pure `lib/selectionplot.ts`
  (`resolveSelectionPlot`, mirroring `lib/dragaxis.ts`'s resolve/apply split):
  an X-designated selected column wins as X (a bare selection of the pinned
  x/time column resets to `.time`; a resolved X matching the CURRENT xKey
  collapses to "no change" — no spurious macro step); Y-error columns pair to
  the nearest PRECEDING selected Y (the `originErrKeys` rule, scoped to the
  selection) and are never themselves plotted; Label/Disregard/X-error/
  secondary-X are always skipped. `useWorksheetView.plotCols(cols, mode)`
  applies the result through the EXISTING `setXKey`/`setYKeys`/`setErrKey`
  store actions (no new plotting pathway) — `plotSelection`/
  `addSelectionToPlot` wrap it over the current selection. Two affordances:
  a toolbar cluster ("Plot selection"/"Add to plot"/"Deselect columns", shown
  only while ≥1 column is selected) and two new column context-menu entries
  ("Plot selection"/"Add selection to plot") that act on the WHOLE selection
  if the right-clicked column is already part of it, else just that one
  column (`WorksheetPane`'s `effectiveCols`). 15 unit tests in
  `lib/selectionplot.test.ts`; `Worksheet.test.tsx` covers the toolbar path,
  both context-menu fallback/whole-selection paths, macro recording (free —
  goes through `setXKey`/`setYKeys`), and a row-state proof (`excludedRows`
  is untouched by a plot-selection action; the plotted result still honors
  it via the pre-existing plot pipeline — no allowlist change).
- ~~**#8 Text-sheet rendering**~~ (2026-07-09) — resolves D3. New
  `lib/columnmeta.originTextColumns`/`hasOriginReportSheets` readers.
  `GridHeader`/`GridRow`/`GridStatsFooter` each append `origin_text_columns`
  as a read-only, UNVIRTUALIZED run past the numeric/computed columns (own
  trailing spacer position, so they line up across header/rows/footer even
  while the numeric portion scrolls) — no click handler (never sortable/
  selectable/plottable), no stats (footer shows "—"), left-aligned text.
  `useWorksheetView`'s row count is `max(ds.data.time.length, longest text
  column)` so a text-only book (0 numeric rows) still renders every text
  row — "text columns are the whole grid" for such a book.
  `origin_report_sheets` stays Inspector-only; `WorksheetPane` shows a
  one-line hint ("… see Inspector › Origin provenance") when a sheet carries
  any. 4 new `columnmeta.test.ts` cases + 6 new `Worksheet.test.tsx` cases
  (mixed numeric/text, text-only book, no-edit, hint shown/hidden).
- ~~**#9 Book switcher for multi-book families**~~ (2026-07-09) —
  `lib/grouping.ts` gained `familyBooks` (one entry per DISTINCT
  `origin_book`, collapsing a multi-sheet book's own sheet pseudo-books down
  to its earliest-sheet representative — deliberately NOT the same thing as
  `originBookFamilies`, which buckets by import stem alone and would
  otherwise misread 3 sheets of ONE book as 3 distinct books) + `bookLabel`
  (strips the `"<stem>:"` prefix for display). `SheetTabs.tsx` (renamed in
  spirit to "worksheet navigation strip") now composes a `<select>`
  book-switcher at the left end (shown only when the family has >1 distinct
  book) alongside its existing sheet-tab buttons — either, both, or neither
  render; still hidden entirely for a non-Origin/single-book/single-sheet
  dataset. 9 new tests (`grouping.test.ts` ×5, `SheetTabs.test.tsx` ×4,
  including the "must not double-count a multi-sheet book as multi-book"
  regression and a combined book+sheet-strip case).
- ~~**#10 Perf validation at Origin-project scale**~~ (2026-07-09) — measured,
  not assumed: `GridViewport.perf.test.tsx`, a synthetic 100k-row ×
  200-column dataset through the real virtualized grid with a real measured
  viewport. Mount: ~860-925ms wall time, 39 rendered rows / 546 rendered
  cells regardless of the 100k×200 backing data (the invariant that
  matters). Scroll re-window after a 500k-px jump: ~18-20ms — no rAF-
  throttling needed at this scale, so none was added. Stats-footer fan-out
  (the plan's risk note): 201 parallel `/api/stats/descriptive` calls at a
  mocked 5ms per-call latency resolved in ~108-114ms wall time — confirms
  `Promise.all` already parallelizes them (vs. a ~1005ms floor if
  serialized) — **no batched endpoint booked**; the residual risk is browser
  per-origin connection limits under real network latency, not JS-side
  serialization. Assertions use generous CI-safe bounds (8s/800ms/700ms) per
  the repo's existing "Windows CI runs several times slower" discipline;
  test-level timeouts raised to 60s (the 5s vitest default was hit under
  heavy local multi-process contention, not by the measured costs above).
- ~~**#11 Stage D readiness: worksheet as future window content**~~
  (2026-07-09) — audited: grepped the whole `components/Stage/worksheet/`
  subtree for `useActiveDataset`/`s.activeId` — zero hits outside doc
  comments (only `Worksheet.tsx`, OUTSIDE the subtree, reads `activeId` to
  supply `datasetId`, exactly the documented Tier-1 contract). The
  pre-existing `xKey`/`yKeys`/`selection` singleton reads (context menu +
  item 7) are a DELIBERATE exception — they're the current globally-shared
  plot/row-selection view, not a "which dataset" decision; making them
  window-scoped is `MULTI_PLOT_PLAN` item 15's job, not this one's. Mount
  contract documented directly in `WorksheetPane.tsx`'s header comment, and
  `plans/MULTI_PLOT_PLAN.md` item 17 annotated with the cross-reference (its
  worksheet-mountability precondition is satisfied here; the window-kind
  promotion itself stays owned there, unbuilt).
