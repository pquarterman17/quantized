import { useSyncExternalStore } from "react";

export type WorkflowWorkspaceView =
  | { kind: "technique" }
  | { kind: "origin"; fidelityId?: string };

let view: WorkflowWorkspaceView = { kind: "technique" };
let deferredOriginReviews: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): WorkflowWorkspaceView {
  return view;
}

function setView(next: WorkflowWorkspaceView): void {
  view = next;
  listeners.forEach((listener) => listener());
}

/** Session-only navigation for the lazy Workflow surface. This intentionally
 * does not enter the workspace file: opening an Origin review must not dirty
 * scientific data or persist a stale import id into a different project. */
export function openOriginMigrationReview(fidelityId?: string): void {
  setView({ kind: "origin", fidelityId });
}

export function openTechniqueWorkflow(): void {
  setView({ kind: "technique" });
}

export function useWorkflowWorkspaceView(): WorkflowWorkspaceView {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function deferredSnapshot(): ReadonlySet<string> {
  return deferredOriginReviews;
}

/** "Review later" is durable for this app session, but deliberately absent
 * from .dwk serialization and the scientific undo stack. */
export function toggleOriginReviewDeferred(key: string): void {
  const next = new Set(deferredOriginReviews);
  if (next.has(key)) next.delete(key); else next.add(key);
  deferredOriginReviews = next;
  listeners.forEach((listener) => listener());
}

export function clearOriginReviewDeferred(): void {
  if (deferredOriginReviews.size === 0) return;
  deferredOriginReviews = new Set();
  listeners.forEach((listener) => listener());
}

export function useOriginReviewDeferred(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, deferredSnapshot, deferredSnapshot);
}
