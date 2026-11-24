import { Button } from "../../primitives";
import { OutOfDateNote } from "../workbench/WorkbenchParts";
import { useMagSeriesCompare } from "./useMagSeriesCompare";

export default function MagComparePane() {
  const c = useMagSeriesCompare();
  return (
    <div style={{ marginTop: 12 }}>
      <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        Overlays the worksheets selected in the Library as one worksheet of X, Y pairs,
        matching each by the response name{c.channel ? ` "${c.channel}"` : ""} against its own
        X axis (a declared field or temperature, the same kind in every worksheet). Every
        series is converted to the units of the active worksheet; nothing is resampled, so a
        loop keeps its order. Only committed Y uncertainty is carried.
      </div>
      <div style={{ marginTop: 12 }}>
        <Button variant="primary" size="sm" disabled={c.busy || c.problem !== null} onClick={() => void c.compare()}>
          {c.busy ? "Comparing…" : `Create comparison of ${c.count} worksheets →`}
        </Button>
      </div>
      {c.problem && <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, #c90)" }}>{c.problem}</div>}
      {c.stale && <OutOfDateNote block>the selection or response changed after the last comparison. Create it again.</OutOfDateNote>}
      {c.shown && c.shown.summary.length > 0 && (
        <ul className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)", paddingLeft: 16 }}>
          {c.shown.summary.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
      {c.shown?.warning && <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, #c90)" }}>{c.shown.warning}</div>}
      {c.shown?.error && <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--danger)" }}>{c.shown.error}</div>}
    </div>
  );
}
