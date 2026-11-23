// Window refs: build, parse and classify the typed `WindowRef` strings.
// Parsing is the trust boundary for a saved layout: anything that is not one
// of the five shapes is refused (null), never guessed at.

import type { SingletonRef, Slot, WindowKind, WindowRef } from "./types";

export const SINGLETON_REFS: readonly SingletonRef[] = ["data", "analysis", "style"];

/** A plot-window or tool id: printable ASCII, no spaces, at most 200 chars.
 *  Real ids are `win-<t36>-<n>` and short tool names ("curvefit"). */
const ID_RX = /^[\x21-\x7e]{1,200}$/;

export const plotRef = (id: string): WindowRef => `plot:${id}`;
export const toolRef = (id: string): WindowRef => `tool:${id}`;

export interface ParsedRef {
  ref: WindowRef;
  kind: WindowKind;
  /** The plot-window or tool id; null for a singleton. */
  id: string | null;
}

/** Parse an untrusted string as a window ref, or null when it is none. */
export function parseRef(raw: unknown): ParsedRef | null {
  if (typeof raw !== "string") return null;
  if ((SINGLETON_REFS as readonly string[]).includes(raw)) {
    return { ref: raw as SingletonRef, kind: raw as SingletonRef, id: null };
  }
  const m = /^(plot|tool):(.*)$/s.exec(raw);
  if (!m || !ID_RX.test(m[2])) return null;
  return { ref: raw as WindowRef, kind: m[1] as "plot" | "tool", id: m[2] };
}

/** The kind of a ref already known to be valid. */
export function kindOf(ref: WindowRef): WindowKind {
  if (ref.startsWith("plot:")) return "plot";
  if (ref.startsWith("tool:")) return "tool";
  return ref as SingletonRef;
}

/** Where a window that was never placed docks: plots in the centre, Data /
 *  Analysis / Style on the right, tools at the bottom (plan P4). */
export function defaultSlotOf(ref: WindowRef): Slot {
  const kind = kindOf(ref);
  if (kind === "plot") return "centre";
  if (kind === "tool") return "bottom";
  return "right";
}
