// Stat Stage — WHICH COLUMNS are picked, and the three rules that govern them:
// how they default per dataset, how a cross-panel "send to stage" overrides
// them, and how a pick goes stale.
//
// Extracted from `useStatStage.ts` (Group R) because that hook sat exactly at
// its 704-line pin and this is the cohesive unit the nested second factor
// touches. The rules belong together because they all govern the SAME four
// picks, and the first two are ORDER-DEPENDENT:
//
//   * the per-dataset reset must be declared BEFORE the seed effect, so a
//     "send to stage" targeting the SAME dataset wins (both fire in the same
//     commit; the later effect's writes land last). That ordering was a
//     deliberate choice in the original hook and is preserved verbatim here —
//     which is most of why the two moved together rather than one at a time.
//   * the staleness mask then reads over the top of whatever they left. It is
//     pure and writes nothing (`lib/statstage.maskStaleCategoricalPicks`),
//     which is exactly why the RAW picks survive an override being reverted.
//
// `mode` lives here too, because the seed sets it in the same breath as the
// columns and splitting them would put half of one write in each file.
//
// NOT extracted: `dist`/`bins`/`fit`/`barStack` and the box/strip mark toggles.
// Those are per-mode display options that no reset, seed, or mask touches.

import { useEffect, useState } from "react";

import {
  categoricalChannels,
  firstValueChannel,
  maskStaleCategoricalPicks,
  type StatMode,
} from "../../lib/statstage";
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
  /** MASKED picks — what the grouping/faceting math must use. Never a column
   *  that has stopped reading as categorical, and (for `group2Col`) never a
   *  nesting that would be degenerate. See `maskStaleCategoricalPicks`. */
  effectiveGroupCol: number | null;
  effectiveGroup2Col: number | null;
  effectiveFacetCol: number | null;
}

export interface UseStatStagePicksParams {
  active: Dataset | null;
  /** The channels that read as categorical, in channel order — the option
   *  list the group/nest/facet pickers are built from, and the set the
   *  staleness mask checks against. */
  categoricalCols: readonly { index: number }[];
  seed: StatStageSeed | null;
  onSeedConsumed: () => void;
}

export function useStatStagePicks(params: UseStatStagePicksParams): StatStagePicks {
  const { active, categoricalCols, seed, onSeedConsumed } = params;

  const [mode, setMode] = useState<StatMode>("box");
  const [groupCol, setGroupColState] = useState<number | null>(null);
  // Nested second factor (Group R) — internal picker state like `facetCol`,
  // never a hook param: background windows have no picker and never set one.
  const [group2Col, setGroup2ColState] = useState<number | null>(null);
  const [valueCol, setValueCol] = useState<number>(0);
  // Facet column (GUI_INTERACTION #11) — internal picker state, NOT a hook
  // param: background windows (params.seed === null) have no facet Picker
  // and never call setFacetCol, so they simply never facet.
  const [facetCol, setFacetColState] = useState<number | null>(null);

  // Re-derive the default picks whenever the active dataset changes — a
  // channel index from the PREVIOUS dataset would silently mis-group.
  useEffect(() => {
    const cats = categoricalChannels(active);
    const g = cats[0] ?? null;
    setGroupColState(g);
    setValueCol(firstValueChannel(active, g ?? -999));
    setGroup2ColState(null);
    setFacetColState(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  // Cross-panel hook: the Graph Builder hands over the mode + pickers for a
  // box/violin/bar spec it "sent to stage" (mirrors the reflectivity SLD
  // seed). Declared AFTER the active-id reset so a same-dataset send wins.
  useEffect(() => {
    if (!seed) return;
    setMode(seed.mode);
    setGroupColState(seed.groupCol);
    setValueCol(seed.valueCol);
    // CLEARED, not left alone: a `StatStageSeed` fully specifies its grouping
    // and has no second factor to send (Graph Builder's spec carries one
    // category zone). Leaving a previously picked nest in place would silently
    // split the sent plot by a column the sender never mentioned.
    setGroup2ColState(null);
    setFacetColState(seed.facetCol ?? null);
    onSeedConsumed();
  }, [seed, onSeedConsumed]);

  // BUG-004 (BUGS_AND_ISSUES.md): mask a stale groupCol/group2Col pick back to
  // null once its column stops reading as categorical (a channelTypes override
  // landed after the pick was made) — applied to BOTH the exposed picker value
  // and the grouping math, not display-only. `facetCol` is deliberately NOT
  // masked. See lib/statstage.ts's maskStaleCategoricalPicks for the full
  // reasoning, including why the two behave differently.
  const effective = maskStaleCategoricalPicks(groupCol, facetCol, categoricalCols, group2Col);

  return {
    mode,
    setMode,
    groupCol,
    setGroupCol: setGroupColState,
    group2Col,
    setGroup2Col: setGroup2ColState,
    valueCol,
    setValueCol,
    facetCol,
    setFacetCol: setFacetColState,
    effectiveGroupCol: effective.groupCol,
    effectiveGroup2Col: effective.group2Col,
    effectiveFacetCol: effective.facetCol,
  };
}
