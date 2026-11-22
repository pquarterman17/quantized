// The "editing a committed result" session of a reopened tool (lane RO). One
// tiny standalone store: store/toolReopenOpen.ts starts a session when the user
// picks "Open in <tool>" on a committed output; the tool reads its seed once
// when it mounts (a new session remounts it, `nonce`), shows the banner, and
// its commit replaces the old output or adds a new one per `mode`. Closing the
// tool ends the session. Session state only: nothing here is saved or undone.

import { create } from "zustand";

import type { ReopenSeed } from "../lib/committedOutputReopen";

export type ReopenMode = "replace" | "new";

export interface ReopenSession {
  nonce: number;
  resultId: string;
  resultName: string;
  /** The recorded source; null when it no longer exists (no seed then). */
  sourceId: string | null;
  /** Every recorded source, primary first (a batch table or spin asymmetry has several). */
  sourceIds: readonly string[];
  outputId: string | null;
  outputName: string | null;
  seed: ReopenSeed | null;
  extra: ReopenSeed | null;
  notice: string | null;
  replaceBlocked: string | null;
  /** Why the NEW computation's columns cannot replace the old output's (lane
   *  RPL: a bound column would vanish); set by the commit hook before commit. */
  layoutBlocked: string | null;
  /** The layout block (not the user) moved the mode to "new": clearing it moves it back. */
  autoNew?: boolean;
  mode: ReopenMode;
}

interface State {
  /** Keyed by tool (= the producer id). */
  sessions: Readonly<Record<string, ReopenSession>>;
  start: (tool: string, session: Omit<ReopenSession, "nonce" | "mode" | "layoutBlocked">) => void;
  end: (tool: string) => void;
  setMode: (tool: string, mode: ReopenMode) => void;
  setLayoutBlocked: (tool: string, reason: string | null) => void;
}

let nonce = 0;

export const useToolReopen = create<State>((set) => ({
  sessions: {},
  start: (tool, session) => set((s) => ({
    sessions: { ...s.sessions, [tool]: { ...session, layoutBlocked: null, nonce: ++nonce, mode: session.replaceBlocked ? "new" : "replace" } },
  })),
  end: (tool) => set((s) => {
    if (!s.sessions[tool]) return s;
    const { [tool]: _gone, ...rest } = s.sessions;
    return { sessions: rest };
  }),
  setMode: (tool, mode) => set((s) => {
    const session = s.sessions[tool];
    if (!session || (mode === "replace" && (session.replaceBlocked || session.layoutBlocked))) return s;
    return { sessions: { ...s.sessions, [tool]: { ...session, mode, autoNew: false } } };
  }),
  setLayoutBlocked: (tool, reason) => set((s) => {
    const session = s.sessions[tool];
    if (!session || session.layoutBlocked === reason) return s;
    const downgrade = reason !== null && session.mode === "replace";
    const restore = reason === null && session.autoNew === true;
    const mode = downgrade ? ("new" as const) : restore ? ("replace" as const) : session.mode;
    return { sessions: { ...s.sessions, [tool]: { ...session, layoutBlocked: reason, mode, autoNew: downgrade || (session.autoNew === true && reason !== null) } } };
  }),
}));

/** The result a commit of `tool` on `sourceId` should replace, or undefined. */
export function replaceTargetFor(sessions: State["sessions"], tool: string, sourceId: string): string | undefined {
  const session = sessions[tool];
  return session && session.mode === "replace" && !session.replaceBlocked && !session.layoutBlocked && session.sourceId === sourceId
    ? session.resultId : undefined;
}

/** The `replace` field of a commit request made OUTSIDE a React hook (a store
 *  commit helper): the session target as of now, or nothing. */
export function replaceRequestFor(tool: string, sourceId: string): { replace?: string } {
  const replace = replaceTargetFor(useToolReopen.getState().sessions, tool, sourceId);
  return replace ? { replace } : {};
}
