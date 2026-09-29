// Graph Builder encoding wells (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4): Color-by,
// Symbol-by and the legend-label source, each a ZoneWell like X/Y/Group (drop a
// channel chip or pick from the list). Symbol offers only channels the modeling
// chokepoint reads as categorical; Color offers every channel (a categorical one
// colours by level, a continuous one by gradient); Label offers every channel —
// a sample id, a field or a temperature column. All three offer the sheet's
// text columns too (./encodingWellModel).
// Box/violin/bar ignore encodings, so the wells hide for those marks unless one
// is already assigned — then they stay, saying so, so it can still be removed.
// Thin: assignment, gating and rendering live in useGraphBuilder and
// lib/plotEncoding.

import type { EncodingZone } from "./encodingWellModel";
import type { GraphBuilderState } from "./useGraphBuilder";
import ZoneWell from "./ZoneWell";

const WELLS: { zone: EncodingZone; title: string; hint: string }[] = [
  { zone: "color", title: "Color", hint: "a colour per level, or a gradient (continuous)" },
  { zone: "symbol", title: "Symbol", hint: "a marker per level (categorical)" },
  { zone: "label", title: "Label", hint: "legend text from a column" },
];

/** Why the assigned encodings are not drawn, or where they are — null when
 *  there is nothing to say. */
function noteFor(g: GraphBuilderState): string | null {
  if (g.family === "categorical") return "Box, violin and bar ignore encodings.";
  if (g.chips("facet").length > 0) return "Ignored while faceted: facet panels do not split by encodings yet.";
  return null;
}

export default function EncodingWells({ g }: { g: GraphBuilderState }) {
  const used = WELLS.some((w) => g.chips(w.zone).length > 0);
  if (g.family === "categorical" && !used) return null;
  const note = used ? noteFor(g) : null;
  return (
    <>
      {WELLS.map((w) => (
        <ZoneWell
          key={w.zone}
          title={w.title}
          hint={w.hint}
          datasetId={g.datasetId}
          options={g.encodingOptions[w.zone]}
          assigned={g.chips(w.zone)}
          onAssign={(c) => g.assign(w.zone, c)}
          onRemove={(c) => g.remove(w.zone, c)}
        />
      ))}
      {note && (
        <div className="qzk-zone-well-note" role="note" style={{ gridColumn: "1 / -1" }}>
          {note}
        </div>
      )}
    </>
  );
}
