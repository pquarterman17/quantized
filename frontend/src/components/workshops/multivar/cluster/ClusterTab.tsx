// Multivariate workshop, Clustering tab (ORIGIN_FEATURE_GAP_PLAN item 11, J13).
// Lazy (React.lazy from MultivarPanel) so none of it joins the eager bundle.
// Clusters the workshop's own column picks; state: ./useCluster, settings:
// ./ClusterForms, readout and dendrogram: ./ClusterResults.

import { Button } from "../../../primitives";
import { SegmentedControl } from "../../../primitives/SegmentedControl";
import StatsInputReview from "../../analysisselection/StatsInputReview";
import { clusterRows } from "../multivarReviewRows";
import type { MultivarState } from "../useMultivar";
import ClusterForms from "./ClusterForms";
import ClusterResultBook from "./ClusterResultBook";
import { CLUSTER_TOOLS, type ClusterTool } from "./clusterRun";
import { useCluster } from "./useCluster";

export default function ClusterTab({ m }: { m: MultivarState }) {
  const x = useCluster(m);
  const faint = { marginTop: 6, color: "var(--text-faint)" } as const;
  return (
    <div style={{ marginTop: 12 }}>
      <StatsInputReview inputs={m.inputs} rows={clusterRows(m.inputs, m.selected, x.tool, x.opts)} />
      <SegmentedControl<ClusterTool> aria-label="Clustering method" options={CLUSTER_TOOLS.map((t) => ({ value: t.id, label: t.label }))}
        value={x.tool} onChange={x.setTool} />
      <ClusterForms x={x} />
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
      <ClusterResultBook x={x} />
    </div>
  );
}
