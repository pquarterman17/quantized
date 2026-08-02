import { useState } from "react";

import type { FigureOverrides } from "../../../lib/figureOverrides";
import { NumberField, Select } from "../../primitives";
import PropertyNumberField from "./PropertyNumberField";

type Annotation = NonNullable<FigureOverrides["annotations"]>[number];
type AnnotationFrame = NonNullable<Annotation["frame"]>;

function withoutUndefined<T extends Record<string, unknown>>(value: T): T | undefined {
  return Object.values(value).some((item) => item !== undefined) ? value : undefined;
}

/** In-place editor for the existing publication annotation override contract. */
export default function AnnotationEditor({
  annotations,
  onChange,
}: {
  annotations: Annotation[];
  onChange: (annotations: Annotation[]) => void;
}) {
  const [annText, setAnnText] = useState("");
  const [annX, setAnnX] = useState("");
  const [annY, setAnnY] = useState("");
  const updateAnnotation = (index: number, change: Partial<Annotation>) =>
    onChange(annotations.map((annotation, current) =>
      current === index ? { ...annotation, ...change } : annotation,
    ));
  const updateAnnotationFrame = (index: number, change: Partial<AnnotationFrame>) => {
    const annotation = annotations[index];
    if (!annotation) return;
    updateAnnotation(index, { frame: withoutUndefined({ ...annotation.frame, ...change }) });
  };

  return (
    <>
      {annotations.map((annotation, index) => (
        <div key={index} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "end", width: "100%", paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
          <span className="qzk-ds-meta" style={{ width: "100%" }}>Annotation {index + 1}</span>
          <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
            {/* The "Annotation N" header above already carries the ordinal —
                visible field labels drop the repeated "annotation N " prefix
                (9 fields per annotation in a ~200px column) while aria-label
                keeps the full, unique string for getByLabelText/screen readers. */}
            <label className="qzk-field-lbl">text</label>
            <NumberField
              aria-label={`annotation ${index + 1} text`}
              numeric={false}
              width={150}
              value={annotation.text}
              onChange={(text) => updateAnnotation(index, { text })}
            />
          </span>
          <PropertyNumberField
            label="x"
            ariaLabel={`annotation ${index + 1} x`}
            value={annotation.x}
            required
            onValue={(x) => x === undefined ? undefined : updateAnnotation(index, { x })}
          />
          <PropertyNumberField
            label="y"
            ariaLabel={`annotation ${index + 1} y`}
            value={annotation.y}
            required
            onValue={(y) => y === undefined ? undefined : updateAnnotation(index, { y })}
          />
          <PropertyNumberField
            label="font size"
            ariaLabel={`annotation ${index + 1} font size`}
            value={annotation.size}
            min={1}
            onValue={(size) => updateAnnotation(index, { size })}
          />
          <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
            <label className="qzk-field-lbl">anchor</label>
            <Select
              aria-label={`annotation ${index + 1} anchor`}
              value={annotation.anchor ?? "data"}
              options={[
                { value: "data", label: "data coordinates" },
                { value: "page", label: "page fraction" },
              ]}
              onChange={(event) => updateAnnotation(index, { anchor: event.target.value === "page" ? "page" : undefined })}
            />
          </span>
          <span className="qzk-ds-meta" style={{ width: "100%" }}>Text box frame</span>
          <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
            <label className="qzk-field-lbl">frame fill</label>
            <NumberField
              aria-label={`annotation ${index + 1} frame fill`}
              title='CSS or matplotlib color: a name ("red") or hex ("#d33")'
              numeric={false}
              width={96}
              value={annotation.frame?.fill ?? ""}
              placeholder="(none)"
              onChange={(fill) => updateAnnotationFrame(index, { fill: fill.trim() || undefined })}
            />
          </span>
          <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
            <label className="qzk-field-lbl">frame stroke</label>
            <NumberField
              aria-label={`annotation ${index + 1} frame stroke`}
              title='CSS or matplotlib color: a name ("red") or hex ("#d33")'
              numeric={false}
              width={96}
              value={annotation.frame?.stroke ?? ""}
              placeholder="(none)"
              onChange={(stroke) => updateAnnotationFrame(index, { stroke: stroke.trim() || undefined })}
            />
          </span>
          <PropertyNumberField
            label="frame opacity"
            ariaLabel={`annotation ${index + 1} frame opacity`}
            value={annotation.frame?.opacity}
            min={0}
            max={1}
            onValue={(opacity) => updateAnnotationFrame(index, { opacity })}
          />
          <PropertyNumberField
            label="frame padding"
            ariaLabel={`annotation ${index + 1} frame padding`}
            value={annotation.frame?.pad}
            min={0}
            onValue={(pad) => updateAnnotationFrame(index, { pad })}
          />
          <button
            className="qz-btn qz-ghost qz-sm"
            aria-label={`Remove annotation ${index + 1}`}
            title="Remove annotation"
            onClick={() => onChange(annotations.filter((_, current) => current !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <NumberField
        aria-label="new annotation text"
        numeric={false}
        width={110}
        value={annText}
        placeholder="text"
        onChange={setAnnText}
      />
      <NumberField aria-label="new annotation x" value={annX} width={56} placeholder="x" onChange={setAnnX} />
      <NumberField aria-label="new annotation y" value={annY} width={56} placeholder="y" onChange={setAnnY} />
      <button
        className="qz-btn qz-sm"
        disabled={
          !annText.trim() ||
          !annX.trim() ||
          !annY.trim() ||
          !Number.isFinite(Number(annX)) ||
          !Number.isFinite(Number(annY))
        }
        onClick={() => {
          onChange([...annotations, { x: Number(annX), y: Number(annY), text: annText.trim() }]);
          setAnnText("");
          setAnnX("");
          setAnnY("");
        }}
      >
        + Add
      </button>
    </>
  );
}
