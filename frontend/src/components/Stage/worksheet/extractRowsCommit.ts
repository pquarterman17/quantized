// The commit half of the worksheet's Extract action (reopen gaps lane): the
// "(subset)" worksheet is written through the shared result contract (one undo
// step with a Library result linked to its source, out of date when the source
// changes, a repeat of the same extract adds nothing) instead of a raw
// `addDataset`. `useWorksheetView` keeps the gesture; this keeps the contract.

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { planSourceLink, stampSourceLink } from "../../../lib/sourceRowLink";
import type { Dataset } from "../../../lib/types";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import { installSourceIdentities } from "../../../store/sourceRowLink";
import { describeExtract, type ExtractPlan } from "./extractRows";

/** Commit the extract. The child records which source rows it holds (`__quantized_source_rows`, ROW_RANGE_CONTRACT
 *  section 4), so Go to Source finds them after the source is sorted, grown or shrunk; above the cap it is
 *  unlinked and the status says so. `quiet`: add beside the source without activating it (a plot's "Create
 *  subset from region" keeps the graph in focus); `patch`: where it lands (its workbook); `onAdded` gets the new worksheet's id.
 *  Null: a new worksheet was added (the caller reports it); else the status to show instead (refused, already
 *  in the Library, or added without its row link). */
export function commitExtract(
  source: Dataset, plan: ExtractPlan, nameOf: (datasetId: string) => string | undefined,
  options: { quiet?: boolean; onAdded?: (outputId: string) => void; patch?: Partial<Dataset> } = {},
): { status: string; tone: "danger" | "ok" } | null {
  const linkPlan = planSourceLink(source, plan.rows);
  const data = stampSourceLink(plan.data, linkPlan.kind === "linked" ? linkPlan.link : null);
  const name = `${source.name.replace(/\.[^.]+$/, "")} (subset)`;
  const outcome = commitComputedOutput({
    producer: { id: "worksheet-subset", label: "Extract rows", version: 1 },
    sources: [{ id: source.id, computedOn: analysisDataFingerprint(source) }],
    settings: { rows: plan.data.time.length, of: source.data.time.length },
    xKey: null, // the rows are cut along the worksheet's own X
    name, data, ...(options.quiet ? { quiet: true } : {}),
    ...(options.patch ? { patch: options.patch } : {}),
  });
  if (outcome.kind === "refused") return { status: outcome.reason, tone: "danger" };
  if (outcome.kind === "existing") {
    const shown = nameOf(outcome.outputId) ?? name;
    return { status: `this extract is already in the Library as “${shown}”; nothing was duplicated`, tone: "ok" };
  }
  if (linkPlan.kind === "linked") installSourceIdentities(source.id, linkPlan.sourceMetadata); // after the commit: Undo takes the child, and the identities are inert without it
  options.onAdded?.(outcome.outputId);
  return linkPlan.kind === "unlinked" ? { status: `${describeExtract(plan, source.data.time.length)}; ${linkPlan.reason}`, tone: "ok" } : null;
}
