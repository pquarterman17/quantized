// The 2-D map card's opt-in Shepard and kriging options (lib/mapGridOpts.ts):
// the same ones the Map gridding workshop exposes. Loaded only when the card's
// method is one of the two, so the card itself stays light. Blank = the
// method's own default. A typed value is applied on blur or Enter; one the route
// would refuse is rejected here, with its reason, and the last good value stays.

import { useState } from "react";

import type { Variogram } from "../../lib/api/mapGrid";
import {
  KRIGE_NEIGHBORS_RANGE,
  SHEP_NEIGHBORS_RANGE,
  parseRadius,
  parseWhole,
  setMapGridOpts,
  useMapGridOpts,
} from "../../lib/mapGridOpts";
import { Select } from "../primitives";
import { Checkbox } from "../primitives/Checkbox";
import { NumberField } from "../primitives/NumberField";

const VARIOGRAMS: { value: Variogram; label: string }[] = [
  { value: "auto", label: "best fit of the three" },
  { value: "spherical", label: "spherical" },
  { value: "exponential", label: "exponential" },
  { value: "gaussian", label: "gaussian" },
];
const gap = { marginTop: 8 } as const;
const note = { ...gap, color: "var(--text-dim)", font: "11px var(--font-ui)" } as const;

/** One typed numeric option: local text, applied on blur/Enter, error kept beside it. */
function OptionField({ label, value, placeholder, parse, apply, hint }: {
  label: string;
  value: number | undefined;
  placeholder: string;
  parse: (text: string) => number | null;
  apply: (v: number | undefined) => void;
  hint: string;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [error, setError] = useState(false);
  const commit = (): void => {
    if (text.trim() === "") {
      setError(false);
      apply(undefined);
      return;
    }
    const v = parse(text);
    setError(v === null);
    if (v !== null) apply(v);
  };
  return (
    <div style={gap}>
      <label className="qzk-field-lbl">{label}</label>
      <NumberField
        aria-label={label}
        placeholder={placeholder}
        value={text}
        width={96}
        onChange={setText}
        onBlur={commit}
        onKeyDown={(e) => (e.key === "Enter" ? commit() : undefined)}
      />
      {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 11, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export default function MapGridOptions({ method }: { method: "shepard" | "kriging" }) {
  const o = useMapGridOpts();
  if (method === "kriging") {
    return (
      <>
        <label className="qzk-field-lbl" style={gap}>Variogram model</label>
        <Select
          aria-label="Variogram model"
          options={VARIOGRAMS}
          value={o.variogram ?? "auto"}
          onChange={(e) => setMapGridOpts({ variogram: e.target.value === "auto" ? undefined : (e.target.value as Variogram) })}
        />
        <OptionField
          label="Kriging neighbours"
          placeholder="32"
          value={o.krigeNeighbors}
          parse={(t) => parseWhole(t, KRIGE_NEIGHBORS_RANGE)}
          apply={(v) => setMapGridOpts({ krigeNeighbors: v })}
          hint={`A whole number from ${KRIGE_NEIGHBORS_RANGE[0]} to ${KRIGE_NEIGHBORS_RANGE[1]}.`}
        />
      </>
    );
  }
  return (
    <>
      <OptionField
        label="Shepard neighbours"
        placeholder="19"
        value={o.shepNeighbors}
        parse={(t) => parseWhole(t, SHEP_NEIGHBORS_RANGE)}
        apply={(v) => setMapGridOpts({ shepNeighbors: v })}
        hint={`A whole number from ${SHEP_NEIGHBORS_RANGE[0]} to ${SHEP_NEIGHBORS_RANGE[1]}.`}
      />
      <OptionField
        label="Shepard radius"
        placeholder="adaptive"
        value={o.shepRadius}
        parse={parseRadius}
        apply={(v) => setMapGridOpts({ shepRadius: v })}
        hint="A fraction of the data extent: above 0 and at most 2."
      />
      <div style={gap}>
        <Checkbox checked={o.shepQuadratic ?? true} onChange={(v) => setMapGridOpts({ shepQuadratic: v ? undefined : false })}>
          Quadratic nodal functions
        </Checkbox>
      </div>
      <div style={note}>Radius is a fraction of the data extent; blank adapts to the local point spacing.</div>
    </>
  );
}
