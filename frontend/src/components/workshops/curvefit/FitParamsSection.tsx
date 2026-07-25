// Starting values / bounds / fixed flags for a REGISTRY fit model
// (MAIN_PLAN #30).
//
// The custom-equation path has had this table since it shipped; the registry
// path did not, which is why the plan long recorded starts and bounds as
// "design-constrained — registry fits expose no user bounds". They were not:
// FitModel carries paramNames, p0, lb and ub, and the route has always accepted
// p0/lower/upper/fixed. The control was simply missing.
//
// Collapsed by default. Most fits never need it, and an always-open table of
// numbers above the Fit button would make the common case worse to serve the
// rare one.

import { useState } from "react";

import type { FitParamRow } from "../../../lib/fitParams";
import { Button, NumberField } from "../../primitives";

export interface FitParamsSectionProps {
  rows: FitParamRow[];
  setRow: (index: number, patch: Partial<FitParamRow>) => void;
  reset: () => void;
}

export default function FitParamsSection({ rows, setRow, reset }: FitParamsSectionProps) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const edited = rows.some((r) => r.fixed) || false;

  return (
    <div style={{ marginTop: 8 }}>
      <button
        className="qz-btn"
        onClick={() => setOpen((v) => !v)}
        title="Set starting values and bounds instead of using the model's defaults"
        aria-expanded={open}
      >
        {open ? "▾" : "▸"} Start values & bounds
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          <div
            className="qzk-ds-meta"
            style={{ display: "flex", gap: 6, color: "var(--text-faint)" }}
          >
            <span style={{ flex: 1 }}>parameter</span>
            <span style={{ width: 72 }}>start</span>
            <span style={{ width: 72 }}>min</span>
            <span style={{ width: 72 }}>max</span>
            <span style={{ width: 40 }}>hold</span>
          </div>
          {rows.map((row, i) => (
            <div
              key={row.name}
              style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}
            >
              <span style={{ flex: 1 }} title={row.name}>
                {row.name}
              </span>
              <NumberField
                value={row.start}
                width={72}
                placeholder="auto"
                title="Starting value — blank uses the model default"
                onChange={(v) => setRow(i, { start: v })}
              />
              <NumberField
                value={row.min}
                width={72}
                placeholder="−∞"
                title="Lower bound — blank is unbounded"
                onChange={(v) => setRow(i, { min: v })}
              />
              <NumberField
                value={row.max}
                width={72}
                placeholder="∞"
                title="Upper bound — blank is unbounded"
                onChange={(v) => setRow(i, { max: v })}
              />
              <input
                type="checkbox"
                checked={row.fixed}
                style={{ width: 40 }}
                aria-label={`Hold ${row.name} fixed`}
                title="Hold this parameter at its start value instead of fitting it"
                onChange={(e) => setRow(i, { fixed: e.target.checked })}
              />
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            <Button size="sm" variant="ghost" onClick={reset} title="Back to the model's defaults">
              Reset to defaults
            </Button>
            {edited && (
              <span className="qzk-ds-meta" style={{ marginLeft: 8, color: "var(--text-faint)" }}>
                held parameters are not fitted
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
