# Preset Bar Contract

The design contract for item 40 (a preset bar on every analysis tool) of `ORIGIN_FEATURE_GAP_PLAN.md`, written before
any code, as the owner asked on 2026-11-26. A preset bar gives each analysis workshop named settings and a "last
used" entry. This document says where presets live, their shape, how they are versioned and fail closed, what Apply
does to an open panel (including the Cancel question item 44 raised), how the existing recipes and fit templates
relate, the rollout order, and the small adapter each workshop writes so that rollout is mechanical. It changes no code.

**Status:** Accepted 2026-11-26 (orchestrator review; notes below)
**Parent:** ORIGIN_FEATURE_GAP_PLAN.md
**Created:** 2026-11-26
**Updated:** 2026-11-26

Paths are under `frontend/src/` unless they start with `src/` (backend).

## Decisions at a glance

Every row marked "confirm" is for the orchestrator.

| # | Decision | Pick | Alternative | |
|---|---|---|---|---|
| P1 | Existing stores | Coexist behind one interface. Fit templates and peak recipes are those workshops' presets (the bar reads and writes the same records). No migration. | Migrate everything into one store | confirmed |
| P2 | Where named presets live | User level only: a content slot in `localStorage` plus export and import files. Not in the `.dwk`. | Also carry them in the project | confirmed |
| P3 | Last used | A preference slot (`qz.presetLastUsed`), shown as an entry, never applied on its own. An opt-in setting starts tools from it. | Apply on open | confirmed |
| P4 | Written when | On a successful run or commit, not on Apply | On every edit | |
| P5 | Stored values | Workshop settings only. No dataset ids, no row ranges, no excluded rows. Columns by label. | | |
| P6 | Unknown or removed field | Reject with a stated reason; a migration step may drop a field only by naming it, and Apply says so | Ignore it | |
| P7 | Newer schema | Shown, locked, kept byte-identical; never applied, never rewritten | Drop it | |
| P8 | Apply | Loads settings into the open panel's draft. Never runs the tool, never commits | | |
| P9 | Undo | A one-slot panel-level Revert; library edits are not undoable but deletion is confirmed | Global undo | confirmed |
| P10 | Cancel after Apply (item 44) | A preset Apply is a draft edit. Cancel discards the draft; what Cancel keeps after a dialog's own Apply stays item 44's decision. Recommended default: keep what was applied (Origin) | | confirmed |
| P11 | First workshop | Resample; second, Curve Fit | Curve Fit first | confirmed |
| P12 | Recipe Library | Presets join its list only in a late slice | In slice 1 | |

### Orchestrator review (2026-11-26)

Every row marked "confirmed" stands as written. Two notes:

- **P2:** no mirror to the server prefs file for now. Neither store syncs between the owner's two machines, so the
  mirror would not make presets follow the owner; export and import files cover sharing.
- **P10:** the recommended default (Cancel keeps what an earlier Apply committed, as Origin does) is adopted, and
  item 44 starts from it for the layout dialogs.

## 1. What exists today

| Mechanism | Code | Notes |
|---|---|---|
| Fit templates | `lib/fitTemplates.ts` (header `:1-20`), `components/workshops/curvefit/FitTemplatesSection.tsx`, `useFitTemplateBinding.ts` | A fit template IS an analysis template whose one step is a "fit" step, with the settings under `params.fitTemplate`. Strict, versioned (`FIT_TEMPLATE_VERSION = 1`, `sanitizeFitTemplate`). Save, apply and delete exist; there is no rename. Apply only loads the panel; the user presses Fit. |
| Analysis templates | `lib/template.ts`, `qz.analysisTemplates` (`lib/templateKey.ts`) | Name-keyed, global, carried in the `.dwk` (`lib/templatesProject.ts`: merge on open, "(from project)" on a name clash, unreadable records preserved). |
| Saved recipe systems | `lib/recipeLibrary.ts` | Six systems (plot, quick plot, analysis, peak, graph, fit model), each with its own storage. Four are name-keyed, so a rename is a delete plus a create. The file header states the rule this contract follows: describe in one vocabulary, migrate nothing. |
| Recipe metadata | `lib/recipeIndex.ts` | A sidecar for favourites, tags and recent use, so the formats stay untouched. |
| Signal Processing recipes | `lib/signalRecipeTemplate.ts`, `components/workshops/signalprocessing/SignalSaveRecipeButton.tsx` | A one-step analysis template with input expectations and a revision; replayable on other sheets. |
| Strict settings parsers | `lib/transformReopenSeed.ts` (`resampleSeed`), and the other `*ReopenSeed.ts` files, `lib/toolResultKinds.ts` | "Open in tool" restores recorded settings, failing closed (null unless every field is present and well typed). |
| Reopen session | `store/toolReopen.ts`, `components/workshops/resultcommit/ReopenBanner.tsx` | A tool opened from a committed result is seeded from the result; Replace or Add as new on commit. |
| Workbench shell | `components/workshops/workbench/WorkbenchParts.tsx` | A provisional preview ("Preview (not saved)"), and `WorkbenchActions` (Cancel plus the commit button). |
| Preference slots | `lib/prefSlots.ts` (header `:1-22`), `lib/prefsServerSync.ts`, `lib/storageKeys.ts` | One `localStorage` key per slot, mirrored to the server prefs file when synced. The header says content (templates, recipes, history) is NOT a pref slot: Reset and the server file are for settings only. The key registry is a ratchet (`architecture.test.ts`). |

