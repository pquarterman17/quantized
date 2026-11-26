// Most-recently-used commands per top-level menu (Origin's "Most Recently Used
// Items" at the bottom of a menu): the last few commands run FROM each menu, as
// command ids only (never labels, names or paths, so the slot is safe to name
// in a diagnostics bundle). Optional: Preferences > Interaction > "Recent
// commands in menus", off by default (see store/prefs.ts). Every storage access
// is guarded; a blocked or corrupt slot costs the list, never the menu.

export const MENU_RECENTS_KEY = "qz.menuRecents";
/** Commands kept per menu: small on purpose. */
export const MENU_RECENTS_CAP = 3;
const MAX_ID = 128;

export type MenuRecents = Readonly<Record<string, readonly string[]>>;

/** The stored lists, or `{}` when absent, unreadable or malformed. */
export function loadMenuRecents(): MenuRecents {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(MENU_RECENTS_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const out: Record<string, string[]> = {};
    for (const [menu, ids] of Object.entries(raw)) {
      if (!Array.isArray(ids)) continue;
      const clean = [...new Set(ids.filter((i): i is string => typeof i === "string" && i.length > 0 && i.length <= MAX_ID))];
      if (clean.length) out[menu] = clean.slice(0, MENU_RECENTS_CAP);
    }
    return out;
  } catch {
    return {};
  }
}

/** Note that command `id` was run from `menu`: it moves to the front, the list stays capped. */
export function recordMenuUse(menu: string, id: string): void {
  try {
    const all = loadMenuRecents();
    const next = [id, ...(all[menu] ?? []).filter((x) => x !== id)].slice(0, MENU_RECENTS_CAP);
    localStorage.setItem(MENU_RECENTS_KEY, JSON.stringify({ ...all, [menu]: next }));
  } catch {
    // Quota, private mode or blocked storage: the menu works without it.
  }
}
