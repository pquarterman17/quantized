// Worksheet state hook (WORKSHEET_PLAN item 3): filter/sort/stats/selection
// state + the extract/copy/formula actions, extracted from the old
// Worksheet.tsx container so it takes the dataset to view as an explicit
// argument rather than reading `useActiveDataset()` itself — the contract
// `WorksheetPane(datasetId)` needs to be mountable for any dataset, not just
// the globally-active one (item 3's Stage-D-readiness audit, item 11).
//
// Row exclusion (#50) and the local data filter (#53) are read ONLY through
// lib/rowstate (excludedSet/filteredOutSet) — never the dataset's persistent
// exclusion field directly — so the architecture guard (#50 universal
// linking) stays green.
//
// Column selection (item 6) is a SEPARATE, session-transient dimension from
// the store's row selection (#50, above) — a Set of column indices (-1 = the
// pinned x/time column, 0..N-1 = value channels, the SAME numbering
// `toggleSort`/`lib/columnmeta` already use), never persisted, cleared on a
// dataset switch or Escape. Selection→plot (item 7) maps it onto the
// EXISTING setXKey/setYKeys/setErrKey store actions via the pure
// `lib/selectionplot.resolveSelectionPlot` — no new plotting pathway, so
// macro recording and row-state honoring come free (setXKey/setYKeys already
// record macro steps; the plotted result already reads through
// lib/rowstate's analysisData/droppedRows via the existing plot pipeline).

import { useEffect, useMemo, useState } from "react";

import { statsDescriptive } from "../../../lib/api";
import { copyText, tableToTSV } from "../../../lib/clipboard";
import { channelLetter, compileFormula } from "../../../lib/formula";
import { originTextColumns, type TextColumn } from "../../../lib/columnmeta";
import { autofitColWidth, clampColWidth } from "../../../lib/gridwindow";
import { excludedSet, filteredOutSet } from "../../../lib/rowstate";
import { resolveSelectionPlot, selectionToSpec } from "../../../lib/selectionplot";
import type { CalcResult, ChannelRole, Dataset, DataStruct } from "../../../lib/types";
import { plotIntentStageTab, useApp } from "../../../store/useApp";
import { askParams } from "../../overlays/ParamDialog";
import { fmtCell } from "./cellFormat";

/** Does value `v` pass `op` against `a` (and `b` for "between")? Non-finite fails. */
function passesFilter(v: number | undefined, op: string, a: number, b: number): boolean {
  if (v == null || !Number.isFinite(v)) return false;
  switch (op) {
    case ">": return v > a;
    case ">=": return v >= a;
    case "<": return v < a;
    case "<=": return v <= a;
    case "==": return v === a;
    case "!=": return v !== a;
    case "between": return v >= a && v <= b;
    default: return true;
  }
}

let _seq = 0;

export interface WorksheetView {
  data: DataStruct;
  xName: string;
  xUnit: string;
  baseCount: number;
  channelRoles: Record<number, ChannelRole>;
  vars: string;

  sort: { col: number; dir: 1 | -1 } | null;
  setSort: (s: { col: number; dir: 1 | -1 } | null) => void;
  toggleSort: (col: number) => void;
  sortMark: (col: number) => string;

  filterCol: string;
  filterOp: string;
  filterV1: string;
  filterV2: string;
  setFilterCol: (v: string) => void;
  setFilterOp: (v: string) => void;
  setFilterV1: (v: string) => void;
  setFilterV2: (v: string) => void;
  filterActive: boolean;

  order: number[];
  filtered: number[];
  analysisRows: number[];
  masked: Set<number>;
  filteredOut: Set<number>;
  selected: Set<number>;
  selectedCount: number;

  canExtract: boolean;
  extractSubset: () => void;
  copyRows: () => void;
  copyRow: (r: number) => void;
  toggleMask: (r: number) => void;
  unmaskAll: () => void;

  toggleRowSelected: (r: number) => void;
  setRowSelection: (rows: number[]) => void;
  clearRowSelection: () => void;
  excludeSelectedRows: () => void;
  keepOnlySelectedRows: () => void;

  showStats: boolean;
  setShowStats: (v: boolean | ((cur: boolean) => boolean)) => void;
  colStats: (CalcResult | null)[] | null;
  statsErr: boolean;

  formula: string;
  setFormula: (v: string) => void;
  colName: string;
  setColName: (v: string) => void;
  addColumn: () => void;
  promptColumn: () => Promise<void>;
  err: string | null;

