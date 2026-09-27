// SIMS workshop, Compare tab — the decade offsets of the CURRENT plot (audit
// P2.3, box 3). One row per plotted series of the focused window: step its
// offset down/up by one decade (one undo entry per click, through the store's
// own `setSeriesStyle`), or clear them all. The offset is the series' style
// (`SeriesStyle.logOffset`), so it persists with the window, the `.dwk` and a
// saved figure, and the vector export draws it too (lib/logOffset.ts).

import { logOffsetDecades, logOffsetSuffix, logOffsetsApply, MAX_DECADES } from "../../../lib/logOffset";
import { effectiveChannels } from "../../../lib/plotdata";
import { canvasGroupCol } from "../../../lib/plotGroupSplit";
import { Button } from "../../primitives";
import { useApp } from "../../../store/useApp";

const faint = { color: "var(--text-faint)" } as const;
const mono = { fontFamily: "var(--font-mono)", minWidth: 56, textAlign: "right" } as const;

export default function SimsOffsets() {
  const active = useApp((s) => s.datasets.find((d) => d.id === s.activeId));
  const yKeys = useApp((s) => s.yKeys);
  const xKey = useApp((s) => s.xKey);
  const order = useApp((s) => s.seriesOrder);
  const styles = useApp((s) => s.seriesStyles);
  const waterfall = useApp((s) => s.waterfall);
  const groupKey = useApp((s) => s.groupKey);
  const y2Keys = useApp((s) => s.y2Keys);
  const yScale = useApp((s) => s.yScale);
  const setSeriesStyle = useApp((s) => s.setSeriesStyle);
  const setYScale = useApp((s) => s.setYScale);
  const recordHistory = useApp((s) => s.recordHistory);
  if (!active) return <div className="qzk-ds-meta" style={faint}>No plot to offset.</div>;
  const plotted = effectiveChannels(active.data, yKeys, xKey, active.channelRoles, order);
  const offsets = plotted.map((ch) => logOffsetDecades(styles[ch]?.logOffset));
  const set = (ch: number, k: number) => setSeriesStyle(ch, { logOffset: k });
  // One undo entry for the whole clear.
  const clearAll = () => {
    recordHistory("clear decade offsets");
    useApp.setState((st) => {
      const next = { ...st.seriesStyles };
      for (const ch of plotted) {
        if (!next[ch]) continue;
        const rest = { ...next[ch] };
        delete rest.logOffset;
        next[ch] = rest;
      }
      return { seriesStyles: next };
    });
  };
  const drawn = logOffsetsApply(waterfall, canvasGroupCol(groupKey, y2Keys));
  return (
    <div role="group" aria-label="Decade offsets">
      <div className="qzk-ds-meta" style={{ ...faint, marginBottom: 4 }}>
        {active.name}: each series is drawn at y × 10<sup>k</sup> — k decades up on a log axis. The data are unchanged.
      </div>
      {!drawn && (
        <div className="qzk-ds-meta" role="note" style={{ color: "var(--warn)" }}>
          Not drawn while the {waterfall > 0 ? "waterfall offset is on" : "plot is split by group"}.
        </div>
      )}
      {yScale !== "log" && (
        <div className="qzk-ds-meta" style={faint}>
          The y axis is linear; decade offsets are meant for a log axis.{" "}
          <Button size="sm" onClick={() => setYScale("log")}>Use log y</Button>
        </div>
      )}
      <div style={{ display: "grid", gap: 2, maxHeight: 160, overflowY: "auto", marginTop: 4 }}>
        {plotted.map((ch, i) => (
          <div key={ch} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="qzk-ds-meta" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
              {active.data.labels[ch] || `column ${ch + 1}`}
            </span>
            <Button size="sm" aria-label={`${active.data.labels[ch]} one decade down`} disabled={offsets[i] <= -MAX_DECADES} onClick={() => set(ch, offsets[i] - 1)}>
              −
            </Button>
            <span className="qzk-ds-meta" style={mono} aria-label={`${active.data.labels[ch]} offset`}>
              {offsets[i] ? logOffsetSuffix(offsets[i]).trim() : "×1"}
            </span>
            <Button size="sm" aria-label={`${active.data.labels[ch]} one decade up`} disabled={offsets[i] >= MAX_DECADES} onClick={() => set(ch, offsets[i] + 1)}>
              +
            </Button>
          </div>
        ))}
      </div>
      <Button size="sm" disabled={!offsets.some((k) => k !== 0)} onClick={clearAll} style={{ marginTop: 6 }}>
        Clear offsets
      </Button>
    </div>
  );
}
