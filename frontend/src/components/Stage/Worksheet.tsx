// Worksheet view of the active dataset: double-click a cell to edit it (commits
// to the active dataset), click a header to sort, filter/mask rows, and add a
// computed column with a formula (e.g. "2*A + sqrt(B)") over x + channels A,B,C…
// The toolbar + data grid are extracted to keep this container under the budget.

import { useEffect, useMemo, useState } from "react";

import { statsDescriptive } from "../../lib/api";
import { copyText, tableToTSV } from "../../lib/clipboard";
import { channelLetter, compileFormula } from "../../lib/formula";
import { excludedSet } from "../../lib/rowstate";
import type { CalcResult, DataStruct } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import { askParams } from "../overlays/ParamDialog";
import WorksheetFilterBar from "./WorksheetFilterBar";
import WorksheetTable from "./WorksheetTable";
import WorksheetToolbar from "./WorksheetToolbar";

const MAX_ROWS = 500;

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

export default function Worksheet() {
  const active = useActiveDataset();
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
  // Right-click menu: a header column (target -1 = x) or a data row.
  const [menu, setMenu] = useState<{ kind: "col" | "row"; target: number; x: number; y: number } | null>(null);
  const [formula, setFormula] = useState("");
  const [colName, setColName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
  // Per-column descriptive stats: index 0 = x column, 1.. = channels (null = pending).
  const [colStats, setColStats] = useState<(CalcResult | null)[] | null>(null);
  const [statsErr, setStatsErr] = useState(false);
  // Non-destructive row filter: column ("" none, "-1" x, "c" channel) op value(s).
  const [filterCol, setFilterCol] = useState("");
  const [filterOp, setFilterOp] = useState(">");
  const [filterV1, setFilterV1] = useState("");
  const [filterV2, setFilterV2] = useState("");
  // Masked (excluded) original-row indices: kept visible (greyed) but dropped
  // from analysis. Sourced from the persistent per-dataset row-state model (#50)
  // — NOT local component state — so it survives dataset switches, round-trips
  // .dwk, and is honored by every view (lib/rowstate is the single source).
  const masked = useMemo(() => excludedSet(active), [active]);

  // Selected rows — only "live" when the store selection targets the active
  // dataset (a transient brush; #50 selection dimension).
  const selected = useMemo(
    () => new Set(selection && active && selection.datasetId === active.id ? selection.rows : []),
    [selection, active],
  );

  // Row indices kept by the filter, in original order (all rows if no/incomplete
  // filter). The view, the stats subset, and "Extract" all derive from this.
  const filtered = useMemo(() => {
    const n = active?.data.time.length ?? 0;
    const all = Array.from({ length: n }, (_, i) => i);
    if (!active || filterCol === "") return all;
    const col = Number(filterCol);
    // Empty string -> NaN (Number("") is 0, which would wrongly filter on "> 0").
    const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
    const a = num(filterV1);
    const b = num(filterV2);
    if (Number.isNaN(a) || (filterOp === "between" && Number.isNaN(b))) return all;
    const { time, values } = active.data;
    const valOf = (r: number) => (col < 0 ? time[r] : values[r]?.[col]);
    return all.filter((r) => passesFilter(valOf(r), filterOp, a, b));
  }, [active, filterCol, filterOp, filterV1, filterV2]);

  // Sort the filtered rows for display (col = -1 is the x column). Non-finite last.
  const order = useMemo(() => {
    if (!active || !sort) return filtered;
    const key = (r: number) =>
      sort.col < 0 ? active.data.time[r] : active.data.values[r]?.[sort.col];
    return [...filtered].sort((a, b) => {
      const va = key(a);
      const vb = key(b);
      if (!Number.isFinite(va)) return 1;
      if (!Number.isFinite(vb)) return -1;
      return (va - vb) * sort.dir;
    });
  }, [active, filtered, sort]);

  // The analysis set = filtered rows minus masked rows. Stats + Extract use this;
  // the displayed table still shows masked rows (greyed) for context.
  const analysisRows = useMemo(
    () => filtered.filter((r) => !masked.has(r)),
    [filtered, masked],
  );

  // Fetch per-column descriptive stats (golden /api/stats/descriptive) over the
  // ANALYSIS rows — independent of the MAX_ROWS display cap and the sort order, so
  // stats follow filter + mask but not pagination/ordering.
  useEffect(() => {
    if (!showStats || !active) {
      setColStats(null);
      setStatsErr(false);
      return;
    }
    let cancelled = false;
    setColStats(null);
    setStatsErr(false);
    const { time, values, labels } = active.data;
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
  }, [active, showStats, analysisRows]);

  if (!active) {
    return (
      <div className="qzk-sheet qzk-ds-meta" style={{ padding: 12 }}>
        Select a dataset
      </div>
    );
  }

  const { time, values, labels, units, metadata } = active.data;
  const channelRoles = active.channelRoles ?? {}; // per-dataset label/ignore roles
  // Computed columns occupy the last `formulas.length` columns; the rest is base.
  const baseCount = labels.length - (active.formulas?.length ?? 0);
  const xName = String(metadata?.["x_column_name"] ?? "x");
  const xUnit = String(metadata?.["x_column_unit"] ?? "");
  const filterActive = filtered.length !== time.length;
  // Extract is meaningful whenever the analysis set differs from the full data
  // (a filter narrowed it and/or some rows are masked), and isn't empty.
  const canExtract = analysisRows.length > 0 && analysisRows.length !== time.length;

  const toggleMask = (r: number) => toggleRowExcluded(active.id, r);
  const unmaskAll = () => clearRowExclusions(active.id);

  // Materialize the analysis set (filtered minus masked) as a new dataset in the
  // library (plottable, fittable) — the non-destructive filter/mask made actionable.
  function extractSubset() {
    if (!canExtract) return;
    const data: DataStruct = {
      time: analysisRows.map((r) => time[r]),
      values: analysisRows.map((r) => values[r]),
      labels,
      units,
      metadata,
    };
    const stem = active!.name.replace(/\.[^.]+$/, "");
    addDataset({ id: `subset-${++_seq}`, name: `${stem} (subset)`, data });
    setStatus(`extracted ${analysisRows.length} of ${time.length} rows`);
  }

  // Copy the visible rows (filtered + sorted, masked excluded) as TSV — the full
  // table (every channel) at full precision, straight to the clipboard. Distinct
  // from the plot's copy-data (which is the plotted series only).
  function copyRows() {
    const rows = order.filter((r) => !masked.has(r));
    const headers = [
      xUnit ? `${xName} (${xUnit})` : xName,
      ...labels.map((lab, c) => (units[c] ? `${lab} (${units[c]})` : lab)),
    ];
    const data = rows.map((r) => [time[r], ...labels.map((_, c) => values[r]?.[c])]);
    copyText(tableToTSV(headers, data)).then((ok) =>
      setStatus(ok ? `copied ${rows.length} rows to clipboard` : "clipboard unavailable"),
    );
  }

  const toggleSort = (col: number) =>
    setSort((s) => (s && s.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }));
  const mark = (col: number) => (sort?.col === col ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  // Copy one data row (TSV) — single-row sibling of copyRows.
  function copyRow(r: number) {
    const headers = [
      xUnit ? `${xName} (${xUnit})` : xName,
      ...labels.map((lab, c) => (units[c] ? `${lab} (${units[c]})` : lab)),
    ];
    const data = [[time[r], ...labels.map((_, c) => values[r]?.[c])]];
    copyText(tableToTSV(headers, data)).then((ok) =>
      setStatus(ok ? `copied row ${r + 1}` : "clipboard unavailable"),
    );
  }

  // Prompt for a name + formula, then add a computed column (validated inline).
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
      addFormula(active!.id, name, expr);
      setStatus(`added column "${name}"`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "formula error");
    }
  }

  // Context-menu item builders (the grid parity of MATLAB's column/row menus).
  const colMenuItems = (col: number): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { label: "Sort ascending", run: () => setSort({ col, dir: 1 }) },
      { label: "Sort descending", run: () => setSort({ col, dir: -1 }) },
    ];
    if (col >= 0) {
      const plotted = yKeys ?? labels.map((_, i) => i);
      const shown = plotted.includes(col);
      items.push({ separator: true });
      items.push({
        label: xKey === col ? "Already the X axis" : "Set as X axis",
        run: () => setXKey(col),
        disabled: xKey === col,
      });
      items.push(
        shown
          ? {
              label: "Hide from plot",
              run: () => setYKeys(plotted.filter((c) => c !== col)),
              disabled: plotted.length <= 1,
            }
          : { label: "Plot as Y", run: () => setYKeys([...plotted, col].sort((a, b) => a - b)) },
      );
    }
    items.push({ separator: true });
    items.push({ label: "New column from formula…", run: () => void promptColumn() });
    items.push({
      label: showStats ? "Hide column statistics" : "Show column statistics",
      run: () => setShowStats((v) => !v),
    });
    return items;
  };
  const rowMenuItems = (r: number): ContextMenuItem[] => [
    { label: masked.has(r) ? "Unmask row" : "Mask row", run: () => toggleMask(r) },
    { label: "Unmask all rows", run: unmaskAll, disabled: masked.size === 0 },
    { separator: true },
    { label: "Copy row (TSV)", run: () => copyRow(r) },
  ];
  const openMenu = (kind: "col" | "row") => (target: number, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ kind, target, x: e.clientX, y: e.clientY });
  };

  // Add a live computed column to the active dataset (it recomputes when the base
  // changes). compileFormula validates the expression here so a syntax error
  // surfaces inline instead of becoming a silent all-NaN column.
  function addColumn() {
    setErr(null);
    try {
      compileFormula(formula); // validate — throws on a bad expression
      const name = colName.trim() || formula.trim();
      addFormula(active!.id, name, formula);
      setStatus(`added column "${name}"`);
      setFormula("");
      setColName("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "formula error");
    }
  }

  const vars = ["x", ...labels.map((_, c) => channelLetter(c))].join(" · ");

  return (
    <div className="qzk-sheet">
      <WorksheetToolbar
        formula={formula}
        colName={colName}
        setFormula={setFormula}
        setColName={setColName}
        onAddColumn={addColumn}
        showStats={showStats}
        onToggleStats={() => setShowStats((v) => !v)}
        onCopy={copyRows}
        maskedCount={masked.size}
        onUnmaskAll={unmaskAll}
        selectedCount={selected.size}
        onExcludeSelected={excludeSelectedRows}
        onKeepOnlySelected={keepOnlySelectedRows}
        onClearSelection={clearRowSelection}
        vars={vars}
      />

      <WorksheetFilterBar
        xName={xName}
        labels={labels}
        filterCol={filterCol}
        filterOp={filterOp}
        filterV1={filterV1}
        filterV2={filterV2}
        setFilterCol={setFilterCol}
        setFilterOp={setFilterOp}
        setFilterV1={setFilterV1}
        setFilterV2={setFilterV2}
        filterActive={filterActive}
        keptCount={filtered.length}
        totalCount={time.length}
        maskedCount={masked.size}
        canExtract={canExtract}
        onExtract={extractSubset}
      />
      {err && (
        <div className="qzk-ds-meta" style={{ padding: "4px 8px", color: "var(--danger)" }}>
          {err}
        </div>
      )}

      <WorksheetTable
        time={time}
        values={values}
        labels={labels}
        units={units}
        xName={xName}
        xUnit={xUnit}
        order={order}
        masked={masked}
        selected={selected}
        channelRoles={channelRoles}
        sortMark={mark}
        onToggleSort={toggleSort}
        onToggleSelect={toggleRowSelected}
        onSelectRange={setRowSelection}
        onEditCell={(row, col, value) => setCellValue(active!.id, row, col, value)}
        baseCount={baseCount}
        onRemoveFormula={(i) => removeFormula(active!.id, i)}
        maxRows={MAX_ROWS}
        showStats={showStats}
        colStats={colStats}
        statsErr={statsErr}
        onHeaderContext={openMenu("col")}
        onRowContext={openMenu("row")}
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={menu.kind === "col" ? colMenuItems(menu.target) : rowMenuItems(menu.target)}
        />
      )}
      {filtered.length > MAX_ROWS && (
        <div className="qzk-ds-meta" style={{ padding: 8 }}>
          showing {MAX_ROWS} of {filtered.length}
          {filterActive ? ` filtered (${time.length} total)` : ""} rows
        </div>
      )}
    </div>
  );
}
