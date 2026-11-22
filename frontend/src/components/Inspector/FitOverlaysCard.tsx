// Inspector card: the graph's fit overlays (gap audit 8, SCAT). Three opt-in
// additions for any plotted series, each OFF by default: a line of fit (with an
// optional confidence or prediction band), a LOWESS smoother and a density
// ellipse. They draw in the live plot and in the vector export from one backend
// computation, are saved with the graph, and a key on the plot names each one
// (and says why an overlay was not drawn: too few points, infinite values, ...).
// A log axis, exchanged axes, horizontal bars or a waterfall refuse them; the card says so.

import { overlayViewRefusal, overlaysOn, DEFAULT_OVERLAY_LEVEL, DEFAULT_SMOOTHER_SPAN, OVERLAY_LEVELS, type OverlayBand, type PlotOverlays } from "../../lib/plotOverlays";
import { useApp } from "../../store/useApp";
import { Checkbox } from "../primitives/Checkbox";
import { SegmentedControl } from "../primitives/SegmentedControl";
import Card from "../primitives/Card";

const NONE: PlotOverlays = { line: null, smoother: null, ellipse: null };
const pct = (l: number) => `${Math.round(l * 100)}%`;

function LevelPick({ label, value, onChange }: { label: string; value: number; onChange: (l: number) => void }) {
  return (
    <SegmentedControl<string>
      aria-label={label}
      options={OVERLAY_LEVELS.map((l) => ({ value: String(l), label: pct(l) }))}
      value={String(value)}
      onChange={(v) => onChange(Number(v))}
    />
  );
}

export default function FitOverlaysCard() {
  const overlays = useApp((s) => s.overlays);
  const setOverlays = useApp((s) => s.setOverlays);
  const xScale = useApp((s) => s.xScale);
  const yScale = useApp((s) => s.yScale);
  const exchangeXY = useApp((s) => s.exchangeXY);
  const waterfall = useApp((s) => s.waterfall);
  const waterfallDx = useApp((s) => s.waterfallDx);
  const horizontalBars = useApp((s) => Object.values(s.seriesStyles).some((st) => st?.bars === "horizontal"));
  const o = overlays ?? NONE;
  const set = (patch: Partial<PlotOverlays>) => setOverlays({ ...o, ...patch });
  const refusal = overlaysOn(overlays) ? overlayViewRefusal({ xScale, yScale, exchangeXY, waterfall, waterfallDx, horizontalBars }) : null;
  return (
    <Card title="Fit overlays" count={overlaysOn(overlays) ? [o.line, o.smoother, o.ellipse].filter(Boolean).length : undefined} defaultOpen={false}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Checkbox checked={!!o.line} onChange={(on) => set({ line: on ? { band: "none", level: DEFAULT_OVERLAY_LEVEL } : null })}>
          Line of fit
        </Checkbox>
        {o.line && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 20 }}>
            <SegmentedControl<OverlayBand>
              aria-label="Line of fit band"
              options={[{ value: "none", label: "No band" }, { value: "confidence", label: "Confidence" }, { value: "prediction", label: "Prediction" }]}
              value={o.line.band}
              onChange={(band) => set({ line: { ...o.line!, band } })}
            />
            {o.line.band !== "none" && <LevelPick label="Band level" value={o.line.level} onChange={(level) => set({ line: { ...o.line!, level } })} />}
          </div>
        )}
        <Checkbox checked={!!o.smoother} onChange={(on) => set({ smoother: on ? { span: DEFAULT_SMOOTHER_SPAN } : null })}>
          LOWESS smoother
        </Checkbox>
        {o.smoother && (
          <label className="qz-hint" style={{ paddingLeft: 20, display: "flex", gap: 8, alignItems: "center", fontFamily: "var(--font-mono)" }}>
            Span
            <input
              type="range"
              aria-label="Smoother span"
              min={0.1}
              max={1}
              step={0.05}
              value={o.smoother.span}
              onChange={(e) => set({ smoother: { span: Number(e.target.value) } })}
            />
            {o.smoother.span.toFixed(2)}
          </label>
        )}
        <Checkbox checked={!!o.ellipse} onChange={(on) => set({ ellipse: on ? { level: DEFAULT_OVERLAY_LEVEL } : null })}>
          Density ellipse
        </Checkbox>
        {o.ellipse && (
          <div style={{ paddingLeft: 20 }}>
            <LevelPick label="Ellipse level" value={o.ellipse.level} onChange={(level) => set({ ellipse: { level } })} />
          </div>
        )}
        <div className="qz-hint" style={{ color: "var(--text-dim)", fontSize: 11 }}>
          Each plotted curve gets its own overlay; excluded rows are left out. A key on the plot names what is drawn.
        </div>
        {refusal && (
          <div role="status" className="qz-hint" style={{ color: "var(--text-dim)", fontSize: 11 }}>
            Overlays {refusal}.
          </div>
        )}
      </div>
    </Card>
  );
}
