// The in-tool half of the result book (lane RB3): the per-table and header
// actions a statistics tool offers on its LIVE result, so they match the saved
// book's.
//
//   Copy table        -> once saved, the SAVED table (row-bounded like Send to
//                        report and Open as worksheet); before, the full live
//                        table from the SAME builder the tool saves with (TSV).
//   Send to report    -> sendAnalysisInlineTableToReport on the SAVED result's
//   Open as worksheet -> freezeAnalysisOutputs              table of that title
//   Open saved result -> store/resultBookRequest (the Library result, Result
//                        book tab)
//
// FAIL CLOSED (provisional, owner to confirm): until this exact computation is
// saved (`savedKey`, lib/snapshotResultKey), Send to report and Open as
// worksheet are disabled with "Save the result first"; nothing is saved on the
// user's behalf. A saved result whose tables no longer include the title (a
// table dropped by the save's size bound) refuses with a reason.

import { useMemo, useRef, useState } from "react";

import type { AnalysisResult, AnalysisResultTable } from "../../../lib/analysisResult";
import { inlineTableOutputs } from "../../../lib/analysisResultFreezeOutputs";
import { copyText } from "../../../lib/clipboard";
import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import { tablesToTSV } from "../../../lib/statsTestsResults";
import { savedSnapshotKey } from "../../../lib/snapshotResultKey";
import { openResultBook } from "../../../store/resultBookRequest";
import { useApp } from "../../../store/useApp";

const loadActions = () => runLazy("Loading analysis result actions…", () => import("../../../store/analysisResultActions"));
const loadFreeze = () => runLazy("Loading freeze actions…", () => import("../../../store/analysisResultFreeze"));

export const SAVE_FIRST = "Save the result first; this table is then sent from the saved result.";
const NOT_IN_SAVED = "The saved result does not include this table (it was too large to save).";
const NOT_COMPUTED = "This table is not available yet (still computing, or not produced with these settings).";

export interface ToolResultBook {
  /** The saved result of this exact computation, or null. */
  saved: AnalysisResult | null;
  /** The live tables (the tool's save builder), or null while computing.
   *  Built on first use, not on every recompute. */
  liveTables: () => readonly AnalysisResultTable[] | null;
  busy: boolean;
  /** Why Send to report is unavailable for this table, or null. */
  reportBlocked: (title: string) => string | null;
  /** Why Open as worksheet is unavailable for this table, or null. */
  openBlocked: (title: string) => string | null;
  hasLiveTable: (title: string) => boolean;
  /** One live table by title (built on demand), or null. */
  liveTable: (title: string) => AnalysisResultTable | null;
  /** Why Copy table is unavailable for this table, or null. */
  copyBlocked: (title: string) => string | null;
  /** What Copy table copies: the saved (row-bounded) table, or the full live one. */
  copySource: (title: string) => "saved" | "live" | null;
  copy: (title: string) => void;
  report: (title: string) => void;
  openTable: (title: string) => void;
  openSaved: () => void;
}

/** `savedKey`: the tool's snapshotResultKey for the live computation (null
 *  while there is none), or `savedId` for a tool whose every run is saved
 *  under a known id (Statistical tests). `liveTables`: the tables the tool
 *  would save, from its own builder (null while computing); pass a stable
 *  thunk (`useLiveTables`) so the tables are built only when a section or an
 *  action reads them. */
