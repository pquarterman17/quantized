import { postJSON } from "./http";
import { spectralRequest, type SpectralAnalysisRecipe } from "../spectralWorkbench";
import type { DataStruct } from "../types";

/** Dataset-level FFT/filter/correlation. Kept lazy with its workbench. */
export function runSpectralWorkbench(
  dataset: DataStruct,
  recipe: SpectralAnalysisRecipe,
  signal?: AbortSignal,
  includeDiagnostics = false,
): Promise<DataStruct> {
  return postJSON(
    "/api/spectral/workbench",
    spectralRequest(dataset, recipe, includeDiagnostics),
    signal,
  );
}
