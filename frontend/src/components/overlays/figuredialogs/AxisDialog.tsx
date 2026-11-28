// Origin's Axis dialog (figures-audit #6): double-click an axis on the Stage
// (or Plot ▸ "Axis…") to edit its scale, limits, major increment, minor
// tick count, tick direction, tick-label number format, divide-by factor,
// fonts and (Y / Y2) an axis break in one place -- for X, Y and the secondary
// Y2 axis -- plus (gap-audit-2 #5) reverse, the axis' own grid, X label
// rotation, an outward offset and a top X axis showing 1/T, d-spacing or a
// linear map of X -- and (gap audit 4 G17) log2 and probability scales,
// custom tick positions and labels, and an axis crossing the other at a
// value (Origin's "axis position at"). Every field is
// an existing view field (axisDialogModel.ts), and the export carries the
// same values (`axisFmtParam` -> `calc/axis_extras.py`), so screen and
// export agree. Each axis tab keeps its own draft (switching X / Y / Y2 loses
// nothing), and Apply commits every edited axis as ONE undo step.

import { useState, type ReactNode } from "react";

import type { AxisId } from "../../../store/figureDialogs";
import { useActiveDataset, useApp } from "../../../store/useApp";
import type { TickMode } from "../../../lib/types";
import { editsY2Format, followYFormat, pickY2Scale, tickModeOptions } from "../../../lib/axisDialogParity";
import AxisTitleField from "./AxisTitleField";
import { currentAxisDraft, followingY2Draft } from "../../../lib/figureDialogActions";
import { axisDraftsErrors, commitAxisDrafts, type AxisDrafts } from "../../../lib/axisDraftsCommit";
import type { AxisDraft } from "../../../lib/axisDialogModel";

const AXIS_NAMES: Record<AxisId, string> = { x: "X axis", y: "Y axis", y2: "Y2 (right) axis" };

