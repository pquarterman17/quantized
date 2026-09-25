// Reflectivity fit — parameter table. One row per model parameter generated
// from the layer stack (reflFitModel.buildParamRows): value (edits the layer
// model itself), vary, min, max and an optional tie to another parameter.
// Stateless: edits route back through useReflFit.setParam.

import { useEffect, useState } from "react";

import { Select } from "../../primitives";
import { NumberField } from "../../primitives/NumberField";
import { editableNum, type FitParamRow, type ParamSettings } from "./reflFitModel";

const COLS = "96px 86px 34px 78px 78px 1fr";

type Patch = Partial<ParamSettings> & { value?: number };

/** A buffered numeric field that SHOWS its value compactly (`editableNum`:
 *  "2.007e-5", not a clipped "0.00002") while staying freely editable. Like
 *  BufferedNumberField, the DOM text is a local buffer committed on every
 *  keystroke that parses; unlike it, the committed value only replaces the
 *  buffer when they disagree numerically, so typing "0.0000025" is never
 *  rewritten to "2e-6" mid-entry. Blur reformats (or reverts an invalid
 *  buffer). */
function ParamNumberField({
  value,
  onValue,
  width,
  disabled,
  label,
}: {
  value: number;
  onValue: (v: number) => void;
  width: number;
  disabled?: boolean;
  label: string;
}) {
  const [text, setText] = useState(() => editableNum(value));
  useEffect(() => {
    setText((t) => (t.trim() !== "" && Number(t) === value ? t : editableNum(value)));
  }, [value]);
  return (
    <NumberField
      aria-label={label}
      value={text}
      width={width}
      disabled={disabled}
      title={String(value)}
      onBlur={() => setText(editableNum(value))}
      onChange={(next) => {
        setText(next);
        const v = Number(next);
        if (next.trim() !== "" && Number.isFinite(v)) onValue(v);
      }}
    />
  );
}

function ParamRow({
  row,
  tieOptions,
  onChange,
}: {
  row: FitParamRow;
  tieOptions: { value: string; label: string }[];
  onChange: (name: string, patch: Patch) => void;
}) {
  const tied = row.tie !== "";
  return (
    <div role="row" style={{ display: "grid", gridTemplateColumns: COLS, gap: 4, alignItems: "center" }}>
      <span role="rowheader" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-sm)", color: "var(--text-dim)" }}>
        {row.name}
      </span>
      <ParamNumberField
        label={`${row.name} value`}
        value={row.value}
        width={80}
        onValue={(v) => onChange(row.name, { value: v })}
      />
      {/* The Checkbox primitive names its input by visible text; a table cell
          has none, so the same qz-check markup carries an aria-label. */}
      <label className="qz-check" title={tied ? `tied to ${row.tie}` : `fit ${row.name}`}>
        <input
          type="checkbox"
          aria-label={`vary ${row.name}`}
          checked={row.vary}
          disabled={tied}
          onChange={(e) => onChange(row.name, { vary: e.target.checked })}
        />
      </label>
      <ParamNumberField
        label={`${row.name} min`}
        value={row.min}
        width={72}
        disabled={!row.vary || tied}
        onValue={(v) => onChange(row.name, { min: v })}
      />
      <ParamNumberField
        label={`${row.name} max`}
        value={row.max}
        width={72}
        disabled={!row.vary || tied}
        onValue={(v) => onChange(row.name, { max: v })}
      />
      <Select
        aria-label={`${row.name} tie`}
        options={tieOptions}
        value={row.tie}
        onChange={(e) => onChange(row.name, { tie: e.target.value })}
      />
    </div>
  );
}

export default function FitParamTable({
  rows,
  onChange,
}: {
  rows: FitParamRow[];
  onChange: (name: string, patch: Patch) => void;
}) {
  const names = rows.map((r) => r.name);
  return (
    <div role="table" aria-label="fit parameters" style={{ overflow: "auto", maxHeight: 260 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 460 }}>
        <div role="row" className="qzk-ds-meta" style={{ display: "grid", gridTemplateColumns: COLS, gap: 4 }}>
          <span role="columnheader">parameter</span>
          <span role="columnheader">value</span>
          <span role="columnheader">fit</span>
          <span role="columnheader">min</span>
          <span role="columnheader">max</span>
          <span role="columnheader">tie to</span>
        </div>
        {rows.map((r) => (
          <ParamRow
            key={r.name}
            row={r}
            onChange={onChange}
            tieOptions={[{ value: "", label: "—" }, ...names.filter((n) => n !== r.name).map((n) => ({ value: n, label: n }))]}
          />
        ))}
      </div>
    </div>
  );
}
