// "Open in <tool>" in the result workspace (lane RO): reopen a committed
// output's producing tool seeded with its recorded source and settings
// (store/toolReopenOpen.ts). Disabled with the reason for a producer that does
// not reopen (a multi-source batch table, a fit band).

import { useMemo } from "react";

import type { AnalysisResult } from "../../../lib/analysisResult";
import { planReopen } from "../../../lib/committedOutputReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";

export default function ReopenInToolButton({ result, disabled }: { result: AnalysisResult; disabled: boolean }) {
  const datasets = useApp((s) => s.datasets);
  const plan = useMemo(() => planReopen(result, datasets), [result, datasets]);
  const open = () => {
    if (openCommittedResultInTool(result.id)) useApp.setState({ openAnalysisResultId: null });
  };
  return (
    <Button disabled={!plan.ok || disabled}
      title={!plan.ok ? plan.reason : plan.notice ?? `Reopen ${plan.toolLabel} with this result's source and settings to adjust and commit again.`}
      onClick={open}>{plan.label}</Button>
  );
}
