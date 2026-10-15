// Inspector card: reference lines drawn across the plot at fixed X/Y values
// (mark Hc, Tc, a critical edge, zero…). Pick an axis + value, add it; the line
// renders via the uPlot refLinePlugin. Lines are global to the Stage.

import { useRef, useState } from "react";

import { absorbStrayDeleteOnContainer, removeRowSafely } from "../../lib/focusGuard";
import { fmtNum } from "../../lib/format";
import { useApp } from "../../store/useApp";
import { IconButton } from "../primitives/IconButton";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Button } from "../primitives";
import Card from "../primitives/Card";

export default function RefLinesCard() {
  const refLines = useApp((s) => s.refLines);
  const addRefLine = useApp((s) => s.addRefLine);
  const removeRefLine = useApp((s) => s.removeRefLine);
  const recordHistory = useApp((s) => s.recordHistory);
  const recordHistoryCoalesced = useApp((s) => s.recordHistoryCoalesced);
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
  const removeGroup = (groupId: string) => {
    recordHistory("delete reference-line group");
    useApp.setState((state) => ({ refLines: state.refLines.filter((line) => line.groupId !== groupId) }));
  };
  const groups = [...new Map(refLines.flatMap((line) => typeof line.groupId === "string" && line.groupId
    ? [[line.groupId, typeof line.groupLabel === "string" && line.groupLabel
      ? line.groupLabel : "Generated reference lines"] as const] : [])).entries()];
  const updateStickGroup = (groupId: string, patch: Partial<NonNullable<(typeof refLines)[number]["stick"]>>, key: string) => {
    recordHistoryCoalesced("style reference pattern", `reference-pattern:${groupId}:${key}`);
    useApp.setState((state) => ({
      refLines: state.refLines.map((line) => line.groupId === groupId && line.stick
        ? { ...line, stick: { ...line.stick, ...patch } }
        : line),
    }));
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
        {groups.map(([groupId, groupLabel]) => {
          const members = refLines.filter((line) => line.groupId === groupId);
          const stick = members.find((line) => line.stick)?.stick;
          return <div key={groupId} className="qz-meta-row" style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <strong className="qz-k">{groupLabel}{stick ? ` · ${members.length} sticks` : ""}</strong>
              <Button size="sm" aria-label={`Remove ${groupLabel}`} title={`Remove ${groupLabel}`}
                onClick={() => removeRowSafely(containerRef.current, () => removeGroup(groupId))}>Remove group</Button>
            </div>
            {stick && <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "5px 8px" }}>
              <label className="qz-k" style={{ display: "flex", gap: 4 }}>
                <input type="checkbox" checked={stick.visible} onChange={(e) => updateStickGroup(groupId, { visible: e.target.checked }, "visible")} /> Show
              </label>
              <label className="qz-k" style={{ display: "flex", gap: 4 }}>
                <input type="checkbox" checked={stick.showLabel} onChange={(e) => updateStickGroup(groupId, { showLabel: e.target.checked }, "labels")} /> Labels
              </label>
              <input type="color" value={stick.color} aria-label={`${groupLabel} color`} onChange={(e) => updateStickGroup(groupId, { color: e.target.value }, "color")} />
              <label className="qz-k">Offset <NumberField value={stick.baseline} width={55} step={0.01}
                aria-label={`${groupLabel} offset`} onChange={(value) => {
                  const number = Number(value);
                  if (Number.isFinite(number) && number >= 0 && number < 1 && number + stick.height <= 1) updateStickGroup(groupId, { baseline: number }, "offset");
                }} /></label>
              <label className="qz-k">Height <NumberField value={stick.height} width={55} step={0.01}
                aria-label={`${groupLabel} height`} onChange={(value) => {
                  const number = Number(value);
                  if (Number.isFinite(number) && number > 0 && stick.baseline + number <= 1) updateStickGroup(groupId, { height: number }, "height");
                }} /></label>
            </div>}
          </div>;
        })}
        {refLines.filter((line) => !line.stick || !line.groupId).map((r) => (
          <div
            key={r.id}
            className="qz-meta-row"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            <span className="qz-k">
              {typeof r.label === "string" && r.label ? `${r.label} · ` : ""}{r.axis.toUpperCase()} = <span style={{ fontFamily: "var(--font-mono)" }}>{fmtNum(r.value)}</span>
            </span>
            <IconButton aria-label="Remove line" title="Remove" onClick={() => removeRowSafely(containerRef.current, () => removeRefLine(r.id))}>
              ✕
            </IconButton>
          </div>
        ))}
      </div>
    </Card>
  );
}
