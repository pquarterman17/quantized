// Inspector card: reference lines drawn across the plot at fixed X/Y values
// (mark Hc, Tc, a critical edge, zero…). Pick an axis + value, add it; the line
// renders via the uPlot refLinePlugin. Lines are global to the Stage.

import { useRef, useState } from "react";

import { absorbStrayDeleteOnContainer, removeRowSafely } from "../../lib/focusGuard";
import { fmtNum } from "../../lib/format";
import { useApp } from "../../store/useApp";
import { Button, IconButton, NumberField, SegmentedControl } from "../primitives";
import Card from "../primitives/Card";

export default function RefLinesCard() {
  const refLines = useApp((s) => s.refLines);
  const addRefLine = useApp((s) => s.addRefLine);
  const removeRefLine = useApp((s) => s.removeRefLine);
  const [axis, setAxis] = useState<"x" | "y">("x");
  const [value, setValue] = useState("0");
  // Focus-safety anchor (lib/focusGuard) — the per-line ✕ below unmounts
  // its own row; without this, focus falls to <body> and a follow-up Delete
  // keystroke deletes the ACTIVE DATASET instead.
  const containerRef = useRef<HTMLDivElement>(null);

  const add = () => {
    const v = Number(value);
    if (Number.isFinite(v)) addRefLine(axis, v);
  };

  return (
    <Card title="Reference lines" count={refLines.length || undefined} defaultOpen={false}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <SegmentedControl<"x" | "y">
          options={[
            { value: "x", label: "X" },
            { value: "y", label: "Y" },
          ]}
          value={axis}
          onChange={setAxis}
        />
        <NumberField
          value={value}
          width={72}
          onChange={setValue}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <Button size="sm" onClick={add}>
          Add
        </Button>
      </div>

      {refLines.length > 0 && (
        <div className="qz-hint" style={{ color: "var(--text-dim)", fontSize: 11, margin: "4px 0 2px" }}>
          Drag a line on the plot (zoom/cursor tool) to move it.
        </div>
      )}

      {/* tabIndex=-1: an invisible, programmatic-only focus anchor — see
       *  lib/focusGuard's doc. Not a new Tab stop. onKeyDown absorbs a stray
       *  Delete/Backspace that lands here right after a removal, before it
       *  can bubble to useGlobalShortcuts' window listener. */}
      <div ref={containerRef} tabIndex={-1} onKeyDown={absorbStrayDeleteOnContainer}>
        {refLines.map((r) => (
          <div
            key={r.id}
            className="qz-meta-row"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            <span className="qz-k">
              {r.axis.toUpperCase()} = <span style={{ fontFamily: "var(--font-mono)" }}>{fmtNum(r.value)}</span>
            </span>
            <IconButton title="Remove" onClick={() => removeRowSafely(containerRef.current, () => removeRefLine(r.id))}>
              ✕
            </IconButton>
          </div>
        ))}
      </div>
    </Card>
  );
}
