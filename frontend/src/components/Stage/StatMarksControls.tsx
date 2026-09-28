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
//   * violin — points + jitter (its summary is its inner quartile glyph);
//   * bar    — error bars (the bar IS the mean);
//   * all    — label rotation and wrapping.

import type { ReactNode } from "react";

import type { StatMode } from "../../lib/statstage";
import type { ResolvedStatMarks, StatMarks } from "../../lib/statMarks";
import { Checkbox } from "../primitives/Checkbox";
import { Select } from "../primitives";

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
}

export default function StatMarksControls({ mode, marks, setMarks, grouped }: StatMarksControlsProps) {
  const boxFamily = mode === "box" || mode === "strip";
  const hasPoints = boxFamily || mode === "violin";
  // Box draws its outliers as fliers on the centre line; only "all" jitters.
  const jitters = hasPoints && marks.points !== "none" && !(mode === "box" && marks.points === "outliers");
  const errorsLive = mode === "bar" || (boxFamily && marks.summary === "mean");
  const jitterValue = marks.jitterWidth === 0 ? "off" : String(marks.jitterWidth);
  const jitterOptions = [
    { value: "off", label: "off" },
    ...[...new Set([...JITTER, ...(marks.jitterWidth > 0 ? [marks.jitterWidth] : [])])]
      .sort((a, b) => a - b)
      .map((w) => ({ value: String(w), label: `${Math.round(w * 100)}%` })),
  ];
  return (
    <span data-testid="stat-marks-controls" style={{ display: "contents" }}>
      {hasPoints && (
        <Picker label="points">
          <Select
            aria-label="raw points"
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
      {boxFamily && (
        <Picker label="summary">
          <Select
            aria-label="summary marker"
            options={SUMMARY}
            value={marks.summary}
            onChange={(e) => setMarks({ summary: e.target.value as StatMarks["summary"] }, "set summary marker")}
          />
        </Picker>
      )}
      {(boxFamily || mode === "bar") && (
        <Picker label="error bars">
          <Select
            aria-label="error bars"
            title={errorsLive ? ERROR_HINT : "Error bars are drawn about the mean — pick the mean summary marker"}
            disabled={!errorsLive}
            options={ERRORS}
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
