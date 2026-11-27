// Clustering tab: the result readout (view). k-means: settings line, per-cluster
// table (count, within sum of squares, silhouette) and centroids in original
// units. Hierarchical: cophenetic correlation, cluster sizes and the dendrogram
// with its export. Lazy with the tab.

import { useState } from "react";

import { exportDendrogramFigure } from "../../../../lib/api/cluster";
import { runCancellable } from "../../../../store/pendingOpActions";
import { useApp } from "../../../../store/useApp";
import { Button } from "../../../primitives";
import type { ClusterMeta, ClusterResult } from "./clusterRun";
import { clusterColor } from "./dendrogramModel";
import DendrogramView from "./DendrogramView";

function fmt(v: number | null | undefined, digits = 4): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toPrecision(digits)).toString();
}

const th = { textAlign: "right", fontWeight: 400, color: "var(--text-faint)" } as const;
const mono = { textAlign: "right", fontFamily: "var(--font-mono)" } as const;
const faint = { color: "var(--text-faint)" } as const;
const swatch = (c: number) => <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, marginRight: 5, background: clusterColor(c) }} />;

function Skipped({ meta }: { meta: ClusterMeta }) {
  return (
    <div className="qzk-ds-meta">
      {meta.sourceRows.length} rows clustered over {meta.columns.length} columns.
      {meta.dropped > 0 && ` ${meta.dropped} row${meta.dropped === 1 ? "" : "s"} with a blank or non-numeric cell skipped (not imputed).`}
    </div>
  );
}

function DendrogramExport({ r, meta }: { r: Extract<ClusterResult, { tool: "hierarchical" }>; meta: ClusterMeta }) {
  const setStatus = useApp((s) => s.setStatus);
  const [busy, setBusy] = useState<string | null>(null);
  async function go(fmt: "pdf" | "svg" | "png"): Promise<void> {
    setBusy(fmt);
    try {
      const done = await runCancellable("Exporting dendrogram…", (signal) => exportDendrogramFigure({
        geometry: r.data.dendrogram, leaf_names: meta.sourceRows.map(String), fmt,
        title: `${r.data.method} linkage, ${r.data.metric} distance`,
      }, signal));
      setStatus(done ? `exported dendrogram (${fmt})` : "export cancelled");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "export failed");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
      {(["pdf", "svg", "png"] as const).map((f) => (
        <Button key={f} size="sm" disabled={busy !== null} onClick={() => void go(f)}>{busy === f ? "Exporting…" : `Export ${f.toUpperCase()}`}</Button>
      ))}
    </div>
  );
}

export default function ClusterResults({ result, meta }: { result: ClusterResult; meta: ClusterMeta }) {
  if (result.tool === "kmeans") {
    const d = result.data;
    return (
      <div style={{ marginTop: 10 }}>
        <Skipped meta={meta} />
        <div className="qzk-ds-meta">
          k = {d.k}, scaling {d.standardize}, {d.init}, seed {d.seed}, best of {d.n_init} restarts (#{d.best_restart}); {d.iterations} iterations,
          {d.converged ? " converged" : " NOT converged (raise the iteration limit)"}.
        </div>
        <div className="qzk-ds-meta">
          Total within-cluster SS {fmt(d.total_wcss)} (between {fmt(d.between_ss)} of {fmt(d.total_ss)}, in the scaled space)
          {d.silhouette != null ? `; mean silhouette ${fmt(d.silhouette)}` : `; silhouette ${d.silhouette_note ?? "not computed"}`}.
        </div>
        <table className="qzk-rsm-table" style={{ width: "100%", fontSize: 11, marginTop: 4 }}>
          <thead><tr>
            <th style={{ ...th, textAlign: "left" }}>cluster</th><th style={th}>n</th><th style={th}>within SS</th>
            {d.silhouette_by_cluster && <th style={th}>silhouette</th>}
            {meta.columns.map((c) => <th key={c} style={th} title="centroid, original units">{c}</th>)}
          </tr></thead>
          <tbody>{d.counts.map((n, i) => (
            <tr key={i}>
              <td>{swatch(i + 1)}{i + 1}</td><td style={mono}>{n}</td><td style={mono}>{fmt(d.wcss_by_cluster[i])}</td>
              {d.silhouette_by_cluster && <td style={mono}>{fmt(d.silhouette_by_cluster[i])}</td>}
              {d.centroids[i].map((v, j) => <td key={j} style={mono}>{fmt(v)}</td>)}
            </tr>))}</tbody>
        </table>
        <div className="qzk-ds-meta" style={faint}>Centroid columns are in the data&apos;s own units; distances are taken after scaling.</div>
      </div>
    );
  }
  const d = result.data;
  return (
    <div style={{ marginTop: 10 }}>
      <Skipped meta={meta} />
      <div className="qzk-ds-meta">
        {d.method} linkage, {d.metric} distance, scaling {d.standardize}; cut at {fmt(d.cut_distance)} gives {d.k} cluster{d.k === 1 ? "" : "s"}
        {" "}({d.counts.join(", ")}). Cophenetic correlation {fmt(d.cophenetic_correlation)}.
      </div>
      <DendrogramView geometry={d.dendrogram} leafNames={meta.sourceRows.map(String)} />
      <div className="qzk-ds-meta" style={faint}>Leaves are labelled by worksheet row; links inside a cluster are coloured, links above the dashed cut are grey.</div>
      <DendrogramExport r={result} meta={meta} />
    </div>
  );
}
