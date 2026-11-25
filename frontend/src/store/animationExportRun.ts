// Plan + download for the animation dialog: resolves full data first (a
// preview-only dataset is never animated), then plans frames and downloads.

import { ghosterFor } from "../lib/excludedRowsExport";
import {
  downloadAnimation,
  planByLevelFrames,
  planDatasetFrames,
  type AnimationBuildOptions,
  type FramePlan,
} from "../lib/animationFrames";
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

export type AnimationSource = "by" | "datasets";

export interface AnimationRequest {
  source: AnimationSource;
  figureId: string;
  datasetIds: readonly string[];
}

async function fullDataset(id: string): Promise<Dataset> {
  const state = useApp.getState();
  const preview = state.datasets.find((d) => d.id === id);
  if (!preview) throw new Error("A selected dataset is no longer loaded.");
  if (!preview.pending) return preview;
  const resolved = await state.resolveDataset(id);
  if (!resolved || resolved.pending) throw new Error(`Could not load full data for "${preview.name}".`);
  return resolved;
}

/** The frames for `request`; throws, saying why, when none can be built. */
export async function planAnimation(request: AnimationRequest): Promise<FramePlan> {
  const figure = useApp.getState().editableFigures.find((f) => f.id === request.figureId);
  if (!figure) throw new Error("Pick a saved figure.");
  if (request.source === "by") {
    if (figure.bindings.datasetId === null) throw new Error(`"${figure.name}" is not bound to a dataset.`);
    return planByLevelFrames(figure, await fullDataset(figure.bindings.datasetId));
  }
  const datasets: Dataset[] = [];
  for (const id of request.datasetIds) datasets.push(await fullDataset(id));
  return planDatasetFrames(figure, datasets);
}

export async function runAnimationExport(
  request: AnimationRequest,
  options: Omit<AnimationBuildOptions, "autoSeriesStyles" | "defaultTrace" | "defaultLineWidth">,
  signal?: AbortSignal,
): Promise<number> {
  const plan = await planAnimation(request);
  signal?.throwIfAborted();
  const state = useApp.getState();
  await downloadAnimation(
    plan,
    {
      ...options,
      autoSeriesStyles: state.autoSeriesStyles,
      defaultTrace: state.defaultTrace,
      defaultLineWidth: state.defaultLineWidth,
      greyExcluded: ghosterFor(state.excludedDisplay),
    },
    signal,
  );
  return plan.frames.length;
}
