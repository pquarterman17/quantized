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
**Updated:** 2026-07-05 (item 5 figure `.dwk` persistence shipped)

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

3. **Library tree UI (decomposed) + drag move/reorder** — the Project
   Explorer view, built to stay under the component ceiling. (3a landed;
   drag-*reorder* within a folder remains — 3b.)
   - [x] `useLibraryTree` hook (folders[] + datasets[] → ordered, nested
         view-model with expand/collapse). — `8a2b45b`
   - [x] `FolderRow` component; `Library.tsx` stays a thin container mapping
         tree rows to FolderRow/DatasetRow.
   - [x] Move a dataset into a folder — drag a row onto a folder header, or
         the row context menu; folder menu: New subfolder / Rename / Delete.
   - [x] Replace the reorder-vs-group exclusion (flat up/down arrows hidden
         once folders exist).
   - [ ] Drag to **reorder** within a folder (drop-between) and drag a folder
         to reparent/reposition — the `move*` store actions already support
         it; only the drop-target DnD is left (3b).

---

## Tier 2 — Medium Impact

4. **Origin import → auto folder structure** — stop discarding the decoded
   hierarchy. Ground truth (live COM, OriginPro 2026b): corpus projects have
   REAL Project Explorer folders (Moke.opj → `Raw normalized`/`Sub subtraction`;
   RockingCurve.opju → `Folder1`), so faithful mirroring needs the PE folder
   tree, not just book→sheet.
   - [x] Frontend: `planOriginFolders` builds project folder (stem) →
         `origin_folder_path` (nested PE folders) → multi-sheet book subfolders
         → sheets; wired into `importFiles`; flat file→book→sheet fallback when
         no folder path. General, not sample-tuned (keyed on structure, not
         joined names: arbitrary depth / duplicate / unicode / spaced names).
         (`dc42f99`, `a94fc16`)
   - [x] Backend: `io/origin_project/tree.py` decodes the PE folder tree and
         attaches `metadata.origin_folder_path` (root-exclusive). **`.opj`:
         100% vs live-Origin-COM across 7 diverse files (611/611 windows, incl.
         4–5-level nesting + duplicate names + root-level mixes). `.opju`: BOTH
         CPYUA sub-versions decoded by one unified parser — 4.3811 (OriginPro
         2026b) on 11 controlled specimens + 4.3380 (the sample corpus) on all
         5 corpus files, byte-exact vs live COM. Handles the 39-book `Hc2 data`
         (report-table windows in the ordinal space + sibling/nested folders) —
         the case that broke the first naive attempt. Fail-closed on any
         framing/consistency mismatch.** (`4e1031e`, `d27a1bb`)
   - [x] Verified Origin PE tree == Boson Library tree via COM: `.opj` matches
         (XRD `Folder1`✓, Moke `Raw normalized`/`Sub subtraction`✓); `.opju`
         4.3811 (real1/real2/deep3/emptyf/split/nested) AND 4.3380
         (RockingCurve/XAS/UnpolPlots/Fixed Lambdas/Hc2) all COM-pinned.
   - [ ] Retire `originBookFamilies`/`originSheetGroups` as the *primary*
         grouping once folders exist (keep as a fallback for un-foldered
         legacy datasets, or delete if migration covers them). *(overlaps #6)*

5. **Persistent figures inside the tree** — let a project contain its
   graphs, like Origin.
   - [x] Persist `originFigures` in `.dwk` v2 (previously dropped on load) —
         serialized in `lib/workspace.ts`, restored in `useApp.loadWorkspace`
         (was hard-reset to `[]`); parse validates each entry and clamps
         `datasetId`/`siblingIds` to surviving datasets so a figure can't
         dangle. Flows through both manual `.dwk` save and autosave (both pass
         full `getState()`). +5 round-trip tests.
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
