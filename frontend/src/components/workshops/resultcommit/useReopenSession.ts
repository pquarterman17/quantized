// The tool half of "Open in <tool>" (lane RO). A reopenable tool's panel calls
// `useReopenScope` (remount on a new session, end the session on close) and its
// state hook calls `useReopenSeed` once, so its controls START from the
// recorded settings instead of being patched after their own reset effects ran.

import { useEffect, useState } from "react";

import type { ReopenSeed } from "../../../lib/committedOutputReopen";
import { useToolReopen } from "../../../store/toolReopen";

/** The key the panel mounts its body under: a new session for `tool` remounts
 *  it (so it seeds afresh). Closing the panel ends the session. */
export function useReopenScope(tool: string): number {
  const nonce = useToolReopen((s) => s.sessions[tool]?.nonce ?? 0);
  useEffect(() => () => useToolReopen.getState().end(tool), [tool]);
  return nonce;
}

export interface ReopenSeedValue {
  settings: ReopenSeed;
  extra: ReopenSeed | null;
}

/** The recorded settings to start from, read ONCE at mount, and only when the
 *  tool is on the session's recorded source (never applied to other data). */
export function useReopenSeed(tool: string, activeId: string | undefined): ReopenSeedValue | null {
  const [seed] = useState<ReopenSeedValue | null>(() => {
    const session = useToolReopen.getState().sessions[tool];
    return session?.seed && session.sourceId === activeId ? { settings: session.seed, extra: session.extra } : null;
  });
  return seed;
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
