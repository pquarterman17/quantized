// Local data filter (#53) — view. A draggable ToolWindow with one control per
// column: a min/max range for continuous columns, a level checklist for
// categorical ones. Edits write to the dataset's `filter`; because analysisData
// folds the filter into the analysis view, Tabulate + Distribution update live.
// Thin — classification + commit logic live in useDataFilter.

import { useState } from "react";

import { fmtNum } from "../../../lib/format";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Checkbox, NumberField } from "../../primitives";
import { useApp } from "../../../store/useApp";
import { type FilterColumn, useDataFilter } from "./useDataFilter";

// Empty or partial ("-", "1.") input parses to undefined (leave the bound open)
// and is not committed; only a finite value or a cleared field changes the filter.
const parseBound = (s: string): { commit: boolean; value: number | undefined } => {
  const t = s.trim();
  if (t === "") return { commit: true, value: undefined };
  const n = Number(t);
  return Number.isFinite(n) ? { commit: true, value: n } : { commit: false, value: undefined };
};

export default function DataFilterPanel() {
  const setOpen = useApp((s) => s.setDataFilterOpen);
  const activeId = useApp((s) => s.activeId);
  const f = useDataFilter();
  // Local text per range field, keyed by dataset so a switch starts fresh.
  const [text, setText] = useState<Record<string, string>>({});
  const key = (col: number, which: "min" | "max") => `${activeId}:${col}:${which}`;

  function onRange(c: FilterColumn, which: "min" | "max", raw: string): void {
    setText((t) => ({ ...t, [key(c.index, which)]: raw }));
    const p = parseBound(raw);
    if (!p.commit) return;
    const curMin = c.current?.min;
    const curMax = c.current?.max;
    if (which === "min") f.setRange(c.index, p.value, curMax);
    else f.setRange(c.index, curMin, p.value);
  }

  const boundText = (c: FilterColumn, which: "min" | "max"): string => {
    const k = key(c.index, which);
    if (k in text) return text[k];
    const v = which === "min" ? c.current?.min : c.current?.max;
    return v !== undefined ? String(v) : "";
  };

  return (
    <ToolWindow title="Data Filter" width={340} onClose={() => setOpen(false)}>
      {!f.hasData ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Select a dataset to filter.
        </div>
      ) : (
        <>
          <div style={{ maxHeight: 320, overflowY: "auto", display: "grid", gap: 10 }}>
            {f.columns.map((c) => (
              <div key={c.index}>
                <label className="qzk-field-lbl">{c.label}</label>
                {c.kind === "range" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <NumberField
                      value={boundText(c, "min")}
                      onChange={(v) => onRange(c, "min", v)}
                      placeholder="min"
                      width={80}
                    />
                    <span style={{ color: "var(--text-faint)" }}>–</span>
                    <NumberField
                      value={boundText(c, "max")}
                      onChange={(v) => onRange(c, "max", v)}
                      placeholder="max"
                      width={80}
                    />
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
                    {c.levels.map((lv) => {
                      const allowed =
                        c.current?.kind === "set" && c.current.values
                          ? c.current.values.includes(lv)
                          : true; // no predicate → all levels allowed
                      return (
                        <Checkbox
                          key={lv}
                          checked={allowed}
                          onChange={() => f.toggleLevel(c.index, lv)}
                        >
                          {fmtNum(lv)}
                        </Checkbox>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
              showing {f.kept} of {f.total} rows
            </span>
            <Button
              size="sm"
              disabled={!f.active}
              onClick={() => {
                setText({});
                f.clear();
              }}
            >
              Clear
            </Button>
          </div>
        </>
      )}
    </ToolWindow>
  );
}
