// Legend formatting, opened by double-clicking the legend box or from the
// "Legend…" command / legend context menu (figure polish, audit 6 lane M):
// show/hide, corner, and each entry's label. Labels go through
// `setSeriesLabel`, the SAME store field the inline label editor and the
// export read, so the legend and a vector export agree. One Apply is ONE undo
// step. "Reset position" is the old double-click behaviour, kept here. Mounted
// in the lazy `FigureDialogs` host, which owns the modal frame and focus.

import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { effectiveChannels } from "../../../lib/plotdata";
import { nearestLegendCorner } from "../../../lib/plotview";
import { withUnit } from "../../../lib/unitDisplay";
import { asOneEditStep } from "../../../store/undoStep";
import { useActiveDataset, useApp, type LegendPos } from "../../../store/useApp";
import { Checkbox } from "../../primitives/Checkbox";
import { Select } from "../../primitives";

const POS_OPTS = [
  { value: "auto", label: "Auto (least crowded)" },
  { value: "ne", label: "Top right" },
  { value: "nw", label: "Top left" },
  { value: "se", label: "Bottom right" },
  { value: "sw", label: "Bottom left" },
];

export default function LegendDialog({ onClose }: { onClose: () => void }) {
  const active = useActiveDataset();
  const v = useApp(useShallow((s) => ({
    showLegend: s.showLegend, legendPos: s.legendPos, legendXY: s.legendXY, legendFrameXY: s.legendFrameXY,
    yKeys: s.yKeys, xKey: s.xKey, seriesOrder: s.seriesOrder, seriesLabels: s.seriesLabels,
    setShowLegend: s.setShowLegend, setLegendPos: s.setLegendPos, setLegendXY: s.setLegendXY,
    setSeriesLabel: s.setSeriesLabel, recordHistory: s.recordHistory,
  })));
  const [show, setShow] = useState(v.showLegend);
  const [pos, setPos] = useState<LegendPos>(v.legendPos);
  const channels = useMemo(
    () => (active ? [...new Set(effectiveChannels(active.data, v.yKeys, v.xKey, active.channelRoles, v.seriesOrder))] : []),
    [active, v.yKeys, v.xKey, v.seriesOrder],
  );
  // The legend row's own default text: "label (unit)", as PlotLegend draws it.
  const own = (ch: number) => withUnit(active?.data.labels[ch] ?? `Series ${ch + 1}`, active?.data.units[ch]);
  const [labels, setLabels] = useState<Record<number, string>>(() =>
    Object.fromEntries(channels.map((ch) => [ch, v.seriesLabels[ch] ?? ""])),
  );
  const free = !!v.legendXY || !!v.legendFrameXY;

  const apply = () => {
    asOneEditStep(useApp.getState, "legend formatting", () => {
      if (show !== v.showLegend) v.setShowLegend(show);
      if (pos !== v.legendPos) {
        v.setLegendPos(pos);
        // A dragged or frame-anchored legend ignores the corner: picking one
        // means "put it there", so the free position goes.
        if (free) v.setLegendXY(null);
      }
      for (const ch of channels) {
        if ((labels[ch] ?? "").trim() !== (v.seriesLabels[ch] ?? "")) v.setSeriesLabel(ch, labels[ch] ?? "");
      }
    });
    onClose();
  };
  const resetPosition = () => {
    asOneEditStep(useApp.getState, "reset legend position", () => {
      if (v.legendXY) v.setLegendPos(nearestLegendCorner(v.legendXY[0], v.legendXY[1]));
      else v.recordHistory("reset legend position");
      v.setLegendXY(null);
    });
    onClose();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 340 }}>
      <Checkbox checked={show} onChange={setShow}>Show legend</Checkbox>
      <label className="qzk-field-lbl">
        Legend position
        <Select options={POS_OPTS} aria-label="Legend position" value={pos} onChange={(e) => setPos(e.target.value as LegendPos)} />
      </label>
      <div className="qzk-field-lbl" style={{ margin: 0 }}>Entries</div>
      <ul aria-label="Legend entries" style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {channels.length === 0 && <li className="qzk-ds-meta">No curves plotted.</li>}
        {channels.map((ch) => (
          <li key={ch}>
            <input
              type="text"
              className="qz-input"
              style={{ width: "100%" }}
              aria-label={`Legend entry for ${own(ch)}`}
              placeholder={own(ch)}
              value={labels[ch] ?? ""}
              onChange={(e) => setLabels((l) => ({ ...l, [ch]: e.target.value }))}
            />
          </li>
        ))}
      </ul>
      <div className="qzk-ds-meta">Overlay, linked-curve and fit rows are renamed in the legend itself (double-click the row).</div>
      <div style={{ display: "flex", gap: 6, justifyContent: "space-between", marginTop: 4 }}>
        <button type="button" className="qz-btn qz-ghost" disabled={!free} onClick={resetPosition}>Reset position</button>
        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" className="qz-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="qz-btn qz-primary" onClick={apply}>Apply</button>
        </span>
      </div>
    </div>
  );
}
