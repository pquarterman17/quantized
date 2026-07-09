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
**Updated:** 2026-07-09

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

- **D1 — header-click gesture (item 6).** Today header click = sort. Origin
  muscle memory says header click = select column. Recommendation: click
  selects (ctrl-click adds, shift-click ranges), sorting moves to the
  context menu (already there) plus a small sort glyph in the header.
  Alternative: keep click-to-sort and select via ctrl-click only — safer
  for existing users, weaker Origin parity. Decide before item 6.
- **D2 — designation editing.** v1 displays designations read-only; the
  store-level equivalents (Set as X, Plot as Y, error pairing, channel
  roles) remain the mutation surface. Making `column_designations` itself
  editable would mean writing into imported metadata — deferred unless
  requested.
- **D3 — text/report sheets.** Recommendation (item 8): render
  `origin_text_columns` as read-only string columns in the grid (a
  text-only book currently shows an empty worksheet); `origin_report_sheets`
  stay Inspector-only (`OriginProvenanceCard` already renders them well —
  they are unresolved cell:// stubs, not tabular data).
- **Stats fan-out at scale:** the opt-in stats footer posts one
  `/api/stats/descriptive` call per column — a 200-column sheet is 201
  requests. Acceptable while opt-in; item 10 measures it and books a
  batched endpoint only if it hurts.
- **`originSheetGroups` keying collision:** two different imported projects
  can both contain a "Book1" — the sheet groups would merge across
  projects. Item 5 hardens the grouping (scope the parent key by import
  stem) with a regression test in `grouping.test`.

---

## Tier 1 — High Impact

1. **Pure windowing math + column-metadata helpers** — (M) the two
   dependency-free libraries everything else builds on.
   - [ ] `lib/gridwindow.ts`: scroll offsets + viewport size + fixed row
         height / column width → visible index ranges, translate offsets,
         spacer dimensions; overscan; degenerate-viewport (jsdom) fallback;
         unit tests for boundaries (top/bottom, exact-fit, tiny viewport)
   - [ ] `lib/columnmeta.ts`: per-value-column designation / comment /
         Origin short name aligned by `origin_column_names` (null-safe for
         non-Origin data); unit tests incl. missing/partial metadata
   - [ ] Refactor `lib/errorbars.ts` (`originErrKeys`,
         `originHiddenChannels`) to read alignment through `columnmeta` —
         behaviour-identical, existing `errorbars.test.ts` stays green

2. **Virtualized grid subtree — kill `MAX_ROWS`** — (L) replace
   `WorksheetTable.tsx` with `components/Stage/worksheet/` (the workshop
   pattern), every existing grid feature preserved, each file ≤400 lines.
   - [ ] `GridViewport.tsx`: scroll container, spacer, windowed layer,
         sticky header / row-number gutter / corner; row + column windowing
         from `lib/gridwindow`; ARIA grid roles
   - [ ] `GridHeader.tsx`: header cells (labels, units, sort marks, ƒx +
         remove button, context-menu hook) — designation/comment display
         lands in item 4
   - [ ] `useCellEdit.ts` + row/cell rendering: double-click edit →
         `setCellValue`, Enter/Esc/blur semantics, computed-column
         read-only dimming, mask (#50) / filter-out (#53) / selection
         styling via `lib/rowstate` reads ONLY
   - [ ] `GridStatsFooter.tsx`: sticky footer, stats over `analysisRows`
         (unchanged fetch), "ignore"-role blanking preserved
   - [ ] Remove `MAX_ROWS` + the "showing N of M" banner; TSV copy still
         materializes ALL kept rows (data op, not DOM)
   - [ ] `Worksheet.test.tsx` green (role queries adjusted, no coverage
         lost) + new tests: windowed rendering, edit-in-window, scroll math
         via the pure lib

3. **Container split: `useWorksheetView` + prop-driven `WorksheetPane`** —
   (M) thin the 395-line container BEFORE items 4–7 add to it; this split
   is also most of Stage D's mountability (item 11 verifies it).
   - [ ] `useWorksheetView.ts`: filter/sort/order/analysisRows/stats state
         + the extract/copy actions, taking the dataset as an argument
   - [ ] `worksheetMenus.ts` (or equivalent): column/row context-menu item
         builders extracted
   - [ ] `WorksheetPane.tsx` renders toolbar + filter bar + grid for an
         explicit `datasetId` prop; `Worksheet.tsx` becomes the thin
         stage-tab wrapper feeding `activeId` — no `useActiveDataset` reads
         inside the subtree
   - [ ] Relocate `WorksheetToolbar` / `WorksheetFilterBar` into the
         subtree (git mv, keep history); all files ≤400, no new pins

4. **Origin designation + comment display in headers** — (S) the decoded
   metadata finally visible where Origin users look for it.
   - [ ] Designation badge in the header role line (X · Y · yEr · xEr ·
         Label · Disregard) from `lib/columnmeta`, replacing the bare
         channel letter when an Origin short name exists (true short name,
         not the formula letter); x column keeps its X badge
   - [ ] Column comment as a second header line, truncated, full text in
         the tooltip; "Disregard"/"Label" columns dimmed like `channelRoles`
         columns are today
   - [ ] Tests: designation/comment rendering, non-Origin datasets
         unchanged (no badge noise)

5. **Sheet tab strip (book container)** — (M) Origin book families
   navigable inside the Worksheet tab, composing over sibling datasets.
   - [ ] `SheetTabs.tsx` in the subtree: bottom strip listing the active
         dataset's `originSheetGroups` siblings (sheet number + long-name
         note from `origin_book_long`); active sheet highlighted; click →
         `setActive` (verified: stage tab stays "worksheet"; plot view
         reset = today's Library-click semantics, documented)
   - [ ] Hidden for non-Origin / single-sheet datasets; per-sheet
         masks/filters/formulas naturally per-Dataset (no shared state)
   - [ ] Harden `grouping.ts` sheet-group keying against same-named books
         from different imports (scope by import stem) + regression test
   - [ ] Tests: strip presence/absence, switch updates `activeId`, grid
         re-renders the new sheet

## Tier 2 — Medium Impact

6. **Column selection model in the grid** — (M) the selection half of
   Origin's highlight-and-plot gesture; requires decision D1.
   - [ ] Selected-column set in `useWorksheetView` (transient, not
         persisted); click / ctrl-click / shift-range per D1; full-column
         highlight via a token-based style; Esc clears
   - [ ] Sort gesture relocated per D1 (context menu retained either way);
         `Worksheet.test.tsx` updated deliberately
   - [ ] Selection survives scrolling (keyed by column index, not DOM)

7. **Selection → plot** — (M) designation-aware mapping onto EXISTING
   store actions; no new plotting pathway.
   - [ ] Pure mapping helper (in `lib/columnmeta` or beside it): an
         X-designated column in the selection wins as X (else current
         `xKey` stays), Y-error columns pair to the nearest preceding
         selected Y (the `originErrKeys` rule), Label/Disregard skipped;
         unit-tested against Origin corpus shapes
   - [ ] "Plot selection" affordances: toolbar button + column context-menu
         entry (+ replace-vs-"Add to plot" append variant), calling
         `setXKey`/`setYKeys`/the errKeys action — macro recording free
   - [ ] Row-state proof: plotted result honors exclusions/filter because
         it rides the existing plot pipeline (no allowlist change)

8. **Text-sheet rendering** — (M) decide-and-ship D3: what the worksheet
   shows for non-numeric Origin sheets (today: an empty grid).
   - [ ] `origin_text_columns` rendered as read-only string columns
         appended after numeric columns (text-only books: text columns are
         the whole grid); no edit, no stats, excluded from selection→plot
   - [ ] `origin_report_sheets` stay Inspector-only (OriginProvenanceCard);
         a one-line worksheet hint points there when a sheet carries them
   - [ ] Tests over both metadata shapes

9. **Book switcher for multi-book families** — (S) jump between books of
   the same imported project from the strip (`originBookFamilies`), not
   just sheets of one book — a compact dropdown at the strip's left end.

10. **Perf validation at Origin-project scale** — (S) measure, don't
    assume: synthetic 100k-row × 200-column dataset through the grid.
    - [ ] Scroll frame budget, mount time, memory; rAF-throttle scroll
          handling if measurement demands it
    - [ ] Stats-footer fan-out timing (risk note) — book a batched
          endpoint as a follow-up ONLY if measured slow

11. **Stage D readiness: worksheet as future window content** — (S) verify
    the Stage B container is mountable as MDI window content;
    cross-reference `plans/MULTI_PLOT_PLAN.md` item 17, which OWNS the
    window-kind promotion — nothing window-shaped is built here.
    - [ ] Audit: `WorksheetPane(datasetId)` has no `useActiveDataset` /
          singleton-view reads inside the subtree (item 3's contract);
          document the mount contract in the component header
    - [ ] Note in MULTI_PLOT_PLAN item 17 that the worksheet half of its
          precondition is satisfied by this item (plan-hygiene
          cross-reference, no duplicate booking)

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
