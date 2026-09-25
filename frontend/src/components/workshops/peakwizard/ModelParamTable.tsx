// Peak Analyzer — the mixed-shape model's editable parameter table (audit
// P2.4 slice 2). One row per model parameter: start value, vary (unchecked =
// fixed at the start value), optional min / max (blank = the backend's
// default: open, except widths > 0 and eta in [0, 1]), and a tie to another
// parameter of the same kind (a tied row copies its target, so its own
// fields are disabled). Presentational: every edit goes through
// `useModelFit`'s `patch`.

import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Select } from "../../primitives";
import { paramLabel, tieTargets, type ModelParam } from "./peakModelParams";
import type { ModelFitState } from "./useModelFit";

const cell = { padding: "2px 3px" } as const;

function Row({ p, all, model }: { p: ModelParam; all: ModelParam[]; model: ModelFitState }) {
  const label = paramLabel(p.name);
  const tied = p.tie !== null;
  const targets = tieTargets(all, p.name);
  // A tie to a target that is no longer eligible still shows (the backend
  // explains the conflict on Fit) rather than silently vanishing.
  const tieOptions = [
    { value: "", label: "—" },
    ...[...targets, ...(p.tie && !targets.includes(p.tie) ? [p.tie] : [])].map((t) => ({
      value: t,
      label: paramLabel(t),
    })),
  ];
  return (
    <tr style={tied ? { opacity: 0.7 } : undefined}>
      <td style={cell} title={p.name}>{label}</td>
      <td style={cell}>
        <BufferedNumberField
          aria-label={`${label} start`}
          value={p.value}
          required
          width={70}
          disabled={tied}
          onValue={(v) => {
            if (v !== undefined) model.patch(p.name, { value: v });
          }}
        />
      </td>
      <td style={{ ...cell, textAlign: "center" }}>
        <input
          type="checkbox"
          aria-label={`${label} vary`}
          title={p.vary ? "fitted (uncheck to fix at the start value)" : "fixed at the start value"}
          checked={tied || p.vary}
          disabled={tied}
          onChange={(e) => model.patch(p.name, { vary: e.target.checked })}
        />
      </td>
      <td style={cell}>
        <BufferedNumberField
          aria-label={`${label} min`}
          value={p.min ?? undefined}
          placeholder="—"
          width={58}
          disabled={tied || !p.vary}
          onValue={(v) => model.patch(p.name, { min: v ?? null })}
        />
      </td>
      <td style={cell}>
        <BufferedNumberField
          aria-label={`${label} max`}
          value={p.max ?? undefined}
          placeholder="—"
          width={58}
          disabled={tied || !p.vary}
          onValue={(v) => model.patch(p.name, { max: v ?? null })}
        />
      </td>
      <td style={cell}>
        <Select
          aria-label={`${label} tie`}
          options={tieOptions}
          value={p.tie ?? ""}
          disabled={tieOptions.length < 2}
          onChange={(e) => model.patch(p.name, { tie: e.target.value || null })}
        />
      </td>
    </tr>
  );
}

export default function ModelParamTable({ model }: { model: ModelFitState }) {
  const params = model.setup.params;
  return (
    <div style={{ marginTop: 8, maxHeight: 240, overflow: "auto" }}>
      <table className="qz-table" aria-label="model parameters">
        <thead>
          <tr>
            <th>parameter</th>
            <th>start</th>
            <th title="vary (fit) or fixed">vary</th>
            <th>min</th>
            <th>max</th>
            <th title="copy another parameter of the same kind">tie to</th>
          </tr>
        </thead>
        <tbody>
          {params.map((p) => (
            <Row key={p.name} p={p} all={params} model={model} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
