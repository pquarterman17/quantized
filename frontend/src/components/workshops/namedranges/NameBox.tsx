// The worksheet's Name box (ROW_RANGE_CONTRACT 5.5, slice R4c). It shows the name of the selected block when that
// block is a named range, defines a new name from the selection (typed name + Enter or Define), and selects a range
// when its name is picked or typed. Names are validated as the model says (a legal name, unique within the workbook);
// a selection that is not one block of rows is refused with the reason, never widened. Lazy: mounted by the worksheet
// pane only while a selection or a named range exists, so it costs the first paint nothing.

import { useMemo, useState } from "react";

import { rangeCols, rangeRows, type CellRange } from "../../../lib/gridCursor";
import type { Dataset } from "../../../lib/types";
import { defineNamedRange } from "../../../store/namedRanges";
import { useApp } from "../../../store/useApp";
import type { WorksheetView } from "../../Stage/worksheet/useWorksheetView";
import { goToNamedRange } from "../../../store/namedRangeGoTo";
import { describeBlock, planNameBox, rangeNamingBlock, selectedBlock, visibleRanges } from "./nameBoxModel";
import { openNamedRangesManager } from "./openManager";
import "./namedRanges.css";

interface Props {
  ds: Dataset;
  view: Pick<WorksheetView, "order" | "selected" | "selectedCols" | "setRowSelection" | "setColSelection">;
  cursorRange: CellRange | null;
  hidden: ReadonlySet<number>;
  onClearCursor: () => void;
  windowId?: string;
}

export default function NameBox({ ds, view, cursorRange, hidden, onClearCursor, windowId }: Props) {
  const ranges = useApp((s) => s.namedRanges);
  const datasets = useApp((s) => s.datasets);
  const [typed, setTyped] = useState<string | null>(null); // null = show the selection's own name
  const [scope, setScope] = useState<"sheet" | "workbook">("sheet");
  const [message, setMessage] = useState<string | null>(null);
  const visible = useMemo(() => visibleRanges(ranges, ds), [ranges, ds]);
  const width = ds.data.labels.length;
  const block = useMemo(
    () =>
      selectedBlock({
        cell: cursorRange ? { rows: rangeRows(cursorRange, view.order), cols: rangeCols(cursorRange, hidden) } : null,
        rows: view.selected,
        cols: view.selectedCols,
        width,
      }),
    [cursorRange, hidden, view.order, view.selected, view.selectedCols, width],
  );
  const okBlock = block && !("reason" in block) ? block : null;
  const named = okBlock ? rangeNamingBlock(okBlock, visible, ds.id) : undefined;
  const plan = planNameBox(typed ?? "", scope, block, ranges, datasets, ds);
  const local = { datasetId: ds.id, windowId, clearCursor: onClearCursor, setRows: view.setRowSelection, setCols: view.setColSelection };

  const run = (): void => {
    if (plan.kind === "go") {
      const why = goToNamedRange(plan.range, local);
      setMessage(why);
      if (!why) setTyped(null);
    } else if (plan.kind === "define" && okBlock) {
      const result = defineNamedRange({ name: plan.name, scope: plan.scope, datasetId: ds.id, cols: okBlock.cols, rows: okBlock.rows });
      setMessage(result.ok ? null : result.reason);
      if (result.ok) setTyped(null);
    }
  };

  let hint: string;
  if (message) hint = message;
  else if (plan.kind === "refused") hint = plan.reason;
  else if (plan.kind === "go") hint = `Enter selects "${plan.range.name}"`;
  else if (plan.kind === "define") hint = `Enter names the selection${okBlock ? ` (${describeBlock(okBlock)})` : ""}`;
  else if (named) hint = `"${named.name}" names this selection`;
  else if (block === null) hint = "Select cells, then name them";
  else if ("reason" in block) hint = block.reason;
  else hint = `Selection ${describeBlock(block)}: type a name to define it`;
  const warn = message !== null || plan.kind === "refused" || (block !== null && "reason" in block && plan.kind === "idle");

  return (
    <div className="qzk-namebox" role="group" aria-label="Name box">
      <label className="qzk-namebox-field">
        <span className="qzk-ds-meta">Name</span>
        <input
          className="qz-input"
          aria-label="Name box"
          value={typed ?? named?.name ?? ""}
          placeholder="Name this selection"
          maxLength={80}
          onChange={(e) => {
            setTyped(e.target.value);
            setMessage(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              run();
            } else if (e.key === "Escape") {
              setTyped(null);
              setMessage(null);
            }
          }}
          onFocus={(e) => e.currentTarget.select()}
        />
      </label>
      {ds.workbookId && (
        <select className="qz-select" aria-label="Name scope" value={scope} onChange={(e) => setScope(e.target.value as "sheet" | "workbook")} title="Where the name can be used">
          <option value="sheet">This sheet</option>
          <option value="workbook">Whole workbook</option>
        </select>
      )}
      <button
        className="qz-btn"
        disabled={plan.kind !== "define" && plan.kind !== "go"}
        onClick={run}
        title={plan.kind === "refused" ? plan.reason : plan.kind === "go" ? "Select this named range" : "Name the selected cells"}
      >
        {plan.kind === "go" ? "Select" : "Define"}
      </button>
      {visible.length > 0 && (
        <select
          className="qz-select"
          aria-label="Go to named range"
          value=""
          onChange={(e) => {
            const range = visible.find((r) => r.id === e.target.value);
            if (!range) return;
            setTyped(null);
            setMessage(goToNamedRange(range, local));
          }}
        >
          <option value="">Go to…</option>
          {visible.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.rowsStale ? " (stale)" : ""}
            </option>
          ))}
        </select>
      )}
      <button className="qz-btn" onClick={() => openNamedRangesManager(okBlock ? { datasetId: ds.id, block: okBlock } : undefined)} title="List, rename, retarget and delete named ranges">
        Named ranges…
      </button>
      <span className={`qzk-ds-meta qzk-namebox-note${warn ? " warning" : ""}`} role="status">
        {hint}
      </span>
    </div>
  );
}