## 2. Store (P2, P3)

Two stores, split by the rule `prefSlots.ts` already states.

- Named presets are CONTENT, so they use a content slot, like templates: `qz.presets`, plain `localStorage`,
  not synced to the server prefs file and not cleared by "Reset all preferences". They are user level: a preset
  such as "Resample to 500 points, PCHIP" belongs to the person, not to a project. A project's results already
  record the exact settings they used, and "Open in tool" restores those (`store/toolReopen.ts`), so a project does not
  need the presets to be reproducible. Carrying presets in the `.dwk` was rejected for a concrete reason: templates
  embed automatically on every save (`templatesProject.ts`), and a gated top-level key written on every save would make
  every project unreadable to older releases. Sharing is by export and import files (slice P5), the route
  the name-keyed recipes already use. Orchestrator to confirm, with one open option: mirroring the content slot to the
  server prefs file would carry presets between the owner's two machines, at the cost of putting content in the
  settings file.
- "Last used" is a SETTING, so it is a pref slot: `qz.presetLastUsed`, declared with `definePrefSlot`, synced like the
  others, cleared by Reset. One entry per workshop.

Both keys are added to `KNOWN_STORAGE_KEYS` (`lib/storageKeys.ts`); the ratchet fails the build otherwise.

### Shape

```ts
interface PresetRecord {
  id: string;                       // "p1:<base36>", stable across rename
  workshop: string;                 // the adapter's id: "resample", "curvefit", ...
  name: string;                     // 1-64 characters, unique per workshop, case-insensitive
  schema: number;                   // the adapter's settings schema when saved
  settings: Record<string, unknown>;
  createdAt: string;                // ISO
  updatedAt: string;
}
interface PresetFile { version: 1; presets: PresetRecord[] }       // qz.presets
type LastUsed = Record<string, { schema: number; settings: Record<string, unknown>; at: string }>;   // qz.presetLastUsed
```

Differences from the name-keyed recipes, on purpose: an id that survives rename (so a favourites sidecar entry
`preset:<id>` is never orphaned, and no `moveEntry` call is needed), and a schema version per workshop.

Limits: 200 presets per workshop, 32 kB per record. A storage write that is refused or over quota is reported, and read
back before it is called saved (`lib/storageWarning.ts`).

### What a preset holds (P5)

Settings the workshop's form holds, and nothing that names data:

- No dataset or result ids, no row ranges, no excluded rows. Positions mean something only on one sheet
  (`ROW_RANGE_CONTRACT.md`).
- A column is stored by LABEL, as the fit template stores `manualLabel`, because indices differ between sheets.
- A value-space window (an X range) is allowed. It is a number pair that means the same on any sheet.

## 3. Coexistence with recipes and fit templates (P1)

The bar is a view over a backend, and a workshop chooses its backend:

```ts
interface PresetBackend {
  list(): PresetEntry[];                       // name, id, state: "ok" | "locked" with a reason
  save(name: string, settings: unknown): SaveOutcome;
  rename(id: string, name: string): void;
  remove(id: string): void;
}
```

| Backend | Used by | Records |
|---|---|---|
| Generic | Every workshop without a legacy store | `qz.presets` (section 2) |
| Fit-template | Curve Fit | `qz.analysisTemplates`, through `fitTemplateOf` and `toFitTemplate`, unchanged |
| Peak-recipe | Peaks | `qz.peakRecipes`, through `lib/nameKeyedRecipes.ts` |