  onEditCell: (row: number, col: number, value: number) => void;
  onRemoveFormula: (index: number) => void;

  xKey: number | null;
  yKeys: number[] | null;
  setXKey: (col: number) => void;
  setYKeys: (cols: number[]) => void;

  // Column selection model (item 6) + selection→plot (item 7).
  selectedCols: Set<number>;
  toggleColSelected: (col: number) => void;
  setColSelection: (cols: number[]) => void;
  clearColSelection: () => void;
  /** Apply the designation-aware mapping over an EXPLICIT column list (used
   *  by the context menu's single-column fallback when nothing is
   *  selected) — "replace" is "Plot selection", "add" is "Add to plot". */
  plotCols: (cols: number[], mode: "replace" | "add") => void;
  /** Convenience wrappers over the CURRENT selection, for the toolbar. */
  plotSelection: () => void;
  addSelectionToPlot: () => void;

  // Per-column widths + drag resize (MAIN_PLAN #3). SESSION state only, like
  // the column selection — reset on a dataset switch, never persisted
  // (per-dataset .dwk persistence is an open owner gate, MAIN_PLAN
  // "worksheet view-state persistence").
  colWidths: Record<number, number>;
  setColWidth: (col: number, width: number) => void;
  /** Double-click autofit: size the column to its header + a content sample
   *  (the first rows of the DISPLAY order, formatted exactly as rendered). */
  autofitCol: (col: number) => void;

  // Selection → Graph Builder handoff (MAIN_PLAN #4): prefill a lib/plotspec
  // spec from an explicit column list (the context menu's effectiveCols) and
  // open the Graph Builder workshop seeded with it.
  openInGraphBuilder: (cols: number[]) => void;
  /** Toolbar wrapper over the CURRENT column selection. */
  openSelectionInGraphBuilder: () => void;

  // Text-sheet rendering (item 8) — read-only, appended after numeric/computed
  // columns; never editable, never in stats, never a selection→plot candidate.
  textCols: TextColumn[];
}

