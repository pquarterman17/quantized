// Legend formatting, opened by double-clicking the legend box (figure polish,
// audit 6 lane M): show/hide, corner, and each entry's label. Labels go
// through `setSeriesLabel`, the SAME store field the inline label editor and
// the export read, so the legend and a vector export agree. "Reset position"
// is the old double-click behaviour, kept here. Mounted in the lazy
// `FigureDialogs` host, which owns the modal frame and focus.

import { useMemo, useState } from "react";

import { nearestLegendCorner } from "../../../lib/plotview";
import { effectiveChannels } from "../../../lib/plotdata";
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
  const view = useApp((s) => s);
  const { setShowLegend, setLegendPos, setSeriesLabel, setLegendXY, recordHistory } = view;
  const [show, setShow] = useState(view.showLegend);
  const [pos, setPos] = useState<LegendPos>(view.legendPos);
  const channels = useMemo(
    () => (active ? [...new Set(effectiveChannels(active.data, view.yKeys, view.xKey, active.channelRoles, view.seriesOrder))] : []),
    [active, view.yKeys, view.xKey, view.seriesOrder],
  );
  const own = (ch: number) => active?.data.labels[ch] ?? `Series ${ch + 1}`;
  const [labels, setLabels] = useState<Record<number, string>>(() =>
    Object.fromEntries(channels.map((ch) => [ch, view.seriesLabels[ch] ?? ""])),
  );
  const free = !!view.legendXY || !!view.legendFrameXY;

  const apply = () => {
    if (show !== view.showLegend) setShowLegend(show);
    if (pos !== view.legendPos) setLegendPos(pos);
    for (const ch of channels) {
      if ((labels[ch] ?? "").trim() !== (view.seriesLabels[ch] ?? "")) setSeriesLabel(ch, labels[ch] ?? "");
    }
    onClose();
  };
  const resetPosition = () => {
    if (view.legendXY) setLegendPos(nearestLegendCorner(view.legendXY[0], view.legendXY[1]));
    else recordHistory("reset legend position");
    setLegendXY(null);
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
