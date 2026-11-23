// Read an UNTRUSTED window layout (a `.dwk` key, a localStorage blob). Fails
// closed and never throws: a layout this build cannot read whole is refused
// (null, with a reason) and the caller re-seeds; a single entry it cannot read
// is dropped, with a reason, and the rest is kept. The layout is never data, so
// it never blocks opening a project (plan "Persistence and versioning").

import { stackOf } from "./ops";
import { parseRef } from "./refs";
import {
  SLOTS,
  WINDOW_LAYOUT_VERSION,
  type CentreMode,
  type DataFollow,
  type Placement,
  type Slot,
  type WindowEdges,
  type WindowLayoutV1,
  type WindowRef,
} from "./types";

/** A saved layout names at most this many windows; beyond it is not a desk. */
export const MAX_PLACEMENTS = 500;
/** No edge region is wider or taller than this (px). */
export const MAX_EDGE_PX = 4000;

export interface SanitizeContext {
  /** Plot-window ids that exist; a `plot:` placement for any other is dropped. */
  plotIds?: ReadonlySet<string>;
  /** Tool ids this build knows; when given, any other `tool:` is dropped. */
  toolIds?: ReadonlySet<string>;
  /** Dataset ids that exist; a Data pin to any other is cleared. */
  datasetIds?: ReadonlySet<string>;
  /** The workspace area; each edge is clamped to 80 % of its axis. */
  viewport?: { width: number; height: number };
}

export interface SanitizeResult {
  /** null = refused as a whole (`reason` says why). */
  layout: WindowLayoutV1 | null;
  reason: string | null;
  /** One line per entry dropped from an otherwise readable layout. */
  dropped: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isSlot = (v: unknown): v is Slot => (SLOTS as readonly unknown[]).includes(v);
const slotOrNull = (v: unknown): v is Slot | null => v === null || isSlot(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const refuse = (reason: string): SanitizeResult => ({ layout: null, reason, dropped: [] });

function placement(raw: unknown): Placement | string {
  if (!isObj(raw)) return "not an object";
  if (!slotOrNull(raw.slot)) return `unknown slot ${JSON.stringify(raw.slot) ?? "undefined"}`;
  if (!slotOrNull(raw.lastSlot)) return `unknown last slot ${JSON.stringify(raw.lastSlot) ?? "undefined"}`;
  if (typeof raw.open !== "boolean") return "open is not true/false";
  if (!finite(raw.order) || raw.order < 0) return "order is not a number >= 0";
  if (!finite(raw.share) || raw.share <= 0 || raw.share > 1) return "share is not in (0, 1]";
  return { slot: raw.slot, lastSlot: raw.lastSlot, open: raw.open, order: Math.trunc(raw.order), share: raw.share };
}

function edges(raw: unknown, viewport: SanitizeContext["viewport"]): WindowEdges {
  const o = isObj(raw) ? raw : {};
  const cap = (v: unknown, axis: number | undefined): number => {
    const max = axis !== undefined && finite(axis) && axis > 0 ? Math.min(MAX_EDGE_PX, axis * 0.8) : MAX_EDGE_PX;
    return finite(v) ? Math.round(Math.min(max, Math.max(0, v))) : 0;
  };
  return { left: cap(o.left, viewport?.width), right: cap(o.right, viewport?.width), bottom: cap(o.bottom, viewport?.height) };
}

function dataFollow(raw: unknown, datasetIds: ReadonlySet<string> | undefined): DataFollow {
  const o = isObj(raw) ? raw : {};
  const pinned = typeof o.pinned === "string" && o.pinned && (!datasetIds || datasetIds.has(o.pinned)) ? o.pinned : null;
  return { pinned, follow: o.follow === "library" ? "library" : "plot" };
}

/** Repack every slot (orders 0..n-1, shares summing to 1) and rebuild `z` as
 *  exactly the open floating windows, saved order first. */
function normalise(layout: WindowLayoutV1): WindowLayoutV1 {
  const placements = { ...layout.placements };
  for (const slot of SLOTS) {
    const stack = stackOf(layout, slot);
    const total = stack.reduce((a, r) => a + placements[r]!.share, 0);
    stack.forEach((r, order) => { placements[r] = { ...placements[r]!, order, share: placements[r]!.share / total, lastSlot: slot }; });
  }
  const floating = (r: WindowRef): boolean => placements[r]?.open === true && placements[r]?.slot === null;
  const z = [...new Set(layout.z)].filter(floating);
  for (const r of Object.keys(placements) as WindowRef[]) if (floating(r) && !z.includes(r)) z.push(r);
  return { ...layout, placements, z };
}

/** Sanitize an untrusted saved layout. */
export function sanitizeWindowLayout(raw: unknown, ctx: SanitizeContext = {}): SanitizeResult {
  if (!isObj(raw)) return refuse("the saved window layout is not an object");
  if (raw.v !== WINDOW_LAYOUT_VERSION) {
    return finite(raw.v) && raw.v > WINDOW_LAYOUT_VERSION
      ? refuse(`the saved window layout is version ${raw.v}, from a newer Quantized`)
      : refuse("the saved window layout has no readable version");
  }
  if (!isObj(raw.placements)) return refuse("the saved window layout has no placements");
  const keys = Object.keys(raw.placements);
  if (keys.length > MAX_PLACEMENTS) return refuse(`the saved window layout names ${keys.length} windows (at most ${MAX_PLACEMENTS})`);
  const dropped: string[] = [];
  const placements: WindowLayoutV1["placements"] = {};
  for (const key of keys) {
    const ref = parseRef(key);
    const label = JSON.stringify(key.length > 60 ? `${key.slice(0, 60)}…` : key);
    if (!ref) { dropped.push(`${label}: not a window this version knows`); continue; }
    if (ref.kind === "plot" && ctx.plotIds && !ctx.plotIds.has(ref.id!)) { dropped.push(`${label}: that plot window is not in the project`); continue; }
    if (ref.kind === "tool" && ctx.toolIds && !ctx.toolIds.has(ref.id!)) { dropped.push(`${label}: not a tool this version has`); continue; }
    const p = placement(raw.placements[key]);
    if (typeof p === "string") { dropped.push(`${label}: ${p}`); continue; }
    placements[ref.ref] = p;
  }
  const z = Array.isArray(raw.z) ? raw.z.filter((r): r is WindowRef => typeof r === "string" && Object.hasOwn(placements, r)) : [];
  const centre: CentreMode = raw.centre === "grid" ? "grid" : "row";
  const layout = normalise({
    v: 1, placements, z, edges: edges(raw.edges, ctx.viewport), centre, data: dataFollow(raw.data, ctx.datasetIds),
  });
  return { layout, reason: null, dropped };
}

/** The one-line `migrationWarnings` note for a sanitize result, or null when
 *  the layout was read whole. */
export function windowLayoutWarning(r: SanitizeResult): string | null {
  if (r.reason) return `Window layout not restored: ${r.reason}; it was reset.`;
  if (r.dropped.length) return `Window layout: ${r.dropped.length} window${r.dropped.length === 1 ? "" : "s"} not restored (${r.dropped.join("; ")}).`;
  return null;
}
