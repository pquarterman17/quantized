import { useRef, useState } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { CalcResult, Dataset } from "../../../lib/types";
import { publishDistributionReport } from "../../../store/distributionReport";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import type { DistributionLevelResult, Normality } from "./useDistribution";

interface DistributionReportArgs {
  active: Dataset | null;
  label: string;
  byLabel: string | null;
  byLevels: readonly unknown[];
  byResults: DistributionLevelResult[];
  desc: CalcResult | null;
  norm: Normality | null;
}

export function useDistributionReport(args: DistributionReportArgs): { reportBusy: boolean; toReport: () => Promise<void> } {
  const [reportBusy, setReportBusy] = useState(false);
  const setStatus = useApp((state) => state.setStatus);
  const inFlight = useRef(false);
  const identity = useRef({
    version: 0, active: args.active, label: args.label, byLabel: args.byLabel,
    byLevels: args.byLevels, byResults: args.byResults, desc: args.desc, norm: args.norm,
  });
  const previous = identity.current;
  if (previous.active !== args.active || previous.label !== args.label || previous.byLabel !== args.byLabel ||
      previous.byLevels !== args.byLevels || previous.byResults !== args.byResults ||
      previous.desc !== args.desc || previous.norm !== args.norm) {
    identity.current = {
      version: previous.version + 1, active: args.active, label: args.label, byLabel: args.byLabel,
      byLevels: args.byLevels, byResults: args.byResults, desc: args.desc, norm: args.norm,
    };
  }

  const toReport = async (): Promise<void> => {
    if (inFlight.current) return;
    if (!args.active || args.active.pending) {
      setStatus("load the full worksheet before reporting a Distribution result");
      return;
    }
    const source = args.active;
    const sourceFingerprint = analysisDataFingerprint(source);
    const questionVersion = identity.current.version;
    inFlight.current = true;
    setReportBusy(true);
    try {
      let title: string;
      let records: Record<string, unknown>[];
      if (args.byLevels.length) {
        if (!args.byResults.length) return;
        title = `${args.label} distribution by ${args.byLabel ?? "level"}`;
        records = args.byResults.map((result) => ({
          level: result.label, n: result.n, mean: result.desc?.mean, median: result.desc?.median,
          std: result.desc?.std, min: result.desc?.min, max: result.desc?.max,
          shapiro_W: result.norm?.W, shapiro_p: result.norm?.p,
        }));
      } else {
        if (!args.desc) return;
        title = `${args.label} distribution`;
        records = [{ n: args.desc.N, mean: args.desc.mean, median: args.desc.median,
          std: args.desc.std, min: args.desc.min, max: args.desc.max,
          shapiro_W: args.norm?.W, shapiro_p: args.norm?.p }];
      }
      await publishDistributionReport({
        sourceId: source.id, sourceName: source.name, sourceFingerprint, title, records,
        accept: () => identity.current.version === questionVersion,
      });
    } catch (error) {
      toast(`could not add to report — ${error instanceof Error ? error.message : "unknown error"}`, "danger");
    } finally {
      inFlight.current = false;
      setReportBusy(false);
    }
  };
  return { reportBusy, toReport };
}
