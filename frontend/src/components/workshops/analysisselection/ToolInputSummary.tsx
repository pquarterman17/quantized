// The shared input line for a tool whose row policy is the plain analysis view
// (lib/analysisInputs ROW_POLICY.analysisView) and whose data path is its own:
// Surface fit, Ellipse fit, Peak wizard, Tabulate, Pie and Ternary. It states
// what the tool already does (excluded and filtered-out rows left out, selected
// rows and plot X range not read); it changes no tool's inputs. A row range set
// on the worksheet narrows the tools that read it and is stated as not applied
// by the ones that do not (`ignoreRowRange`).

import { ROW_POLICY } from "../../../lib/analysisInputs";
import AnalysisInputSummary from "./AnalysisInputSummary";
import { useAnalysisInputs } from "./useAnalysisInputs";

interface Props {
  /** Explicit X pick (null = the X/time column). Omit for a tool with no X. */
  xKey?: number | null;
  /** The columns the tool reads (-1 = the X column); repeats are listed once. */
  columns: readonly number[];
  /** The tool has no X axis (the line omits "X:"). */
  noX?: boolean;
  /** False for a tool that resolves a lazy Origin preview itself, so the line
   *  does not start a full load the tool did not ask for. */
  load?: boolean;
  /** The tool's own data path does not read a row range (Pie, Ternary): the line
   *  then says a range set on the worksheet is not applied. */
  ignoreRowRange?: boolean;
}

export default function ToolInputSummary({ xKey, columns, noX, load = true, ignoreRowRange = false }: Props) {
  const inputs = useAnalysisInputs({
    xKey, yKeys: [...new Set(columns)], noX, load,
    policy: ignoreRowRange ? ROW_POLICY.analysisViewAllRows : ROW_POLICY.analysisView,
  });
  return <AnalysisInputSummary inputs={inputs} />;
}
