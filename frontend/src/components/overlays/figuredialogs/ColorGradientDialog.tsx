// Origin's colour-list / colormap increment for the focused graph (origin gap
// audit 4 G1): spread a continuous colormap over the graph's N curves, from the
// first to the last, optionally reversed or ordered by the number in each
// curve's legend (a temperature, a field). Apply is ONE undo step
// (`setSeriesRamp`); the ramp is a per-graph setting, so it is saved with the
// window and carried by graph templates. The preview resolves the SAME
// function the canvas and the export draw with (`seriesRampImpl`). Mounted in
// the lazy `FigureDialogs` host, which owns the modal frame and focus.

import { useMemo, useState } from "react";

import { effectiveChannels } from "../../../lib/plotdata";
import { RAMP_MAPS, type RampMap, type SeriesRamp } from "../../../lib/seriesRamp";
import { rampApplies, rampColor, rampSeriesStyles, valueRanks } from "../../../lib/seriesRampImpl";
import { documentPinsSeriesStyles } from "../../../lib/seriesStyleCycle";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { Checkbox } from "../../primitives/Checkbox";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Select } from "../../primitives";

const LABELS: Record<RampMap, string> = {
  viridis: "Viridis", plasma: "Plasma", magma: "Magma", cividis: "Cividis (CVD-safe)", coolwarm: "Cool–warm (diverging)", turbo: "Turbo (rainbow)",
};
const MAP_OPTS = RAMP_MAPS.map((value) => ({ value, label: LABELS[value] }));
type Order = "index" | "value";
const ORDER_OPTS: { value: Order; label: string; ariaLabel: string }[] = [
  { value: "index", label: "Plotted order", ariaLabel: "Order by plotted order" },
  { value: "value", label: "Number in legend", ariaLabel: "Order by the number in each legend label" },
];

export default function ColorGradientDialog({ onClose }: { onClose: () => void }) {
  const active = useActiveDataset();
  const stored = useApp((s) => s.seriesRamp);
  const setSeriesRamp = useApp((s) => s.setSeriesRamp);
  const view = useApp((s) => s); // read once per render; the dialog is modal
  const doc = view.plotWindows.find((w) => w.id === view.focusedWindowId)?.document;
  const [draft, setDraft] = useState<SeriesRamp>(() => stored ?? { map: "viridis" });

  const channels = useMemo(
    () => (active ? [...new Set(effectiveChannels(active.data, view.yKeys, view.xKey, active.channelRoles, view.seriesOrder))] : []),
    [active, view.yKeys, view.xKey, view.seriesOrder],
  );
  const label = (ch: number) => view.seriesLabels[ch] ?? active?.data.labels[ch] ?? `Series ${ch + 1}`;
  const byValue = draft.order === "value" && channels.length > 1 && valueRanks(channels.map(label)) !== null;
  const colors = rampSeriesStyles(view.seriesStyles, channels, draft, label);
  const kept = channels.filter((ch) => view.seriesStyles[ch]?.color).length;
  const refused = !rampApplies({ ...view, seriesRamp: draft }, documentPinsSeriesStyles(doc), !!doc?.bindings?.encoding);
  const strip = Array.from({ length: 24 }, (_, k) => rampColor(draft, k, 24));

  const apply = (ramp: SeriesRamp | null) => {
    setSeriesRamp(ramp);
    onClose();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 360 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Select
          options={MAP_OPTS}
          aria-label="Colormap"
          value={draft.map}
          onChange={(e) => setDraft((d) => ({ ...d, map: e.target.value as RampMap }))}
        />
        <Checkbox checked={draft.reverse ?? false} onChange={(c) => setDraft((d) => ({ ...d, reverse: c || undefined }))}>
          Reverse
        </Checkbox>
      </div>
      <div aria-hidden="true" style={{ display: "flex", height: 12, borderRadius: 3, overflow: "hidden", border: "1px solid var(--border)" }}>
        {strip.map((c, k) => <span key={k} style={{ flex: 1, background: c }} />)}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>Order</span>
        <SegmentedControl<Order>
          options={ORDER_OPTS}
          aria-label="Gradient order"
          value={draft.order ?? "index"}
          onChange={(v) => setDraft((d) => ({ ...d, order: v === "value" ? "value" : undefined }))}
        />
      </div>
      {draft.order === "value" && !byValue && (
        <div className="qzk-ds-meta" role="status">Not every legend label has a distinct number; the plotted order is used.</div>
      )}
      <ul aria-label="Curve colours" style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 180, overflowY: "auto" }}>
        {channels.map((ch) => (
          <li key={ch} style={{ display: "flex", gap: 8, alignItems: "center", padding: "1px 0" }}>
            <span style={{ width: 14, height: 3, background: colors[ch]?.color?.startsWith("--") ? `var(${colors[ch]?.color})` : colors[ch]?.color }} />
            <span className="qzk-ds-meta">{label(ch)}{view.seriesStyles[ch]?.color ? " (own colour)" : ""}</span>
          </li>
        ))}
      </ul>
      {kept > 0 && <div className="qzk-ds-meta">Curves with their own colour keep it; reset a curve's colour to join the gradient.</div>}
      {refused && (
        <div className="qzk-ds-meta" role="status">
          This view (grouped, faceted, stacked, polar, statistics, encoded or with pinned publication styles) keeps its own colours; the gradient applies when it is a plain overlay.
        </div>
      )}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
        {stored && <button type="button" className="qz-btn qz-ghost" onClick={() => apply(null)}>Remove gradient</button>}
        <button type="button" className="qz-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="qz-btn qz-primary" onClick={() => apply(draft)} disabled={!active}>Apply</button>
      </div>
    </div>
  );
}
