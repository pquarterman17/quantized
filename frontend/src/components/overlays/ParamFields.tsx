// Ported from fermiviewer frontend/src/components/overlays/ParamFields.tsx.
// Presentational parameter-field row used by ParamDialog. Number fields coerce
// on blur (a non-finite entry reverts to the field default).
//
// Every control is labelled by the row's visible caption (`aria-labelledby`)
// and carries the field's hint as its `title`, which becomes its accessible
// description. The caption used to be a bare <span>, so every askParams
// prompt (Export figure / page / map, Page setup, the rename and tag prompts)
// read its fields as unnamed controls.

import { useId } from "react";

import type { ParamField } from "../../lib/params";

export function ParamFieldRow({
  field,
  value,
  onChange,
  autoFocus = false,
}: {
  field: ParamField;
  value: number | string | boolean | undefined;
  onChange: (v: number | string | boolean) => void;
  autoFocus?: boolean;
}) {
  const f = field;
  const labelId = useId();
  const a11y = { "aria-labelledby": labelId, title: f.hint };
  return (
    <div className="qz-ws-row">
      <span className="k" id={labelId} title={f.hint}>
        {f.label}
      </span>
      {f.type === "number" && (
        <input
          {...a11y}
          autoFocus={autoFocus}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) ? n : (f.default as number));
          }}
        />
      )}
      {f.type === "text" && (
        <input
          {...a11y}
          autoFocus={autoFocus}
          style={{ flex: 1 }}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {f.type === "select" && (
        <select {...a11y} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {(f.options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      )}
      {f.type === "boolean" && (
        <label className="qz-check">
          <input
            {...a11y}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
        </label>
      )}
    </div>
  );
}
