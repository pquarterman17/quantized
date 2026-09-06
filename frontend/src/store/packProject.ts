// P1.7 "Pack Project" PR 4 — the frontend state machine consuming the
// desktopPackBridge.ts contract. A standalone Zustand store (the
// store/relink.ts / store/fitYByX.ts precedent), never composed into
// useApp.ts (which is pinned): nothing here needs to round-trip a `.dwk`,
// and this state is transient job-tracking, not workspace content.
//
// The state machine (exactly, no other edges):
//
//   idle -> selecting_destination -> scanning -> awaiting_confirmation
//        -> packing -> completed
//   any ACTIVE state -> cancelling -> cancelled
//   any ACTIVE state -> failed
//
// where ACTIVE means anything other than idle/completed/cancelled/failed.
// Every action below checks the CURRENT phase against what it requires and
// records a rejection (`lastRejected`) instead of mutating state on an
// illegal call — `previewPackProject`/`startPackProject` from the wrong
// phase, a double `startPackProject` while already `packing`, etc.
//
// Heavy logic (the actual bridge calls, workspace serialization, and the
// 250ms poll loop with its own 200ms update throttle) lives in the
// lazily-imported sibling store/packProjectRun.ts — the store/relinkCommit
// .ts precedent — so this file's own eager bundle cost stays a thin state
// machine: a `usePackProject` import (e.g. a status indicator mounted
// unconditionally in the shell) never pulls in `useApp`/`serializeWorkspace`
// merely by existing. The poll loop itself is NOT tied to any component
// mount — it lives in module scope in packProjectRun.ts and keeps running
// until a terminal phase, exactly as the module doc there states.

import { create } from "zustand";

import type {
  PortableManifest,
  PortableManifestWarning,
  PortableSourceRow,
} from "../lib/desktopPackBridge";

export type PackProjectPhase =
  | "idle"
  | "selecting_destination"
  | "scanning"
  | "awaiting_confirmation"
  | "packing"
  | "completed"
  | "cancelling"
  | "cancelled"
  | "failed";

export type PackStage = "copying" | "verifying" | "publishing" | null;

export interface PackProjectProgress {
  currentFile: string | null;
  completedCount: number;
  totalCount: number;
  bytesCopied: number;
  bytesTotal: number;
  stage: PackStage;
}

export interface PackProjectError {
  code: string;
  message: string;
  originalsModified: false;
  note: string;
}

export interface PackProjectPreview {
  /** Compared by REFERENCE (never re-derived) against whatever
   *  `startPackProject` is handed — see that action's own doc for why
   *  identity, not a re-hash, is what proves "still the reviewed plan". */
  token: string;
  manifest: PortableManifest;
  destination: { bundleDir: string; exists: boolean };
  warnings: PortableManifestWarning[];
  blockers: PortableSourceRow[];
  /** The EXACT serialized workspace content sent to `pack_preview` — kept
   *  verbatim (never re-derived) so `startPackProject` can resend this
   *  SAME string to `pack_start`, byte-for-byte, satisfying the backend's
   *  own `sha256(content)` staleness check trivially whenever the content
   *  is otherwise unchanged. `packProjectRun.ts`'s `contentFingerprint`
   *  is the "did the project meaningfully change since preview" check —
   *  never a raw string compare against this field directly, because
   *  `serializeWorkspace` stamps a fresh `savedAt` on every call and a
   *  raw compare would treat that alone as a change. */
  content: string;
  destinationParent: string;
  projectName: string;
}

export const EMPTY_PACK_PROGRESS: PackProjectProgress = {
  currentFile: null,
  completedCount: 0,
  totalCount: 0,
  bytesCopied: 0,
  bytesTotal: 0,
  stage: null,
};

/** The sentence every error this store surfaces carries — bridge errors
 *  already have it (see `PackStatusError`); every LOCALLY-synthesized
 *  rejection (a missing bridge, a stale preview) states the same guarantee
 *  explicitly rather than leaving a caller to assume it. */
