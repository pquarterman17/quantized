import { fitYByXAnalysisResult, type FitYByXRecipe, type FitYByXSnapshot } from "../lib/fitYByXAnalysisResult";
import { fitYByXQuestion } from "../lib/snapshotResultKey";
import type { Dataset } from "../lib/types";
import { publishSnapshotResult } from "./snapshotResultSave";

export function publishFitYByXResult(source: Dataset, recipe: FitYByXRecipe, snapshot: FitYByXSnapshot): string | null {
  return publishSnapshotResult({
    producerId: "fit-y-by-x", noun: "Fit Y by X result", source, question: fitYByXQuestion(recipe, snapshot.mode),
    changedMessage: "the Fit Y by X source changed or its full worksheet is not loaded; wait for the current analysis before saving",
    build: (id, live) => fitYByXAnalysisResult(id, live, recipe, snapshot),
  });
}
