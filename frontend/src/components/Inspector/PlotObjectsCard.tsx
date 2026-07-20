// Plot Objects inspector (GUI_INTERACTION_PLAN #2): one compact tree over the
// active graph's axes, legend, curves, annotations, and shapes. Curve removal
// is intentionally NON-DESTRUCTIVE visibility (a curve is a dataset channel,
// not an owned copy of data); graphic objects expose real duplicate/delete.

import { useEffect, useRef, useState } from "react";

import {
  annotationKey,
  layoutPlotObjects,
  shapeKey,
  type LayoutCommand,
  type PlotObjectKey,
} from "../../lib/plotObjectLayout";
import { effectiveChannels } from "../../lib/plotdata";
import type { Annotation, Shape } from "../../lib/types";
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
  const [selection, setSelection] = useState<Set<PlotObjectKey>>(new Set());
  const [sharedColor, setSharedColor] = useState("#2563eb");
  const [sharedOpacity, setSharedOpacity] = useState(1);
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
  const editPlotObjects = useApp((s) => s.editPlotObjects);
  const setStatus = useApp((s) => s.setStatus);

  // Sync the checkbox working-set to a CANVAS single-selection (click an
  // object on the plot -> its group expands here). This must fire ONLY when
  // the canvas selection id actually changes, NOT whenever the annotations/
  // shapes arrays mutate: a bulk align/style edit changes those array refs,
  // and re-running the sync then collapsed a multi-selection the user had
  // built via checkboxes back down to the single canvas anchor — silently
  // dropping members from the next bulk command. The ref gate is what stops
  // that; annotations/shapes stay in deps only so the group lookup reads
  // current data on the runs that DO fire.
  const lastCanvasSel = useRef<{ a: string | null; s: string | null }>({ a: null, s: null });
  useEffect(() => {
    if (lastCanvasSel.current.a === selectedAnnotationId && lastCanvasSel.current.s === selectedShapeId) {
      return;
    }
    lastCanvasSel.current = { a: selectedAnnotationId, s: selectedShapeId };
    const a = annotations.find((item) => item.id === selectedAnnotationId);
    const shape = shapes.find((item) => item.id === selectedShapeId);
    const groupId = a?.groupId ?? shape?.groupId;
    if (groupId) {
      setSelection(new Set([
        ...annotations.filter((item) => item.groupId === groupId).map((item) => annotationKey(item.id)),
        ...shapes.filter((item) => item.groupId === groupId).map((item) => shapeKey(item.id)),
      ]));
    } else if (a) setSelection(new Set([annotationKey(a.id)]));
    else if (shape) setSelection(new Set([shapeKey(shape.id)]));
  }, [annotations, selectedAnnotationId, selectedShapeId, shapes]);

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

  const toggleObject = (key: PlotObjectKey) => {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const runLayout = (command: LayoutCommand) => {
    const result = layoutPlotObjects(annotations, shapes, selection, command);
    if (result.error) return setStatus(result.error);
    editPlotObjects(
      command.startsWith("distribute") ? "distribute plot objects" : "align plot objects",
      result.annotations,
      result.shapes,
    );
  };

  const groupSelection = () => {
    if (selection.size < 2) return setStatus("Select at least two objects to group");
    const groupId = `object-group-${Date.now().toString(36)}`;
    const annotationPatches: Record<string, Partial<Omit<Annotation, "id">>> = {};
    const shapePatches: Record<string, Partial<Omit<Shape, "id">>> = {};
    for (const key of selection) {
      const [type, id] = key.split(":", 2);
      if (type === "annotation") annotationPatches[id] = { groupId };
      else shapePatches[id] = { groupId };
    }
    editPlotObjects("group plot objects", annotationPatches, shapePatches);
    setStatus(`Grouped ${selection.size} objects`);
  };

  const ungroupSelection = () => {
    const groupIds = new Set<string>();
    for (const a of annotations) if (selection.has(annotationKey(a.id)) && a.groupId) groupIds.add(a.groupId);
    for (const shape of shapes) if (selection.has(shapeKey(shape.id)) && shape.groupId) groupIds.add(shape.groupId);
    if (!groupIds.size) return setStatus("The selection is not grouped");
    const annotationPatches: Record<string, Partial<Omit<Annotation, "id">>> = {};
    const shapePatches: Record<string, Partial<Omit<Shape, "id">>> = {};
    for (const a of annotations) if (a.groupId && groupIds.has(a.groupId)) annotationPatches[a.id] = { groupId: undefined };
    for (const shape of shapes) if (shape.groupId && groupIds.has(shape.groupId)) shapePatches[shape.id] = { groupId: undefined };
    editPlotObjects("ungroup plot objects", annotationPatches, shapePatches);
  };

  const applySharedStyle = () => {
    const annotationPatches: Record<string, Partial<Omit<Annotation, "id">>> = {};
    const shapePatches: Record<string, Partial<Omit<Shape, "id">>> = {};
    for (const a of annotations) {
      // Recolor an annotation's text box ONLY if it already HAS one. An
      // annotation's only strokeable geometry is its `frame` (the MAIN #27
      // text box); patching `frame` on a frameless annotation would spawn a
      // visible box it never had — recolor existing geometry, never add new.
      if (selection.has(annotationKey(a.id)) && a.frame) {
        annotationPatches[a.id] = { frame: { ...a.frame, stroke: sharedColor, opacity: sharedOpacity } };
      }
    }
    for (const shape of shapes) {
      if (selection.has(shapeKey(shape.id))) shapePatches[shape.id] = { stroke: sharedColor, opacity: sharedOpacity };
    }
    editPlotObjects("style plot objects", annotationPatches, shapePatches);
  };

  return (
    <Card title="Plot objects" count={channels.length + annotations.length + shapes.length + 3} defaultOpen={false}>
      <div className="qz-hint" style={{ marginBottom: 6 }}>
        Select several graphics to align, distribute, group, or style together.
      </div>

      {!!(annotations.length + shapes.length) && (
        <div style={{ display: "grid", gap: 5, marginBottom: 8 }}>
          <div className="qz-meta-row" style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            <span className="qz-k" style={{ marginRight: "auto" }}>{selection.size} selected</span>
            <Button size="sm" onClick={groupSelection}>Group</Button>
            <Button size="sm" onClick={ungroupSelection}>Ungroup</Button>
          </div>
          <div aria-label="Align selected objects" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3 }}>
            {([
              ["left", "Left"], ["hcenter", "H center"], ["right", "Right"],
              ["top", "Top"], ["vcenter", "V center"], ["bottom", "Bottom"],
              ["distribute-h", "Space H"], ["distribute-v", "Space V"],
            ] as const).map(([command, label]) => (
              <Button key={command} size="sm" onClick={() => runLayout(command)}>{label}</Button>
            ))}
          </div>
          <div className="qz-meta-row" style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <label className="qz-k" htmlFor="plot-object-color">Style</label>
            <input id="plot-object-color" aria-label="Shared color" type="color" value={sharedColor} onChange={(event) => setSharedColor(event.target.value)} />
            <input aria-label="Shared opacity" className="qz-input" type="number" min={0} max={1} step={0.1} value={sharedOpacity} onChange={(event) => setSharedOpacity(Math.min(1, Math.max(0, Number(event.target.value))))} style={{ width: 56 }} />
            <Button size="sm" disabled={!selection.size} onClick={applySharedStyle}>Apply</Button>
          </div>
        </div>
      )}

      {/* "On axes" not bare "Axes" — the latter collides with the Axes card's
          own title in the same Inspector (confusing to read, and it made an
          exact-text locator ambiguous). */}
      <div className="qz-meta-row"><span className="qz-k">On axes</span><span className="qz-v">X · Y{y2Keys?.length ? " · Y2" : ""}</span></div>
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
          <input
            type="checkbox"
            aria-label={`Select annotation ${a.text}`}
            checked={selection.has(annotationKey(a.id))}
            onChange={() => toggleObject(annotationKey(a.id))}
          />
          <button
            className="qzk-tool-btn"
            aria-pressed={selectedAnnotationId === a.id}
            onClick={() => { setSelection(new Set([annotationKey(a.id)])); setSelectedShapeId(null); setSelectedAnnotationId(a.id); }}
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
          <input
            type="checkbox"
            aria-label={`Select ${shape.kind} shape`}
            checked={selection.has(shapeKey(shape.id))}
            onChange={() => toggleObject(shapeKey(shape.id))}
          />
          <button
            className="qzk-tool-btn"
            aria-pressed={selectedShapeId === shape.id}
            onClick={() => { setSelection(new Set([shapeKey(shape.id)])); setSelectedAnnotationId(null); setSelectedShapeId(shape.id); }}
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
