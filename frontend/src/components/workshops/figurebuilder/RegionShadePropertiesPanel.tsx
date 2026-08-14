// Region-shade properties for the canonical Publication Preview draft
// (F2.3j, owner decision 2026-08-13 — decoded film-stack shades are EDITABLE
// plot objects, not immutable provenance): per-shade coordinates/fill/axis
// and remove, plus an Add form -- the same operations
// `Inspector/RegionShadesCard.tsx` offers on the Stage, now reachable on the
// detached draft without touching the Stage (the F2.3d precedent: a shade is
// fully specified by numbers, so it needs no live canvas to draw on -- ADD
// belongs here, like RefLinePropertiesPanel and unlike ShapePropertiesPanel).
// Per-row fields reuse PropertyNumberField's unfinished-typing-safe pattern
// (`required`), the same convention ShapePropertiesPanel's x1..y2 fields use.
//
// Unlike F2.3d's reference lines, AXIS is editable per row here, not fixed
// at Add time -- see RegionShadesCard.tsx's doc for why (no prior "nothing
// in the app flips this" history to preserve for a brand-new editing
// surface, and the plan's pointer-default rule).

import { useState } from "react";

import { deriveRegionShadeRows } from "./canonicalRegionShades";
import type { RegionShade } from "../../../lib/types";
import { Button, IconButton, NumberField, SegmentedControl } from "../../primitives";
import PropertyNumberField from "./PropertyNumberField";

const DEFAULT_FILL = "#3388cc";
type AxisChoice = "y" | "y2";
const axisOf = (v: 0 | 1 | undefined): AxisChoice => (v === 1 ? "y2" : "y");
const AXIS_OPTIONS: { value: AxisChoice; label: string }[] = [
  { value: "y", label: "Y" },
  { value: "y2", label: "Y2" },
];

export default function RegionShadePropertiesPanel({
  regionShades,
  onPatch,
  onAdd,
  onRemove,
}: {
  /** The draft's region shades, in their own array order. Rows (display
   *  labels) derive from this same array -- see canonicalRegionShades.ts. */
  regionShades: readonly RegionShade[];
  onPatch: (id: string, patch: Partial<Omit<RegionShade, "id">>) => void;
  onAdd: (shade: Omit<RegionShade, "id">) => void;
  onRemove: (id: string) => void;
}) {
  const [x1, setX1] = useState("0");
  const [y1, setY1] = useState("0");
  const [x2, setX2] = useState("1");
  const [y2, setY2] = useState("1");
  const [fill, setFill] = useState(DEFAULT_FILL);
  const [axis, setAxis] = useState<AxisChoice>("y");
  const coords = [x1, y1, x2, y2].map(Number);
  // Same validity rule the store enforces (appendRegionShade rejects any
  // non-finite coordinate): a broken shade renders nowhere and would
  // serialize as `null` over the export wire, so the button explains itself
  // rather than accepting a no-op. Matches RefLinePropertiesPanel's addReason.
  const addReason: string | null = [x1, y1, x2, y2].some((v) => v.trim() === "")
    ? "enter every coordinate"
    : coords.some((n) => !Number.isFinite(n))
      ? "coordinates must be numbers"
      : null;
  const rows = deriveRegionShadeRows(regionShades);
  const commitAdd = () => {
    if (addReason !== null) return;
    const [nx1, ny1, nx2, ny2] = coords;
    onAdd({ x1: nx1, y1: ny1, x2: nx2, y2: ny2, fill, ...(axis === "y2" ? { axis: 1 } : {}) });
    setX1("0"); setY1("0"); setX2("1"); setY2("1");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      {rows.map((row, index) => {
        const sh = regionShades[index];
        if (!sh) return null;
        return (
          <div
            key={row.id}
            style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", paddingBottom: 6, borderBottom: "1px solid var(--border)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="qz-v" style={{ flex: 1 }}>{row.short}</span>
              <IconButton title="Remove" aria-label={`Remove ${row.label}`} onClick={() => onRemove(row.id)}>
                ✕
              </IconButton>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
              <PropertyNumberField
                label="x1" ariaLabel={`${row.label} x1`} value={sh.x1} required
                onValue={(v) => (v === undefined ? undefined : onPatch(row.id, { x1: v }))}
              />
              <PropertyNumberField
                label="y1" ariaLabel={`${row.label} y1`} value={sh.y1} required
                onValue={(v) => (v === undefined ? undefined : onPatch(row.id, { y1: v }))}
              />
              <PropertyNumberField
                label="x2" ariaLabel={`${row.label} x2`} value={sh.x2} required
                onValue={(v) => (v === undefined ? undefined : onPatch(row.id, { x2: v }))}
              />
              <PropertyNumberField
                label="y2" ariaLabel={`${row.label} y2`} value={sh.y2} required
                onValue={(v) => (v === undefined ? undefined : onPatch(row.id, { y2: v }))}
              />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
              <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                <label className="qzk-field-lbl">fill</label>
                <input
                  type="color"
                  aria-label={`${row.label} fill`}
                  value={sh.fill}
                  onChange={(event) => onPatch(row.id, { fill: event.target.value })}
                  style={{ width: 22, height: 20, padding: 0, border: "1px solid var(--border)" }}
                />
              </span>
              <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                <label className="qzk-field-lbl">axis</label>
                <SegmentedControl<AxisChoice>
                  options={AXIS_OPTIONS}
                  value={axisOf(sh.axis)}
                  onChange={(next) => onPatch(row.id, { axis: next === "y2" ? 1 : 0 })}
                />
              </span>
            </div>
          </div>
        );
      })}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "end" }}>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">x1</label>
          {/* Enter commits, matching RefLinePropertiesPanel's own
              keyboard affordance -- any of the four fields can submit. */}
          <NumberField aria-label="new shade x1" value={x1} width={56} onChange={setX1} onKeyDown={(e) => e.key === "Enter" && commitAdd()} />
        </span>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">y1</label>
          <NumberField aria-label="new shade y1" value={y1} width={56} onChange={setY1} onKeyDown={(e) => e.key === "Enter" && commitAdd()} />
        </span>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">x2</label>
          <NumberField aria-label="new shade x2" value={x2} width={56} onChange={setX2} onKeyDown={(e) => e.key === "Enter" && commitAdd()} />
        </span>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">y2</label>
          <NumberField aria-label="new shade y2" value={y2} width={56} onChange={setY2} onKeyDown={(e) => e.key === "Enter" && commitAdd()} />
        </span>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">fill</label>
          <input
            type="color"
            aria-label="new shade fill"
            value={fill}
            onChange={(event) => setFill(event.target.value)}
            style={{ width: 22, height: 20, padding: 0, border: "1px solid var(--border)" }}
          />
        </span>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">axis</label>
          <SegmentedControl<AxisChoice> options={AXIS_OPTIONS} value={axis} onChange={setAxis} />
        </span>
        <span title={addReason ?? "Add a filled region shade at these coordinates"}>
          <Button size="sm" disabled={addReason !== null} onClick={commitAdd}>
            Add
          </Button>
        </span>
        {/* Only the "not a number" reason shows a message -- a blank field
            (still the default, or freshly cleared) stays silent, matching
            RefLinePropertiesPanel's "don't shout at an untouched field". */}
        {addReason === "coordinates must be numbers" && (
          <div className="qzk-ds-meta" style={{ color: "var(--text-dim)", width: "100%" }}>{addReason}</div>
        )}
      </div>
    </div>
  );
}
