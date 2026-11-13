// Curve Fit — "Output to worksheet" section (lazy chunk; Origin NLFit's
// output options). Writes the fit back on request, never automatically:
//   * Fitted Y / Residual as LINKED formula columns in the source worksheet
//     (they follow every re-fit; each add is undoable), for a model with a
//     formula form;
//   * or a RESULT worksheet beside the source with X, Y, fitted, residual and
//     the optional confidence/prediction limits, provenance in its metadata.
// fitOutputData.ts holds the builders and says why bands are values only.

import { useState } from "react";

import { fitBands } from "../../../lib/api/fitStats";
import type { CalcResult, Dataset } from "../../../lib/types";
import { addWorksheetQuietly } from "../../../store/addWorksheetQuietly";
import { addDerivedColumn } from "../../../store/derivedColumnRun";
import { nextDatasetId } from "../../../store/idSeq";
import { useApp } from "../../../store/useApp";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { BAND_LEVELS, bandFitStats, levelLabel } from "./fitBandData";
import { canLinkModel, linkedColumns, resultSheetData } from "./fitOutputData";
import type { FittedData } from "../../../store/curveFitSession";

interface Props {
  dataset: Dataset;
  model: string;
  paramNames: readonly string[];
  result: CalcResult;
  fitData: FittedData;
}

type Destination = "source" | "sheet";

export default function FitOutputSection({ dataset, model, paramNames, result, fitData }: Props) {
  const setStatus = useApp((s) => s.setStatus);
  const withHistoryBatch = useApp((s) => s.withHistoryBatch);
  const linkable = canLinkModel(model) && dataset.fitSpec?.model === model;
  const [dest, setDest] = useState<Destination>(linkable ? "source" : "sheet");
  const [fitted, setFitted] = useState(true);
  const [residual, setResidual] = useState(true);
  const [ci, setCi] = useState(false);
  const [pi, setPi] = useState(false);
  const [level, setLevel] = useState(0.95);
  const [busy, setBusy] = useState(false);
  const toSource = dest === "source" && linkable;
  const nothing = toSource ? !fitted && !residual : !fitted && !residual && !ci && !pi;

  const write = async () => {
    setBusy(true);
    try {
      if (toSource) {
        const cols = linkedColumns(dataset, model, fitData.xKey, fitData.yKey, { fitted, residual });
        // ONE undo step for both columns: the status promises "Undo removes".
        await withHistoryBatch("add fit columns", async (token) => {
          for (const c of cols) {
            const r = await addDerivedColumn(dataset.id, { name: c.name, expr: c.expr, propagate: false }, token);
            if (!r.ok) throw new Error(r.error);
          }
        });
        setStatus(`added ${cols.map((c) => `"${c.name}"`).join(" and ")} to ${dataset.name} (linked to the fit; Undo removes)`);
        return;
      }
      const band = ci || pi
        ? await fitBands({
          model,
          params: (result.params as number[] | undefined) ?? [],
          covar: (result.covar as number[][] | null | undefined) ?? null,
          x: fitData.x,
          ...bandFitStats(result, fitData.x),
          level,
        })
        : null;
      const data = resultSheetData({ source: dataset, model, paramNames, result, fitData, band, want: { fitted, residual, ci, pi } });
      const name = `${dataset.name} — ${model} fit results`;
      // Beside the source, without leaving it: the plot, the curve and this
      // panel stay on the fitted worksheet (store/addWorksheetQuietly.ts).
      addWorksheetQuietly(
        {
          id: nextDatasetId(),
          name,
          data,
          ...(dataset.workbookId ? { workbookId: dataset.workbookId } : {}),
          ...(dataset.folderId ? { folderId: dataset.folderId } : {}),
        },
        "add fit results worksheet",
      );
      setStatus(`added the worksheet "${name}" to the Library (Undo removes)`);
    } catch (e) {
      setStatus(`could not write the fit results — ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details style={{ marginTop: 10 }}>
      <summary className="qzk-field-lbl">Output to worksheet</summary>
      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
        <Select
          aria-label="Fit output destination"
          options={[
            ...(linkable ? [{ value: "source", label: `Linked columns in ${dataset.name}` }] : []),
            { value: "sheet", label: "New result worksheet" },
          ]}
          value={toSource ? "source" : "sheet"}
          onChange={(e) => setDest(e.target.value as Destination)}
        />
        {!linkable && (
          <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
            {canLinkModel(model)
              ? "Linked columns need this fit saved on the worksheet — run Fit first."
              : `${model} has no worksheet formula, so its results go to a result worksheet.`}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Checkbox checked={fitted} onChange={setFitted} title="The fitted value at each X">Fitted Y</Checkbox>
          <Checkbox checked={residual} onChange={setResidual} title="Y minus the fitted value">Residual</Checkbox>
          <Checkbox checked={ci && !toSource} disabled={toSource} onChange={setCi} title="Confidence limits (result worksheet only)">
            Confidence band
          </Checkbox>
          <Checkbox checked={pi && !toSource} disabled={toSource} onChange={setPi} title="Prediction limits (result worksheet only)">
            Prediction band
          </Checkbox>
        </div>
        {!toSource && (ci || pi) && (
          <Select
            aria-label="Output band level"
            options={BAND_LEVELS.map((l) => ({ value: String(l), label: levelLabel(l) }))}
            value={String(level)}
            onChange={(e) => setLevel(Number(e.target.value))}
          />
        )}
        <div>
          <Button size="sm" disabled={busy || nothing} onClick={() => void write()}>
            {busy ? "Writing…" : "Write to worksheet"}
          </Button>
        </div>
      </div>
    </details>
  );
}
