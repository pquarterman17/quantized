// Multivariate workshop, PLS / LDA / spectra PCA tab (GAP_AUDIT_9 G12). Lazy
// (React.lazy from MultivarPanel) so none of it joins the eager bundle. Uses
// the workshop's own column picks as the predictors / variables / spectra;
// state: ./useMultivarExt, settings: ./ExtForms, readout: ./ExtResults.

import { Button } from "../../../primitives";
import { SegmentedControl } from "../../../primitives/SegmentedControl";
import type { MultivarState } from "../useMultivar";
import ExtForms from "./ExtForms";
import ExtResults from "./ExtResults";
import { EXT_TOOLS, type ExtTool } from "./multivarExtRun";
import { useMultivarExt } from "./useMultivarExt";

export default function MultivarExtTab({ m }: { m: MultivarState }) {
  const x = useMultivarExt(m);
  const faint = { marginTop: 6, color: "var(--text-faint)" } as const;
  return (
    <div style={{ marginTop: 12 }}>
      <SegmentedControl<ExtTool> aria-label="Calibration and classification tool" options={EXT_TOOLS.map((t) => ({ value: t.id, label: t.label }))}
        value={x.tool} onChange={x.setTool} />
      <ExtForms x={x} m={m} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <Button size="sm" disabled={!!x.problem || x.busy} title={x.problem ?? undefined} onClick={() => void x.run()}>{x.busy ? "Running…" : "Run"}</Button>
        {x.outputs.map((o) => (
          <Button key={o.key} size="sm" disabled={!x.canCommit} title="Add as a linked worksheet (one undo step; a repeat adds nothing)" onClick={() => x.commit(o.key)}>
            Add {o.button}
          </Button>
        ))}
      </div>
      {x.problem && <div className="qzk-ds-meta" style={faint}>{x.problem}</div>}
      {x.error && <div className="qzk-ds-meta" role="alert" style={{ marginTop: 6, color: "var(--warn, var(--text-faint))" }}>{x.error}</div>}
      {x.done && <div className="qzk-ds-meta" style={{ marginTop: 6 }}>{x.done}</div>}
      {x.stale && !x.busy && <div className="qzk-ds-meta" style={faint}>The data or settings changed since the last run; run again.</div>}
      {x.result && x.meta && <ExtResults result={x.result} meta={x.meta} figures={x.figures} />}
    </div>
  );
}
