// Nested recipe fields of a saved `.dwk` (workspaceRecipeCompat.ts, plan item 7). The per-field gated cases
// (psdScaling, off-default Distribution CI) live in workspaceForwardCompat.test.ts's FEATURES table; this file pins
// the mechanism: every sanitizer key is classified, the defaults do not gate, and each container is reached.
import { describe, expect, it } from "vitest";

import dwk034 from "./__fixtures__/workspace/v4-0.34.0.dwk.json";
import { DEFAULT_CI_PERCENT } from "./distributionAnalysisResult";
import { sanitizeSignalAnalysisRecipe } from "./signalRecipe";
import { sanitizeSpectralRecipe } from "./spectralWorkbench";
import { makeStep } from "./pipelineStep";
import { featuresV034WouldDrop, parseWorkspace, serializeWorkspace, WORKSPACE_VERSION_POST_045, type LoadedWorkspace } from "./workspace";
import { NEW_SINCE_V045 } from "./workspaceRungSets";
import {
  CORRECTION_RECIPE, CORRECTION_RECIPE_PARAMS, DISTRIBUTION_RECIPE, IIR_SPEC, RECIPE_CLASSIFICATIONS, RECIPE_GATED_FEATURES,
  SIGNAL_CHANNEL, SPECTRAL_CHANNEL, SPECTRAL_RECIPE, SPECTRAL_SECONDARY, checkResultRecipe, checkSignalRecipe,
} from "./workspaceRecipeCompat";

const VIEWPORT = { width: 1600, height: 900 };
const load = (): LoadedWorkspace => parseWorkspace(JSON.stringify(dwk034), VIEWPORT);
const version = (text: string): number => (JSON.parse(text) as { version: number }).version;

const base = {
  kind: "spectral", version: 1, operation: "fft", channels: [{ index: 0, label: "R1", unit: "V" }], xUnit: "s", xMin: 0, xMax: 9,
  resample: false, outputType: "psd", sided: "one", window: "hanning", detrend: "mean", zeroPad: 0, segmentLen: 8, overlap: 0.5,
  filterType: "lowpass", cutoff: [1], order: 4, correlationDemean: true, inputRows: "analysis-view",
};
const keysOf = (o: unknown): string[] => Object.keys(o as object);
const sorted = (a: Iterable<string>): string[] => [...a].sort();

describe("classification maps agree with the sanitizers that read the recipes", () => {
  it("spectral recipe: every key the sanitizer keeps is classified, and every classified key is kept", () => {
    const iir = { family: "ellip", btype: "bandpass", order: 4, cutoff: [1, 2], rp: 1, rs: 40, zeroPhase: true };
    const bessel = { family: "bessel", btype: "lowpass", order: 4, cutoff: [1], besselNorm: "phase", zeroPhase: false };
    const second = { datasetId: "b", datasetName: "B", xUnit: "s", channel: { index: 1, label: "R2", unit: "V" } };
    const samples = [
      { ...base, psdScaling: "spectrum", bandwidth: 0.5 },
      { ...base, operation: "filter", outputType: "magnitude", iir },
      { ...base, operation: "filter", outputType: "magnitude", iir: bessel },
      { ...base, operation: "correlation", outputType: "magnitude", channels: [{ index: 0, label: "R1" }], secondarySource: second },
    ].map((s) => sanitizeSpectralRecipe(s)!);
    expect(samples.every(Boolean)).toBe(true);
    expect(sorted(new Set(samples.flatMap(keysOf)))).toEqual(sorted(keysOf(SPECTRAL_RECIPE)));
    const keys = (f: (s: (typeof samples)[number]) => unknown): string[] => sorted(new Set(samples.flatMap((s) => keysOf(f(s) ?? {}))));
    expect(keys((s) => s.channels[0])).toEqual(sorted(keysOf(SPECTRAL_CHANNEL)));
    expect(keys((s) => s.secondarySource)).toEqual(sorted(keysOf(SPECTRAL_SECONDARY)));
    expect(keys((s) => s.iir)).toEqual(sorted(keysOf(IIR_SPEC)));
  });

  it("correction recipe: every recipe key and every params key the sanitizer keeps is classified", () => {
    const rec = (operation: string, params: Record<string, unknown>) => ({
      kind: "signal-correction", version: 1, operation, channels: [{ index: 0, label: "R1", unit: "V" }], xUnit: "s",
      params: { signalChannels: [0], ...params }, inputRows: "analysis-view",
    });
    const samples = [
      rec("Smooth", { smoothEnabled: true, smoothWindow: 5, smoothMethod: "savgol", smoothPolyOrder: 2, xTrimMin: 0, xTrimMax: 1, dropYUncertainty: true }),
      rec("Normalize to reference", { normMethod: "Reference", normReferenceMin: 1, normReferenceMax: 2 }),
      rec("Normalize to reference", { normMethod: "Reference", normReferenceValue: 3 }),
      rec("Detrend", { detrendOrder: 2 }),
      rec("First derivative", { derivativeMode: "dY/dX" }),
      rec("Z-score", { normMethod: "Z-score" }),
    ].map((s) => sanitizeSignalAnalysisRecipe(s)!) as unknown as { channels: unknown[]; params: object }[];
    expect(samples.every(Boolean)).toBe(true);
    expect(sorted(new Set(samples.flatMap(keysOf)))).toEqual(sorted(keysOf(CORRECTION_RECIPE)));
    expect(sorted(new Set(samples.flatMap((s) => keysOf(s.channels[0]))))).toEqual(sorted(keysOf(SIGNAL_CHANNEL)));
    expect(sorted(new Set(samples.flatMap((s) => keysOf(s.params))))).toEqual(sorted(keysOf(CORRECTION_RECIPE_PARAMS)));
  });

  it("the gated list is exactly the `gated` entries, all in NEW_SINCE_V045 (the top rung), and the CI default is pinned", () => {
    const gated = Object.entries(RECIPE_CLASSIFICATIONS).flatMap(([t, m]) => Object.keys(m).filter((k) => m[k] === "gated").map((k) => `${t}.${k}`));
    expect(sorted(RECIPE_GATED_FEATURES)).toEqual(sorted(gated));
    expect(sorted(gated)).toEqual(["DistributionRecipe.ciBootstrap", "DistributionRecipe.ciPercent", "SpectralRecipe.psdScaling"]);
    for (const f of gated) expect(NEW_SINCE_V045.has(f)).toBe(true);
    expect(DEFAULT_CI_PERCENT).toBe(95); // RECIPE_DEFAULTS inlines it (the module stays a leaf)
    expect(DISTRIBUTION_RECIPE.ciPercent).toBe("gated");
  });
});

