import { reportEmit, type IntegrateResponse } from "../../lib/api";
import { fmtNum } from "../../lib/format";
import type { CalcResult, Dataset } from "../../lib/types";
import { addReportWithProvenance } from "../../store/addReportWithProvenance";
import type { GadgetMode } from "../../lib/quickfit";

interface GadgetReportInput {
  active: Dataset;
  roi: [number, number];
  mode: GadgetMode;
  model: string;
  fitResult: CalcResult | null;
  integrateResult: IntegrateResponse | null;
  statsResult: CalcResult | null;
}

export async function addGadgetReport(input: GadgetReportInput): Promise<void> {
  const { active, roi, mode, model, fitResult, integrateResult, statsResult } = input;
  const caption = `region ${fmtNum(Math.min(...roi))}–${fmtNum(Math.max(...roi))}`;
  const source_refs = [{ kind: "dataset", id: active.id, name: active.name }];
  if (mode === "fit" && fitResult) {
    const params = (fitResult.params as number[] | undefined) ?? [];
    const title = `${model} quick-fit — ${active.name}`;
    const { report } = await reportEmit({
      kind: "curve_fit",
      result: fitResult as Record<string, unknown>,
      param_names: params.map((_, index) => `p${index}`),
      model_name: model,
      title,
      caption,
      source_refs,
    });
    addReportWithProvenance(title, report, active.id);
  } else if (mode === "integrate" && integrateResult) {
    const title = `Integrate — ${active.name}`;
    const { report } = await reportEmit({
      kind: "integrate",
      result: integrateResult as unknown as Record<string, unknown>,
      title,
      caption,
      source_refs,
    });
    addReportWithProvenance(title, report, active.id);
  } else if (mode === "stats" && statsResult) {
    const title = `Stats — ${active.name}`;
    const { report } = await reportEmit({
      kind: "stats_table",
      records: [statsResult as Record<string, unknown>],
      columns: ["N", "mean", "std", "min", "max"],
      title,
      caption,
      source_refs,
    });
    addReportWithProvenance(title, report, active.id);
  }
}
