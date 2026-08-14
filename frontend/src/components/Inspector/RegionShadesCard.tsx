// Inspector card: filled rectangular region shades (Origin `Rect*` bands —
// film-stack shading on an SLD profile, decode-plan #41). F2.3j (owner
// decision 2026-08-13): decoded shades are EDITABLE plot objects, not
// immutable provenance, so this card follows RefLinesCard's conventions —
// a shade is fully specified by numbers, so ADD belongs here (no live canvas
// needed) — plus ShapesCard's per-row editable coordinate fields, since a
// shade carries four coordinates and a fill color, not one value.
//
// Axis picks which Y scale y1/y2 are expressed in (0 = primary, 1 =
// secondary/y2) — editable per row, unlike RefLinesCard's axis (fixed at Add
// time): a region shade has no prior "nothing in the app flips this" history
// to preserve, and the plan's pointer-default rule wants every field on a
// freshly-editable plot object manipulable from day one. `SegmentedControl`
// is string-keyed, so the "y"/"y2" labels double as the axis's wire values.

import { useRef, useState } from "react";

import { absorbStrayDeleteOnContainer, removeRowSafely } from "../../lib/focusGuard";
import { useApp } from "../../store/useApp";
import { BufferedNumberField, Button, Card, IconButton, NumberField, SegmentedControl } from "../primitives";

const DEFAULT_FILL = "#3388cc";
type AxisChoice = "y" | "y2";
const axisOf = (v: 0 | 1 | undefined): AxisChoice => (v === 1 ? "y2" : "y");

export default function RegionShadesCard() {
  const regionShades = useApp((s) => s.regionShades);
  const addRegionShade = useApp((s) => s.addRegionShade);
  const updateRegionShade = useApp((s) => s.updateRegionShade);
  const removeRegionShade = useApp((s) => s.removeRegionShade);
  const [x1, setX1] = useState("0");
  const [y1, setY1] = useState("0");
  const [x2, setX2] = useState("1");
  const [y2, setY2] = useState("1");
  const [fill, setFill] = useState(DEFAULT_FILL);
  const [axis, setAxis] = useState<AxisChoice>("y");
  // Focus-safety anchor (lib/focusGuard) — a remove ✕ below unmounts its own
  // row; without this, focus falls to <body> and a follow-up Delete
  // keystroke deletes the ACTIVE DATASET instead (see focusGuard's doc).
  const containerRef = useRef<HTMLDivElement>(null);

  const coords = [x1, y1, x2, y2].map(Number);
  const addReason: string | null = [x1, y1, x2, y2].some((v) => v.trim() === "")
    ? "enter every coordinate"
    : coords.some((n) => !Number.isFinite(n))
      ? "coordinates must be numbers"
      : null;

  const add = () => {
    if (addReason !== null) return;
    const [nx1, ny1, nx2, ny2] = coords;
    addRegionShade({ x1: nx1, y1: ny1, x2: nx2, y2: ny2, fill, ...(axis === "y2" ? { axis: 1 } : {}) });
  };

  // Nudge one coordinate of one shade — the shared onValue body for all four
  // fields below (only the patched key differs), matching ShapesCard's
  // setCoord. Bound through BufferedNumberField (primitives), not a raw
  // NumberField straight to the store number: a controlled field with no
  // local buffer snaps back to the OLD digits on every unparseable
  // keystroke, so typing "-" then "5" to edit 1 into -5 silently produced 15
  // instead (the digit landed appended to the reverted "1"). BufferedNumberField
  // keeps the in-progress text visible until it resolves to a valid number.
  const setCoord = (id: string, key: "x1" | "y1" | "x2" | "y2") => (v: number | undefined) => {
    if (v !== undefined) updateRegionShade(id, { [key]: v });
  };

  const axisOptions: { value: AxisChoice; label: string }[] = [
    { value: "y", label: "Y" },
    { value: "y2", label: "Y2" },
  ];

  return (
    <Card title="Region shades" count={regionShades.length || undefined} defaultOpen={false}>
      {/* tabIndex=-1: an invisible, programmatic-only focus anchor — see
       *  lib/focusGuard's doc. Not a new Tab stop. onKeyDown absorbs a stray
       *  Delete/Backspace that lands here right after a removal, before it
       *  can bubble to useGlobalShortcuts' window listener. */}
      <div ref={containerRef} tabIndex={-1} onKeyDown={absorbStrayDeleteOnContainer}>
        {regionShades.map((sh) => (
          <div key={sh.id} className="qz-meta-row" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span className="qz-k" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="color"
                aria-label="Fill color"
                value={sh.fill}
                onChange={(e) => updateRegionShade(sh.id, { fill: e.target.value })}
                style={{ width: 20, height: 20, padding: 0, border: "1px solid var(--border)" }}
              />
              <SegmentedControl<AxisChoice>
                options={axisOptions}
                value={axisOf(sh.axis)}
                onChange={(next) => updateRegionShade(sh.id, { axis: next === "y2" ? 1 : 0 })}
              />
              <span style={{ flex: 1 }} />
              <IconButton
                title="Remove"
                aria-label="Remove region shade"
                onClick={() => removeRowSafely(containerRef.current, () => removeRegionShade(sh.id))}
              >
                ✕
              </IconButton>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <BufferedNumberField value={sh.x1} width={48} placeholder="x1" required onValue={setCoord(sh.id, "x1")} />
              <BufferedNumberField value={sh.y1} width={48} placeholder="y1" required onValue={setCoord(sh.id, "y1")} />
              <span style={{ color: "var(--text-faint)" }}>→</span>
              <BufferedNumberField value={sh.x2} width={48} placeholder="x2" required onValue={setCoord(sh.id, "x2")} />
              <BufferedNumberField value={sh.y2} width={48} placeholder="y2" required onValue={setCoord(sh.id, "y2")} />
            </span>
          </div>
        ))}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "end", marginTop: regionShades.length ? 6 : 0 }}>
          <NumberField value={x1} width={48} placeholder="x1" onChange={setX1} />
          <NumberField value={y1} width={48} placeholder="y1" onChange={setY1} />
          <span style={{ color: "var(--text-faint)" }}>→</span>
          <NumberField value={x2} width={48} placeholder="x2" onChange={setX2} />
          <NumberField value={y2} width={48} placeholder="y2" onChange={setY2} />
          <input
            type="color"
            aria-label="New shade fill color"
            value={fill}
            onChange={(e) => setFill(e.target.value)}
            style={{ width: 24, height: 22, padding: 0, border: "1px solid var(--border)" }}
          />
          <SegmentedControl<AxisChoice> options={axisOptions} value={axis} onChange={setAxis} />
          <span title={addReason ?? "Add a filled region shade at these coordinates"}>
            <Button size="sm" disabled={addReason !== null} onClick={add}>
              Add
            </Button>
          </span>
        </div>
      </div>
    </Card>
  );
}
