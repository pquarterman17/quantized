// The Curve Fit model picker's search and recents, pure apart from the
// (try/catch-guarded) localStorage list of recently used models.
//
//   * search: every whitespace-separated word must appear in an option's label,
//     registry name or group heading (case-insensitive), so "exp" narrows to
//     the exponential family and "exponential decay" finds "ExpDec1 (= Exponential
//     Decay)" although that alias is not listed under its own name;
//   * recents: the last few models the user picked, repeated in a "Recent"
//     group at the top (never custom equations, which have their own heading).

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

/** The recently picked registry models, newest first (empty without storage). */
export function readRecents(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Record a pick (custom equations are not recorded); returns the new list. */
export function pushRecent(value: string, current: readonly string[] = readRecents()): string[] {
  if (value === "" || value.startsWith("custom:")) return [...current];
  const next = [value, ...current.filter((v) => v !== value)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private window / blocked storage: the list lives for this session only */
  }
  return next;
}

/** `groups` with a leading "Recent" group of the recents that are still listed. */
export function withRecents(groups: readonly ModelGroup[], recents: readonly string[]): ModelGroup[] {
  const byValue = new Map(groups.flatMap((g) => g.options).map((o) => [o.value, o] as const));
  const options = recents.flatMap((v) => (byValue.has(v) ? [byValue.get(v)!] : []));
  return options.length > 0 ? [{ group: RECENT_GROUP, options }, ...groups] : [...groups];
}
