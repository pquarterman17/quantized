// A tool whose output is computed in one go (a magnetometry normalization, a
// spin asymmetry) and written straight to a worksheet commits through the
// shared contract here (lane RL4). The commit key carries a digest of the
// output itself (`dataFingerprint`), so it encodes exactly what would be
// written: the same run on the same data finds the existing worksheet (a repeat
// Apply creates nothing), and any change to the table commits normally. The
// first source is the primary one; further sources ride along as `alsoFrom`, so
// a change to ANY of them marks the output stale per the recalc mode.

import type { AnalysisResultProducer } from "../lib/analysisResult";
import type { CommitSettings } from "../lib/committedOutput";
import { dataFingerprint } from "../lib/dataFingerprint";
import type { Dataset, DataStruct } from "../lib/types";
import { commitAnalysisOutput, type AnalysisCommitOutcome } from "./analysisOutputCommit";
import { useApp } from "./useApp";

export function commitComputedOutput(args: {
  producer: AnalysisResultProducer;
  /** Source worksheet ids with their analysis-view fingerprint as computed. */
  sources: readonly { id: string; computedOn: string }[];
  settings: CommitSettings;
  name: string;
  data: DataStruct;
  errorRoles?: Dataset["errorRoles"];
  derivedFrom?: Dataset["derivedFrom"];
  status?: string;
}): AnalysisCommitOutcome {
  // The same worksheet twice (two channels of one file) is one source.
  const [primary, ...rest] = args.sources.filter((s, i, all) => all.findIndex((o) => o.id === s.id) === i);
  if (!primary) {
    useApp.getState().setStatus(`${args.producer.label}: no source worksheet to add the output from; nothing was added`, "danger");
    return { kind: "refused", reason: "no source" };
  }
  return commitAnalysisOutput({
    producer: args.producer,
    sourceId: primary.id,
    computedOn: primary.computedOn,
    alsoFrom: rest,
    settings: { ...args.settings, output: dataFingerprint(args.data) },
    output: () => ({
      name: args.name, data: args.data,
      ...(args.errorRoles ? { errorRoles: args.errorRoles } : {}),
      ...(args.derivedFrom ? { derivedFrom: args.derivedFrom } : {}),
    }),
    ...(args.status ? { status: args.status } : {}),
  });
}
