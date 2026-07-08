// Drag-to-axis (ORIGIN_GAP_PLAN #49, Graph Builder phase 1) — pure geometry +
// drop-decision logic. Dragging a channel chip (Channels card row or legend
// entry) onto one of the plot's three axis bands re-plots it through the SAME
// store actions the Channels card's clicks already use (setXKey/setYKeys/
// setY2Keys, see store/useApp.ts) — this file only decides WHICH action and
// WHERE the drop landed; no new plot machinery. Components
// (components/Stage/AxisDropZones.tsx, useAxisDrop.ts) stay thin wiring
// around resolveAxisZone (geometry) and resolveAxisDrop (decision); both are
// exhaustively unit-tested here since jsdom can't drive a real drag gesture.

import { channelModelingType, isCategorical } from "./modeling";
import { defaultDenseChannels } from "./plotdata";
import type { Dataset } from "./types";

/** dataTransfer MIME type for an internal channel-chip drag. Distinct from
 *  `DATASET_DND` (Library row drag, components/Library/useLibraryTree.ts) and
 *  OS file drops, so drop targets can tell them apart via `types`. */
export const CHANNEL_DND = "application/x-qz-channel";

/** What's dragged: one channel of one dataset. */
export interface ChannelDragPayload {
  datasetId: string;
  channel: number;
}

/** JSON-encode a payload onto dataTransfer (structured data needs a MIME
 *  string, not an object). */
export function encodeChannelDrag(payload: ChannelDragPayload): string {
  return JSON.stringify(payload);
}

/** Parses a channel-drag payload; null for anything malformed (a stale/
 *  foreign string, corrupted JSON, …) so callers can safely ignore it rather
 *  than throw mid-drop. */
export function decodeChannelDrag(raw: string): ChannelDragPayload | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (
      v !== null &&
      typeof v === "object" &&
      typeof (v as Record<string, unknown>).datasetId === "string" &&
      typeof (v as Record<string, unknown>).channel === "number" &&
      Number.isInteger((v as Record<string, unknown>).channel)
    ) {
      return v as ChannelDragPayload;
    }
  } catch {
    // not our payload — fall through to null
  }
  return null;
}

/** The three axis drop bands overlaid on the plot during a channel drag. */
export type AxisZone = "x" | "y" | "y2";

// Axis-band sizing shared with the CSS overlay (`.qzk-axis-zone` rules in
// styles/shell.css) — keep the two in sync if you touch either: bandH =
// clamp(height * X_BAND_FRACTION, BAND_MIN_PX, BAND_MAX_PX), bandW likewise
// with Y_BAND_FRACTION.
const X_BAND_FRACTION = 0.22;
const Y_BAND_FRACTION = 0.16;
const BAND_MIN_PX = 32;
const BAND_MAX_PX = 88;

function bandSize(dim: number, fraction: number): number {
  return Math.min(BAND_MAX_PX, Math.max(BAND_MIN_PX, dim * fraction));
}

/** Resolve which axis zone (if any) a pointer position falls in, given the
 *  stage's content-box size. Bottom strip (full width) → X, left strip (full
 *  height) → Y, right strip (full height) → Y2; the dead interior and any
 *  point outside the rect resolve to null — Esc/drop-in-the-middle cancels
 *  (native HTML5 DnD already cancels on Escape; a null-zone drop is a no-op
 *  here too, for a mouse release over the interior). A bottom-corner overlap
 *  resolves to X — it reads as the axis-label row spanning the full width,
 *  the more visually obvious of the two bands there. */
export function resolveAxisZone(
  rect: { width: number; height: number },
  point: { x: number; y: number },
): AxisZone | null {
  const { width, height } = rect;
  if (width <= 0 || height <= 0) return null;
  const { x, y } = point;
  if (x < 0 || y < 0 || x > width || y > height) return null;
  const bandH = bandSize(height, X_BAND_FRACTION);
  const bandW = bandSize(width, Y_BAND_FRACTION);
  if (y >= height - bandH) return "x";
  if (x <= bandW) return "y";
  if (x >= width - bandW) return "y2";
  return null;
}

/** A single store mutation resolveAxisDrop asks the caller to run — mirrors
 *  the store's own setXKey/setYKeys/setY2Keys signatures exactly, so the
 *  component-side apply loop is a one-line switch, no branching logic. */
export type AxisDropStoreAction =
  | { kind: "setXKey"; xKey: number }
  | { kind: "setYKeys"; yKeys: number[] | null }
  | { kind: "setY2Keys"; y2Keys: number[] | null };

