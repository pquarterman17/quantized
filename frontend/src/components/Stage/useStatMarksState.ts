// The Stat Stage's categorical marks STATE (P2.6 box 1), extracted from
// `useStatStage` (which sits on its line pin) when significance comparisons
// landed. The marks are the window's persisted `PlotView.statMarks` when the
// caller passes them (focused stage + background windows), else hook-local (a
// bare hook in a test). Display-only: they re-fetch nothing.
//
// Review finding 6: stored and patched PER MODE (`StatMarksByMode`), never as
// one flat object every mode read from alike — a choice made in one mode
// (strip's `points: "none"`, say) must never read as another mode's DEFAULT
// (box's fliers going dark too) purely because the two shared the same stored
// fields. `marksMode` is null outside the four modes marks apply to at all
// (qq/histogram); the hook still holds a slot for them in `localMarks` so a
// mode switch never drops what was already set for one.

import { useState } from "react";

import type { StatMarksByMode, StatMarksMode } from "../../lib/plotviewSanitize";
import type { StatMarks } from "../../lib/statMarks";
import type { StatMode } from "../../lib/statstage";
import type { UseStatStageParams } from "./useStatStageTypes";

export function useStatMarksState(
  mode: StatMode,
  params: Pick<UseStatStageParams, "marks" | "onMarksChange">,
): { marksMode: StatMarksMode | null; marks: StatMarks | null; patchMarks: (patch: StatMarks, label?: string) => void } {
  const marksMode: StatMarksMode | null =
    mode === "box" || mode === "violin" || mode === "strip" || mode === "bar" ? mode : null;
  const [localMarks, setLocalMarks] = useState<StatMarksByMode>({});
  const marksByMode = params.marks ?? localMarks;
  const marks = marksMode ? marksByMode[marksMode] ?? null : null;
  const patchMarks = (patch: StatMarks, label?: string) => {
    if (!marksMode) return;
    if (params.onMarksChange) params.onMarksChange(marksMode, patch, label);
    else setLocalMarks((m) => ({ ...m, [marksMode]: { ...m[marksMode], ...patch } }));
  };
  return { marksMode, marks, patchMarks };
}
