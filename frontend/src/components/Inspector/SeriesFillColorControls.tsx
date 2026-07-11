// Fill (MAIN #13) + colour-mapped scatter (MAIN #14) controls for one
// SeriesStyleCard row. Extracted from SeriesStyleCard.tsx to keep that
// component under the ~400-line ceiling — these two features each need a
// picker over the OTHER channels (fill's `vs` target / colorBy's z channel),
// which is enough extra markup to earn its own file.

import { COLORMAPS, type ColormapName } from "../../lib/colormap";
import type { SeriesStyle } from "../../lib/types";
import { Checkbox, Select } from "../primitives";

const COLORMAP_NAMES = Object.keys(COLORMAPS) as ColormapName[];

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
  /** Every channel's label, in dataset-channel-index order — the `vs`/
   *  `colorBy` picker source. */
  labels: readonly string[];
  setSeriesStyle: (channel: number, patch: Partial<SeriesStyle>) => void;
}) {
  const mode = fillMode(style.fill);
  const vsChannel = typeof style.fill === "object" ? style.fill.vs : undefined;
  const otherChannels = labels.map((lab, i) => ({ i, lab })).filter(({ i }) => i !== channel);

  return (
    <>
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

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <Checkbox
          checked={style.colorBy != null}
          onChange={(c) =>
            setSeriesStyle(channel, {
              colorBy: c ? (otherChannels[0]?.i ?? channel) : undefined,
            })
          }
        >
          Colour by
        </Checkbox>
        {style.colorBy != null && (
          <>
            <Select
              title="Colour-by channel"
              options={labels.map((lab, i) => ({ value: String(i), label: lab }))}
              value={String(style.colorBy)}
              onChange={(e) => setSeriesStyle(channel, { colorBy: Number(e.target.value) })}
            />
            <Select
              title="Colormap"
              options={COLORMAP_NAMES.map((c) => ({ value: c, label: c }))}
              value={style.colormap ?? "viridis"}
              onChange={(e) => setSeriesStyle(channel, { colormap: e.target.value as ColormapName })}
            />
          </>
        )}
      </div>
    </>
  );
}
