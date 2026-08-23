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

import { hasDesktopShell, pathState, probeSource, type SourceProbe } from "../lib/desktopBridge";
import { importFile } from "../lib/api";
import { resolveFreshData } from "../lib/reimport";
import { applyReimportMerge, computeReimportMerge } from "./reimport";
import { computeDependencyImpact, formatDependencyImpact, hasDependencyImpact } from "../lib/dependencyImpact";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import { toast } from "./toasts";
import type { DataStruct, Dataset } from "../lib/types";
import type { ReimportAllRow } from "./reimportAll";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;
/** The calling slice's monotonic-generation cell — shared with
 *  store/reimportAll.ts's doc. `rowsGen` records which generation most
 *  recently WROTE `reimportAllRows`; `current` is bumped by every genuine
 *  `runStage` call. */
type GenRef = { current: number; rowsGen: number | null };

/** Coordinator review G7: the shared "probe this path once, cache the
 *  promise" idiom both stage's fingerprint capture and commit's re-probe
 *  need — extracted so the two sides can't quietly drift into two slightly
 *  different caching rules. `force` bypasses AND OVERWRITES any cached
 *  entry with a brand-new probe — G5's stage-time retry-once path, so a
 *  transient first-probe failure doesn't permanently poison the cache for
 *  every other row sharing this path. */
function probeCached(
  path: string,
  cache: Map<string, Promise<SourceProbe | null>>,
  force = false,
): Promise<SourceProbe | null> {
  let probePromise = force ? undefined : cache.get(path);
  if (!probePromise) {
    probePromise = probeSource(path);
    cache.set(path, probePromise);
  }
  return probePromise;
}

/** Coordinator review F7: capture `path`'s on-disk `size`/`mtime` (desktop
 *  shell only — `probeSource` itself already degrades to `null` with no
 *  bridge, so this is a no-op in a browser session, same as every other
 *  bridge-gated call here), via the shared `probeCached` (G7). `force`
 *  forwards to `probeCached` — G5's retry. */
async function captureFingerprint(
  path: string,
  probeCache: Map<string, Promise<SourceProbe | null>>,
  force = false,
): Promise<{ size: number | null; mtime: number | null } | undefined> {
  const probe = await probeCached(path, probeCache, force);
  return probe && probe.state === "ok" ? { size: probe.size, mtime: probe.mtime } : undefined;
}

/** Stage one dataset: no store mutation, only network calls + pure lib
 *  helpers — mirrors store/reimport.ts's `reimportDataset`'s `ds.source`
 *  branch exactly (including its browser-mode degrade: with no desktop
 *  bridge, `pathState` is never called at all — `hasDesktopShell()` gates
 *  it — and this falls straight through to `importFile`, matching
 *  `reimportDataset`'s own "every existing browser-mode behavior" comment).
 *  Coordinator review F3: `importCache` memoizes the `importFile(path)`
 *  promise per unique path for the WHOLE `runStage` invocation — N members
 *  of one multi-book Origin file share ONE parse, not N. `probeCache` gives
 *  the F7 fingerprint capture the same sharing. */
