// Curve Fit's model picker: the registry models under Origin's category
// headings (lib/fitModelCatalog.ts, re-audit #14), then the custom equations.
// A native <select> with <optgroup>s, so the keyboard and screen readers get
// the grouping for free; the option VALUES are the registry names, unchanged.

import type { ModelGroup, ModelOption } from "../../../lib/fitModelCatalog";

export default function ModelSelect({
  groups,
  custom,
  value,
  onChange,
}: {
  groups: readonly ModelGroup[];
  /** "Custom equation…" and the saved equations, last, under their own heading. */
  custom: readonly ModelOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select className="qz-select" aria-label="Model" value={value} onChange={(e) => onChange(e.target.value)}>
      {groups.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
      <optgroup label="Custom equations">
        {custom.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
