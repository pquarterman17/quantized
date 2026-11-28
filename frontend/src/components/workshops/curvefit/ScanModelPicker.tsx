// Rank all models: which models to fit. The default is the backend's own set
// (every plausible registry model plus the saved equations). Choosing a
// category -- the headings of the Curve Fit model picker -- fits exactly that
// category's models; each can be unticked first.

import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import type { ModelGroup } from "../../../lib/fitModelCatalog";
import type { ScanScope } from "./useModelScan";

interface Props {
  groups: readonly ModelGroup[];
  scope: ScanScope | null;
  onChange: (scope: ScanScope | null) => void;
  disabled?: boolean;
}

export default function ScanModelPicker({ groups, scope, onChange, disabled = false }: Props) {
  const group = scope ? groups.find((g) => g.group === scope.group) : undefined;
  const ticked = new Set(scope?.models ?? []);
  const toggle = (model: string, on: boolean) => {
    if (!scope) return;
    onChange({ ...scope, models: group ? group.options.map((o) => o.value).filter((v) => (v === model ? on : ticked.has(v))) : [] });
  };
  return (
    <div style={{ marginBottom: 6 }}>
      <Select
        aria-label="Category to rank"
        disabled={disabled}
        options={[
          { value: "", label: "Default set (all plausible models + saved equations)" },
          ...groups.map((g) => ({ value: g.group, label: `${g.group} (${g.options.length})` })),
        ]}
        value={scope?.group ?? ""}
        onChange={(e) => {
          const g = groups.find((x) => x.group === e.target.value);
          onChange(g ? { group: g.group, models: g.options.map((o) => o.value) } : null);
        }}
      />
      {scope && group && (
        <details style={{ marginTop: 4 }}>
          <summary className="qzk-ds-meta">
            {scope.models.length} of {group.options.length} models ticked
          </summary>
          <div style={{ maxHeight: 140, overflowY: "auto", paddingLeft: 4 }}>
            {group.options.map((o) => (
              <div key={o.value}>
                <Checkbox
                  checked={ticked.has(o.value)}
                  disabled={disabled}
                  ariaLabel={`Rank ${o.value}`}
                  onChange={(on) => toggle(o.value, on)}
                >
                  {o.label}
                </Checkbox>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
