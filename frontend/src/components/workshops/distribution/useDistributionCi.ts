// Distribution workshop: the confidence-interval panel's state. For the
// profiled column's finite values it asks /api/stats/confidence-intervals at
// the chosen level (percent, default 95), with the bootstrap rows only when
// switched on. The answer is stamped with the request it answers and shown
// only while that is still the live one, so a column or level change never
// shows the previous numbers; an unusable level is reported, never sent.

import { useEffect, useState } from "react";

import { statsConfidenceIntervals, type CiResult } from "../../../lib/api/statsCi";
import type { CiRow } from "../../../lib/api/statsCi";

export const DEFAULT_CI_PERCENT = 95;
export const CI_PERCENT_RANGE = [50, 99.99] as const;

export interface DistributionCi {
  percent: number;
  setPercent: (p: number) => void;
  bootstrap: boolean;
  setBootstrap: (on: boolean) => void;
  result: CiResult | null;
  busy: boolean;
  /** Why there is no table: a bad level, or the backend's reason (too few values, bootstrap limit). */
  error: string | null;
}

export function ciLevelProblem(percent: number): string | null {
  return Number.isFinite(percent) && percent >= CI_PERCENT_RANGE[0] && percent <= CI_PERCENT_RANGE[1]
    ? null
    : `The confidence level must be between ${CI_PERCENT_RANGE[0]}% and ${CI_PERCENT_RANGE[1]}%.`;
}

export function useDistributionCi(finite: readonly number[]): DistributionCi {
  const [percent, setPercent] = useState(DEFAULT_CI_PERCENT);
  const [bootstrap, setBootstrap] = useState(false);
  const [landed, setLanded] = useState<{ finite: readonly number[]; percent: number; bootstrap: boolean; result: CiResult | null; error: string | null } | null>(null);
  const problem = ciLevelProblem(percent);

  useEffect(() => {
    if (problem || finite.length < 2) return;
    const ctl = new AbortController();
    statsConfidenceIntervals(finite, percent / 100, bootstrap, ctl.signal)
      .then((result) => setLanded({ finite, percent, bootstrap, result, error: null }))
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setLanded({ finite, percent, bootstrap, result: null, error: e instanceof Error ? e.message : "could not compute the intervals" });
      });
    return () => ctl.abort();
  }, [finite, percent, bootstrap, problem]);

  const current = landed && landed.finite === finite && landed.percent === percent && landed.bootstrap === bootstrap ? landed : null;
  const tooFew = finite.length < 2 ? "A confidence interval needs at least 2 values." : null;
  return {
    percent, setPercent, bootstrap, setBootstrap,
    result: problem || tooFew ? null : current?.result ?? null,
    busy: !problem && !tooFew && current === null,
    error: problem ?? tooFew ?? current?.error ?? null,
  };
}

/** The table as tab-separated text (full precision), for the clipboard. */
export function ciTableText(rows: readonly CiRow[], percent: number): string {
  const num = (v: number | null): string => (v === null ? "" : String(v));
  const head = ["statistic", "method", "estimate", "lower", "upper", "coverage %"].join("\t");
  const body = rows.map((r) => [r.statistic, r.method, num(r.estimate), num(r.low), num(r.high), String(Number((r.level * 100).toPrecision(6)))].join("\t"));
  return [`Confidence intervals, requested level ${percent}%`, head, ...body].join("\n");
}
