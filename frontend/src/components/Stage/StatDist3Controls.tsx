// The Stat Stage toolbar's half / split violin, paired, lollipop and stacked-
// histogram controls (plan item 20). Half / split: the style (a split needs a
// "then by" column with two levels) and the KDE bandwidth (shared with the
// ridgeline). Paired: the "before" (y) and "after" columns and the mean +- CI
// marker. Lollipop: the statistic and the order. Histogram: stack the columns.
// Split out of `StatStage.tsx` (400-line ceiling).

import type { ReactNode } from "react";

import { resolveRug } from "../../lib/statCdf";
import { useApp } from "../../store/useApp";
import { LOLLIPOP_SORTS, LOLLIPOP_STATS, LOLLIPOP_WHISKERS, VIOLIN_MARKS, VIOLIN_SIDES } from "../../lib/plotviewSanitize";
import { Select } from "../primitives";
import BufferedNumberField from "../primitives/BufferedNumberField";
import { Checkbox } from "../primitives/Checkbox";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { pairedAfterCol } from "./statDist3Draw";
import StatFacetPicker from "./StatFacetPicker";
import BandwidthPicker from "./StatBandwidth";
import type { StatStageState } from "./useStatStageTypes";

function Picker({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
      {label}
      {children}
    </label>
  );
}

const SIDE_LABELS = { half: "right half", left: "left half", split: "split" };
const SIDES = VIOLIN_SIDES.map((s) => ({ value: s, label: SIDE_LABELS[s] }));
const MARKS = VIOLIN_MARKS.map((m) => ({ value: m, label: m === "none" ? "(none)" : m }));
const STATS = LOLLIPOP_STATS.map((s) => ({ value: s, label: s }));
const SORTS = LOLLIPOP_SORTS.map((s) => ({ value: s, label: s === "none" ? "as is" : s === "asc" ? "ascending" : "descending" }));
const WHISKERS = LOLLIPOP_WHISKERS.map((w) => ({ value: w, label: w === "none" ? "(none)" : w === "ci" ? "95 % CI" : w.toUpperCase() }));

function Controls({ st }: { st: StatStageState }) {
  const d = st.dist2;
  if (st.mode === "histogram") {
    const split = d.histSplit && st.groupCol != null;
    const groupOptions = [{ value: "none", label: "(none)" }, ...st.categoricalCols.map((c) => ({ value: String(c.index), label: c.label }))];
    // Choosing a column splits the histogram into one stacked series per level; "(none)" is the plain histogram.
    const pick = (v: string) => {
      if (v === "none") return st.setDist2({ histSplit: false });
      st.setGroupCol(Number(v));
      st.setDist2({ histSplit: true, histStack: true });
    };
    return (
      <>
        {st.categoricalCols.length > 0 && (
          <Picker label="split by">
            <Select options={groupOptions} value={split ? String(st.groupCol) : "none"} onChange={(e) => pick(e.target.value)} />
          </Picker>
        )}
        {/* A plain histogram draws per facet panel too: offer the pick, and keep it visible while a facet is set. */}
        {(split || st.categoricalCols.length > 0 || st.facetCol != null) && <StatFacetPicker st={st} />}
        {(st.histCols.length > 0 || split) && (
          <Checkbox checked={d.histStack} onChange={(v) => st.setDist2({ histStack: v })} title="Stack the series on the shared bins">
            stack
          </Checkbox>
        )}
        {(st.histCols.length > 0 || split) && d.histStack && (
          <Checkbox checked={d.histPercent} onChange={(v) => st.setDist2({ histPercent: v })} title="Scale each bin's stack to 100 %">
            100 %
          </Checkbox>
        )}
      </>
    );
  }
  if (st.mode === "sideviolin") {
    return (
      <>
        <Picker label="side">
          <SegmentedControl options={SIDES} value={d.violinSide} onChange={(v) => st.setDist2({ violinSide: v })} />
        </Picker>
        <Picker label="inner marks">
          <Select options={MARKS} value={d.violinMarks} onChange={(e) => st.setDist2({ violinMarks: e.target.value as (typeof VIOLIN_MARKS)[number] })} />
        </Picker>
        <Checkbox checked={d.violinMean} onChange={(v) => st.setDist2({ violinMean: v })} title="A diamond at each violin's mean">
          mean
        </Checkbox>
        {d.violinSide !== "split" && (
          <Checkbox checked={d.violinRain} onChange={(v) => st.setDist2({ violinRain: v })} title="The raw points beside the half violin (a raincloud)">
            rain points
          </Checkbox>
        )}
        <BandwidthPicker value={d.ridgeBw} onChange={(ridgeBw) => st.setDist2({ ridgeBw })} />
      </>
    );
  }
  if (st.mode === "lollipop") {
    return (
      <>
        <Picker label="value">
          <SegmentedControl options={STATS} value={d.lollipopStat} onChange={(v) => st.setDist2({ lollipopStat: v })} />
        </Picker>
        <Picker label="order">
          <Select options={SORTS} value={d.lollipopSort} onChange={(e) => st.setDist2({ lollipopSort: e.target.value as (typeof LOLLIPOP_SORTS)[number] })} />
        </Picker>
        <Picker label="whiskers">
          <Select
            options={WHISKERS}
            value={d.lollipopStat === "mean" ? d.lollipopWhisker : "none"}
            disabled={d.lollipopStat !== "mean"}
            title={d.lollipopStat === "mean" ? "Spread of each group's mean" : "Whiskers are drawn for the mean only"}
            onChange={(e) => st.setDist2({ lollipopWhisker: e.target.value as (typeof LOLLIPOP_WHISKERS)[number] })}
          />
        </Picker>
        <Checkbox
          checked={d.lollipopCaps && d.lollipopStat === "mean" && d.lollipopWhisker !== "none"}
          disabled={d.lollipopStat !== "mean" || d.lollipopWhisker === "none"}
          onChange={(v) => st.setDist2({ lollipopCaps: v })}
          title={d.lollipopStat === "mean" && d.lollipopWhisker !== "none" ? "A bar across each whisker end" : "Caps need whiskers: pick SD, SEM or 95 % CI first"}
        >
          caps
        </Checkbox>
        <Checkbox checked={d.lollipopHoriz} onChange={(v) => st.setDist2({ lollipopHoriz: v })} title="Categories down the Y axis (a dot chart)">
          horizontal
        </Checkbox>
      </>
    );
  }
  if (st.mode !== "paired") return null;
  const channels = st.columns.map((c) => ({ value: String(c.index), label: c.label }));
  const after = pairedAfterCol(st.histCols, st.valueCol, st.columns.length);
  return (
    <>
      <Picker label="before">
        <Select options={channels} value={String(st.valueCol)} onChange={(e) => st.setValueCol(Number(e.target.value))} />
      </Picker>
      <Picker label="after">
        <Select
          options={channels.filter((c) => c.value !== String(st.valueCol))}
          value={String(after)}
          onChange={(e) => st.setHistCols([Number(e.target.value)])}
        />
      </Picker>
      <Checkbox checked={d.pairedCi} onChange={(v) => st.setDist2({ pairedCi: v })} title="Each side's mean with its 95 % confidence interval">
        mean ± CI
      </Checkbox>
      <Checkbox checked={d.pairedDirection} onChange={(v) => st.setDist2({ pairedDirection: v })} title="Colour each line by increase, decrease or no change">
        by direction
      </Checkbox>
      {d.pairedDirection && (
        <Picker label="no change within ±">
          <BufferedNumberField
            value={d.pairedTol} min={0} required width={64} aria-label="No-change tolerance"
            title="A line whose after - before is at most this (absolute, in the column's unit) counts as no change"
            onValue={(v) => st.setDist2({ pairedTol: v ?? 0 })}
          />
        </Picker>
      )}
      <StatFacetPicker st={st} />
    </>
  );
}

