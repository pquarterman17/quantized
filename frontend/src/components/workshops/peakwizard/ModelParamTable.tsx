// Peak Analyzer — the mixed-shape model's editable parameter table (audit
// P2.4 slice 2). One row per model parameter: start value, vary (unchecked =
// fixed at the start value), optional min / max (blank = the backend's
// default: open, except widths > 0 and eta in [0, 1]), and a tie to another
// parameter of the same kind (a tied row copies its target, so its own
// fields are disabled). A parameter others are tied to cannot be fixed (the
// backend refuses a tie to a fixed parameter): its vary box is disabled and
// says which ties to undo first. A tied row whose kind allows more than a copy
// gets a second line choosing HOW it follows (gap audit 4 G5): a centre
// offset (a doublet's splitting), a height or width ratio, or an area ratio
// (an XPS doublet's 2:1), with the coefficient fixed or fitted. Presentational:
// every edit goes through `useModelFit`'s `patch`.

import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Select } from "../../primitives";
import {
  dependents, NO_EXPR, paramLabel, tieCoefDefault, tieOpsFor, tieTargets, type ModelParam, type TieOp,
} from "./peakModelParams";
import type { ModelFitState } from "./useModelFit";

const cell = { padding: "2px 3px" } as const;

/** Control widths (px). Together with the name and vary columns they fit the
 *  Peak Analyzer's 420 px window: the table used to run past its right edge,
 *  cutting the "tie to" column off (re-audit #16). */
export const COL = { start: 64, bound: 50, tie: 80 } as const;

const OP_LABEL: Record<TieOp, string> = {
  equal: "= copy",
  offset: "+ offset",
  ratio: "× ratio",
  area_ratio: "area × ratio",
};

/** The second line of a tied row: how it follows its target. */
function TieExpr({ p, model }: { p: ModelParam; model: ModelFitState }) {
  const label = paramLabel(p.name);
  const ops = tieOpsFor(p.name, model.setup.shapes);
  const op = p.tieOp ?? "equal";
  if (p.tie === null || ops.length < 2) return null;
  const coef = p.tieCoef ?? tieCoefDefault(op);
  return (
    <tr>
      <td colSpan={6} style={{ ...cell, paddingLeft: 16 }}>
        <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          <span className="qzk-ds-meta" style={{ margin: 0, color: "var(--text-faint)" }}>↳ {label} =</span>
          <Select
            aria-label={`${label} tie operation`}
            options={ops.map((o) => ({ value: o, label: OP_LABEL[o] }))}
            value={op}
            style={{ width: 96 }}
            onChange={(e) => {
              const next = e.target.value as TieOp;
              model.patch(p.name, { tieOp: next, tieCoef: tieCoefDefault(next), tieCoefVary: false });
            }}
          />
          {op !== "equal" && (
            <>
              <BufferedNumberField
                aria-label={`${label} tie ${op === "offset" ? "offset" : "ratio"}`}
                value={coef}
                required
                width={COL.start}
                onValue={(v) => {
                  if (v !== undefined) model.patch(p.name, { tieCoef: v });
                }}
              />
              <label className="qzk-ds-meta" style={{ margin: 0, display: "inline-flex", gap: 2, alignItems: "center" }}>
                <input
                  type="checkbox"
                  aria-label={`${label} fit tie coefficient`}
                  checked={p.tieCoefVary ?? false}
                  onChange={(e) => model.patch(p.name, { tieCoefVary: e.target.checked })}
                />
                fit
              </label>
            </>
          )}
        </span>
      </td>
    </tr>
  );
}

function Row({ p, all, model }: { p: ModelParam; all: ModelParam[]; model: ModelFitState }) {
  const label = paramLabel(p.name);
  const tied = p.tie !== null;
  const targets = tieTargets(all, p.name);
  const deps = dependents(all, p.name);
  const lockedVary = !tied && p.vary && deps.length > 0;
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
    <>
      <tr style={tied ? { opacity: 0.7 } : undefined}>
        <td style={cell} title={p.name}>{label}</td>
        <td style={cell}>
          <BufferedNumberField
            aria-label={`${label} start`}
            value={p.value}
            required
            width={COL.start}
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
            title={
              lockedVary
                ? `${deps.map(paramLabel).join(", ")} ${deps.length === 1 ? "is" : "are"} tied to this — untie first to fix it`
                : p.vary ? "fitted (uncheck to fix at the start value)" : "fixed at the start value"
            }
            checked={tied || p.vary}
            disabled={tied || lockedVary}
            onChange={(e) => model.patch(p.name, { vary: e.target.checked })}
          />
        </td>
        <td style={cell}>
          <BufferedNumberField
            aria-label={`${label} min`}
            value={p.min ?? undefined}
            placeholder="—"
            width={COL.bound}
            disabled={tied || !p.vary}
            onValue={(v) => model.patch(p.name, { min: v ?? null })}
          />
        </td>
        <td style={cell}>
          <BufferedNumberField
            aria-label={`${label} max`}
            value={p.max ?? undefined}
            placeholder="—"
            width={COL.bound}
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
            style={{ width: COL.tie }}
            onChange={(e) => model.patch(p.name, { tie: e.target.value || null, ...NO_EXPR })}
          />
        </td>
      </tr>
      <TieExpr p={p} model={model} />
    </>
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
            <th title="follow another parameter of the same kind (a copy, an offset or a ratio)">tie to</th>
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