async function stageOneSource(
  ds: Dataset,
  get: SliceGet,
  importCache: Map<string, Promise<DataStruct>>,
  probeCache: Map<string, Promise<SourceProbe | null>>,
): Promise<ReimportAllRow> {
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
    // Coordinator review G3: the fingerprint is captured BEFORE the file is
    // read, not after. A file rewritten WHILE `importFile`/`resolveFreshData`
    // are running would otherwise have its fingerprint taken from the
    // POST-change state — matching whatever `commitReimportAll` re-probes
    // later and silently passing the F7 guard despite the parsed data being
    // stale relative to what was on disk when parsing actually started.
    // Gated explicitly (not left to `probeSource`'s own no-bridge degrade)
    // to match `pathState`'s convention above, so a browser session
    // genuinely never calls out for a fingerprint it can never re-verify.
    let fingerprint = hasDesktopShell() ? await captureFingerprint(ds.source.path, probeCache) : undefined;

    let fetchPromise = importCache.get(ds.source.path);
    if (!fetchPromise) {
      fetchPromise = importFile(ds.source.path);
      importCache.set(ds.source.path, fetchPromise);
    }
    const fresh: DataStruct = await fetchPromise;
    const freshRaw = await resolveFreshData(ds, fresh);
    const merge = await computeReimportMerge(get, ds, freshRaw);

    // Coordinator review G5: a desktop-shell probe failure must fail
    // CLOSED, never stage silently with no fingerprint — that would
    // permanently exempt this row from the F7 re-probe at commit (nothing
    // to compare against, forever). Retry once (a fresh, uncached probe —
    // the first attempt may simply have raced something transient); still
    // nothing, refuse the row outright, matching commit-time's own
    // "no probe = treat as changed" rule.
    if (hasDesktopShell() && !fingerprint) {
      fingerprint = await captureFingerprint(ds.source.path, probeCache, true);
      if (!fingerprint) {
        return {
          ...base,
          outcome: "disk_changed",
          message: "could not verify the file on disk — retry Reimport",
        };
      }
    }

    return { ...base, outcome: "staged", message: "ready", dsRef: ds, merge, fingerprint };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "parse error";
    return { ...base, outcome: "parse_error", message: msg };
  }
}

/** Re-validate one already-staged row against the LIVE store, right before
 *  commit (this module's fail-closed identity guard, doc below). Non-
 *  `"staged"` rows pass through unchanged — they already carry their own
 *  failure reason from staging. `diskChanged` is F7's pre-computed set of
 *  ids whose on-disk fingerprint no longer matches what staging recorded —
 *  checked AFTER the in-app identity guard (an in-app edit is reported as
 *  `"changed"` even if the file also happens to have moved on disk; the two
 *  reasons are not mutually exclusive, this just picks one to show). */
function revalidateRow(
  row: ReimportAllRow,
  live: ReadonlyMap<string, Dataset>,
  diskChanged: ReadonlySet<string>,
): ReimportAllRow {
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
  if (diskChanged.has(row.datasetId)) {
    return {
      datasetId: row.datasetId,
      datasetName: row.datasetName,
      sourcePath: row.sourcePath,
      outcome: "disk_changed",
      message: "file changed on disk since staging — re-run Reimport",
    };
  }
  return row;
}

/** Phase 1 (called from store/reimportAll.ts's thin `stageReimportAll`
 *  trampoline): probe + fully parse/validate every id in `datasetIds` into
 *  `reimportAllRows`, making NO mutation of `datasets` or any other
 *  participating field. De-duplicates `datasetIds`. `genRef` is the calling
 *  slice's own monotonic-generation cell (module doc's sequence guard) — a
 *  superseded (stale) invocation writes nothing and RETURNS `false`
 *  (coordinator review F1 — see store/reimportAll.ts's doc for why a caller
 *  MUST check this before chaining a commit). Coordinator review F6: the
 *  empty/all-duplicate-`datasetIds` no-op check runs BEFORE `genRef.current`
 *  is ever bumped — claiming a generation for a call that never actually
 *  stages anything would silently strand a DIFFERENT, genuinely in-flight
 *  call's own completion (its `genRef.current !== my` check would then see
 *  a mismatch that has nothing to do with it, and never reset
 *  `reimportAllBusy`). Named tersely (`runStage`, not `runStageReimportAll`)
 *  because these bindings, unlike ordinary local variables, survive
 *  minification verbatim — Rollup keeps a dynamic import()'s named exports
 *  stable across the chunk boundary — so every character here is a literal,
 *  permanent eager-bundle cost paid at the call site in
 *  store/reimportAll.ts. */
