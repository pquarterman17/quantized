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
**Updated:** 2026-08-29 (ALL of #1-#10 shipped: #253/#254/#255, the Class B
branch #259, and #10 below; the 2026-08-28 adversarial bug hunt's eight backend
defects shipped in #256/#257. **No open tasks remain in this plan.**
The acceptance candidate once recorded here, `v0.23.2-rc1` = `cd68ad16`, was
superseded without ever being tagged; the candidate is `v0.23.2-rc2`, cut from
`main` after #264.)

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

### 1. Make class A structurally impossible — **shipped #254** (see Completed)

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

### 2. Make class B structurally impossible — **shipped #259** (see Completed)

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

### 3. `editableFigures` `plot.view` fields not remapped — **shipped #254**

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

### 4. Derived worksheet drops the source's last column — **shipped #259**

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

### 5. `reimportColumnsChanged` compares count, not identity — **shipped #253**

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
  *(Resolved in #253: label sequence positional, plus `column_designations`
  positional only when both sides carry them.)*

### 6. `applyCorrections` / `resetCorrections` delete the measurement column — **shipped #259**

**Class B, a different caller than #245 — and it refutes the Completed row
below that "audited and cleared `corrections.ts`".** `store/corrections.ts`
captures `raw = ds.raw ?? ds.data` at first apply; `addFormula`/`removeFormula`
change `data`'s width and never touch `raw`, so `raw` is frozen at the formula
count it had when corrections were last applied. The next apply (or a Reset —
the user's undo button for a correction) feeds that stale-width `raw` to the
strip, which eats real columns (`expected [ '2m' ] to deeply equal [ 'm', '2m' ]`)
or, after `removeFormula`, leaves `raw` too wide so a re-apply invents a
phantom duplicate column (`expected [ 'm', 'F1', 'F1' ]`). Repro: import →
Smooth 3 → add computed column → Smooth 5. **Data loss.** The two paths already
disagree about what `raw` means (`store/reimport.ts` writes it base-only,
`corrections.ts` base+computed) — that is the root cause task #2 must encode.

- **Files:** `frontend/src/store/corrections.ts`, task #2's input type
- **Acceptance:** red-first with the probe above, both the re-apply and the
  Reset paths, asserting values not just labels; `Dataset.raw` defined as
  always base-only (matching reimport).

### 7. A column-changing reimport leaves `fitSpec` stale — **shipped #259**

`store/reimport.ts`'s `columnsChanged` patch clears `filter`/`channelRoles`/
`channelTypes`/`formulas`/`errorRoles` but not `fitSpec`; `yKey` survives
verbatim and, in-range-but-wrong after the reshape, `recomputeStaleFits` refits
the wrong column and `stampRecompute` overwrites the saved params
(`expected [1000,2000,3000] to deeply equal [100,200,300]`). Fix: `fitSpec:
undefined` in the same patch — it is column-indexed like its five neighbours
and has no honest re-derivation.

### 8. `DataStruct.cat_levels` is index-keyed and reaches neither the strip nor the remap — **shipped #259**

`lib/formula.ts` `baseColumns` slices `labels`/`units`/`values` but carries
`cat_levels` through the spread; `computeFormulas` re-seeds `catLevels` from
the stale map. Deleting a recode column `R1` ahead of an arithmetic `F2` shifts
`F2` into index 1 and it inherits `R1`'s level table — a numeric column renders
as level strings and modelling infers `nominal`. Fix at the chokepoint: strip
`cat_levels` entries at/beyond `keep` inside `baseColumns`. (Only formula
columns are removable, so no `DatasetChannelState` registration is needed
unless a base-column removal path appears.)

### 9. `resetFigureDocumentForReshape` leaves `publication.seriesStyles` — **shipped #259**

`lib/figureDocumentReimport.ts` resets `bindings` + `plot.view` but not
`publication.seriesStyles`, a positional `(ExportSeriesStyle | null)[]` that
**wins** over the view at export (`lib/figureSpec.ts`). After the reset widens
`yKeys` to all channels, the one-entry style array paints the wrong series in
the exported PDF (`expected [ { color: '#ff0000' } ] to deeply equal [ null,
{ color: '#ff0000' } ]`). Fix: clear it (→ derive from the view) in the same
reset.

### 10. Corrections card reachable on a derived worksheet bypasses its pipeline — **shipped, see Completed**

Surfaced by #259's `Dataset.raw` audit. `components/Inspector/Inspector.tsx`
(~line 65) mounts `<CorrectionsCard>` for ANY active dataset with no
`active.derivedFrom` gate, and the card calls `applyCorrections`/
`resetCorrections` directly. A derived worksheet's `.raw` is deliberately the
SOURCE's cached table (`store/derivedWorksheets.ts`'s documented override), not
this dataset's own base — so Apply/Reset from the card on a derived sheet
bypasses `recomputeDerivedSheet` and feeds the wrong-contract `raw` into
`corrections.ts`. Pre-existing; not worsened by #259.

- **Files:** `frontend/src/components/Inspector/Inspector.tsx` (gate), or
  `store/corrections.ts` (refuse with a status message when `derivedFrom` is set
  and point at the derived-sheet corrections path) — the store-side refusal is
  the class fix, the Inspector gate is the instance fix; do both.
- **Acceptance:** red-first — a derived sheet with a source computed column,
  Apply from the card, assert the sheet's columns are unchanged and a status
  message names the derived-sheet path.

---

---

## Completed

### 10. Corrections card reachable on a derived worksheet — 2026-08-29

Both halves shipped, each red-first.

`store/corrections.ts` (class fix) now refuses `applyCorrections` /
`resetCorrections` when `derivedFrom` is set, with a status message pointing at
`freezeCopy`. This covers every caller, not just the card — `folderOps`' bulk
apply, the pipeline workshop's `executeSteps`, and the baseline workshop all
reach this slice, which the task description did not account for.

`components/Inspector/Inspector.tsx` (instance fix) no longer mounts
`CorrectionsCard` for a derived dataset, so the affordance isn't offered at all
rather than offered and refused.

**The consequence was narrower than the task assumed, and is recorded honestly
here.** It is NOT data loss: #259's non-stripping `recomputeFromBaseOrEmpty`
already prevents column deletion on this path, and a probe confirmed the labels
survive. The real defect is STALENESS — the sheet was rebuilt from its cached
copy of the source rather than the source's current data, which
`recomputeDerivedSheet` reads live. Proven with the source moved on to
`[999, 888, 777]` while an apply on the sheet still produced `[20, 40, 60]`:
values derived from a version of the source that no longer exists, with no
error and no toast. Refusing loses no capability, because `.corrections` on a
derived sheet is its pipeline recipe (owned by `recomputeDerivedSheet`) and no
"edit an existing sheet's pipeline" action exists.

## Notes

- **Module ceilings.** `frontend/src/store/relink.ts` is the tightest `.ts`
  module at **490 of its 500-line ceiling** (measured on `dad15cf9`; it was 499
  at #217 and has since been trimmed, so do not trust the older figure in the
  release handoff). Not a bug — but a file near its pin needs an extraction
  rather than a line squeeze when the next feature lands on it.
- **Dependency PRs — landed 2026-08-28** after v0.23.1: #230 (codeql-action),
  #251 (npm minor/patch incl. rolldown/vite/vitest — superseded #229) and #252
  (ruff/mypy/pyinstaller/platformdirs — superseded #231). The rolldown bump
  *gained* 0.6 kB of eager headroom. The one open Dependabot alert (#1, `glib`
  0.18.5 medium, `VariantStrIter` unsoundness) is upstream-blocked: it is
  pulled by `gtk 0.18` ← `tauri 2.11`, Linux-only, and not on any code path
  the app uses — same posture as the earlier extract-zip alert.
- **Bundle headroom: 2.9 kB** as of #261 (886.5 kB eager vs the 889.4 kB
  budget, CI-measured). It really was effectively zero after #259 — CI printed
  "0.0 kB under budget", 68 B of slack. #261 recovered 2.8 kB by lazy-loading
  `SqliteQueryDialog`, whose second, non-obvious eager edge was
  `commands/dataCommands.ts` importing its `SHOW_SQLITE_QUERY` *constant* from
  the component file (that alone pinned the whole dialog eager, so fixing only
  its window listener would have recovered nothing). #261 also recorded a full
  per-module attribution proving no larger split remains: the component surface
  is flat at 5.1 kB max and everything above 3 kB is first-paint, so the next
  lane needing real room needs a justified rule-2 pin raise, not another diet
  pass. Measure on CI, never locally — a drifted local `node_modules` built the
  same tree 0.7 kB larger, enough to invert the pass/fail verdict.
  ORIGINAL #259 NOTE, kept for the record: The Class B fixes grew the eager `useApp`
  chunk 0.6 kB; per the ratchet's rule a lazy split was attempted FIRST
  (`figureDocumentReimport.ts` now loads via dynamic `import()` on the already-
  async reimport path, 0.46 kB lazy chunk) and that is what kept it green.
  The next change to any eager store/lib file WILL trip the ratchet. The
  ratchet's own header
  (`frontend/scripts/check-bundle-size.mjs`) requires attempting a lazy split
  before any pin raise; `ContextMenu` (14.2 kB) is the one real candidate, but it
  puts a Suspense fallback on right-click, which that same rule forbids on a hot
  path. Owner call, and better made deliberately than under CI-red pressure.
  (#261 confirmed that reading and left `ContextMenu` eager for exactly that
  reason; the remaining ~26 kB of command handlers was rejected on the same
  grounds — deferring them puts a dynamic import in front of the first press
  of every keyboard shortcut.)
- **Behavioural-reference (MATLAB) latent bugs surfaced by the 2026-08-28 hunt**
  — fixed on the Python side as deliberate deviations, NOT changed in
  `../quantized_matlab` (fix there only on a branch with headless verify):
  `+utilities/fftSpectral.m:105-106` infers the sampling rate from
  `mean(diff(x))`, which is ~0 for a there-and-back sweep (Python now uses
  `median(abs(diff(x)))`, identical for uniform x, 248/248 goldens unchanged);
  `+calc/+semiconductor/carrierConcentration.m:45` cancels catastrophically for
  |nd−na| ≫ ni (15 % wrong at na=1e18, 1/0 above it; Python now larger-root +
  mass action, 14/14 goldens unchanged); `+parser/importCSV.m:401 detectLayout`
  counts a `nan` cell as text so a 2-column `0.05,nan` row ties the 0.5 majority
  and drops both the row and the header. Also two MATLAB-side declaration bugs
  already on record in memory (`londonDepth.m`/`coherenceLength.m`).
- **Residual, deliberately not fixed (D5):** a leading 2-column row with a truly
  EMPTY cell (`0.05,`) still ties at 0.5 and is dropped. Widening the scorer to
  ignore empty cells was tried and reverted on a concrete counter-example — a
  categorical column's blank row got a false 1.0 and ate the header
  (`test_categorical_missing_cell_encodes_as_nan_not_a_level`). The row scorer
  has no column-type context; a real fix needs one. MATLAB-faithful as it stands.
- **By design, flagged for an owner call:** `Export XRD CSV…` (`io/xrd_csv.py`,
  a faithful port of `writeXRDcsv.m`) writes only the first channel under a
  fabricated `Intensity (counts)` label; an 8-channel SIMS profile exports as 2
  columns. `Export consolidated CSV…` covers all channels. Question is whether
  the command label is honest enough, not whether the code is wrong.

---

## Completed

| Date | Item | PR | Evidence |
|---|---|---|---|
| 2026-08-27 | Class A: `errorRoles`, `groupKey`/`facetKey`, `fitSpec`, `editableFigures` bindings, `composition` | #244 | Red 16 failed/34 passed, then 6 failed/30 passed. Rendered-consequence assertions: `expected [999,999] to deeply equal [7,7]`; `expected { model: 'Linear', yKey: 3 } to deeply equal { ..., yKey: 2 }`. Full gate 564 files / 8747 tests. |
| 2026-08-27 | Class B: reimport deleting base data | #245 | Red 2 failed/40 passed both paths, `expected [ '2x' ] to deeply equal [ 'm', '2x' ]`. Pre-existing — reproduced on the unchanged-shape path, which predates the row-only change. Present in rc1/rc2/rc3. |
| 2026-08-27 | ~~Class B: audited and cleared `corrections.ts`~~ and every `cellEdit.ts` site | — | **The `corrections.ts` half was WRONG** — refuted 2026-08-28 by a failing probe (task #6): `raw` is balanced at the instant of one apply but drifts across the lifecycle because `addFormula`/`removeFormula` never touch it. The `cellEdit.ts` half stands (cell edits keep the column count). Lesson: an audit that reasons "X is Y so the strip is balanced" is a claim about one instant, not a lifecycle; only a probe that exercises the sequence counts. |
| 2026-08-28 | Task 5: `reimportColumnsChanged` compares identity (base label sequence + Origin designations when both sides carry them), not just count | #253 | Red 4 failed/15 passed (reorder, rename, rename-with-formula-exclusion, designation mismatch) → 19/19. No column-rename feature exists, so user edits cannot trip the label comparison. Gate 564 files / 8770 tests. |
| 2026-08-28 | Task 3: `editableFigures.plot.view` `seriesOrder`/`hiddenChannels`/`seriesStyles`/`seriesLabels` remapped on column removal via `remapFigureViewChannels` (reuses `remapViewChannels`) | #254 | Red `expected [ 3 ] to deeply equal []`, `expected [ 4, 3 ] to deeply equal [ 3 ]` → 39/39. |
| 2026-08-28 | Task 1: Class A registration ratchet — every `Dataset`/`PlotView` field must be in `DatasetChannelState`/`ViewChannelState` or in a reasoned exclusion map (`architecture.test.ts`); plan option (b) | #254 | Probe `Dataset.__probeChannelField` → `expected [ '__probeChannelField' ] to deeply equal []`; removed → green. Option (a) rejected: TS cannot structurally tell a channel-indexed `number[]` from `excludedRows`. Exclusions independently checked against the real types. |
| 2026-08-28 | F2: `fitSpec.weight.errKey` never remapped — a deleted column silently re-weighted a saved fit by a *different* column and `stampRecompute` wrote the wrong params back | #255 | Red 4 failed/36 passed incl. full-chain `removeFormula`→`dyForFit` (`expected [100,200,300] to deeply equal [5,6,7]`) → 40/40. `remapFitSpec` shifts `errKey`, drops the whole `weight` when its column was removed. |
| 2026-08-28 | F5: `split`/`duplicateDataset` dropped `errorRoles`, re-enabling the label guesser (`[]` O1 marker vs `undefined` destroyed) | #255 | Red `expected undefined to deeply equal []` at both sites; green with `initialQuickFigureMapping(child).yKeys` staying `[1]`. |
| 2026-08-28 | F6: `migrateLegacyWindow` threaded `groupKey` but not `facetKey` — faceted grid collapsed to one panel on the forward-compat/failed-validation path | #255 | Red 2 failed (`expected null to be 4`) → 9/9 on both fallback paths. |
| 2026-08-28 | Backend D3: plot AND exported PDF x-label used the Origin short name (`A`) while four UI readers show `x_column_long` (`Theta`) — new `_default_x_label` chokepoint in `calc/plotting.py` shared by `build_series` and `build_grouped_series` | #256 | Realdata anchors on `RockingCurve.opju`; 248/248 goldens unchanged. |
| 2026-08-28 | Backend D5: a leading `0.05,nan` row tied the 0.5 majority and dropped the row AND the header — the app could not re-import its own `xrd-csv` export | #256 | Classification-only `_is_numeric_like` (NaN/Inf spellings numeric) in `_delimited_layout.py`; conversion path untouched; 36 differential tests unchanged; round-trip test via the real route. Residual recorded in Notes. |
| 2026-08-28 | Backend D6: an all-blank x column made a file unimportable (`cat_levels[1] must be a non-empty tuple`) — 4 real corpus Origin CSV exports | #256 | `any(cells)` guard mirrored onto the `time_promoted` branch; column dropped with an honest note. |
| 2026-08-28 | Backend D1: `/api/spectral/fft` 500 on a closed hysteresis loop, 63× wrong axis on a near-closed one | #257 | `_infer_sampling_rate` = `median(abs(diff(x)))` + ASCII `ValueError` on a degenerate axis; closed loop now 200 with correct `fs`; 248/248 goldens. |
| 2026-08-28 | Backend D4: 34 HTTP 500s across 18 routes — ten copy-pasted `_call` adapters caught only `ValueError` | #257 | `routes/_errors.py::call_calc` + `CALC_ERRORS = (ValueError, ArithmeticError, LinAlgError)`, every `except ValueError` adapter in 45 route files widened; red-proof by narrowing the tuple (15 tests). |
| 2026-08-28 | Backend D2: 3 of 449 unbounded numeric fields wedge a synchronous worker (`baseline smooth_passes` measured 3,650 s at 1e9; violin `n_points`; histogram `bins`) | #257 | `Field(ge, le)` per the `plot.py:130` precedent, caps from measured timings; thread+join tests that fail rather than hang. |
| 2026-08-28 | Backend D8: `carrier_concentration` catastrophic cancellation — 15 % wrong at `na=1e18`, `ZeroDivisionError` 500 at `na≥1e19` (textbook Si numbers) | #257 | Larger-root-first + `n·p = ni²`; 14/14 goldens unchanged; module split (`_semiconductor_materials.py`) to stay under the 500-line ceiling. |
| 2026-08-28 | Backend D7: 13 non-ASCII error strings across `routes/`, `calc/`, `io/` + an AST guard (`test_route_error_details_are_ascii`) covering `HTTPException(detail=…)` and `raise ValueError/RuntimeError(...)` literals | #257 | Red-proofed per file. |
| 2026-08-29 | Task 2: stripping recomputes take a branded `StrippableData` (only `asAlreadyComputed(d.data)` produces it); `lib/formulaInputs.ts` `recomputeFromBase` is the non-stripping path | #259 | Acceptance probe: pointing `store/reimport.ts` at the stripping variant fails `tsc` — `Argument of type 'DataStruct' is not assignable to parameter of type 'StrippableData'`. |
| 2026-08-29 | Task 4: derived worksheets recompute from the source table without stripping | #259 | Red `["A","B","C_srcComputed"]` + F1 → `["A","B","F1"]`; green keeps all three, values asserted. |
| 2026-08-29 | Task 6: `Dataset.raw` defined ALWAYS base-only; `applyCorrections`/`resetCorrections` capture via `baseColumns` and run `recomputeFromBaseOrEmpty`; every `.raw` reader/writer audited (table in the #259 lane report; `derivedWorksheets`' source-cache override documented as the one exception) | #259 | Red 4/4 (`expected [ '2m' ] to deeply equal [ 'm', '2m' ]` on re-apply AND reset; phantom `[ 'm', 'F1', 'F1' ]` after removeFormula) → green; 359/359 `useApp.test.ts` after two stale base+computed mocks were updated. |
| 2026-08-29 | Task 6 version-skew guard: a `.dwk` from an older build carrying a base+computed `raw` is normalized to base-only at load (`workspaceDatasetParse.ts`, wider → `baseColumns`, narrower left alone, never throws) | #259 | Red `expected [ 'm', '2m', '2m' ] to deeply equal [ 'm', '2m' ]` after reset on a legacy fixture → 5/5. |
| 2026-08-29 | Task 7: reimport's `columnsChanged` patch clears stale `fitSpec` (row-only reshape preserves it) | #259 | Red `expected { model: 'Linear', … } to be undefined` → 44/44. |
| 2026-08-29 | Task 8: `baseColumns` strips `cat_levels` entries at/beyond `keep` (`stripCatLevels` in `formulaInputs.ts`; `formula.ts` sits at its ceiling) | #259 | Red `expected {'1':[…]} to be undefined` + e2e `expected true to be false` → 109/109 + 41/41. Base columns' own levels proven untouched. |
| 2026-08-29 | Task 9: `resetFigureDocumentForReshape` clears `publication.seriesStyles` (positional, wins over the view at export); `publication.overrides` audited, no other positional field | #259 | Red length-1 styles replayed onto widened length-2 `y_keys` → 7/7. |
| 2026-08-29 | Bundle: `figureDocumentReimport.ts` lazy-loaded on the async reimport path (the ratchet-mandated split attempt) | #259 | 889.4 kB (0.1 kB over) → 889.3 kB (green); `applyReimportMerge` stays synchronous for `reimportAllRun.ts`'s atomic batch. |
