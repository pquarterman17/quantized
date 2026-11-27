// One row of the Named Ranges manager: the range's name, scope, worksheet, columns, rows and the reason it is stale (when
// it is), with the actions on it. A stale or broken range says why in the Status cell and its Retarget button is the
// way out: choosing the block again IS keeping it.

import { useState } from "react";

import { describeNamedRange, namedRangeIssue, type NamedRange } from "../../../lib/namedRanges";
import type { Dataset } from "../../../lib/types";
import { retargetNamedRange } from "../../../store/namedRanges";
import { goToNamedRange } from "../../../store/namedRangeGoTo";
import { deleteNamedRangeFlow } from "../../../store/namedRangeDelete";
import { analyzeNamedRange, plotNamedRange } from "../../../store/namedRangeUse";
import type { SelectedBlock } from "./nameBoxModel";
import { RenameEditor, RetargetEditor } from "./RangeEditors";

interface Props {
  range: NamedRange;
  datasets: readonly Dataset[];
  workbookName: (id: string) => string;
  usedBy: number;
  /** The worksheet block selected where the manager was opened, if any: "Use selection" retargets to it. */
  selection?: { datasetId: string; block: SelectedBlock };
}

export default function NamedRangeRow({ range, datasets, workbookName, usedBy, selection }: Props) {
  const [editor, setEditor] = useState<"rename" | "retarget" | null>(null);
  const issue = namedRangeIssue(range, datasets);
  const scope = range.scope.kind === "sheet" ? "This sheet" : `Workbook ${workbookName(range.scope.workbookId)}`;
  const sheets = range.scope.kind === "workbook" ? datasets.filter((d) => d.workbookId === (range.scope as { workbookId: string }).workbookId) : datasets.filter((d) => d.id === range.target.datasetId);
  const done = () => setEditor(null);
  const usable = selection && selection.datasetId === range.target.datasetId || (selection && range.scope.kind === "workbook" && sheets.some((d) => d.id === selection.datasetId));
  return (
    <>
      <tr>
        <td><strong>{range.name}</strong></td>
        <td>{scope}</td>
        <td>{describeNamedRange(range, datasets)}</td>
        <td className={issue ? "qzk-nr-warn" : undefined}>{issue ? (range.rowsStale ? "Stale: " : "Broken: ") + issue.replace(`named range ${range.name}: `, "") : "OK"}</td>
        <td>{usedBy}</td>
        <td>
          <div className="qzk-nr-actions">
            <button className="qz-btn" onClick={() => goToNamedRange(range)} disabled={issue !== null} title={issue ?? "Open the worksheet with this range selected"}>Go to</button>
            <button className="qz-btn" onClick={() => plotNamedRange(range.id)} disabled={issue !== null} title={issue ?? "Plot its columns and draw only its rows"}>Plot</button>
            <button className="qz-btn" onClick={() => analyzeNamedRange(range.id)} disabled={issue !== null} title={issue ?? "Open the Analysis Center on its columns and rows"}>Analyze</button>
            <button className="qz-btn" onClick={() => setEditor("rename")}>Rename</button>
            <button className="qz-btn" onClick={() => setEditor("retarget")} title={issue ? "Choose the block again to fix this range" : "Point this name at another block"}>Retarget…</button>
            {usable && selection && (
              <button
                className="qz-btn"
                title="Point this name at the cells selected in the worksheet"
                onClick={() => retargetNamedRange(range.id, { datasetId: selection.datasetId, cols: selection.block.cols, rows: selection.block.rows })}
              >
                Use selection
              </button>
            )}
            <button className="qz-btn" onClick={() => void deleteNamedRangeFlow(range.id)}>Delete</button>
          </div>
        </td>
      </tr>
      {editor && (
        <tr>
          <td colSpan={6}>
            {editor === "rename" ? <RenameEditor range={range} onDone={done} /> : <RetargetEditor range={range} sheets={sheets} onDone={done} />}
          </td>
        </tr>
      )}
    </>
  );
}
