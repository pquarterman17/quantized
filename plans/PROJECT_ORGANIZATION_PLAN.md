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
**Updated:** 2026-07-04

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

## Tier 1 — High Impact

1. **Folder data model + store actions** — the normalized tree + membership
   fields and the operations over them.
   - [ ] Add `FolderNode { id, name, parentId, order }` and a `folders`
         slice to `useApp` state; add `folderId?`/`order?` to `Dataset`
         (`lib/types.ts`).
   - [ ] Tree actions: `createFolder(parentId, name)`, `renameFolder`,
         `deleteFolder(id, mode: reparent|cascade)`, `moveFolder(id,
         newParentId, beforeId?)`.
   - [ ] Membership/order actions: `moveDatasetToFolder(id, folderId,
         beforeId?)`, `reorderWithinFolder(...)`; keep the flat `datasets`
         array intact (order layer is `order`, not array index).
   - [ ] Fractional-index helper (`lib/order.ts`) with a reindex fallback;
         unit-test insert-between and rebalance.
   - [ ] Guard against cycles (moving a folder into its own descendant) and
         orphaned `folderId` (dataset points at a deleted folder → root).

2. **`.dwk` v2 persistence + migration** — make an organized project
   survive save/reload (without this the feature is cosmetic).
   - [ ] Bump `WORKSPACE_VERSION` to 2; extend `WorkspaceDoc` with
         `folders`, `activeId`, `selectedIds`, and folder `expanded` state.
   - [ ] Relax the strict `version === 1` gate to accept v1 (migrate: every
         dataset → root, no folders) and v2; keep v1 round-trip green.
   - [ ] Persist + restore `activeId`/`selectedIds` (today reset to
         `datasets[0]`), and folder expansion (today component-local).

3. **Library tree UI (decomposed) + drag move/reorder** — the Project
   Explorer view, built to stay under the component ceiling.
   - [ ] Extract a `useLibraryTree` hook (folders[] + datasets[] → ordered,
         nested view-model; expand/collapse; DnD intent).
   - [ ] `FolderRow` + `TreeSection` sub-components; `Library.tsx` stays a
         thin container (workshop pattern).
   - [ ] Drag a dataset into a folder and reorder within a folder; context
         menu: New folder / Rename / Move to… / Delete folder.
   - [ ] Replace the reorder-vs-group exclusion with tree-native ordering.

---

## Tier 2 — Medium Impact

4. **Origin import → auto folder structure** — stop discarding the decoded
   hierarchy.
   - [ ] On `.opj`/`.opju` import, create a project folder (file stem) with
         per-book (and per-`@N` sheet) subfolders from `origin_book` /
         `origin_book_long`, and drop the imported datasets into them.
   - [ ] Retire `originBookFamilies`/`originSheetGroups` as the *primary*
         grouping once folders exist (keep as a fallback for un-foldered
         legacy datasets, or delete if migration covers them).

5. **Persistent figures inside the tree** — let a project contain its
   graphs, like Origin.
   - [ ] Persist `originFigures` in `.dwk` v2 (today dropped on load).
   - [ ] Represent figures as tree items under their project folder (via
         `datasetId`/`siblingIds` already on `OriginFigureEntry`).

6. **Migrate the flat `group` string → folders** — one organizational model,
   not two.
   - [ ] On load/migration, map each distinct `Dataset.group` to a
         root-level folder and set `folderId`; drop the `group` chip UI.
   - [ ] Keep a compatibility read of `group` for old `.dwk` files.

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

_(none yet)_
