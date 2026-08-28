# Silent State Corruption

Two defect classes that a fully green test suite has now failed to catch eight
times between them. Both corrupt data or bindings **silently** — no toast, no
error, nothing on screen — and both recur because the precondition each depends
on is written in a comment rather than encoded in a type. The structural items
here (#1, #2) are the point of this plan; the individual instances (#3-#5) are
the ones still open at the time of writing, and are cheap once the structure
exists.

**Status:** Active
**Parent:** MAIN_PLAN.md
**Created:** 2026-08-27
**Updated:** 2026-08-27 (created after the #241-#246 wave; five instances of
class A and three of class B fixed, three instances still open)

---

## Context

### Class A — stale column indices

State keyed by a **column index** goes stale when the column count changes, so
the surviving indices silently point at different data.
`frontend/src/lib/channelRemap.ts` exists to state the remap rule once, and its
own header documents four instances found before today. Five more were found on
2026-08-27:

| Field | Consequence | Fixed in |
|---|---|---|
| `Dataset.errorRoles` | error bars attach to the wrong channel | #244 |
| view `groupKey` / `facetKey` | re-facets the grid on the wrong column | #244 |
| `Dataset.fitSpec.xKey`/`.yKey` | **a saved fit's params overwritten with a fit of the wrong column** | #244 |
| `editableFigures` bindings | a saved figure reopens plotting the wrong column | #244 |
| `composition` render cache | pre-removal facet panels keep rendering | #244 |

The `fitSpec` one is the worst of the set and worth understanding, because it
shows why "it has a guard" is not the same as "it is guarded":
`lib/fitselection.ts`'s only check is `yKey < 0 || yKey >= width`, so an
in-range but now-**wrong** index passes; `removeFormula`'s trailing
`touchDataset` then runs `recomputeStaleFits`, which stamps the result back onto
`fitSpec` at `store/recalcFits.ts:63`.

**Why it recurs:** nothing forces a newly added column-index-keyed field to be
registered with the remap. Each new field is a fresh chance to forget, and the
tests pass either way because no test knows the field exists.

### Class B — strip mismatch

`recomputeData` / `recomputeWithErrors` (`frontend/src/lib/formula.ts`) call
`baseColumns(data, formulas.length)`, which **strips the last `formulas.length`
columns** before reapplying the formulas. That is correct only when `data`
already carries those computed columns. Three call sites, three different
answers:

| Call site | Does `data` carry the computed columns? | Verdict |
|---|---|---|
| `store/cellEdit.ts` (all sites) | yes — `d.data`-derived edits, count unchanged | correct |
| `store/corrections.ts` (apply + reset) | yes — `raw` is `ds.raw ?? ds.data`, so the strip is balanced | correct |
| `store/reimport.ts` | **no** — freshly re-read file, base columns only | **fixed in #245** |
| `store/derivedWorksheets.ts:90` | **no** — the *source's* table, never the sheet's own | **open, see #4** |

The reimport instance deleted the user's measurement column outright: with base
column `m` and formula `2x`, a re-import returned `labels: ["2x"]`,
`values: [[null], [null], [null]]`. It was **pre-existing**, so it shipped in
`v0.23.0-rc1`, `-rc2` and `-rc3`; `v0.23.0-rc4` is the first candidate without
it.

**Why it recurs:** both functions take a bare `DataStruct` and silently assume a
property of it that the type cannot express. A caller has no way to be wrong
loudly.

---

## Tasks

### 1. Make class A structurally impossible

**Goal:** adding a column-index-keyed field without registering it with the
remap should fail a test, not ship.

`channelRemap.ts` already centralises the *rule*; what is missing is anything
that notices a field which never reached it. Options, in the order worth trying:

- A registry the remap and the state type are both derived from, so a field that
  is not in the registry does not exist on the type.
- Failing that, an `architecture.test.ts` ratchet in the shape of the existing
  `HISTORY_EXCLUDED` store-field registration: enumerate the index-keyed fields
  on `Dataset` and `PlotView`, and fail when one appears that the remap does not
  name.

The second is strictly weaker (it catches the omission at test time rather than
compile time) but matches a pattern the repo already uses and enforces.

- **Files:** `frontend/src/lib/channelRemap.ts`, `frontend/src/lib/types.ts`,
  `frontend/src/lib/plotview.ts`, `frontend/src/architecture.test.ts`
- **Acceptance:** add a throwaway index-keyed field to `Dataset`; the build or
  the suite fails naming it. Remove it; green.
- **Stop when:** that probe fails as described. Do not also refactor the existing
  remap helpers — they are correct and covered.

### 2. Make class B structurally impossible

**Goal:** a caller cannot pass base-only data to a stripping recompute without
saying so.

The cheapest honest fix is to stop overloading one `DataStruct` for two
different contracts. Either:

- give the stripping variants a distinct input type (a branded/wrapper type that
  only `d.data`-shaped values satisfy), or
- keep one type and add an explicit assertion — `data.labels.length >=
  formulas.length` is necessary but **not sufficient** (the reimport bug
  satisfied it), so the assertion must be about provenance, not arithmetic.

Note `recomputeData` currently has **no** non-test caller after #245; consider
whether it should exist at all, or whether `applyFormulas` +
`recomputeWithErrors` are the honest pair.

- **Files:** `frontend/src/lib/formula.ts`, `frontend/src/store/useApp.ts`
  (`recompute` helper), plus the four call sites in the table above.
- **Acceptance:** point `store/reimport.ts` back at the stripping variant; it
  fails to compile (or fails an assertion test). Restore; green.
- **Stop when:** that probe fails as described.

### 3. `editableFigures` `plot.view` fields not remapped

`remapFigureBindings` (added #244) covers `FigureBindings`, but a saved figure
also holds a `plot.view` copy of `seriesOrder` / `hiddenChannels` /
`seriesStyles` / `seriesLabels`. Those are not remapped on a column removal.

Severity is **cosmetic** — a style or hidden flag follows the shifted column —
not "plots the wrong column". The live-view analogue of exactly these fields
*is* handled, by `remapViewChannels`; this is the saved-document copy.

- **Files:** `frontend/src/lib/channelRemap.ts`,
  `frontend/src/store/computedColumns.ts`
- **Acceptance:** red-first — a saved figure with `hiddenChannels: [3]` over
  F1@3/F2@4 must not hide F2 after F1 is removed.

### 4. Derived worksheet drops the source's last column

`store/derivedWorksheets.ts:90` calls `recompute({ ...sheet, data, raw:
sourceData })` where `data` is the **source's** table. `recompute` strips
`sheet.formulas.length` columns from it — but `data` never carried the sheet's
own computed columns, so the strip eats real source columns.

**Proven, not suspected.** Probe: source table `["A", "B", "C_srcComputed"]`
plus sheet formula `F1` yields `["A", "B", "F1"]` — `C_srcComputed` silently
gone. Requires a derived worksheet that has its own formula over a source that
has a computed column.

Below #245 in severity (the dropped column is derived and the source dataset
still holds it) but the same class.

**The fix cannot be applied to `recompute` itself** — `store/cellEdit.ts`'s
callers pass `d.data`, which does carry the sheet's computed columns and
legitimately needs the strip. `derivedWorksheets` needs its own non-stripping
path. Task #2 should make this a compile error rather than a judgement call.

- **Files:** `frontend/src/store/derivedWorksheets.ts`
- **Acceptance:** red-first with the probe above, asserting the recomputed
  values, not just the surviving label.

### 5. `reimportColumnsChanged` compares count, not identity

`frontend/src/lib/reimport.ts` decides "did the columns change?" by comparing
`fresh.labels.length` against the base column count. A file whose column
*meaning* changed while the count did not — a user re-designating columns in
Origin, or a reordered export — keeps the old `channelRoles` / `errorRoles` /
`filter`, all of which now describe different columns.

Pre-existing and narrower than the fixed bugs, but it is the same failure mode
one level up: the predicate is a proxy for the property it is asked about.

- **Files:** `frontend/src/lib/reimport.ts`
- **Open question:** what identity signal is available and cheap — label
  sequence, Origin short names, `column_designations`? Decide before coding;
  a wrong identity check is worse than an honest count check.

---

## Notes

- **Module ceilings.** `frontend/src/store/relink.ts` is the tightest `.ts`
  module at **490 of its 500-line ceiling** (measured on `dad15cf9`; it was 499
  at #217 and has since been trimmed, so do not trust the older figure in the
  release handoff). Not a bug — but a file near its pin needs an extraction
  rather than a line squeeze when the next feature lands on it.
- **Dependency PRs** (triaged 2026-08-27): #230 (codeql-action patch) is CI-only
  and mergeable any time. #229 bumps **rolldown, the bundler**, against 0.9 kB of
  eager-bundle headroom — land it after v0.23.0 and re-measure. #231 bumps
  **pyinstaller, which builds the release sidecar**, plus ruff (new rules
  routinely redden CI) — after v0.23.0, so the acceptance-tested artifacts and
  the shipped ones share a toolchain.
- **Bundle headroom is 0.9 kB** as of `a8a939c1`. The ratchet's own header
  (`frontend/scripts/check-bundle-size.mjs`) requires attempting a lazy split
  before any pin raise; `ContextMenu` (14.2 kB) is the one real candidate, but it
  puts a Suspense fallback on right-click, which that same rule forbids on a hot
  path. Owner call, and better made deliberately than under CI-red pressure.

---

## Completed

| Date | Item | PR | Evidence |
|---|---|---|---|
| 2026-08-27 | Class A: `errorRoles`, `groupKey`/`facetKey`, `fitSpec`, `editableFigures` bindings, `composition` | #244 | Red 16 failed/34 passed, then 6 failed/30 passed. Rendered-consequence assertions: `expected [999,999] to deeply equal [7,7]`; `expected { model: 'Linear', yKey: 3 } to deeply equal { ..., yKey: 2 }`. Full gate 564 files / 8747 tests. |
| 2026-08-27 | Class B: reimport deleting base data | #245 | Red 2 failed/40 passed both paths, `expected [ '2x' ] to deeply equal [ 'm', '2x' ]`. Pre-existing — reproduced on the unchanged-shape path, which predates the row-only change. Present in rc1/rc2/rc3. |
| 2026-08-27 | Class B: audited and cleared `corrections.ts` and every `cellEdit.ts` site | — | `raw` is `ds.raw ?? ds.data` so the strip is balanced; cell edits keep the column count. Recorded so the audit is not repeated. |
