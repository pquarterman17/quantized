import AnalysisInputReview from "../analysisselection/AnalysisInputReview";
import PeakBatchSection from "./PeakBatchSection";
import type { PeakFindParams } from "./peakFindParams";

export default function PeakAnalysisInputs({ params }: { params: PeakFindParams }) {
  return <>
    <AnalysisInputReview toolId="peaks" singleY supportsBatch />
    <PeakBatchSection params={params} />
  </>;
}
