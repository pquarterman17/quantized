// The per-user "last layout" template (`qz.windowLayout`, plan "Persistence"):
// the layout's SHAPE without any project's window ids — where each kind of
// window goes (Data, Analysis, Style, tools, the first plot), the edge sizes
// and the centre mode. Kept per width class, `wide` (>= 1280 px) and `narrow`
// (< 1280 px), each written only by user edits made in its own class (UX pass 5
// M2, owner-approved 2026-11-23) and read by the class of the window at seed or
// Reset time. Written on the user's layout edits in windows mode
// (store/windowLayout.ts), never from a narrow-screen tile or the host's own
// upkeep (m4). Applied (plan P6)
// only where a project has no layout of its own: the seed of a new project,
// an import or a file from before the window layout (`seedWithTemplate`), and
// the first placement of a tool window the project never placed
// (`toolFirstPlacement`). A project's own saved layout always wins.

import { close, dock, float, stackOf } from "./ops";
import { defaultSlotOf, kindOf, toolRef } from "./refs";
import { SMALL_SCREEN_PX } from "./seed";
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

/** The two width classes the remembered desk is kept for (plan P6, owner-approved 2026-11-23): a
 *  window of at least SMALL_SCREEN_PX is "wide", a narrower one "narrow". */
export type DeskClass = "wide" | "narrow";
/** A missing width (no window) counts as narrow, like `currentWidth`. */
export const deskClassOf = (width: number | undefined): DeskClass => ((width ?? SMALL_SCREEN_PX) < SMALL_SCREEN_PX ? "narrow" : "wide");
const currentWidth = (): number => (typeof window === "undefined" ? SMALL_SCREEN_PX : window.innerWidth);

/** What `qz.windowLayout` holds: one template per width class. Version 1 (before the split) was a bare
 *  template, written only at 1280 px and over, so it is the wide one. `future` marks a store written by a
 *  newer version: read as empty, and never overwritten (fail closed, not destructive). */
interface TemplateStore {
  wide: WindowLayoutTemplateV1 | null;
  narrow: WindowLayoutTemplateV1 | null;
  future: boolean;
}
const EMPTY_STORE: TemplateStore = { wide: null, narrow: null, future: false };

/** Read an untrusted store (any JSON); an unknown or corrupt shape is empty, never a throw. */
export function sanitizeTemplateStore(raw: unknown): TemplateStore {
  if (!isObj(raw)) return EMPTY_STORE;
  if (raw.v === 1) return { ...EMPTY_STORE, wide: sanitizeTemplate(raw) };
  if (raw.v === 2) return { wide: sanitizeTemplate(raw.wide), narrow: sanitizeTemplate(raw.narrow), future: false };
  return { ...EMPTY_STORE, future: typeof raw.v === "number" && raw.v > 2 };
}

function readStore(): { store: TemplateStore; raw: string | null } {
  try {
    const raw = localStorage.getItem(WINDOW_LAYOUT_TEMPLATE_KEY);
    return { raw, store: raw === null ? EMPTY_STORE : sanitizeTemplateStore(JSON.parse(raw)) };
  } catch {
    return { raw: null, store: EMPTY_STORE };
  }
}

/** The saved template for a width class (default: the current window's), or null (none yet, unreadable,
 *  or storage unavailable). */
export function loadLayoutTemplate(cls: DeskClass = deskClassOf(currentWidth())): WindowLayoutTemplateV1 | null {
  return readStore().store[cls];
}

/** Layouts the host wrote while keeping the project in step (a reconcile, a tool's first placement, a
 *  narrow-screen tile): NOT the user's edits, so never remembered as the template (plan P6 provisional:
 *  the template follows user layout edits only, never a project open, restore or reopen). A WeakSet keyed
 *  by the layout object keeps the eager `setWindowLayout` unchanged: the lazy writer asks. */
const unremembered = new WeakSet<WindowLayoutV1>();
export function markNotRemembered(layout: WindowLayoutV1): WindowLayoutV1 {
  unremembered.add(layout);
  return layout;
}
export const isRemembered = (layout: WindowLayoutV1): boolean => !unremembered.has(layout);

/** `next`'s shape over `prev`: a kind `next` has no window of (no tool open, no plot window) keeps
 *  the place it had last, so a restart or a project without tools does not forget where tools go. */
export function mergeTemplate(prev: WindowLayoutTemplateV1 | null, next: WindowLayoutTemplateV1): WindowLayoutTemplateV1 {
  return prev ? { ...next, kinds: { ...prev.kinds, ...next.kinds } } : next;
}

/** Remember `layout`'s shape as the user's template for width class `cls` (the class of the window when the
 *  user made the edit; default: now), merged over that class's last one (`mergeTemplate`), or replacing it
 *  outright when `merge` is false (Reset layout: no old tool or plot place survives). The other class's
 *  template is kept as it was. A store from a newer version is left alone. Storage failures are
 *  non-fatal (private mode): the project still carries its own layout. */
export function saveLayoutTemplate(layout: WindowLayoutV1, merge = true, cls: DeskClass = deskClassOf(currentWidth())): void {
  try {
    const { store, raw } = readStore();
    if (store.future) return;
    const shape = templateOf(layout);
    const own = merge ? mergeTemplate(store[cls], shape) : shape;
    const wide = cls === "wide" ? own : store.wide;
    const narrow = cls === "narrow" ? own : store.narrow;
    // Fixed key order, so an unchanged store serializes identically (the dedupe below).
    const out = { v: 2, ...(wide && { wide }), ...(narrow && { narrow }) };
    const next = JSON.stringify(out);
    if (raw !== next) localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, next);
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
