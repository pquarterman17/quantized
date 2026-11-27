// Inspector card: the graph's fit overlays (gap audit 8, SCAT). Three opt-in
// additions for any plotted series, each OFF by default: a line of fit (with an
// optional confidence or prediction band), a LOWESS smoother and a density
// ellipse, plus per-group shapes (item 24): a centroid marker, a convex hull and an
// ellipse that is either the DATA ellipse (where points fall) or the MEAN's
// confidence ellipse (where the group mean lies). They draw in the live plot and in the vector export from one backend
// computation, are saved with the graph, and a key on the plot names each one
// (and says why an overlay was not drawn: too few points, infinite values, ...).
// A log axis, exchanged axes, horizontal bars or a waterfall refuse them; the card says so.

import { overlayViewRefusal, overlaysOn, DEFAULT_OVERLAY_LEVEL, DEFAULT_SMOOTHER_SPAN, OVERLAY_LEVELS, type EllipseKind, type OverlayBand, type PlotOverlays } from "../../lib/plotOverlays";
import { useApp } from "../../store/useApp";
import { Checkbox } from "../primitives/Checkbox";
import { SegmentedControl } from "../primitives/SegmentedControl";
import Card from "../primitives/Card";

const NONE: PlotOverlays = { line: null, smoother: null, ellipse: null };
const nOn = (o: PlotOverlays) => [o.line, o.smoother, o.ellipse, o.centroid, o.hull].filter(Boolean).length;
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
    <Card title="Fit overlays" count={overlaysOn(overlays) ? nOn(o) : undefined} defaultOpen={false}>
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
          Ellipse
        </Checkbox>
        {o.ellipse && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 20 }}>
            <SegmentedControl<EllipseKind>
              aria-label="Ellipse kind"
              options={[{ value: "data", label: "Data ellipse" }, { value: "mean", label: "Mean ellipse" }]}
              value={o.ellipse.kind ?? "data"}
              onChange={(kind) => set({ ellipse: { level: o.ellipse!.level, ...(kind === "mean" ? { kind } : {}) } })}
            />
            <div className="qz-hint" style={{ color: "var(--text-dim)", fontSize: 11 }}>
              {o.ellipse.kind === "mean"
                ? "Mean ellipse: where the group mean lies (Hotelling T², covariance / n). Needs 3 points."
                : "Data ellipse: where the points fall (covariance times the chi-square 2 d.f. quantile). Needs 5 points."}
            </div>
            <LevelPick label="Ellipse level" value={o.ellipse.level} onChange={(level) => set({ ellipse: { ...o.ellipse!, level } })} />
          </div>
        )}
        <Checkbox checked={!!o.centroid} onChange={(on) => set({ centroid: on })}>
          Group centroid
        </Checkbox>
        <Checkbox checked={!!o.hull} onChange={(on) => set({ hull: on })}>
          Convex hull
        </Checkbox>
        <div className="qz-hint" style={{ color: "var(--text-dim)", fontSize: 11 }}>
          Each plotted curve (each group of a grouped plot) gets its own overlay; excluded rows are left out. A key on the plot names what is drawn.
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
