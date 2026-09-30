// Graph Builder encoding wells (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4): Color-by,
// Symbol-by and the legend-label source, each a ZoneWell like X/Y/Group (drop a
// channel chip or pick from the list). Symbol offers only channels the modeling
// chokepoint reads as categorical; Color offers every channel (a categorical one
// colours by level, a continuous one by gradient); Label offers every channel —
// a sample id, a field or a temperature column. All three offer the sheet's
// text columns too (./encodingWellModel).
// Box / violin / bar (residual 3) take a categorical Color — by the X
// category, or nesting X by another column (lib/plotEncodingStat) — and refuse
// the rest: a drop is refused with a toast, and a pick the mark cannot draw
// reads "(ignored)" with its one-sentence reason under the wells.
// Thin: assignment, gating and rendering live in useGraphBuilder and
// lib/plotEncoding.

import { useApp } from "../../../store/useApp";
import { encodingNotes, type EncodingZone } from "./encodingWellModel";
import type { GraphBuilderState } from "./useGraphBuilder";
import ZoneWell from "./ZoneWell";

const WELLS: { zone: EncodingZone; title: string; hint: string }[] = [
  { zone: "color", title: "Color", hint: "a colour per level, or a gradient (continuous)" },
  { zone: "symbol", title: "Symbol", hint: "a marker per level (categorical)" },
  { zone: "label", title: "Label", hint: "legend text from a column" },
];

export default function EncodingWells({ g }: { g: GraphBuilderState }) {
  const ds = useApp((s) => s.datasets?.find((d) => d.id === g.datasetId) ?? null);
  const used = WELLS.some((w) => g.chips(w.zone).length > 0);
  const notes = used ? encodingNotes(ds, g.spec) : [];
  if (used && g.family !== "categorical" && g.chips("facet").length > 0) {
    notes.push("Ignored while faceted: facet panels do not split by encodings yet.");
  }
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
      {notes.map((note) => (
        <div key={note} className="qzk-zone-well-note" role="note" style={{ gridColumn: "1 / -1" }}>
          {note}
        </div>
      ))}
    </>
  );
}
