// Inspector card: reference lines drawn across the plot at fixed X/Y values
// (mark Hc, Tc, a critical edge, zero…). Pick an axis + value, add it; the line
// renders via the uPlot refLinePlugin. Lines are global to the Stage.

import { useState } from "react";

import { fmtNum } from "../../lib/format";
import { useApp } from "../../store/useApp";
import { Button, Card, IconButton, NumberField, SegmentedControl } from "../primitives";

export default function RefLinesCard() {
  const refLines = useApp((s) => s.refLines);
  const addRefLine = useApp((s) => s.addRefLine);
  const removeRefLine = useApp((s) => s.removeRefLine);
  const [axis, setAxis] = useState<"x" | "y">("x");
  const [value, setValue] = useState("0");

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

      {refLines.map((r) => (
        <div
          key={r.id}
          className="qz-meta-row"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <span className="qz-k">
            {r.axis.toUpperCase()} = <span style={{ fontFamily: "var(--font-mono)" }}>{fmtNum(r.value)}</span>
          </span>
          <IconButton title="Remove" onClick={() => removeRefLine(r.id)}>
            ✕
          </IconButton>
        </div>
      ))}
    </Card>
  );
}
