// Plan item 50 (OG23, E11): who edits an axis, a curve and the legend.
//
// "popup" -- the double-click popup is the only editor. The right panel names
//            the selection and offers Edit…; the per-object fields are hidden.
// "panel" -- the docked direction: today's panel exactly (Selection quick
//            fields, the per-axis Axes controls, axis titles, Series style).
//
// One switch, read through `objectEditorIsPopup()` so a test can mock it. The
// hidden components are not deleted, so flipping this restores the panel.

export type ObjectEditorMode = "popup" | "panel";

export const OBJECT_EDITOR: ObjectEditorMode = "popup";

/** True when the popup is the only editor (the panel's per-object fields are hidden). */
export function objectEditorIsPopup(): boolean {
  return OBJECT_EDITOR === "popup";
}
