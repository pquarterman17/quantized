// Plot setup (plan item 43): choose X, Y, Y error, X error and Label per
// column for THIS plot, independent of the column designations. Opened by
// "Plot selection" when the X is ambiguous (seeded with the selection), from
// the worksheet column menu, or from the Plot setup command (seeded with the
// plot as it is). Apply writes one undo step (lib/plotSetupApply.ts). The
// second tab lists every plot with its columns and row window.

import { useId, useMemo, useState } from "react";

import { effectiveDesignations } from "../../../lib/columnmeta";
import { liveRoles, OWN_X, planPlotSetup, selectionRoles, withRole, type PlotRole, type PlotSetupSeed } from "../../../lib/plotSetup";
import { applyPlotSetup } from "./plotSetupApply";
import { ownXLabelOf } from "../../../lib/plotSetupLabels";
import { useApp } from "../../../store/useApp";
import PlotListTab from "./PlotListTab";

const ROLES: readonly [PlotRole, string][] = [["x", "X"], ["y", "Y"], ["yErr", "Y err"], ["xErr", "X err"], ["label", "Label"]];
const cell = { textAlign: "center", padding: "2px 6px" } as const;

export default function PlotSetupDialog({ seed, onClose }: { seed?: PlotSetupSeed; onClose: () => void }) {
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const pointLabels = useApp((s) => s.pointLabels);
  const ds = datasets.find((d) => d.id === (seed?.datasetId ?? activeId)) ?? null;
  const [tab, setTab] = useState<"roles" | "plots">("roles");
  const [roles, setRoles] = useState<Record<number, PlotRole>>(() => {
    if (!ds) return {};
    const live = { xKey, yKeys, pointLabels };
    return seed?.cols ? selectionRoles(ds, live, seed.cols, seed.mode ?? "replace") : liveRoles(ds, live);
  });
  const problemsId = useId();
  const desig = useMemo(() => (ds ? effectiveDesignations(ds.data, ds.columnDesignations) : []), [ds]);
  const result = ds ? planPlotSetup(ds, roles, pointLabels) : { plan: null, problems: ["No dataset to plot."] };
  const rows = ds ? [OWN_X, ...ds.data.labels.keys()] : [];
  const tabBtn = (id: "roles" | "plots", text: string) => (
    <button type="button" className="qz-btn" aria-pressed={tab === id} onClick={() => setTab(id)}>{text}</button>
  );

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6 }}>{tabBtn("roles", "Roles")}{tabBtn("plots", "Plot list")}</div>
      {tab === "plots" ? (
        <PlotListTab onShow={onClose} />
      ) : !ds ? (
        <p className="qzk-helptext">Open a worksheet first.</p>
      ) : (
        <>
          <p className="qzk-helptext">
            Pick a role for each column of {ds.name}. This sets the plot only; the columns&apos; designations are not changed.
          </p>
          <div style={{ maxHeight: "40vh", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr><th style={{ textAlign: "left" }}>Column</th>{ROLES.map(([r, t]) => <th key={r} style={cell}>{t}</th>)}<th style={cell}>None</th></tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const name = c === OWN_X ? `${ownXLabelOf(ds.data)} (sheet's own X)` : ds.data.labels[c] ?? `column ${c + 1}`;
                  const hint = c >= 0 && desig[c] ? desig[c] : "";
                  return (
                    <tr key={c}>
                      <th scope="row" style={{ textAlign: "left", fontWeight: "normal" }}>
                        {name}{hint && <span className="qzk-ds-meta"> · {hint}</span>}
                      </th>
                      {ROLES.map(([r, t]) => (
                        <td key={r} style={cell}>
                          <input
                            type="radio"
                            name={`role-${c}`}
                            aria-label={`${name}: ${t}`}
                            disabled={c === OWN_X && r !== "x"}
                            checked={roles[c] === r}
                            onChange={() => setRoles((cur) => withRole(cur, c, r))}
                          />
                        </td>
                      ))}
                      <td style={cell}>
                        <input
                          type="radio"
                          name={`role-${c}`}
                          aria-label={`${name}: not used`}
                          checked={roles[c] === undefined}
                          onChange={() => setRoles((cur) => withRole(cur, c, null))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {result.problems.length > 0 && (
            <ul id={problemsId} style={{ margin: 0, paddingLeft: 18, color: "var(--danger)" }}>
              {result.problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="qz-btn" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="qz-btn qz-primary"
              disabled={!result.plan}
              aria-describedby={result.problems.length > 0 ? problemsId : undefined}
              onClick={() => {
                if (!result.plan) return;
                applyPlotSetup(ds.id, result.plan);
                onClose();
              }}
            >
              Apply
            </button>
          </div>
        </>
      )}
    </div>
  );
}
