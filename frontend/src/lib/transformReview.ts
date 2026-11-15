// The interactive review step of a transform: split out of lib/transformRun.ts
// (which is at its line ceiling) -- a cohesive sibling, not a trimmed comment.

import { askConfirm } from "../store/confirmDialog";
import { actionable, needsConfirm, warningsText } from "./transformWarnings";
import type { TransformPreview } from "./transformRun";

/** Interactive review: silent when there is nothing to say; a unit mismatch
 *  gets a danger-styled confirm whose button names what is being overridden. */
export function reviewTransform(pv: TransformPreview): Promise<boolean> {
  if (!actionable(pv.warnings).length) return Promise.resolve(true);
  const units = needsConfirm(pv.warnings);
  return askConfirm(
    units ? `${pv.title}: units differ` : `${pv.title}: review before creating`,
    warningsText(pv.summary, pv.warnings),
    units ? "Create despite unit mismatch" : "Create",
    units,
  );
}