const SCALES: { value: AxisDraft["scale"]; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "log", label: "Log10" },
  { value: "ln", label: "Ln" },
  { value: "log2", label: "Log2" },
  { value: "reciprocal", label: "Reciprocal (1/x)" },
  { value: "probit", label: "Probability (0–1)" },
  { value: "probitPct", label: "Probability (%)" },
];
const MODES: { value: TickMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "fixed", label: "Decimal" },
  { value: "sci", label: "Scientific" },
  { value: "eng", label: "Engineering" },
];
const GRID_LINES: { value: AxisDraft["gridLines"]; label: string }[] = [
  { value: "plot", label: "As the plot (Grid on/off)" },
  { value: "none", label: "None" },
  { value: "major", label: "Major" },
  { value: "minor", label: "Minor" },
  { value: "both", label: "Major & minor" },
];
const DASHES: { value: AxisDraft["gridDash"]; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dash", label: "Dash" },
  { value: "dot", label: "Dot" },
];
const TOP_KINDS: { value: AxisDraft["topKind"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "reciprocal", label: "Reciprocal (factor / x), e.g. 1/T" },
  { value: "dspacing", label: "d-spacing from 2θ (λ / 2 sin θ)" },
  { value: "linear", label: "Linear (factor · x + shift)" },
  { value: "expr", label: "Expression of x, e.g. 1240/x" },
];
/** Cu Kα1, Å: the usual lab diffractometer, prefilled for d-spacing. */
const CU_KALPHA = "1.5406";
const TICKS: { value: AxisDraft["ticks"]; label: string }[] = [
  { value: "out", label: "Out" },
  { value: "in", label: "In" },
  { value: "both", label: "In & out" },
];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="qzk-field-lbl" style={{ display: "grid", gridTemplateColumns: "130px 1fr", alignItems: "center", gap: 8 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function AxisDialog({ axis, onClose }: { axis: AxisId; onClose: () => void }) {
  const hasY2 = useApp((s) => (s.y2Keys?.length ?? 0) > 0);
  const [current, setCurrent] = useState<AxisId>(axis);
  // One draft per axis tab, made the first time the tab is shown.
  const [drafts, setDrafts] = useState<AxisDrafts>(() => ({ [axis]: currentAxisDraft(axis) }));
  const draft = drafts[current] ?? currentAxisDraft(current);
  const setDraft = (f: (d: AxisDraft) => AxisDraft) => setDrafts((all) => ({ ...all, [current]: f(all[current] ?? currentAxisDraft(current)) }));
  const errors = axisDraftsErrors(drafts);
  const metadata = useActiveDataset()?.data.metadata;
  // Editing any tick-format field gives Y2 a format of its own (it stops following Y).
  const set = <K extends keyof AxisDraft>(k: K, v: AxisDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v, ...(current === "y2" && editsY2Format(k, v) ? { inheritFmt: false } : {}) }));
  const text = (k: Exclude<keyof AxisDraft, "reverse" | "equal" | "sameAsY" | "inheritFmt">, label: string, placeholder = "auto") => (
    <Row label={label}>
      <input
        className="qz-input qz-num"
        aria-label={`${AXIS_NAMES[current]} ${label}`}
        value={draft[k]}
        placeholder={placeholder}
        onChange={(e) => set(k, e.target.value as never)}
      />
    </Row>
  );
  const select = <K extends "scale" | "mode" | "ticks" | "gridLines" | "gridDash" | "topKind">(k: K, label: string, options: { value: AxisDraft[K]; label: string }[]) => (
    <Row label={label}>
      <select
        className="qz-select"
        aria-label={`${AXIS_NAMES[current]} ${label}`}
        value={draft[k]}
        onChange={(e) => {
          const v = e.target.value as AxisDraft[K];
          set(k, v);
          if (k === "topKind" && v === "dspacing" && draft.topWavelength.trim() === "") set("topWavelength", CU_KALPHA);
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Row>
  );
  const pickScale = (v: string) =>
    setDraft((d) => (current === "y2" ? pickY2Scale(d, v, followingY2Draft()) : { ...d, sameAsY: false, scale: v as AxisDraft["scale"] }));
  const switchAxis = (next: AxisId) => {
    setDrafts((all) => (all[next] ? all : { ...all, [next]: currentAxisDraft(next) }));
    setCurrent(next);
  };
  const apply = () => {
    if (errors.length) return;
    commitAxisDrafts(drafts);
    onClose();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 360 }}>
      <div role="tablist" aria-label="Axis" style={{ display: "flex", gap: 4 }}>
        {(hasY2 ? (["x", "y", "y2"] as const) : (["x", "y"] as const)).map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={current === a}
            className={current === a ? "qz-btn qz-primary" : "qz-btn"}
            onClick={() => switchAxis(a)}
          >
            {a === "y2" ? "Y2" : a.toUpperCase()}
          </button>
        ))}
      </div>
      {!hasY2 && (
        <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>
          No Y2 axis yet: put a series on the right axis (Channels ▸ Y2) to edit it here.
        </div>
      )}
      <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>
        Every field here, the scale Type included, takes effect when you press Apply. Cancel or Esc discards your changes.
      </div>
      <h3 style={{ margin: "4px 0" }}>{AXIS_NAMES[current]} — scale</h3>
      <AxisTitleField value={draft.title} onChange={(v) => set("title", v)} axisName={AXIS_NAMES[current]} />
      <Row label="Type">
        <select className="qz-select" aria-label={`${AXIS_NAMES[current]} Type`} value={draft.sameAsY ? "same" : draft.scale} onChange={(e) => pickScale(e.target.value)}>
          {(current === "y2" ? [{ value: "same", label: "Same as Y" }, ...SCALES] : SCALES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Row>
      {text("from", "From")}
      {text("to", "To")}
      <Row label="Reverse">
        <input
          type="checkbox"
          aria-label={`${AXIS_NAMES[current]} Reverse`}
          checked={draft.reverse}
          onChange={(e) => set("reverse", e.target.checked)}
        />
      </Row>
      {current === "y" && (
        <Row label="Equal aspect">
          <input
            type="checkbox"
            aria-label="Y Equal aspect"
            title="One X unit as long as one Y unit (linear X and Y only; the axis with the smaller span is widened)"
            checked={draft.equal}
            onChange={(e) => set("equal", e.target.checked)}
          />
        </Row>
      )}
      {current === "x" ? (
        <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>
          To break the X axis, use Plot ▸ Layout ▸ Break x-axis at gaps…
        </div>
      ) : (
        <>
          <h3 style={{ margin: "4px 0" }}>Break</h3>
          {text("breakFrom", "Break from", "none")}
          {text("breakTo", "Break to", "none")}
        </>
      )}
      <h3 style={{ margin: "4px 0" }}>Ticks</h3>
      {text("increment", "Major increment")}
      {text("anchor", "Anchor ticks at", "off, e.g. 0.5")}
      {text("minor", "Minor ticks", "0")}
      {select("ticks", "Direction", TICKS)}
      {text("tickAt", "Tick positions", "auto, e.g. 0, 0.5, 1")}
      {draft.tickAt.trim() !== "" && text("tickLabels", "Tick labels", "numbers, e.g. low, mid, high (\\, = a comma)")}
      <h3 style={{ margin: "4px 0" }}>Tick labels</h3>
      {current === "y2" && (
        <Row label="Same format as Y">
          <input
            type="checkbox"
            aria-label="Y2 (right) axis Same format as Y"
            title="Y2 draws its tick labels the way Y does (ticking resets the tick format fields below to Y's)"
            checked={draft.inheritFmt}
            onChange={(e) => (e.target.checked ? setDraft((d) => followYFormat(d, followingY2Draft())) : set("inheritFmt", false))}
          />
        </Row>
      )}
      {select("mode", "Number format", tickModeOptions(MODES, current, metadata, draft.mode))}
      {text("digits", "Digits", "2")}
      {text("divide", "Divide by", "1")}
      {text("prefix", "Label prefix", "none, e.g. $")}
      {text("suffix", "Label suffix", "none, e.g. K, %")}
      <div className="qzk-helptext">Prefix and suffix wrap each numeric tick label; tick text you type under Tick positions stays as written.</div>
      {text("size", "Label size (pt)")}
      {current === "x" && text("rotate", "Rotation (°)", "0")}
      {text("titleSize", "Title size (pt)")}
      <h3 style={{ margin: "4px 0" }}>Line &amp; grid</h3>
      {text("offset", "Offset (pt)", "0")}
      {text("cross", current === "x" ? "Cross Y at" : "Cross X at", "frame")}
      {select("gridLines", "Grid lines", GRID_LINES)}
      {draft.gridLines !== "plot" && draft.gridLines !== "none" && (
        <>
          {text("gridColor", "Grid color", "theme")}
          {select("gridDash", "Grid dash", DASHES)}
        </>
      )}
      {current === "x" && (
        <>
          <h3 style={{ margin: "4px 0" }}>Top axis</h3>
          {select("topKind", "Shows", TOP_KINDS)}
          {(draft.topKind === "reciprocal" || draft.topKind === "linear") && text("topFactor", "Factor", "1")}
          {draft.topKind === "expr" && text("topExpr", "f(x) =", "1240/x")}
          {draft.topKind === "linear" && text("topShift", "Shift", "0")}
          {draft.topKind === "dspacing" && text("topWavelength", "Wavelength (Å)", CU_KALPHA)}
          {draft.topKind !== "none" && text("topTitle", "Title", draft.topKind === "dspacing" ? "d (Å)" : "none")}
        </>
      )}
      {errors.length > 0 && (
        <div role="alert" className="qzk-ds-meta qzk-msg" style={{ color: "var(--danger)" }}>
          {errors.join(" ")}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
        <button type="button" className="qz-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="qz-btn qz-primary" onClick={apply} disabled={errors.length > 0}>Apply</button>
      </div>
    </div>
  );
}