export const NOTHING_MODIFIED_NOTE = "No original files or project were modified.";

export function packError(code: string, message: string): PackProjectError {
  return { code, message, originalsModified: false, note: NOTHING_MODIFIED_NOTE };
}

const ACTIVE_PHASES: readonly PackProjectPhase[] = [
  "selecting_destination",
  "scanning",
  "awaiting_confirmation",
  "packing",
  "cancelling",
];

function isActive(phase: PackProjectPhase): boolean {
  return ACTIVE_PHASES.includes(phase);
}

export interface PackProjectState {
  phase: PackProjectPhase;
  progress: PackProjectProgress;
  warnings: PortableManifestWarning[];
  errors: PackProjectError[];
  resultPath: string | null;
  cleanupOk: boolean | null;
  preview: PackProjectPreview | null;
  /** Records the most recent REJECTED transition attempt (a call made from
   *  a phase that does not permit it) — never set on a legal call, and
   *  never cleared automatically by a later legal one (tests read it right
   *  after the rejected call). */
  lastRejected: { from: PackProjectPhase; action: string } | null;

  /** Preview (dry-run plan) a pack of the live workspace. With no
   *  `destination`, opens the native folder picker first
   *  (`selecting_destination`) — backing out of that dialog returns to
   *  `idle`, never a rejection. Legal only from `idle` or a TERMINAL phase
   *  (`completed`/`cancelled`/`failed` — a fresh preview is how a retry
   *  starts over). */
  previewPackProject: (destination?: string) => Promise<void>;
  /** Start the actual copy/publish pipeline for the CURRENT preview.
   *  Legal only from `awaiting_confirmation`; `approvedManifest` must be
   *  reference-identical to `preview.manifest` (see
   *  packProjectRun.ts's `runStartPackProject` for the full stale-preview
   *  rule) or this rejects locally without ever calling the bridge. */
  startPackProject: (approvedManifest: PortableManifest) => Promise<void>;
  /** Idempotent: a no-op from `idle` or a terminal phase; returns directly
   *  to `idle`-adjacent `cancelled` from any pre-`packing` active phase;
   *  from `packing`/`cancelling` asks the backend to cancel and lets the
   *  poll loop resolve the final phase. */
  cancelPackProject: () => Promise<void>;
  /** Clears a terminal phase back to `idle` so a retry can start. Rejected
   *  from any non-terminal phase. */
  resetPackProject: () => Promise<void>;
}

function reject(
  set: (partial: Partial<PackProjectState>) => void,
  from: PackProjectPhase,
  action: string,
): void {
  set({ lastRejected: { from, action } });
}

export const usePackProject = create<PackProjectState>((set, get) => ({
  phase: "idle",
  progress: EMPTY_PACK_PROGRESS,
  warnings: [],
  errors: [],
  resultPath: null,
  cleanupOk: null,
  preview: null,
  lastRejected: null,

  previewPackProject: async (destination) => {
    const phase = get().phase;
    if (isActive(phase)) {
      reject(set, phase, "previewPackProject");
      return;
    }
    const { runPreviewPackProject } = await import("./packProjectRun");
    await runPreviewPackProject(set, destination);
  },

  startPackProject: async (approvedManifest) => {
    const phase = get().phase;
    if (phase !== "awaiting_confirmation") {
      reject(set, phase, "startPackProject");
      return;
    }
    const { runStartPackProject } = await import("./packProjectRun");
    await runStartPackProject(get, set, approvedManifest);
  },

  cancelPackProject: async () => {
    const phase = get().phase;
    if (!isActive(phase)) return; // idle/terminal: idempotent no-op, not a rejection
    const { runCancelPackProject } = await import("./packProjectRun");
    await runCancelPackProject(set, phase);
  },

  resetPackProject: async () => {
    const phase = get().phase;
    if (phase !== "completed" && phase !== "cancelled" && phase !== "failed") {
      reject(set, phase, "resetPackProject");
      return;
    }
    const { runResetPackProject } = await import("./packProjectRun");
    await runResetPackProject(set);
  },
}));
