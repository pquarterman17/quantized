// Fit Model workshop (GAP_AUDIT_9 G1): state hook. Picks a response, builds
// the model (lib/fitModel), and fits it on the active worksheet's ANALYSIS
// VIEW (lib/analysisInputs via useAnalysisInputs: excluded rows and the local
// data filter drop first, a lazy Origin preview is refused), the same row
// contract as Distribution / Fit Y by X / Variability.
//
// The fit reruns whenever the request body changes (a fit is one QR solve on
// the server). The result is stamped with the body it was computed for and
// shown only while that body is still the current one, so a model edit, a
// row exclusion or a data edit never leaves the previous model's numbers on
// screen beside the new picks.

import { useCallback, useEffect, useMemo, useState } from "react";

import { statsFitModel, type FitModelResponse } from "../../../lib/api/statsModel";
import type { AnalysisInputs } from "../../../lib/analysisInputs";
import { ROW_POLICY } from "../../../lib/analysisInputs";
import { buildFitModelBody, modelColumns, modelProblem, termLabel, type FitModelRecipe } from "../../../lib/fitModel";
import { channelModelingType, isCategorical } from "../../../lib/modeling";
import { useActiveDataset } from "../../../store/useApp";
import { useAnalysisInputs } from "../analysisselection/useAnalysisInputs";
import type { ToolResultBook } from "../resultbook/useToolResultBook";
import { useFollowColumnPicks } from "../useFollowColumnPicks";
import { useFitModelResultBridge } from "./useFitModelResultBridge";

export interface FitModelColumn {
  index: number;
  label: string;
  kind: "continuous" | "nominal";
}

export interface FitModelState {
  hasData: boolean;
  inputs: AnalysisInputs;
  columns: FitModelColumn[];
  responseCol: number;
  setResponseCol: (col: number) => void;
  terms: number[][];
  setTerms: (terms: number[][]) => void;
  center: boolean;
  setCenter: (center: boolean) => void;
  labelOf: (col: number) => string;
  kindOf: (col: number) => "continuous" | "nominal";
  termLabels: string[];
  recipe: FitModelRecipe;
  /** Why the model cannot be fitted yet (client-side check), or null. */
  problem: string | null;
  busy: boolean;
  /** The server's refusal (rank deficiency, < 2 levels, < 1 error df), or a transport error. */
  error: string | null;
  fit: FitModelResponse | null;
  /** Original worksheet row behind each fitted request row. */
  rowIds: number[];
  canSaveResult: boolean;
  saveResultDisabledReason: string | null;
  saveResult: () => string | null;
  book: ToolResultBook;
}

type Active = ReturnType<typeof useActiveDataset>;

function defaultResponse(active: Active): number {
  if (!active) return 0;
  for (let i = 0; i < active.data.labels.length; i++) {
    if (!isCategorical(channelModelingType(active, i))) return i;
  }
  return 0;
}

export function useFitModel(): FitModelState {
  const active = useActiveDataset();
  const xName = String(active?.data.metadata?.["x_column_name"] ?? "x");
  const columns = useMemo<FitModelColumn[]>(() => {
    if (!active) return [];
    return [
      { index: -1, label: xName, kind: "continuous" as const },
      ...active.data.labels.map((label, index) => ({
        index, label, kind: isCategorical(channelModelingType(active, index)) ? "nominal" as const : "continuous" as const,
      })),
    ];
  }, [active, xName]);

  const [responseCol, setResponseCol] = useState(() => defaultResponse(active));
  const [terms, setTerms] = useState<number[][]>([]);
  const [center, setCenter] = useState(true);
  // A reopened result keeps the kinds it was fitted with.
  const [kindOverrides, setKindOverrides] = useState<Record<string, "continuous" | "nominal">>({});

  useEffect(() => {
    setResponseCol(defaultResponse(active));
    setTerms([]);
    setKindOverrides({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new dataset's columns are unrelated
  }, [active?.id]);
  useFollowColumnPicks(active, (follow) => {
    const r = follow(responseCol);
    if (r !== responseCol) setResponseCol(r ?? defaultResponse(active));
    const next = terms.flatMap((t) => {
      const moved = t.map(follow);
      return moved.every((c): c is number => c !== null) ? [moved] : [];
    });
    if (JSON.stringify(next) !== JSON.stringify(terms)) setTerms(next);
    setKindOverrides({});
  });

  const labelOf = useCallback(
    (col: number) => columns.find((c) => c.index === col)?.label ?? (col < 0 ? xName : `col ${col}`),
    [columns, xName],
  );
  const kindOf = useCallback(
    (col: number) => kindOverrides[String(col)] ?? columns.find((c) => c.index === col)?.kind ?? "continuous",
    [columns, kindOverrides],
  );
  const recipe = useMemo<FitModelRecipe>(() => {
    const kinds: Record<string, "continuous" | "nominal"> = {};
    for (const c of modelColumns(terms)) kinds[String(c)] = kindOf(c);
    return { responseCol, terms, kinds, center };
  }, [center, kindOf, responseCol, terms]);
  const termLabels = useMemo(() => terms.map((t) => termLabel(t, labelOf)), [labelOf, terms]);

  const used = modelColumns(terms);
  const inputs = useAnalysisInputs({ noX: true, yKeys: [responseCol, ...used], policy: ROW_POLICY.analysisView });
  const data = inputs.ok ? inputs.data : null;
  const rowIds = useMemo(() => (inputs.ok ? [...inputs.rowIds] : []), [inputs]);
  const problem = active ? modelProblem(recipe, active.data.labels.length) : null;
  const body = useMemo(
    () => (data && !problem ? buildFitModelBody(data, recipe, labelOf) : null),
    [data, labelOf, problem, recipe],
  );

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ body: unknown; message: string } | null>(null);
  const [computed, setComputed] = useState<{ body: unknown; fit: FitModelResponse; rowIds: number[] } | null>(null);
  useEffect(() => {
    if (!body) return;
    const controller = new AbortController();
    setBusy(true);
    statsFitModel(body, controller.signal).then(
      (fit) => { if (!controller.signal.aborted) setComputed({ body, fit, rowIds }); },
      (e: unknown) => {
        if (!controller.signal.aborted) setFailure({ body, message: e instanceof Error ? e.message : "Fit Model failed" });
      },
    ).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [body, rowIds]);
  const current = computed && computed.body === body ? computed : null;
  const fit = current?.fit ?? null;
  const error = failure && failure.body === body ? failure.message : null;

  const bridge = useFitModelResultBridge({
    active, recipe, setResponseCol, setTerms, setCenter, setKindOverrides,
    responseLabel: labelOf(responseCol), termLabels, rowIds: current?.rowIds ?? [], fit, busy: busy || (!!body && !current && !error),
  });

  return {
    hasData: !!active, inputs, columns, responseCol, setResponseCol, terms, setTerms, center, setCenter,
    labelOf, kindOf, termLabels, recipe, problem, busy, error, fit, rowIds: current?.rowIds ?? [], ...bridge,
  };
}