export interface AxisDropResult {
  /** Store action(s) to run, in order (empty when the drop is a no-op). */
  actions: AxisDropStoreAction[];
  /** Set when the drop did nothing (already-there, foreign dataset, a role'd
   *  channel dropped on Y/Y2, or moving the last primary Y series to Y2) —
   *  callers can skip the apply loop and any status noise entirely. */
  noop?: string;
  /** Set when a nominal/ordinal (categorical) channel landed on X — the
   *  categorical axis itself renders once GAP_PLOTTYPES #4 lands; today the
   *  X axis stays numeric. Callers surface this as a toast/status note. */
  categoricalXNote?: string;
}

function noop(reason: string): AxisDropResult {
  return { actions: [], noop: reason };
}

/** Add `channel` to the effective Y selection if it isn't already there,
 *  collapsing back to the "auto" sentinel (null) when the result matches the
 *  dense default — mirrors ChannelsCard's own `toggle` so a drag-added
 *  channel behaves identically to a checkbox-added one (round-trips through
 *  the same auto/manual distinction, .dwk, and the recalc graph). */
function ensureVisible(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  channel: number,
): { yKeys: number[] | null; changed: boolean } {
  const dense = defaultDenseChannels(ds.data, xKey);
  const current = yKeys ?? dense;
  if (current.includes(channel)) return { yKeys, changed: false };
  const next = [...current, channel].sort((a, b) => a - b);
  const isDefault = next.length === dense.length && next.every((v, i) => v === dense[i]);
  return { yKeys: isDefault ? null : next, changed: true };
}

/** The current axis assignment resolveAxisDrop needs — a plain snapshot of
 *  the store's xKey/yKeys/y2Keys fields (no store coupling in this file). */
export interface AxisAssignment {
  xKey: number | null;
  yKeys: number[] | null;
  y2Keys: number[] | null;
}

/** Decide what an axis-region drop should do: validates the payload against
 *  the active dataset, applies the same invariants the Channels card's click
 *  handlers enforce (can't plot a Label/Ignore-role channel, can't empty the
 *  primary Y axis by moving its last series to Y2), and — for an X drop —
 *  flags a categorical channel for the caller to note. Never mutates
 *  anything; the caller applies `actions` through the store. */
export function resolveAxisDrop(
  ds: Dataset,
  axis: AxisAssignment,
  zone: AxisZone,
  payload: ChannelDragPayload,
): AxisDropResult {
  if (payload.datasetId !== ds.id) return noop("dropped a chip from a different dataset");
  const { channel } = payload;
  if (!Number.isInteger(channel) || channel < 0 || channel >= ds.data.labels.length) {
    return noop("invalid channel index");
  }

  if (zone === "x") {
    if (channel === axis.xKey) return noop("channel is already the X axis");
    const actions: AxisDropStoreAction[] = [{ kind: "setXKey", xKey: channel }];
    const mt = channelModelingType(ds, channel);
    if (isCategorical(mt)) {
      const label = ds.data.labels[channel] ?? `channel ${channel}`;
      return {
        actions,
        categoricalXNote: `"${label}" is ${mt} — categorical axes land with plot-types item 4; showing it as numeric for now.`,
      };
    }
    return { actions };
  }

  // Y and Y2 both require a plotted ("data") channel — a Label/Ignore role
  // can't ride either axis (matches the disabled checkbox in ChannelsCard).
  if (ds.channelRoles?.[channel]) return noop("channel has a Label/Ignore role — not plotted");
  if (channel === axis.xKey) return noop("can't plot the X channel on Y");

  if (zone === "y") {
    const { yKeys, changed } = ensureVisible(ds, axis.xKey, axis.yKeys, channel);
    if (!changed) return noop("channel is already plotted on Y");
    return { actions: [{ kind: "setYKeys", yKeys }] };
  }

  // zone === "y2"
  const y2set = new Set(axis.y2Keys ?? []);
  if (y2set.has(channel)) return noop("channel is already on the Y2 axis");
  const { yKeys: nextY, changed } = ensureVisible(ds, axis.xKey, axis.yKeys, channel);
  const visibleAfter = nextY ?? defaultDenseChannels(ds.data, axis.xKey);
  const primariesAfter = visibleAfter.filter((c) => c !== channel && !y2set.has(c));
  if (primariesAfter.length === 0) return noop("would leave no primary Y series");
  const actions: AxisDropStoreAction[] = [];
  if (changed) actions.push({ kind: "setYKeys", yKeys: nextY });
  actions.push({ kind: "setY2Keys", y2Keys: [...y2set, channel].sort((a, b) => a - b) });
  return { actions };
}