export function useWorksheetView(ds: Dataset): WorksheetView {
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const setCellValue = useApp((s) => s.setCellValue);
  const addFormula = useApp((s) => s.addFormula);
  const removeFormula = useApp((s) => s.removeFormula);
  const xKey = useApp((s) => s.xKey);
  const setXKey = useApp((s) => s.setXKey);
  const yKeys = useApp((s) => s.yKeys);
  const setYKeys = useApp((s) => s.setYKeys);
  const setErrKey = useApp((s) => s.setErrKey);
  const originWorksheetSeed = useApp((s) => s.originWorksheetSeed);
  const toggleRowExcluded = useApp((s) => s.toggleRowExcluded);
  const clearRowExclusions = useApp((s) => s.clearRowExclusions);
  const selection = useApp((s) => s.selection);
  const toggleRowSelected = useApp((s) => s.toggleRowSelected);
  const setRowSelection = useApp((s) => s.setRowSelection);
  const clearRowSelection = useApp((s) => s.clearRowSelection);
  const excludeSelectedRows = useApp((s) => s.excludeSelectedRows);
  const keepOnlySelectedRows = useApp((s) => s.keepOnlySelectedRows);

  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [formula, setFormula] = useState("");
  const [colName, setColName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [colStats, setColStats] = useState<(CalcResult | null)[] | null>(null);
  const [statsErr, setStatsErr] = useState(false);
  const [filterCol, setFilterCol] = useState("");
  const [filterOp, setFilterOp] = useState(">");
  const [filterV1, setFilterV1] = useState("");
  const [filterV2, setFilterV2] = useState("");
  const [selectedCols, setSelectedCols] = useState<Set<number>>(new Set());
  const [colWidths, setColWidths] = useState<Record<number, number>>({});

  // Clear the column selection AND the per-column widths on a dataset switch
  // (sheet tab, book switcher, Library click, …) — state keyed by column
  // INDEX is meaningless once the underlying columns can be entirely
  // different (the same rule the item-6 selection set already followed).
  useEffect(() => {
    setSelectedCols(new Set());
    setColWidths({});
  }, [ds.id]);

  // Origin #50 one-shot: select the exact decoded X/Y/error columns after
  // the requested source sheet mounts. The durable selection remains local.
  useEffect(() => {
    if (originWorksheetSeed?.datasetId !== ds.id) return;
    setSelectedCols(new Set(originWorksheetSeed.columns));
    useApp.getState().clearOriginWorksheetSeed();
  }, [ds.id, originWorksheetSeed]);

  // Esc clears the column selection while one exists (mirrors useGadgetChip's
  // "listen only while there's something to dismiss" pattern).
  useEffect(() => {
    if (selectedCols.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedCols(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCols.size]);

  const toggleColSelected = (col: number) =>
    setSelectedCols((s) => {
      const next = new Set(s);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  const setColSelection = (cols: number[]) => setSelectedCols(new Set(cols));
  const clearColSelection = () => setSelectedCols(new Set());

  function plotCols(cols: number[], mode: "replace" | "add") {
    // Plot-intent (WORKSHEET_PLAN item 15 "origin book click opens…"):
    // "Plot selection"/"Add to plot" mean PUT THIS ON THE GRAPH. If the
    // worksheet is showing a dataset the focused plot window ISN'T bound to
    // (a worksheet-intent Library click, `useApp.activateFromLibrary`,
    // deliberately left the window alone), rebind the focused window to
    // THIS dataset first — mirrors Origin's "select columns, then Plot"
    // landing on the active graph. Re-reads xKey/yKeys AFTER the rebind
    // (`setActive` resets them) rather than trusting the closured values
    // above, which would otherwise describe the PREVIOUS plot's axes.
    const store = useApp.getState();
    if (store.activeId !== ds.id) store.setActive(ds.id);
    // Owner-routing item 1: `ds` is ALREADY active often enough (the common
    // "worksheet + plot bound to the same dataset" case) that `setActive`
    // above never runs — so its stageTab fix alone doesn't cover this call
    // site. Force the Plot tab here too, whenever it isn't already showing.
    const afterActivate = useApp.getState();
    const wantTab = plotIntentStageTab(ds);
    if (afterActivate.stageTab !== wantTab) useApp.setState({ stageTab: wantTab });
    const cur = useApp.getState();
    const result = resolveSelectionPlot(ds.data, new Set(cols), { xKey: cur.xKey, yKeys: cur.yKeys }, mode);
    for (const action of result.actions) {
      if (action.kind === "setXKey") setXKey(action.xKey);
      else if (action.kind === "setYKeys") setYKeys(action.yKeys);
      else setErrKey(action.channel, action.errChannel);
    }
    setStatus(result.summary);
  }

  const plotSelection = () => plotCols([...selectedCols], "replace");
  const addSelectionToPlot = () => plotCols([...selectedCols], "add");

  // Masked (excluded) original-row indices: kept visible (greyed) but dropped
  // from analysis. Sourced from the persistent per-dataset row-state model
  // (#50) — the single sanctioned read (lib/rowstate) — so it survives
  // dataset switches, round-trips .dwk, and is honored everywhere.
  const masked = useMemo(() => excludedSet(ds), [ds]);
  // Global-filter-dropped rows (#53 residual): kept visible (greyed, distinct
  // from a manual exclusion).
  const filteredOut = useMemo(() => filteredOutSet(ds), [ds]);
  // Selected rows — only "live" when the store selection targets THIS dataset.
  const selected = useMemo(
    () => new Set(selection && selection.datasetId === ds.id ? selection.rows : []),
    [selection, ds.id],
  );

  // Text-sheet columns (item 8): read-only, appended after numeric/computed
  // columns. A text-only book has zero numeric rows (`ds.data.time.length ===
  // 0`) but non-empty text rows — the effective row count is the LARGER of
  // the two so those rows aren't silently dropped ("text columns are the
  // whole grid" for such a book).
  const textCols = useMemo(() => originTextColumns(ds.data), [ds.data]);
  const textRowCount = useMemo(() => textCols.reduce((m, t) => Math.max(m, t.rows.length), 0), [textCols]);

  const filtered = useMemo(() => {
    const n = Math.max(ds.data.time.length, textRowCount);
    const all = Array.from({ length: n }, (_, i) => i);
    if (filterCol === "") return all;
    const col = Number(filterCol);
    // Empty string -> NaN (Number("") is 0, which would wrongly filter on "> 0").
    const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
    const a = num(filterV1);
    const b = num(filterV2);
    if (Number.isNaN(a) || (filterOp === "between" && Number.isNaN(b))) return all;
    const { time, values } = ds.data;
    const valOf = (r: number) => (col < 0 ? time[r] : values[r]?.[col]);
    return all.filter((r) => passesFilter(valOf(r), filterOp, a, b));
  }, [ds, filterCol, filterOp, filterV1, filterV2, textRowCount]);

  const order = useMemo(() => {
    if (!sort) return filtered;
    const key = (r: number) => (sort.col < 0 ? ds.data.time[r] : ds.data.values[r]?.[sort.col]);
    return [...filtered].sort((a, b) => {
      const va = key(a);
      const vb = key(b);
      if (!Number.isFinite(va)) return 1;
      if (!Number.isFinite(vb)) return -1;
      return (va - vb) * sort.dir;
    });
  }, [ds, filtered, sort]);

  const analysisRows = useMemo(() => filtered.filter((r) => !masked.has(r)), [filtered, masked]);

  // Fetch per-column descriptive stats (golden /api/stats/descriptive) over
  // the ANALYSIS rows — independent of the windowed display range and the
  // sort order, so stats follow filter + mask but not scroll/ordering.
  useEffect(() => {
    if (!showStats) {
      setColStats(null);
      setStatsErr(false);
      return;
    }
    let cancelled = false;
    setColStats(null);
    setStatsErr(false);
    const { time, values, labels } = ds.data;
    const columns = [
      analysisRows.map((r) => time[r]),
      ...labels.map((_, c) => analysisRows.map((r) => values[r]?.[c])),
    ];
    Promise.all(columns.map((col) => statsDescriptive(col)))
      .then((res) => {
        if (!cancelled) setColStats(res);
      })
      .catch(() => {
        if (!cancelled) setStatsErr(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ds, showStats, analysisRows]);

  const { time, values, labels, units, metadata } = ds.data;
  const baseCount = labels.length - (ds.formulas?.length ?? 0);
  const xName = String(metadata?.["x_column_name"] ?? "x");
  const xUnit = String(metadata?.["x_column_unit"] ?? "");
  const filterActive = filtered.length !== Math.max(time.length, textRowCount);
  const canExtract = analysisRows.length > 0 && analysisRows.length !== Math.max(time.length, textRowCount);

  const toggleMask = (r: number) => toggleRowExcluded(ds.id, r);
  const unmaskAll = () => clearRowExclusions(ds.id);

  // #38 deferred edge: a still-pending dataset's rows are a min/max-DECIMATED
  // SAMPLE of the true data, not a prefix — a row index computed against the
  // preview doesn't correspond to any real row once the full data lands, so
  // extract/copy abort (kick the fetch, tell the user to retry) rather than
  // produce a permanently-wrong subset or clipboard payload.
  function pendingGuard(action: string): boolean {
    if (!ds.pending) return false;
    useApp.getState().ensureBookData(ds.id);
    setStatus(`still loading full data — try ${action} again in a moment`);
    return true;
  }

  function extractSubset() {
    if (!canExtract) return;
    if (pendingGuard("Extract")) return;
    const data: DataStruct = {
      time: analysisRows.map((r) => time[r]),
      values: analysisRows.map((r) => values[r]),
      labels,
      units,
      metadata,
    };
    const stem = ds.name.replace(/\.[^.]+$/, "");
    addDataset({ id: `subset-${++_seq}`, name: `${stem} (subset)`, data });
    setStatus(`extracted ${analysisRows.length} of ${time.length} rows`);
  }

  function tsvHeaders(): string[] {
    return [
      xUnit ? `${xName} (${xUnit})` : xName,
      ...labels.map((lab, c) => (units[c] ? `${lab} (${units[c]})` : lab)),
    ];
  }

  function copyRows() {
    if (pendingGuard("Copy")) return;
    const rows = order.filter((r) => !masked.has(r));
    const data = rows.map((r) => [time[r], ...labels.map((_, c) => values[r]?.[c])]);
    copyText(tableToTSV(tsvHeaders(), data)).then((ok) =>
      setStatus(ok ? `copied ${rows.length} rows to clipboard` : "clipboard unavailable"),
    );
  }

  function copyRow(r: number) {
    if (pendingGuard("Copy")) return;
    const data = [[time[r], ...labels.map((_, c) => values[r]?.[c])]];
    copyText(tableToTSV(tsvHeaders(), data)).then((ok) =>
      setStatus(ok ? `copied row ${r + 1}` : "clipboard unavailable"),
    );
  }

  async function promptColumn() {
    const p = await askParams("New computed column", [
      { key: "name", label: "Column name", type: "text", default: "" },
      { key: "expr", label: "Formula (e.g. 2*A + sqrt(B))", type: "text", default: "" },
    ]);
    if (!p) return;
    const expr = String(p.expr).trim();
    if (!expr) return;
    try {
      compileFormula(expr);
      const name = String(p.name).trim() || expr;
      addFormula(ds.id, name, expr);
      setStatus(`added column "${name}"`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "formula error");
    }
  }

  function addColumn() {
    setErr(null);
    try {
      compileFormula(formula); // validate — throws on a bad expression
      const name = colName.trim() || formula.trim();
      addFormula(ds.id, name, formula);
      setStatus(`added column "${name}"`);
      setFormula("");
      setColName("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "formula error");
    }
  }

  const toggleSort = (col: number) =>
    setSort((s) => (s && s.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }));
  const sortMark = (col: number) => (sort?.col === col ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  // Per-column widths (MAIN_PLAN #3): clamped on every write so a drag can
  // never store a degenerate width.
  const setColWidth = (col: number, width: number) =>
    setColWidths((w) => {
      const clamped = clampColWidth(width);
      // Bail on identity when a drag is pinned at the min/max clamp -
      // otherwise every pointermove forces a full grid re-render for
      // zero visual change.
      return w[col] === clamped ? w : { ...w, [col]: clamped };
    });

  // Double-click autofit: header text + the first rows of the DISPLAY order
  // (post filter/sort — what the user is actually looking at), formatted with
  // the grid's own cell formatter so the estimate matches rendered text.
  const AUTOFIT_SAMPLE_ROWS = 200;
  function autofitCol(col: number) {
    const samples: string[] =
      col < 0
        ? [xName, xUnit ? `X · ${xUnit}` : "X"]
        : [labels[col] ?? "", units[col] ? `· ${units[col]}` : ""];
    for (const r of order.slice(0, AUTOFIT_SAMPLE_ROWS)) {
      samples.push(fmtCell(col < 0 ? time[r] : values[r]?.[col]));
    }
    setColWidth(col, autofitColWidth(samples));
  }

  // Selection → Graph Builder handoff (MAIN_PLAN #4). The seed rides the
  // store (`openGraphBuilderSeeded`, one-shot like statStageSeed) and is
  // consumed by useGraphBuilder the same way its other entry point (the bare
  // command-palette open) initializes — no second spec pathway. Deliberately
  // NO `setActive` here (MAIN #8i): opening an overlay must not fire the
  // plot-intent side effects (window rebind, view reset, worksheet-override
  // clear) before the user commits — the builder BINDS to the seed's
  // dataset and its sendToStage lands the plot intent instead. (Contrast
  // plotCols above, where "Plot selection" IS the explicit plot intent.)
  function openInGraphBuilder(cols: number[]) {
    const spec = selectionToSpec(ds.data, ds.id, cols);
    if (!spec) {
      setStatus("nothing plottable in the selection");
      return;
    }
    useApp.getState().openGraphBuilderSeeded(spec);
    setStatus("opened the selection in the Graph Builder");
  }
  const openSelectionInGraphBuilder = () => openInGraphBuilder([...selectedCols]);

  const vars = ["x", ...labels.map((_, c) => channelLetter(c))].join(" · ");

  return {
    data: ds.data,
    xName,
    xUnit,
    baseCount,
    channelRoles: ds.channelRoles ?? {},
    vars,
    sort,
    setSort,
    toggleSort,
    sortMark,
    filterCol,
    filterOp,
    filterV1,
    filterV2,
    setFilterCol,
    setFilterOp,
    setFilterV1,
    setFilterV2,
    filterActive,
    order,
    filtered,
    analysisRows,
    masked,
    filteredOut,
    selected,
    selectedCount: selected.size,
    canExtract,
    extractSubset,
    copyRows,
    copyRow,
    toggleMask,
    unmaskAll,
    toggleRowSelected,
    setRowSelection,
    clearRowSelection,
    excludeSelectedRows,
    keepOnlySelectedRows,
    showStats,
    setShowStats,
    colStats,
    statsErr,
    formula,
    setFormula,
    colName,
    setColName,
    addColumn,
    promptColumn,
    err,
    onEditCell: (row, col, value) => setCellValue(ds.id, row, col, value),
    onRemoveFormula: (index) => removeFormula(ds.id, index),
    xKey,
    yKeys,
    setXKey,
    setYKeys,
    selectedCols,
    toggleColSelected,
    setColSelection,
    clearColSelection,
    plotCols,
    plotSelection,
    addSelectionToPlot,
    colWidths,
    setColWidth,
    autofitCol,
    openInGraphBuilder,
    openSelectionInGraphBuilder,
    textCols,
  };
}
