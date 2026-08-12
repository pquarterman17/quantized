// Channel reassignment for the canonical Publication Preview draft (F2.3g):
// pick the X-axis channel and toggle each other channel's Y (plotted) and Y2
// (secondary-axis) membership -- the same `xKey`/`yKeys`/`y2Keys` operations
// `Inspector/ChannelsCard.tsx` offers on the Stage (for the LIVE PlotView),
// now reachable on the detached DOCUMENT draft without touching the Stage.
// The F2.3b/c/d/e/f precedent applied to error-bar designations most
// recently; this is the named next gap.
//
// Vocabulary matches ChannelsCard deliberately: an "X axis" select with a
// "(default)" auto sentinel, a per-channel checkbox for Y (plotted)
// membership, and a "Y2" pill for the secondary axis, disabled until the
// channel is plotted. A roled (label/ignore) channel's checkbox is disabled
// the same way ChannelsCard's is -- a non-data column can't become a curve.
// OUT of scope, same as ChannelsCard's own coupling this panel deliberately
// does not carry over: channel ROLE / modeling-type editing (dataset-scoped,
// not a FigureDocument.bindings field) and the inline "± error" picker
// (error bindings already have their own panel, F2.3f).

import { resolvedYKeys } from "./canonicalChannels";
import type { ChannelRole } from "../../../lib/types";
import { Checkbox, Pill, Select } from "../../primitives";

export default function ChannelsPanel({
  labels,
  channelRoles,
  xKey,
  yKeys,
  y2Keys,
  fallbackYKeys,
  onXKey,
  onToggleY,
  onToggleY2,
}: {
  /** The bound dataset's raw channel labels, indexed by channel. */
  labels: readonly string[];
  /** Non-data column roles (label/ignore); a roled channel can't be plotted. */
  channelRoles?: Record<number, ChannelRole>;
  xKey: number | null;
  yKeys: number[] | null;
  y2Keys: number[] | null;
  /** The dense-channel default the `yKeys=null` auto sentinel resolves to
   *  (see canonicalChannels.ts's resolvedYKeys) -- supplied by the caller so
   *  this stays a pure display component, the same shape as
   *  ErrorColumnsPanel/RefLinePropertiesPanel. */
  fallbackYKeys: readonly number[];
  onXKey: (xKey: number | null) => void;
  onToggleY: (channel: number) => void;
  onToggleY2: (channel: number) => void;
}) {
  const selected = resolvedYKeys(yKeys, fallbackYKeys);
  const y2 = new Set(y2Keys ?? []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, width: "100%" }}>
        <label className="qzk-field-lbl">X axis</label>
        <Select
          aria-label="X axis channel"
          value={xKey == null ? "" : String(xKey)}
          onChange={(e) => onXKey(e.target.value === "" ? null : Number(e.target.value))}
          title="Channel to use as the plot's x-axis (default = the dataset's own x column)"
          options={[
            { value: "", label: "Row index (default)" },
            ...labels.map((label, i) => ({ value: String(i), label })),
          ]}
        />
      </span>
      {labels.length === 0 ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          No data columns to assign.
        </div>
      ) : (
        labels.map((label, i) => {
          if (i === xKey) return null; // this channel is the X axis, not a Y candidate
          const roled = channelRoles?.[i] != null;
          const checked = selected.includes(i);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
              <Checkbox checked={checked} disabled={roled} onChange={() => onToggleY(i)}>
                <span className="qzk-menu-trunc" style={{ maxWidth: 140 }} title={label}>
                  {label}
                </span>
              </Checkbox>
              <Pill
                active={y2.has(i)}
                disabled={roled || !checked}
                title="Draw on the secondary (right) Y axis"
                aria-label={`Plot ${label} on the secondary Y axis`}
                onClick={() => onToggleY2(i)}
              >
                Y2
              </Pill>
            </div>
          );
        })
      )}
    </div>
  );
}
