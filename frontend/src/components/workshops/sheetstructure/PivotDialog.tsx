// Time-series pivot (plan item 34): reshape one worksheet between LONG (time, key, value) and WIDE
// (a row per time, a column per key) into a NEW worksheet. The rules are lib/pivot.ts's header; the
// commit is store/pivotRun.ts. The preview line is the real reshape's own result or refusal, so what
// it says is what Apply will do.

import { useMemo, useState } from "react";

import { categoricalLevels } from "../../../lib/categorical";
import { originTextColumns } from "../../../lib/originTextColumns";
import { PIVOT_RULES, type PivotRule } from "../../../lib/pivot";
import { buildLong, buildWide, columnNameOf, type PivotKey } from "../../../lib/pivotSheet";
import { analysisData } from "../../../lib/rowstate";
import { runPivot, runUnpivot } from "../../../store/pivotRun";
import { useApp } from "../../../store/useApp";
import ToolWindowFrame from "../../overlays/ToolWindowFrame";
import "./sheetStructure.css";

type Mode = "wide" | "long";

export default function PivotDialog({ datasetId, onClose }: { datasetId: string; onClose: () => void }) {
  const ds = useApp((s) => s.datasets.find((d) => d.id === datasetId));
  const rows = useMemo(() => (ds && !ds.pending ? analysisData(ds) : null), [ds]);
  const labels = rows?.labels ?? [];
  const texts = useMemo(() => (rows ? originTextColumns(rows) : []), [rows]);
  const [mode, setMode] = useState<Mode>("wide");
  const [time, setTime] = useState(-1);
  const defaultKey = useMemo(() => {
    if (!rows) return "c0";
    const cat = labels.findIndex((_l, i) => categoricalLevels(rows, i));
    return cat >= 0 ? `c${cat}` : texts.length ? `t${texts[0].shortName}` : "c0";
  }, [rows, labels, texts]);
  const [keyPick, setKeyPick] = useState<string | null>(null);
  const keyId = keyPick ?? defaultKey;
  const [value, setValue] = useState<number | null>(null);
  const keyChannel = keyId.startsWith("c") ? Number(keyId.slice(1)) : -2;
  const valueCol = value ?? Math.max(0, labels.findIndex((_l, i) => i !== keyChannel));
  const [rule, setRule] = useState<PivotRule>("refuse");
  const [stack, setStack] = useState<number[] | null>(null);
  const stacked = stack ?? labels.map((_l, i) => i);
  const [skipEmpty, setSkipEmpty] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const key: PivotKey = keyId.startsWith("t") ? { text: keyId.slice(1) } : { channel: keyChannel };
  const spec = { time, key, value: valueCol, rule };
  const preview = useMemo(() => {
    if (!rows) return null;
    if (mode === "wide") {
      const built = buildWide(rows, { time, key: keyId.startsWith("t") ? { text: keyId.slice(1) } : { channel: keyChannel }, value: valueCol, rule });
      return "error" in built ? { error: built.error } : { text: `${built.data.time.length} rows x ${built.data.labels.length} columns (${built.data.labels.slice(0, 6).join(", ")}${built.data.labels.length > 6 ? ", ..." : ""})${built.merged ? `; ${built.merged} repeated cells combined` : ""}${built.skipped ? `; ${built.skipped} rows left out (no time or key)` : ""}` };
    }
    const built = buildLong(rows, stacked, skipEmpty, "value");
    return "error" in built ? { error: built.error } : { text: `${built.data.time.length} rows: time, key, value` };
  }, [rows, mode, time, keyId, keyChannel, valueCol, rule, stacked, skipEmpty]);

  if (!ds) return null;
  const apply = () => {
    const r = mode === "wide" ? runPivot(ds.id, spec) : runUnpivot(ds.id, stacked, skipEmpty);
    if (r.ok) onClose();
    else setErr(r.error);
  };
  const channelOptions = labels.map((_l, i) => (
    <option key={i} value={i}>
      {rows ? columnNameOf(rows, i) : i}
    </option>
  ));
  return (
    <ToolWindowFrame id="time-series-pivot" title={`Pivot ${ds.name}`} width={520} onClose={onClose}>
      <div className="qzk-ss-form">
        <div className="qzk-ss-row" role="radiogroup" aria-label="Direction">
          <label>
            <input type="radio" name="pivot-mode" checked={mode === "wide"} onChange={() => setMode("wide")} /> Long to wide (time, key, value to time x key)
          </label>
          <label>
            <input type="radio" name="pivot-mode" checked={mode === "long"} onChange={() => setMode("long")} /> Wide to long (stack columns)
          </label>
        </div>
        {mode === "wide" ? (
          <>
            <label className="qzk-ss-row">
              Time column
              <select className="qz-select" aria-label="Time column" value={time} onChange={(e) => setTime(Number(e.target.value))}>
                <option value={-1}>{rows ? columnNameOf(rows, -1) : "X"} (X column)</option>
                {channelOptions}
              </select>
            </label>
            <label className="qzk-ss-row">
              Key column
              <select className="qz-select" aria-label="Key column" value={keyId} onChange={(e) => setKeyPick(e.target.value)}>
                {labels.map((_l, i) => (
                  <option key={`c${i}`} value={`c${i}`}>
                    {rows ? columnNameOf(rows, i) : i}
                  </option>
                ))}
                {texts.map((t) => (
                  <option key={`t${t.shortName}`} value={`t${t.shortName}`}>
                    {t.longName ?? t.shortName} (text)
                  </option>
                ))}
              </select>
            </label>
            <label className="qzk-ss-row">
              Value column
              <select className="qz-select" aria-label="Value column" value={valueCol} onChange={(e) => setValue(Number(e.target.value))}>
                {channelOptions}
              </select>
            </label>
            <label className="qzk-ss-row">
              When a time and key repeat
              <select className="qz-select" aria-label="Duplicate rule" value={rule} onChange={(e) => setRule(e.target.value as PivotRule)}>
                {PIVOT_RULES.map((r) => (
                  <option key={r.rule} value={r.rule}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <fieldset className="qzk-ss-row">
              <legend>Columns to stack</legend>
              {labels.map((_l, i) => (
                <label key={i}>
                  <input
                    type="checkbox"
                    aria-label={`Stack ${rows ? columnNameOf(rows, i) : i}`}
                    checked={stacked.includes(i)}
                    onChange={(e) => setStack(e.target.checked ? [...stacked, i].sort((a, b) => a - b) : stacked.filter((c) => c !== i))}
                  />{" "}
                  {rows ? columnNameOf(rows, i) : i}
                </label>
              ))}
            </fieldset>
            <label>
              <input type="checkbox" checked={skipEmpty} onChange={(e) => setSkipEmpty(e.target.checked)} /> Skip empty cells
            </label>
          </>
        )}
        <p className="qzk-ds-meta" role="status" aria-label="Preview">
          {preview ? ("error" in preview ? `Cannot reshape: ${preview.error}` : `Makes ${preview.text}`) : "This worksheet has no rows to use."}
        </p>
        {err && (
          <p className="qzk-ds-meta" role="alert" style={{ color: "var(--danger)" }}>
            {err}
          </p>
        )}
        <div className="qzk-ss-row">
          <button className="qz-btn qz-primary" disabled={!preview || "error" in preview} onClick={apply}>
            Create worksheet
          </button>
          <button className="qz-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </ToolWindowFrame>
  );
}
