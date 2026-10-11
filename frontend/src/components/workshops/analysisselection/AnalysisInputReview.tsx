import { useMemo, useState } from "react";

import { resolveAnalysisSelection, type AnalysisSelectionItem } from "../../../lib/analysisSelection";
import { channelModelingType, isCategorical } from "../../../lib/modeling";
import { seedAnalysisSelection, useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import "./analysisInputReview.css";

interface Props {
  toolId: string;
  singleY?: boolean;
  allowFactor?: boolean;
  supportsBatch?: boolean;
}

const keyValue = (key: number | null): string => key === null ? "-1" : String(key);

export default function AnalysisInputReview({ toolId, singleY = false, allowFactor = false, supportsBatch = false }: Props) {
  const selectionOwner = useAnalysisSelection((state) => state.toolId);
  const storedSelection = useAnalysisSelection((state) => state.selection);
  const selection = selectionOwner === toolId ? storedSelection : null;
  const datasets = useApp((state) => state.datasets);
  const activeId = useApp((state) => state.activeId);
  const setXKey = useApp((state) => state.setXKey);
  const setYKeys = useApp((state) => state.setYKeys);
  const updateItem = useAnalysisSelection((state) => state.updateItem);
  const [open, setOpen] = useState(true);
  const resolved = useMemo(
    () => selection ? resolveAnalysisSelection(selection, datasets) : { items: [], issues: [] },
    [selection, datasets],
  );

  if (!selection) return null;
  const applyPatch = (item: AnalysisSelectionItem, patch: Partial<Omit<AnalysisSelectionItem, "datasetId">>, primary: boolean): void => {
    updateItem(item.datasetId, patch);
    // Keep the visible plot honest when its primary analysis roles change;
    // batch-only worksheet edits remain local to the selection contract.
    if (primary && item.datasetId === activeId) {
      if ("xKey" in patch) setXKey(patch.xKey ?? null);
      if ("yKeys" in patch && patch.yKeys) setYKeys(patch.yKeys);
    }
  };
  const errors = resolved.issues.filter((issue) => issue.severity === "error");
  return (
    <section className="qzk-analysis-input-review" aria-label="Review analysis inputs">
      <button type="button" className="qzk-analysis-input-review-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span><strong>Review inputs</strong> · {selection.items.length} worksheet{selection.items.length === 1 ? "" : "s"}</span>
        <span>{errors.length ? `${errors.length} blocked` : open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="qzk-analysis-input-review-body">
          <div className="qzk-analysis-input-review-actions">
            <span>{selection.items.length > 1 && !supportsBatch ? "This tool will use the first worksheet." : "Nothing runs until you confirm the tool action."}</span>
            <Button size="sm" onClick={() => seedAnalysisSelection(toolId, "library")}>Refresh from current selection</Button>
          </div>
          {selection.items.map((item, index) => {
            const dataset = datasets.find((entry) => entry.id === item.datasetId);
            const result = resolved.items.find((entry) => entry.selection.datasetId === item.datasetId);
            if (!dataset) return <div key={item.datasetId} className="qzk-analysis-input-card invalid">Missing worksheet: {item.datasetId}</div>;
            const columns = dataset.data.labels.map((label, column) => ({ column, label: label || `Column ${column + 1}` }));
            const factors = columns.filter((column) => isCategorical(channelModelingType(dataset, column.column)));
            const itemIssues = resolved.issues.filter((issue) => issue.datasetId === item.datasetId);
            const yValue = item.yKeys[0] ?? -1;
            return (
              <div key={item.datasetId} className={`qzk-analysis-input-card${itemIssues.some((issue) => issue.severity === "error") ? " invalid" : ""}`}>
                <div className="qzk-analysis-input-title">
                  <strong>{index + 1}. {dataset.name}</strong>
                  <span>{result?.rowCount ?? 0} analysis rows</span>
                </div>
                <div className="qzk-analysis-input-fields">
                  <label>X
                    <select value={keyValue(item.xKey)} onChange={(event) => applyPatch(item, { xKey: Number(event.target.value) < 0 ? null : Number(event.target.value) }, index === 0)}>
                      <option value="-1">{String(dataset.data.metadata.x_column_name ?? "X / time")}</option>
                      {columns.map((column) => <option key={column.column} value={column.column}>{column.label}</option>)}
                    </select>
                  </label>
                  <label>{singleY ? "Y" : "Primary Y"}
                    <select value={yValue} onChange={(event) => applyPatch(item, { yKeys: [Number(event.target.value)] }, index === 0)}>
                      {yValue < 0 && <option value="-1" disabled>No response available</option>}
                      {columns.map((column) => <option key={column.column} value={column.column}>{column.label}</option>)}
                    </select>
                  </label>
                  <label>Y uncertainty
                    <select value={item.errorKeys[yValue] ?? -1} onChange={(event) => {
                      const error = Number(event.target.value);
                      const errorKeys = { ...item.errorKeys };
                      if (error < 0) delete errorKeys[yValue]; else errorKeys[yValue] = error;
                      // This compact picker represents one symmetric Y sigma.
                      // Choosing it replaces any prior symmetric/asymmetric Y
                      // roles for this response instead of leaving conflicting
                      // +/− bindings hidden behind the new value.
                      const errorBindings = item.errorBindings.filter((binding) =>
                        !(binding.axis === "y" && binding.target === yValue));
                      if (error >= 0) errorBindings.push({ channel: error, target: yValue, axis: "y", side: "both" });
                      updateItem(item.datasetId, { errorKeys, errorBindings });
                    }}>
                      <option value="-1">None</option>
                      {columns.filter((column) => column.column !== yValue).map((column) => <option key={column.column} value={column.column}>{column.label}</option>)}
                    </select>
                  </label>
                  {allowFactor && <label>Run by
                    <select value={item.factorKeys[0] ?? -1} onChange={(event) => {
                      const factor = Number(event.target.value);
                      updateItem(item.datasetId, { factorKeys: factor < 0 ? [] : [factor] });
                    }}>
                      <option value="-1">No factor</option>
                      {factors.filter((column) => column.column !== yValue && column.column !== item.xKey).map((column) => <option key={column.column} value={column.column}>{column.label}</option>)}
                    </select>
                  </label>}
                </div>
                <div className="qzk-analysis-input-summary">
                  <span>{item.rowIds ? `${item.rowIds.length} explicitly selected rows` : "Filtered/excluded rows honored"}</span>
                  <span>{item.range ? `X range ${item.range.lo.toPrecision(5)}–${item.range.hi.toPrecision(5)}` : "Full X range"}</span>
                  {index > 0 && <span>Batch item</span>}
                </div>
                {itemIssues.map((issue) => <p key={`${issue.severity}:${issue.message}`} className={`qzk-analysis-input-issue ${issue.severity}`}>{issue.message}</p>)}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