- Fit templates ARE Curve Fit's presets. Saving a preset in Curve Fit writes a fit template, so it still appears in the
  Recipe Library under "Analysis template", still travels in the project, and still replays as a pipeline step. The
  old "Templates" disclosure (`FitTemplatesSection.tsx`) is replaced by the bar in slice P2 and its tests
  (`CurveFitPanel.templates.test.tsx`) are kept green. Rename on these backends is the existing delete plus create
  with the sidecar carried (`nameKeyedRecipes`).
- A recipe is not a preset. The line: a preset is settings only and applies to the panel that is open; a recipe is a
  replayable step list with input expectations, and runs on data (Signal Processing's "Apply to selected sheets").
  Signal Processing therefore keeps its recipe button and gains the generic bar for quick settings. Plot recipes,
  quick plot templates and graph templates are figure documents and stay as they are.
- Nothing existing is rewritten, so no user data is migrated. If a later decision wants one store, the backend
  interface is the seam.
- One existing deviation is fixed in slice P2: a fit template naming a manual-error column that this sheet lacks
  silently sets the column to none (`useFitTemplateBinding.ts`, `apply`). Under P6 and section 5 it is a stated
  skip, or a refusal if the column is required.

## 4. Versioning and migration (P6, P7)

Each adapter declares `schema: number` and `migrate: Record<number, (old) => unknown>` (the step from n to n+1).

On read, per record:

1. The file envelope is not version 1: the whole file is unreadable. It is kept verbatim and the bar says "presets were
   saved by a newer version".
2. `schema` above the adapter's: the entry is shown LOCKED, "needs a newer version of Quantized", and is never
   applied, edited or rewritten.
3. `schema` below: run the migration chain. A missing step locks the entry with "cannot be upgraded from schema 1".
4. Strict parse (`adapter.parse`) of the migrated settings:
   - a key the current schema does not know: reject, "setting 'foo' is not known to this version";
   - a missing required key, a wrong type or an out-of-range value: reject, naming the field;
   - a key a migration step explicitly drops (`dropped: ["foo"]`) is the only way a removed setting is tolerated, and
     Apply then reports "setting 'foo' is no longer supported and was not applied".
5. A rejected or locked entry stays in the list, disabled, with its reason as the tooltip. It can be deleted or
   exported, never applied.

Writes are read-modify-write over the raw file: records this build cannot read are preserved untouched, the rule
`templatesProject.ts` and `appendTemplates` already follow, so saving one preset can never destroy another build's.
A migrated record is rewritten only on the user's next explicit save of that preset, never on read.

## 5. Apply semantics (P8, P9, P10)

Adapter contract (section 6): `apply(settings)` writes the panel's own state. It does not run the tool and does not
touch data, the plot, or the store's history. Outcome:

```ts
type ApplyOutcome =
  | { ok: true; applied: string[]; skipped: { field: string; reason: string }[]; notes: string[] }
  | { ok: false; reason: string };
```

- A field whose column label is missing on this sheet is `skipped` with its reason, unless the adapter marks it
  required, which refuses the whole Apply (atomic: nothing is written).
- The status line reads "Applied preset 'X' to Resample: press Create to run it", plus skipped fields and notes.
- Order of authority when a panel opens: a reopen seed from a result wins, then an explicit Apply, then last used
  (only if the user opted in), then the workshop defaults. The reopen banner and the bar say which one is in effect
  ("Settings from the result 'Fit 12'", "Preset 'PCHIP 500'", "Defaults").
- Revert (P9): `usePresetBar` captures the panel's settings before the first Apply since the last run and offers a
  single "Revert" that restores them. A second Apply does not move the captured state, so Revert returns to what
  the user had set by hand. Running or closing the tool clears it. The panel state of a workshop is local React or hook
  state outside the store's history, so a global Ctrl+Z cannot undo an Apply, and a one-slot Revert is the honest
  replacement. Saving, renaming and deleting presets are library edits, like saving a template, and are not undoable;
  Delete asks to confirm and says the preset is removed from this computer.
- Last used (P3, P4): written when the workshop's run or commit succeeds (the moment `store/recordRecipeUse.ts`
  fires for recipes), deduplicated against the previous entry. It is listed first in the bar as "Last used
  (2026-11-26 14:03)" and applied only when clicked. A setting, off by default, "Start tools with their last-used
  settings", changes that, because a changed default is opt-in (a rule of this repo). Applying last used on open is
  the same call as Apply and shows the same status.