describe("psdScaling and off-default Distribution settings raise the version; plain recipes keep it", () => {
  const withRecipe = (recipe: unknown): LoadedWorkspace => {
    const ws = load();
    const d = ws.datasets.find((x) => x.id === "c")!;
    Object.assign(d, { derivedFrom: { datasetId: "a", pipeline: "signal" }, analysisRecipe: sanitizeSpectralRecipe(recipe) });
    return ws;
  };

  it("a saved dataset recipe with psdScaling is v9; without it the file keeps its rung", () => {
    const plain = serializeWorkspace(withRecipe(base));
    expect(version(plain)).toBe(4);
    expect(featuresV034WouldDrop(JSON.parse(plain))).toEqual([]);
    const text = serializeWorkspace(withRecipe({ ...base, psdScaling: "spectrum" }));
    expect(version(text)).toBe(WORKSPACE_VERSION_POST_045);
    expect(featuresV034WouldDrop(JSON.parse(text))).toEqual(["SpectralRecipe.psdScaling"]);
    // This build keeps it on a round trip.
    const back = parseWorkspace(text, VIEWPORT);
    expect((back.datasets.find((x) => x.id === "c")!.analysisRecipe as { psdScaling?: string }).psdScaling).toBe("spectrum");
  });

  it("the real save path of a Pipeline step holding the recipe is found too (pipeline[].params.recipe)", () => {
    const step = (recipe: unknown) => makeStep("transform", "Signal", "", { op: "signal", recipe });
    const plain = load();
    plain.macroSteps = [step(base)];
    expect(version(serializeWorkspace(plain))).toBeLessThan(WORKSPACE_VERSION_POST_045);
    const ws = load();
    ws.macroSteps = [step({ ...base, psdScaling: "spectrum" })];
    const text = serializeWorkspace(ws);
    expect(version(text)).toBe(WORKSPACE_VERSION_POST_045);
    expect(featuresV034WouldDrop(JSON.parse(text))).toEqual(["SpectralRecipe.psdScaling"]);
  });

  it("a saved transformation recipe (analysisTemplates[].steps[].params.recipe) is found", () => {
    const doc = { analysisTemplates: [{ version: 1, name: "t", outputs: [], steps: [{ kind: "transform", label: "s", code: "", enabled: true, params: { op: "signal", recipe: { ...base, psdScaling: "spectrum" } } }] }] };
    expect(featuresV034WouldDrop(doc)).toEqual(["SpectralRecipe.psdScaling"]);
    expect(featuresV034WouldDrop({ analysisTemplates: [{ steps: [{ params: { recipe: base } }] }] })).toEqual([]);
  });

  it("a Distribution result gates only a CI setting OFF its default (95 %, no bootstrap = what v0.45.0 does)", () => {
    const found = (recipe: object, producer = "distribution-analysis"): string[] => {
      const f = new Set<string>();
      checkResultRecipe({ producer: { id: producer }, parameters: { recipe } }, f);
      return sorted(f);
    };
    const old = { col: 0, byCol: null, fitDist: "none", compareOpen: false, percentileInput: 50 };
    expect(found(old)).toEqual([]);
    expect(found({ ...old, ciPercent: 95, ciBootstrap: false })).toEqual([]);
    expect(found({ ...old, ciPercent: 99 })).toEqual(["DistributionRecipe.ciPercent"]);
    expect(found({ ...old, ciBootstrap: true })).toEqual(["DistributionRecipe.ciBootstrap"]);
    expect(found({ ...old, ciPercent: 99 }, "variability-analysis")).toEqual([]); // another tool's recipe is not this map's
  });

  it("an unrelated object that merely has a psdScaling key (a By-level batch's settings) is not a recipe", () => {
    const f = new Set<string>();
    checkSignalRecipe({ psdScaling: "spectrum", outputType: "psd" }, f);
    checkSignalRecipe({ kind: "spectral", psdScaling: "spectrum" }, f); // no operation / channels
    expect([...f]).toEqual([]);
    expect(featuresV034WouldDrop({ analysisResults: [{ parameters: { toolId: "signal-processing", spectral: { psdScaling: "spectrum" } } }] })).toEqual([]);
  });
});
