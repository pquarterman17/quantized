// "Text from" for a series' text symbol (plan item 24): the literal text, the text of a worksheet column,
// incremental letters (A, B, C ... AA) or the source row numbers. The canvas and the export read it through
// `lib/markerTextRows.ts`; a blank cell draws no symbol.

import { categoricalLevels } from "../../lib/categorical";
import { textColumnEntries } from "../../lib/originTextColumnCells";
import type { SeriesStyle } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import { Select } from "../primitives";

const COL = "col:";
const TEXT = "text:"; // a text-column sidecar, by name
type Patch = Partial<SeriesStyle>;

interface Props { channel: number; style: SeriesStyle; setSeriesStyle: (channel: number, patch: Patch, coalesce?: string) => void }

export default function SeriesTextSourceControls({ channel, style, setSeriesStyle }: Props) {
  const data = useActiveDataset()?.data;
  const from = style.markerTextFrom;
  // A facet grid that splits its panels by a group or an encoding, or greys excluded rows, draws no per-point text
  // (`lib/facetMarkerTexts`): say so rather than leave the glyphs plain without a word.
  // The causes are named, one string (a selector must return a stable snapshot).
  const why = useApp((s) => {
    if (s.facetKey === null) return "";
    const causes = [
      s.groupKey !== null ? "split by a group" : "",
      s.plotWindows.some((w) => w.id === s.focusedWindowId && w.document?.bindings.encoding) ? "split by an encoding" : "",
      s.excludedDisplay === "grey" ? "greying excluded rows" : "",
    ];
    return causes.filter(Boolean).join(" and ");
  });
  const split = why !== "";
  const picked = typeof from === "object" ? TEXT + from.name : typeof from === "number" ? COL + from : (from ?? "");
  const columns = (data?.labels ?? []).map((name, i) => ({ value: COL + i, label: data && categoricalLevels(data, i) ? `${name} (text)` : name }));
  const sidecars = data ? textColumnEntries(data).map(([name]) => ({ value: TEXT + name, label: `${name} (text column)` })) : [];
  return (
    <>
    <label className="qzk-field-lbl" style={{ margin: 0 }}>
      Text from
      <Select
        aria-label="Text symbol source"
        options={[
          { value: "", label: "The text above" },
          { value: "letters", label: "Incremental letters (A, B, C)" },
          { value: "rows", label: "Row numbers" },
          ...columns,
          ...sidecars,
        ]}
        value={picked}
        onChange={(e) => {
          const v = e.target.value;
          const patch: Patch = { markerTextFrom: v === "" ? undefined
            : v === "letters" || v === "rows" ? v
              : v.startsWith(TEXT) ? { name: v.slice(TEXT.length) }
                : Number(v.slice(COL.length)) };
          setSeriesStyle(channel, patch, `marker-text-from:${channel}`);
        }}
      />
    </label>
    {split && from !== undefined && <span role="note" className="qzk-field-lbl" style={{ margin: 0 }}>Text symbols are not drawn on a facet grid that is split by a group or an encoding, or that greys excluded rows (this grid is {why})</span>}
    </>
  );
}
