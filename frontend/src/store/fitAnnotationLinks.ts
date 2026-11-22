// Session-only links from a Curve Fit to the graph annotation that shows its
// result. The annotation itself is an ordinary, persisted text annotation; this
// map only remembers which one a re-fit should refresh, the options it was built
// with, and every text WE wrote into it (so a hand edit is recognised and left
// alone). It is deliberately not saved: a reopened project keeps the annotation
// as plain text and no longer updates it, which needs no file-format change.

import { useSyncExternalStore } from "react";

import type { FitAnnotationOptions } from "../lib/fitAnnotationOptions";

export interface FitAnnotationLink {
  annotationId: string;
  opts: FitAnnotationOptions;
  /** Texts this link has written (newest last, capped): anything else is the user's edit. */
  written: string[];
  /** The last up-to-date text (the out-of-date marker is appended to this). */
  fresh: string;
}

const MAX_WRITTEN = 24;
const links = new Map<string, FitAnnotationLink>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getFitAnnotationLink = (fitId: string): FitAnnotationLink | undefined => links.get(fitId);

export function setFitAnnotationLink(fitId: string, link: FitAnnotationLink): void {
  links.set(fitId, { ...link, written: link.written.slice(-MAX_WRITTEN) });
  emit();
}

/** Every fit id with a link (the out-of-date guard scans these by dataset prefix). */
export const fitAnnotationLinkIds = (): string[] => [...links.keys()];

export function clearFitAnnotationLink(fitId: string): void {
  if (links.delete(fitId)) emit();
}

/** Test helper: forget every link. */
export function resetFitAnnotationLinks(): void {
  links.clear();
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useFitAnnotationLink(fitId: string): FitAnnotationLink | undefined {
  return useSyncExternalStore(subscribe, () => links.get(fitId));
}
