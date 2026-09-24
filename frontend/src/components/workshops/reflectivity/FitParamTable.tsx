// Reflectivity fit — parameter table. One row per model parameter generated
// from the layer stack (reflFitModel.buildParamRows): value (edits the layer
// model itself), vary, min, max and an optional tie to another parameter.
// Stateless: edits route back through useReflFit.setParam.

import { Select } from "../../primitives";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import type { FitParamRow, ParamSettings } from "./reflFitModel";

const COLS = "96px 86px 34px 78px 78px 1fr";

type Patch = Partial<ParamSettings> & { value?: number };

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
      <BufferedNumberField
        aria-label={`${row.name} value`}
        value={row.value}
        width={80}
        required
        onValue={(v) => v !== undefined && onChange(row.name, { value: v })}
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
      <BufferedNumberField
        aria-label={`${row.name} min`}
        value={row.min}
        width={72}
        required
        disabled={!row.vary || tied}
        onValue={(v) => v !== undefined && onChange(row.name, { min: v })}
      />
      <BufferedNumberField
        aria-label={`${row.name} max`}
        value={row.max}
        width={72}
        required
        disabled={!row.vary || tied}
        onValue={(v) => v !== undefined && onChange(row.name, { max: v })}
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
