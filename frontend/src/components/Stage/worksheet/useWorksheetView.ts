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

import { useEffect, useMemo, useState } from "react";

import { statsDescriptive } from "../../../lib/api";
import { copyText, tableToTSV } from "../../../lib/clipboard";
import { channelLetter, compileFormula } from "../../../lib/formula";
import { excludedSet, filteredOutSet } from "../../../lib/rowstate";
import type { CalcResult, ChannelRole, Dataset, DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { askParams } from "../../overlays/ParamDialog";

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

  const filtered = useMemo(() => {
    const n = ds.data.time.length;
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
  }, [ds, filterCol, filterOp, filterV1, filterV2]);

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
  const filterActive = filtered.length !== time.length;
  const canExtract = analysisRows.length > 0 && analysisRows.length !== time.length;

  const toggleMask = (r: number) => toggleRowExcluded(ds.id, r);
  const unmaskAll = () => clearRowExclusions(ds.id);

  function extractSubset() {
    if (!canExtract) return;
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
    const rows = order.filter((r) => !masked.has(r));
    const data = rows.map((r) => [time[r], ...labels.map((_, c) => values[r]?.[c])]);
    copyText(tableToTSV(tsvHeaders(), data)).then((ok) =>
      setStatus(ok ? `copied ${rows.length} rows to clipboard` : "clipboard unavailable"),
    );
  }

  function copyRow(r: number) {
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
  };
}