- Cancel and Apply (item 44). Two classes of surface:
  - Workbench tools (Resample, Curve Fit, Peaks and the rest): there is no data-changing Apply. The
    preview is provisional, "Cancel" closes the tool, and the commit button writes output. A preset Apply changes the
    form, so Cancel discards it with the rest of the draft, last used is untouched by a Cancel, and nothing needs
    undoing in the data.
  - Layout dialogs with their own Apply, OK and Cancel (item 44). The bar there is one more draft editor: a preset
    Apply changes the dialog's draft and the dialog's live preview, and it has no OK of its own. What Cancel does after
    the dialog's Apply stays item 44's decision, made once for each surface. The recommendation, to confirm there:
    follow Origin, so Cancel keeps what an earlier Apply committed and discards only edits since the last Apply
    (a preset applied after the last Apply is such an edit). The preset bar adds no rule of its own.

## 6. The workshop adapter

Small enough to write by pattern. One file per workshop, `presetAdapter.ts`, next to the hook it reads:

```ts
interface PresetAdapter<S extends object> {
  workshop: string;                              // "resample"
  label: string;                                 // "Resample"
  schema: number;                                // 1
  migrate?: Record<number, (old: unknown) => unknown>;
  defaults(): S;
  parse(raw: unknown): S | { error: string };    // strict; reuse the workshop's *Seed parser where one exists
  capture(): S;                                  // read the panel (from its hook)
  apply(settings: S): ApplyOutcome;              // write the panel
  describe(settings: S): string;                 // one line for the tooltip
}
```

The shared parts are written once, in slice P1:

- `lib/presets.ts` (lazy): types, the generic backend, sanitize, migration, the unreadable-record preservation.
- `components/workshops/presets/PresetBar.tsx` and `usePresetBar.ts` (lazy, mounted with `lazyRegion` as
  `FitTemplatesSection` is): select, Save as, Rename, Delete, Export, Revert, the locked-entry display.
- `lib/presetAdapterContract.testkit.ts`: `describePresetAdapterContract(adapter, fixtures)`. Every adapter's test calls it. It
  asserts: capture, parse, apply, capture returns the same settings; an unknown key is rejected with the field named; a
  missing required key is rejected; a future schema is locked; each migration step runs; a missing column label
  skips or refuses as declared; and `defaults()` parses. This is what makes the rollout mechanical and checkable.

An adapter lists its columns-by-label fields and its required fields declaratively, so the shared code, not each
adapter, produces the skip and refuse messages.

## 7. Rollout

| Order | Workshop | Backend | Why here |
|---|---|---|---|
| P1 | Resample (`workshops/resample`) | Generic | A flat form (`resampleForm.ts`: `defaultForm`, `formFromSeed`, `formToParams`) with a strict parser already (`resampleSeed`) and no legacy store. It proves the whole path with the least new schema. |
| P2 | Curve Fit | Fit-template | Proves coexistence and replaces the old Templates section. It has the richest settings and an existing test file. |
| P3 | Peaks, Baseline | Peak-recipe, Generic | The next two plot-driven fitters. Peaks has a legacy store, Baseline has none. |
| P4 | Distribution, Stats tests, Outliers, Multivariate, Variability, Tabulate | Generic | The statistics family; flat settings, one adapter each. |
| P5 | Signal Processing, Time series, DOE, Reductions, Hysteresis, Map ops, SIMS, the remaining workshops | Generic | One adapter each. Plus Export and Import presets. |
| P6 | Recipe Library listing | | A seventh `RecipeKind` for presets, which touches every test that iterates `RECIPE_KINDS` and `RECIPE_CAPABILITIES` |

Each workshop slice is one adapter, its mount line, and its contract test, so after P1 and P2 the tier is Haiku.

## 8. Persistence and older releases

No `.dwk` field is added, so there is nothing to classify in `lib/workspaceForwardCompat.ts` and no version rung
is involved. The classification, per new key:

| Key | Where | `.dwk` class |
|---|---|---|
| `qz.presets` | `localStorage` only | none (not a project field) |
| `qz.presetLastUsed` | `localStorage`, synced preference slot | none |
| Fit templates and peak recipes | unchanged: `analysisTemplates` (a v0.34 key), `qz.peakRecipes` | unchanged |

