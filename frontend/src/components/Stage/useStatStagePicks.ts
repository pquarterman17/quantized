// Stat Stage — WHAT IS PICKED: the plot type, the five column picks (group,
// nested second group, value, facet, colour-by) and the Q-Q / histogram / bar
// options, plus the three rules that govern the columns: how they default per
// dataset, how a cross-panel "send to stage" overrides them, and how a pick
// goes stale.
//
// Extracted from `useStatStage.ts` (Group R) because that hook sat exactly at
// its 704-line pin and this is the cohesive unit the nested second factor
// touches.
//
// PERSISTED PER WINDOW (2026-10-01). The picks are the window's
// `PlotView.statPicks` (sanitized on load by `lib/plotviewSanitize`), so they
// ride every window snapshot, undo entry and `.dwk`. They used to be
// `useState` here, and File ▸ Save workspace + reopen came back in box mode
// with default columns. The caller passes the saved picks and a writer (the
// focused stage: the live store field and `store/statLevelOptions.
// setStatPicks`; a background window: its own view's picks, no writer).
// With neither, the hook keeps them itself (a bare hook in a test).
//
// The columns are DERIVED, not reset. They used to be reset to the dataset's
// defaults by an effect on `active?.id`, which also ran on the first render
// after a reopen and would have wiped what the file restored. Now a saved
// column is `[index, label]`, and `lib/statPicks.resolveStatCols` resolves the
// set against whatever dataset is showing: kept while every saved column is
// still there, the dataset's defaults otherwise (and while nothing is saved).
// The reset's own reason (an index from another dataset names a different
// column) is exactly the case the label check catches.
//
//   * the seed: a "send to stage" writes ALL the column picks at once,
//     labelled from the dataset showing when it lands, so it always wins.
//   * the staleness mask then reads over the top of the resolved picks. It is
//     pure and writes nothing (`lib/statstage.maskStaleCategoricalPicks`),
//     which is exactly why the RAW picks survive an override being reverted.
//
// NOT here: the box/strip mark toggles (`PlotView.statMarks`, per mode).

import { useCallback, useEffect, useMemo, useState } from "react";

import type { StatPicks } from "../../lib/plotviewSanitize";
import { defaultStatCols, resolveStatCols, statColRef, statColRefs, type StatCols } from "../../lib/statPicks";
import { maskStaleCategoricalPicks, type StatMode } from "../../lib/statstage";
import type { Dataset } from "../../lib/types";
import type { StatStageSeed } from "../../store/useApp";

export interface StatStagePicks {
  mode: StatMode;
  setMode: (m: StatMode) => void;
  /** RAW picks — what the toolbar `<select>`s show. */
  groupCol: number | null;
  setGroupCol: (i: number | null) => void;
  group2Col: number | null;
  setGroup2Col: (i: number | null) => void;
  valueCol: number;
  setValueCol: (i: number) => void;
  facetCol: number | null;
  setFacetCol: (i: number | null) => void;
  /** P1.4 Color-by: which grouping factor colours the glyphs (`lib/statColor`). */
  colorCol: number | null;
  setColorCol: (i: number | null) => void;
  /** MASKED picks — what the grouping/faceting math must use. Never a column
   *  that has stopped reading as categorical, and (for `group2Col`) never a
   *  nesting that would be degenerate. See `maskStaleCategoricalPicks`. */
  effectiveGroupCol: number | null;
  effectiveGroup2Col: number | null;
  effectiveFacetCol: number | null;
  dist: string;
  setDist: (d: string) => void;
  bins: string;
  setBins: (b: string) => void;
  fit: string | null;
  setFit: (f: string | null) => void;
  barStack: boolean;
  setBarStack: (s: boolean) => void;
}

export interface UseStatStagePicksParams {
  active: Dataset | null;
  /** The channels that read as categorical, in channel order — the option
   *  list the group/nest/facet pickers are built from, and the set the
   *  staleness mask checks against. */
  categoricalCols: readonly { index: number }[];
  seed: StatStageSeed | null;
  onSeedConsumed: () => void;
  /** The window's saved picks, and the writer that maps them to the next
   *  (persisted + one undo entry). Both absent = hook-local picks. */
  picks?: StatPicks | null;
  onPicksChange?: (update: (p: StatPicks) => StatPicks, label?: string) => void;
}

