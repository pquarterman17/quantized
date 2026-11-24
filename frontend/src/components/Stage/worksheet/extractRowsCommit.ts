// The commit half of the worksheet's Extract action (reopen gaps lane): the
// "(subset)" worksheet is written through the shared result contract (one undo
// step with a Library result linked to its source, out of date when the source
// changes, a repeat of the same extract adds nothing) instead of a raw
// `addDataset`. `useWorksheetView` keeps the gesture; this keeps the contract.

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { Dataset } from "../../../lib/types";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import type { ExtractPlan } from "./extractRows";

/** Commit the extract. Null: a new worksheet was added (the caller reports it);
 *  else the status to show instead (refused, or already in the Library). */
export function commitExtract(source: Dataset, plan: ExtractPlan, nameOf: (datasetId: string) => string | undefined): { status: string; tone: "danger" | "ok" } | null {
  const name = `${source.name.replace(/\.[^.]+$/, "")} (subset)`;
  const outcome = commitComputedOutput({
    producer: { id: "worksheet-subset", label: "Extract rows", version: 1 },
    sources: [{ id: source.id, computedOn: analysisDataFingerprint(source) }],
    settings: { rows: plan.data.time.length, of: source.data.time.length },
    xKey: null, // the rows are cut along the worksheet's own X
    name, data: plan.data,
  });
  if (outcome.kind === "refused") return { status: outcome.reason, tone: "danger" };
  if (outcome.kind === "existing") {
    const shown = nameOf(outcome.outputId) ?? name;
    return { status: `this extract is already in the Library as “${shown}”; nothing was duplicated`, tone: "ok" };
  }
  return null;
}