/** What the plot's own settings ask of a variant that it cannot draw (item 20). Said here rather than
 *  left as a plot that quietly ignores them: the Stat Stage draws neither axis breaks nor an inset,
 *  and a faceted histogram has no rug (the export refuses it too). */
export function variantNotes(
  st: Pick<StatStageState, "mode" | "facetCol" | "dist2" | "groupCol" | "rug" | "fit">,
  plot: { breaks: boolean; inset: boolean },
): string[] {
  const variant = st.mode === "sideviolin" || st.mode === "lollipop" || st.mode === "paired" || (st.mode === "histogram" && st.dist2.histSplit && st.groupCol != null);
  const plainFacetHist = st.mode === "histogram" && st.facetCol != null;
  if (!variant && !plainFacetHist) return [];
  const out: string[] = [];
  if (st.mode === "sideviolin" && st.dist2.violinSide === "split" && st.dist2.violinRain) out.push("Rain points are drawn beside a half violin only: none on a split violin.");
  if (st.mode === "lollipop" && st.dist2.lollipopStat !== "mean" && st.dist2.lollipopWhisker !== "none") out.push("Whiskers are drawn for the mean only: none on a median lollipop.");
  if (plainFacetHist && st.dist2.histPercent && !st.dist2.histStack) out.push("100 % needs the stacked histogram.");
  if (plot.breaks) out.push("This plot is not drawn with axis breaks: the breaks stay saved but do not apply here.");
  if (plot.inset) out.push("This plot is not drawn with an inset: the inset stays saved but does not apply here.");
  if (st.mode === "histogram" && st.facetCol != null && resolveRug(st.rug)) out.push("The rug is not drawn on a faceted histogram.");
  if (plainFacetHist && !st.dist2.histSplit && st.fit) out.push("The distribution fit is not drawn on a faceted histogram.");
  return out;
}

/** Whether the focused plot carries axis breaks / an inset the variants cannot draw. */
function usePlotExtras(): { breaks: boolean; inset: boolean } {
  const breaks = useApp((s) => {
    const b = s.plotWindows.find((w) => w.id === s.focusedWindowId)?.document?.plot.axisBreaks;
    return !!b && b.x.length + b.y.length + b.y2.length > 0;
  });
  const inset = useApp((s) => s.insetMode);
  return { breaks, inset };
}

export default function StatDist3Controls({ st }: { st: StatStageState }) {
  const notes = variantNotes(st, usePlotExtras());
  return (
    <>
      <Controls st={st} />
      {notes.map((n) => (
        <span key={n} role="note" style={{ fontSize: 11, color: "var(--text-faint)" }}>{n}</span>
      ))}
    </>
  );
}
