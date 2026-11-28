// Clustering tab: per-tool settings (view). Numeric fields commit on Enter/blur
// (BufferedNumberField); prepareCluster validates before a run.

import { Select } from "../../../primitives";
import BufferedNumberField from "../../../primitives/BufferedNumberField";
import type { ClusterStandardize, VariableDistance } from "../../../../lib/api/cluster";
import type { ClusterStart } from "./clusterCentres";
import type { ClusterState } from "./useCluster";

const row = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 } as const;
const SCALING: { value: ClusterStandardize; label: string }[] = [
  { value: "zscore", label: "z-score" },
  { value: "range", label: "Range (0 to 1)" },
  { value: "none", label: "None" },
];

function Num({ label, value, min, max, onValue, hint, float }: {
  label: string; value: number; min?: number; max?: number; onValue: (v: number) => void; hint?: string; float?: boolean;
}) {
  return (
    <div title={hint}>
      <label className="qzk-field-lbl">{label}</label>
      <BufferedNumberField aria-label={label} type="number" width={78} required min={min} max={max} step={float ? "any" : 1}
        value={value} onValue={(v) => { if (v !== undefined) onValue(float ? v : Math.round(v)); }} />
    </div>
  );
}

const CUT = [{ value: "k", label: "Number of clusters" }, { value: "distance", label: "Distance" }];

/** Where k-means starts: a seeded start, k worksheet rows, or a pasted k x p table of centres. */
function StartCentres({ x }: { x: ClusterState }) {
  const k = x.opts.kmeans;
  const { patch } = x;
  return (
    <div style={row}>
      <div style={{ minWidth: 150 }}>
        <label className="qzk-field-lbl">Starting centres</label>
        <Select aria-label="Starting centres" value={k.start} onChange={(e) => patch("kmeans", { start: e.target.value as ClusterStart })}
          options={[{ value: "auto", label: "Seeded start (automatic)" }, { value: "rows", label: "Pick rows as centres" }, { value: "table", label: "Enter a centre table" }]} />
      </div>
      {k.start === "rows" && (
        <div title="Worksheet row numbers, as the worksheet shows them; their values become the starting centres (one run, no restarts)">
          <label className="qzk-field-lbl">Start rows (k of them)</label>
          <input className="qz-input" aria-label="Start rows" style={{ width: 150 }} placeholder="e.g. 1, 12, 30" value={k.startRows}
            onChange={(e) => patch("kmeans", { startRows: e.target.value })} />
        </div>
      )}
      {k.start === "table" && (
        <div title="One line per cluster and one value per picked column, in the data's own units; paste from a worksheet and the single run starts there">
          <label className="qzk-field-lbl">Centre table (k lines)</label>
          <textarea className="qz-input" aria-label="Centre table" rows={Math.max(2, Math.min(k.k, 6))} cols={34} spellCheck={false}
            style={{ fontFamily: "var(--font-mono)", fontSize: 11 }} value={k.centreText} onChange={(e) => patch("kmeans", { centreText: e.target.value })} />
        </div>
      )}
    </div>
  );
}

