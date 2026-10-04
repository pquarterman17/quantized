import { useSyncExternalStore } from "react";

export type WorkflowWorkspaceView =
  | { kind: "technique" }
  | { kind: "origin"; fidelityId?: string; requestId: number };

let view: WorkflowWorkspaceView = { kind: "technique" };
let deferredOriginReviews: ReadonlySet<string> = new Set();
let originReviewScope: ReadonlyMap<string, unknown> | null = null;
let originReviewRequestId = 0;
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
  setView({ kind: "origin", fidelityId, requestId: ++originReviewRequestId });
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

/** Apply one session-only review decision to a group without notifying once
 * per row. Large Origin projects commonly contain hundreds of graph windows;
 * bulk review must remain one immediate UI update rather than a render storm. */
export function setOriginReviewsDeferred(keys: readonly string[], deferred: boolean): void {
  const next = new Set(deferredOriginReviews);
  let changed = false;
  for (const key of keys) {
    if (deferred) {
      if (!next.has(key)) {
        next.add(key);
        changed = true;
      }
    } else if (next.delete(key)) {
      changed = true;
    }
  }
  if (!changed) return;
  deferredOriginReviews = next;
  listeners.forEach((listener) => listener());
}

export function clearOriginReviewDeferred(): void {
  if (deferredOriginReviews.size === 0) return;
  deferredOriginReviews = new Set();
  listeners.forEach((listener) => listener());
}

/** Keep marks for import records that survive an append, and discard only
 * records actually replaced/removed. Array identity alone changes when a
 * second Origin project is imported and must not erase the first project's
 * session review work. */
export function syncOriginReviewScope(scope: readonly { id: string }[]): void {
  const nextScope = new Map(scope.map((entry) => [entry.id, entry]));
  if (originReviewScope === null) {
    originReviewScope = nextScope;
    return;
  }
  const retained = new Set(
    [...deferredOriginReviews].filter((key) => {
      const separator = key.indexOf(":");
      if (separator < 0) return false;
      const fidelityId = key.slice(0, separator);
      return nextScope.get(fidelityId) === originReviewScope?.get(fidelityId);
    }),
  );
  originReviewScope = nextScope;
  if (retained.size === deferredOriginReviews.size) return;
  deferredOriginReviews = retained;
  listeners.forEach((listener) => listener());
}

export function useOriginReviewDeferred(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, deferredSnapshot, deferredSnapshot);
}
