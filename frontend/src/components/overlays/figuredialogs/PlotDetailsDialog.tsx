// Origin's Plot Details for ONE curve (gap audit 2 #8, plan item 50 / OG23):
// the whole curve editor. Double-click a curve on the Stage (or its right-click
// > Plot Details...) to edit everything the right panel's Series style card
// holds, in tabs: Line, Symbol, Error bars, Fill and bars, Marks.
//
// All tabs edit ONE draft (`curve/curveDraft.ts`); Apply writes it through the
// store's own setters as ONE undo step, Cancel / Esc change nothing, and Apply
// with nothing edited changes nothing. Each tab takes a value and a setter, so
// a docked panel card could mount the same tab over the live setters.
// Mounted inside the lazy `FigureDialogs` host, which owns the modal frame.

import { useEffect, useRef, useState } from "react";

import { onTabListKeyDown } from "../../../lib/tabListKeys";
import { useApp } from "../../../store/useApp";
import { commitCurveDraft } from "../../../store/commitCurveDraft";
import ErrorBarsTab from "./curve/ErrorBarsTab";
import FillBarsTab from "./curve/FillBarsTab";
import LineTab from "./curve/LineTab";
import MarksTab from "./curve/MarksTab";
import SymbolTab from "./curve/SymbolTab";
import { useCurveContext } from "./curve/useCurveContext";
import { useCurveDraft } from "./curve/useCurveDraft";

const TABS = ["Line", "Symbol", "Error bars", "Fill and bars", "Marks"] as const;
type Tab = (typeof TABS)[number];

export default function PlotDetailsDialog({ channel, onClose }: { channel: number; onClose: () => void }) {
  const name = useApp((s) => {
    const ds = s.datasets.find((d) => d.id === s.activeId);
    return s.seriesLabels[channel] ?? ds?.data.labels[channel] ?? `Series ${channel + 1}`;
  });
  const ctx = useCurveContext(channel);
  const { draft, initialErr, setSeriesStyle, setErrCol, reset } = useCurveDraft(channel, ctx.datasetId);
  const [tab, setTab] = useState<Tab>("Line");
  const panel = useRef<HTMLDivElement | null>(null);
  const style = draft.styles[channel] ?? {};

  // Focus starts in the first field of the first tab (the host would otherwise
  // take the first tab button).
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input,select,button")?.focus();
  }, []);

  const apply = () => {
    commitCurveDraft(channel, ctx.datasetId ?? "", draft, initialErr);
    onClose();
  };
  const props = { channel, style, setSeriesStyle, ctx };
  const aboveStyle = ctx.above !== undefined ? draft.styles[ctx.above] : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 360 }}>
      <div className="qzk-ds-meta">{name}</div>
      <div role="tablist" aria-label="Curve settings" style={{ display: "flex", gap: 4, flexWrap: "wrap" }} onKeyDown={(e) => onTabListKeyDown(e, true)}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`plot-details-tab-${t}`}
            aria-selected={tab === t}
            aria-controls="plot-details-panel"
            tabIndex={tab === t ? 0 : -1}
            className={tab === t ? "qz-btn qz-primary" : "qz-btn"}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div ref={panel} role="tabpanel" id="plot-details-panel" aria-labelledby={`plot-details-tab-${tab}`} style={{ minHeight: 160 }}>
        {tab === "Line" && <LineTab {...props} />}
        {tab === "Symbol" && <SymbolTab {...props} />}
        {tab === "Error bars" && <ErrorBarsTab {...props} errCol={draft.errCol} setErrCol={setErrCol} />}
        {tab === "Fill and bars" && <FillBarsTab {...props} aboveStyle={aboveStyle} />}
        {tab === "Marks" && <MarksTab {...props} />}
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "space-between", marginTop: 4 }}>
        <button type="button" className="qz-btn qz-ghost" title="Back to the default style (applies on Apply)" onClick={reset}>
          Reset style
        </button>
        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" className="qz-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="qz-btn qz-primary" onClick={apply}>Apply</button>
        </span>
      </div>
    </div>
  );
}