export default function ClusterForms({ x }: { x: ClusterState }) {
  const { patch } = x;
  if (x.tool === "variables") {
    const v = x.opts.variables;
    return (
      <div>
        <div style={row}>
          <div style={{ minWidth: 100 }}>
            <label className="qzk-field-lbl">Linkage</label>
            <Select aria-label="Linkage" value={v.method} onChange={(e) => patch("variables", { method: e.target.value as typeof v.method })}
              options={[{ value: "average", label: "Average" }, { value: "complete", label: "Complete" }, { value: "single", label: "Single" }]} />
          </div>
          <div style={{ minWidth: 150 }} title="Distance between two variables from their Pearson correlation r (Ward is not offered: neither is Euclidean)">
            <label className="qzk-field-lbl">Distance</label>
            <Select aria-label="Distance" value={v.corr} onChange={(e) => patch("variables", { corr: e.target.value as VariableDistance })}
              options={[{ value: "abs", label: "1 - |r| (sign ignored)" }, { value: "signed", label: "1 - r (sign counts)" }]} />
          </div>
          <div style={{ minWidth: 130 }}>
            <label className="qzk-field-lbl">Cut by</label>
            <Select aria-label="Cut by" value={v.cutBy} onChange={(e) => patch("variables", { cutBy: e.target.value as "k" | "distance" })} options={CUT} />
          </div>
          {v.cutBy === "k"
            ? <Num label="Clusters" value={v.k} min={1} onValue={(n) => patch("variables", { k: n })} />
            : <Num label="Cut distance" value={v.distance} min={0} float onValue={(n) => patch("variables", { distance: n })} />}
        </div>
        <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
          Clusters the picked columns (at least 3) by how strongly they correlate; a correlation does not depend on scaling.
        </div>
      </div>
    );
  }
  if (x.tool === "kmeans") {
    const k = x.opts.kmeans;
    return (
      <div>
        <div style={row}>
          <Num label="k (clusters)" value={k.k} min={2} max={100} onValue={(v) => patch("kmeans", { k: v })} />
          <div style={{ minWidth: 110 }}>
            <label className="qzk-field-lbl">Scaling</label>
            <Select aria-label="Scaling" value={k.standardize} onChange={(e) => patch("kmeans", { standardize: e.target.value as ClusterStandardize })} options={SCALING} />
          </div>
          <div style={{ minWidth: 110 }}>
            <label className="qzk-field-lbl">Initialization</label>
            <Select aria-label="Initialization" value={k.init} onChange={(e) => patch("kmeans", { init: e.target.value as "kmeans++" | "random" })}
              options={[{ value: "kmeans++", label: "k-means++" }, { value: "random", label: "Random rows" }]} />
          </div>
        </div>
        <StartCentres x={x} />
        <div style={row}>
          <Num label="Seed" value={k.seed} min={0} onValue={(v) => patch("kmeans", { seed: v })} hint="Fixed seed: the same clusters every run (not used with given starting centres)" />
          <Num label="Restarts" value={k.nInit} min={1} max={200} onValue={(v) => patch("kmeans", { nInit: v })} hint="Independent starts; the lowest within-cluster sum of squares wins" />
          <Num label="Max iterations" value={k.maxIter} min={1} max={100000} onValue={(v) => patch("kmeans", { maxIter: v })} />
        </div>
      </div>
    );
  }
  const h = x.opts.hierarchical;
  return (
    <div>
      <div style={row}>
        <div style={{ minWidth: 100 }}>
          <label className="qzk-field-lbl">Linkage</label>
          <Select aria-label="Linkage" value={h.method} onChange={(e) => patch("hierarchical", { method: e.target.value as typeof h.method })}
            options={[{ value: "average", label: "Average" }, { value: "complete", label: "Complete" }, { value: "single", label: "Single" }, { value: "ward", label: "Ward" }]} />
        </div>
        <div style={{ minWidth: 110 }}>
          <label className="qzk-field-lbl">Distance</label>
          <Select aria-label="Distance" value={h.metric} onChange={(e) => patch("hierarchical", { metric: e.target.value as typeof h.metric })}
            options={[{ value: "euclidean", label: "Euclidean" }, { value: "sqeuclidean", label: "Squared Euclidean" }, { value: "cityblock", label: "City block" },
              { value: "cosine", label: "Cosine" }, { value: "correlation", label: "Correlation" }]} />
        </div>
        <div style={{ minWidth: 110 }}>
          <label className="qzk-field-lbl">Scaling</label>
          <Select aria-label="Scaling" value={h.standardize} onChange={(e) => patch("hierarchical", { standardize: e.target.value as ClusterStandardize })} options={SCALING} />
        </div>
      </div>
      <div style={row}>
        <div style={{ minWidth: 130 }}>
          <label className="qzk-field-lbl">Cut by</label>
          <Select aria-label="Cut by" value={h.cutBy} onChange={(e) => patch("hierarchical", { cutBy: e.target.value as "k" | "distance" })}
            options={CUT} />
        </div>
        {h.cutBy === "k"
          ? <Num label="Clusters" value={h.k} min={1} onValue={(v) => patch("hierarchical", { k: v })} />
          : <Num label="Cut distance" value={h.distance} min={0} float onValue={(v) => patch("hierarchical", { distance: v })} />}
      </div>
    </div>
  );
}
