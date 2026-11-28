// Map stack fit: the layer list (which maps, and each one's value) and the
// per-parameter start / bounds / held rows.

import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import type { FitModel } from "../../../lib/types";
import type { MapStackFitState } from "./useMapStackFit";

const faint = { color: "var(--text-faint)" } as const;

export function LayerRows({ m }: { m: MapStackFitState }) {
  const hint = m.guess.source === "none" ? "Type the value of each map." : `Values read from ${m.guess.source === "metadata" ? `the maps' ${m.guess.label}` : m.guess.label}; edit any of them.`;
  return (
    <>
      <div className="qzk-helptext">Tick the maps of the stack, one per value of the variable. They must share one grid.</div>
      <div role="group" aria-label="Maps of the stack" style={{ marginTop: 6, maxHeight: 180, overflowY: "auto" }}>
        {m.maps.map((d) => {
          const on = m.selected.includes(d.id);
          return (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Checkbox checked={on} onChange={() => m.toggle(d.id)}>{d.name}</Checkbox>
              </div>
              {on && <NumberField aria-label={`Value for ${d.name}`} width={64} numeric={false} value={m.xText(d.id)} onChange={(v) => m.setX(d.id, v)} />}
            </div>
          );
        })}
      </div>
      <div className="qzk-helptext" style={{ marginTop: 4, ...faint }}>{hint}</div>
    </>
  );
}

export function ParamRows({ m, model }: { m: MapStackFitState; model: FitModel }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div className="qzk-helptext" style={faint}>Leave Start blank to start each pixel from its own auto-guess. Blank bounds use the model&apos;s own.</div>
      {model.paramNames.map((name, k) => {
        const row = m.form.rows[k];
        if (!row) return null;
        return (
          <div key={name} style={{ display: "grid", gridTemplateColumns: "34px 1fr 1fr 1fr auto", gap: 4, alignItems: "center", marginTop: 4 }}>
            <span title={name}>{name}</span>
            <NumberField aria-label={`${name} start`} placeholder="start" width={56} numeric={false} value={row.start} onChange={(v) => m.setRow(k, { start: v })} />
            <NumberField aria-label={`${name} lower`} placeholder={model.lb[k] == null ? "-∞" : String(model.lb[k])} width={56} numeric={false} value={row.lower} onChange={(v) => m.setRow(k, { lower: v })} />
            <NumberField aria-label={`${name} upper`} placeholder={model.ub[k] == null ? "∞" : String(model.ub[k])} width={56} numeric={false} value={row.upper} onChange={(v) => m.setRow(k, { upper: v })} />
            <Checkbox checked={row.fixed} onChange={(v) => m.setRow(k, { fixed: v })}><span aria-label={`Hold ${name}`}>hold</span></Checkbox>
          </div>
        );
      })}
    </div>
  );
}
