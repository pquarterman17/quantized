// The per-user "last layout" template (`qz.windowLayout`, plan "Persistence"):
// the layout's SHAPE without any project's window ids — where each kind of
// window goes (Data, Analysis, Style, tools, the first plot), the edge sizes
// and the centre mode. Written on every layout change in windows mode
// (store/windowLayout.ts), never from a narrow-screen tile. Applied (plan P6)
// only where a project has no layout of its own: the seed of a new project,
// an import or a file from before the window layout (`seedWithTemplate`), and
// the first placement of a tool window the project never placed
// (`toolFirstPlacement`). A project's own saved layout always wins.

import { close, dock, float, stackOf } from "./ops";
import { defaultSlotOf, kindOf, toolRef } from "./refs";
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

/** `next`'s shape over `prev`: a kind `next` has no window of (no tool open, no plot window) keeps
 *  the place it had last, so a restart or a project without tools does not forget where tools go. */
export function mergeTemplate(prev: WindowLayoutTemplateV1 | null, next: WindowLayoutTemplateV1): WindowLayoutTemplateV1 {
  return prev ? { ...next, kinds: { ...prev.kinds, ...next.kinds } } : next;
}

/** Remember `layout`'s shape as the user's template, merged over the last one (`mergeTemplate`), or
 *  replacing it outright when `merge` is false (Reset layout: no old tool or plot place survives).
 *  Storage failures are non-fatal (private mode): the project still carries its own layout. */
export function saveLayoutTemplate(layout: WindowLayoutV1, merge = true): void {
  try {
    const shape = templateOf(layout);
    const next = JSON.stringify(merge ? mergeTemplate(loadLayoutTemplate(), shape) : shape);
    if (localStorage.getItem(WINDOW_LAYOUT_TEMPLATE_KEY) !== next) localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, next);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** The seed of a project with no layout of its own, laid out the way the user's template says
 *  (plan P6). The focused plot window is the "first plot" the template's plot rule moves; every
 *  other window of a kind the template names follows it, and the rest keep the seed's place. */
export function seedWithTemplate(seed: WindowLayoutV1, template: WindowLayoutTemplateV1 | null, focusedPlot: WindowRef | null): WindowLayoutV1 {
  if (!template) return seed;
  const refs = Object.keys(seed.placements) as WindowRef[];
  const ordered = focusedPlot && refs.includes(focusedPlot) ? [focusedPlot, ...refs.filter((r) => r !== focusedPlot)] : refs;
  return applyTemplate(seed, template, ordered);
}

/** A tool window the layout never placed, closed where the template keeps tools (docked at the end
 *  of that slot's stack, or floating), so opening it (`reopen`) puts it there. Unchanged when the
 *  layout already places it or the template has no tool placement. */
export function toolFirstPlacement(layout: WindowLayoutV1, id: string, template: WindowLayoutTemplateV1 | null): WindowLayoutV1 {
  const ref = toolRef(id);
  const want = template?.kinds.tool;
  if (!want || layout.placements[ref]) return layout;
  const order = want.slot ? stackOf(layout, want.slot).length : 0;
  return { ...layout, placements: { ...layout.placements, [ref]: { slot: want.slot, order, share: 1, lastSlot: want.slot ?? defaultSlotOf(ref), open: false } } };
}
