// The tool half of "Open in <tool>" (lane RO). A reopenable tool's panel calls
// `useReopenScope` (remount on a new session, end the session on close) and its
// state hook calls `useReopenSeed` once, so its controls START from the
// recorded settings instead of being patched after their own reset effects ran.

import { useEffect, useRef, useState } from "react";

import type { ReopenSeed } from "../../../lib/committedOutputReopen";
import { useToolReopen } from "../../../store/toolReopen";

/** The key the panel mounts its body under: a new session for `tool` remounts
 *  it (so it seeds afresh). Closing the panel ends the session. */
export function useReopenScope(tool: string): number {
  const nonce = useToolReopen((s) => s.sessions[tool]?.nonce ?? 0);
  useEffect(() => {
    mounted.set(tool, (mounted.get(tool) ?? 0) + 1);
    return () => {
      mounted.set(tool, (mounted.get(tool) ?? 1) - 1);
      // Deferred: StrictMode's simulated unmount/remount must not end it.
      queueMicrotask(() => {
        if (!mounted.get(tool)) useToolReopen.getState().end(tool);
      });
    };
  }, [tool]);
  return nonce;
}

const mounted = new Map<string, number>();

/** True while `deps` still equal their values at mount AND `active` (a seed
 *  was applied): a tool's reset effect skips itself then, so the seeded
 *  values stand. Value-based (not "first run"), so StrictMode's double effect
 *  run behaves the same; the hold ends for good at the first difference. */
export function useSeedHold(active: boolean, deps: readonly unknown[]): () => boolean {
  const held = useRef<readonly unknown[] | null>(active ? deps : null);
  return () => {
    const at = held.current;
    if (at && at.length === deps.length && at.every((value, i) => Object.is(value, deps[i]))) return true;
    held.current = null;
    return false;
  };
}

export interface ReopenSeedValue {
  settings: ReopenSeed;
  extra: ReopenSeed | null;
  /** Every recorded source, primary first (a batch table or spin asymmetry has several). */
  sourceIds: readonly string[];
}

const consumed = new Map<string, number>();

/** The recorded settings to start from, read ONCE at mount, and only when the
 *  tool is on the session's recorded source (never applied to other data).
 *  `once`: for a tool whose state lives in a part of the panel that unmounts
 *  (a tab pane, a lazy section). Only the FIRST mount of a session seeds; a
 *  later mount (back from another tab) starts as a plain open would, instead
 *  of silently resetting the user's edits to the recorded values. The mark is
 *  made in an effect, so StrictMode's double render still sees the seed. */
export function useReopenSeed(tool: string, activeId: string | undefined, once = false): ReopenSeedValue | null {
  const [snap] = useState(() => {
    const session = useToolReopen.getState().sessions[tool];
    const used = once && session !== undefined && consumed.get(tool) === session.nonce;
    const value: ReopenSeedValue | null = !used && session?.seed && session.sourceId === activeId
      ? { settings: session.seed, extra: session.extra, sourceIds: session.sourceIds } : null;
    return { nonce: session?.nonce ?? null, value };
  });
  useEffect(() => {
    if (once && snap.nonce !== null) consumed.set(tool, snap.nonce);
  }, [once, tool, snap.nonce]);
  return snap.value;
}

/** A recorded number (NaN for a recorded null: the sanitizer stores NaN as null). */
export const seedNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" ? value : value === null ? Number.NaN : fallback;

/** A recorded list of strings (form fields), or [] when the record has none. */
export function seedStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item : "")) : [];
}

/** A recorded list of numbers, or `fallback` when the record has none. */
export function seedNumbers(value: unknown, fallback: number[]): number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number") ? (value as number[]) : fallback;
}

/** A recorded string out of `allowed`, else `fallback`. */
export function seedChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