export async function runStage(
  set: SliceSet,
  get: SliceGet,
  datasetIds: readonly string[],
  genRef: GenRef,
): Promise<boolean> {
  const ids = [...new Set(datasetIds)];
  if (ids.length === 0) return false; // F6: no generation claimed for a no-op call
  const my = ++genRef.current;
  set({ reimportAllBusy: true, reimportAllRows: null });
  // Snapshot the live dataset for each requested id ONCE, synchronously,
  // before any await -- this IS the `dsRef` identity a race lands against
  // (module doc). An id that's already gone by the time staging even
  // starts is reported the same way a mid-stage removal is.
  const live = new Map(get().datasets.map((d) => [d.id, d]));
  // F3: shared per-path caches for the whole invocation -- N members of one
  // multi-book source file parse/fingerprint exactly once between them.
  const importCache = new Map<string, Promise<DataStruct>>();
  const probeCache = new Map<string, Promise<SourceProbe | null>>();
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
      return stageOneSource(ds, get, importCache, probeCache);
    }),
  );
  if (genRef.current !== my) return false; // superseded by a later stageReimportAll call -- discard
  genRef.rowsGen = my; // F1: record which generation these rows belong to
  set({ reimportAllRows: rows, reimportAllBusy: false, reimportAllCommitted: null });
  return true;
}

/** Phase 2 (called from store/reimportAll.ts's thin `commitReimportAll`
 *  trampoline): re-validate every staged row's identity against the LIVE
 *  store (fail-closed, this module's header), then commit. `"all"` commits
 *  only when EVERY row re-validates as `"staged"` — otherwise it makes NO
 *  mutation and just refreshes `reimportAllRows` with the re-validated
 *  problem list. `"available"` always commits the staged subset. Every
 *  committed row folds into ONE `withHistoryBatch` entry.
 *
 *  Coordinator review F1 (second, independent guard): refuses outright when
 *  the rows currently in state were not produced by the CURRENT generation
 *  — a caller that ignores `stageReimportAll`'s returned boolean, or a
 *  commit that itself takes long enough for a newer stage to land first
 *  (the F2/F7 confirm/probe awaits below), can never write against rows
 *  that belong to a different gesture.
 *
 *  Coordinator review F2/F7 ordering rule (both cite this exact sentence):
 *  every ASYNC step — the F7 disk re-probe, the F2 dependency-impact
 *  confirm — happens BEFORE the SYNCHRONOUS revalidate→apply block, never
 *  between revalidation and the actual `applyReimportMerge` calls. That
 *  block re-checks generation/rows-identity/dataset-identity and commits in
 *  one uninterrupted stretch specifically so nothing async can land in the
 *  gap between "verified clean" and "written". */
