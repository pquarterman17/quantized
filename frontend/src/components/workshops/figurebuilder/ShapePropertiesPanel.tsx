// Per-shape properties for the canonical Publication Preview draft (F2.3c):
// the four coordinates, stroke/fill color, opacity, width, and a dash
// toggle -- the same `Shape` fields `Stage/useShapeEdit.ts`'s right-click
// object menu and `Inspector/ShapesCard.tsx` already edit on the Stage, now
// reachable on the detached draft without touching the Stage (the F2.3b/
// SeriesPropertiesPanel precedent, applied to shapes). Kind is READ-ONLY
// here (glyph + kind-scoped label only) -- no surface in this app, Stage
// included, ever changes an EXISTING shape's kind after it's drawn (only the
// draw-tool picks a kind up front); adding kind-mutation only in this
// detached panel would be a new capability with no Stage equivalent to stay
// consistent with, so it stays out rather than half-diverge. Coordinates
// reuse PropertyNumberField's unfinished-typing-safe pattern (`required` --
// a cleared/invalid coordinate keeps its last value, same as ShapesCard's
// intent but without the raw-NumberField reset-to-empty gap). Opacity/width
// are free-typed numeric fields here, not the Stage menu's 3/4-step presets
// -- `Shape.opacity`/`.width` are plain numbers and a "full parity" panel
// should reach any of them, not just the menu's coarse shortcuts.

import { useRef } from "react";

import { deriveShapeRows, SHAPE_KIND_GLYPH, shapeSupportsFill } from "./canonicalShapes";
import { absorbStrayDeleteOnContainer, removeRowSafely } from "../../../lib/focusGuard";
import type { Shape } from "../../../lib/types";
import { resolveShapeOpacity } from "../../../lib/uplotShapes";
import { Checkbox } from "../../primitives/Checkbox";
import { IconButton } from "../../primitives/IconButton";
import PropertyNumberField from "./PropertyNumberField";

const PALETTE = [1, 2, 3, 4, 5, 6, 7, 8];

function ColorField({
  fieldLabel,
  ariaLabel,
  value,
  resetLabel,
  onChange,
}: {
  fieldLabel: string;
  ariaLabel: string;
  value: string | undefined;
  /** Label + swatch for clearing back to the field's own resolved default
   *  (plot ink color for stroke; the shape's own stroke for fill). */
  resetLabel: string;
  onChange: (next: string | undefined) => void;
}) {
  const customHex = value && !value.startsWith("--") ? value : "#8b5cf6";
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <label className="qzk-field-lbl">{fieldLabel}</label>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {PALETTE.map((n) => {
          const token = `--series-${n}`;
          return (
            <button
              key={n}
              aria-label={`${ariaLabel} preset ${n}`}
              aria-pressed={value === token}
              onClick={() => onChange(token)}
              style={{
                width: 16,
                height: 16,
                borderRadius: 3,
                background: `var(${token})`,
                border: value === token ? "2px solid var(--text)" : "1px solid var(--border)",
              }}
            />
          );
        })}
        <button
          aria-label={`${ariaLabel}: ${resetLabel}`}
          title={resetLabel}
          aria-pressed={value == null}
          onClick={() => onChange(undefined)}
          style={{
            width: 16,
            height: 16,
            borderRadius: 3,
            background: "var(--text)",
            border: value == null ? "2px solid var(--accent)" : "1px solid var(--border)",
          }}
        />
        <input
          type="color"
          aria-label={ariaLabel}
          value={customHex}
          onChange={(event) => onChange(event.target.value)}
          style={{ width: 22, height: 20, padding: 0, border: "1px solid var(--border)" }}
        />
      </div>
    </span>
  );
}

export default function ShapePropertiesPanel({
  shapes,
  onStyle,
  onRemove,
}: {
  /** The draft's shapes, in draw order. Rows (kind-scoped display labels)
   *  are derived from this same array internally -- see canonicalShapes.ts's
   *  `deriveShapeRows`. */
  shapes: readonly Shape[];
  onStyle: (id: string, patch: Partial<Omit<Shape, "id">>) => void;
  onRemove: (id: string) => void;
}) {
  const rows = deriveShapeRows(shapes);
  // Focus-safety anchor (lib/focusGuard) — a remove ✕ below unmounts its own
  // row; without this, focus falls to <body> and a follow-up Delete
  // keystroke deletes the ACTIVE DATASET instead (see focusGuard's doc).
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    // tabIndex=-1: invisible, programmatic-only focus anchor. Not a new Tab stop.
    <div ref={containerRef} tabIndex={-1} onKeyDown={absorbStrayDeleteOnContainer} style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      {rows.map((row, i) => {
        const shape = shapes[i];
        if (!shape) return null;
        const canFill = shapeSupportsFill(shape.kind);
        return (
          <div
            key={row.id}
            style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", paddingBottom: 6, borderBottom: "1px solid var(--border)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden="true">{SHAPE_KIND_GLYPH[shape.kind]}</span>
              <span className="qz-v" style={{ flex: 1 }}>{row.label}</span>
              <IconButton
                title="Remove"
                aria-label={`Remove ${row.label}`}
                onClick={() => removeRowSafely(containerRef.current, () => onRemove(row.id))}
              >
                ✕
              </IconButton>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
              <PropertyNumberField
                label="x1" ariaLabel={`${row.label} x1`} value={shape.x1} required
                onValue={(x1) => x1 === undefined ? undefined : onStyle(row.id, { x1 })}
              />
              <PropertyNumberField
                label="y1" ariaLabel={`${row.label} y1`} value={shape.y1} required
                onValue={(y1) => y1 === undefined ? undefined : onStyle(row.id, { y1 })}
              />
              <PropertyNumberField
                label="x2" ariaLabel={`${row.label} x2`} value={shape.x2} required
                onValue={(x2) => x2 === undefined ? undefined : onStyle(row.id, { x2 })}
              />
              <PropertyNumberField
                label="y2" ariaLabel={`${row.label} y2`} value={shape.y2} required
                onValue={(y2) => y2 === undefined ? undefined : onStyle(row.id, { y2 })}
              />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
              <ColorField
                fieldLabel="stroke" ariaLabel={`${row.label} stroke`} value={shape.stroke}
                resetLabel="Default (plot ink color)"
                onChange={(stroke) => onStyle(row.id, { stroke })}
              />
              {canFill && (
                <ColorField
                  fieldLabel="fill" ariaLabel={`${row.label} fill`} value={shape.fill}
                  resetLabel="Default (match stroke)"
                  onChange={(fill) => onStyle(row.id, { fill })}
                />
              )}
              <PropertyNumberField
                label="opacity" ariaLabel={`${row.label} opacity`} value={shape.opacity} min={0} max={1}
                onValue={(opacity) => onStyle(row.id, { opacity })}
              />
              <PropertyNumberField
                label="width" ariaLabel={`${row.label} width`} value={shape.width} min={0}
                onValue={(width) => onStyle(row.id, { width })}
              />
              <Checkbox checked={!!shape.dash} onChange={(dash) => onStyle(row.id, { dash })}>
                dashed
              </Checkbox>
            </div>
            <div className="qzk-ds-meta">{`resolved opacity: ${resolveShapeOpacity(shape)}`}</div>
          </div>
        );
      })}
    </div>
  );
}
