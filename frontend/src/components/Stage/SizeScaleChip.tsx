// The size key (gap audit 3, N5): the legend row of a marker-size-by-column
// series — three discs at the channel's min / middle / max with their values,
// beside the colour-scale chip. The export's counterpart is the second legend
// `calc/figure_sizes.add_size_legend` adds (same three marks, same labels).

import { fmtNum } from "../../lib/format";
import type { SizeLegendEntry } from "../../lib/sizescatter";

export default function SizeScaleChip({ scale }: { scale: SizeLegendEntry }) {
  const range = `${fmtNum(scale.marks[0].value)} to ${fmtNum(scale.marks[scale.marks.length - 1].value)}`;
  return (
    <div className="it qzk-sizekey" role="img" aria-label={`Marker size ${scale.label}: ${range}`} title={`size = ${scale.label}`}>
      {scale.marks.map((m, i) => (
        <span key={i} className="qzk-sizekey-mark">
          <span className="qzk-sizekey-dot" style={{ width: m.px, height: m.px }} />
          <span className="qzk-colorbar-lbl">{fmtNum(m.value)}</span>
        </span>
      ))}
    </div>
  );
}