export function useStatStagePicks(params: UseStatStagePicksParams): StatStagePicks {
  const { active, categoricalCols, seed, onSeedConsumed, onPicksChange } = params;

  const [localPicks, setLocalPicks] = useState<StatPicks>({});
  const picks = params.picks ?? localPicks;
  // A write that changes nothing hands back the SAME object, which both
  // writers treat as a no-op (no re-render, no undo entry): the seed effect
  // re-runs whenever its callback identity changes, and must settle.
  const write = useCallback(
    (update: (p: StatPicks) => StatPicks, label?: string) => {
      const settled = (p: StatPicks) => {
        const next = update(p);
        return JSON.stringify(next) === JSON.stringify(p) ? p : next;
      };
      if (onPicksChange) onPicksChange(settled, label);
      else setLocalPicks(settled);
    },
    [onPicksChange],
  );

  // The defaults are fixed per dataset ID, as the old reset fixed them: a
  // channelTypes override on the same dataset must leave the default group
  // alone for the staleness mask below to hide, not move it to another column.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const defaults = useMemo(() => defaultStatCols(active), [active?.id]);
  const cols = useMemo(() => resolveStatCols(active, picks.cols, defaults), [active, picks.cols, defaults]);

  // One column pick: re-resolve the CURRENT saved set (not this render's) so
  // two picks in one tick compose, then save all five labelled from `active`.
  const setCol = (key: keyof StatCols) => (i: number | null) =>
    write((p) => {
      const now = statColRefs(active, resolveStatCols(active, p.cols, defaults));
      return { ...p, cols: { ...now, [key]: i == null ? null : statColRef(active, i) } };
    }, "pick statistics column");
  const setPick = <K extends "mode" | "dist" | "bins" | "fit" | "barStack">(key: K) => (v: StatPicks[K]) =>
    write((p) => ({ ...p, [key]: v }), "change statistics plot");

  // Cross-panel hook: the Graph Builder hands over the mode + pickers for a
  // box/violin/bar spec it "sent to stage" (mirrors the reflectivity SLD seed).
  useEffect(() => {
    if (!seed) return;
    // CLEARED unless sent, not left alone: a `StatStageSeed` fully specifies
    // its grouping. Its only second factor is a Color pick on another column
    // (P1.4), which nests the plot by that column; leaving a previously picked
    // nest in place would split the sent plot by a column the sender never named.
    const sent: StatCols = {
      group: seed.groupCol,
      group2: seed.group2Col ?? null,
      value: seed.valueCol,
      facet: seed.facetCol ?? null,
      color: seed.colorCol ?? null,
    };
    write((p) => ({ ...p, mode: seed.mode, cols: statColRefs(active, sent) }), "send to statistics");
    onSeedConsumed();
    // `active` only labels the sent columns: a dataset change must not re-send.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, onSeedConsumed, write]);

  // BUG-004 (BUGS_AND_ISSUES.md): mask a stale groupCol/group2Col pick back to
  // null once its column stops reading as categorical (a channelTypes override
  // landed after the pick was made) — applied to BOTH the exposed picker value
  // and the grouping math, not display-only. `facetCol` is deliberately NOT
  // masked. See lib/statstage.ts's maskStaleCategoricalPicks for the full
  // reasoning, including why the two behave differently.
  const effective = maskStaleCategoricalPicks(cols.group, cols.facet, categoricalCols, cols.group2);

  return {
    mode: picks.mode ?? "box",
    setMode: setPick("mode"),
    groupCol: cols.group,
    setGroupCol: setCol("group"),
    group2Col: cols.group2,
    setGroup2Col: setCol("group2"),
    valueCol: cols.value,
    setValueCol: setCol("value"),
    facetCol: cols.facet,
    setFacetCol: setCol("facet"),
    colorCol: cols.color,
    setColorCol: setCol("color"),
    effectiveGroupCol: effective.groupCol,
    effectiveGroup2Col: effective.group2Col,
    effectiveFacetCol: effective.facetCol,
    dist: picks.dist ?? "norm",
    setDist: setPick("dist"),
    bins: picks.bins ?? "fd",
    setBins: setPick("bins"),
    fit: picks.fit ?? null,
    setFit: setPick("fit"),
    barStack: picks.barStack ?? false,
    setBarStack: setPick("barStack"),
  };
}
