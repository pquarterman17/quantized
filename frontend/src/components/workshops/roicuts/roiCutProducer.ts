// The analysis-result producers for the ROI cuts workshop's outputs (lane RL2):
// a box / sector / chi cut and the batch's cuts and summary table commit
// through the shared contract (store/analysisOutputCommit.ts).

export const ROI_CUT_PRODUCER = { id: "roi-cut", label: "ROI cut", version: 1 } as const;
export const ROI_BATCH_SUMMARY_PRODUCER = { id: "roi-batch-summary", label: "ROI batch summary", version: 1 } as const;
