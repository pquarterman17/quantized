// The Stat Stage's categorical-plot marks controls (PRIMARY_SOFTWARE_AUDIT_PLAN
// P2.6 box 1): raw points, jitter, summary marker, error bars, connect-means
// and the category-label options, for Box / Strip / Violin / Bar.
//
// Every control is a native <select> / checkbox — keyboard reachable in tab
// order, operable with arrows / space, labelled for assistive tech — and every
// change is ONE `setMarks` patch, which the focused stage routes to
// `store/statLevelOptions.setStatMarks` (persisted on `PlotView.statMarks`,
// one undo entry). Jitter is a preset list rather than a range slider on
// purpose: a slider emits a change per pixel of a drag, i.e. an undo entry per
// pixel.
//
// What each mode offers (the renderer and the export agree on all of it):
//   * box    — points (all / outliers = its fliers / none), jitter for "all",
//              summary + error bars, connect means;
//   * strip  — points (all / outliers / none), jitter, summary + error bars,
//              connect means;
//   * violin — points + jitter, summary + error bars (its inner glyph is the
//              box's: quartile bar + median, always drawn);
//   * bar    — error bars (the bar IS the mean; always live), and on GROUPED
//              bars points + jitter and a summary marker (stacked: disabled —
//              a raw value has no place inside a stack);
//   * all    — label rotation and wrapping.

import type { ReactNode } from "react";

import type { StatMode } from "../../lib/statstage";
import type { ResolvedStatMarks, StatMarks } from "../../lib/statMarks";
import { Checkbox } from "../primitives/Checkbox";
import { Select } from "../primitives";
import StatSigControls from "./StatSigControls";

const POINTS = [
  { value: "all", label: "all" },
  { value: "outliers", label: "outliers" },
  { value: "none", label: "none" },
];
const JITTER = [0.25, 0.5, 0.7, 0.85, 1];
const SUMMARY = [
  { value: "none", label: "none" },
  { value: "mean", label: "mean" },
  { value: "median", label: "median" },
];
const ERRORS = [
  { value: "none", label: "none" },
  { value: "sd", label: "SD" },
  { value: "se", label: "SE" },
  { value: "ci95", label: "95% CI" },
];
/** Bar mode with a bound error column: its values as the whiskers. */
const FROM_COLUMN = { value: "column", label: "from column" };
const COMPARE = [
  { value: "off", label: "off" },
  { value: "brackets", label: "brackets" },
  { value: "letters", label: "letters" },
];
const METHODS = [
  { value: "tukey", label: "Tukey HSD" },
  { value: "dunnett", label: "Dunnett" },
];
const ROTATIONS = [
  { value: "0", label: "0°" },
  { value: "45", label: "45°" },
  { value: "90", label: "90°" },
];

const ERROR_HINT =
  "Error bars about the group mean: SD = sample SD (n-1); SE = SD/√n; 95% CI = mean ± t(0.975, n-1)·SE. None below n = 2.";

function Picker({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
      {label}
      {children}
    </label>
  );
}

export interface StatMarksControlsProps {
  mode: StatMode;
  marks: ResolvedStatMarks;
  setMarks: (patch: StatMarks, label?: string) => void;
  /** A "group by" column is picked (connect-means needs one). */
  grouped: boolean;
  /** Bar mode draws stacked bars (no points / summary marker there). */
  stacked?: boolean;
  /** Bar mode: the bound error column(s) a whisker can come from, or null --
   *  the error-bar picker then also offers "from column". */
  errorColumn?: string | null;
  /** Significance marks: why none are drawn (null: fine), and the compared
   *  groups' labels (the Dunnett control picker). Absent: no such controls. */
  comparisons?: { error: string | null; labels: string[] };
}

const STACKED_HINT = "Stacked bars carry no raw points or summary marker — switch the layout to grouped";

