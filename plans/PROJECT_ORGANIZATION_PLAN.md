# Project Organization — Folder Tree for the Boson Plotter Library

Give Boson Plotter an Origin-style Project Explorer: a real, persistent
folder tree that organizes datasets (and their figures) into nestable
folders, replacing today's flat list + single-string `group` + render-time
derived grouping. The dataset array stays flat so plotting, export,
multi-select, and the row-state chokepoint are undisturbed; folders are an
explicit organization layer over it. This is the "can I organize my work
like Origin?" gap surfaced by the Origin-import work — where the
project→book→sheet→graph hierarchy we already decode is currently thrown
away on import and re-approximated from name prefixes.

**Status:** Active
**Created:** 2026-07-04
**Updated:** 2026-07-08 (items 3, 4, 6 complete — drop-between DnD reorder/reparent
shipped (3b) and the legacy `group` string is fully migrated into folders (6),
closing item 4's last box too; only Tier 3 nice-to-haves remain open)

---

## Context

### How the pieces fit together

The Library today (`frontend/src/components/Library/`) renders a **flat
`datasets: Dataset[]` array** (`store/useApp.ts`) whose order is insertion
order. The only stored organizational datum is `Dataset.group` — a single
flat string, no nesting, no id. Every visual grouping (`groupDatasets`,
`originBookFamilies`, `originSheetGroups` in `lib/grouping.ts`) is **derived
at render time** by string-parsing `name` and `metadata.origin_book`; none
is stored, so a rename silently dissolves a family. `originFigures` is a
**separate store array that evaporates on `.dwk` reload**. The `.dwk`
workspace (`lib/workspace.ts`, `version === 1`) serializes only the dataset
array (+ the `group` string); it drops selection, active dataset, figures,
and view state.

The chosen model (Approach B) adds a **normalized folder tree** — folder
nodes carrying `id / name / parentId / order` — plus a `folderId` and
`order` on each dataset. Folders are pure organization: they reference
dataset ids and **never touch `excludedRows`/`filter`**, so the #11
row-state chokepoint guard is satisfied by construction. Datasets stay a
flat array, so `build_series`, export column order, `selectRange`, and
`rowstate.analysisData` are unchanged.

### Data / control flow

```
import .opj/.opju ─► flat Dataset[]  ─┐
   (books, @sheet)                    ├─► store: datasets[] (flat, plotted)
                                      │            + folders[] (tree, organization)
   figures ──────────► originFigures ─┘            + folderId/order on each item
                                                        │
 Library render ◄── useLibraryTree (folders[] + datasets[] → ordered tree view)
                                                        │
 save/reload   ◄──► .dwk v2 { datasets[], folders[], figures[], activeId,
                              selectedIds, expanded[] }  (migrates v1)
```

Key design decisions (kept out of the tiers as they are cross-cutting):
- **Order model:** fractional-index sort keys (or reindex-on-move) scoped
  to a parent, so drag-reorder within a folder works and finally removes
  the current reorder-vs-group mutual exclusion (`Library.tsx:70`).
- **Membership on the dataset (`folderId`), tree on folders (`parentId`)** —
  deleting a dataset can't dangle a ref; deleting a folder cascades or
  reparents its members (decide: reparent-to-parent is the safe default).
- **Root is implicit** (`folderId` absent / `parentId` null = top level).

### Dependency map

- Item 1 (model) is the foundation — items 2–6 all require it.
- Items 2 (persistence) and 3 (UI) are parallel after item 1.
- Item 5 (figures in tree) requires items 1 + 2.
- Item 6 (`group` migration) requires items 1 + 2.
- Item 7 (max-lines test) is independent; land it with item 3 to guard the
  new UI from day one.
- Items 8–9 are later; 9 (tags/smart-folders) is the complementary
  secondary layer, deliberately not the base model.

---

## Tier 3 — Nice-to-Have

7. **Enforce the component max-lines ceiling** — the ~400-line rule has no
   committed test (only a skill grep); the new tree UI could silently bloat.
   - [ ] Add a vitest that fails any `.tsx` over the ceiling; fix current
         over-ceiling files or record explicit exemptions.

8. **Folder-level bulk operations** — export all in a folder, apply
   corrections/template to a folder, bulk move/remove by folder.

9. **Tags / smart-folders (complementary secondary view)** — saved
   tag/name/format queries as cross-cutting "smart folders" layered on top
   of the containment tree (a dataset can appear in several). Deliberately
   secondary to the folder tree, not a replacement.

---

## Completed

- ~~**6. Migrate the flat `group` string → folders**~~ (2026-07-08) —
  `lib/foldertree.migrateGroupsToFolders` (pure, idempotent): for every
  un-foldered dataset carrying a non-blank `.group`, create-or-reuse (by name)
  a root-level folder and move the dataset into it, then clears `.group` — its
  job (migration) is done, so re-running on an already-migrated set is a true
  no-op (same array references). Wired into `useApp.loadWorkspace`, which
  BOTH triggers that call it (the autosave restore on startup, and an
  explicit File ▸ Open `.dwk`) funnel through, so a v1 doc migrates exactly
  once either way; the newly-created folder is auto-revealed
  (`expandedFolders`). Dropped the group-chip UI entirely: `DatasetRow`'s
  group input/button, `Library`'s group-filter dropdown, and the collapsible
  group-sections rendering; `lib/grouping.ts`'s `groupDatasets`/`hasAnyGroup`/
  `groupNames` (which existed only to serve that UI) removed along with their
  tests. `Dataset.group` the field + `parseWorkspace`'s read stay — the
  compat surface the plan asked to keep — nothing renders off it anymore.
  +9 pure/store tests (creation, dedup-by-name reuse, idempotence-on-reload,
  clearing) + 3 Library integration tests confirming the flat-list fallback
  still renders correctly once groups are gone.
- ~~**4. Origin import → auto folder structure**~~ (2026-07-08) — closed the
  last open box: `originSheetGroups`' "sheet N" chip/indent decoration
  (`Library.tsx`) is now gated to `folders.length === 0` — a fallback for
  un-foldered legacy datasets (a `.dwk` saved before this item shipped) only.
  Once real folders exist (`planOriginFolders`, landed earlier), the tree's
  own nesting already conveys the sheet relationship, so the chip would just
  double-decorate it. `originBookFamilies`' bulk-manage widget
  (`BookFamiliesSection`) is untouched — it was never a render-grouping
  mechanism, so "retire as primary grouping" didn't apply to it.
- ~~**3. Library tree UI (decomposed) + drag move/reorder**~~ (2026-07-08) —
  3b (the drop-target DnD) shipped, closing the item: `lib/foldertree` gained
  pure hit-testing (`dropEdgeAt` — half-height split for dataset-row reorder;
  `dropZoneAt` — 3-zone split for folder headers; `resolveDropBeforeId`).
  `DatasetRow` shows a thin above/below indicator while a dataset drag hovers
  it and, on drop, reorders within (or moves into) the hovered row's own
  folder. `FolderRow` now ALSO accepts a dragged folder (a distinct
  `FOLDER_DND` payload type): the thin top/bottom edge bands reposition it as
  a sibling of the target (before/after, same parent), the wide middle band
  reparents it into the target — dropping a folder into its own descendant is
  a silent no-op via `moveFolder`'s existing `isSelfOrDescendant` cycle guard
  (no new UI-side check needed). +25 tests: foldertree geometry (pure) +
  DatasetRow/FolderRow DnD wiring via the synthetic-DragEvent pattern
  (`AxisDropZones.test.tsx`'s jsdom workaround — hand-built `DragEvent` +
  mocked `getBoundingClientRect`).
- ~~**5. Persistent figures inside the tree**~~ (2026-07-05) — two halves:
  **(a) `.dwk` persistence** — `originFigures` serialized in `lib/workspace.ts`
  and restored in `useApp.loadWorkspace` (was hard-reset to `[]`, dropping every
  imported graph on reload); parse validates each entry and clamps
  `datasetId`/`siblingIds` to surviving datasets so a figure can't dangle; flows
  through manual `.dwk` save + autosave (both pass full `getState()`); +5
  round-trip tests. **(b) nested in the tree** — `buildTreeRows` homes each
  figure to its bound dataset's folder (unresolved → first sibling's folder →
  root) and emits a `figure` row after that folder's datasets; a figure follows
  its book when the book is moved (placement derived from live state). Shared
  `FigureRow` renders in both the tree and the flat `FiguresSection`, which is
  now hidden in tree mode (the `!inTree` gate) so figures never double-show. +5
  tree + 2 Library integration tests. Frontend 921 green. (`e9e5196`, this
  commit)
