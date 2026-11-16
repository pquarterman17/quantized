// UX-A: which Inspector cards the user has opened, remembered PER CONTEXT
// (the empty project, the Plot tab, the Worksheet tab, …) and across reloads.
// A per-viewer convenience like the toolbar prefs in store/prefs.ts, so it
// lives in localStorage and never in a `.dwk`; every storage access is
// guarded, and a private window or blocked storage simply starts collapsed.
// Only the lazy Inspector imports this module.

import { create } from "zustand";

export const INSPECTOR_CARDS_KEY = "qz.inspectorCards.v1";

/** context → card id → open. */
export type OpenCards = Record<string, Record<string, boolean>>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse the stored map, keeping only well-formed `boolean` entries. */
export function loadOpenCards(): OpenCards {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(INSPECTOR_CARDS_KEY) ?? "{}");
    if (!isRecord(raw)) return {};
    const out: OpenCards = {};
    for (const [ctx, cards] of Object.entries(raw)) {
      if (!isRecord(cards)) continue;
      const kept: Record<string, boolean> = {};
      for (const [id, open] of Object.entries(cards)) if (typeof open === "boolean") kept[id] = open;
      out[ctx] = kept;
    }
    return out;
  } catch {
    return {};
  }
}

export const useInspectorCards = create<{ open: OpenCards }>(() => ({ open: loadOpenCards() }));

/** Record a user open / close of card `id` in `ctx`, and persist it. */
export function setCardOpen(ctx: string, id: string, open: boolean): void {
  const prev = useInspectorCards.getState().open;
  const next: OpenCards = { ...prev, [ctx]: { ...prev[ctx], [id]: open } };
  useInspectorCards.setState({ open: next });
  try {
    localStorage.setItem(INSPECTOR_CARDS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the choice still holds for this session.
  }
}
