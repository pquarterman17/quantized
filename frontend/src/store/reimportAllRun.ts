// The full stage/commit orchestration for L0.33's Reimport All — split out
// of store/reimportAll.ts (whose own header carries the full contract doc)
// purely for EAGER BUNDLE SIZE: this is essentially the WHOLE feature's real
// code (every branch of "what can go wrong with one source", the identity
// re-validation, the transactional commit), and it only ever runs after an
// explicit, rare user gesture (a workbook's "Reimport All"/"Reimport
// Available Sources"), so store/reimportAll.ts's two actions load this
// module via a dynamic `import()` instead of a static one and immediately
// delegate — the same "anything only needed after a user action can be a
// dynamic import()" rule MAIN_PLAN #29 applies to lazy PANELS, applied here
// to a lazy STORE dependency instead (no component involved, so
// `AppOverlays.tsx`'s `lazyPanel()` doesn't apply — a plain dynamic import
// is the whole trick). Never import this module statically from anywhere
// eager, and never move logic back into store/reimportAll.ts to "simplify"
// — that is exactly the eager-bundle regression this split exists to avoid.

import { hasDesktopShell, pathState } from "../lib/desktopBridge";
import { importFile } from "../lib/api";
import { resolveFreshData } from "../lib/reimport";
import { applyReimportMerge, computeReimportMerge } from "./reimport";
import { toast } from "./toasts";
import type { DataStruct, Dataset } from "../lib/types";
import type { ReimportAllRow } from "./reimportAll";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** Stage one dataset: no store mutation, only network calls + pure lib
 *  helpers — mirrors store/reimport.ts's `reimportDataset`'s `ds.source`
 *  branch exactly (including its browser-mode degrade: with no desktop
 *  bridge, `pathState` is never called at all — `hasDesktopShell()` gates
 *  it — and this falls straight through to `importFile`, matching
 *  `reimportDataset`'s own "every existing browser-mode behavior" comment). */
async function stageOneSource(ds: Dataset, get: SliceGet): Promise<ReimportAllRow> {
  const base = { datasetId: ds.id, datasetName: ds.name, sourcePath: ds.source?.path ?? null };
  if (!ds.source) {
    // A browser-uploaded dataset never carries a real path (lib/types.ts's
    // Dataset.source doc) -- there is no source to batch-validate, and a
    // per-row file picker would defeat staging's "zero mutation, zero
    // interaction until commit" contract. Reported as a problem, not
    // silently dropped -- the user re-imports it individually instead.
    return { ...base, outcome: "no_source", message: "no source recorded — re-import this dataset individually" };
  }
  if (hasDesktopShell()) {
    const state = await pathState(ds.source.path);
    if (state === "missing") {
      return { ...base, outcome: "missing", message: `source unavailable (${ds.source.path})` };
    }
    if (state === "offline") {
      return {
        ...base,
        outcome: "offline",
        message: "source volume unreachable — reconnect the drive/network and retry",
      };
    }
  }
  try {
    const fresh: DataStruct = await importFile(ds.source.path);
    const freshRaw = await resolveFreshData(ds, fresh);
    const merge = await computeReimportMerge(get, ds, freshRaw);
    return { ...base, outcome: "staged", message: "ready", dsRef: ds, merge };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "parse error";
    return { ...base, outcome: "parse_error", message: msg };
  }
}

/** Re-validate one already-staged row against the LIVE store, right before
 *  commit (this module's fail-closed identity guard, doc below). Non-
 *  `"staged"` rows pass through unchanged — they already carry their own
 *  failure reason from staging. */
function revalidateRow(row: ReimportAllRow, live: ReadonlyMap<string, Dataset>): ReimportAllRow {
  if (row.outcome !== "staged") return row;
  const nowDs = live.get(row.datasetId);
  if (!nowDs) {
    return {
      datasetId: row.datasetId,
      datasetName: row.datasetName,
      sourcePath: row.sourcePath,
      outcome: "removed",
      message: "dataset was removed before commit",
    };
  }
  if (nowDs !== row.dsRef) {
    return {
      datasetId: row.datasetId,
      datasetName: row.datasetName,
      sourcePath: row.sourcePath,
      outcome: "changed",
      message: "dataset changed before commit — re-run Reimport",
    };
  }
  return row;
}

/** Phase 1 (called from store/reimportAll.ts's thin `stageReimportAll`
 *  trampoline): probe + fully parse/validate every id in `datasetIds` into
 *  `reimportAllRows`, making NO mutation of `datasets` or any other
 *  participating field. De-duplicates `datasetIds`. `genRef` is the calling
 *  slice's own monotonic-generation cell (module doc's sequence guard) — a
 *  superseded (stale) invocation writes nothing. Named tersely (`runStage`,
 *  not `runStageReimportAll`) because these bindings, unlike ordinary local
 *  variables, survive minification verbatim — Rollup keeps a dynamic
 *  import()'s named exports stable across the chunk boundary — so every
 *  character here is a literal, permanent eager-bundle cost paid at the
 *  call site in store/reimportAll.ts. */
export async function runStage(
  set: SliceSet,
  get: SliceGet,
  datasetIds: readonly string[],
  genRef: { current: number },
): Promise<void> {
  const my = ++genRef.current;
  const ids = [...new Set(datasetIds)];
  if (ids.length === 0) return;
  set({ reimportAllBusy: true, reimportAllRows: null });
  // Snapshot the live dataset for each requested id ONCE, synchronously,
  // before any await -- this IS the `dsRef` identity a race lands against
  // (module doc). An id that's already gone by the time staging even
  // starts is reported the same way a mid-stage removal is.
  const live = new Map(get().datasets.map((d) => [d.id, d]));
  const rows = await Promise.all(
    ids.map((id): Promise<ReimportAllRow> => {
      const ds = live.get(id);
      if (!ds) {
        return Promise.resolve({
          datasetId: id,
          datasetName: id,
          sourcePath: null,
          outcome: "removed",
          message: "dataset no longer exists",
        });
      }
      return stageOneSource(ds, get);
    }),
  );
  if (genRef.current !== my) return; // superseded by a later stageReimportAll call -- discard
  set({ reimportAllRows: rows, reimportAllBusy: false });
}

/** Phase 2 (called from store/reimportAll.ts's thin `commitReimportAll`
 *  trampoline): re-validate every staged row's identity against the LIVE
 *  store (fail-closed, this module's header), then commit. `"all"` commits
 *  only when EVERY row re-validates as `"staged"` — otherwise it makes NO
 *  mutation and just refreshes `reimportAllRows` with the re-validated
 *  problem list. `"available"` always commits the staged subset. Every
 *  committed row folds into ONE `withHistoryBatch` entry. */
export async function runCommit(
  set: SliceSet,
  get: SliceGet,
  mode: "all" | "available",
): Promise<void> {
  const rows = get().reimportAllRows;
  if (!rows || get().reimportAllBusy) return;
  const nowById = new Map(get().datasets.map((d) => [d.id, d]));
  const revalidated = rows.map((r) => revalidateRow(r, nowById));
  const committable = revalidated.filter((r) => r.outcome === "staged");
  const failed = revalidated.filter((r) => r.outcome !== "staged");

  if (mode === "all" && failed.length > 0) {
    // L0.33's hard gate: ANY required-source failure leaves the workbook
    // COMPLETELY unchanged -- no `set()` on `datasets` at all, just
    // refreshing the report with whatever revalidation just found
    // (including a freshly-detected mid-stage race).
    set({ reimportAllRows: revalidated });
    toast(`reimport all: ${failed.length} problem${failed.length === 1 ? "" : "s"} — nothing changed`, "danger");
    return;
  }
  if (committable.length === 0) {
    set({ reimportAllRows: revalidated });
    toast("nothing to reimport — no source staged cleanly", "danger");
    return;
  }

  const n = committable.length;
  // ONE undo entry for the whole batch, exactly like store/relink.ts's
  // commit() and store/workbookSeparate.ts's commitSeparateWorksheets --
  // every applyReimportMerge call below forwards the SAME token so its own
  // recordHistory call folds in instead of pushing its own.
  await get().withHistoryBatch(`re-import ${n} source${n === 1 ? "" : "s"}`, async (token) => {
    for (const row of committable) {
      applyReimportMerge(set, get, row.dsRef!, row.merge!, token);
    }
  });
  const skippedNote = failed.length > 0 ? ` — ${failed.length} skipped` : "";
  toast(`re-imported ${n} source${n === 1 ? "" : "s"}${skippedNote}`, "ok");
  set({ reimportAllRows: null });
}
