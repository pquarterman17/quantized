// Curve Fit workshop -- "Rank all models" (GOTO #6, rank-all-models). Isolated
// sub-component (BumpsSection conventions) so the collision surface with
// parallel workshop edits stays tiny: CurveFitPanel owns the useModelScan
// hook (results survive the registry<->custom mode flip) and mounts
// <ModelScanSection state={...} onApply={...}/>. "Rank models" fits the default
// set (every plausible registry model PLUS every saved custom equation) or the
// ticked models of one category, ranks them by AICc, and shows k, reduced
// chi-square, adjusted R-square, AIC, AICc, BIC and whether the fit converged.
// The best converged model is marked; "Use this model" sends the selected row
// to the workshop's picker. Failed candidates stay visible with their error --
// a model that can't fit is itself a result.
//
// The scan runs through the job queue (P0.4 feedback/cancel audit tail):
// while busy, a progress bar + "Scanning i/n: name" message + Cancel button
// track it, the same shape as BumpsSection's DREAM job UI (the reference
// pattern this generalizes).

import { useState } from "react";

import { Button } from "../../primitives";
import { OutOfDateNote, WorkbenchMessage, WorkbenchProgress } from "../workbench/WorkbenchParts";
import type { ModelGroup } from "../../../lib/fitModelCatalog";
import ScanModelPicker from "./ScanModelPicker";
import ScanRankTable from "./ScanRankTable";
import { bestEntry, entryKey } from "./scanRank";
import type { ModelScanState } from "./useModelScan";

interface Props {
  state: ModelScanState;
  /** Apply a scanned model to the workshop; `kind` routes registry names vs
   *  saved custom equation models (picker-value building stays in the panel). */
  onApply: (kind: "registry" | "equation", name: string) => void;
  /** The model categories to choose from; omitted, only the default set is offered. */
  groups?: readonly ModelGroup[];
}

export default function ModelScanSection({ state, onApply, groups = [] }: Props) {
  const { hasDataset, scope, setScope, results, busy, progress, progressMessage, error, refusal, stale, scan, cancel, clear } =
    state;
  const [picked, setPicked] = useState<string | null>(null);
  const shown = results && !busy ? results : null;
  const best = shown ? bestEntry(shown) : null;
  const chosen = shown?.find((e) => entryKey(e) === (picked ?? (best ? entryKey(best) : null)));
  const usable = chosen != null && chosen.error === null && !stale;

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
      <label className="qzk-field-lbl">Rank all models</label>
      {groups.length > 0 && <ScanModelPicker groups={groups} scope={scope} onChange={setScope} disabled={busy} />}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Button
          size="sm"
          disabled={!hasDataset || busy}
          title="Fit the chosen models to this selection and rank them by AICc"
          onClick={() => {
            setPicked(null);
            void scan();
          }}
        >
          {busy ? "Ranking…" : "Rank models"}
        </Button>
        {busy && (
          <Button size="sm" onClick={() => void cancel()}>
            Cancel
          </Button>
        )}
        {results && !busy && (
          <Button size="sm" onClick={clear}>
            Clear
          </Button>
        )}
      </div>

      {busy && (
        <WorkbenchProgress
          label="Scan progress"
          progress={{ fraction: progress, message: progressMessage ?? "ranking models…" }}
        />
      )}

      <WorkbenchMessage refusal={refusal ? error : null} error={refusal ? null : error} />

      {shown && (
        <div style={{ marginTop: 8, maxHeight: 280, overflowY: "auto" }}>
          {stale && <OutOfDateNote block>the data, channels or saved equations changed after this ranking. Rank again before using a model.</OutOfDateNote>}
          <ScanRankTable results={shown} selected={picked} onSelect={setPicked} stale={stale} />
          <div style={{ marginTop: 6 }}>
            <Button
              size="sm"
              disabled={!usable}
              title="Open Curve Fit with the selected model"
              onClick={() => chosen && onApply(chosen.kind, chosen.name)}
            >
              Use this model
            </Button>
          </div>
          <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
            Click a column to sort. ΔAICc = AICc − best; the best is the lowest-AICc fit that converged.
          </div>
        </div>
      )}
    </div>
  );
}
