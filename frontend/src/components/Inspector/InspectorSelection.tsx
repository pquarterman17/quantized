// UX-A: the top of the Inspector on the Plot tab — names what is selected
// (a curve, an axis, the legend, an annotation or a shape) in a polite live
// region, lets a keyboard user pick any plot object from a list (the canvas
// click is mouse-only), and shows the selection's own controls when they are
// not a whole card: the legend's, or an axis' key fields (AxisQuickFields).
// A curve, axis, annotation or shape also hoists its card to just below this
// section (Inspector.tsx).
//
// Plan item 50 (OG23): while `objectEditorMode` is "popup", a selected axis,
// curve or legend shows its name and one Edit… button (its popup) instead;
// the quick fields and legend controls stay in the tree for "panel" mode.

import { useMemo } from "react";

import { objectEditorIsPopup } from "../../lib/objectEditorMode";
import { effectiveChannels } from "../../lib/plotdata";
import type { Dataset } from "../../lib/types";
import {
  clearAllSelection,
  parseSelectionKey,
  selectPlotObject,
  selectionKey,
  usePlotSelection,
} from "../../store/plotSelection";
import { openFigureDialog, type FigureDialog } from "../../store/figureDialogs";
import { useApp } from "../../store/useApp";
import { IconButton } from "../primitives/IconButton";
import { Select } from "../primitives";
import AxisQuickFields, { AXIS_NAMES } from "./AxisQuickFields";
import LegendControls from "./LegendControls";
import "./inspectorSelection.css";

/** The `<select>` value standing for an annotation / shape selection. */
const OBJECT = "object";

export default function InspectorSelection({ active }: { active: Dataset }) {
  // Popup mode: an axis, a curve and the legend are named here and edited
  // through Edit… (the popup the double-click and right-click menu open).
  const popup = objectEditorIsPopup();
  const sel = usePlotSelection((s) => s.sel);
  const onCanvas = usePlotSelection((s) => s.onCanvas);
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

  // Only what this view can select: a polar / statistics / multi-panel view
  // has no on-plot selection, so its picker lists no plot objects.
  const options = [
    { value: "", label: "Nothing selected" },
    ...(objectName ? [{ value: OBJECT, label: objectName }] : []),
    ...(onCanvas
      ? [
          ...channels.map((c) => ({ value: `series:${c}`, label: curveName(c) })),
          { value: "axis:x", label: AXIS_NAMES.x },
          { value: "axis:y", label: AXIS_NAMES.y },
          ...(hasY2 ? [{ value: "axis:y2", label: AXIS_NAMES.y2 }] : []),
          ...(showLegend || sel?.kind === "legend" ? [{ value: "legend", label: "Legend" }] : []),
        ]
      : []),
  ];
  const value = objectName ? OBJECT : selectionKey(sel);
  const popupOf: FigureDialog =
    objectName || !sel
      ? null
      : sel.kind === "series"
        ? { kind: "plotDetails", channel: sel.channel }
        : sel.kind === "axis"
          ? { kind: "axis", axis: sel.axis }
          : { kind: "legend" };

  return (
    <section className="qzk-inspector-selection" aria-label="Selection" data-selected={name ? value : undefined}>
      <div className="qzk-sel-head">
        <span className="qzk-field-lbl">Selected</span>
        <strong className="qzk-sel-name" role="status" aria-live="polite" title={name ?? undefined}>
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
        <p className="qzk-ds-meta qzk-sel-hint">
          {onCanvas
            ? popup
              ? "Click a curve, axis or legend on the plot (Pointer tool), then Edit… (or double-click it)."
              : "Click a curve, axis or legend on the plot (Pointer tool) to edit it here."
            : "This view has no on-plot selection; its settings are in the cards below."}
        </p>
      )}
      {popup && popupOf && (
        <button type="button" className="qz-btn" title={`Edit ${name} (or double-click it on the plot)`} onClick={() => openFigureDialog(popupOf)}>
          Edit…
        </button>
      )}
      {!popup && sel?.kind === "legend" && !objectName && (
        <div className="qzk-sel-fields">
          <LegendControls />
        </div>
      )}
      {!popup && sel?.kind === "axis" && !objectName && <AxisQuickFields key={sel.axis} axis={sel.axis} />}
    </section>
  );
}
