// Animation export seam (gap audit 9, G20): one POST, one file. Lazy-only; kept
// out of figureBatch.ts so the batch module does not grow.

import { HttpError, postDownload } from "./http";
import type { FigureSpec } from "./figures";

export type AnimationFormat = "gif" | "apng" | "zip";

export interface AnimationFrameWire {
  figure: FigureSpec;
  label: string;
}

export interface AnimationWireOptions {
  format: AnimationFormat;
  frameMs: number;
  loop: boolean;
  fixedAxes: boolean;
  filename: string;
}

const EXTENSION: Record<AnimationFormat, string> = { gif: "gif", apng: "png", zip: "zip" };

/** Render `frames` server-side (the figure renderer the static export uses)
 * and download one animated GIF / APNG or a ZIP of PNG frames. A refusal
 * (limit, unsupported figure) comes back as the server's own reason. */
export async function exportFigureAnimation(
  frames: readonly AnimationFrameWire[],
  options: AnimationWireOptions,
  signal?: AbortSignal,
): Promise<void> {
  const filename = options.filename || "animation";
  try {
    await postDownload(
      "/api/export/figure-animation",
      {
        frames,
        format: options.format,
        frame_ms: options.frameMs,
        loop: options.loop,
        fixed_axes: options.fixedAxes,
        filename,
      },
      `${filename}.${EXTENSION[options.format]}`,
      signal,
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 413) {
      throw new Error("This animation is too large to send at once. Use fewer frames or a lower DPI.");
    }
    throw error;
  }
}
