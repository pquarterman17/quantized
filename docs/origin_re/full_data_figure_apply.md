# Origin figure apply: full-data preflight and handoff

**Status:** implemented on `codex/origin-figure-full-data`  
**Plan scope:** Plot Fidelity + Workbook Fallback item #48, plus the safe
actionable-figure filtering part of #49  
**Commit introducing the implementation:** `486ed3c`

## Problem

Origin projects use lazy per-book transport: the import response contains a
small preview for non-primary books and fetches the full `DataStruct` when a
book is first needed. `applyOriginFigure` previously built cross-book overlay
datasets synchronously from whichever data happened to be in the store.

If the user applied a cross-book graph before its books finished loading, the
overlay copied the preview rows. The later source-book fetch replaced the book
datasets, but the separately materialized overlay was cached and reused. Plot,
analysis, workspace save, and export could therefore operate on a plausible
but permanently downsampled graph.

The import route also applied `drop_nonactionable_figures` only to `.opju`.
Old `.opj` projects can contain the same internal/hintless layer anchors; the
local `XMCD.opj` corpus file exposes 61 such disabled Library rows.

## Implementation

`frontend/src/store/originFigureApply.ts` owns the asynchronous preflight:

1. Find the clicked graph's whole layer family.
2. Collect its resolved dataset ids and every exact curve-bound Origin book.
3. Scope matching to `siblingIds`, preventing same-named `Book1`/`Book2`
   datasets from another import from entering the graph.
4. Resolve only referenced pending datasets through the existing bounded,
   single-flight `resolveDatasets` path.
5. Re-enter `applyOriginFigure` after every source swap has landed. The normal
   synchronous apply path is unchanged when no source is pending.

A module-level sequence provides latest-request-wins behavior. If a user
selects Graph B while Graph A's source is still loading, A may finish fetching
and populate its source book, but it cannot overwrite the active plot. A fetch
failure reports an error and creates no partial overlay.

The coordinator is separate from `useApp.ts` to obey the store-size ratchet;
do not move it back into the root store or raise the ratchet.

`src/quantized/routes/parsers.py` now applies
`drop_nonactionable_figures` after either `.opj` or `.opju` extraction. This is
a presentation gate only: pure decoder APIs still return the complete record
scan for diagnostics and reverse engineering.

## Tests and evidence

Frontend regressions in `frontend/src/store/useApp.test.ts` cover:

- two lazy source books resolving before a cross-book overlay is created;
- overlay row counts and values coming from full data, not previews;
- one failed source preventing any partial overlay; and
- an older slow request not applying after a newer figure wins.

Backend coverage in `tests/test_api_parsers.py` pins `.opj` filtering at the
HTTP boundary. The existing local-corpus route test also imported every real
`.opj`/`.opju` project successfully.

Validation run before publication:

```text
uv run pytest -q tests/test_api_parsers.py tests/test_api_books.py
  30 passed
uv run pytest tests/test_repo_integrity.py -q
  3 passed
uv run ruff check src tests
  passed
uv run mypy src
  passed (219 source files)
npm run typecheck
  passed
npm test
  244 files, 3297 tests passed
```

The worktree is under OneDrive, so a fresh `uv` environment may need
`UV_LINK_MODE=copy`; that is an environment workaround, not an application
requirement.

## Reviewer checklist

- Confirm `sourceDatasetIds` never searches outside `entry.siblingIds`.
- Confirm window creation and overlay materialization occur only after the
  preflight returns false (all required sources are full).
- Confirm a rejected fetch cannot fall through to the synchronous apply path.
- Confirm the sequence guard suppresses stale application, not the completed
  source-book installation; keeping the fetched book is intentional.
- Confirm `.opj` filtering remains at the route/presentation boundary and does
  not reduce decoder output used by RE tests.
- Run the focused frontend test and, when the private corpus is present, the
  parser route suite above.

## Remaining work

The stacked `codex/origin-fidelity-manifest` branch completes #49: filtered
records survive as a versioned project diagnostic artifact and the Library
shows project/figure omissions. See `docs/origin_re/fidelity_manifest.md`.
PR #25 itself still does not include that stacked change. #50's **Open source
workbook(s)** / **Remake in Graph Builder** actions remain unimplemented.

Recommended continuation order:

1. Merge/rebase the stacked #49 fidelity-manifest PR after PR #25.
2. Implement workbook/Graph Builder fallback using the same exact
   curve-to-book resolution and pending-data preflight introduced here.

The original workspace may contain an uncommitted expanded
`plans/ORIGIN_FILE_DECODE_PLAN.md`; reconcile that plan deliberately after this
PR merges rather than overwriting it from this isolated worktree.