export function useToolResultBook({ savedKey = null, savedId = null, liveTables, liveTitles, liveTableOf, blocked = null, unsavedReason = SAVE_FIRST, resolveSaved }: {
  savedKey?: string | null;
  savedId?: string | null;
  liveTables: () => readonly AnalysisResultTable[] | null;
  /** The live tables' titles without building them (a tool whose tables are
   *  large, e.g. PCA scores): enablement then never builds a table; only an
   *  expanded section or Copy does. Default: read from `liveTables`. */
  liveTitles?: () => readonly string[] | null;
  /** Build ONE live table by title (with `liveTitles`: Copy then builds only
   *  the table it copies). Default: find it in `liveTables`. */
  liveTableOf?: (title: string) => AnalysisResultTable | null;
  /** Why EVERY table action is withheld (the shown result is out of date), or null. */
  blocked?: string | null;
  /** Why Send to report / Open as worksheet are unavailable with no saved
   *  result (default "Save the result first"; a tool that saves every run says
   *  the saved result was deleted or undone instead). */
  unsavedReason?: string;
  /** The saved table index for a live table label (default: the same title).
   *  For tools whose tables may be untitled or share a title. */
  resolveSaved?: (title: string, saved: AnalysisResult) => number;
}): ToolResultBook {
  const saved = useApp((state) => (savedKey === null && savedId === null) ? null
    : state.analysisResults.find((result) => savedId !== null ? result.id === savedId : savedSnapshotKey(result) === savedKey) ?? null);
  const setActive = useApp((state) => state.setActive);
  const setStageTab = useApp((state) => state.setStageTab);
  const setStatus = useApp((state) => state.setStatus);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const guarded = async (run: () => Promise<void>): Promise<void> => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try { await run(); } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const liveTable = (title: string): AnalysisResultTable | undefined =>
    (liveTableOf ? liveTableOf(title) : liveTables()?.find((table) => table.title === title)) ?? undefined;
  const hasLive = (title: string): boolean => liveTitles ? !!liveTitles()?.includes(title) : !!liveTable(title);
  const savedIndex = (title: string): number => !saved ? -1
    : resolveSaved ? resolveSaved(title, saved) : saved.tables?.findIndex((table) => table.title === title) ?? -1;
  const reportBlocked = (title: string): string | null =>
    blocked ?? (!saved ? unsavedReason : savedIndex(title) < 0 ? NOT_IN_SAVED : null);
  const openBlocked = (title: string): string | null => {
    const why = reportBlocked(title);
    if (why || !saved) return why;
    const freeze = inlineTableOutputs(saved, [])[savedIndex(title)];
    return freeze && !freeze.freezable ? `Can't open as a worksheet: ${freeze.reason}.` : null;
  };
  // Copy = Send to report = Open as worksheet: once saved, Copy copies the
  // SAVED table (row-bounded by the save); before, the full live table.
  const copySource = (title: string): "saved" | "live" | null =>
    saved && savedIndex(title) >= 0 ? "saved" : hasLive(title) ? "live" : null;
  const copyBlocked = (title: string): string | null => blocked ?? (copySource(title) ? null : NOT_COMPUTED);
  const copy = (title: string) => void guarded(async () => {
    if (blocked) { setStatus(blocked, "danger"); return; }
    const source = copySource(title);
    const table = source === "saved" ? saved?.tables?.[savedIndex(title)] : source === "live" ? liveTable(title) : undefined;
    if (!table) { setStatus(`can't copy ${title}: ${NOT_COMPUTED.toLowerCase()}`, "danger"); return; }
    const copied = await copyText(tablesToTSV([table]));
    // Say when the saved table is shorter than what the tool shows.
    const liveRows = source === "saved" ? liveTable(title)?.rows.length : undefined;
    const cut = liveRows !== undefined && liveRows > table.rows.length
      ? `: ${table.rows.length.toLocaleString("en-US")} of ${liveRows.toLocaleString("en-US")} rows` : "";
    setStatus(!copied ? "clipboard unavailable — use Export instead"
      : source === "saved" ? `copied ${title} (the saved table${cut})` : `copied ${title} (the full live table; not saved yet)`);
  });
  const report = (title: string) => void guarded(async () => {
    const index = savedIndex(title);
    if (!saved || index < 0 || blocked) { setStatus(reportBlocked(title) ?? "can't add this table to the report", "danger"); return; }
    await loadActions().then((m) => m.sendAnalysisInlineTableToReport(saved.id, index), onLoadFailure);
  });
  const openTable = (title: string) => void guarded(async () => {
    const index = savedIndex(title);
    const table = index >= 0 ? saved?.tables?.[index] : undefined;
    if (!saved || !table || blocked) { setStatus(openBlocked(title) ?? "can't open this table as a worksheet", "danger"); return; }
    const ids = await loadFreeze().then(
      (m) => m.freezeAnalysisOutputs(saved.id, [{ key: `tbl:${index}`, ref: table }]),
      () => { onLoadFailure(); return [] as string[]; },
    );
    if (!ids.length) return;
    setActive(ids[0]);
    setStageTab("worksheet");
  });
  const openSaved = () => { if (saved) openResultBook(saved.id); };
  return { saved, liveTables, busy, reportBlocked, openBlocked, hasLiveTable: hasLive, liveTable: (title) => liveTable(title) ?? null,
    copyBlocked, copySource, copy, report, openTable, openSaved };
}

/** A cached thunk over the tool's table builder: built once per input, on
 *  first read (a recompute that nobody copies builds nothing). */
export function useLiveTables<T>(input: T | null, build: (input: T) => AnalysisResultTable[]): () => AnalysisResultTable[] | null {
  return useMemo(() => {
    let cache: AnalysisResultTable[] | null = null;
    return () => input === null ? null : (cache ??= build(input));
  }, [input, build]);
}
