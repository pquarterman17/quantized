// Frame planning for animation export (gap audit 9, G20). Pure: turns a saved
// figure plus either its By levels or a list of datasets into one frame per
// level / dataset, each an ordinary FigureSpec built by the same adapter the
// batch export uses (`buildFigureSpecFromDocument`). Lazy-only.

import { exportFigureAnimation, type AnimationFrameWire, type AnimationWireOptions } from "./api/figureAnimation";
import { resolveCategoryLabels } from "./barlayout";
import { partitionByColumn } from "./byPartition";
import { columnUnit } from "./datasetsplit";
import type { FigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument, type ExcludedRowsGhoster } from "./figureSpec";
import { analysisData } from "./rowstate";
import type { DefaultTrace } from "./seriesStyleTypes";
import type { Dataset } from "./types";

/** Mirrors `calc.figure_animation.MAX_FRAMES` (provisional, owner to confirm). */
export const MAX_ANIMATION_FRAMES = 120;

export interface PlannedFrame {
  doc: FigureDocument;
  dataset: Dataset;
  label: string;
}

export interface FramePlan {
  frames: PlannedFrame[];
  /** Levels beyond the frame limit are reported, never silently dropped. */
  totalLevels: number;
}

function levelLabel(dataset: Dataset, col: number, level: { label: string }): string {
  const name = col < 0 ? "" : (dataset.data.labels[col] ?? "");
  const unit = columnUnit(dataset.data, col);
  const numeric = level.label.trim() !== "" && Number.isFinite(Number(level.label));
  const value = numeric && unit ? `${level.label} ${unit}` : level.label;
  return name ? `${name} = ${value}` : value;
}

/** One frame per level of the figure's By column, in ascending level order.
 * Rows are partitioned from the dataset's analysis view (exclusions and filter
 * applied first); each frame draws that level's rows ungrouped, so the figure
 * is otherwise exactly the saved one. Throws, saying why, when the figure has
 * no By column or the level count is over the frame limit. */
export function planByLevelFrames(doc: FigureDocument, dataset: Dataset): FramePlan {
  const col = doc.bindings.groupKey;
  if (col === null) throw new Error(`"${doc.name}" has no By column; group it first or animate a dataset series.`);
  const data = analysisData(dataset);
  if (!data) throw new Error(`"${dataset.name}" has no data.`);
  const { levels, totalLevels } = partitionByColumn(data, col, MAX_ANIMATION_FRAMES);
  if (levels.length === 0) throw new Error("The By column has no levels.");
  if (totalLevels > MAX_ANIMATION_FRAMES) {
    throw new Error(`${totalLevels} By levels exceeds the limit of ${MAX_ANIMATION_FRAMES} frames.`);
  }
  const ungrouped: FigureDocument = { ...doc, bindings: { ...doc.bindings, groupKey: null } };
  const labels = resolveCategoryLabels(data, col, levels.map((l) => l.value));
  return {
    totalLevels,
    frames: levels.map((level, i) => ({
      doc: ungrouped,
      // The level's rows replace the dataset's; row-state was already applied above.
      dataset: { ...dataset, data: level.data, excludedRows: undefined, filter: undefined },
      label: levelLabel(dataset, col, { label: labels[i] }),
    })),
  };
}

/** One frame per dataset, each drawn with the saved figure's settings; the
 * label is the dataset name. Throws when over the frame limit. */
export function planDatasetFrames(doc: FigureDocument, datasets: readonly Dataset[]): FramePlan {
  if (datasets.length === 0) throw new Error("Select at least one dataset.");
  if (datasets.length > MAX_ANIMATION_FRAMES) {
    throw new Error(`${datasets.length} datasets exceeds the limit of ${MAX_ANIMATION_FRAMES} frames.`);
  }
  return {
    totalLevels: datasets.length,
    frames: datasets.map((dataset) => ({
      doc: { ...doc, bindings: { ...doc.bindings, datasetId: dataset.id } },
      dataset,
      label: dataset.name,
    })),
  };
}

export interface AnimationBuildOptions extends AnimationWireOptions {
  dpi: number;
  autoSeriesStyles?: boolean;
  defaultTrace?: DefaultTrace;
  defaultLineWidth?: number;
  greyExcluded?: ExcludedRowsGhoster;
}

/** Each planned frame as a PNG figure spec at the chosen DPI. */
export function frameWires(plan: FramePlan, options: AnimationBuildOptions): AnimationFrameWire[] {
  return plan.frames.map((frame) => ({
    label: frame.label,
    figure: buildFigureSpecFromDocument(frame.doc, frame.dataset, frame.doc.name, {
      fmt: "png",
      dpi: options.dpi,
      filename: frame.doc.name,
      autoSeriesStyles: options.autoSeriesStyles,
      defaultTrace: options.defaultTrace,
      defaultLineWidth: options.defaultLineWidth,
      greyExcluded: options.greyExcluded,
    }),
  }));
}

export async function downloadAnimation(
  plan: FramePlan,
  options: AnimationBuildOptions,
  signal?: AbortSignal,
): Promise<void> {
  await exportFigureAnimation(frameWires(plan, options), options, signal);
}
