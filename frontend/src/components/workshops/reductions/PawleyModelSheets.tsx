// "Create model worksheets" under a finished Pawley batch: for the chosen rows,
// one observed / model / background / residual worksheet each (the single run's
// "→ Library" output, pawleyModelOutput.ts), all in ONE undo step. Each goes
// through the shared result-commit contract: a repeat adds nothing, the output
// is stamped with its source's fingerprint and goes out of date when that
// sheet changes, and it is linked to its source. A row that cannot be written
// is listed with its reason; nothing is skipped silently.

import { useState, type MutableRefObject } from "react";

import { commitBatchOutputs } from "../../../store/commitBatchOutputs";
import { Button } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import type { AnalysisBatchRow } from "../analysisselection/AnalysisBatchControls";
import { PAWLEY_PRODUCER, pawleyCommitSettings, pawleyModelOutput } from "./pawleyModelOutput";
import type { PawleyBatchModel } from "./reductionBatchItems";

export default function PawleyModelSheets({ rows, models }: {
  rows: readonly AnalysisBatchRow[];
  models: MutableRefObject<Map<string, PawleyBatchModel>>;
}) {
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [report, setReport] = useState<string[]>([]);
  const offered = rows.filter((row) => row.status === "completed" && models.current.has(row.datasetId));
  const chosen = offered.filter((row) => !unchecked.has(row.datasetId));
  const toggle = (id: string) => setUnchecked((s) => {
    const next = new Set(s);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const create = () => {
    const lines: string[] = [];
    const items = chosen.flatMap((row) => {
      const model = models.current.get(row.datasetId);
      if (!model) { lines.push(`${row.name}: no refinement is kept for this row; run the batch again.`); return []; }
      return [{
        name: row.name,
        request: {
          producer: PAWLEY_PRODUCER,
          sourceId: row.datasetId,
          computedOn: model.computedOn,
          settings: pawleyCommitSettings(model.input, model.result),
          xKey: null, // 2θ is the worksheet's own X (the fit reads d.time)
          output: () => pawleyModelOutput(model.input, model.result),
          status: `added the Pawley model worksheet for ${row.name}`,
        },
      }];
    });
    const done = commitBatchOutputs("Pawley model worksheets", items);
    setReport([
      `Pawley model worksheets: ${done.created} added, ${done.existing} already added${lines.length + done.refused.length ? `, ${lines.length + done.refused.length} not written` : ""}.`,
      ...lines, ...done.refused,
    ]);
  };

  return <div aria-label="Pawley model worksheets" style={{ marginTop: 8 }}>
    <div className="qzk-field-lbl" style={{ marginTop: 0 }}>Model worksheets (observed, model, background, residual)</div>
    {rows.map((row) => {
      const can = offered.includes(row);
      return <Checkbox key={row.datasetId} checked={can && !unchecked.has(row.datasetId)} disabled={!can} onChange={() => toggle(row.datasetId)}>
        {row.name}{can ? "" : ` (${row.status === "completed" ? "no refinement kept; run again" : (row.warning ?? row.status)})`}
      </Checkbox>;
    })}
    <Button size="sm" disabled={chosen.length === 0} onClick={create}>
      Create model worksheets ({chosen.length})
    </Button>
    {report.length > 0 && <ul className="qzk-ds-meta" role="status" aria-label="model worksheet report" style={{ margin: "6px 0 0", paddingLeft: 16 }}>
      {report.map((line, i) => <li key={i}>{line}</li>)}
    </ul>}
  </div>;
}
