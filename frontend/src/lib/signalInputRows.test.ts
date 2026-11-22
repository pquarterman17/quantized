// The signal recipe's row choice (`inputRows`): absent = every worksheet row
// (default, so old recipes replay unchanged); "analysis-view" drops excluded and
// filtered rows in every compute path.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { correctionMock, spectralMock } = vi.hoisted(() => ({ correctionMock: vi.fn(), spectralMock: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api")>()), applyCorrections: correctionMock }));
vi.mock("./api/spectralWorkbench", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/spectralWorkbench")>()), runSpectralWorkbench: spectralMock,
}));

import { sanitizeSignalAnalysisRecipe, signalRecipeInputData, type SignalCorrectionRecipe } from "./signalRecipe";
import { computeSignalTransform } from "./signalTransform";
import { DEFAULT_SPECTRAL_RECIPE } from "./spectralWorkbench";
import type { Dataset } from "./types";

const SHEET: Dataset = {
  id: "s", name: "scan",
  data: { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["v"], units: ["V"], metadata: {} },
  excludedRows: [1],
};
const base: SignalCorrectionRecipe = {
  kind: "signal-correction", version: 1, xUnit: "", operation: "Smooth",
  channels: [{ index: 0, label: "v", unit: "V" }],
  params: { signalChannels: [0], smoothEnabled: true, smoothMethod: "moving", smoothWindow: 2 },
};

beforeEach(() => {
  vi.clearAllMocks();
  correctionMock.mockResolvedValue(SHEET.data);
  spectralMock.mockResolvedValue(SHEET.data);
});

describe("signal recipe input rows", () => {
  it("defaults to the full worksheet and picks the analysis view only when asked", () => {
    expect(signalRecipeInputData(base, SHEET)).toBe(SHEET.data);
    expect(signalRecipeInputData({ inputRows: "analysis-view" }, SHEET).time).toEqual([1, 3]);
  });

  it("is kept by the sanitizer only as the non-default value", () => {
    expect(sanitizeSignalAnalysisRecipe({ ...base, inputRows: "analysis-view" })).toMatchObject({ inputRows: "analysis-view" });
    expect(sanitizeSignalAnalysisRecipe({ ...base, inputRows: "everything" })).not.toHaveProperty("inputRows");
    const spectral = { ...DEFAULT_SPECTRAL_RECIPE, channels: [{ index: 0, label: "v" }] };
    expect(sanitizeSignalAnalysisRecipe({ ...spectral, inputRows: "analysis-view" })).toMatchObject({ inputRows: "analysis-view" });
    expect(sanitizeSignalAnalysisRecipe(spectral)).not.toHaveProperty("inputRows");
  });

  it("replay uses the full worksheet by default and the analysis view when recorded", async () => {
    await computeSignalTransform({ op: "signal", recipe: base }, SHEET);
    expect(correctionMock.mock.calls[0][0].dataset.time).toEqual([1, 2, 3]);
    const out = await computeSignalTransform({ op: "signal", recipe: { ...base, inputRows: "analysis-view" } }, SHEET);
    expect(correctionMock.mock.calls[1][0].dataset.time).toEqual([1, 3]);
    expect(out.datasetPatch.raw).toBe(SHEET.data); // the record of the source stays complete
    expect(out.datasetPatch.analysisRecipe).toMatchObject({ inputRows: "analysis-view" });
  });

  it("spectral replay honours it too", async () => {
    const spectral = { ...DEFAULT_SPECTRAL_RECIPE, channels: [{ index: 0, label: "v", unit: "V" }], xUnit: "" };
    await computeSignalTransform({ op: "signal", recipe: { ...spectral, inputRows: "analysis-view" } }, SHEET);
    expect(spectralMock.mock.calls[0][0].time).toEqual([1, 3]);
  });
});
