# Origin graph fidelity manifest and omissions UI

**Status:** implemented on stacked branch `codex/origin-fidelity-manifest`  
**Plan scope:** Plot Fidelity + Workbook Fallback item #49  
**Base:** PR #25 (`codex/origin-figure-full-data`)

## Purpose

Origin graph recovery is necessarily incremental: the decoder can recover a
correct curve binding and axis range while still lacking a drawn arrow, saved
preview, or rich-text run. Previously the HTTP response exposed only the
figures retained for the Library. Internal records and stale source references
were silently discarded or appeared as disabled rows, and the user could not
tell which visual properties remained approximate.

The fidelity manifest makes that boundary explicit without weakening the
decoder's precision rule: unproven properties remain omitted, but the omission
is visible and durable.

## Wire contract

Every `.opj`/`.opju` import now returns top-level `origin_fidelity`:

```json
{
  "version": 1,
  "container": "opj",
  "status": "best_effort",
  "graph_records_total": 128,
  "graph_records_actionable": 67,
  "graph_records_filtered": 61,
  "omissions": ["graphic_objects", "saved_graph_preview"],
  "filtered_figures": [
    {
      "index": 12,
      "name": "GraphGone",
      "layer": 1,
      "reason": "source hint \"DeletedBook\" did not match an imported workbook"
    }
  ]
}
```

Actionable entries in `figures[]` additionally carry:

```json
{
  "fidelity": {
    "status": "best_effort",
    "recovered": ["axis_ranges", "curve_bindings", "curve_order"],
    "omissions": ["saved_graph_preview", "graphic_objects"]
  }
}
```

Status semantics are intentionally conservative:

- `exact` is reserved for a future saved-preview/oracle comparison gate;
- `best_effort` is an editable reconstruction with explicit omissions;
- `reference_only` is reserved for a saved preview with no editable result;
- `unresolved` means no graph record can currently be applied.

Current imports do not claim `exact`.

## Backend boundary

`io/origin_project/fidelity.py` is pure assessment logic. It receives decoded
figure records plus the actual imported workbook short/long names and returns:

- copied, annotated actionable figures; and
- a versioned project manifest with summaries of filtered records.

It never mutates decoder records. `extract_figures` and
`extract_figures_opju` therefore remain complete RE/debug APIs.

A source-hint-only record is actionable only if its hint matches an imported
workbook alias under the same match semantics as the frontend resolver. This
closes the real `XMCD.opj` failure mode: 128 detected records become 67
actionable figures and 61 retained diagnostic summaries, not 61 disabled
Library rows.

The parser route owns only serialization and the malformed-figure fallback.
If optional graph extraction raises, workbook import still succeeds and the
manifest reports `figure_decode_error`.

## Frontend boundary

`origin_fidelity` is consumed before a `DataStruct` becomes a Dataset. It is
never inserted into scientific metadata.

`store/originImport.ts` owns both imported figure entries and project fidelity
entries. The latter:

- are keyed to the import's sibling dataset ids;
- prune removed sibling references and disappear after the last source dataset;
- participate in undo/redo; and
- round-trip through `.dwk` with validation of manifest version and basic
  structure.

The Library renders:

- an **Origin fidelity** project section with actionable/total/filtered counts,
  human-readable omissions, and filtered record names; and
- a per-figure `≈` indicator whose tooltip lists that graph's omissions.

Import also emits a one-time informational toast so omissions are visible even
when the Library section is collapsed.

## Validation

```text
Origin/backend focused suite: 465 passed, 3 skipped
Frontend full suite:           246 files, 3305 tests passed
Repository integrity:          3 passed
Ruff:                          passed
mypy:                          passed (220 source files)
TypeScript:                    passed
```

The real-data suite includes an exact `XMCD.opj` 128/67/61 regression anchor.
Private Origin project bytes remain outside the repository.

## Reviewer checklist

- Confirm `fidelity.py` never mutates or hides pure decoder results.
- Confirm stale/nonmatching hints are summarized rather than sent as disabled
  figure rows.
- Confirm omission codes describe unsupported decoder/renderer properties and
  do not claim a property is absent from the source file.
- Confirm no path labels a reconstruction `exact` without an oracle gate.
- Confirm the top-level manifest is removed before dataset creation.
- Confirm `.dwk` parsing rejects unsupported manifest versions and prunes dead
  sibling ids.
- Confirm removing the final dataset from an import removes its project
  fidelity artifact.

## Continuation

Item #50 can now build **Open source workbook(s)** and **Remake in Graph
Builder** actions against a stable diagnostic contract. Later decoder work
should update the recovered/omitted code lists in `fidelity.py` and the display
labels in `lib/originFidelity.ts` in the same commit. Saved-preview work (#51)
may introduce `reference_only` and is the prerequisite for an evidence-backed
`exact` status.