- ~~**2. `.dwk` v2 persistence + migration**~~ (2026-07-04) — `WORKSPACE_VERSION`
  → 2; `.dwk` + localStorage autosave now carry the folder tree,
  `folderId`/`order`, active/selection, and folder expansion. v1 docs
  migrate (empty tree, first dataset active). Defensive load: prune
  dangling `folderId`, reparent orphan folders, clamp stale active/
  selection. `WorkspaceState` (input) + `LoadedWorkspace` (parsed).
  Autosave fires on folder/selection changes too. +8 tests. (`19c79d4`)
- ~~**1. Folder data model + store actions**~~ (2026-07-04) — `FolderNode
  {id,name,parentId,order}` + `Dataset.folderId`/`order` (`lib/types.ts`);
  `lib/order.ts` (`orderBetween`/`byOrder`); `lib/foldertree.ts` — pure,
  immutable ops (child queries, create/rename/delete[reparent|cascade],
  `moveFolder` with cycle guard, `moveDatasetToFolder`, `pruneOrphans`);
  `useApp` `folders` slice + 5 thin store actions. Reindex-on-move (dense
  ints) instead of fractional keys — simpler, precision-proof at Library
  scale. Datasets stay flat; membership on `folderId` → a delete can't
  dangle a ref. 44 unit/store tests. (`5dafbfd`, `6bd12df`)
