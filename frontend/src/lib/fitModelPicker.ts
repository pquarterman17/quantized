// The Curve Fit model picker's search and recents, pure apart from the
// (try/catch-guarded) localStorage list of recently fitted models.
//
//   * search: every whitespace-separated word must appear in an option's label,
//     registry name or group heading (case-insensitive), so "exp" narrows to
//     the exponential family, and "expdec1" finds ExpDec1 AND its same-curve
//     twin "Exponential Decay", whose label hint names it;
//   * recents: the last few models a fit was RUN with (recordRecentModel, from
//     the fit itself -- never a change event, so arrowing through the closed
//     select cannot reorder the list under the keyboard), shown in a "Recent"
//     group at the top INSTEAD of under their own heading, so every option
//     value is unique. Never custom equations, which have their own heading.

import type { ModelGroup, ModelOption } from "./fitModelCatalog";

const KEY = "qz.fitModels.recent";
export const RECENT_MAX = 3;
export const RECENT_GROUP = "Recent";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** True when every word of `query` occurs in `hay`. */
export const matchesQuery = (hay: string, query: string): boolean => {
  const h = norm(hay);
  return norm(query).split(" ").every((w) => w === "" || h.includes(w));
};

/** `groups` / `custom` cut to the options matching `query`. The option whose
 *  value is `keep` always stays, so the picker never loses the current model. */
export function filterModels(
  groups: readonly ModelGroup[],
  custom: readonly ModelOption[],
  query: string,
  keep: string,
): { groups: ModelGroup[]; custom: ModelOption[] } {
  if (norm(query) === "") return { groups: [...groups], custom: [...custom] };
  const ok = (o: ModelOption, heading: string) => o.value === keep || matchesQuery(`${o.label} ${o.value} ${heading}`, query);
  return {
    groups: groups.map((g) => ({ group: g.group, options: g.options.filter((o) => ok(o, g.group)) })).filter((g) => g.options.length > 0),
    custom: custom.filter((o) => ok(o, "custom equations")),
  };
}

/** This session's list when storage is unavailable (private window, blocked). */
let memory: string[] | null = null;
const listeners = new Set<() => void>();

/** The recently fitted registry models, newest first. */
export function readRecents(): string[] {
  try {
    if (memory) return memory; // storage refused a write this session
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return memory ?? [];
  }
}

/** The new recents list with `value` first (custom equations are not recorded). Pure. */
export function pushRecent(value: string, current: readonly string[]): string[] {
  if (value === "" || value.startsWith("custom:")) return [...current];
  return [value, ...current.filter((v) => v !== value)].slice(0, RECENT_MAX);
}

/** Record that a fit was run with `value` and tell any mounted picker. */
export function recordRecentModel(value: string): void {
  const current = readRecents();
  const next = pushRecent(value, current);
  if (next.join("\u0000") === current.join("\u0000")) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    memory = next; // blocked storage: the list lives for this session only
  }
  listeners.forEach((l) => l());
}

/** Subscribe to recordRecentModel (for useSyncExternalStore). */
export function subscribeRecents(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `groups` with a leading "Recent" group of the recents that are still listed,
 *  each MOVED there from its own heading (a heading left empty is dropped), so
 *  no value appears twice in the select. */
export function withRecents(groups: readonly ModelGroup[], recents: readonly string[]): ModelGroup[] {
  const byValue = new Map(groups.flatMap((g) => g.options).map((o) => [o.value, o] as const));
  const options = recents.flatMap((v) => (byValue.has(v) ? [byValue.get(v)!] : []));
  if (options.length === 0) return [...groups];
  const moved = new Set(options.map((o) => o.value));
  const rest = groups
    .map((g) => ({ group: g.group, options: g.options.filter((o) => !moved.has(o.value)) }))
    .filter((g) => g.options.length > 0);
  return [{ group: RECENT_GROUP, options }, ...rest];
}
