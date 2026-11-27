// Dendrogram on screen: an SVG drawn from `dendrogramDrawList` (the same draw
// list the matplotlib export draws; see dendrogramModel.ts). Links inside a
// cluster take its colour, links above the cut are grey, the cut is a dashed
// line and each leaf carries a marker in its cluster's colour.

import type { DendrogramGeometry } from "../../../../lib/api/cluster";
import { LEAF_LABEL_MAX, dendrogramDrawList } from "./dendrogramModel";

const W = 440;
const H = 250;
const M = { left: 40, right: 10, top: 10, bottom: 46 };

export default function DendrogramView({ geometry, leafNames }: { geometry: DendrogramGeometry; leafNames: string[] }) {
  const d = dendrogramDrawList(geometry);
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  const px = (x: number): number => M.left + ((x - d.xRange[0]) / (d.xRange[1] - d.xRange[0])) * pw;
  const py = (y: number): number => M.top + ph - ((y - d.yRange[0]) / (d.yRange[1] - d.yRange[0])) * ph;
  const labelled = geometry.n_leaves <= LEAF_LABEL_MAX;
  return (
    <svg role="img" aria-label="Dendrogram" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <line x1={M.left} y1={M.top + ph} x2={M.left + pw} y2={M.top + ph} stroke="var(--border-soft)" />
      <line x1={M.left} y1={M.top} x2={M.left} y2={M.top + ph} stroke="var(--border-soft)" />
      {[0, 0.5, 1].map((f) => {
        const v = d.yRange[1] * f;
        return (
          <text key={f} x={M.left - 4} y={py(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-faint)" fontFamily="var(--font-mono)">
            {Number(v.toPrecision(3)).toString()}
          </text>
        );
      })}
      {d.links.map((l, i) => (
        <polyline key={i} data-testid="dendrogram-link" fill="none" stroke={l.color} strokeWidth={1.4}
          points={l.x.map((x, j) => `${px(x)},${py(l.y[j])}`).join(" ")} />
      ))}
      <line data-testid="dendrogram-cut" x1={M.left} x2={M.left + pw} y1={py(d.cutY)} y2={py(d.cutY)}
        stroke="var(--text-dim)" strokeDasharray="5 3" strokeWidth={1} />
      {d.leaves.map((l, i) => (
        <circle key={i} data-testid="dendrogram-leaf" cx={px(l.x)} cy={py(0)} r={2.6} fill={l.color} />
      ))}
      {labelled && d.leafOrder.map((row, i) => (
        <text key={row} x={px(i)} y={py(0) + 8} fontSize={8} fill="var(--text-faint)" fontFamily="var(--font-mono)"
          textAnchor="end" transform={`rotate(-90 ${px(i)} ${py(0) + 8})`}>
          {leafNames[row]}
        </text>
      ))}
      <text x={12} y={M.top + ph / 2} fontSize={9} fill="var(--text-faint)" textAnchor="middle"
        transform={`rotate(-90 12 ${M.top + ph / 2})`}>distance</text>
    </svg>
  );
}
