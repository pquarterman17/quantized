// The per-user "last layout" template (`qz.windowLayout`, plan "Persistence"):
// the layout's SHAPE without any project's window ids — where each kind of
// window goes (Data, Analysis, Style, tools, the first plot), the edge sizes
// and the centre mode. P0 writes it (store/windowLayout.ts) and provides
// `applyTemplate`; applying it to a project with no saved layout of its own
// (a project's layout always wins) is wired end to end in plan P6.

import { close, dock, float, stackOf } from "./ops";
import { kindOf } from "./refs";
import { SLOTS, type CentreMode, type Slot, type WindowEdges, type WindowLayoutV1, type WindowRef } from "./types";

export const WINDOW_LAYOUT_TEMPLATE_KEY = "qz.windowLayout";

export type TemplateKind = "data" | "analysis" | "style" | "tool" | "plot";
const KINDS: readonly TemplateKind[] = ["data", "analysis", "style", "tool", "plot"];

export interface KindPlacement {
  slot: Slot | null;
  open: boolean;
}

export interface WindowLayoutTemplateV1 {
  v: 1;
  kinds: Partial<Record<TemplateKind, KindPlacement>>;
  edges: WindowEdges;
  centre: CentreMode;
}

/** Where windows of each kind sit in `layout`. For "plot" and "tool", the
 *  first open one in reading order speaks for its kind. */
export function templateOf(layout: WindowLayoutV1): WindowLayoutTemplateV1 {
  const kinds: WindowLayoutTemplateV1["kinds"] = {};
  const reading: WindowRef[] = [...SLOTS.flatMap((s) => stackOf(layout, s)), ...layout.z];
  for (const ref of reading) {
    const kind = kindOf(ref);
    if (!kinds[kind]) kinds[kind] = { slot: layout.placements[ref]!.slot, open: true };
  }
  for (const ref of ["data", "analysis", "style"] as const) {
    const p = layout.placements[ref];
    if (p && !p.open) kinds[ref] = { slot: p.slot ?? p.lastSlot, open: false };
  }
  return { v: 1, kinds, edges: { ...layout.edges }, centre: layout.centre };
}

/** Lay `refs` out the way `template` says, starting from `base` (a seed).
 *  Windows of a kind the template does not mention keep their base placement. */
export function applyTemplate(base: WindowLayoutV1, template: WindowLayoutTemplateV1, refs: readonly WindowRef[]): WindowLayoutV1 {
  let layout: WindowLayoutV1 = { ...base, edges: { ...template.edges }, centre: template.centre };
  let firstPlot = true;
  for (const ref of refs) {
    const kind = kindOf(ref);
    const want = template.kinds[kind];
    if (!want || (kind === "plot" && !firstPlot)) continue;
    if (kind === "plot") firstPlot = false;
    layout = want.slot ? dock(layout, ref, want.slot) : float(layout, ref);
    if (!want.open) layout = close(layout, ref);
  }
  return layout;
}

const isSlotOrNull = (v: unknown): v is Slot | null => v === null || (SLOTS as readonly unknown[]).includes(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Read an untrusted template; null (= no template) unless it is v1 and whole. */
export function sanitizeTemplate(raw: unknown): WindowLayoutTemplateV1 | null {
  if (!isObj(raw) || raw.v !== 1 || !isObj(raw.kinds) || !isObj(raw.edges)) return null;
  const out: WindowLayoutTemplateV1["kinds"] = {};
  for (const [k, v] of Object.entries(raw.kinds)) {
    if (!(KINDS as readonly string[]).includes(k) || !isObj(v) || !isSlotOrNull(v.slot) || typeof v.open !== "boolean") return null;
    out[k as TemplateKind] = { slot: v.slot, open: v.open };
  }
  const e = raw.edges;
  const px = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 4000 ? Math.round(v) : null);
  const [left, right, bottom] = [px(e.left), px(e.right), px(e.bottom)];
  if (left === null || right === null || bottom === null) return null;
  if (raw.centre !== "row" && raw.centre !== "grid") return null;
  return { v: 1, kinds: out, edges: { left, right, bottom }, centre: raw.centre };
}

/** The saved template, or null (absent, unreadable, or storage unavailable). */
export function loadLayoutTemplate(): WindowLayoutTemplateV1 | null {
  try {
    const raw = localStorage.getItem(WINDOW_LAYOUT_TEMPLATE_KEY);
    return raw === null ? null : sanitizeTemplate(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Remember `layout`'s shape as the user's template. Storage failures are
 *  non-fatal (private mode): the project still carries its own layout. */
export function saveLayoutTemplate(layout: WindowLayoutV1): void {
  try {
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, JSON.stringify(templateOf(layout)));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
