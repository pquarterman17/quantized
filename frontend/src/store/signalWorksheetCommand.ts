import type { SignalAnalysisRecipe } from "../lib/signalTransform";
import { signalAnalysisResult } from "../lib/analysisResult";
import { runTransform } from "../lib/transformRun";
import { nextAnalysisResultId } from "./idSeq";
import { registerAnalysisResult } from "./analysisResultActions";
import { useApp } from "./useApp";

/** Imperative bridge for the lazy Signal Processing workbench. The shared
 * transform runner makes this commit replayable in Pipeline Studio and in a
 * saved Recipe Library template, while still producing the established linked
 * worksheet shape. */
export async function createSignalWorksheetFromApp(
  sourceId: string,
  recipe: SignalAnalysisRecipe,
  signal?: AbortSignal,
): Promise<string | null> {
  const source = useApp.getState().datasets.find((dataset) => dataset.id === sourceId);
  if (!source || source.pending) {
    useApp.getState().setStatus(!source
      ? "Can't create a signal worksheet: source dataset not found."
      : "Can't create a signal worksheet: source data hasn't fully loaded yet.");
    return null;
  }
  try {
    const outcome = await runTransform(useApp.getState, { op: "signal", recipe }, sourceId, undefined, signal);
    if (!outcome) return null;
    const output = useApp.getState().datasets.find((dataset) => dataset.id === outcome.id);
    const result = output ? signalAnalysisResult(nextAnalysisResultId(), source, output) : null;
    if (result) registerAnalysisResult(result);
    return outcome.id;
  } catch (error) {
    if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
      useApp.getState().setStatus("signal processing cancelled — nothing was created");
      return null;
    }
    useApp.getState().setStatus(`create signal worksheet failed: ${error instanceof Error ? error.message : "error"}`);
    return null;
  }
}
