// The scope note plus the "By" block under the Signal Processing preview. One
// component so the panel (at its line ceiling) mounts a single element.

import { useCallback } from "react";

import { applyCorrections } from "../../../lib/api";
import { runSpectralWorkbench } from "../../../lib/api/spectralWorkbench";
import type { CorrectionParams, Dataset, DataStruct } from "../../../lib/types";
import type { ByLevel } from "../useByPartition";
import ByLevelRunSection from "../byrun/ByLevelRunSection";
import type { ByCell } from "../byrun/useByLevelRun";
import { usePlottedPair } from "../byrun/usePlottedPair";
import SignalScopeNote from "./SignalScopeNote";
import type { buildSpectralRecipe } from "./spectralSettings";

type SpectralRecipe = ReturnType<typeof buildSpectralRecipe>;

interface Props {
  source: Dataset;
  secondary: Dataset | null;
  /** Correction-operation request (null for a spectral operation). */
  params: CorrectionParams | null;
  /** The spectral recipe when the operation is spectral. */
  spectralRecipe: SpectralRecipe | null;
  /** Why By cannot run (invalid setup, filter without a recipe, two-sheet correlation). */
  blockedReason: string | null;
  /** Identity of everything the per-level result depends on. */
  settingsKey: string;
}

/** Rows out, finite outputs and the first output column's mean. */
export function signalLevelSummary(out: DataStruct): ByCell[] {
  let sum = 0;
  let finite = 0;
  for (const row of out.values) {
    const v = row[0];
    if (v !== undefined && Number.isFinite(v)) {
      sum += v;
      finite++;
    }
  }
  if (finite === 0) throw new Error("no finite output was produced");
  return [out.values.length, finite, sum / finite];
}

export default function SignalScopeAndBy({ source, secondary, params, spectralRecipe, blockedReason, settingsKey }: Props) {
  const { active, data, columns } = usePlottedPair();
  const run = useCallback(async (level: ByLevel, signal: AbortSignal): Promise<ByCell[]> => {
    if (spectralRecipe) return signalLevelSummary(await runSpectralWorkbench(level.data, spectralRecipe, signal, true));
    if (!params) throw new Error("set up the operation first");
    const out = await applyCorrections({ dataset: level.data, params, ...(source.errorRoles ? { error_bindings: source.errorRoles } : {}) }, signal);
    return signalLevelSummary(out);
  }, [spectralRecipe, params, source.errorRoles]);
  return (
    <>
      <SignalScopeNote source={source} secondary={secondary} />
      <ByLevelRunSection
        tool="Signal processing"
        active={active}
        data={data}
        columns={columns}
        headers={["Rows out", "Finite outputs", "Mean (first output)"]}
        run={run}
        runKey={settingsKey}
        blockedReason={blockedReason}
      />
    </>
  );
}
