// A batch tool's "Add … as dataset" on the shared commit contract (lane RL2):
// the output is one worksheet built from SEVERAL source worksheets (a peak-batch
// summary, a batch-integrate trend). The first source is the primary one, the
// rest ride along as `alsoFrom`, so a change to ANY of them marks the output
// stale and the commit key covers all of them. The key also carries a digest of
// the output itself (`dataFingerprint`), so it encodes exactly what would be
// written: the same run and choices find the existing worksheet, anything that
// changes the table commits normally.

import { dataFingerprint } from "../../../lib/dataFingerprint";
import type { AnalysisResultProducer } from "../../../lib/analysisResult";
import type { CommitSettings } from "../../../lib/committedOutput";
import type { DataStruct } from "../../../lib/types";
import { commitAnalysisOutput, type AnalysisCommitOutcome } from "../../../store/analysisOutputCommit";
import { useApp } from "../../../store/useApp";

export function commitBatchTable(args: {
  producer: AnalysisResultProducer;
  /** Source worksheet ids with their analysis-view fingerprint as computed. */
  sources: readonly { id: string; computedOn: string }[];
  settings: CommitSettings;
  name: string;
  data: DataStruct;
  status?: string;
}): AnalysisCommitOutcome {
  const [primary, ...rest] = args.sources;
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
    output: () => ({ name: args.name, data: args.data }),
    ...(args.status ? { status: args.status } : {}),
  });
}
