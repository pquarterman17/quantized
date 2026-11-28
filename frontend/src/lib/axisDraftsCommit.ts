// The Axis popup keeps ONE draft per axis (X, Y, Y2), so switching tabs keeps
// each tab's edits, and Apply commits every edited axis together as ONE undo
// step (the lazy FigureDialogs chunk is the only importer).

import { markNavUndoable } from "../store/historyNav";
import type { AxisId } from "../store/figureDialogs";
import { useApp } from "../store/useApp";
import { axisDraft, axisDraftErrors, axisPatch, otherAxisKind, type AxisDraft } from "./axisDialogModel";
import { exchangeAxisClash } from "./exchangeXY";
import { navigationView } from "./plotview";

export type AxisDrafts = Partial<Record<AxisId, AxisDraft>>;

const NAMES: Record<AxisId, string> = { x: "X axis", y: "Y axis", y2: "Y2 (right) axis" };
const ORDER: readonly AxisId[] = ["x", "y", "y2"];

/** The axes whose draft differs from the live view (an untouched tab is not an edit). */
export function editedAxes(drafts: AxisDrafts): AxisId[] {
  const s = useApp.getState();
  return ORDER.filter((a) => drafts[a] && JSON.stringify(drafts[a]) !== JSON.stringify(axisDraft(s, a)));
}

/** Why an edited draft cannot be applied, each message prefixed with its axis. */
export function axisDraftsErrors(drafts: AxisDrafts): string[] {
  const s = useApp.getState();
  return editedAxes(drafts).flatMap((a) => {
    const d = drafts[a] as AxisDraft;
    const msgs = [...axisDraftErrors(d, a, otherAxisKind(s, a)), exchangeAxisClash(s.exchangeXY, a, d)].filter(Boolean);
    return msgs.map((m) => `${NAMES[a]}: ${m}`);
  });
}

/** Commit every edited axis as ONE undo step. Nothing edited: nothing changes
 *  (no undo entry, no rebuilt format that would count as user-styled, see
 *  store/windowUserEdits.ts). When the Apply also moves the X / Y limits, that
 *  step undoes and redoes them too (store/historyNav.ts). Returns false when
 *  there is nothing to commit or a draft is invalid. */
export function commitAxisDrafts(drafts: AxisDrafts): boolean {
  const axes = editedAxes(drafts);
  if (axes.length === 0 || axisDraftsErrors(drafts).length > 0) return false;
  const label = axes.length === 1 ? `edit ${NAMES[axes[0]!]}` : "edit axes";
  const navBefore = JSON.stringify(navigationView(useApp.getState()));
  useApp.getState().recordHistory(label); // ONE entry: the patches below record nothing
  const entry = useApp.getState().history.at(-1);
  // One patch at a time against the updated view: each axis writes its own
  // keys, but they share `axisLabelStyles`.
  for (const a of axes) useApp.setState(axisPatch(useApp.getState(), a, drafts[a] as AxisDraft));
  const after = navigationView(useApp.getState());
  if (entry && JSON.stringify(after) !== navBefore) markNavUndoable(entry.snapshot, after);
  return true;
}
