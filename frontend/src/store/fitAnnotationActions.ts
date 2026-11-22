// The store-side steps of Curve Fit's "Result on graph" annotation (kept out of
// the React hook so components make no imperative store calls for it).

import type { FitAnnotationOptions } from "../lib/fitAnnotationOptions";
import { clearFitAnnotationLink, fitAnnotationLinkIds, getFitAnnotationLink, setFitAnnotationLink } from "./fitAnnotationLinks";
import { useApp } from "./useApp";

/** Top-left of the page, as canvas fractions (x right, y down). */
const PAGE_X = 0.05;
const PAGE_Y = 0.1;

/** Rewrite an annotation's text as a derived update: no undo step. */
export function writeAnnotationText(id: string, text: string): void {
  useApp.setState((s) => ({ annotations: s.annotations.map((a) => (a.id === id ? { ...a, text } : a)) }));
}

/** Add the annotation (one undo step) and link it to `fitId`. */
export function addFitAnnotation(fitId: string, text: string, opts: FitAnnotationOptions): void {
  void useApp.getState().withHistoryBatch("add fit to graph", (token) => {
    const s = useApp.getState();
    const id = s.addAnnotation(PAGE_X, PAGE_Y, text, token);
    s.updateAnnotation(id, { anchor: "page", dot: false }, token);
    setFitAnnotationLink(fitId, { annotationId: id, opts, written: [text], fresh: text });
    return Promise.resolve();
  });
}

/** Delete the linked annotation (undoable) and forget the link. */
export function removeFitAnnotation(fitId: string): void {
  const cur = getFitAnnotationLink(fitId);
  if (cur) useApp.getState().removeAnnotation(cur.annotationId);
  clearFitAnnotationLink(fitId);
}

const OUT_OF_DATE = "  (out of date)";

/** A fit of `prefix`'s dataset has no current result (removed, or back to a guess):
 *  mark each of its annotations out of date, unless the user edited the text. */
export function markFitAnnotationsOutOfDate(prefix: string): void {
  const annotations = useApp.getState().annotations;
  for (const id of fitAnnotationLinkIds()) {
    if (!id.startsWith(prefix)) continue;
    const link = getFitAnnotationLink(id);
    const ann = link && annotations.find((a) => a.id === link.annotationId);
    if (!link || !ann || !link.written.includes(ann.text)) continue;
    const want = `${link.fresh}${OUT_OF_DATE}`;
    if (ann.text === want) continue;
    writeAnnotationText(ann.id, want);
    setFitAnnotationLink(id, { ...link, written: [...link.written, want] });
  }
}

/** Overwrite a hand edit with the generated text again (one undo step). */
export function replaceFitAnnotationText(fitId: string, text: string): void {
  const cur = getFitAnnotationLink(fitId);
  if (!cur) return;
  useApp.getState().recordHistory("replace fit annotation text");
  writeAnnotationText(cur.annotationId, text);
  setFitAnnotationLink(fitId, { ...cur, fresh: text, written: [...cur.written, text] });
}
