// Loaders for every preset adapter (the adapters themselves are lazy chunks).
// The Recipe Library, the preset file and "Open in tool" need an adapter's
// schema, migration and strict parser WITHOUT its panel mounted, so each
// adapter is built over a handle that throws if anything touches the panel:
// `parse`, `describe`, `migrate`, `schema` and `backend` never do. The data row
// for each tool is lib/presetWorkshops.ts; presetRegistry.test.ts pins the two
// together and fails when a new presetAdapter.ts is not registered in both.

import type { AnyPresetAdapter } from "../../../lib/presetFile";

const noPanel = new Proxy({}, { get: (_t, key) => { throw new Error(`a preset adapter used the panel (${String(key)}) outside its tool`); } }) as never;
const make = (create: (panel: never) => unknown): AnyPresetAdapter => create(noPanel) as AnyPresetAdapter;

export const PRESET_ADAPTER_LOADERS: Readonly<Record<string, () => Promise<AnyPresetAdapter>>> = {
  baseline: async () => make((await import("../baseline/presetAdapter")).createBaselineAdapter),
  curvefit: async () => make((await import("../curvefit/presetAdapter")).createCurveFitAdapter),
  distribution: async () => make((await import("../distribution/presetAdapter")).createDistributionAdapter),
  doe: async () => make((await import("../doe/presetAdapter")).createDoeAdapter),
  "fft-thickness": async () => make((await import("../reductions/fftThicknessPresetAdapter")).createFftThicknessAdapter),
  hysteresis: async () => make((await import("../hysteresis/presetAdapter")).createHysteresisAdapter),
  "map-ops": async () => make((await import("../mapops/presetAdapter")).createMapOpsAdapter),
  multivar: async () => make((await import("../multivar/presetAdapter")).createMultivarAdapter),
  "outlier-screening": async () => make((await import("../outliers/presetAdapter")).createOutlierAdapter),
  peaks: async () => make((await import("../peaks/presetAdapter")).createPeaksAdapter),
  resample: async () => make((await import("../resample/presetAdapter")).createResampleAdapter),
  "signal-processing": async () => make((await import("../signalprocessing/presetAdapter")).createSignalAdapter),
  sims: async () => make((await import("../sims/presetAdapter")).createSimsAdapter),
  "stats-tests": async () => make((await import("../statstests/presetAdapter")).createStatsTestsAdapter),
  tabulate: async () => make((await import("../tabulate/presetAdapter")).createTabulateAdapter),
  "time-series": async () => make((await import("../timeseries/presetAdapter")).createTimeSeriesAdapter),
  variability: async () => make((await import("../variability/presetAdapter")).createVariabilityAdapter),
};

/** The adapters for `workshops` (every tool when omitted); an unknown id is simply absent from the map. */
export async function loadPresetAdapters(workshops?: readonly string[]): Promise<Map<string, AnyPresetAdapter>> {
  const ids = (workshops ?? Object.keys(PRESET_ADAPTER_LOADERS)).filter((id) => id in PRESET_ADAPTER_LOADERS);
  const out = new Map<string, AnyPresetAdapter>();
  for (const [id, adapter] of await Promise.all(ids.map(async (id) => [id, await PRESET_ADAPTER_LOADERS[id]()] as const))) out.set(id, adapter);
  return out;
}
