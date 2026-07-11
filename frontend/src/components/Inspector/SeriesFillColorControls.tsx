// Fill (MAIN #13) controls for one SeriesStyleCard row. Extracted from
// SeriesStyleCard.tsx to keep that component under the ~400-line ceiling —
// the fill picker needs a select over the OTHER channels (the `vs` target),
// which is enough extra markup to earn its own file.

import type { SeriesStyle } from "../../lib/types";
import { Select } from "../primitives";

type FillMode = "none" | "under" | "between";

function fillMode(fill: SeriesStyle["fill"]): FillMode {
  if (fill === "under") return "under";
  if (fill && fill !== "none") return "between";
  return "none";
}

export default function SeriesFillColorControls({
  channel,
  style,
  labels,
  setSeriesStyle,
}: {
  channel: number;
  style: SeriesStyle;
  /** Every channel's label, in dataset-channel-index order — the `vs`
   *  picker source. */
  labels: readonly string[];
  setSeriesStyle: (channel: number, patch: Partial<SeriesStyle>) => void;
}) {
  const mode = fillMode(style.fill);
  const vsChannel = typeof style.fill === "object" ? style.fill.vs : undefined;
  const otherChannels = labels.map((lab, i) => ({ i, lab })).filter(({ i }) => i !== channel);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
      <span className="qzk-field-lbl" style={{ margin: 0 }}>
        Fill
      </span>
      <Select
        options={[
          { value: "none", label: "None" },
          { value: "under", label: "Under (to zero)" },
          { value: "between", label: "Between…" },
        ]}
        value={mode}
        onChange={(e) => {
          const next = e.target.value as FillMode;
          // "None" clears the override entirely (undefined), matching the
          // width/line/marker "unset = default" convention above — not the
          // "none" literal, which is only ever produced by an external
          // source (an Origin-applied figure, a .dwk round-trip) needing an
          // explicit "no fill" distinct from "unset".
          if (next === "none") setSeriesStyle(channel, { fill: undefined });
          else if (next === "under") setSeriesStyle(channel, { fill: "under" });
          else setSeriesStyle(channel, { fill: { vs: otherChannels[0]?.i ?? channel } });
        }}
      />
      {mode === "between" && otherChannels.length > 0 && (
        <Select
          title="Fill against"
          options={otherChannels.map(({ i, lab }) => ({ value: String(i), label: lab }))}
          value={String(vsChannel ?? otherChannels[0].i)}
          onChange={(e) => setSeriesStyle(channel, { fill: { vs: Number(e.target.value) } })}
        />
      )}
    </div>
  );
}
