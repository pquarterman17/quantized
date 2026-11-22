// Curve Fit -> graph annotation: state and the follow-the-fit sync.
//
// "Add to graph" writes one ordinary text annotation (page-anchored, top left,
// no anchor dot) generated from the result and remembers it in
// store/fitAnnotationLinks. While this hook is mounted:
//   * a re-fit (new result) or an options change rewrites the annotation text;
//   * an out-of-date fit appends "(out of date)" to the last fresh text (the
//     numbers are withheld from being presented as current), and the next
//     fresh result replaces it;
//   * text the user edited by hand is never overwritten (fail closed): the
//     panel says so and offers "Replace my edit".
// Sync writes are derived updates, not user actions, so they add no undo step.
// The store-side steps live in store/fitAnnotationActions.ts.

import { useCallback, useEffect, useState } from "react";

import { DEFAULT_FIT_ANNOTATION, type FitAnnotationOptions } from "../../../lib/fitAnnotationOptions";
import type { FitResultInput } from "../../../lib/fitResultView";
import {
  addFitAnnotation,
  markFitAnnotationsOutOfDate,
  removeFitAnnotation,
  replaceFitAnnotationText,
  writeAnnotationText,
} from "../../../store/fitAnnotationActions";
import { getFitAnnotationLink, setFitAnnotationLink, useFitAnnotationLink } from "../../../store/fitAnnotationLinks";
import { useApp } from "../../../store/useApp";
import { buildFitAnnotationText, OUT_OF_DATE_SUFFIX } from "./fitAnnotationText";

export interface FitAnnotationState {
  opts: FitAnnotationOptions;
  setOpts: (patch: Partial<FitAnnotationOptions>) => void;
  /** The annotation exists in the current plot. */
  onGraph: boolean;
  /** The user edited the text, so re-fits no longer rewrite it. */
  edited: boolean;
  /** Why the requested format fell back, or null. */
  note: string | null;
  add: () => void;
  remove: () => void;
  /** Overwrite a hand edit with the generated text again. */
  replaceEdit: () => void;
}

/** While `datasetId` has no completed fit result, its graph annotations say so
 *  (the section that normally does this is only mounted with a result). */
export function useFitAnnotationGuard(datasetId: string | null, hasResult: boolean): void {
  useEffect(() => {
    if (datasetId && !hasResult) markFitAnnotationsOutOfDate(`${datasetId}:`);
  }, [datasetId, hasResult]);
}

export function useFitAnnotation(fitId: string, input: FitResultInput, stale: boolean): FitAnnotationState {
  const link = useFitAnnotationLink(fitId);
  const [local, setLocal] = useState<FitAnnotationOptions>(() => getFitAnnotationLink(fitId)?.opts ?? DEFAULT_FIT_ANNOTATION);
  const opts = link?.opts ?? local;
  const annotation = useApp((s) => (link ? s.annotations.find((a) => a.id === link.annotationId) : undefined));
  const built = buildFitAnnotationText(input, opts); // cheap; effects key on built.text
  const edited = !!link && !!annotation && !link.written.includes(annotation.text);

  const setOpts = useCallback((patch: Partial<FitAnnotationOptions>) => {
    setLocal((o) => ({ ...o, ...patch }));
    const cur = getFitAnnotationLink(fitId);
    if (cur) setFitAnnotationLink(fitId, { ...cur, opts: { ...cur.opts, ...patch } });
  }, [fitId]);

  useEffect(() => {
    if (!link || !annotation || edited) return;
    const want = stale ? `${link.fresh}${OUT_OF_DATE_SUFFIX}` : built.text;
    if (annotation.text === want && (stale || link.fresh === built.text)) return;
    writeAnnotationText(annotation.id, want);
    setFitAnnotationLink(fitId, { ...link, fresh: stale ? link.fresh : built.text, written: [...link.written, want] });
  }, [link, annotation, edited, stale, built.text, fitId]);

  const add = useCallback(() => {
    if (!stale) addFitAnnotation(fitId, built.text, opts);
  }, [stale, built.text, opts, fitId]);
  const remove = useCallback(() => removeFitAnnotation(fitId), [fitId]);
  const replaceEdit = useCallback(() => {
    if (!stale) replaceFitAnnotationText(fitId, built.text);
  }, [stale, built.text, fitId]);

  return { opts, setOpts, onGraph: !!annotation, edited, note: built.note, add, remove, replaceEdit };
}