export async function runCommit(
  set: SliceSet,
  get: SliceGet,
  mode: "all" | "available",
  genRef: GenRef,
): Promise<void> {
  const rows = get().reimportAllRows;
  if (!rows || get().reimportAllBusy) return;
  if (genRef.rowsGen !== genRef.current) return; // F1: these rows are not the latest generation's

  const stagedRows = rows.filter((r) => r.outcome === "staged");

  // F7: re-probe on-disk fingerprints (desktop shell only) BEFORE anything
  // synchronous below, via the shared `probeCached` (G7). A row with no
  // recorded fingerprint (browser mode at stage time) is never re-probed --
  // nothing to compare against.
  const diskChanged = new Set<string>();
  if (hasDesktopShell()) {
    const probeCache = new Map<string, Promise<SourceProbe | null>>();
    await Promise.all(
      stagedRows
        .filter((r) => r.fingerprint && r.sourcePath)
        .map(async (r) => {
          const probe = await probeCached(r.sourcePath!, probeCache);
          if (
            !probe ||
            probe.state !== "ok" ||
            probe.size !== r.fingerprint!.size ||
            probe.mtime !== r.fingerprint!.mtime
          ) {
            diskChanged.add(r.datasetId);
          }
        }),
    );
  }

  // Coordinator review G4: under `"all"`, a pre-existing stage failure OR a
  // freshly-detected on-disk change ALREADY guarantees the refusal branch
  // below fires (ANY non-staged row is fatal to `"all"`) -- asking the user
  // to confirm a commit that cannot happen wastes their time and implies a
  // choice that was never actually on offer. Skip the confirm outright and
  // fall straight through to the (already-certain) refusal in the sync
  // block; `"available"` never skips it this way, since a partial commit
  // genuinely CAN still go through.
  const certainAllRefusal = mode === "all" && (stagedRows.length < rows.length || diskChanged.size > 0);

  // F2: aggregate the L0.55 dependency impact across whatever would
  // actually commit (post fingerprint check) and confirm ONCE -- see this
  // function's own doc for why this MUST happen before the sync block.
  if (!certainAllRefusal) {
    const wouldCommitIds = stagedRows.filter((r) => !diskChanged.has(r.datasetId)).map((r) => r.datasetId);
    if (wouldCommitIds.length > 0) {
      const impact = computeDependencyImpact(get().datasets, wouldCommitIds);
      if (hasDependencyImpact(impact)) {
        const n = wouldCommitIds.length;
        const ok = await askConfirm(
          `Re-import ${n} source${n === 1 ? "" : "s"}?`,
          formatDependencyImpact(impact),
          "Re-import",
        );
        if (!ok) return; // declined -- zero mutation, report left exactly as it was
      }
    }
  }

  // ---- SYNCHRONOUS BLOCK ----
  // Everything from here through the `applyReimportMerge` loop inside
  // `withHistoryBatch` below runs with no REAL async work of its own in
  // between: `revalidateRow`/the filters are plain synchronous code, and
  // `withHistoryBatch(label, fn)` invokes `fn` (whose own body has no
  // `await` — every `applyReimportMerge` call is synchronous) IMMEDIATELY,
  // before its own `await` is ever reached — so the mutations happen in the
  // same synchronous stretch as this re-check, even though the `await`
  // keyword appears on that line. That is what makes the fail-closed
  // guards below meaningful: nothing async can land in the gap between
  // "verified clean" and "written".
  if (genRef.rowsGen !== genRef.current) return;
  if (get().reimportAllRows !== rows) return;
  const nowById = new Map(get().datasets.map((d) => [d.id, d]));
  const revalidated = rows.map((r) => revalidateRow(r, nowById, diskChanged));
  const committable = revalidated.filter((r) => r.outcome === "staged");
  const failed = revalidated.filter((r) => r.outcome !== "staged");

  if (mode === "all" && failed.length > 0) {
    // L0.33's hard gate: ANY required-source failure leaves the workbook
    // COMPLETELY unchanged -- no `set()` on `datasets` at all, just
    // refreshing the report with whatever revalidation just found
    // (including a freshly-detected mid-stage race).
    set({ reimportAllRows: revalidated, reimportAllCommitted: null });
    toast(`reimport all: ${failed.length} problem${failed.length === 1 ? "" : "s"} — nothing changed`, "danger");
    return;
  }
  if (committable.length === 0) {
    set({ reimportAllRows: revalidated, reimportAllCommitted: null });
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
  // Coordinator review G8: `withHistoryBatch`'s own OUTER promise still
  // resolves through at least one real microtask hop even though `fn`'s
  // body already ran synchronously above -- so a report-closing `set()`
  // here is NOT provably in the same uninterrupted stretch as the applies
  // it follows. The commit ITSELF already happened for real (the data
  // mutation above is not undone) and stays that way regardless; what
  // could still go wrong is clobbering a NEWER stage/report that landed in
  // that gap by blindly overwriting it with THIS (now-stale) call's own
  // idea of what the report should say. Re-check one more time, and skip
  // ONLY the report `set()` (F5's kept-open failures / the closing `null`)
  // when superseded -- the toast above already correctly described what
  // THIS call did, and that stands either way.
  if (genRef.rowsGen === genRef.current && get().reimportAllRows === rows) {
    set({
      reimportAllRows: failed.length > 0 ? failed : null,
      // G2: non-null ONLY for a genuine partial success (something
      // committed AND something was skipped) -- see the field's own doc in
      // store/reimportAll.ts for why the dialog needs this to tell that
      // apart from an outright refusal.
      reimportAllCommitted: failed.length > 0 ? n : null,
    });
  }
}
