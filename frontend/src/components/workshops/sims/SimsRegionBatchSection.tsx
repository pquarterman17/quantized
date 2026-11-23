// SIMS Region tab, "Batch over selected worksheets": the region, species and
// threshold set above are measured on every profile selected in the Library,
// through the shared StatsBatchSection / AnalysisBatchControls (preflight,
// sequential runs, Cancel, a failed profile as an error row, one
// analysis-batch result that dedupes an identical re-run). "Create summary
// worksheet" commits the table through commitBatchTable (one undo step, no
// duplicate on a repeat click, stale when any profile changes). Depth is the
// time axis, so the selection carries no X column (statistics inputs).
// Opt-in: closed by default, so it never claims the shared selection.

import { useCallback, useMemo, useState } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import { summaryX, summaryXNote, type SummaryXChoice } from "../../../lib/batchSummaryX";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { commitBatchTable } from "../../../store/commitBatchTable";
import { useApp } from "../../../store/useApp";
import { Checkbox } from "../../primitives/Checkbox";
import type { AnalysisBatchRow } from "../analysisselection/AnalysisBatchControls";
import StatsBatchSection from "../analysisselection/StatsBatchSection";
import {
  depthUnitProblem, regionBatchColumns, regionSummaryData, runRegionBatchItem, type RegionBatchSettings,
} from "./simsRegionBatch";
import type { RegionForm } from "./useSimsRegion";

const PRODUCER = { id: "sims-region-batch-summary", label: "SIMS region summary", version: 1 } as const;
const TOOL = "sims-region";

interface Props {
  form: RegionForm;
  /** The chosen species, in the Region tab profile's column order. */
  species: readonly string[];
  /** The depth unit the form's limits are stated in. */
  xUnit: string;
  /** The form is incomplete / invalid (the live measure's own message). */
  formError: string | null;
}

export default function SimsRegionBatchSection({ form, species, xUnit, formError }: Props) {
  const datasets = useApp((s) => s.datasets);
  const setStatus = useApp((s) => s.setStatus);
  const owner = useAnalysisSelection((s) => s.toolId);
  const selection = useAnalysisSelection((s) => s.selection);
  const [allowBlanks, setAllowBlanks] = useState(false);
  const selected = useMemo(() => {
    if (owner !== TOOL || !selection) return [];
    const ids = new Set(selection.items.map((i) => i.datasetId));
    return datasets.filter((d) => ids.has(d.id));
  }, [owner, selection, datasets]);
  const blockedReason = formError ?? depthUnitProblem(selected, xUnit);
  const settings = useMemo<RegionBatchSettings>(() => ({ form, species, xUnit, allowBlanks }), [form, species, xUnit, allowBlanks]);
  const runItem = useCallback(
    async (dataset: Dataset, _item: AnalysisSelectionItem) => runRegionBatchItem(dataset, settings),
    [settings],
  );

  const summarySheet = (ranRows: readonly AnalysisBatchRow[], xChoice: SummaryXChoice): string | null => {
    const ordered = datasets.flatMap((d) => ranRows.filter((r) => r.datasetId === d.id));
    const x = summaryX(
      ordered.map((r) => {
        const d = datasets.find((e) => e.id === r.datasetId);
        return { name: r.name, metadata: d?.data.metadata, labels: d?.data.labels };
      }),
      xChoice,
    );
    const built = regionSummaryData(ordered, species, form, allowBlanks, x);
    if ("refused" in built) {
      setStatus(`SIMS region summary: ${built.refused}`, "danger");
      return null;
    }
    const sources = ordered.flatMap((r) => {
      const d = datasets.find((e) => e.id === r.datasetId);
      return d ? [{ id: d.id, computedOn: analysisDataFingerprint(d) }] : [];
    });
    const name = `SIMS region summary (${ordered.length} profile${ordered.length === 1 ? "" : "s"})`;
    const note = summaryXNote(x);
    const outcome = commitBatchTable({
      producer: PRODUCER,
      sources,
      settings: {
        lo: form.lo, hi: form.hi, mode: form.mode, threshold: form.threshold, species: [...species], xUnit, allowBlanks,
        inputs: ordered.map((r) => [r.datasetId, r.status]),
      },
      name,
      data: built.data,
      status: `added the worksheet "${name}" to the Library (Undo removes)${note ? `; ${note}` : ""}`,
    });
    return outcome.kind === "created" || outcome.kind === "replaced" ? outcome.outputId : null;
  };

  return <>
    <StatsBatchSection
      toolId={TOOL}
      label="SIMS region"
      meaning={`The region, species and threshold above are measured on each selected profile (depth in ${xUnit || "its recorded unit"}).`}
      rowsNote="Excluded and filtered-out rows are left out. Profiles with another depth unit, a missing species or non-finite data are refused, never guessed."
      summaryColumns={regionBatchColumns(species)}
      runItem={runItem}
      resultParameters={{
        lo: form.lo, hi: form.hi, mode: form.mode, threshold: form.threshold, species: [...species], xUnit, allowBlanks,
      }}
      blockedReason={blockedReason}
      onSummarySheet={summarySheet}
    />
    <div style={{ marginTop: 6 }}>
      <Checkbox checked={allowBlanks} onChange={setAllowBlanks}>
        Bridge blank samples inside the region (as the Region tab does)
      </Checkbox>
    </div>
  </>;
}
