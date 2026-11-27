// Settings of the curve-measurement gadget kinds, on the chip: level crossings
// (level, dead band, direction) and rise time (10 / 90 %, 20 / 80 % or a custom
// pair, the edge, and optional reference levels instead of the estimated
// plateaus). All opt-in: empty fields keep the defaults. A change re-arms the
// same region, which drops the result shown and measures again, so a stale
// number never sits under new settings.

import type { GadgetMeasureOptions as Options, StepPreset } from "../../lib/gadgetMeasureOptions";
import { useGadgetMeasureOptions } from "../../store/gadgetMeasureOptions";
import { useApp } from "../../store/useApp";
import { Checkbox } from "../primitives/Checkbox";
import { Select } from "../primitives";

const PRESETS = [
  { value: "10-90", label: "10 / 90 %" },
  { value: "20-80", label: "20 / 80 %" },
  { value: "custom", label: "custom %" },
];
const DIRECTIONS = [
  { value: "both", label: "both ways" },
  { value: "rising", label: "rising" },
  { value: "falling", label: "falling" },
];
const EDGES = [
  { value: "auto", label: "edge: auto" },
  { value: "rise", label: "rise" },
  { value: "fall", label: "fall" },
];

export default function GadgetMeasureOptions({ mode }: { mode: "levelcrossing" | "risetime" }) {
  const o = useGadgetMeasureOptions((s) => s.options);
  const setOptions = useGadgetMeasureOptions((s) => s.set);
  const roi = useApp((s) => s.qfitRoi);
  const setQfitRoi = useApp((s) => s.setQfitRoi);
  const change = (patch: Partial<Options>): void => {
    setOptions(patch);
    if (roi) setQfitRoi(roi);
  };
  const field = (key: keyof Options, label: string, placeholder: string) => (
    <input
      className="qz-input"
      aria-label={label}
      title={label}
      placeholder={placeholder}
      value={String(o[key] ?? "")}
      onChange={(e) => change({ [key]: e.target.value })}
    />
  );
  if (mode === "levelcrossing") {
    return (
      <>
        {field("level", "Y level", "level (mid-range)")}
        {field("hysteresis", "Dead band", "± dead band")}
        <Select aria-label="Crossing direction" options={DIRECTIONS} value={o.direction} onChange={(e) => change({ direction: e.target.value as Options["direction"] })} />
        <Checkbox checked={o.inOrder} onChange={(v) => change({ inOrder: v })} title="Read the points in the order they were taken instead of sorted by X: a hysteresis loop then crosses M = 0 once on each branch (at -Hc and +Hc), where sorted by field the two branches trade places">
          sweep order
        </Checkbox>
      </>
    );
  }
  return (
    <>
      <Select aria-label="Rise time percentages" options={PRESETS} value={o.stepPreset} onChange={(e) => change({ stepPreset: e.target.value as StepPreset })} />
      {o.stepPreset === "custom" && (
        <>
          {field("lowPct", "Low percentage", "low %")}
          {field("highPct", "High percentage", "high %")}
        </>
      )}
      <Select aria-label="Edge" options={EDGES} value={o.edge} onChange={(e) => change({ edge: e.target.value as Options["edge"] })} />
      {field("lowLevel", "Low reference level", "low level (plateau)")}
      {field("highLevel", "High reference level", "high level (plateau)")}
    </>
  );
}