export default function StatMarksControls({ mode, marks, setMarks, grouped, stacked = false, errorColumn = null, comparisons }: StatMarksControlsProps) {
  const boxFamily = mode === "box" || mode === "strip";
  const categorical = boxFamily || mode === "violin" || mode === "bar";
  const off = mode === "bar" && stacked;
  // Box draws its outliers as fliers on the centre line; only "all" jitters.
  const jitters = categorical && !off && marks.points !== "none" && !(mode === "box" && marks.points === "outliers");
  const errorsLive = mode === "bar" || (categorical && marks.summary === "mean");
  const fromColumn = mode === "bar" && errorColumn != null;
  const errorHint = fromColumn ? `${ERROR_HINT} From column = the values of ${errorColumn} (one-row categories).` : ERROR_HINT;
  const jitterValue = marks.jitterWidth === 0 ? "off" : String(marks.jitterWidth);
  const jitterOptions = [
    { value: "off", label: "off" },
    ...[...new Set([...JITTER, ...(marks.jitterWidth > 0 ? [marks.jitterWidth] : [])])]
      .sort((a, b) => a - b)
      .map((w) => ({ value: String(w), label: `${Math.round(w * 100)}%` })),
  ];
  return (
    <span data-testid="stat-marks-controls" style={{ display: "contents" }}>
      {categorical && (
        <Picker label="points">
          <Select
            aria-label="raw points"
            disabled={off}
            title={off ? STACKED_HINT : undefined}
            options={POINTS}
            value={marks.points}
            onChange={(e) => setMarks({ points: e.target.value as StatMarks["points"] }, "show points")}
          />
        </Picker>
      )}
      {jitters && (
        <Picker label="jitter">
          <Select
            aria-label="jitter width"
            title="Horizontal spread of the raw points, as a share of the box width (deterministic per row)"
            options={jitterOptions}
            value={jitterValue}
            onChange={(e) =>
              setMarks(
                e.target.value === "off" ? { jitter: false } : { jitter: true, jitterWidth: Number(e.target.value) },
                "set jitter",
              )
            }
          />
        </Picker>
      )}
      {categorical && (
        <Picker label="summary">
          <Select
            aria-label="summary marker"
            disabled={off}
            title={off ? STACKED_HINT : undefined}
            options={SUMMARY}
            value={marks.summary}
            onChange={(e) => setMarks({ summary: e.target.value as StatMarks["summary"] }, "set summary marker")}
          />
        </Picker>
      )}
      {categorical && (
        <Picker label="error bars">
          <Select
            aria-label="error bars"
            title={errorsLive ? errorHint : "Error bars are drawn about the mean — pick the mean summary marker"}
            disabled={!errorsLive}
            options={fromColumn ? [...ERRORS, FROM_COLUMN] : ERRORS}
            value={marks.errorBars}
            onChange={(e) => setMarks({ errorBars: e.target.value as StatMarks["errorBars"] }, "set error bars")}
          />
        </Picker>
      )}
      {/* Connect-means "interaction plot" line (JMP_GAP J5 residual): only
          meaningful once a categorical "group by" column picks the
          categories -- hidden under the per-plotted-channel fallback. */}
      {boxFamily && grouped && (
        <Checkbox checked={marks.connectMeans} onChange={(on) => setMarks({ connectMeans: on }, "toggle connect means")}>
          connect means
        </Checkbox>
      )}
      {categorical && comparisons && (
        <>
          {!marks.sig && (<>
          <Picker label="compare">
            <Select
              aria-label="significance marks"
              title="Significance brackets or compact letters from the post-hoc test (opt-in; the test and correction are named under the plot)"
              options={COMPARE}
              value={marks.comparisons}
              onChange={(e) => setMarks({ comparisons: e.target.value as StatMarks["comparisons"] }, "set significance marks")}
            />
          </Picker>
          {marks.comparisons !== "off" && (
            <Picker label="test">
              <Select
                aria-label="comparison test"
                title="Tukey HSD tests every pair; Dunnett tests every group against one control"
                options={METHODS}
                value={marks.compareMethod}
                onChange={(e) => setMarks({ compareMethod: e.target.value as StatMarks["compareMethod"] }, "set comparison test")}
              />
            </Picker>
          )}
          {marks.comparisons !== "off" && marks.compareMethod === "dunnett" && comparisons.labels.length > 0 && (
            <Picker label="control">
              <Select
                aria-label="Dunnett control group"
                options={comparisons.labels.map((l) => ({ value: l, label: l }))}
                value={marks.compareControl ?? comparisons.labels[0]}
                onChange={(e) => setMarks({ compareControl: e.target.value }, "set comparison control")}
              />
            </Picker>
          )}
          {marks.comparisons === "brackets" && (
            <Checkbox checked={marks.compareExact} onChange={(on) => setMarks({ compareExact: on }, "toggle exact p")}>
              exact p
            </Checkbox>
          )}
          {marks.comparisons !== "off" && comparisons.error && (
            <span data-testid="stat-compare-error" role="status" style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {comparisons.error}
            </span>
          )}
          </>)}
          {/* Marks from supplied p-values (item 23): replaces the inline test above while set. */}
          {(marks.sig || marks.comparisons === "off") && (
            <StatSigControls sig={marks.sig ?? null} setMarks={setMarks} error={comparisons.error} />
          )}
        </>
      )}
      <Picker label="labels">
        <Select
          aria-label="label rotation"
          options={ROTATIONS}
          value={String(marks.labelRotation)}
          onChange={(e) =>
            setMarks({ labelRotation: Number(e.target.value) as 0 | 45 | 90 }, "rotate category labels")
          }
        />
      </Picker>
      <Checkbox
        checked={marks.labelWrap}
        onChange={(on) => setMarks({ labelWrap: on }, "wrap category labels")}
        title="Wrap long category labels onto up to three lines (off: each label whole on one line)"
      >
        wrap
      </Checkbox>
    </span>
  );
}
