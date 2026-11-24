// The in-tool half of the result book (lane RB3): the per-table and header
// actions a statistics tool offers on its LIVE result, so they match the saved
// book's.
//
//   Copy table        -> the live table, built by the SAME builder the tool
//                        saves with, so the copy equals the saved table (TSV).
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
export function useToolResultBook({ savedKey = null, savedId = null, liveTables }: {
  savedKey?: string | null;
  savedId?: string | null;
  liveTables: () => readonly AnalysisResultTable[] | null;
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
  const liveTable = (title: string) => liveTables()?.find((table) => table.title === title);
  const savedIndex = (title: string): number => saved?.tables?.findIndex((table) => table.title === title) ?? -1;
  const reportBlocked = (title: string): string | null =>
    !saved ? SAVE_FIRST : savedIndex(title) < 0 ? NOT_IN_SAVED : null;
  const openBlocked = (title: string): string | null => {
    const blocked = reportBlocked(title);
    if (blocked || !saved) return blocked;
    const freeze = inlineTableOutputs(saved, [])[savedIndex(title)];
    return freeze && !freeze.freezable ? `Can't open as a worksheet: ${freeze.reason}.` : null;
  };
  const copy = (title: string) => void guarded(async () => {
    const table = liveTable(title);
    if (!table) { setStatus(`can't copy ${title}: the table is not computed yet`, "danger"); return; }
    const copied = await copyText(tablesToTSV([table]));
    setStatus(copied ? `copied ${title}` : "clipboard unavailable — use Export instead");
  });
  const report = (title: string) => void guarded(async () => {
    const index = savedIndex(title);
    if (!saved || index < 0) { setStatus(reportBlocked(title) ?? "can't add this table to the report", "danger"); return; }
    await loadActions().then((m) => m.sendAnalysisInlineTableToReport(saved.id, index), onLoadFailure);
  });
  const openTable = (title: string) => void guarded(async () => {
    const index = savedIndex(title);
    const table = index >= 0 ? saved?.tables?.[index] : undefined;
    if (!saved || !table) { setStatus(openBlocked(title) ?? "can't open this table as a worksheet", "danger"); return; }
    const ids = await loadFreeze().then(
      (m) => m.freezeAnalysisOutputs(saved.id, [{ key: `tbl:${index}`, ref: table }]),
      () => { onLoadFailure(); return [] as string[]; },
    );
    if (!ids.length) return;
    setActive(ids[0]);
    setStageTab("worksheet");
  });
  const openSaved = () => { if (saved) openResultBook(saved.id); };
  return { saved, liveTables, busy, reportBlocked, openBlocked, hasLiveTable: (title) => !!liveTable(title), copy, report, openTable, openSaved };
}

/** A cached thunk over the tool's table builder: built once per input, on
 *  first read (a recompute that nobody copies builds nothing). */
export function useLiveTables<T>(input: T | null, build: (input: T) => AnalysisResultTable[]): () => AnalysisResultTable[] | null {
  return useMemo(() => {
    let cache: AnalysisResultTable[] | null = null;
    return () => input === null ? null : (cache ??= build(input));
  }, [input, build]);
}