An older release ignores both new keys, because they are read by name from storage. If the owner later chooses to carry
presets in the project (P2's alternative), the field is a new top-level `.dwk` key and must be gated in
`WORKSPACE_TOP`, embed only the presets a project's results reference, and wait for the version rung that
`ROW_RANGE_CONTRACT.md` section 9.2 describes.

## 9. PR slicing

All new UI and code is lazy. The bar mounts inside already-lazy workshop panels, `lib/presets*.ts` is imported only from
them, and the eager bundle does not change, which the slice confirms with `npm run build` against its parent
baseline.

| Slice | Content | Files (new in bold) | Tier |
|---|---|---|---|
| P1 | Core, bar and the Resample adapter | **`lib/presets.ts`**, **`lib/presetAdapter.ts`**, **`lib/presetAdapterContract.testkit.ts`**, **`components/workshops/presets/`**, `components/workshops/resample/presetAdapter.ts`, `lib/storageKeys.ts`, `lib/workflowPrefs.ts` (the opt-in), `ResamplePanel.tsx` (one mount) | Sonnet |
| P2 | Curve Fit adapter over fit templates, removal of the old Templates section, the missing-column fix | `components/workshops/curvefit/presetAdapter.ts`, `CurveFitAdvanced.tsx`, `FitTemplatesSection.tsx` (deleted), `useFitTemplateBinding.ts` | Sonnet |
| P3 | Peaks and Baseline | one `presetAdapter.ts` each, plus the peak-recipe backend | Sonnet for Peaks, Haiku for Baseline |
| P4 | The statistics family, two or three workshops per PR | one adapter each | Haiku |
| P5 | The remaining workshops; Export and Import presets with the merge rule (`(imported)` suffix on a clash, as `(from project)`) | adapters; `lib/presetFile.ts` | Haiku for adapters, Sonnet for Export and Import |
| P6 | Recipe Library listing | `lib/recipeLibrary.ts`, `lib/recipeIndex.ts` | Sonnet |

### Acceptance tests each slice must add

All through the real store and the real panel, not a helper alone.

- P1:
  - Save a preset in the Resample panel, change the form, Apply: the form equals the saved one, and the preview
    request sent to the backend carries the saved settings (not just the form state).
  - Remount the panel, and the preset is still listed (`localStorage`).
  - A record with a future schema is listed locked with its reason and survives, byte for byte, the saving of a
    different preset.
  - An unknown key, a wrong type and an out-of-range value are each rejected with the field named and are never applied.
  - A migration step that drops a field applies the rest and reports the drop.
  - Revert restores the hand-set values after two Applies.
  - Last used is written after Create succeeds, and not after Cancel, a refusal or a failed run, and is never applied on open
    unless the setting is on.
  - A panel opened from a result applies the result's seed, not a preset or last used, and the bar says so.
  - Rename keeps the id; delete asks to confirm and removes only that record.
  - A refused storage write is reported and the preset is not shown as saved.
  - `qz.presets` and `qz.presetLastUsed` are in `KNOWN_STORAGE_KEYS` (the ratchet passes), and Reset all clears
    last used but not the named presets.
- P2: everything in `CurveFitPanel.templates.test.tsx` still passes; a preset saved in the bar appears in the Recipe
  Library as an analysis template and replays as a pipeline fit step; a manual-error column missing on the sheet
  skips, or refuses when required, and says so.
- P3 to P5: each adapter passes `describePresetAdapterContract`, and one panel-level test per workshop applies a saved
  preset and checks the next run's request. P5 adds Export, then Import into a clean storage, the merge rule on a name
  clash, and a hand-edited file with an unknown key refused with its reason.
- P6: every test that iterates `RECIPE_KINDS` and `RECIPE_CAPABILITIES` passes with the new kind.

## 10. Open risks

- Workshops that hold settings in several hooks (Curve Fit's model, weighting and table are separate setters) can
  make `capture` and `apply` drift. The contract test's round trip is the guard, and an adapter that cannot pass it is
  a sign the workshop's state needs one owner first.
- Some settings are chosen from data (a model's seeded start values). Curve Fit's template already stores a start the user did not
  choose as blank, so it is re-guessed on the new data (`useFitTemplateBinding.ts`). The adapter rule is the same:
  capture what the user set, not what the tool seeded.

## Completed

Slice P1 (#1104, 2026-11-27) is built: the preset core, the bar and the Resample adapter. P2 is in wave 8; the rest is contract only.
