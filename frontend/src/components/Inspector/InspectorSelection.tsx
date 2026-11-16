// UX-A: the top of the Inspector on the Plot tab — names what is selected
// (a curve, an axis, the legend, an annotation or a shape), lets a keyboard
// user pick any plot object from a list (the canvas click is mouse-only), and
// shows the selection's own controls when they are not a whole card. A curve,
// axis, annotation or shape hoists its card to just below this section
// instead (Inspector.tsx), so no control exists twice.

import { useMemo } from "react";

import { effectiveChannels } from "../../lib/plotdata";
import type { Dataset } from "../../lib/types";
import { openFigureDialog, type AxisId } from "../../store/figureDialogs";
import { clearAllSelection, parseSelectionKey, selectPlotObject, selectionKey, usePlotSelection } from "../../store/plotSelection";
import { useApp } from "../../store/useApp";
import { IconButton } from "../primitives/IconButton";
import { Select } from "../primitives";
import LegendControls from "./LegendControls";

const AXIS_NAMES: Record<AxisId, string> = { x: "X axis", y: "Y axis", y2: "Y2 (right) axis" };
/** The `<select>` value standing for an annotation / shape selection. */
const OBJECT = "object";

export default function InspectorSelection({ active }: { active: Dataset }) {
  const sel = usePlotSelection((s) => s.sel);
  const annotation = useApp((s) => s.annotations.find((a) => a.id === s.selectedAnnotationId));
  const shape = useApp((s) => s.shapes.find((x) => x.id === s.selectedShapeId));
  const hasY2 = useApp((s) => (s.y2Keys?.length ?? 0) > 0);
  const showLegend = useApp((s) => s.showLegend);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const { data, channelRoles } = active;
  const channels = useMemo(
    () => effectiveChannels(data, yKeys, xKey, channelRoles, seriesOrder),
    [data, channelRoles, yKeys, xKey, seriesOrder],
  );
  const curveName = (c: number) => `Curve: ${data.labels[c] ?? `channel ${c + 1}`}`;

  const objectName = annotation
    ? `Annotation “${annotation.text || "(empty)"}”`
    : shape
      ? `Shape (${shape.kind})`
      : null;
  const name =
    objectName ??
    (sel?.kind === "series" ? curveName(sel.channel) : sel?.kind === "axis" ? AXIS_NAMES[sel.axis] : sel ? "Legend" : null);

  const options = [
    { value: "", label: "Nothing selected" },
    ...(objectName ? [{ value: OBJECT, label: objectName }] : []),
    ...channels.map((c) => ({ value: `series:${c}`, label: curveName(c) })),
    { value: "axis:x", label: AXIS_NAMES.x },
    { value: "axis:y", label: AXIS_NAMES.y },
    ...(hasY2 ? [{ value: "axis:y2", label: AXIS_NAMES.y2 }] : []),
    ...(showLegend || sel?.kind === "legend" ? [{ value: "legend", label: "Legend" }] : []),
  ];
  const value = objectName ? OBJECT : selectionKey(sel);

  return (
    <section className="qzk-inspector-selection" aria-label="Selection" data-selected={name ? value : undefined}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          Selected
        </span>
        <strong style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name ?? undefined}>
          {name ?? "Nothing"}
        </strong>
        {name && (
          <IconButton aria-label="Clear selection" title="Clear selection (Esc)" onClick={clearAllSelection}>
            ×
          </IconButton>
        )}
      </div>
      <Select
        aria-label="Select plot object"
        options={options}
        value={value}
        onChange={(e) => {
          if (e.target.value === OBJECT) return;
          const next = parseSelectionKey(e.target.value);
          if (next) selectPlotObject(next);
          else clearAllSelection();
        }}
      />
      {!name && (
        <p className="qzk-ds-meta" style={{ margin: "6px 0 0", whiteSpace: "normal" }}>
          Click a curve, axis or legend on the plot (Pointer tool) to edit it here.
        </p>
      )}
      {sel?.kind === "legend" && !objectName && (
        <div style={{ marginTop: 6 }}>
          <LegendControls />
        </div>
      )}
      {sel?.kind === "axis" && !objectName && (
        <button
          type="button"
          className="qz-btn"
          style={{ marginTop: 6 }}
          onClick={() => openFigureDialog({ kind: "axis", axis: sel.axis })}
        >
          {AXIS_NAMES[sel.axis]} settings…
        </button>
      )}
    </section>
  );
}
