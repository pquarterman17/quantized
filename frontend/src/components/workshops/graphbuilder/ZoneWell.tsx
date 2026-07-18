// ZoneWell — a reusable channel drop-zone "well" (Graph Builder #51; the
// Tabulate residuals item 8 reuses this for its Group/Value wells). Accepts the
// #49 channel-chip drag (CHANNEL_DND) from the Channels card / legend AND a
// click-to-assign Select fallback (keyboard / assistive-tech path), so it never
// depends on a mouse drag. Deals in channel INDICES + labels only — no PlotSpec
// coupling — so any workshop can drop it in. Thin: all decisions live in the
// caller's hook; this component just surfaces assign / remove intents.

import { useState, type ReactNode } from "react";

import { CHANNEL_DND, decodeChannelDrag } from "../../../lib/dragaxis";
import { Select } from "../../primitives";

/** One assignable channel (for the click-to-assign Select). */
export interface WellOption {
  index: number;
  label: string;
}

/** One channel currently sitting in the well (rendered as a removable chip). */
export interface WellChip {
  channel: number;
  label: string;
}

export interface ZoneWellProps {
  title: string;
  /** Small caption under the title (e.g. "categorical → box/violin"). */
  hint?: string;
  /** A note shown inside the well body (e.g. the inert-facet explainer). */
  note?: ReactNode;
  /** Only channel drags from THIS dataset are accepted (v1 single-dataset). */
  datasetId: string | null;
  /** Options for the click-to-assign fallback Select. */
  options: WellOption[];
  /** Channels currently in the well (0 or 1 for single-slot, 0..n for `multiple`). */
  assigned: WellChip[];
  /** Whether the well holds a list (Y) vs a single slot (X / Group / Facet). */
  multiple?: boolean;
  onAssign: (channel: number) => void;
  onRemove: (channel: number) => void;
  /** Optional one-slot display-order move (used by the multi-value Y well). */
  onMove?: (channel: number, direction: -1 | 1) => void;
  /** Optional: a channel-drag reached this well but was rejected (foreign
   *  dataset or a malformed payload) — callers can surface a toast. Omit for
   *  the original silent-reject behavior (dragging is exploratory). */
  onReject?: (reason: "dataset" | "malformed") => void;
}

/** Does a drag carry our channel-chip payload (vs an OS file / foreign drag)? */
function isChannelDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(CHANNEL_DND);
}

export default function ZoneWell({
  title,
  hint,
  note,
  datasetId,
  options,
  assigned,
  multiple = false,
  onAssign,
  onRemove,
  onMove,
  onReject,
}: ZoneWellProps) {
  const [over, setOver] = useState(false);

  const onDragOver = (e: React.DragEvent) => {
    if (!isChannelDrag(e.dataTransfer)) return;
    e.preventDefault(); // mark this a valid drop target
    if (!over) setOver(true);
  };
  const onDragLeave = () => setOver(false);
  const onDrop = (e: React.DragEvent) => {
    setOver(false);
    if (!isChannelDrag(e.dataTransfer)) return;
    e.preventDefault();
    const payload = decodeChannelDrag(e.dataTransfer.getData(CHANNEL_DND));
    if (!payload) {
      onReject?.("malformed"); // ignore rather than throw mid-drop
      return;
    }
    if (datasetId && payload.datasetId !== datasetId) {
      onReject?.("dataset"); // foreign dataset
      return;
    }
    onAssign(payload.channel);
  };

  // Options not already assigned — the click-to-assign menu.
  const assignedSet = new Set(assigned.map((c) => c.channel));
  const free = options.filter((o) => !assignedSet.has(o.index));

  return (
    <div
      className={`qzk-zone-well${over ? " over" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="qzk-zone-well-hd">
        <span className="qzk-zone-well-title">{title}</span>
        {hint && <span className="qzk-zone-well-hint">{hint}</span>}
      </div>

      <div className="qzk-zone-well-body">
        {assigned.length === 0 && !note && (
          <span className="qzk-zone-well-empty">drop a channel</span>
        )}
        {assigned.map((c, index) => (
          <span key={c.channel} className="qzk-zone-chip">
            {onMove && <span className="qzk-zone-chip-order">{index + 1}</span>}
            {c.label}
            {onMove && (
              <span className="qzk-zone-chip-move">
                <button
                  type="button"
                  title={`Move ${c.label} earlier`}
                  aria-label={`Move ${c.label} earlier`}
                  disabled={index === 0}
                  onClick={() => onMove(c.channel, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  title={`Move ${c.label} later`}
                  aria-label={`Move ${c.label} later`}
                  disabled={index === assigned.length - 1}
                  onClick={() => onMove(c.channel, 1)}
                >
                  ↓
                </button>
              </span>
            )}
            <button
              type="button"
              className="qzk-zone-chip-x"
              title={`Remove ${c.label}`}
              aria-label={`Remove ${c.label}`}
              onClick={() => onRemove(c.channel)}
            >
              ×
            </button>
          </span>
        ))}
        {note && <div className="qzk-zone-well-note">{note}</div>}
      </div>

      {(multiple || assigned.length === 0) && free.length > 0 && (
        <Select
          className="qzk-zone-well-add"
          aria-label={`Assign a channel to ${title}`}
          value=""
          onChange={(e) => {
            if (e.target.value !== "") onAssign(Number(e.target.value));
          }}
          options={[{ value: "", label: multiple ? "+ add channel…" : "+ assign channel…" }, ...free.map((o) => ({ value: String(o.index), label: o.label }))]}
        />
      )}
    </div>
  );
}
