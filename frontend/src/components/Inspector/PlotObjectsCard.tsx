// Plot Objects inspector (GUI_INTERACTION_PLAN #2): one compact tree over the
// active graph's axes, legend, curves, annotations, and shapes. Curve removal
// is intentionally NON-DESTRUCTIVE visibility (a curve is a dataset channel,
// not an owned copy of data); graphic objects expose real duplicate/delete.

import { effectiveChannels } from "../../lib/plotdata";
import { useActiveDataset, useApp } from "../../store/useApp";
import { Button, Card, IconButton } from "../primitives";

function openSeriesProperties(channel: number): void {
  const row = document.getElementById(`series-style-${channel}`) as HTMLDetailsElement | null;
  if (row) {
    row.open = true;
    row.scrollIntoView({ block: "nearest" });
  }
}

export default function PlotObjectsCard() {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const y2Keys = useApp((s) => s.y2Keys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const hidden = useApp((s) => s.hiddenChannels);
  const showLegend = useApp((s) => s.showLegend);
  const annotations = useApp((s) => s.annotations);
  const shapes = useApp((s) => s.shapes);
  const selectedAnnotationId = useApp((s) => s.selectedAnnotationId);
  const selectedShapeId = useApp((s) => s.selectedShapeId);
  const setShowLegend = useApp((s) => s.setShowLegend);
  const toggleHidden = useApp((s) => s.toggleHidden);
  const setSeriesOrder = useApp((s) => s.setSeriesOrder);
  const setY2Keys = useApp((s) => s.setY2Keys);
  const setSelectedAnnotationId = useApp((s) => s.setSelectedAnnotationId);
  const setSelectedShapeId = useApp((s) => s.setSelectedShapeId);
  const addAnnotation = useApp((s) => s.addAnnotation);
  const removeAnnotation = useApp((s) => s.removeAnnotation);
  const addShape = useApp((s) => s.addShape);
  const removeShape = useApp((s) => s.removeShape);
  const setStatus = useApp((s) => s.setStatus);

  if (!active) return null;
  const channels = effectiveChannels(active.data, yKeys, xKey, active.channelRoles, seriesOrder);

  const moveCurve = (channel: number, delta: -1 | 1) => {
    const order = [...channels];
    const i = order.indexOf(channel);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setSeriesOrder(order);
  };

  const toggleCurveAxis = (channel: number) => {
    const next = new Set(y2Keys ?? []);
    if (next.has(channel)) next.delete(channel);
    else next.add(channel);
    setY2Keys(next.size ? [...next] : null);
  };

  return (
    <Card title="Plot objects" count={channels.length + annotations.length + shapes.length + 3} defaultOpen={false}>
      <div className="qz-hint" style={{ marginBottom: 6 }}>
        Select an annotation or shape here to select it on the canvas.
      </div>

      <div className="qz-meta-row"><span className="qz-k">Axes</span><span className="qz-v">X · Y{y2Keys?.length ? " · Y2" : ""}</span></div>
      <div className="qz-meta-row" style={{ display: "flex", alignItems: "center" }}>
        <button className="qzk-tool-btn" aria-pressed={showLegend} onClick={() => setShowLegend(!showLegend)}>Legend</button>
        <span style={{ marginLeft: "auto", color: "var(--text-faint)" }}>{showLegend ? "visible" : "hidden"}</span>
      </div>

      <div className="qzk-field-lbl" style={{ marginTop: 8 }}>Curves</div>
      {channels.map((channel, i) => (
        <div key={channel} className="qz-meta-row" style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <button
            className="qzk-tool-btn"
            aria-label={`${hidden.includes(channel) ? "Show" : "Hide"} ${active.data.labels[channel]}`}
            aria-pressed={!hidden.includes(channel)}
            onClick={() => toggleHidden(channel)}
          >{hidden.includes(channel) ? "○" : "●"}</button>
          <span className="qz-v" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
            {active.data.labels[channel] ?? `Channel ${channel + 1}`}
          </span>
          <IconButton title="Move up" disabled={i === 0} onClick={() => moveCurve(channel, -1)}>↑</IconButton>
          <IconButton title="Move down" disabled={i === channels.length - 1} onClick={() => moveCurve(channel, 1)}>↓</IconButton>
          <Button size="sm" onClick={() => toggleCurveAxis(channel)}>{y2Keys?.includes(channel) ? "Y2" : "Y"}</Button>
          <IconButton title="Properties" onClick={() => openSeriesProperties(channel)}>⚙</IconButton>
        </div>
      ))}

      <div className="qzk-field-lbl" style={{ marginTop: 8 }}>Annotations</div>
      {annotations.map((a) => (
        <div key={a.id} className="qz-meta-row" style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <button
            className="qzk-tool-btn"
            aria-pressed={selectedAnnotationId === a.id}
            onClick={() => { setSelectedShapeId(null); setSelectedAnnotationId(a.id); }}
            style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", textAlign: "left" }}
          >{a.text}</button>
          <IconButton title="Duplicate" onClick={() => addAnnotation(a.x, a.y, a.text)}>⧉</IconButton>
          <IconButton title="Properties" onClick={() => { setSelectedAnnotationId(a.id); setStatus("Annotation selected; edit it in Annotations below"); }}>⚙</IconButton>
          <IconButton title="Delete" onClick={() => removeAnnotation(a.id)}>×</IconButton>
        </div>
      ))}

      <div className="qzk-field-lbl" style={{ marginTop: 8 }}>Shapes</div>
      {shapes.map((shape) => (
        <div key={shape.id} className="qz-meta-row" style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <button
            className="qzk-tool-btn"
            aria-pressed={selectedShapeId === shape.id}
            onClick={() => { setSelectedAnnotationId(null); setSelectedShapeId(shape.id); }}
            style={{ flex: 1, textAlign: "left" }}
          >{shape.kind}</button>
          <IconButton title="Duplicate" onClick={() => { const { id: _id, ...copy } = shape; addShape(copy); }}>⧉</IconButton>
          <IconButton title="Properties" onClick={() => { setSelectedShapeId(shape.id); setStatus("Shape selected; edit it in Shapes below"); }}>⚙</IconButton>
          <IconButton title="Delete" onClick={() => removeShape(shape.id)}>×</IconButton>
        </div>
      ))}
    </Card>
  );
}
