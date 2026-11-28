// Standard curve (item 12) -- state hook for StandardCurveSection. The standards
// are the plotted X / primary-Y over the dataset's ANALYSIS rows (the same bridge
// every Curve Fit path uses, lib/fitselection); the unknown responses are typed.
// One POST /api/fitting/standard-curve; the result is stamped with the key it was
// launched with, so a changed selection marks it out of date (workbench/useRunStamp).

import { useState } from "react";

import { dropGapRows } from "../../../lib/api/finitePairs";
import { fitStandardCurve, type StandardCurveModel, type StandardCurveResult } from "../../../lib/api/standardCurve";
import { fitSelectionRefusal, selectedFitData } from "../../../lib/fitselection";
import { useLatestRef } from "../../../lib/previewKey";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { datasetInputsToken } from "../workbench/inputsKey";
import { Refusal, failureOf, type Failure } from "../workbench/refusal";
import { useRunStamp } from "../workbench/useRunStamp";
import { parseResponses } from "./standardCurveTable";

export interface StandardCurveState {
  hasDataset: boolean;
  model: StandardCurveModel;
  setModel: (m: StandardCurveModel) => void;
  responses: string;
  setResponses: (t: string) => void;
  replicates: number;
  setReplicates: (n: number) => void;
  result: StandardCurveResult | null;
  busy: boolean;
  failure: Failure | null;
  /** `result` was fitted to standards or settings that have since changed. */
  stale: boolean;
  run: () => Promise<void>;
  clear: () => void;
}

export function useStandardCurve(): StandardCurveState {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const resolveDataset = useApp((s) => s.resolveDataset);
  // The plotted channels as of NOW, read after the dataset resolves (they may move meanwhile).
  const plotted = useLatestRef({ xKey, yKeys, seriesOrder });
  const [model, setModel] = useState<StandardCurveModel>("linear");
  const [responses, setResponses] = useState("");
  const [replicates, setReplicates] = useState(1);
  const [result, setResult] = useState<StandardCurveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const stamp = useRunStamp(
    active ? JSON.stringify([datasetInputsToken(active), xKey, yKeys, seriesOrder, model, responses, replicates]) : "",
  );

  async function run(): Promise<void> {
    if (!active || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const parsed = parseResponses(responses);
      if ("bad" in parsed) throw new Refusal(`"${parsed.bad}" is not a number; type the unknown responses separated by spaces, commas or new lines`);
      if (parsed.values.length === 0) throw new Refusal("type at least one unknown response to read off the curve");
      const ds = await resolveDataset(active.id);
      if (!ds) return;
      const launchKey = stamp.launchKey();
      const st = plotted.current;
      const d = selectedFitData(ds, st.xKey, st.yKeys, st.seriesOrder);
      if (!d) {
        const why = fitSelectionRefusal(ds, st.xKey, st.yKeys, st.seriesOrder);
        throw new Refusal(why ?? "no standards are selected");
      }
      const pairs = dropGapRows(d.x, d.y);
      if (pairs.x.length === 0) throw new Refusal("no finite X/Y pairs are available as standards");
      const r = await fitStandardCurve({
        x: pairs.x, y: pairs.y, unknowns: parsed.values, model, replicates, confidence: 0.95,
      });
      stamp.record(launchKey);
      setResult(r);
    } catch (e) {
      setFailure(failureOf(e, "standard curve failed"));
    } finally {
      setBusy(false);
    }
  }

  const clear = () => {
    setResult(null);
    setFailure(null);
    stamp.record(null);
  };

  return {
    hasDataset: active != null, model, setModel, responses, setResponses, replicates, setReplicates,
    result, busy, failure, stale: stamp.stale, run, clear,
  };
}
